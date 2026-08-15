import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BalancedSequencer } from '../scripts/ci_balanced_sequencer.mjs';

type FakeSpec = { moduleId: string };

function makeSequencer(root: string, shard: { index: number; count: number } | null) {
  // Minimal ctx shape: only what BalancedSequencer.shard reads.
  // Cast through unknown: we never call BaseSequencer constructor side effects.
  const seq = Object.create(BalancedSequencer.prototype) as BalancedSequencer;
  Object.assign(seq, {
    ctx: {
      config: {
        root,
        shard,
      },
    },
  });
  return seq;
}

describe('BalancedSequencer.shard (D11 path-matrix behavior)', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('returns all files unchanged when --shard is absent', async () => {
    dir = mkdtempSync(join(tmpdir(), 'woc-seq-'));
    const a = join(dir, 'a.test.ts');
    writeFileSync(a, "import { it } from 'vitest';\n");
    const files: FakeSpec[] = [{ moduleId: a }];
    const seq = makeSequencer(dir, null);
    const out = await seq.shard(files as never);
    expect(out).toEqual(files);
  });

  it('assigns every file to exactly one 1-based shard pack (completeness)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'woc-seq-'));
    const specs: FakeSpec[] = [];
    for (let i = 0; i < 16; i++) {
      const path = join(dir, `f${String(i).padStart(2, '0')}.test.ts`);
      // Alternate heavy (three) and light so LPT spreads heavies.
      const body =
        i % 2 === 0 ? "import * as THREE from 'three';\n" : "import { it } from 'vitest';\n";
      writeFileSync(path, body);
      specs.push({ moduleId: path });
    }
    const count = 4;
    const packs: FakeSpec[][] = [];
    for (let index = 1; index <= count; index++) {
      const seq = makeSequencer(dir, { index, count });
      packs.push((await seq.shard(specs as never)) as FakeSpec[]);
    }
    const seen = new Set<string>();
    for (const pack of packs) {
      expect(pack.length).toBeGreaterThan(0);
      for (const s of pack) {
        expect(seen.has(s.moduleId)).toBe(false);
        seen.add(s.moduleId);
      }
    }
    expect(seen.size).toBe(specs.length);
    // 1-based: index count must not throw and must be a real pack.
    expect(packs[count - 1].length).toBeGreaterThan(0);
  });

  it('does not fall back to returning the full file list for a single shard index', async () => {
    dir = mkdtempSync(join(tmpdir(), 'woc-seq-'));
    const specs: FakeSpec[] = [];
    for (let i = 0; i < 8; i++) {
      const path = join(dir, `g${i}.test.ts`);
      writeFileSync(path, "import { it } from 'vitest';\n");
      specs.push({ moduleId: path });
    }
    const seq = makeSequencer(dir, { index: 1, count: 4 });
    const pack = (await seq.shard(specs as never)) as FakeSpec[];
    // Proper sharding is a strict subset when files > 1 and count > 1.
    expect(pack.length).toBeLessThan(specs.length);
    expect(pack.length).toBeGreaterThan(0);
  });
});
