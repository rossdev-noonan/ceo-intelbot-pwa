import { requireUser } from "@/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// --- limits ---------------------------------------------------------------
const MAX_FILE_BYTES = 30 * 1024 * 1024; // 30MB per upload (matches Claude's practical floor)
const SINGLE_MAX = 200_000; // chars kept from a single file (~50k tokens)
const ZIP_TOTAL_MAX = 200_000; // total chars kept from a ZIP
const ZIP_PER_FILE_MAX = 80_000; // per-file cap inside a ZIP
const ZIP_MAX_FILES = 300; // safety cap on entries read from a ZIP

// Plain-text / code / data files read verbatim as UTF-8.
const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".html", ".htm", ".xml",
  ".yaml", ".yml", ".log", ".css", ".scss", ".less", ".sql", ".toml", ".ini",
  ".cfg", ".conf", ".env", ".properties", ".js", ".jsx", ".mjs", ".cjs", ".ts",
  ".tsx", ".py", ".rb", ".php", ".java", ".kt", ".kts", ".scala", ".go", ".rs",
  ".swift", ".c", ".h", ".cpp", ".cc", ".hpp", ".cs", ".sh", ".bash", ".zsh",
  ".ps1", ".bat", ".r", ".pl", ".lua", ".dart", ".vue", ".svelte", ".gradle",
  ".tex", ".gitignore", ".dockerfile",
]);

// CommonJS/ESM interop for dynamically-imported parsers (pdf-parse, mammoth, xlsx).
function interop<T>(mod: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (mod as any)?.default;
  return d && typeof d === "object" ? d : mod;
}

function extOf(name: string): string {
  const base = name.toLowerCase().split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : base; // e.g. ".docx", or "dockerfile"
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Pull readable text out of a .pptx (a ZIP of slide XML) by reading the <a:t> runs.
async function extractPptx(data: Uint8Array): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(data);
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)?.[1] ?? 0) - Number(b.match(/(\d+)/)?.[1] ?? 0));
  const out: string[] = [];
  slides.forEach((n, i) => {
    const xml = strFromU8(files[n]);
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]));
    const text = runs.join(" ").replace(/\s+/g, " ").trim();
    if (text) out.push(`Slide ${i + 1}: ${text}`);
  });
  return out.join("\n\n");
}

// Extract text from one file (by name + bytes). Reused for direct uploads and
// for each entry inside a ZIP. Returns { text } or { error }.
async function extractOne(name: string, data: Uint8Array): Promise<{ text: string } | { error: string }> {
  const lower = name.toLowerCase();
  const ext = extOf(lower);
  try {
    if (ext === ".pdf") {
      const { PDFParse } = await import("pdf-parse");
      const r = await new PDFParse({ data: Buffer.from(data) }).getText();
      const text = String(r.text ?? "").trim();
      return text ? { text } : { error: "no extractable text (scanned PDF?)" };
    }
    if (ext === ".docx") {
      const mammoth = interop(await import("mammoth"));
      const r = await mammoth.extractRawText({ buffer: Buffer.from(data) });
      return { text: (r.value ?? "").trim() };
    }
    if (ext === ".xlsx" || ext === ".xls") {
      const XLSX = interop(await import("xlsx"));
      const wb = XLSX.read(data, { type: "array" });
      const parts = wb.SheetNames.map((s) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[s]).trim();
        return csv ? `# Sheet: ${s}\n${csv}` : "";
      }).filter(Boolean);
      return { text: parts.join("\n\n") };
    }
    if (ext === ".pptx") {
      return { text: await extractPptx(data) };
    }
    if (TEXT_EXTS.has(ext) || ext === "dockerfile" || ext === "makefile") {
      return { text: Buffer.from(data).toString("utf8") };
    }
    return { error: "unsupported type" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "parse failed" };
  }
}

// Unzip an archive, extract text from every supported entry, and concatenate
// with clear separators. Images/binaries/unsupported/nested zips are skipped
// and reported. Respects per-file, total, and entry-count caps.
async function handleZip(name: string, data: Uint8Array): Promise<Response> {
  const { unzipSync } = await import("fflate");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    return Response.json({ error: "Could not open that ZIP archive (corrupt or encrypted?)." }, { status: 400 });
  }

  const entries = Object.keys(files)
    .filter((n) => !n.endsWith("/") && !n.includes("__MACOSX/") && !(n.split("/").pop() || "").startsWith("."))
    .sort();

  const parts: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  let used = 0;
  let truncated = false;

  for (const path of entries) {
    if (used >= ZIP_MAX_FILES || total >= ZIP_TOTAL_MAX) {
      truncated = true;
      break;
    }
    if (extOf(path) === ".zip") {
      skipped.push(`${path} (nested archive)`);
      continue;
    }
    const r = await extractOne(path, files[path]);
    if ("error" in r || !r.text.trim()) {
      skipped.push(path);
      continue;
    }
    let t = r.text.trim();
    if (t.length > ZIP_PER_FILE_MAX) t = t.slice(0, ZIP_PER_FILE_MAX) + "\n…[file truncated]";
    if (total + t.length > ZIP_TOTAL_MAX) {
      t = t.slice(0, Math.max(0, ZIP_TOTAL_MAX - total)) + "\n…[truncated to fit]";
      truncated = true;
    }
    parts.push(`===== ${path} =====\n${t}`);
    total += t.length;
    used++;
  }

  if (!parts.length) {
    return Response.json({ error: "No readable text files found inside that ZIP." }, { status: 400 });
  }

  let header = `ZIP archive "${name}" — ${used} file(s) extracted`;
  if (skipped.length) header += `; ${skipped.length} skipped (images/binaries/unsupported)`;
  if (truncated) header += "; content truncated to fit";
  const text = `${header}\n\n${parts.join("\n\n")}`;
  return Response.json({ name, text, chars: text.length, files: used });
}

// Friendly guidance for the formats we deliberately don't parse.
function unsupportedMessage(name: string): string {
  const ext = extOf(name);
  if (ext === ".doc") return "Legacy .doc isn't supported — please save it as .docx or PDF and re-upload.";
  if (ext === ".ppt") return "Legacy .ppt isn't supported — please save it as .pptx or PDF and re-upload.";
  if (ext === ".pages" || ext === ".key" || ext === ".numbers")
    return "Apple iWork files aren't supported — export to PDF, Word, or Excel first.";
  return "Unsupported file type. Supported: PDF, Word (.docx), Excel (.xlsx/.xls), PowerPoint (.pptx), ZIP, and text/code/data files.";
}

export async function POST(req: Request) {
  const gate = await requireUser();
  if (!gate.ok) return new Response("Unauthorized", { status: 401 });

  // Reject oversize uploads up front by Content-Length. The platform buffers the
  // body to a fixed limit (see next.config proxyClientMaxBodySize) and truncates
  // beyond it, which makes formData() throw — catch that case cleanly instead of
  // letting it surface as a confusing "no file" error.
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared && declared > MAX_FILE_BYTES + 1024 * 1024) {
    return Response.json({ error: "File too large (max 30MB)." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: "Upload failed — the file may be too large (max 30MB) or the connection dropped. Try a smaller file." },
      { status: 400 }
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file received." }, { status: 400 });

  const name = file.name;
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: "File too large (max 30MB)." }, { status: 400 });
  }

  const data = new Uint8Array(await file.arrayBuffer());

  if (extOf(name) === ".zip") {
    return handleZip(name, data);
  }

  const r = await extractOne(name, data);
  if ("error" in r) {
    const msg = r.error === "unsupported type" ? unsupportedMessage(name) : `Could not read this file: ${r.error}`;
    return Response.json({ error: msg }, { status: 400 });
  }
  if (!r.text.trim()) {
    return Response.json({ error: "Could not read any text from this file." }, { status: 400 });
  }

  let text = r.text;
  if (text.length > SINGLE_MAX) text = text.slice(0, SINGLE_MAX) + "\n…[truncated to fit]";
  return Response.json({ name, text, chars: text.length });
}
