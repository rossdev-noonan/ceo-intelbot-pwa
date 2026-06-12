// Client-safe shared types for Projects + Connectors. Kept separate from
// lib/brain.ts so client components don't pull server-only deps (fs, pdf-parse).

export type Connectors = { web: boolean; fetch: boolean; vaultDepth: number };
export type Depth = "auto" | "instant" | "thinking" | "pro";
export type Settings = {
  globalInstructions: string;
  connectors: Connectors;
  depth: Depth;
  // Developer debug mode: shows engine traces, timings and router decisions
  // under each answer. Hidden for normal use — sources get their own clean UI.
  debugMode: boolean;
};
export type Project = { id: string; name: string; instructions: string };

export const DEFAULT_CONNECTORS: Connectors = { web: true, fetch: true, vaultDepth: 8 };
export const DEFAULT_SETTINGS: Settings = {
  globalInstructions: "",
  connectors: DEFAULT_CONNECTORS,
  depth: "auto",
  debugMode: false,
};

// Reasoning-depth options for the header selector.
export const DEPTHS: { id: Depth; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Picks the right models for the question's complexity — cheap for simple, full power for complex. Saves cost." },
  { id: "instant", label: "Instant", hint: "Force fast, light reasoning — quick questions." },
  { id: "thinking", label: "Thinking", hint: "Force deep reasoning (extended thinking) on the full 3-model fan-out." },
  { id: "pro", label: "Pro", hint: "Force maximum reasoning (xhigh) on the full fan-out — most rigorous, slowest, most expensive." },
];

// External connectors planned but not yet wired — shown as disabled in the panel.
export const PLANNED_CONNECTORS = [
  { id: "gdrive", name: "Google Drive", icon: "📁" },
  { id: "gmail", name: "Gmail", icon: "✉️" },
  { id: "outlook", name: "Outlook / SharePoint", icon: "📨" },
  { id: "notion", name: "Notion", icon: "🗂️" },
];

// ---- FLOWs: IntelBot's custom AI assistants (GPTs parity) ------------------
// A FLOW is a specialist assistant built for one task/role/workflow. Stored in
// localStorage (intelbot_flows_v1); shared by exporting/importing JSON.

export type FlowKnowledgeDoc = { name: string; text: string };

export type Flow = {
  id: string;
  // identity
  name: string;
  description: string;
  icon: string; // emoji
  category: string;
  // instructions
  role: string;
  goal: string;
  rules: string; // one per line
  tone: string;
  outputFormat: string;
  avoid: string;
  // knowledge (extracted text, capped — see FLOW_KNOWLEDGE_MAX)
  knowledge: FlowKnowledgeDoc[];
  // tools
  webSearch: boolean;
  vaultDepth: number;
  engine: "auto" | "team" | "agent" | "hybrid"; // auto = whatever the header toggle says
  depth: "default" | Depth; // default = whatever the header selector says
  createdAt: number;
  updatedAt: number;
};

export const FLOW_CATEGORIES = [
  "General",
  "Property Management",
  "Legal & Compliance",
  "Sales & Marketing",
  "Finance",
  "Operations",
  "Research",
  "Writing",
];

export const FLOW_TONES = ["professional", "friendly", "direct", "detailed", "executive-brief"];
export const FLOW_FORMATS = ["markdown", "plain text", "tables-first", "bullet summary", "step-by-step"];

// Knowledge caps per FLOW (chars) — single source of truth for the builder,
// the importer, AND the server clamp in /api/chat. Keeps localStorage and
// per-turn token cost bounded, and stops the server silently dropping content
// the builder accepted.
export const FLOW_KNOWLEDGE_MAX = 200_000; // combined across all docs
export const FLOW_DOC_MAX = 80_000; // per document

// Take the first N grapheme clusters (emoji-safe — plain slice() cuts
// surrogate pairs and ZWJ sequences like 🧑‍💻 into broken glyphs).
export function firstGraphemes(s: string, n: number): string {
  try {
    const seg = new Intl.Segmenter();
    const out: string[] = [];
    for (const g of seg.segment(s)) {
      out.push(g.segment);
      if (out.length >= n) break;
    }
    return out.join("");
  } catch {
    return Array.from(s).slice(0, n * 2).join(""); // code-point fallback
  }
}

// Spec's default_flow_template.
export function defaultFlow(): Omit<Flow, "id" | "createdAt" | "updatedAt"> {
  return {
    name: "",
    description: "A custom AI assistant for a specific task.",
    icon: "⚡",
    category: "General",
    role: "You are a specialist AI assistant inside IntelBot.",
    goal: "Help the user complete the task clearly and accurately.",
    rules: [
      "Stay focused on the FLOW's purpose.",
      "Use available knowledge when helpful.",
      "Use tools only when needed.",
      "Ask questions only when needed.",
      "Do not invent facts.",
      "Be clear when information is missing.",
    ].join("\n"),
    tone: "professional",
    outputFormat: "markdown",
    avoid: "",
    knowledge: [],
    webSearch: true,
    vaultDepth: 8,
    engine: "auto",
    depth: "default",
  };
}
