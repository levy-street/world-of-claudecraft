// The wave plan is what makes the tower a Demon Tower rather than a room you
// sweep once. These assertions pin the things a regression would actually break:
// demons must land INSIDE the arena and OUTSIDE the core (a spawn in either wall
// is an unreachable or stuck mob), the roster must slide as you climb, the boss
// must be released by the last wave of a boss floor and never anywhere else, and
// the whole plan must be a pure function of the floor index.

import { describe, expect, it } from 'vitest';
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

  it('maps the two bosses to the gate and the summit', () => {
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
