import { describe, expect, it } from "vitest";
import { SessionRateLimiter } from "./session-rate-limiter.js";

describe("SessionRateLimiter", () => {
  it("allows up to the limit within a window", () => {
    const limiter = new SessionRateLimiter(2, 60_000);
    expect(limiter.tryConsume("s1")).toBe(true);
    expect(limiter.tryConsume("s1")).toBe(true);
    expect(limiter.tryConsume("s1")).toBe(false);
  });

  it("tracks sessions independently", () => {
    const limiter = new SessionRateLimiter(1, 60_000);
    expect(limiter.tryConsume("s1")).toBe(true);
    expect(limiter.tryConsume("s2")).toBe(true);
    expect(limiter.tryConsume("s1")).toBe(false);
  });

  it("resets after the window elapses", async () => {
    const limiter = new SessionRateLimiter(1, 20);
    expect(limiter.tryConsume("s1")).toBe(true);
    expect(limiter.tryConsume("s1")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(limiter.tryConsume("s1")).toBe(true);
  });
});
