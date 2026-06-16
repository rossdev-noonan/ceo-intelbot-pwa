// Conversation Mode Router (master spec 2026-06-11). Runs BEFORE any model,
// retrieval or orchestration call. Decides whether the latest message needs
// the full Teams/Agents/Hybrid machinery, or can be answered cheaply from the
// existing conversation (Direct Follow-Up Mode), optionally with a narrow web
// check. Deterministic heuristics — no model call, so routing itself is free.
//
// Bias: when unsure, run FULL orchestration. A wrong "full" costs money; a
// wrong "followup" costs answer quality — quality wins ties.

export type RoutePath = "full" | "followup" | "followup_web";
export type RouteDecision = { path: RoutePath; reason: string };

type Turn = { role: string; content: string };

// Explicit requests for the heavy machinery — always honour them.
const EXPLICIT_FULL =
  /\b(use (the )?(teams?|agents?|hybrid)|run (the )?(full|complete) (workflow|pipeline|procedure)|deep research|re-?run|run it again|research (this|that|it|again)|full analysis|multi[- ]model|compare (the )?models)\b/i;

// Signals the answer depends on CURRENT external facts → narrow web check.
const FRESHNESS =
  /\b(latest|current(ly)?|today|this (week|month|year)|right now|up[- ]to[- ]date|still (accurate|current|valid|true)|recent(ly)?|news|verify (this|that|it|online)|fact[- ]?check|price[sd]? (now|today)|202[6-9])\b/i;

// Transform/clarify verbs that operate on the PREVIOUS answer.
const TRANSFORM =
  /^(please |can you |could you |now |ok(ay)?,? )*(make (it|that|this)|shorten|summari[sz]e|condense|expand|lengthen|reword|rewrite|rephrase|simplify|clarify|explain (that|this|it|the|why|how)|translate|convert|turn (this|that|it)|format|combine|merge|mix|add|remove|drop|fix|tweak|adjust|change|update|polish|tighten|bullet|tabulate|list (them|those|it)|continue|keep going|go on|finish|complete (it|that|the))\b/i;

// References to prior content ("that", "the last yaml", "above", …).
const PRIOR_REF =
  /\b(that|this|it|those|these|the (previous|last|earlier|above) (answer|response|yaml|table|list|section|message|output|version|one)|previous answer|last (answer|response|yaml|one)|above|earlier|same as before|what you (wrote|said|made|gave))\b/i;

// Topics that need the internal knowledge base → full orchestration.
const NEEDS_KB =
  /\b(our|noonan'?s?|the (vault|knowledge base)|internal|company|office) (process|policy|procedure|workflow|notes?|documents?|training|checklist|template)|\bvault\b|knowledge base/i;

export function routeMessage(
  message: string,
  history: Turn[] | undefined,
  opts: { hasAttachments: boolean; hasImages: boolean }
): RouteDecision {
  const text = message.trim();
  const hasPriorAnswer = !!history?.some((t) => t.role === "assistant" && t.content.trim().length > 0);

  // No cached conversation state → nothing to follow up on.
  if (!hasPriorAnswer) return { path: "full", reason: "no previous answer state" };

  // New material always gets the full treatment.
  if (opts.hasAttachments || opts.hasImages) return { path: "full", reason: "new attachment/image uploaded" };

  // The user asked for the machinery by name.
  if (EXPLICIT_FULL.test(text)) return { path: "full", reason: "explicit full-orchestration request" };

  // Internal-knowledge questions need retrieval, not cache.
  if (NEEDS_KB.test(text)) return { path: "full", reason: "needs knowledge-base retrieval" };

  // Long messages are new briefs/documents, not follow-ups.
  if (text.length > 600) return { path: "full", reason: "long message — treated as a new task" };

  // Quality-first: only TRUE transforms of prior content ("shorten that",
  // "make it a table") ride the cheap path. A substantive question — even a
  // short one — gets the full machinery (models + web + vault), never the cheap
  // cached path. We never route below the single-LLM baseline to save tokens.
  const looksLikeFollowup = TRANSFORM.test(text) || (PRIOR_REF.test(text) && text.length <= 400);
  if (!looksLikeFollowup) return { path: "full", reason: "not a pure transform — full machinery" };

  if (FRESHNESS.test(text)) {
    return { path: "followup_web", reason: "follow-up needing a narrow current-data check" };
  }
  return { path: "followup", reason: "follow-up answerable from cached conversation state" };
}
