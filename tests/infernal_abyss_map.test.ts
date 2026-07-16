import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { INFERNAL_ABYSS_LAYOUT } from '../src/sim/dungeon_layout';
import {
  infernalAbyssLocalToCanvas,
  infernalAbyssMapModel,
  infernalAbyssMapScale,
} from '../src/ui/infernal_abyss_map';
import { minimapMode } from '../src/ui/minimap_markers';
import type { IWorld } from '../src/world_api';

const SIZE = 162;
const PAD = 8;

function worldAt(x: number, z: number): IWorld {
  return {
    player: { id: 1, pos: { x, y: 0, z }, facing: 0 },
    entities: new Map(),
    delveRun: null,
  } as unknown as IWorld;
}

describe('Infernal Abyss minimap mode', () => {
  it('selects the schematic only in the Infernal Abyss dungeon band', () => {
    const infernalOrigin = instanceOrigin(DUNGEONS.infernal_abyss.index, 0);
    expect(minimapMode(worldAt(infernalOrigin.x, infernalOrigin.z))).toBe('infernalAbyss');
    expect(minimapMode(worldAt(0, 100))).toBe('overworld');
  });
});

describe('Infernal Abyss map projection', () => {
  it('uses one centered scale for both axes and mirrors X', () => {
    const rooms = INFERNAL_ABYSS_LAYOUT.rooms ?? [];
    const barriers = INFERNAL_ABYSS_LAYOUT.barriers ?? [];
    const minX = Math.min(
      ...rooms.map((room) => room.x0),
      ...barriers.map((wall) => wall.x - wall.hw),
    );
    const maxX = Math.max(
      ...rooms.map((room) => room.x1),
      ...barriers.map((wall) => wall.x + wall.hw),
    );
    const minZ = Math.min(
      ...rooms.map((room) => room.z0),
      ...barriers.map((wall) => wall.z - wall.hd),
    );
    const maxZ = Math.max(
      ...rooms.map((room) => room.z1),
      ...barriers.map((wall) => wall.z + wall.hd),
    );
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const scale = infernalAbyssMapScale(SIZE, PAD);
    const center = infernalAbyssLocalToCanvas(centerX, centerZ, SIZE, PAD);
    const x0 = infernalAbyssLocalToCanvas(minX, centerZ, SIZE, PAD);
    const x1 = infernalAbyssLocalToCanvas(maxX, centerZ, SIZE, PAD);
    const z0 = infernalAbyssLocalToCanvas(centerX, minZ, SIZE, PAD);
    const z1 = infernalAbyssLocalToCanvas(centerX, maxZ, SIZE, PAD);

    expect(center).toEqual({ cx: SIZE / 2, cy: SIZE / 2 });
    expect(x0.cx).toBeGreaterThan(x1.cx);
    expect((x0.cx - x1.cx) / (maxX - minX)).toBeCloseTo(scale);
    expect((z1.cy - z0.cy) / (maxZ - minZ)).toBeCloseTo(scale);
    expect(Math.max(x0.cx - x1.cx, z1.cy - z0.cy)).toBeCloseTo(SIZE - PAD * 2);
  });

  it('derives every room, door, and barrier primitive from the canonical layout', () => {
    const origin = instanceOrigin(DUNGEONS.infernal_abyss.index, 2);
    const room = (INFERNAL_ABYSS_LAYOUT.rooms ?? [])[0];
    const localX = (room.x0 + room.x1) / 2;
    const localZ = (room.z0 + room.z1) / 2;
    const model = infernalAbyssMapModel(worldAt(origin.x + localX, origin.z + localZ), SIZE, PAD);

    expect(model.rooms.map((room) => room.id)).toEqual(
      INFERNAL_ABYSS_LAYOUT.rooms?.map((room) => room.id),
    );
    expect(model.doors).toHaveLength(INFERNAL_ABYSS_LAYOUT.doors?.length ?? 0);
    expect(model.barriers).toHaveLength(INFERNAL_ABYSS_LAYOUT.barriers?.length ?? 0);
    const barrier = INFERNAL_ABYSS_LAYOUT.barriers?.[0];
    if (barrier) {
      const projected = model.barriers[0];
      const scale = infernalAbyssMapScale(SIZE, PAD);
      expect(projected.w).toBeCloseTo(barrier.hw * 2 * scale);
      expect(projected.h).toBeCloseTo(barrier.hd * 2 * scale);
    }
    expect(model.player).toMatchObject(infernalAbyssLocalToCanvas(localX, localZ, SIZE, PAD));
    expect(Math.abs(model.player.angle)).toBe(0);
  });

  it('projects lava geometry from decor scale, including non-damaging chasms', () => {
    const origin = instanceOrigin(DUNGEONS.infernal_abyss.index, 0);
    const model = infernalAbyssMapModel(worldAt(origin.x, origin.z), SIZE, PAD);
    const lavaDecor = (INFERNAL_ABYSS_LAYOUT.decor ?? []).filter((decor) =>
      ['lava_pool', 'lava_fissure', 'lava_chasm', 'lava_moat'].includes(decor.key),
    );

    expect(model.lava).toHaveLength(lavaDecor.length);
    for (let i = 0; i < lavaDecor.length; i++) {
      const decor = lavaDecor[i];
      const lava = model.lava[i];
      expect(lava).toMatchObject(infernalAbyssLocalToCanvas(decor.x, decor.z, SIZE, PAD));
      expect(lava.halfWidth).toBeGreaterThan(0);
      expect(lava.halfLength).toBeGreaterThan(0);
      if (decor.key === 'lava_chasm') {
        const scale = infernalAbyssMapScale(SIZE, PAD);
        expect(lava.kind).toBe('chasm');
        expect(lava.halfWidth).toBeCloseTo(((decor.scaleX ?? 12) / 2) * scale);
        expect(lava.halfLength).toBeCloseTo(((decor.scaleZ ?? 12) / 2) * scale);
      } else if (decor.key === 'lava_moat') {
        const scale = infernalAbyssMapScale(SIZE, PAD);
        expect(lava.kind).toBe('moat');
        expect(lava.innerHalfWidth).toBeCloseTo(
          ((decor.scaleX ?? 12) / 2) * (decor.innerScale ?? 0.68) * scale,
        );
        expect(lava.innerHalfLength).toBeCloseTo(
          ((decor.scaleZ ?? 12) / 2) * (decor.innerScale ?? 0.68) * scale,
        );
      }
    }
  });

  it('keeps live mob, party, corpse, and player markers on the same projection', () => {
    const origin = instanceOrigin(DUNGEONS.infernal_abyss.index, 1);
    const playerLocal = { x: 0, z: 30 };
    const mobLocal = { x: -10, z: 50 };
    const partyLocal = { x: 12, z: 110 };
    const corpseLocal = { x: 3, z: 40 };
    const world = {
      player: {
        id: 1,
        pos: { x: origin.x + playerLocal.x, y: 0, z: origin.z + playerLocal.z },
        facing: Math.PI / 2,
        ghost: true,
        corpsePos: { x: origin.x + corpseLocal.x, y: 0, z: origin.z + corpseLocal.z },
      },
      entities: new Map([
        [
          2,
          {
            kind: 'mob',
            dead: false,
            pos: { x: origin.x + mobLocal.x, y: 0, z: origin.z + mobLocal.z },
            aggroTargetId: 1,
          },
        ],
      ]),
      partyInfo: {
        members: [
          {
            pid: 3,
            x: origin.x + partyLocal.x,
            z: origin.z + partyLocal.z,
            cls: 'mage',
            dead: 0,
          },
        ],
      },
      delveRun: null,
    } as unknown as IWorld;
    const model = infernalAbyssMapModel(world, SIZE, PAD);

    expect(model.player).toMatchObject(
      infernalAbyssLocalToCanvas(playerLocal.x, playerLocal.z, SIZE, PAD),
    );
    expect(model.player.angle).toBe(-Math.PI / 2);
    expect(model.mobs[0]).toMatchObject({
      ...infernalAbyssLocalToCanvas(mobLocal.x, mobLocal.z, SIZE, PAD),
      aggro: true,
    });
    expect(model.party[0]).toMatchObject({
      ...infernalAbyssLocalToCanvas(partyLocal.x, partyLocal.z, SIZE, PAD),
      cls: 'mage',
      dead: false,
    });
    expect(model.corpse).toEqual(
      infernalAbyssLocalToCanvas(corpseLocal.x, corpseLocal.z, SIZE, PAD),
    );
  });
});
