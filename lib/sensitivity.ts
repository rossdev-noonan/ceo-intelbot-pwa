// Pre-LLM data-boundary gate (spec C1 / node 3_sensitivity_check).
// Runs WITHOUT calling any model. Refuses inputs that look like they carry
// client PII, financial identifiers, or material non-public information —
// because every question transits external LLM providers.
//
// Design goal: HIGH PRECISION. It targets identifiers and explicit MNPI
// markers, NOT sensitive topics. Asking about domestic-violence lease exits,
// arrears, or child-safety procedures is legitimate and must NOT be blocked;
// pasting a tenant's TFN or credit-card number must be.

export type SensitivityResult = { blocked: boolean; categories: string[] };

function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function checkSensitivity(text: string): SensitivityResult {
  const categories = new Set<string>();
  const t = text || "";

  // Credit/debit card numbers: 13-19 digit runs that pass the Luhn checksum.
  for (const m of t.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    if (luhnValid(m[0].replace(/\D/g, ""))) {
      categories.add("a card number");
      break;
    }
  }

  // Explicit financial / identity identifiers (keyword-anchored to avoid
  // false positives on ordinary numbers).
  if (/\b(tax file number|\btfn\b|medicare (number|card)|passport (number|no)\b|driver'?s? licen[cs]e (number|no)|bank account (number|details)|\bbsb\b|\bcvv\b|sort code|routing number)\b/i.test(t)) {
    categories.add("personal/financial identifiers");
  }

  // Date of birth paired with an actual date.
  if (/\b(date of birth|d\.?o\.?b\.?)\b/i.test(t) && /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(t)) {
    categories.add("a date of birth");
  }

  // Material non-public / confidential-deal markers.
  if (/\b(insider information|material non[- ]?public|\bmnpi\b|non[- ]?public information|under (an? )?nda|confidential deal)\b/i.test(t)) {
    categories.add("material non-public information");
  }

  return { blocked: categories.size > 0, categories: [...categories] };
}

export function sensitivityRefusal(categories: string[]): string {
  const what = categories.length ? categories.join(", ") : "sensitive personal or confidential information";
  return (
    `🔒 I can't process that — it looks like it may contain ${what}.\n\n` +
    "IntelBot sends questions to external AI providers (OpenAI, Anthropic, Perplexity), so questions must stay **public and non-identifiable** — no client PII, account or card numbers, dates of birth, or material non-public information.\n\n" +
    "Please remove the identifying details, or ask the same question in general / aggregate terms (e.g. describe the situation without the person's identifiers)."
  );
}
