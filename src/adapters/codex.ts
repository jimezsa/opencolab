import { BaseCliAdapter } from "./base.js";

export class CodexAdapter extends BaseCliAdapter {
  readonly adapterName = "codex";

  override formatPrompt(input: { prompt: string }): string {
    return `You are Codex working in OpenColab.\n\n${input.prompt}`;
  }
}
