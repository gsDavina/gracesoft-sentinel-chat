import type { BookingLogEntry, ConversationDataEraser, ConversationLogger, ConversationMessageLogEntry } from "./conversation-logger.js";
import { createPgClient, type PgLikeClient } from "./pg-client.js";

export interface PostgresConversationLoggerConfig {
  client: PgLikeClient;
}

/** `ConversationLogger` backed by Postgres — see `schema.sql` for the table shapes this writes to. */
export class PostgresConversationLogger implements ConversationLogger, ConversationDataEraser {
  private readonly client: PgLikeClient;

  constructor(config: PostgresConversationLoggerConfig) {
    this.client = config.client;
  }

  async logMessage(entry: ConversationMessageLogEntry): Promise<void> {
    await this.client.query(
      `INSERT INTO conversation_messages (session_id, channel, agent, direction, text, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.sessionId, entry.channel, entry.agent, entry.direction, entry.text ?? null, entry.occurredAt]
    );
  }

  async logBooking(entry: BookingLogEntry): Promise<void> {
    await this.client.query(
      `INSERT INTO bookings (session_id, booking_id, calendar_id, starts_at, ends_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.sessionId, entry.bookingId, entry.calendarId, entry.start, entry.end, entry.createdAt]
    );
  }

  /**
   * A real `DELETE`, not a soft-delete flag — the point is that the rows
   * are gone. Counts come back through `RETURNING` so this works with the
   * minimal `PgLikeClient` (rows only, no `rowCount`).
   */
  async deleteSessionData(sessionIds: string[]): Promise<{ messages: number; bookings: number }> {
    if (sessionIds.length === 0) return { messages: 0, bookings: 0 };
    const count = async (table: "conversation_messages" | "bookings"): Promise<number> => {
      const result = await this.client.query(
        `WITH deleted AS (DELETE FROM ${table} WHERE session_id = ANY($1::text[]) RETURNING 1) SELECT count(*)::int AS count FROM deleted`,
        [sessionIds]
      );
      return Number((result.rows[0] as { count?: number } | undefined)?.count ?? 0);
    };
    return { messages: await count("conversation_messages"), bookings: await count("bookings") };
  }
}

/** Config-driven construction from the process environment. */
export function createPostgresConversationLoggerFromEnv(env: NodeJS.ProcessEnv): PostgresConversationLogger {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing required env var: DATABASE_URL");
  return new PostgresConversationLogger({ client: createPgClient(connectionString) });
}
