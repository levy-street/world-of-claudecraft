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
// resurrection.ts header comment, pinned as WHICH modules reach the clean slate,
// by all THREE routes: the direct call (exactly two: the clearPrep arm of
// readyArenaFighter in src/sim/social/arena.ts, which IS the clean slate, and
// a Fiesta down, fiestaDownEntity in social/fiesta.ts, which a Protect Yumi
// down runs too); readyArenaFighter called with clearPrep: true; and
// resetForArena, the one-line wrapper around that call, which arena.ts runs
// itself and hands out through the SimContext seam (ctx.resetForArena) to
// modules that never name readyArenaFighter at all. The phase 10 QA found the
// record wrong three times: on the readyArenaFighter route (every Yumi and
// Fiesta revive re-seats with clearPrep: true; Thornhollow Fields seats,
// starts, ends, and drops a leaver with clearPrep: true; ONLY its wave respawn,
// clearPrep: false, keeps a flask, the classic-era battleground-death rule the
// ledger records), on the resetForArena route (the Yumi match seat and the
// Vale Cup's kit-swap seat and teardown wipe through it, and the first cut of
// THIS scan was blind to a new ctx.resetForArena site anywhere), and on the
// wrapper pattern itself (a call spelled `ctx.resetForArena(e as Entity)` slid
// past the first bare-identifier regex). The accounting a flask lives under is
// therefore: overworld and PvE deaths keep it, a battleground or arena death
// keeps it on the corpse, every instanced match's seat and end (and each
// Fiesta or Yumi down and revive) clears it; each mode's behavior is pinned in
// its own suite (arena, battleground, yumi_match, fiesta, vale_cup_match).
// Absences cannot be asserted by driving the predicates, so the three caller
// sets are pinned literally here.
describe('resurrection: which sim modules wipe through aurasSurvivingCleanSlate', () => {
  const SIM_ROOT = fileURLToPath(new URL('../src/sim', import.meta.url));
  const CLEAN_SLATE_CALL = 'aurasSurvivingCleanSlate(';
  const INDIRECT_CALL = /readyArenaFighter\((?:ctx, )?[^)]*clearPrep: true/g;
  // A CALL of the wrapper, in any argument spelling: a bare `e`, a member
  // (`match.e`, `this.e`), an index, a cast, a ternary, one nested call
  // (`ctx.entities.get(pid)!`), or a call wrapped over lines. What keeps the
  // three DECLARATIONS out (`export function resetForArena(ctx: SimContext, e:
  // Entity): void {`, the Sim delegate `private resetForArena(e: Entity): void
  // {`, the seam's `resetForArena(e: Entity): void;`) is the RETURN annotation
  // after the closing paren: `(?!\s*:\s*void\b)`. The seam's bind line
  // (`resetForArena: sim.resetForArena.bind(sim)`) never opens a paren on the
  // name. Two residues, both fail-safe or documented: a declaration that
  // dropped its `: void` would be COUNTED (the table goes red and a person
  // looks, the safe direction), and a bracketed or aliased call
  // (`ctx['resetForArena'](e)`, `const f = ctx.resetForArena`) is invisible
  // here, the same class of blind spot the Lucent tripwire documents; neither
  // spelling exists in the sim tree, and the per-mode behavioral arms are the
  // net under this scan for any site that matters.
  const WRAPPER_CALL = /resetForArena\((?:[^()]|\([^()]*\))*\)(?!\s*:\s*void\b)/g;
  // Comments stripped first, so prose naming the helper (resurrection.ts and the
  // sim/moderation notes both do) cannot mint a call site that does not exist.
  // The line-comment arm keeps a `://` in a URL from eating the rest of its
  // line, the stripper bug this repo has already shipped once (#2499).
  const codeOf = (full: string): string =>
    readFileSync(full, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('is called from arena.ts and fiesta.ts, and from nowhere else in src/sim outside its own module', () => {
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

  it('reaches the clean slate INDIRECTLY (readyArenaFighter clearPrep: true) from exactly the recorded sites', () => {
    // The route the first cut of this scan missed: clearPrep: true runs
    // aurasSurvivingCleanSlate inside readyArenaFighter, so a module that never
    // names the predicate still wipes. Counted per file (call sites, not
    // lines that mention it), and pinned as the literal table so a new seat or
    // revive that wipes, or one that stops wiping, changes this record on
    // purpose. battleground.ts: seat (bgSeat), the countdown end, the leaver
    // reset, and the match end; its WAVE respawn passes clearPrep: false and is
    // deliberately absent here. yumi.ts: the revive. fiesta.ts: the revive.
    // arena.ts: the body of resetForArena (the wrapper the next case counts
    // the callers of) and, with clearPrep: false, the countdown-end top-off
    // that keeps a fighter's targets, absent here too.
    const files = tsFilesUnder(SIM_ROOT);
    const indirect = new Map<string, number>();
    for (const f of files) {
      const hits = codeOf(f.full).match(INDIRECT_CALL);
      if (hits && hits.length > 0) indirect.set(f.file, hits.length);
    }
    expect([...indirect.entries()].sort()).toEqual([
      ['social/arena.ts', 1],
      ['social/battleground.ts', 4],
      ['social/fiesta.ts', 1],
      ['social/yumi.ts', 1],
    ]);
    // And the one battleground respawn that KEEPS a flask is the wave, which
    // passes clearPrep: false: pinned as the negative literal, since it is the
    // classic-era rule the whole accounting is built around.
    const bg = codeOf(fileURLToPath(new URL('../src/sim/social/battleground.ts', import.meta.url)));
    expect(bg.match(/readyArenaFighter\(e, \{ clearPrep: false \}\)/g)?.length).toBe(1);
  });

  it('reaches the clean slate through the resetForArena WRAPPER from exactly the recorded sites', () => {
    // The third route, and the one the previous cut of this scan was blind to
    // (a planted ctx.resetForArena in an unrelated module stayed green): the
    // wrapper's callers never spell readyArenaFighter or clearPrep, so neither
    // pattern above sees them. Counted per file. arena.ts: its own seat
    // (startArenaMatch, every arena-family format including Fiesta), the match
    // end (endArenaMatch), and the send-home (returnFromArena). yumi.ts: the
    // match seat. vale_cup.ts: the kit-swap seat (valeCupStandardize) and the
    // teardown. sim.ts: the BODY of the Sim delegate (`private resetForArena`
    // forwarding to arenaMod.resetForArena), so a module reaching it as
    // ctx.resetForArena is counted at its own site above and the seam's
    // plumbing once here; the delegate's declaration line and its bind line
    // in buildSimContext are not calls and are not counted.
    const files = tsFilesUnder(SIM_ROOT);
    const wrapper = new Map<string, number>();
    for (const f of files) {
      const hits = codeOf(f.full).match(WRAPPER_CALL);
      if (hits && hits.length > 0) wrapper.set(f.file, hits.length);
    }
    expect([...wrapper.entries()].sort()).toEqual([
      ['sim.ts', 1],
      ['social/arena.ts', 3],
      ['social/vale_cup.ts', 2],
      ['social/yumi.ts', 1],
    ]);
    // The wrapper really is the clean slate and nothing softer: its body is the
    // one clearPrep: true call the indirect table counts for arena.ts.
    const arena = codeOf(fileURLToPath(new URL('../src/sim/social/arena.ts', import.meta.url)));
    expect(arena).toMatch(
      /export function resetForArena\(ctx: SimContext, e: Entity\): void \{\s*readyArenaFighter\(ctx, e, \{ clearPrep: true \}\);\s*\}/,
    );
  });

  it('the wrapper pattern matches every call spelling and no declaration (its own case, so a table red cannot hide it)', () => {
    // The three spellings the tree uses today, then the ones a new site could
    // plausibly be written in (the round-3 probe planted `e as Entity` and the
    // first regex, a bare-identifier tail, let it through): a member, an
    // index, a cast, a ternary argument, a call inside a ternary, one nested
    // call, a differently named context, and a call wrapped over lines.
    for (const call of [
      'ctx.resetForArena(e);',
      'for (const e of entities) resetForArena(ctx, e!);',
      'arenaMod.resetForArena(this.ctx, e);',
      'ctx.resetForArena(match.e);',
      'ctx.resetForArena(entities[i]);',
      'ctx.resetForArena(e as Entity);',
      'resetForArena(ctx, this.e);',
      'resetForArena(simCtx, e);',
      'ctx.resetForArena(cond ? a : b);',
      'ctx.resetForArena(ctx.entities.get(pid)!);',
      'resetForArena(ctx, must(e));',
      'ctx.resetForArena(\n  e,\n);',
      'ctx.resetForArena( e )',
    ]) {
      expect(call.match(WRAPPER_CALL)?.length, call).toBe(1);
    }
    expect('cond ? ctx.resetForArena(a) : ctx.resetForArena(b);'.match(WRAPPER_CALL)?.length).toBe(
      2,
    );
    // The declaration spellings, single-line and wrapped, and the seam's bind
    // line: none is a call.
    for (const decl of [
      'export function resetForArena(ctx: SimContext, e: Entity): void {',
      'export function resetForArena(\n  ctx: SimContext,\n  e: Entity,\n): void {',
      'private resetForArena(e: Entity): void {',
      'resetForArena(e: Entity): void;',
      'resetForArena: sim.resetForArena.bind(sim),',
    ]) {
      expect(decl.match(WRAPPER_CALL), decl).toBeNull();
    }
  });

  it('reads the sim tree only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});
