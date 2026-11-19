// The Masterless Strength's OWN elemental mechanics (Jose's brief of
// 2026-11-19 (b), docs/design/raid/smith_heart.md 7.5 "Its own elements";
// src/sim/encounters/smith_heart/final_strike.ts, final_fusion.ts,
// final_opposites.ts over the leaf final_elements_ids.ts), on a REAL Sim:
//   - Elemental Strike: its cadence on the tank, the stacks, the element
//     following the quarter, each debuff's effect, Static Charge's arc;
//   - Elemental Fusion: only on a change into a new quarter (never the pull's
//     first, an intermission or the final phase), each of the six pairs to its
//     combo, the combos' footprints and hits, the tiers' scaling and Mythic's
//     residue;
//   - Opposing Elements: the counts per tier, the even opposite pairs (deaths
//     included), non-tanks only, the cancel, the wrong meeting, the timeout.

import { describe, expect, it } from 'vitest';
import { HEART_ROOM, type SmithHeartVein } from '../src/sim/content/smith_heart_layout';
import { heartQuarterAt, heartQuarterSpot } from '../src/sim/content/smith_heart_quarters';
import { effectiveArmorOf } from '../src/sim/effective_stats';
import { finalScopeForDev } from '../src/sim/encounters/smith_heart/final';
import {
  ELEMENT_TUNING as E,
  ELEMENT_AURAS,
  ELEMENT_CASTS,
  ELEMENT_DIFFICULTY,
  ELEMENT_NAMES,
  ELEMENT_OBJECTS,
  FUSION_COMBOS,
  type FusionCombo,
  fusionCombo,
  type Polarity,
  polaritiesCancel,
  polarityCount,
  polarityFor,
  polarityOf,
  STRIKE_AURAS,
  spireLinks,
} from '../src/sim/encounters/smith_heart/final_elements_ids';
import { FINAL_DIFFICULTY } from '../src/sim/encounters/smith_heart/final_ids';
import type { FinalScope } from '../src/sim/encounters/smith_heart/final_scope';
import { elementalStrike, strikeStacks } from '../src/sim/encounters/smith_heart/final_strike';
import type { Entity, SimEvent } from '../src/sim/types';
import { type FinalFight, finalFight } from './helpers/final_fight';

type Damage = Extract<SimEvent, { type: 'damage' }>;
const hits = (ev: SimEvent[], name: string, target?: number): Damage[] =>
  ev.filter(
    (e): e is Damage =>
      e.type === 'damage' && e.ability === name && (target === undefined || e.targetId === target),
  );
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const sec = (s: number) => Math.round(s * 20);
const VEINS: readonly SmithHeartVein[] = ['heat', 'quench', 'breath', 'hammer'];

function must(f: FinalFight) {
  const st = f.state();
  if (!st) throw new Error('no fight');
  return st;
}

function scope(f: FinalFight): FinalScope {
  const s = finalScopeForDev(f.sim.ctx, f.inst);
  if (!s) throw new Error('no fight');
  return s;
}

/** Hold the boss where it stands (its tank by it) for `seconds`. */
function hold(f: FinalFight, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < sec(seconds); i++) {
    const b = f.local(f.boss());
    const t = f.local(f.players[0]);
    if (Math.hypot(b.x - t.x, b.z - t.z) > 3) f.put(f.players[0], b.x + 2, b.z + 1);
    out.push(...f.tick(1));
  }
  return out;
}

/** A spot `r` yards out from the room's centre on bearing `deg`. */
function spot(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: HEART_ROOM.x + Math.sin(a) * r, z: HEART_ROOM.z + Math.cos(a) * r };
}

/** Stand every player but the tank far apart round the room. */
function scatter(f: FinalFight): void {
  f.players.forEach((p, i) => {
    if (i === 0) return;
    const at = spot(24 + (i % 2) * 12, i * (360 / f.players.length));
    f.put(p, at.x, at.z);
  });
}

/** Silence the rest of the fight (the stars, the kit, the Anvil, the strike
 *  and the polarity clocks) so a test sees only what it lays. */
function quiet(f: FinalFight): void {
  const st = f.state();
  if (!st) throw new Error('no fight');
  for (const v of VEINS) st.stars.clock[v] = 1e9;
  st.anvilClock = 1e9;
  st.elements.strikeClock = 1e9;
  st.elements.polarityClock = 1e9;
}

// ---- the pure rules -------------------------------------------------------------------

describe('the pure rules', () => {
  it('every unordered pair fuses into its one combo, and a quarter with itself into none', () => {
    const want: Record<string, FusionCombo> = {
      'heat+quench': 'steam',
      'heat+hammer': 'magma',
      'heat+breath': 'firestorm',
      'quench+breath': 'hail',
      'quench+hammer': 'avalanche',
      'breath+hammer': 'spires',
    };
    const seen = new Set<FusionCombo>();
    for (const [pair, combo] of Object.entries(want)) {
      const [a, b] = pair.split('+') as [SmithHeartVein, SmithHeartVein];
      expect(fusionCombo(a, b), pair).toBe(combo);
      expect(fusionCombo(b, a), `${b}+${a}`).toBe(combo);
      seen.add(combo);
    }
    expect([...seen].sort()).toEqual([...FUSION_COMBOS].sort());
    for (const v of VEINS) expect(fusionCombo(v, v)).toBeNull();
  });

  it('the marks pair as opposites, always an even count', () => {
    expect(polaritiesCancel('fire', 'ice')).toBe(true);
    expect(polaritiesCancel('ice', 'fire')).toBe(true);
    expect(polaritiesCancel('earth', 'lightning')).toBe(true);
    expect(polaritiesCancel('fire', 'earth')).toBe(false);
    expect(polaritiesCancel('fire', 'fire')).toBe(false);
    expect(polaritiesCancel('lightning', 'ice')).toBe(false);
    for (let k = 0; k < 8; k += 2)
      expect(polaritiesCancel(polarityFor(k), polarityFor(k + 1)), `pair ${k / 2}`).toBe(true);
    // Fire/Ice, then Earth/Lightning, then again.
    expect([0, 1, 2, 3, 4, 5].map(polarityFor)).toEqual([
      'fire',
      'ice',
      'earth',
      'lightning',
      'fire',
      'ice',
    ]);
    for (let free = 0; free <= 12; free++)
      for (const cap of [4, 6, 8]) {
        const n = polarityCount(free, cap);
        expect(n % 2).toBe(0);
        expect(n).toBeLessThanOrEqual(Math.min(free, cap));
        expect(n).toBeGreaterThanOrEqual(Math.min(free, cap) - 1);
      }
    for (const p of ['fire', 'ice', 'earth', 'lightning'] as Polarity[])
      expect(polarityOf(['fire', 'ice', 'earth', 'lightning'].indexOf(p))).toBe(p);
  });

  it('the tiers: the same strike cadence, harder per stack, more of every combo', () => {
    const N = ELEMENT_DIFFICULTY.normal;
    const H = ELEMENT_DIFFICULTY.heroic;
    const M = ELEMENT_DIFFICULTY.mythic;
    expect(E.strikeEvery).toBe(8);
    expect(E.stackSeconds).toBe(30);
    expect(E.swapAt).toBe(4);
    for (const k of ['strikeGrowth', 'burnPerStack', 'arcMin', 'armorPerStack'] as const) {
      expect(H[k], k).toBeGreaterThan(N[k]);
      expect(M[k], k).toBeGreaterThanOrEqual(H[k]);
    }
    for (const k of [
      'steamClouds',
      'magmaMarks',
      'fireLanes',
      'hailPerWave',
      'avalancheLanes',
      'spires',
      'polarityMarks',
    ] as const) {
      expect(H[k], k).toBeGreaterThanOrEqual(N[k]);
      expect(M[k], k).toBeGreaterThanOrEqual(H[k]);
    }
    for (const k of [
      'steamMin',
      'magmaMin',
      'fireMin',
      'hailMin',
      'avalancheMin',
      'spireMin',
    ] as const) {
      expect(H[k], k).toBeGreaterThan(N[k]);
      expect(M[k], k).toBeGreaterThan(H[k]);
    }
    expect([N.polarityMarks, H.polarityMarks, M.polarityMarks]).toEqual([4, 6, 8]);
    expect(H.spires).toBeGreaterThan(N.spires);
    expect(M.spireDischarges).toBe(2);
    expect([N.residue, H.residue, M.residue]).toEqual([false, false, true]);
    expect([N.clashReach, H.clashReach, M.clashReach]).toEqual(['pair', 'pair', 'around']);
    expect([N.unbalancedOn, H.unbalancedOn, M.unbalancedOn]).toEqual(['player', 'raid', 'raid']);
    expect(M.unbalancedMin).toBeGreaterThan(H.unbalancedMin);
    expect(N.clashMin).toBeLessThan(H.clashMin);
  });

  it('a group of spires links into a chain, closed into a loop from three', () => {
    expect(spireLinks(2)).toEqual([[0, 1]]);
    expect(spireLinks(3)).toEqual([
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
    expect(spireLinks(4).length).toBe(4);
  });
});

// ---- Elemental Strike -----------------------------------------------------------------

describe('Elemental Strike', () => {
  it('every 8 s on its tank, a stack of the quarter it stands in that lasts 30 s', () => {
    const f = finalFight(6);
    // The Hammer's kit plants no bar of its own but the Anvil (held off here:
    // a planted bar holds the strike to its end).
    f.pullIn('hammer');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.anvilClock = 1e9;
    const tank = f.players[0];
    const ev = hold(f, E.strikeFirst + 3 * E.strikeEvery + 1);
    const struck = hits(ev, ELEMENT_NAMES.strike);
    expect(struck.length).toBe(4);
    expect(struck.every((h) => h.targetId === tank.id)).toBe(true);
    // Harder per stack.
    expect(struck[3].amount).toBeGreaterThan(struck[0].amount * 1.5);
    const a = aura(tank, STRIKE_AURAS.hammer);
    expect(a?.stacks).toBe(4);
    expect(a?.duration).toBe(E.stackSeconds);
    expect(strikeStacks(tank)).toEqual({ stacks: 4, vein: 'hammer' });
    // Nobody else carries it.
    for (const p of f.players.slice(1)) expect(strikeStacks(p).stacks).toBe(0);
  });

  it('the element follows the quarter: a strike in a new one re-forges the stacks into it', () => {
    const f = finalFight(6);
    f.pullIn('heat');
    quiet(f);
    const s = scope(f);
    const tank = f.players[0];
    elementalStrike(s, tank);
    elementalStrike(s, tank);
    expect(strikeStacks(tank)).toEqual({ stacks: 2, vein: 'heat' });
    // The boss drinks the Quench now: its strike carries the frost.
    f.dev('/dev heart final quarter quench');
    const q = heartQuarterSpot('quench');
    f.gather(q.x, q.z, 3);
    f.tick(2);
    expect(f.state()?.zone).toBe('quench');
    elementalStrike(scope(f), tank);
    expect(strikeStacks(tank)).toEqual({ stacks: 3, vein: 'quench' });
    expect(aura(tank, STRIKE_AURAS.heat)).toBeUndefined();
  });

  it('the stacks fall off 30 s after the last strike (the swap)', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    quiet(f);
    const tank = f.players[0];
    for (let k = 0; k < 4; k++) elementalStrike(scope(f), tank, 'hammer');
    f.tick(sec(E.stackSeconds - 1));
    expect(strikeStacks(tank).stacks).toBe(4);
    f.tick(sec(1.5));
    expect(strikeStacks(tank).stacks).toBe(0);
  });

  it('Searing Burn burns every second, harder per stack', () => {
    const f = finalFight(6);
    f.pullIn('heat');
    quiet(f);
    const tank = f.players[0];
    const s = scope(f);
    elementalStrike(s, tank, 'heat');
    const one = aura(tank, STRIKE_AURAS.heat)?.value ?? 0;
    elementalStrike(s, tank, 'heat');
    elementalStrike(s, tank, 'heat');
    const three = aura(tank, STRIKE_AURAS.heat)?.value ?? 0;
    expect(one).toBeGreaterThan(0);
    expect(three).toBeCloseTo(one * 3, -1);
    const ev = f.tick(sec(3.05));
    expect(hits(ev, ELEMENT_NAMES.heat, tank.id).length).toBeGreaterThanOrEqual(3);
  });

  it('Biting Frost slows per stack; from 5 stacks every strike freezes the tank for 2 s', () => {
    const f = finalFight(6);
    f.pullIn('quench');
    quiet(f);
    const tank = f.players[0];
    const s = scope(f);
    const per = ELEMENT_DIFFICULTY.normal.frostSlowPerStack;
    elementalStrike(s, tank, 'quench');
    expect(aura(tank, STRIKE_AURAS.quench)?.kind).toBe('slow');
    expect(aura(tank, STRIKE_AURAS.quench)?.value).toBeCloseTo(1 - per, 5);
    for (let k = 0; k < 3; k++) elementalStrike(s, tank, 'quench');
    expect(aura(tank, STRIKE_AURAS.quench)?.value).toBeCloseTo(1 - 4 * per, 5);
    expect(aura(tank, ELEMENT_AURAS.frozen)).toBeUndefined();
    elementalStrike(s, tank, 'quench');
    const frozen = aura(tank, ELEMENT_AURAS.frozen);
    expect(frozen?.kind).toBe('stun');
    expect(frozen?.duration).toBe(E.freezeSeconds);
    expect(f.sim.ctx.isStunned(tank)).toBe(true);
    f.tick(sec(E.freezeSeconds + 0.1));
    expect(aura(tank, ELEMENT_AURAS.frozen)).toBeUndefined();
    // The slow never passes its cap.
    for (let k = 0; k < 5; k++) elementalStrike(s, tank, 'quench');
    expect(aura(tank, STRIKE_AURAS.quench)?.value).toBeCloseTo(1 - E.frostSlowCap, 5);
  });

  it('Cracked Armor takes armour per stack, never under its floor', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    quiet(f);
    const tank = f.players[0];
    const s = scope(f);
    const per = ELEMENT_DIFFICULTY.normal.armorPerStack;
    elementalStrike(s, tank, 'hammer');
    const base = tank.stats.armor;
    expect(base).toBeGreaterThan(0);
    expect(effectiveArmorOf(tank)).toBeCloseTo(base * (1 - per), -1);
    for (let k = 0; k < 3; k++) elementalStrike(s, tank, 'hammer');
    expect(effectiveArmorOf(tank)).toBeCloseTo(base * (1 - 4 * per), -1);
    for (let k = 0; k < 5; k++) elementalStrike(s, tank, 'hammer');
    expect(effectiveArmorOf(tank)).toBeCloseTo(base * E.armorFloor, -1);
  });

  it('Static Charge: from 3 stacks lightning arcs from the tank to allies within 6 yd, no further', () => {
    const f = finalFight(6);
    f.pullIn('breath');
    quiet(f);
    const tank = f.players[0];
    const s = scope(f);
    const t = f.local(tank);
    const near = f.players[1];
    const far = f.players[2];
    const keep = () => {
      f.put(near, t.x + E.arcReach - 1.5, t.z);
      f.put(far, t.x - (E.arcReach + 4), t.z);
      f.put(tank, t.x, t.z);
    };
    for (let k = 0; k < 2; k++) elementalStrike(s, tank, 'breath');
    keep();
    let ev: SimEvent[] = [];
    for (let i = 0; i < sec(E.arcEvery * 2 + 0.2); i++) {
      keep();
      ev = ev.concat(f.tick(1));
    }
    // Two stacks: no arc yet.
    expect(hits(ev, ELEMENT_NAMES.breath).length).toBe(0);
    elementalStrike(s, tank, 'breath');
    ev = [];
    for (let i = 0; i < sec(E.arcEvery * 2 + 0.2); i++) {
      keep();
      ev = ev.concat(f.tick(1));
    }
    expect(hits(ev, ELEMENT_NAMES.breath, near.id).length).toBeGreaterThanOrEqual(2);
    expect(hits(ev, ELEMENT_NAMES.breath, far.id).length).toBe(0);
    expect(hits(ev, ELEMENT_NAMES.breath, tank.id).length).toBe(0);
    expect(ev.some((e) => e.type === 'spellfx' && e.ability === 'heart_final_static_arc')).toBe(
      true,
    );
    // Its own damage taken up per stack (spellvuln).
    expect(aura(tank, STRIKE_AURAS.breath)?.kind).toBe('spellvuln');
  });

  it('Heroic and Mythic strike harder at the same stacks', () => {
    const at = (tier: 'normal' | 'heroic' | 'mythic') => {
      const f = finalFight(5);
      if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
      f.pullIn('hammer');
      quiet(f);
      const s = scope(f);
      let ev: SimEvent[] = [];
      for (let k = 0; k < 5; k++) {
        elementalStrike(s, f.players[0], 'hammer');
        ev = ev.concat(f.tick(1));
      }
      const last = hits(ev, ELEMENT_NAMES.strike).pop();
      return last?.amount ?? 0;
    };
    const n = at('normal');
    const h = at('heroic');
    const m = at('mythic');
    expect(h).toBeGreaterThan(n);
    expect(m).toBeGreaterThan(n);
  });
});
