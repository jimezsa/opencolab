import test from "node:test";
import assert from "node:assert/strict";
import {
  detectGatewayServicePlatform,
  renderLaunchdPlist,
  renderSystemdUnit
} from "../src/gateway-service.js";

test("detectGatewayServicePlatform maps supported process platforms", () => {
  assert.equal(detectGatewayServicePlatform("darwin"), "darwin");
  assert.equal(detectGatewayServicePlatform("linux"), "linux");
  assert.equal(detectGatewayServicePlatform("win32"), null);
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
});
