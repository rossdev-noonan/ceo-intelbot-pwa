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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-[#0d1622] border border-[#23344a] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#e6eefb]">
            {isNew ? "New project" : "Project settings"}
          </h2>
          <button onClick={onClose} className="text-[#6b7d94] hover:text-[#cdd9e8] text-xl leading-none">
            ✕
          </button>
        </div>

        <label className="block text-sm font-medium text-[#cdd9e8] mb-1">Project name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Arrears, Legal, New Business"
          className="w-full rounded-lg bg-[#0f1825] border border-[#2a3a52] px-3 py-2 text-sm outline-none focus:border-[#4a90d9] mb-4"
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />

        <label className="block text-sm font-medium text-[#cdd9e8] mb-1">Project instructions</label>
        <p className="text-xs text-[#6b7d94] mb-2">
          Added on top of your global instructions for every chat in this project.
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={5}
          placeholder="e.g. Focus on NSW residential tenancy arrears. Always reference the Arrears process note and quote the day-count thresholds."
          className="w-full resize-y rounded-lg bg-[#0f1825] border border-[#2a3a52] px-3 py-2 text-sm outline-none focus:border-[#4a90d9] mb-4"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#2a3a52] px-3 py-2 text-sm text-[#8aa0bb] hover:bg-[#13202f]"
          >
            Cancel
          </button>
          <button onClick={save} className="rounded-lg bg-[#2b6fb3] px-4 py-2 text-sm font-medium hover:bg-[#357ec7]">
            {isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
