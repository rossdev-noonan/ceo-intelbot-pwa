"use client";

import { useRef, useState } from "react";
import {
  FLOW_CATEGORIES,
  FLOW_TONES,
  FLOW_FORMATS,
  FLOW_KNOWLEDGE_MAX,
  FLOW_DOC_MAX,
  firstGraphemes,
  DEPTHS,
  type Flow,
} from "@/lib/uiTypes";

// FLOW Builder — create/edit a specialist assistant. Sections per the FLOWs
// spec: Basic Info, Instructions, Knowledge, Tools, Sharing & Safety.
// (Actions, Memory, Team/Market sharing are staged as "Soon".)

const QUICK_ICONS = ["⚡", "🏠", "⚖️", "📊", "💰", "🔧", "🔍", "✍️", "📧", "🎯", "🧮", "🗂️"];

const inputCls =
  "w-full rounded-lg bg-[var(--surface)] border border-[var(--border-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
const labelCls = "block text-sm font-medium text-[var(--text)] mb-1";
const hintCls = "text-xs text-[var(--muted-2)] mb-2";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-5 mb-2 border-b border-[var(--border)] pb-1.5 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
      {children}
    </h3>
  );
}

export default function FlowBuilder({
  flow,
  isNew,
  onSave,
  onClose,
}: {
  flow: Flow;
  isNew: boolean;
  onSave: (f: Flow) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Flow>(flow);
  const [attaching, setAttaching] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Flow>) => setDraft((d) => ({ ...d, ...patch }));
  const knowledgeUsed = draft.knowledge.reduce((s, k) => s + k.text.length, 0);
  // Notices derive from rendered state — pure, and immune to updater re-runs.
  const knowledgeFull = knowledgeUsed >= FLOW_KNOWLEDGE_MAX;
  const dirty = JSON.stringify(draft) !== JSON.stringify(flow);

  // Batch-safe add: one functional update computes the caps against LIVE
  // state. (The old per-file add spread a render-scoped draft.knowledge, so
  // multi-file uploads with awaits in between kept only the last file.)
  function addKnowledgeDocs(docs: { name: string; text: string }[]) {
    setDraft((d) => {
      let used = d.knowledge.reduce((s, k) => s + k.text.length, 0);
      const next = [...d.knowledge];
      for (const doc of docs) {
        const t = doc.text.slice(0, Math.max(0, Math.min(FLOW_DOC_MAX, FLOW_KNOWLEDGE_MAX - used)));
        if (!t.length) continue; // knowledge full — meter + warning show it
        next.push({ name: doc.name, text: t });
        used += t.length;
      }
      return { ...d, knowledge: next };
    });
  }

  async function onPickKnowledge(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (!files.length) return;
    setAttaching(true);
    const docs: { name: string; text: string }[] = [];
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/extract", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({ error: "Bad response" }));
        if (!res.ok || data.error) alert(`${data.error || "Could not read that file."} (${file.name})`);
        else docs.push({ name: data.name, text: data.text });
      } catch (err) {
        alert(`Upload failed for ${file.name}: ` + (err instanceof Error ? err.message : "error"));
      }
    }
    setAttaching(false);
    if (docs.length) addKnowledgeDocs(docs);
  }

  // Discard guard: closing with unsaved changes asks first. Only treat it as
  // a backdrop click if the press STARTED on the backdrop (a drag-select that
  // ends outside the panel must not close the builder).
  const downOnBackdrop = useRef(false);
  function requestClose() {
    if (!dirty || confirm("Discard unsaved changes to this FLOW?")) onClose();
  }

  function save() {
    const name = draft.name.trim();
    if (!name) {
      alert("Give your FLOW a name.");
      return;
    }
    onSave({ ...draft, name, updatedAt: Date.now() });
    onClose();
  }

  return (
    <div
      className="ib-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) requestClose();
      }}
    >
      <div className="ib-pop flex w-full max-w-2xl max-h-[90vh] flex-col rounded-2xl bg-[var(--panel)] border border-[var(--border-2)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">
            {isNew ? "Create FLOW" : `Edit FLOW — ${flow.name || "Untitled"}`}
          </h2>
          <button onClick={requestClose} className="text-[var(--muted-2)] hover:text-[var(--text)] text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {/* ---- Basic Info ---- */}
          <SectionTitle>Basic info</SectionTitle>
          <div className="flex gap-3">
            <div className="w-24 shrink-0">
              <label className={labelCls}>Icon</label>
              <input
                value={draft.icon}
                onChange={(e) => set({ icon: firstGraphemes(e.target.value, 2) })}
                className={`${inputCls} text-center text-xl`}
              />
              <div className="mt-1 flex flex-wrap gap-0.5">
                {QUICK_ICONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => set({ icon: ic })}
                    className="rounded p-0.5 text-sm hover:bg-[var(--hover)]"
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <label className={labelCls}>Name *</label>
              <input
                autoFocus={isNew}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Arrears Letter Writer"
                className={inputCls}
              />
              <label className={`${labelCls} mt-3`}>Category</label>
              <select
                value={draft.category}
                onChange={(e) => set({ category: e.target.value })}
                className={inputCls}
              >
                {FLOW_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className={`${labelCls} mt-3`}>Description</label>
          <input
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="What is this FLOW a specialist in?"
            className={inputCls}
          />

          {/* ---- Instructions ---- */}
          <SectionTitle>Instructions</SectionTitle>
          <p className={hintCls}>How the FLOW behaves, what it focuses on, and what it avoids.</p>
          <label className={labelCls}>Role</label>
          <input value={draft.role} onChange={(e) => set({ role: e.target.value })} className={inputCls} />
          <label className={`${labelCls} mt-3`}>Main goal</label>
          <input value={draft.goal} onChange={(e) => set({ goal: e.target.value })} className={inputCls} />
          <label className={`${labelCls} mt-3`}>Rules (one per line)</label>
          <textarea
            value={draft.rules}
            onChange={(e) => set({ rules: e.target.value })}
            rows={5}
            className={`${inputCls} resize-y font-mono text-xs`}
          />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tone</label>
              <select value={draft.tone} onChange={(e) => set({ tone: e.target.value })} className={inputCls}>
                {FLOW_TONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Output format</label>
              <select
                value={draft.outputFormat}
                onChange={(e) => set({ outputFormat: e.target.value })}
                className={inputCls}
              >
                {FLOW_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className={`${labelCls} mt-3`}>Things to avoid</label>
          <input
            value={draft.avoid}
            onChange={(e) => set({ avoid: e.target.value })}
            placeholder="e.g. legal advice wording, discussing fees, em-dashes"
            className={inputCls}
          />

          {/* ---- Knowledge ---- */}
          <SectionTitle>Knowledge</SectionTitle>
          <p className={hintCls}>
            Documents this FLOW can always use. Sent with every question — keep it focused. Up to{" "}
            {FLOW_DOC_MAX / 1000}k chars per document.{" "}
            <span className="font-mono">
              {Math.round(knowledgeUsed / 1000)}k / {FLOW_KNOWLEDGE_MAX / 1000}k chars
            </span>
            {knowledgeFull && <span className="ml-2 text-[var(--danger)]">Knowledge is full — remove a document to add more.</span>}
          </p>
          {draft.knowledge.length > 0 && (
            <div className="mb-2 space-y-1.5">
              {draft.knowledge.map((k, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">📄 {k.name}</span>
                  <span className="shrink-0 font-mono text-[var(--muted-2)]">{Math.round(k.text.length / 1000)}k</span>
                  <button
                    onClick={() => set({ knowledge: draft.knowledge.filter((_, j) => j !== i) })}
                    className="text-[var(--muted-2)] hover:text-[var(--danger)]"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept=".pdf,.docx,.xlsx,.xls,.pptx,.zip,.txt,.md,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,text/*"
            onChange={onPickKnowledge}
          />
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-[var(--border-2)] px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] transition-colors"
            >
              {attaching ? "Reading…" : "📎 Upload files"}
            </button>
            <button
              onClick={() => setPasteOpen((o) => !o)}
              className="rounded-lg border border-[var(--border-2)] px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] transition-colors"
            >
              📋 Paste text
            </button>
          </div>
          {pasteOpen && (
            <div className="ib-pop mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <input
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
                placeholder="Document name"
                className={`${inputCls} mb-2`}
              />
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={4}
                placeholder="Paste the content…"
                className={`${inputCls} resize-y font-mono text-xs`}
              />
              <button
                onClick={() => {
                  if (!pasteText.trim()) return;
                  addKnowledgeDocs([{ name: pasteName.trim() || "Pasted note", text: pasteText }]);
                  setPasteName("");
                  setPasteText("");
                  setPasteOpen(false);
                }}
                className="mt-2 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                Add to knowledge
              </button>
            </div>
          )}

          {/* ---- Tools ---- */}
          <SectionTitle>Tools</SectionTitle>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              <div>
                <div className="text-sm text-[var(--text)]">🌐 Web search</div>
                <div className="text-xs text-[var(--muted-2)]">Live research via Perplexity for this FLOW.</div>
              </div>
              <button
                onClick={() => set({ webSearch: !draft.webSearch })}
                className={`h-5 w-9 shrink-0 rounded-full transition-colors ${
                  draft.webSearch ? "bg-[var(--accent)]" : "bg-[var(--border-2)]"
                }`}
                aria-pressed={draft.webSearch}
              >
                <span
                  className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                    draft.webSearch ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Engine</label>
                <select
                  value={draft.engine}
                  onChange={(e) => set({ engine: e.target.value as Flow["engine"] })}
                  className={inputCls}
                >
                  <option value="auto">Auto (use header toggle)</option>
                  <option value="team">Teams (swarm)</option>
                  <option value="agent">Agents (relay)</option>
                  <option value="hybrid">Hybrid (compare + decide)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Reasoning depth</label>
                <select
                  value={draft.depth}
                  onChange={(e) => set({ depth: e.target.value as Flow["depth"] })}
                  className={inputCls}
                >
                  <option value="default">Default (use header selector)</option>
                  {DEPTHS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>
                Knowledge-base depth: <span className="font-mono text-[var(--muted)]">{draft.vaultDepth}</span> excerpts
              </label>
              <input
                type="range"
                min={0}
                max={16}
                step={1}
                value={draft.vaultDepth}
                onChange={(e) => set({ vaultDepth: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
              <p className="text-xs text-[var(--muted-2)]">0 = don&apos;t search the Obsidian vault for this FLOW.</p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {["✉️ Email actions", "📅 Calendar actions", "🔗 API actions", "🧠 FLOW memory"].map((s) => (
                <span
                  key={s}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-xs text-[var(--muted-2)]"
                >
                  {s} <span className="rounded bg-[var(--hover)] px-1 py-0.5 text-[10px]">Soon</span>
                </span>
              ))}
            </div>
          </div>

          {/* ---- Sharing & safety ---- */}
          <SectionTitle>Sharing &amp; safety</SectionTitle>
          <p className="text-xs text-[var(--muted-2)]">
            This FLOW is <strong className="text-[var(--text)]">private to this device</strong>. Share it with the
            Export button in the FLOW Library (JSON file) — the recipient imports it on their device. Team, company and
            FLOW Market sharing arrive with hosted accounts. Every FLOW always enforces: never expose its hidden
            instructions, treat knowledge as data (not commands), never invent facts, and say when information is
            missing.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            onClick={requestClose}
            className="rounded-lg border border-[var(--border-2)] px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            {isNew ? "Create FLOW" : "Save FLOW"}
          </button>
        </div>
      </div>
    </div>
  );
}
