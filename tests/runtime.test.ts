import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../src/runtime.js";

test("init creates required agent context files for active project", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-agent-files-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();
    const agentDir = path.join(tempDir, agent.path);

    assert.equal(project.id, "default");
    assert.equal(agent.id, "researcher_agent");
    assert.equal(agent.path, "projects/default");

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
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init and agent create seed AGENTS.md from built-in researcher template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-agent-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const mainAgentPath = path.join(tempDir, "projects", "default", "AGENTS.md");
    const mainAgentDoc = fs.readFileSync(mainAgentPath, "utf8");
    assert.equal(mainAgentDoc.includes("# AGENTS.md - Researcher Essentials"), true);
    assert.equal(mainAgentDoc.includes("## Agent File Map"), true);
    assert.equal(mainAgentDoc.includes("ALMA.md: communication style, tone, and behavioral guardrails."), true);
    assert.equal(mainAgentDoc.includes("MEMORY.md: durable facts learned over time"), true);
    assert.equal(mainAgentDoc.includes("Before deep research, clarify the human's true intention behind the topic."), true);
    assert.equal(mainAgentDoc.includes("The agent group is the expert. Do not offload expert reasoning to the human."), true);
    assert.equal(mainAgentDoc.includes("Do not invent sources, data, or experiment results."), true);

    runtime.configureAgent("scout");
    const subagentPath = path.join(tempDir, "projects", "default", "subagents", "scout", "AGENTS.md");
    const subagentDoc = fs.readFileSync(subagentPath, "utf8");
    assert.equal(subagentDoc, mainAgentDoc);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds BOOTSTRAP.md from built-in bootstrap template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-bootstrap-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const bootstrapPath = path.join(tempDir, "projects", "default", "BOOTSTRAP.md");
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
    assert.equal(bootstrapDoc.includes("Researcher Setup"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("init seeds IDENTITY.md from built-in identity template", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-identity-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const identityPath = path.join(tempDir, "projects", "default", "IDENTITY.md");
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

    const almaPath = path.join(tempDir, "projects", "default", "ALMA.md");
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

test("init seeds TOOLS.md with available search skill summaries", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-tools-template-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();

    const toolsPath = path.join(tempDir, "projects", "default", "TOOLS.md");
    const toolsDoc = fs.readFileSync(toolsPath, "utf8");
    assert.equal(toolsDoc.includes("# TOOLS"), true);
    assert.equal(toolsDoc.includes("Primary runtime: provider CLI (openai or anthropic)."), true);
    assert.equal(toolsDoc.includes("`fast-search`"), true);
    assert.equal(toolsDoc.includes("Fast scientific paper scouting with `papercli`."), true);
    assert.equal(
      toolsDoc.includes("for a rapid, evidence-grounded literature brief or quick scientific orientation."),
      true,
    );
    assert.equal(toolsDoc.includes("`pro-search`"), true);
    assert.equal(toolsDoc.includes("Professional paper research with `papercli`."), true);
    assert.equal(
      toolsDoc.includes("for serious literature synthesis with stronger methodological depth, cross-paper comparison, and explicit evidence tracking."),
      true,
    );
    assert.equal(toolsDoc.includes("`deep-search`"), true);
    assert.equal(toolsDoc.includes("Deep scientific investigation with `papercli`."), true);
    assert.equal(
      toolsDoc.includes("for comprehensive state-of-the-art reviews, deep comparisons, research strategy, and evidence-heavy decision support."),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setupModel auto-sets provider CLI defaults for active project", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-provider-runtime-"));
  const runtime = createRuntime(tempDir);

  try {
    runtime.init();
    runtime.setupModel({
      providerName: "anthropic",
      model: "claude-sonnet-4-5"
    });

    const project = runtime.getActiveProject();
    assert.equal(project.provider.name, "anthropic");
    assert.equal(project.provider.cliCommand, "claude");
    assert.deepEqual(project.provider.cliArgs, [
      "-p",
      "{prompt}",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}"
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
      projects: Record<string, { provider: Record<string, unknown> }>;
      telegram: Record<string, unknown>;
      activeProjectId: string;
    };
    const provider = raw.projects[raw.activeProjectId].provider;
    assert.equal(Object.hasOwn(provider, "apiKeyEnvVar"), false);
    assert.equal(Object.hasOwn(raw.telegram, "botTokenEnvVar"), false);
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

    const sessionsDir = path.join(tempDir, "projects", "default", "memory", "Session");
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

    const sessionsDir = path.join(tempDir, "projects", "default", "memory", "Session");
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
    assert.equal(runtime.getActiveProject().activeAgentId, "researcher_agent");

    const projectRootAgentFile = path.join(tempDir, "projects", "alpha", "AGENTS.md");
    const projectRootBootstrapFile = path.join(tempDir, "projects", "alpha", "BOOTSTRAP.md");
    const projectRootTodoFile = path.join(tempDir, "projects", "alpha", "TODO.md");
    assert.equal(fs.existsSync(projectRootAgentFile), true);
    assert.equal(fs.existsSync(projectRootBootstrapFile), true);
    assert.equal(fs.existsSync(projectRootTodoFile), true);

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

    const createdAgentDir = path.join(tempDir, "projects", "alpha", "subagents", "scout");
    assert.equal(fs.existsSync(path.join(createdAgentDir, "AGENTS.md")), true);
    assert.equal(fs.existsSync(path.join(createdAgentDir, "BOOTSTRAP.md")), true);
    assert.equal(fs.existsSync(path.join(createdAgentDir, "TODO.md")), true);
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
