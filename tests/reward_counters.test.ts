// The session reward counters' ZERO VALUE, pinned field by field.
//
// WHY THIS FILE EXISTS. src/sim/reward_counters.ts was extracted out of sim.ts so
// one module owns the shape, and the extraction surfaced that nothing pinned it:
// deleting a single `levelUps: 0` line survived every suite in the repo. The
// consequence is not a crash. headless/env_server.ts computes its RL reward as
// `(c.levelUps - this.prev.levelUps) * r.levelUp`, so a missing zero makes the
// reward NaN from the first step, silently, for as long as a training run lasts.
import { describe, expect, it } from 'vitest';
import { freshCounters, type RewardCounters } from '../src/sim/reward_counters';
import { Sim } from '../src/sim/sim';

// Every key of the interface, written out ONCE as data. The `satisfies` makes it
// exactly the interface's key set at compile time: a key added to RewardCounters
// without a row here fails tsc, and a row here that is not a key fails too. That
// is what makes the runtime loop below exhaustive rather than a sample.
const EVERY_FIELD = [
  'damageDealt',
  'damageTaken',
  'kills',
  'deaths',
  'xpGained',
  'questsCompleted',
  'questProgress',
  'lootCopper',
  'levelUps',
] as const satisfies readonly (keyof RewardCounters)[];
// The CONSTRAINED form, because a bare `type X = ... ? true : never` is legal
// TypeScript that resolves to `never` and emits no diagnostic at all. Only a type
// PARAMETER constrained to never rejects a non-never union, which is what makes
// the comment above true (the same idiom tests/world_api_parity.test.ts uses).
type AssertNever<T extends never> = T;
type _Exhaustive = AssertNever<Exclude<keyof RewardCounters, (typeof EVERY_FIELD)[number]>>;

describe('freshCounters', () => {
  it('gives EVERY field of the interface a real zero, not merely some of them', () => {
    const c = freshCounters();
    for (const field of EVERY_FIELD) {
      // `toBe(0)` and not a truthiness check: undefined is the failure mode, and
      // `expect(c[field]).toBeFalsy()` would pass for it.
      expect(c[field], `${field} has no zero`).toBe(0);
      expect(Number.isFinite(c[field]), `${field} is not a finite number`).toBe(true);
    }
    // And no EXTRA keys, so a field removed from the interface but left in the
    // zero value (the other half of the drift) reddens here too.
    expect(Object.keys(c).sort()).toEqual([...EVERY_FIELD].sort());
  });

  it('hands back a FRESH object each time, so two sessions cannot share one', () => {
    const a = freshCounters();
    const b = freshCounters();
    expect(a).not.toBe(b);
    a.kills = 7;
    expect(b.kills, 'the second set saw the first one mutate').toBe(0);
  });

  it('is what a new Sim actually starts from, so the module is really the owner', () => {
    // The extraction is only worth anything if sim.ts consumes it. Read the
    // counters off a real constructed Sim rather than trusting the import.
    const sim = new Sim({ seed: 12345, playerClass: 'warrior' });
    expect(sim.counters).toEqual(freshCounters());
  });
});
