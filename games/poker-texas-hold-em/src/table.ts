/**
 * Pure helpers for seating order, blind/action-order positions, and side-pot math. Split out from
 * `game.ts` because heads-up (2 players) genuinely inverts several of these rules relative to
 * 3+-handed play — keeping the formulas named and tested in isolation is worth it.
 */

/** Table order rotated to start at the button, filtered down to players still in the match
 * (i.e. not busted out). `seatOrder[0]` is always the button. */
export function buildSeatOrder(
  participantIds: readonly string[],
  buttonParticipantId: string,
  bustedOut: ReadonlySet<string>,
): string[] {
  const buttonIndex = participantIds.indexOf(buttonParticipantId);
  if (buttonIndex === -1) {
    throw new Error(`unreachable: "${buttonParticipantId}" is not in participantIds`);
  }
  const rotated = [...participantIds.slice(buttonIndex), ...participantIds.slice(0, buttonIndex)];
  return rotated.filter((id) => !bustedOut.has(id));
}

/** The next player (in fixed table order, wrapping) after `currentButtonId` who hasn't busted
 * out — i.e. where the button moves for the next hand. */
export function nextButton(
  participantIds: readonly string[],
  currentButtonId: string,
  bustedOut: ReadonlySet<string>,
): string {
  const n = participantIds.length;
  const startIndex = participantIds.indexOf(currentButtonId);
  if (startIndex === -1) {
    throw new Error(`unreachable: "${currentButtonId}" is not in participantIds`);
  }
  for (let step = 1; step <= n; step += 1) {
    const candidate = participantIds[(startIndex + step) % n];
    if (candidate !== undefined && !bustedOut.has(candidate)) {
      return candidate;
    }
  }
  throw new Error('unreachable: nextButton requires at least 2 active (non-busted) players');
}

/**
 * Heads-up inverts two rules relative to 3+-handed play: the button (who is also the small
 * blind) acts FIRST preflop but LAST on every later street, whereas at 3+ players the button
 * always acts last. `seatOrder` is button-relative (`seatOrder[0]` = button), so these return
 * indices into it.
 */
export function smallBlindSeatIndex(seatCount: number): number {
  return seatCount === 2 ? 0 : 1;
}
export function bigBlindSeatIndex(seatCount: number): number {
  return seatCount === 2 ? 1 : 2;
}
export function preflopFirstToActIndex(seatCount: number): number {
  return seatCount === 2 ? 0 : 3 % seatCount;
}
export function postflopFirstToActIndex(seatCount: number): number {
  return 1 % seatCount;
}

export interface PotShare {
  amount: number;
  /** Participants whose contribution reached this pot layer and who haven't folded — the only
   * ones who can win it. A side pot can have zero eligible winners (everyone who reached that
   * layer folded); such a pot is still awarded, to whichever earlier/lower layer's winners
   * remain, by the caller working pot-by-pot. */
  eligibleParticipantIds: string[];
}

/**
 * Splits total contributions into main pot + side pots. Standard layered algorithm: repeatedly
 * take the smallest remaining contribution among everyone who still has chips left to allocate,
 * multiply by the number of contributors at that layer, and peel that layer off everyone.
 * Folded players still contribute chips to whatever layers their commitment reaches — they just
 * aren't eligible to win any of them.
 */
export function computeSidePots(
  committed: Readonly<Record<string, number>>,
  folded: ReadonlySet<string>,
): PotShare[] {
  const remaining = new Map(Object.entries(committed).filter(([, amount]) => amount > 0));
  const pots: PotShare[] = [];
  while (remaining.size > 0) {
    const minContribution = Math.min(...remaining.values());
    const contributorIds = [...remaining.keys()];
    pots.push({
      amount: minContribution * contributorIds.length,
      eligibleParticipantIds: contributorIds.filter((id) => !folded.has(id)),
    });
    for (const id of contributorIds) {
      const left = (remaining.get(id) ?? 0) - minContribution;
      if (left > 0) {
        remaining.set(id, left);
      } else {
        remaining.delete(id);
      }
    }
  }
  return pots;
}

/** Orders `winnerIds` starting from the seat immediately after the button (wrapping), so an
 * odd remainder chip from a split pot can be handed out one at a time in that order — the
 * standard convention (closest to acting first postflop gets it before the button would). */
export function oddChipOrder(winnerIds: readonly string[], seatOrder: readonly string[]): string[] {
  const n = seatOrder.length;
  return [...winnerIds].sort((a, b) => {
    const rankOf = (id: string) => {
      const index = seatOrder.indexOf(id);
      return (index - 1 + n) % n;
    };
    return rankOf(a) - rankOf(b);
  });
}
