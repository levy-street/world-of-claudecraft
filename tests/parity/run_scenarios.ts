// Shared runner for the sharded parity gate (parity_a..g.test.ts) and the
// sharded coverage suite (coverage_a..c.test.ts).
//
// The gate used to live in a single parity.test.ts; recording every scenario
// three times in one worker made it the slowest file in the whole suite. The
// scenario list is now split across several *.test.ts shard files, each running
// a CONTIGUOUS slice of SCENARIOS through this one runner, so vitest can spread
// the recordings over parallel worker files. Nothing about what is recorded,
// how goldens resolve, or how UPDATE_PARITY mints changes: each shard mints
// exactly its own slice's goldens into the same tests/parity/golden dir.
//
// For every scenario the gate asserts two things:
//   1. INTERNALLY DETERMINISTIC: recording the same scenario twice is identical
//      (proves the harness itself adds no nondeterminism).
//   2. MATCHES THE COMMITTED GOLDEN: the recorded trace equals the checked-in
//      golden (proves current Sim behavior == the behavior captured when the
//      golden was minted).
//
// A red trace means behavior changed. Fix the change, NOT the harness. Regenerate
// goldens deliberately and reviewably with `UPDATE_PARITY=1 npx vitest run
// tests/parity` as its own commit.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Recorder, Scenario } from './record';
import { record, recordTrace } from './record';
import { SCENARIOS } from './scenarios';
import type { Trace } from './trace';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, 'golden');
const UPDATE = process.env.UPDATE_PARITY === '1';

function goldenPath(name: string): string {
  return join(GOLDEN_DIR, `${name}.json`);
}

// Normalize through JSON so the in-memory trace and the parsed golden compare as
// plain data (undefined-vs-missing and key order can't matter).
function plain(trace: Trace): unknown {
  return JSON.parse(JSON.stringify(trace));
}

// Contiguous shard boundaries over SCENARIOS, timing-balanced by MEASURED
// per-file cost (not by scenario count). Two subtleties found while balancing:
// recording warms subsystem code paths for later same-subsystem scenarios, so
// `fiesta` stays in the same shard as the heavy `fiesta_powerups` (cold, that
// scenario alone records ~4x slower); and `nythraxis_full_pull` is the one
// irreducibly heavy scenario, so it rides alone. The last bound is
// SCENARIOS.length, so a newly appended scenario automatically lands in the
// final shard. Every shard file re-validates the tiling at import time, so a
// bad edit here fails the whole suite instead of silently dropping scenarios
// from the gate.
const SHARD_BOUNDS: readonly number[] = [0, 7, 11, 13, 17, 36, 37, SCENARIOS.length];

export const PARITY_SHARD_COUNT = SHARD_BOUNDS.length - 1;

function shardSlice(shard: number): Scenario[] {
  if (!Number.isInteger(shard) || shard < 0 || shard >= PARITY_SHARD_COUNT) {
    throw new Error(`parity shard ${shard} out of range 0..${PARITY_SHARD_COUNT - 1}`);
  }
  if (SHARD_BOUNDS[0] !== 0 || SHARD_BOUNDS[SHARD_BOUNDS.length - 1] !== SCENARIOS.length) {
    throw new Error('SHARD_BOUNDS must start at 0 and end at SCENARIOS.length');
  }
  for (let i = 1; i < SHARD_BOUNDS.length; i++) {
    if (!(SHARD_BOUNDS[i] > SHARD_BOUNDS[i - 1])) {
      throw new Error('SHARD_BOUNDS must be strictly increasing (every shard non-empty)');
    }
  }
  return SCENARIOS.slice(SHARD_BOUNDS[shard], SHARD_BOUNDS[shard + 1]);
}

// The parity GATE for one shard: identical assertions (and identical full test
// names, `parity gate > <scenario> > ...`) to the pre-shard single file.
export function runParityShard(shard: number): void {
  const scenarios = shardSlice(shard);
  describe('parity gate', () => {
    for (const scenario of scenarios) {
      describe(scenario.name, () => {
        // Explicit timeouts: the heaviest scenario (nythraxis_full_pull) records a
        // full raid pull TWICE in the determinism test and brushes vitest's 5000ms
        // default on slow shared CI runners (observed timing out twice in a row on
        // the PR gate while green locally). The assertions are unchanged; the
        // recording just gets room to finish. This does not soften the gate: a
        // trace mismatch still fails identically.
        it('records deterministically (same scenario -> identical trace)', () => {
          const a = plain(recordTrace(scenario));
          const b = plain(recordTrace(scenario));
          expect(a).toEqual(b);
          // two full recordings of the heaviest scenarios (the raid pull,
          // the fiesta) on the 13-zone world: headroom under suite load
        }, 90_000);

        it(UPDATE ? 'mints the golden' : 'matches the committed golden', () => {
          const trace = plain(recordTrace(scenario));
          const path = goldenPath(scenario.name);
          if (UPDATE) {
            mkdirSync(GOLDEN_DIR, { recursive: true });
            writeFileSync(path, `${JSON.stringify(trace, null, 2)}\n`);
            return;
          }
          expect(existsSync(path), `missing golden for ${scenario.name}; run UPDATE_PARITY=1`).toBe(
            true,
          );
          const golden = JSON.parse(readFileSync(path, 'utf8'));
          expect(trace).toEqual(golden);
          // a full re-recording compared against disk: same headroom as above
        }, 90_000);
      });
    }
  });
}

// Shared helpers for the coverage shards (moved verbatim from coverage.test.ts).

export type Ev = Record<string, any>;

export function run(name: string): Recorder {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (!scenario) throw new Error(`no scenario ${name}`);
  return record(scenario).rec;
}

export function entities(rec: Recorder): any[] {
  return [...(rec.sim as any).entities.values()];
}
