// Procedural matcaps for hair shading previews. Each preset bakes a 256px
// sphere-shading image analytically (wrap diffuse + Blinn lobes + sheen
// bands + rim), no binary assets, and the recipes stay editable here.
// They are kept near-grayscale on purpose: MeshMatcapMaterial multiplies the
// texture by material.color, so the appearance panel's hair wheel keeps
// working, the matcap contributes only the light, never the dye.
import { THREE } from '/three.bundle.js';

const SIZE = 256;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const sstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const norm3 = (x, y, z) => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};
const dot3 = (n, l) => n[0] * l[0] + n[1] * l[1] + n[2] * l[2];
/** Lambert softened by a wrap term, w=0 is hard Lambert, 1 is full wrap. */
const wrapDiff = (n, L, w) => clamp((dot3(n, L) + w) / (1 + w));
/** Blinn specular with the matcap's fixed view V=(0,0,1). */
const blinn = (n, L, p) => clamp(dot3(n, norm3(L[0], L[1], L[2] + 1))) ** p;
/** Smooth bump centred at c with half-width w, the hair "sheen band". */
const band = (y, c, w) => {
  const t = clamp(1 - Math.abs(y - c) / w);
  return t * t * (3 - 2 * t);
};

// Each shade(nx, ny, nz) returns a linear luminance (or [r,g,b]) with lit
// areas near 1 and cores near 0.2 to 0.4, so a matcap'd style reads about as
// bright as the standard-lit one at the same tint.
export const MATCAP_PRESETS = [
  {
    key: 'velvet',
    label: 'Velvet',
    tip: 'Velvet: soft matte wrap',
    shade: (nx, ny, nz) => {
      const L = norm3(-0.4, 0.55, 0.73);
      return 0.3 + 0.62 * wrapDiff([nx, ny, nz], L, 0.55) + 0.1 * (1 - nz) ** 2.2;
    },
  },
  {
    key: 'silk',
    label: 'Silk',
    tip: 'Silk: soft anisotropic sheen',
    shade: (nx, ny, nz) => {
      const n = [nx, ny, nz];
      const base = 0.26 + 0.44 * wrapDiff(n, norm3(-0.3, 0.45, 0.85), 0.45);
      const front = 0.35 + 0.65 * nz; // sheen lives on the shell, fades at the silhouette
      const sheen = 0.66 * band(ny, 0.42, 0.3) * (0.7 + 0.3 * (1 - nx * nx)) * front;
      const counter = 0.14 * band(ny, -0.38, 0.24) * front;
      return base + sheen + counter;
    },
  },
  {
    key: 'anime',
    label: 'Anime',
    tip: 'Anime: cel tones + angel band',
    shade: (nx, ny, nz) => {
      const n = [nx, ny, nz];
      const lit = sstep(0.45, 0.53, wrapDiff(n, norm3(-0.42, 0.5, 0.76), 0.35));
      let v = 0.38 + 0.5 * lit;
      v += 0.55 * sstep(0.25, 0.6, 1 - Math.abs(ny - 0.48) / 0.14) * sstep(0.05, 0.35, nz);
      v -= 0.1 * band(ny, -0.75, 0.35);
      return v;
    },
  },
  {
    key: 'gloss',
    label: 'Gloss',
    tip: 'Gloss: wet-look hotspot',
    shade: (nx, ny, nz) => {
      const n = [nx, ny, nz];
      const d = wrapDiff(n, norm3(-0.35, 0.5, 0.79), 0.2);
      let v = 0.2 + 0.48 * d * d;
      v += 1.0 * blinn(n, [-0.35, 0.5, 0.79], 110);
      v += 0.28 * blinn(n, [0.55, -0.2, 0.8], 30);
      v += 0.3 * (1 - nz) ** 2.6;
      return v;
    },
  },
  {
    key: 'pearl',
    label: 'Pearl',
    tip: 'Pearl: bright with a faint iridescent drift',
    shade: (nx, ny, nz) => {
      const n = [nx, ny, nz];
      const L = norm3(-0.3, 0.5, 0.81);
      const v = 0.42 + 0.46 * wrapDiff(n, L, 0.6) + 0.18 * blinn(n, [-0.3, 0.5, 0.81], 18);
      const ang = Math.atan2(ny, nx) * 2;
      return [
        v * (1 + 0.055 * Math.sin(ang + 0.8)),
        v * (1 + 0.055 * Math.sin(ang + 2.9)),
        v * (1 + 0.055 * Math.sin(ang + 5.0)),
      ];
    },
  },
  {
    key: 'noir',
    label: 'Noir',
    tip: 'Noir: dark core, hot back rim',
    shade: (nx, ny, nz) => {
      const n = [nx, ny, nz];
      let v = 0.14 + 0.26 * wrapDiff(n, norm3(-0.35, 0.45, 0.83), 0.25);
      const rimSide = 0.35 + 0.65 * clamp(0.5 + 0.5 * (nx * 0.6 + ny * 0.8));
      v += 0.8 * (1 - nz) ** 2.2 * rimSide;
      v += 0.22 * blinn(n, [-0.45, 0.55, 0.7], 60);
      return v;
    },
  },
];

const canvases = new Map(); // key -> baked canvas
const textures = new Map(); // key -> CanvasTexture

function bake(preset) {
  let c = canvases.get(preset.key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const px = img.data;
  for (let y = 0; y < SIZE; y++) {
    // Canvas row 0 is the top; flipY on CanvasTexture puts it back at uv.y=1,
    // which is where three's matcap shader looks for "world up", so ny is
    // +1 on the first row.
    const ny0 = 1 - (2 * (y + 0.5)) / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const nx0 = (2 * (x + 0.5)) / SIZE - 1;
      let nx = nx0;
      let ny = ny0;
      const r2 = nx * nx + ny * ny;
      let nz = 0;
      if (r2 > 1) {
        // Outside the sphere: hold the rim shading so bilinear taps at the
        // very edge of the uv disc never read garbage.
        const r = Math.sqrt(r2);
        nx /= r;
        ny /= r;
      } else {
        nz = Math.sqrt(1 - r2);
      }
      const out = preset.shade(nx, ny, nz);
      const rgb = Array.isArray(out) ? out : [out, out, out];
      const i = (y * SIZE + x) * 4;
      for (let ch = 0; ch < 3; ch++) px[i + ch] = Math.round(255 * clamp(rgb[ch]) ** (1 / 2.2));
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  canvases.set(preset.key, c);
  return c;
}

export function matcapTexture(key) {
  let t = textures.get(key);
  if (t) return t;
  const preset = MATCAP_PRESETS.find((p) => p.key === key);
  if (!preset) return null;
  t = new THREE.CanvasTexture(bake(preset));
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, t);
  return t;
}

/** CSS background for the picker swatch, the baked sphere itself. */
export function matcapSwatchCss(key) {
  const preset = MATCAP_PRESETS.find((p) => p.key === key);
  if (!preset) return '#444';
  return `#20242c url(${bake(preset).toDataURL()}) center/cover`;
}
