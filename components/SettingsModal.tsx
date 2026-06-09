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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-[#0d1622] border border-[#23344a] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#e6eefb]">Settings &amp; Connectors</h2>
          <button onClick={onClose} className="text-[#6b7d94] hover:text-[#cdd9e8] text-xl leading-none">
            ✕
          </button>
        </div>

        {/* Global custom instructions */}
        <section className="mb-5">
          <label className="block text-sm font-medium text-[#cdd9e8] mb-1">
            Global custom instructions
          </label>
          <p className="text-xs text-[#6b7d94] mb-2">
            Applied to every chat in every project (e.g. tone, defaults, what to always include).
          </p>
          <textarea
            value={draft.globalInstructions}
            onChange={(e) => setDraft({ ...draft, globalInstructions: e.target.value })}
            rows={4}
            placeholder="e.g. Always answer for NSW. Be concise and practical. Cite legislation by name."
            className="w-full resize-y rounded-lg bg-[#0f1825] border border-[#2a3a52] px-3 py-2 text-sm outline-none focus:border-[#4a90d9]"
          />
        </section>

        {/* Built-in connectors */}
        <section className="mb-5">
          <h3 className="text-sm font-medium text-[#cdd9e8] mb-2">Connectors (Agent mode tools)</h3>
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
              desc="Live web research via Perplexity (current law, market data)."
              checked={c.web}
              onChange={(v) => setConn({ web: v })}
            />
            <ToggleRow
              label="📄 Fetch web page"
              desc="Let the agent open and read a specific URL it finds."
              checked={c.fetch}
              onChange={(v) => setConn({ fetch: v })}
            />
          </div>

          <div className="mt-4">
            <label className="block text-sm text-[#cdd9e8] mb-1">
              Knowledge-base depth: <span className="font-mono text-[#8aa0bb]">{c.vaultDepth}</span> excerpts
            </label>
            <input
              type="range"
              min={4}
              max={16}
              step={1}
              value={c.vaultDepth}
              onChange={(e) => setConn({ vaultDepth: Number(e.target.value) })}
              className="w-full accent-[#2b6fb3]"
            />
            <p className="text-xs text-[#6b7d94]">
              More excerpts = deeper grounding but slower / more tokens.
            </p>
          </div>
        </section>

        {/* Planned external connectors (stubs) */}
        <section className="mb-5">
          <h3 className="text-sm font-medium text-[#cdd9e8] mb-2">
            External connectors <span className="text-xs text-[#6b7d94]">(coming soon)</span>
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {PLANNED_CONNECTORS.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-lg border border-[#1c2838] bg-[#0b121c] px-3 py-2 text-sm text-[#5b6b80]"
              >
                <span>{p.icon}</span>
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-[10px] rounded bg-[#16263a] px-1.5 py-0.5 text-[#7a8da3]">Soon</span>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#2a3a52] px-3 py-2 text-sm text-[#8aa0bb] hover:bg-[#13202f]"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="rounded-lg bg-[#2b6fb3] px-4 py-2 text-sm font-medium hover:bg-[#357ec7]"
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
    <div className="flex items-start justify-between gap-3 rounded-lg border border-[#1c2838] bg-[#0f1825] px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm text-[#cdd9e8]">{label}</div>
        <div className="text-xs text-[#6b7d94]">{desc}</div>
      </div>
      <button
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-[#2b6fb3]" : "bg-[#2a3a52]"
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
