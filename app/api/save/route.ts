import { requireUser } from "@/auth";
import { saveAnswer, graphConfigured } from "@/lib/sharepoint";

export const dynamic = "force-dynamic";

// POST /api/save — persist an exported answer to SharePoint.
// Body: { filename, contentBase64, mime }. The client builds the exact export
// bytes (same builders as the download buttons) so the saved file matches what
// Mike would have downloaded. Returns the SharePoint web URL.
export async function POST(req: Request) {
  const gate = await requireUser();
  if (!gate.ok) return new Response("Unauthorized", { status: 401 });
  if (!graphConfigured()) {
    return Response.json(
      { ok: false, error: "SharePoint not configured" },
      { status: 503 }
    );
  }

  let body: { filename?: string; contentBase64?: string; mime?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const { filename, contentBase64, mime } = body;
  if (!filename || !contentBase64) {
    return Response.json(
      { ok: false, error: "filename and contentBase64 are required" },
      { status: 400 }
    );
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(contentBase64, "base64");
  } catch {
    return Response.json({ ok: false, error: "contentBase64 not decodable" }, { status: 400 });
  }
  // Guard against oversized payloads (answers are small; this is a sanity cap).
  if (buf.byteLength > 25 * 1024 * 1024) {
    return Response.json({ ok: false, error: "file too large (>25MB)" }, { status: 413 });
  }

  // Keep the filename a bare leaf — no path traversal into other folders.
  const safeName = filename.replace(/[/\\]/g, "_").slice(0, 180);

  try {
    const saved = await saveAnswer(
      safeName,
      buf,
      mime || "application/octet-stream"
    );
    return Response.json({ ok: true, ...saved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "save failed";
    return Response.json({ ok: false, error: msg }, { status: 502 });
  }
}
