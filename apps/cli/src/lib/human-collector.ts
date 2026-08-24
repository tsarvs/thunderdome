// The seam that lets a real terminal-typing human sit in for one participant in an otherwise
// Docker-bot-driven match (`thunderdome play`). Every other participantId is delegated untouched
// to `fallback` (typically a `DockerActionCollector`) — this collector only ever intercepts
// requests for its one `humanParticipantId`.
import { createInterface, type Interface } from 'node:readline';
import type { ActionCollector, CollectedAction, RequestActionArgs } from '@thunderdome/engine';
import type { AnyGameDefinition } from './match-execution.js';

const RESIGN_INPUTS = new Set(['quit', 'resign', 'exit']);

export interface TerminalHumanCollectorOptions {
  humanParticipantId: string;
  /** Must declare `humanInterface` — checked by the caller before construction, since prompting
   * with no way to render an observation or parse a reply isn't recoverable at this layer. */
  game: AnyGameDefinition;
  fallback: ActionCollector;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export class TerminalHumanCollector implements ActionCollector {
  private readonly rl: Interface;
  private readonly output: NodeJS.WritableStream;
  // A manual async-iterator pull, not repeated `rl.question()` calls: `readline/promises`'
  // `question()` can reject with "readline was closed" the moment piped/non-TTY input hits EOF
  // partway through answering, which a human-play session over piped input (tests, scripts) hits
  // constantly. Iterating the interface's own AsyncIterable<string> of lines doesn't have that
  // failure mode — a genuine EOF just ends the iterator, handled below as a clean disconnect.
  private readonly lines: AsyncIterator<string>;

  constructor(private readonly options: TerminalHumanCollectorOptions) {
    this.output = options.output ?? process.stdout;
    this.rl = createInterface({ input: options.input ?? process.stdin });
    this.lines = this.rl[Symbol.asyncIterator]();
  }

  async requestAction(args: RequestActionArgs): Promise<CollectedAction> {
    if (args.participantId !== this.options.humanParticipantId) {
      return this.options.fallback.requestAction(args);
    }

    const humanInterface = this.options.game.humanInterface;
    if (!humanInterface) {
      throw new Error(`"${this.options.game.id}" has no humanInterface — cannot prompt a human`);
    }

    // No deadline enforced here, unlike a bot's own requestAction path — a human, not a
    // container, sets this match's pace. Loops silently past an unparseable line (typing
    // "roc" is a typo, not a forfeit) rather than ever handing that on to validateAction/resolve.
    for (;;) {
      this.output.write(humanInterface.describeObservation(args.observation));
      const next = await this.lines.next();
      if (next.done) {
        return { ok: false, reason: 'disconnected' }; // stdin ended — nobody left to answer
      }

      const raw = next.value;
      if (RESIGN_INPUTS.has(raw.trim().toLowerCase())) {
        return { ok: false, reason: 'disconnected' };
      }
      const action = humanInterface.parseInput(raw);
      if (action !== undefined) {
        return { ok: true, action };
      }
    }
  }

  close(): void {
    this.rl.close();
  }
}
