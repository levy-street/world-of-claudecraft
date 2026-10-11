// A Buried Hoard BOSS ROOM, dressed: the engine that turns a boss's room theme
// (hoard_room_themes_core.ts) into where each piece of its Blender kit stands and what
// is drawn on the floor. Pure: no Three.js, no DOM. The room itself (outline,
// cliffs, floor, collision) stays the seeded one the sim generates; this only
// decides what stands in it, from that same seed, so every player in one hoard
// sees one room. The adapter (hoard_room_kit.ts) turns the plan into instances.
//
// Composition, not scatter: a HERO piece set against the end wall behind the boss,
// then CLUSTERS pressed against the side walls with bare wall left between them,
// never mirrored across the room. Nothing taller than a floor mark ever stands in
// the fight: every prop keeps within ROOM_KIT_WALL_BAND of a wall, and none of it
// collides (the walls already do). Floor marks that do reach the fight are dark or
// dim by their theme's own tones, so every telegraph out-reads them.

import {
  type HoardValleyLayoutInput,
  type HoardValleyZoneProfile,
  hoardValleyRevealZ,
  hoardValleySpanAtZ,
} from './hoard_valley_core';

/** What a graphics tier keeps: low the room's identity, high all of it. */
export type RoomKitCategory = 'hero' | 'large' | 'medium' | 'filler';
export type RoomKitTier = 'high' | 'medium' | 'low';
const KEPT: Record<RoomKitTier, readonly RoomKitCategory[]> = {
  high: ['hero', 'large', 'medium', 'filler'],
  medium: ['hero', 'large', 'medium'],
  low: ['hero', 'large'],
};
/** The low tier also caps its large props: the hero and a few silhouettes. */
const LOW_LARGE_CAP = 6;

/** Every prop stands within this of a wall; the floor beyond it is the fight's. */
export const ROOM_KIT_WALL_BAND = 9;
/** The boss's own ground: nothing but floor marks comes this close to the dais. */
export const ROOM_KIT_DAIS_CLEAR = 4;

// ------------------------------------------------------------------ the theme
/** One flat colour a floor mark may take. `lit` tones are drawn unlit-bright and
 *  breathe with the kit's glow; every other tone takes the room's day/night grade. */
export interface RoomFloorTone {
  color: number;
  /** Height over the floor, in yards: which marks lie on which. */
  lift: number;
  lit?: boolean;
}

/** A prop of a cluster, measured from the wall it stands against. */
export interface RoomKitPut {
  piece: string;
  category: RoomKitCategory;
  /** Yards into the room from the wall, and along it from the cluster's middle. */
  depth: number;
  along: number;
  /** 'face' looks into the room, 'side' lies along the wall; jitter is +/- radians. */
  yaw?: 'face' | 'side';
  yawJitter?: number;
  scale?: number;
  /** Height of its origin over the floor (hung and floating pieces). */
  y?: number;
  mirror?: boolean;
}

/** A floor mark of a cluster or of the hero, in the same wall-relative frame. */
export interface RoomKitFloorPut {
  shape: 'quad' | 'fan' | 'blot';
  tone: string;
  depth: number;
  along: number;
  halfLength: number;
  halfWidth: number;
  /** Fans and blots: their reach. A fan's halfWidth is its strength (0..1). */
  radius?: number;
  yaw?: 'face' | 'side';
}

export interface RoomKitCluster {
  name: string;
  puts: readonly RoomKitPut[];
  floor?: readonly RoomKitFloorPut[];
}

/** Marks scattered over the floor from the seed: cracks, puddles, stars. */
export interface RoomFloorScatter {
  shape: 'line' | 'blot' | 'point';
  tone: string;
  count: number;
  /** 'center' keeps off the wall band, 'edge' keeps inside it, 'dais' rings the boss. */
  region: 'center' | 'edge' | 'dais';
  size: readonly [number, number];
  /** Lines: how thin. */
  width?: number;
  /** Dais region: how far from the boss it may reach. */
  reach?: number;
  /** Lines: this many short branches off each. */
  branches?: number;
}

export type BossRoomPalette = Pick<
  HoardValleyZoneProfile,
  | 'fogColor'
  | 'fogNear'
  | 'fogFar'
  | 'ground'
  | 'groundLight'
  | 'cliff'
  | 'cliffLight'
  | 'trunk'
  | 'accent'
>;

export interface BossRoomTheme {
  id: string;
  /** The boss whose room this is. */
  boss: string;
  /** The room's own colours: they REPLACE the dig site's biome palette. */
  palette: BossRoomPalette;
  kitUrl: string;
  pieces: readonly string[];
  hero: {
    piece: string;
    /** How far in front of the end wall its origin stands, and its size. */
    inset: number;
    scale: number;
    /** Pieces beside it on the end wall, mirrored to both sides. */
    flank: readonly {
      piece: string;
      category: RoomKitCategory;
      dx: number;
      inset: number;
      scale?: number;
      y?: number;
    }[];
    floor?: readonly RoomKitFloorPut[];
  };
  clusters: readonly RoomKitCluster[];
  /** Yards between cluster stations down a wall, and how often one is left bare. */
  clusterSpacing: number;
  clusterSkip: number;
  tones: Readonly<Record<string, RoomFloorTone>>;
  floor: {
    /** Rings round the boss's ground: [offset past the dais, half width, tone]. */
    rings?: readonly (readonly [number, number, string])[];
    /** A run at the foot of every wall: [yards off the wall, half width, tone]. */
    wallRuns?: readonly (readonly [number, number, string])[];
    scatter?: readonly RoomFloorScatter[];
  };
  ambient: {
    /** The kit's glow material breathes between these, at this speed. */
    pulse: readonly [number, number, number];
    /** Pieces hung from their origin, which sway; and floating ones, which bob and turn. */
    sway?: readonly string[];
    hover?: readonly string[];
    particles?: {
      color: number;
      count: number;
      size: number;
      /** 'rise' climbs off the emitting pieces; 'fall' and 'drift' fill the room. */
      mode: 'rise' | 'fall' | 'drift';
      /** rise: which pieces emit, how high their mouth is and how wide. */
      emitters?: Readonly<Record<string, readonly [number, number]>>;
    };
  };
}

// ------------------------------------------------------------------- the plan
export interface RoomKitPlacement {
  piece: string;
  category: RoomKitCategory;
  x: number;
  y: number;
  z: number;
  /** Radians about +Y; a kit piece's front is +Z. */
  yaw: number;
  scale: number;
  /** Mirrored across its own front axis: a free second variant. */
  mirror: boolean;
}

export interface RoomKitFloorMark {
  shape: 'quad' | 'ring' | 'fan' | 'blot';
  tone: string;
  x: number;
  z: number;
  halfLength: number;
  halfWidth: number;
  yaw: number;
  radius?: number;
  /** Blots: a seed for their ragged edge. */
  seed?: number;
}

export interface RoomKitPlan {
  theme: BossRoomTheme;
  placements: RoomKitPlacement[];
  floor: RoomKitFloorMark[];
  /** The room's extent, for ambience that fills it. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function hash(seed: number, index: number, salt: number): number {
  let x = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** The room a boss's theme asks for, in the zone profile's own shape. */
export function themedRoomProfile(
  zone: HoardValleyZoneProfile,
  theme: BossRoomTheme | null,
): HoardValleyZoneProfile {
  return theme ? { ...zone, ...theme.palette } : zone;
}

export function buildBossRoomPlan(
  theme: BossRoomTheme,
  layout: HoardValleyLayoutInput,
  seed: number,
  tier: RoomKitTier,
): RoomKitPlan {
  const all: RoomKitPlacement[] = [];
  const floor: RoomKitFloorMark[] = [];
  const back = layout.zMax;
  const start = hoardValleyRevealZ(layout) + 5;
  const dais = layout.dais;
  const put = (
    piece: string,
    category: RoomKitCategory,
    x: number,
    z: number,
    yaw: number,
    scale = 1,
    y = 0,
    mirror = false,
  ): void => {
    if (category !== 'hero' && Math.hypot(x - dais.x, z - dais.z) < dais.r + ROOM_KIT_DAIS_CLEAR)
      return;
    all.push({ piece, category, x, y, z, yaw, scale, mirror });
  };

  // ---- the hero, its back in the end wall, and what flanks it
  const backSpan = hoardValleySpanAtZ(layout, back - 0.5);
  const heroX = (backSpan.minX + backSpan.maxX) / 2;
  put(theme.hero.piece, 'hero', heroX, back - theme.hero.inset, Math.PI, theme.hero.scale);
  for (const flank of theme.hero.flank) {
    for (const side of [-1, 1]) {
      const x = heroX + side * flank.dx;
      if (x < backSpan.minX + 1 || x > backSpan.maxX - 1) continue;
      put(
        flank.piece,
        flank.category,
        x,
        back - flank.inset,
        Math.PI,
        flank.scale,
        flank.y,
        side < 0,
      );
    }
  }
  for (const mark of theme.hero.floor ?? []) {
    // The hero's frame: depth runs out from the end wall, along runs across it.
    floor.push({
      shape: mark.shape,
      tone: mark.tone,
      x: heroX + mark.along,
      z: back - mark.depth,
      halfLength: mark.halfLength,
      halfWidth: mark.halfWidth,
      yaw: mark.yaw === 'side' ? Math.PI / 2 : 0,
      radius: mark.radius,
      seed: floor.length,
    });
  }

  // ---- clusters down the side walls, never mirrored across the room
  const spacing = theme.clusterSpacing;
  for (const side of [-1, 1]) {
    let previous = -1;
    let kept = 0;
    const first = start + (side > 0 ? spacing * 0.5 : 2);
    for (let station = 0, z = first; z < back - 27; station++, z += spacing) {
      const index = station * 2 + (side > 0 ? 1 : 0);
      // Leave some wall bare, but never a whole side.
      if (hash(seed, index, 11) < theme.clusterSkip && kept >= 1) continue;
      const at = z + (hash(seed, index, 12) - 0.5) * 7;
      const inward = -side;
      const face = Math.atan2(inward, 0);
      let pick = Math.floor(hash(seed, index, 13) * theme.clusters.length);
      if (pick === previous) pick = (pick + 1) % theme.clusters.length;
      previous = pick;
      kept++;
      const cluster = theme.clusters[pick];
      // Each piece measures from the wall at ITS OWN depth into the room: where the
      // gorge funnels out, the wall a few yards along is not the wall here.
      const wallAt = (offset: number): number => {
        const there = hoardValleySpanAtZ(layout, Math.min(back - 0.01, at + offset));
        return side < 0 ? there.minX : there.maxX;
      };
      cluster.puts.forEach((item, n) => {
        const base = item.yaw === 'side' ? face + Math.PI / 2 : face;
        const yaw = base + (hash(seed, index, 20 + n) - 0.5) * 2 * (item.yawJitter ?? 0);
        put(
          item.piece,
          item.category,
          wallAt(item.along) + inward * item.depth,
          at + item.along,
          yaw,
          item.scale,
          item.y,
          item.mirror ?? false,
        );
      });
      for (const mark of cluster.floor ?? []) {
        floor.push({
          shape: mark.shape,
          tone: mark.tone,
          x: wallAt(mark.along) + inward * mark.depth,
          z: at + mark.along,
          halfLength: mark.halfLength,
          halfWidth: mark.halfWidth,
          yaw: mark.yaw === 'side' ? face + Math.PI / 2 : face,
          radius: mark.radius,
          seed: floor.length,
        });
      }
    }
    // A run at this wall's foot, in straight pieces that follow it.
    for (const [off, halfWidth, tone] of theme.floor.wallRuns ?? []) {
      for (let z = start; z < back - 8; z += 6) {
        const a = hoardValleySpanAtZ(layout, z);
        const b = hoardValleySpanAtZ(layout, Math.min(back - 8, z + 6));
        const ax = (side < 0 ? a.minX : a.maxX) - side * off;
        const bx = (side < 0 ? b.minX : b.maxX) - side * off;
        floor.push({
          shape: 'quad',
          tone,
          x: (ax + bx) / 2,
          z: z + 3,
          halfLength: Math.hypot(bx - ax, 6) / 2 + 0.05,
          halfWidth,
          yaw: Math.atan2(bx - ax, 6),
        });
      }
    }
  }
  // The runs meet along the end wall.
  for (const [off, halfWidth, tone] of theme.floor.wallRuns ?? []) {
    floor.push({
      shape: 'quad',
      tone,
      x: heroX,
      z: back - off - 0.7,
      halfLength: Math.max(1, backSpan.maxX - heroX - off),
      halfWidth,
      yaw: Math.PI / 2,
    });
  }

  // ---- rings round the boss's ground, and the floor's seeded marks
  for (const [offset, halfWidth, tone] of theme.floor.rings ?? []) {
    floor.push({
      shape: 'ring',
      tone,
      x: dais.x,
      z: dais.z,
      halfLength: 0,
      halfWidth,
      yaw: 0,
      radius: dais.r + offset,
    });
  }
  (theme.floor.scatter ?? []).forEach((scatter, s) => {
    const salt = 100 + s * 16;
    for (let i = 0; i < scatter.count; i++) {
      let x: number;
      let z: number;
      if (scatter.region === 'dais') {
        const angle = hash(seed, i, salt) * Math.PI * 2;
        const r = Math.sqrt(hash(seed, i, salt + 1)) * (scatter.reach ?? dais.r + 8);
        x = dais.x + Math.sin(angle) * r;
        z = dais.z + Math.cos(angle) * r;
      } else {
        z = start + 6 + hash(seed, i, salt) * Math.max(1, back - start - 16);
        const span = hoardValleySpanAtZ(layout, z);
        const middle = (span.minX + span.maxX) / 2;
        const half = (span.maxX - span.minX) / 2;
        if (scatter.region === 'center') {
          x =
            middle +
            (hash(seed, i, salt + 1) - 0.5) * 2 * Math.max(0, half - ROOM_KIT_WALL_BAND - 1);
        } else {
          const sideOf = hash(seed, i, salt + 2) < 0.5 ? -1 : 1;
          x = middle + sideOf * (half - 1.5 - hash(seed, i, salt + 1) * (ROOM_KIT_WALL_BAND - 3));
        }
      }
      const size = scatter.size[0] + hash(seed, i, salt + 3) * (scatter.size[1] - scatter.size[0]);
      const yaw = hash(seed, i, salt + 4) * Math.PI * 2;
      if (scatter.shape === 'line') {
        const width = scatter.width ?? 0.08;
        floor.push({
          shape: 'quad',
          tone: scatter.tone,
          x,
          z,
          halfLength: size,
          halfWidth: width,
          yaw,
        });
        for (let b = 0; b < (scatter.branches ?? 0); b++) {
          const along = (hash(seed, i, salt + 5 + b) - 0.5) * 1.4 * size;
          const turn = yaw + (b % 2 ? 1 : -1) * (0.5 + hash(seed, i, salt + 8 + b) * 0.6);
          const length = size * (0.3 + hash(seed, i, salt + 11 + b) * 0.35);
          floor.push({
            shape: 'quad',
            tone: scatter.tone,
            x: x + Math.sin(yaw) * along + Math.sin(turn) * length,
            z: z + Math.cos(yaw) * along + Math.cos(turn) * length,
            halfLength: length,
            halfWidth: width * 0.75,
            yaw: turn,
          });
        }
      } else if (scatter.shape === 'blot') {
        floor.push({
          shape: 'blot',
          tone: scatter.tone,
          x,
          z,
          halfLength: size,
          halfWidth: size * (0.6 + hash(seed, i, salt + 6) * 0.4),
          yaw,
          seed: i + salt,
        });
      } else {
        floor.push({
          shape: 'quad',
          tone: scatter.tone,
          x,
          z,
          halfLength: size,
          halfWidth: size,
          yaw: Math.PI / 4,
        });
      }
    }
  });

  // ---- the tier FILTERS one plan, so every tier agrees on where things are
  const keep = KEPT[tier];
  let larges = 0;
  const placements = all.filter((placement) => {
    if (!keep.includes(placement.category)) return false;
    if (tier === 'low' && placement.category === 'large') return larges++ < LOW_LARGE_CAP;
    return true;
  });
  return {
    theme,
    placements,
    // Low keeps the floor's lines; the small firelight fans and the points go.
    floor:
      tier === 'low'
        ? floor.filter(
            (mark) =>
              !(mark.shape === 'fan' && (mark.radius ?? 0) < 10) &&
              (mark.shape !== 'quad' || mark.halfLength + mark.halfWidth > 0.5),
          )
        : floor,
    bounds: {
      minX: -(layout.floorHalfX ?? 36),
      maxX: layout.floorHalfX ?? 36,
      minZ: start,
      maxZ: back,
    },
  };
}
