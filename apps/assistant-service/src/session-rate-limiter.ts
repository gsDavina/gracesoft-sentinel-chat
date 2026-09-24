interface Window {
  count: number;
  windowStart: number;
}

/**
 * `express-rate-limit` (used for the per-IP limit below) keys by IP —
 * fine for a floor against abuse, but the milestone doc also asks for a
 * *per-session* limit, which needs its own key. A small in-memory sliding
 * window is enough for a single-process demo; a multi-instance deployment
 * would move this to Redis alongside the session store.
 */
export class SessionRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000
  ) {}

  /** Returns true and records the hit when under the limit; returns false (and does NOT record) once the limit is reached for this window. */
  tryConsume(sessionId: string): boolean {
    const now = Date.now();
    const existing = this.windows.get(sessionId);
    if (!existing || now - existing.windowStart >= this.windowMs) {
      this.windows.set(sessionId, { count: 1, windowStart: now });
      return true;
    }
    if (existing.count >= this.limit) return false;
    existing.count += 1;
    return true;
  }
}
