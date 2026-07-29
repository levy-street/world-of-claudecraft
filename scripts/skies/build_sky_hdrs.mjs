// Convert a project sky painting (skies_in/<name>.png, equirect) into the
// runtime HDRI pair public/env/<out>_{2k,1k}.hdr: sRGB decoded to linear,
// written as flat (uncompressed) RGBE radiance files, the same format the
// shipped realm skies use. Usage:
//   node scripts/skies/build_sky_hdrs.mjs <src.png> <outBase> [exposure]
// e.g. node scripts/skies/build_sky_hdrs.mjs skies_in/vale_cup_practice.png vale_cup
import fs from 'node:fs';
import sharp from 'sharp';

const [srcPath, outBase, exposureArg] = process.argv.slice(2);
if (!srcPath || !outBase) {
  console.error('usage: node scripts/skies/build_sky_hdrs.mjs <src.png> <outBase> [exposure]');
  process.exit(1);
}
const exposure = exposureArg ? Number(exposureArg) : 1.0;

function toRgbe(r, g, b) {
  const max = Math.max(r, g, b);
  if (max < 1e-32) return [0, 0, 0, 0];
  let e = Math.ceil(Math.log2(max));
  let scale = 2 ** -e * 256;
  // keep the max mantissa inside [128, 256)
  if (max * scale >= 256) {
    e += 1;
    scale = 2 ** -e * 256;
  }
  return [
    Math.min(255, Math.floor(r * scale)),
    Math.min(255, Math.floor(g * scale)),
    Math.min(255, Math.floor(b * scale)),
    e + 128,
  ];
}

async function writeHdr(width, height, outPath) {
  const { data } = await sharp(srcPath)
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const out = Buffer.alloc(Buffer.byteLength(header) + width * height * 4);
  out.write(header, 0, 'ascii');
  let o = Buffer.byteLength(header);
  for (let i = 0; i < width * height; i++) {
    const r = (data[i * 3] / 255) ** 2.2 * exposure;
    const g = (data[i * 3 + 1] / 255) ** 2.2 * exposure;
    const b = (data[i * 3 + 2] / 255) ** 2.2 * exposure;
    const [er, eg, eb, ee] = toRgbe(r, g, b);
    out[o] = er;
    out[o + 1] = eg;
    out[o + 2] = eb;
    out[o + 3] = ee;
    o += 4;
  }
  fs.writeFileSync(outPath, out);
  console.log(`${outPath}: ${width}x${height}, ${Math.round(out.length / 1024)}KB`);
}

await writeHdr(2048, 1024, `public/env/${outBase}_2k.hdr`);
await writeHdr(1024, 512, `public/env/${outBase}_1k.hdr`);
