// Pure plans for the Drowned Temple's open-air lagoon: the lights and their
// flame sockets, the crater ring that walls the lagoon, the waterfalls pouring
// off its rim (and the one the Waterfall Walk passes behind), the drowned
// statues and columns standing in the water, the lily rafts and reeds, the
// light-fish shoals and the Moon Altar's column. The renderer paints exactly
// these; tests pin that nothing here stands on a walkable floor it has no
// collider for.
//
// Three-free, DOM-free, deterministic.

import {
  CHOIR_COURT,
  DROWNED_TEMPLE_FIELD,
  DROWNED_TEMPLE_WATER_LEVEL,
  HYDRA_POOL,
  MOON_ALTAR,
  PRISM_TERRACE,
} from '../../sim/content/drowned_temple_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';

/** A small deterministic hash in [0, 1). */
export function templeHash(i: number, salt: number): number {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

const FIELD = DROWNED_TEMPLE_FIELD;
const ground = (x: number, z: number): number => authoredFieldHeight(FIELD, x, z);

/** Is (x, z) open lagoon (no walkable floor under it, with a margin)? */
export function isLagoon(x: number, z: number, margin = 0): boolean {
  if (margin <= 0) return ground(x, z) <= FIELD.voidHeight + 1e-6;
  for (const [dx, dz] of [
    [0, 0],
    [margin, 0],
    [-margin, 0],
    [0, margin],
    [0, -margin],
    [margin * 0.7, margin * 0.7],
    [-margin * 0.7, margin * 0.7],
    [margin * 0.7, -margin * 0.7],
    [-margin * 0.7, -margin * 0.7],
  ]) {
    if (ground(x + dx, z + dz) > FIELD.voidHeight + 1e-6) return false;
  }
  return true;
}

// ---- lights ---------------------------------------------------------------------------

export type TempleLightKind = 'palefire' | 'moonorb' | 'conch' | 'prism' | 'tidepool' | 'altar';

export interface TempleLightSpot {
  kind: TempleLightKind;
  /** The kit piece that carries this light (its flame socket). */
  holder: string;
  x: number;
  z: number;
  rot: number;
  /** Absolute height of the light (else the holder's socket over the ground). */
  y?: number;
}

/** Where the flame or glow sits in each holder (piece-local x, y, z). */
export const TEMPLE_FLAME_SOCKETS: Readonly<Record<string, [number, number, number]>> = {
  Kit_Brazier: [0, 1.75, 0],
  Kit_LampPillar: [0, 6.6, 0],
  Kit_TidepoolBasin: [0, 0.9, 0],
  Kit_MoonAltar: [0, 3.2, 0],
  Kit_PrismPlinth: [0, 1.2, 0],
  Kit_GreatConch: [0, 7.5, 0],
};

export const TEMPLE_FLAME_KINDS: ReadonlySet<TempleLightKind> = new Set(['palefire']);

export const TEMPLE_LIGHT_STYLE: Readonly<
  Record<TempleLightKind, { color: number; flame: number; intensity: number; range: number }>
> = {
  palefire: { color: 0xa8c6ff, flame: 0xdbe8ff, intensity: 2.4, range: 16 },
  moonorb: { color: 0xc9dcff, flame: 0xf0f6ff, intensity: 2.0, range: 18 },
  conch: { color: 0xffd08a, flame: 0xffe2a8, intensity: 3.2, range: 30 },
  prism: { color: 0xb9a6ff, flame: 0xd8ccff, intensity: 2.2, range: 20 },
  tidepool: { color: 0x6fe3e0, flame: 0x9ff4f0, intensity: 1.4, range: 11 },
  altar: { color: 0xdde8f5, flame: 0xffffff, intensity: 3.0, range: 26 },
};

function spot(
  kind: TempleLightKind,
  holder: string,
  x: number,
  z: number,
  rot = 0,
  y?: number,
): TempleLightSpot {
  return y === undefined ? { kind, holder, x, z, rot } : { kind, holder, x, z, rot, y };
}

/** Every light of the temple, in route order (the braziers are sim props). */
export function planTempleLights(): TempleLightSpot[] {
  const out: TempleLightSpot[] = [];
  for (const p of FIELD.props) {
    if (p.kind === 'dt_brazier') out.push(spot('palefire', 'Kit_Brazier', p.x, p.z, p.rot));
    else if (p.kind === 'dt_lamp_pillar') out.push(spot('moonorb', 'Kit_LampPillar', p.x, p.z));
    else if (p.kind === 'dt_tidepool_basin')
      out.push(spot('tidepool', 'Kit_TidepoolBasin', p.x, p.z));
  }
  // The Great Conch breathes gold into the court from behind the stage.
  // The throat light sits in the turned mouth, 8 yd out along the shell's axis.
  out.push(
    spot(
      'conch',
      'Kit_GreatConch',
      CONCH.x - 8 * Math.sin(CONCH.rot),
      CONCH.z - 8 * Math.cos(CONCH.rot),
      0,
      CHOIR_COURT.h + 5,
    ),
  );
  // The prism plinth's violet under the Colossus, and the altar's silver.
  out.push(spot('prism', 'Kit_PrismPlinth', PRISM_TERRACE.x, PRISM_TERRACE.z + 2));
  out.push(spot('altar', 'Kit_MoonAltar', MOON_ALTAR.x, MOON_ALTAR.z));
  return out;
}

/** A light's world position (instance-local x, y, z). */
export function templeFlamePosition(s: TempleLightSpot): [number, number, number] {
  const sock = TEMPLE_FLAME_SOCKETS[s.holder] ?? [0, 1, 0];
  const c = Math.cos(s.rot);
  const n = Math.sin(s.rot);
  const x = s.x + sock[0] * c + sock[2] * n;
  const z = s.z - sock[0] * n + sock[2] * c;
  const y = s.y ?? Math.max(ground(s.x, s.z), DROWNED_TEMPLE_WATER_LEVEL) + sock[1];
  return [x, y, z];
}

// ---- the crater ring ------------------------------------------------------------------

/** The crater rim's crest, clockwise from behind the Moongate (x, z, height).
 *  The inner face drops from here to the lake bed; every stretch stays clear
 *  of the walkable field (pinned by tests/drowned_temple_render_core.test.ts). */
export const CRATER_CREST: readonly (readonly [number, number, number])[] = [
  [0, -254, 38],
  [-42, -250, 46],
  [-92, -226, 56],
  [-126, -182, 62],
  [-138, -120, 60],
  [-138, -52, 64],
  [-132, 18, 68],
  [-124, 80, 66],
  [-114, 132, 62],
  [-100, 184, 60],
  [-90, 240, 66],
  [-44, 272, 72],
  [18, 280, 78],
  [80, 266, 72],
  [124, 232, 62],
  [138, 176, 58],
  [132, 122, 58],
  [108, 96, 52],
  [103, 62, 50],
  [102, 22, 50],
  [112, -22, 54],
  [127, -82, 58],
  [127, -152, 60],
  [102, -212, 54],
  [52, -246, 46],
];

/** The crest resampled every `step` yards, closed. */
export function craterCrest(step = 6): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = CRATER_CREST.length;
  for (let i = 0; i < n; i++) {
    const a = CRATER_CREST[i];
    const b = CRATER_CREST[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.round(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      // A smooth step along each stretch so the crest heights ease.
      const e = t * t * (3 - 2 * t);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * e]);
    }
  }
  return out;
}

/** The crater's centre (the lagoon's middle, for the ring's inward normal). */
export const CRATER_CENTRE = { x: 0, z: 12 } as const;

/** How far the inner face's foot reaches toward the lagoon from the crest. */
export const CRATER_FOOT_INSET = 9;

/** Radial rows of the ring mesh: inset (+ toward the lagoon, - outward) and
 *  the height as a share of the crest height (negative: under the water). */
export const CRATER_ROWS: readonly (readonly [number, number])[] = [
  [CRATER_FOOT_INSET, -0.35],
  [CRATER_FOOT_INSET * 0.72, 0.02],
  [CRATER_FOOT_INSET * 0.45, 0.42],
  [CRATER_FOOT_INSET * 0.2, 0.8],
  [0, 1],
  [-10, 1.04],
  [-35, 1.1],
  [-90, 1.18],
  [-200, 1.05],
];

/** The inward unit normal of the ring at a crest point (toward the lagoon). */
export function craterInward(x: number, z: number): [number, number] {
  const dx = CRATER_CENTRE.x - x;
  const dz = CRATER_CENTRE.z - z;
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

// ---- waterfalls -----------------------------------------------------------------------

export interface TempleWaterfall {
  id: string;
  /** Lip end points (instance-local) and the lip height. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  top: number;
  /** Unit direction the water leaves the lip in (toward the lagoon). */
  nx: number;
  nz: number;
  /** How far out the sheet travels while it falls (its arc). */
  throwOut: number;
}

function fall(
  id: string,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  top: number,
  throwOut: number,
): TempleWaterfall {
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const [nx, nz] = craterInward(mx, mz);
  return { id, ax, az, bx, bz, top, nx, nz, throwOut };
}

/** The three great falls off the north rim, one off the west rim, and the
 *  curtain the Waterfall Walk passes behind (it pours off a rock overhang
 *  above the walk and lands in the lagoon on its outer side). */
export const TEMPLE_WATERFALLS: readonly TempleWaterfall[] = [
  fall('north_west', -62, 262, -36, 270, 70, 10),
  fall('north', 4, 276, 34, 276, 76, 12),
  fall('north_east', 70, 264, 92, 256, 70, 10),
  fall('west', -135, -30, -133, 0, 62, 8),
  // The Walk's curtain: its lip runs 8 yd off the walkway, parallel to it.
  {
    id: 'walk_curtain',
    ax: 53.2,
    az: 34.2,
    bx: 69.2,
    bz: 60.2,
    top: 42,
    nx: -0.85,
    nz: 0.52,
    throwOut: 3,
  },
];

/** The overhang the Walk's curtain pours from (render only, high overhead). */
// Its centre sits 27 yd behind the curtain's lip (along the walk's outward
// normal) and it runs 58 yd deep, so its back buries into the crater's east
// face instead of hanging free over the lagoon.
export const WALK_OVERHANG = { x: 84, z: 33, height: 42, length: 40, depth: 58 } as const;

// ---- set dressing in the water ------------------------------------------------------------

export interface TempleDressing {
  piece: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
  /** Absolute height (else the water level). */
  y: number;
}

/** The Great Conch in the lagoon behind the court's stage, mouth to the court. */
// Turned 0.95 rad off the court's axis: seen from the court the shell shows
// its whole spiral flank and spines with the flared mouth still toward the
// stage, instead of reading end-on as a flat pink disc.
export const CONCH = { x: CHOIR_COURT.x, z: 44, scale: 0.8, y: -2.4, rot: 0.95 } as const;
/** The drowned temple massing rising out of the lagoon, north-west. */
export const SUNKEN_TEMPLE = { x: -74, z: 140, scale: 0.8, rot: 0.35 } as const;
/** The Prism Tower in the water behind the terrace. */
export const PRISM_TOWER = { x: 62, z: 240, scale: 1 } as const;

/** Every render-only piece standing in the lagoon (statues, columns, arches,
 *  the amphitheater's tiers, the hero massing), all over open water. */
export function planTempleDressing(): TempleDressing[] {
  const out: TempleDressing[] = [];
  const water = DROWNED_TEMPLE_WATER_LEVEL;
  // The drowned choir knee-deep either side of the Reflecting Causeway.
  const singers = ['Kit_StatueSinger', 'Kit_StatuePraying', 'Kit_StatueConch'];
  let k = 0;
  for (let z = -146; z <= -84; z += 12) {
    for (const side of [-1, 1]) {
      const roadX = z < -140 ? -8 + (z + 146) * 0.25 : z < -112 ? -3.5 : 0;
      const x = roadX + side * (15 + templeHash(k, 3) * 4);
      k++;
      if (!isLagoon(x, z, 2.5)) continue;
      out.push({
        piece: singers[k % 3],
        x,
        z,
        rot:
          side > 0
            ? -Math.PI / 2 + (templeHash(k, 5) - 0.5) * 0.6
            : Math.PI / 2 + (templeHash(k, 5) - 0.5) * 0.6,
        scale: 1.05 + templeHash(k, 7) * 0.3,
        y: water - 2.2,
      });
    }
  }
  // The colonnade's outer row: statues in the water beside the columns.
  for (const z of [-72, -58, -46]) {
    for (const side of [-1, 1]) {
      const x = side * 25;
      if (!isLagoon(x, z, 2.5)) continue;
      out.push({
        piece: singers[(k++ + (side > 0 ? 1 : 0)) % 3],
        x,
        z,
        rot: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        scale: 1.25,
        y: water - 2.4,
      });
    }
  }
  // A processional arch across the causeway, legs in the water.
  out.push({ piece: 'Kit_RuinedArch', x: 0, z: -86, rot: 0, scale: 1.3, y: water - 1.5 });
  // The amphitheater's tiers rising out of the shallows round the stage (the
  // south arc, split by the Choir Stair).
  for (const deg of [105, 140, 220, 255]) {
    const a = (deg * Math.PI) / 180;
    out.push({
      piece: 'Kit_AmphiTier',
      x: CHOIR_COURT.x + Math.sin(a) * (CHOIR_COURT.r + 0.6),
      z: CHOIR_COURT.z + Math.cos(a) * (CHOIR_COURT.r + 0.6),
      rot: a + Math.PI,
      scale: 1,
      y: water - 0.6,
    });
  }
  // The hero massing.
  out.push({
    piece: 'Kit_GreatConch',
    x: CONCH.x,
    z: CONCH.z,
    rot: CONCH.rot,
    scale: CONCH.scale,
    y: CONCH.y,
  });
  out.push({
    piece: 'Kit_SunkenTemple',
    x: SUNKEN_TEMPLE.x,
    z: SUNKEN_TEMPLE.z,
    rot: SUNKEN_TEMPLE.rot,
    scale: SUNKEN_TEMPLE.scale,
    y: water - 3,
  });
  out.push({
    piece: 'Kit_PrismTower',
    x: PRISM_TOWER.x,
    z: PRISM_TOWER.z,
    rot: 0.4,
    scale: PRISM_TOWER.scale,
    y: water - 1,
  });
  // Columns scattered through the lagoon, intact and broken.
  let placed = 0;
  for (let i = 0; i < 260 && placed < 46; i++) {
    const x = -118 + templeHash(i, 11) * 236;
    const z = -200 + templeHash(i, 13) * 440;
    if (!isLagoon(x, z, 6)) continue;
    if (Math.hypot(x - CONCH.x, z - CONCH.z) < 22) continue;
    if (Math.hypot(x - SUNKEN_TEMPLE.x, z - SUNKEN_TEMPLE.z) < 36) continue;
    if (!insideCrater(x, z, 12)) continue;
    const roll = templeHash(i, 17);
    out.push({
      piece: roll < 0.35 ? 'Kit_Column' : roll < 0.8 ? 'Kit_ColumnBroken' : 'Kit_ColumnFallen',
      x,
      z,
      rot: templeHash(i, 19) * Math.PI * 2,
      scale: 0.9 + templeHash(i, 23) * 0.5,
      y: water - 1.4 - templeHash(i, 29) * 1.4,
    });
    placed++;
  }
  // Lily rafts, reeds, coral and giant shells near the walkways' edges.
  let near = 0;
  for (let i = 0; i < 600 && near < 70; i++) {
    const x = -112 + templeHash(i, 31) * 224;
    const z = -205 + templeHash(i, 37) * 440;
    if (!isLagoon(x, z, 1.8) || isLagoon(x, z, 9)) continue;
    const roll = templeHash(i, 41);
    out.push({
      piece:
        roll < 0.4
          ? 'Kit_LilyPads'
          : roll < 0.65
            ? 'Kit_Reeds'
            : roll < 0.85
              ? 'Kit_CoralCluster'
              : 'Kit_Shells',
      x,
      z,
      rot: templeHash(i, 43) * Math.PI * 2,
      scale: 0.8 + templeHash(i, 47) * 0.6,
      y: roll < 0.4 ? water + 0.03 : water - 0.3,
    });
    near++;
  }
  return out;
}

/** Is (x, z) inside the crater ring by at least `margin` yards? */
export function insideCrater(x: number, z: number, margin = 0): boolean {
  // Winding test against the crest polygon, then the distance to its edges.
  const ring = CRATER_CREST;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  if (!inside) return false;
  if (margin <= 0) return true;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(ax + dx * t - x, az + dz * t - z) < margin + CRATER_FOOT_INSET) return false;
  }
  return true;
}

/** Crags standing on the rim (render only, far above the walkways). */
export function planCraterSpires(): TempleDressing[] {
  const out: TempleDressing[] = [];
  const crest = craterCrest(22);
  crest.forEach(([x, z, h], i) => {
    if (templeHash(i, 53) < 0.35) return;
    const [nx, nz] = craterInward(x, z);
    const back = 8 + templeHash(i, 59) * 18;
    out.push({
      piece: 'Kit_CraterSpire',
      x: x - nx * back,
      z: z - nz * back,
      rot: templeHash(i, 61) * Math.PI * 2,
      scale: 0.7 + templeHash(i, 67) * 0.9,
      y: h - 9,
    });
  });
  return out;
}

// ---- light-fish shoals under the lagoon ----------------------------------------------------

export interface FishShoal {
  x: number;
  z: number;
  radius: number;
  count: number;
  seed: number;
}

/** Shoals of glowing fish circling in open water beside the walkways. */
export function planFishShoals(): FishShoal[] {
  const spots: [number, number, number][] = [
    [-22, -150, 7],
    [16, -134, 6],
    [-26, -100, 8],
    [30, -70, 7],
    [-34, -40, 6],
    [36, 34, 8],
    [-30, 50, 7],
    [26, 120, 7],
    [-10, 150, 9],
    [60, 190, 7],
    [2, 236, 8],
  ];
  return spots
    .filter(([x, z, r]) => isLagoon(x, z, r * 0.6))
    .map(([x, z, r], i) => ({ x, z, radius: r, count: 10 + (i % 3) * 3, seed: templeHash(i, 71) }));
}

// ---- the Moon Altar's column --------------------------------------------------------------

/** The silver column of moonlight over the altar, seen from the Moongate. */
export const MOON_COLUMN = {
  x: MOON_ALTAR.x,
  z: MOON_ALTAR.z,
  base: MOON_ALTAR.h + 2.8,
  height: 260,
  radius: 5.5,
} as const;

/** The Hydra Pool's steam (the pool water sits a hand under the rim). */
export const POOL_WATER = {
  x: HYDRA_POOL.x,
  z: HYDRA_POOL.z,
  r: HYDRA_POOL.poolR,
  y: 5.85,
} as const;
