# IntelBot-PWA — Deployment & Security Plan

Decisions (2026-06-10): **Hosted private web app** + **Microsoft 365 SSO**. Aligns
with the IntelBot v2.1 protocol (M365 identity, MFA, HTTPS, secrets in vault,
audit, handover to Mike).

## Target architecture

```
Mike's device (PWA, any platform)
        │  HTTPS + M365 SSO (MFA / conditional access)
        ▼
Azure App Service (Linux) or container — runs `next start` (long-lived)
  ├─ Auth.js (Microsoft Entra ID provider), allowlist = Mike's account only
  ├─ /api/chat (brain) — protected; runs minutes; reads vault from disk
  ├─ Vault on persistent disk — MIRROR of a SharePoint document library
  │     └─ scheduled POST /api/sync (Graph pull) → app auto-reindexes on change
  ├─ Secrets — App Service config / Azure Key Vault (NOT in repo)
  └─ Audit log — append-only, encrypted, per question/answer
```

Why not Vercel/serverless: the vault is read from the filesystem, the PDF cache
is written to disk, and answers run for minutes — all incompatible with
read-only/ephemeral serverless. Use a persistent Node host.

## Obsidian + SharePoint sync (the elegant part) — IMPLEMENTED
Decision (2026-06-15): the vault transport is **SharePoint**, not git. One
mechanism serves both "Obsidian syncing" and the "connect to SharePoint" ask:

```
Mike's Obsidian (any device)
  → OneDrive client syncs the vault folder into a SharePoint document library
  → server pulls it via Microsoft Graph (app-only) into a local mirror
  → BM25 index rebuilds on the file-signature change (already implemented)
```

Code (this build):
- `lib/graph.ts` — app-only Graph client (token, site/drive resolution, list,
  download, upload). Reuses the Entra app; gated on `SHAREPOINT_*` env.
- `lib/sharepoint.ts` — `syncVault()` mirrors the library folder to
  `SHAREPOINT_SYNC_DIR` via a manifest (only fetches changed files); `saveAnswer()`
  uploads exports back.
- `lib/vault.ts` — when SharePoint is configured, `VAULT_PATH` resolves to the
  mirror dir; otherwise unchanged (local-vault dev still works).
- `POST /api/sync` — pull + reindex (auth, or `Bearer SYNC_SECRET` for a cron);
  `GET /api/sync` — last-sync status.
- `POST /api/save` + the answer "☁ Save to SharePoint" menu item — save any
  answer (as Markdown) back to the library, so outputs round-trip into the vault.

Scheduling the pull: a timer (Azure App Service WebJob / Logic App / external
cron) hits `POST /api/sync` with the `SYNC_SECRET` bearer on an interval
(e.g. every 5–15 min). Git pull remains a viable alternative if SharePoint is
ever unavailable.

### Graph app-permission setup (one-time, Mike's tenant)
On the existing **IntelBot PWA** Entra app registration:
- "API permissions" → Add a permission → Microsoft Graph → **Application
  permissions** → add **`Sites.Selected`** (least privilege; preferred). Grant
  admin consent.
- Grant the app access to ONLY the IntelBot site (so `Sites.Selected` resolves).
  Using Graph (as a Sites admin), `POST /sites/{site-id}/permissions` with
  `roles: ["write"]` and the app's client id + displayName. (Broader fallback:
  use `Sites.ReadWrite.All` instead and skip the per-site grant.)
- No new secret needed — the daemon reuses `AUTH_MICROSOFT_ENTRA_ID_ID/SECRET`.
- Fill the `SHAREPOINT_*` env (see `.env.example`): `SHAREPOINT_SITE_PATH`
  (e.g. `noonan.sharepoint.com:/sites/IntelBot`), `SHAREPOINT_VAULT_FOLDER`,
  optionally `SHAREPOINT_SAVE_FOLDER`, and `SYNC_SECRET`.

> Data boundary note: vault content retrieved from SharePoint still feeds the
> LLMs, so the same MNPI/sensitivity rules apply — keep the synced library to
> public/business-planning material, not client-identifiable or insider data.

## Build sequence

### Phase A — Secure the app (P0)
1. **Auth.js + Microsoft Entra ID provider** — sign-in page, session, callback.
2. **Allowlist** — only Mike's M365 account (and a break-glass admin) may sign in.
3. **Protect everything** — middleware on all pages; every `/api/*` route checks
   the session server-side. No anonymous access to `/api/chat`.
4. **HTTPS only** — provided by App Service; enforce secure cookies.

### Phase B — Make it hosted + multi-device (P0)
5. `output: "standalone"` + Dockerfile (or App Service Node config). **DONE.**
6. Vault from SharePoint → local mirror on a persistent volume
   (`SHAREPOINT_SYNC_DIR`); scheduled `POST /api/sync` reindexes. **DONE (code).**
7. Secrets in App Service config / Key Vault. Remove all keys from any machine.
8. Install as PWA on Mike's devices (manifest already present; add icons).

### Phase C — Harden to protocol (P1)
9. **Audit log** — append-only store of {timestamp, user, question-hash,
   answer, models, cost} with retention; the deferred piece.
10. **Server-side chat storage** (per-user, encrypted) instead of localStorage,
    so history follows Mike across devices.
11. Rate limiting; keep the sensitivity gate; security headers (CSP, HSTS).

### Phase D — Handover (P1, protocol)
12. Mike on **his own** provider API keys; 60-day key/secret rotation.
13. Deployment + Azure app registration owned by Mike's tenant; Ross removed.
14. Deliver this doc + runbook; break-glass admin is the only re-entry path.

## What Ross must provide to unblock auth (Azure app registration)
In the Microsoft Entra admin center (Mike's tenant), "App registrations" → New:
- **Name:** IntelBot PWA
- **Supported account types:** Single tenant (Mike's org only)
- **Redirect URI (Web):** `https://<host>/api/auth/callback/microsoft-entra-id`
  (and `http://localhost:3000/api/auth/callback/microsoft-entra-id` for dev)
- After creation, collect: **Application (client) ID**, **Directory (tenant) ID**
- "Certificates & secrets" → New client secret → copy the **secret value**
- "API permissions" → Microsoft Graph → delegated: `openid`, `profile`, `email`
  (optionally `User.Read`). Grant admin consent.

These become env vars: `AUTH_MICROSOFT_ENTRA_ID_ID`,
`AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
(`https://login.microsoftonline.com/<tenant-id>/v2.0`), plus `AUTH_SECRET`
(random) and `AUTH_URL`. Plus `INTELBOT_ALLOWED_EMAILS=mike@...`.

## Status
- Brain / RAG / routing / export / formatting: **done**.
- Auth (Entra ID + allowlist): **done**.
- Standalone build + Dockerfile: **done**.
- SharePoint vault sync + save-back (`lib/graph.ts`, `lib/sharepoint.ts`,
  `/api/sync`, `/api/save`): **done (code)** — needs the one-time Graph
  `Sites.Selected` consent + `SHAREPOINT_*` env to go live.
- Blocked on Mike: deploy target/host + DNS + Entra redirect URIs; the
  SharePoint site URL + admin consent; scheduled-sync wiring on the host.
- Still to build (P1): audit log, server-side chat storage, rate limiting,
  security headers, handover (Mike's own keys + ownership).
