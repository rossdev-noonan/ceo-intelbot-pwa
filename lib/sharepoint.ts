// SharePoint vault sync + answer save, layered on the Graph client.
//
// sync model: the SharePoint document-library folder is the source of truth for
// the vault; we MIRROR it to a local directory (SHAREPOINT_SYNC_DIR) and the
// existing BM25 indexer (lib/vault.ts) reads that directory unchanged. A small
// manifest tracks each file's lastModified so re-syncs only fetch what changed.
//
// This keeps Obsidian sync and SharePoint as one mechanism: Mike edits the vault
// in Obsidian → OneDrive client syncs it to the SharePoint library → the server
// pulls it here. Nothing in the retrieval path had to change.

import fs from "node:fs";
import path from "node:path";
import {
  graphConfigured,
  listVaultFiles,
  downloadFile,
  uploadFile,
  type SavedFile,
} from "@/lib/graph";

export { graphConfigured };

// Local mirror directory. Defaults under .vaultcache (gitignored) so it sits
// beside the PDF cache; override with SHAREPOINT_SYNC_DIR (e.g. a mounted volume
// or persistent disk on the host). vault.ts points VAULT_PATH here when SharePoint
// is configured.
export function syncDir(): string {
  return (
    process.env.SHAREPOINT_SYNC_DIR ||
    path.join(process.cwd(), ".vaultcache", "sharepoint")
  );
}

const MANIFEST = () => path.join(syncDir(), ".sync-manifest.json");

type Manifest = {
  lastSync: string | null;
  files: Record<string, string>; // rel path -> lastModified ISO
};

function loadManifest(): Manifest {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST(), "utf8")) as Manifest;
  } catch {
    return { lastSync: null, files: {} };
  }
}

function saveManifest(m: Manifest): void {
  fs.mkdirSync(syncDir(), { recursive: true });
  fs.writeFileSync(MANIFEST(), JSON.stringify(m, null, 2));
}

export type SyncResult = {
  ok: boolean;
  downloaded: number;
  unchanged: number;
  deleted: number;
  total: number;
  ms: number;
  error?: string;
};

// Mirror the SharePoint vault folder into syncDir(). Downloads new/changed files,
// removes local files no longer present remotely, and rewrites the manifest.
// Safe to call repeatedly; cheap when nothing changed.
export async function syncVault(): Promise<SyncResult> {
  const start = Date.now();
  if (!graphConfigured()) {
    return {
      ok: false,
      downloaded: 0,
      unchanged: 0,
      deleted: 0,
      total: 0,
      ms: 0,
      error: "SharePoint not configured (SHAREPOINT_* env unset)",
    };
  }

  const dir = syncDir();
  fs.mkdirSync(dir, { recursive: true });
  const prev = loadManifest();

  let remote;
  try {
    remote = await listVaultFiles();
  } catch (e) {
    return {
      ok: false,
      downloaded: 0,
      unchanged: 0,
      deleted: 0,
      total: 0,
      ms: Date.now() - start,
      error: e instanceof Error ? e.message : "list failed",
    };
  }

  const next: Manifest = { lastSync: new Date().toISOString(), files: {} };
  let downloaded = 0;
  let unchanged = 0;

  for (const f of remote) {
    next.files[f.rel] = f.lastModified;
    const dest = path.join(dir, f.rel);
    const fresh = prev.files[f.rel] === f.lastModified && fs.existsSync(dest);
    if (fresh) {
      unchanged++;
      continue;
    }
    try {
      const buf = await downloadFile(f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      downloaded++;
    } catch {
      // Skip a single bad file rather than failing the whole sync; it keeps its
      // previous local copy (if any) and we retry next sync.
      if (prev.files[f.rel]) next.files[f.rel] = prev.files[f.rel];
    }
  }

  // Delete local files that vanished from SharePoint (but never the manifest).
  let deleted = 0;
  const remoteSet = new Set(remote.map((f) => f.rel));
  for (const rel of Object.keys(prev.files)) {
    if (remoteSet.has(rel)) continue;
    const dead = path.join(dir, rel);
    try {
      if (fs.existsSync(dead)) {
        fs.rmSync(dead);
        deleted++;
      }
    } catch {}
  }

  saveManifest(next);
  return {
    ok: true,
    downloaded,
    unchanged,
    deleted,
    total: remote.length,
    ms: Date.now() - start,
  };
}

// Last sync metadata for the /api/sync status endpoint.
export function syncStatus(): { configured: boolean; lastSync: string | null; fileCount: number; dir: string } {
  const m = loadManifest();
  return {
    configured: graphConfigured(),
    lastSync: m.lastSync,
    fileCount: Object.keys(m.files).length,
    dir: syncDir(),
  };
}

// Save an exported answer back to SharePoint. The client builds the exact bytes
// (so format/styling matches the download), base64-encodes them, and posts here.
export async function saveAnswer(
  name: string,
  content: Buffer,
  contentType: string
): Promise<SavedFile> {
  if (!graphConfigured()) throw new Error("SharePoint not configured");
  return uploadFile(name, content, contentType);
}
