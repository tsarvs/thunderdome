# Protocol Reference

A precise reference for the wire protocol every bot container speaks, regardless of language or
game. If you're writing a bot in TypeScript, use `@thunderdome/bot-sdk`'s `runBot()`
(`docs/guides/bot-author-guide.md` walks through it) and you'll rarely need this document —
it handles everything here for you. This guide is for implementing a bot client from scratch in
a language `@thunderdome/bot-sdk` doesn't cover, or for understanding exactly what's on the wire
when debugging.

The full decision record and reasoning behind everything here is
`docs/adr/0002-universal-bot-protocol.md`; this guide is the practical, example-driven version of
the same contract.

## 1. Transport

One JSON value per line (NDJSON), written with a trailing `\n`, over the bot container's
stdin/stdout:

- **stdin**: messages _from_ the engine, written by the runtime.
- **stdout**: messages _to_ the engine — and **only** protocol messages. Never print debug output
  here; it will be parsed as protocol and rejected.
- **stderr**: your bot's free-form debug log. Captured by the runtime, never parsed as protocol —
  print whatever you want here.

Use your language's standard JSON serializer to write each line — never hand-rolled string
concatenation. A serializer correctly escapes control characters (including a literal newline
inside a string value); string concatenation is a classic way to accidentally emit a line break
mid-message and break framing for everyone downstream.

Lines are capped at 1 MiB (`packages/protocol/src/ndjson.ts`'s `DEFAULT_MAX_LINE_BYTES`) — an
oversized or unterminated line is a framing error, which the runtime treats as a
`PROTOCOL_VIOLATION` forfeit, not a crash.

## 2. The envelope

Every message, in both directions, shares this shape:

```ts
interface Envelope<TPayload = unknown> {
  protocolVersion: string; // "MAJOR.MINOR", e.g. "1.0"
  type: MessageType;
  matchId: string;
  roundId?: number; // present on round-scoped messages only — see §4's table
  seq: number; // per-direction monotonic counter, starting at 0
  sentAt: string; // ISO-8601 datetime; diagnostic only, never consulted for game logic
  payload: TPayload;
}
```

`seq` must strictly increase within each direction (engine→bot and bot→engine are counted
separately) — a duplicate or out-of-order `seq` is a `PROTOCOL_VIOLATION`. `sentAt` exists purely
for logs/debugging; nothing in the engine's own logic ever reads it.

## 3. Versioning

`protocolVersion` is `MAJOR.MINOR`. A MINOR bump is additive-only — every implementation must
silently ignore fields or message types it doesn't recognize rather than reject them (this is
why every schema in `packages/protocol/src/messages.ts` is a plain zod `.object()`, not
`.strict()` — unknown keys are dropped, not rejected). A MAJOR bump is a breaking change; a bot
declares which version it supports in its `ready` reply (§4), and the engine is expected to keep
a per-version dispatch table during any deprecation window.

Today's version is `1.0`.

## 4. Message catalogue

| Direction    | Type          | `roundId`?                   | Purpose                                                                  |
| ------------ | ------------- | ---------------------------- | ------------------------------------------------------------------------ |
| engine → bot | `init`        | never                        | Match/config/roster/derived `rngSeed`, sent once                         |
| engine → bot | `observation` | always                       | This round's view of state; `awaitingAction` says whether a reply is due |
| engine → bot | `result`      | present iff `scope: 'round'` | A round- or match-scoped outcome reveal                                  |
| engine → bot | `error`       | optional                     | Your last message was rejected, or you're being forfeited                |
| engine → bot | `match-end`   | never                        | Terminal message — shut down after this                                  |
| bot → engine | `ready`       | never                        | Acknowledges `init`; declares your supported `protocolVersion`           |
| bot → engine | `action`      | always                       | Your move for the round named by `roundId`                               |
| bot → engine | `resign`      | optional                     | Voluntary forfeit                                                        |
| bot → engine | `error`       | optional                     | Self-reported fault                                                      |

Every noun here is generic — `match`/`participant`/`round`/`observation`/`action`/`result`/
`error` — nothing in the envelope or message catalogue is game-specific. Whatever's game-specific
lives entirely inside `payload.state`/`payload.action`/`payload.config`/`payload.outcome`, which
the protocol layer treats as opaque (`z.unknown()`) and never validates itself — that's the
game's own `validateAction`/`getObservation` (see
[`game-authoring-guide.md`](game-authoring-guide.md)).

### `init` (engine → bot, once)

```json
{
  "protocolVersion": "1.0",
  "type": "init",
  "matchId": "match-001",
  "seq": 0,
  "sentAt": "2026-01-01T00:00:00.000Z",
  "payload": {
    "gameId": "rock-paper-scissors",
    "gameVersion": "1.0.0",
    "participantId": "p1",
    "roster": ["p1", "p2"],
    "rngSeed": "a1b2c3d4",
    "config": { "bestOf": 3 }
  }
}
```

`roster` is every participant in the match, including your own `participantId`. `rngSeed` is
**your own** derived seed and yours alone — never another participant's, never the tournament's
own seed (`docs/adr/0004-deterministic-randomness.md`). Seed your own PRNG from it once, here, if
your strategy uses randomness; nothing about this platform requires (or gives you a way to
achieve) bit-identical randomness with any other bot or the engine — "same code + same seed ⇒
same output" within your own process is the entire determinism contract. `config` is the shared
game's own config, opaque to the protocol layer. `matchDeadlineAt` may be present (an ISO
datetime) — the whole-match wall-clock deadline, informational only.

### `ready` (bot → engine, once, in reply to `init`)

```json
{
  "protocolVersion": "1.0",
  "type": "ready",
  "matchId": "match-001",
  "seq": 0,
  "sentAt": "2026-01-01T00:00:00.100Z",
  "payload": { "protocolVersion": "1.0" }
}
```

Must be your first message. If you don't send this within the engine's init timeout, or you
declare an unsupported `protocolVersion`, your match is forfeited (`INIT_TIMEOUT` /
`PROTOCOL_VERSION_UNSUPPORTED`) before anything else happens.

### `observation` (engine → bot, every round you're pending)

```json
{
  "protocolVersion": "1.0",
  "type": "observation",
  "matchId": "match-001",
  "roundId": 1,
  "seq": 1,
  "sentAt": "2026-01-01T00:00:01.000Z",
  "payload": {
    "state": { "round": 1 },
    "awaitingAction": true,
    "deadlineAt": "2026-01-01T00:00:06.000Z"
  }
}
```

`state` is entirely game-defined — see the specific game's own docs (e.g.
[`bot-author-guide.md`](bot-author-guide.md) §9 for Rock-Paper-Scissors's exact shape,
`games/connect-four/src/types.ts` for Connect Four's). **You only receive an `observation` for a
round you're actually pending in** — a sequential game's non-active participant simply gets
nothing that round, not an observation with `awaitingAction: false`. When `awaitingAction` is
`true`, reply with `action` before `deadlineAt` (or the per-turn deadline your runtime enforces,
if `deadlineAt` is absent); when it's `false`, no reply is expected or wanted.

### `action` (bot → engine, in reply to an `observation` with `awaitingAction: true`)

```json
{
  "protocolVersion": "1.0",
  "type": "action",
  "matchId": "match-001",
  "roundId": 1,
  "seq": 2,
  "sentAt": "2026-01-01T00:00:02.000Z",
  "payload": { "action": { "choice": "rock" } }
}
```

`roundId` must match the `observation` you're replying to — a mismatched `roundId` is a
`PROTOCOL_VIOLATION`. `action`'s shape is entirely game-defined; an invalid one (either malformed,
or structurally valid but game-illegal) is rejected by the game's own `validateAction` and becomes
`ILLEGAL_ACTION` if you were required to act.

### `result` (engine → bot, round- or match-scoped)

Round-scoped (only sent to games that reveal per-round outcomes):

```json
{
  "protocolVersion": "1.0",
  "type": "result",
  "matchId": "match-001",
  "roundId": 1,
  "seq": 3,
  "sentAt": "2026-01-01T00:00:03.000Z",
  "payload": {
    "scope": "round",
    "outcome": { "winner": "p1", "choices": { "p1": "rock", "p2": "scissors" } }
  }
}
```

Match-scoped (`roundId` must be **absent** — this is enforced, not just convention):

```json
{
  "protocolVersion": "1.0",
  "type": "result",
  "matchId": "match-001",
  "seq": 10,
  "sentAt": "2026-01-01T00:01:00.000Z",
  "payload": {
    "scope": "match",
    "outcome": { "winner": "p1", "roundsWon": { "p1": 2, "p2": 1 } }
  }
}
```

`outcome` is game-defined either way. The `scope`/`roundId` pairing is validated as a unit: a
`scope: 'round'` payload without a `roundId`, or a `scope: 'match'` payload _with_ one, is
rejected — this is the one cross-field rule the envelope schema enforces beyond per-field shape.

### `resign` (bot → engine, optional, any time you'd otherwise be asked to act)

```json
{
  "protocolVersion": "1.0",
  "type": "resign",
  "matchId": "match-001",
  "roundId": 4,
  "seq": 8,
  "sentAt": "2026-01-01T00:00:40.000Z",
  "payload": { "note": "no winning move available" }
}
```

A clean, voluntary forfeit (`RESIGNED`) — `note` is optional, free text.

### `error` (either direction)

Engine → bot, reporting a forfeit that's about to happen:

```json
{
  "protocolVersion": "1.0",
  "type": "error",
  "matchId": "match-001",
  "roundId": 2,
  "seq": 6,
  "sentAt": "2026-01-01T00:00:11.000Z",
  "payload": { "reason": "TURN_TIMEOUT", "detail": "no action received before deadline" }
}
```

Bot → engine, self-reporting an internal fault (`reason` may be omitted here — you're not
required to know which of the engine's own forfeit categories applies to you, only that
something went wrong):

```json
{ "payload": { "detail": "internal strategy error: division by zero" } }
```

At least one of `reason`/`detail` must be present. `reason`, when present, is one of:

```
BOT_CRASHED  TURN_TIMEOUT  MATCH_TIMEOUT  PROTOCOL_VIOLATION  ILLEGAL_ACTION
RESOURCE_LIMIT_EXCEEDED  ENGINE_ERROR  RESIGNED  INIT_TIMEOUT  PROTOCOL_VERSION_UNSUPPORTED
```

(`packages/protocol/src/forfeit-reason.ts`'s `FORFEIT_REASONS` — see
[`security-model.md`](security-model.md) for what triggers each one.)

### `match-end` (engine → bot, once, terminal)

```json
{
  "protocolVersion": "1.0",
  "type": "match-end",
  "matchId": "match-001",
  "seq": 11,
  "sentAt": "2026-01-01T00:01:01.000Z",
  "payload": { "result": { "winner": "p1" }, "reason": "completed" }
}
```

`reason` is `'completed'` (the game reached its own natural end) or `'aborted'` (the match ended
some other way — a forfeit, a timeout, or the tournament/CLI process itself being interrupted).
`result` is `null` when `reason` is `'aborted'`. Exit promptly on receiving this — the runtime
will forcibly tear your container down shortly regardless, but a clean, fast exit is good
practice and avoids being on the receiving end of a `SIGTERM`/`SIGKILL` you didn't need.

## 5. The lifecycle, end to end

```
engine: init  ────────────────────────────▶  bot
bot:    ready ────────────────────────────▶  engine
                    (repeat per round)
engine: observation (awaitingAction?) ────▶  bot
bot:    action | resign | error ──────────▶  engine   (only if awaitingAction: true)
engine: result (scope: round)? ───────────▶  bot       (only if the game reveals per-round outcomes)
                    (until isTerminal)
engine: result (scope: match) ────────────▶  bot
engine: match-end ─────────────────────────▶  bot
```

A game with no hidden information and full mutual visibility might never send round-scoped
`result` at all — everything a participant needs is already in the next `observation`. Whether
`result` gets sent, and at what scope, is a per-game choice, not a protocol requirement.

## 6. Golden fixture corpus

`packages/protocol/fixtures/v1/` holds real, validated example messages —
`valid/` (one file per message type shown above, plus edge cases like
`forward-compatible-extra-field.json` proving unknown fields are tolerated) and `invalid/` (e.g.
`missing-type.json`, `negative-seq.json`, `result-round-missing-roundid.json`). Every example in
this guide is drawn directly from `valid/`. Any new-language SDK's own test suite should validate
against this same corpus — it's the actual cross-language conformance contract, not just
documentation of intent.

## See also

- `docs/adr/0002-universal-bot-protocol.md` — the full design and alternatives considered
- `docs/adr/0004-deterministic-randomness.md` — the seed-derivation scheme `rngSeed` comes from
- [`security-model.md`](security-model.md) — the forfeit-reason taxonomy in context, and what triggers each one
- [`bot-author-guide.md`](bot-author-guide.md) — using `@thunderdome/bot-sdk` instead of implementing this by hand
- `packages/protocol/src/messages.ts` — the actual zod schemas this reference describes
