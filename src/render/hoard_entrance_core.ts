import type { TreasureMapRarity } from '../sim/content/treasure_maps';

/** Item quality colours: common maps use uncommon item green. */
export const HOARD_RARITY_PROFILES = {
  common: { color: 0x1eff00, shaftHeight: 2.3, motes: 8, pulse: 0 },
  rare: { color: 0x0070dd, shaftHeight: 3.6, motes: 14, pulse: 0 },
  epic: { color: 0xa335ee, shaftHeight: 5, motes: 22, pulse: 0 },
  legendary: { color: 0xff8000, shaftHeight: 8, motes: 36, pulse: 0.055 },
} as const;

export function hoardEntranceProfile(rarity: TreasureMapRarity | undefined, tier: string) {
  const quality = rarity ?? 'common';
  const profile = HOARD_RARITY_PROFILES[quality];
  return {
    ...profile,
    rarity: quality,
    motes: tier === 'low' ? 0 : profile.motes,
    shaftHeight: tier === 'low' ? 0 : profile.shaftHeight,
    glow: tier !== 'low',
  };
}

function smooth(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

/** Time starts on first compiled, visible frame, not while the body is gated. */
export function hoardRevealPose(age: number, reducedMotion = false) {
  const t = reducedMotion ? 1 : Math.max(0, age);
  return {
    hatch: smooth((t - 0.12) / 0.78),
    light: smooth((t - 0.3) / 0.7),
    earth: Math.sin(Math.PI * Math.max(0, Math.min(1, t / 0.65))) * 0.32,
  };
}

export function hoardRimScale(rarity: TreasureMapRarity, time: number, reducedMotion: boolean) {
  return 1 + (reducedMotion ? 0 : HOARD_RARITY_PROFILES[rarity].pulse * Math.sin(time * 1.5));
}

/** Rotate a local sample into the entity's terrain footprint. */
export function hoardTerrainSample(
  x: number,
  z: number,
  facing: number,
  localX: number,
  localZ: number,
) {
  return {
    x: x + Math.cos(facing) * localX + Math.sin(facing) * localZ,
    z: z - Math.sin(facing) * localX + Math.cos(facing) * localZ,
  };
}

/** Stable, slowly rising dust trajectories; no random stream or accumulated drift. */
export function hoardMotePose(
  index: number,
  age: number,
  height: number,
  calm: boolean,
  out: { x: number; y: number; z: number; scale: number },
) {
  const phase = (index * 0.61803398875 + (calm ? 0 : age * 0.11)) % 1;
  out.x = Math.sin(index * 2.4) * 0.95;
  out.y = 0.2 + phase * height * 0.75;
  out.z = Math.cos(index * 4.1) * 0.72;
  out.scale = Math.sin(phase * Math.PI) * (0.02 + (index % 3) * 0.007);
  return out;
}
