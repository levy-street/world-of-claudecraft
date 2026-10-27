// The Hammer Council (src/sim/encounters/smith_heart/council*.ts) over a REAL
// Sim claim of the Smith's Heart: one pull for all three, the pillars (rising
// at the marked spot, cover from Mountain's Wrath, cracked by Resonance and
// the Falling Rock, falling into rubble, standing whole again on a wipe), the
// soak's split, every inheritance order, the heroic pulse and overlap, the
// Slab and the seal waiting on all three, and determinism.

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
import type { Entity } from '../src/sim/types';
import { type CouncilFight, councilFight, hitsOf } from './helpers/council_fight';

/** Park every council clock so one mechanic can be watched alone. */
function quiet(st: CouncilFightState): void {
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
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

describe('Hammer Council: one pull', () => {
  it('pulling one wakes all three, and nothing else in the raid', () => {
    const f = councilFight(2);
    const b = f.bodies();
    f.sim.ctx.aggroMob(b.singer as Entity, f.players[0], false);
    f.tick(10);
    for (const r of ['guardian', 'slabwright', 'singer'] as const) {
      expect(['chase', 'attack'], r).toContain(b[r]?.aiState);
    }
    const st = f.state();
    expect(st?.kind).toBe('council');
    // One shared state.
    expect(b.guardian?.smithHeartFight).toBe(b.slabwright?.smithHeartFight);
    expect(b.singer?.smithHeartFight).toBe(st);
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
    expect(b.slabwright?.resource).toBe(0);
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

  it('Wake the Stone raises a pillar where the marked player stands, and throws them back', () => {
    const f = pulled(3);
    const [tank, a, bp] = f.players;
    f.put(tank, MID.x + 4, MID.z);
    f.put(a, MID.x - 12, MID.z + 8);
    f.put(bp, MID.x - 6, MID.z - 14);
    expect(f.dev('/dev heart council wake')).toBe(true);
    f.tick(Math.ceil((T.wakeCast + 0.2) * 20));
    const marked = f.st.wakeMarks.map((m) => m.playerId);
    // Normal marks one player.
    expect(marked.length).toBe(1);
    const spots = marked.map((id) => {
      const p = f.sim.ctx.entities.get(id) as Entity;
      expect(p.auras.some((x) => x.id === COUNCIL_AURAS.wakeMark)).toBe(true);
      return f.local(p);
    });
    const before = f.pillars().length;
    // The first mark rises where its player stands, exactly.
    const exact = spots[0];
    const ev = f.tick(Math.ceil(T.wakeMarkSeconds * 20) + 2);
    expect(
      f
        .pillars()
        .some(
          (p) => p.risen && Math.hypot(f.local(p.e).x - exact.x, f.local(p.e).z - exact.z) < 0.01,
        ),
    ).toBe(true);
    const risen = f.pillars().filter((p) => p.risen);
    expect(f.pillars().length).toBe(before + 1);
    for (const s of spots) {
      const near = risen.some((p) => {
        const at = f.local(p.e);
        // On the spot, or nudged off a pillar that rose a breath away.
        return Math.hypot(at.x - s.x, at.z - s.z) < T.riseGap;
      });
      expect(near).toBe(true);
    }
    // The marked were standing on it: thrown back and hit.
    expect(hitsOf(ev, COUNCIL_NAMES.wake).length).toBeGreaterThanOrEqual(1);
    for (const id of marked) {
      const p = f.sim.ctx.entities.get(id) as Entity;
      const pl = risen[0];
      const d = Math.min(...risen.map((q) => Math.hypot(p.pos.x - q.e.pos.x, p.pos.z - q.e.pos.z)));
      expect(d).toBeGreaterThan(pl.r);
    }
  });

  it('a rise never stands on another pillar, off the floor, or past the cap', () => {
    const f = councilFight(1);
    const pillars = QUARRY_PILLAR_SPOTS.map((s) => ({ x: s.x, z: s.z }));
    const s0 = QUARRY_PILLAR_SPOTS[0];
    const spot = nearestRiseSpot(pillars, [], s0.x + 1, s0.z);
    expect(spot).not.toBeNull();
    if (spot) expect(Math.hypot(spot.x - s0.x, spot.z - s0.z)).toBeGreaterThanOrEqual(T.riseGap);
    // Far outside the pit: nothing.
    expect(nearestRiseSpot(pillars, [], MID.x + 200, MID.z)).toBeNull();
    void f;
  });

  it("Mountain's Wrath spares the hidden, strikes the exposed, and cracks the shielding pillar", () => {
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
    expect(f.dev('/dev heart council wrath')).toBe(true);
    expect(g.castingAbility).toBe(COUNCIL_CASTS.wrath);
    const ev = f.tick(Math.ceil(T.wrathCast * 20) + 2);
    const hits = (p: Entity) => hitsOf(ev, COUNCIL_NAMES.wrath, p.id).length;
    expect(hits(hidden)).toBe(0);
    expect(hits(exposed)).toBe(1);
    expect(hits(tank)).toBe(1);
    const shield = f
      .pillars()
      .find((p) => Math.hypot(f.local(p.e).x - col.x, f.local(p.e).z - col.z) < 0.5);
    const full = councilPillarFull(false);
    expect(shield?.integrity).toBe(full - 1);
    expect(f.pillars().filter((p) => p.integrity === full).length).toBe(4);
    expect(f.st.wraths).toBe(1);
    expect(f.st.energy).toBeLessThan(5);
  });

  it('Resonance cracks the pillar its player stands by for 3 seconds, and restarts', () => {
    const f = pulled(2);
    const [, marked] = f.players;
    const col = QUARRY_PILLAR_SPOTS[2];
    const dx = (col.x - MID.x) / 24;
    const dz = (col.z - MID.z) / 24;
    f.put(marked, col.x + dx * (QUARRY_PILLAR_R + 1.5), col.z + dz * (QUARRY_PILLAR_R + 1.5));
    expect(f.dev('/dev heart council resonance 1')).toBe(true);
    const r = f.st.resonance.find((x) => x.playerId === marked.id);
    expect(r).toBeDefined();
    f.tick(Math.ceil(T.resonanceCrackSeconds * 20) - 4);
    const pillarAt = () =>
      f.pillars().find((p) => Math.hypot(f.local(p.e).x - col.x, f.local(p.e).z - col.z) < 0.5);
    const full = councilPillarFull(false);
    expect(pillarAt()?.integrity).toBe(full);
    f.tick(6);
    expect(pillarAt()?.integrity).toBe(full - 1);
    // The 3 s start again: the next blow only after another 3 s.
    f.tick(Math.ceil(T.resonanceCrackSeconds * 20) - 6);
    expect(pillarAt()?.integrity).toBe(full - 1);
    // The second blow fells the two-blow column.
    f.tick(8);
    expect(pillarAt()).toBeUndefined();
  });

  it('a pillar at 0 falls: its wall goes, rubble lies and bites, then is gone; a wipe restores the five', () => {
    const f = pulled(3);
    const [, , victim] = f.players;
    const col = QUARRY_PILLAR_SPOTS[1];
    const p0 = f
      .pillars()
      .find((p) => Math.hypot(f.local(p.e).x - col.x, f.local(p.e).z - col.z) < 0.5);
    expect(p0).toBeDefined();
    if (!p0) return;
    p0.e.templateId = councilPillarTemplate(1, false);
    const dx = (col.x - MID.x) / 24;
    const dz = (col.z - MID.z) / 24;
    f.put(victim, col.x + dx * (QUARRY_PILLAR_R + 1), col.z + dz * (QUARRY_PILLAR_R + 1));
    f.dev('/dev heart council resonance 3');
    expect(f.st.resonance.some((r) => r.playerId === victim.id)).toBe(true);
    let ev = f.tick(Math.ceil(T.resonanceCrackSeconds * 20) + 2);
    expect(f.pillars().length).toBe(4);
    const o = f.world(0, 0);
    expect(quarryCircles(o).length).toBe(4);
    expect(f.st.rubble.length).toBe(1);
    // The victim stands in the rubble now.
    f.put(victim, col.x, col.z);
    ev = f.tick(20 * 3);
    expect(hitsOf(ev, COUNCIL_NAMES.rubble, victim.id).length).toBeGreaterThanOrEqual(2);
    f.tick(20 * (T.rubbleSeconds - 2));
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
    // Three soakers 4 yd off a column's face, the tank and one more far away.
    const sx = col.x - dx * (QUARRY_PILLAR_R + 3);
    const sz = col.z - dz * (QUARRY_PILLAR_R + 3);
    for (const p of [a, b, c]) f.put(p, sx, sz);
    f.put(far, MID.x + 20, MID.z - 18);
    f.put(tank, MID.x + 2, MID.z);
    f.dev('/dev heart council rock');
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

describe('Hammer Council: the stone remembers', () => {
  const kill = (f: CouncilFight, role: 'guardian' | 'slabwright' | 'singer') => {
    const b = f.bodies()[role] as Entity;
    f.sim.ctx.handleDeath(b, f.players[0]);
    f.tick();
  };
  const orders: ('guardian' | 'slabwright' | 'singer')[][] = [
    ['guardian', 'slabwright', 'singer'],
    ['guardian', 'singer', 'slabwright'],
    ['slabwright', 'guardian', 'singer'],
    ['slabwright', 'singer', 'guardian'],
    ['singer', 'guardian', 'slabwright'],
    ['singer', 'slabwright', 'guardian'],
  ];
  for (const order of orders) {
    it(`order ${order.join(' > ')}: stacks, heirs and a finish`, () => {
      const f = pulled(6);
      kill(f, order[0]);
      const b = f.bodies();
      const alive = (['guardian', 'slabwright', 'singer'] as const).filter((r) => !b[r]?.dead);
      for (const r of alive) {
        const mem = b[r]?.auras.find((a) => a.id === COUNCIL_AURAS.memory);
        expect(mem?.stacks, r).toBe(1);
        expect(mem?.value).toBeCloseTo(T.memoryPerFallen);
      }
      // The fallen one's job lives on in a survivor.
      if (order[0] === 'guardian') {
        f.dev('/dev heart council wrath');
        const caster = alive
          .map((r) => b[r])
          .find((e) => e?.castingAbility === COUNCIL_CASTS.wrath);
        expect(caster).toBeDefined();
        expect(caster?.castTotal).toBe(T.heirWrathCast);
      }
      if (order[0] === 'singer') {
        f.dev('/dev heart council song');
        const caster = alive
          .map((r) => b[r])
          .find((e) => e?.castingAbility === COUNCIL_CASTS.songUnbroken);
        expect(caster).toBeDefined();
        f.tick(Math.ceil(T.songCast * 20) + 2);
        expect(f.st.resonance.length).toBe(T.songMarks);
      }
      if (order[0] === 'slabwright') {
        f.st.wakeTimer = 0;
        f.tick();
        expect(f.st.riseSpots.length).toBeGreaterThan(0);
        const before = f.pillars().length;
        f.tick(Math.ceil(T.heirRiseWarn * 20) + 2);
        expect(f.pillars().length).toBeGreaterThan(before);
      }
      kill(f, order[1]);
      const last = f.bodies()[order[2]] as Entity;
      expect(last.auras.find((a) => a.id === COUNCIL_AURAS.memory)?.stacks).toBe(2);
      // The last one carries every job: let a minute run and see each of them.
      quiet(f.st);
      f.st.energy = 99.5;
      f.st.wakeTimer = 1;
      f.st.songTimer = 3;
      f.st.songDue = 3;
      f.tick(20 * 25);
      expect(f.st.wraths).toBeGreaterThanOrEqual(1);
      expect(f.st.casts).toBeGreaterThan(2);
      kill(f, order[2]);
      expect(f.state()?.finished).toBe(true);
      expect(f.pillars().some((p) => p.risen)).toBe(false);
    });
  }

  it('a wipe stands a fallen member up whole and lifts every stack', () => {
    const f = pulled(2);
    kill(f, 'slabwright');
    const b = f.bodies();
    expect(b.slabwright?.dead).toBe(true);
    for (const p of f.players) f.sim.ctx.handleDeath(p, null);
    for (let i = 0; i < 20 * 60 && f.state(); i++) f.sim.tick();
    expect(b.slabwright?.dead).toBe(false);
    expect(b.slabwright?.hp).toBe(b.slabwright?.maxHp);
    expect(b.slabwright?.regrown).toBe(true);
    expect(b.guardian?.auras.some((a) => a.id === COUNCIL_AURAS.memory)).toBe(false);
  });
});

describe('Hammer Council: difficulty', () => {
  it('normal: the song waits for a Wrath, so Resonance is over before the next', () => {
    const f = pulled(4);
    // No Wrath has landed: the song is not owed, whatever its own clock says.
    f.st.songTimer = 0;
    f.tick(20 * 5);
    expect(f.bodies().singer?.castingAbility).not.toBe(COUNCIL_CASTS.song);
    f.dev('/dev heart council wrath');
    f.tick(Math.ceil(T.wrathCast * 20) + 2);
    // The song begins just after the Wrath lands.
    f.tick(Math.ceil((T.songAfterWrath + 0.2) * 20));
    expect(f.bodies().singer?.castingAbility).toBe(COUNCIL_CASTS.song);
    // Its Resonance lands and runs out well before the next full energy.
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
    // The song is owed now and starts after its breath.
    f.tick(Math.ceil((T.songAfterWrath + T.songCast + 0.3) * 20));
    expect(f.st.resonance.length).toBeGreaterThan(0);
    const left = Math.max(...f.st.resonance.map((r) => r.remaining));
    const per = T.energyMax / (T.heirFillSeconds / T.enrageFillMult);
    const toNext = (T.energyMax - f.st.energy) / per + T.heirWrathCast;
    expect(left).toBeLessThan(toNext);
  });

  it('heroic: two marks, the pillars pulse, the song keeps its own clock', () => {
    const f = pulled(5);
    expect(f.dev('/dev heart council heroic on')).toBe(true);
    expect(f.st.difficulty).toBe('heroic');
    const [, a] = f.players;
    const col = QUARRY_PILLAR_SPOTS[4];
    const dx = (col.x - MID.x) / 24;
    const dz = (col.z - MID.z) / 24;
    f.put(a, col.x - dx * (QUARRY_PILLAR_R + 1.5), col.z - dz * (QUARRY_PILLAR_R + 1.5));
    const ev = f.tick(20 * 5);
    expect(hitsOf(ev, COUNCIL_NAMES.pulse, a.id).length).toBeGreaterThanOrEqual(2);
    // Wake the Stone marks two (room under the cap: two columns down).
    for (const p of f.pillars().slice(0, 2)) f.sim.ctx.dropEntity(p.e.id);
    f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
    f.dev('/dev heart council wake');
    f.tick(Math.ceil((T.wakeCast + 0.2) * 20));
    expect(f.st.wakeMarks.length).toBe(2);
    // The song sings on its own clock, with no Wrath landed.
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

describe('Hammer Council: the Slab and the seal wait on all three', () => {
  it('two dead is not enough; the third opens the Slab and lights the Hammer vein', () => {
    const f = pulled(2);
    const slab = SMITH_HEART_GATES.find((g) => g.id === 'the_slab');
    if (!slab) throw new Error('slab');
    expect(slab.bosses).toEqual([...SMITH_HEART_COUNCIL]);
    const b = f.bodies();
    f.sim.ctx.handleDeath(b.guardian as Entity, f.players[0]);
    f.tick();
    f.sim.ctx.handleDeath(b.singer as Entity, f.players[0]);
    f.tick();
    expect(dungeonGateState(f.sim.ctx, f.inst, slab)).toBe('closed');
    expect(smithHeartProgress(f.sim.ctx, f.inst).slabOpen).toBe(false);
    f.sim.ctx.handleDeath(b.slabwright as Entity, f.players[0]);
    f.tick();
    expect(dungeonGateState(f.sim.ctx, f.inst, slab)).toBe('open');
    expect(smithHeartProgress(f.sim.ctx, f.inst).slabOpen).toBe(true);
  });
});

describe('Hammer Council: the Pit Mouth', () => {
  it('stays sealed while any of the three fights, whichever falls first', () => {
    const f = councilFight(2);
    const mouth = SMITH_HEART_GATES.find((g) => g.id === 'hammer_pit_mouth');
    if (!mouth) throw new Error('mouth');
    // The Gallery's packs down, so only the fight holds the mouth.
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
    f.sim.ctx.handleDeath(f.bodies().slabwright as Entity, f.players[0]);
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
