// The headlight positions, checked against the SHIPPED mesh.
//
// Same reasoning as the exhaust ports: the lamp circles are bare primitives
// inside the Chassis mesh with no empties to hang a name on, so their offsets
// are constants measured off this export and a re-rip is the one thing that
// silently invalidates them. Without this, a new model leaves four glowing
// spheres floating in front of a car that no longer has lamps there.
//
// Positions are re-derived here rather than asserted from the constants.

import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RALLYCART_HEADLIGHTS } from '../src/render/vehicle_headlights';

const MODEL = 'public/models/mounts/rallycart_rxt.glb';

interface Gltf {
  nodes: { name?: string; mesh?: number }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: {
    bufferView: number;
    byteOffset?: number;
    min: number[];
    max: number[];
    count: number;
  }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

function load(): { json: Gltf; bin: Buffer } {
  const buf = fs.readFileSync(MODEL);
  const len = buf.readUInt32LE(12);
  return {
    json: JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as Gltf,
    bin: buf.subarray(20 + len + 8),
  };
}

/** Vertices of one primitive. HONOURS byteStride: these buffers interleave at
 *  stride 32, and ignoring it hands back normals instead of positions. */
function positions(json: Gltf, bin: Buffer, accessor: number): number[][] {
  const acc = json.accessors[accessor];
  const view = json.bufferViews[acc.bufferView];
  const stride = view.byteStride ?? 12;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[][] = [];
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    out.push([bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8)]);
  }
  return out;
}

describe('rallycart headlights', () => {
  it('still finds a lamp circle at every position the code lights', () => {
    const { json, bin } = load();
    const chassis = json.nodes.find((n) => n.name === 'Chassis');
    expect(chassis?.mesh, 'Chassis mesh missing: the rig contract changed').toBeDefined();
    const prims = json.meshes[chassis?.mesh as number].primitives;

    // Every primitive at the front of the car, described by its front face.
    //
    // A primitive is described THREE times: whole, and each half either side of
    // its own midpoint. The housing carries both bowls on one primitive AND
    // sweeps back toward the outer edge, so a single front-face pass over the
    // whole thing is dominated by the inboard bowl and the outboard one is
    // invisible to it. Splitting is what lets this see all four lamps; without
    // it the guard silently covers half of them.
    const faceCircle = (verts: number[][]) => {
      if (verts.length < 20) return null;
      const maxZ = Math.max(...verts.map((v) => v[2]));
      const face = verts.filter((v) => v[2] > maxZ - 0.02);
      if (face.length < 20) return null;
      const cx = face.reduce((s, v) => s + v[0], 0) / face.length;
      const cy = face.reduce((s, v) => s + v[1], 0) / face.length;
      const radius = Math.max(...face.map((v) => Math.hypot(v[0] - cx, v[1] - cy)));
      return { cx, cy, cz: maxZ, radius };
    };
    const circles = prims
      .flatMap((p) => {
        const acc = json.accessors[p.attributes.POSITION];
        if (acc.max[2] < 0.35) return [];
        const verts = positions(json, bin, p.attributes.POSITION);
        const mid = (acc.min[0] + acc.max[0]) / 2;
        return [
          faceCircle(verts),
          faceCircle(verts.filter((v) => v[0] < mid)),
          faceCircle(verts.filter((v) => v[0] >= mid)),
        ];
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    for (const lamp of RALLYCART_HEADLIGHTS) {
      // Nearest by centre AND radius. Centre alone is ambiguous here, because
      // the half-splits overlap the whole-primitive circle, so several
      // candidates sit near any one lamp.
      const near = circles.filter(
        (c) => Math.abs(c.cx - lamp.x) < 0.02 && Math.abs(c.cy - lamp.y) < 0.03,
      );
      const match = near.sort(
        (a, b) => Math.abs(a.radius - lamp.radius) - Math.abs(b.radius - lamp.radius),
      )[0];
      expect(
        match,
        `no lamp circle near x=${lamp.x}, y=${lamp.y}. The nose moved: re-measure ` +
          'RALLYCART_HEADLIGHTS, or add named empties and stop guessing.',
      ).toBeDefined();
      // A sphere much larger than its circle pokes out of the housing.
      expect(lamp.radius).toBeLessThanOrEqual((match?.radius ?? 0) + 0.005);
    }
  });

  it('keeps two lamps a side, symmetric about the centreline', () => {
    const left = RALLYCART_HEADLIGHTS.filter((l) => l.x < 0);
    const right = RALLYCART_HEADLIGHTS.filter((l) => l.x > 0);
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(2);
    // Mirrored to within the model's own slop, which is about a centimetre.
    const spread = (side: typeof left) => side.map((l) => Math.abs(l.x)).sort((a, b) => a - b);
    const [ls, lb] = spread(left);
    const [rs, rb] = spread(right);
    expect(ls).toBeCloseTo(rs, 1);
    expect(lb).toBeCloseTo(rb, 1);
  });
});
