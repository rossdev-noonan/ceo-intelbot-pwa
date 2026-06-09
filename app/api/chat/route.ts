import { answer } from "@/lib/brain";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // deep answers can take minutes

type Body = {
  message?: string;
  conversationId?: string;
  history?: { role: string; content: string }[];
};

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {}

  const message = (body.message ?? "").toString().trim();
  const isDev = process.env.NODE_ENV !== "production";

  if (!message) {
    return Response.json({ reply: "Please enter a question." });
  }

  // Preview mode — no model keys yet, so the brain can't run.
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({
      connected: false,
      reply:
        "⚙️ Preview mode — no model key configured.\n\n" +
        "Add ANTHROPIC_API_KEY (and optionally OPENAI_API_KEY, PERPLEXITY_API_KEY) " +
        "to .env.local to enable grounded answers from your Obsidian knowledge base.\n\n" +
        "You asked:\n“" +
        message +
        "”",
    });
  }

  try {
    const result = await answer(message, body.history);

    // Dev-only debug line: which engines answered, timings, and what was retrieved.
    const debug = isDev
      ? {
          engines: result.models
            .map((m) => `${m.name} ${m.ok ? `✓ ${m.ms}ms` : `✗ ${m.error ?? "failed"}`}`)
            .join(" · "),
          retrieved: result.retrievedCount,
          sources: result.sources.map((s) => `[${s.n}] ${s.file}`),
          totalMs: result.ms,
        }
      : undefined;

    return Response.json({ connected: true, reply: result.answer, sources: result.sources, debug });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return Response.json({
      connected: false,
      reply: "The IntelBot brain hit an error: " + msg,
      ...(isDev ? { debug: { error: msg } } : {}),
    });
  }
}
