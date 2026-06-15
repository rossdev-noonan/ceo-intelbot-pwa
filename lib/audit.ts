// Append-only, tamper-evident audit log (IntelBot protocol: security/audit).
//
// One JSON line per answered (or blocked) question. Per the data-boundary rule
// the QUESTION is stored only as a SHA-256 hash; the synthesised ANSWER is
// stored in clear. Each record carries the hash of the previous record + itself
// (a hash chain), so any later edit/deletion breaks verification.
//
// Writes are best-effort and fully swallowed: a logging failure must NEVER break
// a live answer. Lands on the persistent volume (same disk as the vault mirror).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function auditDir(): string {
  return process.env.AUDIT_DIR || path.join(process.cwd(), ".vaultcache", "audit");
}
function auditFile(): string {
  return path.join(auditDir(), "audit.jsonl");
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export type AuditInput = {
  user: string; // signed-in email, or "local-dev"
  question: string; // hashed before storage — never persisted in clear
  answer: string; // synthesis, stored in clear
  mode: string; // team | agent | hybrid | followup | continue | blocked
  route?: string; // router path / reason / block categories
  engines?: string; // which models actually ran
  sources?: number; // count of grounded sources
  totalMs?: number;
};

export type AuditRecord = {
  ts: string;
  user: string;
  mode: string;
  route?: string;
  questionHash: string;
  questionChars: number;
  answerChars: number;
  answer: string;
  engines?: string;
  sources?: number;
  totalMs?: number;
  prev: string; // hash of the previous record (chain link)
  h: string; // sha256(prev + canonical record)
};

// Last record's chain hash, so the next record links to it.
function lastHash(): string {
  try {
    const data = fs.readFileSync(auditFile(), "utf8").trimEnd();
    if (!data) return "";
    const line = data.slice(data.lastIndexOf("\n") + 1);
    return (JSON.parse(line) as AuditRecord).h || "";
  } catch {
    return "";
  }
}

// ISO timestamp without relying on Date.now in a way that complicates testing.
function nowIso(): string {
  return new Date().toISOString();
}

export function logAudit(e: AuditInput): void {
  try {
    fs.mkdirSync(auditDir(), { recursive: true });
    const base = {
      ts: nowIso(),
      user: e.user || "unknown",
      mode: e.mode,
      route: e.route,
      questionHash: sha256(e.question),
      questionChars: e.question.length,
      answerChars: e.answer.length,
      answer: e.answer,
      engines: e.engines,
      sources: e.sources,
      totalMs: e.totalMs,
    };
    const prev = lastHash();
    const h = sha256(prev + JSON.stringify(base));
    const record: AuditRecord = { ...base, prev, h };
    fs.appendFileSync(auditFile(), JSON.stringify(record) + "\n");
  } catch {
    // Audit must never break the answer path.
  }
}

// Read the most recent records (newest first). Question text is not stored, so
// this is safe to surface in an admin view — only hashes + the clear answer.
export function readAudit(limit = 100): AuditRecord[] {
  try {
    const lines = fs.readFileSync(auditFile(), "utf8").trim().split("\n").filter(Boolean);
    const recs = lines.map((l) => JSON.parse(l) as AuditRecord);
    return recs.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// Re-walk the chain and confirm no record was altered or removed.
export function verifyChain(): { ok: boolean; count: number; brokenAt?: number } {
  try {
    const lines = fs.readFileSync(auditFile(), "utf8").trim().split("\n").filter(Boolean);
    let prev = "";
    for (let i = 0; i < lines.length; i++) {
      const rec = JSON.parse(lines[i]) as AuditRecord;
      const { prev: _p, h: _h, ...base } = rec;
      const expected = sha256(prev + JSON.stringify(base));
      if (rec.prev !== prev || rec.h !== expected) {
        return { ok: false, count: lines.length, brokenAt: i };
      }
      prev = rec.h;
    }
    return { ok: true, count: lines.length };
  } catch {
    return { ok: true, count: 0 };
  }
}
