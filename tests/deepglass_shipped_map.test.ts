// The Deepglass opens in Studio as a real, editable document.
//
// The arena is the one shipped venue built entirely in code, so this suite
// guards the conversion end to end: the document survives the editor's own
// sanitizer, it carries the venue flag (without which the map opens as a bare
// caldera), the things a maker should be able to grab are actually placements,
// and projecting it back yields a world the sim can boot.

import { describe, expect, it } from 'vitest';
import { customMapToWorldContent } from '../src/editor/custom_map';
import { assetIdFromModelPath, deepglassMap } from '../src/editor/shipped_deepglass';
import { createShippedMap, SHIPPED_MAPS } from '../src/editor/shipped_maps';
import { DG_MARKET_STALLS } from '../src/sim/content/deepglass_event';
import { TH_GATE_Z, TIDEHOLD_RESIDENTS } from '../src/sim/deepglass/citadel';
import { buildDeepglassWorld } from '../src/sim/deepglass/world';
import { sanitizeMapDoc } from '../src/sim/map_doc';

const doc = () => {
  const parsed = sanitizeMapDoc(JSON.parse(JSON.stringify(deepglassMap('The Deepglass', 'dg', 1))));
  if (!parsed) throw new Error('the Deepglass document did not survive sanitizeMapDoc');
  return parsed;
};

describe('assetIdFromModelPath', () => {
  it('rewrites a world model path into a catalogue id', () => {
    expect(assetIdFromModelPath('/models/props/streetlamp_veiled_crystal.glb')).toBe(
      'props/streetlamp_veiled_crystal',
    );
    expect(assetIdFromModelPath('models/deepglass/goal_gate.glb')).toBe('deepglass/goal_gate');
  });

  it('drops anything outside the model tree rather than minting a broken id', () => {
    expect(assetIdFromModelPath('/textures/foo.png')).toBeNull();
    expect(assetIdFromModelPath('/models/.glb')).toBeNull();
  });
});

describe('the Deepglass as a Studio document', () => {
  it('is offered in the shipped map list', () => {
    const entry = SHIPPED_MAPS.find((e) => e.id === 'deepglass');
    expect(entry).toBeDefined();
    expect(entry?.group).toBe('Arena');
  });

  it('keeps the venue flag through the sanitizer', () => {
    // Without this the bell, the stadium, the marshal, the crowd and the
    // market all vanish and the overworld's dungeon doors move in.
    expect(doc().presentationMode).toBe('deepglass');
  });

  it('carries the arena world over: terrain, parapet, lights, sound, crowd', () => {
    const world = buildDeepglassWorld();
    const d = doc();
    expect(d.terrainEdits.length).toBe(world.terrainEdits?.length ?? 0);
    expect(d.blockers?.length).toBe(world.blockers?.length ?? 0);
    expect(d.lights?.length).toBe(world.lights?.length ?? 0);
    expect(d.pointSounds?.length).toBe(world.pointSounds?.length ?? 0);
    expect(Object.keys(d.content.npcs ?? {}).length).toBe(Object.keys(world.npcs).length);
    expect(d.waterLevel).toBe(world.waterLevel);
    expect(d.worldHalfX).toBe(world.worldHalfX);
    // The arena dresses itself; the built-in overworld prop set must not be
    // spliced into a sky caldera.
    expect(d.propsMode).toBe('empty');
  });

  it('turns every lamp into a grabbable placement, collider and all', () => {
    const world = buildDeepglassWorld();
    // Count lamps against the world's LAMPS, not against its total placement
    // count. Those two were the same number only while the arena's dressing was
    // nothing but lamps; Tidehold's walls, houses and ships are placements too,
    // and the invariant this test exists for, every lamp survives the adapter
    // as a grabbable, colliding placement, is unchanged by them.
    const lampPath = '/models/props/streetlamp_veiled_crystal.glb';
    const worldLamps = (world.placements ?? []).filter((p) => p.path === lampPath);
    const lamps = doc().placements.filter((p) => p.assetId === 'props/streetlamp_veiled_crystal');
    expect(worldLamps.length).toBeGreaterThan(0);
    expect(lamps.length).toBe(worldLamps.length);
    for (const lamp of lamps) {
      expect(lamp.collide).toBe(true);
      expect(lamp.collisionMode).toBe('basic');
      expect(lamp.collideRadius).toBeGreaterThan(0);
    }
  });

  it('carries the whole Warden City into the document, not just the arena', () => {
    // Tidehold is authored through the same layers the arena is, so the Studio
    // adapter should pick it up with no adapter change at all. This pins that:
    // if a future ward stops round-tripping, it fails here rather than in a
    // maker's editor.
    const d = doc();
    const world = buildDeepglassWorld();
    // At LEAST the world's placements: the adapter also rebuilds the market
    // stalls (a document has no props field) and seeds the pylon colliders, so
    // the document is deliberately a superset.
    expect(d.placements.length).toBeGreaterThanOrEqual(world.placements?.length ?? 0);
    const cityPlacements = d.placements.filter((p) => p.z > TH_GATE_Z - 20);
    expect(cityPlacements.length).toBeGreaterThan(300);
    // Every district of the ring city is a named location a maker can see in
    // the scene tree (citadel_ring.ts ringLocations).
    for (const name of [
      'The Warden’s Seat',
      'The Glass Market',
      'Wardens’ Row',
      'Brinegate',
      'The Tidewharf',
      'Gullhaven',
    ]) {
      expect(
        d.locations?.some((l) => l.name === name),
        name,
      ).toBe(true);
    }
    // And its residents come across as content, not as scenery.
    for (const r of TIDEHOLD_RESIDENTS) {
      expect(d.content.npcs?.[r.def.id]).toBeDefined();
    }
  });

  it('rebuilds the market as placements, since a document has no props field', () => {
    const placements = doc().placements;
    // The ring city has stands of its own on the island; only the arena's
    // match-day market (within the terrace) is the adapter's rebuild.
    const stands = placements.filter(
      (p) => p.assetId.startsWith('props/market_stand_') && Math.hypot(p.x, p.z) < 110,
    );
    expect(stands.length).toBe(DG_MARKET_STALLS.length);
    // Each stand keeps its dressing, and the dressing is separately editable.
    const dressing = placements.filter((p) => p.name === 'Stall dressing');
    expect(dressing.length).toBe(DG_MARKET_STALLS.length * 2);
    for (const stall of DG_MARKET_STALLS) {
      expect(stands.some((s) => s.x === stall.x && s.z === stall.z)).toBe(true);
    }
  });

  it('ships editable collision for the stadium, clear of the entrance gap', () => {
    const colliders = doc().placements.filter((p) => p.assetId.startsWith('collider/'));
    // The thirteen buttress-leg boxes plus the arena world's own volume set
    // (world.ts stadiumColliderVolumes: bowl walls, causeway floors, cheeks,
    // colonnade and cradle rings), all carried over as editable placements.
    const worldVolumes = buildDeepglassWorld().colliderVolumes ?? [];
    expect(worldVolumes.length).toBeGreaterThan(0);
    expect(colliders.length).toBe(13 + worldVolumes.length);
    for (const c of colliders) {
      expect(c.collide).toBe(true);
      expect(c.hidden).toBe(true);
      expect((c.sizeY ?? 0) > 0).toBe(true);
    }
    // The way in must stay open: no BLOCKING volume may contain the causeway
    // centre line (a body walks up +z at x = 0). Planes never block, they are
    // walkable floors, so only boxes, walls and spheres are held to this.
    const body = 0.8;
    for (const c of colliders) {
      const kind = c.assetId.slice('collider/'.length);
      if (kind === 'plane') continue;
      for (let z = 52; z <= 100; z += 4) {
        const dx = 0 - c.x;
        const dz = z - c.z;
        let inside: boolean;
        if (kind === 'sphere') {
          inside = Math.hypot(dx, dz) < (c.sizeX ?? 0) / 2 + body;
        } else {
          const cos = Math.cos(c.rotY);
          const sin = Math.sin(c.rotY);
          const lx = dx * cos - dz * sin;
          const lz = dx * sin + dz * cos;
          inside =
            Math.abs(lx) < (c.sizeX ?? 0) / 2 + body && Math.abs(lz) < (c.sizeZ ?? 0) / 2 + body;
        }
        expect(
          inside,
          `collider at ${c.x.toFixed(1)},${c.z.toFixed(1)} blocks the way in at z=${z}`,
        ).toBe(false);
      }
    }
  });

  it('carries the ground paint into the document and back into the world', () => {
    // The texture painter's layer: Tidehold authors its plazas, cobbles and
    // frost lips as ordinary paint swatches. Losing this in either direction
    // would strip the whole painted city floor without any other test noticing.
    const world = buildDeepglassWorld();
    const d = doc();
    expect(world.biomePaint).toBeDefined();
    expect(d.biomePaint?.custom?.length).toBe(world.biomePaint?.custom?.length ?? 0);
    expect(d.biomePaint?.ids.length).toBe(world.biomePaint?.ids.length ?? 0);
    // And the projection puts it back on the world the sim boots.
    const projected = customMapToWorldContent(d);
    expect(projected.biomePaint?.custom?.length).toBe(world.biomePaint?.custom?.length ?? 0);
  });

  it('projects back into a bootable world with its collision intact', () => {
    const world = customMapToWorldContent(doc());
    expect(world.presentationMode).toBe('deepglass');
    // The collider placements become real collision volumes for the sim: the
    // thirteen buttress legs plus the arena world's own set, none lost.
    const arenaVolumes = buildDeepglassWorld().colliderVolumes ?? [];
    expect(world.colliderVolumes?.length).toBe(13 + arenaVolumes.length);
    expect((world.placements?.length ?? 0) > 0).toBe(true);
    // Every parapet segment survives the round trip. The projection also adds
    // the map's own perimeter walls, so the count is higher than the arena's
    // forty: assert the arena's segments are all still there rather than
    // pinning a total that belongs to the editor.
    const arena = buildDeepglassWorld().blockers ?? [];
    const projected = world.blockers ?? [];
    expect(projected.length).toBeGreaterThanOrEqual(arena.length);
    for (const seg of arena) {
      expect(
        projected.some(
          (p) =>
            Math.abs(p.x1 - seg.x1) < 1e-6 &&
            Math.abs(p.z1 - seg.z1) < 1e-6 &&
            Math.abs(p.x2 - seg.x2) < 1e-6 &&
            Math.abs(p.z2 - seg.z2) < 1e-6,
        ),
        `parapet segment ${seg.x1},${seg.z1} lost in projection`,
      ).toBe(true);
    }
  });

  it('hands out fresh documents rather than sharing arrays with the arena', async () => {
    const first = await createShippedMap('deepglass', 'first', 1);
    const second = await createShippedMap('deepglass', 'second', 2);
    first.placements[0].x += 99;
    expect(second.placements[0].x).not.toBe(first.placements[0].x);
    // And editing the document must not mutate the live arena world.
    expect(buildDeepglassWorld().placements?.[0]?.x).not.toBe(first.placements[0].x);
  });
});

describe('the stair blocks (one solid inline built model per flight)', () => {
  it('use the real built-model path, stay cheap, and survive the Studio adapter', async () => {
    const { MODEL_PATH, MODEL_ASSET_ID } = await import('../src/sim/map_doc');
    const { ringPlacements: citadelPlacements, ringColliderVolumes: citadelColliderVolumes } =
      await import('../src/sim/deepglass/citadel_ring');
    const all = citadelPlacements();
    const blocks = all.filter((p) => p.path === MODEL_PATH);
    // Ring city: four avenues x two tier edges, plus the Tideway's arena end.
    expect(blocks.length).toBe(9);
    let triangles = 0;
    for (const b of blocks) {
      const mesh = b.meshes?.[0];
      expect(mesh).toBeDefined();
      if (!mesh) continue;
      // Per step: ten shared vertices; a top, a riser and two side walls (8
      // triangles), plus one head-end quad for the flight. No bottoms, no
      // buried faces.
      const steps = mesh.verts.length / 3 / 10;
      expect(Number.isInteger(steps)).toBe(true);
      expect(steps).toBeGreaterThan(0);
      expect(mesh.tris.length).toBe((8 * steps + 2) * 3);
      triangles += mesh.tris.length / 3;
      expect(b.detached).toBe(true);
      expect(b.collideRadius ?? 0).toBe(0); // the floor is the plane, not the block
      // The Warden Cobbles at the street paint's tile (SPACEY 2026-09-07): one
      // material with the cobbled ground beside the flight.
      expect(b.modelTexId).toBe('Cobblestone001');
      expect(b.modelTexTile).toBe(6);
    }
    // The old courses of cobble slabs cost ~112,000 triangles across the city;
    // the blocks come to ~2,850 (eight a step, ~340 steps).
    expect(triangles).toBeLessThan(4000);
    expect(all.some((p) => p.path === '/models/props/stone_step.glb')).toBe(false);
    // One sloped walking floor per flight: pitched about x on the north/south
    // avenues, rolled about z on the east/west ones (world.ts tilts in world
    // axes), never both.
    const floors = citadelColliderVolumes();
    expect(floors.length).toBe(9);
    for (const f of floors) {
      expect(f.kind).toBe('plane');
      const pitched = Math.abs(f.rotX ?? 0) > 0.05;
      const rolled = Math.abs(f.rotZ ?? 0) > 0.05;
      expect(pitched !== rolled).toBe(true);
      expect(f.detached).toBe(true);
    }
    const { deepglassMap } = await import('../src/editor/shipped_deepglass');
    const doc = deepglassMap('Deepglass', 'test', 0);
    const docBlocks = doc.placements.filter((p) => p.assetId === MODEL_ASSET_ID);
    expect(docBlocks.length).toBe(9);
    expect(docBlocks[0].meshes?.[0].tris.length).toBe(blocks[0].meshes?.[0].tris.length);
    expect(docBlocks[0].modelTexTile).toBe(6);
  });
});
