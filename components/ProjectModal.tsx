"use client";

import { useState } from "react";
import type { Project } from "@/lib/uiTypes";

export default function ProjectModal({
  project,
  isNew,
  onSave,
  onClose,
}: {
  project: Project;
  isNew: boolean;
  onSave: (p: Project) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [instructions, setInstructions] = useState(project.instructions);

  const save = () => {
    const finalName = name.trim() || "Untitled project";
    onSave({ ...project, name: finalName, instructions: instructions.trim() });
    onClose();
  };

  return (
    <div className="ib-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="ib-pop w-full max-w-lg rounded-2xl bg-[var(--panel)] border border-[var(--border-2)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">
            {isNew ? "New project" : "Project settings"}
          </h2>
          <button onClick={onClose} className="text-[var(--muted-2)] hover:text-[var(--text)] text-xl leading-none">
            ✕
          </button>
        </div>

        <label className="block text-sm font-medium text-[var(--text)] mb-1">Project name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Arrears, Legal, New Business"
          className="w-full rounded-lg bg-[var(--surface)] border border-[var(--border-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] mb-4"
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />

        <label className="block text-sm font-medium text-[var(--text)] mb-1">Project instructions</label>
        <p className="text-xs text-[var(--muted-2)] mb-2">
          Added on top of your global instructions for every chat in this project.
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={5}
          placeholder="e.g. Focus on NSW residential tenancy arrears. Always reference the Arrears process note and quote the day-count thresholds."
          className="w-full resize-y rounded-lg bg-[var(--surface)] border border-[var(--border-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] mb-4"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border-2)] px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            Cancel
          </button>
          <button onClick={save} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium hover:bg-[var(--accent-hover)]">
            {isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
