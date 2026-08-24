// A tournament record's persistence: one JSON file per tournament, no database
// (docs/architecture.md §10 — deliberately out of scope right now). Read/write is the entire
// contract; the CLI owns deciding *when* to save (apps/cli/src/commands/tournament.ts saves
// after every match, so a tournament interrupted mid-run still leaves partial progress behind).
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@thunderdome/engine';
import { TournamentRecordSchema, type TournamentRecord, type TournamentSummary } from './types.js';

function recordPath(storeDir: string, id: string): string {
  return path.join(storeDir, `${id}.json`);
}

/** Overwrites the whole record file — simplest-correct, given records are small (a few matches'
 * worth of events, not a media-sized blob) and this is called once per match, not per round. */
export async function saveTournamentRecord(
  storeDir: string,
  record: TournamentRecord,
): Promise<void> {
  await mkdir(storeDir, { recursive: true });
  await writeFile(recordPath(storeDir, record.id), JSON.stringify(record, null, 2), 'utf8');
}

export async function loadTournamentRecord(
  storeDir: string,
  id: string,
): Promise<Result<TournamentRecord>> {
  let raw: string;
  try {
    raw = await readFile(recordPath(storeDir, id), 'utf8');
  } catch {
    return err(`no tournament record found for id "${id}"`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(`tournament record for id "${id}" is not valid JSON`);
  }

  const result = TournamentRecordSchema.safeParse(parsed);
  return result.success
    ? ok(result.data)
    : err(`tournament record for id "${id}" is corrupt: ${result.error.message}`);
}

export interface ListTournamentRecordsResult {
  summaries: TournamentSummary[];
  /** One entry per `.json` file that failed to load/validate — collected rather than thrown, so
   * one corrupt record never hides every other tournament from the list. */
  issues: { path: string; message: string }[];
}

/** Newest-first by `createdAt`. Corrupt or unreadable files are reported in `issues`, not thrown. */
export async function listTournamentRecords(
  storeDir: string,
): Promise<ListTournamentRecordsResult> {
  let files: string[];
  try {
    files = await readdir(storeDir);
  } catch {
    return { summaries: [], issues: [] }; // the store dir doesn't exist yet — no tournaments, not an error
  }

  const summaries: TournamentSummary[] = [];
  const issues: { path: string; message: string }[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const id = file.slice(0, -'.json'.length);
    const result = await loadTournamentRecord(storeDir, id);
    if (!result.ok) {
      issues.push({ path: path.join(storeDir, file), message: result.reason });
      continue;
    }
    const record = result.value;
    summaries.push({
      id: record.id,
      createdAt: record.createdAt,
      status: record.status,
      gameId: record.gameId,
      formatId: record.formatId,
      roster: record.roster,
      ...(record.completedAt !== undefined ? { completedAt: record.completedAt } : {}),
    });
  }

  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { summaries, issues };
}
