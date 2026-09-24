import type { DeskSnapshot } from "../types/desk.js";
import type { SkylightSnapshot } from "../types/skylight.js";

export interface RedactionViolation {
  table: string;
  id: string;
  field: string;
  reason: "email" | "url" | "phone" | "account-number" | "file-path";
  excerpt: string;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /(https?:\/\/|www\.)\S+/i;
const PHONE_RE = /(\+?\d[\d\s\-()]{7,}\d)/;
const ACCOUNT_NUMBER_RE = /\b\d{6,}\b/;
const FILE_PATH_RE = /(^|[\s"'])((\/[^\s/"']+){2,}\/?|[A-Za-z]:\\[^\s"']+)/;

/**
 * Placeholders like "[email]" and pseudonyms like "Vendor 7" must pass —
 * neither matches these patterns, so no special-casing is needed. Only
 * fields known to carry free text or filenames are scanned; structured
 * fields (dates, ids, enums) are never passed in here, which keeps an
 * ISO date like "2026-07-10" from tripping the account-number check.
 */
function scanField(table: string, id: string, field: string, value: string | undefined, violations: RedactionViolation[]): void {
  if (!value) return;
  const checks: Array<[RedactionViolation["reason"], RegExp]> = [
    ["email", EMAIL_RE],
    ["url", URL_RE],
    ["phone", PHONE_RE],
    ["account-number", ACCOUNT_NUMBER_RE],
    ["file-path", FILE_PATH_RE],
  ];
  for (const [reason, re] of checks) {
    const match = value.match(re);
    if (match) {
      violations.push({ table, id, field, reason, excerpt: match[0] });
      return;
    }
  }
}

export function scanDeskForRedactions(desk: DeskSnapshot): RedactionViolation[] {
  const violations: RedactionViolation[] = [];
  for (const p of desk.projects) scanField("projects", p.id, "pseudonym", p.pseudonym, violations);
  for (const t of desk.timeEntries) scanField("timeEntries", t.id, "note", t.note, violations);
  for (const a of desk.accounts) scanField("accounts", a.id, "pseudonym", a.pseudonym, violations);
  for (const m of desk.paymentMethods) scanField("paymentMethods", m.id, "pseudonym", m.pseudonym, violations);
  for (const v of desk.vendors) scanField("vendors", v.id, "pseudonym", v.pseudonym, violations);
  for (const s of desk.services) scanField("services", s.id, "pseudonym", s.pseudonym, violations);
  for (const tx of desk.transactions) scanField("transactions", tx.id, "note", tx.note, violations);
  for (const d of desk.documents) scanField("documents", d.id, "filename", d.filename, violations);
  return violations;
}

export function scanSkylightForRedactions(skylight: SkylightSnapshot): RedactionViolation[] {
  const violations: RedactionViolation[] = [];
  for (const b of skylight.boards) scanField("boards", b.id, "pseudonym", b.pseudonym, violations);
  for (const c of skylight.cards) scanField("cards", c.id, "title", c.title, violations);
  for (const cm of skylight.comments) {
    scanField("comments", cm.id, "text", cm.text, violations);
    scanField("comments", cm.id, "author", cm.author, violations);
  }
  for (const n of skylight.notes) scanField("notes", n.id, "text", n.text, violations);
  for (const ci of skylight.checklistItems) scanField("checklistItems", ci.id, "text", ci.text, violations);
  for (const al of skylight.activityLog) scanField("activityLog", al.id, "actor", al.actor, violations);
  return violations;
}
