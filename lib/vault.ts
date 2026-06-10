import fs from "node:fs";
import path from "node:path";

// The Obsidian knowledge base the PWA is grounded in. Override with VAULT_PATH
// in .env.local if the vault ever moves.
export const VAULT_PATH =
  process.env.VAULT_PATH ||
  "C:\\Users\\Rossrival-Noonan\\Documents\\ross-vault-01";

// Folders we never index — Obsidian internals, version control, trash.
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);

// Text-based file types we index directly (read as UTF-8). PDFs are handled
// separately. Anything else (images, office binaries) is skipped.
const TEXT_EXTS = new Set([
  ".md", ".markdown", ".txt", ".text", ".csv", ".tsv", ".json", ".jsonl",
  ".canvas", ".base", ".html", ".htm", ".xml", ".yaml", ".yml", ".log", ".ini", ".cfg",
]);
const MAX_TEXT_BYTES = 8 * 1024 * 1024; // skip pathologically large text files

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
  textCount: number;
  pdfCount: number;
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

function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(path.join(dir, e.name), out);
    } else if (e.isFile()) {
      const lower = e.name.toLowerCase();
      const ext = lower.slice(lower.lastIndexOf("."));
      if (lower.endsWith(".pdf") || TEXT_EXTS.has(ext)) {
        out.push(path.join(dir, e.name));
      }
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

// --- PDF extraction (cached to disk) -------------------------------------

// Extracted PDF text is cached on disk so large legislation PDFs only parse
// once; keyed by path + mtime. Kept out of git via .gitignore.
const CACHE_DIR = path.join(process.cwd(), ".vaultcache");
const PDF_CACHE_FILE = path.join(CACHE_DIR, "pdf-text.json");
type PdfCache = Record<string, { mtimeMs: number; pages: string[] }>;

function loadPdfCache(): PdfCache {
  try {
    return JSON.parse(fs.readFileSync(PDF_CACHE_FILE, "utf8")) as PdfCache;
  } catch {
    return {};
  }
}

function savePdfCache(cache: PdfCache): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(PDF_CACHE_FILE, JSON.stringify(cache));
  } catch {}
}

async function extractPdfPages(abs: string): Promise<string[]> {
  const { PDFParse } = await import("pdf-parse");
  const buf = fs.readFileSync(abs);
  const parser = new PDFParse({ data: buf });
  const r = await parser.getText();
  // r.pages is an array of per-page strings/objects; fall back to splitting text.
  const pages = Array.isArray(r.pages)
    ? r.pages.map((p: unknown) =>
        typeof p === "string" ? p : ((p as { text?: string })?.text ?? "")
      )
    : String(r.text ?? "").split("\f");
  return pages.map((p) => p.trim()).filter(Boolean);
}

// Chunk PDF pages: one chunk per page, windowing oversized pages.
function chunkPdf(relPath: string, pages: string[]): Omit<IndexedChunk, "tf" | "len">[] {
  const title = path.basename(relPath).replace(/\.pdf$/i, "");
  const chunks: Omit<IndexedChunk, "tf" | "len">[] = [];
  pages.forEach((page, idx) => {
    const heading = `p.${idx + 1}`;
    if (page.length <= MAX_CHUNK_CHARS) {
      chunks.push({ file: relPath, title, heading, text: page });
      return;
    }
    let window = "";
    for (const para of page.split(/\n\s*\n/)) {
      if (window && (window + "\n\n" + para).length > MAX_CHUNK_CHARS) {
        chunks.push({ file: relPath, title, heading, text: window.trim() });
        window = para;
      } else {
        window = window ? window + "\n\n" + para : para;
      }
    }
    if (window.trim()) chunks.push({ file: relPath, title, heading, text: window.trim() });
  });
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

async function buildIndex(): Promise<VaultIndex> {
  const files = walkFiles(VAULT_PATH);
  const signature = computeSignature(files);

  const chunks: IndexedChunk[] = [];
  const df = new Map<string, number>();
  let totalLen = 0;
  let textCount = 0;
  let pdfCount = 0;

  // Index one chunk: tokenise (title + heading + body) and update df/avgLen.
  const addChunk = (c: Omit<IndexedChunk, "tf" | "len">) => {
    const tokens = tokenize(`${c.title} ${c.heading} ${c.text}`);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    totalLen += tokens.length;
    chunks.push({ ...c, tf, len: tokens.length });
  };

  const pdfCache = loadPdfCache();
  let cacheDirty = false;

  for (const abs of files) {
    const rel = path.relative(VAULT_PATH, abs).replace(/\\/g, "/");
    const isPdf = abs.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(abs).mtimeMs;
      } catch {
        continue;
      }
      let entry = pdfCache[rel];
      if (!entry || entry.mtimeMs !== mtimeMs) {
        try {
          const pages = await extractPdfPages(abs);
          entry = { mtimeMs, pages };
          pdfCache[rel] = entry;
          cacheDirty = true;
        } catch {
          continue; // skip unreadable PDFs rather than failing the whole build
        }
      }
      for (const c of chunkPdf(rel, entry.pages)) addChunk(c);
      pdfCount++;
    } else {
      try {
        if (fs.statSync(abs).size > MAX_TEXT_BYTES) continue;
      } catch {
        continue;
      }
      let raw = "";
      try {
        raw = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const isMd = /\.(md|markdown)$/i.test(abs);
      for (const c of chunkNote(rel, isMd ? stripFrontmatter(raw) : raw)) addChunk(c);
      textCount++;
    }
  }

  if (cacheDirty) savePdfCache(pdfCache);

  return {
    signature,
    builtAt: Date.now(),
    fileCount: files.length,
    textCount,
    pdfCount,
    chunks,
    df,
    avgLen: chunks.length ? totalLen / chunks.length : 0,
  };
}

// Build (or rebuild on change) and cache the index. Async because PDF
// extraction is async; callers in async contexts must await this before search.
let building: Promise<VaultIndex> | null = null;
export async function ensureIndex(): Promise<VaultIndex> {
  const files = walkFiles(VAULT_PATH);
  const signature = computeSignature(files);
  if (cached && cached.signature === signature) return cached;
  // Coalesce concurrent rebuilds so two requests don't parse PDFs twice.
  if (!building) {
    building = buildIndex().then((idx) => {
      cached = idx;
      building = null;
      return idx;
    });
  }
  return building;
}

// --- public API ----------------------------------------------------------

export async function getVaultStats() {
  const idx = await ensureIndex();
  return {
    vaultPath: VAULT_PATH,
    exists: fs.existsSync(VAULT_PATH),
    fileCount: idx.fileCount,
    textCount: idx.textCount,
    pdfCount: idx.pdfCount,
    chunkCount: idx.chunks.length,
    vocabulary: idx.df.size,
    builtAt: new Date(idx.builtAt).toISOString(),
  };
}

// Unique list of indexed files (relative paths). For the agent's overview tool.
export function listFiles(): string[] {
  const idx = cached;
  if (!idx) return [];
  return Array.from(new Set(idx.chunks.map((c) => c.file))).sort();
}

// Authoritative source notes should outrank the bot's own past exports and
// rough drafts. Folder-based multipliers applied on top of the BM25 score.
function folderWeight(file: string): number {
  if (file.startsWith("Conversations/")) return 0.4; // prior Q&A — avoid echo chamber
  if (file.startsWith("Inbox/")) return 0.7; // drafts / unfiled
  return 1;
}

// BM25 ranking over the chunk index, with a per-file cap for source diversity.
// maxPerFile keeps a single note from monopolising the results on broad
// questions, while still allowing depth (default 4) on focused ones.
export function searchVault(query: string, k = 8, maxPerFile = 4): Hit[] {
  const idx = cached; // caller must await ensureIndex() first
  if (!idx) return [];
  const qTerms = tokenize(query);
  if (!qTerms.length || !idx.chunks.length) return [];

  const k1 = 1.5;
  const b = 0.75;
  const N = idx.chunks.length;

  const scored = idx.chunks
    .map((c) => {
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
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Greedy diversity pass: take the best chunks but cap how many come from any
  // one file. If we run short, a second pass relaxes the cap to fill up to k.
  const perFile = new Map<string, number>();
  const picked: typeof scored = [];
  for (const s of scored) {
    if (picked.length >= k) break;
    const used = perFile.get(s.c.file) ?? 0;
    if (used >= maxPerFile) continue;
    perFile.set(s.c.file, used + 1);
    picked.push(s);
  }
  if (picked.length < k) {
    const have = new Set(picked);
    for (const s of scored) {
      if (picked.length >= k) break;
      if (!have.has(s)) picked.push(s);
    }
  }

  return picked.map(({ c, score }) => ({
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
