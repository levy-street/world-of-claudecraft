// The Realm Builder monument's effect anchors, re-MEASURED against the shipped
// GLB rather than trusted.
//
// realm_builder_monument_fx_core.ts holds the plate and lantern positions as
// constants because a runtime scene walk hides drift: re-export the sculpt with
// a plate a hand's width lower and the hologram silently projects out of the
// statue's hip. This suite is the other half of that bargain. If the asset and
// the constants disagree, this reds, and the fix is to re-measure, not to widen
// the tolerance.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  hologramMetrics,
  hologramPanelCenter,
  MONUMENT_EFFECTS_RANGE,
  MONUMENT_EMBER_SEED_STRIDE,
  MONUMENT_HOLOGRAM,
  MONUMENT_IMPOSTOR_ANGLES,
  MONUMENT_IMPOSTOR_ATLAS,
  MONUMENT_IMPOSTOR_RANGE,
  MONUMENT_LANTERNS,
  MONUMENT_PLATE_BACK,
  MONUMENT_PLATE_FRONT,
  MONUMENT_SOURCE_SIZE,
  type MonumentPlacement,
  monumentDirectionWorld,
  monumentEmberSeeds,
  monumentImpostorCell,
  monumentImpostorSize,
  monumentImpostorUvOffset,
  monumentLodPlan,
  monumentPlateYaw,
  monumentPointWorld,
  monumentScale,
} from '../src/render/realm_builder_monument_fx_core';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';

const ASSET = 'public/models/props/eastbrook_realm_builder_monument.glb';
/** Meshopt quantization moves a position by well under a millimetre. */
const MEASURE_TOLERANCE = 1e-4;

interface ShippedMonument {
  size: { x: number; y: number; z: number };
  sockets: Map<string, { x: number; y: number; z: number }>;
}

async function readShippedMonument(): Promise<ShippedMonument> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const document = await io.readBinary(readFileSync(path.join(__dirname, '..', ASSET)));
  const root = document.getRoot();
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const sockets = new Map<string, { x: number; y: number; z: number }>();

  const walk = (node: ReturnType<typeof root.listNodes>[number], parent: number[]): void => {
    const translation = node.getTranslation();
    const scale = node.getScale();
    const world = [
      parent[0] + translation[0],
      parent[1] + translation[1],
      parent[2] + translation[2],
    ];
    const extras = node.getExtras() as { sculptSocket?: { id: string } } | undefined;
    if (extras?.sculptSocket) {
      sockets.set(extras.sculptSocket.id, { x: world[0], y: world[1], z: world[2] });
    }
    const mesh = node.getMesh();
    if (mesh) {
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (!position) throw new Error(`${ASSET} has a primitive with no POSITION`);
        const element = [0, 0, 0];
        for (let index = 0; index < position.getCount(); index++) {
          position.getElement(index, element);
          for (let axis = 0; axis < 3; axis++) {
            const value = world[axis] + element[axis] * scale[axis];
            if (value < min[axis]) min[axis] = value;
            if (value > max[axis]) max[axis] = value;
          }
        }
      }
    }
    for (const child of node.listChildren()) walk(child, world);
  };
  for (const scene of root.listScenes()) {
    for (const node of scene.listChildren()) walk(node, [0, 0, 0]);
  }
  return {
    size: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
    sockets,
  };
}

/** The monument exactly as eastbrook_town.ts seats it, ground flattened to 0. */
function livePlacement(groundY = 0): MonumentPlacement {
  const monument = EASTBROOK_LAYOUT.civic.monument;
  return {
    x: monument.position.x,
    z: monument.position.z,
    groundY,
    rotation: monument.rotation,
    nativeWidth: monument.nativeDimensions.width,
    nativeHeight: monument.nativeDimensions.height,
    nativeDepth: monument.nativeDimensions.depth,
  };
}

describe('Realm Builder monument effect anchors', () => {
  it('measures the shipped sculpt and finds the constants it is authored against', async () => {
    const shipped = await readShippedMonument();
    expect(shipped.size.x).toBeCloseTo(MONUMENT_SOURCE_SIZE.x, 4);
    expect(shipped.size.y).toBeCloseTo(MONUMENT_SOURCE_SIZE.y, 4);
    expect(shipped.size.z).toBeCloseTo(MONUMENT_SOURCE_SIZE.z, 4);

    for (const [id, anchor] of [
      ['plaque-front', MONUMENT_PLATE_FRONT.anchor],
      ['plaque-back', MONUMENT_PLATE_BACK.anchor],
    ] as const) {
      const socket = shipped.sockets.get(id);
      expect(socket, `${ASSET} is missing the ${id} socket`).toBeDefined();
      expect(Math.abs((socket?.x ?? 0) - anchor.x)).toBeLessThan(MEASURE_TOLERANCE);
      expect(Math.abs((socket?.y ?? 0) - anchor.y)).toBeLessThan(MEASURE_TOLERANCE);
      expect(Math.abs((socket?.z ?? 0) - anchor.z)).toBeLessThan(MEASURE_TOLERANCE);
    }

    expect(MONUMENT_LANTERNS).toHaveLength(4);
    for (let index = 0; index < MONUMENT_LANTERNS.length; index++) {
      const socket = shipped.sockets.get(`lantern-${index + 1}`);
      expect(socket, `${ASSET} is missing lantern ${index + 1}`).toBeDefined();
      const local = MONUMENT_LANTERNS[index];
      expect(Math.abs((socket?.x ?? 0) - local.x)).toBeLessThan(MEASURE_TOLERANCE);
      expect(Math.abs((socket?.y ?? 0) - local.y)).toBeLessThan(MEASURE_TOLERANCE);
      expect(Math.abs((socket?.z ?? 0) - local.z)).toBeLessThan(MEASURE_TOLERANCE);
    }
  });

  it('scales the live placement uniformly, so the statue cannot shear', () => {
    const scale = monumentScale(livePlacement());
    expect(scale.x).toBeCloseTo(scale.y, 9);
    expect(scale.z).toBeCloseTo(scale.y, 9);
    // The layout's declared height is what the sculpt actually reaches.
    expect(MONUMENT_SOURCE_SIZE.y * scale.y).toBeCloseTo(EASTBROOK_LAYOUT.civic.monument.height, 9);
  });

  it('lands both plates outside the collider and at a readable height', () => {
    const placement = livePlacement();
    const monument = EASTBROOK_LAYOUT.civic.monument;
    const metrics = hologramMetrics(placement);
    for (const plate of [MONUMENT_PLATE_FRONT, MONUMENT_PLATE_BACK]) {
      const anchor = monumentPointWorld(plate.anchor, placement);
      const normal = monumentDirectionWorld(plate.normal, placement);
      const panel = hologramPanelCenter(anchor, normal, metrics);

      // The plate is on the plinth, so it sits inside the cylinder; the NAME
      // it projects has to clear it or the statue eats its own hologram.
      const plateRadius = Math.hypot(anchor.x - placement.x, anchor.z - placement.z);
      expect(plateRadius).toBeLessThan(monument.radius);

      // Held as a FRACTION of the statue rather than an absolute height: the
      // projection is part of the monument's composition, so a resize moves it
      // with everything else instead of stranding it at an old eye level.
      expect(panel.y).toBeGreaterThan(monument.height * 0.35);
      expect(panel.y).toBeLessThan(monument.height * 0.55);
      expect(panel.y - anchor.y).toBeCloseTo(metrics.lift, 9);

      // The panel steps OUT from the plate, never back into the plinth.
      const panelRadius = Math.hypot(panel.x - placement.x, panel.z - placement.z);
      expect(panelRadius).toBeGreaterThan(plateRadius);
      // Precision 3, not more: the plate anchor is a hair off dead radial (its
      // own centre is a few mm to one side in model space), so stepping out
      // along the flattened normal gains a fraction less than the standoff.
      expect(panelRadius - plateRadius).toBeCloseTo(metrics.standoff, 3);
    }
  });

  it('faces the front plate down the open east arrival lane and the back plate opposite', () => {
    const placement = livePlacement();
    const front = monumentDirectionWorld(MONUMENT_PLATE_FRONT.normal, placement);
    const back = monumentDirectionWorld(MONUMENT_PLATE_BACK.normal, placement);
    // The layout leaves the east quadrant open as the spawn-to-square lane and
    // aims the current honouree's face at it. East is -x in this town (the
    // civic bench named "west" sits at +x of centre).
    expect(front.x).toBeLessThan(-0.9);
    expect(back.x).toBeGreaterThan(0.9);
    // Opposite faces, so a player circling the statue always meets one.
    expect(Math.abs(monumentPlateYaw(front) - monumentPlateYaw(back))).toBeCloseTo(Math.PI, 2);
  });

  it('places every lantern on the plinth ring, under the plate line', () => {
    const placement = livePlacement();
    const bearings: number[] = [];
    for (const local of MONUMENT_LANTERNS) {
      const at = monumentPointWorld(local, placement);
      const radius = Math.hypot(at.x - placement.x, at.z - placement.z);
      // The outriggers ARE the widest ring: the collider is sized off them, so
      // a lantern outside it would be a flame in unreachable air.
      const monumentHeight = EASTBROOK_LAYOUT.civic.monument.height;
      expect(radius).toBeLessThanOrEqual(EASTBROOK_LAYOUT.civic.monument.radius);
      expect(radius).toBeGreaterThan(EASTBROOK_LAYOUT.civic.monument.radius * 0.7);
      // On the lowest plinth course, under the honour plates' own line.
      expect(at.y).toBeGreaterThan(monumentHeight * 0.05);
      expect(at.y).toBeLessThan(monumentHeight * 0.15);
      bearings.push(Math.atan2(at.z - placement.z, at.x - placement.x));
    }
    // Four distinct bearings: the halo and flame shaders both phase off this,
    // and duplicates would put two lanterns on the same flicker beat.
    expect(new Set(bearings.map((bearing) => bearing.toFixed(3))).size).toBe(4);
  });

  it('rotates a model-space point exactly as a three Y Euler does', () => {
    const placement: MonumentPlacement = {
      x: 10,
      z: -4,
      groundY: 2,
      rotation: Math.PI / 2,
      nativeWidth: MONUMENT_SOURCE_SIZE.x,
      nativeHeight: MONUMENT_SOURCE_SIZE.y,
      nativeDepth: MONUMENT_SOURCE_SIZE.z,
    };
    // Scale 1 at these dimensions, so the numbers below are the rotation alone.
    // A quarter turn takes local +Z to world +X and local +X to world -Z.
    expect(monumentPointWorld({ x: 0, y: 0, z: 1 }, placement)).toMatchObject({ y: 2 });
    const fromZ = monumentPointWorld({ x: 0, y: 0, z: 1 }, placement);
    expect(fromZ.x).toBeCloseTo(11, 9);
    expect(fromZ.z).toBeCloseTo(-4, 9);
    const fromX = monumentPointWorld({ x: 1, y: 0, z: 0 }, placement);
    expect(fromX.x).toBeCloseTo(10, 9);
    expect(fromX.z).toBeCloseTo(-5, 9);
  });

  it('seeds embers deterministically and never through Math.random', () => {
    const first = monumentEmberSeeds(9);
    const second = monumentEmberSeeds(9);
    expect(first).toHaveLength(9 * MONUMENT_EMBER_SEED_STRIDE);
    expect([...first]).toEqual([...second]);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    // Every mote must differ from its neighbour or the ring strobes in unison.
    expect(new Set([...first]).size).toBeGreaterThan(first.length / 2);

    const source = readFileSync(
      path.join(__dirname, '..', 'src/render/realm_builder_monument_fx_core.ts'),
      'utf8',
    );
    // Call forms, so the module can still NAME Math.random in the comment
    // explaining why it does not use it.
    expect(source).not.toMatch(/Math\.random\(|Date\.now\(|performance\.now\(/);
    // A registered RENDER_PURE_CORE: no Three, no DOM.
    expect(source).not.toMatch(/from 'three'|document\.|window\./);
  });

  it('degrades in two steps, and never draws both bodies or neither', () => {
    // Effects go first: they are the fill-rate half and the first half to stop
    // reading. The swap comes later, so the two never change on one frame.
    expect(MONUMENT_EFFECTS_RANGE).toBeLessThan(MONUMENT_IMPOSTOR_RANGE);

    for (const distance of [0, 1, 30, 47.9, 48, 71.9, 72, 200, 10_000]) {
      const plan = monumentLodPlan(distance);
      // Exactly one body at every distance: a caller cannot draw the statue
      // and its billboard at once, or lose both and leave a hole in the square.
      expect(plan.body).toBe(!plan.impostor);
    }

    expect(monumentLodPlan(0)).toEqual({ body: true, impostor: false, effects: true });
    expect(monumentLodPlan(MONUMENT_EFFECTS_RANGE - 0.01).effects).toBe(true);
    expect(monumentLodPlan(MONUMENT_EFFECTS_RANGE).effects).toBe(false);
    expect(monumentLodPlan(MONUMENT_IMPOSTOR_RANGE - 0.01).body).toBe(true);
    expect(monumentLodPlan(MONUMENT_IMPOSTOR_RANGE).impostor).toBe(true);
    // Nothing cosmetic survives out here, and nothing a player acts on lives
    // here either, which is what makes the whole ladder legal.
    expect(monumentLodPlan(10_000)).toEqual({ body: false, impostor: true, effects: false });
  });

  it('picks the baked view facing the camera, in the monument own frame', () => {
    const placement = livePlacement();
    const monument = EASTBROOK_LAYOUT.civic.monument;
    const step = (2 * Math.PI) / MONUMENT_IMPOSTOR_ANGLES;

    // Cell 0 is the view the bake took from the statue's front, so a camera
    // standing where the front plate points must land on it. That direction is
    // the plate normal, which the placement's rotation already turned.
    const front = monumentDirectionWorld(MONUMENT_PLATE_FRONT.normal, placement);
    const flat = Math.hypot(front.x, front.z);
    expect(
      monumentImpostorCell(
        placement.x + (front.x / flat) * 100,
        placement.z + (front.z / flat) * 100,
        placement,
      ),
    ).toBe(0);

    // Every step around the statue advances exactly one cell and wraps once.
    const walked = new Set<number>();
    for (let index = 0; index < MONUMENT_IMPOSTOR_ANGLES; index++) {
      const bearing = monument.rotation + index * step;
      walked.add(
        monumentImpostorCell(
          placement.x + Math.sin(bearing) * 60,
          placement.z + Math.cos(bearing) * 60,
          placement,
        ),
      );
    }
    expect(walked.size).toBe(MONUMENT_IMPOSTOR_ANGLES);

    // Distance never changes the answer, and neither does a full turn: the
    // wrap has to be a modulo, not a clamp, or a camera that walks all the way
    // round the plinth runs off the end of the atlas.
    expect(monumentImpostorCell(placement.x, placement.z + 5, placement)).toBe(
      monumentImpostorCell(placement.x, placement.z + 500, placement),
    );
    const straightOn = monumentImpostorCell(
      placement.x + Math.sin(monument.rotation) * 60,
      placement.z + Math.cos(monument.rotation) * 60,
      placement,
    );
    for (const turns of [-2, -1, 1, 2]) {
      const bearing = monument.rotation + turns * 2 * Math.PI;
      expect(
        monumentImpostorCell(
          placement.x + Math.sin(bearing) * 60,
          placement.z + Math.cos(bearing) * 60,
          placement,
        ),
      ).toBe(straightOn);
    }
  });

  it('maps every cell inside the atlas, top row first', () => {
    const { columns, rows } = MONUMENT_IMPOSTOR_ATLAS;
    expect(columns * rows).toBe(MONUMENT_IMPOSTOR_ANGLES);
    // Cell 0 is the TOP-LEFT of the baked image, which in UV space (origin
    // bottom-left) is the upper row: getting this backwards shows the statue's
    // back when you are looking at its face.
    expect(monumentImpostorUvOffset(0)).toEqual({ u: 0, v: (rows - 1) / rows });

    const seen = new Set<string>();
    for (let cell = 0; cell < MONUMENT_IMPOSTOR_ANGLES; cell++) {
      const offset = monumentImpostorUvOffset(cell);
      expect(offset.u).toBeGreaterThanOrEqual(0);
      expect(offset.v).toBeGreaterThanOrEqual(0);
      expect(offset.u + 1 / columns).toBeLessThanOrEqual(1);
      expect(offset.v + 1 / rows).toBeLessThanOrEqual(1);
      seen.add(`${offset.u},${offset.v}`);
    }
    expect(seen.size).toBe(MONUMENT_IMPOSTOR_ANGLES);
  });

  it('sizes the billboard to the widest silhouette, not the front one', () => {
    const placement = livePlacement();
    const size = monumentImpostorSize(placement);
    const scale = monumentScale(placement);
    const width = MONUMENT_SOURCE_SIZE.x * scale.x;
    const depth = MONUMENT_SOURCE_SIZE.z * scale.z;
    // The bake framed every cell to the diagonal, where the lantern outriggers
    // show. A quad cut to the front width would shrink the statue the moment
    // it swapped, which is exactly the pop an impostor exists to avoid.
    expect(size).toBeGreaterThanOrEqual(Math.hypot(width, depth));
    expect(size).toBeGreaterThanOrEqual(placement.nativeHeight);
    // But not wildly bigger: a loose frame wastes texels and floats the statue.
    expect(size).toBeLessThan(Math.hypot(width, depth) * 1.15);
  });
});
