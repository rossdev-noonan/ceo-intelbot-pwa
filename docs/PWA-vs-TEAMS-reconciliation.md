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

**The PWA currently has no equivalent gate.** It retrieves from Mike's internal
Obsidian vault (operational procedures, NSW legal notes, scenario playbooks) and
sends that content to the same three external LLMs. The vault appears to be
internal *knowledge* (processes + legislation), not live client records — but:

- There is no sensitivity/data-boundary gate refusing PII/MNPI inputs.
- There is no audit log of questions/answers.
- Vault excerpts (which could include client-identifiable scenarios) leave to
  third-party LLMs by design.

This is acceptable IF the intent is "internal knowledge assistant for Mike over
non-client-PII content." It is **not** aligned with the Teams public-only
boundary. Decide one of:

1. **Accept** the PWA as an internal-knowledge tool (document the boundary: no
   raw client PII in the vault).
2. **Port the sensitivity gate** into the PWA (a pre-LLM check that refuses
   PII/MNPI), matching the spec's posture.
3. **Add audit logging** of Q&A for the PWA to mirror the Teams audit trail.

Prompt-injection defence IS already present in the PWA (question + retrieved
content + tool output are all treated as untrusted data in the system prompts).

## Phase 15 (uRent API) overlap

The PWA's Agent mode (tools/connectors) and the proposed Phase 15 (expose
IntelBot as an authenticated API to uRent, with per-department instruction
profiles) point in the same direction. The PWA's `lib/agent.ts` + connectors +
custom-instructions work could become the reference implementation for Phase 15
— but Phase 15's conflict flags (separate instance, uRent's own keys/caps, same
sensitivity gate, no standing Ross dependency) still apply.
