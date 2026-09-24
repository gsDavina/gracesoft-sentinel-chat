import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const VALID_ENV = {
  OPENAI_API_KEY: "sk-test",
  SNAPSHOT_DIR: "/tmp/snapshot",
  DEMO_TOKEN: "secret",
} as NodeJS.ProcessEnv;

describe("loadEnv", () => {
  it("loads valid config with defaults filled in", () => {
    const env = loadEnv(VALID_ENV);
    expect(env).toMatchObject({ PORT: 3004, OPENAI_MODEL: "gpt-4o-mini", AS_OF_DATE: "2026-09-10", MAX_TOOL_STEPS: 6 });
  });

  it("fails on boot with the missing key named", () => {
    expect(() => loadEnv({ SNAPSHOT_DIR: "/tmp", DEMO_TOKEN: "x" } as NodeJS.ProcessEnv)).toThrowError(/OPENAI_API_KEY/);
  });

  it("fails when SNAPSHOT_DIR is missing", () => {
    expect(() => loadEnv({ OPENAI_API_KEY: "sk", DEMO_TOKEN: "x" } as NodeJS.ProcessEnv)).toThrowError(/SNAPSHOT_DIR/);
  });

  it("fails when DEMO_TOKEN is missing", () => {
    expect(() => loadEnv({ OPENAI_API_KEY: "sk", SNAPSHOT_DIR: "/tmp" } as NodeJS.ProcessEnv)).toThrowError(/DEMO_TOKEN/);
  });
});
