import { describe, expect, it } from "vitest";
import { DailyCallCap } from "./daily-call-cap.js";

describe("DailyCallCap", () => {
  it("is not exceeded below the limit", () => {
    const cap = new DailyCallCap(3);
    cap.recordCall();
    cap.recordCall();
    expect(cap.isExceeded()).toBe(false);
    expect(cap.remaining()).toBe(1);
  });

  it("is exceeded once the limit is reached", () => {
    const cap = new DailyCallCap(2);
    cap.recordCall();
    cap.recordCall();
    expect(cap.isExceeded()).toBe(true);
    expect(cap.remaining()).toBe(0);
  });
});
