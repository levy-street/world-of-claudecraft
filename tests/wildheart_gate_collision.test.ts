import { readFileSync } from 'node:fs';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { wildheartPropsPreloadInternalsForTest } from '../src/render/wildheart_props';
import { resolveMovement, resolvePosition } from '../src/sim/colliders';
import { DUNGEONS, INSTANCE_SLOT_COUNT, instanceOrigin } from '../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { WILDHEART_FIELD_COLLIDER_SPECS } from '../src/sim/wildheart_field';

const kind = 'wildheart_jaguar_gate';
const gate = WILDHEART_FIELD_COLLIDER_SPECS.filter((spec) => spec.kind === kind);
const placement = wildheartPropsPreloadInternalsForTest.placements.find((p) => p.kind === kind)!;
type Point = [number, number, number];
type Segment = [Point, Point];

describe('Wildheart entrance gate collision', () => {
  it('allows a player to walk both clear flanks and the central arch in every instance slot', () => {
    // The GLB's outer edges are x +/-8.03 after its 1.1 placement scale.
    // Old posts at +/-13.75 blocked this visibly empty grass. Test the whole
    // approach in both directions, including the space just beside the mesh.
    for (let slot = 0; slot < INSTANCE_SLOT_COUNT; slot++) {
      const origin = instanceOrigin(DUNGEONS.wildheart_basin.index, slot);
      for (const x of [-16, -13.75, -11, -9, 0, 9, 11, 13.75, 16]) {
        for (const [fromZ, toZ] of [
          [8, 23],
          [23, 8],
        ]) {
          const target = { x: origin.x + x, z: origin.z + toZ };
          expect(
            resolveMovement(
              1,
              origin.x + x,
              origin.z + fromZ,
              target.x,
              target.z,
              PLAYER_BODY_RADIUS,
            ),
            `slot ${slot}, x ${x}, z ${fromZ} to ${toZ}`,
          ).toEqual(target);
        }
      }
    }
  });

  it('blocks both visible stone feet instead of moving their collision into the grass', () => {
    const origin = instanceOrigin(DUNGEONS.wildheart_basin.index, 0);
    for (const x of [-4.8, 4.8]) {
      const point = { x: origin.x + x, z: origin.z + 14.13 };
      const resolved = resolvePosition(1, point.x, point.z, PLAYER_BODY_RADIUS);
      expect(Math.hypot(resolved.x - point.x, resolved.z - point.z)).toBeGreaterThan(0.5);
      const approach = resolveMovement(
        1,
        point.x,
        origin.z + 8,
        point.x,
        point.z,
        PLAYER_BODY_RADIUS,
      );
      expect(approach.z).toBeLessThan(point.z - 0.5);
    }
  });

  it('keeps every post inside the shipped gate mesh at player waist height', async () => {
    expect(readFileSync('src/render/wildheart_props.ts', 'utf8')).toContain(
      'wildheart_jaguar_gate: -Math.PI / 2,',
    );
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.read(`public${wildheartPropsPreloadInternalsForTest.assetUrl[kind]}`);
    const scene = document.getRoot().getDefaultScene()!;
    const bounds = getBounds(scene);
    const scale =
      wildheartPropsPreloadInternalsForTest.targetHeight[kind] / (bounds.max[1] - bounds.min[1]);
    const segments: Segment[] = [];
    for (const node of document.getRoot().listNodes()) {
      const matrix = node.getWorldMatrix();
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
        const positions = primitive.getAttribute('POSITION')!;
        const vertices: Point[] = [];
        for (let i = 0; i < positions.getCount(); i++) {
          const [x, y, z] = positions.getElement(i, [0, 0, 0]);
          const wx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
          const wy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
          const wz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
          // cloneLoaded normalizes height, seats the bottom and yaws -PI/2.
          vertices.push([-wz * scale, (wy - bounds.min[1]) * scale, wx * scale]);
        }
        const indices = primitive.getIndices();
        const count = indices?.getCount() ?? vertices.length;
        for (let i = 0; i < count; i += 3) {
          const triangle = [0, 1, 2].map((j) => vertices[indices?.getScalar(i + j) ?? i + j]);
          const intersections: Point[] = [];
          for (let edge = 0; edge < 3; edge++) {
            const a = triangle[edge];
            const b = triangle[(edge + 1) % 3];
            if (a[1] > 0.5 === b[1] > 0.5) continue;
            const t = (0.5 - a[1]) / (b[1] - a[1]);
            intersections.push([a[0] + t * (b[0] - a[0]), 0.5, a[2] + t * (b[2] - a[2])]);
          }
          if (intersections.length === 2) segments.push([intersections[0], intersections[1]]);
        }
      }
    }
    expect(segments).toHaveLength(92);
    expect(gate).toHaveLength(6);
    const placementScale = placement.scale ?? 1;
    for (const post of gate) {
      // A zero-radius outer post also fits the mesh, but leaves its foot
      // hollow. Pin the measured radius independently of containment.
      expect(post.r).toBeCloseTo(0.935, 10);
      for (let sample = 0; sample < 32; sample++) {
        const angle = (sample / 32) * Math.PI * 2;
        const x = (post.x - placement.x + Math.cos(angle) * post.r) / placementScale;
        const z = (post.z - placement.z + Math.sin(angle) * post.r) / placementScale;
        let crossings = 0;
        for (const [a, b] of segments) {
          if (a[2] > z === b[2] > z) continue;
          const hitX = a[0] + ((z - a[2]) * (b[0] - a[0])) / (b[2] - a[2]);
          if (hitX > x) crossings++;
        }
        expect(crossings % 2, `post ${post.x},${post.z}, sample ${sample}`).toBe(1);
      }
    }
  });
});
