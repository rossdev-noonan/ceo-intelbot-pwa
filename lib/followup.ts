// Direct Follow-Up Mode + Continue generation (master spec 2026-06-11).
//
// followupStream: after a major Teams/Agents/Hybrid answer exists, normal
// follow-ups ("make that shorter", "combine with the last yaml", small
// questions) are answered from cached conversation state by the CHEAPEST
// configured Perplexity model — no orchestration, no vault retrieval, no QA.
// The narrow-web variant lets Sonar verify current facts directly.
//
// continueStream: resumes an answer that was paused at the output limit,
// continuing from the exact stopping point without repeating content.

import { callAnthropicStream, callOpenAI, callPerplexity, FINAL_MAX_TOKENS } from "@/lib/models";
import { MODELS } from "@/lib/registry";
import { type StreamEvent, type BrainOptions, type BrainDebug } from "@/lib/brain";
import { FOLLOWUP_SYSTEM, CONTINUE_SYSTEM, APP_CAPABILITIES, withInstructions } from "@/lib/prompts";

type Turn = { role: string; content: string };

// Cap what we resend: full last exchange (the thing being transformed), and a
// compact tail of older turns for conversational continuity.
const LAST_ANSWER_MAX = 60_000;
const LAST_QUESTION_MAX = 8_000;
const OLDER_TURN_MAX = 600;
const OLDER_TURNS = 6;

// previous_answer_state, derived from the conversation itself (the client
// resends history every turn, so the thread IS the cache — no server store).
function contextPacket(history?: Turn[]): string {
  const h = history ?? [];
  let lastAnswerIdx = -1;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].role === "assistant" && h[i].content.trim()) {
      lastAnswerIdx = i;
      break;
    }
  }
  if (lastAnswerIdx < 0) return "";
  const lastAnswer = h[lastAnswerIdx].content.slice(0, LAST_ANSWER_MAX);
  let lastQuestion = "";
  for (let i = lastAnswerIdx - 1; i >= 0; i--) {
    if (h[i].role === "user") {
      lastQuestion = h[i].content.slice(0, LAST_QUESTION_MAX);
      break;
    }
  }
  const older = h
    .slice(Math.max(0, lastAnswerIdx - 1 - OLDER_TURNS), Math.max(0, lastAnswerIdx - 1))
    .map((t) => `${t.role === "user" ? "User" : "IntelBot"}: ${t.content.slice(0, OLDER_TURN_MAX)}`)
    .join("\n");
  return (
    (older ? `Earlier conversation (compact):\n${older}\n\n` : "") +
    (lastQuestion ? `PREVIOUS QUESTION:\n${lastQuestion}\n\n` : "") +
    `PREVIOUS ANSWER (the content the follow-up refers to):\n${lastAnswer}\n\n`
  );
}

export async function* followupStream(
  question: string,
  history: Turn[] | undefined,
  opts: BrainOptions,
  web: boolean,
  routeReason: string
): AsyncGenerator<StreamEvent> {
  const start = Date.now();
  yield { type: "status", stage: "Quick follow-up…" };

  const system = withInstructions(`${FOLLOWUP_SYSTEM}\n\n${APP_CAPABILITIES}`, opts.instructions);
  const user =
    contextPacket(history) +
    (web
      ? "If current external facts are needed to answer, check the web and cite source URLs.\n\n"
      : "Answer from the conversation context — do not search the web.\n\n") +
    `<user_question>\n${question}\n</user_question>`;

  // Cheapest configured Perplexity model (spec: direct_followup default).
  const r = await callPerplexity(system, user, { model: MODELS.sonar, name: "Follow-up (Sonar)" });
  const status: { name: string; ok: boolean; ms: number; error?: string }[] = [
    { name: r.name, ok: r.ok, ms: r.ms, error: r.error },
  ];

  let answer = r.ok ? r.text : "";
  let citations = r.ok ? r.citations ?? [] : [];

  // Fail-soft: Sonar down → cheapest capable fallback (GPT mini).
  if (!answer.trim()) {
    const fb = await callOpenAI(system, user, {
      model: MODELS.gptMini,
      reasoningEffort: "low",
      name: "Follow-up (GPT mini)",
    });
    status.push({ name: fb.name, ok: fb.ok, ms: fb.ms, error: fb.error });
    answer = fb.ok ? fb.text : "";
    citations = [];
  }
  if (!answer.trim()) {
    answer = "I couldn't generate a follow-up answer right now — please try again.";
  }

  if (citations.length) yield { type: "links", urls: citations };
  yield { type: "delta", text: answer };
  yield {
    type: "done",
    answer,
    debug: {
      engines:
        `router: ${web ? "direct_followup_with_web_search" : "direct_followup"} (${routeReason}) → ` +
        status.map((s) => `${s.name} ${s.ok ? `✓ ${s.ms}ms` : `✗ ${s.error ?? "failed"}`}`).join(" · "),
      retrieved: 0,
      sources: citations.map((u) => `web: ${u}`),
      totalMs: Date.now() - start,
    },
  };
}

// --- Continue generation ----------------------------------------------------

export type Continuation = { tail: string; question: string; openFence?: boolean };

const TAIL_MAX = 12_000;

export async function* continueStream(
  cont: Continuation,
  opts: BrainOptions
): AsyncGenerator<StreamEvent> {
  const start = Date.now();
  yield { type: "status", stage: "Continuing from where it stopped…" };

  const system = withInstructions(CONTINUE_SYSTEM, opts.instructions);
  const tail = cont.tail.slice(-TAIL_MAX);
  // Fence-seam guard: a stray ``` at the joint swallows everything after it
  // into a code block. The client computed fence parity over the FULL draft.
  const fenceNote = cont.openFence
    ? "NOTE: the draft currently ends INSIDE an open ``` code fence — continue inside it and close it at the right place.\n\n"
    : "NOTE: the draft does NOT end inside a code fence — do NOT start your output with ``` unless you are intentionally opening a new code block.\n\n";
  const user =
    `ORIGINAL REQUEST:\n${cont.question.slice(0, 8000)}\n\n` +
    `TAIL OF THE DRAFT SO FAR (continue from its exact end — do not repeat any of it):\n…${tail}\n\n` +
    fenceNote +
    "Continue now.";

  const gen = callAnthropicStream(system, user, {
    model: MODELS.sonnet,
    effort: "medium",
    maxTokens: FINAL_MAX_TOKENS,
  });
  let acc = "";
  let result: { ok: boolean; error?: string; stopReason?: string } = { ok: true };
  while (true) {
    const step = await gen.next();
    if (step.done) {
      result = step.value;
      break;
    }
    acc += step.value;
    yield { type: "delta", text: step.value };
  }

  // Sonnet unavailable → GPT continues instead.
  if (!acc.trim()) {
    const fb = await callOpenAI(system, user, {
      model: MODELS.gptFlagship,
      reasoningEffort: "medium",
      name: "Continue (GPT)",
    });
    acc = fb.ok && fb.text ? fb.text : "⚠ Couldn't continue the answer right now — please try again.";
    yield { type: "delta", text: acc };
  }

  const debug: BrainDebug = {
    engines: `router: continue_generation → Continue (Sonnet) ${result.ok ? "✓" : `✗ ${result.error ?? ""}`}`,
    retrieved: 0,
    sources: [],
    totalMs: Date.now() - start,
  };
  yield { type: "done", answer: acc, debug, truncated: result.stopReason === "max_tokens" };
}
