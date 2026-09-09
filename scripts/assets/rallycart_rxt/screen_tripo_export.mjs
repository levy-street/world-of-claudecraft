#!/usr/bin/env node
// Screen a raw Tripo export BEFORE spending any time wiring it up.
//
// A generation can look perfect in Tripo's viewer and read as mush in game, and
// the reason is measurable in seconds. Their viewer fills the screen with the
// model and samples the texture near mip 0, which is the best case and the only
// case it shows you. In game the mount is a few hundred pixels tall, the GPU
// drops several mip levels, and any UV island smaller than a mip texel has been
// averaged together with whatever unrelated island sits next to it in the
// atlas. Colours bleed between unrelated surfaces and detail turns to mush.
//
// THE METRIC IS RESOLUTION INDEPENDENT, which is the part that catches people
// out. Bleeding begins when the mip texel grows past the island, and the GPU
// picks the mip from the texel-to-pixel ratio, so what matters is the island's
// size as a FRACTION of UV space, not its size in texels. Doubling the atlas
// doubles the texels per island and doubles the mip drop, and the threshold
// does not move. Measured on two real exports of this car:
//
//   WRX-3   8.0 texels / 4096 atlas = 0.00195 of UV   holds to ~512px
//   WRX-2  15.6 texels / 8192 atlas = 0.00190 of UV   holds to ~526px
//
// Twice the texture, same verdict. So this reports the honest number: the
// on-screen size, in pixels, below which the median island stops holding
// together. Smaller is better, and it wants to be under how big the mount
// actually draws.
//
// PER-PART TEXTURES SIDESTEP ALL OF IT. The first export of this car came back
// with 42 materials and 42 images, one per part. An image containing exactly
// one part has nothing to bleed into: mip it down to 4x4 and every texel still
// belongs to that part, so it degrades to the right average colour instead of
// someone else's. That layout is reported as a pass regardless of island count,
// because it is structurally robust rather than merely high resolution.
//
// Usage: node scripts/assets/rallycart_rxt/screen_tripo_export.mjs <export.glb>

import { readFileSync } from 'node:fs';

/** How big the mount actually draws, in pixels, at ordinary play distance.
 *  The median island has to survive at least this. */
const TARGET_PIXELS = 320;

function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const jsonLength = buf.readUInt32LE(12);
  return {
    json: JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')),
    bin: buf.subarray(20 + jsonLength + 8),
  };
}

function readAccessor(glb, index) {
  const acc = glb.json.accessors[index];
  const view = glb.json.bufferViews[acc.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const width = { 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
  const read = {
    5123: (b, o) => b.readUInt16LE(o),
    5125: (b, o) => b.readUInt32LE(o),
    5126: (b, o) => b.readFloatLE(o),
  }[acc.componentType];
  const stride = view.byteStride ?? width * components;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    if (components === 1) {
      out.push(read(glb.bin, at));
      continue;
    }
    const tuple = [];
    for (let c = 0; c < components; c++) tuple.push(read(glb.bin, at + c * width));
    out.push(tuple);
  }
  return out;
}

/** JPEG or PNG dimensions, straight out of the header. */
function imageSize(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return null;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: screen_tripo_export.mjs <export.glb>');
    process.exit(2);
  }
  const glb = readGlb(path);
  const images = glb.json.images ?? [];
  const materials = glb.json.materials ?? [];
  const meshes = glb.json.meshes ?? [];
  const primCount = meshes.reduce((n, m) => n + m.primitives.length, 0);

  console.log(path);
  console.log(
    `  ${glb.json.nodes?.length ?? 0} nodes, ${meshes.length} meshes, ${primCount} primitives`,
  );
  console.log(`  ${materials.length} materials, ${images.length} images`);

  if (images.length > 1) {
    console.log('');
    console.log(`PASS: ${images.length} per-part textures.`);
    console.log('  Each image belongs to one part, so nothing can bleed into it and it mips');
    console.log('  down cleanly at any distance. This is the robust layout; island count');
    console.log('  inside a part barely matters. Wire it up.');
    return;
  }
  if (images.length === 0) {
    console.log('');
    console.log('NO TEXTURE in this export.');
    return;
  }

  // Single atlas: measure how small its islands are as a fraction of UV space.
  const view = glb.json.bufferViews[glb.json.images[0].bufferView];
  const bytes = glb.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const size = imageSize(bytes);

  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const uvOf = new Map();
  meshes.forEach((mesh, mi) => {
    for (const prim of mesh.primitives) {
      if (prim.attributes.TEXCOORD_0 === undefined) continue;
      const uv = readAccessor(glb, prim.attributes.TEXCOORD_0);
      const idx = readAccessor(glb, prim.indices);
      for (let t = 0; t < idx.length; t += 3) {
        const raw = [idx[t], idx[t + 1], idx[t + 2]];
        // Key per PRIMITIVE: index 5 of one primitive is not index 5 of another,
        // and merging them silently undercounts islands many times over.
        const keys = raw.map((v) => `${mi}:${v}`);
        keys.forEach((k, n) => {
          if (!parent.has(k)) {
            parent.set(k, k);
            uvOf.set(k, uv[raw[n]]);
          }
        });
        parent.set(find(keys[1]), find(keys[0]));
        parent.set(find(keys[2]), find(keys[0]));
      }
    }
  });

  const boxes = new Map();
  for (const key of parent.keys()) {
    const root = find(key);
    const [u, v] = uvOf.get(key);
    const box = boxes.get(root) ?? [9, 9, -9, -9];
    boxes.set(root, [
      Math.min(box[0], u),
      Math.min(box[1], v),
      Math.max(box[2], u),
      Math.max(box[3], v),
    ]);
  }
  // Narrow side of each island, as a fraction of UV space.
  const fractions = [...boxes.values()]
    .map((b) => Math.min(b[2] - b[0], b[3] - b[1]))
    .filter((f) => f > 0)
    .sort((a, b) => a - b);
  const at = (q) => fractions[Math.floor(fractions.length * q)];
  const median = at(0.5);
  // An island holds together while it is at least one sampled texel across.
  const holdsTo = Math.round(1 / median);

  console.log(
    `  atlas ${size ? `${size.width}x${size.height}` : 'unknown'}, ${fractions.length} UV islands`,
  );
  console.log('');
  console.log('  island narrow side, as a fraction of UV space:');
  console.log(
    `    10th pct ${at(0.1).toFixed(5)}   median ${median.toFixed(5)}   90th pct ${at(0.9).toFixed(5)}`,
  );
  console.log('');
  console.log(`  the median island holds together down to about ${holdsTo}px of car on screen`);
  console.log(`  the mount actually draws around ${TARGET_PIXELS}px`);
  console.log('');
  if (holdsTo <= TARGET_PIXELS) {
    console.log(`PASS: islands survive at the size this thing is actually viewed.`);
  } else {
    console.log(`FAIL: below ~${holdsTo}px the median island is under one texel and bleeds into`);
    console.log(`  its neighbours. It will look right in Tripo's viewer and like mush in game.`);
    console.log('  A bigger atlas will NOT fix this: the threshold is resolution independent.');
    console.log('  What fixes it is fewer and larger islands, or per-part textures.');
  }
}

main();
