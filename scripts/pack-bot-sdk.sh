#!/usr/bin/env bash
set -euo pipefail

# Packs @thunderdome/bot-sdk into a tarball and vendors it into every TypeScript bot that
# depends on it.
#
# bots/** is deliberately not a Yarn workspace member (docs/adr/0001-monorepo-and-boundary.md):
# a bot's isolated `docker build bots/<game>/<bot>/` context has no shared node_modules to reach
# into, and there's no private npm registry to `npm install` @thunderdome/bot-sdk from. A
# committed vendor/*.tgz — installed via a "file:./vendor/..." dependency — is what makes
# @thunderdome/bot-sdk a real, reproducible dependency for bots without either of those.
#
# Run this after changing packages/bot-sdk, then commit the updated vendor/*.tgz and
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

yarn workspace @thunderdome/bot-sdk run build

TARBALL_DIR=$(mktemp -d)
trap 'rm -rf "$TARBALL_DIR"' EXIT

(cd packages/bot-sdk && npm pack --silent --pack-destination "$TARBALL_DIR" > /dev/null)
TARBALL=$(ls "$TARBALL_DIR"/thunderdome-bot-sdk-*.tgz)

BOT_DIRS=(
  "bots/rock-paper-scissors/only-rock"
  "bots/rock-paper-scissors/only-paper"
  "bots/rock-paper-scissors/only-scissors"
  "bots/rock-paper-scissors/copycat-rps"
  "bots/rock-paper-scissors/random-rps"
  "bots/rock-paper-scissors/t800"
  "bots/rock-paper-scissors/t1000"
  "bots/rock-paper-scissors/tx"
  "bots/connect-four/leftmost-connect-four"
  "bots/connect-four/random-connect-four"
)

for dir in "${BOT_DIRS[@]}"; do
  mkdir -p "$dir/vendor"
  cp "$TARBALL" "$dir/vendor/thunderdome-bot-sdk.tgz"
  echo "vendored bot-sdk into $dir/vendor/thunderdome-bot-sdk.tgz"
  rm -f "$dir/package-lock.json"
  rm -rf "$dir/node_modules"
  (cd "$dir" && npm install > /dev/null)
  echo "refreshed $dir/package-lock.json"
done
