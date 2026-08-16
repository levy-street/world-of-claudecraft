// The shared death/respawn leaf module (src/sim/resurrection.ts): the two level-scaled
// sickness durations (Resurrection Sickness, aka "The Keeper's Toll", and the shorter
// Unstuck Sickness) and the "which auras survive death" predicate, shared by every player
// death/respawn site so the rule cannot drift.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHEATER_MARK_AURA_ID } from '../src/sim/moderation';
import {
  aurasSurvivingCleanSlate,
  aurasSurvivingDeath,
  RES_SICKNESS_DURATION,
  RES_SICKNESS_MIN_DURATION,
  RES_SICKNESS_MIN_LEVEL,
  RES_SICKNESS_STAT_MULT,
  RESURRECTION_SICKNESS_ID,
  resSicknessDuration,
  UNSTUCK_SICKNESS_DURATION,
  UNSTUCK_SICKNESS_ID,
  UNSTUCK_SICKNESS_MIN_DURATION,
  UNSTUCK_SICKNESS_MIN_LEVEL,
  UNSTUCK_SICKNESS_STAT_MULT,
  unstuckSicknessDuration,
} from '../src/sim/resurrection';
import { type Aura, MAX_LEVEL } from '../src/sim/types';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

// A minimal valid Aura carrying an id; the predicate reads only `id`, the rest satisfies
// the type.
function aura(id: string): Aura {
  return {
    id,
    name: id,
    kind: 'buff_allstats_pct',
    remaining: 10,
    duration: 10,
    value: -0.75,
    sourceId: 1,
    school: 'shadow',
  };
}

describe('resurrection: level-scaled sickness duration', () => {
  it('is zero below the minimum level (classic exemption)', () => {
    expect(resSicknessDuration(1)).toBe(0);
    expect(resSicknessDuration(RES_SICKNESS_MIN_LEVEL - 1)).toBe(0);
  });

  it('is exactly the minimum duration at the minimum level', () => {
    expect(resSicknessDuration(RES_SICKNESS_MIN_LEVEL)).toBe(RES_SICKNESS_MIN_DURATION);
  });

  it('is the full duration at max level', () => {
    expect(resSicknessDuration(MAX_LEVEL)).toBe(RES_SICKNESS_DURATION);
  });

  it('scales linearly and monotonically between the bounds', () => {
    const mid = (RES_SICKNESS_MIN_LEVEL + MAX_LEVEL) / 2;
    const expected = Math.round(
      RES_SICKNESS_MIN_DURATION + 0.5 * (RES_SICKNESS_DURATION - RES_SICKNESS_MIN_DURATION),
    );
    expect(resSicknessDuration(mid)).toBe(expected);
    expect(resSicknessDuration(RES_SICKNESS_MIN_LEVEL + 1)).toBeGreaterThan(
      RES_SICKNESS_MIN_DURATION,
    );
    expect(resSicknessDuration(MAX_LEVEL - 1)).toBeLessThan(RES_SICKNESS_DURATION);
  });
});

describe('unstuck: level-scaled sickness duration', () => {
  it('is zero below the minimum level (the same classic exemption)', () => {
    expect(unstuckSicknessDuration(1)).toBe(0);
    expect(unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL - 1)).toBe(0);
  });

  it('is exactly the minimum duration at the minimum level', () => {
    expect(unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL)).toBe(UNSTUCK_SICKNESS_MIN_DURATION);
  });

  it('tops out at five minutes, half the Pale Keeper ceiling', () => {
    expect(UNSTUCK_SICKNESS_DURATION).toBe(300);
    expect(UNSTUCK_SICKNESS_DURATION).toBe(RES_SICKNESS_DURATION / 2);
    expect(unstuckSicknessDuration(MAX_LEVEL)).toBe(UNSTUCK_SICKNESS_DURATION);
  });

  it('scales linearly and monotonically between the bounds', () => {
    const mid = (UNSTUCK_SICKNESS_MIN_LEVEL + MAX_LEVEL) / 2;
    expect(unstuckSicknessDuration(mid)).toBe(
      Math.round(
        UNSTUCK_SICKNESS_MIN_DURATION +
          0.5 * (UNSTUCK_SICKNESS_DURATION - UNSTUCK_SICKNESS_MIN_DURATION),
      ),
    );
    expect(unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL + 1)).toBeGreaterThan(
      UNSTUCK_SICKNESS_MIN_DURATION,
    );
    expect(unstuckSicknessDuration(MAX_LEVEL - 1)).toBeLessThan(UNSTUCK_SICKNESS_DURATION);
  });

  it('is strictly shorter than The Keeper’s Toll above the minimum level, and weighs the same', () => {
    expect(unstuckSicknessDuration(MAX_LEVEL)).toBeLessThan(resSicknessDuration(MAX_LEVEL));
    expect(unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL + 1)).toBeLessThan(
      resSicknessDuration(RES_SICKNESS_MIN_LEVEL + 1),
    );
    expect(UNSTUCK_SICKNESS_STAT_MULT).toBe(RES_SICKNESS_STAT_MULT);
    expect(UNSTUCK_SICKNESS_ID).not.toBe(RESURRECTION_SICKNESS_ID);
  });
});

describe('resurrection: aurasSurvivingDeath predicate', () => {
  it('keeps only Resurrection Sickness and drops every other aura', () => {
    const auras = [aura('rejuvenation'), aura(RESURRECTION_SICKNESS_ID), aura('blessing_of_might')];
    const survivors = aurasSurvivingDeath(auras);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(RESURRECTION_SICKNESS_ID);
  });

  it('keeps Unstuck Sickness too, so dying cannot shed it', () => {
    const auras = [aura('rejuvenation'), aura(UNSTUCK_SICKNESS_ID), aura('blessing_of_might')];
    const survivors = aurasSurvivingDeath(auras);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(UNSTUCK_SICKNESS_ID);
  });

  it('keeps encounter-owned unbreakable control until its script releases it', () => {
    const scriptedStun = { ...aura('scripted_stun'), unbreakableControl: true } as const;

    expect(aurasSurvivingDeath([aura('rejuvenation'), scriptedStun])).toEqual([scriptedStun]);
  });

  it('keeps a FLASK-marked aura, the fourth surviving class', () => {
    // Masterwrought phase 10. The predicate has four classes, not three, and
    // this one is keyed on Aura.flask rather than on an id or a kind: a flask
    // is bought to survive a wipe. The decoy is the point: the SAME id and kind
    // without the marker dies, so the filter cannot be reading the family.
    const marked = { ...aura('elixir_buff_sta'), flask: true } as const;
    const unmarked = aura('elixir_buff_sta');

    expect(aurasSurvivingDeath([aura('rejuvenation'), marked, unmarked])).toEqual([marked]);
  });

  it('returns an empty list when nothing survives', () => {
    expect(aurasSurvivingDeath([aura('rejuvenation')])).toEqual([]);
    expect(aurasSurvivingDeath([])).toEqual([]);
  });

  it('does not mutate the input array (immutable filter)', () => {
    const auras = [aura(RESURRECTION_SICKNESS_ID), aura('rejuvenation')];
    aurasSurvivingDeath(auras);
    expect(auras).toHaveLength(2);
  });

  it('keeps the operator-applied Cheater mark, so dying cannot serve a sanction', () => {
    // The mark's aura IS its played-seconds countdown, so dropping it here would
    // both end the sanction early and hand a marked player a one-keypress way out.
    const auras = [aura('rejuvenation'), aura(CHEATER_MARK_AURA_ID), aura('blessing_of_might')];
    const survivors = aurasSurvivingDeath(auras);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(CHEATER_MARK_AURA_ID);
  });
});

describe('resurrection: aurasSurvivingCleanSlate predicate', () => {
  it('keeps ONLY the Cheater mark, sicknesses and flasks included in the wipe', () => {
    // Arena entry and a Fiesta down strip more than a death does: a normalized
    // bout is decided by play, so even The Keeper's Toll goes. The sanction is
    // not something the fighter walked in carrying, so it stays. The flask
    // decoy pins the composed rule minted at the v0.38.0 merge: a flask
    // survives DEATH (the arm above) but never a clean-slate wipe, so nothing
    // carried in from the world rides into a ranked bout.
    const flask = { ...aura('elixir_buff_sta'), flask: true } as const;
    const auras = [
      aura(RESURRECTION_SICKNESS_ID),
      aura(UNSTUCK_SICKNESS_ID),
      aura('rejuvenation'),
      flask,
      aura(CHEATER_MARK_AURA_ID),
    ];
    const survivors = aurasSurvivingCleanSlate(auras);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(CHEATER_MARK_AURA_ID);
  });

  it('drops encounter-owned unbreakable control too (a clean slate is cleaner)', () => {
    const scriptedStun = { ...aura('scripted_stun'), unbreakableControl: true } as const;
    expect(aurasSurvivingCleanSlate([scriptedStun])).toEqual([]);
  });

  it('returns an empty list when nothing survives', () => {
    expect(aurasSurvivingCleanSlate([aura('rejuvenation')])).toEqual([]);
    expect(aurasSurvivingCleanSlate([])).toEqual([]);
  });

  it('does not mutate the input array (immutable filter)', () => {
    const auras = [aura(CHEATER_MARK_AURA_ID), aura('rejuvenation')];
    aurasSurvivingCleanSlate(auras);
    expect(auras).toHaveLength(2);
  });
});

// The PvP half of the flask decision, which until now lived only in the
// resurrection.ts header comment: arena entry and a Fiesta down wipe through
// aurasSurvivingCleanSlate (so a flask never rides into a ranked bout), while
// Thornhollow Fields and Protect Yumi deliberately do NOT wipe, so a death in
// either mode runs the ordinary death filter and the flask survives it. The
// second half is an ABSENCE, and no predicate arm above can assert one: every
// test in this file drives the two functions directly, so re-pointing
// battleground.ts at the harsher one would leave all of them green. What the
// decision actually is, is WHICH modules call it, so that is what is pinned.
describe('resurrection: which sim modules wipe through aurasSurvivingCleanSlate', () => {
  const SIM_ROOT = fileURLToPath(new URL('../src/sim', import.meta.url));
  const CLEAN_SLATE_CALL = 'aurasSurvivingCleanSlate(';
  // Comments stripped first, so prose naming the helper (resurrection.ts and the
  // sim/moderation notes both do) cannot mint a call site that does not exist.
  // The line-comment arm keeps a `://` in a URL from eating the rest of its
  // line, the stripper bug this repo has already shipped once (#2499).
  const codeOf = (full: string): string =>
    readFileSync(full, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('is called from arena.ts and fiesta.ts, and from nowhere else in src/sim', () => {
    const files = tsFilesUnder(SIM_ROOT);
    // Vacuity floor near the real count: a walk that collapsed to the top level
    // (or to nothing) would find no caller at all and pass the set assertion
    // below by accident, since both real callers live one directory down.
    expect(files.length, 'the src/sim walk found the real tree').toBeGreaterThan(400);
    expect(
      files.some((f) => f.file === 'social/arena.ts'),
      'the walk reaches subdirectories',
    ).toBe(true);

    const callers = files
      .filter((f) => f.file !== 'resurrection.ts' && codeOf(f.full).includes(CLEAN_SLATE_CALL))
      .map((f) => f.file)
      .sort();
    expect(callers).toEqual(['social/arena.ts', 'social/fiesta.ts']);
  });

  it('is NOT called from battleground.ts or yumi.ts: those modes keep their flasks', () => {
    // Named directly rather than left to the set above, because THIS is the
    // recorded decision: classic-era flasks persisted through battleground
    // deaths, so Thornhollow Fields and Protect Yumi run the ordinary death
    // filter and a flask rides through a death inside either mode.
    for (const file of ['social/battleground.ts', 'social/yumi.ts']) {
      const full = fileURLToPath(new URL(`../src/sim/${file}`, import.meta.url));
      expect(codeOf(full).includes(CLEAN_SLATE_CALL), `${file} must not clean-slate`).toBe(false);
    }
  });

  it('reads the sim tree only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});
