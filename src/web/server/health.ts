/**
 * Web DTO builder for /api/web/health.
 * Reports gateway, telegram, provider, and build status without leaking secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenColabRuntime } from "../../runtime.js";
import type { ProviderName } from "../../types.js";
import type { WebHealthStatus, WebProviderHealth } from "../shared/types.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const PROVIDER_CREDENTIAL_ENVS: Record<ProviderName, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  kimi: ["KIMI_API_KEY", "MOONSHOT_API_KEY"]
};

const PROVIDER_NAMES: ProviderName[] = [
  "openai",
  "anthropic",
  "gemini",
  "minimax",
  "xai",
  "openrouter",
  "kimi"
];

export function buildHealthStatus(runtime: OpenColabRuntime): WebHealthStatus {
  const state = runtime.getState();
  const providers: WebProviderHealth[] = [];
  const seen = new Set<string>();
  for (const project of Object.values(state.projects)) {
    for (const agent of Object.values(project.agents)) {
      const key = `${agent.provider.name}:${agent.provider.authMode}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      providers.push({
        name: agent.provider.name,
        authMode: agent.provider.authMode,
        hasCredential: hasProviderCredential(agent.provider.name, agent.provider.authMode)
      });
    }
  }
  for (const name of PROVIDER_NAMES) {
    if (![...seen].some((entry) => entry.startsWith(`${name}:`))) {
      providers.push({
        name,
        authMode: "api_key",
        hasCredential: hasProviderCredential(name, "api_key")
      });
    }
  }
  providers.sort((a, b) => a.name.localeCompare(b.name));

  return {
    gateway: {
      ok: true,
      port: runtime.config.localApiPort,
      rootDir: runtime.config.rootDir,
      runtimeMode: runtime.config.forceMockCodex ? "mock" : "real"
    },
    telegram: {
      paired: state.telegram.paired,
      pendingPairing: Boolean(state.telegram.pendingPairingCode),
      chatPresent: Boolean(state.telegram.chatId)
    },
    providers,
    build: readBuildInfo()
  };
}

function hasProviderCredential(name: ProviderName, authMode: string): boolean {
  if (authMode === "oauth") {
    return true;
  }
  const candidates = PROVIDER_CREDENTIAL_ENVS[name] ?? [];
  return candidates.some((envName) => Boolean(process.env[envName]?.trim()));
}

function readBuildInfo(): WebHealthStatus["build"] {
  const candidates = [
    path.resolve(MODULE_DIR, "../../../package.json"),
    path.resolve(MODULE_DIR, "../../../../package.json")
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (parsed.name === "opencolab" && typeof parsed.version === "string") {
        return {
          version: parsed.version,
          packaged: !candidate.includes(`${path.sep}src${path.sep}`)
        };
      }
    } catch {
      // ignore
    }
  }
  return { version: null, packaged: false };
}
