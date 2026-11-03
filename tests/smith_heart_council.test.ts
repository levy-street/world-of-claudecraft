// The Hammer Council (src/sim/encounters/smith_heart/council*.ts) over a REAL
// Sim claim of the Smith's Heart: one pull for both members, the pillars
// (rising at the marked spot, cover from Mountain's Wrath and then shattered
// by it, cracked by the Falling Rock, falling into rubble, standing whole again
// on a wipe), the soak's split, Resonance's spread, both kill orders, the
// heroic pulse and overlap, the Slab and the seal waiting on both, and
// determinism. Mountain's Rush, the cursed pillar, Bond of the Stone and the
// pillar supply: tests/smith_heart_council_rush.test.ts.

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_COUNCIL, SMITH_HEART_GATES } from '../src/sim/content/smith_heart';
import {
  HAMMER_PIT,
  QUARRY_PILLAR_H,
  QUARRY_PILLAR_R,
  QUARRY_PILLAR_SPOTS,
} from '../src/sim/content/smith_heart_layout';
import { DUNGEONS } from '../src/sim/data';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_NAMES,
  type CouncilFightState,
  councilPillarFull,
  councilPillarOf,
  councilPillarTemplate,
  fallingRockShare,
  nearestRiseSpot,
  smithHeartProgress,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { COMBAT_WALL_SHAPES, combatWallsAt } from '../src/sim/instances/combat_wall_state';
import { dungeonGateState } from '../src/sim/instances/dungeon_gates';
import type { Entity, SimEvent } from '../src/sim/types';
import { type CouncilFight, councilFight, hitsOf } from './helpers/council_fight';

/** Park every council clock so one mechanic can be watched alone. */
function quiet(st: CouncilFightState): void {
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.rushTimer = 999;
  st.songDue = null;
  st.energy = 0;
}

/** Pull the council onto the first raider and park its clocks. */
function pulled(n = 6, seed = 17): CouncilFight & { st: CouncilFightState } {
  const f = councilFight(n, seed);
  f.dev('/dev heart council pull');
  f.tick();
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  quiet(st);
  return { ...f, st };
}

/** Stand a council member still at instance-local (x, z). */
function plant(f: CouncilFight, e: Entity, x: number, z: number): void {
  const w = f.world(x, z);
  e.pos.x = w.x;
  e.pos.z = w.z;
  e.pos.y = f.sim.ctx.groundPos(w.x, w.z).y;
  e.prevPos = { ...e.pos };
  f.sim.ctx.rebucket(e);
}

const MID = { x: HAMMER_PIT.x, z: HAMMER_PIT.z };

/** The claim's round walls in the Quarry (the Frozen Lake's sunk blades
 *  stand as walls of the same slot, far to the east). */
function quarryCircles(o: { x: number; z: number }) {
  return combatWallsAt(o.x, o.z).filter(
    (w) => w.type === 'circle' && Math.hypot(w.x - MID.x, w.z - MID.z) < 60,
  );
}

const warned = (ev: readonly SimEvent[], key: string) =>
  ev.some(
    (e) =>
      e.type === 'chat' && (e as { textKey?: string }).textKey === `hudChrome.council.warn.${key}`,
  );

describe('Hammer Council: one pull, two members', () => {
  it('the council is the Guardian and the Seam Singer: no Slabwright anywhere', () => {
    expect([...SMITH_HEART_COUNCIL]).toEqual(['heart_hammer_guardian', 'heart_seam_singer']);
    const spawned = DUNGEONS.smith_heart.spawns.map((s) => s.mobId);
    expect(spawned).not.toContain('heart_slabwright');
    expect(spawned).not.toContain('heart_stone_prison');
  });

  it('pulling one wakes both, and nothing else in the raid', () => {
    const f = councilFight(2);
    const b = f.bodies();
    f.sim.ctx.aggroMob(b.singer as Entity, f.players[0], false);
    f.tick(10);
    for (const r of ['guardian', 'singer'] as const) {
      expect(['chase', 'attack'], r).toContain(b[r]?.aiState);
    }
    const st = f.state();
    expect(st?.kind).toBe('council');
    // One shared state.
    expect(b.guardian?.smithHeartFight).toBe(b.singer?.smithHeartFight);
    const awake = [...f.sim.ctx.entities.values()].filter(
      (e) =>
        e.kind === 'mob' &&
        !e.dead &&
        e.aiState !== 'idle' &&
        !SMITH_HEART_COUNCIL.includes(e.templateId) &&
        Math.abs(e.pos.x - f.world(0, 0).x) < 300,
    );
    expect(awake.map((e) => e.templateId)).toEqual([]);
  });

  it("the energy bar is the Wrath holder's resource", () => {
    const f = pulled();
    f.st.energy = 40;
    f.tick();
    const b = f.bodies();
    expect(b.guardian?.resourceType).toBe('energy');
    expect(b.guardian?.maxResource).toBe(100);
    expect(b.guardian?.resource).toBeGreaterThanOrEqual(40);
    expect(b.singer?.resource).toBe(0);
    // Full in about 55 s from empty.
    f.st.energy = 0;
    f.tick(20 * 27);
    expect(f.st.energy).toBeGreaterThan(45);
    expect(f.st.energy).toBeLessThan(55);
  });
});

describe('Hammer Council: the pillars', () => {
  it("the five columns stand as round combat walls of the layout's size", () => {
    const f = councilFight(1);
    const pillars = f.pillars();
    expect(pillars.length).toBe(5);
    for (const p of pillars)
      expect(p.e.templateId).toBe(councilPillarTemplate(councilPillarFull(false), false));
    const shape = COMBAT_WALL_SHAPES[councilPillarTemplate(councilPillarFull(false), false)];
    expect(shape.hw).toBe(QUARRY_PILLAR_R);
    expect(shape.height).toBe(QUARRY_PILLAR_H);
    expect(shape.round).toBe(true);
    const o = f.world(0, 0);
    expect(quarryCircles(o).length).toBe(5);
  });

  it("Wake the Stone is the Seam Singer's: two marks on normal, a pillar where each stands", () => {
    const f = pulled(4);
    const [tank, a, bp, c] = f.players;
    f.put(tank, MID.x + 4, MID.z);
    f.put(a, MID.x - 12, MID.z + 8);
    f.put(bp, MID.x - 6, MID.z - 14);
    f.put(c, MID.x + 14, MID.z + 10);
    expect(f.dev('/dev heart council wake')).toBe(true);
    expect(f.bodies().singer?.castingAbility).toBe(COUNCIL_CASTS.wake);
    f.tick(Math.ceil((T.wakeCast + 0.2) * 20));
    const marked = f.st.wakeMarks.map((m) => m.playerId);
    expect(marked.length).toBe(2);
    // Never a council member's tank.
    for (const r of ['guardian', 'singer'] as const) {
      const foe = f.bodies()[r]?.aggroTargetId;
      if (foe !== null && foe !== undefined) expect(marked).not.toContain(foe);
    }
    const spots = marked.map((id) => {
      const p = f.sim.ctx.entities.get(id) as Entity;
      expect(p.auras.some((x) => x.id === COUNCIL_AURAS.wakeMark)).toBe(true);
      return f.local(p);
    });
    const before = f.pillars().length;
    const ev = f.tick(Math.ceil(T.wakeMarkSeconds * 20) + 2);
    const risen = f.pillars().filter((p) => p.risen);
    expect(f.pillars().length).toBe(before + 2);
    for (const s of spots) {
      const near = risen.some((p) => {
        const at = f.local(p.e);
        return Math.hypot(at.x - s.x, at.z - s.z) < T.riseGap;
      });
      expect(near).toBe(true);
    }
    // The marked were standing on it: thrown back and hit.
    expect(hitsOf(ev, COUNCIL_NAMES.wake).length).toBeGreaterThanOrEqual(2);
  });

  it('a kicked Wake the Stone raises nothing, and the raid is told', () => {
    const f = pulled(4);
    const before = f.pillars().length;
    expect(f.dev('/dev heart council wake')).toBe(true);
    const c = f.bodies().singer as Entity;
    f.tick(10);
    f.sim.ctx.cancelCast(c);
    const ev = f.tick(2);
    expect(warned(ev, 'wakeKicked')).toBe(true);
    const more = f.tick(20 * (T.wakeMarkSeconds + 2));
    expect(f.st.wakeMarks.length).toBe(0);
    expect(f.pillars().length).toBe(before);
    expect(hitsOf(more, COUNCIL_NAMES.wake).length).toBe(0);
  });

  it('a rise never stands on another pillar, off the floor, or past the cap', () => {
    const pillars = QUARRY_PILLAR_SPOTS.map((s) => ({ x: s.x, z: s.z }));
    const s0 = QUARRY_PILLAR_SPOTS[0];
    const spot = nearestRiseSpot(pillars, [], s0.x + 1, s0.z);
    expect(spot).not.toBeNull();
    if (spot) expect(Math.hypot(spot.x - s0.x, spot.z - s0.z)).toBeGreaterThanOrEqual(T.riseGap);
    expect(nearestRiseSpot(pillars, [], MID.x + 200, MID.z)).toBeNull();
  });

  it("Mountain's Wrath spares the hidden, strikes the exposed, then shatters EVERY pillar", () => {
    const f = pulled(3);
    const [tank, hidden, exposed] = f.players;
    const g = f.bodies().guardian as Entity;
    plant(f, g, MID.x, MID.z);
    const col = QUARRY_PILLAR_SPOTS[0];
    const dx = (col.x - MID.x) / 24;
    const dz = (col.z - MID.z) / 24;
    f.put(hidden, MID.x + dx * 30, MID.z + dz * 30);
    f.put(exposed, MID.x - 15, MID.z + 2);
    f.put(tank, MID.x + 3, MID.z);
    expect(f.pillars().length).toBe(5);
    expect(f.dev('/dev heart council wrath')).toBe(true);
    expect(g.castingAbility).toBe(COUNCIL_CASTS.wrath);
    const ev = f.tick(Math.ceil(T.wrathCast * 20) + 2);
    const hits = (p: Entity) => hitsOf(ev, COUNCIL_NAMES.wrath, p.id).length;
    expect(hits(hidden)).toBe(0);
    expect(hits(exposed)).toBe(1);
    expect(hits(tank)).toBe(1);
    // Every column is gone, the one that hid someone and the four that did not.
    expect(f.pillars().length).toBe(0);
    expect(quarryCircles(f.world(0, 0)).length).toBe(0);
    expect(warned(ev, 'columnsGone')).toBe(true);
    expect(f.st.wraths).toBe(1);
    expect(f.st.energy).toBeLessThan(5);
    // The shattered stone's rubble is a look, never a bite on the hidden.
    f.put(hidden, col.x, col.z);
    const after = f.tick(20 * 3);
    expect(hitsOf(after, COUNCIL_NAMES.rubble).length).toBe(0);
    // The next cover is never more than a breath after the Wrath.
    expect(f.st.wakeTimer).toBeLessThanOrEqual(T.wakeAfterWrath);
  });

  it('the first Wrath uses the carved columns; the next needs the stone Wake the Stone raises', () => {
    const f = pulled(4);
    const [tank, hider, a, b] = f.players;
    const g = f.bodies().guardian as Entity;
    plant(f, g, MID.x, MID.z);
    f.put(tank, MID.x + 3, MID.z);
    const col = QUARRY_PILLAR_SPOTS[1];
    const dx = (col.x - MID.x) / 24;
    const dz = (col.z - MID.z) / 24;
    f.put(hider, MID.x + dx * 30, MID.z + dz * 30);
    f.put(a, MID.x - 12, MID.z + 9);
    f.put(b, MID.x + 9, MID.z - 13);
    f.dev('/dev heart council wrath');
    let ev = f.tick(Math.ceil(T.wrathCast * 20) + 2);
    expect(hitsOf(ev, COUNCIL_NAMES.wrath, hider.id).length).toBe(0);
    expect(f.pillars().length).toBe(0);
    // No cover at all now: the same spot is open to the next Wrath.
    quiet(f.st);
    f.dev('/dev heart council wrath');
    ev = f.tick(Math.ceil(T.wrathCast * 20) + 2);
    expect(hitsOf(ev, COUNCIL_NAMES.wrath, hider.id).length).toBe(1);
    // Wake the Stone raises the cover: hiding behind a risen pillar works.
    quiet(f.st);
    f.dev('/dev heart council wake');
    f.tick(Math.ceil((T.wakeCast + 0.2) * 20));
    const markId = f.st.wakeMarks[0]?.playerId;
    const marked = f.players.find((p) => p.id === markId) as Entity;
    const spot = { x: MID.x + dx * 18, z: MID.z + dz * 18 };
    f.put(marked, spot.x, spot.z);
    for (const p of f.players) if (p !== marked && p !== tank) f.put(p, MID.x - 15, MID.z + 6);
    f.tick(Math.ceil(T.wakeMarkSeconds * 20) + 2);
    const risen = f.pillars().find((p) => {
      const at = f.local(p.e);
      return Math.hypot(at.x - spot.x, at.z - spot.z) < T.riseGap;
    });
    expect(risen).toBeDefined();
    if (!risen) return;
    const rl = f.local(risen.e);
    const ux = (rl.x - MID.x) / Math.hypot(rl.x - MID.x, rl.z - MID.z);
    const uz = (rl.z - MID.z) / Math.hypot(rl.x - MID.x, rl.z - MID.z);
    f.put(hider, rl.x + ux * (risen.r + 2), rl.z + uz * (risen.r + 2));
    quiet(f.st);
    f.dev('/dev heart council wrath');
    ev = f.tick(Math.ceil(T.wrathCast * 20) + 2);
    expect(hitsOf(ev, COUNCIL_NAMES.wrath, hider.id).length).toBe(0);
    expect(f.pillars().length).toBe(0);
  });

  it('a pillar at 0 falls: its wall goes, rubble lies and bites, then is gone; a wipe restores the five', () => {
    const f = pulled(5);
    const col = QUARRY_PILLAR_SPOTS[1];
    const p0 = f
      .pillars()
      .find((p) => Math.hypot(f.local(p.e).x - col.x, f.local(p.e).z - col.z) < 0.5);
    expect(p0).toBeDefined();
    if (!p0) return;
    p0.e.templateId = councilPillarTemplate(1, false);
    const dx = (col.x - MID.x) / 24;
    const dz = (col.z - MID.z) / 24;
    const sx = col.x - dx * (QUARRY_PILLAR_R + 3);
    const sz = col.z - dz * (QUARRY_PILLAR_R + 3);
    f.dev('/dev heart council rock');
    f.tick(Math.ceil((T.rockCast + 0.1) * 20));
    const rock = f.st.rock;
    expect(rock).not.toBeNull();
    if (!rock) return;
    const victim = f.sim.ctx.entities.get(rock.playerId) as Entity;
    for (const p of f.players.slice(1)) f.put(p, sx, sz);
    f.tick(Math.ceil(T.rockMarkSeconds * 20) + 2);
    expect(f.pillars().length).toBe(4);
    expect(quarryCircles(f.world(0, 0)).length).toBe(4);
    expect(f.st.rubble.length).toBe(1);
    f.put(victim, col.x, col.z);
    let ev = f.tick(20 * 3);
    expect(hitsOf(ev, COUNCIL_NAMES.rubble, victim.id).length).toBeGreaterThanOrEqual(2);
    ev = f.tick(20 * (T.rubbleSeconds - 2));
    expect(f.st.rubble.length).toBe(0);
    // A wipe: everyone dies, the council goes home, the five stand whole.
    for (const p of f.players) f.sim.ctx.handleDeath(p, null);
    for (let i = 0; i < 20 * 60 && f.state(); i++) f.sim.tick();
    expect(f.state()).toBeNull();
    expect(f.pillars().length).toBe(5);
    expect(f.pillars().every((p) => p.integrity === councilPillarFull(false) && !p.risen)).toBe(
      true,
    );
  });
});

describe('Hammer Council: the Falling Rock', () => {
  it('splits the blow between the soakers, cracks the pillars in reach, punishes a thin soak', () => {
    expect(fallingRockShare(3, 1350)).toEqual({ each: 450, tremor: false });
    expect(fallingRockShare(5, 1350)).toEqual({ each: 270, tremor: false });
    expect(fallingRockShare(2, 1350).tremor).toBe(true);
    expect(fallingRockShare(2, 1350).each).toBe(Math.round(675 * T.rockPenaltyMult));

    const f = pulled(5);
    const [tank, a, b, c, far] = f.players;
    const col = QUARRY_PILLAR_SPOTS[3];
    const dx = (col.x - MID.x) / 24;
    const dz = (col.z - MID.z) / 24;
    const sx = col.x - dx * (QUARRY_PILLAR_R + 3);
    const sz = col.z - dz * (QUARRY_PILLAR_R + 3);
    for (const p of [a, b, c]) f.put(p, sx, sz);
    f.put(far, MID.x + 20, MID.z - 18);
    f.put(tank, MID.x + 2, MID.z);
    f.dev('/dev heart council rock');
    expect(f.bodies().singer?.castingAbility).toBe(COUNCIL_CASTS.rock);
    f.tick(Math.ceil((T.rockCast + 0.1) * 20));
    const rock = f.st.rock;
    expect(rock).not.toBeNull();
    if (!rock) return;
    const marked = f.sim.ctx.entities.get(rock.playerId) as Entity;
    f.put(marked, sx, sz);
    for (const p of [a, b, c]) f.put(p, sx, sz);
    const soakers = [...new Set([a, b, c, marked])];
    const ev = f.tick(Math.ceil(T.rockMarkSeconds * 20) + 2);
    const share = Math.round(T.rockTotal / soakers.length);
    for (const p of soakers) expect(hitsOf(ev, COUNCIL_NAMES.rock, p.id)).toEqual([share]);
    for (const p of [tank, far].filter((q) => !soakers.includes(q)))
      expect(hitsOf(ev, COUNCIL_NAMES.rock, p.id)).toEqual([]);
    expect(hitsOf(ev, COUNCIL_NAMES.rockTremor).length).toBe(0);
    const p3 = f
      .pillars()
      .find((p) => Math.hypot(f.local(p.e).x - col.x, f.local(p.e).z - col.z) < 0.5);
    expect(p3?.integrity).toBe(councilPillarFull(false) - 1);
  });
});

describe('Hammer Council: Resonance is a spread', () => {
  it('each second it rings on every ally within its ring, never its carrier, never a pillar', () => {
    const f = pulled(4);
    const [, carrier, near, far] = f.players;
    const col = QUARRY_PILLAR_SPOTS[2];
    const dx = (col.x - MID.x) / 24;
    const dz = (col.z - MID.z) / 24;
    const at = { x: col.x - dx * (QUARRY_PILLAR_R + 1), z: col.z - dz * (QUARRY_PILLAR_R + 1) };
    f.put(carrier, at.x, at.z);
    f.put(near, at.x + 3, at.z);
    f.put(far, at.x + T.resonanceRadius + 6, at.z);
    // Mark exactly the carrier.
    f.st.resonance = [];
    f.sim.ctx.applyAura(carrier, {
      id: COUNCIL_AURAS.resonance,
      name: COUNCIL_NAMES.resonance,
      kind: 'vulnerability',
      remaining: T.resonanceSeconds,
      duration: T.resonanceSeconds,
      value: 0,
      value2: T.resonanceRadius,
      sourceId: f.bodies().singer?.id ?? 0,
      school: 'nature',
    });
    f.st.resonance.push({ playerId: carrier.id, remaining: T.resonanceSeconds, tick: 1 });
    const ev = f.tick(20 * (T.resonanceSeconds + 1));
    expect(hitsOf(ev, COUNCIL_NAMES.resonance, near.id).length).toBe(
      Math.round(T.resonanceSeconds / T.resonanceEvery),
    );
    expect(hitsOf(ev, COUNCIL_NAMES.resonance, carrier.id).length).toBe(0);
    expect(hitsOf(ev, COUNCIL_NAMES.resonance, far.id).length).toBe(0);
    for (const amount of hitsOf(ev, COUNCIL_NAMES.resonance, near.id)) {
      expect(amount).toBeGreaterThanOrEqual(T.resonanceMin);
      expect(amount).toBeLessThanOrEqual(T.resonanceMax);
    }
    // The pillar it stood by is whole.
    expect(f.pillars().every((p) => p.integrity === councilPillarFull(false))).toBe(true);
    expect(f.st.resonance.length).toBe(0);
    expect(carrier.auras.some((a) => a.id === COUNCIL_AURAS.resonance)).toBe(false);
  });
});

describe('Hammer Council: the stone remembers', () => {
  const kill = (f: CouncilFight, role: 'guardian' | 'singer') => {
    const b = f.bodies()[role] as Entity;
    f.sim.ctx.handleDeath(b, f.players[0]);
    f.tick();
  };

  it('the Guardian first: the Singer gains Memory and a shorter, lighter Wrath; no Rush, no Weight', () => {
    const f = pulled(6);
    kill(f, 'guardian');
    const c = f.bodies().singer as Entity;
    const mem = c.auras.find((a) => a.id === COUNCIL_AURAS.memory);
    expect(mem?.stacks).toBe(1);
    expect(mem?.value).toBeCloseTo(T.memoryPerFallen);
    f.dev('/dev heart council wrath');
    expect(c.castingAbility).toBe(COUNCIL_CASTS.wrath);
    expect(c.castTotal).toBe(T.heirWrathCast);
    expect(T.heirWrathMax).toBeLessThan(T.wrathMax);
    expect(f.dev('/dev heart council rush')).toBe(true);
    expect(f.st.rush).toBeNull();
    // Her own kit stays: Wake the Stone is still hers, kickable.
    quiet(f.st);
    f.tick(20 * 6);
    f.dev('/dev heart council wake');
    expect(c.castingAbility).toBe(COUNCIL_CASTS.wake);
    kill(f, 'singer');
    expect(f.state()?.finished).toBe(true);
    expect(f.pillars().some((p) => p.risen)).toBe(false);
    // The council's fall stands the carved columns back in their sockets.
    expect(f.pillars().length).toBe(5);
  });

  it('the Singer first: the Guardian gains Memory and raises the pillars itself, less often, on random players', () => {
    const f = pulled(6);
    kill(f, 'singer');
    const g = f.bodies().guardian as Entity;
    expect(g.auras.find((a) => a.id === COUNCIL_AURAS.memory)?.stacks).toBe(1);
    f.st.wakeTimer = 0;
    f.tick();
    expect(f.st.riseSpots.length).toBeGreaterThan(0);
    expect(f.st.wakeTimer).toBeGreaterThan(T.wakeEvery);
    expect(f.st.wakeTimer).toBeLessThanOrEqual(T.heirWakeEvery);
    const before = f.pillars().length;
    f.tick(Math.ceil(T.heirRiseWarn * 20) + 2);
    expect(f.pillars().length).toBeGreaterThan(before);
    // Her rock, bolt and song die with her on normal.
    quiet(f.st);
    f.st.rockTimer = 0;
    f.st.boltTimer = 0;
    f.st.songTimer = 0;
    f.st.songDue = 0;
    f.tick(20 * 3);
    expect(f.st.rock).toBeNull();
    expect(f.st.resonance.length).toBe(0);
    kill(f, 'guardian');
    expect(f.state()?.finished).toBe(true);
  });

  it('a wipe stands a fallen member up whole and lifts every stack', () => {
    const f = pulled(2);
    kill(f, 'singer');
    const b = f.bodies();
    expect(b.singer?.dead).toBe(true);
    for (const p of f.players) f.sim.ctx.handleDeath(p, null);
    for (let i = 0; i < 20 * 60 && f.state(); i++) f.sim.tick();
    expect(b.singer?.dead).toBe(false);
    expect(b.singer?.hp).toBe(b.singer?.maxHp);
    expect(b.singer?.regrown).toBe(true);
    expect(b.guardian?.auras.some((a) => a.id === COUNCIL_AURAS.memory)).toBe(false);
  });
});

describe('Hammer Council: difficulty', () => {
  it('normal: the song waits for a Wrath, so Resonance is over before the next', () => {
    const f = pulled(4);
    f.st.songTimer = 0;
    f.tick(20 * 5);
    expect(f.bodies().singer?.castingAbility).not.toBe(COUNCIL_CASTS.song);
    f.dev('/dev heart council wrath');
    f.tick(Math.ceil(T.wrathCast * 20) + 2);
    f.st.wakeTimer = 999;
    f.tick(Math.ceil((T.songAfterWrath + 0.2) * 20));
    expect(f.bodies().singer?.castingAbility).toBe(COUNCIL_CASTS.song);
    const toNext = (T.energyMax - f.st.energy) / (T.energyMax / T.energyFillSeconds);
    expect(T.songCast + T.resonanceSeconds).toBeLessThan(toNext);
  });

  it("normal: even an heir's soft-enraged Wrath never overlaps the Resonance", () => {
    const f = pulled(5);
    f.sim.ctx.handleDeath(f.bodies().guardian as Entity, f.players[0]);
    f.tick();
    quiet(f.st);
    f.st.wraths = T.enrageAfterWraths;
    f.dev('/dev heart council wrath');
    f.tick(Math.ceil(T.heirWrathCast * 20) + 2);
    f.st.wakeTimer = 999;
    f.tick(Math.ceil((T.songAfterWrath + T.songCast + 0.3) * 20));
    expect(f.st.resonance.length).toBeGreaterThan(0);
    const left = Math.max(...f.st.resonance.map((r) => r.remaining));
    const per = T.energyMax / (T.heirFillSeconds / T.enrageFillMult);
    const toNext = (T.energyMax - f.st.energy) / per + T.heirWrathCast;
    expect(left).toBeLessThan(toNext);
  });

  it('heroic: three marks, the pillars pulse, the song keeps its own clock', () => {
    const f = pulled(6);
    expect(f.dev('/dev heart council heroic on')).toBe(true);
    expect(f.st.difficulty).toBe('heroic');
    const [, a] = f.players;
    const col = QUARRY_PILLAR_SPOTS[4];
    const dx = (col.x - MID.x) / 24;
    const dz = (col.z - MID.z) / 24;
    f.put(a, col.x - dx * (QUARRY_PILLAR_R + 1.5), col.z - dz * (QUARRY_PILLAR_R + 1.5));
    const ev = f.tick(20 * 5);
    expect(hitsOf(ev, COUNCIL_NAMES.pulse, a.id).length).toBeGreaterThanOrEqual(2);
    // Wake the Stone marks three (room under the cap: two columns down).
    for (const p of f.pillars().slice(0, 2)) f.sim.ctx.dropEntity(p.e.id);
    f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
    f.dev('/dev heart council wake');
    f.tick(Math.ceil((T.wakeCast + 0.2) * 20));
    expect(f.st.wakeMarks.length).toBe(3);
    quiet(f.st);
    f.st.songTimer = 0.5;
    f.tick(20 * 2);
    expect(f.bodies().singer?.castingAbility).toBe(COUNCIL_CASTS.song);
  });

  it('a kicked song rings on one player only', () => {
    const f = pulled(5);
    f.dev('/dev heart council song');
    const c = f.bodies().singer as Entity;
    expect(c.castingAbility).toBe(COUNCIL_CASTS.song);
    f.tick(10);
    f.sim.ctx.cancelCast(c);
    f.tick(2);
    expect(f.st.resonance.length).toBe(T.songKickedMarks);
  });
});

describe('Hammer Council: the Slab and the seal wait on both', () => {
  it('one dead is not enough; the second opens the Slab and lights the Hammer vein', () => {
    const f = pulled(2);
    const slab = SMITH_HEART_GATES.find((g) => g.id === 'the_slab');
    if (!slab) throw new Error('slab');
    expect(slab.bosses).toEqual([...SMITH_HEART_COUNCIL]);
    const b = f.bodies();
    f.sim.ctx.handleDeath(b.guardian as Entity, f.players[0]);
    f.tick();
    expect(dungeonGateState(f.sim.ctx, f.inst, slab)).toBe('closed');
    expect(smithHeartProgress(f.sim.ctx, f.inst).slabOpen).toBe(false);
    f.sim.ctx.handleDeath(b.singer as Entity, f.players[0]);
    f.tick();
    expect(dungeonGateState(f.sim.ctx, f.inst, slab)).toBe('open');
    expect(smithHeartProgress(f.sim.ctx, f.inst).slabOpen).toBe(true);
  });
});

describe('Hammer Council: the Pit Mouth', () => {
  it('stays sealed while either fights, whichever falls first', () => {
    const f = councilFight(2);
    const mouth = SMITH_HEART_GATES.find((g) => g.id === 'hammer_pit_mouth');
    if (!mouth) throw new Error('mouth');
    const spawns = DUNGEONS.smith_heart.spawns;
    spawns.forEach((s, i) => {
      if (!['h1', 'h2', 'h3'].includes(s.packId ?? '')) return;
      const m = f.sim.ctx.entities.get(f.inst.mobIds[i]) as Entity;
      m.hp = 0;
      m.dead = true;
      m.aiState = 'dead';
    });
    f.dev('/dev heart council pull');
    f.tick(20 * 12);
    expect(dungeonGateState(f.sim.ctx, f.inst, mouth)).toBe('sealed');
    f.sim.ctx.handleDeath(f.bodies().guardian as Entity, f.players[0]);
    f.tick(20);
    expect(dungeonGateState(f.sim.ctx, f.inst, mouth)).toBe('sealed');
    f.sim.ctx.handleDeath(f.bodies().singer as Entity, f.players[0]);
    f.tick(2);
    expect(dungeonGateState(f.sim.ctx, f.inst, mouth)).toBe('open');
  });
});

describe('Hammer Council: determinism', () => {
  it('the same seed and the same raid fight the same fight', () => {
    const run = () => {
      const f = councilFight(6, 41);
      f.dev('/dev heart council pull');
      const ev = f.tick(20 * 75);
      const st = f.state();
      return JSON.stringify({
        casts: st?.casts,
        wraths: st?.wraths,
        energy: st?.energy,
        pillars: f.pillars().map((p) => [p.e.templateId, Math.round(p.e.pos.x * 10)]),
        hits: ev
          .filter((e) => e.type === 'damage')
          .map((e) => [(e as { ability?: string }).ability, (e as { amount?: number }).amount])
          .slice(0, 400),
      });
    };
    expect(run()).toBe(run());
  });

  it('every pillar template reads back', () => {
    for (const risen of [false, true])
      for (const n of [1, 2, 3])
        expect(councilPillarOf(councilPillarTemplate(n, risen))).toEqual({ integrity: n, risen });
    expect(councilPillarOf('sh_council_pillar_0')).toBeNull();
  });
});
