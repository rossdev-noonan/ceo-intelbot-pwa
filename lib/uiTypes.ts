// Client-safe shared types for Projects + Connectors. Kept separate from
// lib/brain.ts so client components don't pull server-only deps (fs, pdf-parse).

export type Connectors = { web: boolean; fetch: boolean; vaultDepth: number };
export type Depth = "auto" | "instant" | "thinking" | "pro";
export type Settings = { globalInstructions: string; connectors: Connectors; depth: Depth };
export type Project = { id: string; name: string; instructions: string };

export const DEFAULT_CONNECTORS: Connectors = { web: true, fetch: true, vaultDepth: 8 };
export const DEFAULT_SETTINGS: Settings = {
  globalInstructions: "",
  connectors: DEFAULT_CONNECTORS,
  depth: "auto",
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
