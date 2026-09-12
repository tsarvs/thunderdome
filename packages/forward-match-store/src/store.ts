// A forward match record's persistence: one JSON file per matchId, no database
// (docs/architecture.md §10 — deliberately out of scope right now). Two deliberate deviations
// from @thunderdome/tournament-store's own store.ts, both because a forward match's own
// correctness bar is explicitly higher (docs/adr/0013-forward-match-persistence.md):
//
// 1. Saves are ATOMIC (write to a temp file in the SAME directory, then `rename` — same-filesystem
//    rename is atomic on POSIX; a temp file elsewhere, e.g. os.tmpdir(), would not be, and could
//    even fail with EXDEV across filesystems). A crash mid-write must never leave a half-written,
//    unparseable record behind — tournament-store's plain `writeFile` doesn't need this guarantee
//    (a tournament's own persistence is a nice-to-have inspection trail; a forward match's is the
//    only record of a portfolio's real history).
// 2. `load` returns a THREE-way outcome (found/not-found/corrupt), not tournament-store's two-way
//    `Result` (which conflates "missing" and "corrupt" into one error string). A forward match's
//    create-or-resume caller genuinely needs to tell these apart: "not found" means create a fresh
//    match; "corrupt" must be a hard failure, never silently treated as "not found" (which would
//    quietly create a brand-new match under the same id, discarding whatever trading history the
//    corrupted file held).
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from './result.js';
import { ForwardMatchRecordSchema, type ForwardMatchRecord, type ForwardMatchSummary } from './types.js';

function recordPath(storeDir: string, matchId: string): string {
  return path.join(storeDir, `${matchId}.json`);
}

/** Atomic overwrite of the whole record file — see this module's own doc comment for why this
 * differs from `tournament-store`'s plain `writeFile`. */
export async function saveForwardMatchRecord(
  storeDir: string,
  record: ForwardMatchRecord,
): Promise<Result<void>> {
  await mkdir(storeDir, { recursive: true });
  const finalPath = recordPath(storeDir, record.matchId);
  const tmpPath = `${finalPath}.${String(process.pid)}.${String(Date.now())}.tmp`;
  try {
    await writeFile(tmpPath, JSON.stringify(record, null, 2), 'utf8');
    await rename(tmpPath, finalPath);
    return ok(undefined);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {
      // Best-effort cleanup only — the save has already failed either way, and a stray .tmp file
      // is invisible to load()/list() (both filter to exactly `${matchId}.json`).
    });
    return err(`failed to save forward match record "${record.matchId}": ${String(error)}`);
  }
}

export type LoadForwardMatchRecordOutcome =
  | { status: 'found'; record: ForwardMatchRecord }
  | { status: 'not-found' }
  | { status: 'corrupt'; reason: string };

/** Three-way, not a `Result` — see this module's own doc comment for why a create-or-resume
 * caller needs "missing" and "corrupt" to be distinguishable. */
export async function loadForwardMatchRecord(
  storeDir: string,
  matchId: string,
): Promise<LoadForwardMatchRecordOutcome> {
  let raw: string;
  try {
    raw = await readFile(recordPath(storeDir, matchId), 'utf8');
  } catch {
    return { status: 'not-found' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', reason: `forward match record "${matchId}" is not valid JSON` };
  }

  const result = ForwardMatchRecordSchema.safeParse(parsed);
  return result.success
    ? { status: 'found', record: result.data }
    : { status: 'corrupt', reason: `forward match record "${matchId}" is corrupt: ${result.error.message}` };
}

export interface ListForwardMatchRecordsResult {
  summaries: ForwardMatchSummary[];
  /** One entry per `.json` file that failed to load/validate — collected rather than thrown, so
   * one corrupt record never hides every other forward match from the list. A stray leftover
   * `.tmp` file from an interrupted save is never even considered (filtered to `.json` below), so
   * it neither appears here nor as an issue. */
  issues: { path: string; message: string }[];
}

/** Newest-first by `updatedAt`. Corrupt or unreadable files are reported in `issues`, not thrown. */
export async function listForwardMatchRecords(storeDir: string): Promise<ListForwardMatchRecordsResult> {
  let files: string[];
  try {
    files = await readdir(storeDir);
  } catch {
    return { summaries: [], issues: [] }; // the store dir doesn't exist yet — no matches, not an error
  }

  const summaries: ForwardMatchSummary[] = [];
  const issues: { path: string; message: string }[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const matchId = file.slice(0, -'.json'.length);
    const outcome = await loadForwardMatchRecord(storeDir, matchId);
    if (outcome.status === 'not-found') {
      continue; // readdir raced a concurrent delete — not this function's problem to report
    }
    if (outcome.status === 'corrupt') {
      issues.push({ path: path.join(storeDir, file), message: outcome.reason });
      continue;
    }
    const { record } = outcome;
    summaries.push({
      matchId: record.matchId,
      gameId: record.gameId,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      roundsPlayed: record.roundsPlayed,
      participantIds: record.participantIds,
    });
  }

  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { summaries, issues };
}
