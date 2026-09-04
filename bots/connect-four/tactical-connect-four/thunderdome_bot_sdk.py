"""thunderdome_bot_sdk — a minimal, dependency-free Python client for the Thunderdome bot wire
protocol (docs/guides/protocol-reference.md). This is the Python analog of
@thunderdome/bot-sdk's runBot() (packages/bot-sdk/src/run-bot.ts) for TypeScript/JavaScript bots:
same contract, same behavior, translated idiomatically rather than line-for-line.

This module owns the NDJSON-over-stdio plumbing (parsing inbound messages, replying to
"init"/"observation", exiting on "match-end") that is identical for every bot regardless of
game. A bot only supplies `decide_action` — everything else here is boilerplate a bot author
should never need to read, let alone modify.

Usage (see docs/guides/bot-author-guide.md for the full protocol walkthrough, written for JS but
identical for Python):

    from thunderdome_bot_sdk import run_bot

    def decide_action(observation):
        return {"choice": "rock"}  # whatever your game's Action shape is

    run_bot(decide_action)

bots/** is not a Yarn workspace member and has no Python package registry to install from
(docs/adr/0001-monorepo-and-boundary.md) — a real dependency on this module means vendoring this
file directly into a bot's own directory, not installing it as a package. See
scripts/vendor-python-bot-sdk.sh, or bots/connect-four/tactical-connect-four/ for the pattern.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any, Callable, Optional, TextIO

DecideAction = Callable[[Any], Any]
OnInit = Callable[[dict], None]
Exit = Callable[[int], None]


def _now_iso() -> str:
    # Millisecond precision with a trailing "Z", matching JS's `new Date().toISOString()" —
    # sentAt is diagnostic-only (never consulted for game logic), so exact format parity across
    # languages isn't required, just a valid ISO-8601 datetime.
    now = datetime.now(timezone.utc)
    return now.strftime('%Y-%m-%dT%H:%M:%S.') + f'{now.microsecond // 1000:03d}Z'


def run_bot(
    decide_action: DecideAction,
    on_init: Optional[OnInit] = None,
    protocol_version: str = '1.0',
    input_stream: TextIO = sys.stdin,
    output_stream: TextIO = sys.stdout,
    exit_fn: Exit = sys.exit,
) -> None:
    """Runs a bot to completion: reads NDJSON messages from `input_stream`, replies on
    `output_stream`, and calls `exit_fn(0)` on "match-end". Blocks for the lifetime of the
    match — call this once, at the top level of a bot's entry point, and do nothing else.

    `decide_action` is called once per round this bot is expected to act, given that round's
    `payload.state` (the game's own observation shape) — its return value is sent back as the
    action.

    `on_init` is called once, when "init" arrives, with the full init payload (rngSeed, config,
    and the rest of docs/guides/protocol-reference.md's `init` payload) — the right place to seed
    a bot's own PRNG from rngSeed.
    """
    outgoing_seq = 0

    def send(match_id: str, msg_type: str, **fields: Any) -> None:
        nonlocal outgoing_seq
        envelope = {
            'protocolVersion': protocol_version,
            'type': msg_type,
            'matchId': match_id,
            'seq': outgoing_seq,
            'sentAt': _now_iso(),
            **fields,
        }
        outgoing_seq += 1
        output_stream.write(json.dumps(envelope) + '\n')
        output_stream.flush()

    for line in input_stream:
        line = line.strip()
        if not line:
            continue

        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue  # malformed input from the engine isn't something a bot can usefully react to

        if not isinstance(message, dict) or 'type' not in message or 'matchId' not in message:
            continue

        message_type = message['type']
        match_id = message['matchId']

        # The engine just told us who we are, who our opponent is, and this match's
        # rngSeed/config. We must reply with "ready" before anything else happens.
        if message_type == 'init':
            if on_init is not None:
                on_init(message['payload'])
            send(match_id, 'ready', payload={'protocolVersion': protocol_version})
            continue

        # Every round, every participant that could plausibly need to act receives one of these.
        # `awaitingAction` tells us whether a reply is actually expected this round.
        if message_type == 'observation':
            payload = message['payload']
            if not payload.get('awaitingAction'):
                continue
            action = decide_action(payload['state'])
            send(match_id, 'action', roundId=message['roundId'], payload={'action': action})
            continue

        # The match is over — exit promptly. The runtime will forcibly tear down our container
        # shortly regardless, but a clean, fast exit is good practice.
        if message_type == 'match-end':
            exit_fn(0)
            return
