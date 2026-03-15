import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentProgressLine } from "../src/provider-agent.js";

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
