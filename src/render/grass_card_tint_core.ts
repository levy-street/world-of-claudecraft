// The colour a grass card tuft takes from the ground it stands on.
//
// The cards are drawn from one texture of chartreuse blades (textures.ts grassTuftTexture),
// and their instance tint used to be a near-white lift of the ground colour: on a green
// meadow the card shows its own chartreuse, which is the look it was painted for. But the
// zones' painted looks recolour the ground itself (Veiled Hollow's lavender heath, the
// Nightbloom's orchid field, Amberfall's gold), and a near-white tint cannot move a
// chartreuse texture off chartreuse: every tuft stood out as a yellow-green spike in a
// carpet of another colour.
//
// So the tint has two ends. On a green meadow (a saturated green ground, which is every
// lawn, shade green and sunlit yellow-green the zone looks paint) it is the old lift exactly:
// green zones do not change by a single value, except the two whose dark looks made the
// chartreuse glow (CARD_FOLLOWS_GROUND below). On any other ground (grey heath, olive, gold,
// pink, violet) the tint is whatever makes the card show the meadow's own colour with the
// lift the 3D blades take (blade_grass.ts multiplies the same ground colour by 1.18), and
// it eases between the two ends across a band of hue and of saturation, so a border between
// two looks shows no seam.
//
// Pure: plain numbers in the renderer's linear working space, no Three and no DOM.

export type Rgb = readonly [number, number, number];

/** The mean colour of the card texture's blades, linear: its gradient runs
 *  (0.62 g, g, 0.42 g) at the root to (0.68 g, g, 0.36 g) at the tip around g 0.78 sRGB. */
export const CARD_TEXTURE_LINEAR: Rgb = [0.224, 0.579, 0.073];

/** The per-channel gain of the old lift (warm, less blue: a sunlit blade). */
export const GRASS_TINT_GAIN: Rgb = [1.08, 1.0, 0.7];

/** The lift the 3D blade carpet gives the same ground colour (blade_grass.ts). */
export const CARD_GROUND_LIFT = 1.18;

/** A green meadow by hue: degrees of the ground colour's hue (linear RGB) that count as
 *  green, with the eased edges either side. The zones' greens run 63 to 137; their golds sit
 *  at 30 to 41 and their pinks and violets past 230. */
export const MEADOW_HUE = { in0: 46, in1: 58, out0: 150, out1: 170 } as const;
/** ...and by saturation: the zones' greens are 0.69 and over, their grey heath and olive
 *  grounds 0.41 and under. */
export const MEADOW_SATURATION = { low: 0.45, high: 0.62 } as const;

/** A tint may brighten a channel the texture hardly has (its blue) by no more than this,
 *  so a card never glows where its texture is nearly black. */
export const CARD_TINT_MAX = 12;

/** One channel of the old lift: never darker than 0.65 of the gain, never over 1. */
export function tuftTintChannel(ground: number, gain: number): number {
  return Math.min(1, gain * (0.65 + 0.7 * ground));
}

const smooth = (edge0: number, edge1: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return u * u * (3 - 2 * u);
};

/** How much of a green meadow a ground colour is, 1 for a saturated green down to 0 for
 *  ground of any other hue or a grey one. */
export function meadowGreenness(ground: Rgb): number {
  const max = Math.max(ground[0], ground[1], ground[2]);
  const min = Math.min(ground[0], ground[1], ground[2]);
  const spread = max - min;
  if (max <= 1e-6 || spread <= 1e-9) return 0;
  let hue: number;
  if (max === ground[0]) hue = ((ground[1] - ground[2]) / spread) * 60;
  else if (max === ground[1]) hue = ((ground[2] - ground[0]) / spread + 2) * 60;
  else hue = ((ground[0] - ground[1]) / spread + 4) * 60;
  if (hue < 0) hue += 360;
  const byHue =
    smooth(MEADOW_HUE.in0, MEADOW_HUE.in1, hue) *
    (1 - smooth(MEADOW_HUE.out0, MEADOW_HUE.out1, hue));
  return byHue * smooth(MEADOW_SATURATION.low, MEADOW_SATURATION.high, spread / max);
}

/** How far a card leaves its own chartreuse for the ground's colour: 0 on a green meadow,
 *  1 on ground of another colour altogether. */
export function grassCardClash(ground: Rgb): number {
  return 1 - meadowGreenness(ground);
}

/** Biomes whose cards take the meadow's own colour whatever it is: a floor under the clash,
 *  0 to 1, by biome id. The marsh wears a dusk look and the jungle a deep canopy look whose
 *  meadows are greens far darker than the card's chartreuse: by colour alone each is a green
 *  meadow, so the old lift stood, and every tuft glowed lime in it (up to four times as
 *  bright as the blades beside it, since the lift never goes under 0.65). Following the
 *  ground holds under any look these zones may wear: on a bright lawn the ground's colour
 *  times the blade lift lands within a few percent of the old lift in red and green (the
 *  blue, a small channel, about doubles). The builder eases this floor across a zone border
 *  with the ground palette's own window (grass_card_follow_core.ts), and with the floor on,
 *  the biome's own accent no longer reaches its cards, as it never reached its blades. */
export const CARD_FOLLOWS_GROUND: Readonly<Record<string, number>> = { marsh: 1, jungle: 1 };

/**
 * The instance tint of a card on ground of colour `ground` (linear), with the biome's
 * accent, in two parts: `lift` is the old lift (every channel in 0..1, so the builder's
 * small HSL jitter can still run on it) and `gain` is what to multiply the jittered lift by
 * afterwards. On a green meadow the gain is exactly 1; elsewhere it carries the card to the
 * ground's own colour, which may need a channel well over 1 (the texture has little blue).
 * `follow` is the least the card leaves its chartreuse by (CARD_FOLLOWS_GROUND).
 */
export function grassCardTint(
  ground: Rgb,
  accent: Rgb,
  lift: [number, number, number],
  gain: [number, number, number],
  follow = 0,
): void {
  const w = Math.max(grassCardClash(ground), follow);
  for (let i = 0; i < 3; i++) {
    const old = tuftTintChannel(ground[i], GRASS_TINT_GAIN[i] * accent[i]);
    lift[i] = old;
    if (w <= 0) {
      gain[i] = 1;
      continue;
    }
    const own = Math.min(CARD_TINT_MAX, (ground[i] * CARD_GROUND_LIFT) / CARD_TEXTURE_LINEAR[i]);
    // (old is never 0 unless a biome accent channel is: then the gain has nothing to scale)
    gain[i] = old > 0 ? (old + (own - old) * w) / old : 1;
  }
}

const groundScratch: [number, number, number] = [0, 0, 0];

/** grassCardTint for a builder that holds the ground colour as three numbers: allocates
 *  nothing, so a chunk of thousands of tufts builds without churn. `follow` is the floor at
 *  the tuft's own place (grass_card_follow_core.ts cardFollowAt). */
export function grassCardTintRgb(
  r: number,
  g: number,
  b: number,
  accent: Rgb,
  lift: [number, number, number],
  gain: [number, number, number],
  follow = 0,
): void {
  groundScratch[0] = r;
  groundScratch[1] = g;
  groundScratch[2] = b;
  grassCardTint(groundScratch, accent, lift, gain, follow);
}
