import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIgnite } from "../src/ignite.js";
import { createRuntime } from "../src/runtime.js";

const ESC_INPUT = "\u001b";

function clearSecretEnvVars(): Record<string, string | undefined> {
  const previous = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
  };
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.MINIMAX_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.TELEGRAM_BOT_TOKEN;
  return previous;
}

function restoreSecretEnvVars(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("ignite configures project, provider, and telegram", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-ignite-"));
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "science",
    "openai",
    "api-key",
    "gpt-5.3-codex",
    "openai_test_key_123",
    "y",
    "123456:telegram_bot_token",
    "10001",
    "n"
  ];
  const prompts: string[] = [];
  const outputs: string[] = [];
  let syncCalls = 0;

  try {
    await runIgnite(
      runtime,
      {
        ask: async (prompt) => {
          prompts.push(prompt);
          return answers.shift() ?? "";
        },
        write: (line) => {
          outputs.push(line);
        }
      },
      {
        syncTelegramCommands: async () => {
          syncCalls += 1;
          return { ok: true };
        }
      }
    );

    assert.equal(answers.length, 0, "all scripted onboarding answers should be consumed");
    assert.equal(syncCalls, 1);

    const state = runtime.getState();
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();

    assert.equal(state.activeProjectId, "science");
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.model, "gpt-5.3-codex");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.runtime, "codex");
    assert.equal(agent.provider.cliCommand, "codex");
    assert.deepEqual(agent.provider.cliArgs, [
      "exec",
      "--full-auto",
      "--add-dir",
      "{project_dir}",
      "-"
    ]);

    assert.equal(state.telegram.chatId, "10001");
    assert.equal(state.telegram.paired, false);
    assert.equal(process.env.OPENAI_API_KEY, "openai_test_key_123");
    assert.equal(process.env.TELEGRAM_BOT_TOKEN, "123456:telegram_bot_token");
    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envLocal.includes("OPENAI_API_KEY=openai_test_key_123"), true);
    assert.equal(envLocal.includes("TELEGRAM_BOT_TOKEN=123456:telegram_bot_token"), true);

    assert.equal(agent.id, "researcher_agent");
    assert.equal(agent.path, "projects/science");

    assert.equal(prompts.length > 0, true);
    assert.equal(outputs.includes("Onboarding complete."), true);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite lets Esc skip a step and continue", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-ignite-esc-"));
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    ESC_INPUT,
    "openai",
    "api-key",
    "gpt-5.3-codex",
    "openai_test_key_esc",
    ESC_INPUT
  ];
  const outputs: string[] = [];
  let syncCalls = 0;

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: (line) => {
          outputs.push(line);
        }
      },
      {
        syncTelegramCommands: async () => {
          syncCalls += 1;
          return { ok: true };
        }
      }
    );

    const state = runtime.getState();
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();

    assert.equal(state.activeProjectId, "default");
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.model, "gpt-5.3-codex");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.runtime, "codex");
    assert.equal(state.telegram.chatId, null);
    assert.equal(agent.id, "researcher_agent");
    assert.equal(syncCalls, 0);
    assert.equal(process.env.OPENAI_API_KEY, "openai_test_key_esc");
    assert.equal(outputs.some((line) => line.includes("Step skipped.")), true);
    assert.equal(outputs.includes("Onboarding complete."), true);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite detects existing provider setup and allows keeping it", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-ignite-provider-detect-"));
  const previousEnv = clearSecretEnvVars();
  process.env.OPENAI_API_KEY = "existing_openai_key";
  const runtime = createRuntime(tempDir);
  runtime.init();
  runtime.setupModel({
    providerName: "openai",
    model: "gpt-5.3-codex"
  });

  const answers = ["", "y", "n"];
  const prompts: string[] = [];

  try {
    await runIgnite(
      runtime,
      {
        ask: async (prompt) => {
          prompts.push(prompt);
          return answers.shift() ?? "";
        },
        write: () => undefined
      },
      {
        syncTelegramCommands: async () => ({ ok: true })
      }
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.model, "gpt-5.3-codex");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.runtime, "codex");
    assert.equal(prompts.some((prompt) => prompt.includes("OPENAI_API_KEY value")), false);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports configuring the minimax provider", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-ignite-minimax-"));
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "minimax",
    "MiniMax-M2.5",
    "minimax_test_key_123",
    "n"
  ];

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: () => undefined
      },
      {
        syncTelegramCommands: async () => ({ ok: true })
      }
    );

    assert.equal(answers.length, 0, "all scripted onboarding answers should be consumed");

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "minimax");
    assert.equal(agent.provider.model, "MiniMax-M2.5");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.runtime, "claude");
    assert.equal(agent.provider.cliCommand, "claude");
    assert.deepEqual(agent.provider.cliArgs, [
      "-p",
      "{prompt}",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}"
    ]);

    assert.equal(process.env.MINIMAX_API_KEY, "minimax_test_key_123");
    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envLocal.includes("MINIMAX_API_KEY=minimax_test_key_123"), true);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports OpenAI oauth mode without asking for API key", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-ignite-openai-oauth-"));
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "openai",
    "oauth",
    "gpt-5.3-codex",
    "n"
  ];
  const prompts: string[] = [];

  try {
    await runIgnite(
      runtime,
      {
        ask: async (prompt) => {
          prompts.push(prompt);
          return answers.shift() ?? "";
        },
        write: () => undefined
      },
      {
        syncTelegramCommands: async () => ({ ok: true })
      }
    );

    assert.equal(answers.length, 0, "all scripted onboarding answers should be consumed");

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.runtime, "codex");
    assert.equal(prompts.some((prompt) => prompt.includes("OPENAI_API_KEY value")), false);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports configuring the Gemini provider with a concrete model name", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-ignite-gemini-"));
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "gemini",
    "api-key",
    "gemini-2.5-pro",
    "gemini_test_key_123",
    "n"
  ];

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: () => undefined
      },
      {
        syncTelegramCommands: async () => ({ ok: true })
      }
    );

    assert.equal(answers.length, 0, "all scripted onboarding answers should be consumed");

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "gemini");
    assert.equal(agent.provider.model, "gemini-2.5-pro");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.runtime, "gemini");
    assert.equal(agent.provider.cliCommand, "gemini");
    assert.deepEqual(agent.provider.cliArgs, [
      "--prompt",
      "{prompt}",
      "--model",
      "{model}",
      "--yolo"
    ]);

    assert.equal(process.env.GEMINI_API_KEY, "gemini_test_key_123");
    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envLocal.includes("GEMINI_API_KEY=gemini_test_key_123"), true);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports Gemini oauth mode without asking for API key", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-ignite-gemini-oauth-"));
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "gemini",
    "oauth",
    "gemini-2.5-pro",
    "n"
  ];
  const prompts: string[] = [];
  const outputs: string[] = [];

  try {
    await runIgnite(
      runtime,
      {
        ask: async (prompt) => {
          prompts.push(prompt);
          return answers.shift() ?? "";
        },
        write: (line) => {
          outputs.push(line);
        }
      },
      {
        syncTelegramCommands: async () => ({ ok: true })
      }
    );

    assert.equal(answers.length, 0, "all scripted onboarding answers should be consumed");

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "gemini");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.runtime, "gemini");
    assert.equal(agent.provider.model, "gemini-2.5-pro");
    assert.equal(prompts.some((prompt) => prompt.includes("GEMINI_API_KEY value")), false);
    assert.equal(outputs.some((line) => line.includes("Login with Google")), true);
    assert.equal(process.env.GEMINI_API_KEY, undefined);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite exposes Gemini preview models in interactive chooser mode", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-ignite-gemini-choose-"));
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = ["", "n"];
  let modelOptions: string[] | null = null;

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        choose: async (prompt, options) => {
          if (prompt === "| Provider:") {
            return "gemini";
          }
          if (prompt === "| Auth mode:") {
            return "oauth";
          }
          if (prompt === "| Model:") {
            modelOptions = [...options];
            return "gemini-3.1-pro-preview";
          }
          return options[0] ?? "";
        },
        write: () => undefined
      },
      {
        syncTelegramCommands: async () => ({ ok: true })
      }
    );

    assert.deepEqual(modelOptions, [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview"
    ]);

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "gemini");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.runtime, "gemini");
    assert.equal(agent.provider.model, "gemini-3.1-pro-preview");
    assert.equal(answers.length, 0, "all scripted onboarding answers should be consumed");
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports configuring xAI on the pi runtime", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-ignite-xai-"));
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "xai",
    "grok-code-fast-1",
    "xai_test_key_123",
    "n"
  ];

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: () => undefined
      },
      {
        syncTelegramCommands: async () => ({ ok: true })
      }
    );

    assert.equal(answers.length, 0, "all scripted onboarding answers should be consumed");

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "xai");
    assert.equal(agent.provider.model, "grok-code-fast-1");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.runtime, "pi");
    assert.equal(agent.provider.cliCommand, "pi");
    assert.deepEqual(agent.provider.cliArgs, [
      "--print",
      "--provider",
      "{runtime_provider}",
      "--model",
      "{model}",
      "--append-system-prompt",
      "{system_prompt}",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--tools",
      "read,bash,edit,write,grep,find,ls",
      "{user_message}"
    ]);

    assert.equal(process.env.XAI_API_KEY, "xai_test_key_123");
    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envLocal.includes("XAI_API_KEY=xai_test_key_123"), true);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
