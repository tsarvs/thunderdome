# Security Model

What actually protects the platform, the host it runs on, and other competitors' bots from one
untrusted, potentially adversarial bot submission — written for both audiences that need to know:
**bot authors** (what limits your bot operates under) and **operators** (what protection you get,
and don't, from running this yourself). The full decision record is
`docs/adr/0003-docker-bot-isolation.md`; this guide is the practical summary plus the resource-
cleanup and forfeit-taxonomy detail that record doesn't spell out in one place.

## 1. The threat model

Bot code is submitted by anyone and must be treated as untrusted — potentially buggy, potentially
deliberately adversarial. The one hard requirement everything below serves: **one bot's crash,
timeout, resource abuse, or protocol violation must never crash the engine, or affect any other
participant's match.** Nothing about this platform assumes bots are well-behaved; every mechanism
described here exists because a bot might not be.

## 2. Isolation boundaries

**One container per participant per match.** The engine process itself never runs inside a bot's
container, and bots never talk to each other directly — not even over a network, since there is
none (below). For an N-participant match there are N independent containers and N independent
stdin/stdout pipes, controlled programmatically via `dockerode`, never by shelling out to the
`docker` CLI (so exit codes and OOM status are typed, not string-parsed).

**No bind mounts, ever.** A bot image is fully self-contained at build time
(`docker build bots/<game-id>/<bot-id>/` in isolation, per `docs/adr/0001-monorepo-and-boundary.md`)
— there is nothing on the host filesystem to mount into a running container. This is what
actually satisfies "no filesystem access to the repo or other bots": it's a property of how the
image was built, not a mount-time restriction someone has to remember to apply correctly on every
run.

**Container hardening baseline** (`packages/runtime/src/docker-config.ts`):

```
--network none                          no network access, period
--memory=<N> --memory-swap=<N>          swap fully disabled — no slow-degradation/timing side channel
--cpus=<N>
--pids-limit=<N>
--read-only                              root filesystem read-only
--tmpfs /tmp:rw,noexec,nosuid,size=<N>   small writable scratch only, not executable
--user 65534:65534                       non-root by default
--cap-drop=ALL
--security-opt no-new-privileges
(Docker's default seccomp profile — not disabled or replaced)
--ulimit nofile=<N>:<N>
--stop-timeout=<N>
```

Defaults (`packages/runtime/src/resource-limits.ts`'s `DEFAULT_RESOURCE_LIMITS`): 1 CPU, 256 MiB
memory, 64 pids, 32 MiB `/tmp`. A game may declare its own limits via `GameDefinition.
resourceLimits` (see [`game-authoring-guide.md`](game-authoring-guide.md) §8) — the runtime
interprets whatever it's given; nothing about the shape is enforced at the engine layer.

**Resource limits are fairness/containment, not the timeout mechanism.** A bot throttled to its
CPU/memory share could still legitimately run "forever" within that share without ever being
OOM-killed or exceeding a pids limit — that's a real, distinct problem, solved separately by
timeouts (§4).

**Flagged limitation — not silently accepted as sufficient long-term.** Hardened Docker + default
seccomp is a fairness/accident boundary: adequate against buggy or lazy submissions, but _not_ a
hardened defense against a determined container-escape attempt from arbitrary adversarial code.
Evaluating gVisor (`--runtime=runsc`) or Firecracker as a stronger isolation boundary is recorded
as a deliberate near-term follow-up in ADR-0003, not an oversight. **If you're operating this
platform yourself against genuinely hostile, high-stakes submissions** (as opposed to hobbyist
competition entries), treat this gap as real and plan host-level mitigations accordingly — this
platform's isolation, as it stands today, is not a multi-tenant hardened sandbox.

## 3. Timeouts: independent of resource limits

Three distinct timeout mechanisms, each covering a different way a match can stall:

- **Init timeout** — a bot has a bounded window to send `ready` after `init`. Miss it →
  `INIT_TIMEOUT`, that bot's container only.
- **Per-turn deadline** — every round, each participant `getPendingActions` marks as pending gets
  an independent deadline for its `action` reply. Miss it → `TURN_TIMEOUT` (or the game's own
  `onMissingAction` leniency, if it declared one — see
  [`game-authoring-guide.md`](game-authoring-guide.md) §6).
- **Whole-match wall-clock safety net** (`packages/engine/src/match-runner.ts`'s
  `matchDeadlineMs`) — an independent budget for the _entire match_, regardless of why it hasn't
  finished. This isn't only a misbehaving-bot concern: it's equally a defense against a game whose
  own `isTerminal()` has a gap — e.g. two bots whose strategies converge into an infinite draw
  cycle, where every participant responds correctly and on time, every round, and the match
  simply never ends on its own (reproduced for real, historically, with a fixed-throw
  Rock-Paper-Scissors bot against one that always mirrors the opponent's last move — since fixed
  by bounding Rock-Paper-Scissors's own round count, but the engine-level safety net exists
  precisely so a _different_ game's own bug can't reproduce that failure mode). No participant is
  at fault in that case, so it's reported as its own outcome, `status: 'match-timeout'`, not
  charged to anyone as a forfeit.

## 4. Failure taxonomy → forfeit reason

Every non-completion outcome maps to exactly one of these
(`packages/protocol/src/forfeit-reason.ts`) — a bot's failure is always explicit and attributable,
never an unstructured "something went wrong":

| Failure mode                                             | Reason                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| Process crash / nonzero exit, not OOM                    | `BOT_CRASHED`                                                     |
| No `ready` within the init timeout                       | `INIT_TIMEOUT`                                                    |
| Declared an unsupported `protocolVersion`                | `PROTOCOL_VERSION_UNSUPPORTED`                                    |
| No action before the per-turn deadline                   | `TURN_TIMEOUT`                                                    |
| Malformed JSON / envelope violation / unexpected message | `PROTOCOL_VIOLATION`                                              |
| Structurally valid but game-illegal action               | `ILLEGAL_ACTION`                                                  |
| cgroup OOM kill / pids-limit hit                         | `RESOURCE_LIMIT_EXCEEDED`                                         |
| Engine/orchestrator bug, Docker API failure              | `ENGINE_ERROR` (never charged to a bot)                           |
| Bot sends `resign`                                       | `RESIGNED`                                                        |
| _(whole-match wall-clock exceeded)_                      | not a `ForfeitReason` — `status: 'match-timeout'`, nobody's fault |

`MATCH_TIMEOUT` remains defined in the `ForfeitReason` enum for a narrower, still-unbuilt future
case (forcibly terminating one specific bot's own lifecycle, rather than ending the whole match)
— it is not what the whole-match safety net above produces today.

## 5. Resource cleanup: three layers

A container that's still running after its match is over is both a resource leak and, at scale, a
real operational concern. Three independent layers guarantee cleanup, deliberately not just one
(`docs/adr/0003-docker-bot-isolation.md`'s "Resource cleanup" section has the full detail):

1. **Every failure path inside one match run tears down every container it started.** A later
   participant's own container failing to start, a bot failing to initialize, or the match loop
   itself throwing unexpectedly all still leave zero containers behind.
2. **A process-level interrupt tears down whatever's currently running.** Closing the terminal, or
   an ordinary Ctrl+C, sends `SIGINT`/`SIGTERM` to the CLI — caught and used to abort the
   in-flight match's containers before exiting, rather than abandoning them.
3. **`yarn thunderdome cleanup` is the explicit backstop** for whatever slips past both — most
   notably a `SIGKILL` or host crash that never gives the process a chance to run any of its own
   cleanup code. It force-removes every container carrying the `thunderdome.matchId` label,
   regardless of which process created it or whether that process is still alive.

If you're operating this platform continuously, `yarn thunderdome cleanup` is worth running (or
scheduling) as routine hygiene, not just an emergency measure — it's a plain, idempotent sweep,
safe to run any time nothing is actively mid-match.

## 6. Determinism and seed handling, as a security-adjacent property

Each bot receives, in `init`, **only its own derived `rngSeed`** — never the tournament's own
seed, never another participant's derived seed
(`docs/adr/0004-deterministic-randomness.md`'s one-way `deriveSeed` scheme). A bot cannot
reconstruct another participant's seed, the match seed, or the tournament seed from its own. This
isn't primarily a fairness mechanism (nothing stops a bot from choosing not to use randomness at
all) — it's what keeps "same code + same seed ⇒ same output" a per-process guarantee rather than
something a bot could exploit by predicting a sibling's behavior from shared entropy.

## 7. What a bot cannot do, by construction

- **Read the platform's source, secrets, or any other bot's files** — no bind mounts exist; there
  is nothing to read.
- **Reach the network** — `--network none`, always.
- **See another participant's hidden information** — governed entirely by the game's own
  `getObservation` (ADR-0005); the engine never leaks `TState` fields a game didn't choose to
  reveal.
- **Affect another participant's container** — no shared network namespace, no shared filesystem,
  no direct process visibility between containers.
- **Escalate privileges inside its own container** — non-root user, all capabilities dropped,
  `no-new-privileges`, read-only root filesystem.

## 8. Guidance for bot authors

- Treat the resource limits as real constraints during development, not just production
  concerns — test against `DEFAULT_RESOURCE_LIMITS` (or your game's declared limits) locally
  rather than discovering a memory ceiling for the first time in a real tournament.
- Use the `rngSeed` you're given for any strategy randomness; don't reach for your language's
  unseeded default PRNG if you want your own bot's behavior to be reproducible run to run.
- Don't rely on wall-clock tricks (sleeping past a deadline hoping for leniency, spawning
  background threads that outlive a round) — the timeouts in §3 are enforced independently of
  your own bot's internal state, and `RESOURCE_LIMIT_EXCEEDED`/`TURN_TIMEOUT` forfeits are
  final, not warnings.
- A crash is always attributed to you (`BOT_CRASHED`) — there's no partial credit for "it worked
  until it didn't"; write for the resource ceiling you're actually given.

## 9. Guidance for operators

- This is a fairness/accident boundary against buggy or lazy submissions, not a hardened
  multi-tenant sandbox against a determined adversary (§2's flagged limitation) — weigh that
  against who's actually submitting bots to your instance.
- Resource limits, network isolation, and the forfeit taxonomy together mean a single bad
  submission degrades gracefully (that bot forfeits) rather than taking down a tournament or
  affecting other competitors — but they don't substitute for host-level hardening if your threat
  model includes container-escape attempts.
- Run `yarn thunderdome cleanup` as routine maintenance, and treat a persisted tournament record
  stuck in `status: 'running'` (`docs/adr/0009-tournament-persistence.md`) as a signal something
  was interrupted or crashed mid-run, worth investigating rather than ignoring.

## See also

- `docs/adr/0003-docker-bot-isolation.md` — the full decision record, including the flagged gVisor/Firecracker follow-up
- `docs/adr/0004-deterministic-randomness.md` — the seed-derivation scheme behind §6
- `docs/adr/0005-observation-vs-game-state.md` — the mechanism behind §7's "can't see hidden information"
- `docs/adr/0009-tournament-persistence.md` — what a `'running'`/`'failed'` record actually means
- [`protocol-reference.md`](protocol-reference.md) — the wire-level detail behind every forfeit reason in §4
- [`game-authoring-guide.md`](game-authoring-guide.md) §8 — declaring a game's own `resourceLimits`
