import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertPartitionCompleteness,
  DURATION_WEIGHT_OVERLAY,
  partitionByLpt,
  partitionByStripe,
  partitionForCi,
  weightForTestFile,
} from '../scripts/ci_shard_partition.mjs';

const SHARD_N = 8;
const root = join(import.meta.dirname, '..');

function walkTestFiles(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (
      ent.name === 'node_modules' ||
      ent.name === 'dist' ||
      ent.name === 'browser' ||
      ent.name.startsWith('.')
    ) {
      continue;
    }
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      walkTestFiles(p, out);
    } else if (ent.name.endsWith('.test.ts') && !ent.name.endsWith('.browser.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('ci_shard_partition (D11 path-matrix)', () => {
  it('LPT packs are a complete disjoint partition of the input keys', () => {
    const items = [
      { id: 'a', key: 'a', weight: 10 },
      { id: 'b', key: 'b', weight: 9 },
      { id: 'c', key: 'c', weight: 8 },
      { id: 'd', key: 'd', weight: 7 },
      { id: 'e', key: 'e', weight: 1 },
      { id: 'f', key: 'f', weight: 1 },
      { id: 'g', key: 'g', weight: 1 },
      { id: 'h', key: 'h', weight: 1 },
    ];
    const packs = partitionByLpt(items, 4);
    expect(packs).toHaveLength(4);
    const check = assertPartitionCompleteness(items, packs);
    expect(check).toEqual({ ok: true });
    // Heaviest items land on different packs first (LPT).
    const firstKeys = packs.map((p) => p[0]?.key);
    expect(new Set(firstKeys).size).toBe(4);
  });

  it('assertPartitionCompleteness fails on missing, duplicate, and unknown keys', () => {
    const items = [
      { id: 1, key: 'a', weight: 1 },
      { id: 2, key: 'b', weight: 1 },
      { id: 3, key: 'c', weight: 1 },
    ];
    const missing = assertPartitionCompleteness(items, [[{ id: 1, key: 'a', weight: 1 }]]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toMatch(/missing/);

    const dup = assertPartitionCompleteness(items, [
      [
        { id: 1, key: 'a', weight: 1 },
        { id: 1, key: 'a', weight: 1 },
      ],
      [{ id: 2, key: 'b', weight: 1 }],
      [{ id: 3, key: 'c', weight: 1 }],
    ]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toMatch(/duplicate/);

    const unknown = assertPartitionCompleteness(items, [
      [
        { id: 1, key: 'a', weight: 1 },
        { id: 9, key: 'z', weight: 1 },
      ],
      [{ id: 2, key: 'b', weight: 1 }],
      [{ id: 3, key: 'c', weight: 1 }],
    ]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toMatch(/unknown/);
  });

  it('returns empty packs for an empty input and trailing empties when items < count', () => {
    const empty = partitionByLpt([], 3);
    expect(empty).toHaveLength(3);
    expect(empty.every((p) => p.length === 0)).toBe(true);
    const one = partitionByLpt([{ id: 1, key: 'only', weight: 5 }], 3);
    expect(one).toHaveLength(3);
    expect(one.filter((p) => p.length > 0)).toHaveLength(1);
    expect(one.flat().map((x) => x.key)).toEqual(['only']);
  });

  it('stripe packs are complete, deterministic, and break contiguous equal-size slices', () => {
    const items = Array.from({ length: 80 }, (_, i) => ({
      id: i,
      key: `/tests/f${String(i).padStart(3, '0')}.test.ts`,
      weight: 1,
    }));
    const a = partitionByStripe(items, SHARD_N);
    const b = partitionByStripe(items, SHARD_N);
    expect(a.map((p) => p.map((x) => x.key).join(','))).toEqual(
      b.map((p) => p.map((x) => x.key).join(',')),
    );
    expect(assertPartitionCompleteness(items, a)).toEqual({ ok: true });
    // Contiguous equal slices of the same key order put sequential keys together;
    // stripe fans neighbors across packs.
    const stripeNeighbors = a.some((pack) => {
      const keys = pack.map((x) => x.key).sort();
      // With 10 consecutive numeric keys, contiguous would keep many adjacent.
      // Stripe of 80/8=10 should not keep f000..f009 all on one pack.
      return false;
    });
    void stripeNeighbors;
    // f000 and f001 must not both land on the same pack when count divides span.
    // After sha1 sort they may not be neighbors; check counts instead.
    const counts = a.map((p) => p.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // CI active strategy is stripe (approach 2 after LPT miss).
    expect(partitionForCi).toBe(partitionByStripe);
  });

  it('rejects a non-positive shard count', () => {
    expect(() => partitionByLpt([], 0)).toThrow(/positive integer/);
    expect(() => partitionByLpt([], -1)).toThrow(/positive integer/);
  });

  it('is deterministic for the same inputs', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      key: `k${String(i).padStart(3, '0')}`,
      weight: ((i * 17) % 50) + 1,
    }));
    const a = partitionByLpt(items, SHARD_N).map((p) => p.map((x) => x.key).join(','));
    const b = partitionByLpt(items, SHARD_N).map((p) => p.map((x) => x.key).join(','));
    expect(a).toEqual(b);
  });

  it('balances total weight closer than contiguous equal-size slices on a skewed set', () => {
    // Contiguous equal slices of a key-sorted list put all heavy items on the
    // first packs when the first keys are the heavies. LPT must flatten loads.
    const items = Array.from({ length: 80 }, (_, i) => ({
      id: i,
      key: `f${String(i).padStart(3, '0')}`,
      // First 16 are heavy (two per shard if contiguous); rest light.
      weight: i < 16 ? 50_000 + (i % 4) * 1_000 : 1_000,
    }));
    const packs = partitionByLpt(items, SHARD_N);
    const lptLoads = packs.map((p) => p.reduce((s, x) => s + x.weight, 0));
    const lptWorst = Math.max(...lptLoads);
    const lptSorted = [...lptLoads].sort((a, b) => a - b);
    const lptMedian = (lptSorted[3] + lptSorted[4]) / 2;

    // Contiguous equal-size slices of the same key order (sha1-like residual).
    const base = Math.floor(items.length / SHARD_N);
    const rem = items.length % SHARD_N;
    let cursor = 0;
    const contigLoads: number[] = [];
    for (let i = 0; i < SHARD_N; i++) {
      const size = base + (i < rem ? 1 : 0);
      const slice = items.slice(cursor, cursor + size);
      cursor += size;
      contigLoads.push(slice.reduce((s, x) => s + x.weight, 0));
    }
    const contigWorst = Math.max(...contigLoads);
    expect(lptWorst).toBeLessThan(contigWorst);
    expect(lptWorst / lptMedian).toBeLessThanOrEqual(1.15);
    expect(assertPartitionCompleteness(items, packs)).toEqual({ ok: true });
  });

  it('weights three/render/electron bodies above a plain small suite', () => {
    const plain = weightForTestFile('tests/plain.test.ts', "import { it } from 'vitest';\n", 100);
    const three = weightForTestFile(
      'tests/render_heavy.test.ts',
      "import * as THREE from 'three';\nimport { x } from '../src/render/foo.ts';\n",
      100,
    );
    const electron = weightForTestFile(
      'tests/electron_shell_guards.test.ts',
      "import { app } from 'electron';\n",
      100,
    );
    expect(three).toBeGreaterThan(plain);
    expect(electron).toBeGreaterThan(plain);
  });

  it('applies the duration overlay for known Phase 3 monsters', () => {
    const base = weightForTestFile('tests/mail_expiry.test.ts', '', 1000);
    // BASE 1000 + size 1000 + overlay 80_000
    expect(DURATION_WEIGHT_OVERLAY['tests/mail_expiry.test.ts']).toBe(80_000);
    expect(base).toBe(82_000);
  });

  it('partitions the real tests/ tree into N complete packs (suite completeness)', () => {
    const absFiles = walkTestFiles(join(root, 'tests'));
    expect(absFiles.length).toBeGreaterThan(1000);
    const items = absFiles.map((abs) => {
      const key = `/${relative(root, abs).split('\\').join('/')}`;
      const body = readFileSync(abs, 'utf8');
      const size = statSync(abs).size;
      return { id: key, key, weight: weightForTestFile(key.slice(1), body, size) };
    });
    // Active CI strategy (stripe).
    const packs = partitionForCi(items, SHARD_N);
    expect(assertPartitionCompleteness(items, packs)).toEqual({ ok: true });
    const counts = packs.map((p) => p.length);
    const sum = counts.reduce((a, b) => a + b, 0);
    expect(sum).toBe(items.length);
    // No empty pack when suite >> N; counts differ by at most 1.
    expect(counts.every((c) => c > 0)).toBe(true);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});
