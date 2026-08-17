// World of ClaudeCraft (WoCC) OpenCode guard plugin: pure core.
//
// Dependency-free helper logic for .opencode/plugins/woc-guard.ts. This file is
// NOT a plugin: OpenCode auto-loads only .opencode/plugins/, so the helper
// functions here are importable by the plugin and by the repo's tests without
// being invoked as plugins themselves.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// --- Generated-file guard ---------------------------------------------------

export function isGeneratedPath(p: string): boolean {
  return (
    p.endsWith('.generated.ts') ||
    p.includes('/i18n.resolved.generated/') ||
    p.startsWith('i18n.resolved.generated/')
  );
}

// Paths where the copy-rule exclusions apply (kept identical to the pre-push
// copy scan in .githooks/pre-push and qa-stop.sh).
export function isExcludedPath(p: string): boolean {
  return (
    p.includes('/i18n.locales/') ||
    p.startsWith('i18n.locales/') ||
    isGeneratedPath(p) ||
    /(\/|^)docs\/i18n\/[^/]+\.ru_RU\.md$/.test(p) ||
    p.endsWith('.lock') ||
    p.endsWith('/package-lock.json') ||
    p === 'package-lock.json'
  );
}

// --- Instant QA scan --------------------------------------------------------

export interface Violation {
  path: string;
  kind: string;
  line: string;
}

const DASH_RE = /[\u2013\u2014\u2015]/;
// biome-ignore lint/suspicious/noMisleadingCharacterClass: ranges must stay identical to the pre-push copy scan and qa-stop.sh emoji pattern.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const ONLY_RE = /\b(?:it|test|describe|bench|suite)\.only\s*\(/;
const DEBUGGER_RE = /^\s*debugger\s*;?\s*$/;
const WALLCLOCK_RE = /\b(?:Math\.random|Date\.now|performance\.now)\s*\(/;
const COMMENT_START_RE = /^\s*(?:\/\/|\*|\/\*)/;
const CODE_EXT_RE = /\.(ts|tsx|js|mjs|cjs)$/;
const TEST_FILE_RE = /\.test\.(ts|tsx|js|mjs|cjs)$/;
// Matches src/sim/*.ts whether the path is repo-relative or absolute (an
// agent session may run in a linked worktree, so tool paths arrive absolute).
const SIM_FILE_RE = /(^|\/)src\/sim\/.*\.ts$/;

export function isTestPath(p: string): boolean {
  return TEST_FILE_RE.test(p) || /(^|\/)tests\//.test(p);
}

// Classify a single added line, or return null when it is clean.
export function classifyLine(file: string, line: string): string | null {
  if (DASH_RE.test(line)) return 'em or en dash';
  if (EMOJI_RE.test(line)) return 'emoji';
  if (isTestPath(file) && ONLY_RE.test(line)) {
    return 'stray .only( disables the suite';
  }
  if (CODE_EXT_RE.test(file) && DEBUGGER_RE.test(line)) {
    return 'leftover debugger';
  }
  if (SIM_FILE_RE.test(file) && !COMMENT_START_RE.test(line) && WALLCLOCK_RE.test(line)) {
    return 'wall-clock or Math.random in sim code (use Rng and sim time)';
  }
  return null;
}

// Scan added lines for invariant violations. Mirrors qa-stop.sh: at most 20
// hits are reported, and the whole file is skipped when an exclusion applies.
export function scanAddedLines(file: string, added: string[]): Violation[] {
  if (isExcludedPath(file)) return [];
  const out: Violation[] = [];
  for (const raw of added) {
    const line = raw.startsWith('+') ? raw.slice(1) : raw;
    const kind = classifyLine(file, line);
    if (kind) {
      out.push({ path: file, kind, line: line.trim().slice(0, 80) });
      if (out.length >= 20) break;
    }
  }
  return out;
}

// --- Tool argument extraction (write / edit / apply_patch) ------------------

// The added lines a write/edit/apply_patch will introduce. write carries the
// full content, edit carries the replacement text, apply_patch carries a diff
// whose + lines are the additions (the same "added lines" semantics qa-stop.sh
// scans).
export function addedLinesFor(tool: string, args: Record<string, unknown>): string[] {
  if (tool === 'write') {
    const content = args.content;
    return typeof content === 'string' ? content.split('\n') : [];
  }
  if (tool === 'edit') {
    const next = args.newString;
    return typeof next === 'string' ? next.split('\n') : [];
  }
  if (tool === 'apply_patch' || tool === 'patch') {
    const patch = args.patch ?? args.diff;
    if (typeof patch === 'string') {
      return patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    }
  }
  return [];
}

// --- Hooks-path setup (ensure-hooks.sh equivalent) --------------------------

export interface HooksPathResult {
  changed: boolean;
  message: string;
}

export function ensureHooksPath(directory: string): HooksPathResult {
  try {
    const rootRes = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: directory,
      encoding: 'utf8',
    });
    if (rootRes.status !== 0) {
      return { changed: false, message: 'not a git work tree' };
    }
    const root = rootRes.stdout.trim();
    if (!existsSync(path.join(root, '.githooks'))) {
      return { changed: false, message: 'no .githooks directory' };
    }
    const cur = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
      cwd: root,
      encoding: 'utf8',
    });
    const current = cur.status === 0 ? cur.stdout.trim() : '';
    if (current === '') {
      const set = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
        cwd: root,
        encoding: 'utf8',
      });
      if (set.status === 0) {
        return {
          changed: true,
          message:
            'enabled .githooks (pre-push QA floor). Undo with: git config --unset core.hooksPath',
        };
      }
      return { changed: false, message: 'failed to set core.hooksPath' };
    }
    if (current === '.githooks') {
      return {
        changed: false,
        message: 'core.hooksPath already points at .githooks',
      };
    }
    if (current.endsWith('/.githooks')) {
      return {
        changed: false,
        message: `core.hooksPath points at another checkout (${current}); the pre-push floor that runs here may be a stale copy. Repoint with: git config --local core.hooksPath .githooks`,
      };
    }
    return { changed: false, message: 'existing custom hooksPath left untouched' };
  } catch {
    return { changed: false, message: 'ensureHooksPath could not run git' };
  }
}

export function filePathOf(args: Record<string, unknown>): string | undefined {
  const v = args.filePath ?? args.path;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export interface ToolInput {
  tool?: string;
  sessionID?: string;
}

export interface ToolOutput {
  args?: Record<string, unknown>;
}

export interface WocGuardContext {
  directory?: string;
  worktree?: string;
  project?: unknown;
  client?: {
    app?: {
      log?: (options?: {
        body: {
          service: string;
          level: 'debug' | 'info' | 'error' | 'warn';
          message: string;
        };
      }) => unknown;
    };
  };
}
