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

// Generous default output ceiling so answers are never truncated. Override with
// MAX_OUTPUT_TOKENS. This is a ceiling, not a target — actual length is
// model-driven. Perplexity is capped lower (it feeds the synthesiser).
export const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS) || 16000;
const PERPLEXITY_MAX_TOKENS = Math.min(MAX_OUTPUT_TOKENS, 8000);

function ms(start: number): number {
  return Date.now() - start;
}

// Parse a "data:image/png;base64,XXXX" URL into the parts the model APIs need.
export type ImagePart = { mediaType: string; data: string };
export function parseDataUrl(url: string): ImagePart | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

// Mark the system prompt as cacheable (ephemeral, ~5-min TTL). cache_control is
// GA — no beta header needed. It only caches when the rendered prefix clears the
// model's minimum (4096 tokens for Opus/Haiku, 2048 for Sonnet); below that it
// silently no-ops, so this is safe to send on every call. Pays off on the
// Sonnet-tier synthesiser and any large-context follow-ups within the window.
function cachedSystem(system: string) {
  return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
}

// Build an Anthropic user-content array with optional image blocks.
function anthropicContent(text: string, images?: ImagePart[]) {
  if (!images?.length) return text;
  return [
    { type: "text", text },
    ...images.map((im) => ({
      type: "image",
      source: { type: "base64", media_type: im.mediaType, data: im.data },
    })),
  ];
}

// Claude Opus 4.8 uses adaptive thinking controlled by output_config.effort
// (low|medium|high|xhigh|max). High-effort runs need extra max_tokens headroom
// because thinking tokens count toward the limit.
function anthropicThinking(effort?: string): { body: object; maxBump: number } {
  if (!effort) return { body: {}, maxBump: 0 };
  const big = effort === "high" || effort === "xhigh" || effort === "max";
  return {
    body: { thinking: { type: "adaptive" }, output_config: { effort } },
    maxBump: big ? 16000 : 0,
  };
}

export async function callAnthropic(
  system: string,
  user: string,
  opts: { model?: string; maxTokens?: number; name?: string; effort?: string } = {}
): Promise<ModelResult> {
  const model = opts.model || process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  const name = opts.name || "Claude Opus";
  const key = process.env.ANTHROPIC_API_KEY;
  const start = Date.now();
  if (!key) return { name, model, ok: false, text: "", error: "ANTHROPIC_API_KEY not set", ms: 0 };
  const think = anthropicThinking(opts.effort);
  const maxTokens = (opts.maxTokens ?? MAX_OUTPUT_TOKENS) + think.maxBump;
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
        max_tokens: maxTokens,
        system: cachedSystem(system),
        ...think.body,
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

// Streaming variant of the Anthropic call, used for the synthesiser so the
// final answer types out live. Yields text deltas; the generator's return value
// reports overall success/failure (capture it via manual .next() iteration).
export async function* callAnthropicStream(
  system: string,
  user: string,
  opts: { model?: string; maxTokens?: number; effort?: string; images?: ImagePart[] } = {}
): AsyncGenerator<string, { ok: boolean; error?: string }, unknown> {
  const model = opts.model || process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY not set" };
  const think = anthropicThinking(opts.effort);
  const maxTokens = (opts.maxTokens ?? MAX_OUTPUT_TOKENS) + think.maxBump;

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: cachedSystem(system),
        stream: true,
        ...think.body,
        messages: [{ role: "user", content: anthropicContent(user, opts.images) }],
      }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }

  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      const d = await res.json();
      msg = d?.error?.message || msg;
    } catch {}
    return { ok: false, error: msg };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            yield evt.delta.text as string;
          } else if (evt.type === "error") {
            return { ok: false, error: evt.error?.message || "stream error" };
          }
        } catch {}
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "stream read failed" };
  }
  return { ok: true };
}

export async function callOpenAI(
  system: string,
  user: string,
  opts: { model?: string; maxTokens?: number; name?: string; reasoningEffort?: string } = {}
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
        reasoning_effort: opts.reasoningEffort || process.env.OPENAI_REASONING_EFFORT || "high",
        max_completion_tokens: opts.maxTokens ?? MAX_OUTPUT_TOKENS,
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

// Streaming variant of the OpenAI call — used by FLOWs stages that stream the
// final deliverable from GPT (e.g. the Hybrid final-decision stage). Yields
// text deltas; the generator's return value reports overall success/failure.
export async function* callOpenAIStream(
  system: string,
  user: string,
  opts: { model?: string; maxTokens?: number; reasoningEffort?: string } = {}
): AsyncGenerator<string, { ok: boolean; error?: string }, unknown> {
  const model = opts.model || process.env.OPENAI_MODEL || "gpt-5.5";
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "OPENAI_API_KEY not set" };

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        stream: true,
        reasoning_effort: opts.reasoningEffort || "medium",
        max_completion_tokens: opts.maxTokens ?? MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }

  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      const d = await res.json();
      msg = d?.error?.message || msg;
    } catch {}
    return { ok: false, error: msg };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload);
          // OpenAI emits {"error": {...}} mid-stream on failures — surface it
          // so callers fire their fallback with the real provider error.
          if (evt?.error) return { ok: false, error: evt.error?.message || "stream error" };
          const delta = evt?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        } catch {}
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "stream read failed" };
  }
  return { ok: true };
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
        max_tokens: opts.maxTokens ?? PERPLEXITY_MAX_TOKENS,
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