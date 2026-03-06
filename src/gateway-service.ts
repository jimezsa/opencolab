/**
 * Background gateway service management.
 * Handles user-level launchd/systemd setup for persistent gateway execution.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir } from "./utils.js";

const LAUNCHD_LABEL = "com.opencolab.gateway";
const SYSTEMD_UNIT_NAME = "opencolab-gateway.service";

export type GatewayServicePlatform = "darwin" | "linux";

export interface GatewayServiceStartInput {
  rootDir: string;
  cliScriptPath: string;
  nodePath: string;
  port: number;
  telegramPolling: boolean;
}

export interface GatewayServiceFiles {
  platform: GatewayServicePlatform;
  launchdLabel: string;
  systemdUnitName: string;
  configPath: string;
  stdoutLogPath: string;
  stderrLogPath: string;
}

export interface GatewayServiceStatus {
  running: boolean;
  statusText: string;
}

export function detectGatewayServicePlatform(
  platform = process.platform,
): GatewayServicePlatform | null {
  if (platform === "darwin") {
    return "darwin";
  }
  if (platform === "linux") {
    return "linux";
  }
  return null;
}

export function resolveGatewayServiceFiles(rootDir: string): GatewayServiceFiles {
  const platform = detectGatewayServicePlatform();
  if (!platform) {
    throw new Error("Background gateway service is supported only on macOS and Linux.");
  }

  const stateDir = path.join(rootDir, ".opencolab");
  const logsDir = path.join(stateDir, "logs");

  if (platform === "darwin") {
    return {
      platform,
      launchdLabel: LAUNCHD_LABEL,
      systemdUnitName: SYSTEMD_UNIT_NAME,
      configPath: path.join(
        os.homedir(),
        "Library",
        "LaunchAgents",
        `${LAUNCHD_LABEL}.plist`,
      ),
      stdoutLogPath: path.join(logsDir, "gateway.stdout.log"),
      stderrLogPath: path.join(logsDir, "gateway.stderr.log"),
    };
  }

  return {
    platform,
    launchdLabel: LAUNCHD_LABEL,
    systemdUnitName: SYSTEMD_UNIT_NAME,
    configPath: path.join(
      os.homedir(),
      ".config",
      "systemd",
      "user",
      SYSTEMD_UNIT_NAME,
    ),
    stdoutLogPath: path.join(logsDir, "gateway.stdout.log"),
    stderrLogPath: path.join(logsDir, "gateway.stderr.log"),
  };
}

export function startGatewayBackgroundService(
  input: GatewayServiceStartInput,
): GatewayServiceFiles {
  const files = resolveGatewayServiceFiles(input.rootDir);
  ensureDir(path.dirname(files.configPath));
  ensureDir(path.dirname(files.stdoutLogPath));

  if (files.platform === "darwin") {
    fs.writeFileSync(
      files.configPath,
      renderLaunchdPlist({
        label: files.launchdLabel,
        nodePath: input.nodePath,
        cliScriptPath: input.cliScriptPath,
        rootDir: input.rootDir,
        port: input.port,
        telegramPolling: input.telegramPolling,
        pathEnv: process.env.PATH ?? "",
        stdoutLogPath: files.stdoutLogPath,
        stderrLogPath: files.stderrLogPath,
      }),
      "utf8",
    );
    runCommand("launchctl", ["unload", files.configPath], { allowFailure: true });
    runCommand("launchctl", ["load", "-w", files.configPath]);
    return files;
  }

  fs.writeFileSync(
    files.configPath,
    renderSystemdUnit({
      unitName: files.systemdUnitName,
      nodePath: input.nodePath,
      cliScriptPath: input.cliScriptPath,
      rootDir: input.rootDir,
      port: input.port,
      telegramPolling: input.telegramPolling,
      pathEnv: process.env.PATH ?? "",
      stdoutLogPath: files.stdoutLogPath,
      stderrLogPath: files.stderrLogPath,
    }),
    "utf8",
  );

  runCommand("systemctl", ["--user", "daemon-reload"]);
  runCommand("systemctl", ["--user", "enable", "--now", files.systemdUnitName]);
  return files;
}

export function stopGatewayBackgroundService(rootDir: string): GatewayServiceFiles {
  const files = resolveGatewayServiceFiles(rootDir);
  if (files.platform === "darwin") {
    runCommand("launchctl", ["unload", files.configPath], { allowFailure: true });
    return files;
  }

  runCommand("systemctl", ["--user", "stop", files.systemdUnitName], {
    allowFailure: true,
  });
  return files;
}

export function restartGatewayBackgroundService(
  input: GatewayServiceStartInput,
): GatewayServiceFiles {
  const files = resolveGatewayServiceFiles(input.rootDir);
  if (files.platform === "darwin") {
    return startGatewayBackgroundService(input);
  }

  ensureDir(path.dirname(files.configPath));
  ensureDir(path.dirname(files.stdoutLogPath));
  fs.writeFileSync(
    files.configPath,
    renderSystemdUnit({
      unitName: files.systemdUnitName,
      nodePath: input.nodePath,
      cliScriptPath: input.cliScriptPath,
      rootDir: input.rootDir,
      port: input.port,
      telegramPolling: input.telegramPolling,
      pathEnv: process.env.PATH ?? "",
      stdoutLogPath: files.stdoutLogPath,
      stderrLogPath: files.stderrLogPath,
    }),
    "utf8",
  );
  runCommand("systemctl", ["--user", "daemon-reload"]);
  runCommand("systemctl", ["--user", "enable", "--now", files.systemdUnitName]);
  runCommand("systemctl", ["--user", "restart", files.systemdUnitName]);
  return files;
}

export function getGatewayBackgroundServiceStatus(rootDir: string): {
  files: GatewayServiceFiles;
  status: GatewayServiceStatus;
} {
  const files = resolveGatewayServiceFiles(rootDir);
  if (files.platform === "darwin") {
    const result = runCommand("launchctl", ["list", files.launchdLabel], {
      allowFailure: true,
    });
    return {
      files,
      status: {
        running: result.ok,
        statusText: result.ok ? "running" : "not running",
      },
    };
  }

  const result = runCommand(
    "systemctl",
    ["--user", "is-active", files.systemdUnitName],
    { allowFailure: true },
  );
  const statusText = result.stdout.trim() || (result.ok ? "active" : "inactive");
  return {
    files,
    status: {
      running: statusText === "active",
      statusText,
    },
  };
}

export function getGatewayBackgroundLogCommand(rootDir: string): {
  files: GatewayServiceFiles;
  command: string;
} {
  const files = resolveGatewayServiceFiles(rootDir);
  if (files.platform === "darwin") {
    return {
      files,
      command: `tail -f "${files.stdoutLogPath}" "${files.stderrLogPath}"`,
    };
  }

  return {
    files,
    command: `journalctl --user -u ${files.systemdUnitName} -f`,
  };
}

interface LaunchdRenderInput {
  label: string;
  nodePath: string;
  cliScriptPath: string;
  rootDir: string;
  port: number;
  telegramPolling: boolean;
  pathEnv: string;
  stdoutLogPath: string;
  stderrLogPath: string;
}

export function renderLaunchdPlist(input: LaunchdRenderInput): string {
  const args = [
    input.nodePath,
    input.cliScriptPath,
    "gateway",
    "start",
    "--foreground",
    "--port",
    String(input.port),
    "--telegram-polling",
    input.telegramPolling ? "true" : "false",
  ];

  const programArgsXml = args
    .map((value) => `    <string>${escapeXml(value)}</string>`)
    .join("\n");

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    `  <string>${escapeXml(input.label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    programArgsXml,
    "  </array>",
    "  <key>WorkingDirectory</key>",
    `  <string>${escapeXml(input.rootDir)}</string>`,
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>OPENCOLAB_ROOT</key>",
    `    <string>${escapeXml(input.rootDir)}</string>`,
    "    <key>PATH</key>",
    `    <string>${escapeXml(input.pathEnv)}</string>`,
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>StandardOutPath</key>",
    `  <string>${escapeXml(input.stdoutLogPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${escapeXml(input.stderrLogPath)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

interface SystemdRenderInput {
  unitName: string;
  nodePath: string;
  cliScriptPath: string;
  rootDir: string;
  port: number;
  telegramPolling: boolean;
  pathEnv: string;
  stdoutLogPath: string;
  stderrLogPath: string;
}

export function renderSystemdUnit(input: SystemdRenderInput): string {
  const execArgs = [
    input.nodePath,
    input.cliScriptPath,
    "gateway",
    "start",
    "--foreground",
    "--port",
    String(input.port),
    "--telegram-polling",
    input.telegramPolling ? "true" : "false",
  ];

  return [
    "[Unit]",
    "Description=OpenColab Gateway",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${input.rootDir}`,
    `Environment=\"OPENCOLAB_ROOT=${escapeSystemdEnvironmentValue(input.rootDir)}\"`,
    `Environment=\"PATH=${escapeSystemdEnvironmentValue(input.pathEnv)}\"`,
    `ExecStart=${execArgs.map((value) => quoteSystemdValue(value)).join(" ")}`,
    "Restart=always",
    "RestartSec=2",
    "StandardOutput=journal",
    "StandardError=journal",
    "SyslogIdentifier=opencolab-gateway",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function runCommand(
  command: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const ok = result.status === 0;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (!ok && !options.allowFailure) {
    const message = stderr.trim() || stdout.trim() || `Command failed: ${command} ${args.join(" ")}`;
    throw new Error(message);
  }

  return { ok, stdout, stderr };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function quoteSystemdValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function escapeSystemdEnvironmentValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
