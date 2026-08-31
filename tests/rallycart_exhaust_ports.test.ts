// The exhaust port offsets, checked against the SHIPPED mesh.
//
// Everything else about this mount is derived at runtime from named nodes, so a
// re-rip that reproduces the rig contract needs no code changes. The tailpipes
// are the exception: Tripo left them as bare primitives inside the Chassis mesh
// with no empties to hang a name on, so their positions are constants measured
// off this particular export.
//
// This re-finds them independently and fails if they move, which is the whole
// point: a re-rip would otherwise silently leave the smoke hanging in the air
// near where the old pipes used to be. If that day comes, either re-measure
// from the output here, or add four `Exhaust_*` empties in Blender and turn
// this into the same name-based contract the suspension nodes already use.

import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RALLYCART_EXHAUST_PORTS } from '../src/render/vehicle_exhaust_core';

const MODEL = 'public/models/mounts/rallycart_rxt.glb';

interface Gltf {
  nodes: { name?: string; mesh?: number }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { min: number[]; max: number[]; count: number }[];
}

function chassisPrimitives(): { cx: number; cy: number; tipZ: number; span: number[] }[] {
  const buf = fs.readFileSync(MODEL);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as Gltf;
  const chassis = json.nodes.find((n) => n.name === 'Chassis');
  expect(chassis?.mesh, 'Chassis mesh missing: the rig contract changed').toBeDefined();
  return json.meshes[chassis?.mesh as number].primitives.map((p) => {
    const a = json.accessors[p.attributes.POSITION];
    return {
      cx: (a.min[0] + a.max[0]) / 2,
      cy: (a.min[1] + a.max[1]) / 2,
      tipZ: a.min[2],
      span: [a.max[0] - a.min[0], a.max[1] - a.min[1], a.max[2] - a.min[2]],
    };
  });
}

describe('rallycart exhaust ports', () => {
  it('still finds four tubes slung under the rear bumper where the code says', () => {
    // Re-derived rather than asserted from the constants: small square cross
    // section, longer than it is wide, low, and at the back.
    const tubes = chassisPrimitives().filter(
      (p) =>
        p.tipZ < -0.4 &&
        p.cy < 0.2 &&
        p.span[0] < 0.05 &&
        p.span[1] < 0.05 &&
        p.span[2] > p.span[0] * 2,
    );
    expect(tubes).toHaveLength(4);

    for (const port of RALLYCART_EXHAUST_PORTS) {
      const match = tubes.find(
        (t) => Math.abs(t.cx - port.x) < 0.01 && Math.abs(t.tipZ - port.z) < 0.02,
      );
      expect(
        match,
        `no tailpipe found near x=${port.x}, z=${port.z}. The mesh moved: re-measure ` +
          'RALLYCART_EXHAUST_PORTS, or add named Exhaust_* empties and stop guessing.',
      ).toBeDefined();
      expect(match?.cy).toBeCloseTo(port.y, 2);
    }
  });
});
