#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyChangedPaths, type Issue } from './classify.js';
import { findDuplicateIds, validateManifestEntry, type IdentifiedManifest } from './manifests.js';

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i += 1) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown };
      if (Array.isArray(pkg.workspaces)) {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate repo root (no package.json with a "workspaces" field found).');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function tryAddManifest(
  entries: IdentifiedManifest[],
  fullPath: string,
  relativePath: string,
): void {
  try {
    const raw = JSON.parse(readFileSync(fullPath, 'utf8')) as { id?: unknown };
    if (typeof raw.id === 'string') {
      entries.push({ path: relativePath, id: raw.id });
    }
  } catch {
    // A pre-existing, unrelated broken manifest shouldn't block this PR; validateManifestEntry
    // reports it if and only if this PR is the one touching it.
  }
}

/**
 * `games/<game-id>/manifest.json` is one level deep; `bots/<game-id>/<bot-id>/manifest.json` is
 * two (bots are grouped by the one game each declares) — `depth` generalizes the walk over
 * either shape rather than duplicating the traversal per kind.
 */
function scanManifests(root: string, kind: 'bots' | 'games'): IdentifiedManifest[] {
  const dir = join(root, kind);
  if (!existsSync(dir)) {
    return [];
  }

  const depth = kind === 'bots' ? 2 : 1;
  const entries: IdentifiedManifest[] = [];

  const walk = (currentDir: string, segments: string[]): void => {
    if (segments.length === depth) {
      const manifestPath = join(currentDir, 'manifest.json');
      if (existsSync(manifestPath)) {
        tryAddManifest(entries, manifestPath, `${kind}/${segments.join('/')}/manifest.json`);
      }
      return;
    }
    for (const dirent of readdirSync(currentDir, { withFileTypes: true })) {
      if (dirent.isDirectory()) {
        walk(join(currentDir, dirent.name), [...segments, dirent.name]);
      }
    }
  };

  walk(dir, []);
  return entries;
}

export async function main(): Promise<number> {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const changedPaths = (await readStdin())
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const hasOverrideLabel = process.env.THUNDERDOME_MAINTAINER_OVERRIDE === 'true';

  const { issues, warnings } = classifyChangedPaths({ changedPaths, hasOverrideLabel });

  const changedManifestPaths = changedPaths.filter(
    (path) =>
      /^bots\/[^/]+\/[^/]+\/manifest\.json$/.test(path) ||
      /^games\/[^/]+\/manifest\.json$/.test(path),
  );
  const manifestIssues: Issue[] = [];
  for (const manifestPath of changedManifestPaths) {
    const fullPath = join(root, manifestPath);
    if (!existsSync(fullPath)) continue; // deleted in this PR
    try {
      const raw: unknown = JSON.parse(readFileSync(fullPath, 'utf8'));
      manifestIssues.push(...validateManifestEntry({ path: manifestPath, raw }));
    } catch (error) {
      manifestIssues.push({
        code: 'unreadable-manifest',
        message: `${manifestPath}: could not parse as JSON (${(error as Error).message})`,
      });
    }
  }

  const allManifests = [...scanManifests(root, 'bots'), ...scanManifests(root, 'games')];
  const duplicateIssues = findDuplicateIds(allManifests);

  const allIssues = [...issues, ...manifestIssues, ...duplicateIssues];

  for (const warning of warnings) {
    console.warn(`::warning::${warning}`);
  }
  for (const issue of allIssues) {
    console.error(`::error::[${issue.code}] ${issue.message}`);
  }

  if (allIssues.length > 0) {
    console.error(`\nboundary-check failed with ${String(allIssues.length)} issue(s).`);
    return 1;
  }
  console.log('boundary-check passed.');
  return 0;
}

/* node:coverage disable */
if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
/* node:coverage enable */
