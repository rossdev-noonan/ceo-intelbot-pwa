import { requireUser } from "@/auth";
import { syncVault, syncStatus, graphConfigured } from "@/lib/sharepoint";
import { ensureIndex, getVaultStats } from "@/lib/vault";

export const dynamic = "force-dynamic";
// Mirroring a whole library + reindexing can take a while on first run.
export const maxDuration = 300;

// Authorise either a signed-in allowlisted user (manual "Sync now") OR a bearer
// token matching SYNC_SECRET (for a scheduler / cron hitting this unattended).
async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth === `Bearer ${secret}`) return true;
  }
  const gate = await requireUser();
  return gate.ok;
}

// GET /api/sync — last-sync status (cheap; no network).
export async function GET() {
  const gate = await requireUser();
  if (!gate.ok) return new Response("Unauthorized", { status: 401 });
  return Response.json({ ok: true, ...syncStatus() });
}

// POST /api/sync — pull the latest vault from SharePoint, then rebuild the index.
export async function POST(req: Request) {
  if (!(await authorize(req))) return new Response("Unauthorized", { status: 401 });
  if (!graphConfigured()) {
    return Response.json(
      { ok: false, error: "SharePoint not configured (SHAREPOINT_* env unset)" },
      { status: 503 }
    );
  }

  const result = await syncVault();
  if (!result.ok) return Response.json(result, { status: 502 });

  // Force the BM25 index to pick up the freshly mirrored files.
  await ensureIndex();
  const stats = await getVaultStats();
  return Response.json({ ok: true, sync: result, vault: stats });
}
