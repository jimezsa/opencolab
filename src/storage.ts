import fs from "node:fs";
import path from "node:path";
import type { RunPaths } from "./paths.js";
import { nowIso, toJson } from "./utils.js";

export function writePrompt(runPaths: RunPaths, taskId: string, prompt: string): string {
  const out = path.join(runPaths.prompts, `${taskId}.txt`);
  fs.writeFileSync(out, prompt, "utf8");
  return out;
}

export function writeOutput(runPaths: RunPaths, taskId: string, stdout: string): string {
  const out = path.join(runPaths.outputs, `${taskId}.txt`);
  fs.writeFileSync(out, stdout, "utf8");
  return out;
}

export function writeError(runPaths: RunPaths, taskId: string, stderr: string): string {
  const out = path.join(runPaths.logs, `${taskId}.stderr.log`);
  fs.writeFileSync(out, stderr, "utf8");
  return out;
}

export function appendRunEvent(runPaths: RunPaths, event: Record<string, unknown>): void {
  const logPath = path.join(runPaths.logs, "events.jsonl");
  const line = `${toJson({ ...event, recordedAt: nowIso() })}\n`;
  fs.appendFileSync(logPath, line, "utf8");
}

export function writeMeetingSummary(runPaths: RunPaths, meetingId: string, summary: string): string {
  const out = path.join(runPaths.meetings, `${meetingId}.md`);
  fs.writeFileSync(out, summary, "utf8");
  return out;
}

export function writeChatExport(runPaths: RunPaths, chatId: string, markdown: string): string {
  const out = path.join(runPaths.chats, `${chatId}.md`);
  fs.writeFileSync(out, markdown, "utf8");
  return out;
}
