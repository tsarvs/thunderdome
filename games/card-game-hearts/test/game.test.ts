import { type Card, cardId, containsCard, parseCardId, standardDeck } from '@thunderdome/deck-of-cards';
import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { hearts } from '../src/game.js';
import {
  applyShootTheMoon,
  dealNewHand,
  deterministicPass,
  deterministicPlay,
  isPointCard,
  legalPlaysFor,
  passDirectionForHand,
  passTargetIndex,
  pointValue,
  trickPoints,
  trickWinner,
} from '../src/rules.js';
import type { CompletedTrick, HeartsAction, HeartsState } from '../src/types.js';

const rng = createRng(Buffer.alloc(16, 1));
const PARTICIPANT_IDS: [string, string, string, string] = ['alice', 'bob', 'carol', 'dave'];

function card(id: string): Card {
  const parsed = parseCardId(id);
  if (parsed === undefined) {
    throw new Error(`invalid test card id "${id}"`);
  }
  return parsed;
}

function cards(...ids: string[]): Card[] {
  return ids.map(card);
}

function config(overrides: Partial<{ pointLimit: number }> = {}) {
  const result = hearts.parseConfig(overrides);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.value;
}

function initialState(
  participantIds: [string, string, string, string] = PARTICIPANT_IDS,
  overrides?: Partial<{ pointLimit: number }>,
) {
  return hearts.initialize({ config: config(overrides), participantIds, rng });
}

function zeroed(participantIds: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  participantIds.forEach((id) => {
    result[id] = 0;
  });
  return result;
}

function passingState(options: {
  hands: Record<string, Card[]>;
  handNumber?: number;
  participantIds?: [string, string, string, string];
  scores?: Record<string, number>;
  pointLimit?: number;
  lastTrick?: CompletedTrick | null;
}): HeartsState {
  const participantIds = options.participantIds ?? PARTICIPANT_IDS;
  return {
    phase: 'passing',
    participantIds,
    config: config(options.pointLimit !== undefined ? { pointLimit: options.pointLimit } : {}),
    handNumber: options.handNumber ?? 0,
    hands: options.hands,
    heartsBroken: false,
    tricksCompleted: 0,
    handPoints: zeroed(participantIds),
    lastTrick: options.lastTrick ?? null,
    scores: options.scores ?? zeroed(participantIds),
    matchComplete: false,
  };
}

function playingState(options: {
  hands: Record<string, Card[]>;
  currentTrick: { leaderId: string; plays: { participantId: string; card: Card }[] };
  currentPlayerIndex: 0 | 1 | 2 | 3;
  handNumber?: number;
  participantIds?: [string, string, string, string];
  heartsBroken?: boolean;
  tricksCompleted?: number;
  handPoints?: Record<string, number>;
  scores?: Record<string, number>;
  pointLimit?: number;
  lastTrick?: CompletedTrick | null;
}): HeartsState {
  const participantIds = options.participantIds ?? PARTICIPANT_IDS;
  return {
    phase: 'playing',
    participantIds,
    config: config(options.pointLimit !== undefined ? { pointLimit: options.pointLimit } : {}),
    handNumber: options.handNumber ?? 0,
    hands: options.hands,
    heartsBroken: options.heartsBroken ?? false,
    tricksCompleted: options.tricksCompleted ?? 0,
    handPoints: options.handPoints ?? zeroed(participantIds),
    lastTrick: options.lastTrick ?? null,
    scores: options.scores ?? zeroed(participantIds),
    matchComplete: false,
    currentTrick: options.currentTrick,
    currentPlayerIndex: options.currentPlayerIndex,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (src/rules.ts)
// ---------------------------------------------------------------------------

describe('pointValue / isPointCard', () => {
  it('scores each heart as 1 point', () => {
    for (const id of ['2H', '9H', 'AH']) {
      expect(pointValue(card(id))).toBe(1);
      expect(isPointCard(card(id))).toBe(true);
    }
  });

  it('scores the queen of spades as 13 points', () => {
    expect(pointValue(card('QS'))).toBe(13);
  });

  it('scores every other card as 0 points', () => {
    for (const id of ['2C', 'AS', 'KD', 'JS']) {
      expect(pointValue(card(id))).toBe(0);
      expect(isPointCard(card(id))).toBe(false);
    }
  });

  it('totals 26 points across a standard deck', () => {
    expect(standardDeck().reduce((sum, c) => sum + pointValue(c), 0)).toBe(26);
  });
});

describe('passDirectionForHand', () => {
  it('rotates left, right, across, hold, repeating every 4 hands', () => {
    const expected = ['left', 'right', 'across', 'hold', 'left', 'right', 'across', 'hold'];
    expected.forEach((direction, handNumber) => {
      expect(passDirectionForHand(handNumber)).toBe(direction);
    });
  });
});

describe('passTargetIndex', () => {
  it('sends "left" to the next seat, "right" to the previous seat, "across" two seats away', () => {
    expect(passTargetIndex('left', 0)).toBe(1);
    expect(passTargetIndex('left', 3)).toBe(0);
    expect(passTargetIndex('right', 0)).toBe(3);
    expect(passTargetIndex('right', 1)).toBe(0);
    expect(passTargetIndex('across', 0)).toBe(2);
    expect(passTargetIndex('across', 3)).toBe(1);
  });
});

describe('legalPlaysFor', () => {
  it('forces the 2 of clubs holder to lead it on the first trick', () => {
    const state = playingState({
      hands: { alice: cards('2C', '5H', 'KS'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 0,
    });
    expect(legalPlaysFor(state, 'alice').map(cardId)).toEqual(['2C']);
  });

  it('excludes hearts when leading unbroken, unless the whole hand is hearts', () => {
    const withAlternative = playingState({
      hands: { alice: cards('5H', 'KS', '3D'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 1,
    });
    expect(legalPlaysFor(withAlternative, 'alice').map(cardId).sort()).toEqual(['3D', 'KS']);

    const allHearts = playingState({
      hands: { alice: cards('5H', '9H'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 1,
    });
    expect(legalPlaysFor(allHearts, 'alice').map(cardId).sort()).toEqual(['5H', '9H']);
  });

  it('allows leading a heart once hearts are broken', () => {
    const state = playingState({
      hands: { alice: cards('5H', 'KS'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 1,
      heartsBroken: true,
    });
    expect(legalPlaysFor(state, 'alice').map(cardId).sort()).toEqual(['5H', 'KS']);
  });

  it('requires following the led suit when able', () => {
    const state = playingState({
      hands: { alice: [], bob: cards('4C', '9H', 'KS'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [{ participantId: 'alice', card: card('2C') }] },
      currentPlayerIndex: 1,
      tricksCompleted: 1,
    });
    expect(legalPlaysFor(state, 'bob').map(cardId)).toEqual(['4C']);
  });

  it('allows any card when void in the led suit (not the first trick)', () => {
    const state = playingState({
      hands: { alice: [], bob: cards('9H', 'KS'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [{ participantId: 'alice', card: card('2C') }] },
      currentPlayerIndex: 1,
      tricksCompleted: 1,
    });
    expect(legalPlaysFor(state, 'bob').map(cardId).sort()).toEqual(['9H', 'KS']);
  });

  it('excludes point cards on the first trick unless forced', () => {
    const canAvoid = playingState({
      hands: { alice: [], bob: cards('4C', 'QS'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [{ participantId: 'alice', card: card('2C') }] },
      currentPlayerIndex: 1,
      tricksCompleted: 0,
    });
    expect(legalPlaysFor(canAvoid, 'bob').map(cardId)).toEqual(['4C']);

    const forced = playingState({
      hands: { alice: [], bob: cards('9H', 'QS'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [{ participantId: 'alice', card: card('2C') }] },
      currentPlayerIndex: 1,
      tricksCompleted: 0,
    });
    expect(legalPlaysFor(forced, 'bob').map(cardId).sort()).toEqual(['9H', 'QS']);
  });

  it('excludes the queen of spades on the first trick even when following suit, if an alternative spade is available', () => {
    const state = playingState({
      hands: { alice: [], bob: cards('JS', 'QS', '4C'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [{ participantId: 'alice', card: card('2S') }] },
      currentPlayerIndex: 1,
      tricksCompleted: 0,
    });
    expect(legalPlaysFor(state, 'bob').map(cardId)).toEqual(['JS']);
  });

  it("returns an empty list when it isn't the participant's turn", () => {
    const state = playingState({
      hands: { alice: cards('2C'), bob: cards('3C'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
    });
    expect(legalPlaysFor(state, 'bob')).toEqual([]);
  });
});

describe('trickWinner', () => {
  it('awards the trick to the highest card of the led suit, ignoring a higher off-suit card', () => {
    const plays = [
      { participantId: 'alice', card: card('4C') },
      { participantId: 'bob', card: card('AS') },
      { participantId: 'carol', card: card('TC') },
      { participantId: 'dave', card: card('2C') },
    ];
    expect(trickWinner(plays)).toBe('carol');
  });
});

describe('trickPoints', () => {
  it('sums the point values of every card played to the trick', () => {
    const plays = [
      { participantId: 'alice', card: card('4C') },
      { participantId: 'bob', card: card('QS') },
      { participantId: 'carol', card: card('5H') },
      { participantId: 'dave', card: card('2C') },
    ];
    expect(trickPoints(plays)).toBe(14);
  });
});

describe('applyShootTheMoon', () => {
  it('zeroes the shooter and gives everyone else 26 when one player takes all 26 points', () => {
    expect(applyShootTheMoon({ alice: 26, bob: 0, carol: 0, dave: 0 })).toEqual({
      alice: 0,
      bob: 26,
      carol: 26,
      dave: 26,
    });
  });

  it('leaves a normal distribution unchanged', () => {
    const points = { alice: 10, bob: 6, carol: 5, dave: 5 };
    expect(applyShootTheMoon(points)).toEqual(points);
  });
});

describe('deterministicPass / deterministicPlay', () => {
  it('deterministically passes the 3 highest-ranked cards', () => {
    const hand = cards('2C', 'AS', 'QH', '5D', 'KC');
    const first = deterministicPass(hand);
    const second = deterministicPass(hand);
    expect(first.map(cardId).sort()).toEqual(second.map(cardId).sort());
    expect(first.map(cardId).sort()).toEqual(['AS', 'KC', 'QH']);
  });

  it('plays the forced 2 of clubs when that is the only legal card', () => {
    const state = playingState({
      hands: { alice: cards('2C', '5H', 'KS'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 0,
    });
    expect(cardId(deterministicPlay(state, 'alice'))).toBe('2C');
  });

  it('otherwise always returns a member of legalPlaysFor', () => {
    const state = playingState({
      hands: { alice: cards('9H', 'KS', '3D'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 1,
    });
    const play = deterministicPlay(state, 'alice');
    expect(legalPlaysFor(state, 'alice').map(cardId)).toContain(cardId(play));
  });
});

// ---------------------------------------------------------------------------
// GameDefinition methods
// ---------------------------------------------------------------------------

describe('hearts.parseConfig', () => {
  it('defaults pointLimit to 100', () => {
    const result = hearts.parseConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pointLimit).toBe(100);
    }
  });

  it('accepts an in-range pointLimit', () => {
    expect(hearts.parseConfig({ pointLimit: 50 }).ok).toBe(true);
  });

  it('rejects a pointLimit below 20 or above 1000', () => {
    expect(hearts.parseConfig({ pointLimit: 10 }).ok).toBe(false);
    expect(hearts.parseConfig({ pointLimit: 1001 }).ok).toBe(false);
  });

  it('rejects a non-integer pointLimit', () => {
    expect(hearts.parseConfig({ pointLimit: 50.5 }).ok).toBe(false);
  });
});

describe('hearts.initialize', () => {
  it('throws for a roster that is not exactly 4 participants', () => {
    expect(() =>
      hearts.initialize({ config: config(), participantIds: ['alice', 'bob'], rng }),
    ).toThrow('exactly 4 participants');
  });

  it('deals 52 unique cards split 13/13/13/13', () => {
    const state = initialState();
    const allIds = PARTICIPANT_IDS.flatMap((id) => state.hands[id]?.map(cardId) ?? []);
    expect(new Set(allIds).size).toBe(52);
    for (const id of PARTICIPANT_IDS) {
      expect(state.hands[id]).toHaveLength(13);
    }
  });

  it('starts hand 0 in the passing phase (hand 1 always passes left)', () => {
    const state = initialState();
    expect(state.handNumber).toBe(0);
    expect(state.phase).toBe('passing');
  });

  it('starts every score at 0 with matchComplete false', () => {
    const state = initialState();
    for (const id of PARTICIPANT_IDS) {
      expect(state.scores[id]).toBe(0);
    }
    expect(state.matchComplete).toBe(false);
  });

  it('is deterministic for a fixed seed', () => {
    const a = hearts.initialize({
      config: config(),
      participantIds: PARTICIPANT_IDS,
      rng: createRng(Buffer.alloc(16, 1)),
    });
    const b = hearts.initialize({
      config: config(),
      participantIds: PARTICIPANT_IDS,
      rng: createRng(Buffer.alloc(16, 1)),
    });
    for (const id of PARTICIPANT_IDS) {
      expect(a.hands[id]?.map(cardId)).toEqual(b.hands[id]?.map(cardId));
    }
  });
});

describe('hearts.getObservation', () => {
  it("exposes your own hand in full but only other hands' sizes", () => {
    const state = playingState({
      hands: { alice: cards('2C', '5H'), bob: cards('3C', '4C', '9H'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
    });
    const observation = hearts.getObservation(state, 'alice');
    expect(observation.hand.map(cardId).sort()).toEqual(['2C', '5H']);
    expect(observation.handSizes).toEqual({ alice: 2, bob: 3, carol: 0, dave: 0 });
    expect(JSON.stringify(observation)).not.toContain('3C');
  });

  it('reports currentTrick as null while passing', () => {
    const state = passingState({ hands: { alice: cards('2C'), bob: [], carol: [], dave: [] } });
    expect(hearts.getObservation(state, 'alice').currentTrick).toBeNull();
  });

  it('includes legalPlays only for the participant whose turn it is', () => {
    const state = playingState({
      hands: { alice: cards('2C'), bob: cards('3C'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
    });
    expect(hearts.getObservation(state, 'alice').legalPlays).toBeDefined();
    expect(hearts.getObservation(state, 'bob').legalPlays).toBeUndefined();
  });

  it('throws for an unknown participant', () => {
    expect(() => hearts.getObservation(initialState(), 'nobody')).toThrow();
  });
});

describe('hearts.getPendingActions', () => {
  it('requires all 4 participants during the passing phase', () => {
    const state = passingState({ hands: { alice: [], bob: [], carol: [], dave: [] } });
    expect(hearts.getPendingActions(state)).toEqual(
      PARTICIPANT_IDS.map((participantId) => ({ participantId, required: true })),
    );
  });

  it('requires only the current player during the playing phase', () => {
    const state = playingState({
      hands: { alice: [], bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'carol', plays: [] },
      currentPlayerIndex: 2,
    });
    expect(hearts.getPendingActions(state)).toEqual([{ participantId: 'carol', required: true }]);
  });
});

describe('hearts.validateAction', () => {
  it('accepts a valid pass of 3 distinct owned cards', () => {
    const state = passingState({
      hands: { alice: cards('2C', '5H', '9D', 'KS'), bob: [], carol: [], dave: [] },
    });
    expect(
      hearts.validateAction(state, 'alice', { type: 'pass', cards: cards('2C', '5H', '9D') }).ok,
    ).toBe(true);
  });

  it('rejects a pass with a duplicate card', () => {
    const state = passingState({
      hands: { alice: cards('2C', '5H', '9D'), bob: [], carol: [], dave: [] },
    });
    const action = { type: 'pass', cards: [card('2C'), card('2C'), card('5H')] };
    expect(hearts.validateAction(state, 'alice', action).ok).toBe(false);
  });

  it('rejects a pass of a card not in hand', () => {
    const state = passingState({
      hands: { alice: cards('2C', '5H', '9D'), bob: [], carol: [], dave: [] },
    });
    expect(
      hearts.validateAction(state, 'alice', { type: 'pass', cards: cards('2C', '5H', 'AS') }).ok,
    ).toBe(false);
  });

  it('rejects a pass submitted during the playing phase', () => {
    const state = playingState({
      hands: { alice: cards('2C', '5H', '9D'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
    });
    expect(
      hearts.validateAction(state, 'alice', { type: 'pass', cards: cards('2C', '5H', '9D') }).ok,
    ).toBe(false);
  });

  it('rejects a play submitted during the passing phase', () => {
    const state = passingState({ hands: { alice: cards('2C'), bob: [], carol: [], dave: [] } });
    expect(hearts.validateAction(state, 'alice', { type: 'play', card: card('2C') }).ok).toBe(
      false,
    );
  });

  it('rejects playing a card not in hand', () => {
    const state = playingState({
      hands: { alice: cards('2C'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
    });
    expect(hearts.validateAction(state, 'alice', { type: 'play', card: card('5H') }).ok).toBe(
      false,
    );
  });

  it('rejects an off-suit play when able to follow', () => {
    const state = playingState({
      hands: { alice: [], bob: cards('4C', '9H'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [{ participantId: 'alice', card: card('2C') }] },
      currentPlayerIndex: 1,
      tricksCompleted: 1,
    });
    expect(hearts.validateAction(state, 'bob', { type: 'play', card: card('9H') }).ok).toBe(false);
    expect(hearts.validateAction(state, 'bob', { type: 'play', card: card('4C') }).ok).toBe(true);
  });

  it('rejects leading a heart when unbroken and a non-heart is available', () => {
    const state = playingState({
      hands: { alice: cards('5H', 'KS'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 1,
    });
    expect(hearts.validateAction(state, 'alice', { type: 'play', card: card('5H') }).ok).toBe(
      false,
    );
    expect(hearts.validateAction(state, 'alice', { type: 'play', card: card('KS') }).ok).toBe(true);
  });

  it('accepts leading a heart when the whole hand is hearts (forced)', () => {
    const state = playingState({
      hands: { alice: cards('5H', '9H'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 1,
    });
    expect(hearts.validateAction(state, 'alice', { type: 'play', card: card('5H') }).ok).toBe(true);
  });

  it('rejects a point card on the first trick when a legal alternative exists', () => {
    const state = playingState({
      hands: { alice: [], bob: cards('4C', 'QS'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [{ participantId: 'alice', card: card('2C') }] },
      currentPlayerIndex: 1,
      tricksCompleted: 0,
    });
    expect(hearts.validateAction(state, 'bob', { type: 'play', card: card('QS') }).ok).toBe(false);
  });

  it('accepts a forced point card on the first trick when no alternative exists', () => {
    const state = playingState({
      hands: { alice: [], bob: cards('9H', 'QS'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [{ participantId: 'alice', card: card('2C') }] },
      currentPlayerIndex: 1,
      tricksCompleted: 0,
    });
    expect(hearts.validateAction(state, 'bob', { type: 'play', card: card('9H') }).ok).toBe(true);
  });

  it("rejects the 2 of clubs holder attempting anything else on hand 1's opening lead", () => {
    const state = playingState({
      hands: { alice: cards('2C', '5H'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 0,
    });
    expect(hearts.validateAction(state, 'alice', { type: 'play', card: card('5H') }).ok).toBe(
      false,
    );
    expect(hearts.validateAction(state, 'alice', { type: 'play', card: card('2C') }).ok).toBe(true);
  });
});

describe('hearts.resolve', () => {
  it('reassigns cards for a "left" pass and recomputes the leader after reassignment', () => {
    const state = passingState({
      handNumber: 0, // hand 0 => 'left'
      hands: {
        alice: cards('3C', '4C', '5C'),
        bob: cards('2C', '6C', '7C'), // bob holds the 2C — passing left moves it to carol
        carol: cards('9C', 'TC', 'JC'),
        dave: cards('QC', 'KC', 'AC'),
      },
    });
    const actions = new Map<string, HeartsAction>([
      ['alice', { type: 'pass', cards: cards('3C', '4C', '5C') as [Card, Card, Card] }],
      ['bob', { type: 'pass', cards: cards('2C', '6C', '7C') as [Card, Card, Card] }],
      ['carol', { type: 'pass', cards: cards('9C', 'TC', 'JC') as [Card, Card, Card] }],
      ['dave', { type: 'pass', cards: cards('QC', 'KC', 'AC') as [Card, Card, Card] }],
    ]);
    const { nextState, events } = hearts.resolve({ state, actions, rng });
    if (nextState.phase !== 'playing') {
      throw new Error('expected the playing phase after passing');
    }

    expect(nextState.hands.alice?.map(cardId).sort()).toEqual(['AC', 'KC', 'QC']);
    expect(nextState.hands.bob?.map(cardId).sort()).toEqual(['3C', '4C', '5C']);
    expect(nextState.hands.carol?.map(cardId).sort()).toEqual(['2C', '6C', '7C']);
    expect(nextState.hands.dave?.map(cardId).sort()).toEqual(['9C', 'JC', 'TC']);

    // The 2C moved from bob to carol, so carol — not the pre-pass holder — leads.
    expect(nextState.currentTrick.leaderId).toBe('carol');
    expect(nextState.currentPlayerIndex).toBe(2);
    expect(events.some((event) => event.type === 'cards-passed')).toBe(true);
  });

  it('passes to the correct target seat for "right" and "across"', () => {
    const makeState = (handNumber: number) =>
      passingState({
        handNumber,
        hands: {
          alice: cards('3C', '4C', '5C'),
          bob: cards('2C', '7C', '8C'), // holds the 2C — needed so a post-pass leader lookup succeeds
          carol: cards('9C', 'TC', 'JC'),
          dave: cards('QC', 'KC', 'AC'),
        },
      });
    const actionsFor = (state: HeartsState) => {
      const map = new Map<string, HeartsAction>();
      for (const id of PARTICIPANT_IDS) {
        const hand = state.hands[id] ?? [];
        map.set(id, { type: 'pass', cards: hand as [Card, Card, Card] });
      }
      return map;
    };

    const rightState = makeState(1); // hand 1 => 'right'
    const rightResult = hearts.resolve({ state: rightState, actions: actionsFor(rightState), rng });
    expect(rightResult.nextState.hands.alice?.map(cardId).sort()).toEqual(['2C', '7C', '8C']); // from bob

    const acrossState = makeState(2); // hand 2 => 'across'
    const acrossResult = hearts.resolve({
      state: acrossState,
      actions: actionsFor(acrossState),
      rng,
    });
    expect(acrossResult.nextState.hands.alice?.map(cardId).sort()).toEqual(['9C', 'JC', 'TC']); // from carol
  });

  it('never produces a passing state on a hold hand', () => {
    const setup = dealNewHand(PARTICIPANT_IDS, 3, rng); // hand index 3 => 'hold'
    expect(setup.phase).toBe('playing');
  });

  it('removes the played card, keeps the trick open, and does not break hearts on a non-heart play', () => {
    const state = playingState({
      hands: { alice: cards('2C', '5H'), bob: cards('3C'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 0,
    });
    const actions = new Map<string, HeartsAction>([['alice', { type: 'play', card: card('2C') }]]);
    const { nextState } = hearts.resolve({ state, actions, rng });
    if (nextState.phase !== 'playing') {
      throw new Error('expected the playing phase');
    }
    expect(nextState.hands.alice?.map(cardId)).toEqual(['5H']);
    expect(nextState.currentTrick.plays).toHaveLength(1);
    expect(nextState.heartsBroken).toBe(false);
    expect(nextState.currentPlayerIndex).toBe(1);
  });

  it('sets heartsBroken when a heart is played', () => {
    const state = playingState({
      hands: { alice: [], bob: cards('9H'), carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [{ participantId: 'alice', card: card('2C') }] },
      currentPlayerIndex: 1,
      tricksCompleted: 1,
    });
    const actions = new Map<string, HeartsAction>([['bob', { type: 'play', card: card('9H') }]]);
    const { nextState } = hearts.resolve({ state, actions, rng });
    if (nextState.phase !== 'playing') {
      throw new Error('expected the playing phase');
    }
    expect(nextState.heartsBroken).toBe(true);
  });

  it('completes a trick, ignoring a higher off-suit decoy, tallies points, and opens a new trick led by the winner', () => {
    const state = playingState({
      hands: { alice: [], bob: [], carol: [], dave: cards('QS') },
      currentTrick: {
        leaderId: 'alice',
        plays: [
          { participantId: 'alice', card: card('4C') },
          { participantId: 'bob', card: card('AS') }, // higher rank, off-suit — must not win
          { participantId: 'carol', card: card('TC') },
        ],
      },
      currentPlayerIndex: 3,
      tricksCompleted: 1,
    });
    const actions = new Map<string, HeartsAction>([['dave', { type: 'play', card: card('QS') }]]);
    const { nextState, events } = hearts.resolve({ state, actions, rng });
    if (nextState.phase !== 'playing') {
      throw new Error('expected the playing phase');
    }
    expect(nextState.currentTrick.leaderId).toBe('carol'); // highest club wins, not the AS
    expect(nextState.currentTrick.plays).toHaveLength(0);
    expect(nextState.tricksCompleted).toBe(2);
    expect(nextState.handPoints.carol).toBe(13); // captured the QS played into this trick
    expect(events.some((event) => event.type === 'trick-won')).toBe(true);
    expect(nextState.lastTrick).toEqual({
      winnerId: 'carol',
      plays: [
        { participantId: 'alice', card: card('4C') },
        { participantId: 'bob', card: card('AS') },
        { participantId: 'carol', card: card('TC') },
        { participantId: 'dave', card: card('QS') },
      ],
    });
  });

  it('resets lastTrick to null when a new hand is dealt', () => {
    const state = playingState({
      hands: { alice: [], bob: [], carol: [], dave: cards('QS') },
      currentTrick: {
        leaderId: 'alice',
        plays: [
          { participantId: 'alice', card: card('4C') },
          { participantId: 'bob', card: card('AS') },
          { participantId: 'carol', card: card('TC') },
        ],
      },
      currentPlayerIndex: 3,
      tricksCompleted: 12,
    });
    const actions = new Map<string, HeartsAction>([['dave', { type: 'play', card: card('QS') }]]);
    const { nextState } = hearts.resolve({ state, actions, rng });
    expect(nextState.lastTrick).toBeNull();
  });

  it('scores the hand and deals a new hand when trick 13 completes without a shoot-the-moon', () => {
    const state = playingState({
      hands: { alice: [], bob: [], carol: [], dave: cards('QS') },
      currentTrick: {
        leaderId: 'alice',
        plays: [
          { participantId: 'alice', card: card('4C') },
          { participantId: 'bob', card: card('AS') },
          { participantId: 'carol', card: card('TC') },
        ],
      },
      currentPlayerIndex: 3,
      tricksCompleted: 12,
      handPoints: { alice: 5, bob: 8, carol: 3, dave: 2 },
      scores: { alice: 50, bob: 40, carol: 30, dave: 20 },
    });
    const actions = new Map<string, HeartsAction>([['dave', { type: 'play', card: card('QS') }]]);
    const { nextState, events } = hearts.resolve({ state, actions, rng });

    // carol wins the final trick and captures the QS (13pts): 3 + 13 = 16.
    expect(nextState.scores).toEqual({ alice: 55, bob: 48, carol: 46, dave: 22 });
    expect(nextState.matchComplete).toBe(false);
    expect(nextState.handNumber).toBe(1);
    expect(nextState.hands.alice).toHaveLength(13); // freshly redealt
    expect(events.some((event) => event.type === 'hand-scored')).toBe(true);
  });

  it('applies shoot-the-moon (0 for the shooter, 26 for everyone else) when trick 13 completes', () => {
    const state = playingState({
      hands: { alice: [], bob: [], carol: [], dave: cards('QS') },
      currentTrick: {
        leaderId: 'alice',
        plays: [
          { participantId: 'alice', card: card('4C') },
          { participantId: 'bob', card: card('AS') },
          { participantId: 'carol', card: card('TC') },
        ],
      },
      currentPlayerIndex: 3,
      tricksCompleted: 12,
      handPoints: { alice: 0, bob: 0, carol: 13, dave: 0 },
    });
    const actions = new Map<string, HeartsAction>([['dave', { type: 'play', card: card('QS') }]]);
    const { nextState } = hearts.resolve({ state, actions, rng });
    expect(nextState.scores).toEqual({ alice: 26, bob: 26, carol: 0, dave: 26 });
  });

  it('sets matchComplete once a score reaches pointLimit, without dealing a further hand', () => {
    const state = playingState({
      hands: { alice: [], bob: [], carol: [], dave: cards('QS') },
      currentTrick: {
        leaderId: 'alice',
        plays: [
          { participantId: 'alice', card: card('4C') },
          { participantId: 'bob', card: card('AS') },
          { participantId: 'carol', card: card('TC') },
        ],
      },
      currentPlayerIndex: 3,
      tricksCompleted: 12,
      scores: { alice: 10, bob: 10, carol: 90, dave: 10 },
      pointLimit: 100,
    });
    const actions = new Map<string, HeartsAction>([['dave', { type: 'play', card: card('QS') }]]);
    const { nextState, events } = hearts.resolve({ state, actions, rng });
    expect(nextState.matchComplete).toBe(true);
    expect(nextState.scores.carol).toBe(103);
    expect(nextState.handNumber).toBe(0); // stays at the hand that just finished — no further deal
    expect(events.some((event) => event.type === 'match-complete')).toBe(true);
  });

  it('rotates the passing direction correctly across consecutive hands', () => {
    for (const handNumber of [0, 1, 2]) {
      const state = playingState({
        handNumber,
        hands: { alice: [], bob: [], carol: [], dave: cards('QS') },
        currentTrick: {
          leaderId: 'alice',
          plays: [
            { participantId: 'alice', card: card('4C') },
            { participantId: 'bob', card: card('AS') },
            { participantId: 'carol', card: card('TC') },
          ],
        },
        currentPlayerIndex: 3,
        tricksCompleted: 12,
      });
      const actions = new Map<string, HeartsAction>([['dave', { type: 'play', card: card('QS') }]]);
      const { nextState } = hearts.resolve({ state, actions, rng });
      expect(nextState.handNumber).toBe(handNumber + 1);
      const expectedPhase = passDirectionForHand(handNumber + 1) === 'hold' ? 'playing' : 'passing';
      expect(nextState.phase).toBe(expectedPhase);
    }
  });
});

describe('hearts.isTerminal', () => {
  it('is false until matchComplete, true after', () => {
    const state = initialState();
    expect(hearts.isTerminal(state)).toBe(false);
    expect(hearts.isTerminal({ ...state, matchComplete: true })).toBe(true);
  });
});

describe('hearts.getResult / hearts.getStandingOutcomes', () => {
  it('ranks a fully decisive result 1/2/3/4 with a single winner and the rest losses', () => {
    const state = { ...initialState(), scores: { alice: 40, bob: 60, carol: 20, dave: 80 } };
    const result = hearts.getResult(state);
    expect(result).toEqual({
      participantIds: PARTICIPANT_IDS,
      scores: state.scores,
      handsPlayed: 1,
    });
    expect(hearts.getStandingOutcomes(result)).toEqual([
      { participantId: 'alice', rank: 2, score: 40, outcome: 'loss' },
      { participantId: 'bob', rank: 3, score: 60, outcome: 'loss' },
      { participantId: 'carol', rank: 1, score: 20, outcome: 'win' },
      { participantId: 'dave', rank: 4, score: 80, outcome: 'loss' },
    ]);
  });

  it('reports a draw for a 2-way tie at the best score, and skips the next rank', () => {
    const result = {
      participantIds: PARTICIPANT_IDS,
      scores: { alice: 10, bob: 10, carol: 30, dave: 40 },
      handsPlayed: 1,
    };
    const outcomes = hearts.getStandingOutcomes(result);
    expect(outcomes.find((o) => o.participantId === 'alice')).toMatchObject({
      rank: 1,
      outcome: 'draw',
    });
    expect(outcomes.find((o) => o.participantId === 'bob')).toMatchObject({
      rank: 1,
      outcome: 'draw',
    });
    expect(outcomes.find((o) => o.participantId === 'carol')).toMatchObject({
      rank: 3,
      outcome: 'loss',
    });
  });

  it('reports a 4-way draw when every score ties', () => {
    const result = {
      participantIds: PARTICIPANT_IDS,
      scores: { alice: 50, bob: 50, carol: 50, dave: 50 },
      handsPlayed: 1,
    };
    const outcomes = hearts.getStandingOutcomes(result);
    expect(outcomes.every((o) => o.rank === 1 && o.outcome === 'draw')).toBe(true);
  });

  it('reports a loss (not a draw) for a tie that is not at the best rank', () => {
    const result = {
      participantIds: PARTICIPANT_IDS,
      scores: { alice: 10, bob: 20, carol: 20, dave: 30 },
      handsPlayed: 1,
    };
    const outcomes = hearts.getStandingOutcomes(result);
    expect(outcomes.find((o) => o.participantId === 'alice')).toMatchObject({
      rank: 1,
      outcome: 'win',
    });
    expect(outcomes.find((o) => o.participantId === 'bob')).toMatchObject({
      rank: 2,
      outcome: 'loss',
    });
    expect(outcomes.find((o) => o.participantId === 'carol')).toMatchObject({
      rank: 2,
      outcome: 'loss',
    });
    expect(outcomes.find((o) => o.participantId === 'dave')).toMatchObject({
      rank: 4,
      outcome: 'loss',
    });
  });
});

describe('hearts.onMissingAction', () => {
  it('substitutes 3 cards from the hand during the passing phase', () => {
    const state = passingState({
      hands: { alice: cards('2C', '9H', 'KS', '4D'), bob: [], carol: [], dave: [] },
    });
    const decision = hearts.onMissingAction?.({ state, participantId: 'alice', reason: 'timeout' });
    if (decision?.policy !== 'substitute' || decision.action.type !== 'pass') {
      throw new Error('expected a pass substitute');
    }
    for (const c of decision.action.cards) {
      expect(containsCard(state.hands.alice ?? [], c)).toBe(true);
    }
  });

  it('substitutes a legal card during the playing phase, including the forced 2 of clubs case', () => {
    const state = playingState({
      hands: { alice: cards('2C', '5H', 'KS'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 0,
    });
    const decision = hearts.onMissingAction?.({ state, participantId: 'alice', reason: 'timeout' });
    if (decision?.policy !== 'substitute' || decision.action.type !== 'play') {
      throw new Error('expected a play substitute');
    }
    expect(cardId(decision.action.card)).toBe('2C');
  });
});

describe('hearts.humanInterface', () => {
  const humanInterface = hearts.humanInterface;
  if (humanInterface === undefined) {
    throw new Error('hearts must implement humanInterface');
  }

  it('describes a passing-phase observation, with an inline format example', () => {
    const state = passingState({
      hands: { alice: cards('2C', '9H', 'KS'), bob: [], carol: [], dave: [] },
    });
    const text = humanInterface.describeObservation(hearts.getObservation(state, 'alice'));
    expect(text).toContain('passing');
    expect(text).toContain('Pass 3 cards');
    expect(text).toContain('2C');
    expect(text).toContain('Type: PASS <card> <card> <card>');
    expect(text).toMatch(/example: PASS \w+ \w+ \w+/);
  });

  it('describes a playing-phase observation with legal plays and an inline format example', () => {
    const state = playingState({
      hands: { alice: cards('2C', '5H'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'alice', plays: [] },
      currentPlayerIndex: 0,
      tricksCompleted: 0,
    });
    const text = humanInterface.describeObservation(hearts.getObservation(state, 'alice'));
    expect(text).toContain('Legal plays: 2C');
    expect(text).toContain('Type: PLAY <card>');
    // The example must itself be a legal card, not just any notation sample.
    expect(text).toContain('example: PLAY 2C');
  });

  it('always includes the card-notation legend', () => {
    const state = passingState({ hands: { alice: cards('2C'), bob: [], carol: [], dave: [] } });
    const text = humanInterface.describeObservation(hearts.getObservation(state, 'alice'));
    expect(text).toContain('T=10');
    expect(text).toContain('C=clubs');
  });

  it('starts every prompt with a separator, to break up consecutive turns', () => {
    const state = passingState({ hands: { alice: cards('2C'), bob: [], carol: [], dave: [] } });
    const text = humanInterface.describeObservation(hearts.getObservation(state, 'alice'));
    expect(text.startsWith('----------')).toBe(true);
  });

  it('shows the last completed trick and its winner, relabeling your own plays as "you"', () => {
    const state = playingState({
      hands: { alice: cards('5D'), bob: [], carol: [], dave: [] },
      currentTrick: { leaderId: 'carol', plays: [] },
      currentPlayerIndex: 2,
      tricksCompleted: 1,
      lastTrick: {
        winnerId: 'carol',
        plays: [
          { participantId: 'alice', card: card('4C') },
          { participantId: 'bob', card: card('AS') },
          { participantId: 'carol', card: card('TC') },
          { participantId: 'dave', card: card('2C') },
        ],
      },
    });
    const text = humanInterface.describeObservation(hearts.getObservation(state, 'alice'));
    expect(text).toContain('Last trick: you: 4C, bob: AS, carol: TC, dave: 2C — won by carol');
  });

  it('omits the last-trick line before any trick has completed', () => {
    const state = passingState({ hands: { alice: cards('2C'), bob: [], carol: [], dave: [] } });
    const text = humanInterface.describeObservation(hearts.getObservation(state, 'alice'));
    expect(text).not.toContain('Last trick:');
  });

  it('parses valid PASS/PLAY input, including lowercase and the "10" alias', () => {
    expect(humanInterface.parseInput('PASS 2C 5C TH')).toEqual({
      type: 'pass',
      cards: [card('2C'), card('5C'), card('TH')],
    });
    expect(humanInterface.parseInput('play qs')).toEqual({ type: 'play', card: card('QS') });
    expect(humanInterface.parseInput('PLAY 10H')).toEqual({ type: 'play', card: card('TH') });
  });

  it('rejects malformed input', () => {
    expect(humanInterface.parseInput('PASS 2C 5C')).toBeUndefined();
    expect(humanInterface.parseInput('PLAY ZZ')).toBeUndefined();
    expect(humanInterface.parseInput('FOO')).toBeUndefined();
  });

  it('confirms a pass action with the cards actually understood, sorted for readability', () => {
    if (humanInterface.describeAction === undefined) {
      throw new Error('hearts must implement describeAction');
    }
    const text = humanInterface.describeAction({
      type: 'pass',
      cards: cards('KS', '2C', '9H') as [Card, Card, Card],
    });
    expect(text).toBe('Passed: 2C 9H KS');
  });

  it('confirms a play action with the card actually understood', () => {
    if (humanInterface.describeAction === undefined) {
      throw new Error('hearts must implement describeAction');
    }
    expect(humanInterface.describeAction({ type: 'play', card: card('QS') })).toBe('Played: QS');
  });
});
