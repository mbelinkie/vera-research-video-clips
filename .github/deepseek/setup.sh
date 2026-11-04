#!/usr/bin/env bash
# Dependency setup for DeepSeek attempts in Research.
set -uo pipefail
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
echo "== npm ci"; npm ci --no-audit --no-fund || echo "npm ci FAILED"
echo "Setup finished. Focused checks: npx vitest run <file>, npm run typecheck, npm run format:check."
