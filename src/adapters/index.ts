import type { Provider } from "../types.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { GeminiAdapter } from "./gemini.js";
import type { Adapter } from "./base.js";

const adapters: Record<Provider, Adapter> = {
  openai: new CodexAdapter(),
  anthropic: new ClaudeCodeAdapter(),
  google: new GeminiAdapter()
};

export function getAdapter(provider: Provider): Adapter {
  return adapters[provider];
}
