// The mullet hairstyle (scripts/assets/woc_character/build_mullet_hair.mjs): the one WOC
// hairstyle built in-repo instead of from the Face Studio head files, the mohawk's strands
// over a tail cut from a committed sculpt. Pins what the build decides and nothing else
// checks: the tail's cut (a sector at the back, nothing on the sides, no mannequin left), how
// it is laid on the neck and painted, where the top lands per type, and the shipped files' own
// names and texture. The file set, codecs, sizes and triangle counts are held by the
// library-wide suites (woc_head_split_files, woc_character_size_budget, woc_triangle_budget).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import {
  cutTail,
  hugTail,
  MULLET_FIT,
  MULLET_ID,
  MULLET_TOP_ID,
  placeTop,
  readSculpt,
  TAIL_PANEL,
  tailUv,
} from '../scripts/assets/woc_character/build_mullet_hair.mjs';
import { WOC_HEAD_TYPES, wocHeadPieceUrl } from '../src/render/characters/woc_head_catalog';
import { WOC_HEAD_TINT_TABLE } from '../src/render/characters/woc_head_look_core';

const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'scripts/assets/woc_character/mullet_src/tripo_mullet_raw.glb');
const TYPES = ['a', 'b'] as const;

async function sculpt() {
  return readSculpt(await new NodeIO().read(RAW));
}

/** A GLB's JSON chunk and BIN chunk, served from public/. */
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

/** The bytes of a file's one image. */
function imageBytes(file: ReturnType<typeof glb>): Buffer {
  expect(file.json.images).toHaveLength(1);
  const view = file.json.bufferViews[file.json.images[0].bufferView];
  const at = view.byteOffset ?? 0;
  return file.bin.subarray(at, at + view.byteLength);
}

const degFromBack = (m: number[]): number => (Math.abs(Math.atan2(m[0], -m[2])) * 180) / Math.PI;

describe('the mullet hairstyle build', () => {
  it('is offered on both head types', () => {
    for (const type of TYPES) {
      expect(WOC_HEAD_TYPES[type].slots.hair.map((v) => v.id)).toContain(MULLET_ID);
    }
  });

  it.each(TYPES)('Type %s: the tail is a sector at the back, under the top', async (type) => {
    const fit = MULLET_FIT[type];
    // no head: nothing is dropped as mannequin, so the cut is the only thing measured
    const { soup, mannequin } = cutTail(await sculpt(), fit, []);
    expect(mannequin).toBe(0);
    expect(soup.length).toBeGreaterThan(0);
    expect(soup.length % 3).toBe(0);
    const slack = 1e-3; // the bisection's
    for (const v of soup) {
      // nothing above the tail line or below the shoulders, and nothing on the sides or the
      // front: past cutDeg the tail's upper edge IS the shoulder line, so all that can be left
      // there is the edge itself
      if (degFromBack(v.m) > fit.cutDeg) expect(v.m[1]).toBeLessThan(fit.backY + slack);
      expect(v.m[1]).toBeLessThan(fit.tailY + slack);
      expect(v.m[1]).toBeGreaterThan(fit.backY - slack);
    }
    // straight back it runs the whole way, from the tail line to the shoulder line
    const back = soup.filter((v) => degFromBack(v.m) < fit.keepDeg).map((v) => v.m[1]);
    expect(Math.max(...back)).toBeGreaterThan(fit.tailY - 0.02);
    expect(Math.min(...back)).toBeLessThan(fit.backY + 0.02);
  });

  it('drops triangles that lie on the head and keeps the ones off it', async () => {
    const raw = await sculpt();
    const fit = MULLET_FIT.a;
    const whole = cutTail(raw, fit, []).soup.length;
    // one huge triangle over everything, facing up: every corner is "inside" (below it)
    const floor = [
      [
        [-50, 5, -50],
        [0, 5, 50],
        [50, 5, -50],
      ],
    ];
    const under = cutTail(raw, fit, floor);
    expect(under.soup).toHaveLength(0);
    expect(under.mannequin).toBe(raw.indices.length / 3);
    // the same triangle far below: every corner is above it and far off, so nothing is dropped
    const below = [floor[0].map(([x, , z]) => [x, -5, z])];
    expect(cutTail(raw, fit, below).soup).toHaveLength(whole);
  });

  it('carries the tail on from the top: its root inside, forward again as it falls', () => {
    const fit = MULLET_FIT.a;
    const at = (y: number): number[] => hugTail([0.2, y, -0.3], fit);
    // at the nape line a point comes forward by the hug alone
    const nape = at(fit.napeY);
    expect(nape[2]).toBeCloseTo(-0.3 + fit.hug, 9);
    // above it the root comes forward faster than that, by `rise` per unit of height, so it
    // runs up inside the top instead of standing proud of it (the dent, seen from the side,
    // was a tail whose root sat further in than the top's back at ONE height only)
    const root = at(fit.tailY);
    expect(root[2]).toBeCloseTo(-0.3 + fit.hug + fit.rise * (fit.tailY - fit.napeY), 9);
    expect(root[2]).toBeGreaterThan(nape[2]);
    // and at the root it is the full tuck narrower than the sculpt
    expect(root[0]).toBeCloseTo(0.2 * (1 - fit.tuck), 9);
    // below the nape the lean carries it toward the neck, the tuck is spent by tuckDrop, and
    // only the narrowing is left on its width
    const drop = fit.tuckDrop + 0.05;
    const free = at(fit.napeY - drop);
    expect(free[0]).toBeCloseTo(0.2 * (1 - fit.narrow * drop), 9);
    expect(free[2]).toBeCloseTo(-0.3 + fit.hug + fit.lean * drop + fit.curl * drop * drop, 9);
    expect(free[2]).toBeGreaterThan(nape[2]);
    // the nape line is the furthest back the tail's own move leaves any point
    for (const y of [fit.tailY, fit.napeY + 0.05, fit.napeY - 0.05, fit.backY]) {
      expect(at(y)[2]).toBeGreaterThan(nape[2]);
      expect(at(y)[1]).toBe(y);
    }
  });

  it('paints the tail inside the strand panel, across the head and down the fall', async () => {
    const fit = MULLET_FIT.a;
    const { soup } = cutTail(await sculpt(), fit, []);
    for (const v of soup) {
      expect(v.t[0]).toBeGreaterThanOrEqual(TAIL_PANEL.u0);
      expect(v.t[0]).toBeLessThanOrEqual(TAIL_PANEL.u1);
      expect(v.t[1]).toBeGreaterThanOrEqual(TAIL_PANEL.v0);
      expect(v.t[1]).toBeLessThanOrEqual(TAIL_PANEL.v1);
    }
    // straight back, top of the tail: the middle of the panel's top edge
    const mid = (TAIL_PANEL.u0 + TAIL_PANEL.u1) / 2;
    expect(tailUv([0, fit.tailY, -0.3], fit)).toEqual([mid, TAIL_PANEL.v0]);
    expect(tailUv([0, fit.backY, -0.3], fit)).toEqual([mid, TAIL_PANEL.v1]);
    // one side of the head is one side of the panel
    expect(tailUv([0.2, 0, -0.3], fit)[0]).toBeGreaterThan(mid);
    expect(tailUv([-0.2, 0, -0.3], fit)[0]).toBeLessThan(mid);
  });

  it('places the top about its own middle, then by the type offset', () => {
    const corners = [{ p: [-1, 0, 2] }, { p: [1, 4, 6] }];
    // the middle is (0, 2, 4): scaled by 2 about it, then moved by (10, 20, 30)
    const placed = placeTop(corners, { dx: 10, dy: 20, dz: 30, inflate: 2 });
    expect(placed.map((c) => c.p)).toEqual([
      [8, 18, 30],
      [12, 26, 38],
    ]);
    // Type A wears the mohawk where the mohawk file has it
    const { dx, dy, dz } = MULLET_FIT.a.topPlace;
    expect([dx, dy, dz]).toEqual([0, 0, 0]);
  });

  it('tints as the mohawk does: one hair material on the mohawk reference', () => {
    for (const type of TYPES) {
      expect(WOC_HEAD_TINT_TABLE[type][`hair_${MULLET_ID}`]).toEqual(
        WOC_HEAD_TINT_TABLE.a[`hair_${MULLET_TOP_ID}`],
      );
    }
  });

  it('ships one piece per type: one primitive, on the mohawk texture byte for byte', () => {
    const top = glb(wocHeadPieceUrl('a', 'hair', MULLET_TOP_ID) as string);
    for (const type of TYPES) {
      const url = wocHeadPieceUrl(type, 'hair', MULLET_ID);
      expect(url).toBe(`models/chars/players/woc/head_type_${type}_hair_mullet.glb`);
      const file = glb(url as string);
      const drawn = file.json.nodes.filter((n) => n.mesh !== undefined);
      expect(drawn.map((n) => n.name)).toEqual([`WocHead_${type.toUpperCase()}_hair_mullet`]);
      expect(file.json.meshes[drawn[0].mesh as number].primitives).toHaveLength(1);
      expect(file.json.materials.map((m) => m.name)).toEqual(['hair_mullet']);
      expect(file.json.images[0].name).toBe(top.json.images[0].name);
      expect(imageBytes(file).equals(imageBytes(top))).toBe(true);
    }
  });
});
