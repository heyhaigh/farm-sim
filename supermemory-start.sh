#!/usr/bin/env bash
# Start the self-hosted SuperMemory local server for Propagate (hackathon integration).
# Runs on http://localhost:6767 with an encrypted local store in ./.supermemory (gitignored).
# The game (server.mjs) reads/writes it via SUPERMEMORY_URL in .env. Its own dashboard is the
# visual memory portal at http://localhost:6767.
#
#   ./supermemory-start.sh              # run in the foreground
#   ./supermemory-start.sh &            # background for the session
#
# Requires a model: reads OPENAI_API_KEY from ./.env (falls back to ~/.supermemory/env, which the
# installer wrote on first run). No Docker/DB needed.

set -euo pipefail
cd "$(dirname "$0")"   # data dir must be this folder so it matches .env / .gitignore

# pull OPENAI_API_KEY from .env if present (strip quotes)
if [ -f .env ]; then
  KEY_LINE="$(grep -E '^OPENAI_API_KEY=' .env | head -1 || true)"
  if [ -n "$KEY_LINE" ]; then
    export OPENAI_API_KEY="$(printf '%s' "${KEY_LINE#OPENAI_API_KEY=}" | sed 's/^["'"'"']//;s/["'"'"']$//')"
  fi
fi

# prefer the installed wrapper; else install-and-run via npx
if command -v supermemory-server >/dev/null 2>&1; then
  exec supermemory-server
elif [ -x "$HOME/.local/bin/supermemory-server" ]; then
  exec "$HOME/.local/bin/supermemory-server"
else
  exec npx -y supermemory local
fi
