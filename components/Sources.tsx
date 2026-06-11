"use client";

import { useState } from "react";

// Clean Sources UI (master spec 2026-06-11): grouped, deduplicated source
// cards below the answer — replacing the raw engines/notes/URL debug dump.
// KB cards keep their [n] citation labels so inline [n] markers in the answer
// map to a card. The raw debug trace renders only in DebugTracePanel, which
// the UI shows solely when developer debug mode is enabled in Settings.

export type KbSource = { n: number; file: string; heading: string };

const MAX_VISIBLE = 5;

// "Folder/Note Name.md" → "Note Name" ; keep it human-readable, hide paths.
function cleanFileTitle(file: string): string {
  const base = file.split("/").pop() || file;
  return base.replace(/\.(md|markdown|pdf|txt|csv|json|html?|ya?ml|canvas|base|log)$/i, "");
}

function urlLabel(url: string): { domain: string; path: string } {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).replace(/\/$/, "");
    return { domain: u.hostname.replace(/^www\./, ""), path: path.length > 1 ? path.slice(0, 60) : "" };
  } catch {
    return { domain: url.slice(0, 60), path: "" };
  }
}

function TypeBadge({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded bg-[var(--hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted)]">
      {label}
    </span>
  );
}

export default function Sources({ kb, web }: { kb: KbSource[]; web: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(true);

  // Deduplicate: KB by file (keep best-ranked = first), web by URL.
  const kbSeen = new Set<string>();
  const kbCards = kb.filter((s) => (kbSeen.has(s.file) ? false : (kbSeen.add(s.file), true)));
  const webCards = [...new Set(web)];

  const total = kbCards.length + webCards.length;
  if (!total) return null;

  // Knowledge base first (primary source), then web.
  const all: { key: string; card: React.ReactNode }[] = [
    ...kbCards.map((s) => ({
      key: `kb-${s.file}`,
      card: (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5">
          <span className="shrink-0 text-[10px] font-mono text-[var(--muted-2)]">[{s.n}]</span>
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--text)]" title={s.file}>
            {cleanFileTitle(s.file)}
            {s.heading ? <span className="text-[var(--muted-2)]"> · {s.heading}</span> : null}
          </span>
          <TypeBadge label="Knowledge base" />
        </div>
      ),
    })),
    ...webCards.map((u) => {
      const { domain, path } = urlLabel(u);
      return {
        key: `web-${u}`,
        card: (
          <a
            href={u}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 hover:border-[var(--accent)] transition-colors"
          >
            <span className="shrink-0 text-[10px]">🔗</span>
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--accent-text)]" title={u}>
              {domain}
              {path ? <span className="text-[var(--muted-2)]"> {path}</span> : null}
            </span>
            <TypeBadge label="Web" />
          </a>
        ),
      };
    }),
  ];

  const visible = expanded ? all : all.slice(0, MAX_VISIBLE);

  return (
    <div className="mt-2 w-full max-w-full">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors"
      >
        <span className="text-[10px]">{open ? "▾" : "▸"}</span> Sources
        <span className="text-[var(--muted-2)]">({total})</span>
      </button>
      {open && (
        <div className="ib-pop mt-1.5 grid gap-1.5 sm:grid-cols-2">
          {visible.map((v) => (
            <div key={v.key}>{v.card}</div>
          ))}
          {all.length > MAX_VISIBLE && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="rounded-lg border border-dashed border-[var(--border-2)] px-2.5 py-1.5 text-left text-xs text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors"
            >
              {expanded ? "Show fewer" : `Show ${all.length - MAX_VISIBLE} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Developer-only trace panel — collapsed monospace block, rendered only when
// debug mode is enabled in Settings & Connectors.
export function DebugTracePanel({ trace }: { trace: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5 w-full max-w-full">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[10px] text-[var(--muted-2)] hover:text-[var(--muted)] transition-colors"
      >
        <span>{open ? "▾" : "▸"}</span> Debug trace
      </button>
      {open && (
        <div className="ib-pop mt-1 max-w-[90%] rounded-md bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-[10px] font-mono text-[var(--muted)] whitespace-pre-wrap break-all">
          {trace}
        </div>
      )}
    </div>
  );
}
