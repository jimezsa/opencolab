import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveProgressEventFromCodexExecEvent,
  parseAgentProgressLine,
  parseCodexExecJsonEvent,
} from "../src/provider-agent.js";

test("parseAgentProgressLine returns a structured progress event for valid control lines", () => {
  const event = parseAgentProgressLine(
    '@telegram-progress {"phase":"downloading","message":"Downloading 2 papers","items":["Paper A","Paper B"]}',
  );

  assert.deepEqual(event, {
    phase: "downloading",
    message: "Downloading 2 papers",
    items: ["Paper A", "Paper B"],
  });
});

test("parseAgentProgressLine ignores malformed or incomplete control lines", () => {
  assert.equal(parseAgentProgressLine("@telegram-progress"), null);
  assert.equal(
    parseAgentProgressLine('@telegram-progress {"phase":"unknown","message":"bad"}'),
    null,
  );
  assert.equal(
    parseAgentProgressLine('@telegram-progress {"phase":"searching","message":42}'),
    null,
  );
  assert.equal(parseAgentProgressLine("normal answer text"), null);
});

test("parseCodexExecJsonEvent reads Codex JSON stream lines", () => {
  const event = parseCodexExecJsonEvent(
    '{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc pwd","status":"in_progress"}}',
  );

  assert.deepEqual(event, {
    type: "item.started",
    item: {
      id: "item_0",
      type: "command_execution",
      command: "/bin/zsh -lc pwd",
      status: "in_progress",
    },
  });
});

test("deriveProgressEventFromCodexExecEvent maps turn start and command execution to Telegram progress", () => {
  assert.deepEqual(
    deriveProgressEventFromCodexExecEvent({ type: "turn.started" }),
    {
      phase: "planning",
      message: "Planning approach",
    },
  );

  assert.deepEqual(
    deriveProgressEventFromCodexExecEvent({
      type: "item.started",
      item: {
        type: "command_execution",
        command: "/bin/zsh -lc papercli search transformers",
      },
    }),
    {
      phase: "searching",
      message: "Searching papers",
    },
  );

  assert.deepEqual(
    deriveProgressEventFromCodexExecEvent({
      type: "item.started",
      item: {
        type: "command_execution",
        command: "/bin/zsh -lc curl -L https://example.com/paper.pdf -o paper.pdf",
      },
    }),
    {
      phase: "downloading",
      message: "Downloading sources",
    },
  );
});
