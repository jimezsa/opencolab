#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${OPENCOLAB_REPO_URL:-https://github.com/jimezsa/opencolab.git}"
INSTALL_DIR="${OPENCOLAB_INSTALL_DIR:-$HOME/.opencolab}"
BRANCH="${OPENCOLAB_BRANCH:-main}"
PNPM_VERSION="${OPENCOLAB_PNPM_VERSION:-9.15.5}"
SKIP_DEPS="${OPENCOLAB_SKIP_DEPS:-0}"
SKIP_INIT="${OPENCOLAB_SKIP_INIT:-0}"

log() {
  printf "[opencolab] %s\n" "$*"
}

warn() {
  printf "[opencolab] WARNING: %s\n" "$*" >&2
}

fail() {
  printf "[opencolab] ERROR: %s\n" "$*" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

sudo_cmd() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  if has_cmd sudo; then
    sudo "$@"
    return
  fi

  fail "Need root privileges to run '$*' but sudo is not available."
}

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "darwin" ;;
    Linux) echo "linux" ;;
    CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

node_major_version() {
  if ! has_cmd node; then
    echo "0"
    return
  fi

  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0"
}

install_git() {
  local os="$1"

  if has_cmd git; then
    return
  fi

  log "Installing git..."

  case "$os" in
    darwin)
      if has_cmd brew; then
        brew install git
      else
        fail "git is required. Install Homebrew or Xcode command line tools first."
      fi
      ;;
    linux)
      if has_cmd apt-get; then
        sudo_cmd apt-get update
        sudo_cmd apt-get install -y git curl ca-certificates
      elif has_cmd dnf; then
        sudo_cmd dnf install -y git curl ca-certificates
      elif has_cmd yum; then
        sudo_cmd yum install -y git curl ca-certificates
      elif has_cmd pacman; then
        sudo_cmd pacman -Sy --noconfirm git curl ca-certificates
      elif has_cmd zypper; then
        sudo_cmd zypper install -y git curl ca-certificates
      elif has_cmd apk; then
        sudo_cmd apk add --no-cache git curl ca-certificates
      else
        fail "Unsupported Linux package manager. Install git manually."
      fi
      ;;
    windows)
      if has_cmd winget; then
        powershell.exe -NoProfile -Command \
          "winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements"
      else
        fail "git is required. Install Git for Windows and rerun."
      fi
      ;;
    *)
      fail "Unsupported OS. Install git manually and rerun."
      ;;
  esac

  has_cmd git || fail "git installation failed."
}

install_node22() {
  local os="$1"

  if [ "$(node_major_version)" -ge 22 ]; then
    return
  fi

  log "Installing Node.js 22..."

  case "$os" in
    darwin)
      if has_cmd brew; then
        brew install node@22
        brew link --overwrite --force node@22 >/dev/null 2>&1 || true
      else
        fail "Node.js 22 is required. Install Homebrew or Node.js manually."
      fi
      ;;
    linux)
      if has_cmd apt-get; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo_cmd -E bash -
        sudo_cmd apt-get install -y nodejs
      elif has_cmd dnf; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo_cmd bash -
        sudo_cmd dnf install -y nodejs
      elif has_cmd yum; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo_cmd bash -
        sudo_cmd yum install -y nodejs
      elif has_cmd pacman; then
        sudo_cmd pacman -Sy --noconfirm nodejs npm
      elif has_cmd zypper; then
        sudo_cmd zypper install -y nodejs npm
      elif has_cmd apk; then
        sudo_cmd apk add --no-cache nodejs npm
      else
        fail "Unsupported Linux package manager. Install Node.js 22 manually."
      fi
      ;;
    windows)
      if has_cmd winget; then
        powershell.exe -NoProfile -Command \
          "winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements"
      else
        fail "Node.js 22 is required. Install it manually and rerun."
      fi
      ;;
    *)
      fail "Unsupported OS. Install Node.js 22 manually and rerun."
      ;;
  esac

  [ "$(node_major_version)" -ge 22 ] || fail "Node.js 22+ is required."
}

ensure_pnpm() {
  if has_cmd pnpm; then
    return
  fi

  log "Installing pnpm..."

  if has_cmd corepack; then
    corepack enable
    corepack prepare "pnpm@${PNPM_VERSION}" --activate
  elif has_cmd npm; then
    npm install -g "pnpm@${PNPM_VERSION}"
  else
    fail "Could not install pnpm (missing corepack and npm)."
  fi

  has_cmd pnpm || fail "pnpm installation failed."
}

clone_or_update_repo() {
  if [ -d "${INSTALL_DIR}/.git" ]; then
    log "Updating existing repository at ${INSTALL_DIR}..."
    git -C "$INSTALL_DIR" fetch --depth=1 origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
    return
  fi

  if [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]; then
    fail "Install directory '${INSTALL_DIR}' exists and is not empty."
  fi

  log "Cloning repository to ${INSTALL_DIR}..."
  mkdir -p "$INSTALL_DIR"
  git clone --depth=1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
}

install_project() {
  cd "$INSTALL_DIR"

  log "Installing dependencies..."
  if ! pnpm install --frozen-lockfile; then
    warn "Falling back to 'pnpm install' because lockfile install failed."
    pnpm install
  fi

  log "Building project..."
  pnpm run build

  if [ "$SKIP_INIT" != "1" ]; then
    log "Initializing project state..."
    node dist/src/cli.js init
  fi
}

main() {
  local os
  os="$(detect_os)"
  log "Detected OS: ${os}"

  if [ "$SKIP_DEPS" != "1" ]; then
    install_git "$os"
    install_node22 "$os"
    ensure_pnpm
  fi

  clone_or_update_repo
  install_project

  cat <<EOF

[opencolab] Installation complete.
[opencolab] Install path: ${INSTALL_DIR}

Next steps:
  cd "${INSTALL_DIR}"
  node dist/src/cli.js setup telegram --bot-token-env-var TELEGRAM_BOT_TOKEN --chat-id <telegram_chat_id>
  node dist/src/cli.js gateway start --port 4646

EOF
}

main "$@"
