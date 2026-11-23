// The tavern's textured props, packed for the build: each real model props.json lists (the
// trophies, the shelves, the barrels and the rest made with Tripo, shields from the game's own
// armoury) at its triangle budget, its painted texture laid into its own tile of the props' atlas
// (where props.json puts it: a big piece a big tile, a small one a small tile) and its UVs moved
// into that tile, turned about the vertical first where its face looks elsewhere (props.json's
// `turn`). A piece made from a `dense` model arrives at its budget already (bake_low.py, run
// first, writes its `source`); one with none is simplified to it here, its UV seams kept. Writes
// the atlas (tex/TavernProps_Color.jpg, the TavernProps material's map in textures.json) and
// props_data.json (each prop's corners, triangles and atlas UVs, in the tavern's frame: +y up,
// its face looking +z, its back on z 0), which inn_props.py hangs in the room. Deterministic; run
// it again only when props.json or a source changes:
//
//   blender -b --factory-startup --python scripts/assets/mirefen_tavern/props/bake_low.py
//   node scripts/assets/mirefen_tavern/props/build_atlas.mjs
//
// A source may be a shipped GLB (meshopt, quantized, KTX2: its texture is decoded with KTX-Software's
// `ktx` tool, on PATH or in KTX_BIN) or a plain one (a Tripo export: JPEG or PNG). The Tripo
// exports and the low pieces baked from them are a maintainer-local source pack under
// tmp/asset_src/mirefen_tavern_props/ (gitignored, as every raw pack is): what this writes is the
// checked-in record of them, and the asset test pins it to props.json.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const TAVERN = path.resolve(HERE, '..');
const MANIFEST = JSON.parse(readFileSync(path.join(HERE, 'props.json'), 'utf8'));

if (process.env.KTX_BIN)
  process.env.PATH = `${process.env.PATH}${path.delimiter}${process.env.KTX_BIN}`;
await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

/** A source's one textured mesh, in the frame of its file: positions, UVs and triangles, with
 *  its nodes' transforms applied, and its base colour texture as PNG bytes. */
async function readSource(file) {
  const doc = await io.read(path.join(ROOT, file));
  const pos = [];
  const uv = [];
  const tris = [];
  let texture = null;
  const v = [0, 0, 0];
  const t = [0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const p = prim.getAttribute('POSITION');
      const tc = prim.getAttribute('TEXCOORD_0');
      if (!p || !tc) throw new Error(`${file}: a primitive without positions or UVs`);
      const base = pos.length / 3;
      for (let k = 0; k < p.getCount(); k++) {
        p.getElement(k, v);
        pos.push(
          m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
          m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
          m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
        );
        tc.getElement(k, t);
        uv.push(t[0], t[1]);
      }
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : p.getCount();
      for (let k = 0; k < n; k++) tris.push(base + (idx ? idx.getScalar(k) : k));
      const tex = prim.getMaterial()?.getBaseColorTexture();
      if (tex && !texture) texture = tex;
    }
  }
  if (!texture) throw new Error(`${file}: no base colour texture`);
  let png = texture.getImage();
  if (texture.getMimeType() === 'image/ktx2') {
    const dir = mkdtempSync(path.join(tmpdir(), 'tavern-props-'));
    writeFileSync(path.join(dir, 'map.ktx2'), png);
    execFileSync('ktx', [
      'extract',
      '--transcode',
      'rgba8',
      path.join(dir, 'map.ktx2'),
      path.join(dir, 'map.png'),
    ]);
    png = readFileSync(path.join(dir, 'map.png'));
    rmSync(dir, { recursive: true, force: true });
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), tris: new Uint32Array(tris), png };
}

/** The mesh brought down to about `target` triangles, its UV seams and borders kept. */
function simplify(mesh, target) {
  const count = mesh.tris.length / 3;
  if (count <= target) return mesh.tris;
  const [tris] = MeshoptSimplifier.simplifyWithAttributes(
    mesh.tris,
    mesh.pos,
    3,
    mesh.uv,
    2,
    [0.5, 0.5],
    null,
    target * 3,
    0.12,
  );
  return tris;
}

/** The mesh turned `degrees` about +y (+z toward +x), in place: props.json's `turn` brings a
 *  source whose face looks elsewhere round to +z. */
function turn(pos, degrees) {
  if (!degrees) return;
  const c = Math.cos((degrees * Math.PI) / 180);
  const s = Math.sin((degrees * Math.PI) / 180);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const z = pos[i + 2];
    pos[i] = x * c + z * s;
    pos[i + 2] = -x * s + z * c;
  }
}

const round = (x) => Math.round(x * 10000) / 10000;

/** Each prop's tile ([left, top, side] in atlas pixels), checked to lie inside the atlas and
 *  clear of every other tile. */
function tilesOf(props, width, height) {
  const rects = props.map((prop) => {
    const [x, y, side] = prop.tile;
    if (x < 0 || y < 0 || x + side > width || y + side > height) {
      throw new Error(`${prop.id}: its tile runs off the ${width} by ${height} atlas`);
    }
    return { id: prop.id, x, y, side };
  });
  for (const [i, a] of rects.entries()) {
    for (const b of rects.slice(i + 1)) {
      if (a.x < b.x + b.side && b.x < a.x + a.side && a.y < b.y + b.side && b.y < a.y + a.side) {
        throw new Error(`${a.id} and ${b.id}: their tiles overlap`);
      }
    }
  }
  return rects;
}

async function main() {
  const { width, height, pad } = MANIFEST.atlas;
  const rects = tilesOf(MANIFEST.props, width, height);
  const tiles = [];
  const data = { atlas: MANIFEST.atlas.out, props: {} };
  for (const [n, prop] of MANIFEST.props.entries()) {
    const { x: left, y: top, side } = rects[n];
    const inner = side - 2 * pad;
    const mesh = await readSource(prop.source);
    turn(mesh.pos, prop.turn ?? 0);
    const tris = simplify(mesh, prop.triangles);
    // the corners the triangles still use, in first-use order (stable)
    const remap = new Map();
    const order = [];
    for (const i of tris) {
      if (!remap.has(i)) {
        remap.set(i, order.length);
        order.push(i);
      }
    }
    // its box: centred on x and y, its back on z 0 (the face looks +z, out of the wall)
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const i of order) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], mesh.pos[i * 3 + k]);
        hi[k] = Math.max(hi[k], mesh.pos[i * 3 + k]);
      }
    }
    const shift = [-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]];
    const ox = left + pad;
    const oy = top + pad;
    const verts = order.map((i) => [0, 1, 2].map((k) => round(mesh.pos[i * 3 + k] + shift[k])));
    // UVs into its tile (glTF's top-left origin), then turned to Blender's (bottom-left)
    const uvs = order.map((i) => {
      const u = (ox + Math.min(1, Math.max(0, mesh.uv[i * 2])) * inner) / width;
      const w = (oy + Math.min(1, Math.max(0, mesh.uv[i * 2 + 1])) * inner) / height;
      return [round(u), round(1 - w)];
    });
    const faces = [];
    for (let k = 0; k < tris.length; k += 3) {
      faces.push([remap.get(tris[k]), remap.get(tris[k + 1]), remap.get(tris[k + 2])]);
    }
    data.props[prop.id] = {
      source: prop.source,
      size: [0, 1, 2].map((k) => round(hi[k] - lo[k])),
      verts,
      uvs,
      faces,
    };
    tiles.push({
      input: await sharp(mesh.png)
        .removeAlpha()
        .resize(inner, inner, { fit: 'fill', kernel: 'lanczos3' })
        // the tile's border repeats its edge, so a mip never bleeds the next tile in
        .extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: 'copy' })
        .png()
        .toBuffer(),
      left,
      top,
    });
    console.log(
      `${prop.id}: ${mesh.tris.length / 3} -> ${faces.length} triangles, tile ${side} at ${left},${top}`,
    );
  }
  await sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } },
  })
    .composite(tiles)
    .jpeg({ quality: 92 })
    .toFile(path.join(TAVERN, MANIFEST.atlas.out));
  writeFileSync(path.join(TAVERN, MANIFEST.atlas.data), `${JSON.stringify(data)}\n`);
  console.log('wrote', MANIFEST.atlas.out, 'and', MANIFEST.atlas.data);
}

await main();
