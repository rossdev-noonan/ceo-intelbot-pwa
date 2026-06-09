import { answerStream, type StreamEvent, type Connectors } from "@/lib/brain";
import { agentStream } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // deep answers can take minutes

type Body = {
  message?: string;
  conversationId?: string;
  history?: { role: string; content: string }[];
  mode?: "team" | "agent";
  instructions?: string;
  connectors?: Connectors;
};

// Streams NDJSON events: {type:"status"|"sources"|"delta"|"done"|"error", ...}
export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {}

  const message = (body.message ?? "").toString().trim();
  const isDev = process.env.NODE_ENV !== "production";
  const encoder = new TextEncoder();

  const single = (evt: StreamEvent) =>
    new Response(encoder.encode(JSON.stringify(evt) + "\n"), {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
    });

  if (!message) {
    return single({ type: "error", error: "Please enter a question." });
  }

  // Preview mode — no model key configured.
  if (!process.env.ANTHROPIC_API_KEY) {
    const reply =
      "⚙️ Preview mode — no model key configured.\n\n" +
      "Add ANTHROPIC_API_KEY (and optionally OPENAI_API_KEY, PERPLEXITY_API_KEY) " +
      "to .env.local to enable grounded answers from your Obsidian knowledge base.\n\n" +
      `You asked:\n“${message}”`;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ type: "delta", text: reply }) + "\n"));
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: "done", answer: reply, debug: { engines: "preview", retrieved: 0, sources: [], totalMs: 0 } }) + "\n"
          )
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const opts = { instructions: body.instructions, connectors: body.connectors };
  const events =
    body.mode === "agent"
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
