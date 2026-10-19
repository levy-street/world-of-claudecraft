// Where the seasonal dressing's candlelight IS, from the resolved layout (pure,
// no Three): the halo sprites that make a lit pumpkin or a paper lantern read as
// a light source from every side, and the ground-light sites that pool warm
// light on the street round them (the night light field, or the draped pools on
// the Lambert tier, and the few budgeted point lights near the player). The
// painter is seasonal_decor_lights.ts; a Vitest pins this directly.
//
// Every offset below is measured off the authored kit
// (scripts/assets/gourdlight_eve/model.py and stall.py): Blender (x, y, z) is
// three (x, z, -y), and every piece turns by its yaw the way the instancer turns
// it (local +z toward (sin yaw, cos yaw)).
import type { SeasonalDecorLayout, SeasonalGroundKind } from '../sim/seasonal_decor_layout';
import { garlandOrnaments } from './seasonal_garland_core';

export interface SeasonalHalo {
  x: number;
  y: number;
  z: number;
  /** Sprite width in yards. */
  size: number;
}

export interface SeasonalLightSite {
  x: number;
  y: number;
  z: number;
  /** How far the light reaches (yards). */
  radius: number;
  /** Relative strength (a big lit pumpkin is 1). */
  strength: number;
}

/** The wall lanterns and the garland ornaments are drawn this much over their
 *  authored size (seasonal_decor.ts LANTERN_SCALE / ORNAMENT_SCALE). */
export const HALO_LANTERN_SCALE = 1.6;
export const HALO_ORNAMENT_SCALE = 1.8;

/** Per ground kind: the candle's local position (three frame, before the
 *  piece's scale) and the halo's width per unit of scale. */
const KIND_GLOW: Readonly<
  Partial<Record<SeasonalGroundKind, { lx: number; ly: number; lz: number; size: number }>>
> = {
  pumpkin_lit: { lx: 0, ly: 0.26, lz: 0, size: 1.15 },
  pumpkin_small: { lx: 0, ly: 0.15, lz: 0, size: 0.8 },
  // the small carved pumpkin sitting on the bale
  hay_bale: { lx: -0.2, ly: 0.62, lz: 0, size: 0.62 },
  // the lantern hung from the festival pole's crossbar
  garland_pole: { lx: 0.22, ly: 3.24, lz: 0, size: 0.55 },
  // the jack-o'-lantern hung from a road post's crook, out over the verge toward the road
  road_lantern: { lx: 0, ly: 1.44, lz: 0.56, size: 1.15 },
};

/** The ground-light kinds: what pools light on the street (a lantern on a pole
 *  or a bead on a rope is too small and too high to light the ground). */
const LIGHT_STRENGTH: Readonly<Partial<Record<SeasonalGroundKind, number>>> = {
  pumpkin_lit: 1,
  pumpkin_small: 0.55,
  hay_bale: 0.45,
  // hung at shoulder height, so a softer pool than a pumpkin on the ground
  road_lantern: 0.75,
};

/** The keeper's stall, in ITS frame (three axes, before its scale): the two paper
 *  lanterns under the raised overhang (one over each end of the counter), the crest's
 *  carved face and its two little lanterns, the lit pumpkin on the counter, the big one
 *  on the hay bales. Heights follow scripts/assets/gourdlight_eve/stall.py FRONT_TOP. */
const STALL_HALOS: readonly { lx: number; ly: number; lz: number; size: number }[] = [
  { lx: -1.75, ly: 2.55, lz: 1.35, size: 1.1 },
  { lx: 1.75, ly: 2.55, lz: 1.35, size: 1.1 },
  { lx: 0, ly: 3.57, lz: 1.18, size: 1.0 },
  { lx: -1.0, ly: 3.37, lz: 1.15, size: 0.55 },
  { lx: 1.0, ly: 3.37, lz: 1.15, size: 0.55 },
  { lx: 0.42, ly: 1.3, lz: 1.0, size: 0.75 },
  { lx: -3.08, ly: 1.15, lz: -0.2, size: 1.1 },
];
/** The stall's ground light: one warm pool out front, one by the hay bales. */
const STALL_LIGHTS: readonly { lx: number; lz: number; radius: number; strength: number }[] = [
  { lx: 0, lz: 1.6, radius: 8, strength: 1.4 },
  { lx: -3.0, lz: 0, radius: 5, strength: 0.8 },
];
/** Lantern body below and out from its bracket root (the wall lantern). */
const LANTERN_DROP = 0.44;
const LANTERN_OUT = 0.38;
/** Ground-light sites closer than this merge into one (yards). */
export const LIGHT_MERGE_DISTANCE = 3;
/** A ground light's reach per unit of strength (yards). */
export const LIGHT_RADIUS = 5.5;

/** The halo sprite's alpha at `r` (0 centre, 1 edge): a bright core falling
 *  off smoothly to nothing at the rim, never a hard-edged disc. */
export function haloFalloff(r: number): number {
  if (r >= 1) return 0;
  const t = 1 - r;
  // a soft quadratic body plus a tight hot core
  return Math.min(1, 0.55 * t * t + 0.45 * t ** 6);
}

function turn(yaw: number, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

/** Every halo the layout carries (deterministic order). */
export function seasonalHalos(layout: SeasonalDecorLayout): SeasonalHalo[] {
  const out: SeasonalHalo[] = [];
  for (const p of layout.ground) {
    const g = KIND_GLOW[p.kind];
    if (!g) continue;
    const o = turn(p.yaw, g.lx * p.scale, g.lz * p.scale);
    out.push({ x: p.x + o.x, y: p.y + g.ly * p.scale, z: p.z + o.z, size: g.size * p.scale });
  }
  for (const l of layout.lanterns) {
    const o = turn(l.yaw, 0, LANTERN_OUT * HALO_LANTERN_SCALE);
    out.push({
      x: l.x + o.x,
      y: l.y - LANTERN_DROP * HALO_LANTERN_SCALE,
      z: l.z + o.z,
      size: 1.15,
    });
  }
  layout.garlands.forEach((g, gi) => {
    // the bead ornaments only: the leaves are not lit. The index matches the
    // painter's (cityIndex * 1000 + gi) only in its variety, which a halo ignores.
    for (const o of garlandOrnaments(g, gi)) {
      if (o.kind !== 'bead') continue;
      out.push({ x: o.x, y: o.y, z: o.z, size: 0.5 * HALO_ORNAMENT_SCALE * o.scale });
    }
  });
  for (const s of layout.stalls) {
    for (const h of STALL_HALOS) {
      const o = turn(s.yaw, h.lx * s.scale, h.lz * s.scale);
      out.push({ x: s.x + o.x, y: s.y + h.ly * s.scale, z: s.z + o.z, size: h.size * s.scale });
    }
  }
  return out;
}

/** The ground-light sites, nearby ones merged so a cluster of pumpkins is one
 *  warm pool, not a stack of slots (the night field's static window is shared
 *  with every lamp in town). */
export function seasonalLightSites(layout: SeasonalDecorLayout): SeasonalLightSite[] {
  const raw: SeasonalLightSite[] = [];
  for (const s of layout.stalls) {
    for (const l of STALL_LIGHTS) {
      const o = turn(s.yaw, l.lx * s.scale, l.lz * s.scale);
      raw.push({
        x: s.x + o.x,
        y: s.y + 0.6,
        z: s.z + o.z,
        radius: l.radius,
        strength: l.strength,
      });
    }
  }
  for (const p of layout.ground) {
    const k = LIGHT_STRENGTH[p.kind];
    if (!k) continue;
    raw.push({ x: p.x, y: p.y + 0.4, z: p.z, radius: LIGHT_RADIUS * k, strength: k });
  }
  const merged: SeasonalLightSite[] = [];
  for (const site of raw) {
    const near = merged.find((m) => Math.hypot(m.x - site.x, m.z - site.z) < LIGHT_MERGE_DISTANCE);
    if (!near) {
      merged.push({ ...site });
      continue;
    }
    // strength-weighted centre, the stronger reach, a little more light
    const w = near.strength + site.strength;
    near.x = (near.x * near.strength + site.x * site.strength) / w;
    near.y = (near.y * near.strength + site.y * site.strength) / w;
    near.z = (near.z * near.strength + site.z * site.strength) / w;
    near.radius = Math.max(near.radius, site.radius) + 0.5;
    near.strength = Math.min(1.8, w);
  }
  return merged;
}

/** The nearest `count` sites to (px, pz) within `reach` (indices into `sites`,
 *  nearest first): who holds the few budgeted point lights this frame. Writes
 *  into `out` (reused across frames) and returns how many it filled. */
export function nearestLightSites(
  sites: readonly SeasonalLightSite[],
  px: number,
  pz: number,
  reach: number,
  out: number[],
  dist: number[],
): number {
  const count = out.length;
  let n = 0;
  const r2 = reach * reach;
  for (let i = 0; i < sites.length; i++) {
    const dx = sites[i].x - px;
    const dz = sites[i].z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    // insertion into the sorted window
    let j = n < count ? n : count - 1;
    if (n === count && d2 >= dist[j]) continue;
    while (j > 0 && dist[j - 1] > d2) {
      out[j] = out[j - 1];
      dist[j] = dist[j - 1];
      j--;
    }
    out[j] = i;
    dist[j] = d2;
    if (n < count) n++;
  }
  return n;
}
