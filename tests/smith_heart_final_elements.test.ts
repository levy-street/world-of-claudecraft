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
import { fireCombo } from '../src/sim/encounters/smith_heart/final_fusion';
import { FINAL_DIFFICULTY } from '../src/sim/encounters/smith_heart/final_ids';
import { failedPairs, startOpposites } from '../src/sim/encounters/smith_heart/final_opposites';
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
    // Normal four; Heroic and Mythic every living non-tank (the cap is past
    // any raid's size: polarityCount keeps it even).
    expect(N.polarityMarks).toBe(4);
    expect(H.polarityMarks).toBeGreaterThanOrEqual(40);
    expect(M.polarityMarks).toBeGreaterThanOrEqual(40);
    expect(H.spires).toBeGreaterThan(N.spires);
    expect(M.spireDischarges).toBe(2);
    expect([N.residue, H.residue, M.residue]).toEqual([false, false, true]);
    expect([N.clashReach, H.clashReach, M.clashReach]).toEqual(['pair', 'pair', 'around']);
    expect([N.unbalancedOn, H.unbalancedOn, M.unbalancedOn]).toEqual(['player', 'raid', 'raid']);
    expect(M.unbalancedMin).toBeGreaterThan(H.unbalancedMin);
    expect(N.clashMin).toBeLessThan(H.clashMin);
  });

  it('a timeout counts its failed pairs: the marks left, two to a pair, rounded up', () => {
    expect([0, 1, 2, 3, 4, 8].map(failedPairs)).toEqual([0, 1, 1, 2, 2, 4]);
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

// ---- Elemental Fusion -----------------------------------------------------------------

/** Carry the boss into `vein` (the raid with it) and hold it there. */
function carry(f: FinalFight, vein: SmithHeartVein, seconds: number): SimEvent[] {
  f.dev(`/dev heart final quarter ${vein}`);
  const q = heartQuarterSpot(vein);
  f.gather(q.x, q.z, 3);
  return hold(f, seconds);
}

describe('Elemental Fusion', () => {
  it("never on the pull's first quarter", () => {
    const f = finalFight(6);
    f.pullIn('heat');
    const ev = hold(f, 10);
    expect(f.state()?.elements.fusions).toBe(0);
    expect(ev.some((e) => e.type === 'spellfx' && e.ability === 'heart_final_fusion_start')).toBe(
      false,
    );
  });

  it("a change into a new quarter: a 3 s bar with both elements, then the pair's combo", () => {
    const f = finalFight(6);
    f.pullIn('heat');
    quiet(f);
    let ev = carry(f, 'breath', 0.5);
    const st = f.state();
    expect(st?.elements.casting).toEqual({ from: 'heat', to: 'breath' });
    expect(f.boss().castingAbility).toBe(ELEMENT_CASTS.fusion);
    const fa = aura(f.boss(), ELEMENT_AURAS.fusion);
    expect(fa).toBeDefined();
    expect(ev.some((e) => e.type === 'spellfx' && e.ability === 'heart_final_fusion_start')).toBe(
      true,
    );
    ev = hold(f, E.fusionCast);
    expect(st?.elements.fusions).toBe(1);
    expect(st?.elements.lastCombo).toBe('firestorm');
    expect(st?.elements.comboQuarter).toBe('breath');
    expect(f.objects(ELEMENT_OBJECTS.firePrefix).length).toBe(ELEMENT_DIFFICULTY.normal.fireLanes);
    expect(aura(f.boss(), ELEMENT_AURAS.fusion)).toBeUndefined();
  });

  it('the quarter kit holds through the bar (its opener never lands on the combo)', () => {
    const f = finalFight(6);
    f.pullIn('heat');
    quiet(f);
    carry(f, 'hammer', 0.2);
    expect(f.state()?.elements.casting).not.toBeNull();
    // Nothing else is cast through it.
    for (let i = 0; i < sec(E.fusionCast - 0.4); i++) {
      hold(f, 0.05);
      expect(f.boss().castingAbility).toBe(ELEMENT_CASTS.fusion);
    }
  });

  it('every pair lays its combo in the quarter it entered', () => {
    const pairs: [SmithHeartVein, SmithHeartVein, FusionCombo, string][] = [
      ['heat', 'quench', 'steam', ELEMENT_OBJECTS.steamPrefix],
      ['heat', 'hammer', 'magma', ''],
      ['heat', 'breath', 'firestorm', ELEMENT_OBJECTS.firePrefix],
      ['quench', 'breath', 'hail', ELEMENT_OBJECTS.hailPrefix],
      ['quench', 'hammer', 'avalanche', ELEMENT_OBJECTS.avalanchePrefix],
      ['breath', 'hammer', 'spires', ELEMENT_OBJECTS.spirePrefix],
    ];
    for (const [from, to, combo, prefix] of pairs) {
      const f = finalFight(6);
      f.pullIn(to);
      quiet(f);
      const got = fireCombo(scope(f), from, to);
      expect(got, `${from}+${to}`).toBe(combo);
      f.tick(sec(0.7));
      if (combo === 'magma') {
        const marked = f.players.filter((p) => aura(p, ELEMENT_AURAS.magmaMark));
        expect(marked.length).toBe(ELEMENT_DIFFICULTY.normal.magmaMarks);
        continue;
      }
      const objs = f.objects(prefix);
      expect(objs.length, combo).toBeGreaterThan(0);
      for (const o of objs) {
        const p = f.local(o);
        // Lanes stand at their middle and run past the quarter's edge; the
        // rest stand inside it.
        if (combo === 'firestorm' || combo === 'avalanche') continue;
        expect(heartQuarterAt(p.x, p.z), combo).toBe(to);
      }
    }
  });

  it('per tier: more clouds, marks, lanes, stones and spires', () => {
    for (const tier of ['normal', 'heroic', 'mythic'] as const) {
      const R = ELEMENT_DIFFICULTY[tier];
      const f = finalFight(8);
      if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
      f.pullIn('quench');
      quiet(f);
      const s = scope(f);
      fireCombo(s, 'heat', 'quench');
      expect(f.objects(ELEMENT_OBJECTS.steamPrefix).length, tier).toBe(R.steamClouds);
      fireCombo(s, 'breath', 'quench');
      f.tick(1);
      expect(f.objects(ELEMENT_OBJECTS.hailPrefix).length, tier).toBe(R.hailPerWave);
      fireCombo(s, 'hammer', 'quench');
      expect(f.objects(ELEMENT_OBJECTS.avalanchePrefix).length, tier).toBe(R.avalancheLanes);
      fireCombo(s, 'breath', 'hammer');
      expect(f.objects(ELEMENT_OBJECTS.spirePrefix).length, tier).toBe(R.spires);
      fireCombo(s, 'heat', 'breath');
      expect(f.objects(ELEMENT_OBJECTS.firePrefix).length, tier).toBe(R.fireLanes);
      fireCombo(s, 'heat', 'hammer');
      expect(f.players.filter((p) => aura(p, ELEMENT_AURAS.magmaMark)).length, tier).toBe(
        R.magmaMarks,
      );
    }
  });

  it('Scalding Steam scalds a player inside a live cloud, not one outside', () => {
    const f = finalFight(6);
    f.pullIn('quench');
    quiet(f);
    fireCombo(scope(f), 'heat', 'quench');
    f.tick(sec(E.steamWarn + 0.1));
    const cloud = f.objects(ELEMENT_OBJECTS.steamPrefix)[0];
    const inside = f.players[2];
    const outside = f.players[3];
    let ev: SimEvent[] = [];
    for (let i = 0; i < sec(2.2); i++) {
      const c = f.local(cloud);
      f.put(inside, c.x + 0.5, c.z);
      f.put(outside, c.x + E.steamR + 6, c.z);
      ev = ev.concat(f.tick(1));
    }
    expect(hits(ev, ELEMENT_NAMES.steam, inside.id).length).toBeGreaterThanOrEqual(2);
    expect(hits(ev, ELEMENT_NAMES.steam, outside.id).length).toBe(0);
  });

  it('Magma Rift erupts under its marked players and leaves a lava pool for 20 s', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    quiet(f);
    scatter(f);
    fireCombo(scope(f), 'heat', 'hammer');
    const marked = f.players.filter((p) => aura(p, ELEMENT_AURAS.magmaMark));
    const ev = f.tick(sec(E.magmaMarkSeconds + 0.1));
    for (const p of marked) expect(hits(ev, ELEMENT_NAMES.magma, p.id).length).toBe(1);
    expect(f.objects(ELEMENT_OBJECTS.lava).length).toBe(marked.length);
    f.tick(sec(E.lavaLife - 1));
    expect(f.objects(ELEMENT_OBJECTS.lava).length).toBe(marked.length);
    f.tick(sec(1.5));
    expect(f.objects(ELEMENT_OBJECTS.lava).length).toBe(0);
  });

  it('Firestorm: the wall sweeps its lane after the warning; off the lane is safe', () => {
    const f = finalFight(6);
    f.pullIn('breath');
    quiet(f);
    fireCombo(scope(f), 'heat', 'breath');
    const lane = f.objects(ELEMENT_OBJECTS.firePrefix)[0];
    const L = f.state()?.elements.lanes[0];
    if (!L || !lane) throw new Error('no lane');
    const onLane = f.players[2];
    const offLane = f.players[3];
    const mid = { x: L.x + Math.sin(L.facing) * 30, z: L.z + Math.cos(L.facing) * 30 };
    const side = { x: Math.cos(L.facing), z: -Math.sin(L.facing) };
    const keep = () => {
      f.put(onLane, mid.x, mid.z);
      f.put(offLane, mid.x + side.x * (L.half + 4), mid.z + side.z * (L.half + 4));
    };
    let ev: SimEvent[] = [];
    for (let i = 0; i < sec(E.fireWarn - 0.2); i++) {
      keep();
      ev = ev.concat(f.tick(1));
    }
    expect(hits(ev, ELEMENT_NAMES.firestorm).length).toBe(0);
    for (let i = 0; i < sec(E.fireLength / E.fireSpeed + 0.6); i++) {
      keep();
      ev = ev.concat(f.tick(1));
    }
    expect(hits(ev, ELEMENT_NAMES.firestorm, onLane.id).length).toBe(1);
    expect(hits(ev, ELEMENT_NAMES.firestorm, offLane.id).length).toBe(0);
  });

  it('Storm Spires: after the charge, lightning strikes whoever stands between two spires', () => {
    const f = finalFight(6);
    f.pullIn('hammer');
    quiet(f);
    fireCombo(scope(f), 'breath', 'hammer');
    const g = f.state()?.elements.spires[0];
    if (!g) throw new Error('no spires');
    const [A, B] = [g.pts[0], g.pts[1]];
    const between = f.players[2];
    const clear = f.players[3];
    const keep = () => {
      f.put(between, (A.x + B.x) / 2, (A.z + B.z) / 2);
      f.put(clear, HEART_ROOM.x, HEART_ROOM.z);
    };
    let ev: SimEvent[] = [];
    for (let i = 0; i < sec(E.spireCharge - 0.2); i++) {
      keep();
      ev = ev.concat(f.tick(1));
    }
    expect(hits(ev, ELEMENT_NAMES.spire).length).toBe(0);
    for (let i = 0; i < sec(0.5); i++) {
      keep();
      ev = ev.concat(f.tick(1));
    }
    expect(hits(ev, ELEMENT_NAMES.spire, between.id).length).toBe(1);
    expect(hits(ev, ELEMENT_NAMES.spire, clear.id).length).toBe(0);
    f.tick(sec(2));
    expect(f.objects(ELEMENT_OBJECTS.spirePrefix).length).toBe(0);
  });

  it('Mythic: the spires discharge twice; the combos leave a residue on the floor (never on Normal)', () => {
    for (const tier of ['normal', 'mythic'] as const) {
      const f = finalFight(6);
      if (tier === 'mythic') f.dev('/dev heart final mythic');
      f.pullIn('hammer');
      quiet(f);
      fireCombo(scope(f), 'breath', 'hammer');
      let beams = 0;
      for (let i = 0; i < sec(E.spireCharge + E.spireGap + 2); i++)
        for (const e of f.tick(1))
          if (e.type === 'spellfx' && e.ability === 'heart_final_spire_link') beams++;
      const links = spireLinks(ELEMENT_DIFFICULTY[tier].spires).length;
      expect(beams, tier).toBe(links * ELEMENT_DIFFICULTY[tier].spireDischarges);
      const residue = f.objects(ELEMENT_OBJECTS.residuePrefix).length;
      if (tier === 'mythic') expect(residue).toBeGreaterThan(0);
      else expect(residue).toBe(0);
    }
  });

  it('never in an intermission or the final phase: a waiting fusion is dropped', () => {
    const f = finalFight(6);
    f.pullIn('heat');
    quiet(f);
    must(f).elements.pending = { from: 'heat', to: 'hammer' };
    f.dev('/dev heart final inter70');
    f.tick(sec(4));
    expect(f.state()?.phase.stage).not.toBe('fight');
    expect(f.state()?.elements.pending).toBeNull();
    expect(f.state()?.elements.fusions).toBe(0);
    const g = finalFight(6);
    g.pullIn('heat');
    g.dev('/dev heart final last');
    for (let i = 0; i < sec(30) && g.state()?.phase.stage !== 'final'; i++) g.tick(1);
    expect(g.state()?.phase.stage).toBe('final');
    must(g).elements.pending = { from: 'heat', to: 'hammer' };
    g.tick(sec(5));
    expect(g.state()?.elements.fusions).toBe(0);
  });
});

// ---- Opposing Elements ----------------------------------------------------------------

/** A fight with `n` players, the boss's tank players[0] and, when `offTank`,
 *  players[1] carrying Elemental Strike (the other tank), everyone scattered. */
function polarityFight(tier: 'normal' | 'heroic' | 'mythic', n = 10, offTank = true): FinalFight {
  const f = finalFight(n);
  if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
  f.pullIn('heat');
  quiet(f);
  if (offTank) elementalStrike(scope(f), f.players[1], 'heat');
  scatter(f);
  f.tick(1);
  return f;
}

const marked = (f: FinalFight) =>
  f.players.filter((p) => !p.dead && aura(p, ELEMENT_AURAS.polarity));
const polarity = (p: Entity) => polarityOf(aura(p, ELEMENT_AURAS.polarity)?.value);

describe('Opposing Elements', () => {
  it('marks 4 on Normal and EVERY living non-tank on Heroic and Mythic, in opposite pairs', () => {
    // Ten players: the boss's tank and the other tank, eight non-tanks.
    for (const [tier, want] of [
      ['normal', 4],
      ['heroic', 8],
      ['mythic', 8],
    ] as const) {
      const f = polarityFight(tier);
      const marks = startOpposites(scope(f));
      expect(marks.length, tier).toBe(want);
      const ps = marked(f);
      expect(ps.length, tier).toBe(want);
      // Never a tank.
      expect(ps.includes(f.players[0])).toBe(false);
      expect(ps.includes(f.players[1])).toBe(false);
      if (tier !== 'normal')
        for (const p of f.players.slice(2))
          expect(aura(p, ELEMENT_AURAS.polarity), tier).toBeDefined();
      // Each element's count matches its opposite's.
      const count = (p: Polarity) => ps.filter((x) => polarity(x) === p).length;
      expect(count('fire'), tier).toBe(count('ice'));
      expect(count('earth'), tier).toBe(count('lightning'));
      expect(aura(ps[0], ELEMENT_AURAS.polarity)?.duration).toBe(E.polaritySeconds);
    }
  });

  it('an odd number of non-tanks: exactly one is left unmarked (Heroic and Mythic)', () => {
    for (const tier of ['heroic', 'mythic'] as const)
      for (const n of [9, 11, 13]) {
        const f = polarityFight(tier, n);
        const free = n - 2;
        const marks = startOpposites(scope(f));
        expect(marks.length, `${tier} ${n}`).toBe(free - 1);
        expect(
          f.players.slice(2).filter((p) => !aura(p, ELEMENT_AURAS.polarity)).length,
          `${tier} ${n}`,
        ).toBe(1);
        const ps = marked(f);
        const count = (p: Polarity) => ps.filter((x) => polarity(x) === p).length;
        expect(count('fire')).toBe(count('ice'));
        expect(count('earth')).toBe(count('lightning'));
      }
  });

  it('only the living, always an even count: an odd one out is left unmarked', () => {
    const f = polarityFight('mythic');
    // Three non-tanks die: five are left, four are marked, one is not.
    for (const p of f.players.slice(2, 5)) {
      p.hp = 0;
      p.dead = true;
    }
    const marks = startOpposites(scope(f));
    expect(marks.length).toBe(4);
    expect(f.players.slice(5).filter((p) => !aura(p, ELEMENT_AURAS.polarity)).length).toBe(1);
    for (const p of f.players.slice(2, 5)) expect(aura(p, ELEMENT_AURAS.polarity)).toBeUndefined();
    const ps = marked(f);
    const count = (p: Polarity) => ps.filter((x) => polarity(x) === p).length;
    expect(count('fire')).toBe(count('ice'));
    expect(count('earth')).toBe(count('lightning'));
  });

  it("a partner dying mid-round clears the survivor's mark harmlessly (Normal)", () => {
    const f = polarityFight('normal');
    startOpposites(scope(f));
    const ps = marked(f);
    const fire = ps.find((p) => polarity(p) === 'fire') as Entity;
    const ice = ps.find((p) => polarity(p) === 'ice') as Entity;
    fire.hp = 0;
    fire.dead = true;
    let ev = f.tick(2);
    // Ice has no Fire left to find: cleared at once, never a clash or a timeout.
    expect(aura(ice, ELEMENT_AURAS.polarity)).toBeUndefined();
    expect(marked(f).length).toBe(2);
    for (let i = 0; i < sec(E.polaritySeconds); i++) {
      scatter(f);
      ev = ev.concat(f.tick(1));
    }
    expect(hits(ev, ELEMENT_NAMES.unbalanced, ice.id).length).toBe(0);
    expect(hits(ev, ELEMENT_NAMES.clash).length).toBe(0);
  });

  it('with every non-tank marked, a death keeps the survivors who can still pair (Heroic)', () => {
    const f = polarityFight('heroic');
    startOpposites(scope(f));
    const ps = marked(f);
    const fires = ps.filter((p) => polarity(p) === 'fire');
    const ices = ps.filter((p) => polarity(p) === 'ice');
    expect(fires.length).toBe(2);
    expect(ices.length).toBe(2);
    // One Fire dies: both Ices keep theirs (the other Fire is still there).
    fires[0].hp = 0;
    fires[0].dead = true;
    f.tick(2);
    for (const p of ices) expect(aura(p, ELEMENT_AURAS.polarity)).toBeDefined();
    // The other Fire cancels with one Ice: the last Ice is cleared harmlessly.
    f.tick(sec(E.polarityGrace));
    const at = f.local(fires[1]);
    f.put(ices[0], at.x + 1.2, at.z);
    const ev = f.tick(2);
    expect(hits(ev, ELEMENT_NAMES.clash).length).toBe(0);
    expect(aura(ices[0], ELEMENT_AURAS.polarity)).toBeUndefined();
    expect(aura(ices[1], ELEMENT_AURAS.polarity)).toBeUndefined();
    // Earth and Lightning still pair.
    expect(marked(f).length).toBe(4);
  });

  it('two opposites meeting cancel both marks, no harm', () => {
    const f = polarityFight('normal');
    startOpposites(scope(f));
    const ps = marked(f);
    const fire = ps.find((p) => polarity(p) === 'fire') as Entity;
    const ice = ps.find((p) => polarity(p) === 'ice') as Entity;
    const at = f.local(fire);
    f.put(ice, at.x + 1.5, at.z);
    const ev = f.tick(sec(E.polarityGrace + 0.2));
    expect(aura(fire, ELEMENT_AURAS.polarity)).toBeUndefined();
    expect(aura(ice, ELEMENT_AURAS.polarity)).toBeUndefined();
    expect(f.state()?.elements.balanced).toBe(1);
    expect(hits(ev, ELEMENT_NAMES.clash).length).toBe(0);
    expect(
      ev.some((e) => e.type === 'spellfxAt' && e.ability === 'heart_final_polarity_balance'),
    ).toBe(true);
    // The other pair still wears theirs.
    expect(marked(f).length).toBe(2);
  });

  it('a wrong meeting explodes on both (Normal) and on everyone round it (Mythic)', () => {
    for (const tier of ['normal', 'mythic'] as const) {
      const f = polarityFight(tier);
      startOpposites(scope(f));
      const ps = marked(f);
      const fire = ps.find((p) => polarity(p) === 'fire') as Entity;
      const earth = ps.find((p) => polarity(p) === 'earth') as Entity;
      const at = f.local(fire);
      f.put(earth, at.x + 1.5, at.z);
      // A bystander 5 yd off (unmarked: the off-tank).
      const by = f.players[1];
      f.put(by, at.x - 5, at.z);
      const ev = f.tick(sec(E.polarityGrace + 0.2));
      expect(hits(ev, ELEMENT_NAMES.clash, fire.id).length, tier).toBe(1);
      expect(hits(ev, ELEMENT_NAMES.clash, earth.id).length, tier).toBe(1);
      expect(hits(ev, ELEMENT_NAMES.clash, by.id).length, tier).toBe(tier === 'mythic' ? 1 : 0);
      expect(aura(fire, ELEMENT_AURAS.polarity), tier).toBeUndefined();
      expect(aura(earth, ELEMENT_AURAS.polarity), tier).toBeUndefined();
      expect(f.state()?.elements.clashes, tier).toBe(1);
    }
  });

  it('no meeting counts in the first 1.5 s: marked side by side, they step apart first', () => {
    const f = polarityFight('normal');
    startOpposites(scope(f));
    const ps = marked(f);
    const fire = ps.find((p) => polarity(p) === 'fire') as Entity;
    const earth = ps.find((p) => polarity(p) === 'earth') as Entity;
    const at = f.local(fire);
    f.put(earth, at.x + 1.5, at.z);
    const ev = f.tick(sec(E.polarityGrace - 0.2));
    expect(hits(ev, ELEMENT_NAMES.clash).length).toBe(0);
    expect(aura(fire, ELEMENT_AURAS.polarity)).toBeDefined();
    // Apart again before the grace ends: never a clash.
    f.put(earth, at.x + 12, at.z);
    expect(hits(f.tick(sec(1)), ELEMENT_NAMES.clash).length).toBe(0);
  });

  it('a mark left with no possible partner fades quietly', () => {
    const f = polarityFight('normal');
    startOpposites(scope(f));
    const ps = marked(f);
    const fire = ps.find((p) => polarity(p) === 'fire') as Entity;
    const earth = ps.find((p) => polarity(p) === 'earth') as Entity;
    const at = f.local(fire);
    f.put(earth, at.x + 1.5, at.z);
    f.tick(sec(E.polarityGrace + 0.2));
    // Ice and Lightning are left, opposites of nobody left: gone, no timeout.
    expect(marked(f).length).toBe(0);
    const ev = f.tick(sec(E.polaritySeconds + 1));
    expect(hits(ev, ELEMENT_NAMES.unbalanced).length).toBe(0);
  });

  it('uncancelled at 10 s: the marked player alone on Normal, the whole raid on Heroic and Mythic', () => {
    const want = { normal: 'player', heroic: 'raid', mythic: 'raid' } as const;
    const sizes: number[] = [];
    for (const tier of ['normal', 'heroic', 'mythic'] as const) {
      const f = polarityFight(tier);
      startOpposites(scope(f));
      const ps = marked(f);
      let ev: SimEvent[] = [];
      for (let i = 0; i < sec(E.polaritySeconds + 0.3); i++) {
        scatter(f);
        ev = ev.concat(f.tick(1));
      }
      const struck = hits(ev, ELEMENT_NAMES.unbalanced);
      if (want[tier] === 'player') {
        expect(struck.length, tier).toBe(ps.length);
        expect(
          struck.every((h) => ps.some((p) => p.id === h.targetId)),
          tier,
        ).toBe(true);
      } else {
        expect(new Set(struck.map((h) => h.targetId)).size, tier).toBe(f.players.length);
        sizes.push(struck[0].amount);
      }
      expect(marked(f).length, tier).toBe(0);
    }
    // Mythic's hit is the harder.
    expect(sizes[1]).toBeGreaterThan(sizes[0]);
  });

  it('Mythic: one failed pair hurts a healthy raid, two wipe it (real level-20 pools)', () => {
    const run = (failed: number) => {
      const f = polarityFight('mythic');
      startOpposites(scope(f));
      // Real pools: cloth about 1,100, the tanks' plate about 1,740.
      f.players.forEach((p, i) => {
        p.auras = p.auras.filter((a) => a.id !== 'test_final_vigour');
        p.maxHp = i < 2 ? 1742 : 1100;
        p.hp = p.maxHp;
      });
      // Every pair but `failed` cancels.
      const ps = marked(f);
      const used = new Set<number>();
      let cancelled = 0;
      const pairs = ps.length / 2;
      for (const p of ps) {
        if (cancelled >= pairs - failed) break;
        if (used.has(p.id)) continue;
        const opp = ps.find(
          (q) => !used.has(q.id) && q !== p && polaritiesCancel(polarity(p), polarity(q)),
        );
        if (!opp) continue;
        used.add(p.id);
        used.add(opp.id);
        cancelled++;
      }
      f.tick(sec(E.polarityGrace + 0.1));
      // The cancelling pairs meet one by one, far from everyone else.
      const done = [...used];
      for (let k = 0; k < done.length; k += 2) {
        const a = f.players.find((p) => p.id === done[k]) as Entity;
        const b = f.players.find((p) => p.id === done[k + 1]) as Entity;
        const at = spot(50, 30 * k);
        f.put(a, at.x, at.z);
        f.put(b, at.x + 1, at.z);
        f.tick(1);
      }
      for (const p of f.players) if (!used.has(p.id) && !p.dead) p.hp = p.maxHp;
      let ev: SimEvent[] = [];
      for (let i = 0; i < sec(E.polaritySeconds) && marked(f).length > 0; i++) {
        for (const p of f.players) if (!p.dead) p.hp = p.maxHp;
        ev = ev.concat(f.tick(1, false));
      }
      ev = ev.concat(f.tick(1, false));
      return { f, struck: hits(ev, ELEMENT_NAMES.unbalanced) };
    };
    const one = run(1);
    expect(one.struck.length).toBeGreaterThan(0);
    // (The Heat's own kit may strike too: only the timeout's targets are judged.)
    const byId = (f: FinalFight, id: number) => f.players.find((p) => p.id === id) as Entity;
    expect(one.struck.every((h) => !byId(one.f, h.targetId).dead)).toBe(true);
    // It hurts: most of a cloth pool.
    expect(Math.min(...one.struck.map((h) => h.amount))).toBeGreaterThan(1100 * 0.7);
    const two = run(2);
    expect(two.struck.length).toBeGreaterThan(0);
    expect(two.struck.every((h) => byId(two.f, h.targetId).dead)).toBe(true);
    expect(two.f.players.every((p) => p.dead)).toBe(true);
  });

  it('its cadence: first 42 s in, then every 48 s, never while a fusion runs or the Anvil is near', () => {
    expect(E.polarityFirst).toBe(42);
    expect(E.polarityEvery).toBe(48);
    const f = finalFight(10);
    f.pullIn('heat');
    const st = f.state();
    if (!st) throw new Error('no fight');
    for (const v of VEINS) st.stars.clock[v] = 1e9;
    st.anvilClock = 1e9;
    st.elements.polarityClock = 0.1;
    // A combo on the floor holds it.
    fireCombo(scope(f), 'heat', 'quench');
    f.tick(sec(0.5));
    expect(st.elements.rounds).toBe(0);
    // The Anvil near holds it.
    const s = scope(f);
    for (const c of st.elements.steam) c.life = 0.01;
    st.anvilClock = E.polarityAnvilClear - 1;
    f.tick(sec(1));
    expect(st.elements.rounds).toBe(0);
    st.anvilClock = 1e9;
    f.tick(sec(0.5));
    expect(st.elements.rounds).toBe(1);
    void s;
  });

  it('the same seed marks the same players with the same elements', () => {
    const run = () => {
      const f = polarityFight('heroic');
      startOpposites(scope(f));
      return f.players.map((p) => aura(p, ELEMENT_AURAS.polarity)?.value ?? -1);
    };
    expect(run()).toEqual(run());
  });
});

describe('the end', () => {
  it("a wipe's reset clears every mark, stack, combo and footprint", () => {
    const f = polarityFight('mythic');
    const s = scope(f);
    for (let k = 0; k < 3; k++) elementalStrike(s, f.players[0], 'heat');
    startOpposites(s);
    fireCombo(s, 'breath', 'hammer');
    fireCombo(s, 'heat', 'quench');
    f.dev('/dev heart final reset');
    f.tick(1);
    for (const p of f.players) {
      expect(strikeStacks(p).stacks).toBe(0);
      expect(aura(p, ELEMENT_AURAS.polarity)).toBeUndefined();
      expect(aura(p, ELEMENT_AURAS.magmaMark)).toBeUndefined();
    }
    for (const prefix of Object.values(ELEMENT_OBJECTS))
      expect(f.objects(prefix).length, prefix).toBe(0);
  });

  it('the dev verbs: strike, fusion <combo>, opposites', () => {
    const f = polarityFight('normal');
    expect(f.dev('/dev heart final strike 3')).toBe(true);
    expect(strikeStacks(f.players[0]).stacks).toBe(3);
    expect(f.dev('/dev heart final fusion spires now')).toBe(true);
    expect(f.objects(ELEMENT_OBJECTS.spirePrefix).length).toBeGreaterThan(0);
    expect(f.dev('/dev heart final fusion steam')).toBe(true);
    expect(f.state()?.elements.casting).not.toBeNull();
    expect(f.dev('/dev heart final opposites')).toBe(true);
    expect(marked(f).length).toBe(4);
    // Sky Strike keeps its own words.
    expect(f.dev('/dev heart final strike here')).toBe(true);
    void FINAL_DIFFICULTY;
  });
});
