import { requireUser } from "@/auth";
import { readAudit, verifyChain } from "@/lib/audit";

export const dynamic = "force-dynamic";

// GET /api/audit?limit=100 — recent audit records (newest first) + a chain
// integrity check. Questions are stored only as hashes, so this is safe to view.
// Auth-gated like everything else.
export async function GET(req: Request) {
  const gate = await requireUser();
  if (!gate.ok) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 1000);

  const integrity = verifyChain();
  const records = readAudit(limit);
  return Response.json({ ok: true, integrity, count: records.length, records });
}
