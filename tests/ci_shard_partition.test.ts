import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertPartitionCompleteness,
  MEASURED_FALLBACK_MS,
  MEASURED_WEIGHTS,
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
    // f000 and f001 must not both land on the same pack when count divides span.
    // After sha1 sort they may not be neighbors; check counts instead.
    const counts = a.map((p) => p.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // CI active strategy is LPT over MEASURED weights (re-wired 2026-08-14
    // after the harness splits; stripe re-measured WORSE than contiguous
    // with real durations and stays rejected).
    expect(partitionForCi).toBe(partitionByLpt);
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

  it('prefers a measured duration over every heuristic and falls back cleanly', () => {
    // The whale must carry its real measured ms (not the static guess), and
    // an unknown file must keep the heuristic path (never zero, never NaN).
    const whale = MEASURED_WEIGHTS['tests/druid_balance_probe.test.ts'];
    expect(whale).toBeGreaterThan(120_000);
    expect(weightForTestFile('tests/druid_balance_probe.test.ts', '', 100)).toBe(whale);
    const unknown = weightForTestFile(
      'tests/not_yet_written.test.ts',
      "import x from '../src/sim/sim';",
      500,
    );
    expect(unknown).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(unknown)).toBe(true);
  });

  it('carries a plausibly complete measured table with provenance', () => {
    // Vacuity floor near the real harvest (2,709 files on 2026-08-14): a
    // shrunken regeneration (e.g. harvested from a SELECTIVE run) must fail
    // here, not silently unbalance the packs.
    expect(Object.keys(MEASURED_WEIGHTS).length).toBeGreaterThanOrEqual(2_400);
    // Realism: the table must carry real variance (a degenerate all-equal
    // regeneration would balance trivially while measuring nothing).
    const heavy = Object.values(MEASURED_WEIGHTS).filter((ms) => ms > 60_000).length;
    expect(heavy).toBeGreaterThanOrEqual(5);
    const raw = JSON.parse(
      readFileSync(join(root, 'scripts/ci_shard_weights.generated.json'), 'utf8'),
    ) as { __provenance?: { run?: string; files?: number } };
    expect(raw.__provenance?.run).toMatch(/^\d+$/);
    expect(raw.__provenance?.files).toBe(Object.keys(MEASURED_WEIGHTS).length);
    // Every row must name a file that exists on disk: absent-file rows are
    // exactly this table's own failure story (an interim hand-merge imported
    // 94 rows from an unmerged branch and they rode along until pruned), and
    // a stale row silently skews the pack it lands in.
    const stale = Object.keys(MEASURED_WEIGHTS).filter((file) => !existsSync(join(root, file)));
    expect(stale).toEqual([]);
    for (const [file, ms] of Object.entries(MEASURED_WEIGHTS)) {
      expect(file.startsWith('tests/'), file).toBe(true);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThan(20 * 60_000);
    }
  });

  it('is wired as the live vitest sequencer', () => {
    // Line-anchored on the RAW text (a block-comment strip would eat the
    // config's own glob patterns): a `//`-commented wiring breaks the ^\s*
    // anchor, so it cannot satisfy the pin.
    const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    expect(vite).toMatch(/^\s{4}sequence: \{ sequencer: BalancedSequencer \},$/m);
    expect(vite).toMatch(
      /^import \{ BalancedSequencer \} from '\.\/scripts\/ci_balanced_sequencer\.mjs';$/m,
    );
  });

  it('gives every unknown file the measured-scale fallback (never the raw heuristic)', () => {
    // The review round measured the import-cost heuristic on a different
    // scale than real durations (unknowns claimed 18.7% of planned load and
    // made the packing WORSE than contiguous), so with a non-empty table
    // every unknown file gets exactly the measured median.
    expect(MEASURED_FALLBACK_MS).toBeGreaterThan(0);
    const values = Object.values(MEASURED_WEIGHTS).sort((a, b) => a - b);
    expect(MEASURED_FALLBACK_MS).toBe(values[Math.floor(values.length / 2)]);
    for (const [path, body] of [
      ['tests/__synthetic_plain.test.ts', "import { it } from 'vitest';\n"],
      ['tests/__synthetic_render_heavy.test.ts', "import * as THREE from 'three';\n"],
      ['tests/__synthetic_electron.test.ts', "import { app } from 'electron';\n"],
    ] as const) {
      expect(weightForTestFile(path, body, 100)).toBe(MEASURED_FALLBACK_MS);
    }
  });

  it('a table member returns exactly its measured ms, anchored independently', () => {
    // The whale is DERIVED as the table argmax (rename-proof), with an
    // absolute bound no heuristic or fallback can reach.
    const [whaleFile, whaleMs] = Object.entries(MEASURED_WEIGHTS).sort((a, b) => b[1] - a[1])[0];
    expect(whaleMs).toBeGreaterThan(120_000);
    expect(weightForTestFile(whaleFile, '', 100)).toBe(whaleMs);
    // A mid-table member with rich imports still returns its measured value,
    // proving measured beats the heuristic path outright (the old additive
    // overlay is deleted; mail_expiry's measured ms sits far below the 82k
    // the overlay-era sum produced).
    expect(MEASURED_WEIGHTS['tests/mail_expiry.test.ts']).toBeLessThan(80_000);
    expect(weightForTestFile('tests/mail_expiry.test.ts', '', 1000)).toBe(
      MEASURED_WEIGHTS['tests/mail_expiry.test.ts'],
    );
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
    // Active CI strategy (LPT over measured weights).
    const packs = partitionForCi(items, SHARD_N);
    expect(assertPartitionCompleteness(items, packs)).toEqual({ ok: true });
    const counts = packs.map((p) => p.length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(items.length);
    expect(counts.every((c) => c > 0)).toBe(true);
    // LPT's contract is WEIGHTED balance, not count parity, and the bar is
    // scored on MEASURED ms only (unknowns at the measured fallback), never
    // on the planner's own weights: a self-referential bar passed cleanly
    // while the real spread regressed (review round). 1.15 is the D11 bar.
    const measuredLoad = (p: { key: string }[]) =>
      p.reduce((s, x) => s + (MEASURED_WEIGHTS[x.key.slice(1)] ?? MEASURED_FALLBACK_MS), 0);
    const loads = packs.map(measuredLoad);
    const sorted = [...loads].sort((a, b) => a - b);
    const mid = Math.floor(loads.length / 2);
    const median = loads.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    expect(Math.max(...loads) / median).toBeLessThanOrEqual(1.15);
    // Table coverage over the real walked tree: staleness shows up as
    // fallback churn. The table is refreshed only from a completed all-green
    // CI harvest, so release-side suite growth rides the measured-median
    // fallback until the next harvest rather than inventing local weights.
    const covered = items.filter((i) => MEASURED_WEIGHTS[i.key.slice(1)] !== undefined).length;
    expect(covered / items.length).toBeGreaterThanOrEqual(0.94);
  });
});
