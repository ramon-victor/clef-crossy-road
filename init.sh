#!/bin/sh
# Sets up Clef Crossy Road on Linux or macOS:  ./init.sh [--desktop] [--yes]
# scripts/init.mjs does the work; this file only makes sure Node.js is there to run it.
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[!!] Node.js was not found. Install Node 24 or newer from https://nodejs.org, then run ./init.sh again."
  exit 1
fi
exec node scripts/init.mjs "$@"
