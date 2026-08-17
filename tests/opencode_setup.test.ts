// OpenCode support for World of ClaudeCraft.
//
// Verifies the native OpenCode integration under .opencode/ the way
// codex_setup.test.ts pins the Codex mirror: schema, agent parity with
// .claude/agents/, skill sharing via native .claude/skills discovery, and real
// behavior of the woc-guard plugin (generated-file guard, QA scan, hooks-path
// setup). Drift in .claude/agents/ bodies fails here until the OpenCode agent
// is updated, so the two stay aligned.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addedLinesFor,
  classifyLine,
  ensureHooksPath,
  isExcludedPath,
  isGeneratedPath,
  scanAddedLines,
} from '../.opencode/lib/woc-guard-core';
import { wocGuard } from '../.opencode/plugins/woc-guard';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// A throwaway git repo so plugin initialization (which may set core.hooksPath)
// can never touch the real checkout's Git configuration.
const makeSandboxRepo = (): string => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-opencode-sandbox-'));
  fs.mkdirSync(path.join(fixture, '.githooks'), { recursive: true });
  spawnSync('git', ['init', '--quiet'], { cwd: fixture, encoding: 'utf8' });
  return fixture;
};

const bashAllowOf = (front: string): string[] => {
  const lines = front.split('\n');
  const start = lines.findIndex((l) => /^ {2}bash:$/.test(l));
  if (start < 0) throw new Error('no bash block in frontmatter');
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!/^ {4}"/.test(l) || /^ {6}/.test(l)) continue;
    const m = l.match(/^ {4}(".*"):\s*(allow|ask|deny)$/);
    if (m) out.push(m[1]);
  }
  return out;
};

// The exact Bash allowlist the reviewers are permitted. Adding or removing a
// command requires deliberately updating this list (and the agent frontmatter).
const EXPECTED_BASH_ALLOW = [
  '"git status*"',
  '"git diff*"',
  '"git log*"',
  '"git ls-files*"',
  '"git rev-parse*"',
  '"git merge-base*"',
  '"git show*"',
  '"git grep*"',
  '"git config --get*"',
  '"git config --list*"',
  '"pwd"',
  '"ls*"',
  '"cat *"',
  '"rg *"',
  '"grep *"',
  '"npx vitest*"',
  '"npm run test*"',
  '"npx tsc*"',
  '"node scripts/*"',
];

const AGENTS = [
  'architecture-reviewer',
  'content-obligations-reviewer',
  'cross-platform-sync',
  'database-performance-reviewer',
  'frontend-seam-reviewer',
  'gate-integrity-reviewer',
  'migration-safety',
  'privacy-security-review',
  'qa-checklist',
  'release-malware-audit',
  'server-hot-path-reviewer',
  'test-coverage-auditor',
];

const SPLIT_FRONT = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

const splitFrontmatter = (text: string): { front: string; body: string } => {
  const m = text.match(SPLIT_FRONT);
  if (!m) throw new Error('missing YAML frontmatter');
  return { front: m[1], body: m[2] };
};

const foldedValue = (front: string, key: string): string => {
  const m = front.match(new RegExp(`^${key}: >\n((?: {2}.*\\n)+)`, 'm'));
  if (!m) throw new Error(`no folded ${key}`);
  return m[1].replace(/^ {2}/gm, '').replace(/\s+$/, '');
};

const topLevelKeys = (front: string): string[] =>
  [...front.matchAll(/^([a-z_][a-z0-9_-]*):/gm)].map((m) => m[1]);

describe('OpenCode configuration', () => {
  it('uses native mechanisms, not Claude hook protocol', () => {
    expect(fs.existsSync(path.join(root, '.opencode/settings.json'))).toBe(false);
    const entries = fs.readdirSync(path.join(root, '.opencode'));
    expect(entries).not.toContain('settings.json');
    expect(entries).not.toContain('opencode.json');
  });

  it('has no CLAUDE_PROJECT_DIR dependency in the implementation', () => {
    for (const f of fs.readdirSync(path.join(root, '.opencode/agents'))) {
      expect(read(`.opencode/agents/${f}`), f).not.toContain('CLAUDE_PROJECT_DIR');
    }
    for (const f of fs.readdirSync(path.join(root, '.opencode/plugins'))) {
      expect(read(`.opencode/plugins/${f}`), f).not.toContain('CLAUDE_PROJECT_DIR');
    }
  });

  it('tracks the committed OpenCode tooling and ignores generated local scaffolding', () => {
    const ignore = read('.gitignore');
    // mirror of the .claude/ pattern: ignore by default, unignore the committed tooling
    expect(ignore).toMatch(/^\.opencode\/\*$/m);
    for (const keep of [
      '!.opencode/agents/',
      '!.opencode/lib/',
      '!.opencode/plugins/',
      '!.opencode/README.md',
    ]) {
      expect(ignore, keep).toContain(keep);
    }
    const isIgnored = (p: string) =>
      spawnSync('git', ['check-ignore', '-q', p], { cwd: root }).status === 0;
    for (const generated of [
      '.opencode/node_modules/',
      '.opencode/package.json',
      '.opencode/package-lock.json',
    ]) {
      expect(isIgnored(generated), generated).toBe(true);
    }
    for (const tracked of [
      '.opencode/README.md',
      '.opencode/agents/qa-checklist.md',
      '.opencode/lib/woc-guard-core.ts',
      '.opencode/plugins/woc-guard.ts',
    ]) {
      expect(isIgnored(tracked), tracked).toBe(false);
    }
  });
});

describe('OpenCode skills stay shared with .claude/skills', () => {
  it('has no duplicate skill mirror', () => {
    expect(fs.existsSync(path.join(root, '.opencode/skills'))).toBe(false);
  });

  it('keeps .claude/skills as the single source with valid OpenCode frontmatter', () => {
    const dir = path.join(root, '.claude/skills');
    const skills = fs
      .readdirSync(dir)
      .filter((s) => !s.startsWith('.'))
      .sort();
    expect(skills.length).toBeGreaterThanOrEqual(10);
    for (const skill of skills) {
      const text = read(`.claude/skills/${skill}/SKILL.md`);
      const { front } = splitFrontmatter(text);
      expect(front, skill).toContain(`name: ${skill}`);
      expect(topLevelKeys(front), skill).toContain('description');
      expect(front, skill).toMatch(/^description: /m);
    }
  });
});

describe('OpenCode agents', () => {
  it('mirrors every Claude agent with a native counterpart and nothing extra', () => {
    const claude = fs
      .readdirSync(path.join(root, '.claude/agents'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .sort();
    const opencode = fs
      .readdirSync(path.join(root, '.opencode/agents'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .sort();
    expect(opencode).toEqual(claude);
    expect(opencode).toEqual(AGENTS);
  });

  it('keeps instruction bodies byte-identical to the Claude agents', () => {
    for (const name of AGENTS) {
      const claude = splitFrontmatter(read(`.claude/agents/${name}.md`));
      const opencode = splitFrontmatter(read(`.opencode/agents/${name}.md`));
      expect(opencode.body, name).toBe(claude.body);
    }
  });

  it('keeps descriptions aligned with the Claude agents', () => {
    for (const name of AGENTS) {
      const claude = splitFrontmatter(read(`.claude/agents/${name}.md`));
      const opencode = splitFrontmatter(read(`.opencode/agents/${name}.md`));
      expect(foldedValue(opencode.front, 'description'), name).toBe(
        foldedValue(claude.front, 'description'),
      );
    }
  });

  it('uses valid native OpenCode frontmatter with enforced read-only permissions', () => {
    const allowed = new Set(['description', 'mode', 'permission']);
    for (const name of AGENTS) {
      const { front } = splitFrontmatter(read(`.opencode/agents/${name}.md`));
      for (const key of topLevelKeys(front)) {
        expect(allowed.has(key), `${name}: unexpected key ${key}`).toBe(true);
      }
      expect(front, name).toMatch(/^mode: subagent$/m);
      expect(front, name).toMatch(/^permission:$/m);
      expect(front, name).toMatch(/^ {2}edit: deny$/m);
      expect(front, name).toMatch(/^ {2}write: deny$/m);
      expect(front, name).toMatch(/^ {2}apply_patch: deny$/m);
      expect(front, name).toMatch(/^ {2}task: deny$/m);
      expect(front, name).toMatch(/^ {2}webfetch: deny$/m);
      expect(front, name).toMatch(/^ {2}websearch: deny$/m);
      expect(front, name).toMatch(/^ {2}bash:$/m);
      expect(front, name).toMatch(/^ {4}"\*": ask$/m);
    }
  });

  it('pins the exact Bash allowlist in every agent', () => {
    for (const name of AGENTS) {
      const { front } = splitFrontmatter(read(`.opencode/agents/${name}.md`));
      const entries = bashAllowOf(front);
      expect(
        entries.filter((e) => e === '"*"'),
        name,
      ).toEqual(['"*"']);
      expect(
        entries.filter((e) => e !== '"*"'),
        name,
      ).toEqual(EXPECTED_BASH_ALLOW);
    }
  });

  it('forbids broad write, network, or destructive Git commands in the Bash allowlist', () => {
    for (const name of AGENTS) {
      const { front } = splitFrontmatter(read(`.opencode/agents/${name}.md`));
      expect(front, name).not.toMatch(/^ {4}"git config\*"/m);
      expect(front, name).not.toMatch(/^ {4}"git fetch\*"/m);
      expect(front, name).not.toMatch(/^ {4}"git branch\*"/m);
      expect(front, name).not.toMatch(/^ {4}"git config --global/m);
      expect(front, name).not.toMatch(/^ {4}"git checkout\*"/m);
      expect(front, name).not.toMatch(/^ {4}"git pull\*"/m);
      expect(front, name).not.toMatch(/^ {4}"git merge\*"/m);
      // read-only inspection forms stay available
      expect(front, name).toMatch(/^ {4}"git config --get\*"/m);
      expect(front, name).toMatch(/^ {4}"git config --list\*"/m);
    }
  });

  it('never hard-codes a model, provider, or iteration cap', () => {
    for (const name of AGENTS) {
      const { front } = splitFrontmatter(read(`.opencode/agents/${name}.md`));
      expect(front, name).not.toMatch(/^model:/m);
      expect(front, name).not.toMatch(/^provider:/m);
      expect(front, name).not.toMatch(/^maxTurns:/m);
      expect(front, name).not.toMatch(/^maxSteps:/m);
      expect(front, name).not.toMatch(/^steps:/m);
      expect(front, name).not.toMatch(/^tools:/m);
    }
  });
});

describe('woc-guard plugin: generated-file guard', () => {
  it('rejects generated paths and allows normal source paths', () => {
    expect(isGeneratedPath('src/foo.generated.ts')).toBe(true);
    expect(isGeneratedPath('src/ui/i18n.resolved.generated/en.ts')).toBe(true);
    expect(isGeneratedPath('src/sim/data.ts')).toBe(false);
    expect(isGeneratedPath('src/ui/i18n.locales/en.ts')).toBe(false);
  });

  it('blocks a write to a generated file and allows a normal write', async () => {
    const sandbox = makeSandboxRepo();
    try {
      const plugin = await wocGuard({ directory: sandbox });
      await expect(
        plugin['tool.execute.before'](
          { tool: 'write', sessionID: 'test' },
          { args: { filePath: 'src/ui/i18n.resolved.generated/en.ts', content: 'x' } },
        ),
      ).rejects.toThrow(/generated artifact/);
      await expect(
        plugin['tool.execute.before'](
          { tool: 'read', sessionID: 'test' },
          { args: { filePath: 'src/ui/i18n.resolved.generated/en.ts' } },
        ),
      ).resolves.toBeUndefined();
      await expect(
        plugin['tool.execute.before'](
          { tool: 'write', sessionID: 'test' },
          { args: { filePath: 'src/sim/data.ts', content: 'export const ok = true;\n' } },
        ),
      ).resolves.toBeUndefined();
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('woc-guard plugin: QA scan', () => {
  it('classifies each hard invariant', () => {
    expect(classifyLine('src/a.ts', 'const x = 1;')).toBeNull();
    expect(classifyLine('src/a.ts', `const dash = 'x\u2014y';`)).toBe('em or en dash');
    expect(classifyLine('src/a.ts', 'const emoji = "\u{1F600}";')).toBe('emoji');
    expect(classifyLine('tests/a.test.ts', 'it.only("x", () => {})')).toBe(
      'stray .only( disables the suite',
    );
    expect(classifyLine('src/a.ts', 'debugger;')).toBe('leftover debugger');
    expect(classifyLine('src/sim/a.ts', 'const n = Math.random();')).toBe(
      'wall-clock or Math.random in sim code (use Rng and sim time)',
    );
    expect(classifyLine('src/sim/a.ts', '// Math.random() note')).toBeNull();
    expect(classifyLine('/mnt/checkout/src/sim/a.ts', 'const n = performance.now();')).toBe(
      'wall-clock or Math.random in sim code (use Rng and sim time)',
    );
    expect(classifyLine('/mnt/checkout/src/sim/a.ts', 'const n = 1;')).toBeNull();
  });

  it('honors the same path exclusions as the pre-push copy scan', () => {
    expect(isExcludedPath('src/ui/i18n.locales/ru_RU.ts')).toBe(true);
    expect(isExcludedPath('docs/i18n/contributing.ru_RU.md')).toBe(true);
    expect(isExcludedPath('package-lock.json')).toBe(true);
    expect(isExcludedPath('src/sim/data.ts')).toBe(false);
    expect(scanAddedLines('src/ui/i18n.locales/ru_RU.ts', ['бла\u2014бла'])).toEqual([]);
    expect(scanAddedLines('src/sim/data.ts', ['const x = Math.random();'])).toHaveLength(1);
  });

  it('extracts the added lines each tool introduces', () => {
    expect(addedLinesFor('write', { content: 'a\nb\n' })).toEqual(['a', 'b', '']);
    expect(addedLinesFor('edit', { newString: 'a\nb' })).toEqual(['a', 'b']);
    expect(addedLinesFor('apply_patch', { patch: '+++ b/x\n+a\n-b\n+c\n' })).toEqual(['+a', '+c']);
  });

  it('blocks a bad edit through the wired hook and allows a clean one', async () => {
    const sandbox = makeSandboxRepo();
    try {
      const plugin = await wocGuard({ directory: sandbox });
      await expect(
        plugin['tool.execute.before'](
          { tool: 'edit', sessionID: 'test' },
          { args: { filePath: 'src/sim/a.ts', newString: 'const n = Date.now();\n' } },
        ),
      ).rejects.toThrow(/QA guard blocked/);
      await expect(
        plugin['tool.execute.before'](
          { tool: 'edit', sessionID: 'test' },
          { args: { filePath: 'src/sim/a.ts', newString: 'const n = 1;\n' } },
        ),
      ).resolves.toBeUndefined();
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('woc-guard plugin: hooks-path setup', () => {
  const runGit = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

  const makeRepo = (): string => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-opencode-hook-'));
    fs.mkdirSync(path.join(fixture, '.githooks'), { recursive: true });
    runGit(fixture, ['init', '--quiet']);
    return fixture;
  };

  const hooksPathOf = (cwd: string): string =>
    runGit(cwd, ['config', '--local', '--get', 'core.hooksPath']).stdout.trim();

  it('enables .githooks when unset, idempotently and without clobbering', () => {
    const fixture = makeRepo();
    try {
      const first = ensureHooksPath(fixture);
      expect(first.changed).toBe(true);
      expect(hooksPathOf(fixture)).toBe('.githooks');

      const second = ensureHooksPath(fixture);
      expect(second.changed).toBe(false);
      expect(second.message).toContain('already points at .githooks');
      expect(hooksPathOf(fixture)).toBe('.githooks');

      runGit(fixture, ['config', '--local', 'core.hooksPath', 'my-custom-hooks']);
      const custom = ensureHooksPath(fixture);
      expect(custom.changed).toBe(false);
      expect(custom.message).toContain('custom hooksPath left untouched');
      expect(hooksPathOf(fixture)).toBe('my-custom-hooks');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('warns on another checkout .githooks without touching it', () => {
    const fixture = makeRepo();
    try {
      runGit(fixture, ['config', '--local', 'core.hooksPath', '/somewhere/else/.githooks']);
      const result = ensureHooksPath(fixture);
      expect(result.changed).toBe(false);
      expect(result.message).toContain('another checkout');
      expect(hooksPathOf(fixture)).toBe('/somewhere/else/.githooks');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
