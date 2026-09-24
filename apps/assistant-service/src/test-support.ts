import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AIProvider, ChatCompleteInput, ChatCompleteResult, EmbedInput, EmbedResult, TranscribeAudioInput, TranscribeAudioResult, VisionAnalyzeInput, VisionAnalyzeResult } from "@gracesoft-sentinel/core";
import { createLogger, type Logger } from "@gracesoft-sentinel/logging";

/** The M1 fixture snapshot, reused here rather than duplicating a second fixture just for this app's own tests. */
export const FIXTURE_SNAPSHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/agent-assistant/data/snapshot/valid");

/** A working structured logger that writes nowhere — keeps test output clean, same convention as cook-service's `createSilentTestLogger`. */
export function createSilentTestLogger(): Logger {
  return createLogger("test", { write: () => {} });
}

/** Always answers immediately with a fixed final_answer — enough to exercise the HTTP layer without a live model. */
export class FakeAiProvider implements AIProvider {
  constructor(private readonly answerText = "Fixed test answer.") {}

  async chatComplete(_input: ChatCompleteInput): Promise<ChatCompleteResult> {
    return { text: JSON.stringify({ action: "final_answer", text: this.answerText }) };
  }
  async visionAnalyze(_input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    throw new Error("not implemented");
  }
  async embed(_input: EmbedInput): Promise<EmbedResult> {
    throw new Error("not implemented");
  }
  async transcribeAudio(_input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    throw new Error("not implemented");
  }
}
