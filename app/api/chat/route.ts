import { answerStream, type StreamEvent, type Connectors } from "@/lib/brain";
import { relayStream } from "@/lib/relay";
import { hybridStream } from "@/lib/hybrid";
import { followupStream, continueStream } from "@/lib/followup";
import { routeMessage } from "@/lib/router";
import { checkSensitivity, sensitivityRefusal } from "@/lib/sensitivity";
import { requireUser } from "@/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // long, complete answers can take several minutes

type Body = {
  message?: string;
  conversationId?: string;
  history?: { role: string; content: string }[];
  mode?: "team" | "agent" | "hybrid";
  instructions?: string;
  connectors?: Connectors;
  depth?: "auto" | "instant" | "thinking" | "pro";
  attachments?: { name: string; text: string }[];
  images?: string[];
  // Developer debug mode — attach the engines/timings trace to done events.
  debug?: boolean;
  // Continue a paused (output-limit) answer from its exact stopping point.
  continuation?: { tail: string; question: string; openFence?: boolean };
};

// Streams NDJSON events: {type:"status"|"sources"|"delta"|"done"|"error", ...}
export async function POST(req: Request) {
  // Hard authorization gate — no anonymous access to the brain.
  const gate = await requireUser();
  if (!gate.ok) return new Response("Unauthorized", { status: 401 });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {}

  const message = (body.message ?? "").toString().trim();
  const isDev = process.env.NODE_ENV !== "production";
  const encoder = new TextEncoder();

  const ndjsonHeaders = {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
  };

  const single = (evt: StreamEvent) =>
    new Response(encoder.encode(JSON.stringify(evt) + "\n"), { headers: ndjsonHeaders });

  // Stream a fixed reply as a delta + done (used for preview and the gate).
  const streamReply = (reply: string, engines: string) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: "delta", text: reply }) + "\n"));
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ type: "done", answer: reply, debug: { engines, retrieved: 0, sources: [], totalMs: 0 } }) + "\n"
            )
          );
          controller.close();
        },
      }),
      { headers: ndjsonHeaders }
    );

  if (!message) {
    return single({ type: "error", error: "Please enter a question." });
  }

  // Preview mode — only when NO provider key is configured at all. The
  // pipelines fail soft per-provider, so any single key is enough to answer
  // (e.g. Agents/Hybrid run OpenAI-led even with no Anthropic key).
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.PERPLEXITY_API_KEY) {
    return streamReply(
      "⚙️ Preview mode — no model key configured.\n\n" +
        "Add ANTHROPIC_API_KEY, OPENAI_API_KEY and/or PERPLEXITY_API_KEY " +
        "to .env.local to enable grounded answers from your Obsidian knowledge base.\n\n" +
        `You asked:\n“${message}”`,
      "preview"
    );
  }

  // Data-boundary gate (spec C1) — refuse PII / financial identifiers / MNPI
  // BEFORE any model is called.
  const sens = checkSensitivity(message);
  if (sens.blocked) {
    return streamReply(sensitivityRefusal(sens.categories), `blocked: sensitivity gate (${sens.categories.join(", ")})`);
  }

  const opts = {
    instructions: body.instructions,
    connectors: body.connectors,
    depth: body.depth,
    attachments: body.attachments,
    images: body.images,
  };
  // Conversation Mode Router (runs BEFORE any orchestration): paused-answer
  // continuations and recognisable follow-ups bypass the heavy pipelines.
  // Everything else takes the FLOWs v0.2 mode routing:
  //   team   → swarm fan-out + synthesis (lib/brain.ts)
  //   agent  → relay pipeline (research → synthesis → final QA)
  //   hybrid → research-first parallel candidates → comparison → decision
  // Images always take the Team/vision path — only that path can see them.
  const route = body.continuation?.tail
    ? { path: "continue" as const, reason: "continuation of a paused answer" }
    : routeMessage(message, body.history, {
        hasAttachments: !!body.attachments?.length,
        hasImages: !!body.images?.length,
      });

  const events =
    route.path === "continue" && body.continuation
      ? continueStream(body.continuation, opts)
      : route.path === "followup" || route.path === "followup_web"
      ? followupStream(message, body.history, opts, route.path === "followup_web", route.reason)
      : body.images?.length
      ? answerStream(message, body.history, opts)
      : body.mode === "agent"
      ? relayStream(message, body.history, opts)
      : body.mode === "hybrid"
      ? hybridStream(message, body.history, opts)
      : answerStream(message, body.history, opts);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const wantDebug = isDev || !!body.debug;
        for await (const evt of events) {
          // The debug trace travels only when debug mode asks for it; the
          // truncated flag is user-facing state and must always survive.
          if (evt.type === "done" && !wantDebug) {
            send({ type: "done", answer: evt.answer, truncated: evt.truncated });
          } else send(evt);
        }
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
