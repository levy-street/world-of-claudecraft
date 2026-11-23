import { describe, expect, it } from 'vitest';
import { buildCampPreviewEntities } from '../src/editor/camp_preview';
import {
  applyCampMobTuning,
  campStatModsAreStock,
  MAX_CAMP_RESPAWN_SECONDS,
  MOB_STAT_MOD_MAX,
  MOB_STAT_MOD_MIN,
} from '../src/sim/camp_authoring';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { updateMobRoute } from '../src/sim/npc_routes';
import type { SimContext } from '../src/sim/sim_context';
import type { CampDef, Entity } from '../src/sim/types';

// The editor Mob tool authors per-mob tuning onto the mob's own one-mob camp:
// stat multipliers, a respawn delay, and a patrol route. The contract that
// matters is that all three are INERT when unauthored (shipped-world spawns
// must stay byte-identical) and land exactly once when they are.

const TEMPLATE = MOBS.forest_wolf;

function camp(extra: Partial<CampDef> = {}): CampDef {
  return { mobId: 'forest_wolf', center: { x: 0, z: 0 }, radius: 1, count: 1, ...extra };
}

function wolf(): Entity {
  return createMob(1, TEMPLATE, 10, { x: 0, y: 0, z: 0 });
}

describe('applyCampMobTuning', () => {
  it('leaves a stock camp byte-identical', () => {
    const stock = wolf();
    const tuned = wolf();
    applyCampMobTuning(camp(), tuned);
    expect(tuned).toEqual(stock);
  });

  it('multiplies health, damage, armor, speed, swing, and size', () => {
    const base = wolf();
    const mob = wolf();
    applyCampMobTuning(
      camp({
        statMods: {
          health: 3,
          damage: 2,
          armor: 0.5,
          moveSpeed: 1.5,
          attackSpeed: 0.5,
          scale: 2,
        },
      }),
      mob,
    );
    expect(mob.maxHp).toBe(Math.round(base.maxHp * 3));
    expect(mob.hp).toBe(mob.maxHp);
    expect(mob.weapon.min).toBe(Math.round(base.weapon.min * 2));
    expect(mob.weapon.max).toBe(Math.round(base.weapon.max * 2));
    expect(mob.stats.armor).toBe(Math.round(base.stats.armor * 0.5));
    expect(mob.moveSpeed).toBeCloseTo(base.moveSpeed * 1.5, 6);
    expect(mob.weapon.speed).toBeCloseTo(base.weapon.speed * 0.5, 6);
    expect(mob.scale).toBeCloseTo(base.scale * 2, 6);
  });

  it('clamps out-of-range multipliers instead of minting an absurd mob', () => {
    const base = wolf();
    const mob = wolf();
    applyCampMobTuning(camp({ statMods: { health: 1e6, damage: 0 } }), mob);
    expect(mob.maxHp).toBe(Math.round(base.maxHp * MOB_STAT_MOD_MAX));
    expect(mob.weapon.min).toBe(Math.max(1, Math.round(base.weapon.min * MOB_STAT_MOD_MIN)));
  });

  it('clamps the authored respawn delay and copies the route without aliasing', () => {
    const source = camp({
      respawnSeconds: 99_999,
      route: {
        points: [
          { x: 0, z: 0 },
          { x: 10, z: 0 },
        ],
        mode: 'loop',
      },
    });
    const mob = wolf();
    applyCampMobTuning(source, mob);
    expect(mob.campRespawnSeconds).toBe(MAX_CAMP_RESPAWN_SECONDS);
    expect(mob.route?.points).toHaveLength(2);
    // A live mob must never mutate the shared map document through its route.
    expect(mob.route?.points[0]).not.toBe(source.route?.points[0]);
  });

  it('ignores a one-point route (the walker needs a segment)', () => {
    const mob = wolf();
    applyCampMobTuning(camp({ route: { points: [{ x: 5, z: 5 }], mode: 'loop' } }), mob);
    expect(mob.route).toBeUndefined();
  });
});

describe('campStatModsAreStock', () => {
  it('treats absent, empty, and all-ones stacks as stock', () => {
    expect(campStatModsAreStock(undefined)).toBe(true);
    expect(campStatModsAreStock({})).toBe(true);
    expect(campStatModsAreStock({ health: 1, damage: 1 })).toBe(true);
    expect(campStatModsAreStock({ health: 1.05 })).toBe(false);
  });
});

// A stub context exposing only what updateMobRoute consumes: a straight-line
// mover that reports arrival, exactly like the real ctx.moveToward.
function routeCtx(step = 1): SimContext {
  return {
    moveToward(e: Entity, dest: { x: number; z: number }): boolean {
      const dx = dest.x - e.pos.x;
      const dz = dest.z - e.pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= step) {
        e.pos.x = dest.x;
        e.pos.z = dest.z;
        return true;
      }
      e.pos.x += (dx / distance) * step;
      e.pos.z += (dz / distance) * step;
      return false;
    },
  } as unknown as SimContext;
}

describe('updateMobRoute', () => {
  it('declines to drive a mob with no route, so the stock wander still runs', () => {
    expect(updateMobRoute(routeCtx(), wolf())).toBe(false);
  });

  it('walks the waypoints and wraps in loop mode', () => {
    const mob = wolf();
    applyCampMobTuning(
      camp({
        route: {
          points: [
            { x: 0, z: 0 },
            { x: 3, z: 0 },
          ],
          mode: 'loop',
        },
      }),
      mob,
    );
    const ctx = routeCtx();
    expect(updateMobRoute(ctx, mob)).toBe(true); // arrives at point 0 immediately
    expect(mob.routeIdx).toBe(1);
    for (let tick = 0; tick < 3; tick++) updateMobRoute(ctx, mob);
    expect(mob.pos.x).toBeCloseTo(3, 6);
    expect(mob.routeIdx).toBe(0); // wrapped back to the head of the loop
  });

  it('bounces at either end in pingpong mode', () => {
    const mob = wolf();
    applyCampMobTuning(
      camp({
        route: {
          points: [
            { x: 0, z: 0 },
            { x: 2, z: 0 },
          ],
          mode: 'pingpong',
        },
      }),
      mob,
    );
    const ctx = routeCtx();
    updateMobRoute(ctx, mob); // arrive point 0 -> target point 1
    expect(mob.routeIdx).toBe(1);
    updateMobRoute(ctx, mob);
    updateMobRoute(ctx, mob); // arrive point 1 -> bounce back to point 0
    expect(mob.routeIdx).toBe(0);
    expect(mob.routeDir).toBe(-1);
  });

  it('holds position while a waypoint pause burns down', () => {
    const mob = wolf();
    applyCampMobTuning(
      camp({
        route: {
          points: [
            { x: 0, z: 0, wait: 5 },
            { x: 4, z: 0 },
          ],
          mode: 'loop',
        },
      }),
      mob,
    );
    const ctx = routeCtx();
    updateMobRoute(ctx, mob);
    expect(mob.routeWaitLeft).toBe(5);
    updateMobRoute(ctx, mob);
    expect(mob.routeWaitLeft).toBeLessThan(5);
    expect(mob.pos.x).toBe(0); // parked, not walking
  });

  it('drags the leash home along the path so a patroller can be pulled', () => {
    const mob = wolf();
    applyCampMobTuning(
      camp({
        route: {
          points: [
            { x: 0, z: 0 },
            { x: 40, z: 0 },
          ],
          mode: 'loop',
        },
      }),
      mob,
    );
    const ctx = routeCtx(2);
    for (let tick = 0; tick < 6; tick++) updateMobRoute(ctx, mob);
    expect(mob.pos.x).toBeGreaterThan(5);
    expect(mob.spawnPos.x).toBeCloseTo(mob.pos.x, 6);
    expect(mob.spawnPos.z).toBeCloseTo(mob.pos.z, 6);
  });
});

describe('editor camp preview', () => {
  it('shows the authored size so the viewport matches what playtest spawns', () => {
    const previews = buildCampPreviewEntities(
      [camp({ statMods: { scale: 2.5 } })],
      1234,
      1,
      () => 0,
    );
    expect(previews).toHaveLength(1);
    expect(previews[0].scale).toBeCloseTo(TEMPLATE.scale * 2.5, 6);
  });
});

describe('sanitizeMapDoc mob tuning', () => {
  const doc = (campRaw: Record<string, unknown>): Record<string, unknown> => ({
    version: 2,
    meta: { id: 'm1', name: 'Map', seed: 7 },
    content: {
      zones: [
        { id: 'z', name: 'Z', zMin: -10, zMax: 100, hub: { x: 0, z: 0, radius: 5, name: 'H' } },
      ],
      camps: [campRaw],
      npcs: {},
      objects: [],
      roads: [],
    },
    terrainEdits: [],
    placements: [],
  });

  it('round-trips clamped stat mods, respawn, and a patrol route', () => {
    const parsed = sanitizeMapDoc(
      doc({
        mobId: 'forest_wolf',
        center: { x: 1, z: 2 },
        radius: 3,
        count: 1,
        statMods: { health: 500, damage: 1.5, bogus: 4 },
        respawnSeconds: 0,
        route: {
          points: [
            { x: 0, z: 0, wait: 3 },
            { x: 9, z: 9 },
          ],
          mode: 'pingpong',
          speed: 999,
        },
      }),
    );
    const saved = parsed?.content.camps[0];
    expect(saved?.statMods).toEqual({ health: MOB_STAT_MOD_MAX, damage: 1.5 });
    expect(saved?.respawnSeconds).toBe(1);
    expect(saved?.route?.mode).toBe('pingpong');
    expect(saved?.route?.points).toHaveLength(2);
    expect(saved?.route?.speed).toBe(8);
  });

  it('drops an all-default stat stack and an unusable route', () => {
    const parsed = sanitizeMapDoc(
      doc({
        mobId: 'forest_wolf',
        center: { x: 1, z: 2 },
        radius: 3,
        count: 1,
        statMods: { health: 1, damage: 1 },
        route: { points: [{ x: 0, z: 0 }], mode: 'loop' },
      }),
    );
    const saved = parsed?.content.camps[0];
    expect(saved?.statMods).toBeUndefined();
    expect(saved?.route).toBeUndefined();
  });
});
