// The Last Keep interior map pure core (src/ui/lastkeep_map_view.ts): story
// banding by lift, the position-derived activation guard, plate geometry, the
// canvas-space draw models for both surfaces (driven with the real offline Sim
// AND a ClientWorld-mirror-shaped stub, asserting identical output), and the
// deterministic SVG plan source the baker + runtime fallback share.
import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../src/sim/data';
import { LASTKEEP_ROOMS, lastKeepLiftAt } from '../src/sim/dungeon_layout';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import {
  buildLastKeepMinimapModel,
  buildLastKeepWorldMapModel,
  LASTKEEP_STORY_IDS,
  lastKeepLocal,
  lastKeepMapActive,
  lastKeepPlanBounds,
  lastKeepPlanSvg,
  lastKeepPlateSize,
  lastKeepStoryForLift,
} from '../src/ui/lastkeep_map_view';
import type { IWorld } from '../src/world_api';

const KEEP_ORIGIN = instanceOrigin(DUNGEONS.the_last_keep.index, 0);

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });

// Enter the keep through the real door path, then optionally stand at an
// instance-local point (the same slot enterDungeon claimed).
function simInKeep(localX?: number, localZ?: number): Sim {
  const sim = makeSim();
  expect(enterDungeon((sim as any).ctx, 'the_last_keep', sim.player.id)).toBe(true);
  if (localX !== undefined && localZ !== undefined) {
    const origin = instanceOrigin(DUNGEONS.the_last_keep.index, instanceSlotForZ(sim.player.pos.z));
    sim.player.pos.x = origin.x + localX;
    sim.player.pos.z = origin.z + localZ;
    sim.player.prevPos = { ...sim.player.pos };
  }
  return sim;
}

describe('story banding', () => {
  it('classifies every authored room lift into its story', () => {
    // The four bands, probed at the authored lifts (stairs classify with the
    // story they climb toward; the throne dais stays on the state floor).
    expect(lastKeepStoryForLift(0)).toBe('undercroft'); // gaol / cells / cellar
    expect(lastKeepStoryForLift(1.5)).toBe('undercroft'); // gaol stair landing
    expect(lastKeepStoryForLift(3.0)).toBe('state');
    expect(lastKeepStoryForLift(4.2)).toBe('state'); // throne dais
    expect(lastKeepStoryForLift(4.5)).toBe('residence'); // grand/servants stair
    expect(lastKeepStoryForLift(6.0)).toBe('residence');
    expect(lastKeepStoryForLift(7.5)).toBe('tower'); // tower stair
    expect(lastKeepStoryForLift(9.0)).toBe('tower'); // the lookout
    // Every room maps into one of the four stories (total by construction).
    for (const room of LASTKEEP_ROOMS) {
      expect(LASTKEEP_STORY_IDS).toContain(lastKeepStoryForLift(room.lift ?? 0));
    }
  });

  it('resolves the story from live sim positions via lastKeepLiftAt', () => {
    for (const [lx, lz, story] of [
      [26, 0, 'undercroft'], // the gaol corridor
      [0, 26, 'state'], // the great hall
      [0, 84, 'residence'], // the solar
      [33, 95, 'tower'], // the lookout
    ] as const) {
      expect(lastKeepStoryForLift(lastKeepLiftAt(lx, lz))).toBe(story);
    }
  });
});

describe('activation guard (position-derived, host-agnostic)', () => {
  it('is active only inside a lastkeep-interior instance', () => {
    expect(lastKeepLocal(0, 0)).toBeNull(); // overworld
    expect(lastKeepLocal(instanceOrigin(0, 0).x, instanceOrigin(0, 0).z)).toBeNull(); // a crypt
    const local = lastKeepLocal(KEEP_ORIGIN.x + 4, KEEP_ORIGIN.z - 5);
    expect(local).toEqual({
      originX: KEEP_ORIGIN.x,
      originZ: KEEP_ORIGIN.z,
      lx: 4,
      lz: -5,
    });
  });

  it('activates for a real sim player entering through the door path', () => {
    const sim = simInKeep();
    expect(lastKeepMapActive(sim)).toBe(true);
    const outside = makeSim();
    expect(lastKeepMapActive(outside)).toBe(false);
  });
});

describe('plate geometry', () => {
  it('covers every room with a margin, at a fixed integer pixel size', () => {
    const b = lastKeepPlanBounds();
    for (const room of LASTKEEP_ROOMS) {
      expect(room.x0).toBeGreaterThan(b.minX);
      expect(room.x1).toBeLessThan(b.maxX);
      expect(room.z0).toBeGreaterThan(b.minZ);
      expect(room.z1).toBeLessThan(b.maxZ);
    }
    const { w, h } = lastKeepPlateSize();
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
    const sim = simInKeep(0, 0);
    const model = buildLastKeepMinimapModel(sim, S, ppy);
    expect(model).not.toBeNull();
    if (!model) return;
    const b = lastKeepPlanBounds();
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
    const sim = simInKeep(0, -5); // the entrance hall
    const model = buildLastKeepMinimapModel(sim, 162, 1.7);
    expect(model).not.toBeNull();
    if (!model) return;
    expect(model.storyId).toBe('state'); // the entrance hall is the state floor
    const kinds = model.markers.map((m) => m.kind);
    expect(kinds).toContain('exit'); // the door back out
    expect(kinds).toContain('loot'); // the signet keepsake
    expect(kinds[kinds.length - 1]).toBe('player');
  });

  it('selects the story plate from the player lift', () => {
    expect(buildLastKeepMinimapModel(simInKeep(26, 0), 162, 1.7)?.storyId).toBe('undercroft');
    expect(buildLastKeepMinimapModel(simInKeep(0, 49), 162, 1.7)?.storyId).toBe('state');
    expect(buildLastKeepMinimapModel(simInKeep(0, 72), 162, 1.7)?.storyId).toBe('residence');
    expect(buildLastKeepMinimapModel(simInKeep(33, 95), 162, 1.7)?.storyId).toBe('tower');
  });

  it('produces identical output for a Sim host and a ClientWorld-mirror-shaped stub', () => {
    const sim = simInKeep(0, -5);
    const expected = buildLastKeepMinimapModel(sim, 162, 1.7);
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
    expect(buildLastKeepMinimapModel(stub, 162, 1.7)).toEqual(expected);
  });

  it('draws party members inside the rim and culls the rest', () => {
    const near = { pid: 9, x: KEEP_ORIGIN.x + 5, z: KEEP_ORIGIN.z, dead: 0, cls: 'priest' };
    const far = { pid: 10, x: KEEP_ORIGIN.x + 60, z: KEEP_ORIGIN.z, dead: 1, cls: 'mage' };
    const stub = {
      player: { id: 1, pos: { x: KEEP_ORIGIN.x, y: 0, z: KEEP_ORIGIN.z }, facing: 0 },
      entities: new Map(),
      partyInfo: { members: [near, far] },
    } as unknown as IWorld;
    const model = buildLastKeepMinimapModel(stub, 162, 2);
    expect(model).not.toBeNull();
    if (!model) return;
    const party = model.markers.filter((m) => m.kind === 'party');
    expect(party).toEqual([
      // +X is map-left: the ally 5yd east of the player draws left of centre.
      { kind: 'party', cx: 71, cy: 81, cls: 'priest', dead: false },
    ]);
  });

  it('returns null outside the keep', () => {
    expect(buildLastKeepMinimapModel(makeSim(), 162, 1.7)).toBeNull();
  });
});

describe('world-map model', () => {
  it('frames the whole plan at a uniform scale and projects the player with it', () => {
    const S = 560;
    const pad = 34;
    const sim = simInKeep(0, -5);
    const model = buildLastKeepWorldMapModel(sim, S, pad);
    expect(model).not.toBeNull();
    if (!model) return;
    const b = lastKeepPlanBounds();
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

  it('returns null outside the keep', () => {
    expect(buildLastKeepWorldMapModel(makeSim(), 560, 34)).toBeNull();
  });
});

describe('plan SVG source', () => {
  it('is deterministic and draws every room on every story plate', () => {
    for (const storyId of LASTKEEP_STORY_IDS) {
      const svg = lastKeepPlanSvg(storyId);
      expect(svg).toBe(lastKeepPlanSvg(storyId));
      // Every room rect is present (stories sit side by side in plan; the
      // inactive ones stay as dimmed context), plus walls and stair rungs.
      const rects = svg.match(/<rect /g)?.length ?? 0;
      expect(rects).toBeGreaterThan(LASTKEEP_ROOMS.length);
    }
    // The four story plates are genuinely different drawings.
    const unique = new Set(LASTKEEP_STORY_IDS.map((s) => lastKeepPlanSvg(s)));
    expect(unique.size).toBe(LASTKEEP_STORY_IDS.length);
  });
});
