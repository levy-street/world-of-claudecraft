// The Quench's grade for its Tripo atlases (prepare_sources.mjs): the builds came back a
// washed lavender, paler than the arena concept. Each texel is read as one of four
// things and graded as its own:
//   - rock: put on the deep slate ramp by value (navy shade, slate-blue body, a pale
//     blue-grey on its lit planes), darker than the pale frost guardian it stands round;
//   - ice: its own teal and cyan, a little richer and deeper;
//   - snow: kept pale, cooled toward the concept's blue-white;
//   - the fire bowls' coals: left warm (the one warm thing in the cold).

/** The slate by value (sRGB): navy shade, slate-blue body, pale blue-grey lit planes. */
export const QUENCH_RAMP = [
  [0, [14, 18, 34]],
  [70, [34, 44, 72]],
  [125, [58, 72, 104]],
  [178, [98, 114, 146]],
  [238, [160, 176, 202]],
];

/** The snow's cool blue-white (sRGB). */
export const QUENCH_SNOW = [214, 226, 244];

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

/** How much of a texel is ice: its green and blue alike well past its red, and bright. */
export function iceShare(r, g, b) {
  return clamp01((Math.min(g, b) - r - 30) / 40) * clamp01((Math.max(g, b) - 100) / 40);
}

/** How much of a texel is snow: bright and nearly grey. */
export function snowShare(r, g, b) {
  const luma = 0.3 * r + 0.59 * g + 0.11 * b;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return clamp01((luma - 178) / 30) * clamp01((70 - spread) / 30);
}

/** How much of a texel is fire (the coals): its red well past its blue. */
export function warmShare(r, _g, b) {
  return clamp01((r - b - 30) / 40);
}

/** Grade raw RGB by `amount` (0 leaves it as built). */
export function gradeQuench(px, amount, stretch = 1.3) {
  for (let i = 0; i < px.length; i += 3) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const ice = iceShare(r, g, b);
    const snow = snowShare(r, g, b) * (1 - ice);
    const warm = warmShare(r, g, b);
    const rock = Math.max(0, 1 - ice - snow - warm);
    const luma = 0.3 * r + 0.59 * g + 0.11 * b;
    const v = Math.max(0, Math.min(238, (luma - 128) * stretch + 118));
    const slate = rampAt(QUENCH_RAMP, v);
    // The ice a little richer (its chroma pushed out) and a little deeper.
    const iceC = [r, g, b].map((c) => (luma + (c - luma) * 1.25) * 0.9);
    const snowC = [r, g, b].map((c, k) => c + (QUENCH_SNOW[k] - c) * 0.5);
    for (let k = 0; k < 3; k++) {
      const own = px[i + k];
      const graded = slate[k] * rock + iceC[k] * ice + snowC[k] * snow + own * warm;
      px[i + k] = Math.max(0, Math.min(255, own + (graded - own) * amount));
    }
  }
}

/** A painting taken toward the slate: `k` of its chroma removed and its value scaled by
 *  `value` (ChatGPT's stone came back a saturated cobalt, which the night's blue light
 *  doubled into one blue; the ice and the crystal keep their own colour). */
export function gradePainting(px, k, value) {
  for (let i = 0; i < px.length; i += 3) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const keep = iceShare(r, g, b);
    const luma = 0.3 * r + 0.59 * g + 0.11 * b;
    const kk = k * (1 - keep * 0.7);
    for (let c = 0; c < 3; c++) {
      const own = px[i + c];
      px[i + c] = Math.max(0, Math.min(255, (luma + (own - luma) * (1 - kk)) * value));
    }
  }
}
