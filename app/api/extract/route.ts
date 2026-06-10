import { requireUser } from "@/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TEXT_EXTS = [".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".html", ".htm", ".xml", ".yaml", ".yml", ".log"];
const MAX_CHARS = 120000;

// Extract text from an uploaded document so the bot can analyse it.
// Supports PDF (pdf-parse) and text-based files. Word/Excel binaries aren't
// parsed yet — the user can export to PDF or paste the text.
export async function POST(req: Request) {
  const gate = await requireUser();
  if (!gate.ok) return new Response("Unauthorized", { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "No file received." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file received." }, { status: 400 });

  const name = file.name;
  const lower = name.toLowerCase();
  if (file.size > 15 * 1024 * 1024) {
    return Response.json({ error: "File too large (max 15MB)." }, { status: 400 });
  }

  try {
    if (lower.endsWith(".pdf")) {
      const { PDFParse } = await import("pdf-parse");
      const buf = Buffer.from(await file.arrayBuffer());
      const r = await new PDFParse({ data: buf }).getText();
      const text = String(r.text ?? "").slice(0, MAX_CHARS);
      if (!text.trim()) return Response.json({ error: "Could not read any text from this PDF (it may be scanned)." }, { status: 400 });
      return Response.json({ name, text, chars: text.length });
    }

    if (TEXT_EXTS.some((e) => lower.endsWith(e)) || (file.type || "").startsWith("text")) {
      const text = (await file.text()).slice(0, MAX_CHARS);
      return Response.json({ name, text, chars: text.length });
    }

    return Response.json(
      {
        error:
          "Unsupported file type. Supported: PDF and text files (.txt, .md, .csv, .json, .html). For Word/Excel, export to PDF or paste the text.",
      },
      { status: 400 }
    );
  } catch (e) {
    return Response.json(
      { error: "Could not read file: " + (e instanceof Error ? e.message : "unknown error") },
      { status: 500 }
    );
  }
}
