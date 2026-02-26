import { BaseCliAdapter } from "./base.js";

export class ClaudeCodeAdapter extends BaseCliAdapter {
  readonly adapterName = "claude_code";

  override formatPrompt(input: { prompt: string }): string {
    return `You are Claude Code Student Agent in OpenColab.\n\n${input.prompt}`;
  }
}
