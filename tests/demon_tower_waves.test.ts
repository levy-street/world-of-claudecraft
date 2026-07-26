// The wave plan is what makes the tower a Demon Tower rather than a room you
// sweep once. These assertions pin the things a regression would actually break:
// demons must land INSIDE the arena and OUTSIDE the core (a spawn in either wall
// is an unreachable or stuck mob), the roster must slide as you climb, the boss
// must be released by the last wave of a boss floor and never anywhere else, and
// the whole plan must be a pure function of the floor index.

import { describe, expect, it } from 'vitest';
import { demonTowerDecor, demonTowerDecorObstacles } from '../src/sim/content/rift/demon_tower';
import {
  DEMON_TOWER_CORE_RADIUS,
  DEMON_TOWER_FLOOR_COUNT,
  demonTowerArenaRadius,
  demonTowerFloorTuning,
  isDemonTowerBossFloor,
} from '../src/sim/rift/tower_scaling';
import {
  DEMON_TOWER_GATEKEEPER,
  DEMON_TOWER_LORD,
  DEMON_TOWER_ROSTER,
  demonTowerBossFor,
  demonTowerFloorDemonCount,
  demonTowerRingRadius,
  demonTowerRosterWindow,
  demonTowerWavePlan,
} from '../src/sim/rift/tower_waves';

const FLOORS = Array.from({ length: DEMON_TOWER_FLOOR_COUNT }, (_, i) => i);
// Demons are bodies, not points: leave room between the spawn ring and the wall.
const BODY_CLEARANCE = 1.5;

describe('demon tower waves', () => {
  it('sends exactly the wave count and pack size the tuning declares', () => {
    for (const k of FLOORS) {
      const tuning = demonTowerFloorTuning(k);
      const plan = demonTowerWavePlan(k);
      expect(plan).toHaveLength(tuning.waveCount);
      for (const wave of plan) expect(wave.spawns).toHaveLength(tuning.packSize);
      expect(demonTowerFloorDemonCount(k)).toBe(tuning.waveCount * tuning.packSize);
    }
  });

  it('stands every demon inside the arena wall and clear of the core', () => {
    for (const k of FLOORS) {
      const arena = demonTowerArenaRadius(k);
      for (const wave of demonTowerWavePlan(k)) {
        for (const s of wave.spawns) {
          const r = Math.hypot(s.x, s.z);
          expect(r, `floor ${k + 1} wave ${wave.index} spawn escaped the arena`).toBeLessThan(
            arena - BODY_CLEARANCE,
          );
          expect(r, `floor ${k + 1} wave ${wave.index} spawn is inside the core`).toBeGreaterThan(
            DEMON_TOWER_CORE_RADIUS + BODY_CLEARANCE,
          );
        }
      }
    }
  });

  it('keeps the ring between the core and the wall on every floor', () => {
    for (const k of FLOORS) {
      expect(demonTowerRingRadius(k)).toBeGreaterThan(DEMON_TOWER_CORE_RADIUS);
      expect(demonTowerRingRadius(k)).toBeLessThan(demonTowerArenaRadius(k));
    }
  });

  it('never stacks two demons of a wave on the same spot', () => {
    for (const k of FLOORS) {
      for (const wave of demonTowerWavePlan(k)) {
        for (let i = 0; i < wave.spawns.length; i++) {
          for (let j = i + 1; j < wave.spawns.length; j++) {
            const a = wave.spawns[i];
            const b = wave.spawns[j];
            expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.5);
          }
        }
      }
    }
  });

  it('staggers successive waves so a wave never reuses the last one exactly', () => {
    for (const k of FLOORS) {
      const plan = demonTowerWavePlan(k);
      for (let w = 1; w < plan.length; w++) {
        const prev = plan[w - 1].spawns;
        const cur = plan[w].spawns;
        const identical = cur.every((s, i) => s.x === prev[i].x && s.z === prev[i].z);
        expect(identical, `floor ${k + 1} wave ${w} reused wave ${w - 1}'s ring`).toBe(false);
      }
    }
  });

  it('draws only from the roster, and slides the window up as the tower climbs', () => {
    const roster = new Set(DEMON_TOWER_ROSTER);
    for (const k of FLOORS) {
      for (const wave of demonTowerWavePlan(k)) {
        for (const s of wave.spawns) expect(roster.has(s.templateId)).toBe(true);
      }
    }
    // The bottom fights the weakest demons, the summit the strongest, and the
    // window never slides backwards.
    expect(demonTowerRosterWindow(0)[0]).toBe(DEMON_TOWER_ROSTER[0]);
    expect(demonTowerRosterWindow(DEMON_TOWER_FLOOR_COUNT - 1)).toEqual([
      DEMON_TOWER_ROSTER[DEMON_TOWER_ROSTER.length - 1],
    ]);
    for (let k = 1; k < DEMON_TOWER_FLOOR_COUNT; k++) {
      const prev = DEMON_TOWER_ROSTER.indexOf(demonTowerRosterWindow(k - 1)[0]);
      const cur = DEMON_TOWER_ROSTER.indexOf(demonTowerRosterWindow(k)[0]);
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });

  it('releases a boss only on the last wave of a boss floor', () => {
    for (const k of FLOORS) {
      const plan = demonTowerWavePlan(k);
      const releasing = plan.filter((w) => w.releasesBoss);
      if (isDemonTowerBossFloor(k)) {
        expect(releasing).toHaveLength(1);
        expect(releasing[0].index).toBe(plan.length - 1);
      } else {
        expect(releasing).toHaveLength(0);
      }
    }
  });

  it('maps every boss floor to its own boss, and no other floor to any', () => {
    expect(demonTowerBossFor(2)).toBe('tower_boss_flesh_shaper');
    expect(demonTowerBossFor(6)).toBe('tower_boss_ash_tyrant');
    expect(demonTowerBossFor(4)).toBe(DEMON_TOWER_GATEKEEPER);
    expect(demonTowerBossFor(DEMON_TOWER_FLOOR_COUNT - 1)).toBe(DEMON_TOWER_LORD);
    for (const k of FLOORS) {
      if (!isDemonTowerBossFloor(k)) expect(demonTowerBossFor(k)).toBeNull();
    }
  });

  it('is a pure function of the floor index (no rng, no call-order state)', () => {
    for (const k of FLOORS) {
      expect(demonTowerWavePlan(k)).toEqual(demonTowerWavePlan(k));
    }
    // Interleaving calls must not perturb any shared state.
    const a = demonTowerWavePlan(3);
    demonTowerWavePlan(9);
    demonTowerWavePlan(0);
    expect(demonTowerWavePlan(3)).toEqual(a);
  });
});

// The arena dressing has to stay OUT of the fight. A prop that lands on the wave
// ring bodyblocks a spawning demon; one on the entry arc bodyblocks the raid as
// it walks in; one past the wall is floating outside the room.
describe('demon tower decor', () => {
  it('keeps every prop out of the wave ring, off the core, and inside the wall', () => {
    for (const k of FLOORS) {
      const arena = demonTowerArenaRadius(k);
      const ring = demonTowerRingRadius(k);
      for (const d of demonTowerDecor(k)) {
        const r = Math.hypot(d.x, d.z);
        // Flat walk-through sigils are the one thing allowed inside the ring:
        // they carry no collider, so they cannot bodyblock anything.
        if (d.r === undefined && d.key === 'tower_rune_slab') {
          expect(r).toBeGreaterThan(DEMON_TOWER_CORE_RADIUS);
          continue;
        }
        expect(r, `floor ${k + 1} ${d.key} sits on the wave ring`).toBeGreaterThan(ring + 2);
        expect(r, `floor ${k + 1} ${d.key} escaped the wall`).toBeLessThan(arena);
      }
    }
  });

  it('leaves the entry arc clear so the raid is not bodyblocked walking in', () => {
    for (const k of FLOORS) {
      const entryZ = -(demonTowerArenaRadius(k) - 3.5);
      for (const d of demonTowerDecor(k)) {
        expect(
          Math.hypot(d.x - 0, d.z - entryZ),
          `floor ${k + 1} ${d.key} blocks the arrival point`,
        ).toBeGreaterThan(4);
      }
    }
  });

  it('furnishes the tower more as it climbs, and every collider is measured', () => {
    expect(demonTowerDecor(9).length).toBeGreaterThan(demonTowerDecor(0).length);
    const obstacles = demonTowerDecorObstacles(5);
    expect(obstacles.length).toBeGreaterThan(0);
    for (const o of obstacles) expect(o.r).toBeGreaterThan(0);
    // The ascent arch is a gateway the raid walks through: no collider, ever.
    for (const k of FLOORS) {
      for (const d of demonTowerDecor(k)) {
        if (d.key === 'tower_ascent_arch') expect(d.r).toBeUndefined();
      }
    }
  });

  it('is a pure function of the floor index', () => {
    for (const k of FLOORS) expect(demonTowerDecor(k)).toEqual(demonTowerDecor(k));
  });
});
