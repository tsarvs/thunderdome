import { Readable, Writable } from 'node:stream';
import type { ActionCollector, CollectedAction, RequestActionArgs } from '@thunderdome/engine';
import { describe, expect, it } from 'vitest';
import { TerminalHumanCollector } from '../src/lib/human-collector.js';
import type { AnyGameDefinition } from '../src/lib/match-execution.js';

/** A minimal fake `GameDefinition` — only `humanInterface` and `id` matter to this collector. */
function fakeGame(withHumanInterface = true): AnyGameDefinition {
  return {
    id: 'fake-game',
    version: '1.0.0',
    parseConfig: () => ({ ok: true, value: {} }),
    initialize: () => ({}),
    getObservation: () => ({}),
    getPendingActions: () => [],
    validateAction: () => ({ ok: true, value: {} }),
    resolve: () => ({ nextState: {}, events: [] }),
    isTerminal: () => false,
    getResult: () => ({}),
    getStandingOutcomes: () => [],
    resourceLimits: {},
    ...(withHumanInterface
      ? {
          humanInterface: {
            describeObservation: (observation: unknown) =>
              `prompt:${JSON.stringify(observation)}> `,
            parseInput: (raw: string) => (raw === 'valid' ? { picked: raw } : undefined),
          },
        }
      : {}),
  };
}

function outputSink(): { output: Writable; text: () => string } {
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { output, text: () => chunks.join('') };
}

class FakeFallback implements ActionCollector {
  calls: RequestActionArgs[] = [];

  requestAction(args: RequestActionArgs): Promise<CollectedAction> {
    this.calls.push(args);
    return Promise.resolve({ ok: true, action: { fallback: true } });
  }
}

const BASE_ARGS: RequestActionArgs = {
  participantId: 'you',
  roundId: 0,
  observation: { round: 1 },
  deadlineMs: 5000,
  required: true,
};

describe('TerminalHumanCollector', () => {
  it('delegates non-human participant ids to the fallback collector untouched', async () => {
    const fallback = new FakeFallback();
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(),
      fallback,
      input: Readable.from([]),
    });

    const result = await collector.requestAction({ ...BASE_ARGS, participantId: 'bot-1' });

    expect(result).toEqual({ ok: true, action: { fallback: true } });
    expect(fallback.calls).toHaveLength(1);
  });

  it('prompts, reprompts on unparseable input, and returns the parsed action once valid', async () => {
    const { output, text } = outputSink();
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(),
      fallback: new FakeFallback(),
      input: Readable.from(['garbage\n', 'valid\n']),
      output,
    });

    const result = await collector.requestAction(BASE_ARGS);

    expect(result).toEqual({ ok: true, action: { picked: 'valid' } });
    // prompted twice: once before the garbage line, once more before the valid one
    expect(text().split('prompt:').length - 1).toBe(2);
  });

  it('treats "quit" as a disconnect (forfeit), not a parse attempt', async () => {
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(),
      fallback: new FakeFallback(),
      input: Readable.from(['quit\n']),
      output: outputSink().output,
    });

    const result = await collector.requestAction(BASE_ARGS);

    expect(result).toEqual({ ok: false, reason: 'disconnected' });
  });

  it('treats stdin ending with no answer as a disconnect too', async () => {
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(),
      fallback: new FakeFallback(),
      input: Readable.from([]), // ends immediately, before answering
      output: outputSink().output,
    });

    const result = await collector.requestAction(BASE_ARGS);

    expect(result).toEqual({ ok: false, reason: 'disconnected' });
  });

  it('throws a clear error if the game declares no humanInterface', async () => {
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(false),
      fallback: new FakeFallback(),
      input: Readable.from([]),
      output: outputSink().output,
    });

    await expect(collector.requestAction(BASE_ARGS)).rejects.toThrow(/humanInterface/);
  });
});
