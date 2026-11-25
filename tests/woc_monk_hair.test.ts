// The monk hairstyle, a tonsure (scripts/assets/woc_character/build_monk_hair.mjs): a ring of
// hair grown on each head's own skull. Pins what the build decides and nothing else checks:
// the ray that finds the scalp, the skull's frame, the ring's cross-section (on the crown at
// its top edge, full thickness low down, tucked back under), its dip at the brow, its closed
// seam and its paint, and the shipped files' own names and texture. The file set, codecs,
// sizes and triangle counts are held by the library-wide suites.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  farthestHit,
  growRing,
  MONK_ID,
  MONK_SHAPE,
  ringU,
  skullFrame,
} from '../scripts/assets/woc_character/build_monk_hair.mjs';
import { MULLET_TOP_ID } from '../scripts/assets/woc_character/build_mullet_hair.mjs';
import { POMP_PATCH } from '../scripts/assets/woc_character/build_pompadour_hair.mjs';
import { WOC_HEAD_TYPES, wocHeadPieceUrl } from '../src/render/characters/woc_head_catalog';
import { WOC_HEAD_TINT_TABLE } from '../src/render/characters/woc_head_look_core';

const ROOT = path.resolve(__dirname, '..');
const TYPES = ['a', 'b'] as const;
/** A head that is a cylinder of radius 1 about the y axis: the scalp is 1 out, everywhere. */
const CYLINDER = (): number => 1;
const FRAME = { top: 10, cx: 0, cz: 0 };

function glb(url: string): {
  json: {
    nodes: { name?: string; mesh?: number }[];
    meshes: { primitives: unknown[] }[];
    materials: { name: string }[];
    images: { name?: string; bufferView: number }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  bin: Buffer;
} {
  const buf = readFileSync(path.join(ROOT, 'public', url));
  const jsonLength = buf.readUInt32LE(12);
  const binAt = 20 + jsonLength;
  return {
    json: JSON.parse(buf.subarray(20, binAt).toString('utf8')),
    bin: buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt)),
  };
}

function imageBytes(file: ReturnType<typeof glb>): Buffer {
  expect(file.json.images).toHaveLength(1);
  const view = file.json.bufferViews[file.json.images[0].bufferView];
  const start = view.byteOffset ?? 0;
  return file.bin.subarray(start, start + view.byteLength);
}

describe('the monk tonsure build', () => {
  it('is offered on both head types', () => {
    for (const type of TYPES) {
      expect(WOC_HEAD_TYPES[type].slots.hair.map((v) => v.id)).toContain(MONK_ID);
    }
  });

  it('finds the scalp along a ray: the farthest hit, and nothing where it misses', () => {
    // two walls across +z, at 2 and at 5
    const wall = (z: number): number[][] => [
      [-9, -9, z],
      [9, -9, z],
      [0, 9, z],
    ];
    const walls = [wall(2), wall(5)];
    expect(farthestHit([0, 0, 0], [0, 0, 1], walls)).toBeCloseTo(5, 9);
    // behind the origin and off to the side there is nothing
    expect(farthestHit([0, 0, 0], [0, 0, -1], walls)).toBe(0);
    expect(farthestHit([0, 0, 0], [1, 0, 0], walls)).toBe(0);
  });

  it('frames the skull on its top and the middle of what lies just under it', () => {
    const frame = skullFrame([
      [
        [-1, 10, -3],
        [3, 9.98, 5],
        [0, 9.95, 0],
      ],
      // far below the top: not part of the skull's middle
      [
        [50, 0, 50],
        [51, 0, 50],
        [50, 0, 51],
      ],
    ]);
    expect(frame).toEqual({ top: 10, cx: 1, cz: 1 });
  });

  it('grows a ring that lies on the crown, stands full low down, and tucks back under', () => {
    const s = MONK_SHAPE;
    const soup = growRing(FRAME, CYLINDER, s);
    expect(soup).toHaveLength(s.around * (s.profile.length - 1) * 6);
    const radius = (p: number[]): number => Math.hypot(p[0], p[2]);
    const radii = soup.map((v) => radius(v.p));
    // never inside the scalp, and at its fullest the whole thickness off it
    expect(Math.min(...radii)).toBeCloseTo(1 + s.lift, 9);
    expect(Math.max(...radii)).toBeCloseTo(1 + s.lift + s.thick, 9);
    // the upper edge is the highest row and lies on the crown; the fullest row is low down
    const ys = soup.map((v) => v.p[1]);
    const top = soup.filter((v) => v.p[1] === Math.max(...ys));
    for (const v of top) expect(radius(v.p)).toBeCloseTo(1 + s.lift, 9);
    const fullest = soup.find((v) => radius(v.p) > 1 + s.lift + s.thick - 1e-9);
    expect(fullest?.p[1]).toBeLessThan((Math.max(...ys) + Math.min(...ys)) / 2);
    // the last row of the cross-section is back on the scalp, above the bottom edge: an underside
    const last = s.profile[s.profile.length - 1];
    expect(last[1]).toBe(0);
    expect(last[0]).toBeLessThan(1);
  });

  it('dips at the brow and closes on itself', () => {
    const s = MONK_SHAPE;
    const soup = growRing(FRAME, CYLINDER, s);
    const upperEdgeAt = (pick: (p: number[]) => boolean): number =>
      Math.max(...soup.filter((v) => pick(v.p)).map((v) => v.p[1]));
    // straight ahead (+z) the band sits browDrop lower than straight behind
    const brow = upperEdgeAt((p) => Math.abs(p[0]) < 1e-9 && p[2] > 0);
    const nape = upperEdgeAt((p) => Math.abs(p[0]) < 0.06 && p[2] < 0);
    expect(brow).toBeCloseTo(FRAME.top - s.topDrop - s.browDrop, 9);
    expect(nape).toBeGreaterThan(brow + s.browDrop * 0.9);
    // the last step round lands on the first: one ring, no gap, and the paint meets itself
    expect(ringU(s.around, s)).toBeCloseTo(ringU(0, s), 9);
    const first = soup.filter(
      (v) => v.t[0] === ringU(0, s) && Math.abs(v.p[0]) < 1e-9 && v.p[2] > 0,
    );
    expect(first.length).toBeGreaterThan(s.profile.length);
  });

  it('paints inside the texture patch', () => {
    for (const v of growRing(FRAME, CYLINDER, MONK_SHAPE)) {
      expect(v.t[0]).toBeGreaterThanOrEqual(POMP_PATCH.u0);
      expect(v.t[0]).toBeLessThanOrEqual(POMP_PATCH.u1);
      expect(v.t[1]).toBeGreaterThanOrEqual(POMP_PATCH.v0);
      expect(v.t[1]).toBeLessThanOrEqual(POMP_PATCH.v1);
      expect(Math.hypot(...v.n)).toBeCloseTo(1, 6);
    }
  });

  it('tints as the mohawk does, and ships one piece per type on its texture', () => {
    const top = glb(wocHeadPieceUrl('a', 'hair', MULLET_TOP_ID) as string);
    for (const type of TYPES) {
      expect(WOC_HEAD_TINT_TABLE[type][`hair_${MONK_ID}`]).toEqual(
        WOC_HEAD_TINT_TABLE.a[`hair_${MULLET_TOP_ID}`],
      );
      const url = wocHeadPieceUrl(type, 'hair', MONK_ID);
      expect(url).toBe(`models/chars/players/woc/head_type_${type}_hair_monk.glb`);
      const file = glb(url as string);
      const drawn = file.json.nodes.filter((n) => n.mesh !== undefined);
      expect(drawn.map((n) => n.name)).toEqual([`WocHead_${type.toUpperCase()}_hair_monk`]);
      expect(file.json.meshes[drawn[0].mesh as number].primitives).toHaveLength(1);
      expect(file.json.materials.map((m) => m.name)).toEqual(['hair_monk']);
      expect(imageBytes(file).equals(imageBytes(top))).toBe(true);
    }
  });
});
