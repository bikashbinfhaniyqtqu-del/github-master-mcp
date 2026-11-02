#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20.6+ is required. Install Node.js first." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
NODE_MINOR="$(node -p 'Number(process.versions.node.split(".")[1])')"
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 6) )); then
  echo "Node.js 20.6+ is required. Current version: $(node --version)" >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "Git is required. Install Git and rerun this script." >&2
  exit 1
fi

npm install
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Add your GitHub token and private confirmation phrase."
else
  echo "Existing .env preserved."
fi

echo
echo "Setup complete. Configure your MCP client using the examples/ directory."
echo "Keep GITHUB_MCP_ALLOW_PUSH=false until you are ready to enable pushes."
