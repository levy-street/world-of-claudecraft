import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  classifyPrFiles,
  detectCode,
  fetchPrFiles,
  isCodePath,
  PR_FILES_CAP,
} from '../scripts/lib/ci_change_classify.mjs';

type Entry = { filename?: string; previous_filename?: string | null };

// Minimal fetch stub: serves `files` through the paginated PR files endpoint
// shape (per_page/page query params), recording every call for order, header,
// and signal assertions. Plain objects stand in for Response; the lib only
// reads ok, status, and json().
function pagedFetch(files: Entry[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const u = new URL(String(url));
    const page = Number(u.searchParams.get('page'));
    const perPage = Number(u.searchParams.get('per_page'));
    return {
      ok: true,
      status: 200,
      json: async () => files.slice((page - 1) * perPage, page * perPage),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const failingFetch = (status: number) =>
  (async () => ({
    ok: false,
    status,
    json: async () => ({}),
  })) as unknown as typeof fetch;

const BASE = {
  eventName: 'pull_request',
  prNumber: 123,
  repo: 'levy-street/world-of-claudecraft',
  token: 'ghs_test',
} as const;

describe('isCodePath', () => {
  it('matches directory rules at any depth, exactly as the old shell case globs did', () => {
    expect(isCodePath('src/sim/sim.ts')).toBe(true);
    expect(isCodePath('src/ui/hud/town/index.ts')).toBe(true);
    expect(isCodePath('scripts/lib/ci_change_classify.mjs')).toBe(true);
    expect(isCodePath('.github/workflows/ci.yml')).toBe(true);
    expect(isCodePath('data/battleground/thornhollow.map.json')).toBe(true);
    // Sibling-name near misses must not match: prefixes end at the slash.
    expect(isCodePath('srcs/notes.md')).toBe(false);
    expect(isCodePath('docs/src/diagram.md')).toBe(false);
    // Non-workflow .github files are not code (the PR template, agent docs).
    expect(isCodePath('.github/PULL_REQUEST_TEMPLATE.md')).toBe(false);
  });

  it('matches the top-level exact rules without widening them to nested paths', () => {
    for (const exact of [
      'package.json',
      'pnpm-lock.yaml',
      'tsconfig.json',
      'tsconfig.admin.json',
      'vite.config.ts',
      'vitest.browser.config.ts',
      'biome.json',
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
    ]) {
      expect(isCodePath(exact)).toBe(true);
    }
    expect(isCodePath('Dockerfile.bot')).toBe(true);
    // The shell case matched the WHOLE path, so a nested copy of an exact name
    // outside every code directory stayed non-code; preserve that.
    expect(isCodePath('docs/package.json')).toBe(false);
    expect(isCodePath('docs/examples/Dockerfile')).toBe(false);
  });

  it('classifies the root build and supply-chain inputs as code (widened set)', () => {
    // These were holes in the old inline set: each feeds a shipped bundle or
    // the install itself, so skipping the malware gate and builds on them was
    // a bypass (index.html alone carries inline scripts and third-party tags).
    for (const widened of [
      'index.html',
      'play.html',
      'admin.html',
      'guide.html',
      'editor.html',
      'wallet-handoff.html',
      'music_editor.html',
      'svelte.config.js',
      'capacitor.config.ts',
      'tsconfig.bot.json',
      'turbo.json',
      '.npmrc',
      '.browserslistrc',
      '.dockerignore',
      'python/wow_env.py',
      'python/example_random_agent.py',
    ]) {
      expect(isCodePath(widened)).toBe(true);
    }
  });

  it('leaves documentation surfaces classifiable as non-code', () => {
    expect(isCodePath('README.md')).toBe(false);
    expect(isCodePath('CLAUDE.md')).toBe(false);
    expect(isCodePath('docs/prd/some-spec.md')).toBe(false);
    expect(isCodePath('docs/screenshots/before.png')).toBe(false);
    expect(isCodePath('CREDITS.md')).toBe(false);
  });

  it('fails closed on input it cannot read', () => {
    expect(isCodePath('')).toBe(true);
    expect(isCodePath(undefined as unknown as string)).toBe(true);
    expect(isCodePath(7 as unknown as string)).toBe(true);
  });
});

describe('classifyPrFiles', () => {
  it('flags a code file anywhere in the listing and names it, JSON-escaped, in the reason', () => {
    const result = classifyPrFiles([
      { filename: 'docs/prd/spec.md' },
      { filename: 'server/game.ts' },
      { filename: 'README.md' },
    ]);
    expect(result.code).toBe(true);
    expect(result.reason).toBe('code path change detected ("server/game.ts"): full PR tier');
    // Filenames are attacker-controlled and the reason reaches the CI log,
    // where a line-leading :: is a workflow command; a newline must arrive
    // escaped, never literal.
    const sneaky = classifyPrFiles([{ filename: 'src/a\n::error::forged' }]);
    expect(sneaky.reason).not.toContain('\n');
    expect(sneaky.reason).toContain('\\n::error::forged');
  });

  it('classifies a fully non-code listing as docs-only with the skip reason', () => {
    const result = classifyPrFiles([
      { filename: 'docs/prd/spec.md' },
      { filename: 'docs/screenshots/after.png' },
      { filename: 'README.md' },
    ]);
    expect(result).toEqual({
      code: false,
      reason: 'docs-only (or non-code) change: skip pr-gate, pr-checks, browser-gate',
    });
  });

  it('classifies both ends of a rename, stricter than the old diff on purpose', () => {
    // The old git-diff classifier printed only the DESTINATION under default
    // rename detection, so renaming src/sim/old.ts to docs/old_sim.md read as
    // docs-only. previous_filename closes that hole; this pin keeps a future
    // "restore parity" cleanup from reopening it.
    const out = classifyPrFiles([
      { filename: 'docs/old_sim.md', previous_filename: 'src/sim/old.ts' },
    ]);
    expect(out.code).toBe(true);
    expect(out.reason).toBe(
      'code path change detected (renamed from "src/sim/old.ts"): full PR tier',
    );
    // A rename fully inside docs stays non-code.
    const docs = classifyPrFiles([
      { filename: 'docs/prd/new-name.md', previous_filename: 'docs/prd/old-name.md' },
    ]);
    expect(docs.code).toBe(false);
  });

  it('fails closed on an entry it cannot read', () => {
    expect(classifyPrFiles([{ filename: 'docs/a.md' }, {}]).code).toBe(true);
    expect(classifyPrFiles([{ filename: '' }]).code).toBe(true);
    expect(
      classifyPrFiles([{ filename: 'docs/a.md', previous_filename: 9 as unknown as string }]).code,
    ).toBe(true);
  });
});

describe('fetchPrFiles', () => {
  it('paginates until a short page and returns the concatenated listing', async () => {
    const files: Entry[] = Array.from({ length: 250 }, (_, i) => ({ filename: `docs/f${i}.md` }));
    const { impl, calls } = pagedFetch(files);
    const listed = await fetchPrFiles({ ...BASE, fetchImpl: impl });
    expect(listed).toHaveLength(250);
    expect(listed[249]).toEqual({ filename: 'docs/f249.md' });
    expect(calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2', '3']);
    expect(calls[0].url).toBe(
      'https://api.github.com/repos/levy-street/world-of-claudecraft/pulls/123/files?per_page=100&page=1',
    );
  });

  it('sends the token and API headers, and ONE shared deadline, on every page', async () => {
    const files: Entry[] = Array.from({ length: 250 }, (_, i) => ({ filename: `docs/f${i}.md` }));
    const { impl, calls } = pagedFetch(files);
    await fetchPrFiles({ ...BASE, fetchImpl: impl });
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghs_test');
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    // One AbortSignal instance across all pages: the timeout bounds the whole
    // listing, so a slow API fails closed inside the job's 5 minute timeout
    // instead of running it into the hard kill (where dependents skip).
    expect(calls).toHaveLength(3);
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Set(calls.map((c) => c.init?.signal)).size).toBe(1);
  });

  it('throws on an HTTP error status', async () => {
    await expect(fetchPrFiles({ ...BASE, fetchImpl: failingFetch(403) })).rejects.toThrow(
      /HTTP 403/,
    );
  });

  it('throws on a non-array payload', async () => {
    const impl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: 'unexpected' }),
    })) as unknown as typeof fetch;
    await expect(fetchPrFiles({ ...BASE, fetchImpl: impl })).rejects.toThrow(/non-array/);
  });

  it('throws once the listing REACHES the completeness cap, not only past it', async () => {
    // The endpoint truncates at the cap silently, so a listing of exactly cap
    // entries is indistinguishable from a truncated one and must fail closed
    // on its own, without depending on the optional changed_files field.
    const files = (n: number): Entry[] =>
      Array.from({ length: n }, (_, i) => ({ filename: `docs/f${i}.md` }));
    await expect(
      fetchPrFiles({ ...BASE, fetchImpl: pagedFetch(files(250)).impl, cap: 200 }),
    ).rejects.toThrow(/200 or more files/);
    await expect(
      fetchPrFiles({ ...BASE, fetchImpl: pagedFetch(files(200)).impl, cap: 200 }),
    ).rejects.toThrow(/200 or more files/);
    // One under the cap is a complete, provable listing.
    await expect(
      fetchPrFiles({ ...BASE, fetchImpl: pagedFetch(files(199)).impl, cap: 200 }),
    ).resolves.toHaveLength(199);
    // The real cap matches the documented endpoint limit.
    expect(PR_FILES_CAP).toBe(3000);
  });
});

describe('detectCode (fail closed end to end)', () => {
  const neverFetch = (async () => {
    throw new Error('fetch must not be called for this case');
  }) as unknown as typeof fetch;

  it('returns code=true for non-PR events without touching the API', async () => {
    // merge_group is the queue's event: a queue run must always take the full
    // PR tier (there is no PR files listing to classify on a merge group).
    for (const eventName of ['push', 'workflow_dispatch', 'schedule', 'merge_group', '']) {
      expect(await detectCode({ ...BASE, eventName, fetchImpl: neverFetch })).toEqual({
        code: true,
        reason: 'non-PR event: full PR tier (code=true)',
      });
    }
  });

  it('returns code=true when the PR context or token is missing', async () => {
    expect((await detectCode({ ...BASE, prNumber: Number.NaN, fetchImpl: neverFetch })).code).toBe(
      true,
    );
    expect((await detectCode({ ...BASE, prNumber: 0, fetchImpl: neverFetch })).code).toBe(true);
    expect((await detectCode({ ...BASE, repo: '', fetchImpl: neverFetch })).code).toBe(true);
    expect(await detectCode({ ...BASE, token: '', fetchImpl: neverFetch })).toEqual({
      code: true,
      reason: 'missing API token: full PR tier (code=true)',
    });
  });

  it('returns code=true on a forced API failure, never code=false', async () => {
    // The acceptance case for the API-driven classifier: an API that errors,
    // times out, or rejects must run the full suite.
    const rejecting = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const rejected = await detectCode({ ...BASE, fetchImpl: rejecting });
    expect(rejected.code).toBe(true);
    // The detail is JSON-escaped like the filenames: V8 parse errors embed
    // raw response snippets, newlines included, and this reaches the CI log.
    expect(rejected.reason).toBe(
      'changed-file listing failed ("ECONNRESET"): full PR tier (code=true)',
    );
    const denied = await detectCode({ ...BASE, fetchImpl: failingFetch(401) });
    expect(denied.code).toBe(true);
    expect(denied.reason).toMatch(/^changed-file listing failed .*HTTP 401/);
    // A non-Error throw still resolves to code=true.
    const weird = (async () => {
      throw 'string failure';
    }) as unknown as typeof fetch;
    expect((await detectCode({ ...BASE, fetchImpl: weird })).code).toBe(true);
  });

  it('returns code=true on an empty listing or a changed_files mismatch', async () => {
    const { impl: empty } = pagedFetch([]);
    expect(await detectCode({ ...BASE, fetchImpl: empty })).toEqual({
      code: true,
      reason: 'empty file list: full PR tier (code=true)',
    });
    const { impl } = pagedFetch([{ filename: 'docs/a.md' }, { filename: 'docs/b.md' }]);
    const mismatched = await detectCode({ ...BASE, reportedCount: 5, fetchImpl: impl });
    expect(mismatched).toEqual({
      code: true,
      reason: 'listed 2 files but the event reports 5: full PR tier (code=true)',
    });
  });

  it('classifies a docs-only PR as code=false with an auditable count in the reason', async () => {
    const docs: Entry[] = [
      { filename: 'docs/prd/spec.md' },
      { filename: 'README.md' },
      { filename: 'docs/screenshots/after.png' },
    ];
    const { impl } = pagedFetch(docs);
    // The skip decision must be auditable from the job log alone: how many
    // files were listed and what the event reported. The classified listing is
    // returned as `files` so the Phase 2 mode decision reads the SAME snapshot
    // instead of fetching again into a race with a new push.
    expect(await detectCode({ ...BASE, reportedCount: 3, fetchImpl: impl })).toEqual({
      code: false,
      reason:
        'docs-only (or non-code) change: skip pr-gate, pr-checks, browser-gate (3 files listed; event reports 3)',
      files: docs,
    });
    // changed_files missing from the payload skips the count check but still
    // classifies (pagination terminated below the cap, so the listing is
    // complete), and the log says the report was absent.
    const { impl: uncounted } = pagedFetch(docs);
    expect(await detectCode({ ...BASE, fetchImpl: uncounted })).toEqual({
      code: false,
      reason:
        'docs-only (or non-code) change: skip pr-gate, pr-checks, browser-gate (3 files listed; event reports n/a)',
      files: docs,
    });
  });

  it('classifies a code PR as code=true through the same path', async () => {
    const listing: Entry[] = [{ filename: 'docs/a.md' }, { filename: 'src/sim/sim.ts' }];
    const { impl } = pagedFetch(listing);
    const result = await detectCode({ ...BASE, reportedCount: 2, fetchImpl: impl });
    expect(result).toEqual({
      code: true,
      reason: 'code path change detected ("src/sim/sim.ts"): full PR tier',
      files: listing,
    });
  });

  it('returns no files on any fail-closed path, so the mode decision cannot trust them', async () => {
    // Absence of `files` is the contract: every code=true-by-doubt return
    // (non-PR event, missing PR context, missing token, API failure, empty
    // listing, count mismatch) proves nothing about the diff, and a mode
    // decision reading a partial listing would narrow the run on unproven
    // data. One assertion per named arm.
    const rejecting = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect(
      await detectCode({ ...BASE, eventName: 'push', fetchImpl: neverFetch }),
    ).not.toHaveProperty('files');
    expect(
      await detectCode({ ...BASE, prNumber: Number.NaN, fetchImpl: neverFetch }),
    ).not.toHaveProperty('files');
    expect(await detectCode({ ...BASE, token: '', fetchImpl: neverFetch })).not.toHaveProperty(
      'files',
    );
    expect(await detectCode({ ...BASE, fetchImpl: rejecting })).not.toHaveProperty('files');
    const { impl: empty } = pagedFetch([]);
    expect(await detectCode({ ...BASE, fetchImpl: empty })).not.toHaveProperty('files');
    const { impl } = pagedFetch([{ filename: 'docs/a.md' }]);
    expect(await detectCode({ ...BASE, reportedCount: 5, fetchImpl: impl })).not.toHaveProperty(
      'files',
    );
  });
});

// The entry script is the wiring between the Actions environment and the
// tested lib, and its GITHUB_OUTPUT write is what the three dependent jobs
// gate on: a silently missing write leaves the output empty and every
// dependent SKIPS, which is a false green. So the entry runs for real here,
// as a subprocess, against a local HTTP stub standing in for the API.
describe('detect_code_changes.mjs entry (subprocess)', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  let scratch = '';
  let apiUrl = '';
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify([
        { filename: 'docs/prd/spec.md', status: 'modified' },
        { filename: 'README.md', status: 'modified' },
      ]),
    );
  });

  beforeAll(async () => {
    // In beforeAll, not at collection time: a filtered run that skips this
    // describe must not mint a scratch dir, and afterAll removes it.
    scratch = mkdtempSync(join(tmpdir(), 'wocc-detect-entry-'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    rmSync(scratch, { recursive: true, force: true });
  });

  async function runEntry(name: string, env: Record<string, string>) {
    const outFile = join(scratch, `${name}.out`);
    writeFileSync(outFile, '');
    const child = spawn(process.execPath, ['scripts/detect_code_changes.mjs'], {
      cwd: repoRoot,
      // Minimal on purpose: keeps the runner's real GITHUB_* vars and
      // vitest's NODE_OPTIONS out of the child. Windows children still need
      // SystemRoot for network/crypto init.
      env: {
        PATH: process.env.PATH ?? '',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        GITHUB_OUTPUT: outFile,
        ...env,
      },
    });
    let log = '';
    child.stdout.on('data', (chunk) => {
      log += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      log += String(chunk);
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      // A hung or unspawnable entry must fail THIS test with its log, not
      // stall the vitest worker or orphan the child.
      const killer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`entry did not exit within 15s; log so far:\n${log}`));
      }, 15_000);
      killer.unref();
      child.on('error', (err) => {
        clearTimeout(killer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(killer);
        resolve(code);
      });
    });
    return { exitCode, log, output: readFileSync(outFile, 'utf8') };
  }

  function eventFixture(name: string, payload: unknown): string {
    const file = join(scratch, `${name}.json`);
    writeFileSync(file, JSON.stringify(payload));
    return file;
  }

  it('writes code=true and test_mode=full to GITHUB_OUTPUT for a push event', async () => {
    const run = await runEntry('push', { GITHUB_EVENT_NAME: 'push' });
    expect(run.exitCode).toBe(0);
    // Exact whole-output pin: these four lines are the entire contract the
    // dependent jobs read, and selection must never activate off a PR event.
    expect(run.output).toBe(
      'code=true\n' +
        'test_mode=full\n' +
        'test_mode_reason=selection applies to pull requests only: full suite\n' +
        'changed_files=[]\n',
    );
    expect(run.log).toContain('non-PR event');
  });

  it('writes code=true and test_mode=full to GITHUB_OUTPUT for a merge queue run', async () => {
    // The merge_group event is the queue's own run over the candidate merge
    // result; the queue is the last pre-merge bar, so the handover the shard
    // jobs read must be the full-suite contract, end to end through the real
    // entry, exactly as for push.
    const run = await runEntry('merge-group', { GITHUB_EVENT_NAME: 'merge_group' });
    expect(run.exitCode).toBe(0);
    expect(run.output).toBe(
      'code=true\n' +
        'test_mode=full\n' +
        'test_mode_reason=selection applies to pull requests only: full suite\n' +
        'changed_files=[]\n',
    );
    expect(run.log).toContain('non-PR event');
  });

  it('writes code=false and the selective handover for a docs-only PR through the real fetch path', async () => {
    const run = await runEntry('docs', {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventFixture('docs-event', {
        pull_request: { number: 12, changed_files: 2 },
      }),
      GITHUB_REPOSITORY: 'levy-street/world-of-claudecraft',
      GITHUB_TOKEN: 'ghs_test',
      GITHUB_API_URL: apiUrl,
    });
    expect(run.exitCode).toBe(0);
    // The docs-only PR skips the shards on code=false either way; the pin is
    // that the SAME fetched snapshot fed both decisions and the changed list
    // rides the output as one line of JSON.
    expect(run.output).toBe(
      'code=false\n' +
        'test_mode=selective\n' +
        'test_mode_reason=selective: 0 changed source file(s), 0 changed test file(s), 2 inert path(s)\n' +
        'changed_files=["docs/prd/spec.md","README.md"]\n',
    );
    expect(run.log).toContain('2 files listed; event reports 2');
  });

  it('fails closed when the payload count disagrees with the listing', async () => {
    // This also pins that changed_files is actually read and passed through:
    // if that wiring broke, this case would classify docs-only. The mode
    // decision must fail closed off the same mismatch (detectCode returns no
    // files on any unprovable path).
    const run = await runEntry('mismatch', {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventFixture('mismatch-event', {
        pull_request: { number: 12, changed_files: 5 },
      }),
      GITHUB_REPOSITORY: 'levy-street/world-of-claudecraft',
      GITHUB_TOKEN: 'ghs_test',
      GITHUB_API_URL: apiUrl,
    });
    expect(run.exitCode).toBe(0);
    expect(run.output).toBe(
      'code=true\n' +
        'test_mode=full\n' +
        'test_mode_reason=no provable changed-file listing: full suite\n' +
        'changed_files=[]\n',
    );
    expect(run.log).toContain('listed 2 files but the event reports 5');
  });
});
