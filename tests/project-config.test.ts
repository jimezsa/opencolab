import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import {
  createDefaultExecutionTargetConfig,
  readProjectState,
  updateProjectState
} from "../src/project-config.js";

const DEFAULT_AGENT_ID = "professor";

function buildDefaultAgentPath(projectId: string): string {
  return `projects/${projectId}/AGENTS/${DEFAULT_AGENT_ID}`;
}

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

    assert.equal(agent.id, DEFAULT_AGENT_ID);
    assert.equal(agent.path, buildDefaultAgentPath("default"));
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
    assert.deepEqual(project.executionTargets, {});
    assert.equal(state.telegram.paired, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("default Runpod execution targets use the pytorch-cu12 bootstrap profile and keep_warm policy", () => {
  const target = createDefaultExecutionTargetConfig("runpod-a100");
  assert.equal(target.bootstrapProfile, "pytorch-cu12");
  assert.equal(target.autoStopPolicy, "keep_warm");
});

test("project state normalizes project-scoped execution targets", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-execution-targets-"));

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
            activeAgentId: DEFAULT_AGENT_ID,
            executionTargets: {
              "runpod-a100": {
                id: "runpod-a100",
                backend: "runpod",
                enabled: true,
                datacenterId: "US-KS-2",
                preferredDatacenterIds: ["US-KS-2", "CA-MTL-1"],
                cloudType: "secure",
                gpuType: "NVIDIA A100 80GB PCIe",
                preferredGpuTypes: ["NVIDIA A100 80GB PCIe", "NVIDIA RTX 4090"],
                gpuCount: 1,
                volume: {
                  mode: "network_volume",
                  id: "vol_123",
                  name: "alpha-runpod-a100",
                  sizeGb: 200
                },
                ssh: {
                  mode: "public_ip",
                  user: "root",
                  privateKeyPath: "~/.ssh/id_ed25519"
                },
                workspaceRoot: "/workspace",
                bootstrapProfile: "python-ml",
                maxRuntimeMinutes: 360,
                autoStopPolicy: "stop_on_completion"
              }
            },
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
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
    const target = loaded.projects.alpha.executionTargets["runpod-a100"];
    assert.equal(target.backend, "runpod");
    assert.equal(target.enabled, true);
    assert.equal(target.datacenterId, "US-KS-2");
    assert.deepEqual(target.preferredDatacenterIds, ["US-KS-2", "CA-MTL-1"]);
    assert.equal(target.cloudType, "secure");
    assert.equal(target.gpuType, "NVIDIA A100 80GB PCIe");
    assert.deepEqual(target.preferredGpuTypes, ["NVIDIA A100 80GB PCIe", "NVIDIA RTX 4090"]);
    assert.equal(target.volume.id, "vol_123");
    assert.equal(target.volume.name, "alpha-runpod-a100");
    assert.equal(target.ssh.user, "root");
    assert.equal(target.ssh.privateKeyPath, "~/.ssh/id_ed25519");
    assert.equal(target.bootstrapProfile, "python-ml");
    assert.equal(target.autoStopPolicy, "stop_on_completion");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state infers fallback candidate lists from legacy fixed Runpod fields", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-execution-target-legacy-"));

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
            activeAgentId: DEFAULT_AGENT_ID,
            executionTargets: {
              "runpod-a100": {
                id: "runpod-a100",
                backend: "runpod",
                datacenterId: "US-KS-2",
                gpuType: "NVIDIA A100 80GB PCIe"
              }
            },
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
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
    const target = loaded.projects.alpha.executionTargets["runpod-a100"];
    assert.deepEqual(target.preferredDatacenterIds, ["US-KS-2"]);
    assert.deepEqual(target.preferredGpuTypes, ["NVIDIA A100 80GB PCIe"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state normalizes saved manual SSH profiles and agent defaults", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-manual-ssh-"));

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
            activeAgentId: DEFAULT_AGENT_ID,
            manualSshProfiles: {
              "runpod-manual-a100": {
                id: "runpod-manual-a100",
                backend: "runpod",
                mode: "manual_pod",
                podId: "pod_123",
                host: "203.0.113.10",
                port: 21438,
                user: "root",
                privateKeyPath: "~/.ssh/id_ed25519",
                workspaceRoot: "/workspace",
                interactiveAccess: "opt_in"
              }
            },
            agentRemoteDefaults: {
              [DEFAULT_AGENT_ID]: {
                manualSshProfileId: "runpod-manual-a100"
              }
            },
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
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
    const profile = loaded.projects.alpha.manualSshProfiles["runpod-manual-a100"];
    assert.equal(profile.backend, "runpod");
    assert.equal(profile.mode, "manual_pod");
    assert.equal(profile.podId, "pod_123");
    assert.equal(profile.host, "203.0.113.10");
    assert.equal(profile.port, 21438);
    assert.equal(profile.privateKeyPath, "~/.ssh/id_ed25519");
    assert.equal(profile.workspaceRoot, "/workspace");
    assert.equal(profile.interactiveAccess, "opt_in");
    assert.equal(
      loaded.projects.alpha.agentRemoteDefaults[DEFAULT_AGENT_ID]?.manualSshProfileId,
      "runpod-manual-a100"
    );
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
            activeAgentId: DEFAULT_AGENT_ID,
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
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
      "--verbose",
      "--output-format",
      "stream-json",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}",
      "--",
      "{prompt}"
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
            activeAgentId: DEFAULT_AGENT_ID,
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
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
    const agent = loaded.projects.alpha.agents[DEFAULT_AGENT_ID];
    assert.equal(agent.provider.name, "minimax");
    assert.equal(agent.provider.runtime, "claude");
    assert.equal(agent.provider.authMode, "api_key");
    assert.equal(agent.provider.cliCommand, "claude");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state migrates previously shipped Claude workspace args to the current streaming defaults", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-claude-stream-migrate-"));

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
            activeAgentId: DEFAULT_AGENT_ID,
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
                files: {
                  agents: "AGENTS.md",
                  bootstrap: "BOOTSTRAP.md",
                  identity: "IDENTITY.md",
                  alma: "ALMA.md",
                  tools: "TOOLS.md",
                  user: "USER.md",
                  memory: "MEMORY.md"
                },
                provider: {
                  name: "anthropic",
                  model: "claude-opus-4-6",
                  runtime: "claude",
                  cliCommand: "claude",
                  cliArgs: [
                    "-p",
                    "{prompt}",
                    "--output-format",
                    "stream-json",
                    "--model",
                    "{model}",
                    "--permission-mode",
                    "bypassPermissions",
                    "--add-dir",
                    "{project_dir}",
                    "--add-dir",
                    "{shared_skills_dir}"
                  ],
                  authMode: "oauth"
                }
              }
            }
          }
        }
      }),
      "utf8"
    );

    const loaded = readProjectState(config);
    const project = loaded.projects[loaded.activeProjectId];
    const agent = project.agents[project.activeAgentId];
    assert.equal(agent.provider.name, "anthropic");
    assert.equal(agent.provider.runtime, "claude");
    assert.equal(agent.provider.authMode, "oauth");
    assert.equal(agent.provider.cliCommand, "claude");
    assert.deepEqual(agent.provider.cliArgs, [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}",
      "--",
      "{prompt}"
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state migrates older Claude workspace args without stream-json to the current defaults", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-claude-workspace-migrate-"));

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
            activeAgentId: DEFAULT_AGENT_ID,
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
                files: {
                  agents: "AGENTS.md",
                  bootstrap: "BOOTSTRAP.md",
                  identity: "IDENTITY.md",
                  alma: "ALMA.md",
                  tools: "TOOLS.md",
                  user: "USER.md",
                  memory: "MEMORY.md"
                },
                provider: {
                  name: "anthropic",
                  model: "claude-opus-4-6",
                  runtime: "claude",
                  cliCommand: "claude",
                  cliArgs: [
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
                  ],
                  authMode: "api_key"
                }
              }
            }
          }
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
      "--verbose",
      "--output-format",
      "stream-json",
      "--model",
      "{model}",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      "{project_dir}",
      "--add-dir",
      "{shared_skills_dir}",
      "--",
      "{prompt}"
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
            activeAgentId: DEFAULT_AGENT_ID,
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
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
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.authMode, "api_key");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.runtime, "codex");
    assert.deepEqual(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.cliArgs, [
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
                  model: "gpt-5.4"
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

    assert.equal(agent.provider.model, "gpt-5.4");
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
          model: "gpt-5.4"
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
            activeAgentId: DEFAULT_AGENT_ID,
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
                provider: {
                  name: "openai",
                  model: "gpt-5.4",
                  authMode: "oauth",
                  reasoningEffort: "xhigh"
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
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.runtime, "codex");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.authMode, "oauth");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.reasoningEffort, "xhigh");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state preserves Anthropic oauth auth mode", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-anthropic-oauth-"));

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
            activeAgentId: DEFAULT_AGENT_ID,
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
                provider: {
                  name: "anthropic",
                  model: "claude-opus-4-6",
                  authMode: "oauth",
                  reasoningEffort: "max"
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
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.name, "anthropic");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.runtime, "claude");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.authMode, "oauth");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.reasoningEffort, "max");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state leaves reasoning effort unset when it is absent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-openai-no-effort-"));

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
            activeAgentId: DEFAULT_AGENT_ID,
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
                provider: {
                  name: "openai",
                  model: "gpt-5.4",
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
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.reasoningEffort, undefined);
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
            activeAgentId: DEFAULT_AGENT_ID,
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
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
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.name, "gemini");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.runtime, "gemini");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.model, "gemini-2.5-pro");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.authMode, "oauth");
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
            activeAgentId: DEFAULT_AGENT_ID,
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
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
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.name, "xai");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.runtime, "pi");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.model, "grok-code-fast-1");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.cliCommand, "pi");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project state preserves Kimi provider runtime and model", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-state-kimi-pi-"));

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
            activeAgentId: DEFAULT_AGENT_ID,
            agents: {
              [DEFAULT_AGENT_ID]: {
                id: DEFAULT_AGENT_ID,
                path: buildDefaultAgentPath("alpha"),
                provider: {
                  name: "kimi",
                  model: "k2p5"
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
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.name, "kimi");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.runtime, "pi");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.model, "k2p5");
    assert.equal(loaded.projects.alpha.agents[DEFAULT_AGENT_ID].provider.cliCommand, "pi");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
