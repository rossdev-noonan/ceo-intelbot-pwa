# PWA ↔ Teams IntelBot — reconciliation

How `ceo-intelbot-pwa` (this repo) relates to the **Teams IntelBot** described in
[`intelbot-build-procedure-v1.yaml`](./intelbot-build-procedure-v1.yaml) and the
v2.1 spec. They are **sibling products**, not the same system.

| Aspect | Teams IntelBot (procedure v1) | This PWA |
|---|---|---|
| Surface | Private Teams channel, no web UI | Next.js web PWA (sidebar, chats, projects) |
| Users | Mike only | Mike (web) — same owner |
| Transport | Power Automate bridge → n8n | Direct Next.js route handlers |
| Orchestration | n8n workflows | In-app `lib/brain.ts` + `lib/agent.ts` |
| AI core | 3-model fan-out + synthesiser | **Same** (GPT-5.5 + Opus + Perplexity → Opus) |
| Grounding | None (public ASX/market info) | **Obsidian vault RAG** (BM25 over notes + PDFs) |
| Storage | n8n Data Tables (24h TTL) | Browser localStorage (chats) + disk PDF cache |
| Export | PDF/CSV/XLSX via n8n | Copy/MD/CSV/PDF client-side |

## The intentional divergences (PWA-only, NOT spec violations)

The procedure marks sidebar / projects / web frontend as "NOT APPLICABLE" — but
that is scoped to the **Teams** build. The PWA is a deliberately different
product, so projects, a connectors panel, and a web UI are in-scope here.

## ⚠️ The one tension to decide consciously — DATA BOUNDARY

The Teams spec's **locked decision C1**: IntelBot handles **public ASX/market
info only**, because every question transits OpenAI/Anthropic/Perplexity, and a
`sensitivity_check` node refuses MNPI / client-confidential / PII **before** any
LLM call.

**Decision (2026-06-10): "gate now, audit later."**

- ✅ **Sensitivity gate IMPLEMENTED** (`lib/sensitivity.ts`, wired in
  `app/api/chat/route.ts`). A pre-LLM, high-precision check refuses inputs
  containing card numbers (Luhn), personal/financial identifiers (TFN, Medicare,
  passport, licence, BSB/account, CVV), dates of birth, and MNPI markers —
  BEFORE any model is called. It targets *identifiers*, not sensitive *topics*:
  questions about DV lease exits, arrears, child-safety procedures still work.
- ⏳ **Audit log DEFERRED** — no persistent Q&A audit trail yet (Teams uses
  Purview). To add later if required.
- ✅ **Prompt-injection defence** already present (question + retrieved content +
  tool output all treated as untrusted data in the system prompts).

Remaining residual vs the Teams public-only boundary: vault excerpts (internal
knowledge — procedures + legislation) still go to third-party LLMs by design,
which is the intended behaviour for an internal knowledge assistant. Keep raw
client records out of the vault.

## Phase 15 (uRent API) overlap

The PWA's Agent mode (tools/connectors) and the proposed Phase 15 (expose
IntelBot as an authenticated API to uRent, with per-department instruction
profiles) point in the same direction. The PWA's `lib/agent.ts` + connectors +
custom-instructions work could become the reference implementation for Phase 15
— but Phase 15's conflict flags (separate instance, uRent's own keys/caps, same
sensitivity gate, no standing Ross dependency) still apply.
