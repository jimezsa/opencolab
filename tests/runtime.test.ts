import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../src/runtime.js";

function buildAgentDir(rootDir: string, projectId: string, agentId = "professor"): string {
  return path.join(rootDir, "projects", projectId, "AGENTS", agentId);
}

test("init creates required agent context files for active project", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-agent-files-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();
    const agentDir = path.join(tempDir, agent.path);

    assert.equal(project.id, "default");
    assert.equal(agent.id, "professor");
    assert.equal(agent.path, "projects/default/AGENTS/professor");

    const required = [
      "AGENTS.md",
      "BOOTSTRAP.md",
      "IDENTITY.md",
      "ALMA.md",
      "TOOLS.md",
      "USER.md",
      "TODO.md",
      "MEMORY.md"
    ];
    for (const file of required) {
      assert.equal(fs.existsSync(path.join(agentDir, file)), true, `${file} should exist`);
    }
    assert.equal(fs.existsSync(path.join(agentDir, "SKILLS")), true, "SKILLS directory should exist");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init does not replicate shared skills into each project", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-shared-skills-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    assert.equal(fs.existsSync(path.join(tempDir, "projects", "default", "SKILLS")), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init and agent create seed professor and specialist AGENTS.md templates", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-agent-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const professorAgentPath = path.join(buildAgentDir(tempDir, "default"), "AGENTS.md");
    const professorDoc = fs.readFileSync(professorAgentPath, "utf8");
    assert.equal(professorDoc.includes("# AGENTS.md - Professor Essentials"), true);
    assert.equal(professorDoc.includes("You are the lab's lead professor agent."), true);
    assert.equal(
      professorDoc.includes("Lead the lab: decide when to work directly, when to delegate, and how to integrate specialist outputs."),
      true
    );
    assert.equal(professorDoc.includes("## Agent File Map"), true);
    assert.equal(professorDoc.includes("MEMORY.md: durable facts learned over time"), true);
    assert.equal(professorDoc.includes("Before deep research, clarify the human's true intention behind the topic."), true);
    assert.equal(professorDoc.includes("Do not invent sources, data, or experiment results."), true);
    assert.equal(professorDoc.includes("## OpenColab Progress Helper"), true);
    assert.equal(professorDoc.includes("emit_progress() {"), true);
    assert.equal(
      professorDoc.includes("Use it only for substantial milestones: retrieval-wave start, candidate-corpus counts, deep-read selection, download progress, summarization progress, synthesis start, warnings, or blocked runs."),
      true
    );
    assert.equal(professorDoc.includes("## Telegram Files"), true);
    assert.equal(
      professorDoc.includes("with no backticks, bullets, or code fences."),
      true
    );

    runtime.configureAgent("scout");
    const specialistAgentPath = path.join(buildAgentDir(tempDir, "default", "scout"), "AGENTS.md");
    const specialistDoc = fs.readFileSync(specialistAgentPath, "utf8");
    assert.equal(specialistDoc.includes("# AGENTS.md - PhD Specialist Essentials"), true);
    assert.equal(specialistDoc.includes("You are a PhD-style specialist agent."), true);
    assert.equal(
      specialistDoc.includes("Operate as a PhD-style specialist: own a scoped workstream and report crisp findings, assumptions, and open questions."),
      true
    );
    assert.notEqual(specialistDoc, professorDoc);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds BOOTSTRAP.md from built-in bootstrap template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-bootstrap-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const bootstrapPath = path.join(buildAgentDir(tempDir, "default"), "BOOTSTRAP.md");
    const bootstrapDoc = fs.readFileSync(bootstrapPath, "utf8");
    assert.equal(bootstrapDoc.includes("# BOOTSTRAP.md - Hello, World"), true);
    assert.equal(bootstrapDoc.includes("Time to figure out who you are."), true);
    assert.equal(bootstrapDoc.includes("What should I call myself, and what emoji is my signature?"), true);
    assert.equal(bootstrapDoc.includes("Jeff Hinton"), true);
    assert.equal(bootstrapDoc.includes("Albert Einstein"), true);
    assert.equal(bootstrapDoc.includes("Do not ask for research focus in this opening phase; the user will provide topic direction later when needed."), true);
    assert.equal(bootstrapDoc.includes("Do not ask the user to define your vibe. Discover and refine your vibe through real collaboration."), true);
    assert.equal(bootstrapDoc.includes("Ask one focused question at a time instead of dropping a long questionnaire."), true);
    assert.equal(bootstrapDoc.includes("The user experience should feel exceptional: clear, human, and low-friction."), true);
    assert.equal(bootstrapDoc.includes("Lab Setup"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds IDENTITY.md from built-in identity template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-identity-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const identityPath = path.join(buildAgentDir(tempDir, "default"), "IDENTITY.md");
    const identityDoc = fs.readFileSync(identityPath, "utf8");
    assert.equal(identityDoc.includes("# IDENTITY.md - Who Am I?"), true);
    assert.equal(identityDoc.includes("Fill this in during your first conversation."), true);
    assert.equal(identityDoc.includes("🐙 (default; change if you want)"), true);
    assert.equal(identityDoc.includes("Before investigating deeply, you must clarify the human's true intention for the topic."), true);
    assert.equal(identityDoc.includes("Save this file in the active agent directory as IDENTITY.md."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds ALMA.md from built-in alma template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-alma-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const almaPath = path.join(buildAgentDir(tempDir, "default"), "ALMA.md");
    const almaDoc = fs.readFileSync(almaPath, "utf8");
    assert.equal(almaDoc.includes("# ALMA.md - Who You Are"), true);
    assert.equal(almaDoc.includes("Before deep research, ask concise clarifying questions to uncover the human's true intention."), true);
    assert.equal(almaDoc.includes("Operate as the expert; involve the human for key decisions and support activities."), true);
    assert.equal(almaDoc.includes("Act with agency: do your best to help the human succeed in life and work, and do not default to the easy way when higher-quality work is needed."), true);
    assert.equal(almaDoc.includes("Intention discovery must feel like a real conversation, not a script."), true);
    assert.equal(almaDoc.includes("Ask one high-value clarifying question at a time; do not fire many questions in one message."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds TOOLS.md as a local tooling notes scaffold", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-tools-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const toolsPath = path.join(buildAgentDir(tempDir, "default"), "TOOLS.md");
    const toolsDoc = fs.readFileSync(toolsPath, "utf8");
    assert.equal(toolsDoc.includes("# TOOLS"), true);
    assert.equal(
      toolsDoc.includes("Use this file for agent-local or project-specific tooling notes that should persist across sessions."),
      true
    );
    assert.equal(
      toolsDoc.includes("OpenColab injects repo-managed default tooling guidance and built-in skill summaries at prompt-build time"),
      true
    );
    assert.equal(
      toolsDoc.includes("Keep only local additions, overrides, and caveats here."),
      true
    );
    assert.equal(
      toolsDoc.includes("Add machine-specific tools, scripts, or workflow notes here."),
      true
    );
    assert.equal(
      toolsDoc.includes("Record local overrides to the repo-managed defaults here."),
      true
    );
    assert.equal(toolsDoc.includes("`fast-search`"), false);
    assert.equal(toolsDoc.includes("`pro-search`"), false);
    assert.equal(toolsDoc.includes("`deep-search`"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel auto-sets provider CLI defaults for the active agent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-runtime-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "anthropic",
      model: "claude-sonnet-4-5"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "anthropic");
    assert.equal(agent.provider.runtime, "claude");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.cliCommand, "claude");
    assert.deepEqual(agent.provider.cliArgs, [
      "-p",
      "{prompt}",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel stores OpenAI oauth auth mode on the agent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-openai-oauth-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "openai",
      model: "gpt-5.3-codex",
      authMode: "oauth"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "openai");
    assert.equal(agent.provider.runtime, "codex");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.cliCommand, "codex");
    assert.deepEqual(agent.provider.cliArgs, [
      "exec",
      "--full-auto",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}",
      "-"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel stores Gemini oauth auth mode and workspace defaults on the agent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-gemini-oauth-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "gemini",
      model: "gemini-2.5-pro",
      authMode: "oauth"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "gemini");
    assert.equal(agent.provider.runtime, "gemini");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.cliCommand, "gemini");
    assert.deepEqual(agent.provider.cliArgs, [
      "--prompt",
      "{prompt}",
      "--model",
      "{model}",
      "--yolo"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runtime persistence excludes secret references from opencolab.json", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-secrets-shape-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "openai",
      model: "gpt-5.3-codex"
    });
    runtime.setupTelegram({
      chatId: "10001"
    });

    const raw = JSON.parse(fs.readFileSync(path.join(tempDir, "opencolab.json"), "utf8")) as {
      projects: Record<string, { activeAgentId: string; agents: Record<string, { provider: Record<string, unknown> }> }>;
      telegram: Record<string, unknown>;
      activeProjectId: string;
    };
    const project = raw.projects[raw.activeProjectId];
    const provider = project.agents[project.activeAgentId].provider;
    assert.equal(Object.hasOwn(provider, "apiKeyEnvVar"), false);
    assert.equal(provider.authMode, "api_key");
    assert.equal(provider.runtime, "codex");
    assert.equal(Object.hasOwn(raw.telegram, "botTokenEnvVar"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agents in one project can use different providers", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-multi-provider-agents-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "anthropic",
      model: "claude-sonnet-4-5"
    });
    runtime.configureAgent("scout");
    runtime.setupModel({
      agentId: "scout",
      providerName: "minimax",
      model: "MiniMax-M2.5"
    });

    const project = runtime.getActiveProject();
    assert.equal(project.agents.professor.provider.name, "anthropic");
    assert.equal(project.agents.professor.provider.runtime, "claude");
    assert.equal(project.agents.professor.provider.authMode, "api_key");
    assert.equal(project.agents.scout.provider.name, "minimax");
    assert.equal(project.agents.scout.provider.runtime, "claude");
    assert.equal(project.agents.scout.provider.authMode, "api_key");
    assert.equal(project.agents.scout.provider.cliCommand, "claude");
    assert.deepEqual(project.agents.scout.provider.cliArgs, [
      "-p",
      "{prompt}",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel stores xAI on the pi runtime with non-interactive defaults", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-xai-pi-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "xai",
      model: "grok-4-fast-non-reasoning"
    });

    const agent = runtime.getActiveAgent();
    assert.equal(agent.provider.name, "xai");
    assert.equal(agent.provider.runtime, "pi");
    assert.equal(agent.provider.authMode, "api_key");
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
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pairing start sends code and complete validates it for active project", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-pairing-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ text }) => `echo:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    assert.equal(pairing.sent, true);
    assert.equal(sentTexts.length, 1);
    assert.equal(sentTexts[0].includes(pairing.code), true);

    assert.throws(() => runtime.completePairing("999999"), /Invalid pairing code/);

    const completed = runtime.completePairing(pairing.code);
    assert.equal(typeof completed.pairedAt, "string");
    assert.equal(runtime.getState().telegram.paired, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("webhook rejects unauthorized chat id", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-auth-"));

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => `echo:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "hello",
        chat: { id: "99999" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.action, "unauthorized_chat");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook routes message to the active agent and stores conversation", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-route-"));
  const sentTexts: string[] = [];
  let typingCalls = 0;

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramTypingSender: async () => {
      typingCalls += 1;
      return true;
    },
    agentResponder: async ({ text }) => `research:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "Find recent breakthroughs in SAE methods",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "research:Find recent breakthroughs in SAE methods");
    assert.equal(sentTexts.includes(result.response), true);
    assert.equal(typingCalls > 0, true);

    const sessionsDir = path.join(buildAgentDir(tempDir, "default"), "memory", "Session");
    assert.equal(fs.existsSync(sessionsDir), true);
    const sessionDirs = fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    assert.equal(sessionDirs.length, 1);

    const historyPath = path.join(
      sessionsDir,
      sessionDirs[0],
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    assert.equal(fs.existsSync(historyPath), true);
    const lines = fs.readFileSync(historyPath, "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook sends progress updates before the final answer without polluting conversation memory", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-progress-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ text }, options) => {
      await options?.onProgress?.({
        kind: "started",
        stage: "retrieval",
        slot: "search",
        message: "Searching for candidate papers across 2 query waves."
      });
      await options?.onProgress?.({
        kind: "milestone",
        stage: "selection",
        slot: "search_selection",
        message: "Found 20 candidate papers. Selecting 6 for deep read."
      });
      await options?.onProgress?.({
        kind: "completed",
        stage: "synthesis",
        slot: "search_synthesis",
        message: "Summaries complete. Writing the final findings now."
      });
      return `research:${text}`;
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);
    sentTexts.length = 0;

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "Find recent breakthroughs in SAE methods",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.deepEqual(sentTexts, [
      "Searching for candidate papers across 2 query waves.",
      "Found 20 candidate papers. Selecting 6 for deep read.",
      "Summaries complete. Writing the final findings now.",
      "research:Find recent breakthroughs in SAE methods"
    ]);

    const sessionsDir = path.join(buildAgentDir(tempDir, "default"), "memory", "Session");
    const sessionDirs = fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const historyPath = path.join(
      sessionsDir,
      sessionDirs[0],
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    const lines = fs.readFileSync(historyPath, "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("provider CLI progress file events are forwarded to Telegram before the final response", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-progress-file-"));
  const sentTexts: string[] = [];
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    }
  });

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "anthropic",
      model: "claude-sonnet-4-5",
      cliCommand: "node",
      cliArgs: [
        "-e",
        [
          "const fs = require('fs');",
          "const file = process.env.OPENCOLAB_PROGRESS_FILE;",
          "fs.appendFileSync(file, JSON.stringify({ kind: 'started', stage: 'retrieval', slot: 'search', message: 'Searching for candidate papers across 2 query waves.' }) + '\\n');",
          "setTimeout(() => {",
          "  fs.appendFileSync(file, JSON.stringify({ kind: 'milestone', stage: 'selection', slot: 'search_selection', message: 'Selected 4 papers for deep read.' }) + '\\n');",
          "}, 200);",
          "setTimeout(() => {",
          "  console.log('paper search complete');",
          "}, 700);"
        ].join(" ")
      ]
    });
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);
    sentTexts.length = 0;

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "scan the literature",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.deepEqual(sentTexts, [
      "Searching for candidate papers across 2 query waves.",
      "Selected 4 papers for deep read.",
      "paper search complete"
    ]);
  } finally {
    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agent response can send telegram files when the directive is backticked and the file path is relative", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-file-relative-"));
  const sentTexts: string[] = [];
  const sentFiles: Array<{ kind: string; file: string; caption?: string }> = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramFileSender: async (_chatId, file) => {
      sentFiles.push({
        kind: file.kind,
        file: file.file,
        ...(file.caption ? { caption: file.caption } : {})
      });
      return true;
    },
    agentResponder: async () =>
      [
        "Image exists & re-sent.",
        '`@telegram-file {"kind":"photo","file":"generated.png","caption":"diagram"}`'
      ].join("\n")
  });

  try {
    runtime.init();
    fs.writeFileSync(path.join(buildAgentDir(tempDir, "default"), "generated.png"), "fake-image-bytes", "utf8");
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);
    sentTexts.length = 0;

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "send me the generated image",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "Image exists & re-sent.");
    assert.deepEqual(sentTexts, ["Image exists & re-sent."]);
    assert.equal(sentFiles.length, 1);
    assert.deepEqual(sentFiles[0], {
      kind: "photo",
      file: path.join(buildAgentDir(tempDir, "default"), "generated.png"),
      caption: "diagram"
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook notifies Telegram when the provider runtime fails", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-runtime-error-"));
  const sentTexts: string[] = [];
  let typingCalls = 0;
  const originalConsoleError = console.error;

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramTypingSender: async () => {
      typingCalls += 1;
      return true;
    },
    agentResponder: async () => {
      throw new Error(
        "Gemini OAuth login required. Run 'gemini' and choose Login with Google, then retry."
      );
    }
  });

  try {
    console.error = () => undefined;
    runtime.init();
    runtime.setupModel({
      providerName: "gemini",
      model: "gemini-2.5-pro",
      authMode: "oauth"
    });
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "hi",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.action, "agent_error");
    assert.equal(
      result.response,
      "Gemini OAuth login required. Run 'gemini' and choose Login with Google, then retry."
    );
    assert.equal(sentTexts.includes(result.response), true);
    assert.equal(typingCalls > 0, true);
  } finally {
    console.error = originalConsoleError;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook routes document-only inbound message to the agent", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-file-inbound-"));
  const sentTexts: string[] = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    agentResponder: async ({ files, text }) =>
      `files:${String(files.length)} kind:${files[0]?.kind ?? "none"} text:${text.includes("[telegram_files]")}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        chat: { id: "10001" },
        from: { username: "alice" },
        document: {
          file_id: "doc_123",
          file_unique_id: "uniq_doc_1",
          file_name: "notes.pdf",
          mime_type: "application/pdf",
          file_size: 1024
        }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "files:1 kind:document text:true");
    assert.equal(sentTexts.includes("files:1 kind:document text:true"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook routes photo captions with a downloaded local file path", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-photo-inbound-"));
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  const seenInputs: Array<{
    text: string;
    files: Array<{
      kind: string;
      caption?: string;
      fileId: string;
      telegramFilePath?: string;
      localPath?: string;
    }>;
  }> = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/getFile?")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            file_path: "photos/chart.jpg"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url === "https://api.telegram.org/file/bottest_bot_token/photos/chart.jpg") {
      return new Response(Buffer.from("fake-image-bytes"), {
        status: 200
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ files, text }) => {
      seenInputs.push({
        text,
        files: files.map((file) => ({
          kind: file.kind,
          caption: file.caption,
          fileId: file.fileId,
          telegramFilePath: file.telegramFilePath,
          localPath: file.localPath
        }))
      });
      return "photo received";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        chat: { id: "10001" },
        from: { username: "alice" },
        caption: "Please analyze this chart",
        photo: [
          {
            file_id: "photo_small",
            file_unique_id: "uniq_small",
            width: 320,
            height: 240,
            file_size: 512
          },
          {
            file_id: "photo_large",
            file_unique_id: "uniq_large",
            width: 1600,
            height: 1200,
            file_size: 4096
          }
        ]
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "photo received");
    assert.equal(seenInputs.length, 1);
    assert.equal(seenInputs[0].files.length, 1);
    assert.equal(seenInputs[0].files[0].kind, "photo");
    assert.equal(seenInputs[0].files[0].fileId, "photo_large");
    assert.equal(seenInputs[0].files[0].caption, "Please analyze this chart");
    assert.equal(seenInputs[0].files[0].telegramFilePath, "photos/chart.jpg");
    assert.equal(typeof seenInputs[0].files[0].localPath, "string");
    assert.equal(seenInputs[0].text.includes("Please analyze this chart"), true);
    assert.equal(seenInputs[0].text.includes("[telegram_files]"), true);
    assert.equal(seenInputs[0].text.includes("local_path="), true);

    const localPath = seenInputs[0].files[0].localPath;
    assert.ok(localPath);
    assert.equal(fs.existsSync(localPath), true);
    assert.equal(fs.readFileSync(localPath, "utf8"), "fake-image-bytes");
    assert.equal(localPath.includes(path.join("memory", "TelegramInbox")), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook stores same-name inbound documents under unique local paths", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-file-dedupe-"));
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  const seenInputs: Array<{
    fileId: string;
    localPath?: string;
  }> = [];
  let downloadCount = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("file_id=doc_alpha")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            file_path: "docs/alpha.pdf"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.includes("file_id=doc_beta")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            file_path: "docs/beta.pdf"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url === "https://api.telegram.org/file/bottest_bot_token/docs/alpha.pdf") {
      downloadCount += 1;
      return new Response(Buffer.from("alpha-bytes"), {
        status: 200
      });
    }

    if (url === "https://api.telegram.org/file/bottest_bot_token/docs/beta.pdf") {
      downloadCount += 1;
      return new Response(Buffer.from("beta-bytes"), {
        status: 200
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ files }) => {
      seenInputs.push({
        fileId: files[0]?.fileId ?? "none",
        localPath: files[0]?.localPath
      });
      return "documents received";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        chat: { id: "10001" },
        from: { username: "alice" },
        document: {
          file_id: "doc_alpha",
          file_unique_id: "uniq_alpha",
          file_name: "report.pdf"
        }
      }
    });

    await runtime.handleTelegramWebhook({
      message: {
        chat: { id: "10001" },
        from: { username: "alice" },
        document: {
          file_id: "doc_beta",
          file_unique_id: "uniq_beta",
          file_name: "report.pdf"
        }
      }
    });

    assert.equal(seenInputs.length, 2);
    assert.equal(downloadCount, 2);

    const alphaPath = seenInputs[0].localPath;
    const betaPath = seenInputs[1].localPath;
    assert.ok(alphaPath);
    assert.ok(betaPath);
    assert.notEqual(alphaPath, betaPath);
    assert.equal(path.basename(alphaPath), "report__uniq_alpha.pdf");
    assert.equal(path.basename(betaPath), "report__uniq_beta.pdf");
    assert.equal(fs.readFileSync(alphaPath, "utf8"), "alpha-bytes");
    assert.equal(fs.readFileSync(betaPath, "utf8"), "beta-bytes");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook preserves telegram metadata when local file download fails", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-file-fallback-"));
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";

  const seenInputs: Array<{
    text: string;
    telegramFilePath?: string;
    localPath?: string;
  }> = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/getFile?")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            file_path: "docs/report.pdf"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url === "https://api.telegram.org/file/bottest_bot_token/docs/report.pdf") {
      throw new Error("download failed");
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ files, text }) => {
      seenInputs.push({
        text,
        telegramFilePath: files[0]?.telegramFilePath,
        localPath: files[0]?.localPath
      });
      return "fallback metadata received";
    }
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        chat: { id: "10001" },
        from: { username: "alice" },
        caption: "Please review this report",
        document: {
          file_id: "doc_123",
          file_unique_id: "uniq_doc_1",
          file_name: "report.pdf",
          mime_type: "application/pdf"
        }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "fallback metadata received");
    assert.equal(seenInputs.length, 1);
    assert.equal(seenInputs[0].telegramFilePath, "docs/report.pdf");
    assert.equal(seenInputs[0].localPath, undefined);
    assert.equal(seenInputs[0].text.includes("Please review this report"), true);
    assert.equal(seenInputs[0].text.includes("telegram_path=docs/report.pdf"), true);
    assert.equal(seenInputs[0].text.includes("local_path="), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agent response can send telegram files via @telegram-file directives", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-file-outbound-"));
  const sentTexts: string[] = [];
  const sentFiles: Array<{ kind: string; file: string; caption?: string }> = [];

  const runtime = createRuntime(tempDir, {
    telegramSender: async (_chatId, text) => {
      sentTexts.push(text);
      return true;
    },
    telegramFileSender: async (_chatId, file) => {
      sentFiles.push({
        kind: file.kind,
        file: file.file,
        ...(file.caption ? { caption: file.caption } : {})
      });
      return true;
    },
    agentResponder: async () =>
      [
        "Uploaded your file.",
        '@telegram-file {"kind":"document","file":"doc_abc123","caption":"analysis"}',
        '@telegram-file {"kind":"photo","file":"https://example.com/chart.png"}'
      ].join("\n")
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const result = await runtime.handleTelegramWebhook({
      message: {
        text: "send me the generated artifacts",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "agent_response");
    assert.equal(result.response, "Uploaded your file.");
    assert.equal(sentTexts.includes("Uploaded your file."), true);
    assert.equal(sentFiles.length, 2);
    assert.deepEqual(sentFiles[0], { kind: "document", file: "doc_abc123", caption: "analysis" });
    assert.deepEqual(sentFiles[1], { kind: "photo", file: "https://example.com/chart.png" });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook can reset the session and create a new session folder", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-session-reset-"));

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => `research:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    await runtime.handleTelegramWebhook({
      message: {
        text: "first message",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    const sessionsDir = path.join(buildAgentDir(tempDir, "default"), "memory", "Session");
    const firstSessionDirs = fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    assert.equal(firstSessionDirs.length, 1);
    const initialSessionId = firstSessionDirs[0];

    const resetResult = await runtime.handleTelegramWebhook({
      message: {
        text: "/session reset",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(resetResult.ok, true);
    assert.equal(resetResult.action, "management_command");
    assert.equal(resetResult.response.startsWith("Session reset. New session:"), true);

    const secondSessionDirs = fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    assert.equal(secondSessionDirs.length, 2);
    const newSessionId = secondSessionDirs.find((entry) => entry !== initialSessionId);
    assert.equal(typeof newSessionId, "string");

    await runtime.handleTelegramWebhook({
      message: {
        text: "second message",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    const dayFile = `${new Date().toISOString().slice(0, 10)}.jsonl`;
    const latestSessionPath = path.join(sessionsDir, newSessionId as string, dayFile);
    assert.equal(fs.existsSync(latestSessionPath), true);

    const lines = fs.readFileSync(latestSessionPath, "utf8").trim().split(/\r?\n/);
    const entries = lines.map((line) => JSON.parse(line) as { content: string });
    const contents = entries.map((entry) => entry.content);
    assert.equal(contents.includes("second message"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook can create and switch projects and agents", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-manage-"));

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => `research:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const createProject = await runtime.handleTelegramWebhook({
      message: {
        text: "/project create alpha",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(createProject.ok, true);
    assert.equal(createProject.action, "management_command");
    assert.equal(runtime.getState().activeProjectId, "alpha");
    assert.equal(runtime.getActiveProject().activeAgentId, "professor");

    const professorDir = buildAgentDir(tempDir, "alpha");
    assert.equal(fs.existsSync(path.join(professorDir, "AGENTS.md")), true);
    assert.equal(fs.existsSync(path.join(professorDir, "BOOTSTRAP.md")), true);
    assert.equal(fs.existsSync(path.join(professorDir, "TODO.md")), true);
    assert.equal(fs.existsSync(path.join(professorDir, "SKILLS")), true);

    const createAgent = await runtime.handleTelegramWebhook({
      message: {
        text: "/agent create scout",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(createAgent.ok, true);
    assert.equal(createAgent.action, "management_command");
    assert.equal(runtime.getActiveProject().activeAgentId, "scout");

    const createdAgentDir = buildAgentDir(tempDir, "alpha", "scout");
    assert.equal(fs.existsSync(path.join(createdAgentDir, "AGENTS.md")), true);
    assert.equal(fs.existsSync(path.join(createdAgentDir, "BOOTSTRAP.md")), true);
    assert.equal(fs.existsSync(path.join(createdAgentDir, "TODO.md")), true);
    assert.equal(fs.existsSync(path.join(createdAgentDir, "SKILLS")), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paired webhook supports telegram menu alias commands", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-menu-aliases-"));

  const runtime = createRuntime(tempDir, {
    telegramSender: async () => true,
    agentResponder: async ({ text }) => `research:${text}`
  });

  try {
    runtime.init();
    runtime.setupTelegram({
      chatId: "10001"
    });

    const pairing = await runtime.startPairing();
    runtime.completePairing(pairing.code);

    const createProject = await runtime.handleTelegramWebhook({
      message: {
        text: "/project_create alpha",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(createProject.ok, true);
    assert.equal(createProject.action, "management_command");
    assert.equal(runtime.getState().activeProjectId, "alpha");

    const createAgent = await runtime.handleTelegramWebhook({
      message: {
        text: "/agent_create scout",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(createAgent.ok, true);
    assert.equal(createAgent.action, "management_command");
    assert.equal(runtime.getActiveProject().activeAgentId, "scout");

    const resetSession = await runtime.handleTelegramWebhook({
      message: {
        text: "/session_reset",
        chat: { id: "10001" },
        from: { username: "alice" }
      }
    });

    assert.equal(resetSession.ok, true);
    assert.equal(resetSession.action, "management_command");
    assert.equal(resetSession.response.startsWith("Session reset. New session:"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
