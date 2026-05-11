import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectGatewayServicePlatform,
  encodeWindowsGatewayTaskXml,
  parseGatewayLaunchdRuntimeConfig,
  parseGatewaySystemdRuntimeConfig,
  parseGatewayWindowsRuntimeConfig,
  readGatewayServiceRuntimeConfig,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsGatewayCommandScript,
  renderWindowsGatewayTaskCommand,
  renderWindowsGatewayTaskXml,
  resolveGatewayServiceFiles
} from "../src/gateway-service.js";

test("detectGatewayServicePlatform maps supported process platforms", () => {
  assert.equal(detectGatewayServicePlatform("darwin"), "darwin");
  assert.equal(detectGatewayServicePlatform("linux"), "linux");
  assert.equal(detectGatewayServicePlatform("win32"), "win32");
});

test("renderLaunchdPlist includes foreground gateway command and logs", () => {
  const output = renderLaunchdPlist({
    label: "com.opencolab.gateway",
    nodePath: "/usr/local/bin/node",
    cliScriptPath: "/Users/dev/.opencolab/dist/src/cli.js",
    rootDir: "/Users/dev/.opencolab",
    port: 4646,
    telegramPolling: true,
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
    stdoutLogPath: "/Users/dev/.opencolab/.opencolab/logs/gateway.stdout.log",
    stderrLogPath: "/Users/dev/.opencolab/.opencolab/logs/gateway.stderr.log"
  });

  assert.equal(output.includes("<key>Label</key>"), true);
  assert.equal(output.includes("gateway"), true);
  assert.equal(output.includes("--foreground"), true);
  assert.equal(output.includes("RunAtLoad"), true);
  assert.equal(output.includes("KeepAlive"), true);
  assert.equal(output.includes("gateway.stdout.log"), true);
  assert.deepEqual(parseGatewayLaunchdRuntimeConfig(output), {
    port: 4646,
    telegramPolling: true,
  });
});

test("renderSystemdUnit includes foreground gateway command and restart policy", () => {
  const output = renderSystemdUnit({
    unitName: "opencolab-gateway.service",
    nodePath: "/usr/bin/node",
    cliScriptPath: "/home/dev/.opencolab/dist/src/cli.js",
    rootDir: "/home/dev/.opencolab",
    port: 4646,
    telegramPolling: false,
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
    stdoutLogPath: "/home/dev/.opencolab/.opencolab/logs/gateway.stdout.log",
    stderrLogPath: "/home/dev/.opencolab/.opencolab/logs/gateway.stderr.log"
  });

  assert.equal(output.includes("ExecStart="), true);
  assert.equal(output.includes("--foreground"), true);
  assert.equal(output.includes("Restart=always"), true);
  assert.equal(output.includes("Environment=\"OPENCOLAB_ROOT="), true);
  assert.equal(output.includes("StandardOutput=journal"), true);
  assert.equal(output.includes("StandardError=journal"), true);
  assert.deepEqual(parseGatewaySystemdRuntimeConfig(output), {
    port: 4646,
    telegramPolling: false,
  });
});

test("resolveGatewayServiceFiles maps Windows service files under runtime root", () => {
  const files = resolveGatewayServiceFiles("C:\\Users\\dev\\AppData\\Local\\OpenColab\\root", "win32");

  assert.equal(files.platform, "win32");
  assert.equal(files.configPath.endsWith(path.join(".opencolab", "gateway-service.ps1")), true);
  assert.equal(files.stdoutLogPath.endsWith(path.join(".opencolab", "logs", "gateway.stdout.log")), true);
  assert.equal(files.stderrLogPath.endsWith(path.join(".opencolab", "logs", "gateway.stderr.log")), true);
});

test("renderWindowsGatewayCommandScript supervises foreground gateway command and logs", () => {
  const output = renderWindowsGatewayCommandScript({
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    cliScriptPath: "C:\\Users\\dev\\AppData\\Local\\OpenColab\\package\\node_modules\\opencolab\\dist\\src\\cli.js",
    rootDir: "C:\\Users\\dev\\AppData\\Local\\OpenColab\\root",
    port: 4646,
    telegramPolling: true,
    pathEnv: "C:\\Program Files\\nodejs;C:\\Windows\\System32",
    stdoutLogPath: "C:\\Users\\dev\\AppData\\Local\\OpenColab\\root\\.opencolab\\logs\\gateway.stdout.log",
    stderrLogPath: "C:\\Users\\dev\\AppData\\Local\\OpenColab\\root\\.opencolab\\logs\\gateway.stderr.log"
  });

  assert.equal(output.includes("$ErrorActionPreference = 'Stop'"), true);
  assert.equal(output.includes("$env:OPENCOLAB_ROOT ="), true);
  assert.equal(output.includes("Set-Location -LiteralPath"), true);
  assert.equal(output.includes("while ($true)"), true);
  assert.equal(output.includes("gateway start --foreground"), true);
  assert.equal(output.includes("--port 4646"), true);
  assert.equal(output.includes("--telegram-polling true"), true);
  assert.equal(output.includes("gateway exited with code"), true);
  assert.equal(output.includes("Start-Sleep -Seconds $RestartDelaySeconds"), true);
  assert.equal(output.includes("gateway.stdout.log"), true);
  assert.equal(output.includes("gateway.stderr.log"), true);
  assert.equal(output.includes("@echo off"), false);
  assert.equal(output.includes("exit $LASTEXITCODE"), false);
  assert.deepEqual(parseGatewayWindowsRuntimeConfig(output), {
    port: 4646,
    telegramPolling: true,
  });
});

test("renderWindowsGatewayTaskCommand runs PowerShell hidden", () => {
  const output = renderWindowsGatewayTaskCommand(
    "C:\\Users\\dev\\AppData\\Local\\OpenColab\\root\\.opencolab\\gateway-service.ps1",
  );

  assert.equal(output.includes("powershell.exe"), true);
  assert.equal(output.includes("-NonInteractive"), true);
  assert.equal(output.includes("-WindowStyle Hidden"), true);
  assert.equal(output.includes("gateway-service.ps1"), true);
});

test("renderWindowsGatewayTaskXml configures hidden restart-on-failure task", () => {
  const output = renderWindowsGatewayTaskXml(
    "C:\\Users\\dev\\AppData\\Local\\OpenColab\\root\\.opencolab\\gateway-service.ps1",
  );

  assert.equal(output.includes("<LogonTrigger>"), true);
  assert.equal(output.includes("encoding=\"UTF-16\""), true);
  assert.equal(output.includes("<Hidden>true</Hidden>"), true);
  assert.equal(output.includes("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"), true);
  assert.equal(output.includes("<RestartOnFailure>"), true);
  assert.equal(output.includes("<Interval>PT2M</Interval>"), true);
  assert.equal(output.includes("<Count>255</Count>"), true);
  assert.equal(output.includes("<Command>powershell.exe</Command>"), true);
  assert.equal(output.includes("-WindowStyle Hidden"), true);
  assert.equal(output.includes("gateway-service.ps1"), true);
});

test("encodeWindowsGatewayTaskXml writes UTF-16LE with BOM for schtasks", () => {
  const output = renderWindowsGatewayTaskXml(
    "C:\\Users\\dev\\AppData\\Local\\OpenColab\\root\\.opencolab\\gateway-service.ps1",
  );
  const encoded = encodeWindowsGatewayTaskXml(output);

  assert.equal(encoded[0], 0xff);
  assert.equal(encoded[1], 0xfe);
  assert.equal(encoded.toString("utf16le").startsWith("\ufeff<?xml"), true);
  assert.equal(encoded.toString("utf16le").includes("encoding=\"UTF-16\""), true);
});

test("readGatewayServiceRuntimeConfig prefers saved runtime config when present", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencolab-gateway-config-"));

  try {
    fs.mkdirSync(path.join(tempDir, ".opencolab"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".opencolab", "gateway-service.json"),
      JSON.stringify({
        port: 4777,
        telegramPolling: false,
      }),
      "utf8",
    );

    assert.deepEqual(readGatewayServiceRuntimeConfig(tempDir), {
      port: 4777,
      telegramPolling: false,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
