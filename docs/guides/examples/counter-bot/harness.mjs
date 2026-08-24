// A minimal, generic NDJSON protocol harness — reusable for any Thunderdome bot, for any game,
// in any Node script. It handles the mechanical parts of the wire protocol (message framing,
// envelope fields, the init/ready handshake, and match-end shutdown) and calls out to your
// strategy for exactly one decision per round: given this round's observation, what action do
// you take? It has zero knowledge of Rock-Paper-Scissors or any other game — copy this file
// as-is into a bot for a different game and only `strategy.mjs` needs to change.
//
// See docs/guides/rps-bot-author-guide.md for the protocol this implements.
import { createInterface } from 'node:readline';

/**
 * @param {{ decideAction: (observation: unknown) => unknown }} strategy
 *   `decideAction` receives `observation.payload.state` for a round with `awaitingAction: true`
 *   and must return the action payload's `action` value — for Rock-Paper-Scissors that's
 *   `{ choice: 'rock' | 'paper' | 'scissors' }`, but the harness never looks inside it.
 */
export function runBot({ decideAction }) {
  let seq = 0;

  function send(matchId, type, fields) {
    process.stdout.write(
      `${JSON.stringify({
        protocolVersion: '1.0',
        type,
        matchId,
        seq: seq++,
        sentAt: new Date().toISOString(),
        ...fields,
      })}\n`,
    );
  }

  const rl = createInterface({ input: process.stdin });

  rl.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // malformed input isn't something a bot can usefully react to
    }

    switch (message.type) {
      case 'init': {
        // message.payload has { gameId, gameVersion, participantId, roster, rngSeed, config } —
        // this generic harness doesn't need any of it, but your strategy module can import it
        // separately and read message.payload.config if your game needs it.
        send(message.matchId, 'ready', { payload: { protocolVersion: '1.0' } });
        break;
      }
      case 'observation': {
        if (!message.payload.awaitingAction) {
          break; // an informational observation this round doesn't require a reply
        }
        send(message.matchId, 'action', {
          roundId: message.roundId,
          payload: { action: decideAction(message.payload.state) },
        });
        break;
      }
      case 'match-end': {
        process.exit(0);
      }
    }
  });
}
