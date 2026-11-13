// Turn a raw Tripo weapon into the game's held-weapon shape (tests/weapon_skin_prewarm_host
// and tests/smith_heart_raid_arms describe it; src/render/characters/weapon_grip.ts holds it).
//
//   node normalize.mjs <arms.json> <key> <out.glb> [--double-sided] [--color-size 1024]
//        [--normal-size 512] [--flat-normal]
//
// arms.json[key]: { source, yaw, span, gripFrac, fistY, gripBand: [lo, hi] }
//   source    raw GLB (thin along X, wide along Z, head up +Y: Tripo's own frame)
//   yaw       degrees about +Y that bring the wide axis onto X (blade flat in XY)
//   span      final height along Y in model units
//   gripFrac  where the fist centre sits, as a fraction of the height from the foot
//   fistY     model y of the fist centre (-lift / in-hand scale)
//   gripBand  height fractions of the grip wrap; its vertices give the handle axis (x = z = 0)
//
// Output: one node, one mesh, one primitive and one material, all named <key>; identity
// node transform (everything baked into vertices); POSITION, NORMAL, TEXCOORD_0 only; a
// painted base colour (WebP), a uniform occlusion/roughness/metal map (no AO, rough 0.9,
// metal 0) shared by the occlusion and metal-rough slots, and a normal map; no extensions on
// the material, no emissive, no compression.
import { readFileSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const positional = [];
const opt = {
  doubleSided: false,
  colorSize: 1024,
  normalSize: 512,
  flatNormal: false,
  colorQ: 90,
  normalQ: 90,
};
while (argv.length) {
  const a = argv.shift();
  if (a === '--double-sided') opt.doubleSided = true;
  else if (a === '--color-size') opt.colorSize = Number(argv.shift());
  else if (a === '--normal-size') opt.normalSize = Number(argv.shift());
  else if (a === '--flat-normal') opt.flatNormal = true;
  else if (a === '--color-q') opt.colorQ = Number(argv.shift());
  else positional.push(a);
}
const [configPath, key, outPath] = positional;
if (!configPath || !key || !outPath) {
  console.error(
    'usage: normalize.mjs <arms.json> <key> <out.glb> [--double-sided] [--color-size n] [--normal-size n] [--flat-normal]',
  );
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(configPath, 'utf8'))[key];
if (!cfg) throw new Error(`no entry for ${key} in ${configPath}`);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const src = await io.read(cfg.source);

// ---- gather every primitive into one triangle soup with world transforms baked -------------
const positions = [];
const normals = [];
const uvs = [];
const indices = [];
let baseColorTex = null;
let normalTex = null;
for (const node of src.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const nor = prim.getAttribute('NORMAL');
    const uv = prim.getAttribute('TEXCOORD_0');
    if (!pos || !nor || !uv) throw new Error('primitive lacks POSITION, NORMAL or TEXCOORD_0');
    const base = positions.length / 3;
    const p = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      positions.push(
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      );
      nor.getElement(i, p);
      // Uniform-scale node matrices only (Tripo ships identity), so the upper 3x3 is enough.
      const nx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2];
      const ny = m[1] * p[0] + m[5] * p[1] + m[9] * p[2];
      const nz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2];
      const nl = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / nl, ny / nl, nz / nl);
      uv.getElement(i, p);
      uvs.push(p[0], p[1]);
    }
    const idx = prim.getIndices();
    if (idx) for (let i = 0; i < idx.getCount(); i++) indices.push(base + idx.getScalar(i));
    else for (let i = 0; i < pos.getCount(); i++) indices.push(base + i);
    const mat = prim.getMaterial();
    if (mat) {
      baseColorTex ??= mat.getBaseColorTexture();
      normalTex ??= mat.getNormalTexture();
    }
  }
}
if (!baseColorTex) throw new Error('source has no base colour texture');
const count = positions.length / 3;

// ---- orient: yaw about +Y so the wide axis lies on X ---------------------------------------
const th = (cfg.yaw * Math.PI) / 180;
const c = Math.cos(th);
const s = Math.sin(th);
for (let i = 0; i < count; i++) {
  const x = positions[i * 3];
  const z = positions[i * 3 + 2];
  positions[i * 3] = x * c + z * s;
  positions[i * 3 + 2] = -x * s + z * c;
  const nx = normals[i * 3];
  const nz = normals[i * 3 + 2];
  normals[i * 3] = nx * c + nz * s;
  normals[i * 3 + 2] = -nx * s + nz * c;
}
const bounds = () => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
};

// ---- scale to the span, seat the fist on the grip, put the handle axis on x = z = 0 --------
let b = bounds();
const scale = cfg.span / (b.max[1] - b.min[1]);
for (let i = 0; i < positions.length; i++) positions[i] *= scale;
b = bounds();
const yLo = b.min[1] + cfg.gripBand[0] * cfg.span;
const yHi = b.min[1] + cfg.gripBand[1] * cfg.span;
const band = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, n: 0 };
for (let i = 0; i < count; i++) {
  const y = positions[i * 3 + 1];
  if (y < yLo || y > yHi) continue;
  band.n++;
  band.minX = Math.min(band.minX, positions[i * 3]);
  band.maxX = Math.max(band.maxX, positions[i * 3]);
  band.minZ = Math.min(band.minZ, positions[i * 3 + 2]);
  band.maxZ = Math.max(band.maxZ, positions[i * 3 + 2]);
}
if (band.n < 8) throw new Error(`grip band holds only ${band.n} vertices: check gripBand`);
const axisX = (band.minX + band.maxX) / 2;
const axisZ = (band.minZ + band.maxZ) / 2;
const dy = cfg.fistY - cfg.gripFrac * cfg.span - b.min[1];
for (let i = 0; i < count; i++) {
  positions[i * 3] -= axisX;
  positions[i * 3 + 1] += dy;
  positions[i * 3 + 2] -= axisZ;
}
b = bounds();

// ---- textures ------------------------------------------------------------------------------
// The game lights up painted texels inside a hue window with enough HSL saturation and
// lightness (src/render/weapon_vfx_emissive_core.ts). A painted texture is full of PALE
// tints of the same hue (silver with a blue cast, bronze near amber), and HSL saturation is
// high for pale colours, so they would all glow. glowGate keeps the glow for the vivid paint
// only: inside the window, a texel whose chroma (max - min) is below `vivid` has its HSL
// saturation capped at `capS` (hue and lightness kept), ramped over `ramp` so the glow has
// no hard rim. The change to the eye is a slightly more neutral highlight.
const colorRaw = await sharp(Buffer.from(baseColorTex.getImage()))
  .resize(opt.colorSize, opt.colorSize, { fit: 'fill', kernel: 'lanczos3' })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const gateStats = {
  gated: 0,
  vivid: 0,
  toned: 0,
  total: colorRaw.info.width * colorRaw.info.height,
};
// tone: the Armory stage blooms anything brighter than about 0.6 in linear light, so pale
// paint (white silver, cream stone) would bloom into a white shape and hide its own detail.
// For paint that does not glow, values above `knee` are compressed toward `cap` (hue and
// saturation kept). Vivid paint inside the glow window is left as bright as it was painted.
if (cfg.glowGate || cfg.tone || cfg.toneVivid) {
  const g = cfg.glowGate;
  const ramp = g?.ramp ?? 0.1;
  const tone = cfg.tone;
  const toneK = tone ? (tone.cap - tone.knee) / (1 - tone.knee) : 1;
  const toneVivid = cfg.toneVivid;
  const toneVividK = toneVivid ? (toneVivid.cap - toneVivid.knee) / (1 - toneVivid.knee) : 1;
  const px = colorRaw.data;
  for (let i = 0; i < px.length; i += 3) {
    let r = px[i] / 255;
    let gg = px[i + 1] / 255;
    let b = px[i + 2] / 255;
    const mx = Math.max(r, gg, b);
    const mn = Math.min(r, gg, b);
    const d = mx - mn;
    const l = (mx + mn) / 2;
    let glow = 0;
    if (g && d > 0) {
      let hue;
      if (mx === r) hue = 60 * (((gg - b) / d + 6) % 6);
      else if (mx === gg) hue = 60 * ((b - r) / d + 2);
      else hue = 60 * ((r - gg) / d + 4);
      if (hue >= g.hue[0] - 4 && hue <= g.hue[1] + 4 && l >= (g.minL ?? 0) - 0.06) {
        const t = Math.max(0, Math.min(1, (d - (g.vivid - ramp)) / ramp));
        glow = t * t * (3 - 2 * t);
        if (glow >= 1) gateStats.vivid++;
        const sat = d / (1 - Math.abs(2 * l - 1));
        if (glow < 1 && sat > g.capS) {
          const scale = (g.capS + (sat - g.capS) * glow) / sat;
          r = l + (r - l) * scale;
          gg = l + (gg - l) * scale;
          b = l + (b - l) * scale;
          gateStats.gated++;
        }
      }
    }
    if (tone || toneVivid) {
      const v = Math.max(r, gg, b);
      // the scale for paint that does not glow, and the (gentler) one for vivid paint
      let kPlain = 1;
      if (tone && v > tone.knee) kPlain = (tone.knee + (v - tone.knee) * toneK) / v;
      let kVivid = 1;
      if (toneVivid && v > toneVivid.knee) {
        kVivid = (toneVivid.knee + (v - toneVivid.knee) * toneVividK) / v;
      }
      const k = kPlain + (kVivid - kPlain) * glow;
      if (k !== 1) {
        r *= k;
        gg *= k;
        b *= k;
        gateStats.toned++;
      }
    }
    px[i] = Math.round(255 * Math.max(0, Math.min(1, r)));
    px[i + 1] = Math.round(255 * Math.max(0, Math.min(1, gg)));
    px[i + 2] = Math.round(255 * Math.max(0, Math.min(1, b)));
  }
}
const colorBytes = await sharp(colorRaw.data, {
  raw: { width: colorRaw.info.width, height: colorRaw.info.height, channels: 3 },
})
  .webp({ quality: opt.colorQ, effort: 6, smartSubsample: true })
  .toBuffer();
// Occlusion in R (none), roughness in G (0.9), metal in B (0): the painted, non-metal look of
// the game's epic weapons, in the texture slots the skin host shader is warmed for.
const ormBytes = await sharp({
  create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 230, b: 0 } },
})
  .png()
  .toBuffer();
let normalBytes;
let normalMime;
if (normalTex && !opt.flatNormal) {
  normalBytes = await sharp(Buffer.from(normalTex.getImage()))
    .resize(opt.normalSize, opt.normalSize, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .webp({ quality: opt.normalQ, effort: 6 })
    .toBuffer();
  normalMime = 'image/webp';
} else {
  normalBytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 128, g: 128, b: 255 } },
  })
    .png()
    .toBuffer();
  normalMime = 'image/png';
}

// ---- write ---------------------------------------------------------------------------------
const doc = new Document();
doc.createExtension(EXTTextureWebP).setRequired(true);
const buffer = doc.createBuffer();
const color = doc.createTexture(`${key}_color`).setImage(colorBytes).setMimeType('image/webp');
const orm = doc.createTexture(`${key}_orm`).setImage(ormBytes).setMimeType('image/png');
const normal = doc.createTexture(`${key}_normal`).setImage(normalBytes).setMimeType(normalMime);
const material = doc
  .createMaterial(key)
  .setBaseColorTexture(color)
  .setBaseColorFactor([1, 1, 1, 1])
  .setMetallicRoughnessTexture(orm)
  .setOcclusionTexture(orm)
  .setMetallicFactor(1)
  .setRoughnessFactor(1)
  .setNormalTexture(normal)
  .setAlphaMode('OPAQUE')
  .setDoubleSided(opt.doubleSided);
const prim = doc
  .createPrimitive()
  .setMaterial(material)
  .setAttribute(
    'POSITION',
    doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer),
  )
  .setAttribute(
    'NORMAL',
    doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer),
  )
  .setAttribute(
    'TEXCOORD_0',
    doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer),
  )
  .setIndices(
    doc
      .createAccessor()
      .setType('SCALAR')
      .setArray(count < 65536 ? new Uint16Array(indices) : new Uint32Array(indices))
      .setBuffer(buffer),
  );
const mesh = doc.createMesh(key).addPrimitive(prim);
const node = doc.createNode(key).setMesh(mesh);
doc.createScene(key).addChild(node);
doc.getRoot().getAsset().generator = 'raid_arms_painted normalize.mjs (Tripo P2 mesh)';
const bytes = await io.writeBinary(doc);
writeFileSync(outPath, bytes);

const report = {
  key,
  out: outPath,
  bytes: bytes.length,
  tris: indices.length / 3,
  verts: count,
  min: b.min.map((v) => +v.toFixed(4)),
  max: b.max.map((v) => +v.toFixed(4)),
  span: +(b.max[1] - b.min[1]).toFixed(4),
  scale: +scale.toFixed(5),
  handleAxisShift: [+axisX.toFixed(4), +axisZ.toFixed(4)],
  gripBandVerts: band.n,
  gripBandHalfWidth: [
    +((band.maxX - band.minX) / 2).toFixed(4),
    +((band.maxZ - band.minZ) / 2).toFixed(4),
  ],
  textures: { color: colorBytes.length, orm: ormBytes.length, normal: normalBytes.length },
  doubleSided: opt.doubleSided,
  paint: {
    gatedPct: +((100 * gateStats.gated) / gateStats.total).toFixed(1),
    vividPct: +((100 * gateStats.vivid) / gateStats.total).toFixed(1),
    tonedPct: +((100 * gateStats.toned) / gateStats.total).toFixed(1),
  },
};
console.log(`NORMALIZE_JSON ${JSON.stringify(report)}`);
