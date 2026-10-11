import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HoardForgeGate } from '../src/render/hoard_forge_gate';
import {
  FORGE_GATE_LOOK,
  FORGE_GATE_VERTICES,
  type ForgeGateFrame,
  forgeGateFrame,
  forgeGateRadius,
  writeRingEdge,
} from '../src/render/hoard_forge_gate_core';
import { writeRingMask } from '../src/render/hoard_forge_hammer_core';
import {
  FORGE_HAMMER,
  forgeBearingInGap,
  forgeGapAngle,
} from '../src/sim/rift/hoard_forge_hammer_core';

const blank = (): ForgeGateFrame => ({
  middle: 0,
  radialX: 0,
  radialZ: 1,
  postA: 0,
  postB: 0,
  edgeA: 0,
  edgeB: 0,
  halfWidth: 1,
});

describe('forge gate core', () => {
  it('stands at the edge of the blow before the ring exists, then on the ring', () => {
    expect(forgeGateRadius(0)).toBe(FORGE_HAMMER.ringSafeRadius);
    expect(forgeGateRadius(18)).toBe(18);
  });

  it('puts the posts in the FIRE and everything marked safe inside the sim gap', () => {
    for (const cueId of [1, 7, 42, 313]) {
      for (const radius of [FORGE_HAMMER.ringSafeRadius, 12, FORGE_HAMMER.ringMaxRadius]) {
        for (let gap = 0; gap < FORGE_HAMMER.gaps; gap++) {
          const frame = forgeGateFrame(cueId, gap, radius, blank());
          expect(frame.middle).toBe(forgeGapAngle(cueId, gap));
          // A post never stands on safe ground, and never far from the edge.
          expect(forgeBearingInGap(cueId, frame.postA)).toBe(false);
          expect(forgeBearingInGap(cueId, frame.postB)).toBe(false);
          expect((frame.middle - FORGE_HAMMER.gapHalfAngle - frame.postA) * radius).toBeCloseTo(
            FORGE_GATE_LOOK.postInset,
            6,
          );
          // The threshold's ends are safe, short of the true edge by the margin.
          expect(forgeBearingInGap(cueId, frame.edgeA)).toBe(true);
          expect(forgeBearingInGap(cueId, frame.edgeB)).toBe(true);
          // Where the corridor crosses the burning BAND it stays inside the gap: never a
          // visual opening wider than the hitbox. (Behind and ahead of the band nothing burns.)
          const chord = radius * Math.sin(FORGE_HAMMER.gapHalfAngle);
          expect(frame.halfWidth).toBeLessThanOrEqual(chord - FORGE_GATE_LOOK.safetyMargin + 1e-9);
          expect(frame.halfWidth).toBeLessThanOrEqual(FORGE_GATE_LOOK.stripHalfWidthMax);
          const corner = Math.atan2(frame.halfWidth, radius - FORGE_HAMMER.ringThickness / 2);
          expect(corner).toBeLessThan(FORGE_HAMMER.gapHalfAngle);
        }
      }
    }
  });

  it('lifts the fire only beside a door, and never inside one', () => {
    const mask = new Float32Array(97);
    const edge = new Float32Array(97);
    writeRingMask(9, mask);
    writeRingEdge(mask, edge);
    let lifted = 0;
    for (let column = 0; column < 96; column++) {
      if (mask[column] === 0) expect(edge[column]).toBe(0);
      const besideDoor =
        mask[column] > 0 && (mask[(column + 1) % 96] === 0 || mask[(column + 95) % 96] === 0);
      if (besideDoor) expect(edge[column]).toBe(1);
      if (edge[column] > 0) lifted++;
    }
    // Two doors, two sides each, a few columns a side: far from the whole ring.
    expect(lifted).toBeGreaterThanOrEqual(FORGE_HAMMER.gaps * 2);
    expect(lifted).toBeLessThanOrEqual(FORGE_HAMMER.gaps * 2 * FORGE_GATE_LOOK.edgeReach);
  });
});

describe('forge gate adapter', () => {
  const named = (root: THREE.Group, name: string) => root.getObjectByName(name) as THREE.Mesh;

  it('draws every gate in three draw calls, on the low tier too, and hides clean', () => {
    for (const animate of [true, false]) {
      const root = new THREE.Group();
      const gate = new HoardForgeGate(root, 6, animate);
      expect(root.children).toHaveLength(3);
      gate.commit();
      expect(named(root, 'ForgeGateFloor').visible).toBe(false);

      gate.write(2, 42, 100, -50, 3, 12, 1, 0);
      gate.commit();
      for (const name of ['ForgeGatePost', 'ForgeGatePostMolten', 'ForgeGateFloor']) {
        expect(named(root, name).visible).toBe(true);
      }
      // The posts stand on the ring, at the bearings the core names.
      const posts = named(root, 'ForgeGatePost') as THREE.InstancedMesh;
      const frame = forgeGateFrame(42, 0, 12, blank());
      const matrix = new THREE.Matrix4();
      const at = new THREE.Vector3();
      posts.getMatrixAt(2 * FORGE_HAMMER.gaps * 2, matrix);
      at.setFromMatrixPosition(matrix);
      expect(at.x).toBeCloseTo(100 + Math.sin(frame.postA) * 12, 4);
      expect(at.z).toBeCloseTo(-50 + Math.cos(frame.postA) * 12, 4);
      expect(at.y).toBe(3);
      // The floor marks are opaque enough to read without bloom.
      const color = named(root, 'ForgeGateFloor').geometry.getAttribute('color');
      const base = 2 * FORGE_HAMMER.gaps * FORGE_GATE_VERTICES;
      expect(color.getW(base)).toBeGreaterThan(0.7);

      gate.hide(2);
      gate.commit();
      expect(named(root, 'ForgeGateFloor').visible).toBe(false);
      expect(color.getW(base)).toBe(0);
      gate.dispose();
      expect(root.children).toHaveLength(0);
    }
  });

  it('points the chevrons IN, the way a player crosses the wall', () => {
    const root = new THREE.Group();
    const gate = new HoardForgeGate(root, 1, false);
    gate.write(0, 5, 0, 0, 0, 15, 1, 0);
    const position = named(root, 'ForgeGateFloor').geometry.getAttribute('position');
    const frame = forgeGateFrame(5, 0, 15, blank());
    const firstChevron = (FORGE_GATE_LOOK.thresholdSegments + 1) * 2 + 8;
    const radial = (v: number) =>
      position.getX(v) * frame.radialX + position.getZ(v) * frame.radialZ;
    // Vertex 0 of an arm is its tip, vertex 3 its trailing end: the tip is nearer the centre.
    expect(radial(firstChevron)).toBeLessThan(radial(firstChevron + 3));
  });
});
