function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * A proxy for a "daily spend cap" — `AIProvider.chatComplete` doesn't
 * expose token usage or per-provider pricing, so this counts model calls
 * per UTC day instead of real cost. Documented as an approximation in the
 * milestone doc; good enough to stop a demo from running away overnight.
 */
export class DailyCallCap {
  private count = 0;
  private day = utcDayKey(new Date());

  constructor(private readonly limit: number) {}

  private rollIfNewDay(): void {
    const today = utcDayKey(new Date());
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
  }

  isExceeded(): boolean {
    this.rollIfNewDay();
    return this.count >= this.limit;
  }

  recordCall(): void {
    this.rollIfNewDay();
    this.count += 1;
  }

  remaining(): number {
    this.rollIfNewDay();
    return Math.max(0, this.limit - this.count);
  }
}
