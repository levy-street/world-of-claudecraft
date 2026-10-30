// Eastbrook's civic benches: the painted Eastbrook bench
// (public/models/props/eastbrook_painted_bench.glb) replaced the dungeon kit's
// bench on the square. Pinned here, against the shipped file itself:
//  - all three layout benches name the painted model and keep their 1.8 x 0.6
//    boxes, turns and ring;
//  - the sim's bench proportions (sim/prop_layout.ts) are the painted model's
//    own, so the standable seat the colliders build is the seat the renderer
//    draws: backless, its top a full-depth slab, 0.399 above the ground at the
//    civic fit, where the depth sets the scale because the trestle feet flare
//    a little past the seat (the kit bench stood 0.40);
//  - the model sits on the town's template frame (centred, base at y 0), so
//    the renderer's box fit and the Studio placement fit draw the same bench.
// Deliberately free of src/sim/data, so it runs without the world content.
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import {
  BENCH_NATIVE_DEPTH_PER_WIDTH,
  BENCH_NATIVE_HEIGHT_PER_WIDTH,
  benchDrawnHeight,
} from '../src/sim/prop_layout';

const BENCH_URL = '/models/props/eastbrook_painted_bench.glb';

async function readBench() {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const document = await io.read(path.join(__dirname, '..', 'public', BENCH_URL.slice(1)));
  const scene = document.getRoot().listScenes()[0];
  if (!scene) throw new Error('the painted bench has no scene');
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      triangles +=
        (primitive.getIndices()?.getCount() ??
          primitive.getAttribute('POSITION')?.getCount() ??
          0) / 3;
    }
  }
  return { document, bounds: getBounds(scene), triangles };
}

describe('the civic benches', () => {
  it('all stand the painted bench in their 1.8 x 0.6 boxes', () => {
    expect(EASTBROOK_LAYOUT.civic.benches).toHaveLength(3);
    for (const bench of EASTBROOK_LAYOUT.civic.benches) {
      expect(bench.assetId, bench.id).toBe(BENCH_URL);
      expect(bench.width, bench.id).toBe(1.8);
      expect(bench.depth, bench.id).toBe(0.6);
    }
  });

  it("carry the painted model's own proportions into the sim's standable seat", async () => {
    const { bounds } = await readBench();
    const width = bounds.max[0] - bounds.min[0];
    const height = bounds.max[1] - bounds.min[1];
    const depth = bounds.max[2] - bounds.min[2];
    expect(BENCH_NATIVE_HEIGHT_PER_WIDTH).toBeCloseTo(height / width, 4);
    expect(BENCH_NATIVE_DEPTH_PER_WIDTH).toBeCloseTo(depth / width, 4);
    // the seat the colliders build at the civic fit
    expect(benchDrawnHeight(1.8, 0.6)).toBeCloseTo(0.399, 3);
    // the renderer's fit of the same box: height follows the native aspect
    const fit = Math.min(1.8 / width, 0.6 / depth);
    expect(height * fit).toBeCloseTo(benchDrawnHeight(1.8, 0.6), 3);
  });

  it('is a backless bench on the town template frame', async () => {
    const { bounds, document } = await readBench();
    // centred on its origin with its base at y 0 (the town's template frame)
    expect(Math.abs((bounds.min[0] + bounds.max[0]) / 2)).toBeLessThan(0.01);
    expect(Math.abs((bounds.min[2] + bounds.max[2]) / 2)).toBeLessThan(0.01);
    expect(Math.abs(bounds.min[1])).toBeLessThan(0.01);
    // its top band spans the full depth: a seat slab, not a back rail
    const top = bounds.max[1];
    let lowZ = Number.POSITIVE_INFINITY;
    let highZ = Number.NEGATIVE_INFINITY;
    const element = [0, 0, 0];
    for (const node of document.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      // quantized positions: through the node's own transform into the scene
      const m = node.getWorldMatrix();
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        for (let index = 0; index < position.getCount(); index++) {
          position.getElement(index, element);
          const [x, y, z] = element;
          const sceneY = m[1] * x + m[5] * y + m[9] * z + m[13];
          const sceneZ = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (sceneY < top - 0.06) continue;
          lowZ = Math.min(lowZ, sceneZ);
          highZ = Math.max(highZ, sceneZ);
        }
      }
    }
    expect(highZ - lowZ).toBeGreaterThan((bounds.max[2] - bounds.min[2]) * 0.9);
  });
});
