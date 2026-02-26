import { BaseCliAdapter } from "./base.js";

export class GeminiAdapter extends BaseCliAdapter {
  readonly adapterName = "gemini";

  override formatPrompt(input: { prompt: string }): string {
    return `You are Gemini CLI Student Agent in OpenColab.\n\n${input.prompt}`;
  }
}
