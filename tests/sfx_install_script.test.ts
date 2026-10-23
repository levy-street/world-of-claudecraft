import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error untyped zero-dependency authoring tool (scripts/*.mjs convention)
import { posixInstallScript } from '../scripts/sfx_studio/export_bundle.mjs';

// The generated POSIX installer over a small synthetic artifact. The full
// catalog run lives in tests/sfx_export_core.test.ts; this suite covers every
// refusal branch and pins that per-blob work runs in bulk, so the installer
// cost stays flat in the blob count under a slow-fork shell (Git for Windows).

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const BUNDLE_ID = 'f'.repeat(64);
const RUNTIME = Buffer.from('{"runtime":"pack"}\n');
const BLOBS = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((name) =>
  Buffer.from(`synthetic mp3 ${name}`),
);
const IDS = BLOBS.map((bytes) => hash(bytes)).sort();
const BLOB_BY_ID = new Map(BLOBS.map((bytes) => [hash(bytes), bytes]));
const LIST = Buffer.from(IDS.join('\n'));
const LAST = IDS[IDS.length - 1];

let fixture = '';
let shimPath = '';
let toolLog = '';
let caseCount = 0;
// The checksum tool the installer detects: GNU sha256sum first, else shasum.
let shaTool = 'sha256sum';

function installScript(list: Buffer = LIST, runtime: Buffer = RUNTIME): string {
  return posixInstallScript({
    runtimeManifestSha256: hash(runtime),
    runtimeBundleId: BUNDLE_ID,
    installBlobsSha256: hash(list),
  }).toString('utf8');
}

function writeFiles(root: string, files: Record<string, Buffer | string>): void {
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
}

function artifact(
  options: { script?: string; list?: Buffer; ids?: string[]; blobs?: Map<string, Buffer> } = {},
): string {
  const root = join(fixture, `artifact-${caseCount++}`);
  const blobs = options.blobs ?? BLOB_BY_ID;
  writeFiles(root, {
    'install.sh': options.script ?? installScript(options.list ?? LIST),
    'activate/audio/sfx/runtime-pack.json': RUNTIME,
    'install-blobs.txt': options.list ?? LIST,
  });
  for (const id of options.ids ?? IDS) {
    const bytes = blobs.get(id);
    if (bytes) writeFiles(root, { [`payload/audio/sfx/blobs/${id}.mp3`]: bytes });
  }
  return root;
}

function staticRoot(files: Record<string, Buffer | string> = {}): string {
  const root = join(fixture, `static-${caseCount++}`);
  mkdirSync(root, { recursive: true });
  writeFiles(root, { 'sentinel.txt': 'production stays untouched\n', ...files });
  return root;
}

function snapshot(root: string, relative = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result[`${name}/`] = 'directory';
      Object.assign(result, snapshot(root, name));
    } else {
      result[name] = `file:${hash(readFileSync(join(root, name)))}`;
    }
  }
  return result;
}

function install(
  artifactRoot: string,
  target: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
) {
  writeFileSync(toolLog, '');
  // Windows spells the key Path and separates entries with ';'.
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const result = spawnSync('sh', [join(artifactRoot, 'install.sh'), target], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      [pathKey]: `${shimPath}${delimiter}${process.env[pathKey] ?? ''}`,
      WOC_TOOL_LOG: toolLog,
      ...options.env,
    },
  });
  expect(result.error, 'installer failed to execute').toBeUndefined();
  const calls = readFileSync(toolLog, 'utf8').split('\n').filter(Boolean);
  return {
    ...result,
    calls,
    count: (tool: string) => calls.filter((call) => call.startsWith(`${tool} `)).length,
  };
}

// The last argument of a logged tool call: the destination of a cp or mv.
const destination = (call: string | undefined) => call?.split(' ').at(-1) ?? '';

function expectInstalled(target: string, extra: Record<string, string> = {}): void {
  const expected: Record<string, string> = {
    'audio/': 'directory',
    'audio/sfx/': 'directory',
    'audio/sfx/blobs/': 'directory',
    'audio/sfx/runtime-pack.json': `file:${hash(RUNTIME)}`,
    'sentinel.txt': `file:${hash('production stays untouched\n')}`,
    ...extra,
  };
  for (const id of IDS) expected[`audio/sfx/blobs/${id}.mp3`] = `file:${id}`;
  // Exactly the installed tree: no staging directory or temporary file is left.
  expect(snapshot(target)).toEqual(expected);
}

function expectRefused(
  result: ReturnType<typeof install>,
  target: string,
  before: Record<string, string>,
  message: string,
): void {
  expect(result.status, result.stderr).not.toBe(0);
  expect(result.stderr).toContain(message);
  expect(snapshot(target)).toEqual(before);
}

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'woc-sfx-install-script-'));
  shimPath = join(fixture, 'shim');
  toolLog = join(fixture, 'tools.log');
  mkdirSync(shimPath);
  // Logging wrappers ahead of the real tools on PATH count every invocation.
  for (const tool of ['sha256sum', 'shasum', 'cp', 'mv']) {
    const real = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    if (!real) {
      if (tool === 'sha256sum') shaTool = 'shasum';
      continue;
    }
    writeFileSync(
      join(shimPath, tool),
      `#!/bin/sh\nprintf '%s\\n' "${tool} $*" >> "$WOC_TOOL_LOG"\nexec '${real}' "$@"\n`,
      { mode: 0o755 },
    );
  }
});

afterAll(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

describe('SFX production bundle POSIX installer', () => {
  it('parses as POSIX sh', () => {
    const root = artifact();
    execFileSync('sh', ['-n', join(root, 'install.sh')]);
  });

  it('installs every blob and the runtime manifest with one checksum pass', () => {
    const root = artifact();
    const target = staticRoot();
    const result = install(root, target);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Activated SFX bundle ${BUNDLE_ID}`);
    expectInstalled(target);
    // Runtime manifest, blob list, and ONE pass over every source blob; one cp
    // and one mv batch for the blobs, then the runtime manifest last.
    expect(result.count(shaTool)).toBe(3);
    expect(result.count('cp')).toBe(2);
    expect(result.count('mv')).toBe(2);
    const copies = result.calls.filter((call) => call.startsWith('cp '));
    const moves = result.calls.filter((call) => call.startsWith('mv '));
    expect(moves[0]).toContain(`${IDS[0]}.mp3`);
    expect(moves[0]).toContain(`${LAST}.mp3`);
    expect(moves[1]).toMatch(/runtime-pack\.json$/);
    expect(result.calls.at(-1)).toBe(moves[1]);
    // Each staging directory sits inside the directory its files are renamed
    // into, so every rename stays on one filesystem and is atomic.
    const blobsDir = destination(moves[0]);
    expect(blobsDir).toMatch(/\/audio\/sfx\/blobs$/);
    expect(destination(copies[0]).startsWith(`${blobsDir}/.install.`)).toBe(true);
    const manifestStaging = destination(copies[1]);
    expect(manifestStaging).toMatch(/\/\.install\.[^/]+\/runtime-pack\.json$/);
    expect(dirname(dirname(manifestStaging))).toBe(dirname(destination(moves[1])));
  });

  it('re-installs over its own result with one pass over the existing blobs', () => {
    const root = artifact();
    const target = staticRoot();
    expect(install(root, target).status).toBe(0);
    const result = install(root, target);
    expect(result.status, result.stderr).toBe(0);
    expectInstalled(target);
    expect(result.count(shaTool)).toBe(4);
    expect(result.count('cp')).toBe(1);
    expect(result.count('mv')).toBe(1);
  });

  it('keeps valid existing blobs and copies only the missing ones', () => {
    const root = artifact();
    const kept = IDS.slice(0, 2);
    const target = staticRoot(
      Object.fromEntries(
        kept.map((id) => [`audio/sfx/blobs/${id}.mp3`, BLOB_BY_ID.get(id) as Buffer]),
      ),
    );
    const result = install(root, target);
    expect(result.status, result.stderr).toBe(0);
    expectInstalled(target);
    const blobCopy = result.calls.find((call) => call.startsWith('cp ') && call.includes('.mp3'));
    for (const id of kept) expect(blobCopy).not.toContain(id);
    for (const id of IDS.slice(2)) expect(blobCopy).toContain(id);
  });

  it('resolves a relative static root against the working directory', () => {
    const root = artifact();
    const cwd = staticRoot();
    for (const relative of ['relative-root', '-dash-root']) {
      const result = install(root, relative, { cwd });
      expect(result.status, result.stderr).toBe(0);
      const target = join(cwd, relative);
      writeFileSync(join(target, 'sentinel.txt'), 'production stays untouched\n');
      expectInstalled(target);
    }
  });

  it('ignores an inherited CDPATH when checking a relative static root', () => {
    const root = artifact();
    // A decoy tree with the same relative layout and valid blobs: a CDPATH cd
    // would check it instead of the real target and miss the corrupt blob.
    const decoy = staticRoot(
      Object.fromEntries(
        IDS.map((id) => [`relative-root/audio/sfx/blobs/${id}.mp3`, BLOB_BY_ID.get(id) as Buffer]),
      ),
    );
    const cwd = staticRoot({
      [`relative-root/audio/sfx/blobs/${IDS[0]}.mp3`]: BLOB_BY_ID.get(IDS[0]) as Buffer,
      [`relative-root/audio/sfx/blobs/${LAST}.mp3`]: 'corrupt production blob',
    });
    const before = snapshot(cwd);
    expectRefused(
      install(root, 'relative-root', { cwd, env: { CDPATH: decoy } }),
      cwd,
      before,
      `existing audio blob checksum failed: ${LAST}`,
    );
  });

  it('installs a list that repeats an identity', () => {
    const list = Buffer.from([...IDS, IDS[2]].sort().join('\n'));
    const root = artifact({ list });
    const target = staticRoot();
    const result = install(root, target);
    expect(result.status, result.stderr).toBe(0);
    expectInstalled(target);
  });

  it('refuses a corrupt source blob anywhere in the list before touching the target', () => {
    const blobs = new Map(BLOB_BY_ID);
    blobs.set(LAST, Buffer.from('corrupt artifact blob'));
    const root = artifact({ blobs });
    const target = staticRoot({ 'audio/sfx/runtime-pack.json': 'old manifest\n' });
    const before = snapshot(target);
    const result = install(root, target);
    expectRefused(result, target, before, `artifact audio checksum failed: ${LAST}`);
    expect(result.count(shaTool)).toBe(3);
  });

  it('refuses a missing source blob', () => {
    const missing = IDS[2];
    const root = artifact({ ids: IDS.filter((id) => id !== missing) });
    const target = staticRoot();
    const before = snapshot(target);
    expectRefused(
      install(root, target),
      target,
      before,
      `artifact audio checksum failed: ${missing}`,
    );
  });

  it('refuses a corrupt existing target blob before touching anything', () => {
    const root = artifact();
    const target = staticRoot({
      [`audio/sfx/blobs/${IDS[0]}.mp3`]: BLOB_BY_ID.get(IDS[0]) as Buffer,
      [`audio/sfx/blobs/${LAST}.mp3`]: 'corrupt production blob',
      'audio/sfx/runtime-pack.json': 'old manifest\n',
    });
    const before = snapshot(target);
    const result = install(root, target);
    expectRefused(result, target, before, `existing audio blob checksum failed: ${LAST}`);
    expect(result.count('cp')).toBe(0);
    expect(result.count('mv')).toBe(0);
  });

  it('refuses an existing target path that is not a regular file', () => {
    const root = artifact();
    const target = staticRoot();
    mkdirSync(join(target, `audio/sfx/blobs/${IDS[1]}.mp3`), { recursive: true });
    const before = snapshot(target);
    expectRefused(
      install(root, target),
      target,
      before,
      `existing audio blob checksum failed: ${IDS[1]}`,
    );
  });

  it('refuses a tampered, truncated, or empty blob list', () => {
    const tampered = Buffer.from(LIST);
    tampered[tampered.length - 1] = tampered.at(-1) === 0x61 ? 0x62 : 0x61;
    for (const list of [tampered, LIST.subarray(0, LIST.lastIndexOf(0x0a)), Buffer.alloc(0)]) {
      const root = artifact({ script: installScript(LIST) });
      writeFileSync(join(root, 'install-blobs.txt'), list);
      const target = staticRoot();
      const before = snapshot(target);
      expectRefused(install(root, target), target, before, 'artifact audio list checksum failed');
    }
  });

  it('refuses an empty or malformed list even when its checksum matches', () => {
    const empty = Buffer.alloc(0);
    const emptyRoot = artifact({ list: empty, ids: [] });
    const emptyTarget = staticRoot();
    const emptyBefore = snapshot(emptyTarget);
    expectRefused(
      install(emptyRoot, emptyTarget),
      emptyTarget,
      emptyBefore,
      'artifact audio list is empty',
    );

    for (const identity of [IDS[0].toUpperCase(), IDS[0].slice(1), `${IDS[0]}0`, '../x']) {
      const list = Buffer.from(`${IDS[1]}\n${identity}`);
      const root = artifact({ list });
      const target = staticRoot();
      const before = snapshot(target);
      expectRefused(install(root, target), target, before, 'artifact audio identity failed');
    }
  });

  it('refuses a tampered runtime manifest', () => {
    const root = artifact();
    writeFileSync(join(root, 'activate/audio/sfx/runtime-pack.json'), '{"tampered":true}\n');
    const target = staticRoot();
    const before = snapshot(target);
    expectRefused(
      install(root, target),
      target,
      before,
      'artifact runtime manifest checksum failed',
    );
  });

  it('refuses to run without sha256sum or shasum', () => {
    const script = installScript()
      .replaceAll('command -v sha256sum', 'command -v woc-no-sha256sum')
      .replaceAll('command -v shasum', 'command -v woc-no-shasum');
    const root = artifact({ script });
    const target = staticRoot();
    const before = snapshot(target);
    expectRefused(install(root, target), target, before, 'install.sh requires sha256sum or shasum');
  });

  it('falls back to shasum when sha256sum is unavailable', (context) => {
    if (!existsSync(join(shimPath, 'shasum'))) context.skip();
    const script = installScript().replaceAll(
      'command -v sha256sum',
      'command -v woc-no-sha256sum',
    );
    const root = artifact({ script });
    const target = staticRoot();
    const result = install(root, target);
    expect(result.status, result.stderr).toBe(0);
    expectInstalled(target);
    expect(result.count('sha256sum')).toBe(0);
    expect(result.count('shasum')).toBe(3);

    const again = install(root, target);
    expect(again.status, again.stderr).toBe(0);
    expect(again.count('shasum')).toBe(4);

    const blobs = new Map(BLOB_BY_ID);
    blobs.set(IDS[3], Buffer.from('corrupt artifact blob'));
    const corrupt = artifact({ script, blobs });
    const corruptTarget = staticRoot();
    const before = snapshot(corruptTarget);
    expectRefused(
      install(corrupt, corruptTarget),
      corruptTarget,
      before,
      `artifact audio checksum failed: ${IDS[3]}`,
    );
  });
});
