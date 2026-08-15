// Curated compositions and formations are part of each floor's identity. These
// tests expand the canonical registry and pin safe, deterministic runtime plans.

import { describe, expect, it } from 'vitest';
import {
  demonTowerArenaPolygon,
  demonTowerDecor,
  demonTowerDecorObstacles,
  demonTowerEntry,
  demonTowerHazards,
} from '../src/sim/content/rift/demon_tower';
import { DEMON_TOWER_FLOORS } from '../src/sim/rift/tower_floors';
import {
  DEMON_TOWER_CORE_RADIUS,
  DEMON_TOWER_FLOOR_COUNT,
  DEMON_TOWER_MAX_LIVE_DEMONS,
  demonTowerArenaRadius,
  demonTowerFloorTuning,
} from '../src/sim/rift/tower_scaling';
import {
  DEMON_TOWER_GATEKEEPER,
  DEMON_TOWER_LORD,
  DEMON_TOWER_ROSTER,
  demonTowerBossFor,
  demonTowerFloorDemonCount,
  demonTowerRosterWindow,
  demonTowerWavePlan,
  safeTowerSpawnPosition,
} from '../src/sim/rift/tower_waves';

const FLOORS = Array.from({ length: DEMON_TOWER_FLOOR_COUNT }, (_, i) => i);
const BODY_CLEARANCE = 1.5;

function pointInPolygon(
  point: { x: number; z: number },
  polygon: readonly { x: number; z: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(
  point: { x: number; z: number },
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / len2));
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

function wallClearance(
  point: { x: number; z: number },
  polygon: readonly { x: number; z: number }[],
): number {
  return Math.min(
    ...polygon.map((a, index) =>
      distanceToSegment(point, a, polygon[(index + 1) % polygon.length]),
    ),
  );
}

describe('demon tower waves', () => {
  it('expands every authored composition exactly and reports its real total', () => {
    for (const [k, floor] of DEMON_TOWER_FLOORS.entries()) {
      const plan = demonTowerWavePlan(k);
      expect(plan).toHaveLength(floor.waves.length);
      expect(plan.map((wave) => wave.spawns.map((spawn) => spawn.templateId))).toEqual(
        floor.waves.map((wave) =>
          wave.flatMap((member) => Array.from({ length: member.count }, () => member.templateId)),
        ),
      );
      expect(demonTowerFloorDemonCount(k)).toBe(
        floor.waves.flat().reduce((sum, member) => sum + member.count, 0),
      );
      expect(Math.max(...plan.map((wave) => wave.spawns.length))).toBe(
        demonTowerFloorTuning(k).packSize,
      );
      for (const wave of plan) {
        expect(wave.spawns.length).toBeLessThanOrEqual(DEMON_TOWER_MAX_LIVE_DEMONS);
      }
    }
  });

  it('keeps every body inside its actual floor polygon and clear of the core and walls', () => {
    for (const k of FLOORS) {
      const polygon = demonTowerArenaPolygon(k);
      for (const wave of demonTowerWavePlan(k)) {
        for (const spawn of wave.spawns) {
          expect(pointInPolygon(spawn, polygon), `floor ${k + 1} wave ${wave.index}`).toBe(true);
          expect(Math.hypot(spawn.x, spawn.z)).toBeGreaterThan(
            DEMON_TOWER_CORE_RADIUS + BODY_CLEARANCE,
          );
          expect(
            wallClearance(spawn, polygon),
            `floor ${k + 1} wave ${wave.index}`,
          ).toBeGreaterThan(BODY_CLEARANCE);
        }
      }
    }
  });

  it('does not place wave bodies inside authored hazard footprints', () => {
    for (const k of FLOORS) {
      for (const wave of demonTowerWavePlan(k)) {
        for (const spawn of wave.spawns) {
          for (const hazard of demonTowerHazards(k)) {
            const rx = hazard.rx ?? hazard.r;
            const rz = hazard.rz ?? hazard.r;
            const normalized =
              ((spawn.x - hazard.x) / (rx + BODY_CLEARANCE)) ** 2 +
              ((spawn.z - hazard.z) / (rz + BODY_CLEARANCE)) ** 2;
            expect(
              normalized,
              `floor ${k + 1} wave ${wave.index} ${spawn.templateId} at (${spawn.x},${spawn.z}) overlaps hazard (${hazard.x},${hazard.z})`,
            ).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  it('places every boss clear of the Core, decor, hazards and shell', () => {
    for (const k of FLOORS) {
      const boss = safeTowerSpawnPosition(k, { x: 0, z: demonTowerArenaRadius(k) * 0.36 });
      const polygon = demonTowerArenaPolygon(k);
      expect(pointInPolygon(boss, polygon)).toBe(true);
      expect(Math.hypot(boss.x, boss.z)).toBeGreaterThan(DEMON_TOWER_CORE_RADIUS + BODY_CLEARANCE);
      expect(wallClearance(boss, polygon)).toBeGreaterThan(BODY_CLEARANCE);
      for (const obstacle of demonTowerDecorObstacles(k)) {
        expect(Math.hypot(boss.x - obstacle.x, boss.z - obstacle.z)).toBeGreaterThan(
          obstacle.r + BODY_CLEARANCE,
        );
      }
      for (const hazard of demonTowerHazards(k)) {
        const rx = (hazard.rx ?? hazard.r) + BODY_CLEARANCE;
        const rz = (hazard.rz ?? hazard.r) + BODY_CLEARANCE;
        expect(((boss.x - hazard.x) / rx) ** 2 + ((boss.z - hazard.z) / rz) ** 2).toBeGreaterThan(
          1,
        );
      }
    }
  });

  it('never stacks two members of one wave on the same body footprint', () => {
    for (const k of FLOORS) {
      for (const wave of demonTowerWavePlan(k)) {
        for (let i = 0; i < wave.spawns.length; i++) {
          for (let j = i + 1; j < wave.spawns.length; j++) {
            const a = wave.spawns[i];
            const b = wave.spawns[j];
            expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  it('uses only registered demons and exposes each floor roster in authored order', () => {
    const roster = new Set(DEMON_TOWER_ROSTER);
    for (const [k, floor] of DEMON_TOWER_FLOORS.entries()) {
      const expected = [
        ...new Set(floor.waves.flatMap((wave) => wave.map((member) => member.templateId))),
      ];
      expect(demonTowerRosterWindow(k)).toEqual(expected);
      for (const id of expected) expect(roster.has(id) || id === DEMON_TOWER_GATEKEEPER).toBe(true);
    }
  });

  it('releases each bespoke boss after its floor final wave', () => {
    expect(FLOORS.map(demonTowerBossFor)).toEqual([
      'tower_boss_ash_tyrant',
      'tower_boss_flesh_shaper',
      DEMON_TOWER_LORD,
    ]);
    for (const k of FLOORS) {
      const plan = demonTowerWavePlan(k);
      expect(plan.map((wave) => wave.releasesBoss)).toEqual(
        plan.map((_, index) => index === plan.length - 1),
      );
    }
  });

  it('authors Vaskar as the Void Crown lieutenant, not as its run boss', () => {
    const lieutenants = demonTowerWavePlan(2).flatMap((wave) =>
      wave.spawns.filter((spawn) => spawn.lieutenant),
    );
    expect(lieutenants).toEqual([
      expect.objectContaining({
        templateId: DEMON_TOWER_GATEKEEPER,
        lieutenant: true,
      }),
    ]);
    expect(demonTowerBossFor(2)).toBe(DEMON_TOWER_LORD);
    expect(
      demonTowerWavePlan(0)
        .flatMap((wave) => wave.spawns)
        .some((s) => s.lieutenant),
    ).toBe(false);
    expect(
      demonTowerWavePlan(1)
        .flatMap((wave) => wave.spawns)
        .some((s) => s.lieutenant),
    ).toBe(false);
  });

  it('is deterministic across repeated and interleaved calls', () => {
    const baseline = FLOORS.map(demonTowerWavePlan);
    demonTowerWavePlan(2);
    demonTowerWavePlan(0);
    demonTowerWavePlan(1);
    expect(FLOORS.map(demonTowerWavePlan)).toEqual(baseline);
    expect(demonTowerWavePlan(-99)).toEqual(demonTowerWavePlan(0));
    expect(demonTowerWavePlan(99)).toEqual(demonTowerWavePlan(2));
  });
});

describe('demon tower decor safety', () => {
  it('keeps measured colliders clear of the core, every spawn, and the arrival point', () => {
    for (const k of FLOORS) {
      const spawns = demonTowerWavePlan(k).flatMap((wave) => wave.spawns);
      const entry = demonTowerEntry(k);
      for (const obstacle of demonTowerDecorObstacles(k)) {
        expect(Math.hypot(obstacle.x, obstacle.z)).toBeGreaterThan(
          DEMON_TOWER_CORE_RADIUS + obstacle.r,
        );
        expect(
          Math.hypot(obstacle.x - entry.x, obstacle.z - entry.z),
          `floor ${k + 1} collider at (${obstacle.x},${obstacle.z}) blocks entry (${entry.x},${entry.z})`,
        ).toBeGreaterThan(obstacle.r + BODY_CLEARANCE);
        for (const spawn of spawns) {
          expect(
            Math.hypot(obstacle.x - spawn.x, obstacle.z - spawn.z),
            `floor ${k + 1} collider (${obstacle.x},${obstacle.z}) overlaps ${spawn.templateId} (${spawn.x},${spawn.z})`,
          ).toBeGreaterThan(obstacle.r + BODY_CLEARANCE);
        }
      }
    }
  });

  it('gives every floor its own deterministic decor vocabulary', () => {
    const vocabularies = FLOORS.map((k) => new Set(demonTowerDecor(k).map((d) => d.key)));
    expect(vocabularies.map((keys) => keys.size)).toEqual([10, 11, 9]);
    for (const vocabulary of vocabularies) expect(vocabulary).toContain('demon_core');
    expect(vocabularies[0]).toContain('tower_ascent_arch');
    expect(vocabularies[1]).toContain('tower_ascent_arch');
    expect(vocabularies[0]).toContain('tower_bloodforge_furnace');
    expect(vocabularies[1]).toContain('tower_ossuary_reliquary');
    expect(vocabularies[2]).toContain('tower_void_throne');
    for (const k of FLOORS) expect(demonTowerDecor(k)).toEqual(demonTowerDecor(k));
  });
});
