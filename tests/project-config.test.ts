import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { readProjectState, updateProjectState } from "../src/project-config.js";

test("project state defaults to a default project and agent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-default-"));

  try {
    const config = loadConfig(tempDir);
    const state = readProjectState(config);
    const project = state.projects[state.activeProjectId];
    const agent = project.agents[project.activeAgentId];

    assert.equal(state.activeProjectId, "default");
    assert.equal(project.id, "default");
    assert.equal(project.path, "projects/default");

    assert.equal(agent.id, "research_agent");
    assert.equal(agent.path, "projects/default/agents/research_agent");
    assert.equal(agent.files.agents, "AGENTS.md");
    assert.equal(agent.files.identity, "IDENTITY.md");
    assert.equal(agent.files.soul, "SOUL.md");
    assert.equal(agent.files.tools, "TOOLS.md");
    assert.equal(agent.files.user, "USER.md");
    assert.equal(agent.files.memory, "MEMORY.md");

    assert.equal(project.provider.name, "codex");
    assert.equal(project.provider.apiKeyEnvVar, "OPENAI_API_KEY");
    assert.equal(project.telegram.paired, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state normalizes supported provider name in nested project config", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-provider-"));

  try {
    const config = loadConfig(tempDir);
    fs.writeFileSync(
      config.projectConfigPath,
      JSON.stringify({
        activeProjectId: "alpha",
        projects: {
          alpha: {
            id: "alpha",
            activeAgentId: "research_agent",
            agents: {
              research_agent: {
                id: "research_agent",
                path: "projects/alpha/agents/research_agent",
                files: {
                  agents: "AGENTS.md",
                  identity: "IDENTITY.md",
                  soul: "SOUL.md",
                  tools: "TOOLS.md",
                  user: "USER.md",
                  memory: "MEMORY.md"
                }
              }
            },
            provider: {
              name: "claude_code"
            }
          }
        }
      }),
      "utf8"
    );

    const loaded = readProjectState(config);
    const project = loaded.projects[loaded.activeProjectId];
    assert.equal(project.provider.name, "claude_code");
    assert.equal(project.provider.apiKeyEnvVar, "ANTHROPIC_API_KEY");
    assert.equal(project.provider.cliCommand, "claude");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state persists updates in opencolab.json", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-persist-"));

  try {
    const config = loadConfig(tempDir);

    updateProjectState(config, (current) => {
      const project = current.projects[current.activeProjectId];

      return {
        ...current,
        projects: {
          ...current.projects,
          [project.id]: {
            ...project,
            provider: {
              ...project.provider,
              model: "gpt-5-research"
            },
            telegram: {
              ...project.telegram,
              chatId: "10001",
              paired: true,
              pairedAt: "2026-02-27T00:00:00.000Z"
            }
          }
        }
      };
    });

    const loaded = readProjectState(config);
    const project = loaded.projects[loaded.activeProjectId];

    assert.equal(project.provider.model, "gpt-5-research");
    assert.equal(project.telegram.chatId, "10001");
    assert.equal(project.telegram.paired, true);
    assert.equal(fs.existsSync(config.projectConfigPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state migrates legacy single-agent shape", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-legacy-"));

  try {
    const config = loadConfig(tempDir);
    fs.writeFileSync(
      config.projectConfigPath,
      JSON.stringify({
        agent: {
          id: "legacy_agent",
          path: "agents/legacy_agent",
          files: {
            agents: "AGENTS.md",
            identity: "IDENTITY.md",
            soul: "SOUL.md",
            tools: "TOOLS.md",
            user: "USER.md",
            memory: "MEMORY.md"
          }
        },
        provider: {
          name: "codex",
          model: "gpt-5"
        },
        telegram: {
          botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
          chatId: "10001",
          paired: true
        }
      }),
      "utf8"
    );

    const loaded = readProjectState(config);
    const project = loaded.projects[loaded.activeProjectId];

    assert.equal(loaded.activeProjectId, "default");
    assert.equal(project.activeAgentId, "legacy_agent");
    assert.equal(project.agents.legacy_agent.path, "agents/legacy_agent");
    assert.equal(project.provider.name, "codex");
    assert.equal(project.telegram.chatId, "10001");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
