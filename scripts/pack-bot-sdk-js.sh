#!/usr/bin/env bash
set -euo pipefail

# Packs @thunderdome/bot-sdk-js into a tarball and vendors it into every TypeScript/JavaScript
# bot that depends on it. (Python bots depend on packages/bot-sdk-python instead — see
# scripts/vendor-python-bot-sdk.sh, a plain file copy with no packing step.)
#
# bots/** is deliberately not a Yarn workspace member (docs/adr/0001-monorepo-and-boundary.md):
# a bot's isolated `docker build bots/<game>/<bot>/` context has no shared node_modules to reach
# into, and there's no private npm registry to `npm install` @thunderdome/bot-sdk-js from. A
# committed vendor/*.tgz — installed via a "file:./vendor/..." dependency — is what makes
# @thunderdome/bot-sdk-js a real, reproducible dependency for bots without either of those.
#
# Run this after changing packages/bot-sdk-js, then commit the updated vendor/*.tgz and
# package-lock.json files. It re-runs `npm install` in every dependent bot itself (rather than
# leaving that to the caller) because `npm pack` is not byte-reproducible — its tarball embeds a
# timestamp, so re-packing identical source still changes the tarball's sha512 — and `npm ci`
# (used by every bot's Dockerfile) enforces that hash strictly. It deletes each bot's
# package-lock.json and node_modules before reinstalling, rather than just running `npm install`
# in place: since the vendored tarball's filename and declared version never change, npm treats
# an already-installed "file:" dependency as satisfied and won't refresh its recorded integrity
# hash on its own — leaving `npm ci` (which enforces that hash strictly) to fail with EINTEGRITY
# on the next Docker build, for a reason that has nothing to do with the bot's own code.

cd "$(dirname "$0")/.."

yarn workspace @thunderdome/bot-sdk-js run build

TARBALL_DIR=$(mktemp -d)
trap 'rm -rf "$TARBALL_DIR"' EXIT

(cd packages/bot-sdk-js && npm pack --silent --pack-destination "$TARBALL_DIR" > /dev/null)
TARBALL=$(ls "$TARBALL_DIR"/thunderdome-bot-sdk-js-*.tgz)

BOT_DIRS=(
  "bots/rock-paper-scissors/only-rock"
  "bots/rock-paper-scissors/only-paper"
  "bots/rock-paper-scissors/only-scissors"
  "bots/rock-paper-scissors/copycat-rps"
  "bots/rock-paper-scissors/random-rps"
  "bots/rock-paper-scissors/tominator-t800"
  "bots/rock-paper-scissors/tominator-t1000"
  "bots/rock-paper-scissors/tominator-tx"
  "bots/connect-four/leftmost-connect-four"
  "bots/connect-four/random-connect-four"
  "bots/card-game-hearts/random-hearts"
  "bots/card-game-hearts/lowest-card-hearts"
  "bots/card-game-hearts/point-dodger-hearts"
  "bots/card-game-hearts/tominator-t1"
  "bots/card-game-hearts/tominator-t101"
  "bots/poker-texas-hold-em/random-poker"
  "bots/poker-texas-hold-em/calling-station-poker"
  "bots/poker-texas-hold-em/tight-poker"
  "bots/stock-market/random-stock-market"
  "bots/stock-market/buy-and-hold-stock-market"
  "bots/stock-market/momentum-stock-market"
  "bots/stock-market/mean-reversion-stock-market"
  "bots/stock-market/target-allocation-stock-market"
)

for dir in "${BOT_DIRS[@]}"; do
  mkdir -p "$dir/vendor"
  rm -f "$dir/vendor/thunderdome-bot-sdk.tgz"
  cp "$TARBALL" "$dir/vendor/thunderdome-bot-sdk-js.tgz"
  echo "vendored bot-sdk-js into $dir/vendor/thunderdome-bot-sdk-js.tgz"
  rm -f "$dir/package-lock.json"
  rm -rf "$dir/node_modules"
  (cd "$dir" && npm install > /dev/null)
  echo "refreshed $dir/package-lock.json"
done
