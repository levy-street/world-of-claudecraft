// Heatsworn Ember: shift the emberkin's fel green to fire red, and derive a red glow map
// from the lit pockets. node recolor.mjs <in.png> <color_out.png> <emissive_out.png>
import sharp from 'sharp';

const [, , src, colorOut, emOut] = process.argv;
const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const n = info.width * info.height;
const col = Buffer.alloc(n * 3);
const em = Buffer.alloc(n * 3);

function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}
function hsv2rgb(h, s, v) {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [r + m, g + m, b + m];
}
const clamp = (x) => Math.max(0, Math.min(1, x));
for (let i = 0; i < n; i++) {
  const [h, s, v] = rgb2hsv(data[i * 3] / 255, data[i * 3 + 1] / 255, data[i * 3 + 2] / 255);
  // Lit fel pockets become fire red (the brightest cores a touch orange); the dark rock
  // loses its green cast and goes a neutral warm charcoal. w blends the two smoothly.
  const w = clamp((s - 0.2) / 0.2) * clamp((v - 0.18) / 0.14);
  const [fr, fg, fb] = hsv2rgb(v > 0.8 ? 10 : 0, Math.max(s, v > 0.8 ? 0.8 : 0.92), v);
  const [rr, rg, rb] = hsv2rgb(15, 0.12, v * 0.9);
  const r = fr * w + rr * (1 - w),
    g = fg * w + rg * (1 - w),
    b = fb * w + rb * (1 - w);
  col[i * 3] = r * 255;
  col[i * 3 + 1] = g * 255;
  col[i * 3 + 2] = b * 255;
  const glow = clamp((s - 0.3) / 0.3) * clamp((v - 0.28) / 0.4);
  em[i * 3] = r * 255 * glow;
  em[i * 3 + 1] = g * 255 * glow;
  em[i * 3 + 2] = b * 255 * glow;
}
const raw = { raw: { width: info.width, height: info.height, channels: 3 } };
await sharp(col, raw).png().toFile(colorOut);
await sharp(em, raw).png().toFile(emOut);
console.log('done', info.width, info.height);
