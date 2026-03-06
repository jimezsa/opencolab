#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${OPENCOLAB_REPO_URL:-https://github.com/jimezsa/opencolab.git}"
INSTALL_DIR="${OPENCOLAB_INSTALL_DIR:-$HOME/.opencolab}"
BIN_DIR="${OPENCOLAB_BIN_DIR:-$HOME/.local/bin}"
BRANCH="${OPENCOLAB_BRANCH:-main}"
PNPM_VERSION="${OPENCOLAB_PNPM_VERSION:-9.15.5}"
SKIP_DEPS="${OPENCOLAB_SKIP_DEPS:-0}"
SKIP_INIT="${OPENCOLAB_SKIP_INIT:-0}"
PATH_UPDATED_PROFILE=""

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

path_has_dir() {
  local dir="$1"
  case ":${PATH}:" in
    *":${dir}:"*) return 0 ;;
    *) return 1 ;;
  esac
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
    log "Initializing runtime state..."
    node dist/src/cli.js project list >/dev/null
  fi
}

install_cli_shim() {
  local os="$1"
  if [ "$os" = "windows" ]; then
    warn "Automatic command setup is not supported on Windows in this installer."
    return
  fi

  mkdir -p "$BIN_DIR"
  cat > "${BIN_DIR}/opencolab" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "${INSTALL_DIR}"
export OPENCOLAB_ROOT="${INSTALL_DIR}"
exec node "${INSTALL_DIR}/dist/src/cli.js" "\$@"
EOF
  chmod +x "${BIN_DIR}/opencolab"
}

ensure_bin_on_path() {
  local os="$1"
  if path_has_dir "$BIN_DIR"; then
    return
  fi

  local shell_name profile export_line
  shell_name="$(basename "${SHELL:-}")"

  case "$shell_name" in
    zsh)
      profile="${HOME}/.zprofile"
      ;;
    bash)
      if [ "$os" = "darwin" ]; then
        profile="${HOME}/.bash_profile"
      else
        profile="${HOME}/.bashrc"
      fi
      ;;
    *)
      warn "Could not update PATH automatically for shell '${SHELL:-unknown}'."
      warn "Add '${BIN_DIR}' to your PATH manually."
      return
      ;;
  esac

  mkdir -p "$(dirname "$profile")"
  touch "$profile"
  export_line="export PATH=\"${BIN_DIR}:\$PATH\""
  if ! grep -Fqs "$export_line" "$profile"; then
    {
      printf "\n# Added by OpenColab installer\n"
      printf "%s\n" "$export_line"
    } >> "$profile"
    PATH_UPDATED_PROFILE="$profile"
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
  install_cli_shim "$os"
  ensure_bin_on_path "$os"

  cat <<EOF

[opencolab] Installation complete.
[opencolab] Install path: ${INSTALL_DIR}
[opencolab] Command shim: ${BIN_DIR}/opencolab

Next steps:
  ${BIN_DIR}/opencolab ignite
  ${BIN_DIR}/opencolab gateway start --port 4646

EOF

  if [ -n "$PATH_UPDATED_PROFILE" ]; then
    cat <<EOF
[opencolab] PATH was updated in: ${PATH_UPDATED_PROFILE}
[opencolab] Run this or open a new terminal:
  source "${PATH_UPDATED_PROFILE}"

After reloading your shell, you can run:
  opencolab ignite
  opencolab gateway start --port 4646

EOF
  fi
}

main "$@"
