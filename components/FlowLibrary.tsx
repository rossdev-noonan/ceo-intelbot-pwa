"use client";

import { useRef, useState } from "react";
import {
  FLOW_CATEGORIES,
  FLOW_KNOWLEDGE_MAX,
  FLOW_DOC_MAX,
  defaultFlow,
  firstGraphemes,
  type Flow,
} from "@/lib/uiTypes";

// FLOW Library — browse, search and manage FLOWs (specialist assistants).
// Sharing today = export/import JSON (single-user app); Market = Soon.

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Accept either a single exported FLOW or an array; sanitise into Flow shape.
// Imported files are foreign data — every field is type-checked AND bounded
// (lengths, counts, ranges) so a crafted .flow.json can't blow localStorage
// or smuggle oversized prompt content.
const MAX_FLOWS_PER_IMPORT = 20;
const str = (v: unknown, fallback: string, max: number): string =>
  typeof v === "string" ? v.slice(0, max) : fallback;

function parseImported(json: unknown): Omit<Flow, "id" | "createdAt" | "updatedAt">[] {
  const items = (Array.isArray(json) ? json : [json]).slice(0, MAX_FLOWS_PER_IMPORT);
  const base = defaultFlow();
  return items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => {
      const engine: Flow["engine"] =
        x.engine === "team" || x.engine === "agent" || x.engine === "hybrid" ? (x.engine as Flow["engine"]) : "auto";
      const depth: Flow["depth"] =
        x.depth === "auto" || x.depth === "instant" || x.depth === "thinking" || x.depth === "pro"
          ? (x.depth as Flow["depth"])
          : "default";
      let knowledgeBudget = FLOW_KNOWLEDGE_MAX;
      const knowledge = (Array.isArray(x.knowledge) ? x.knowledge : [])
        .filter(
          (k): k is { name: string; text: string } =>
            !!k &&
            typeof k === "object" &&
            typeof (k as Record<string, unknown>).name === "string" &&
            typeof (k as Record<string, unknown>).text === "string"
        )
        .map((k) => {
          const text = k.text.slice(0, Math.max(0, Math.min(FLOW_DOC_MAX, knowledgeBudget)));
          knowledgeBudget -= text.length;
          return { name: k.name.slice(0, 200), text };
        })
        .filter((k) => k.text.length > 0);
      return {
        ...base,
        name: str(x.name, "", 100),
        description: str(x.description, base.description, 300),
        icon: typeof x.icon === "string" ? firstGraphemes(x.icon, 2) : base.icon,
        category: FLOW_CATEGORIES.includes(str(x.category, "", 50)) ? (x.category as string) : base.category,
        role: str(x.role, base.role, 2000),
        goal: str(x.goal, base.goal, 2000),
        rules: str(x.rules, base.rules, 4000),
        tone: str(x.tone, base.tone, 100),
        outputFormat: str(x.outputFormat, base.outputFormat, 100),
        avoid: str(x.avoid, "", 2000),
        knowledge,
        webSearch: typeof x.webSearch === "boolean" ? x.webSearch : base.webSearch,
        vaultDepth:
          typeof x.vaultDepth === "number" && Number.isFinite(x.vaultDepth)
            ? Math.max(0, Math.min(16, Math.round(x.vaultDepth)))
            : base.vaultDepth,
        engine,
        depth,
      };
    })
    .filter((f) => f.name.trim());
}

export default function FlowLibrary({
  flows,
  setFlows,
  onRun,
  onEdit,
  onCreate,
  onDelete,
  onClose,
}: {
  flows: Flow[];
  setFlows: React.Dispatch<React.SetStateAction<Flow[]>>;
  onRun: (flow: Flow) => void;
  onEdit: (flow: Flow) => void;
  onCreate: () => void;
  onDelete: (flow: Flow) => void; // page-level: also detaches the flow from its chats
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const importRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const visible = flows
    .filter((f) => category === "All" || f.category === category)
    .filter(
      (f) =>
        !q ||
        f.name.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

  function duplicate(f: Flow) {
    const copy: Flow = { ...f, id: uid(), name: `${f.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
    setFlows((prev) => [copy, ...prev]);
  }

  function remove(f: Flow) {
    if (!confirm(`Delete FLOW "${f.name}"? Chats that used it keep their history.`)) return;
    onDelete(f);
  }

  function exportFlow(f: Flow) {
    const data = { ...f } as Partial<Flow>;
    delete data.id; // ids are device-local
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${f.name.replace(/[^\w\- ]+/g, "").trim() || "flow"}.flow.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = parseImported(JSON.parse(await file.text()));
      if (!parsed.length) {
        alert("That file doesn't contain a valid FLOW.");
        return;
      }
      const now = Date.now();
      setFlows((prev) => [...parsed.map((p) => ({ ...p, id: uid(), createdAt: now, updatedAt: now })), ...prev]);
    } catch {
      alert("Couldn't read that file — it must be a .flow.json export.");
    }
  }

  return (
    <div className="ib-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="ib-pop flex w-full max-w-3xl max-h-[88vh] flex-col rounded-2xl bg-[var(--panel)] border border-[var(--border-2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-5 py-3">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">⚡ FLOW Library</h2>
          <span className="text-xs text-[var(--muted-2)]">specialist assistants built for mastery</span>
          <div className="ml-auto flex items-center gap-2">
            <input ref={importRef} type="file" hidden accept=".json,application/json" onChange={onImport} />
            <button
              onClick={() => importRef.current?.click()}
              className="rounded-lg border border-[var(--border-2)] px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] transition-colors"
            >
              ⬆ Import
            </button>
            <button
              onClick={onCreate}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
            >
              + Create FLOW
            </button>
            <button onClick={onClose} className="ml-1 text-xl leading-none text-[var(--muted-2)] hover:text-[var(--text)]">
              ✕
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search FLOWs…"
            className="w-56 rounded-lg bg-[var(--surface)] border border-[var(--border-2)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <div className="flex flex-wrap gap-1">
            {["All", ...FLOW_CATEGORIES].map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  category === c
                    ? "bg-[var(--user-bubble)] text-white"
                    : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-2)]">
              {flows.length === 0 ? (
                <>
                  <div className="mb-2 text-3xl">⚡</div>
                  No FLOWs yet. A FLOW is a specialist AI assistant built for one task — arrears letters, lease
                  reviews, listing copy…
                  <div className="mt-3">
                    <button onClick={onCreate} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">
                      Create your first FLOW
                    </button>
                  </div>
                </>
              ) : (
                "No FLOWs match your search."
              )}
            </div>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {visible.map((f) => (
                <div
                  key={f.id}
                  className="group flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--accent)]"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-2xl leading-none">{f.icon || "⚡"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[var(--text-strong)]">{f.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--muted-2)]">
                        <span className="rounded bg-[var(--hover)] px-1.5 py-0.5">{f.category}</span>
                        {f.knowledge.length > 0 && <span>📄 {f.knowledge.length}</span>}
                        {f.engine !== "auto" && <span className="uppercase">{f.engine}</span>}
                      </div>
                    </div>
                  </div>
                  <p className="mt-1.5 line-clamp-2 min-h-[2rem] text-xs text-[var(--muted)]">{f.description}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      onClick={() => onRun(f)}
                      className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
                    >
                      Run FLOW
                    </button>
                    <button
                      onClick={() => onEdit(f)}
                      className="rounded-lg border border-[var(--border-2)] px-2.5 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] transition-colors"
                    >
                      Edit
                    </button>
                    <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => duplicate(f)} title="Duplicate" className="rounded p-1 text-xs text-[var(--muted-2)] hover:text-[var(--text)]">
                        ⧉
                      </button>
                      <button onClick={() => exportFlow(f)} title="Export (share)" className="rounded p-1 text-xs text-[var(--muted-2)] hover:text-[var(--text)]">
                        ⬇
                      </button>
                      <button onClick={() => remove(f)} title="Delete" className="rounded p-1 text-xs text-[var(--muted-2)] hover:text-[var(--danger)]">
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] px-5 py-2 text-center text-[10px] text-[var(--muted-2)]">
          FLOWs are private to this device. Share with Export / Import. Team sharing &amp; FLOW Market — Soon.
        </div>
      </div>
    </div>
  );
}
