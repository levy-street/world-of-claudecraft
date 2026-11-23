// Regrade one of the Fenrire painted maps (the mossy repaints of the painted kit's maps, the look
// the painted Fenbridge buildings wear) for the Mirefen tavern (textures.json). Deterministic; run
// once per map, by hand:
//
//   node scripts/assets/mirefen_tavern/regrade_map.mjs SOURCE.jpg OUT.jpg PRESET
//
// Two kinds of preset, both keeping the map's brushwork (and its tiling: every pixel is regraded
// on its own):
//   - a gain (fenrireStone, fenrireTimber, fenrireRoof): the map's own colours, scaled in linear
//     light per channel, a soft shoulder keeping the brightest strokes from clipping. The
//     tavern's TownStone, TownTimber and TownRoof colour maps are the Fenrire stone, oak and
//     slates lifted this way so that, under the tavern's own tints and shading (which darken a
//     wall's foot and the builders' shaded oak), they draw as Fenbridge's buildings draw them:
//     measured texel for texel against those buildings' baked maps
//     (public/models/tidehold/fenrire/*.glb), where the stone stands at about 0.96 of the raw
//     map's linear colour and its moss a touch less vivid, the oak about 0.9, and the slates
//     about 1.03 and a touch greener.
//   - a ramp (floor; timber and plaster are kept for the record): the map's brightness remapped
//     through a three-stop ramp of the preset's colours, its moss turned to a lichen. The
//     tavern's TownFloor colour map is the Fenrire boards regraded this way to a weathered brown
//     (the fires' warm light over it reads warm, never orange).
// The SOURCE is the Fenrire map itself: the ClaudeCraft Studio repository's
// scripts/assets/blender_tidehold/town_tex_painted_var/fenrire/ map of that name, the bytes the
// tavern shipped unchanged in tex/ until its painted rebuild (git history of tex/).
import sharp from 'sharp';

const [src, out, preset] = process.argv.slice(2);
const P = {
  // the Fenrire maps as Fenbridge's buildings show them: gains in linear light
  fenrireStone: { gain: [1.22, 1.12, 1.3] },
  fenrireTimber: { gain: [1.3, 1.27, 1.22] },
  fenrireRoof: { gain: [1.08, 1.12, 0.97] },
  timber: {
    lo: [0.15, 0.095, 0.065],
    mid: [0.36, 0.235, 0.15],
    hi: [0.6, 0.43, 0.29],
    lichen: [0.72, 0.42, 0.2],
    lichenAmt: 0.45,
    gamma: 1.0,
  },
  // the boards: a weathered brown, so the fires' warm light over them reads warm, never orange
  floor: {
    lo: [0.19, 0.13, 0.095],
    mid: [0.43, 0.32, 0.23],
    hi: [0.66, 0.54, 0.41],
    lichen: [0.52, 0.4, 0.3],
    lichenAmt: 0.2,
    gamma: 0.95,
  },
  plaster: {
    lo: [0.66, 0.58, 0.46],
    mid: [0.88, 0.81, 0.67],
    hi: [0.97, 0.93, 0.83],
    lichen: [0.82, 0.6, 0.4],
    lichenAmt: 0.35,
    gamma: 0.9,
  },
}[preset];
if (!src || !out || !P) {
  throw new Error(
    'usage: regrade_map.mjs SOURCE OUT fenrireStone|fenrireTimber|fenrireRoof|floor|timber|plaster',
  );
}

const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const n = info.width * info.height;
const pixels = Buffer.alloc(n * 3);
const lerp = (a, b, t) => a + (b - a) * t;
if (P.gain) {
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  // the shoulder: linear light over KNEE eases toward 1 instead of clipping at it
  const KNEE = 0.8;
  const shoulder = (v) => (v <= KNEE ? v : KNEE + (1 - KNEE) * Math.tanh((v - KNEE) / (1 - KNEE)));
  for (let i = 0; i < n * 3; i++) {
    const v = shoulder(toLinear(data[i] / 255) * P.gain[i % 3]);
    pixels[i] = Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255);
  }
} else {
  const L = new Float32Array(n);
  const M = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    L[i] = 0.3 * r + 0.55 * g + 0.15 * b;
    // the moss: green over both its red and its blue
    M[i] = Math.min(1, Math.max(0, (g - Math.max(r, b)) * 5));
  }
  // the ramp spans the map's own 2nd to 98th percentile of brightness
  const sorted = Float32Array.from(L).sort();
  const p2 = sorted[Math.floor(n * 0.02)];
  const p98 = sorted[Math.floor(n * 0.98)];
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, (L[i] - p2) / (p98 - p2))) ** P.gamma;
    const c =
      t < 0.5
        ? P.lo.map((v, k) => lerp(v, P.mid[k], t * 2))
        : P.mid.map((v, k) => lerp(v, P.hi[k], (t - 0.5) * 2));
    const m = M[i] * P.lichenAmt;
    for (let k = 0; k < 3; k++) {
      pixels[i * 3 + k] = Math.round(
        Math.min(1, lerp(c[k], P.lichen[k] * (0.7 + 0.5 * t), m)) * 255,
      );
    }
  }
}
await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 3 } })
  .jpeg({ quality: 92 })
  .toFile(out);
console.log('regraded', preset, out);
