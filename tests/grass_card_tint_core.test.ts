// The grass card tuft's tint (src/render/grass_card_tint_core.ts): the old lift, value for
// value, on a green meadow; the meadow's own colour where the painted ground has left the
// card texture's chartreuse, and in the two biomes whose dark greens made it glow; an eased
// band between, and never a glowing channel.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CARD_FOLLOWS_GROUND,
  CARD_GROUND_LIFT,
  CARD_TEXTURE_LINEAR,
  CARD_TINT_MAX,
  GRASS_TINT_GAIN,
  grassCardClash,
  grassCardTint,
  grassCardTintRgb,
  meadowGreenness,
  type Rgb,
  tuftTintChannel,
} from '../src/render/grass_card_tint_core';
import { DEFAULT_ZONE_SELECTIONS } from '../src/render/palette_lab/zone_look_core';
import { ZONE_LOOKS } from '../src/render/palette_lab/zone_looks';

const linear = (hex: number): Rgb => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const NONE: Rgb = [1, 1, 1];
/** The whole tint a card ends up with (no jitter): lift times gain, and the two parts. */
const tintOf = (ground: Rgb, accent: Rgb = NONE) => {
  const lift: [number, number, number] = [0, 0, 0];
  const gain: [number, number, number] = [0, 0, 0];
  grassCardTint(ground, accent, lift, gain);
  return { lift, gain, tint: [lift[0] * gain[0], lift[1] * gain[1], lift[2] * gain[2]] };
};
const shown = (tint: readonly number[]): Rgb => [
  tint[0] * CARD_TEXTURE_LINEAR[0],
  tint[1] * CARD_TEXTURE_LINEAR[1],
  tint[2] * CARD_TEXTURE_LINEAR[2],
];
const chroma = (v: Rgb): number[] => v.map((x) => x / (v[0] + v[1] + v[2]));

describe('grass card tint', () => {
  // every ground colour of the looks the zones ship with (palette_lab/zone_look_core.ts
  // DEFAULT_ZONE_SELECTIONS): the green ones, and the ones that have left green (the marsh
  // and the jungle, green by colour but following the ground, have their own test below)
  const GREEN_ZONES = [
    'proving_shore',
    'eastbrook_vale',
    'thornpeak_heights',
    'farshore_isle',
    'galecrest',
    'evergarden',
    'willowfen',
  ];
  const PAINTED_ZONES = ['veiled_hollow', 'nightbloom', 'drakelands', 'wraithwood', 'amberfall'];
  const groundsOf = (zone: string): number[] => {
    const look = ZONE_LOOKS[zone]?.find((entry) => entry.id === DEFAULT_ZONE_SELECTIONS[zone]);
    const { grass, grassDark, grassYellow } = look?.ground ?? {};
    if (grass === undefined || grassDark === undefined || grassYellow === undefined) {
      throw new Error(`no ground for ${zone}`);
    }
    return [grass, grassDark, grassYellow];
  };

  it('is the old lift, value for value, on every green zone', () => {
    for (const zone of GREEN_ZONES) {
      for (const hex of groundsOf(zone)) {
        const ground = linear(hex);
        expect(grassCardClash(ground), `${zone} ${hex.toString(16)}`).toBe(0);
        const { lift, gain } = tintOf(ground);
        expect(gain).toEqual([1, 1, 1]);
        for (let i = 0; i < 3; i++) {
          expect(lift[i]).toBe(tuftTintChannel(ground[i], GRASS_TINT_GAIN[i]));
          expect(lift[i]).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('stands the marsh and jungle cards in the meadow own colour under their dark looks', () => {
    // Firefly Dusk paints a green by colour (its lawn and its shade both clash 0, its
    // golden reeds sit on the band's edge), and Deep Canopy three greens outright, so
    // without the biome's floor the old lift stood and the cards glowed lime in meadows
    // far darker than their chartreuse
    const marsh = groundsOf('mirefen_marsh').map(linear);
    expect(grassCardClash(marsh[0])).toBe(0);
    expect(grassCardClash(marsh[1])).toBe(0);
    expect(grassCardClash(marsh[2])).toBeGreaterThan(0.2);
    expect(grassCardClash(marsh[2])).toBeLessThan(0.45);
    const jungle = groundsOf('palmreach').map(linear);
    for (const ground of jungle) expect(grassCardClash(ground)).toBe(0);
    expect(CARD_FOLLOWS_GROUND).toEqual({ marsh: 1, jungle: 1 });
    const cases: [string, Rgb][] = [
      ...marsh.map((ground): [string, Rgb] => ['marsh', ground]),
      ...jungle.map((ground): [string, Rgb] => ['jungle', ground]),
    ];
    for (const [biome, ground] of cases) {
      const lift: [number, number, number] = [0, 0, 0];
      const gain: [number, number, number] = [0, 0, 0];
      grassCardTintRgb(
        ground[0],
        ground[1],
        ground[2],
        NONE,
        lift,
        gain,
        CARD_FOLLOWS_GROUND[biome],
      );
      const old: [number, number, number] = [0, 0, 0];
      const oldGain: [number, number, number] = [0, 0, 0];
      grassCardTintRgb(ground[0], ground[1], ground[2], NONE, old, oldGain, 0);
      for (let i = 0; i < 3; i++) {
        // the jittered part is still the old lift, a colour HSL can carry
        expect(lift[i]).toBe(old[i]);
        expect(lift[i]).toBeLessThanOrEqual(1);
        const card = lift[i] * gain[i] * CARD_TEXTURE_LINEAR[i];
        // exactly the ground's colour with the lift the 3D blades take
        expect(card).toBeCloseTo(ground[i] * CARD_GROUND_LIFT, 9);
      }
      // and that is darker than the lime the old lift showed on the same ground
      const oldGreen = old[1] * oldGain[1] * CARD_TEXTURE_LINEAR[1];
      expect(lift[1] * gain[1] * CARD_TEXTURE_LINEAR[1]).toBeLessThan(oldGreen * 0.8);
    }
  });

  it('is the colour rule alone without a floor, and the floor is only ever a floor', () => {
    const lawn = linear(0x587e40);
    for (const follow of [undefined, 0]) {
      const lift: [number, number, number] = [0, 0, 0];
      const gain: [number, number, number] = [0, 0, 0];
      grassCardTintRgb(lawn[0], lawn[1], lawn[2], NONE, lift, gain, follow);
      expect(gain, String(follow)).toEqual([1, 1, 1]);
    }
    // a ground that already clashes by a third: a lower floor changes nothing, a higher one
    // carries the card further, exactly as that clash would
    const reeds = groundsOf('mirefen_marsh').map(linear)[2];
    const clash = grassCardClash(reeds);
    const byColour = tintOf(reeds);
    const under: [number, number, number] = [0, 0, 0];
    const underGain: [number, number, number] = [0, 0, 0];
    grassCardTint(reeds, NONE, under, underGain, clash - 0.1);
    expect(underGain).toEqual(byColour.gain);
    const over: [number, number, number] = [0, 0, 0];
    const overGain: [number, number, number] = [0, 0, 0];
    grassCardTint(reeds, NONE, over, overGain, 0.8);
    for (let i = 0; i < 3; i++) {
      const old = over[i];
      const own = Math.min(CARD_TINT_MAX, (reeds[i] * CARD_GROUND_LIFT) / CARD_TEXTURE_LINEAR[i]);
      expect(overGain[i]).toBeCloseTo((old + (own - old) * 0.8) / old, 12);
      expect(overGain[i]).not.toBeCloseTo(byColour.gain[i], 6);
    }
  });

  it('shows the meadow own colour in every zone whose ground has left green', () => {
    for (const zone of PAINTED_ZONES) {
      for (const hex of groundsOf(zone)) {
        const ground = linear(hex);
        const clash = grassCardClash(ground);
        expect(clash, `${zone} ${hex.toString(16)}`).toBe(1);
        const { lift, tint } = tintOf(ground);
        const card = shown(tint);
        for (let i = 0; i < 3; i++) {
          expect(tint[i]).toBeLessThanOrEqual(CARD_TINT_MAX + 1e-9);
          // the part the builder jitters in HSL stays a colour HSL can carry
          expect(lift[i]).toBeLessThanOrEqual(1);
          expect(lift[i]).toBeGreaterThan(0);
        }
        // the card's chroma moved off chartreuse, most of the way to the ground's
        const before = chroma(shown([1, 1, 0.7]));
        const after = chroma(card);
        const to = chroma(ground);
        const dist = (a: number[], b: number[]) =>
          Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(dist(after, to), `${zone} ${hex.toString(16)}`).toBeLessThan(dist(before, to) * 0.5);
      }
    }
  });

  it('lands on the ground colour times the blade lift at the far end', () => {
    // well past the band: every channel the cap did not hold is exact
    for (const hex of [0x52566a, 0xd88ad8, 0x9a5ab8, 0xd6b23a]) {
      const ground = linear(hex);
      expect(grassCardClash(ground)).toBe(1);
      const { tint } = tintOf(ground);
      const card = shown(tint);
      for (let i = 0; i < 3; i++) {
        if (tint[i] < CARD_TINT_MAX - 1e-9) {
          expect(card[i]).toBeCloseTo(ground[i] * CARD_GROUND_LIFT, 9);
        }
      }
    }
  });

  it('eases between the two ends, so a border between looks shows no seam', () => {
    // walk the ground from a green lawn to the lavender heath, and to Amberfall's gold
    for (const end of [0x7a8a72, 0xd6b23a]) {
      const from = linear(0x7cbc5c);
      const to = linear(end);
      let last = -1;
      let stepMax = 0;
      for (let k = 0; k <= 200; k++) {
        const t = k / 200;
        const ground: Rgb = [
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
          from[2] + (to[2] - from[2]) * t,
        ];
        const clash = grassCardClash(ground);
        expect(clash).toBeGreaterThanOrEqual(last - 1e-12);
        if (last >= 0) stepMax = Math.max(stepMax, clash - last);
        last = clash;
      }
      expect(last).toBe(1);
      expect(stepMax).toBeLessThan(0.08);
    }
  });

  it('reads a green meadow by hue and by saturation', () => {
    expect(meadowGreenness(linear(0x72b444))).toBe(1);
    expect(meadowGreenness(linear(0xcace6a))).toBe(1); // the yellowest sunlit green
    expect(meadowGreenness(linear(0x2e8050))).toBe(1); // the bluest shade green
    expect(meadowGreenness(linear(0x808080))).toBe(0);
    expect(meadowGreenness(linear(0x4e5e52))).toBe(0); // a green hue, but grey
    expect(meadowGreenness(linear(0xd6b23a))).toBe(0); // saturated, but gold
    expect(meadowGreenness([0, 0, 0])).toBe(0);
  });

  it('never lets a channel glow where the texture is nearly black', () => {
    expect(tintOf(linear(0x2030ff)).tint[2]).toBeCloseTo(CARD_TINT_MAX, 9);
    // black ground is no meadow: the card goes dark with it, it does not keep a 0.65 glow
    expect(tintOf([0, 0, 0]).tint).toEqual([0, 0, 0]);
  });

  it('has a three-number entry that gives the same tint and a gain of one where the lift is zero', () => {
    for (const hex of [0x7cbc5c, 0x7a8a72, 0xd88ad8]) {
      const ground = linear(hex);
      const a = tintOf(ground, [1.1, 0.8, 1.6]);
      const lift: [number, number, number] = [0, 0, 0];
      const gain: [number, number, number] = [0, 0, 0];
      grassCardTintRgb(ground[0], ground[1], ground[2], [1.1, 0.8, 1.6], lift, gain);
      expect(lift).toEqual(a.lift);
      expect(gain).toEqual(a.gain);
    }
    // an accent with a dead channel: the lift is 0 there and the gain stays finite
    const dead = tintOf(linear(0x7a8a72), [1, 0, 1]);
    expect(dead.lift[1]).toBe(0);
    expect(dead.gain[1]).toBe(1);
    expect(dead.tint.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('carries the biome accent on the old end', () => {
    const ground = linear(0x6ab04c);
    const accent: Rgb = [0.9, 1.05, 0.8];
    const { tint } = tintOf(ground, accent);
    expect(tint[0]).toBeCloseTo(tuftTintChannel(ground[0], 1.08 * 0.9), 12);
    expect(tint[2]).toBeCloseTo(tuftTintChannel(ground[2], 0.7 * 0.8), 12);
  });
});
