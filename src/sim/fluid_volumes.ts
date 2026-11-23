// Fluid-volume placements: the map editor stores lava/acid/spectral/water
// pools as ordinary MapPlacements with a reserved 'fluid/<kind>' assetId, so
// they ride the whole placement pipeline (transform gizmo, undo, caps, the
// sanitizer, region copy/paste) for free ? the same pattern as
// collider_volumes.ts. This module owns the reserved ids, the per-kind preset
// defaults, and the ONE resolution from a placement record to a world-space
// FluidVolume shared by the playtest projection (custom_map.ts), the sim's
// damage tick, and both renderers (editor overlay + playtest surfaces).
// Sim layer: pure data, no DOM/Three imports.
//
// A fluid volume is an ellipse footprint (half-axes sizeX/2 x sizeZ/2,
// rotated by rotY) whose SURFACE sits at terrainHeight(center) + offsetY.
// It is fully independent of the map-wide water level: the sim's swim system
// never reads these, only the damage tick does.

import type { MapPlacement } from './map_doc';
import type { FluidKind, FluidSchool, FluidVolume } from './types';

export type { FluidKind, FluidSchool, FluidVolume } from './types';

const FLUID_ASSET_PREFIX = 'fluid/';

export const FLUID_ASSET_IDS: Record<FluidKind, string> = {
  lava: 'fluid/lava',
  acid: 'fluid/acid',
  spectral: 'fluid/spectral',
  water: 'fluid/water',
};

// Effect toggle bits carried in MapPlacement.fluidFx (sanitized 0..15).
export const FLUID_FX_BUBBLES = 1;
export const FLUID_FX_SMOKE = 2;
export const FLUID_FX_HAZE = 4;
export const FLUID_FX_LIGHT = 8;

export const FLUID_MAX_DPS = 50;

export interface FluidPreset {
  kind: FluidKind;
  hue: number; // degrees, the tint slider's default
  lum: number; // 0..1 lightness
  dps: number; // flat damage per second while submerged (0 = harmless)
  /** Extra damage/second as a fraction of the victim's max HP (0..1), stacked
   *  on top of `dps`. Lava = 0.10 (10% max HP/s); flat-damage kinds leave it 0. */
  dpsPct: number;
  school: FluidSchool;
  fx: number; // default FLUID_FX_* bits
  /** Emissive strength 0..1: lava glows hard, water not at all. */
  glow: number;
  /** Attached point-light color/intensity when FLUID_FX_LIGHT is on. */
  lightColor: number;
  lightIntensity: number;
}

export const FLUID_PRESETS: Record<FluidKind, FluidPreset> = {
  lava: {
    kind: 'lava',
    hue: 24,
    lum: 0.5,
    // Molten rock burns for 10% of the victim's max HP each second (dpsPct);
    // the flat component stays 0 so lava is exactly a tenth-per-second by default.
    dps: 0,
    dpsPct: 0.1,
    school: 'fire',
    fx: FLUID_FX_BUBBLES | FLUID_FX_SMOKE | FLUID_FX_LIGHT,
    glow: 1,
    lightColor: 0xff6a22,
    lightIntensity: 9,
  },
  acid: {
    kind: 'acid',
    hue: 95,
    lum: 0.45,
    dps: 4,
    dpsPct: 0,
    school: 'nature',
    fx: FLUID_FX_BUBBLES | FLUID_FX_HAZE | FLUID_FX_LIGHT,
    glow: 0.55,
    lightColor: 0x7ddc3a,
    lightIntensity: 5,
  },
  spectral: {
    kind: 'spectral',
    hue: 265,
    lum: 0.6,
    dps: 0,
    dpsPct: 0,
    school: 'shadow',
    fx: FLUID_FX_HAZE | FLUID_FX_LIGHT,
    glow: 0.75,
    lightColor: 0x9a6aff,
    lightIntensity: 6,
  },
  water: {
    kind: 'water',
    hue: 205,
    lum: 0.45,
    dps: 0,
    dpsPct: 0,
    school: 'frost',
    fx: 0,
    glow: 0,
    lightColor: 0x4a90d9,
    lightIntensity: 3,
  },
};

/** Authoring footprint at placement scale 1 (yards). */
export const FLUID_DEFAULT_SIZE = { x: 14, z: 14 };
/** Default surface offset above the terrain at the pool center (stored in
 *  the placement's sizeY, the same slot a collider plane's floor offset uses,
 *  so the gizmo's Y arrow slides the surface up/down). */
export const FLUID_DEFAULT_OFFSET_Y = 0.3;

export function isFluidAssetId(assetId: string): boolean {
  return assetId.startsWith(FLUID_ASSET_PREFIX);
}

export function fluidKindFor(assetId: string): FluidKind | null {
  if (assetId === FLUID_ASSET_IDS.lava) return 'lava';
  if (assetId === FLUID_ASSET_IDS.acid) return 'acid';
  if (assetId === FLUID_ASSET_IDS.spectral) return 'spectral';
  if (assetId === FLUID_ASSET_IDS.water) return 'water';
  return null;
}

/**
 * Resolve a fluid placement into its world-space volume, or null when the
 * placement is not a fluid. Scale multiplies the footprint; hue/lum ride the
 * placement's existing tint fields; damage and effects come from the
 * placement's fluid fields with the preset as the default.
 */
export function fluidVolumeFromPlacement(p: MapPlacement): FluidVolume | null {
  const kind = fluidKindFor(p.assetId);
  if (!kind) return null;
  const preset = FLUID_PRESETS[kind];
  const halfX = Math.max(0.5, ((p.sizeX ?? FLUID_DEFAULT_SIZE.x) * p.scale) / 2);
  const halfZ = Math.max(0.5, ((p.sizeZ ?? FLUID_DEFAULT_SIZE.z) * p.scale) / 2);
  return {
    kind,
    x: p.x,
    z: p.z,
    rotY: p.rotY,
    halfX,
    halfZ,
    offsetY: p.sizeY ?? FLUID_DEFAULT_OFFSET_Y,
    hue: p.hue ?? preset.hue,
    lum: p.lum ?? preset.lum,
    dps: Math.min(FLUID_MAX_DPS, Math.max(0, p.fluidDps ?? preset.dps)),
    dpsPct: preset.dpsPct,
    school: preset.school,
    fx: p.fluidFx ?? preset.fx,
    glow: preset.glow,
    lightColor: preset.lightColor,
    lightIntensity: preset.lightIntensity,
  };
}

/** All fluid volumes in a placement list (playtest projection). */
export function fluidVolumesFromPlacements(placements: readonly MapPlacement[]): FluidVolume[] {
  const out: FluidVolume[] = [];
  for (const p of placements) {
    const v = fluidVolumeFromPlacement(p);
    if (v) out.push(v);
  }
  return out;
}

/** True when (x, z) lies inside the volume's rotated ellipse footprint. */
export function fluidContains(v: FluidVolume, x: number, z: number): boolean {
  const dx = x - v.x;
  const dz = z - v.z;
  const c = Math.cos(v.rotY);
  const s = Math.sin(v.rotY);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const nx = lx / v.halfX;
  const nz = lz / v.halfZ;
  return nx * nx + nz * nz <= 1;
}

/**
 * The DAMAGING fluid volume covering (x, z) with the entity's feet at or
 * below the fluid surface, or null. `surfaceYOf` supplies the absolute
 * surface height for a volume (terrainHeight at its center + offsetY); the
 * caller owns the terrain lookup so this module stays world-agnostic.
 */
export function damagingFluidAt(
  fluids: readonly FluidVolume[] | undefined,
  x: number,
  z: number,
  feetY: number,
  surfaceYOf: (v: FluidVolume) => number,
): FluidVolume | null {
  if (!fluids || fluids.length === 0) return null;
  for (const v of fluids) {
    if (v.dps <= 0 && v.dpsPct <= 0) continue;
    if (!fluidContains(v, x, z)) continue;
    if (feetY <= surfaceYOf(v) + 0.05) return v;
  }
  return null;
}
