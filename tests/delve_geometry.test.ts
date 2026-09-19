// Pure delve interior geometry (src/sim/delves/geometry.ts), extracted so the
// online self-motion predictor can collide against the same module bounds and
// door/prop solids the server does (issue #3480). Covers the pure clamp math
// directly, the client-side entity-to-solids derivation, and a parity pin
// proving clampDelveDoors (the server's ctx-based path) and
// clampDelveDoorSolids (the pure list-based path) agree for a real door.

import { describe, expect, it } from 'vitest';
import { DELVES } from '../src/sim/data';
import {
  clampDelveDoorSolids,
  DELVE_CHEST_SOLID_R,
  DELVE_DOOR_AISLE_HALF_DEPTH,
  DELVE_DOOR_AISLE_HALF_WIDTH,
  DELVE_GRAVE_SOLID_R,
  DELVE_WALL_SOLID_R,
  type DelveDoorClampSolid,
  delveDoorClampSolidsFromEntities,
} from '../src/sim/delves/geometry';
import { clampDelveDoors } from '../src/sim/delves/runs';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const R = PLAYER_BODY_RADIUS;

describe('clampDelveDoorSolids', () => {
  it('an empty solids list never moves the point', () => {
    expect(clampDelveDoorSolids([], 5, 5, R)).toEqual({ x: 5, z: 5 });
  });

  it('a closed portcullis blocks approach along its depth axis', () => {
    const solids: DelveDoorClampSolid[] = [{ kind: 'locked_door', x: 0, z: 0, hp: 1 }];
    const min = DELVE_DOOR_AISLE_HALF_DEPTH + R;
    const out = clampDelveDoorSolids(solids, 0, -min + 0.3, R);
    expect(out.z).toBeCloseTo(-min, 6);
    expect(out.x).toBe(0);
  });

  it('cannot be bypassed by skirting sideways within the wide aisle', () => {
    const solids: DelveDoorClampSolid[] = [{ kind: 'locked_door', x: 0, z: 0, hp: 1 }];
    const out = clampDelveDoorSolids(solids, DELVE_DOOR_AISLE_HALF_WIDTH - 1, -0.5, R);
    expect(Math.abs(out.z)).toBeCloseTo(DELVE_DOOR_AISLE_HALF_DEPTH + R, 6);
  });

  it('never blocks well outside the aisle width', () => {
    const solids: DelveDoorClampSolid[] = [{ kind: 'locked_door', x: 0, z: 0, hp: 1 }];
    const out = clampDelveDoorSolids(solids, DELVE_DOOR_AISLE_HALF_WIDTH + 5, 0, R);
    expect(out).toEqual({ x: DELVE_DOOR_AISLE_HALF_WIDTH + 5, z: 0 });
  });

  it.each([
    ['reward_chest', DELVE_CHEST_SOLID_R],
    ['locked_chest', DELVE_CHEST_SOLID_R],
    ['drowned_reliquary', DELVE_CHEST_SOLID_R],
    ['cracked_grave', DELVE_GRAVE_SOLID_R],
  ] as const)('%s pushes out to its own solid radius', (kind, radius) => {
    const solids: DelveDoorClampSolid[] = [{ kind, x: 10, z: 10, hp: 1 }];
    const out = clampDelveDoorSolids(solids, 10 + radius * 0.5, 10, R);
    expect(Math.hypot(out.x - 10, out.z - 10)).toBeCloseTo(radius + R, 6);
  });

  it('a destructible wall blocks only while hp is above zero', () => {
    const near = { x: 3, z: 0 };
    const intact: DelveDoorClampSolid[] = [{ kind: 'destructible_wall', x: 0, z: 0, hp: 80 }];
    const blocked = clampDelveDoorSolids(intact, near.x, near.z, R);
    expect(blocked.x).toBeCloseTo(DELVE_WALL_SOLID_R + R, 6);

    const broken: DelveDoorClampSolid[] = [{ kind: 'destructible_wall', x: 0, z: 0, hp: 0 }];
    expect(clampDelveDoorSolids(broken, near.x, near.z, R)).toEqual(near);
  });
});

describe('delveDoorClampSolidsFromEntities', () => {
  const ent = (
    over: Partial<Pick<Entity, 'templateId' | 'pos' | 'hp'>>,
  ): Pick<Entity, 'templateId' | 'pos' | 'hp'> => ({
    templateId: '',
    pos: { x: 0, y: 0, z: 0 },
    hp: 1,
    ...over,
  });

  it('keeps only the solid delve_<kind> templates, in encounter order', () => {
    const out = delveDoorClampSolidsFromEntities([
      ent({ templateId: 'delve_locked_door', pos: { x: 1, y: 0, z: 2 }, hp: 1 }),
      ent({ templateId: 'delve_destructible_wall', pos: { x: 3, y: 0, z: 4 }, hp: 40 }),
      // Pressure plates (closed or triggered) are never solid.
      ent({ templateId: 'delve_pressure_plate' }),
      ent({ templateId: 'delve_pressure_plate_triggered' }),
      // Not a delve object at all: a player/mob/open-world entity.
      ent({ templateId: '' }),
      ent({ templateId: 'forest_wolf' }),
    ]);
    expect(out).toEqual([
      { kind: 'locked_door', x: 1, z: 2, hp: 1 },
      { kind: 'destructible_wall', x: 3, z: 4, hp: 40 },
    ]);
  });

  it('an empty roster yields an empty solids list', () => {
    expect(delveDoorClampSolidsFromEntities([])).toEqual([]);
  });
});

// The parity pin the extraction exists to prove: the server's clampDelveDoors
// (built from run.objectIds/objectState) and the client's clampDelveDoorSolids
// fed by delveDoorClampSolidsFromEntities (built from the mirrored entities
// alone) must resolve identically for a real spawned door, or the online
// predictor could show a door as open when the server still has it closed.
describe('clampDelveDoors parity: server object-state derivation vs the client entity derivation', () => {
  it('agrees with the pure clamp for a real spawned door across a range of approaches', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel);
    const doorEntryPos = DELVES.collapsed_reliquary.doorPos;
    const p = sim.player;
    p.pos.x = doorEntryPos.x;
    p.pos.z = doorEntryPos.z;
    p.pos.y = terrainHeight(doorEntryPos.x, doorEntryPos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(p.id);
    if (!run) throw new Error('delve run did not spawn');
    run.modules = ['reliquary_sunken_ossuary'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const doorEntry = run.objectIds
      .map((id) => ({ id, state: run.objectState[id] }))
      .find((o) => o.state?.kind === 'locked_door');
    if (!doorEntry) throw new Error('module spawned no locked_door');
    const door = sim.entities.get(doorEntry.id);
    if (!door) throw new Error('door entity missing');

    const ctx = (sim as any).ctx;
    const clientSolids = delveDoorClampSolidsFromEntities(sim.entities.values());
    expect(clientSolids.some((s) => s.kind === 'locked_door')).toBe(true);

    const approaches: [number, number][] = [
      [0, -2],
      [0, -1.5],
      [0, -1],
      [5, -1],
      [-5, -1],
      [DELVE_DOOR_AISLE_HALF_WIDTH + 5, 0],
      [0, 2],
    ];
    for (const [dx, dz] of approaches) {
      const x = door.pos.x + dx;
      const z = door.pos.z + dz;
      const server = clampDelveDoors(ctx, run, x, z, R);
      const client = clampDelveDoorSolids(clientSolids, x, z, R);
      expect(client, `approach (${dx}, ${dz})`).toEqual(server);
    }

    // And once the door opens (dropped exactly like tickDelvePressurePlates
    // does), both derivations agree it no longer blocks anything.
    sim.entities.delete(doorEntry.id);
    const openSolids = delveDoorClampSolidsFromEntities(sim.entities.values());
    expect(openSolids.some((s) => s.kind === 'locked_door')).toBe(false);
    const x = door.pos.x;
    const z = door.pos.z - 1;
    expect(clampDelveDoorSolids(openSolids, x, z, R)).toEqual({ x, z });
  });
});
