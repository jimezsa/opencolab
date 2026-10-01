import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRuntime } from "../src/runtime.js";

const REPO_ROOT = process.cwd();
const CLI_PATH = path.join(REPO_ROOT, "dist", "src", "cli.js");
const PACKAGE_VERSION = (() => {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  ) as { version?: unknown };
  return typeof parsed.version === "string" && parsed.version.trim()
    ? parsed.version.trim()
    : "unknown";
})();

function runCli(
  rootDir: string,
  args: string[],
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      OPENCOLAB_ROOT: rootDir,
    },
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

test("setup api-key saves one provider key without changing the active agent runtime", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-api-key-"),
  );
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const initialRuntime = createRuntime(tempDir);
    initialRuntime.init();
    const initialAgent = initialRuntime.getActiveAgent();

    const result = runCli(tempDir, [
      "setup",
      "api-key",
      "--provider",
      "gemini",
      "--api-key",
      "gemini_cli_test_key",
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.includes("Provider API key saved."), true);
    assert.equal(result.stdout.includes("Provider: gemini"), true);
    assert.equal(result.stdout.includes("Env var: GEMINI_API_KEY"), true);

    const envLocal = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envLocal.includes("GEMINI_API_KEY=gemini_cli_test_key"), true);

    const reloadedRuntime = createRuntime(tempDir);
    reloadedRuntime.init();
    const reloadedAgent = reloadedRuntime.getActiveAgent();
    assert.equal(reloadedAgent.provider.name, initialAgent.provider.name);
    assert.equal(reloadedAgent.provider.model, initialAgent.provider.model);
    assert.equal(
      reloadedAgent.provider.authMode,
      initialAgent.provider.authMode,
    );
  } finally {
    if (previousGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousGeminiKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setup model stores native reasoning effort for supported models", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-setup-model-effort-"),
  );

  try {
    const runtime = createRuntime(tempDir);
    runtime.init();

    const result = runCli(tempDir, [
      "setup",
      "model",
      "--provider",
      "openai",
      "--auth",
      "oauth",
      "--model",
      "gpt-5.5",
      "--reasoning-effort",
      "xhigh",
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.includes("Provider configured: openai"), true);
    assert.equal(result.stdout.includes("Model: gpt-5.5"), true);
    assert.equal(result.stdout.includes("Auth mode: oauth"), true);
    assert.equal(result.stdout.includes("Reasoning effort: xhigh"), true);

    const reloadedRuntime = createRuntime(tempDir);
    reloadedRuntime.init();
    const reloadedAgent = reloadedRuntime.getActiveAgent();
    assert.equal(reloadedAgent.provider.name, "openai");
    assert.equal(reloadedAgent.provider.authMode, "oauth");
    assert.equal(reloadedAgent.provider.reasoningEffort, "xhigh");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("bare CLI help shows the installed version immediately", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-version-help-"),
  );

  try {
    const result = runCli(tempDir, []);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.includes(`OpenColab v${PACKAGE_VERSION}`), true);
    assert.equal(result.stdout.includes("multi-agent research lab"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("--version prints the installed CLI version", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-version-flag-"),
  );

  try {
    const result = runCli(tempDir, ["--version"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), `opencolab ${PACKAGE_VERSION}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("version command prints the installed CLI version", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-version-command-"),
  );

  try {
    const result = runCli(tempDir, ["version"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), `opencolab ${PACKAGE_VERSION}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gpu server add stores a Runpod target and gpu server list shows it", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-gpu-server-"),
  );

  try {
    const runtime = createRuntime(tempDir);
    runtime.init();

    const addResult = runCli(tempDir, [
      "gpu",
      "server",
      "add",
      "--provider",
      "runpod",
      "--server-id",
      "runpod-a100",
      "--datacenter-id",
      "US-KS-2",
      "--gpu-type",
      "NVIDIA A100 80GB PCIe",
      "--gpu-count",
      "1",
      "--volume-name",
      "default-runpod-a100",
      "--volume-size-gb",
      "200",
    ]);

    assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);
    assert.equal(
      addResult.stdout.includes("GPU server configured: runpod-a100"),
      true,
    );
    assert.equal(addResult.stdout.includes("Provider: runpod"), true);

    const listResult = runCli(tempDir, ["gpu", "server", "list"]);
    assert.equal(listResult.status, 0, listResult.stderr || listResult.stdout);
    assert.equal(
      listResult.stdout.includes(
        "runpod-a100 [runpod] 1x NVIDIA A100 80GB PCIe @ US-KS-2",
      ),
      true,
    );

    const reloadedRuntime = createRuntime(tempDir);
    reloadedRuntime.init();
    const target = reloadedRuntime.getExecutionTarget("runpod-a100");
    assert.equal(target.volume.name, "default-runpod-a100");
    assert.equal(target.volume.sizeGb, 200);
    assert.deepEqual(target.preferredDatacenterIds, ["US-KS-2"]);
    assert.deepEqual(target.preferredGpuTypes, ["NVIDIA A100 80GB PCIe"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gpu server add accepts ordered location and GPU candidates", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-gpu-server-candidates-"),
  );

  try {
    const runtime = createRuntime(tempDir);
    runtime.init();

    const addResult = runCli(tempDir, [
      "gpu",
      "server",
      "add",
      "--provider",
      "runpod",
      "--server-id",
      "runpod-flex",
      "--location",
      "US-KS-2,CA-MTL-1",
      "--gpu-type",
      "NVIDIA A100 80GB PCIe,NVIDIA RTX 4090",
      "--gpu-count",
      "1",
    ]);

    assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);
    assert.equal(
      addResult.stdout.includes(
        "GPU candidates: NVIDIA A100 80GB PCIe, NVIDIA RTX 4090",
      ),
      true,
    );
    assert.equal(
      addResult.stdout.includes("Location candidates: US-KS-2, CA-MTL-1"),
      true,
    );

    const reloadedRuntime = createRuntime(tempDir);
    reloadedRuntime.init();
    const target = reloadedRuntime.getExecutionTarget("runpod-flex");
    assert.deepEqual(target.preferredDatacenterIds, ["US-KS-2", "CA-MTL-1"]);
    assert.deepEqual(target.preferredGpuTypes, [
      "NVIDIA A100 80GB PCIe",
      "NVIDIA RTX 4090",
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gpu server help describes the availability command", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-gpu-server-help-"),
  );

  try {
    const result = runCli(tempDir, ["gpu", "server", "--help"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      result.stdout.includes(
        "opencolab gpu server availability --server-id <id>",
      ),
      true,
    );
    assert.equal(
      result.stdout.includes(
        "Check live Runpod datacenter and GPU availability for one target",
      ),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gpu job help describes the exec command", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-gpu-job-help-"),
  );

  try {
    const result = runCli(tempDir, ["gpu", "job", "--help"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      result.stdout.includes(
        "opencolab gpu job exec --run-id <id> --command <command>",
      ),
      true,
    );
    assert.equal(
      result.stdout.includes(
        "Run one bounded remote command over the launched Pod SSH path",
      ),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gpu ssh help describes profile and session commands", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-gpu-ssh-help-"),
  );

  try {
    const result = runCli(tempDir, ["gpu", "ssh", "--help"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      result.stdout.includes("opencolab gpu ssh profile [subcommand]"),
      true,
    );
    assert.equal(
      result.stdout.includes("opencolab gpu ssh session [subcommand]"),
      true,
    );
    assert.equal(
      result.stdout.includes(
        "opencolab gpu ssh session start --profile-id runpod-manual-a100",
      ),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gpu ssh session help shows live session examples and flags", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-gpu-ssh-session-help-"),
  );

  try {
    const result = runCli(tempDir, ["gpu", "ssh", "session", "--help"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      result.stdout.includes(
        "opencolab gpu ssh session read --session-id manual-ssh-session-123 --offset 0",
      ),
      true,
    );
    assert.equal(
      result.stdout.includes(
        'opencolab gpu ssh session write --session-id manual-ssh-session-123 --stdin "nvidia-smi"',
      ),
      true,
    );
    assert.equal(result.stdout.includes("--append-newline true|false"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gpu ssh profile save persists a manual Pod SSH profile and default", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-gpu-ssh-profile-"),
  );

  try {
    const runtime = createRuntime(tempDir);
    runtime.init();

    const saveResult = runCli(tempDir, [
      "gpu",
      "ssh",
      "profile",
      "save",
      "--profile-id",
      "runpod-manual-a100",
      "--pod-id",
      "pod_123",
      "--ssh-command",
      "ssh -p 21438 -i ~/.ssh/id_ed25519 root@203.0.113.10",
      "--set-default",
      "true",
    ]);

    assert.equal(saveResult.status, 0, saveResult.stderr || saveResult.stdout);
    assert.equal(
      saveResult.stdout.includes(
        "Manual SSH profile saved: runpod-manual-a100",
      ),
      true,
    );
    assert.equal(saveResult.stdout.includes("Runpod Pod: pod_123"), true);

    const listResult = runCli(tempDir, ["gpu", "ssh", "profile", "list"]);
    assert.equal(listResult.status, 0, listResult.stderr || listResult.stdout);
    assert.equal(
      listResult.stdout.includes("* runpod-manual-a100 [runpod/manual_pod]"),
      true,
    );

    const reloadedRuntime = createRuntime(tempDir);
    reloadedRuntime.init();
    const project = reloadedRuntime.getActiveProject();
    assert.equal(project.manualSshProfiles["runpod-manual-a100"]?.port, 21438);
    assert.equal(
      project.agentRemoteDefaults[reloadedRuntime.getActiveAgent().id]
        ?.manualSshProfileId,
      "runpod-manual-a100",
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("upgrade help describes git and packaged install flows", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencolab-cli-upgrade-help-"),
  );

  try {
    const result = runCli(tempDir, ["upgrade", "--help"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      result.stdout.includes(
        "Upgrade an installer-managed OpenColab or a git/source checkout",
      ),
      true,
    );
    assert.equal(
      result.stdout.includes(
        "Git/source installs switch to branch main and fast-forward to origin/main.",
      ),
      true,
    );
    assert.equal(
      result.stdout.includes(
        "One-link installer installs upgrade the managed package or managed clone behind the shim.",
      ),
      true,
    );
    assert.equal(
      result.stdout.includes(
        "Generic package installs without installer metadata print package-manager upgrade guidance instead.",
      ),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

async function seedTwoProjectBots(rootDir: string): Promise<void> {
  const runtime = createRuntime(rootDir, {
    telegramIdentityFetcher: async (token) => ({
      telegramBotId: `tg-${token}`,
      username: `${token}_handle`,
    }),
  });
  runtime.init();
  runtime.createProject("alpha");
  runtime.createProject("beta");
  await runtime.addTelegramBot({
    token: "alpha_token",
    botId: "alpha_bot",
    projectId: "alpha",
    chatId: "111",
  });
  await runtime.addTelegramBot({
    token: "beta_token",
    botId: "beta_bot",
    projectId: "beta",
    chatId: "222",
  });
  runtime.markTelegramPaired("111", "alpha_bot");
  runtime.markTelegramPaired("222", "beta_bot");
}

test("telegram help describes the per-project bot commands", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-tg-help-"));

  try {
    const result = runCli(tempDir, ["telegram", "--help"]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes("opencolab telegram bot add"), true);
    assert.equal(result.stdout.includes("opencolab telegram bot bind"), true);
    assert.equal(result.stdout.includes("opencolab telegram bot pin"), true);
    assert.equal(
      result.stdout.includes("One project owns at most one enabled bot"),
      true,
    );
    assert.equal(
      result.stdout.includes(
        "Messages to a bot route to its project regardless of the active project",
      ),
      true,
    );
    assert.equal(
      result.stdout.includes("Tokens live only in .env.local"),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("telegram bot list explains how to add the first bot", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-tg-empty-"));

  try {
    const runtime = createRuntime(tempDir);
    runtime.init();

    const result = runCli(tempDir, ["telegram", "bot", "list"]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes("No Telegram bots configured."), true);
    assert.equal(result.stdout.includes("opencolab telegram bot add"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("telegram bot list shows each binding and which bot owns each project", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-tg-list-"));

  try {
    await seedTwoProjectBots(tempDir);

    const result = runCli(tempDir, ["telegram", "bot", "list"]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes("Telegram bots (2)"), true);
    assert.equal(result.stdout.includes("alpha_bot @alpha_token_handle"), true);
    assert.equal(result.stdout.includes("target: project alpha"), true);
    assert.equal(result.stdout.includes("target: project beta"), true);

    // Project coverage must name the owner, and say so plainly when there is none.
    assert.equal(result.stdout.includes("Project notification owners"), true);
    assert.equal(result.stdout.includes("- alpha: alpha_bot"), true);
    assert.equal(
      result.stdout.includes(
        "- default: none (heartbeat + workflow updates are skipped)",
      ),
      true,
    );

    const json = runCli(tempDir, ["telegram", "bot", "list", "--json"]);
    const parsed = JSON.parse(json.stdout) as Array<{
      id: string;
      tokenEnvVar: string;
      tokenPresent: boolean;
    }>;
    assert.deepEqual(
      parsed.map((bot) => bot.id),
      ["alpha_bot", "beta_bot"],
    );
    assert.equal(parsed[0].tokenEnvVar, "TELEGRAM_BOT_TOKEN_ALPHA_BOT");
    assert.equal(parsed[0].tokenPresent, true);
    // The listing carries env var names, never token values.
    assert.equal(json.stdout.includes("alpha_token"), true, "username is derived from it");
    assert.equal(
      parsed.every((bot) => !/^\d+:/.test(bot.tokenEnvVar)),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("telegram bot bind rejects a project that another enabled bot already owns", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-tg-conflict-"));

  try {
    await seedTwoProjectBots(tempDir);

    const result = runCli(tempDir, [
      "telegram",
      "bot",
      "bind",
      "--id",
      "beta_bot",
      "--project",
      "alpha",
    ]);
    assert.notEqual(result.status, 0);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(output.includes("already bound to Telegram bot 'alpha_bot'"), true);

    // The refused bind left beta_bot where it was.
    const after = runCli(tempDir, ["telegram", "bot", "show", "--id", "beta_bot", "--json"]);
    const parsed = JSON.parse(after.stdout) as { projectId: string };
    assert.equal(parsed.projectId, "beta");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("telegram bot pin and unbind move a bot between pinned and legacy modes", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-tg-pin-"));

  try {
    await seedTwoProjectBots(tempDir);

    const unbound = runCli(tempDir, ["telegram", "bot", "unbind", "--id", "alpha_bot"]);
    assert.equal(unbound.status, 0);
    assert.equal(unbound.stdout.includes("floating again"), true);

    const pinned = runCli(tempDir, [
      "telegram",
      "bot",
      "pin",
      "--id",
      "alpha_bot",
      "--project",
      "alpha",
    ]);
    assert.equal(pinned.status, 0);
    assert.equal(pinned.stdout.includes("pinned to project alpha"), true);
    assert.equal(
      pinned.stdout.includes("no longer follows the active project"),
      true,
    );

    const shown = runCli(tempDir, ["telegram", "bot", "show", "--id", "alpha_bot", "--json"]);
    const parsed = JSON.parse(shown.stdout) as { scope: string; projectId: string };
    assert.equal(parsed.scope, "pinned");
    assert.equal(parsed.projectId, "alpha");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("telegram bot remove deletes the profile and its token", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-tg-remove-"));

  try {
    await seedTwoProjectBots(tempDir);
    const envBefore = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envBefore.includes("TELEGRAM_BOT_TOKEN_BETA_BOT"), true);

    const removed = runCli(tempDir, ["telegram", "bot", "remove", "--id", "beta_bot"]);
    assert.equal(removed.status, 0);
    assert.equal(removed.stdout.includes("Bot 'beta_bot' removed."), true);
    assert.equal(
      removed.stdout.includes("Removed TELEGRAM_BOT_TOKEN_BETA_BOT from .env.local."),
      true,
    );
    assert.equal(removed.stdout.includes("/revoke"), true);

    const envAfter = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envAfter.includes("TELEGRAM_BOT_TOKEN_BETA_BOT"), false);
    assert.equal(envAfter.includes("TELEGRAM_BOT_TOKEN_ALPHA_BOT"), true);

    const list = runCli(tempDir, ["telegram", "bot", "list", "--json"]);
    const parsed = JSON.parse(list.stdout) as Array<{ id: string }>;
    assert.deepEqual(
      parsed.map((bot) => bot.id),
      ["alpha_bot"],
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("telegram bot remove --keep-token leaves the secret in place", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-tg-keep-token-"));

  try {
    await seedTwoProjectBots(tempDir);

    const removed = runCli(tempDir, [
      "telegram",
      "bot",
      "remove",
      "--id",
      "beta_bot",
      "--keep-token",
    ]);
    assert.equal(removed.status, 0);
    assert.equal(
      removed.stdout.includes("Left TELEGRAM_BOT_TOKEN_BETA_BOT in .env.local."),
      true,
    );

    const envAfter = fs.readFileSync(path.join(tempDir, ".env.local"), "utf8");
    assert.equal(envAfter.includes("TELEGRAM_BOT_TOKEN_BETA_BOT"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("telegram bot commands require an explicit bot id", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-cli-tg-id-required-"));

  try {
    await seedTwoProjectBots(tempDir);

    const result = runCli(tempDir, ["telegram", "bot", "show"]);
    assert.notEqual(result.status, 0);
    assert.equal(`${result.stdout}${result.stderr}`.includes("--id"), true);

    const unknown = runCli(tempDir, ["telegram", "bot", "show", "--id", "nope"]);
    assert.notEqual(unknown.status, 0);
    const output = `${unknown.stdout}${unknown.stderr}`;
    assert.equal(output.includes("Unknown Telegram bot: nope"), true);
    assert.equal(output.includes("known: alpha_bot, beta_bot"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
