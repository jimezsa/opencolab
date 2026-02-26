import type { OpenColabConfig } from "./config.js";
import type { AgentInput, AgentInstance, AgentOutput, AgentTemplate } from "./types.js";
import { getAdapter } from "./adapters/index.js";

export class AgentRunner {
  constructor(private readonly config: OpenColabConfig) {}

  async runTask(
    input: AgentInput,
    template: AgentTemplate,
    instance: AgentInstance
  ): Promise<AgentOutput> {
    const adapter = getAdapter(template.provider);

    let lastOutput: AgentOutput | null = null;

    for (let attempt = 0; attempt <= instance.retryLimit; attempt += 1) {
      lastOutput = await adapter.run(input, template, instance, this.config);

      if (lastOutput.status === "ok") {
        return lastOutput;
      }

      if (lastOutput.status === "timeout") {
        return lastOutput;
      }
    }

    return lastOutput ?? {
      status: "error",
      stdout: "",
      stderr: "Agent did not execute",
      outputFiles: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: null
    };
  }
}
