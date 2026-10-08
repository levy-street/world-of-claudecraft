// A geometry's levels and the variant geometries that draw them
// (src/render/assets/geometry_lod.ts): what a variant shares with its source, the cache, the
// fallbacks, the carries, and the ownership rule that keeps a dispose from freeing a buffer the
// other level still draws, pinned against three's own WebGLGeometries and WebGLAttributes (the
// code that deletes GL buffers on a geometry's dispose) over a recording GL stub.
import * as THREE from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { WebGLGeometries } from 'three/src/renderers/webgl/WebGLGeometries.js';
import { describe, expect, it, vi } from 'vitest';
import {
  applyGeometryLod,
  carryGeometryLod,
  geometryLodLevelOf,
  geometryLodOf,
  geometryLodSourceOf,
  geometryLodVariant,
  mergeGeometryLod,
  setGeometryLod,
} from '../src/render/assets/geometry_lod';

/** A two-quad strip (6 vertices, 4 triangles) with a morph target, a mid level of two
 *  triangles and a far level of one. */
function strip(levels: { mid?: boolean; far?: boolean } = { mid: true, far: true }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 2, 0, 1, 2, 0], 3),
  );
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
  g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
  g.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(18), 3)];
  g.morphTargetsRelative = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  setGeometryLod(g, {
    mid: levels.mid ? new THREE.BufferAttribute(new Uint16Array([0, 1, 4, 4, 1, 5]), 1) : undefined,
    far: levels.far ? new THREE.BufferAttribute(new Uint16Array([0, 1, 5]), 1) : undefined,
  });
  return g;
}

describe('variants share everything but the index', () => {
  it('draws the level over the very attribute objects of its source', () => {
    const source = strip();
    const mid = geometryLodVariant(source, 'mid');
    expect(mid).not.toBe(source);
    expect(mid.attributes).toBe(source.attributes);
    expect(mid.getAttribute('position')).toBe(source.getAttribute('position'));
    expect(mid.morphAttributes).toBe(source.morphAttributes);
    expect(mid.morphTargetsRelative).toBe(true);
    expect(mid.groups).toBe(source.groups);
    expect(mid.boundingBox).toBe(source.boundingBox);
    expect(mid.boundingSphere).toBe(source.boundingSphere);
    expect(mid.index).toBe(geometryLodOf(source)?.mid);
    expect([...(mid.index?.array ?? [])]).toEqual([0, 1, 4, 4, 1, 5]);
    // the source keeps drawing its own index
    expect(source.index?.count).toBe(12);
  });

  it('follows its source when the source swaps an attribute later', () => {
    const source = strip();
    const mid = geometryLodVariant(source, 'mid');
    const narrowed = new THREE.BufferAttribute(new Uint8Array(24), 4);
    source.setAttribute('skinIndex', narrowed);
    expect(mid.getAttribute('skinIndex')).toBe(narrowed);
  });

  it('is cached per (source, level), and maps back through its source', () => {
    const source = strip();
    const mid = geometryLodVariant(source, 'mid');
    const far = geometryLodVariant(source, 'far');
    expect(geometryLodVariant(source, 'mid')).toBe(mid);
    expect(geometryLodVariant(mid, 'far')).toBe(far);
    expect(geometryLodVariant(far, 'lod0')).toBe(source);
    expect(geometryLodSourceOf(far)).toBe(source);
    expect(geometryLodLevelOf(mid)).toBe('mid');
    expect(geometryLodLevelOf(far)).toBe('far');
    expect(geometryLodLevelOf(source)).toBe('lod0');
    expect(geometryLodOf(far)).toBe(geometryLodOf(source));
  });

  it('falls back to the next finer level the source carries', () => {
    const onlyMid = strip({ mid: true });
    expect(geometryLodVariant(onlyMid, 'far')).toBe(geometryLodVariant(onlyMid, 'mid'));
    const onlyFar = strip({ far: true });
    expect(geometryLodVariant(onlyFar, 'mid')).toBe(onlyFar);
    expect(geometryLodLevelOf(geometryLodVariant(onlyFar, 'far'))).toBe('far');
    const none = strip({});
    expect(geometryLodOf(none)).toBeNull();
    expect(geometryLodVariant(none, 'far')).toBe(none);
  });

  it('draws level 0 where another index cannot stand in: groups, a partial draw range', () => {
    const grouped = strip();
    grouped.addGroup(0, 6, 0);
    expect(geometryLodVariant(grouped, 'mid')).toBe(grouped);
    const ranged = strip();
    ranged.setDrawRange(0, 6);
    expect(geometryLodVariant(ranged, 'mid')).toBe(ranged);
  });

  it('swaps every mesh of a tree once, and back', () => {
    const a = strip();
    const b = strip({});
    const root = new THREE.Group();
    const ma = new THREE.Mesh(a);
    const mb = new THREE.Mesh(b);
    root.add(ma, mb);
    applyGeometryLod(root, 'mid');
    expect(ma.geometry).toBe(geometryLodVariant(a, 'mid'));
    expect(mb.geometry).toBe(b);
    applyGeometryLod(root, 'lod0');
    expect(ma.geometry).toBe(a);
  });
});

describe('carrying levels through a derived geometry', () => {
  it('copies the lists onto a geometry with the same vertices (each owns its own)', () => {
    const source = strip();
    const clone = source.clone();
    carryGeometryLod(source, clone);
    const lod = geometryLodOf(clone);
    expect(lod?.mid).not.toBe(geometryLodOf(source)?.mid);
    expect([...(lod?.mid?.array ?? [])]).toEqual([0, 1, 4, 4, 1, 5]);
    expect([...(lod?.far?.array ?? [])]).toEqual([0, 1, 5]);
  });

  it('carries nothing from a variant (its index already is a level), and sets nothing on one', () => {
    const source = strip();
    const mid = geometryLodVariant(source, 'mid');
    const derived = mid.clone();
    carryGeometryLod(mid, derived);
    expect(geometryLodOf(derived)).toBeNull();
    setGeometryLod(mid, { far: new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1) });
    expect(geometryLodOf(mid)?.far).toBe(geometryLodOf(source)?.far);
  });

  it('merges parts in vertex order, reading a variant part through its source', () => {
    const a = strip();
    const b = strip({ far: true });
    const out = new THREE.BufferGeometry();
    mergeGeometryLod(out, [
      { geometry: geometryLodVariant(a, 'mid') },
      { geometry: b, flip: true },
    ]);
    const lod = geometryLodOf(out);
    // a's mid, then b's level 0 (it has no mid) offset by a's six vertices and flipped
    expect([...(lod?.mid?.array ?? [])]).toEqual([
      0, 1, 4, 4, 1, 5, 6, 8, 7, 8, 9, 7, 8, 10, 9, 10, 11, 9,
    ]);
    expect([...(lod?.far?.array ?? [])]).toEqual([0, 1, 5, 6, 11, 7]);
    const plain = new THREE.BufferGeometry();
    mergeGeometryLod(plain, [{ geometry: strip({}) }]);
    expect(geometryLodOf(plain)).toBeNull();
  });

  it('merges a part no variant can draw (a partial draw range) at its level 0 throughout', () => {
    // the part itself draws level 0 at every level, so the merged mesh must too: a coarser
    // list there would pop the moment the merged mesh stood in for it
    const ranged = strip();
    ranged.setDrawRange(0, 12);
    const out = new THREE.BufferGeometry();
    mergeGeometryLod(out, [{ geometry: strip({ far: true }) }, { geometry: ranged }]);
    const lod = geometryLodOf(out);
    expect(lod?.mid).toBeUndefined();
    // the first part's far, then the ranged part's whole level 0 offset by six vertices
    expect([...(lod?.far?.array ?? [])]).toEqual([0, 1, 5, 6, 7, 8, 8, 7, 9, 8, 9, 10, 10, 9, 11]);
    const alone = new THREE.BufferGeometry();
    mergeGeometryLod(alone, [{ geometry: ranged }]);
    expect(geometryLodOf(alone)).toBeNull();
  });
});

describe('levels are set once', () => {
  it('keeps the levels a drawn variant draws when a second set arrives', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const source = strip();
      const mid = geometryLodVariant(source, 'mid');
      const before = geometryLodOf(source);
      setGeometryLod(source, { far: new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1) });
      expect(geometryLodOf(source)).toBe(before);
      expect(geometryLodVariant(source, 'mid')).toBe(mid);
      expect(warn).toHaveBeenCalledTimes(1);
      // a geometry no variant was asked of yet takes a new set
      const fresh = strip({});
      setGeometryLod(fresh, { mid: new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1) });
      expect(geometryLodOf(fresh)?.mid?.count).toBe(3);
    } finally {
      warn.mockRestore();
    }
  });
});

/** Three's own buffer bookkeeping over a GL stub that records what it creates and deletes. */
function glHarness() {
  let next = 1;
  const live = new Set<number>();
  const gl = {
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    UNSIGNED_SHORT: 5123,
    UNSIGNED_INT: 5125,
    UNSIGNED_BYTE: 5121,
    createBuffer: () => {
      const id = next++;
      live.add(id);
      return { id };
    },
    deleteBuffer: (buffer: { id: number }) => live.delete(buffer.id),
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    bufferSubData: () => undefined,
  };
  const released: THREE.BufferGeometry[] = [];
  const attributes = new WebGLAttributes(gl as unknown as WebGL2RenderingContext);
  const geometries = new (
    WebGLGeometries as unknown as new (
      ...args: unknown[]
    ) => {
      get(object: THREE.Object3D, geometry: THREE.BufferGeometry): THREE.BufferGeometry;
      update(geometry: THREE.BufferGeometry): void;
    }
  )(
    gl,
    attributes,
    { memory: { geometries: 0 } },
    {
      releaseStatesOfGeometry: (geometry: THREE.BufferGeometry) => released.push(geometry),
    },
  );
  /** One draw of `geometry` as WebGLObjects and WebGLBindingStates make it: register, upload
   *  every attribute, upload the index. */
  const draw = (geometry: THREE.BufferGeometry): void => {
    geometries.get(new THREE.Mesh(geometry), geometry);
    geometries.update(geometry);
    if (geometry.index) attributes.update(geometry.index, gl.ELEMENT_ARRAY_BUFFER);
  };
  const resident = (attribute: THREE.BufferAttribute | null | undefined): boolean => {
    const data = attribute ? attributes.get(attribute) : undefined;
    return data !== undefined && live.has((data.buffer as unknown as { id: number }).id);
  };
  return { draw, resident, live, released };
}

describe('disposal: a variant goes with its source, never alone', () => {
  it('a variant disposed alone frees nothing its source draws, nor its own index', () => {
    const { draw, resident, released } = glHarness();
    const source = strip();
    const mid = geometryLodVariant(source, 'mid');
    draw(source);
    draw(mid);
    mid.dispose();
    expect(resident(source.getAttribute('position') as THREE.BufferAttribute)).toBe(true);
    expect(resident(source.getAttribute('uv') as THREE.BufferAttribute)).toBe(true);
    expect(resident(source.index)).toBe(true);
    expect(resident(mid.index)).toBe(true);
    expect(released).toEqual([]);
  });

  it('a source dispose frees its buffers and every variant index, in the same call', () => {
    const { draw, resident, live, released } = glHarness();
    const source = strip();
    const mid = geometryLodVariant(source, 'mid');
    const far = geometryLodVariant(source, 'far');
    draw(source);
    draw(mid);
    draw(far);
    // the shared attributes uploaded once: position, uv, the source index and two levels
    expect(live.size).toBe(5);
    let midEvents = 0;
    mid.addEventListener('dispose', () => midEvents++);
    source.dispose();
    expect(midEvents).toBe(1);
    expect(resident(source.getAttribute('position') as THREE.BufferAttribute)).toBe(false);
    expect(resident(source.index)).toBe(false);
    expect(resident(mid.index)).toBe(false);
    expect(resident(far.index)).toBe(false);
    expect(live.size).toBe(0);
    expect(released).toEqual(expect.arrayContaining([source, mid, far]));
  });

  it('a variant drawn before its source ever was is still freed by the source', () => {
    const { draw, live } = glHarness();
    const source = strip();
    const mid = geometryLodVariant(source, 'mid');
    draw(mid);
    expect(live.size).toBe(3);
    source.dispose();
    expect(live.size).toBe(0);
  });

  it('a source redrawn after a dispose (a context rebuild) keeps its variants drawable', () => {
    const { draw, resident } = glHarness();
    const source = strip();
    const mid = geometryLodVariant(source, 'mid');
    draw(source);
    draw(mid);
    source.dispose();
    draw(source);
    draw(mid);
    expect(resident(mid.index)).toBe(true);
    expect(geometryLodVariant(source, 'mid')).toBe(mid);
    // and a second dispose cascades again
    source.dispose();
    expect(resident(mid.index)).toBe(false);
  });
});
