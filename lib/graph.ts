// Microsoft Graph — app-only (client-credentials) client for SharePoint.
//
// Dependency-free, raw fetch (same posture as lib/models.ts). Used to mirror a
// SharePoint document-library folder into the local vault dir and to save
// exported answers back to SharePoint. Reuses the existing Entra app
// registration (AUTH_MICROSOFT_ENTRA_ID_*) but requires *application* Graph
// permissions on that app: Sites.Selected (granted to the IntelBot site) or, as
// a broader fallback, Sites.ReadWrite.All. Delegated sign-in perms are separate.
//
// Everything is gated on graphConfigured(): when the SHAREPOINT_* env is absent
// the whole module no-ops and the app keeps using the local vault unchanged.

const GRAPH = "https://graph.microsoft.com/v1.0";

// Percent-encode each segment of a drive path while preserving the "/" between
// segments, so folder/file names with spaces (e.g. "CEO Intelbot") or other
// reserved characters address correctly in Graph "root:/path:" URLs.
function encodePath(p: string): string {
  return p
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

// Tenant: explicit SHAREPOINT_TENANT_ID, else parsed from the Entra issuer
// (https://login.microsoftonline.com/<tenant-id>/v2.0).
function tenantId(): string {
  if (process.env.SHAREPOINT_TENANT_ID) return process.env.SHAREPOINT_TENANT_ID;
  const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER || "";
  const m = /login\.microsoftonline\.com\/([^/]+)/.exec(issuer);
  return m ? m[1] : "";
}

// The app registration's client id/secret double as the daemon credential.
function clientId(): string {
  return process.env.AUTH_MICROSOFT_ENTRA_ID_ID || "";
}
function clientSecret(): string {
  return process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET || "";
}

// SharePoint location. Provide EITHER:
//   SHAREPOINT_SITE_ID   — full Graph site id (host,siteGuid,webGuid), OR
//   SHAREPOINT_SITE_PATH — "host:/sites/Name" (e.g. noonan.sharepoint.com:/sites/IntelBot)
// SHAREPOINT_VAULT_FOLDER — folder in the default library holding the vault
//   (e.g. "IntelBot/vault"; "" or "/" = library root).
// SHAREPOINT_SAVE_FOLDER  — folder exports are saved to (default same as vault).
export function vaultFolder(): string {
  return (process.env.SHAREPOINT_VAULT_FOLDER || "").replace(/^\/+|\/+$/g, "");
}
export function saveFolder(): string {
  return (process.env.SHAREPOINT_SAVE_FOLDER || process.env.SHAREPOINT_VAULT_FOLDER || "")
    .replace(/^\/+|\/+$/g, "");
}

export function graphConfigured(): boolean {
  return !!(
    tenantId() &&
    clientId() &&
    clientSecret() &&
    (process.env.SHAREPOINT_SITE_ID || process.env.SHAREPOINT_SITE_PATH)
  );
}

// --- token (cached in-memory, refreshed ~1 min before expiry) --------------

let token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value;
  const url = `https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Graph token request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
  return token.value;
}

async function graphGet<T>(pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await getToken()}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Graph GET ${url} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// --- site + drive resolution (cached) --------------------------------------

let driveIdCache: string | null = null;

async function resolveSiteId(): Promise<string> {
  if (process.env.SHAREPOINT_SITE_ID) return process.env.SHAREPOINT_SITE_ID;
  // SHAREPOINT_SITE_PATH = "host:/sites/Name" → /sites/{host}:/sites/Name
  const raw = process.env.SHAREPOINT_SITE_PATH || "";
  const [host, ...rest] = raw.split(":");
  const serverRel = rest.join(":").replace(/^\/+/, "");
  const site = await graphGet<{ id: string }>(`/sites/${host}:/${encodePath(serverRel)}`);
  return site.id;
}

// The default document library (drive) of the site. Override the library by
// setting SHAREPOINT_DRIVE_NAME to match a specific library's name.
export async function getDriveId(): Promise<string> {
  if (driveIdCache) return driveIdCache;
  const siteId = await resolveSiteId();
  const wanted = process.env.SHAREPOINT_DRIVE_NAME;
  if (wanted) {
    const { value } = await graphGet<{ value: { id: string; name: string }[] }>(
      `/sites/${siteId}/drives`
    );
    const drive = value.find((d) => d.name === wanted);
    if (!drive) throw new Error(`SharePoint library "${wanted}" not found on site`);
    driveIdCache = drive.id;
  } else {
    const drive = await graphGet<{ id: string }>(`/sites/${siteId}/drive`);
    driveIdCache = drive.id;
  }
  return driveIdCache;
}

// --- listing ---------------------------------------------------------------

export type DriveFile = {
  // path relative to the synced folder, forward-slashed (the vault-relative path)
  rel: string;
  size: number;
  lastModified: string; // ISO timestamp — the sync change-key
  downloadUrl: string; // short-lived pre-authenticated URL
};

type DriveItem = {
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
  "@microsoft.graph.downloadUrl"?: string;
};

// Path of a folder inside the drive, addressed for the Graph "root:/path:" form.
function folderAddr(folder: string): string {
  return folder ? `root:/${encodePath(folder)}:` : "root";
}

// Recursively list every file beneath the vault folder. Follows @odata.nextLink
// paging and descends into subfolders. relPrefix is the path accumulated so far.
async function listFolder(
  driveId: string,
  folder: string,
  relPrefix: string,
  out: DriveFile[]
): Promise<void> {
  let next: string | null =
    `${GRAPH}/drives/${driveId}/${folderAddr(folder)}/children?$top=200`;
  while (next) {
    const page: { value: DriveItem[]; "@odata.nextLink"?: string } =
      await graphGet(next);
    for (const item of page.value) {
      const rel = relPrefix ? `${relPrefix}/${item.name}` : item.name;
      if (item.folder) {
        const childFolder = folder ? `${folder}/${item.name}` : item.name;
        await listFolder(driveId, childFolder, rel, out);
      } else if (item.file) {
        out.push({
          rel,
          size: item.size ?? 0,
          lastModified: item.lastModifiedDateTime ?? "",
          downloadUrl: item["@microsoft.graph.downloadUrl"] ?? "",
        });
      }
    }
    next = page["@odata.nextLink"] ?? null;
  }
}

// Every file under the configured vault folder, as vault-relative paths.
export async function listVaultFiles(): Promise<DriveFile[]> {
  const driveId = await getDriveId();
  const out: DriveFile[] = [];
  await listFolder(driveId, vaultFolder(), "", out);
  return out;
}

// Download one file's bytes. Uses the item's pre-authenticated downloadUrl when
// present (no auth header needed); falls back to the authenticated content API.
export async function downloadFile(f: DriveFile): Promise<Buffer> {
  if (f.downloadUrl) {
    const res = await fetch(f.downloadUrl);
    if (!res.ok) throw new Error(`download ${f.rel} failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  const driveId = await getDriveId();
  const folder = vaultFolder();
  const full = folder ? `${folder}/${f.rel}` : f.rel;
  const res = await fetch(`${GRAPH}/drives/${driveId}/root:/${encodePath(full)}:/content`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
  });
  if (!res.ok) throw new Error(`download ${f.rel} failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// --- upload (save back) ----------------------------------------------------

const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024; // Graph simple-PUT ceiling

export type SavedFile = { name: string; webUrl: string; id: string };

// Upload bytes to the save folder, returning the SharePoint web URL. Files up to
// 4 MB use a single PUT; larger files use a chunked upload session. Exports are
// small, but the session path keeps big PDFs safe.
export async function uploadFile(
  name: string,
  content: Buffer,
  contentType: string
): Promise<SavedFile> {
  const driveId = await getDriveId();
  const folder = saveFolder();
  const full = folder ? `${folder}/${name}` : name;

  if (content.byteLength <= SIMPLE_UPLOAD_MAX) {
    const res = await fetch(`${GRAPH}/drives/${driveId}/root:/${encodePath(full)}:/content`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        "Content-Type": contentType,
      },
      body: new Uint8Array(content),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`upload ${name} failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const item = (await res.json()) as { id: string; name: string; webUrl: string };
    return { name: item.name, webUrl: item.webUrl, id: item.id };
  }

  // Large file: create an upload session and PUT in chunks.
  const session = await fetch(
    `${GRAPH}/drives/${driveId}/root:/${encodePath(full)}:/createUploadSession`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
    }
  );
  if (!session.ok) throw new Error(`upload session failed (${session.status})`);
  const { uploadUrl } = (await session.json()) as { uploadUrl: string };

  const CHUNK = 5 * 1024 * 1024; // multiple of 320 KiB
  const total = content.byteLength;
  let last: Response | null = null;
  for (let start = 0; start < total; start += CHUNK) {
    const end = Math.min(start + CHUNK, total);
    const slice = content.subarray(start, end);
    last = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(slice.byteLength),
        "Content-Range": `bytes ${start}-${end - 1}/${total}`,
      },
      body: new Uint8Array(slice),
    });
    if (!last.ok && last.status !== 202) {
      const detail = await last.text().catch(() => "");
      throw new Error(`chunk upload failed (${last.status}): ${detail.slice(0, 200)}`);
    }
  }
  const item = (await last!.json()) as { id: string; name: string; webUrl: string };
  return { name: item.name, webUrl: item.webUrl, id: item.id };
}
