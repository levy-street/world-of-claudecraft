// The six facial-hair styles built in the repo (scripts/assets/woc_character/
// build_facial_hair.mjs): each is a shipped beard reshaped in place. Pins what the reshapes
// decide and nothing else checks: each style's defining move and what it leaves alone, the
// normal's turn through a shape, and that every shipped file is its source piece with only
// its positions changed (same triangles, same texture bytes, the chin morph kept). The file
// set, codecs, sizes and triangle counts are held by the library-wide suites.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FACIAL_STYLE_IDS,
  FACIAL_STYLES,
  type FacialFrame,
  FRAME_EXTRA,
  frameOf,
  liftOff,
  reshape,
} from '../scripts/assets/woc_character/build_facial_hair.mjs';
import {
  WOC_HEAD_MORPHS,
  WOC_HEAD_TYPES,
  wocHeadPieceUrl,
} from '../src/render/characters/woc_head_catalog';
import { WOC_HEAD_TINT_TABLE } from '../src/render/characters/woc_head_look_core';

const ROOT = path.resolve(__dirname, '..');
const TYPES = ['a', 'b'] as const;

/** A frame a unit wide and a unit tall about the origin: u = x, v = y. */
const FRAME: FacialFrame = { cx: 0, hw: 1, y0: 0, y1: 1, z0: 0, z1: 1, ...FRAME_EXTRA.a };
const at = (id: string, p: number[]): number[] => FACIAL_STYLES[id].shape(p, FRAME);

interface GlbJson {
  nodes: { name?: string; mesh?: number }[];
  meshes: {
    extras?: { targetNames?: string[] };
    primitives: { indices: number; material: number; targets?: unknown[] }[];
  }[];
  materials: { name: string; doubleSided?: boolean }[];
  accessors: { count: number }[];
  images: { name?: string; bufferView: number }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
}

function glb(url: string): { json: GlbJson; bin: Buffer } {
  const buf = readFileSync(path.join(ROOT, 'public', url));
  const jsonLength = buf.readUInt32LE(12);
  const binAt = 20 + jsonLength;
  return {
    json: JSON.parse(buf.subarray(20, binAt).toString('utf8')),
    bin: buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt)),
  };
}

function imageBytes(file: ReturnType<typeof glb>, index: number): Buffer {
  const view = file.json.bufferViews[file.json.images[index].bufferView];
  const start = view.byteOffset ?? 0;
  return file.bin.subarray(start, start + view.byteLength);
}

describe('the reshaped facial-hair styles', () => {
  it('offers all six on both head types, each from a file of its own', () => {
    expect(FACIAL_STYLE_IDS).toEqual(['forked', 'sage', 'wild', 'walrus', 'whiskers', 'imperial']);
    for (const type of TYPES) {
      const offered = WOC_HEAD_TYPES[type].slots.beard.map((v) => v.id);
      for (const id of FACIAL_STYLE_IDS) {
        expect(offered).toContain(id);
        expect(wocHeadPieceUrl(type, 'beard', id)).toBe(
          `models/chars/players/woc/head_type_${type}_beard_${id}.glb`,
        );
      }
    }
  });

  it('reads a piece frame off its points', () => {
    const frame = frameOf(
      [
        [-1, 2, 5],
        [3, 6, 9],
      ],
      { sageDrop: 7 },
    );
    expect(frame).toEqual({ cx: 1, hw: 2, y0: 2, y1: 6, z0: 5, z1: 9, sageDrop: 7 });
  });

  it('forked: the lower beard parts into two tines, and the jaw is left alone', () => {
    // at the jaw and above nothing moves
    expect(at('forked', [0.5, 0.8, 0.5])).toEqual([0.5, 0.8, 0.5]);
    // at the tip, points left and right of the middle draw apart round their own tines
    const left = at('forked', [-0.1, 0, 0.5]);
    const right = at('forked', [0.1, 0, 0.5]);
    expect(right[0]).toBeGreaterThan(0.1);
    expect(left[0]).toBeCloseTo(-right[0], 9);
    // and the middle is lifted into the notch between them
    expect(at('forked', [0, 0, 0.5])[1]).toBeGreaterThan(right[1]);
  });

  it('sage: the tip is drawn down by the drop, to one point, and the jaw is left alone', () => {
    expect(at('sage', [0.5, 0.8, 0.5])).toEqual([0.5, 0.8, 0.5]);
    const tip = at('sage', [0.5, 0, 1]);
    expect(tip[1]).toBeCloseTo(-FRAME_EXTRA.a.sageDrop, 9);
    // it is broad: wider than the long beard just under the jaw, and still at the tip it
    // comes to a point, well under half the width it started with
    expect(Math.abs(at('sage', [0.5, 0.3, 1])[0])).toBeGreaterThan(0.5);
    expect(Math.abs(tip[0])).toBeLessThan(0.5 * 0.4);
    // half way down it has swung forward of where it started
    expect(at('sage', [0, 0.25, 1])[2]).toBeGreaterThan(1);
    // it reaches the crotch on both body types, further forward where the chest is fuller
    expect(FRAME_EXTRA.b.sageDrop).toBe(FRAME_EXTRA.a.sageDrop);
    expect(FRAME_EXTRA.b.sageSwing).toBeGreaterThan(FRAME_EXTRA.a.sageSwing);
  });

  it('wild: wider, fuller and longer below, held where it meets the sideburns', () => {
    expect(at('wild', [0.9, 0.95, 0.2])).toEqual([0.9, 0.95, 0.2]);
    // round the mouth it is fuller but no lower: only the hair under the chin is drawn down
    expect(at('wild', [0.3, 0.5, 1])[1]).toBe(0.5);
    const low = at('wild', [0.5, 0.1, 1]);
    expect(low[0]).toBeGreaterThan(0.5);
    expect(low[1]).toBeLessThan(0.1);
    expect(low[2]).toBeGreaterThan(1);
    // the tufts are teased below and never at the sideburns, and the tease repeats
    const jitter = FACIAL_STYLES.wild.jitter as NonNullable<
      (typeof FACIAL_STYLES)['wild']['jitter']
    >;
    expect(Math.hypot(...jitter([0.9, 0.95, 0.2], FRAME))).toBe(0);
    const tease = jitter([0.5, 0.1, 1], FRAME);
    expect(Math.hypot(...tease)).toBeGreaterThan(0);
    expect(jitter([0.5, 0.1, 1], FRAME)).toEqual(tease);
  });

  it('walrus: hung from its top edge, thicker, and lower at the corners', () => {
    // the top edge on the centre line only comes forward
    const top = at('walrus', [0, 1, 0.5]);
    expect([top[0], top[1]]).toEqual([0, 1]);
    expect(top[2]).toBeGreaterThan(0.5);
    // a point below the edge hangs more than twice as far below it
    expect(1 - at('walrus', [0, 0.9, 0.5])[1]).toBeGreaterThan(0.2);
    // and the corners droop under the middle
    expect(at('walrus', [1, 1, 0.5])[1]).toBeLessThan(top[1]);
  });

  it('whiskers and imperial: the middle is the handlebar, only the tips turn', () => {
    for (const id of ['whiskers', 'imperial']) {
      expect(at(id, [0.2, 0.5, 0.5])).toEqual([0.2, 0.5, 0.5]);
      expect(at(id, [-0.3, 0.5, 0.5])).toEqual([-0.3, 0.5, 0.5]);
    }
    // the whiskers' tips hang down and come in under the corners of the mouth, and come
    // FORWARD to the front of the moustache: the handlebar's tips run back along the cheeks,
    // so a tip that only dropped would hang inside the jaw
    const hung = at('whiskers', [1, 0.5, 0]);
    expect(hung[2]).toBeCloseTo(FRAME.z1, 9);
    // a tail is a plain strand: the handlebar's end flicks up, and hung down that flick
    // would stand out as a hook, so a tip far above the strand lands within its thickness
    const flick = at('whiskers', [1, 0.9, 0]);
    expect(Math.abs(flick[0] - hung[0])).toBeLessThan(0.005);
    expect(flick[1]).toBeCloseTo(hung[1], 9);
    expect(FACIAL_STYLES.whiskers.clear?.([1, 0.5, 0], FRAME)).toBeGreaterThan(0);
    expect(FACIAL_STYLES.whiskers.clear?.([0.2, 0.5, 0], FRAME)).toBe(0);
    expect(hung[1]).toBeLessThan(0.5 - 0.08);
    expect(hung[0]).toBeLessThan(0.6);
    expect(at('whiskers', [-1, 0.5, 0.5])[0]).toBeCloseTo(-hung[0], 9);
    // the imperial's tips stand up
    const up = at('imperial', [1, 0.5, 0.5]);
    expect(up[1]).toBeCloseTo(0.5 + 0.05, 9);
    expect(at('imperial', [-1, 0.5, 0.5])[1]).toBeCloseTo(up[1], 9);
  });

  it('lifts a point off the skin to its clearance, and leaves one that already stands off', () => {
    // the "head" is everything below y = 0: distance is the height
    const probe = (p: number[]): number => p[1];
    expect(liftOff([1, -0.02, 2], probe, 0.003)[1]).toBeCloseTo(0.003, 9);
    expect(liftOff([1, 0.001, 2], probe, 0.003)).toEqual([1, 0.003, 2]);
    expect(liftOff([1, 0.01, 2], probe, 0.003)).toEqual([1, 0.01, 2]);
    // no clearance asked: untouched, even inside
    expect(liftOff([1, -0.02, 2], probe, 0)).toEqual([1, -0.02, 2]);
  });

  it('turns a normal through the shape, and leaves it where the shape does nothing', () => {
    // in the untouched middle of the imperial the normal is kept
    const still = reshape(FACIAL_STYLES.imperial, [0.2, 0.5, 0.5], [0, 0, 1], FRAME);
    expect(still.p).toEqual([0.2, 0.5, 0.5]);
    expect(still.n[2]).toBeCloseTo(1, 6);
    // a shape that squeezes x to a tenth turns a diagonal normal toward x (inverse transpose)
    const squeeze = { from: '', file: '', shape: ([x, y, z]: number[]) => [x * 0.1, y, z] };
    const turned = reshape(squeeze, [1, 0, 0], [Math.SQRT1_2, Math.SQRT1_2, 0], FRAME);
    expect(turned.p).toEqual([0.1, 0, 0]);
    expect(turned.n[0] / turned.n[1]).toBeCloseTo(10, 3);
    expect(Math.hypot(...turned.n)).toBeCloseTo(1, 9);
  });

  it('tints each style on its source texture reference', () => {
    for (const type of TYPES) {
      for (const id of FACIAL_STYLE_IDS) {
        const from = FACIAL_STYLES[id].from;
        expect(WOC_HEAD_TINT_TABLE[type][`hair_beard_${id}`]).toEqual(
          WOC_HEAD_TINT_TABLE[type][`hair_beard_${from}`],
        );
      }
    }
  });

  it.each(TYPES)('Type %s: every file is its source piece, reshaped and nothing else', (type) => {
    const T = type.toUpperCase();
    for (const id of FACIAL_STYLE_IDS) {
      const style = FACIAL_STYLES[id];
      const file = glb(wocHeadPieceUrl(type, 'beard', id) as string);
      const drawn = file.json.nodes.filter((n) => n.mesh !== undefined);
      expect(drawn.map((n) => n.name)).toEqual([`WocHead_${T}_beard_${id}`]);
      const mesh = file.json.meshes[drawn[0].mesh as number];
      expect(mesh.primitives).toHaveLength(1);
      expect(file.json.materials.map((m) => [m.name, m.doubleSided])).toEqual([
        [`hair_beard_${id}`, true],
      ]);
      // the chin slider still moves it
      expect(mesh.extras?.targetNames).toEqual([WOC_HEAD_MORPHS.chinWidth]);
      expect(mesh.primitives[0].targets).toHaveLength(1);
      // the same triangles and the same texture, byte for byte, as the piece it came from
      const source = glb(`models/chars/players/woc/head_type_${type}_${style.file}.glb`);
      const from = source.json.nodes.find((n) => n.name === `WocHead_${T}_beard_${style.from}`);
      const fromPrim = source.json.meshes[from?.mesh as number].primitives[0];
      expect(file.json.accessors[mesh.primitives[0].indices].count).toBe(
        source.json.accessors[fromPrim.indices].count,
      );
      expect(file.json.images).toHaveLength(1);
      expect(imageBytes(file, 0).equals(imageBytes(source, 0))).toBe(true);
    }
  });
});
