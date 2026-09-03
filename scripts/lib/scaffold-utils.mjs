// Shared helpers for scripts/scaffold-game.mjs and scripts/scaffold-bot.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function assertKebabCase(id, label) {
  if (!KEBAB_CASE.test(id)) {
    throw new Error(`${label} "${id}" must be kebab-case (lowercase letters, digits, hyphens).`);
  }
}

function capitalize(part) {
  return part.charAt(0).toUpperCase() + part.slice(1);
}

export function kebabToPascal(id) {
  return id.split('-').map(capitalize).join('');
}

export function kebabToCamel(id) {
  const pascal = kebabToPascal(id);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function kebabToTitle(id) {
  return id.split('-').map(capitalize).join(' ');
}

export function gitConfig(key) {
  try {
    return (
      execFileSync('git', ['config', key], { cwd: REPO_ROOT, encoding: 'utf8' }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

/** Minimal `--flag value` parser — no external dependency needed for a couple of dev scripts. */
export function parseArgs(argv, { positionals = [], flags = [] }) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (!flags.includes(key)) {
        throw new Error(`Unknown flag --${key}`);
      }
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`--${key} requires a value`);
      }
      result[key] = value;
      i += 1;
    } else {
      result._.push(arg);
    }
  }
  positionals.forEach((name, index) => {
    result[name] = result._[index];
  });
  return result;
}

export function relPath(path) {
  return path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1) : path;
}

export function writeScaffoldFile(path, content) {
  if (existsSync(path)) {
    throw new Error(`Refusing to overwrite existing file: ${relPath(path)}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`  created ${relPath(path)}`);
}

/** A directory that doesn't exist yet, or exists but is empty, is fine to scaffold into. */
export function assertTargetIsFresh(path, label) {
  if (existsSync(path) && readdirSync(path).length > 0) {
    throw new Error(`${label} already exists and is not empty: ${relPath(path)}`);
  }
}

/**
 * Inserts a new quoted entry into a bash array declared as
 *   NAME=(
 *     "a"
 *     "b"
 *   )
 * in `filePath`, right before the closing paren — idempotent, and a no-op if already present.
 */
export function insertIntoBashArray(filePath, arrayName, entry) {
  const original = readFileSync(filePath, 'utf8');
  if (original.includes(`"${entry}"`)) {
    console.log(`  ${relPath(filePath)}: "${entry}" already present in ${arrayName}, skipping`);
    return;
  }
  const pattern = new RegExp(`(${arrayName}=\\(\\n(?:.*\\n)*?)(\\))`);
  const match = pattern.exec(original);
  if (!match) {
    throw new Error(`Could not find a ${arrayName}=(...) array in ${relPath(filePath)}`);
  }
  const updated = original.replace(pattern, `$1  "${entry}"\n$2`);
  writeFileSync(filePath, updated);
  console.log(`  updated ${relPath(filePath)}: added "${entry}" to ${arrayName}`);
}
