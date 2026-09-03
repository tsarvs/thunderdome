#!/usr/bin/env bash
set -euo pipefail

# Yarn Classic's `workspaces run` does not guarantee topological order, and several packages
# import another workspace's compiled output (tools/boundary-check <- bot-sdk/game-sdk;
# games/rock-paper-scissors, games/connect-four <- engine <- rng) — so dependencies are built
# explicitly before the packages that import them.
INDEPENDENT_PACKAGES=(
  "@thunderdome/protocol"
  "@thunderdome/rng"
  "@thunderdome/card-kit"
  "@thunderdome/engine"
  "@thunderdome/runtime"
  "@thunderdome/tournament-formats"
  "@thunderdome/tournament-store"
  "@thunderdome/bot-sdk"
  "@thunderdome/game-sdk"
  "@thunderdome/registry"
  "@thunderdome/cli"
  "@thunderdome/game-rock-paper-scissors"
  "@thunderdome/game-connect-four"
  "@thunderdome/game-card-game-hearts"
  "@thunderdome/game-poker-texas-hold-em"
)

for pkg in "${INDEPENDENT_PACKAGES[@]}"; do
  yarn workspace "$pkg" run build
done

yarn workspace @thunderdome/boundary-check run build
