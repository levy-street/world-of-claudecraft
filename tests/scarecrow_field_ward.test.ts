// The field ward (src/sim/seasonal/scarecrow_field_ward.ts): while Gourdlight Eve runs, Boar
// Meadow's idle wildlife (the level-2 boars, Mogger) keeps out of Old Thatchgrin's pumpkin
// patch; outside the event the meadow wanders exactly as before. Zero rng: the ward only
// rewrites wander targets.
import { afterEach, describe, expect, it } from 'vitest';
import { STRAWLING_ID } from '../src/sim/content/gourdlight_eve_scarecrow';
import { resolveScarecrowField } from '../src/sim/seasonal/scarecrow_field';
import {
  pushOutOfWard,
  SCARECROW_FIELD_WARD_MARGIN,
  SCARECROW_FIELD_WARD_RADIUS,
  skirtWard,
  walkCrossesWard,
  wardedByScarecrowField,
} from '../src/sim/seasonal/scarecrow_field_ward';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

// The collider grid is shared per seed in one process: close the event's decor gate
// after each test so no other suite in this worker walks into a stall.
afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));

function world(season: boolean): Sim {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-10-20';
  if (season) sim.chat('/dev season on');
  return sim;
}

/** Exercise an actual inward wander independently of nearby camp placement. */
function inwardWildlife(sim: Sim): Entity[] {
  const field = resolveScarecrowField(WORLD_SEED)!;
  // Within interest range, outside aggro range of both the wildlife and boss.
  sim.player.pos = sim.ctx.groundPos(field.x, field.z + 50);
  return ['wild_boar', 'mogger'].map((id, i) => {
    const mob = [...sim.entities.values()].find((e) => e.templateId === id && !e.dead)!;
    expect(mob, id).toBeDefined();
    const sign = i === 0 ? 1 : -1;
    mob.pos = sim.ctx.groundPos(field.x + sign * (SCARECROW_FIELD_WARD_RADIUS + 0.5), field.z);
    mob.spawnPos = { ...mob.pos };
    mob.wanderTarget = sim.ctx.groundPos(
      field.x + sign * (SCARECROW_FIELD_WARD_RADIUS - 3),
      field.z,
    );
    mob.wanderTimer = 30;
    mob.aiState = 'idle';
    sim.ctx.grid.update(mob);
    return mob;
  });
}

describe('the ward geometry', () => {
  it('pushes a point inside the disc out onto the rim, along its own radius', () => {
    const out = { x: 0, z: 0 };
    expect(pushOutOfWard(0, 0, 3, 4, 0, 0, out)).toBe(true);
    const r = SCARECROW_FIELD_WARD_RADIUS + SCARECROW_FIELD_WARD_MARGIN;
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(r, 6);
    expect(out.x / out.z).toBeCloseTo(3 / 4, 6);
  });

  it('leaves a point outside the disc alone', () => {
    const out = { x: 7, z: 7 };
    expect(pushOutOfWard(0, 0, SCARECROW_FIELD_WARD_RADIUS + 0.01, 0, 0, 0, out)).toBe(false);
    expect(out).toEqual({ x: 7, z: 7 });
  });

  it('sends a point on the exact centre out along the fallback, else due +x', () => {
    const out = { x: 0, z: 0 };
    pushOutOfWard(5, 5, 5, 5, 5, 0, out);
    expect(out.x).toBeCloseTo(5, 6);
    expect(out.z).toBeLessThan(5 - SCARECROW_FIELD_WARD_RADIUS);
    pushOutOfWard(5, 5, 5, 5, 5, 5, out);
    expect(out.z).toBeCloseTo(5, 6);
    expect(out.x).toBeGreaterThan(5 + SCARECROW_FIELD_WARD_RADIUS);
  });

  it('flags a walk that cuts across the disc, not one that skirts it or starts inside', () => {
    const R = SCARECROW_FIELD_WARD_RADIUS;
    expect(walkCrossesWard(0, 0, -R - 2, 0, R + 2, 0)).toBe(true);
    expect(walkCrossesWard(0, 0, -R - 2, R + 1, R + 2, R + 1)).toBe(false);
    expect(walkCrossesWard(0, 0, 1, 1, R + 5, 0)).toBe(false);
  });

  it('replaces a crossing with a step round the rim whose straight walk stays outside', () => {
    const R = SCARECROW_FIELD_WARD_RADIUS;
    const out = { x: 0, z: 0 };
    for (const [px, pz, tx, tz] of [
      [-R - 1, 0, R + 1, 0],
      [0, R + 3, 0.5, -R - 2],
      [R + 1, 1, -R, -2],
    ]) {
      skirtWard(0, 0, px, pz, tx, tz, out);
      expect(Math.hypot(out.x, out.z)).toBeGreaterThanOrEqual(R);
      expect(walkCrossesWard(0, 0, px, pz, out.x, out.z)).toBe(false);
      // and it actually moves round toward the target's side
      expect(Math.hypot(out.x - px, out.z - pz)).toBeGreaterThan(1);
    }
  });

  it('governs only idle wild mobs outside his encounter', () => {
    const base = {
      kind: 'mob',
      dead: false,
      ownerId: null,
      summonedAdd: false,
      inCombat: false,
      aiState: 'idle',
      templateId: 'wild_boar',
    } as unknown as Entity;
    expect(wardedByScarecrowField(base)).toBe(true);
    expect(wardedByScarecrowField({ ...base, inCombat: true } as Entity)).toBe(false);
    expect(wardedByScarecrowField({ ...base, aiState: 'chase' } as Entity)).toBe(false);
    expect(wardedByScarecrowField({ ...base, ownerId: 7 } as Entity)).toBe(false);
    expect(wardedByScarecrowField({ ...base, summonedAdd: true } as Entity)).toBe(false);
    expect(wardedByScarecrowField({ ...base, templateId: STRAWLING_ID } as Entity)).toBe(false);
    expect(wardedByScarecrowField({ ...base, kind: 'player' } as unknown as Entity)).toBe(false);
  });
});

describe('Boar Meadow round his field', () => {
  it('wanders into the field when the event is off (the meadow is untouched then)', () => {
    const sim = world(false);
    const field = resolveScarecrowField(WORLD_SEED);
    if (!field) throw new Error('no field');
    const mobs = inwardWildlife(sim);
    for (let t = 0; t < 40; t++) sim.tick();
    for (const mob of mobs)
      expect(Math.hypot(mob.pos.x - field.x, mob.pos.z - field.z), mob.templateId).toBeLessThan(
        SCARECROW_FIELD_WARD_RADIUS,
      );
  });

  it('keeps every boar and Mogger out of it while the event runs', () => {
    const sim = world(true);
    const field = resolveScarecrowField(WORLD_SEED);
    if (!field) throw new Error('no field');
    const mobs = inwardWildlife(sim);
    for (let t = 0; t < 40; t++) {
      sim.tick();
      for (const mob of mobs)
        expect(
          Math.hypot(mob.pos.x - field.x, mob.pos.z - field.z),
          mob.templateId,
        ).toBeGreaterThanOrEqual(SCARECROW_FIELD_WARD_RADIUS);
    }
    for (const mob of mobs) expect(mob.aiState).toBe('idle');
  });

  it('is deterministic: two worlds on one seed walk their wildlife identically', () => {
    const run = () => {
      const sim = world(true);
      for (let t = 0; t < 20 * 15; t++) sim.tick();
      return [...sim.entities.values()]
        .filter((e) => e.kind === 'mob' && e.templateId === 'wild_boar')
        .map((e) => [e.id, Math.round(e.pos.x * 1000), Math.round(e.pos.z * 1000)]);
    };
    expect(run()).toEqual(run());
  });
});
