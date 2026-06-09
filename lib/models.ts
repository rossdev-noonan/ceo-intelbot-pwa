// Thin, dependency-free callers for the three frontier models. Each returns a
// uniform ModelResult and never throws — failures come back as { ok: false }
// so the fan-out can continue with whatever succeeded (continue_on_fail).

export type ModelResult = {
  name: string; // display name, e.g. "GPT-5.5"
  model: string; // resolved model id
  ok: boolean;
  text: string;
  citations?: string[]; // source URLs (Perplexity)
  error?: string;
  ms: number;
};

const ANTHROPIC_VERSION = "2023-06-01";

function ms(start: number): number {
  return Date.now() - start;
}

export async function callAnthropic(
  system: string,
  user: string,
  opts: { model?: string; maxTokens?: number; name?: string } = {}
): Promise<ModelResult> {
  const model = opts.model || process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  const name = opts.name || "Claude Opus";
  const key = process.env.ANTHROPIC_API_KEY;
  const start = Date.now();
  if (!key) return { name, model, ok: false, text: "", error: "ANTHROPIC_API_KEY not set", ms: 0 };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 4096,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      return { name, model, ok: false, text: "", error: msg, ms: ms(start) };
    }
    const text = (data?.content ?? [])
      .filter((b: { type?: string }) => b.type === "text")
      .map((b: { text?: string }) => b.text ?? "")
      .join("\n")
      .trim();
    return { name, model, ok: !!text, text, error: text ? undefined : "empty response", ms: ms(start) };
  } catch (e) {
    return { name, model, ok: false, text: "", error: e instanceof Error ? e.message : "unknown error", ms: ms(start) };
  }
}

export async function callOpenAI(
  system: string,
  user: string,
  opts: { model?: string; maxTokens?: number; name?: string } = {}
): Promise<ModelResult> {
  const model = opts.model || process.env.OPENAI_MODEL || "gpt-5.5";
  const name = opts.name || "GPT-5.5";
  const key = process.env.OPENAI_API_KEY;
  const start = Date.now();
  if (!key) return { name, model, ok: false, text: "", error: "OPENAI_API_KEY not set", ms: 0 };
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        reasoning_effort: process.env.OPENAI_REASONING_EFFORT || "high",
        max_completion_tokens: opts.maxTokens ?? 4096,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      return { name, model, ok: false, text: "", error: msg, ms: ms(start) };
    }
    const text = (data?.choices?.[0]?.message?.content ?? "").toString().trim();
    return { name, model, ok: !!text, text, error: text ? undefined : "empty response", ms: ms(start) };
  } catch (e) {
    return { name, model, ok: false, text: "", error: e instanceof Error ? e.message : "unknown error", ms: ms(start) };
  }
}

export async function callPerplexity(
  system: string,
  user: string,
  opts: { model?: string; maxTokens?: number; name?: string } = {}
): Promise<ModelResult> {
  const model = opts.model || process.env.PERPLEXITY_MODEL || "sonar-reasoning-pro";
  const name = opts.name || "Perplexity Sonar";
  const key = process.env.PERPLEXITY_API_KEY;
  const start = Date.now();
  if (!key) return { name, model, ok: false, text: "", error: "PERPLEXITY_API_KEY not set", ms: 0 };
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 4096,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || `HTTP ${res.status}`;
      return { name, model, ok: false, text: "", error: String(msg), ms: ms(start) };
    }
    let text = (data?.choices?.[0]?.message?.content ?? "").toString().trim();
    // Perplexity wraps chain-of-thought in <think>...</think> — strip it.
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const citations: string[] =
      data?.citations ??
      (Array.isArray(data?.search_results)
        ? data.search_results.map((r: { url?: string }) => r.url).filter(Boolean)
        : []);
    return { name, model, ok: !!text, text, citations, error: text ? undefined : "empty response", ms: ms(start) };
  } catch (e) {
    return { name, model, ok: false, text: "", error: e instanceof Error ? e.message : "unknown error", ms: ms(start) };
  }
}
