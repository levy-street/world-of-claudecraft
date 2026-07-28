// Minimal, lossless GLB reader/patcher: parse the JSON + BIN chunks, read any
// accessor into floats, and write float accessors back AT THEIR ORIGINAL OFFSETS.
//
// Why not gltf-transform here: these character GLBs ship verbatim to players, and
// a full read/serialise round-trip de-interleaves the vertex buffers and re-lays
// out every bufferView, which grew the level-20 armor sets by 7 to 12 percent for
// a change that only touches normal values. Patching the BIN chunk in place keeps
// the file byte-identical apart from the numbers that were actually wrong, so the
// download weight and the git delta both stay honest. Read-only consumers that
// need extension support (compressed meshes) should use gltf-transform instead.

import fs from 'node:fs';

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const COMPONENT = {
  5120: { size: 1, max: 127, read: (b, o) => b.readInt8(o), write: (b, v, o) => b.writeInt8(v, o) },
  5121: {
    size: 1,
    max: 255,
    read: (b, o) => b.readUInt8(o),
    write: (b, v, o) => b.writeUInt8(v, o),
  },
  5122: {
    size: 2,
    max: 32767,
    read: (b, o) => b.readInt16LE(o),
    write: (b, v, o) => b.writeInt16LE(v, o),
  },
  5123: {
    size: 2,
    max: 65535,
    read: (b, o) => b.readUInt16LE(o),
    write: (b, v, o) => b.writeUInt16LE(v, o),
  },
  5125: {
    size: 4,
    max: 4294967295,
    read: (b, o) => b.readUInt32LE(o),
    write: (b, v, o) => b.writeUInt32LE(v, o),
  },
  5126: {
    size: 4,
    max: 1,
    read: (b, o) => b.readFloatLE(o),
    write: (b, v, o) => b.writeFloatLE(v, o),
  },
};
const COMPONENT_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** Split a .glb into its JSON chunk (parsed) and its BIN chunk (a Buffer view). */
export function readGlb(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  let offset = 12;
  let json = null;
  let bin = null;
  let binStart = -1;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(body.toString('utf8'));
    if (type === BIN_CHUNK) {
      bin = body;
      binStart = offset + 8;
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error(`${path}: no JSON chunk`);
  return { buf, json, bin, binStart };
}

/** Where an accessor's elements actually live in the BIN chunk. */
export function accessorLayout(json, index) {
  const accessor = json.accessors[index];
  if (accessor.bufferView === undefined) return null; // sparse / zero-filled
  const view = json.bufferViews[accessor.bufferView];
  const component = COMPONENT[accessor.componentType];
  if (!component) throw new Error(`unsupported componentType ${accessor.componentType}`);
  const items = COMPONENT_COUNT[accessor.type];
  return {
    accessor,
    view,
    component,
    items,
    start: (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    stride: view.byteStride ?? items * component.size,
    compressed: !!view.extensions?.EXT_meshopt_compression,
  };
}

/** Read an accessor as a flat Float64Array, denormalising integer components. */
export function readAccessor(json, bin, index) {
  const layout = accessorLayout(json, index);
  if (!layout) throw new Error(`accessor ${index} has no bufferView`);
  if (layout.compressed) throw new Error(`accessor ${index} is meshopt-compressed`);
  const { accessor, component, items, start, stride } = layout;
  const out = new Float64Array(accessor.count * items);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < items; c++) {
      let value = component.read(bin, start + i * stride + c * component.size);
      if (accessor.normalized) value = Math.max(value / component.max, -1);
      out[i * items + c] = value;
    }
  }
  return out;
}

/**
 * Overwrite a FLOAT, non-normalised accessor's values in place. Refuses anything
 * else: rewriting a quantised or compressed accessor losslessly is not possible
 * here, and silently re-encoding one would be exactly the class of mistake this
 * module exists to clean up after.
 */
export function writeFloatAccessor(json, bin, index, values) {
  const layout = accessorLayout(json, index);
  if (!layout) throw new Error(`accessor ${index} has no bufferView`);
  const { accessor, component, items, start, stride, compressed } = layout;
  if (compressed) throw new Error(`accessor ${index} is meshopt-compressed, re-export instead`);
  if (accessor.componentType !== 5126 || accessor.normalized) {
    throw new Error(`accessor ${index} is not plain FLOAT, re-export instead`);
  }
  if (values.length !== accessor.count * items) {
    throw new Error(
      `accessor ${index} expects ${accessor.count * items} values, got ${values.length}`,
    );
  }
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < items; c++) {
      component.write(bin, values[i * items + c], start + i * stride + c * component.size);
    }
  }
}

/** Write the (patched) file back. The JSON chunk and every byte offset are
 *  unchanged, so only the values that were edited differ. */
export function writeGlb(path, glb) {
  fs.writeFileSync(path, glb.buf);
}

/** The byte span an accessor occupies, so callers can prove two accessors that
 *  need different treatment do not overlap the same bytes. */
export function accessorSpan(json, index) {
  const layout = accessorLayout(json, index);
  if (!layout) return null;
  const { accessor, component, items, start, stride } = layout;
  return {
    view: accessor.bufferView,
    start,
    end: start + (accessor.count - 1) * stride + items * component.size,
    stride,
  };
}
