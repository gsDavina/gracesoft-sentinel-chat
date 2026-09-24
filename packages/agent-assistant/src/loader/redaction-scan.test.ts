import { describe, expect, it } from "vitest";
import { scanDeskForRedactions, scanSkylightForRedactions } from "./redaction-scan.js";
import type { DeskSnapshot } from "../types/desk.js";
import type { SkylightSnapshot } from "../types/skylight.js";

function emptyDesk(overrides: Partial<DeskSnapshot> = {}): DeskSnapshot {
  return { projects: [], timeEntries: [], accounts: [], paymentMethods: [], categories: [], vendors: [], services: [], transactions: [], documents: [], ...overrides };
}

function emptySkylight(overrides: Partial<SkylightSnapshot> = {}): SkylightSnapshot {
  return { boards: [], columns: [], cards: [], checklists: [], checklistItems: [], comments: [], notes: [], activityLog: [], ...overrides };
}

describe("scanDeskForRedactions", () => {
  it("flags an email in a transaction note", () => {
    const desk = emptyDesk({
      transactions: [{ id: "tx-1", date: "2026-07-15", type: "income", amountCents: 100, currency: "SGD", accountId: "a", paymentMethodId: "m", categoryId: "c", status: "posted", note: "billed jane.doe@acme.com" }],
    });
    expect(scanDeskForRedactions(desk)).toHaveLength(1);
    expect(scanDeskForRedactions(desk)[0]?.reason).toBe("email");
  });

  it("flags a bank/account number run of 6+ digits", () => {
    const desk = emptyDesk({
      transactions: [{ id: "tx-1", date: "2026-07-15", type: "income", amountCents: 100, currency: "SGD", accountId: "a", paymentMethodId: "m", categoryId: "c", status: "posted", note: "wired to acct 123456789" }],
    });
    expect(scanDeskForRedactions(desk).length).toBeGreaterThan(0);
  });

  it("lets pseudonyms and placeholder tokens pass", () => {
    const desk = emptyDesk({
      projects: [{ id: "p1", pseudonym: "Project 4", status: "active", hourlyRateCents: 100, currency: "SGD", startDate: "2026-07-10" }],
      vendors: [{ id: "v1", pseudonym: "Vendor 7" }],
      transactions: [{ id: "tx-1", date: "2026-07-15", type: "income", amountCents: 100, currency: "SGD", accountId: "a", paymentMethodId: "m", categoryId: "c", status: "posted", note: "sent to [email], ref [url]" }],
    });
    expect(scanDeskForRedactions(desk)).toHaveLength(0);
  });
});

describe("scanSkylightForRedactions", () => {
  it("flags a URL in a card title", () => {
    const skylight = emptySkylight({
      cards: [{ id: "c1", boardId: "b1", columnId: "col1", title: "See https://example.com/secret", labels: [], tags: [] }],
    });
    expect(scanSkylightForRedactions(skylight)[0]?.reason).toBe("url");
  });

  it("flags a phone number in a comment", () => {
    const skylight = emptySkylight({
      comments: [{ id: "cm1", cardId: "c1", author: "User 1", text: "call +65 9123 4567 for details", createdAt: "2026-07-15T00:00:00Z" }],
    });
    expect(scanSkylightForRedactions(skylight)[0]?.reason).toBe("phone");
  });

  it("lets pseudonym actors and ordinary text pass", () => {
    const skylight = emptySkylight({
      activityLog: [{ id: "al1", boardId: "b1", cardId: "c1", type: "created", at: "2026-07-15T00:00:00Z", actor: "User 1" }],
      checklistItems: [{ id: "ci1", checklistId: "cl1", text: "Draft the proposal", done: false }],
    });
    expect(scanSkylightForRedactions(skylight)).toHaveLength(0);
  });
});
