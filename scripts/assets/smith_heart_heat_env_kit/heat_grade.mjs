// The Heat's grade for its Tripo atlases and paintings (prepare_sources.mjs). The builds
// came back a warm brown-violet with the sheets' orange rim light baked onto every rock
// edge, which read as fire everywhere; the owner wants the molten as an accent only ("a
// mix with molten but don't overdo it", 2026-11-10). Each texel is read as one of three
// things and graded as its own:
//   - rock: put on the sooted basalt ramp by value (charcoal shade, slate body, a warm grey
//     on its lit planes), the baked orange rims taken out with the rest of its hue;
//   - the first flame's crystal: bright and warm, kept, nudged toward white-gold;
//   - molten: saturated red-orange, kept as built; in the seamed basalt and the falls (the
//     dressed concept of 2026-11-10) kept even as a thin seam and taken onto a deep orange
//     (`HEAT_DEEP_MOLTEN`: the owner's note, a darker orange so the guardian pops on it).

/** The basalt by value (sRGB): the dressed concept's charcoal (the owner's note of
 *  2026-11-10: as close to the concept as it gets), a cool dark shade, a mauve-grey body,
 *  warm grey lit planes, so the cliffs read as rock under the dusk, never a black void,
 *  and the warm stays in the light, the seams and the falls. */
export const HEAT_RAMP = [
  [0, [20, 19, 23]],
  [70, [44, 42, 47]],
  [125, [74, 69, 73]],
  [178, [112, 104, 102]],
  [238, [164, 154, 148]],
];

/** The backdrop's molten (sRGB) by the texel's own brightest channel: an ember red at its
 *  dim edges, a deep orange at its brightest, never yellow (the owner's note of 2026-11-10:
 *  a darker orange in the background so the red-orange guardian pops on it). */
export const HEAT_DEEP_MOLTEN = [
  [0, [44, 10, 4]],
  [140, [158, 50, 12]],
  [255, [226, 102, 26]],
];

/** The seams' molten (sRGB): a hot orange at a seam's heart (an orange, never the
 *  guardian's yellow-white), cooling to an ember red in the glow round it. */
export const HEAT_SEAM_HOT = [250, 128, 34];
export const HEAT_SEAM_EMBER = [120, 34, 10];

/** How a thin seam is drawn so it reads across the hall: its molten grown by `grow`
 *  texels (a max filter) and a soft glow `halo` texels round it at `haloShare`. */
export const HEAT_SEAM_SPREAD = { grow: 1, halo: 3, haloShare: 0.55 };

/** The first flame's white-gold (sRGB): the crystal's lit faces drift toward it. */
export const HEAT_WHITE_GOLD = [255, 226, 160];

function rampAt(ramp, v) {
  for (let i = 1; i < ramp.length; i++) {
    if (v > ramp[i][0]) continue;
    const [a, ca] = ramp[i - 1];
    const [b, cb] = ramp[i];
    const t = (v - a) / (b - a);
    return [0, 1, 2].map((k) => ca[k] + (cb[k] - ca[k]) * t);
  }
  return ramp[ramp.length - 1][1];
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** How much of a texel is molten: red well past blue, and bright. A rock edge the sheet's
 *  rim light warmed is warm but dim, and stays rock. */
export function moltenShare(r, g, b) {
  return clamp01((r - b - 90) / 40) * clamp01((r - 150) / 40) * clamp01((r - g - 40) / 40);
}

/** How much of a texel is the first flame's crystal: warm, bright, and less red than the
 *  molten (its green high too). */
export function crystalShare(r, g, b) {
  const luma = 0.3 * r + 0.59 * g + 0.11 * b;
  return clamp01((luma - 140) / 40) * clamp01((r - b - 30) / 40) * clamp01((g - b - 20) / 30);
}

/** Where the builds' rock sits by value: Tripo's basalt came back dark and narrow (its
 *  luma's middle near 75, its tenth to ninetieth percentiles about 65 to 95), so it is
 *  stretched about that middle onto the ramp's body, keeping its facets apart. */
export const HEAT_ROCK_PIVOT = 75;
export const HEAT_ROCK_STRETCH = 1.8;

/** How much of a texel is unmistakably molten: deeply saturated red-orange, whatever lies
 *  round it (a thin seam keeps its fire). */
export function moltenCoreShare(r, g, b) {
  return clamp01((r - g - 100) / 40) * clamp01((r - 170) / 40);
}

/** The share of fire round each texel: the warm mask (molten or crystal) box-blurred over
 *  `radius` texels each way, wrapped. The sheets' orange rim light baked a thin warm line
 *  onto every rock edge, as saturated in linear light as the molten and as bright as the
 *  crystal's dimmer faces, so colour alone cannot tell them apart; shape can: a crystal's
 *  faces and a fall's ribbon are broad, a rim is a line. */
export function fireRegion(px, width, height, radius) {
  const warm = new Float32Array(width * height);
  for (let i = 0, t = 0; t < warm.length; i += 3, t++) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    warm[t] = Math.max(moltenShare(r, g, b), crystalShare(r, g, b));
  }
  const pass = (src, dx, dy) => {
    const out = new Float32Array(src.length);
    const n = 2 * radius + 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = (x + dx * k + width) % width;
          const yy = (y + dy * k + height) % height;
          s += src[yy * width + xx];
        }
        out[y * width + x] = s / n;
      }
    }
    return out;
  };
  return pass(pass(warm, 1, 0), 0, 1);
}

/** Grade raw RGB of a `width` by `height` atlas by `amount` (0 leaves it as built).
 *  `seams`: the build's molten is thin seams by design (the seamed basalt, the thin fall),
 *  kept wherever it is molten, not only in a broad region; `deep`: its molten taken onto
 *  `HEAT_DEEP_MOLTEN`. */
export function gradeHeat(px, amount, width, height, { seams = false, deep = false } = {}) {
  const region = fireRegion(px, width, height, Math.max(2, Math.round(width / 128)));
  const spread = seams && deep ? seamSpread(px, width, height) : null;
  for (let i = 0, t = 0; i < px.length; i += 3, t++) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    // A warm texel keeps its fire only inside a broad warm region (or as the molten's own
    // core); a rim's thin line goes to the basalt with the rest of the rock.
    const broad = Math.min(1, Math.max(0, (region[t] - 0.4) / 0.25));
    const core = moltenCoreShare(r, g, b);
    const molten = Math.max(core, moltenShare(r, g, b) * (seams ? 1 : broad));
    const crystal = crystalShare(r, g, b) * broad * (1 - molten);
    const rock = Math.max(0, 1 - molten - crystal);
    const luma = 0.3 * r + 0.59 * g + 0.11 * b;
    const v = Math.max(0, Math.min(238, (luma - HEAT_ROCK_PIVOT) * HEAT_ROCK_STRETCH + 120));
    const basalt = rampAt(HEAT_RAMP, v);
    const crystalC = [r, g, b].map((c, k) => c + (HEAT_WHITE_GOLD[k] - c) * 0.25);
    const moltenC = deep ? rampAt(HEAT_DEEP_MOLTEN, Math.max(r, g, b)) : [r, g, b];
    for (let k = 0; k < 3; k++) {
      const own = px[i + k];
      let graded = basalt[k] * rock + crystalC[k] * crystal + moltenC[k] * molten;
      if (spread) {
        // The seam grown and haloed: hot at its heart, ember in its glow.
        const hot = spread.core[t];
        const glow = Math.max(hot, spread.halo[t]);
        const seam = HEAT_SEAM_EMBER[k] + (HEAT_SEAM_HOT[k] - HEAT_SEAM_EMBER[k]) * hot;
        graded += (seam - graded) * glow;
      }
      px[i + k] = Math.max(0, Math.min(255, own + (graded - own) * amount));
    }
  }
}

/** The seams of an atlas grown and haloed (`HEAT_SEAM_SPREAD`): `core` the molten under a
 *  max filter, `halo` its soft glow (both 0 to 1 per texel, wrapped). */
export function seamSpread(px, width, height) {
  const S = HEAT_SEAM_SPREAD;
  const n = width * height;
  const m = new Float32Array(n);
  for (let i = 0, t = 0; t < n; i += 3, t++) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    m[t] = Math.max(moltenCoreShare(r, g, b), moltenShare(r, g, b));
  }
  const core = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let dy = -S.grow; dy <= S.grow; dy++)
        for (let dx = -S.grow; dx <= S.grow; dx++) {
          const xx = (x + dx + width) % width;
          const yy = (y + dy + height) % height;
          v = Math.max(v, m[yy * width + xx]);
        }
      core[y * width + x] = v;
    }
  }
  const blur = (src, dx, dy) => {
    const out = new Float32Array(n);
    const k = 2 * S.halo + 1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let s = 0;
        for (let j = -S.halo; j <= S.halo; j++) {
          const xx = (x + dx * j + width) % width;
          const yy = (y + dy * j + height) % height;
          s += src[yy * width + xx];
        }
        out[y * width + x] = s / k;
      }
    return out;
  };
  const b = blur(blur(core, 1, 0), 0, 1);
  const halo = new Float32Array(n);
  for (let t = 0; t < n; t++) halo[t] = Math.min(1, b[t] * 2.2) * S.haloShare;
  return { core, halo };
}

/** A painting taken toward the basalt: `k` of its chroma removed and its value scaled by
 *  `value` (ChatGPT painted the stone a dusky violet-brown). */
export function gradePainting(px, k, value) {
  for (let i = 0; i < px.length; i += 3) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const luma = 0.3 * r + 0.59 * g + 0.11 * b;
    for (let c = 0; c < 3; c++) {
      const own = px[i + c];
      px[i + c] = Math.max(0, Math.min(255, (luma + (own - luma) * (1 - k)) * value));
    }
  }
}
