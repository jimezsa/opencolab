#!/usr/bin/env bash
set -euo pipefail

INSTALL_MODE="package"
INSTALL_DIR="${OPENCOLAB_INSTALL_DIR:-$HOME/.opencolab}"
PACKAGE_PREFIX="${OPENCOLAB_PACKAGE_PREFIX:-$HOME/.local/share/opencolab}"
BIN_DIR="${OPENCOLAB_BIN_DIR:-$HOME/.local/bin}"
PACKAGE_SPEC="${OPENCOLAB_PACKAGE_SPEC:-opencolab@latest}"
SOURCE_DIR="${OPENCOLAB_CLONE_DIR:-$HOME/.local/share/opencolab/source}"
REPO_URL="${OPENCOLAB_REPO_URL:-https://github.com/jimezsa/opencolab.git}"
BRANCH="${OPENCOLAB_BRANCH:-main}"
PNPM_VERSION="${OPENCOLAB_PNPM_VERSION:-9.15.5}"
SKIP_DEPS="${OPENCOLAB_SKIP_DEPS:-0}"
SKIP_INIT="${OPENCOLAB_SKIP_INIT:-0}"
PATH_UPDATED_PROFILE=""
PACKAGE_CLI_PATH=""
CLONE_CLI_PATH=""
WINDOWS_INSTALL_COMMAND='powershell -c "irm https://opencolab.ai/install.ps1 | iex"'

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

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --hacky)
        INSTALL_MODE="clone"
        ;;
      *)
        fail "Unsupported installer argument '$1'. Supported flags: --hacky"
        ;;
    esac
    shift
  done
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
        fail "git is required for clone mode. Install Homebrew or Xcode command line tools first."
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
      fail "Windows uses the PowerShell installer instead: ${WINDOWS_INSTALL_COMMAND}"
      ;;
    *)
      fail "Unsupported OS. Install Node.js 22 manually and rerun."
      ;;
  esac

  [ "$(node_major_version)" -ge 22 ] || fail "Node.js 22+ is required."
}

ensure_npm() {
  if has_cmd npm; then
    return
  fi

  fail "npm is required. Install Node.js 22+ with npm and rerun."
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

resolve_package_cli_path() {
  local candidates=(
    "${PACKAGE_PREFIX}/bin/opencolab"
    "${PACKAGE_PREFIX}/opencolab"
    "${PACKAGE_PREFIX}/opencolab.cmd"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -e "$candidate" ]; then
      printf "%s\n" "$candidate"
      return
    fi
  done

  fail "Could not find the installed OpenColab CLI under ${PACKAGE_PREFIX}."
}

install_package() {
  mkdir -p "$INSTALL_DIR"
  mkdir -p "$PACKAGE_PREFIX"

  log "Installing ${PACKAGE_SPEC} into ${PACKAGE_PREFIX}..."
  npm install -g --prefix "$PACKAGE_PREFIX" "$PACKAGE_SPEC"
  PACKAGE_CLI_PATH="$(resolve_package_cli_path)"
}

resolve_clone_cli_path() {
  local candidate="${SOURCE_DIR}/dist/src/cli.js"
  if [ -f "$candidate" ]; then
    printf "%s\n" "$candidate"
    return
  fi

  fail "Could not find the built OpenColab CLI under ${SOURCE_DIR}."
}

clone_or_update_repo() {
  if [ -d "${SOURCE_DIR}/.git" ]; then
    log "Updating existing repository at ${SOURCE_DIR}..."
    git -C "$SOURCE_DIR" fetch --depth=1 origin "$BRANCH"
    git -C "$SOURCE_DIR" checkout "$BRANCH"
    git -C "$SOURCE_DIR" pull --ff-only origin "$BRANCH"
    return
  fi

  if [ -e "$SOURCE_DIR" ] && [ -n "$(ls -A "$SOURCE_DIR" 2>/dev/null || true)" ]; then
    fail "Clone directory '${SOURCE_DIR}' exists and is not empty."
  fi

  log "Cloning repository to ${SOURCE_DIR}..."
  mkdir -p "$(dirname "$SOURCE_DIR")"
  git clone --depth=1 --branch "$BRANCH" "$REPO_URL" "$SOURCE_DIR"
}

install_clone_project() {
  (
    cd "$SOURCE_DIR"

    log "Installing dependencies in ${SOURCE_DIR}..."
    if ! pnpm install --frozen-lockfile; then
      warn "Falling back to 'pnpm install' because lockfile install failed."
      pnpm install
    fi

    log "Building project..."
    pnpm run build
  )

  CLONE_CLI_PATH="$(resolve_clone_cli_path)"
}

run_cli() {
  if [ "$INSTALL_MODE" = "clone" ]; then
    OPENCOLAB_ROOT="${INSTALL_DIR}" node "$CLONE_CLI_PATH" "$@"
    return
  fi

  OPENCOLAB_ROOT="${INSTALL_DIR}" "$PACKAGE_CLI_PATH" "$@"
}

initialize_runtime() {
  if [ "$SKIP_INIT" = "1" ]; then
    return
  fi

  mkdir -p "$INSTALL_DIR"
  log "Initializing runtime state..."
  run_cli project list >/dev/null
}

install_cli_shim() {
  local os="$1"
  if [ "$os" = "windows" ]; then
    warn "Automatic command setup is not supported on Windows in this installer."
    return
  fi

  mkdir -p "$BIN_DIR"
  if [ "$INSTALL_MODE" = "clone" ]; then
    cat > "${BIN_DIR}/opencolab" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export OPENCOLAB_ROOT="${INSTALL_DIR}"
exec node "${CLONE_CLI_PATH}" "\$@"
EOF
  else
    cat > "${BIN_DIR}/opencolab" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export OPENCOLAB_ROOT="${INSTALL_DIR}"
exec "${PACKAGE_CLI_PATH}" "\$@"
EOF
  fi
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
  parse_args "$@"
  os="$(detect_os)"
  log "Detected OS: ${os}"
  log "Install mode: ${INSTALL_MODE}"

  if [ "$os" = "windows" ]; then
    fail "Windows is not supported by install.sh. Use: ${WINDOWS_INSTALL_COMMAND}"
  fi

  if [ "$SKIP_DEPS" != "1" ]; then
    install_node22 "$os"
    if [ "$INSTALL_MODE" = "clone" ]; then
      install_git "$os"
      ensure_pnpm
    fi
  fi

  if [ "$(node_major_version)" -lt 22 ]; then
    fail "Node.js 22+ is required."
  fi

  if [ "$INSTALL_MODE" = "clone" ]; then
    has_cmd git || fail "git is required for clone mode. Install git or rerun without --hacky."
    has_cmd pnpm || fail "pnpm is required for clone mode. Install pnpm or rerun without OPENCOLAB_SKIP_DEPS=1."
    clone_or_update_repo
    install_clone_project
  else
    ensure_npm
    install_package
  fi

  initialize_runtime
  install_cli_shim "$os"
  ensure_bin_on_path "$os"

  if [ "$INSTALL_MODE" = "clone" ]; then
    warn "Clone mode is a hacky fallback. The shim runs a locally built checkout from ${SOURCE_DIR}."
    cat <<EOF

[opencolab] Installation complete.
[opencolab] Install mode: clone
[opencolab] Runtime root: ${INSTALL_DIR}
[opencolab] Source checkout: ${SOURCE_DIR}
[opencolab] Command shim: ${BIN_DIR}/opencolab

Next steps:
  ${BIN_DIR}/opencolab ignite
  ${BIN_DIR}/opencolab gateway start --port 4646

EOF
  else
    cat <<EOF

[opencolab] Installation complete.
[opencolab] Install mode: package
[opencolab] Runtime root: ${INSTALL_DIR}
[opencolab] Package prefix: ${PACKAGE_PREFIX}
[opencolab] Command shim: ${BIN_DIR}/opencolab

Next steps:
  ${BIN_DIR}/opencolab ignite
  ${BIN_DIR}/opencolab gateway start --port 4646

EOF
  fi

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
