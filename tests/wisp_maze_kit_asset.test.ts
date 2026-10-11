// The shipped wisp maze kit (public/models/props/wisp_maze_kit.glb), built by
// scripts/assets/wisp_maze/build.mjs from the Blender source in
// docs/design/wisp-maze/. Pins the named pieces the runtime instances, the three
// materials it tells apart, the source fingerprint (a Blender source edited
// without re-running the builder reds here), the painted colours, the size, and
// the one geometric promise the maze depends on: every hedge piece stays inside
// its wall cell and under the wall height, so the kit never changes a sight line.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { ASSET, PIECES, sourceFingerprint } from '../scripts/assets/wisp_maze/build.mjs';
import { WISP_MAZE_WALL_HEIGHT } from '../src/render/wisp_maze_core';
import {
  WISP_GUARDIAN_CRESTS,
  WISP_MAZE_HEDGE_KINDS,
  WISP_MAZE_KIT_CELL,
  WISP_MAZE_KIT_URL,
} from '../src/render/wisp_maze_kit_core';

const BYTE_CEILING = 320_000;

async function readKit() {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return (await io.read(ASSET.target)).getRoot();
}

describe('the shipped wisp maze kit', () => {
  it('is the file the runtime fetches, built from a committed Blender source', () => {
    expect(ASSET.target).toBe(`public${WISP_MAZE_KIT_URL}`);
    expect(existsSync(ASSET.source), ASSET.source).toBe(true);
    expect(existsSync('docs/design/wisp-maze/build_wisp_maze_kit.py')).toBe(true);
    expect(statSync(ASSET.target).size).toBeLessThanOrEqual(BYTE_CEILING);
  });

  it('names every piece the runtime reads, and only those', () => {
    expect(PIECES).toEqual([
      ...WISP_MAZE_HEDGE_KINDS.map((kind) => `Hedge${kind}`),
      'LanternPost',
      'Flagstones',
      'Spirit',
      ...WISP_GUARDIAN_CRESTS,
    ]);
  });

  it('keeps its named parts, three materials, painted colours and fingerprint', async () => {
    const kit = await readKit();
    expect(
      kit
        .listNodes()
        .map((node) => node.getName())
        .sort(),
    ).toEqual(ASSET.nodes);
    expect(
      kit
        .listMaterials()
        .map((material) => material.getName())
        .sort(),
    ).toEqual(['KitGlow', 'KitSolid', 'KitTint']);
    const extras = kit.getExtras() as { authoring?: string; sourceFingerprint?: string };
    expect(extras.authoring).toBe('Blender');
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(kit.listTextures()).toHaveLength(0);
    let triangles = 0;
    for (const mesh of kit.listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
        // Vertex-painted: a part without its colours would draw black.
        expect(primitive.getAttribute('COLOR_0'), mesh.getName()).not.toBeNull();
        expect(primitive.getAttribute('NORMAL'), mesh.getName()).not.toBeNull();
      }
    }
    expect(triangles).toBeGreaterThan(3000);
    expect(triangles).toBeLessThan(14000);
  });

  it('gives the spirit a dyed body and lit eyes, and every crest a dyed part', async () => {
    const kit = await readKit();
    const materialsOf = (piece: string) =>
      (
        kit
          .listNodes()
          .find((node) => node.getName() === `Kit_${piece}`)
          ?.getMesh()
          ?.listPrimitives() ?? []
      )
        .map((primitive) => primitive.getMaterial()?.getName())
        .sort();
    expect(materialsOf('Spirit')).toEqual(['KitGlow', 'KitSolid', 'KitTint']);
    for (const crest of WISP_GUARDIAN_CRESTS) expect(materialsOf(crest)).toContain('KitTint');
    expect(materialsOf('LanternPost')).toContain('KitGlow');
    expect(materialsOf('HedgeGate')).toContain('KitGlow');
    for (const kind of WISP_MAZE_HEDGE_KINDS.filter((kind) => kind !== 'Gate'))
      expect(materialsOf(`Hedge${kind}`)).toEqual(['KitSolid']);
  });

  it('keeps every hedge piece inside its wall cell and under the wall height', async () => {
    const kit = await readKit();
    const half = WISP_MAZE_KIT_CELL / 2;
    // The sides each piece joins to a neighbouring WALL cell, unturned (north is
    // glTF -Z). Leaves may grow on across a joined side into the next hedge; an
    // exposed side faces a corridor and must stay inside the collision box.
    const joined: Record<string, string> = {
      Post: '',
      End: 'W',
      Straight: 'WE',
      Corner: 'ES',
      Tee: 'ESW',
      Cross: 'NESW',
      Gate: 'WE',
    };
    for (const kind of WISP_MAZE_HEDGE_KINDS) {
      const node = kit.listNodes().find((candidate) => candidate.getName() === `Kit_Hedge${kind}`);
      const bounds = getBounds(node!);
      const reach = (side: string) => (joined[kind].includes(side) ? half + 0.3 : half + 0.05);
      expect(-bounds.min[2], `${kind} north`).toBeLessThanOrEqual(reach('N'));
      expect(bounds.max[2], `${kind} south`).toBeLessThanOrEqual(reach('S'));
      expect(bounds.max[0], `${kind} east`).toBeLessThanOrEqual(reach('E'));
      expect(-bounds.min[0], `${kind} west`).toBeLessThanOrEqual(reach('W'));
      // ...and a joined side reaches the cell edge, so runs never gap.
      if (joined[kind].includes('E')) expect(bounds.max[0], kind).toBeGreaterThanOrEqual(half);
      expect(bounds.min[1], kind).toBeLessThan(0);
      if (kind === 'Gate') {
        // The entrance arch rises over the outer shell, never over a corridor.
        expect(bounds.max[1]).toBeLessThan(4);
      } else {
        expect(bounds.max[1], kind).toBeLessThanOrEqual(WISP_MAZE_WALL_HEIGHT + 0.05);
        expect(bounds.max[1], kind).toBeGreaterThanOrEqual(WISP_MAZE_WALL_HEIGHT - 0.05);
      }
    }
    const spirit = getBounds(kit.listNodes().find((node) => node.getName() === 'Kit_Spirit')!);
    // A spirit about as tall as the hunters it replaced (a hood near 1.8yd up).
    expect(spirit.max[1]).toBeGreaterThan(1.8);
    expect(spirit.max[1]).toBeLessThan(2.3);
    const stones = getBounds(kit.listNodes().find((node) => node.getName() === 'Kit_Flagstones')!);
    expect(stones.max[1]).toBeLessThan(0.1);
  });

  it('is shipped by the deferred world-content lane, never at import', () => {
    const painter = readFileSync('src/render/wisp_maze_kit.ts', 'utf8');
    expect(painter).toMatch(/registerDeferredPreload\(/);
    expect(painter).not.toMatch(/registerPreload\(/);
    expect(painter).toMatch(/releaseGltf\(WISP_MAZE_KIT_URL\)/);
  });
});
