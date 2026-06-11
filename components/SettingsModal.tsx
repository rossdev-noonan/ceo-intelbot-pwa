"use client";

import { useState } from "react";
import { PLANNED_CONNECTORS, type Settings } from "@/lib/uiTypes";

export default function SettingsModal({
  settings,
  onSave,
  onClose,
}: {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const c = draft.connectors;
  const setConn = (patch: Partial<typeof c>) =>
    setDraft({ ...draft, connectors: { ...c, ...patch } });

  return (
    <div
      className="ib-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="ib-pop w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-[var(--panel)] border border-[var(--border-2)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">Settings &amp; Connectors</h2>
          <button onClick={onClose} className="text-[var(--muted-2)] hover:text-[var(--text)] text-xl leading-none">
            ✕
          </button>
        </div>

        {/* Global custom instructions */}
        <section className="mb-5">
          <label className="block text-sm font-medium text-[var(--text)] mb-1">
            Global custom instructions
          </label>
          <p className="text-xs text-[var(--muted-2)] mb-2">
            Applied to every chat in every project (e.g. tone, defaults, what to always include).
          </p>
          <textarea
            value={draft.globalInstructions}
            onChange={(e) => setDraft({ ...draft, globalInstructions: e.target.value })}
            rows={4}
            placeholder="e.g. Always answer for NSW. Be concise and practical. Cite legislation by name."
            className="w-full resize-y rounded-lg bg-[var(--surface)] border border-[var(--border-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </section>

        {/* Built-in connectors */}
        <section className="mb-5">
          <h3 className="text-sm font-medium text-[var(--text)] mb-2">Connectors (Agent mode tools)</h3>
          <div className="space-y-2">
            <ToggleRow
              label="🔎 Knowledge base"
              desc="Search Mike's Obsidian vault. Always on — the primary source."
              checked
              disabled
              onChange={() => {}}
            />
            <ToggleRow
              label="🌐 Web search"
              desc="Live web research via Perplexity — competitors, companies, market data, current law."
              checked={c.web}
              onChange={(v) => setConn({ web: v })}
            />
            <ToggleRow
              label="📄 Fetch web page"
              desc="Let the agent open and read any URL — including competitor websites."
              checked={c.fetch}
              onChange={(v) => setConn({ fetch: v })}
            />
          </div>

          <div className="mt-4">
            <label className="block text-sm text-[var(--text)] mb-1">
              Knowledge-base depth: <span className="font-mono text-[var(--muted)]">{c.vaultDepth}</span> excerpts
            </label>
            <input
              type="range"
              min={4}
              max={16}
              step={1}
              value={c.vaultDepth}
              onChange={(e) => setConn({ vaultDepth: Number(e.target.value) })}
              className="w-full accent-[var(--accent)]"
            />
            <p className="text-xs text-[var(--muted-2)]">
              More excerpts = deeper grounding but slower / more tokens.
            </p>
          </div>
        </section>

        {/* Planned external connectors (stubs) */}
        <section className="mb-5">
          <h3 className="text-sm font-medium text-[var(--text)] mb-2">
            External connectors <span className="text-xs text-[var(--muted-2)]">(coming soon)</span>
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {PLANNED_CONNECTORS.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--muted-2)]"
              >
                <span>{p.icon}</span>
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-[10px] rounded bg-[var(--hover)] px-1.5 py-0.5 text-[var(--muted)]">Soon</span>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border-2)] px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium hover:bg-[var(--accent-hover)]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm text-[var(--text)]">{label}</div>
        <div className="text-xs text-[var(--muted-2)]">{desc}</div>
      </div>
      <button
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-[var(--accent)]" : "bg-[var(--border-2)]"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        aria-pressed={checked}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
