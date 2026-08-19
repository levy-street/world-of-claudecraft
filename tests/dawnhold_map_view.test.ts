// Dawnhold Castle interior map pure core (the dawnhold surface of
// src/ui/lastkeep_map_view.ts): story banding by lift, the position-derived
// activation guard, plate geometry, the canvas-space draw models for both
// surfaces (driven with the real offline Sim AND a ClientWorld-mirror-shaped
// stub, asserting identical output), and the deterministic SVG plan source
// the baker + runtime fallback share.
import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../src/sim/data';
import { DAWNHOLD_ROOMS, dawnholdKeepLiftAt } from '../src/sim/dungeon_layout';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import {
  buildDawnholdMinimapModel,
  buildDawnholdWorldMapModel,
  DAWNHOLD_STORY_IDS,
  dawnholdLocal,
  dawnholdMapActive,
  dawnholdPlanBounds,
  dawnholdPlanSvg,
  dawnholdPlateSize,
  dawnholdStoryForLift,
  lastKeepMapActive,
} from '../src/ui/lastkeep_map_view';
import type { IWorld } from '../src/world_api';

const CASTLE_ORIGIN = instanceOrigin(DUNGEONS.dawnhold_castle.index, 0);

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });

// Enter the castle through the real door path, then optionally stand at an
// instance-local point (the same slot enterDungeon claimed).
function simInCastle(localX?: number, localZ?: number): Sim {
  const sim = makeSim();
  expect(enterDungeon((sim as any).ctx, 'dawnhold_castle', sim.player.id)).toBe(true);
  if (localX !== undefined && localZ !== undefined) {
    const origin = instanceOrigin(
      DUNGEONS.dawnhold_castle.index,
      instanceSlotForZ(sim.player.pos.z),
    );
    sim.player.pos.x = origin.x + localX;
    sim.player.pos.z = origin.z + localZ;
    sim.player.prevPos = { ...sim.player.pos };
  }
  return sim;
}

describe('story banding', () => {
  it('classifies every authored room lift into its story', () => {
    // Two bands, probed at the authored lifts (the half-landing stair
    // classifies with the solar story it climbs toward).
    expect(dawnholdStoryForLift(0)).toBe('ground');
    expect(dawnholdStoryForLift(1.5)).toBe('solar'); // the stair landing
    expect(dawnholdStoryForLift(3.0)).toBe('solar');
    // Every room maps into one of the two stories (total by construction).
    for (const room of DAWNHOLD_ROOMS) {
      expect(DAWNHOLD_STORY_IDS).toContain(dawnholdStoryForLift(room.lift ?? 0));
    }
  });

  it('resolves the story from live sim positions via dawnholdKeepLiftAt', () => {
    for (const [lx, lz, story] of [
      [0, -5, 'ground'], // the entrance hall
      [22, 8, 'ground'], // the conservatory
      [8, 31, 'solar'], // the stair landing
      [20, 40, 'solar'], // the solar
      [-17, 41, 'solar'], // the bedroom suite
    ] as const) {
      expect(dawnholdStoryForLift(dawnholdKeepLiftAt(lx, lz))).toBe(story);
    }
  });
});

describe('activation guard (position-derived, host-agnostic)', () => {
  it('is active only inside a dawnhold-interior instance', () => {
    expect(dawnholdLocal(0, 0)).toBeNull(); // overworld
    expect(dawnholdLocal(instanceOrigin(0, 0).x, instanceOrigin(0, 0).z)).toBeNull(); // a crypt
    // The Last Keep's instance (the sibling castle) must NOT activate this map.
    const keepOrigin = instanceOrigin(DUNGEONS.the_last_keep.index, 0);
    expect(dawnholdLocal(keepOrigin.x, keepOrigin.z)).toBeNull();
    const local = dawnholdLocal(CASTLE_ORIGIN.x + 4, CASTLE_ORIGIN.z - 5);
    expect(local).toEqual({
      originX: CASTLE_ORIGIN.x,
      originZ: CASTLE_ORIGIN.z,
      lx: 4,
      lz: -5,
    });
  });

  it('activates for a real sim player entering through the door path', () => {
    const sim = simInCastle();
    expect(dawnholdMapActive(sim)).toBe(true);
    // ...and never trips the sibling castle's guard.
    expect(lastKeepMapActive(sim)).toBe(false);
    const outside = makeSim();
    expect(dawnholdMapActive(outside)).toBe(false);
  });
});

describe('plate geometry', () => {
  it('covers every room with a margin, at a fixed integer pixel size', () => {
    const b = dawnholdPlanBounds();
    for (const room of DAWNHOLD_ROOMS) {
      expect(room.x0).toBeGreaterThan(b.minX);
      expect(room.x1).toBeLessThan(b.maxX);
      expect(room.z0).toBeGreaterThan(b.minZ);
      expect(room.z1).toBeLessThan(b.maxZ);
    }
    const { w, h } = dawnholdPlateSize();
    expect(Number.isInteger(w)).toBe(true);
    expect(Number.isInteger(h)).toBe(true);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });
});

describe('minimap model', () => {
  it('centers the player, places the plate by its world rect, and culls to the rim', () => {
    const S = 162;
    const ppy = 2;
    const sim = simInCastle(0, 0);
    const model = buildDawnholdMinimapModel(sim, S, ppy);
    expect(model).not.toBeNull();
    if (!model) return;
    const b = dawnholdPlanBounds();
    // Plate rect: player local (0,0) sits at canvas centre (81, 81).
    expect(model.plate.dx).toBeCloseTo(81 - b.maxX * ppy, 5);
    expect(model.plate.dy).toBeCloseTo(81 - b.maxZ * ppy, 5);
    expect(model.plate.dw).toBeCloseTo((b.maxX - b.minX) * ppy, 5);
    expect(model.plate.dh).toBeCloseTo((b.maxZ - b.minZ) * ppy, 5);
    // The player arrow is last, centered, angle = -facing.
    const player = model.markers[model.markers.length - 1];
    expect(player.kind).toBe('player');
    if (player.kind !== 'player') return;
    expect(player.cx).toBeCloseTo(81, 5);
    expect(player.cy).toBeCloseTo(81, 5);
    expect(player.angle).toBeCloseTo(-sim.player.facing, 5);
  });

  it('marks the exit portal and the lootable keepsake for a real sim host', () => {
    const sim = simInCastle(0, -5); // the entrance hall
    const model = buildDawnholdMinimapModel(sim, 162, 1.7);
    expect(model).not.toBeNull();
    if (!model) return;
    expect(model.storyId).toBe('ground'); // the entrance hall is the garden floor
    const kinds = model.markers.map((m) => m.kind);
    expect(kinds).toContain('exit'); // the door back out
    expect(kinds).toContain('loot'); // the posy keepsake
    expect(kinds[kinds.length - 1]).toBe('player');
  });

  it('selects the story plate from the player lift', () => {
    expect(buildDawnholdMinimapModel(simInCastle(22, 8), 162, 1.7)?.storyId).toBe('ground');
    expect(buildDawnholdMinimapModel(simInCastle(8, 31), 162, 1.7)?.storyId).toBe('solar');
    expect(buildDawnholdMinimapModel(simInCastle(20, 40), 162, 1.7)?.storyId).toBe('solar');
  });

  it('produces identical output for a Sim host and a ClientWorld-mirror-shaped stub', () => {
    const sim = simInCastle(0, -5);
    const expected = buildDawnholdMinimapModel(sim, 162, 1.7);
    // Mirror stub: the same positions as snapshot-shaped plain data (the online
    // mirror carries positions identically, so the model must be equal).
    const entities = new Map<number, unknown>();
    for (const [id, e] of (sim as any).entities as Map<number, any>) {
      entities.set(id, {
        id: e.id,
        kind: e.kind,
        templateId: e.templateId,
        lootable: e.lootable,
        pos: { ...e.pos },
      });
    }
    const stub = {
      player: {
        id: sim.player.id,
        pos: { ...sim.player.pos },
        facing: sim.player.facing,
      },
      entities,
      partyInfo: null,
    } as unknown as IWorld;
    expect(buildDawnholdMinimapModel(stub, 162, 1.7)).toEqual(expected);
  });

  it('draws party members inside the rim and culls the rest', () => {
    const near = { pid: 9, x: CASTLE_ORIGIN.x + 5, z: CASTLE_ORIGIN.z, dead: 0, cls: 'priest' };
    const far = { pid: 10, x: CASTLE_ORIGIN.x + 60, z: CASTLE_ORIGIN.z, dead: 1, cls: 'mage' };
    const stub = {
      player: { id: 1, pos: { x: CASTLE_ORIGIN.x, y: 0, z: CASTLE_ORIGIN.z }, facing: 0 },
      entities: new Map(),
      partyInfo: { members: [near, far] },
    } as unknown as IWorld;
    const model = buildDawnholdMinimapModel(stub, 162, 2);
    expect(model).not.toBeNull();
    if (!model) return;
    const party = model.markers.filter((m) => m.kind === 'party');
    expect(party).toEqual([
      // +X is map-left: the ally 5yd east of the player draws left of centre.
      { kind: 'party', cx: 71, cy: 81, cls: 'priest', dead: false },
    ]);
  });

  it('returns null outside the castle', () => {
    expect(buildDawnholdMinimapModel(makeSim(), 162, 1.7)).toBeNull();
  });
});

describe('world-map model', () => {
  it('frames the whole plan at a uniform scale and projects the player with it', () => {
    const S = 560;
    const pad = 34;
    const sim = simInCastle(0, -5);
    const model = buildDawnholdWorldMapModel(sim, S, pad);
    expect(model).not.toBeNull();
    if (!model) return;
    const b = dawnholdPlanBounds();
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    const scale = Math.min((S - pad * 2) / spanX, (S - pad * 2) / spanZ);
    expect(model.plate.dw).toBeCloseTo(spanX * scale, 5);
    expect(model.plate.dh).toBeCloseTo(spanZ * scale, 5);
    // Centered on both axes.
    expect(model.plate.dx).toBeCloseTo((S - spanX * scale) / 2, 5);
    expect(model.plate.dy).toBeCloseTo((S - spanZ * scale) / 2, 5);
    const player = model.markers[model.markers.length - 1];
    expect(player.kind).toBe('player');
    if (player.kind !== 'player') return;
    // The same uniform transform the plate uses (+X map-left, +Z map-up).
    expect(player.cx).toBeCloseTo(model.plate.dx + b.maxX * scale, 5);
    expect(player.cy).toBeCloseTo(model.plate.dy + (b.maxZ - -5) * scale, 5);
  });

  it('returns null outside the castle', () => {
    expect(buildDawnholdWorldMapModel(makeSim(), 560, 34)).toBeNull();
  });
});

describe('plan SVG source', () => {
  it('is deterministic and draws every room on every story plate', () => {
    for (const storyId of DAWNHOLD_STORY_IDS) {
      const svg = dawnholdPlanSvg(storyId);
      expect(svg).toBe(dawnholdPlanSvg(storyId));
      // Every room rect is present (stories sit side by side in plan; the
      // inactive ones stay as dimmed context), plus walls and stair rungs.
      const rects = svg.match(/<rect /g)?.length ?? 0;
      expect(rects).toBeGreaterThan(DAWNHOLD_ROOMS.length);
    }
    // The two story plates are genuinely different drawings.
    const unique = new Set(DAWNHOLD_STORY_IDS.map((s) => dawnholdPlanSvg(s)));
    expect(unique.size).toBe(DAWNHOLD_STORY_IDS.length);
  });
});
