import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { DungeonInteriors } from '../src/render/dungeon';
import { ARENA_LAYOUT } from '../src/sim/dungeon_layout';

interface PlacementCall {
  kind: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number | [number, number, number];
}

describe('arena cover rendering', () => {
  it('maps each visible cover wall footprint onto its authored collider', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.read('public/models/dungeon/wall.glb');
    const scene = document.getRoot().listScenes()[0];
    if (!scene) throw new Error('wall.glb has no scene');
    const bounds = getBounds(scene);
    expect(bounds.min[1]).toBeCloseTo(0, 6);
    expect(bounds.max[1]).toBeCloseTo(4, 6);

    const calls: PlacementCall[] = [];
    const placements = {
      add: (
        kind: string,
        x: number,
        y: number,
        z: number,
        rotY = 0,
        scale: number | [number, number, number] = 1,
      ) => calls.push({ kind, x, y, z, rotY, scale }),
    };
    const interiors = Object.create(DungeonInteriors.prototype) as DungeonInteriors;

    (
      interiors as unknown as {
        placeStubs(
          sink: typeof placements,
          stubs: typeof ARENA_LAYOUT.stubs,
          variant: 'arena',
        ): void;
      }
    ).placeStubs(placements, ARENA_LAYOUT.stubs, 'arena');

    expect(calls).toHaveLength(ARENA_LAYOUT.stubs.length);
    for (const [index, stub] of ARENA_LAYOUT.stubs.entries()) {
      const call = calls[index];
      expect(call.kind).toBe('wall');
      expect(call.y).toBe(0);
      expect(call.rotY).toBe(Math.PI / 2);
      expect(Array.isArray(call.scale)).toBe(true);
      if (!Array.isArray(call.scale)) throw new Error('arena cover requires non-uniform scale');

      // Transform the shipped GLB's real bounds with the same scale and
      // Y rotation Placements.add uses, including asset quantization.
      const [scaleX, , scaleZ] = call.scale;
      const corners = [bounds.min[0], bounds.max[0]].flatMap((localX) =>
        [bounds.min[2], bounds.max[2]].map((localZ) => ({
          x: call.x + Math.cos(call.rotY) * localX * scaleX + Math.sin(call.rotY) * localZ * scaleZ,
          z: call.z - Math.sin(call.rotY) * localX * scaleX + Math.cos(call.rotY) * localZ * scaleZ,
        })),
      );
      const xs = corners.map((corner) => corner.x);
      const zs = corners.map((corner) => corner.z);
      expect(Math.min(...xs)).toBeCloseTo(stub.x - stub.hw, 3);
      expect(Math.max(...xs)).toBeCloseTo(stub.x + stub.hw, 3);
      expect(Math.min(...zs)).toBeCloseTo(stub.z - stub.hd, 3);
      expect(Math.max(...zs)).toBeCloseTo(stub.z + stub.hd, 3);
    }
  });
});
