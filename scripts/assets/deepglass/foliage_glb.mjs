// Shared finishing steps for the Deepglass foliage kits (finish_dg_trees.mjs,
// finish_dg_shrubs.mjs).
//
// THE BACK FACE WAS NEVER SHIPPED. The builders emit every foliage card twice,
// once per winding, both carrying the same up-and-out normal, so a card on a
// single-sided material lights the same from either side (a double-sided
// material flips the back-face normal and half a crown goes black). But the
// two windings share one vertex set, and Blender's glTF export evaluates the
// mesh through a validate pass that deletes duplicate faces, so every GLB
// shipped ONE winding: tree_pine_full had 1732 triangles in Blender and 1028
// in the file. Each card was invisible from behind, which is the real cause of
// years of "floating leaves" and "the leaves vanish when they face the camera".
//
// So the second winding is added HERE, after export, where nothing can merge
// it away: every triangle of a `Leaves*` primitive gets a reversed twin on the
// SAME vertices (same shared normal), unless the twin is already present.
export function doubleWindLeaves(doc) {
  let added = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat || !/^Leaves/.test(mat.getName())) continue;
      const idx = prim.getIndices();
      if (!idx) continue;
      const a = idx.getArray();
      // Twins are found by POSITION, not index: the v2 builders emit each
      // card's back face on its own vertices (so it can carry its own UVs
      // and shade), and those must not be doubled a second time.
      const pos = prim.getAttribute('POSITION');
      const v = [0, 0, 0];
      const pk = (i) => {
        pos.getElement(i, v);
        return `${Math.round(v[0] * 1e4)},${Math.round(v[1] * 1e4)},${Math.round(v[2] * 1e4)}`;
      };
      const keys = new Array(pos.getCount());
      for (let i = 0; i < keys.length; i++) keys[i] = pk(i);
      const seen = new Set();
      const key = (x, y, z) => `${keys[x]}|${keys[y]}|${keys[z]}`;
      for (let i = 0; i < a.length; i += 3) seen.add(key(a[i], a[i + 1], a[i + 2]));
      const extra = [];
      for (let i = 0; i < a.length; i += 3) {
        const [x, y, z] = [a[i], a[i + 1], a[i + 2]];
        // the reversed triangle, in any of its three rotations
        if (seen.has(key(x, z, y)) || seen.has(key(z, y, x)) || seen.has(key(y, x, z))) continue;
        extra.push(x, z, y);
      }
      if (!extra.length) continue;
      const Ctor =
        a.length + extra.length > 65535 || a.constructor === Uint32Array
          ? Uint32Array
          : Uint16Array;
      const out = new Ctor(a.length + extra.length);
      out.set(a, 0);
      out.set(extra, a.length);
      idx.setArray(out);
      added += extra.length / 3;
    }
  }
  return added;
}

/** Triangle count of every primitive in the document (what the GPU draws). */
export function triCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  return n;
}
