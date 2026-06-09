// Client-safe shared types for Projects + Connectors. Kept separate from
// lib/brain.ts so client components don't pull server-only deps (fs, pdf-parse).

export type Connectors = { web: boolean; fetch: boolean; vaultDepth: number };
export type Settings = { globalInstructions: string; connectors: Connectors };
export type Project = { id: string; name: string; instructions: string };

export const DEFAULT_CONNECTORS: Connectors = { web: true, fetch: true, vaultDepth: 8 };
export const DEFAULT_SETTINGS: Settings = { globalInstructions: "", connectors: DEFAULT_CONNECTORS };

// External connectors planned but not yet wired — shown as disabled in the panel.
export const PLANNED_CONNECTORS = [
  { id: "gdrive", name: "Google Drive", icon: "📁" },
  { id: "gmail", name: "Gmail", icon: "✉️" },
  { id: "outlook", name: "Outlook / SharePoint", icon: "📨" },
  { id: "notion", name: "Notion", icon: "🗂️" },
];
