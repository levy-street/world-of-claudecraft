import { describe, it, expect } from 'vitest';
import { buildFlaredConeFan, buildRingXZ, drapeConeWorld } from '../src/render/target_cone_debug';

// A flared half-angle: 45 degrees at the apex widening to 60 degrees by 30 yd.
const HALF_NEAR = Math.PI / 4;
const HALF_FAR = Math.PI / 3;
const halfAt = (r: number): number => HALF_NEAR + (HALF_FAR - HALF_NEAR) * Math.min(1, r / 30);

describe('buildFlaredConeFan', () => {
  it('collapses the apex ring to the origin and lays the outer ring at the radius', () => {
    const { localXZ, vertexCount } = buildFlaredConeFan(30, halfAt, 4, 4);
    const cols = 5; // angular + 1
    expect(vertexCount).toBe(5 * cols); // rings * cols
    // Ring 0 (r = 0) is the apex: every column collapses to the origin.
    for (let j = 0; j < cols; j++) {
      expect(localXZ[(0 * cols + j) * 2]).toBeCloseTo(0, 6);
      expect(localXZ[(0 * cols + j) * 2 + 1]).toBeCloseTo(0, 6);
    }
    // Outer ring (i = 4, r = 30): every column sits at the radius.
    for (let j = 0; j < cols; j++) {
      const v = (4 * cols + j) * 2;
      expect(Math.hypot(localXZ[v], localXZ[v + 1])).toBeCloseTo(30, 5);
    }
  });

  it('flares the side edge: the half-angle grows with radius', () => {
    const { localXZ } = buildFlaredConeFan(30, halfAt, 4, 4);
    const cols = 5;
    const edgeAngle = (i: number): number => {
      const v = (i * cols + 0) * 2; // left edge column j = 0
      return Math.atan2(localXZ[v], localXZ[v + 1]); // angle from +Z
    };
    // Left edge angle (negative) widens from the inner ring to the outer ring.
    expect(edgeAngle(1)).toBeCloseTo(-halfAt(30 / 4), 5);
    expect(edgeAngle(4)).toBeCloseTo(-HALF_FAR, 5);
    expect(Math.abs(edgeAngle(4))).toBeGreaterThan(Math.abs(edgeAngle(1)));
  });

  it('points the center column straight ahead at the outer rim', () => {
    const { localXZ } = buildFlaredConeFan(30, halfAt, 4, 4);
    const cols = 5;
    const v = (4 * cols + 2) * 2; // outer ring, middle column (u = 0.5 -> angle 0)
    expect(localXZ[v]).toBeCloseTo(0, 5);
    expect(localXZ[v + 1]).toBeCloseTo(30, 5);
  });

  it('emits two triangles per grid cell and a closed perimeter outline', () => {
    const { index, outline } = buildFlaredConeFan(30, halfAt, 4, 4);
    expect(index.length).toBe(4 * 4 * 6);
    // left edge (5) + outer arc (5) + right edge (5)
    expect(outline.length).toBe(5 + 5 + 5);
    expect(outline[0]).toBe(0); // starts at the apex (ring 0, column 0)
  });
});

describe('buildRingXZ', () => {
  it('lays out segment vertices on the circle of the given radius', () => {
    const xz = buildRingXZ(40, 8);
    expect(xz.length).toBe(16);
    for (let i = 0; i < 8; i++) {
      expect(Math.hypot(xz[i * 2], xz[i * 2 + 1])).toBeCloseTo(40, 6);
    }
    // First vertex (angle 0) is straight ahead at +Z.
    expect(xz[0]).toBeCloseTo(0, 6);
    expect(xz[1]).toBeCloseTo(40, 6);
  });
});

describe('drapeConeWorld', () => {
  // apex, straight-ahead (local +Z), and right-hand (local +X) vertices.
  const localXZ = new Float32Array([0, 0, 0, 10, 10, 0]);

  it('anchors the apex at the player and rides the sampled terrain', () => {
    const out = new Float32Array(3 * 3);
    drapeConeWorld(localXZ, 5, 7, 0, 0.05, () => 2, out);
    expect(out[0]).toBeCloseTo(5, 6);
    expect(out[1]).toBeCloseTo(2.05, 6);
    expect(out[2]).toBeCloseTo(7, 6);
  });

  it('points the cone down +Z when facing 0', () => {
    const out = new Float32Array(3 * 3);
    drapeConeWorld(localXZ, 0, 0, 0, 0, () => 0, out);
    // The straight-ahead vertex (index 1) lands at +Z = radius.
    expect(out[1 * 3]).toBeCloseTo(0, 6);
    expect(out[1 * 3 + 2]).toBeCloseTo(10, 6);
  });

  it('rotates the cone to the +X axis when facing 90 degrees', () => {
    const out = new Float32Array(3 * 3);
    drapeConeWorld(localXZ, 0, 0, Math.PI / 2, 0, () => 0, out);
    // Forward is now (sin 90, cos 90) = (1, 0): the straight-ahead vertex goes +X.
    expect(out[1 * 3]).toBeCloseTo(10, 6);
    expect(out[1 * 3 + 2]).toBeCloseTo(0, 6);
  });

  it('samples ground height at each vertex world position', () => {
    const out = new Float32Array(3 * 3);
    drapeConeWorld(localXZ, 3, 0, 0, 0.1, (x) => x, out);
    for (let i = 0; i < 3; i++) {
      expect(out[i * 3 + 1]).toBeCloseTo(out[i * 3] + 0.1, 6);
    }
  });
});
