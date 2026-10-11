// The continuous cliff body of a Buried Hoard room
// (src/render/hoard_cliff_mass_core.ts) and the rocks embedded in it
// (buildHoardValleyPlan): one geological mass, never a pile of loose rocks.
import { describe, expect, it } from 'vitest';
import {
  buildHoardCliffMass,
  CLIFF_MAX_HEIGHT,
  CLIFF_MIN_HEIGHT,
  CLIFF_SHOULDER_BOOST,
  cliffFaceDepth,
  cliffHeight,
  cliffLinearChannels,
  cliffNoise,
  cliffPerimeter,
} from '../src/render/hoard_cliff_mass_core';
import { buildHoardValleyPlan } from '../src/render/hoard_valley_core';

const ROOM = [
  { x: -40, z: -20 },
  { x: 40, z: -20 },
  { x: 40, z: 150 },
  { x: -40, z: 150 },
];
const CENTRE = { x: 0, z: 65 };

function build(seed = 7) {
  return buildHoardCliffMass({
    polygon: ROOM,
    seed,
    revealZ: 40,
    cliff: 0x556677,
    cliffLight: 0xddeeff,
  });
}

describe('cliff body', () => {
  it('finds outward normals whatever the winding of the room outline', () => {
    for (const polygon of [ROOM, [...ROOM].reverse()]) {
      const { edges, length } = cliffPerimeter(polygon);
      expect(length).toBeCloseTo(2 * (80 + 170));
      for (const edge of edges) {
        const mx = (edge.a.x + edge.b.x) / 2;
        const mz = (edge.a.z + edge.b.z) / 2;
        // Stepping along the normal moves AWAY from the room centre.
        const before = Math.hypot(mx - CENTRE.x, mz - CENTRE.z);
        const after = Math.hypot(mx + edge.nx - CENTRE.x, mz + edge.nz - CENTRE.z);
        expect(after).toBeGreaterThan(before);
      }
    }
  });

  it('wraps its noise so the wall closes with no seam, and varies the skyline', () => {
    expect(cliffNoise(3, 1, 0, 12)).toBeCloseTo(cliffNoise(3, 1, 12, 12));
    const perimeter = 500;
    const heights: number[] = [];
    for (let s = 0; s < perimeter; s += 5) heights.push(cliffHeight(9, s, perimeter));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(CLIFF_MIN_HEIGHT);
    expect(Math.max(...heights)).toBeLessThanOrEqual(CLIFF_MAX_HEIGHT);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(2.5);
    expect(cliffHeight(9, 0, perimeter)).toBeCloseTo(cliffHeight(9, perimeter, perimeter));
  });

  it('leans the face back as it climbs and never reaches into the room', () => {
    for (let s = 0; s < 300; s += 17) {
      const foot = cliffFaceDepth(5, s, 500, 0);
      const mid = cliffFaceDepth(5, s, 500, 0.5);
      const lip = cliffFaceDepth(5, s, 500, 1);
      expect(foot).toBeGreaterThan(0);
      expect(mid).toBeGreaterThan(foot);
      expect(lip).toBeGreaterThan(mid);
    }
  });

  it('is one closed, deterministic mesh that stays outside the room and faces into it', () => {
    const mass = build();
    expect(build().positions).toEqual(mass.positions);
    expect(build(8).positions).not.toEqual(mass.positions);
    const p = mass.positions;
    expect(p.length % 9).toBe(0);
    let facing = 0;
    let away = 0;
    for (let t = 0; t < p.length; t += 9) {
      for (let v = 0; v < 3; v++) {
        const x = p[t + v * 3];
        const z = p[t + v * 3 + 2];
        // Nothing of the body is inside the playable outline.
        expect(x <= -40 || x >= 40 || z <= -20 || z >= 150).toBe(true);
      }
      const cy = (p[t + 1] + p[t + 4] + p[t + 7]) / 3;
      if (cy > 7) continue;
      const ux = p[t + 3] - p[t];
      const uy = p[t + 4] - p[t + 1];
      const uz = p[t + 5] - p[t + 2];
      const vx = p[t + 6] - p[t];
      const vy = p[t + 7] - p[t + 1];
      const vz = p[t + 8] - p[t + 2];
      const nx = uy * vz - uz * vy;
      const nz = ux * vy - uy * vx;
      const cx = (p[t] + p[t + 3] + p[t + 6]) / 3;
      const cz = (p[t + 2] + p[t + 5] + p[t + 8]) / 3;
      if ((CENTRE.x - cx) * nx + (CENTRE.z - cz) * nz > 0) facing++;
      else away++;
    }
    // The lower face is what a player sees: it must look into the room (a few
    // corner triangles may turn sideways, never a stretch of wall).
    expect(facing).toBeGreaterThan(away * 12);
  });

  it('chunks the wall contiguously for the camera cutaway', () => {
    const mass = build();
    let cursor = 0;
    for (const chunk of mass.chunks) {
      expect(chunk.start).toBe(cursor);
      expect(chunk.count).toBeGreaterThan(0);
      expect(chunk.max[1]).toBeGreaterThan(chunk.min[1]);
      cursor += chunk.count;
    }
    expect(cursor).toBe(mass.positions.length / 3);
    expect(mass.chunks.length).toBeGreaterThan(20);
  });

  it('paints heavy shadow at the foot and light on the plateau, in linear colour', () => {
    expect(cliffLinearChannels(0xffffff)).toEqual([1, 1, 1]);
    expect(cliffLinearChannels(0x808080)[0]).toBeCloseTo(0.2159, 3);
    const mass = build();
    let foot = 0;
    let footCount = 0;
    let top = 0;
    let topCount = 0;
    for (let v = 0; v < mass.positions.length / 3; v++) {
      const y = mass.positions[v * 3 + 1];
      const luminance = (mass.colors[v * 3] + mass.colors[v * 3 + 1] + mass.colors[v * 3 + 2]) / 3;
      if (y < 1.5) {
        foot += luminance;
        footCount++;
      } else if (y > CLIFF_MIN_HEIGHT * 0.9) {
        top += luminance;
        topCount++;
      }
    }
    expect(top / topCount).toBeGreaterThan((foot / footCount) * 2);
  });
});

describe('rocks embedded in the cliff body', () => {
  const plan = buildHoardValleyPlan({
    layout: { zMin: -20, zMax: 150, floorHalfX: 40, dais: { x: 0, z: 120, r: 6 } },
    zoneId: 'frostveil',
    seed: 77,
    low: false,
  });

  it('carries the outline and seed the body is built from', () => {
    expect(plan.outline).toHaveLength(4);
    expect(plan.seed).toBe(77);
  });

  it('never leaves a rock floating: each is buried in the floor, the face or the plateau', () => {
    const tallest = CLIFF_MAX_HEIGHT * CLIFF_SHOULDER_BOOST;
    expect(plan.cliffs.length % 3).toBe(0);
    for (let i = 0; i < plan.cliffs.length; i += 3) {
      const [primary, crown, seam] = plan.cliffs.slice(i, i + 3);
      for (const rock of [primary, crown, seam]) expect(rock.centerY).toBeDefined();
      // Primary: its foot is under the floor.
      expect((primary.centerY ?? 0) - primary.scaleY).toBeLessThan(0);
      // Crown: most of it is inside the plateau, and only its top breaks the skyline.
      const crownBottom = (crown.centerY ?? 0) - crown.scaleY;
      const crownTop = (crown.centerY ?? 0) + crown.scaleY;
      expect(crownBottom).toBeLessThan(crownTop - crown.scaleY);
      expect(crownBottom).toBeLessThan(tallest);
      expect(crownBottom).toBeGreaterThan(CLIFF_MIN_HEIGHT * 0.5);
      // Seam filler: small, and at mid height on the face.
      expect(seam.scaleY).toBeLessThan(primary.scaleY);
      expect(seam.centerY ?? 0).toBeGreaterThan(1);
      expect(seam.centerY ?? 0).toBeLessThan(tallest * 0.8);
    }
  });
});
