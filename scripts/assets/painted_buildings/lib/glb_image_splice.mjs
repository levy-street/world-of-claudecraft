// Replace embedded images inside a GLB in place, byte for byte everywhere
// else. Used by ../rebake_walls.mjs to swap a building's re-baked walls maps
// into the shipped file and its texture tiers without re-encoding anything
// else: the meshopt-compressed geometry, every other image, the materials,
// samplers, nodes and extras keep their exact bytes, and only the binary
// layout (the offsets after a resized image) and the buffer length move.
//
// A GLB written by glTF-Transform keeps buffer 0 in the BIN chunk as a run of
// segments: plain bufferViews (the images) and, for EXT_meshopt_compression,
// the compressed streams its bufferViews point at through the extension
// (their own byteOffset is into the fallback buffer, which has no bytes).
// glTF-Transform starts each plain view (an image) on 8 bytes and each
// compressed stream on 4; the splice keeps that, so a splice that replaces
// nothing gives back the file byte for byte.

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const align4 = (n) => (n + 3) & ~3;
const align8 = (n) => (n + 7) & ~7;

/** Split a GLB into its JSON document and its BIN chunk. */
export function readGlb(buf) {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== CHUNK_JSON) throw new Error('first chunk is not JSON');
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binHead = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHead);
  if (buf.readUInt32LE(binHead + 4) !== CHUNK_BIN) throw new Error('second chunk is not BIN');
  return { json, bin: buf.subarray(binHead + 8, binHead + 8 + binLen) };
}

/** Every byte range of buffer 0 something references, in file order. */
function segments(json) {
  const out = [];
  json.bufferViews.forEach((view, index) => {
    const ext = view.extensions?.EXT_meshopt_compression;
    if (ext && ext.buffer === 0) {
      out.push({ index, kind: 'meshopt', offset: ext.byteOffset ?? 0, length: ext.byteLength });
    } else if (!ext && view.buffer === 0) {
      out.push({ index, kind: 'view', offset: view.byteOffset ?? 0, length: view.byteLength });
    }
  });
  out.sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < out.length; i++) {
    if (out[i].offset < out[i - 1].offset + out[i - 1].length) {
      throw new Error(`bufferViews ${out[i - 1].index} and ${out[i].index} overlap`);
    }
  }
  return out;
}

/** The bytes of a named image. */
export function imageBytes(glb, name) {
  const image = glb.json.images.find((img) => img.name === name);
  if (!image) throw new Error(`no image named ${name}`);
  const view = glb.json.bufferViews[image.bufferView];
  const at = view.byteOffset ?? 0;
  return glb.bin.subarray(at, at + view.byteLength);
}

/**
 * A new GLB with each image named in `replacements` (name -> bytes) swapped
 * in, and each attribute in `appended` added to its primitive. Throws when a
 * name is missing, when buffer 0 holds bytes nothing references (they would
 * be dropped), or when any untouched segment fails to come out byte-identical.
 *
 * `appended`: [{ mesh, primitive, name, data: Float32Array, type: 'VEC2' }],
 * each written as a plain FLOAT accessor over its own bufferView appended at
 * the end of buffer 0 (and at the end of the accessor and bufferView lists,
 * so every existing index keeps pointing where it did).
 */
export function spliceGlbImages(buf, replacements, appended = []) {
  const { json, bin } = readGlb(buf);
  const byView = new Map();
  for (const [name, bytes] of replacements) {
    const image = json.images.find((img) => img.name === name);
    if (!image) throw new Error(`no image named ${name}`);
    byView.set(image.bufferView, bytes);
  }
  const segs = segments(json);
  const used = segs.reduce((n, s) => n + s.length, 0);
  if (bin.length - used > 4 * segs.length + 4) {
    throw new Error(`buffer 0 holds ${bin.length - used} unreferenced bytes`);
  }
  const parts = [];
  let cursor = 0;
  const placed = [];
  for (const seg of segs) {
    const start = seg.kind === 'view' ? align8(cursor) : align4(cursor);
    if (start > cursor) parts.push(Buffer.alloc(start - cursor));
    const bytes = byView.get(seg.index) ?? bin.subarray(seg.offset, seg.offset + seg.length);
    if (seg.kind === 'meshopt' && byView.has(seg.index)) {
      throw new Error(`bufferView ${seg.index} is geometry, not an image`);
    }
    parts.push(Buffer.from(bytes));
    const view = json.bufferViews[seg.index];
    if (seg.kind === 'meshopt') {
      view.extensions.EXT_meshopt_compression.byteOffset = start;
    } else {
      view.byteOffset = start;
      view.byteLength = bytes.length;
    }
    placed.push({ seg, start, length: bytes.length });
    cursor = start + bytes.length;
  }
  const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  for (const add of appended) {
    const prim = json.meshes[add.mesh]?.primitives?.[add.primitive];
    if (!prim) throw new Error(`no primitive ${add.mesh}/${add.primitive}`);
    if (prim.attributes[add.name] !== undefined) {
      throw new Error(`primitive ${add.mesh}/${add.primitive} already has ${add.name}`);
    }
    const count = json.accessors[prim.attributes.POSITION].count;
    const width = COMPONENTS[add.type];
    if (add.data.length !== count * width) {
      throw new Error(`${add.name}: ${add.data.length} values for ${count} vertices`);
    }
    const start = align8(cursor);
    if (start > cursor) parts.push(Buffer.alloc(start - cursor));
    const bytes = Buffer.from(add.data.buffer, add.data.byteOffset, add.data.byteLength);
    parts.push(Buffer.from(bytes));
    json.bufferViews.push({
      buffer: 0,
      byteOffset: start,
      byteLength: bytes.length,
      target: 34962,
    });
    json.accessors.push({
      bufferView: json.bufferViews.length - 1,
      componentType: 5126,
      count,
      type: add.type,
    });
    prim.attributes[add.name] = json.accessors.length - 1;
    cursor = start + bytes.length;
  }
  const total = align4(cursor);
  if (total > cursor) parts.push(Buffer.alloc(total - cursor));
  const newBin = Buffer.concat(parts, total);
  json.buffers[0].byteLength = total;
  for (const { seg, start, length } of placed) {
    if (byView.has(seg.index)) continue;
    const a = bin.subarray(seg.offset, seg.offset + seg.length);
    const b = newBin.subarray(start, start + length);
    if (!a.equals(b)) throw new Error(`segment ${seg.index} changed`);
  }
  let jsonText = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = align4(jsonText.length) - jsonText.length;
  if (jsonPad) jsonText = Buffer.concat([jsonText, Buffer.alloc(jsonPad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonText.length + 8 + newBin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonText.length, 0);
  jsonHead.writeUInt32LE(CHUNK_JSON, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(newBin.length, 0);
  binHead.writeUInt32LE(CHUNK_BIN, 4);
  return Buffer.concat([header, jsonHead, jsonText, binHead, newBin]);
}
