// Pure plan for the Gravewyrm Sanctum's open-air renderer (the Ice Tomb of
// the Wyrm, docs/design/dungeon-rework/gravewyrm_sanctum.md sections 3, 4 and
// 8): the palette, the polar dusk's light and fog numbers, the hash and noise
// every painter shares, the Calving Face's per-stage look (the heartbeat, the
// glow, the aurora), the budgeted fire spots and the light zones they fall
// in, and the cosmetic spots for the air (diamond dust over the walks,
// spindrift off the ridges, steam over the Thaw Works and the vault).
//
// Three-free, DOM-free, deterministic (hash noise, never Math.random). The sim
// layout (sim/content/gravewyrm_sanctum_layout.ts) is the single source of
// every position here.

import {
  GRAVEWYRM_SANCTUM_FIELD,
  GRAVEWYRM_SANCTUM_VOID_HEIGHT,
  RITUAL_VAULT,
  THAW_WORKS,
} from '../../sim/content/gravewyrm_sanctum_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';

// ---- palette (design section 8) ----------------------------------------------------

/** The Sanctum's palette (sRGB hex), design section 8. */
export const SANCTUM_PALETTE = {
  glacier: 0x7fc4e8,
  deepIce: 0x2e6f9e,
  snow: 0xeef6fa,
  slate: 0x4a5058,
  rune: 0x5ab8ff,
  chain: 0x3a3d42,
  shard: 0xf2b880,
  teal: 0x59d6b5,
  violet: 0x8c6bd8,
  pyre: 0xe8862e,
  soulGreen: 0x8fd6a0,
  soulViolet: 0x7a58b8,
  soot: 0x1c1b1e,
} as const;

/** Linear 0..1 rgb of a palette hex (sRGB to linear, the shaders' space). */
export function sanctumLinear(hex: number): [number, number, number] {
  const c = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

// ---- the polar dusk ----------------------------------------------------------------

/** The thin blue dusk haze (the dome's horizon fades to it): clear, blue
 *  with distance, never grey murk and never a sea mist. */
export const SANCTUM_FOG_COLOR = 0x3d5a82;
/** Where the cold key light comes from (from the ground toward it): the
 *  bright west of the blue hour, a little south and fairly high, so the party
 *  walking north is lit from the side, never from behind the camera's back. */
export const SANCTUM_KEY_DIRECTION: readonly [number, number, number] = (() => {
  const v: [number, number, number] = [-0.78, 0.52, -0.22];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
/** The afterglow's bearing on the dome: the band of warm light low behind
 *  the western peaks (a unit vector, y the band's height). */
export const SANCTUM_AFTERGLOW_DIRECTION: readonly [number, number, number] = (() => {
  const v: [number, number, number] = [-0.96, 0.06, 0.2];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

// ---- hash and noise ----------------------------------------------------------------

/** A deterministic 0..1 hash of two numbers. */
export function sanctumHash(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7 + 17.13) * 43758.5453;
  return v - Math.floor(v);
}

function valueNoise(x: number, z: number, salt: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const w = zf * zf * (3 - 2 * zf);
  const h = (i: number, k: number) => sanctumHash(i * 1.37 + salt * 13.1, k * 2.11 - salt * 7.7);
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}

/** Fractal value noise in [0, 1). */
export function sanctumNoise(x: number, z: number, salt = 0, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, salt + i * 3) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// ---- the floor ---------------------------------------------------------------------

/** The walkable floor height at (x, z), instance-local. */
export function sanctumGround(x: number, z: number): number {
  return authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, x, z);
}

/** A walkable top at (x, z), or null over the crevasses. */
export function sanctumFloorAt(x: number, z: number): number | null {
  const y = sanctumGround(x, z);
  return y > GRAVEWYRM_SANCTUM_VOID_HEIGHT + 1 ? y : null;
}

// ---- the Calving Face's stage look (design section 3) -------------------------------

export interface FaceStageLook {
  /** The shard's glow in his chest (1 = the arrival's faint beat). */
  glow: number;
  /** The aurora's brightness over the cirque (1 = arrival). */
  aurora: number;
  /** Beats per minute of the heart. */
  bpm: number;
}

/** The face's look per render stage: the glow doubles at stage 3 (the lock
 *  open) and the aurora brightens with it for the rest of the run; at 4 the
 *  face has calved, at 5 he is torn free and the shard flares. */
export function faceStageLook(stage: number): FaceStageLook {
  const s = Math.max(0, Math.min(5, Math.floor(stage)));
  const glow = [0.55, 0.62, 0.72, 1.3, 1.45, 1.75][s];
  const aurora = [0.62, 0.68, 0.76, 1.08, 1.2, 1.4][s];
  const bpm = [24, 26, 30, 34, 38, 44][s];
  return { glow, aurora, bpm };
}

/** The heartbeat's pulse at time `t` (seconds): a sharp double beat (lub,
 *  dub) then rest, 0..1. Shared by the shard's glow and the aurora. */
export function heartbeat(t: number, bpm: number): number {
  const period = 60 / Math.max(1, bpm);
  const p = (((t / period) % 1) + 1) % 1;
  const beat = (c: number, w: number) => Math.exp(-(((p - c) / w) ** 2));
  return Math.min(1, beat(0.08, 0.05) + 0.62 * beat(0.24, 0.06));
}

// ---- fires and lights --------------------------------------------------------------

/** What burns: the cult's braziers and the Thaw Works' pyres burn orange
 *  wood-and-pitch fire; the soul braziers and the vault's thaw pyres burn the
 *  stolen souls, violet-green. */
export type SanctumFireKind = 'brazier' | 'pyre' | 'soulBrazier' | 'thawPyre';

export interface SanctumFireStyle {
  /** The light's colour (sRGB hex), its intensity and range. */
  light: number;
  intensity: number;
  range: number;
  /** The fire's height above its prop's base, and its size (tongue width). */
  lift: number;
  size: number;
  /** True for soulfire (the violet-green ramp). */
  soul: boolean;
}

export const SANCTUM_FIRE_STYLE: Readonly<Record<SanctumFireKind, SanctumFireStyle>> = {
  brazier: { light: 0xffa04a, intensity: 2.6, range: 13, lift: 1.5, size: 0.9, soul: false },
  pyre: { light: 0xff8a36, intensity: 4.4, range: 22, lift: 2.3, size: 1.9, soul: false },
  soulBrazier: { light: 0x8fe0b0, intensity: 2.4, range: 12, lift: 1.7, size: 0.9, soul: true },
  thawPyre: { light: 0x9ce6b8, intensity: 4.0, range: 18, lift: 2.6, size: 1.7, soul: true },
};

export interface SanctumFireSpot {
  kind: SanctumFireKind;
  x: number;
  z: number;
}

const FIRE_OF_PROP: Readonly<Record<string, SanctumFireKind>> = {
  gs_cult_brazier: 'brazier',
  gs_soul_pyre: 'pyre',
  gs_soul_brazier: 'soulBrazier',
  gs_thaw_pyre: 'thawPyre',
};

/** Every fire of the field (from its props), in prop order. */
export function planSanctumFires(): SanctumFireSpot[] {
  const out: SanctumFireSpot[] = [];
  for (const p of GRAVEWYRM_SANCTUM_FIELD.props) {
    const kind = FIRE_OF_PROP[p.kind];
    if (kind) out.push({ kind, x: p.x, z: p.z });
  }
  return out;
}

/** The light zone a point falls in (nearest zone centre within its radius). */
export function sanctumLightZoneOf(x: number, z: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const zone of GRAVEWYRM_SANCTUM_FIELD.lightZones) {
    const d = Math.hypot(x - zone.x, z - zone.z);
    if (d <= zone.r && d < bestD) {
      bestD = d;
      best = zone.id;
    }
  }
  return best;
}

/** The budgeted point lights: one per fire. The pure test pins at most eight
 *  per light zone (the fire-light sink's rule). */
export function planSanctumLights(): SanctumFireSpot[] {
  return planSanctumFires();
}

// ---- the air -----------------------------------------------------------------------

/** Spots over the walkable floor (never over a crevasse), hashed, `count` of
 *  them: the diamond dust glitters there. */
export function planDustSpots(count: number, seed: number): [number, number, number][] {
  const b = GRAVEWYRM_SANCTUM_FIELD.bounds;
  const out: [number, number, number][] = [];
  for (let i = 0; out.length < count && i < count * 14; i++) {
    const x = b.minX + sanctumHash(i, seed) * (b.maxX - b.minX);
    const z = b.minZ + sanctumHash(seed + 0.5, i * 1.37) * (b.maxZ - b.minZ);
    const y = sanctumFloorAt(x, z);
    if (y === null) continue;
    out.push([x, y, z]);
  }
  return out;
}

export interface SteamSource {
  x: number;
  z: number;
  /** Plume radius (yards) and how many cards it carries at full density. */
  r: number;
  cards: number;
  /** 0 a white meltwater steam, 1 a sooty pyre smoke. */
  soot: number;
}

/** Where steam and smoke rise: ONLY over the Thaw Works (the pyres' smoke,
 *  the melt channel's steam) and the vault (the three pools), design 8. */
export function planSteamSources(): SteamSource[] {
  const out: SteamSource[] = [];
  for (const f of planSanctumFires()) {
    if (f.kind === 'pyre') out.push({ x: f.x, z: f.z, r: 2.4, cards: 9, soot: 1 });
  }
  // The melt channel and the works' sledge park: meltwater steaming off the cut ice.
  const w = THAW_WORKS.upper;
  out.push({ x: 22, z: 40, r: 4, cards: 8, soot: 0 });
  out.push({ x: 34, z: 47, r: 4, cards: 8, soot: 0 });
  out.push({ x: (w.x0 + w.x1) / 2 - 22, z: 46, r: 5, cards: 6, soot: 0.3 });
  // The vault's three pools: steam rising off the dark meltwater.
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3;
    out.push({
      x: RITUAL_VAULT.x + Math.sin(a) * 10.5,
      z: RITUAL_VAULT.z + Math.cos(a) * 10.5,
      r: 6,
      cards: 10,
      soot: 0,
    });
  }
  return out;
}

// ---- gate motion curves -------------------------------------------------------------

/** 0..1 smoothstep. */
export function smooth01(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}
