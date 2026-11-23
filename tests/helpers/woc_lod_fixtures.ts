// Fixture meshes for the WOC_lod suites (tests/woc_lod_indices.test.ts,
// tests/woc_lod_extension.test.ts): an indexed height-field grid with normals and uvs, hung on a
// node of its own, so the LOD generator and the extension run on real glTF-Transform documents
// without reading a shipped file.
import { type Document, type Mesh, type Node, Primitive } from '@gltf-transform/core';

export interface GridOptions {
  /** quads per side (the grid has (n + 1)^2 vertices and 2 n^2 triangles) */
  n: number;
  /** side length in scene units, centred on the origin in x and z */
  size?: number;
  /** height of the surface at (x, z); flat when omitted */
  height?: (x: number, z: number) => number;
  /** unreferenced vertices placed BEFORE the grid's own (pushes its vertex numbers up) */
  padding?: number;
  /** a morph target's POSITION delta per vertex, by grid position */
  morph?: (x: number, z: number) => [number, number, number];
  name?: string;
}

/** A triangle-list grid primitive (u32 indices, float POSITION, NORMAL, TEXCOORD_0). */
export function gridPrimitive(doc: Document, opts: GridOptions): Primitive {
  const { n, size = 1, height = () => 0, padding = 0 } = opts;
  const side = n + 1;
  const count = padding + side * side;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const delta = opts.morph ? new Float32Array(count * 3) : null;
  for (let i = 0; i < padding; i++) nrm[i * 3 + 1] = 1;
  const e = 1e-4;
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const v = padding + r * side + c;
      const x = (c / n - 0.5) * size;
      const z = (r / n - 0.5) * size;
      const y = height(x, z);
      pos.set([x, y, z], v * 3);
      // the surface normal from the height field's slope
      const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
      const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
      const len = Math.hypot(dx, 1, dz);
      nrm.set([-dx / len, 1 / len, -dz / len], v * 3);
      uv.set([c / n, r / n], v * 2);
      if (delta && opts.morph) delta.set(opts.morph(x, z), v * 3);
    }
  }
  const indices = new Uint32Array(n * n * 6);
  let k = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = padding + r * side + c;
      const b = a + 1;
      const d = a + side;
      const f = d + 1;
      indices.set([a, d, b, b, d, f], k);
      k += 6;
    }
  }
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const acc = (
    type: 'SCALAR' | 'VEC2' | 'VEC3',
    array: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
  ) => doc.createAccessor('', buffer).setType(type).setArray(array);
  const prim = doc
    .createPrimitive()
    .setMode(Primitive.Mode.TRIANGLES)
    .setIndices(acc('SCALAR', indices))
    .setAttribute('POSITION', acc('VEC3', pos))
    .setAttribute('NORMAL', acc('VEC3', nrm))
    .setAttribute('TEXCOORD_0', acc('VEC2', uv));
  if (delta) {
    prim.addTarget(
      doc.createPrimitiveTarget('slider').setAttribute('POSITION', acc('VEC3', delta)),
    );
  }
  return prim;
}

/** A mesh of the given primitives on a node of its own in the document's scene. */
export function hang(
  doc: Document,
  name: string,
  ...prims: Primitive[]
): { mesh: Mesh; node: Node } {
  const mesh = doc.createMesh(name);
  for (const prim of prims) mesh.addPrimitive(prim);
  const node = doc.createNode(name).setMesh(mesh);
  const scene = doc.getRoot().listScenes()[0] ?? doc.createScene('scene');
  scene.addChild(node);
  if (prims.some((p) => p.listTargets().length)) {
    mesh.setWeights(prims[0].listTargets().map(() => 0));
    mesh.setExtras({ targetNames: prims[0].listTargets().map((t) => t.getName()) });
  }
  return { mesh, node };
}

/** A bumpy surface: a few gentle waves, so every simplification moves the surface a little. */
export const waves = (x: number, z: number): number =>
  0.03 * Math.sin(5 * x) * Math.cos(4 * z) + 0.01 * Math.sin(13 * x + 7 * z);

/** The squared distance from a point to a triangle (brute force reference, no acceleration). */
export function pointTriangleDistance(
  p: ArrayLike<number>,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  c: ArrayLike<number>,
): number {
  // Ericson's closest point on a triangle, Real-Time Collision Detection 5.1.5
  const sub = (u: ArrayLike<number>, v: ArrayLike<number>) => [
    u[0] - v[0],
    u[1] - v[1],
    u[2] - v[2],
  ];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  const at = (u: number, v: number) => [
    a[0] + u * ab[0] + v * ac[0],
    a[1] + u * ab[1] + v * ac[1],
    a[2] + u * ab[2] + v * ac[2],
  ];
  let q: number[];
  if (d1 <= 0 && d2 <= 0) q = [a[0], a[1], a[2]];
  else {
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    const cp = sub(p, c);
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) q = [b[0], b[1], b[2]];
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) q = at(d1 / (d1 - d3), 0);
    else if (d6 >= 0 && d5 <= d6) q = [c[0], c[1], c[2]];
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) q = at(0, d2 / (d2 - d6));
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
    } else {
      const den = 1 / (va + vb + vc);
      q = at(vb * den, vc * den);
    }
  }
  return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
}

/** The largest distance from every vertex `base` draws to the surface `lod` draws, by brute
 *  force over every triangle (the independent reference the generator's tree is held to). */
export function bruteDeviation(
  pos: Float32Array,
  base: ArrayLike<number>,
  lod: ArrayLike<number>,
): number {
  const drawn = new Set<number>();
  for (let i = 0; i < base.length; i++) drawn.add(base[i]);
  const vec = (v: number) => pos.subarray(v * 3, v * 3 + 3);
  let max = 0;
  for (const v of drawn) {
    let best = Infinity;
    for (let t = 0; t < lod.length; t += 3) {
      const d = pointTriangleDistance(vec(v), vec(lod[t]), vec(lod[t + 1]), vec(lod[t + 2]));
      if (d < best) best = d;
    }
    max = Math.max(max, best);
  }
  return Math.sqrt(max);
}
