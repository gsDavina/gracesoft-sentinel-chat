export interface ConversationMessageLogEntry {
  sessionId: string;
  channel: string;
  agent: string;
  direction: "inbound" | "outbound";
  /** Message text only — never a channel's raw payload; PII redaction (Milestone 10) is the caller's job before this is called. */
  text?: string;
  occurredAt: string;
}

export interface BookingLogEntry {
  sessionId: string;
  bookingId: string;
  calendarId: string;
  start: string;
  end: string;
  createdAt: string;
}

/**
 * Persistence capability for conversation/booking audit records —
 * intentionally not a `core` interface: this is an operational/observability
 * concern the service-wiring layer performs around calls to `handleMessage`,
 * not something either agent takes as an input.
 */
export interface ConversationLogger {
  logMessage(entry: ConversationMessageLogEntry): Promise<void>;
  logBooking(entry: BookingLogEntry): Promise<void>;
}

/**
 * Erasure capability for the same records — kept separate from
 * `ConversationLogger` so existing loggers (and test fakes) that only
 * write don't have to grow a delete method. Used by a service's "delete my
 * data" flow (`@gracesoft-sentinel/user-data-deletion`).
 */
export interface ConversationDataEraser {
  /** Hard-deletes every message and booking row for these session ids; resolves to how many rows went from each table. */
  deleteSessionData(sessionIds: string[]): Promise<{ messages: number; bookings: number }>;
}
