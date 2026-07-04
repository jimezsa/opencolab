import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../src/runtime.js";
import { __chatInternals } from "../src/web/server/chat.js";
import { ensureAgentFiles } from "../src/agent.js";

function setupRuntime(rootDir: string) {
  process.env.OPENCOLAB_ROOT = rootDir;
  process.env.OPENCOLAB_FORCE_MOCK_CLI = "1";
  const runtime = createRuntime(rootDir);
  runtime.init();
  return runtime;
}

function teardown(): void {
  delete process.env.OPENCOLAB_ROOT;
  delete process.env.OPENCOLAB_FORCE_MOCK_CLI;
}

test("detectAttachmentKind groups extensions and mime types into chat kinds", () => {
  const { detectAttachmentKind } = __chatInternals;
  assert.equal(detectAttachmentKind("paper.pdf", null), "pdf");
  assert.equal(detectAttachmentKind("notes.md", null), "markdown");
  assert.equal(detectAttachmentKind("snapshot.png", null), "image");
  assert.equal(detectAttachmentKind("audio.mp3", null), "audio");
  assert.equal(detectAttachmentKind("data.tar.gz", null), "archive");
  assert.equal(detectAttachmentKind("script.py", null), "text");
  assert.equal(detectAttachmentKind("unknown", null), "other");
  assert.equal(detectAttachmentKind("image", "image/png"), "image");
});

test("normalizeSafeFilename strips path separators, dotfiles, and exotic characters", () => {
  const { normalizeSafeFilename } = __chatInternals;
  assert.equal(normalizeSafeFilename("../../etc/passwd"), "passwd");
  assert.equal(normalizeSafeFilename("..\\windows\\file.txt"), "file.txt");
  assert.equal(normalizeSafeFilename(".hidden"), "hidden");
  assert.equal(normalizeSafeFilename("résumé.pdf"), "resume.pdf");
  assert.equal(normalizeSafeFilename(""), "upload.bin");
});

test("ensureUnderRoot rejects paths that escape the allowed root", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-root-"));
  try {
    const root = path.join(tempDir, "root");
    fs.mkdirSync(root);
    const inside = path.join(root, "child.txt");
    fs.writeFileSync(inside, "ok", "utf8");
    const outside = path.join(tempDir, "outside.txt");
    fs.writeFileSync(outside, "no", "utf8");
    assert.equal(__chatInternals.ensureUnderRoot(inside, [root]), true);
    assert.equal(__chatInternals.ensureUnderRoot(outside, [root]), false);
    assert.equal(__chatInternals.ensureUnderRoot(path.join(root, "..", "outside.txt"), [root]), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("parseAssistantContent strips @telegram-file directives and resolves attachments inside the agent dir", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-parse-"));
  try {
    const agentDir = path.join(tempDir, "projects", "default", "AGENTS", "professor");
    fs.mkdirSync(agentDir, { recursive: true });
    const filePath = path.join(agentDir, "report.pdf");
    fs.writeFileSync(filePath, Buffer.from("%PDF-1.4 fake"), null);
    const outside = path.join(tempDir, "escape.pdf");
    fs.writeFileSync(outside, Buffer.from("%PDF-1.4"), null);
    const raw = [
      "Here is the report.",
      `@telegram-file ${JSON.stringify({ kind: "document", file: "report.pdf" })}`,
      `@telegram-file ${JSON.stringify({ kind: "document", file: outside })}`,
      "More notes after the directive.",
    ].join("\n");
    const parsed = __chatInternals.parseAssistantContent(raw, agentDir, "default", "professor");
    assert.equal(parsed.text.includes("@telegram-file"), false);
    assert.equal(parsed.text.includes("Here is the report."), true);
    assert.equal(parsed.text.includes("More notes after the directive."), true);
    assert.equal(parsed.attachments.length, 1);
    assert.equal(parsed.attachments[0].name, "report.pdf");
    assert.equal(parsed.attachments[0].kind, "pdf");
    assert.equal(
      parsed.attachments[0].rawUrl.startsWith("/api/web/projects/default/chat/files/"),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("parseAssistantContent resolves pretty-printed multi-line @telegram-file directives", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-chat-multiline-"));
  try {
    const agentDir = path.join(tempDir, "projects", "default", "AGENTS", "professor");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "chart.png"), Buffer.from("fake-png"), null);
    const raw = [
      "Here is the chart.",
      "@telegram-file {",
      '  "kind": "photo",',
      '  "file": "chart.png"',
      "}",
      "Thanks!",
    ].join("\n");
    const parsed = __chatInternals.parseAssistantContent(raw, agentDir, "default", "professor");
    assert.equal(parsed.text.includes("@telegram-file"), false);
    assert.equal(parsed.text.includes("\"kind\""), false);
    assert.equal(parsed.text.includes("Here is the chart."), true);
    assert.equal(parsed.text.includes("Thanks!"), true);
    assert.equal(parsed.attachments.length, 1);
    assert.equal(parsed.attachments[0].name, "chart.png");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildInboundChatText preserves user prose and appends a [telegram_files] block", () => {
  const text = __chatInternals.buildInboundChatText("Please summarize the paper", [
    {
      kind: "document",
      fileId: "upload_abc",
      fileName: "paper.pdf",
      mimeType: "application/pdf",
      fileSize: 1024,
      localPath: "/tmp/uploads/paper.pdf",
    },
  ]);
  assert.equal(text.includes("Please summarize the paper"), true);
  assert.equal(text.includes("[telegram_files]"), true);
  assert.equal(text.includes("file_name=paper.pdf"), true);
  assert.equal(text.includes("local_path=\"/tmp/uploads/paper.pdf\""), true);
});

test("parseMultipart extracts fields and files from a basic form upload", () => {
  const boundary = "----opencolab-multipart-test";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="agentId"\r\n\r\n`),
    Buffer.from(`professor\r\n`),
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(
      `Content-Disposition: form-data; name="files"; filename="hello.txt"\r\nContent-Type: text/plain\r\n\r\n`,
    ),
    Buffer.from(`hello world\r\n`),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  const parts = __chatInternals.parseMultipart(body, boundary);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].name, "agentId");
  assert.equal(parts[0].data.toString("utf8"), "professor");
  assert.equal(parts[1].name, "files");
  assert.equal(parts[1].filename, "hello.txt");
  assert.equal(parts[1].data.toString("utf8"), "hello world");
  assert.equal(parts[1].contentType, "text/plain");
});

test("runtime web chat helpers expose session reset and active session resolution", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-web-chat-runtime-"));
  try {
    const runtime = setupRuntime(tempDir);
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();
    ensureAgentFiles(tempDir, agent);
    const initial = runtime.webChatActiveSessionId(project.id, agent.id);
    assert.ok(initial);
    const created = runtime.webChatResetSession(project.id, agent.id);
    assert.notEqual(created, initial);
    runtime.webChatAppend(project.id, agent.id, {
      role: "user",
      content: "hello",
      at: new Date().toISOString(),
    });
    const list = runtime.webChatListSessionIds(project.id, agent.id);
    assert.ok(list.includes(created));
    const messages = runtime.webChatReadSessionMessages(project.id, agent.id, created);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, "hello");
    assert.equal(runtime.webChatActivateSession(project.id, agent.id, initial), true);
    assert.equal(runtime.webChatActiveSessionId(project.id, agent.id), initial);
    assert.equal(runtime.webChatActivateSession(project.id, agent.id, "session-nope"), false);
  } finally {
    teardown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runWebChatTurn appends the user message but lets the caller persist the assistant reply", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-web-chat-run-"));
  try {
    const runtime = setupRuntime(tempDir);
    const project = runtime.getActiveProject();
    const agent = runtime.getActiveAgent();
    runtime.webChatAppend(project.id, agent.id, {
      role: "user",
      content: "From the route",
      at: new Date().toISOString(),
    });
    const sessionId = runtime.webChatActiveSessionId(project.id, agent.id);
    const controller = new AbortController();
    const response = await runtime.runWebChatTurn(
      {
        projectId: project.id,
        agentId: agent.id,
        text: "Please reply",
        files: [],
      },
      {
        signal: controller.signal,
        onProgress: () => {},
      },
    );
    assert.ok(response);
    // The runtime should not have appended an assistant turn (only the user message above).
    const messages = runtime.webChatReadSessionMessages(project.id, agent.id, sessionId);
    assert.equal(messages.every((m) => m.role !== "assistant"), true);
  } finally {
    teardown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
