import { getVaultStats, searchVault } from "@/lib/vault";

export const dynamic = "force-dynamic";

// Diagnostic endpoint for the Obsidian retrieval layer.
//   GET /api/vault            -> index stats (file/chunk counts)
//   GET /api/vault?q=arrears  -> stats + top matching chunks for the query
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();

  let stats;
  try {
    stats = getVaultStats();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }

  if (!q) return Response.json({ ok: true, ...stats });

  const hits = searchVault(q, 8).map((h) => ({
    file: h.file,
    heading: h.heading,
    score: h.score,
    preview: h.text.slice(0, 240).replace(/\s+/g, " "),
  }));

  return Response.json({ ok: true, ...stats, query: q, hitCount: hits.length, hits });
}
