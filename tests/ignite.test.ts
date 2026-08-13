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
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    KIMI_API_KEY: process.env.KIMI_API_KEY,
    RUNPOD_API_KEY: process.env.RUNPOD_API_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  };
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.MINIMAX_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.KIMI_API_KEY;
  delete process.env.RUNPOD_API_KEY;
  delete process.env.TELEGRAM_BOT_TOKEN;
  return previous;
}

function restoreSecretEnvVars(
  previous: Record<string, string | undefined>,
): void {
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
    "gpt-5.5",
    "high",
    "openai_test_key_123",
    "y", // configure telegram now
    "123456:telegram_bot_token",
    "10001",
    "n", // skip pairing
    "y", // open the optional Gemini + Runpod section
    "y", // add gemini built-in tools key
    "gemini_tools_key_123",
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
        },
      },
      {
        syncTelegramCommands: async () => {
          syncCalls += 1;
          return { ok: true };
        },
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );
    assert.equal(syncCalls, 1);

    const state = runtime.getState();
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();

    assert.equal(state.activeProjectId, "science");
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.model, "gpt-5.5");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.reasoningEffort, "high");
    assert.equal(agent.provider.runtime, "codex");
    assert.equal(agent.provider.cliCommand, "codex");
    assert.deepEqual(agent.provider.cliArgs, [
      "-a",
      "never",
      "exec",
      "--skip-git-repo-check",
      "--json",
      "--output-last-message",
      "{output_file}",
      "--sandbox",
      "danger-full-access",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}",
      "-",
    ]);

    assert.equal(state.telegram.chatId, "10001");
    assert.equal(state.telegram.paired, false);
    assert.equal(process.env.OPENAI_API_KEY, "openai_test_key_123");
    assert.equal(process.env.GEMINI_API_KEY, "gemini_tools_key_123");
    assert.equal(process.env.TELEGRAM_BOT_TOKEN, "123456:telegram_bot_token");
    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envLocal.includes("OPENAI_API_KEY=openai_test_key_123"), true);
    assert.equal(
      envLocal.includes("GEMINI_API_KEY=gemini_tools_key_123"),
      true,
    );
    assert.equal(
      envLocal.includes("TELEGRAM_BOT_TOKEN=123456:telegram_bot_token"),
      true,
    );

    assert.equal(agent.id, "professor");
    assert.equal(agent.path, "projects/science/AGENTS/professor");

    assert.equal(prompts.length > 0, true);
    assert.equal(
      outputs.some((line) =>
        line.includes(
          "Set OPENAI_API_KEY here: https://platform.openai.com/api-keys",
        ),
      ),
      true,
    );
    assert.equal(
      outputs.some((line) =>
        line.includes(
          "Set GEMINI_API_KEY here: https://aistudio.google.com/app/apikey",
        ),
      ),
      true,
    );
    assert.equal(
      outputs.some((line) =>
        line.includes(
          "Create a Telegram bot token with BotFather: open https://t.me/BotFather and run /newbot.",
        ),
      ),
      true,
    );
    assert.equal(outputs.includes("Onboarding complete."), true);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite edits an existing telegram token via single-key confirm without re-asking", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-token-edit-"),
  );
  const previousEnv = clearSecretEnvVars();
  process.env.TELEGRAM_BOT_TOKEN = "123456:existing_token";
  const runtime = createRuntime(tempDir);
  runtime.init();

  // Free-text answers (io.ask) and yes/no answers (io.confirm) are scripted on
  // separate queues, mirroring the real CLI where confirmations are a single
  // keypress and never share the line-based input path.
  const askAnswers = [
    "science", // project id
    "openai", // provider
    "api-key", // auth mode
    "gpt-5.5", // model
    "high", // reasoning effort
    "openai_test_key_123", // openai api key
    "999999:new_token", // new telegram bot token
    "10001", // telegram chat id
    "gemini_tools_key_123", // gemini built-in tools key
  ];
  const confirmAnswers = [
    "y", // configure telegram now
    "n", // do not keep existing token (edit it)
    "n", // skip pairing
    "y", // open the optional Gemini + Runpod section
    "y", // add gemini built-in tools key
    "n", // skip runpod
  ];
  const confirmPrompts: string[] = [];
  const askPrompts: string[] = [];

  try {
    await runIgnite(
      runtime,
      {
        ask: async (prompt) => {
          askPrompts.push(prompt);
          return askAnswers.shift() ?? "";
        },
        confirm: async (prompt) => {
          confirmPrompts.push(prompt);
          return confirmAnswers.shift() ?? "n";
        },
        write: () => undefined,
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      askAnswers.length,
      0,
      "all scripted free-text answers should be consumed",
    );
    assert.equal(
      confirmAnswers.length,
      0,
      "all scripted confirm answers should be consumed",
    );

    // The "Keep it?" question must be asked exactly once — the old bug caused a
    // pasted token to be appended to the answer, rejected, and re-asked.
    const keepPrompts = confirmPrompts.filter((prompt) =>
      prompt.includes("already has a value. Keep it?"),
    );
    assert.equal(keepPrompts.length, 1);

    // The new token must be requested and saved.
    assert.equal(
      askPrompts.some((prompt) => prompt.includes("TELEGRAM_BOT_TOKEN value")),
      true,
    );
    assert.equal(process.env.TELEGRAM_BOT_TOKEN, "999999:new_token");
    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(
      envLocal.includes("TELEGRAM_BOT_TOKEN=999999:new_token"),
      true,
    );
    assert.equal(runtime.getState().telegram.chatId, "10001");
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite lets Esc skip a step and continue", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-esc-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    ESC_INPUT,
    "openai",
    "api-key",
    "gpt-5.5",
    "",
    "openai_test_key_esc",
    ESC_INPUT, // skip telegram step
    "n", // decline the optional Gemini + Runpod section
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
        },
      },
      {
        syncTelegramCommands: async () => {
          syncCalls += 1;
          return { ok: true };
        },
      },
    );

    const state = runtime.getState();
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();

    assert.equal(state.activeProjectId, "default");
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.model, "gpt-5.5");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.reasoningEffort, "high");
    assert.equal(agent.provider.runtime, "codex");
    assert.equal(state.telegram.chatId, null);
    assert.equal(agent.id, "professor");
    assert.equal(syncCalls, 0);
    assert.equal(process.env.OPENAI_API_KEY, "openai_test_key_esc");
    assert.equal(
      outputs.some((line) => line.includes("Step skipped.")),
      true,
    );
    assert.equal(outputs.includes("Onboarding complete."), true);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite detects existing provider setup and allows keeping it", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-provider-detect-"),
  );
  const previousEnv = clearSecretEnvVars();
  process.env.OPENAI_API_KEY = "existing_openai_key";
  const runtime = createRuntime(tempDir);
  runtime.init();
  runtime.setupModel({
    providerName: "openai",
    model: "gpt-5.5",
  });

  const answers = ["", "y", "n", "n"];
  const prompts: string[] = [];

  try {
    await runIgnite(
      runtime,
      {
        ask: async (prompt) => {
          prompts.push(prompt);
          return answers.shift() ?? "";
        },
        write: () => undefined,
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.model, "gpt-5.5");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.reasoningEffort, "high");
    assert.equal(agent.provider.runtime, "codex");
    assert.equal(
      prompts.some((prompt) => prompt.includes("OPENAI_API_KEY value")),
      false,
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports configuring the minimax provider", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-minimax-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "minimax",
    "MiniMax-M2.5",
    "minimax_test_key_123",
    "n", // skip telegram
    "n", // decline the optional Gemini + Runpod section
  ];

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: () => undefined,
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "minimax");
    assert.equal(agent.provider.model, "MiniMax-M2.5");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.runtime, "claude");
    assert.equal(agent.provider.cliCommand, "claude");
    assert.deepEqual(agent.provider.cliArgs, [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}",
    ]);

    assert.equal(process.env.MINIMAX_API_KEY, "minimax_test_key_123");
    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(
      envLocal.includes("MINIMAX_API_KEY=minimax_test_key_123"),
      true,
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite exposes MiniMax-M2.7 in interactive chooser mode", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-minimax-choose-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = ["", "minimax_test_key_choose", "n", "n"];
  let modelOptions: string[] | null = null;

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        choose: async (prompt, options) => {
          if (prompt === "| Provider:") {
            return "minimax";
          }
          if (prompt === "| Model:") {
            modelOptions = [...options];
            return "MiniMax-M2.7";
          }
          return options[0] ?? "";
        },
        write: () => undefined,
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.deepEqual(modelOptions, ["MiniMax-M2.7", "MiniMax-M2.5"]);

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "minimax");
    assert.equal(agent.provider.model, "MiniMax-M2.7");
    assert.equal(agent.provider.runtime, "claude");
    assert.equal(process.env.MINIMAX_API_KEY, "minimax_test_key_choose");
    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports OpenAI oauth mode without asking for API key", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-openai-oauth-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = ["", "openai", "oauth", "gpt-5.5", "", "n", "n"];
  const prompts: string[] = [];

  try {
    await runIgnite(
      runtime,
      {
        ask: async (prompt) => {
          prompts.push(prompt);
          return answers.shift() ?? "";
        },
        write: () => undefined,
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.reasoningEffort, "high");
    assert.equal(agent.provider.runtime, "codex");
    assert.equal(
      prompts.some((prompt) => prompt.includes("OPENAI_API_KEY value")),
      false,
    );
    assert.equal(process.env.OPENAI_API_KEY, undefined);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite exposes native OpenAI reasoning effort options in chooser mode", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-openai-choose-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = ["", "n", "n"];
  let reasoningOptions: string[] | null = null;

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        choose: async (prompt, options) => {
          if (prompt === "| Provider:") {
            return "openai";
          }
          if (prompt === "| Auth mode:") {
            return "oauth";
          }
          if (prompt === "| Model:") {
            return "gpt-5.5";
          }
          if (prompt === "| Reasoning effort:") {
            reasoningOptions = [...options];
            return "xhigh";
          }
          return options[0] ?? "";
        },
        write: () => undefined,
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.deepEqual(reasoningOptions, ["low", "medium", "high", "xhigh"]);
    assert.equal(runtime.getActiveAgent().provider.reasoningEffort, "xhigh");
    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports Anthropic oauth mode without asking for API key", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-anthropic-oauth-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "anthropic",
    "oauth",
    "claude-opus-4-6",
    "max",
    "n", // skip telegram
    "n", // decline the optional Gemini + Runpod section
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
        },
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "anthropic");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.runtime, "claude");
    assert.equal(agent.provider.model, "claude-opus-4-6");
    assert.equal(agent.provider.reasoningEffort, "max");
    assert.equal(
      prompts.some((prompt) => prompt.includes("ANTHROPIC_API_KEY value")),
      false,
    );
    assert.equal(
      outputs.some((line) => line.includes("claude auth login")),
      true,
    );
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports configuring the Gemini provider with a concrete model name", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-gemini-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "gemini",
    "api-key",
    "gemini-2.5-pro",
    "gemini_test_key_123",
    "n",
    "n",
  ];

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: () => undefined,
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "gemini");
    assert.equal(agent.provider.model, "gemini-2.5-pro");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.runtime, "gemini");
    assert.equal(agent.provider.cliCommand, "gemini");
    assert.deepEqual(agent.provider.cliArgs, [
      "--output-format",
      "stream-json",
      "--model",
      "{model}",
      "--yolo",
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
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-gemini-oauth-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = ["", "gemini", "oauth", "gemini-2.5-pro", "n", "n"];
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
        },
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "gemini");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.runtime, "gemini");
    assert.equal(agent.provider.model, "gemini-2.5-pro");
    assert.equal(
      prompts.some((prompt) => prompt.includes("GEMINI_API_KEY value")),
      false,
    );
    assert.equal(
      outputs.some((line) => line.includes("Login with Google")),
      true,
    );
    assert.equal(process.env.GEMINI_API_KEY, undefined);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite exposes curated Gemini models in interactive chooser mode", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-gemini-choose-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = ["", "n", "n"];
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
        write: () => undefined,
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.deepEqual(modelOptions, [
      "gemini-3.1-pro-preview",
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ]);

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "gemini");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.runtime, "gemini");
    assert.equal(agent.provider.model, "gemini-3.1-pro-preview");
    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports configuring xAI on the pi runtime", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-xai-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "xai",
    "grok-code-fast-1",
    "xai_test_key_123",
    "n", // skip telegram
    "n", // decline the optional Gemini + Runpod section
  ];

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: () => undefined,
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "xai");
    assert.equal(agent.provider.model, "grok-code-fast-1");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.runtime, "pi");
    assert.equal(agent.provider.cliCommand, "pi");
    assert.deepEqual(agent.provider.cliArgs, [
      "--mode",
      "json",
      "--print",
      "--provider",
      "{runtime_provider}",
      "--model",
      "{model}",
      "--append-system-prompt",
      "{system_prompt_file}",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--tools",
      "read,bash,edit,write,grep,find,ls",
    ]);

    assert.equal(process.env.XAI_API_KEY, "xai_test_key_123");
    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envLocal.includes("XAI_API_KEY=xai_test_key_123"), true);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports configuring OpenRouter on the pi runtime", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-openrouter-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "openrouter",
    "openai/gpt-5.5",
    "openrouter_test_key_123",
    "n", // skip telegram
    "n", // decline the optional Gemini + Runpod section
  ];

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: () => undefined,
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openrouter");
    assert.equal(agent.provider.model, "openai/gpt-5.5");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.runtime, "pi");
    assert.equal(agent.provider.cliCommand, "pi");
    assert.deepEqual(agent.provider.cliArgs, [
      "--mode",
      "json",
      "--print",
      "--provider",
      "{runtime_provider}",
      "--model",
      "{model}",
      "--append-system-prompt",
      "{system_prompt_file}",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--tools",
      "read,bash,edit,write,grep,find,ls",
    ]);

    assert.equal(process.env.OPENROUTER_API_KEY, "openrouter_test_key_123");
    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(
      envLocal.includes("OPENROUTER_API_KEY=openrouter_test_key_123"),
      true,
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite supports configuring Kimi on the pi runtime", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-kimi-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = ["", "kimi", "k2p5", "kimi_test_key_123", "n", "n"];

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: () => undefined,
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "kimi");
    assert.equal(agent.provider.model, "k2p5");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.runtime, "pi");
    assert.equal(agent.provider.cliCommand, "pi");
    assert.deepEqual(agent.provider.cliArgs, [
      "--mode",
      "json",
      "--print",
      "--provider",
      "{runtime_provider}",
      "--model",
      "{model}",
      "--append-system-prompt",
      "{system_prompt_file}",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--tools",
      "read,bash,edit,write,grep,find,ls",
    ]);

    assert.equal(process.env.KIMI_API_KEY, "kimi_test_key_123");
    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envLocal.includes("KIMI_API_KEY=kimi_test_key_123"), true);
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite can save the Gemini built-in tools key without changing the active provider", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-built-in-tools-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "openai",
    "oauth",
    "gpt-5.5",
    "high",
    "n", // skip telegram
    "y", // open the optional Gemini + Runpod section
    "y", // add gemini built-in tools key
    "gemini_built_in_key_123",
    "n", // skip runpod
  ];
  const outputs: string[] = [];

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: (line) => {
          outputs.push(line);
        },
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.reasoningEffort, "high");
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    assert.equal(process.env.GEMINI_API_KEY, "gemini_built_in_key_123");

    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(
      envLocal.includes("GEMINI_API_KEY=gemini_built_in_key_123"),
      true,
    );
    assert.equal(
      outputs.some((line) =>
        line.includes("Saved GEMINI_API_KEY in .env.local for shared tools."),
      ),
      true,
    );
    assert.equal(
      outputs.some((line) =>
        line.includes(
          "pageindex-grounded can use the existing GEMINI_API_KEY for the local PageIndex runner.",
        ),
      ),
      true,
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite can save the Gemini key for pageindex-grounded without changing the active provider", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-pageindex-grounded-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "gemini",
    "oauth",
    "gemini-2.5-pro",
    "n", // skip telegram
    "y", // open the optional Gemini + Runpod section
    "n", // skip the gemini built-in tools key
    "y", // add the gemini key for pageindex-grounded
    "pageindex_gemini_key_123",
    "n", // skip runpod
  ];
  const outputs: string[] = [];

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: (line) => {
          outputs.push(line);
        },
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "gemini");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    assert.equal(process.env.GEMINI_API_KEY, "pageindex_gemini_key_123");

    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(
      envLocal.includes("GEMINI_API_KEY=pageindex_gemini_key_123"),
      true,
    );
    assert.equal(
      outputs.some((line) =>
        line.includes(
          "Saved GEMINI_API_KEY in .env.local for pageindex-grounded.",
        ),
      ),
      true,
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite can configure an optional Runpod GPU server", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-runpod-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "",
    "openai",
    "api-key",
    "gpt-5.5",
    "",
    "openai_test_key_for_runpod",
    "n", // skip telegram
    "y", // open the optional Gemini + Runpod section
    "n", // skip gemini built-in tools key
    "n", // skip pageindex-grounded key
    "y", // configure runpod now
    "y", // add runpod api key
    "runpod_test_key_123",
    "y", // create the default gpu server
    "runpod-a100",
    "n", // skip validation
  ];
  const outputs: string[] = [];

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: (line) => {
          outputs.push(line);
        },
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );
    assert.equal(process.env.RUNPOD_API_KEY, "runpod_test_key_123");
    const target = runtime.getExecutionTarget("runpod-a100");
    assert.equal(target.backend, "runpod");
    assert.equal(target.gpuType, "NVIDIA A100 80GB PCIe");
    assert.deepEqual(target.preferredGpuTypes, ["NVIDIA A100 80GB PCIe"]);
    assert.deepEqual(target.preferredDatacenterIds, ["US-KS-2"]);
    assert.equal(target.workspaceRoot, "/workspace");
    assert.equal(target.bootstrapProfile, "pytorch-cu12");
    assert.equal(target.autoStopPolicy, "keep_warm");

    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envLocal.includes("RUNPOD_API_KEY=runpod_test_key_123"), true);
    assert.equal(
      outputs.some((line) =>
        line.includes(
          "Set RUNPOD_API_KEY here: https://www.runpod.io/console/user/settings",
        ),
      ),
      true,
    );
    assert.equal(
      outputs.some((line) =>
        line.includes("Configured Runpod GPU server 'runpod-a100'"),
      ),
      true,
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite pairs Telegram via the handshake without asking for a chat id or code", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-tg-handshake-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "", // project id (default)
    "openai", // provider
    "oauth", // auth mode (skips api key)
    "gpt-5.5", // model
    "", // reasoning effort (default)
    "y", // configure telegram now
    "123456:handshake_token", // telegram bot token
    "n", // decline the optional Gemini + Runpod section
  ];
  const prompts: string[] = [];
  const outputs: string[] = [];
  let syncChatId: string | null | undefined;
  let handshakeCalls = 0;

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
        },
      },
      {
        syncTelegramCommands: async (chatId) => {
          syncChatId = chatId;
          return { ok: true };
        },
        waitForTelegramHandshake: async (request) => {
          handshakeCalls += 1;
          request.onBotInfo?.("opencolab_bot");
          return {
            chatId: "778899",
            chatType: "private",
            sender: "alice",
            text: "hello",
          };
        },
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );
    assert.equal(handshakeCalls, 1);

    const state = runtime.getState();
    assert.equal(state.telegram.chatId, "778899");
    assert.equal(state.telegram.paired, true);
    assert.equal(syncChatId, "778899");
    assert.equal(process.env.TELEGRAM_BOT_TOKEN, "123456:handshake_token");

    // The manual chat-id and pairing-code prompts are gone in the handshake flow.
    assert.equal(
      prompts.some((prompt) => prompt.includes("Telegram chat id")),
      false,
    );
    assert.equal(
      prompts.some((prompt) => prompt.includes("Enter pairing code")),
      false,
    );
    assert.equal(
      outputs.some((line) =>
        line.includes("Telegram paired with alice (chat 778899)."),
      ),
      true,
    );
    assert.equal(
      outputs.some((line) => line.includes("https://t.me/opencolab_bot")),
      true,
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite handshake timeout offers a retry and then skips", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-tg-handshake-skip-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "", // project id
    "openai", // provider
    "oauth", // auth mode
    "gpt-5.5", // model
    "", // reasoning effort
    "y", // configure telegram now
    "123:tok", // telegram bot token
    "y", // retry handshake after first timeout
    "n", // do not retry after second timeout
    "n", // do not enter chat id manually
    "n", // decline the optional Gemini + Runpod section
  ];
  const outputs: string[] = [];
  let handshakeCalls = 0;

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: (line) => {
          outputs.push(line);
        },
      },
      {
        syncTelegramCommands: async () => ({ ok: true }),
        waitForTelegramHandshake: async () => {
          handshakeCalls += 1;
          return null;
        },
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );
    assert.equal(handshakeCalls, 2);

    const state = runtime.getState();
    assert.equal(state.telegram.chatId, null);
    assert.equal(state.telegram.paired, false);
    assert.equal(
      outputs.some((line) =>
        line.includes(
          "Telegram pairing skipped. Run 'opencolab setup telegram pair start' when ready.",
        ),
      ),
      true,
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ignite handshake timeout can fall back to manual chat-id entry", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-ignite-tg-handshake-manual-"),
  );
  const previousEnv = clearSecretEnvVars();
  const runtime = createRuntime(tempDir);
  runtime.init();

  const answers = [
    "", // project id
    "openai", // provider
    "oauth", // auth mode
    "gpt-5.5", // model
    "", // reasoning effort
    "y", // configure telegram now
    "123:tok", // telegram bot token
    "n", // do not retry handshake
    "y", // enter chat id manually instead
    "10001", // telegram chat id
    "n", // do not start code pairing now
    "n", // decline the optional Gemini + Runpod section
  ];
  const outputs: string[] = [];
  let syncChatId: string | null | undefined;

  try {
    await runIgnite(
      runtime,
      {
        ask: async () => answers.shift() ?? "",
        write: (line) => {
          outputs.push(line);
        },
      },
      {
        syncTelegramCommands: async (chatId) => {
          syncChatId = chatId;
          return { ok: true };
        },
        waitForTelegramHandshake: async () => null,
      },
    );

    assert.equal(
      answers.length,
      0,
      "all scripted onboarding answers should be consumed",
    );

    const state = runtime.getState();
    assert.equal(state.telegram.chatId, "10001");
    assert.equal(state.telegram.paired, false);
    assert.equal(syncChatId, "10001");
    assert.equal(
      outputs.some((line) =>
        line.includes("Telegram configured for chat: 10001"),
      ),
      true,
    );
  } finally {
    restoreSecretEnvVars(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
