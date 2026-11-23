// The Mere Hydra's Combined Breath (src/sim/encounters/drowned_temple/
// hydra_combo.ts): between two Tsunamis two heads fuse their elements in a
// fixed order: the Frostlocked Torrent (its Ice Wall shelters from the next
// wave and shatters on it), the Venom Current (the pools slide out down their
// currents) and the Toxic Rime (the pools freeze, then burst).

import { describe, expect, it } from 'vitest';
import {
  HYDRA_CENTER_ID,
  HYDRA_COMBO_TUNING,
  HYDRA_FROSTLOCKED_TORRENT,
  HYDRA_FROZEN,
  HYDRA_LEFT_ID,
  HYDRA_RIGHT_ID,
  HYDRA_TIDE_BREATH,
  HYDRA_TOXIC_RIME,
  HYDRA_TUNING,
  HYDRA_VENOM_CURRENT,
  ICE_WALL_TEMPLATE,
  iceWallDistance,
  iceWallFrom,
  inIceWallLee,
  inTsunamiLee,
  inTsunamiPath,
  POOL,
  RIME_CRYSTAL_TEMPLATE,
  VENOM_CURRENT_TEMPLATE,
  VENOM_POOL_TEMPLATE,
  venomCurrentHeading,
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

const C = HYDRA_COMBO_TUNING;
const T = HYDRA_TUNING;

/** Where the two others stand: together south-east of the heads, so whichever
 *  is the Frostlocked Torrent's victim, its lane runs the same way. */
const SPOT = { x: POOL.x + 8, z: POOL.z - 14 };

function hydraFight(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; heads: Entity[] } {
  const f = fight(difficulty);
  const heads = [HYDRA_LEFT_ID, HYDRA_CENTER_ID, HYDRA_RIGHT_ID].map((id) => boss(f, id));
  hold(f)();
  for (const h of heads) engage(f, h);
  run(f, 0.1, hold(f));
  return { f, heads };
}

function hold(f: Fight): () => void {
  return () => {
    put(f, f.tank, POOL.x, POOL.z - 2);
    put(f, f.others[0], SPOT.x, SPOT.z);
    put(f, f.others[1], SPOT.x, SPOT.z);
  };
}

function state(heads: Entity[]): HydraFightState {
  const st = heads.find((h) => h.templeFight?.kind === 'hydra')?.templeFight;
  if (st?.kind !== 'hydra') throw new Error('no hydra fight');
  return st;
}

/** Bring the fight to a combo slot: `waves` Tsunamis have rolled (so the next
 *  rises on the east when even) and the clock reads the slot. */
function toSlot(heads: Entity[], waves: number, at = C.comboAt[0]): HydraFightState {
  const st = state(heads);
  st.tsunamis = waves;
  st.comboSlot = 0;
  st.tsunamiTimer = at + 0.01;
  // Clear plain bars so the heads are free.
  for (const h of heads) {
    h.castingAbility = null;
    h.castRemaining = 0;
  }
  st.breathTimer = 30;
  st.torrentTimer = 30;
  st.spitTimer = 30;
  return st;
}

function casting(heads: Entity[], castId: string): string[] {
  return heads.filter((h) => h.castingAbility === castId).map((h) => h.templateId);
}

describe('the Combined Breath: two heads, one element pair, a fixed order', () => {
  it('waits for the first Tsunami, then comes round frostlock, current, rime', () => {
    const { f, heads } = hydraFight();
    const st = toSlot(heads, 0);
    run(f, 0.2, hold(f));
    expect(st.combo).toBeNull();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      toSlot(heads, 1 + i * 2);
      run(f, 0.1, hold(f));
      expect(st.combo).not.toBeNull();
      seen.push(st.combo?.kind ?? '');
      run(f, C.comboCast + 0.2, hold(f));
      expect(st.combo).toBeNull();
    }
    expect(seen).toEqual(['frostlock', 'current', 'rime', 'frostlock']);
  });

  it('puts the bar on the heads that wield the two elements', () => {
    const { f, heads } = hydraFight();
    const st = toSlot(heads, 1);
    run(f, 0.1, hold(f));
    expect(casting(heads, HYDRA_FROSTLOCKED_TORRENT).sort()).toEqual(
      [HYDRA_LEFT_ID, HYDRA_RIGHT_ID].sort(),
    );
    run(f, C.comboCast + 0.2, hold(f));
    toSlot(heads, 3);
    run(f, 0.1, hold(f));
    expect(casting(heads, HYDRA_VENOM_CURRENT).sort()).toEqual(
      [HYDRA_CENTER_ID, HYDRA_RIGHT_ID].sort(),
    );
    run(f, C.comboCast + 0.2, hold(f));
    toSlot(heads, 5);
    run(f, 0.1, hold(f));
    expect(casting(heads, HYDRA_TOXIC_RIME).sort()).toEqual(
      [HYDRA_LEFT_ID, HYDRA_CENTER_ID].sort(),
    );
    expect(st.combo?.kind).toBe('rime');
  });

  it('a lone survivor carrying both elements fuses them alone', () => {
    const { f, heads } = hydraFight();
    f.sim.ctx.handleDeath(heads[0], f.tank);
    f.sim.ctx.handleDeath(heads[1], f.tank);
    run(f, 0.1, hold(f));
    toSlot(heads, 1);
    run(f, 0.1, hold(f));
    expect(casting(heads, HYDRA_FROSTLOCKED_TORRENT)).toEqual([HYDRA_RIGHT_ID]);
  });

  it('heroic opens a second slot in the cycle (twice as often)', () => {
    const { f, heads } = hydraFight('heroic');
    const st = toSlot(heads, 1, C.comboAtHeroic[0]);
    run(f, 0.1, hold(f));
    expect(st.combo?.kind).toBe('frostlock');
    run(f, C.comboCast + 0.2, hold(f));
    st.tsunamiTimer = C.comboAtHeroic[1] + 0.01;
    run(f, 0.1, hold(f));
    expect(st.combo?.kind).toBe('current');
    // Normal has the one slot only.
    const n = hydraFight();
    const sn = toSlot(n.heads, 1, C.comboAtHeroic[0]);
    run(n.f, 0.1, hold(n.f));
    expect(sn.combo).toBeNull();
  });

  it('holds the plain breath and torrent while a combo is due', () => {
    const { f, heads } = hydraFight();
    const st = toSlot(heads, 1, C.comboAt[0] + C.comboHold - 0.5);
    st.breathTimer = 0.05;
    run(f, 0.3, hold(f));
    expect(casting(heads, HYDRA_TIDE_BREATH)).toEqual([]);
  });

  it('a slot too close to the wave passes', () => {
    const { f, heads } = hydraFight();
    const st = toSlot(heads, 1);
    st.tsunamiTimer = C.comboLatest - 0.5;
    run(f, 0.1, hold(f));
    expect(st.combo).toBeNull();
    expect(st.comboSlot).toBe(1);
  });
});

describe('Frostlocked Torrent: a frozen lane and an Ice Wall', () => {
  it('freezes whoever stands in the lane (no shove) and leaves the wall standing', () => {
    const { f, heads } = hydraFight();
    const st = toSlot(heads, 2);
    run(f, 0.1, hold(f));
    const before = local(f, f.others[0]);
    run(f, C.comboCast + 0.1, hold(f));
    const victim = f.others.find((p) => took(f, p, 'Frostlocked Torrent') > 0);
    expect(victim).toBeDefined();
    const dealt = took(f, victim as Entity, 'Frostlocked Torrent');
    expect(dealt).toBeGreaterThanOrEqual(C.frostMin);
    expect(dealt).toBeLessThanOrEqual(C.frostMax);
    expect(aura(victim as Entity, HYDRA_FROZEN)?.kind).toBe('stun');
    expect(local(f, f.others[0]).x).toBeCloseTo(before.x, 3);
    const walls = objects(f, ICE_WALL_TEMPLATE);
    expect(walls.length).toBe(1);
    expect(st.iceWall?.remaining).toBeGreaterThan(C.wallSeconds - 0.5);
    expect(walls[0].scale).toBeCloseTo(T.torrentLength - C.wallStart, 5);
  });

  it('the next Tsunami breaks on the wall: its lee is safe, the open water is not', () => {
    const { f, heads } = hydraFight();
    const st = toSlot(heads, 2);
    run(f, C.comboCast + 0.2, hold(f));
    const w = st.iceWall;
    if (!w) throw new Error('no wall');
    // A spot in the wall's lee against the east wave (it rolls west), out of
    // every column's shadow, and a spot in the open east half.
    let lee: { x: number; z: number } | null = null;
    for (let k = 1; k < 8 && !lee; k++) {
      const t = (w.length * k) / 8;
      const x = w.x + Math.sin(w.yaw) * t - 3;
      const z = w.z + Math.cos(w.yaw) * t;
      if (
        inTsunamiPath('east', x, z) &&
        !inTsunamiLee('east', x, z) &&
        inIceWallLee(w, 'east', x, z)
      )
        lee = { x, z };
    }
    if (!lee) throw new Error('no lee spot');
    const open = { x: POOL.x + 14, z: POOL.z + 12 };
    expect(inIceWallLee(w, 'east', open.x, open.z)).toBe(false);
    const sheltered = lee;
    const keep = () => {
      put(f, f.tank, POOL.x - 20, POOL.z);
      put(f, f.others[0], sheltered.x, sheltered.z);
      put(f, f.others[1], open.x, open.z);
    };
    st.tsunamiTimer = 0.05;
    run(f, 0.2, keep);
    expect(st.tsunami?.side).toBe('east');
    const from = f.hits.length;
    run(f, T.tsunamiCast + 0.2, keep);
    expect(took(f, f.others[0], 'Tsunami', from)).toBe(0);
    expect(took(f, f.others[1], 'Tsunami', from)).toBeGreaterThan(0);
    // The wave shattered the wall.
    expect(st.iceWall).toBeNull();
    expect(objects(f, ICE_WALL_TEMPLATE).length).toBe(0);
  });

  it('heroic: the shattering wall cuts anyone hugging it', () => {
    const { f, heads } = hydraFight('heroic');
    const st = toSlot(heads, 2, C.comboAtHeroic[0]);
    run(f, C.comboCast + 0.2, hold(f));
    // No second combo in this cycle: the wave comes straight on.
    st.comboSlot = C.comboAtHeroic.length;
    const w = st.iceWall;
    if (!w) throw new Error('no wall');
    const mid = {
      x: w.x + Math.sin(w.yaw) * (w.length / 2),
      z: w.z + Math.cos(w.yaw) * (w.length / 2),
    };
    expect(iceWallDistance(w, mid.x, mid.z)).toBeLessThan(0.01);
    const keep = () => {
      put(f, f.tank, POOL.x - 20, POOL.z);
      put(f, f.others[0], mid.x, mid.z);
      put(f, f.others[1], POOL.x - 20, POOL.z + 4);
    };
    st.tsunamiTimer = 0.05;
    const from = f.hits.length;
    run(f, T.tsunamiCast + 0.5, keep);
    expect(took(f, f.others[0], 'Ice Shards', from)).toBeGreaterThan(0);
    expect(took(f, f.others[1], 'Ice Shards', from)).toBe(0);
  });

  it('a wall raised in the early heroic slot stands until the next wave lands', () => {
    const { f, heads } = hydraFight('heroic');
    const st = toSlot(heads, 2, C.comboAtHeroic[0]);
    run(f, C.comboCast + 0.2, hold(f));
    const w = st.iceWall;
    if (!w) throw new Error('no wall');
    expect(w.remaining).toBeGreaterThan(C.wallSeconds);
    expect(w.remaining).toBeGreaterThanOrEqual(st.tsunamiTimer + T.tsunamiCast);
    // The normal slot keeps the plain 20 s (its wave lands inside it).
    const n = hydraFight();
    const sn = toSlot(n.heads, 2);
    run(n.f, C.comboCast + 0.2, hold(n.f));
    expect(Math.abs((sn.iceWall?.remaining ?? 0) - C.wallSeconds)).toBeLessThan(0.3);
    expect(sn.tsunamiTimer + T.tsunamiCast).toBeLessThan(sn.iceWall?.remaining ?? 0);
  });

  it('melts after its time with no wave in flight', () => {
    const { f, heads } = hydraFight();
    const st = toSlot(heads, 2);
    run(f, C.comboCast + 0.2, hold(f));
    if (!st.iceWall) throw new Error('no wall');
    st.iceWall.remaining = 0.05;
    st.tsunamiTimer = 99;
    run(f, 0.2, hold(f));
    expect(st.iceWall).toBeNull();
  });

  it('the lee is the wall line seen back up the wave', () => {
    const w = iceWallFrom(0, 0, 0); // a wall running north (+z) from (0, 3)
    // The east wave rolls west (-x): a spot just west of the wall is in its lee.
    expect(inIceWallLee(w, 'east', -2, 10)).toBe(true);
    expect(inIceWallLee(w, 'east', 2, 10)).toBe(false);
    expect(inIceWallLee(w, 'east', -C.wallLeeDepth - 1, 10)).toBe(false);
    expect(inIceWallLee(w, 'west', 2, 10)).toBe(true);
    // Past the wall's end there is no lee.
    expect(inIceWallLee(w, 'east', -2, T.torrentLength + 2)).toBe(false);
  });
});

describe('Venom Current and Toxic Rime: the venom pools, transformed', () => {
  it('Venom Current seeds the pools, then slides them out down their currents', () => {
    const { f, heads } = hydraFight();
    const st = toSlot(heads, 3);
    // The combo order: frostlock first.
    st.combos = 1;
    run(f, 0.1, hold(f));
    expect(st.combo?.kind).toBe('current');
    // The seeded venom, just before the current takes it.
    run(f, C.comboCast - 0.2, hold(f));
    expect(st.venom.length).toBeGreaterThan(0);
    const start = { x: st.venom[0].x, z: st.venom[0].z };
    run(f, 0.25, hold(f));
    const currents = objects(f, VENOM_CURRENT_TEMPLATE);
    expect(currents.length).toBeGreaterThan(0);
    expect(objects(f, VENOM_POOL_TEMPLATE).length).toBe(0);
    const c0 = st.currents[0];
    const heading = venomCurrentHeading(start.x, start.z);
    expect(c0.yaw).toBeCloseTo(heading, 6);
    run(f, C.currentSlideSeconds, hold(f));
    const moved = Math.hypot(c0.x - start.x, c0.z - start.z);
    expect(moved).toBeCloseTo(C.currentSlide, 1);
    // It slid straight out along its arrow.
    expect(Math.atan2(c0.x - start.x, c0.z - start.z)).toBeCloseTo(heading, 3);
    expect(currents[0].scale).toBeCloseTo(C.currentRadius, 5);
    run(f, C.currentLinger + 0.2, hold(f));
    expect(objects(f, VENOM_CURRENT_TEMPLATE).length).toBe(0);
  });

  it('a body in a sliding pool burns', () => {
    const { f, heads } = hydraFight();
    const st = toSlot(heads, 3);
    st.combos = 1;
    run(f, C.comboCast + 0.1, hold(f));
    const from = f.hits.length;
    run(f, 1.1, hold(f));
    const burnt = f.others.some((p) => took(f, p, 'Venom Current', from) > 0);
    expect(burnt).toBe(true);
  });

  it('Toxic Rime freezes the pools to walkable crystals, then they burst wider', () => {
    const { f, heads } = hydraFight();
    const st = toSlot(heads, 5);
    st.combos = 2;
    run(f, 0.1, hold(f));
    expect(st.combo?.kind).toBe('rime');
    run(f, C.comboCast + 0.05, hold(f));
    expect(objects(f, RIME_CRYSTAL_TEMPLATE).length).toBeGreaterThan(0);
    expect(objects(f, VENOM_POOL_TEMPLATE).length).toBe(0);
    const from = f.hits.length;
    run(f, C.rimeSeconds - 0.3, hold(f));
    // Standing on a crystal: no venom burn while it is frozen.
    expect(f.others.some((p) => took(f, p, 'Venom', from) > 0)).toBe(false);
    expect(f.others.some((p) => took(f, p, 'Toxic Rime', from) > 0)).toBe(false);
    run(f, 0.5, hold(f));
    const burst = took(f, f.others[0], 'Toxic Rime', from);
    expect(burst).toBeGreaterThanOrEqual(C.rimeMin);
    expect(objects(f, RIME_CRYSTAL_TEMPLATE).length).toBe(0);
  });

  it('a reset drains the wall, the currents and the crystals', () => {
    const { f, heads } = hydraFight();
    toSlot(heads, 2);
    run(f, C.comboCast + 0.2, hold(f));
    expect(objects(f, ICE_WALL_TEMPLATE).length).toBe(1);
    for (const p of [f.tank, ...f.others]) put(f, p, 0, -230);
    for (const h of heads) {
      h.inCombat = false;
      h.aggroTargetId = null;
      h.aiState = 'evade';
    }
    run(f, 0.2);
    expect(objects(f, ICE_WALL_TEMPLATE).length).toBe(0);
  });

  it('a reset also drains the sliding currents and thaws the frozen', () => {
    const { f, heads } = hydraFight();
    const st = toSlot(heads, 3);
    st.combos = 1;
    run(f, C.comboCast + 0.2, hold(f));
    expect(objects(f, VENOM_CURRENT_TEMPLATE).length).toBeGreaterThan(0);
    f.sim.ctx.applyAura(f.others[0], {
      id: HYDRA_FROZEN,
      name: 'Frozen',
      kind: 'stun',
      remaining: 2,
      duration: 2,
      value: 0,
      sourceId: heads[2].id,
      school: 'frost',
    });
    for (const p of [f.tank, ...f.others]) put(f, p, 0, -230);
    for (const h of heads) {
      h.inCombat = false;
      h.aggroTargetId = null;
      h.aiState = 'evade';
    }
    run(f, 0.2);
    expect(objects(f, VENOM_CURRENT_TEMPLATE).length).toBe(0);
    expect(objects(f, RIME_CRYSTAL_TEMPLATE).length).toBe(0);
    expect(aura(f.others[0], HYDRA_FROZEN)).toBeUndefined();
  });

  it('replays the same combo by seed', () => {
    const a = hydraFight();
    const b = hydraFight();
    toSlot(a.heads, 2);
    toSlot(b.heads, 2);
    run(a.f, 0.1, hold(a.f));
    run(b.f, 0.1, hold(b.f));
    expect(state(a.heads).combo?.yaw).toBeCloseTo(state(b.heads).combo?.yaw ?? NaN, 9);
    expect(until(a.f, () => state(a.heads).iceWall !== null, 3, hold(a.f))).toBe(true);
  });
});
