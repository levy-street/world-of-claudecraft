// The Mere Hydra's sixth pass (src/sim/encounters/drowned_temple: mere_hydra.ts,
// hydra_elements.ts, hydra_tsunami.ts, hydra_regrowth.ts): three elemental
// heads whose attacks the survivors inherit, the Tsunami that rolls over one
// half of the pool, and the heads that grow back while another lives.

import { describe, expect, it } from 'vitest';
import { HYDRA_POOL_COLUMNS } from '../src/sim/content/drowned_temple_layout';
import {
  BRINE_SPIT_TEMPLATE,
  elementWielders,
  HYDRA_CENTER_ID,
  HYDRA_CRUSHING_TORRENT,
  HYDRA_FROSTBITE,
  HYDRA_LEFT_ID,
  HYDRA_RIGHT_ID,
  HYDRA_SUBMERGED,
  HYDRA_TIDE_BREATH,
  HYDRA_TSUNAMI,
  HYDRA_TUNING,
  hydraElementOwners,
  inTsunamiLee,
  inTsunamiPath,
  POOL,
  TSUNAMI_TEMPLATES,
  VENOM_POOL_TEMPLATE,
} from '../src/sim/encounters/drowned_temple';
import type { Entity, HydraFightState } from '../src/sim/types';
import {
  aura,
  boss,
  engage,
  type Fight,
  fight,
  local,
  objects,
  put,
  run,
  took,
  until,
} from './helpers/temple_fight';

const T = HYDRA_TUNING;

function hydraFight(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; heads: Entity[] } {
  const f = fight(difficulty);
  const heads = [HYDRA_LEFT_ID, HYDRA_CENTER_ID, HYDRA_RIGHT_ID].map((id) => boss(f, id));
  put(f, f.tank, POOL.x, POOL.z - 2);
  put(f, f.others[0], POOL.x - 12, POOL.z - 12);
  put(f, f.others[1], POOL.x + 12, POOL.z - 12);
  for (const h of heads) engage(f, h);
  return { f, heads };
}

/** The heads' shared fight state (the pull must have ticked once). */
function state(heads: Entity[]): HydraFightState {
  const st = heads.find((h) => h.templeFight?.kind === 'hydra')?.templeFight;
  if (st?.kind !== 'hydra') throw new Error('no hydra fight');
  return st;
}

/** Skip the fight's clocks ahead (the next Tsunami this tick, a fallen head's
 *  regrowth `left` seconds away) instead of simulating the wait. */
function nextTsunami(heads: Entity[]): void {
  state(heads).tsunamiTimer = 0.05;
}
function regrowIn(heads: Entity[], i: number, left: number): void {
  const st = state(heads);
  st.diedAt[i] = (st.diedAt[i] ?? 0) - (T.regrowAfter - left);
}

/** Everyone back at their marks each tick (a shove would scatter the party). */
function hold(f: Fight): () => void {
  return () => {
    put(f, f.tank, POOL.x, POOL.z - 2);
    put(f, f.others[0], POOL.x - 12, POOL.z - 12);
    put(f, f.others[1], POOL.x + 12, POOL.z - 12);
  };
}

describe('the Mere Hydra: one element to each head', () => {
  it('owns each element with its own head, and hands a fallen head’s on round the ring', () => {
    expect(hydraElementOwners([false, false, false])).toEqual([0, 1, 2]);
    // The ice head falls: the venom head takes the ice.
    expect(hydraElementOwners([true, false, false])).toEqual([1, 1, 2]);
    // The water head falls: the ice head takes the water.
    expect(hydraElementOwners([false, false, true])).toEqual([0, 1, 0]);
    // The last head standing wields all three.
    expect(hydraElementOwners([true, true, false])).toEqual([2, 2, 2]);
    expect(hydraElementOwners([true, true, true])).toEqual([null, null, null]);
  });

  it('the ice head breathes, the water head pours its torrent, the venom head spits', () => {
    const { f, heads } = hydraFight();
    const casts = new Map<string, Set<string>>();
    let spat = 0;
    run(f, 13, () => {
      hold(f)();
      for (const h of heads) {
        if (h.castingAbility === null) continue;
        const set = casts.get(h.castingAbility) ?? new Set();
        set.add(h.templateId);
        casts.set(h.castingAbility, set);
      }
      spat = Math.max(spat, objects(f, BRINE_SPIT_TEMPLATE).length);
    });
    expect([...(casts.get(HYDRA_TIDE_BREATH) ?? [])]).toEqual([HYDRA_LEFT_ID]);
    expect([...(casts.get(HYDRA_CRUSHING_TORRENT) ?? [])]).toEqual([HYDRA_RIGHT_ID]);
    expect(spat).toBe(3);
  });

  it('the Freezing Breath chills whoever it catches', () => {
    const { f, heads } = hydraFight();
    const left = heads[0];
    expect(until(f, () => left.castingAbility === HYDRA_TIDE_BREATH, 10, hold(f))).toBe(true);
    const victim = f.sim.ctx.entities.get(left.castTargetId as number) as Entity;
    const at = local(f, victim);
    run(f, T.breathCast + 0.1, () => put(f, victim, at.x, at.z));
    expect(took(f, victim, 'Freezing Breath')).toBeGreaterThanOrEqual(T.breathMin);
    expect(aura(victim, HYDRA_FROSTBITE)?.value).toBeCloseTo(T.chillSlow, 5);
  });

  it('a breathing head that dies mid-bar ends its breath: no bar, no channel, no cone after', () => {
    const { f, heads } = hydraFight();
    const left = heads[0];
    expect(until(f, () => left.castingAbility === HYDRA_TIDE_BREATH, 10, hold(f))).toBe(true);
    run(f, T.breathCast * 0.6, hold(f));
    f.sim.ctx.handleDeath(left, f.tank);
    expect(left.castingAbility).toBeNull();
    expect(left.castRemaining).toBe(0);
    expect(left.channeling).toBe(false);
    let cones = 0;
    for (let t = 0; t < T.breathCast + 2; t += 0.05) {
      hold(f)();
      for (const ev of f.sim.tick())
        if (ev.type === 'spellfx' && ev.sourceId === left.id && ev.ability === HYDRA_TIDE_BREATH)
          cones++;
      expect(left.castingAbility).toBeNull();
    }
    expect(cones).toBe(0);
  });

  it('the Tsunami and a wipe leave no head mid-breath', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    nextTsunami(heads);
    run(f, 0.2, hold(f));
    expect(heads.some((h) => h.castingAbility === HYDRA_TIDE_BREATH)).toBe(false);
    expect(heads.some((h) => h.castingAbility === HYDRA_CRUSHING_TORRENT)).toBe(false);
    const left = heads[0];
    run(f, T.tsunamiCast + 1, hold(f));
    expect(until(f, () => left.castingAbility === HYDRA_TIDE_BREATH, 20, hold(f))).toBe(true);
    for (const p of [f.tank, ...f.others]) put(f, p, 0, -230);
    for (const h of heads) {
      h.inCombat = false;
      h.aggroTargetId = null;
      h.aiState = 'evade';
    }
    run(f, 0.2);
    expect(heads.map((h) => h.castingAbility)).toEqual([null, null, null]);
  });

  it('a Venom Spit bursts, then leaves venom that burns every second', () => {
    const { f } = hydraFight();
    expect(until(f, () => objects(f, BRINE_SPIT_TEMPLATE).length > 0, 8, hold(f))).toBe(true);
    const pool = objects(f, BRINE_SPIT_TEMPLATE)[0];
    const at = local(f, pool);
    const who = [f.tank, ...f.others].reduce((a, b) =>
      Math.hypot(local(f, a).x - at.x, local(f, a).z - at.z) <
      Math.hypot(local(f, b).x - at.x, local(f, b).z - at.z)
        ? a
        : b,
    );
    const from = f.hits.length;
    run(f, T.spitWarn + 3.1, () => put(f, who, at.x, at.z));
    expect(took(f, who, 'Venom Spit', from)).toBeGreaterThanOrEqual(T.spitMin);
    expect(objects(f, VENOM_POOL_TEMPLATE).length).toBeGreaterThan(0);
    // Three seconds in the venom: three burns.
    expect(took(f, who, 'Venom', from)).toBeGreaterThanOrEqual(T.venomPerSecond * 3);
    run(f, T.venomSeconds);
    expect(objects(f, VENOM_POOL_TEMPLATE)).toHaveLength(0);
  });

  it('the Crushing Torrent hits only its locked lane and hurls you down it', () => {
    const { f, heads } = hydraFight();
    const right = heads[2];
    expect(until(f, () => right.castingAbility === HYDRA_CRUSHING_TORRENT, 12, hold(f))).toBe(true);
    const yaw = right.facing;
    const o = local(f, right);
    const inLaneAt = { x: o.x + Math.sin(yaw) * 12, z: o.z + Math.cos(yaw) * 12 };
    const aside = { x: inLaneAt.x + Math.cos(yaw) * 7, z: inLaneAt.z - Math.sin(yaw) * 7 };
    const [a, b] = f.others;
    const from = f.hits.length;
    run(f, T.torrentCast - 0.05, () => {
      put(f, a, inLaneAt.x, inLaneAt.z);
      put(f, b, aside.x, aside.z);
    });
    run(f, 0.1);
    expect(took(f, a, 'Crushing Torrent', from)).toBeGreaterThanOrEqual(T.torrentMin);
    expect(took(f, b, 'Crushing Torrent', from)).toBe(0);
    const now = local(f, a);
    const along = (now.x - inLaneAt.x) * Math.sin(yaw) + (now.z - inLaneAt.z) * Math.cos(yaw);
    expect(along).toBeGreaterThan(T.torrentKnockback * 0.5);
  });

  it('a fallen head’s attack passes to a survivor: the venom head breathes the ice', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    f.sim.ctx.handleDeath(heads[0], f.tank);
    run(f, 0.1, hold(f));
    expect(elementWielders(heads).map((h) => h?.templateId)).toEqual([
      HYDRA_CENTER_ID,
      HYDRA_CENTER_ID,
      HYDRA_RIGHT_ID,
    ]);
    let breathedBy = '';
    run(f, T.breathFirst + 1, () => {
      hold(f)();
      for (const h of heads) if (h.castingAbility === HYDRA_TIDE_BREATH) breathedBy = h.templateId;
    });
    expect(breathedBy).toBe(HYDRA_CENTER_ID);
  });
});

describe('the Mere Hydra: the Tsunami', () => {
  it('reads the pool’s halves and the columns’ lee', () => {
    expect(inTsunamiPath('east', POOL.x + 10, POOL.z)).toBe(true);
    expect(inTsunamiPath('east', POOL.x - 10, POOL.z)).toBe(false);
    expect(inTsunamiPath('west', POOL.x - 10, POOL.z)).toBe(true);
    const east = HYDRA_POOL_COLUMNS.find((c) => c.x > POOL.x) as { x: number; z: number };
    // Behind an east column (toward the west) the wave breaks on it.
    expect(inTsunamiLee('east', east.x - 3, east.z)).toBe(true);
    expect(inTsunamiLee('east', east.x + 3, east.z)).toBe(false);
    expect(inTsunamiLee('east', east.x - 3, east.z + 6)).toBe(false);
  });

  it('sinks the Hydra, then rolls over the east half: caught, sheltered and safe', () => {
    const { f, heads } = hydraFight();
    const east = HYDRA_POOL_COLUMNS.find((c) => c.x > POOL.x) as { x: number; z: number };
    const [a, b] = f.others;
    const spots = (): void => {
      put(f, f.tank, POOL.x + 14, POOL.z - 10); // the east half, in the open
      put(f, a, east.x - 3, east.z); // in a column's lee
      put(f, b, POOL.x - 14, POOL.z - 10); // the dry west half
    };
    run(f, 0.2, spots);
    // Its first wave waits for its beat; skip the wait.
    expect(state(heads).tsunamiTimer).toBeGreaterThan(T.tsunamiFirst - 1);
    nextTsunami(heads);
    expect(until(f, () => heads[1].castingAbility === HYDRA_TSUNAMI, 3, spots)).toBe(true);
    for (const h of heads) expect(aura(h, HYDRA_SUBMERGED)?.value).toBeCloseTo(0.75, 5);
    const wave = objects(f, TSUNAMI_TEMPLATES.warn)[0];
    expect(wave).toBeDefined();
    expect(local(f, wave).x).toBeGreaterThan(POOL.x);
    const from = f.hits.length;
    run(f, T.tsunamiCast + 0.1, spots);
    expect(took(f, f.tank, 'Tsunami', from)).toBeGreaterThanOrEqual(T.tsunamiMin);
    expect(took(f, a, 'Tsunami', from)).toBe(0);
    expect(took(f, b, 'Tsunami', from)).toBe(0);
    expect(objects(f, TSUNAMI_TEMPLATES.warn)).toHaveLength(0);
    expect(objects(f, TSUNAMI_TEMPLATES.surge)).toHaveLength(0);
    for (const h of heads) expect(aura(h, HYDRA_SUBMERGED)).toBeUndefined();
  });

  it('the next wave rises on the west, a full beat later', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    nextTsunami(heads);
    run(f, T.tsunamiCast + 0.5, hold(f));
    expect(state(heads).tsunamiTimer).toBeGreaterThan(T.tsunamiEvery - T.tsunamiCast - 1);
    nextTsunami(heads);
    expect(until(f, () => objects(f, TSUNAMI_TEMPLATES.warn).length > 0, 3, hold(f))).toBe(true);
    expect(local(f, objects(f, TSUNAMI_TEMPLATES.warn)[0]).x).toBeLessThan(POOL.x);
  });

  it('heroic backwash: the wave rolls back over the other half', () => {
    const { f, heads } = hydraFight('heroic');
    run(f, 0.2, hold(f));
    nextTsunami(heads);
    expect(until(f, () => heads[1].castingAbility === HYDRA_TSUNAMI, 3, hold(f))).toBe(true);
    run(f, T.tsunamiCast + 0.1, hold(f));
    const back = objects(f, TSUNAMI_TEMPLATES.warn);
    expect(back).toHaveLength(1);
    expect(local(f, back[0]).x).toBeLessThan(POOL.x);
    const west = f.others[0];
    const from = f.hits.length;
    run(f, T.backwashAfter + 0.1, hold(f));
    expect(took(f, west, 'Tsunami', from)).toBeGreaterThan(0);
  });
});

describe('the Mere Hydra: a fallen head grows back', () => {
  it('grows back 20 s after it fell, at half health, into the same fight', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    f.sim.ctx.handleDeath(heads[2], f.tank);
    run(f, 0.2, hold(f));
    // Fast-forward to a second before the regrowth.
    regrowIn(heads, 2, 1);
    run(f, 0.5, hold(f));
    expect(heads[2].dead).toBe(true);
    run(f, 0.7, hold(f));
    expect(heads[2].dead).toBe(false);
    expect(heads[2].hp).toBe(Math.round(heads[2].maxHp * T.regrowShare));
    expect(heads[2].inCombat).toBe(true);
    expect(heads[2].aggroTargetId).toBe(f.tank.id);
    expect(heads[2].regrown).toBe(true);
  });

  it('a regrown head pays nothing the second time it falls', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    f.sim.ctx.handleDeath(heads[2], f.tank);
    expect(heads[2].lootable || heads[2].loot !== null).toBe(true);
    const first = heads[2].loot;
    run(f, 0.2, hold(f));
    regrowIn(heads, 2, 0);
    run(f, 0.2, hold(f));
    expect(heads[2].dead).toBe(false);
    const xp = f.sim.players.get(f.tank.id)?.xp;
    f.sim.ctx.handleDeath(heads[2], f.tank);
    // No second roll: the head still carries only its FIRST loot, held
    // (unlootable) until the kill hands it back (hydra_regrowth.ts).
    expect(heads[2].loot).toBe(first);
    expect(heads[2].lootable).toBe(false);
    expect(f.sim.players.get(f.tank.id)?.xp).toBe(xp);
    // Nor is its corpse harvestable a second time.
    expect(heads[2].corpseHarvestState).toBeUndefined();
  });

  it('three heads down inside the window end it: nothing grows back', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    const st = state(heads);
    for (const h of heads) {
      f.sim.ctx.handleDeath(h, f.tank);
      run(f, 1, hold(f));
    }
    // The fight is over: no clock is left to grow a head back, however long.
    expect(heads.every((h) => h.templeFight === undefined)).toBe(true);
    for (let i = 0; i < 3; i++) st.diedAt[i] = -1000;
    run(f, 2, hold(f));
    expect(heads.every((h) => h.dead)).toBe(true);
  });

  it('a regrown head and the last one falling: every head stays dead, nothing grows back', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    f.sim.ctx.handleDeath(heads[0], f.tank);
    run(f, 0.2, hold(f));
    regrowIn(heads, 0, 0);
    run(f, 0.2, hold(f));
    expect(heads[0].dead).toBe(false);
    f.sim.ctx.handleDeath(heads[1], f.tank);
    run(f, 1, hold(f));
    f.sim.ctx.handleDeath(heads[2], f.tank);
    run(f, 1, hold(f));
    f.sim.ctx.handleDeath(heads[0], f.tank);
    // Thirty seconds on, tick by tick: no head ever stands again and no
    // regrowth cue fires (the renderer keyed the reappearance on neither).
    let regrowths = 0;
    for (let t = 0; t < 30; t += 0.05) {
      hold(f)();
      for (const ev of f.sim.tick())
        if (ev.type === 'spellfx' && heads.some((h) => h.id === ev.sourceId) && ev.fx === 'nova')
          regrowths++;
      expect(heads.map((h) => h.dead)).toEqual([true, true, true]);
    }
    expect(regrowths).toBe(0);
  });

  it('a wipe grows every fallen head back whole', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    f.sim.ctx.handleDeath(heads[0], f.tank);
    run(f, 0.2);
    for (const p of [f.tank, ...f.others]) put(f, p, 0, -230);
    for (const h of heads) {
      if (h.dead) continue;
      h.inCombat = false;
      h.aggroTargetId = null;
      h.aiState = 'evade';
    }
    run(f, 0.2);
    expect(heads[0].dead).toBe(false);
    expect(heads[0].hp).toBe(heads[0].maxHp);
  });
});
