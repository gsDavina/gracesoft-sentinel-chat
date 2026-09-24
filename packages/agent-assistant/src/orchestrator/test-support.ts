import type { AIProvider, ChatCompleteInput, ChatCompleteResult } from "@gracesoft-sentinel/core";

/** A scripted `AIProvider` for orchestrator tests — returns queued responses in order, with no live network call, mirroring `provider-ai-openai`'s own mocked-fetch test convention. */
export class ScriptedAIProvider implements AIProvider {
  private readonly script: (string | Error)[];
  private cursor = 0;
  public readonly calls: ChatCompleteInput[] = [];

  constructor(script: (string | Error)[]) {
    this.script = script;
  }

  async chatComplete(input: ChatCompleteInput): Promise<ChatCompleteResult> {
    this.calls.push(input);
    const next = this.script[this.cursor++];
    if (next === undefined) throw new Error("ScriptedAIProvider ran out of scripted responses");
    if (next instanceof Error) throw next;
    return { text: next };
  }

  visionAnalyze(): never {
    throw new Error("not implemented");
  }
  embed(): never {
    throw new Error("not implemented");
  }
  transcribeAudio(): never {
    throw new Error("not implemented");
  }
}
