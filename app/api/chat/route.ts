import { answerStream, type StreamEvent, type Connectors } from "@/lib/brain";
import { agentStream } from "@/lib/agent";
import { checkSensitivity, sensitivityRefusal } from "@/lib/sensitivity";
import { requireUser } from "@/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // long, complete answers can take several minutes

type Body = {
  message?: string;
  conversationId?: string;
  history?: { role: string; content: string }[];
  mode?: "team" | "agent";
  instructions?: string;
  connectors?: Connectors;
  depth?: "auto" | "instant" | "thinking" | "pro";
  attachment?: { name: string; text: string };
  images?: string[];
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

  // Preview mode — no model key configured.
  if (!process.env.ANTHROPIC_API_KEY) {
    return streamReply(
      "⚙️ Preview mode — no model key configured.\n\n" +
        "Add ANTHROPIC_API_KEY (and optionally OPENAI_API_KEY, PERPLEXITY_API_KEY) " +
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
    attachment: body.attachment,
    images: body.images,
  };
  // Images need vision — always use the Team/vision path (agent tools can't see images).
  const events =
    body.mode === "agent" && !body.images?.length
      ? agentStream(message, body.history, opts)
      : answerStream(message, body.history, opts);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        for await (const evt of events) {
          // Strip the debug payload in production.
          if (evt.type === "done" && !isDev) send({ type: "done", answer: evt.answer });
          else send(evt);
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
