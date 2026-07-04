/**
 * Cross-platform launcher for provider CLIs (claude, codex, gemini, pi).
 *
 * On Windows these CLIs are usually installed by npm/pnpm as batch shims
 * (e.g. `claude.cmd`). Node's spawn/spawnSync cannot execute a bare `claude`
 * (ENOENT), and since Node 20.12/21.7/22+ it refuses to run a `.cmd`/`.bat`
 * without `shell: true`. Using `shell: true` on an argv that contains
 * untrusted, possibly multi-line prompt text would be a command-injection and
 * quoting hazard, so we avoid it.
 *
 * Instead, on Windows we resolve the command against PATH/PATHEXT and:
 *   - spawn a real `.exe`/`.com` directly (native argv, no shell); or
 *   - for an npm/pnpm `.cmd`/`.bat` shim, extract the underlying Node script
 *     and spawn it with the current `node` binary directly. This preserves argv
 *     exactly (spaces, quotes, newlines) and cannot inject shell commands.
 *   - as a last resort (unrecognized shim), invoke it through cmd.exe with
 *     cross-spawn-style escaping so metacharacters cannot inject commands.
 *
 * On non-Windows platforms this is a thin pass-through to spawn/spawnSync.
 */
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnSyncOptions,
  type SpawnSyncReturns
} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const isWindows = process.platform === "win32";

interface ResolvedInvocation {
  command: string;
  args: string[];
  options: { windowsVerbatimArguments?: boolean };
}

/**
 * Translate a (command, args) pair into a form that spawns reliably on the
 * current platform. Exported for testing.
 */
export function resolveCliInvocation(
  command: string,
  args: readonly string[]
): ResolvedInvocation {
  const baseArgs = [...args];
  if (!isWindows) {
    return { command, args: baseArgs, options: {} };
  }

  const resolved = resolveWindowsExecutable(command);
  if (!resolved) {
    // Leave it to spawn to raise ENOENT; callers surface a clear message.
    return { command, args: baseArgs, options: {} };
  }

  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".exe" || ext === ".com" || ext === "") {
    return { command: resolved, args: baseArgs, options: {} };
  }

  if (ext === ".cmd" || ext === ".bat") {
    const nodeScript = extractNodeScriptFromShim(resolved);
    if (nodeScript) {
      return {
        command: process.execPath,
        args: [nodeScript, ...baseArgs],
        options: {}
      };
    }
    const comspec = process.env.ComSpec || "cmd.exe";
    const line = buildWindowsCommandLine(resolved, baseArgs);
    return {
      command: comspec,
      args: ["/d", "/s", "/c", line],
      options: { windowsVerbatimArguments: true }
    };
  }

  return { command: resolved, args: baseArgs, options: {} };
}

export function spawnCli(
  command: string,
  args: readonly string[],
  options: SpawnOptions
): ChildProcessWithoutNullStreams {
  const invocation = resolveCliInvocation(command, args);
  // Callers always request piped stdio, so the streams are non-null.
  return spawn(invocation.command, invocation.args, {
    ...options,
    ...invocation.options
  }) as ChildProcessWithoutNullStreams;
}

export function spawnCliSync(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions
): SpawnSyncReturns<string> {
  const invocation = resolveCliInvocation(command, args);
  return spawnSync(invocation.command, invocation.args, {
    ...options,
    ...invocation.options
  }) as SpawnSyncReturns<string>;
}

/**
 * Expand a candidate path into the concrete files Windows would consider
 * executable. A bare name (no extension) resolves ONLY through PATHEXT
 * extensions — never the extension-less file itself, which on Windows is an
 * npm/pnpm Git-Bash shell shim that cannot be spawned. Exported for testing.
 */
export function windowsExecutableCandidates(
  base: string,
  pathext: string[]
): string[] {
  if (path.win32.extname(base)) {
    return [base];
  }
  return pathext.map((entry) => base + entry);
}

/**
 * Directories a provider CLI may live in when it is not on the process PATH,
 * e.g. when the gateway runs as a Windows scheduled task without the user's
 * PATH. Covers npm-global, pnpm, the native Claude installer, and Node itself.
 */
function windowsFallbackDirs(): string[] {
  const dirs: string[] = [];
  const add = (root: string | undefined, ...sub: string[]): void => {
    if (root) {
      dirs.push(path.join(root, ...sub));
    }
  };
  add(process.env.APPDATA, "npm");
  add(process.env.PNPM_HOME);
  add(process.env.LOCALAPPDATA, "pnpm");
  add(process.env.USERPROFILE, ".local", "bin");
  add(process.env.ProgramFiles, "nodejs");
  return dirs;
}

function resolveWindowsExecutable(command: string): string | null {
  const pathext = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const firstExisting = (candidates: string[]): string | null => {
    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // Ignore missing candidates.
      }
    }
    return null;
  };

  if (command.includes("\\") || command.includes("/")) {
    return firstExisting(
      windowsExecutableCandidates(path.resolve(command), pathext)
    );
  }

  const pathDirs = (process.env.PATH || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const dir of [...pathDirs, ...windowsFallbackDirs()]) {
    if (!dir || seen.has(dir)) {
      continue;
    }
    seen.add(dir);
    const match = firstExisting(
      windowsExecutableCandidates(path.join(dir, command), pathext)
    );
    if (match) {
      return match;
    }
  }
  return null;
}

/**
 * Extract the Node script that an npm/pnpm cmd-shim ultimately runs, resolved
 * to an absolute path. Returns null for shims that don't launch a Node script.
 */
function extractNodeScriptFromShim(shimPath: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }

  const dir = path.dirname(shimPath);
  const stripDp0 = (value: string): string =>
    value.replace(/%[~]?dp0%?[\\/]?/gi, "");

  // Standard cmd-shim: `"%dp0%\path\to\cli.js"  %*`
  const shimMatch = text.match(/"(%[~]?dp0%?[\\/][^"]+?)"\s+%\*/i);
  let scriptRel: string | null = shimMatch ? stripDp0(shimMatch[1]) : null;

  if (!scriptRel) {
    // Fallback: any quoted JS path referenced in the shim.
    const jsMatch = text.match(/"([^"]*\.(?:js|mjs|cjs))"/i);
    if (jsMatch) {
      scriptRel = stripDp0(jsMatch[1]);
    }
  }

  if (!scriptRel || !/\.(js|mjs|cjs)$/i.test(scriptRel)) {
    return null;
  }

  const scriptPath = path.resolve(dir, scriptRel);
  try {
    if (fs.statSync(scriptPath).isFile()) {
      return scriptPath;
    }
  } catch {
    // Fall through when the parsed path doesn't exist.
  }
  return null;
}

/**
 * Build a cmd.exe command line with cross-spawn-style escaping so that
 * arguments (including quotes and cmd metacharacters) cannot inject commands.
 * Used only as a fallback for shims we can't resolve to a Node script.
 */
function buildWindowsCommandLine(command: string, args: string[]): string {
  const escapeCommand = (value: string): string =>
    value.replace(/[()%!^"<>&|]/g, "^$&");

  const escapeArgument = (value: string): string => {
    let arg = String(value);
    // Escape backslashes preceding a double quote, and any trailing run.
    arg = arg.replace(/(\\*)"/g, '$1$1\\"');
    arg = arg.replace(/(\\*)$/, "$1$1");
    arg = `"${arg}"`;
    // Caret-escape cmd metacharacters twice (cmd /c strips one layer).
    arg = arg.replace(/[()%!^"<>&|]/g, "^$&");
    arg = arg.replace(/[()%!^"<>&|]/g, "^$&");
    return arg;
  };

  return [escapeCommand(command), ...args.map(escapeArgument)].join(" ");
}
