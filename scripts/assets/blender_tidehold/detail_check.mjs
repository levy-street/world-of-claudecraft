// Verify the detail pass preserves the palette: for every WocKitTimber /
// WocKitStone primitive, mean(COLOR_0) x mean(detail map, linear) must land
// back on the atlas swatch the face used to show.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const s2l = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const l2s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const meanCache = new Map();
async function detailMean(tex) {
  const k = tex.getName();
  if (meanCache.has(k)) return meanCache.get(k);
  const { data } = await sharp(Buffer.from(tex.getImage()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const m = [0, 0, 0];
  for (let i = 0; i < data.length; i += 3)
    for (let c = 0; c < 3; c++) m[c] += s2l(data[i + c] / 255);
  const n = data.length / 3;
  const out = m.map((v) => v / n);
  meanCache.set(k, out);
  return out;
}
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const name = f.split('/').pop();
  const acc = new Map();
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const mat = p.getMaterial();
      if (!mat || !/^Woc(KitTimber|KitStone)/.test(mat.getName())) continue;
      const col = p.getAttribute('COLOR_0');
      if (!col) {
        console.log(`${name}: ${mat.getName()} prim has NO COLOR_0, tint lost`);
        continue;
      }
      const key = mat.getName();
      if (!acc.has(key)) acc.set(key, { mat, sum: [0, 0, 0], n: 0, uniq: new Map() });
      const a = acc.get(key);
      const e = [0, 0, 0, 0];
      for (let i = 0; i < col.getCount(); i++) {
        col.getElement(i, e);
        for (let c = 0; c < 3; c++) a.sum[c] += e[c];
        a.n++;
        const kk = e
          .slice(0, 3)
          .map((v) => Math.round(l2s(Math.min(1, v / 1.45)) * 255))
          .join(',');
        a.uniq.set(kk, (a.uniq.get(kk) || 0) + 1);
      }
    }
  console.log(`\n=== ${name} ===`);
  for (const [k, a] of acc) {
    const dm = await detailMean(a.mat.getBaseColorTexture());
    const mean = a.sum.map((v) => v / a.n);
    const shown = mean.map((v, c) => Math.round(l2s(Math.min(1, v * dm[c])) * 255));
    const top = [...a.uniq]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 4)
      .map(([c, n]) => `rgb(${c})x${n}`)
      .join(' ');
    console.log(`  ${k}: ${a.n} verts, detail linear mean [${dm.map((v) => v.toFixed(3))}]`);
    console.log(`      rendered mean -> rgb(${shown})   top swatches: ${top}`);
  }
}
