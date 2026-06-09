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
  const conversationId = (body.conversationId ?? "").toString();
  const url = process.env.INTELBOT_CHAT_URL;

  if (!message) {
    return Response.json({ reply: "Please enter a question." });
  }

  // Preview mode — the n8n brain isn't wired yet.
  if (!url) {
    return Response.json({
      connected: false,
      reply:
        "⚙️ Preview mode — the IntelBot brain isn't connected yet.\n\n" +
        "This is the PWA front-end running locally. Once the cloned n8n chat endpoint is set in INTELBOT_CHAT_URL (.env.local), your questions will be answered here with the full multi-engine + Obsidian knowledge-base analysis — the same brain as the Teams bot, untouched.\n\n" +
        "You asked:\n“" +
        message +
        "”",
    });
  }

  // Live mode — call the cloned IntelBot brain (synchronous chat webhook).
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTELBOT_SHARED_SECRET
          ? { Authorization: "Bearer " + process.env.INTELBOT_SHARED_SECRET }
          : {}),
      },
      body: JSON.stringify({
        message,
        conversationId,
        timestamp: new Date().toISOString(),
      }),
    });

    const raw = await res.text();
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {}

    const reply =
      (data &&
        typeof data === "object" &&
        ((data as Record<string, unknown>).reply ||
          (data as Record<string, unknown>).answer ||
          (data as Record<string, unknown>).synthesis ||
          (data as Record<string, unknown>).response)) ||
      (typeof data === "string" ? data : JSON.stringify(data));

    return Response.json({ connected: true, reply: String(reply) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return Response.json({
      connected: false,
      reply: "Couldn't reach the IntelBot brain: " + msg,
    });
  }
}
