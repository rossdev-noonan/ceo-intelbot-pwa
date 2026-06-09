import fs from "node:fs";
import path from "node:path";

// The Obsidian knowledge base the PWA is grounded in. Override with VAULT_PATH
// in .env.local if the vault ever moves.
export const VAULT_PATH =
  process.env.VAULT_PATH ||
  "C:\\Users\\Rossrival-Noonan\\Documents\\ross-vault-01";

// Folders we never index — Obsidian internals, version control, trash.
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);

const MAX_CHUNK_CHARS = 1400; // ~350 tokens; splits big sections into windows
const STOPWORDS = new Set(
  ("the a an and or but of to in on at for with by from as is are was were be " +
    "been being this that these those it its their our your my we you i they he " +
    "she them his her can could should would will shall may might do does did " +
    "not no yes if then than so such what which who whom how when where why what " +
    "about into over under out up down off again further once here there all any " +
    "each few more most other some only own same too very just also").split(" ")
);

export type Hit = {
  file: string; // path relative to the vault root
  title: string; // note title (filename without extension)
  heading: string; // nearest markdown heading for the chunk
  text: string; // the chunk body
  score: number;
};

type IndexedChunk = {
  file: string;
  title: string;
  heading: string;
  text: string;
  tf: Map<string, number>; // term -> frequency within this chunk
  len: number; // number of tokens in the chunk
};

type VaultIndex = {
  signature: string; // file count + newest mtime; rebuild when it changes
  builtAt: number;
  fileCount: number;
  chunks: IndexedChunk[];
  df: Map<string, number>; // term -> number of chunks containing it
  avgLen: number;
};

let cached: VaultIndex | null = null;

// --- helpers -------------------------------------------------------------

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[`*_>#~|\[\]()]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function stripFrontmatter(raw: string): string {
  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end !== -1) return raw.slice(end + 4);
  }
  return raw;
}

function walkMarkdown(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkMarkdown(path.join(dir, e.name), out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

// Split one note into chunks keyed by heading, windowing oversized sections.
function chunkNote(relPath: string, body: string): Omit<IndexedChunk, "tf" | "len">[] {
  const title = path.basename(relPath).replace(/\.md$/i, "");
  const lines = body.split(/\r?\n/);
  const sections: { heading: string; text: string }[] = [];
  let heading = title;
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) sections.push({ heading, text });
    buf = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heading = m[2].trim() || title;
    } else {
      buf.push(line);
    }
  }
  flush();

  const chunks: Omit<IndexedChunk, "tf" | "len">[] = [];
  for (const sec of sections) {
    if (sec.text.length <= MAX_CHUNK_CHARS) {
      chunks.push({ file: relPath, title, heading: sec.heading, text: sec.text });
      continue;
    }
    // Window large sections on paragraph boundaries.
    let window = "";
    for (const para of sec.text.split(/\n\s*\n/)) {
      if (window && (window + "\n\n" + para).length > MAX_CHUNK_CHARS) {
        chunks.push({ file: relPath, title, heading: sec.heading, text: window.trim() });
        window = para;
      } else {
        window = window ? window + "\n\n" + para : para;
      }
    }
    if (window.trim()) {
      chunks.push({ file: relPath, title, heading: sec.heading, text: window.trim() });
    }
  }
  return chunks;
}

// --- index build ---------------------------------------------------------

function computeSignature(files: string[]): string {
  let newest = 0;
  for (const f of files) {
    try {
      const m = fs.statSync(f).mtimeMs;
      if (m > newest) newest = m;
    } catch {}
  }
  return `${files.length}:${Math.round(newest)}`;
}

function buildIndex(): VaultIndex {
  const files = walkMarkdown(VAULT_PATH);
  const signature = computeSignature(files);

  const chunks: IndexedChunk[] = [];
  const df = new Map<string, number>();
  let totalLen = 0;

  for (const abs of files) {
    let raw = "";
    try {
      raw = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(VAULT_PATH, abs).replace(/\\/g, "/");
    const body = stripFrontmatter(raw);

    for (const c of chunkNote(rel, body)) {
      // Index the heading + title alongside the body so a query that matches a
      // note's name surfaces even when the term is sparse in the prose.
      const tokens = tokenize(`${c.title} ${c.heading} ${c.text}`);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
      totalLen += tokens.length;
      chunks.push({ ...c, tf, len: tokens.length });
    }
  }

  return {
    signature,
    builtAt: Date.now(),
    fileCount: files.length,
    chunks,
    df,
    avgLen: chunks.length ? totalLen / chunks.length : 0,
  };
}

function getIndex(): VaultIndex {
  const files = walkMarkdown(VAULT_PATH);
  const signature = computeSignature(files);
  if (!cached || cached.signature !== signature) {
    cached = buildIndex();
  }
  return cached;
}

// --- public API ----------------------------------------------------------

export function getVaultStats() {
  const idx = getIndex();
  return {
    vaultPath: VAULT_PATH,
    exists: fs.existsSync(VAULT_PATH),
    fileCount: idx.fileCount,
    chunkCount: idx.chunks.length,
    vocabulary: idx.df.size,
    builtAt: new Date(idx.builtAt).toISOString(),
  };
}

// Authoritative source notes should outrank the bot's own past exports and
// rough drafts. Folder-based multipliers applied on top of the BM25 score.
function folderWeight(file: string): number {
  if (file.startsWith("Conversations/")) return 0.4; // prior Q&A — avoid echo chamber
  if (file.startsWith("Inbox/")) return 0.7; // drafts / unfiled
  return 1;
}

// BM25 ranking over the chunk index.
export function searchVault(query: string, k = 8): Hit[] {
  const idx = getIndex();
  const qTerms = tokenize(query);
  if (!qTerms.length || !idx.chunks.length) return [];

  const k1 = 1.5;
  const b = 0.75;
  const N = idx.chunks.length;

  const scored = idx.chunks.map((c) => {
    let score = 0;
    for (const term of qTerms) {
      const f = c.tf.get(term);
      if (!f) continue;
      const n = idx.df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = f + k1 * (1 - b + (b * c.len) / (idx.avgLen || 1));
      score += idf * ((f * (k1 + 1)) / denom);
    }
    return { c, score: score * folderWeight(c.file) };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ c, score }) => ({
      file: c.file,
      title: c.title,
      heading: c.heading,
      text: c.text,
      score: Math.round(score * 1000) / 1000,
    }));
}

// Build a grounded-context block + a numbered citation list for the LLM.
export function buildContext(hits: Hit[]): { context: string; citations: string[] } {
  const citations = hits.map((h, i) => `[${i + 1}] ${h.file}${h.heading && h.heading !== h.title ? ` › ${h.heading}` : ""}`);
  const context = hits
    .map((h, i) => `[${i + 1}] ${h.title}${h.heading && h.heading !== h.title ? ` — ${h.heading}` : ""}\n${h.text}`)
    .join("\n\n---\n\n");
  return { context, citations };
}
