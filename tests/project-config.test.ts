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

    assert.equal(agent.id, "researcher_agent");
    assert.equal(agent.path, "projects/default");
    assert.equal(agent.files.agents, "AGENTS.md");
    assert.equal(agent.files.bootstrap, "BOOTSTRAP.md");
    assert.equal(agent.files.identity, "IDENTITY.md");
    assert.equal(agent.files.alma, "ALMA.md");
    assert.equal(agent.files.tools, "TOOLS.md");
    assert.equal(agent.files.user, "USER.md");
    assert.equal(agent.files.todo, "TODO.md");
    assert.equal(agent.files.memory, "MEMORY.md");
    assert.equal(agent.provider.name, "anthropic");
    assert.equal(agent.provider.runtime, "claude");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(state.telegram.paired, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state migrates legacy project provider into agent config", () => {
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
            activeAgentId: "researcher_agent",
            agents: {
              researcher_agent: {
                id: "researcher_agent",
                path: "projects/alpha",
                files: {
                  agents: "AGENTS.md",
                  bootstrap: "BOOTSTRAP.md",
                  identity: "IDENTITY.md",
                  alma: "ALMA.md",
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
    const agent = project.agents[project.activeAgentId];
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
      "{project_dir}"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state prefers explicit agent provider over legacy project provider", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-agent-provider-"));

  try {
    const config = loadConfig(tempDir);
    fs.writeFileSync(
      config.projectConfigPath,
      JSON.stringify({
        activeProjectId: "alpha",
        projects: {
          alpha: {
            id: "alpha",
            path: "projects/alpha",
            activeAgentId: "researcher_agent",
            agents: {
              researcher_agent: {
                id: "researcher_agent",
                path: "projects/alpha",
                provider: {
                  name: "minimax",
                  model: "MiniMax-M2.5"
                },
                files: {
                  agents: "AGENTS.md",
                  bootstrap: "BOOTSTRAP.md",
                  identity: "IDENTITY.md",
                  alma: "ALMA.md",
                  tools: "TOOLS.md",
                  user: "USER.md",
                  todo: "TODO.md",
                  memory: "MEMORY.md"
                }
              }
            },
            provider: {
              name: "openai"
            }
          }
        }
      }),
      "utf8"
    );

    const loaded = readProjectState(config);
    const agent = loaded.projects.alpha.agents.researcher_agent;
    assert.equal(agent.provider.name, "minimax");
    assert.equal(agent.provider.runtime, "claude");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.cliCommand, "claude");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state migrates legacy provider CLI defaults to workspace defaults on the agent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-provider-cli-migrate-"));

  try {
    const config = loadConfig(tempDir);
    fs.writeFileSync(
      config.projectConfigPath,
      JSON.stringify({
        activeProjectId: "alpha",
        projects: {
          alpha: {
            id: "alpha",
            path: "projects/alpha",
            activeAgentId: "researcher_agent",
            agents: {
              researcher_agent: {
                id: "researcher_agent",
                path: "projects/alpha",
                files: {
                  agents: "AGENTS.md",
                  bootstrap: "BOOTSTRAP.md",
                  identity: "IDENTITY.md",
                  alma: "ALMA.md",
                  tools: "TOOLS.md",
                  user: "USER.md",
                  todo: "TODO.md",
                  memory: "MEMORY.md"
                }
              }
            },
            provider: {
              name: "codex",
              cliCommand: "codex",
              cliArgs: ["exec", "-"]
            }
          }
        }
      }),
      "utf8"
    );

    const loaded = readProjectState(config);
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.authMode, "api_key");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.runtime, "codex");
    assert.deepEqual(loaded.projects.alpha.agents.researcher_agent.provider.cliArgs, [
      "exec",
      "--full-auto",
      "--add-dir",
      "{project_dir}",
      "-"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state preserves custom provider CLI defaults on the agent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-provider-cli-custom-"));

  try {
    const config = loadConfig(tempDir);
    fs.writeFileSync(
      config.projectConfigPath,
      JSON.stringify({
        activeProjectId: "alpha",
        projects: {
          alpha: {
            id: "alpha",
            path: "projects/alpha",
            activeAgentId: "researcher_agent",
            agents: {
              researcher_agent: {
                id: "researcher_agent",
                path: "projects/alpha",
                provider: {
                  name: "openai",
                  cliCommand: "codex",
                  cliArgs: ["exec", "--sandbox", "danger-full-access", "-"]
                },
                files: {
                  agents: "AGENTS.md",
                  bootstrap: "BOOTSTRAP.md",
                  identity: "IDENTITY.md",
                  alma: "ALMA.md",
                  tools: "TOOLS.md",
                  user: "USER.md",
                  todo: "TODO.md",
                  memory: "MEMORY.md"
                }
              }
            }
          }
        }
      }),
      "utf8"
    );

    const loaded = readProjectState(config);
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.authMode, "api_key");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.runtime, "codex");
    assert.deepEqual(loaded.projects.alpha.agents.researcher_agent.provider.cliArgs, [
      "exec",
      "--sandbox",
      "danger-full-access",
      "-"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state persists agent provider updates in opencolab.json", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-persist-"));

  try {
    const config = loadConfig(tempDir);

    updateProjectState(config, (current) => {
      const project = current.projects[current.activeProjectId];
      const agent = project.agents[project.activeAgentId];

      return {
        ...current,
        projects: {
          ...current.projects,
          [project.id]: {
            ...project,
            agents: {
              ...project.agents,
              [agent.id]: {
                ...agent,
                provider: {
                  ...agent.provider,
                  model: "gpt-5-research"
                }
              }
            }
          }
        },
        telegram: {
          ...current.telegram,
          chatId: "10001",
          paired: true,
          pairedAt: "2026-02-27T00:00:00.000Z"
        }
      };
    });

    const loaded = readProjectState(config);
    const project = loaded.projects[loaded.activeProjectId];
    const agent = project.agents[project.activeAgentId];

    assert.equal(agent.provider.model, "gpt-5-research");
    assert.equal(loaded.telegram.chatId, "10001");
    assert.equal(loaded.telegram.paired, true);
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
            bootstrap: "BOOTSTRAP.md",
            identity: "IDENTITY.md",
            alma: "ALMA.md",
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
    assert.equal(project.agents.legacy_agent.provider.name, "openai");
    assert.equal(project.agents.legacy_agent.provider.runtime, "codex");
    assert.equal(project.agents.legacy_agent.provider.authMode, "api_key");
    assert.equal(loaded.telegram.chatId, "10001");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state migrates legacy per-project telegram shape", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-legacy-project-telegram-"));

  try {
    const config = loadConfig(tempDir);
    fs.writeFileSync(
      config.projectConfigPath,
      JSON.stringify({
        activeProjectId: "alpha",
        projects: {
          alpha: {
            id: "alpha",
            path: "projects/alpha",
            activeAgentId: "researcher_agent",
            agents: {
              researcher_agent: {
                id: "researcher_agent",
                path: "projects/alpha",
                files: {
                  agents: "AGENTS.md",
                  bootstrap: "BOOTSTRAP.md",
                  identity: "IDENTITY.md",
                  alma: "ALMA.md",
                  tools: "TOOLS.md",
                  user: "USER.md",
                  memory: "MEMORY.md"
                }
              }
            },
            provider: {
              name: "codex"
            },
            telegram: {
              botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
              chatId: "55555",
              paired: true,
              pairedAt: "2026-02-27T00:00:00.000Z"
            }
          }
        }
      }),
      "utf8"
    );

    const loaded = readProjectState(config);
    assert.equal(loaded.activeProjectId, "alpha");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.name, "openai");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.runtime, "codex");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.authMode, "api_key");
    assert.equal(loaded.telegram.chatId, "55555");
    assert.equal(loaded.telegram.paired, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state preserves OpenAI oauth auth mode", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-openai-oauth-"));

  try {
    const config = loadConfig(tempDir);
    fs.writeFileSync(
      config.projectConfigPath,
      JSON.stringify({
        activeProjectId: "alpha",
        projects: {
          alpha: {
            id: "alpha",
            path: "projects/alpha",
            activeAgentId: "researcher_agent",
            agents: {
              researcher_agent: {
                id: "researcher_agent",
                path: "projects/alpha",
                provider: {
                  name: "openai",
                  model: "gpt-5.3-codex",
                  authMode: "oauth"
                },
                files: {
                  agents: "AGENTS.md",
                  bootstrap: "BOOTSTRAP.md",
                  identity: "IDENTITY.md",
                  alma: "ALMA.md",
                  tools: "TOOLS.md",
                  user: "USER.md",
                  todo: "TODO.md",
                  memory: "MEMORY.md"
                }
              }
            }
          }
        }
      }),
      "utf8"
    );

    const loaded = readProjectState(config);
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.runtime, "codex");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.authMode, "oauth");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state preserves Gemini oauth auth mode and concrete model name", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-gemini-oauth-"));

  try {
    const config = loadConfig(tempDir);
    fs.writeFileSync(
      config.projectConfigPath,
      JSON.stringify({
        activeProjectId: "alpha",
        projects: {
          alpha: {
            id: "alpha",
            path: "projects/alpha",
            activeAgentId: "researcher_agent",
            agents: {
              researcher_agent: {
                id: "researcher_agent",
                path: "projects/alpha",
                provider: {
                  name: "gemini",
                  model: "gemini-2.5-pro",
                  authMode: "oauth"
                },
                files: {
                  agents: "AGENTS.md",
                  bootstrap: "BOOTSTRAP.md",
                  identity: "IDENTITY.md",
                  alma: "ALMA.md",
                  tools: "TOOLS.md",
                  user: "USER.md",
                  todo: "TODO.md",
                  memory: "MEMORY.md"
                }
              }
            }
          }
        }
      }),
      "utf8"
    );

    const loaded = readProjectState(config);
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.name, "gemini");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.runtime, "gemini");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.model, "gemini-2.5-pro");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.authMode, "oauth");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state preserves xAI provider runtime and model", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-xai-pi-"));

  try {
    const config = loadConfig(tempDir);
    fs.writeFileSync(
      config.projectConfigPath,
      JSON.stringify({
        activeProjectId: "alpha",
        projects: {
          alpha: {
            id: "alpha",
            path: "projects/alpha",
            activeAgentId: "researcher_agent",
            agents: {
              researcher_agent: {
                id: "researcher_agent",
                path: "projects/alpha",
                provider: {
                  name: "xai",
                  model: "grok-code-fast-1"
                },
                files: {
                  agents: "AGENTS.md",
                  bootstrap: "BOOTSTRAP.md",
                  identity: "IDENTITY.md",
                  alma: "ALMA.md",
                  tools: "TOOLS.md",
                  user: "USER.md",
                  todo: "TODO.md",
                  memory: "MEMORY.md"
                }
              }
            }
          }
        }
      }),
      "utf8"
    );

    const loaded = readProjectState(config);
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.name, "xai");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.runtime, "pi");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.model, "grok-code-fast-1");
    assert.equal(loaded.projects.alpha.agents.researcher_agent.provider.cliCommand, "pi");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
