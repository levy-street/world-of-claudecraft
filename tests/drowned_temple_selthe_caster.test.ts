// Choirmother Selthe's caster pass (src/sim/encounters/drowned_temple/selthe.ts):
// she never leaves her pool and never swings her hands. Moonwater Bolt is her
// filler on the tank and can be kicked; the Drowning Aria is a sung beam that a
// kick, a lost line of sight or a body stepping into it answers; the Mere Surge
// is a wedge of water to step out of. Driven through full Sim ticks in a real
// claimed Temple with a real party (tests/helpers/temple_fight.ts).

import { describe, expect, it } from 'vitest';
import { DROWNED_TEMPLE_ANCHORS } from '../src/sim/content/drowned_temple_layout';
import {
  COLOSSUS_ID,
  SELTHE_DROWNING_ARIA,
  SELTHE_ID,
  SELTHE_MERE_SURGE,
  SELTHE_MOONWATER_BOLT,
  SELTHE_TUNING,
  TEMPLE_BOSS_CAST_SCHOOLS,
  TERRACE,
} from '../src/sim/encounters/drowned_temple';
import { ariaCatcher, startAria, startSurge } from '../src/sim/encounters/drowned_temple/selthe';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { angleTo, type Entity, type SeltheFightState } from '../src/sim/types';
import {
  boss,
  engage,
  type Fight,
  fight,
  local,
  put,
  run,
  took,
  until,
} from './helpers/temple_fight';

const T = SELTHE_TUNING;
const COURT = DROWNED_TEMPLE_ANCHORS.court;

function selthe(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; b: Entity } {
  const f = fight(difficulty);
  const b = boss(f, SELTHE_ID);
  put(f, f.tank, COURT.x, COURT.z + 6);
  put(f, f.others[0], COURT.x - 10, COURT.z - 6);
  put(f, f.others[1], COURT.x + 10, COURT.z - 6);
  engage(f, b);
  return { f, b };
}

function state(b: Entity): SeltheFightState {
  const st = b.templeFight;
  if (st?.kind !== 'selthe') throw new Error('no selthe fight');
  return st;
}

/** Hold every timed mechanic off so a test reads one bar in isolation (the
 *  fight state is born on the first engaged tick, which starts a bolt). */
function hush(f: Fight, b: Entity): void {
  if (b.templeFight?.kind !== 'selthe') run(f, 0.05);
  const st = state(b);
  st.chorusTimer = 999;
  st.soloTimer = 999;
  st.songTimer = 999;
  st.surgeTimer = 999;
  st.ariaTimer = 999;
}

/** Pummel her (the warrior tank's real interrupt), the tank in her reach. */
function pummel(f: Fight, b: Entity): void {
  put(f, f.tank, local(f, b).x, local(f, b).z - 3);
  f.tank.targetId = b.id;
  f.sim.castAbility('pummel', f.tank.id);
}

describe('Selthe the caster: no hands, no steps', () => {
  it('never swings her hands and never leaves her pool, even with the tank far off', () => {
    const { f, b } = selthe();
    const home = { ...b.pos };
    // The tank stands far down the court: she must not walk to him.
    run(f, 24, () => put(f, f.tank, COURT.x, COURT.z - 18));
    const swings = f.hits.filter((h) => h.sourceId === b.id && h.ability === null);
    expect(swings).toHaveLength(0);
    expect(b.pos.x).toBeCloseTo(home.x, 6);
    expect(b.pos.z).toBeCloseTo(home.z, 6);
    // She fought with water instead: bolts on the tank.
    expect(took(f, f.tank, 'Moonwater Bolt')).toBeGreaterThan(0);
    // A long fight with the tank far off: about 13 s alone, near the default.
  }, 60_000);

  it('bolts her foe between bars: one weapon roll x 0.8 of frost on each 2 s bar', () => {
    const { f, b } = selthe();
    hush(f, b);
    expect(b.castingAbility).toBe(SELTHE_MOONWATER_BOLT);
    expect(b.castTargetId).toBe(f.tank.id);
    expect(b.castTotal).toBe(T.boltCast);
    const from = f.hits.length;
    run(f, T.boltCast + 0.1);
    const bolts = f.hits.slice(from).filter((h) => h.ability === 'Moonwater Bolt');
    expect(bolts).toHaveLength(1);
    expect(bolts[0].targetId).toBe(f.tank.id);
    expect(bolts[0].amount).toBeGreaterThanOrEqual(
      Math.round(b.weapon.min * T.boltWeaponShare) - 1,
    );
    expect(bolts[0].amount).toBeLessThanOrEqual(Math.round(b.weapon.max * T.boltWeaponShare) + 1);
  });

  it('a kick cuts the bolt: no damage lands, and she falls quiet for 3 s', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[SELTHE_MOONWATER_BOLT]?.school).toBe('frost');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[SELTHE_DROWNING_ARIA]?.school).toBe('frost');
    expect(TEMPLE_BOSS_CAST_SCHOOLS[SELTHE_MERE_SURGE]).toBeUndefined();
    const { f, b } = selthe();
    hush(f, b);
    run(f, 0.5);
    expect(b.castingAbility).toBe(SELTHE_MOONWATER_BOLT);
    const from = f.hits.length;
    pummel(f, b);
    run(f, 0.05);
    expect(b.castingAbility).toBeNull();
    // Nothing more for the hush: no bolt lands, no new bar starts.
    run(f, T.kickQuiet - 0.2);
    expect(f.hits.slice(from).filter((h) => h.ability === 'Moonwater Bolt')).toHaveLength(0);
    expect(b.castingAbility).not.toBe(SELTHE_MOONWATER_BOLT);
    // Then she bolts again.
    expect(until(f, () => b.castingAbility === SELTHE_MOONWATER_BOLT, 6)).toBe(true);
  });
});

describe('the Drowning Aria: kick it, break its sight, or step into it', () => {
  function aria(): { f: Fight; b: Entity; target: Entity } {
    const { f, b } = selthe();
    hush(f, b);
    // Cut the opening bolt quietly (not a kick) so the aria starts clean.
    b.castingAbility = null;
    b.castRemaining = 0;
    state(b).kickable = null;
    expect(startAria(f.sim.ctx, f.inst, b, state(b))).toBe(true);
    const target = f.sim.ctx.entities.get(b.castTargetId ?? -1) as Entity;
    return { f, b, target };
  }

  it('sings at someone other than the tank and climbs 30, 40, 50, 60, 70 on the same body', () => {
    const { f, b, target } = aria();
    expect(target.id).not.toBe(f.tank.id);
    expect(b.channeling).toBe(true);
    const from = f.hits.length;
    run(f, T.ariaChannel + 0.1);
    const pulses = f.hits
      .slice(from)
      .filter((h) => h.ability === 'Drowning Aria')
      .map((h) => h.amount);
    expect(pulses).toEqual([30, 40, 50, 60, 70]);
    expect(b.castingAbility).not.toBe(SELTHE_DROWNING_ARIA);
  });

  it('a kick breaks it at once: no further pulse lands', () => {
    const { f, b, target } = aria();
    run(f, 2.05);
    expect(took(f, target, 'Drowning Aria')).toBe(30 + 40);
    const from = f.hits.length;
    pummel(f, b);
    run(f, 3);
    expect(f.hits.slice(from).filter((h) => h.ability === 'Drowning Aria')).toHaveLength(0);
    expect(state(b).aria).toBeNull();
  });

  it('a body stepping into the beam catches the pulse, and the climb starts over on it', () => {
    const { f, b, target } = aria();
    run(f, 2.05);
    // The other caster steps onto the line halfway between her and the target.
    const catcher = [f.tank, ...f.others].find((p) => p !== target && p !== f.tank) as Entity;
    const bt = local(f, b);
    const tt = local(f, target);
    const mid = { x: (bt.x + tt.x) / 2, z: (bt.z + tt.z) / 2 };
    const before = took(f, target, 'Drowning Aria');
    const from = f.hits.length;
    let beamOn = -1;
    run(f, 3, () => {
      put(f, catcher, mid.x, mid.z);
      put(f, f.tank, bt.x + 6, bt.z + 6);
      if (b.castingAbility === SELTHE_DROWNING_ARIA) beamOn = b.castTargetId ?? -1;
    });
    const caught = f.hits.slice(from).filter((h) => h.ability === 'Drowning Aria');
    expect(caught.map((h) => h.targetId)).toEqual([catcher.id, catcher.id, catcher.id]);
    // The climb restarted on the catcher.
    expect(caught.map((h) => h.amount)).toEqual([30, 40, 50]);
    expect(took(f, target, 'Drowning Aria')).toBe(before);
    // The beam bends to the catcher (the renderer draws it there).
    expect(beamOn).toBe(catcher.id);
  });

  it('breaks when its target gets out of her sight or reach', () => {
    const { f, b, target } = aria();
    run(f, 1.05);
    const from = f.hits.length;
    // Out of her reach (45 yd) down the Choir Stair.
    run(f, 2, () => put(f, target, COURT.x, COURT.z - 60));
    expect(f.hits.slice(from).filter((h) => h.ability === 'Drowning Aria')).toHaveLength(0);
    expect(state(b).aria).toBeNull();
    expect(b.castingAbility).not.toBe(SELTHE_DROWNING_ARIA);
  });

  it('breaks when its target hides behind a lamp pillar (line of sight)', () => {
    const { f, b, target } = aria();
    run(f, 1.05);
    expect(took(f, target, 'Drowning Aria')).toBe(30);
    // Behind the east lamp pillar (12, 18) as she sees it from her pool.
    const bt = local(f, b);
    const dx = 12 - bt.x;
    const dz = 18 - bt.z;
    const k = 16 / Math.hypot(dx, dz);
    const from = f.hits.length;
    run(f, 2, () => put(f, target, bt.x + dx * k, bt.z + dz * k));
    expect(f.sim.ctx.hasLineOfSight(b, target)).toBe(false);
    expect(f.hits.slice(from).filter((h) => h.ability === 'Drowning Aria')).toHaveLength(0);
    expect(state(b).aria).toBeNull();
  });

  it('the catch is the FIRST body on the line, never one behind the target or off it', () => {
    const at = (id: number, x: number, z: number) => ({ id, pos: { x, y: 0, z }, dead: false });
    const target = at(1, 0, 20);
    const near = at(2, 0.5, 8);
    const nearer = at(3, -1, 4);
    const behind = at(4, 0, 25);
    const wide = at(5, 3, 10);
    const from = { x: 0, y: 0, z: 0 };
    expect(ariaCatcher(from, target, [near, nearer, behind, wide], 1.5).id).toBe(3);
    expect(ariaCatcher(from, target, [behind, wide], 1.5).id).toBe(1);
    expect(ariaCatcher(from, target, [{ ...nearer, dead: true }, near], 1.5).id).toBe(2);
  });
});

describe('the Mere Surge: step out of the wedge', () => {
  it('hits and shoves everyone in the 60 degree wedge she aimed, nobody outside it', () => {
    const { f, b } = selthe();
    hush(f, b);
    b.castingAbility = null;
    b.castRemaining = 0;
    state(b).kickable = null;
    const st = state(b);
    expect(startSurge(f.sim.ctx, f.inst, b, st)).toBe(true);
    const yaw = st.surgeYaw as number;
    const victim = f.sim.ctx.entities.get(b.castTargetId ?? -1) as Entity;
    expect(angleTo(b.pos, victim.pos)).toBeCloseTo(yaw, 6);
    // Someone else stands out at 90 degrees off the aim.
    const bt = local(f, b);
    const safe = [f.tank, ...f.others].find((p) => p !== victim) as Entity;
    const side = yaw + Math.PI / 2;
    const victimAt = local(f, victim);
    run(f, T.surgeCast - 0.3, () => {
      put(f, victim, victimAt.x, victimAt.z);
      put(f, safe, bt.x + Math.sin(side) * 10, bt.z + Math.cos(side) * 10);
    });
    const from = f.hits.length;
    const before = local(f, victim);
    run(f, 0.4);
    const surge = f.hits.slice(from).filter((h) => h.ability === 'Mere Surge');
    expect(surge.map((h) => h.targetId)).toContain(victim.id);
    expect(surge.map((h) => h.targetId)).not.toContain(safe.id);
    for (const h of surge) {
      expect(h.amount).toBeGreaterThanOrEqual(T.surgeMin);
      expect(h.amount).toBeLessThanOrEqual(T.surgeMax);
    }
    // Shoved away from her.
    const after = local(f, victim);
    expect(Math.hypot(after.x - bt.x, after.z - bt.z)).toBeGreaterThan(
      Math.hypot(before.x - bt.x, before.z - bt.z) + 3,
    );
  });

  it('the surge and the aria both come within 18 s, and the old hand slap never does', () => {
    const { f, b } = selthe();
    const seen = new Set<string>();
    run(f, 18, () => {
      if (b.castingAbility) seen.add(b.castingAbility);
    });
    expect(seen.has(SELTHE_MERE_SURGE)).toBe(true);
    expect(seen.has(SELTHE_DROWNING_ARIA)).toBe(true);
    expect(seen.has('temple_tidal_slap')).toBe(false);
  });
});

describe('one seed, one fight: the caster kit and the fracture replay exactly', () => {
  /** A full Selthe pull with a kick, then a Colossus fracture, from a fresh Sim. */
  function trace(): string[] {
    const { f, b } = selthe();
    run(f, 7);
    pummel(f, b);
    run(f, 17);
    const col = boss(f, COLOSSUS_ID);
    put(f, f.tank, TERRACE.x - 6, TERRACE.z);
    put(f, f.others[0], TERRACE.x + 9, TERRACE.z + 4);
    put(f, f.others[1], TERRACE.x - 3, TERRACE.z - 11);
    engage(f, col);
    run(f, 0.05);
    const st = col.templeFight;
    if (st?.kind !== 'colossus') throw new Error('no colossus fight');
    st.fractureTimer = 0;
    run(f, 10);
    return f.hits.map((h) => `${h.sourceId}>${h.targetId}:${h.ability}:${h.amount}`);
  }

  it('two runs from the same seed land the same hits in the same order', () => {
    const a = trace();
    expect(a.some((h) => h.includes('Moonwater Bolt'))).toBe(true);
    expect(a.some((h) => h.includes('Tideglass Fracture'))).toBe(true);
    expect(trace()).toEqual(a);
    // Two full fights back to back: about 23 s alone on a slow machine, past
    // the 20 s default, and over 30 s while a full suite shares the cores.
  }, 120_000);
});
