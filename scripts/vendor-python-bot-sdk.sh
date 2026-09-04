#!/usr/bin/env bash
set -euo pipefail

# Vendors thunderdome_bot_sdk.py into every Python bot that depends on it.
#
# bots/** is deliberately not a Yarn workspace member (docs/adr/0001-monorepo-and-boundary.md),
# and there's no Python package registry to `pip install` this from either. Unlike
# scripts/pack-bot-sdk-js.sh (the TypeScript/JavaScript equivalent), there's no build step and
# nothing to pack: thunderdome_bot_sdk.py is already the file a bot ships, so "vendoring" it is
# just copying it straight into each dependent bot's own directory, alongside its own bot.py —
# see bots/connect-four/tactical-connect-four/Dockerfile for the pattern.
#
# Run this after changing packages/bot-sdk-python/thunderdome_bot_sdk.py, then commit the updated
# copies.

cd "$(dirname "$0")/.."

SOURCE="packages/bot-sdk-python/thunderdome_bot_sdk.py"

BOT_DIRS=(
  "bots/connect-four/tactical-connect-four"
  "bots/stock-market/news-reaction-stock-market"
)

for dir in "${BOT_DIRS[@]}"; do
  cp "$SOURCE" "$dir/thunderdome_bot_sdk.py"
  echo "vendored thunderdome_bot_sdk.py into $dir/thunderdome_bot_sdk.py"
done
