---
name: browser-use
description: Automated browser control via the `browser-use` CLI. Navigate pages, fill forms, click elements, take screenshots, and extract content from the command line. Used by `apply-to-job` to drive real ATS portals end-to-end while the human watches.
---

# browser-use

Automated browser control via the `browser-use` CLI. Navigate pages, fill forms, click elements, take screenshots, and extract content — all from the command line. Backed by Playwright Chromium under the hood.

## Prerequisites

- Python 3.11+ (3.12 recommended)
- A Python virtual environment with `browser-use` installed (`pip install browser-use`)
- Playwright Chromium installed (`python -m playwright install chromium`)
- A graphical display when running headed (Linux: an X / Wayland session; macOS / Windows: native window)

## Environment Setup

Every `browser-use` command needs the venv activated. On Linux you also need to point `DISPLAY` at the active session and (optionally) tell Playwright where its browsers live.

```bash
# activate the venv that has browser-use installed
source <path/to/venv>/bin/activate

# Linux only — point at the active X/Wayland display
export DISPLAY=:0           # adjust to match the running session (:0, :1, ...)

# optional — pin the Playwright browser cache location
export PLAYWRIGHT_BROWSERS_PATH="$HOME/.playwright"
```

macOS and Windows do not need `DISPLAY`; the headed flag just opens a native window.

## Quick Reference

```bash
# Open a URL (headed — visible window)
browser-use --headed open <url>

# Open headless (no visible window)
browser-use open <url>

# See numbered interactive elements on current page
browser-use state

# Click element by index
browser-use click <index>

# Type into an input field by index
browser-use input <index> "text"

# Take a screenshot
browser-use screenshot output.png

# Scroll the page
browser-use scroll [up|down]

# Go back
browser-use back

# Press keys (e.g. Enter, Tab)
browser-use keys Enter

# Select from dropdown
browser-use select <index> "value"

# Extract page content
browser-use extract

# Close the browser
browser-use close
```

## Sessions

- `browser-use sessions` — list active sessions
- `browser-use --session <name> open <url>` — named session for persistence across commands
- `browser-use --session <name> close` — close one named session

## Persistent Browser Profile (LinkedIn etc.)

For sites that require an authenticated login (LinkedIn, some company portals), use a persistent Chrome user-data directory so the login session survives across restarts. The `--profile` flag stores cookies and local storage between commands.

```bash
browser-use --headed --profile --session linkedin open https://www.linkedin.com
```

Notes:

- Log in **once** in the visible window. Subsequent commands with the same `--session` reuse the cookies.
- If the session expires, re-authenticate by hand in the headed window. **Never** type passwords through the CLI — they get captured in shell history and process listings.
- The persistent profile directory location is managed by `browser-use`; check `browser-use doctor` if you need the exact path.

## Troubleshooting

- **Browser fails to launch on Linux** → check `DISPLAY` points at an active X/Wayland session and `PLAYWRIGHT_BROWSERS_PATH` (if set) resolves to an installed Chromium build.
- **General environment health** → `browser-use doctor`.
- **Stale sessions** → `browser-use close` then retry. For a specific session: `browser-use --session <name> close`.
- **Playwright Chromium missing** → reinstall via `python -m playwright install chromium`.
- **CDP / "Target closed" errors** → kill stray Chromium processes and reopen the session.
