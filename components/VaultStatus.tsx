"use client";

import { useEffect, useState } from "react";

type Status = { configured?: boolean; lastSync?: string | null; fileCount?: number };

// Shows whether IntelBot is connected to the Noonan vault and prompts a sync if
// nothing is loaded yet. A hosted web app can't read a local Obsidian folder
// directly — the vault reaches it through SharePoint (Obsidian ↔ OneDrive ↔
// SharePoint ↔ app) — so this is the honest "are we connected to your notes"
// signal, and the button loads/refreshes that content.
export default function VaultStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const load = async () => {
    try {
      const r = await fetch("/api/sync");
      setStatus((await r.json()) as Status);
    } catch {
      setStatus(null);
    }
  };
  // Fetch status on mount. setState runs in the .then callback (after the fetch
  // resolves), not synchronously in the effect body.
  useEffect(() => {
    let active = true;
    fetch("/api/sync")
      .then((r) => r.json())
      .then((j) => {
        if (active) setStatus(j as Status);
      })
      .catch(() => {
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  // Hidden when SharePoint isn't configured (local dev) or after the user
  // dismisses the connected confirmation.
  if (!status?.configured || dismissed) return null;

  const files = status.fileCount ?? 0;

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await fetch("/api/sync", { method: "POST" });
      const j = await r.json();
      if (j.ok) await load();
    } finally {
      setSyncing(false);
    }
  };

  if (files > 0) {
    return (
      <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
        <span>✓ Connected to your vault · {files} notes synced from SharePoint / Obsidian</span>
        <button
          onClick={() => setDismissed(true)}
          className="ml-auto text-emerald-300/60 hover:text-emerald-200"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="mx-3 mt-2 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
      <span className="flex-1">
        Your knowledge base isn&apos;t loaded yet — connect it so IntelBot can answer from your
        Obsidian / SharePoint notes instead of generic info.
      </span>
      <button
        onClick={syncNow}
        disabled={syncing}
        className={`shrink-0 rounded-md px-3 py-1.5 font-medium text-white transition-colors ${
          syncing ? "bg-amber-700/60 cursor-not-allowed" : "bg-amber-600 hover:bg-amber-500"
        }`}
      >
        {syncing ? "Connecting…" : "Connect / Sync now"}
      </button>
    </div>
  );
}
