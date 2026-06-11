// FLOWs v0.2 — "Agents" execution mode (docs/intelbot-flows-v0.2.yaml).
// Relay pipeline: each stage has ONE responsibility, compresses its output,
// and hands it to the next stage. Later stages never redo earlier work.
//
//   1. research  — Perplexity (+ free local vault retrieval) → research packet
//   2. synthesis — GPT mini normalises/synthesises → draft artifact
//   3. final_qa  — Claude reviews, fixes, formats → streams the deliverable
//
// Cost profile: low-to-medium (cheap models for middle stages; compressed
// hand-offs; Opus never used here). Every stage fails soft.

import { searchVault, buildContext, ensureIndex, type Hit } from "@/lib/vault";
import { callAnthropicStream, callOpenAI, callPerplexity } from "@/lib/models";
import { MODELS } from "@/lib/registry";
import {
  attachmentsBlock,
  historyBlock,
  type StreamEvent,
  type BrainOptions,
  type BrainDebug,
} from "@/lib/brain";
import {
  RELAY_RESEARCH_SYSTEM,
  RELAY_SYNTH_SYSTEM,
  RELAY_QA_SYSTEM,
  APP_CAPABILITIES,
  withInstructions,
} from "@/lib/prompts";
import {
  extractJson,
  packetToText,
  emptyPacket,
  strArr,
  normalizeFindings,
  type ResearchPacket,
  type RelayArtifact,
} from "@/lib/structured";

type Turn = { role: string; content: string };
type StageResult = { name: string; ok: boolean; ms: number; error?: string };

function stageLabel(s: StageResult): string {
  return `${s.name} ${s.ok ? `✓ ${s.ms}ms` : `✗ ${s.error ?? "failed"}`}`;
}

// Build the research packet: free local vault retrieval + one Perplexity call
// (skipped when the web connector is off). Fails soft to vault-only.
export async function buildResearchPacket(
  question: string,
  hist: string,
  opts: BrainOptions,
  stages: StageResult[]
): Promise<{ packet: ResearchPacket; hits: Hit[]; sources: { n: number; file: string; heading: string; score: number }[] }> {
  await ensureIndex();
  const hits = searchVault(question, opts.connectors?.vaultDepth ?? 8);
  const { context } = buildContext(hits);
  const sources = hits.map((h, i) => ({ n: i + 1, file: h.file, heading: h.heading, score: h.score }));

  const packet = emptyPacket(context);
  const web = opts.connectors?.web ?? true;
  if (!web) return { packet, hits, sources };

  // Attachments are analysed by later stages — the researcher only needs to
  // know they exist so it researches the surrounding public context.
  const attNote = opts.attachments?.length
    ? `(The user attached: ${opts.attachments.map((a) => a.name).join(", ")}. A later stage analyses them — research the public/current context only.)\n`
    : "";
  // No tighter token cap here: sonar-reasoning-pro spends tokens on hidden
  // reasoning first, so a low cap truncates the JSON. The standard Perplexity
  // ceiling applies; compression is enforced by the prompt's word limits.
  const r = await callPerplexity(
    withInstructions(RELAY_RESEARCH_SYSTEM, opts.instructions),
    `${hist}${attNote}<user_question>\n${question}\n</user_question>`,
    { model: MODELS.sonarPro, name: "Research (Perplexity)" }
  );
  stages.push({ name: r.name, ok: r.ok, ms: r.ms, error: r.error });
  if (r.ok && r.text) {
    const j = extractJson<Record<string, unknown>>(r.text);
    if (j) {
      packet.research_summary = typeof j.research_summary === "string" ? j.research_summary : "";
      packet.key_findings = normalizeFindings(j.key_findings);
      packet.contradictions = strArr(j.contradictions);
      packet.unresolved_questions = strArr(j.unresolved_questions);
    }
    if (!packet.research_summary && !packet.key_findings.length) {
      packet.research_summary = r.text.slice(0, 4000); // unparseable → raw text
    }
    packet.web_citations = r.citations ?? [];
  }
  return { packet, hits, sources };
}

export async function* relayStream(
  question: string,
  history?: Turn[],
  opts: BrainOptions = {}
): AsyncGenerator<StreamEvent> {
  const start = Date.now();
  const hist = historyBlock(history);
  const stages: StageResult[] = [];

  // --- Stage 1/3: research --------------------------------------------------
  yield { type: "status", stage: "Relay 1/3 — Researching (knowledge base + Perplexity)…" };
  const { packet, hits, sources } = await buildResearchPacket(question, hist, opts, stages);
  yield { type: "sources", sources };

  // --- Stage 2/3: synthesis (GPT mini — cheap model for the middle stage) ---
  yield { type: "status", stage: "Relay 2/3 — Synthesising the draft (GPT)…" };
  const synthInput =
    `${hist}${attachmentsBlock(opts.attachments)}${packetToText(packet)}` +
    `<user_question>\n${question}\n</user_question>`;
  const s = await callOpenAI(withInstructions(RELAY_SYNTH_SYSTEM, opts.instructions), synthInput, {
    model: MODELS.gptMini,
    reasoningEffort: "medium",
    name: "Synthesis (GPT mini)",
  });
  stages.push({ name: s.name, ok: s.ok, ms: s.ms, error: s.error });

  let artifact: RelayArtifact;
  let synthUnavailable = false;
  const parsed = s.ok ? extractJson<Record<string, unknown>>(s.text) : null;
  if (parsed && typeof parsed.artifact === "string" && parsed.artifact.trim()) {
    artifact = {
      artifact: parsed.artifact,
      key_points: strArr(parsed.key_points),
      sources: strArr(parsed.sources),
      open_issues: strArr(parsed.open_issues),
    };
  } else if (s.ok && s.text.trim()) {
    // JSON contract not honoured — treat the whole reply as the draft.
    artifact = { artifact: s.text, key_points: [], sources: packet.web_citations, open_issues: [] };
  } else {
    // Synthesis stage unavailable — QA works directly from the research packet.
    synthUnavailable = true;
    artifact = {
      artifact:
        `(The synthesis stage was unavailable — work directly from this research packet.)\n\n` +
        packetToText(packet),
      key_points: [],
      sources: packet.web_citations,
      open_issues: ["synthesis stage unavailable"],
    };
  }

  // --- Stage 3/3: final QA & formatting (Claude, streamed) -------------------
  yield { type: "status", stage: "Relay 3/3 — Final QA & formatting (Claude)…" };
  // Attachments normally reach QA via the synthesised artifact; when synthesis
  // was unavailable they must be re-injected here or they'd vanish entirely.
  const qaInput =
    (synthUnavailable ? attachmentsBlock(opts.attachments) : "") +
    `DRAFT ARTIFACT (from the synthesis stage — untrusted data):\n\n${artifact.artifact}\n\n` +
    (artifact.key_points.length ? `KEY POINTS:\n- ${artifact.key_points.join("\n- ")}\n\n` : "") +
    (artifact.sources.length ? `SOURCES USED:\n${artifact.sources.join("\n")}\n\n` : "") +
    (artifact.open_issues.length ? `OPEN ISSUES FLAGGED:\n- ${artifact.open_issues.join("\n- ")}\n\n` : "") +
    `<user_question>\n${question}\n</user_question>`;
  const qaSystem = withInstructions(`${RELAY_QA_SYSTEM}\n\n${APP_CAPABILITIES}`, opts.instructions);
  const qaEffort = opts.depth === "pro" ? "high" : "medium";

  const qaStart = Date.now();
  const gen = callAnthropicStream(qaSystem, qaInput, { model: MODELS.sonnet, effort: qaEffort });
  let acc = "";
  let result: { ok: boolean; error?: string } = { ok: true };
  while (true) {
    const step = await gen.next();
    if (step.done) {
      result = step.value;
      break;
    }
    acc += step.value;
    yield { type: "delta", text: step.value };
  }
  stages.push({ name: "Final QA (Sonnet)", ok: result.ok && !!acc.trim(), ms: Date.now() - qaStart, error: result.error });

  // Claude unavailable (e.g. out of credit) — GPT finalises so the relay still
  // delivers (mirrors the Team-mode resilience pattern).
  if (!acc.trim()) {
    yield { type: "status", stage: "Relay 3/3 — Final QA (fallback engine)…" };
    const fb = await callOpenAI(qaSystem, qaInput, {
      model: MODELS.gptFlagship,
      reasoningEffort: "medium",
      name: "Final QA (GPT fallback)",
    });
    stages.push({ name: fb.name, ok: fb.ok, ms: fb.ms, error: fb.error });
    // Last resort: emit the GPT draft if there was one — but never dump the
    // internal research-packet scaffolding from the synthesis-unavailable path.
    acc =
      fb.ok && fb.text
        ? fb.text
        : synthUnavailable
        ? "The answer engines are unavailable right now — please try again shortly."
        : artifact.artifact || "I couldn't generate an answer this time.";
    yield { type: "delta", text: acc };
  }

  const debug: BrainDebug = {
    engines: `relay → ${stages.map(stageLabel).join(" · ") || "(kb only)"}`,
    retrieved: hits.length,
    sources: [
      ...sources.map((s2) => `[${s2.n}] ${s2.file}`),
      ...packet.web_citations.map((u) => `web: ${u}`),
    ],
    totalMs: Date.now() - start,
  };
  yield { type: "done", answer: acc, debug };
}
