import { spawn } from "node:child_process";
import fs from "node:fs";
import type { OpenColabConfig } from "../config.js";
import type { AgentInput, AgentInstance, AgentOutput, AgentTemplate } from "../types.js";
import { nowIso } from "../utils.js";

export interface Adapter {
  run(
    input: AgentInput,
    template: AgentTemplate,
    instance: AgentInstance,
    config: OpenColabConfig
  ): Promise<AgentOutput>;
}

export abstract class BaseCliAdapter implements Adapter {
  abstract readonly adapterName: string;

  formatPrompt(input: AgentInput): string {
    return input.prompt;
  }

  async run(
    input: AgentInput,
    template: AgentTemplate,
    instance: AgentInstance,
    config: OpenColabConfig
  ): Promise<AgentOutput> {
    const startedAt = nowIso();
    const formattedPrompt = this.formatPrompt(input);

    fs.mkdirSync(instance.workspacePath, { recursive: true });

    if (config.forceMockCli) {
      return {
        status: "ok",
        stdout: this.mockOutput(input, template, instance),
        stderr: "",
        outputFiles: [],
        startedAt,
        finishedAt: nowIso(),
        exitCode: 0
      };
    }

    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let commandMissing = false;
    let timedOut = false;

    const runPromise = new Promise<void>((resolve) => {
      const child = spawn(template.cliCommand, template.defaultArgs, {
        cwd: instance.workspacePath,
        env: {
          ...process.env,
          ...template.defaultEnv
        },
        stdio: ["pipe", "pipe", "pipe"]
      });

      let settled = false;
      const finalize = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        resolve();
      };

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, Math.max(instance.maxRuntimeSec, 1) * 1000);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          commandMissing = true;
        }
        stderr += `${error.message}\n`;
        finalize();
      });

      child.on("close", (code) => {
        exitCode = code;
        finalize();
      });

      child.stdin.write(formattedPrompt);
      child.stdin.end();
    });

    await runPromise;

    if (commandMissing && config.mockCliOnMissing) {
      return {
        status: "ok",
        stdout: this.mockOutput(input, template, instance),
        stderr,
        outputFiles: [],
        startedAt,
        finishedAt: nowIso(),
        exitCode: 0
      };
    }

    if (timedOut) {
      return {
        status: "timeout",
        stdout,
        stderr,
        outputFiles: [],
        startedAt,
        finishedAt: nowIso(),
        exitCode
      };
    }

    return {
      status: exitCode === 0 ? "ok" : "error",
      stdout,
      stderr,
      outputFiles: [],
      startedAt,
      finishedAt: nowIso(),
      exitCode
    };
  }

  private mockOutput(input: AgentInput, template: AgentTemplate, instance: AgentInstance): string {
    return [
      `[mock:${this.adapterName}] ${instance.agentId} executed ${input.taskId}`,
      `provider=${template.provider}`,
      `goal_context=${input.prompt.slice(0, 400)}`,
      "result=Generated placeholder output because CLI command is not installed."
    ].join("\n");
  }
}
