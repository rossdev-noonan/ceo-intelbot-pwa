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
  ├─ Vault on persistent disk — git clone of a PRIVATE vault repo
  │     └─ scheduled `git pull` (or webhook) → app auto-reindexes on change
  ├─ Secrets — App Service config / Azure Key Vault (NOT in repo)
  └─ Audit log — append-only, encrypted, per question/answer
```

Why not Vercel/serverless: the vault is read from the filesystem, the PDF cache
is written to disk, and answers run for minutes — all incompatible with
read-only/ephemeral serverless. Use a persistent Node host.

## Obsidian across devices (the elegant part)
The vault is already a git repo. Flow: Mike's Obsidian (Obsidian Git plugin or
Obsidian Sync → git) auto-commits to a **private vault repo**; the server does a
scheduled `git pull`; the app re-indexes on the file-signature change (already
implemented). Mike edits on any device; the server always has the current vault.

## Build sequence

### Phase A — Secure the app (P0)
1. **Auth.js + Microsoft Entra ID provider** — sign-in page, session, callback.
2. **Allowlist** — only Mike's M365 account (and a break-glass admin) may sign in.
3. **Protect everything** — middleware on all pages; every `/api/*` route checks
   the session server-side. No anonymous access to `/api/chat`.
4. **HTTPS only** — provided by App Service; enforce secure cookies.

### Phase B — Make it hosted + multi-device (P0)
5. `output: "standalone"` + Dockerfile (or App Service Node config).
6. Vault on a persistent path (`VAULT_PATH`), git-clone + scheduled `git pull`.
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
- Auth, hosting, vault-sync, audit, handover: **to build** (this plan).
