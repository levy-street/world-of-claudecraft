// The far bake's vertex diet (src/render/characters/far_bake_compact.ts): a WOC piece is
// baked at its far level, an index over a fraction of its own vertices, and the bake used
// to pose, skin and store every vertex of level 0 to draw that fraction. The compact
// geometry keeps exactly the drawn vertices: same triangles, same attribute values bit
// for bit (a quantized position, a skin weight, a morph delta), same order, and a
// geometry there is nothing to drop from is handed back untouched.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compactDrawnVertices, FAR_BAKE_READS } from '../src/render/characters/far_bake_compact';

/** Six vertices in a row, one float per vertex in every attribute so a vertex is told by
 *  its value; quantized where the shipped files quantize (positions, uvs, skin weights). */
function strip(index: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = 6;
  const position = new Int16Array(n * 3);
  const uv = new Uint16Array(n * 2);
  const skinIndex = new Uint8Array(n * 4);
  const skinWeight = new Uint8Array(n * 4);
  const morph = new Int8Array(n * 3);
  for (let i = 0; i < n; i++) {
    position.set([i * 1000, i * 2000, -i * 3000], i * 3);
    uv.set([i * 10000, 65535 - i * 10000], i * 2);
    skinIndex.set([i, i + 1, 0, 0], i * 4);
    skinWeight.set([255 - i * 20, i * 20, 0, 0], i * 4);
    morph.set([i * 7, -i * 9, i], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(position, 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2, true));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4, true));
  g.morphAttributes.position = [new THREE.BufferAttribute(morph, 3, true)];
  g.morphTargetsRelative = true;
  g.setIndex(index);
  return g;
}

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** What a geometry draws: per triangle corner, every value three would read for it
 *  (through the attribute's own accessors, so a normalized or interleaved one is read as
 *  the bake reads it). */
function corners(g: THREE.BufferGeometry): number[][] {
  const index = g.index;
  if (!index) throw new Error('no index');
  const morph = g.morphAttributes.position?.[0] as Attribute | undefined;
  if (!morph) throw new Error('no morph target');
  const read = (a: Attribute, i: number): number[] =>
    Array.from({ length: a.itemSize }, (_, c) => a.getComponent(i, c));
  const out: number[][] = [];
  for (let k = 0; k < index.count; k++) {
    const i = index.getX(k);
    out.push([
      ...read(g.getAttribute('position'), i),
      ...read(g.getAttribute('uv'), i),
      ...read(g.getAttribute('skinIndex'), i),
      ...read(g.getAttribute('skinWeight'), i),
      ...read(morph, i),
    ]);
  }
  return out;
}

describe('compactDrawnVertices', () => {
  it('keeps exactly the vertices the index draws, in their own order, and draws the same triangles', () => {
    // a far level over a strip: vertices 1, 3 and 4 are never drawn
    const source = strip([5, 2, 0, 0, 2, 5]);
    const compact = compactDrawnVertices(source);
    expect(compact).not.toBe(source);
    expect(compact.getAttribute('position').count).toBe(3);
    // every corner reads the very values it read, through every attribute
    expect(corners(compact)).toEqual(corners(source));
    // the kept vertices are 0, 2, 5 in that order: the index is renumbered over them
    expect([...(compact.index?.array ?? [])]).toEqual([2, 1, 0, 0, 1, 2]);
    // raw data, not a read-back: the same typed arrays and normalization, bit for bit
    for (const name of ['position', 'uv', 'skinIndex', 'skinWeight']) {
      const a = compact.getAttribute(name) as THREE.BufferAttribute;
      const b = source.getAttribute(name) as THREE.BufferAttribute;
      expect(a.array.constructor, name).toBe(b.array.constructor);
      expect(a.normalized, name).toBe(b.normalized);
      expect(a.itemSize, name).toBe(b.itemSize);
    }
    expect([...compact.getAttribute('position').array]).toEqual([
      0, 0, 0, 2000, 4000, -6000, 5000, 10000, -15000,
    ]);
    const morph = compact.morphAttributes.position?.[0] as THREE.BufferAttribute;
    expect(morph.array.constructor).toBe(Int8Array);
    expect(morph.normalized).toBe(true);
    expect([...morph.array]).toEqual([0, 0, 0, 14, -18, 2, 35, -45, 5]);
    expect(compact.morphTargetsRelative).toBe(true);
    // the source is untouched: it is the pack's own geometry, drawn by every wearer
    expect(source.getAttribute('position').count).toBe(6);
    expect([...(source.index?.array ?? [])]).toEqual([5, 2, 0, 0, 2, 5]);
  });

  it('hands a geometry back as is when there is nothing to drop', () => {
    const whole = strip([0, 1, 2, 3, 4, 5]);
    expect(compactDrawnVertices(whole)).toBe(whole);
    const unindexed = new THREE.BufferGeometry();
    unindexed.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    expect(compactDrawnVertices(unindexed)).toBe(unindexed);
    const empty = new THREE.BufferGeometry();
    expect(compactDrawnVertices(empty)).toBe(empty);
    // an index over nothing (a primitive whose positions never loaded) is not a geometry
    // this can stand for either
    const indexOnly = new THREE.BufferGeometry();
    indexOnly.setIndex([0, 1, 2]);
    expect(compactDrawnVertices(indexOnly)).toBe(indexOnly);
  });

  it('leaves a shape it cannot stand for alone: groups, a draw range', () => {
    const grouped = strip([5, 2, 0]);
    grouped.addGroup(0, 3, 0);
    expect(compactDrawnVertices(grouped)).toBe(grouped);
    const ranged = strip([5, 2, 0, 1, 3, 4]);
    ranged.setDrawRange(0, 3);
    expect(compactDrawnVertices(ranged)).toBe(ranged);
    // a range that only skips its first triangles is a partial range too
    const late = strip([5, 2, 0, 1, 3, 4]);
    late.setDrawRange(3, Number.POSITIVE_INFINITY);
    expect(compactDrawnVertices(late)).toBe(late);
  });

  it('reads an interleaved stream out of its buffer: a quantized position padded to its stride', () => {
    // the shape the loader builds for a meshopt stream: three int16 in a stride of four,
    // and a second attribute sharing the buffer at an offset
    const source = strip([5, 2, 0, 0, 2, 5]);
    const n = 6;
    const packed = new Int16Array(n * 4);
    for (let i = 0; i < n; i++) packed.set([i * 1000, i * 2000, -i * 3000, 77 + i], i * 4);
    const buffer = new THREE.InterleavedBuffer(packed, 4);
    source.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0, true));
    source.setAttribute('pad', new THREE.InterleavedBufferAttribute(buffer, 1, 3, false));
    const before = corners(source);
    const compact = compactDrawnVertices(source);
    expect(compact).not.toBe(source);
    expect(compact.getAttribute('position').count).toBe(3);
    expect(corners(compact)).toEqual(before);
    const position = compact.getAttribute('position') as THREE.BufferAttribute;
    expect('isInterleavedBufferAttribute' in position).toBe(false);
    expect(position.array).toBeInstanceOf(Int16Array);
    expect(position.normalized).toBe(true);
    // its own three components each, never the stream's fourth
    expect([...position.array]).toEqual([0, 0, 0, 2000, 4000, -6000, 5000, 10000, -15000]);
    expect([...compact.getAttribute('pad').array]).toEqual([77, 79, 82]);
  });

  it('carries only what a caller reads when it says so: the far bake drops normals and morph normals', () => {
    const source = strip([5, 2, 0, 0, 2, 5]);
    source.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
    source.setAttribute('tangent', new THREE.Float32BufferAttribute(new Float32Array(24), 4));
    source.morphAttributes.normal = [new THREE.Float32BufferAttribute(new Float32Array(18), 3)];
    // by default everything rides along
    const all = compactDrawnVertices(source);
    expect(Object.keys(all.attributes).sort()).toEqual(
      ['normal', 'position', 'skinIndex', 'skinWeight', 'tangent', 'uv'].sort(),
    );
    expect(Object.keys(all.morphAttributes).sort()).toEqual(['normal', 'position']);
    // the far bake's reads: the four attributes it transforms by, the position morphs
    const read = compactDrawnVertices(source, FAR_BAKE_READS);
    expect(Object.keys(read.attributes).sort()).toEqual(
      ['position', 'skinIndex', 'skinWeight', 'uv'].sort(),
    );
    expect(Object.keys(read.morphAttributes)).toEqual(['position']);
    // ...and what it kept still draws corner for corner what the source drew
    expect(corners(read)).toEqual(corners(source));
    expect(read.morphTargetsRelative).toBe(true);
  });

  it('indexes the vertices it keeps with 16 bits while they fit, and 32 past that', () => {
    /** A geometry of `kept + 1` vertices whose index draws the first `kept`, once each. */
    const drawingFirst = (kept: number): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(new Float32Array((kept + 1) * 3), 3),
      );
      const index = new Uint32Array(kept);
      for (let i = 0; i < kept; i++) index[i] = i;
      g.setIndex(new THREE.BufferAttribute(index, 1));
      return g;
    };
    for (const [kept, width] of [
      [3, Uint16Array],
      [65535, Uint16Array],
      [65536, Uint32Array],
    ] as const) {
      const compact = compactDrawnVertices(drawingFirst(kept));
      expect(compact.getAttribute('position').count, String(kept)).toBe(kept);
      expect(compact.index?.array.constructor, String(kept)).toBe(width);
      // the last kept vertex is still the last one drawn: no index wrapped
      expect(compact.index?.getX(kept - 1), String(kept)).toBe(kept - 1);
    }
  });

  it('indexes a large compact geometry with 32 bits', () => {
    const n = 70_000;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((n + 1) * 3), 3));
    // every vertex but the last is drawn
    const index = new Uint32Array(n - (n % 3));
    for (let i = 0; i < index.length; i++) index[i] = i;
    index[index.length - 1] = n - 1;
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const compact = compactDrawnVertices(g);
    expect(compact).not.toBe(g);
    expect(compact.index?.array).toBeInstanceOf(Uint32Array);
    expect(compact.getAttribute('position').count).toBeGreaterThan(65535);
  });
});
