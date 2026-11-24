// The dev server's base copies for Studio's change-only push
// (scripts/lib/studio_map_base.mjs). Pinned here: the id is git's own blob id
// (so a committed version is found through git too), a bad or unknown id
// reads as nothing, a damaged cached copy is never served as that version,
// git only hands back map documents, and the cache keeps the newest copies.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitBlobId, pruneBases, readBase, snapshotBase } from '../scripts/lib/studio_map_base.mjs';

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-map-base-'));
  dirs.push(dir);
  return dir;
}

// Unknown-object reads must not search the developer's shared partial clone or
// attempt a promisor fetch. Exercise real Git against a tiny, local-only store.
function gitRepo(): string {
  const dir = scratch();
  execFileSync('git', ['init', '--bare', '--quiet', '--object-format=sha1', '--template=', dir]);
  return dir;
}

function storeBlob(repo: string, text: string): string {
  return execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: repo,
    input: text,
    encoding: 'utf8',
  }).trim();
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MAP_TEXT = '{"meta":{"name":"m"},\n"placements":[]}\n';

describe('studio map base copies', () => {
  it('names a version by the id git hash-object gives it', () => {
    const dir = scratch();
    const file = path.join(dir, 'a.json');
    writeFileSync(file, MAP_TEXT);
    const fromGit = execFileSync('git', ['hash-object', file], { encoding: 'utf8' }).trim();
    expect(gitBlobId(MAP_TEXT)).toBe(fromGit);
  });

  it('serves a snapshot back, and nothing for a bad or unknown id', () => {
    const cache = scratch();
    const repo = gitRepo();
    const id = snapshotBase(cache, MAP_TEXT);
    expect(readBase(cache, repo, id)).toBe(MAP_TEXT);
    expect(readBase(cache, repo, '../../etc/passwd')).toBeNull();
    expect(readBase(cache, repo, 'f'.repeat(40))).toBeNull();
    expect(readdirSync(cache).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('never serves a damaged copy as that version', () => {
    const cache = scratch();
    const id = snapshotBase(cache, MAP_TEXT);
    writeFileSync(path.join(cache, `${id}.json`), MAP_TEXT.slice(0, 10));
    expect(readBase(cache, gitRepo(), id)).toBeNull();
  });

  it('reads a map from git when no cached copy exists', () => {
    const cache = scratch();
    const repo = gitRepo();
    const id = storeBlob(repo, MAP_TEXT);
    expect(readBase(cache, repo, id)).toBe(MAP_TEXT);
  });

  it('falls back to the original git blob when a cached copy is damaged', () => {
    const cache = scratch();
    const repo = gitRepo();
    const id = storeBlob(repo, MAP_TEXT);
    writeFileSync(path.join(cache, `${id}.json`), MAP_TEXT.slice(0, 10));
    expect(readBase(cache, repo, id)).toBe(MAP_TEXT);
  });

  it('only hands back map documents from git', () => {
    const cache = scratch();
    const repo = gitRepo();
    const pkg = storeBlob(repo, '{"name":"fixture","private":true}');
    expect(readBase(cache, repo, pkg)).toBeNull();
  });

  it('keeps the newest copies', () => {
    const cache = scratch();
    const ids = [0, 1, 2, 3].map((n) =>
      snapshotBase(cache, `{"meta":{},"placements":[],"n":${n}}`),
    );
    ids.forEach((id, n) => {
      const t = new Date(2026, 0, 1, 0, n);
      utimesSync(path.join(cache, `${id}.json`), t, t);
    });
    pruneBases(cache, 2);
    expect(readdirSync(cache).sort()).toEqual([`${ids[2]}.json`, `${ids[3]}.json`].sort());
  });
});
