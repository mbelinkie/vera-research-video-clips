#!/usr/bin/env bash
# Dependency setup for DeepSeek attempts in Research.
set -uo pipefail
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
echo "== ffmpeg"; command -v ffmpeg >/dev/null || { sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ffmpeg >/dev/null; } || echo "ffmpeg install FAILED"; ffmpeg -version 2>/dev/null | head -1
echo "== npm ci"; npm ci --no-audit --no-fund || echo "npm ci FAILED"
echo "Setup finished. Focused checks: npx vitest run <file>, npm run typecheck, npm run format:check."
