import { ensureIndex, searchVault, getVaultStats, listFiles } from "@/lib/vault";
import { callPerplexity } from "@/lib/models";
import { RESEARCH_SYSTEM } from "@/lib/prompts";

// Tool schemas advertised to the Anthropic tool-use loop (Agent mode).
export const TOOLS = [
  {
    name: "search_vault",
    description:
      "Search Noonan's internal Obsidian knowledge base (operational notes + NSW legislation PDFs). This is the PRIMARY source. Run several targeted searches for different facets of the question.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms / a focused sub-question." },
        k: { type: "integer", description: "How many results to return (default 6, max 10)." },
      },
      required: ["query"],
    },
  },
  {
    name: "vault_overview",
    description:
      "Get knowledge-base statistics (file/PDF counts) and the list of note/legislation file names. Use for meta questions such as how many files exist or what topics are covered.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "web_search",
    description:
      "Search the live web for current or external information (recent NSW law changes, market data) via Perplexity. Returns an answer with source URLs. Use only when the vault is insufficient.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch a specific public web page and return its main text. Use to read a source URL found via web_search.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
];

// Filter the tool list by enabled connectors. Vault tools are always on; the
// web search and fetch connectors can be turned off in the Connectors panel.
export function toolsFor(connectors?: { web?: boolean; fetch?: boolean }) {
  return TOOLS.filter((t) => {
    if (t.name === "web_search") return connectors?.web ?? true;
    if (t.name === "fetch_url") return connectors?.fetch ?? true;
    return true;
  });
}

type ToolInput = Record<string, unknown>;

// Short human-readable label for a tool call, shown as a status line in the UI.
export function toolLabel(name: string, input: ToolInput): string {
  switch (name) {
    case "search_vault":
      return `🔎 Searching the knowledge base: “${String(input.query ?? "")}”`;
    case "vault_overview":
      return "📚 Reviewing the knowledge-base index…";
    case "web_search":
      return `🌐 Searching the web: “${String(input.query ?? "")}”`;
    case "fetch_url":
      try {
        return `📄 Reading ${new URL(String(input.url ?? "")).hostname}…`;
      } catch {
        return "📄 Reading a web page…";
      }
    default:
      return `Running ${name}…`;
  }
}

// Block obvious internal/loopback targets for fetch_url (basic SSRF guard).
function isUnsafeHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.startsWith("127.") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    h.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

async function fetchUrlText(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "Invalid URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http(s) URLs are allowed.";
  if (isUnsafeHost(url.hostname)) return "Refused: internal/loopback address.";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      headers: { "user-agent": "IntelBot/1.0 (+research)" },
    });
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("text") && !ctype.includes("html") && !ctype.includes("json")) {
      return `Unsupported content type: ${ctype || "unknown"}.`;
    }
    const raw = await res.text();
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 6000) || "(no readable text)";
  } catch (e) {
    return `Fetch failed: ${e instanceof Error ? e.message : "unknown error"}`;
  } finally {
    clearTimeout(timer);
  }
}

// Execute a tool call and return a plain-text result for the model.
export async function runTool(name: string, input: ToolInput): Promise<string> {
  if (name === "search_vault") {
    await ensureIndex();
    const k = Math.min(Math.max(Number(input.k) || 6, 1), 10);
    const hits = searchVault(String(input.query ?? ""), k);
    if (!hits.length) return "No matching notes found.";
    return hits
      .map(
        (h) =>
          `[${h.file}${h.heading && h.heading !== h.title ? ` › ${h.heading}` : ""}]\n${h.text}`
      )
      .join("\n\n---\n\n");
  }

  if (name === "vault_overview") {
    const s = await getVaultStats();
    const files = listFiles();
    return (
      `Knowledge base: ${s.fileCount} files (${s.mdCount} markdown notes, ${s.pdfCount} legislation PDFs), ${s.chunkCount} indexed sections.\n\n` +
      `Files:\n${files.join("\n")}`
    );
  }

  if (name === "web_search") {
    const r = await callPerplexity(
      RESEARCH_SYSTEM,
      `<user_question>\n${String(input.query ?? "")}\n</user_question>`
    );
    if (!r.ok) return `web_search failed: ${r.error ?? "unknown error"}`;
    return r.text + (r.citations?.length ? `\n\nSources:\n${r.citations.join("\n")}` : "");
  }

  if (name === "fetch_url") {
    return fetchUrlText(String(input.url ?? ""));
  }

  return `Unknown tool: ${name}`;
}
