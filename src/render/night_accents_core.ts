// night_accents_core: the placement math for the map-wide night accents, so
// every region of the world has something to look at after dark rather than
// only the towns the streetlamps reach.
//
// Three layers, all pure here and all deterministic (hash-driven, never
// Math.random), with the Three side in ember_pools.ts and night_accents.ts:
//   - ember pools: a static warm pool at every authored campfire; a mob camp
//     without a campfire gets a fire brazier instead (camp_braziers.ts), and
//     uncoveredCampSites below decides which camps those are.
//   - glow flora: luminous mushroom clusters, streamed on a world-anchored cell
//     grid around the camera.
//   - fireflies: a drifting pool that only settles in its habitat (water edges
//     and the leafy realms).
//
// World-ANCHORED is the load-bearing word for the flora. A player-centred
// random pool (motes.ts) is right for airborne dust, which nobody tracks; a
// mushroom that teleports when you walk past it is a bug. So every cluster is a
// pure function of its integer cell, and walking away and back reproduces the
// identical cluster.
//
// A src/render pure core: no Three, no DOM, and every world probe (ground
// height, road distance, biome) arrives as a caller-supplied callback, so the
// whole layout is drivable from a Vitest with no renderer and no sim.

import type { BiomeId, MobFamily } from '../sim/types';

// ---------------------------------------------------------------------------
// Ember pools
// ---------------------------------------------------------------------------

export interface EmberSite {
  x: number;
  z: number;
  /** pool radius in yards: a camp lights a wider circle than a single fire */
  radius: number;
}

/** A campfire's pool. Small and bright: this is one fire, and props.ts already
 *  gives it a flame and a budgeted point light; the pool is what survives when
 *  the budget's nearest-few rule leaves this one dark. */
const CAMPFIRE_POOL_RADIUS = 4.2;
/** A camp with an authored campfire this close already has its fire. */
const CAMP_DEDUPE_RANGE = 12;

/** One ember pool per authored campfire (camps without one get a brazier). */
export function campfireEmberSites(campfires: readonly (readonly [number, number])[]): EmberSite[] {
  return campfires.map(([x, z]) => ({ x, z, radius: CAMPFIRE_POOL_RADIUS }));
}

/**
 * The mob families that BUILD fires. A wolf pack or a spider nest with a tended
 * brazier reads as a placement bug; a bandit camp without one reads as a
 * different bug. Trolls and ogres are fire-builders in every classic bestiary,
 * so they count; the skittering and elemental families do not.
 */
export const FIRE_BUILDING_FAMILIES: ReadonlySet<MobFamily> = new Set<MobFamily>([
  'humanoid',
  'troll',
  'ogre',
]);

/**
 * Only the camps whose mob would actually build and tend a fire. `familyOf`
 * resolves a camp's mob id to its family (the sim's MOBS table at the call
 * site); an unknown id builds nothing, which is the safe reading of bad data.
 */
export function fireBuildingCamps<T extends { mobId: string }>(
  camps: readonly T[],
  familyOf: (mobId: string) => MobFamily | undefined,
): T[] {
  return camps.filter((camp) => {
    const family = familyOf(camp.mobId);
    return family !== undefined && FIRE_BUILDING_FAMILIES.has(family);
  });
}

/**
 * Every mob camp that does NOT already have an authored campfire inside it:
 * these are the camps that get a real fire of their own (camp_braziers.ts), so
 * each fire-building camp owns exactly one fire.
 *
 * The dedupe matters because the two tables overlap by design (a camp usually
 * gets a campfire prop), and standing a brazier beside a bright campfire is how
 * a hostile camp ends up glowing like a bonfire from across the valley.
 */
export function uncoveredCampSites(
  campfires: readonly (readonly [number, number])[],
  camps: readonly { center: { x: number; z: number } }[],
): { x: number; z: number }[] {
  const dedupeSq = CAMP_DEDUPE_RANGE * CAMP_DEDUPE_RANGE;
  const sites: { x: number; z: number }[] = [];
  for (const camp of camps) {
    let covered = false;
    for (const [x, z] of campfires) {
      const dx = x - camp.center.x;
      const dz = z - camp.center.z;
      if (dx * dx + dz * dz < dedupeSq) {
        covered = true;
        break;
      }
    }
    if (!covered) sites.push({ x: camp.center.x, z: camp.center.z });
  }
  return sites;
}

// ---------------------------------------------------------------------------
// Glow flora
// ---------------------------------------------------------------------------

/** Yards per cluster cell. One cluster at most per cell, so this IS the spacing. */
export const FLORA_CELL = 19;
/** Cells out from the camera's own cell: 9x9, about a 170 yd square of cover. */
export const FLORA_CELL_RADIUS = 4;
/** Instanced pool cap. Sized above the worst-case fill so density leads, not this. */
export const FLORA_CAP_POOL = 420;

export interface GlowFloraCap {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  /** 0..1 within the cluster, so a cluster can shade its caps apart */
  variant: number;
}

/**
 * How thickly a realm grows luminous flora, 0 to 1, as the chance any one cell
 * holds a cluster. Every biome is non-zero on purpose: the brief is that the
 * WHOLE map has night interest, so a realm may be sparse but never bare. A
 * Record over BiomeId, so tsc fails the build if a new biome lands without a
 * considered density here.
 */
export const FLORA_DENSITY: Record<BiomeId, number> = {
  // leafy and damp: mushrooms belong here, and this is where they are thickest
  jungle: 0.62,
  fen: 0.6,
  marsh: 0.58,
  night: 0.68, // the Nightbloom is the realm whose whole identity is this
  haunt: 0.5, // grave-pale caps in the Wraithwood gloom
  garden: 0.42,
  vale: 0.38,
  dusk: 0.46,
  cave: 0.55,
  // open, dry, or cold: sparse, but never nothing
  peaks: 0.2,
  frost: 0.22,
  gale: 0.18,
  amber: 0.3,
  ember: 0.24, // cinder-blooms rather than mushrooms
  beach: 0.14,
  desert: 0.12,
  volcano: 0.16,
};

/** Per-realm cap colour, so a cluster reads as part of its realm after dark. */
export const FLORA_TINT: Record<BiomeId, number> = {
  vale: 0x7fe8c0,
  marsh: 0x9ff26a,
  fen: 0x8cf2a8,
  jungle: 0x6ef2b4,
  peaks: 0x9fd8ff,
  frost: 0x8fe0ff,
  gale: 0xa8e4ff,
  garden: 0xffa8d8,
  amber: 0xffc46a,
  ember: 0xff8a4a,
  night: 0xc88aff,
  haunt: 0xa8f2c8,
  dusk: 0xe08aff,
  beach: 0x8fe8d0,
  desert: 0xffd48a,
  volcano: 0xff9a5a,
  cave: 0x8ad8f2,
};

const CAPS_MIN = 3;
const CAPS_MAX = 7;
/** How far a cap sits from its cluster centre. */
const CLUSTER_SPREAD = 1.35;

export interface FloraProbes {
  /** deterministic 0..1 for an integer cell plus a salt (the sim's hash2) */
  hash(cx: number, cz: number, salt: number): number;
  /** ground height at a world XZ */
  groundAt(x: number, z: number): number;
  /** realm at a world XZ */
  biomeAt(x: number, z: number): BiomeId;
  /** true where a cluster must not grow: roads, town plateaus, open water */
  excluded(x: number, z: number, groundY: number): boolean;
}

/**
 * Fill `out` with every glow-flora cap in the cell window around a camera.
 *
 * Caller-owned `out` and a returned COUNT rather than a fresh array: this runs
 * again every time the camera crosses a cell boundary, which while running is
 * often enough that a per-rebuild allocation of a few hundred objects is worth
 * avoiding. Entries past the returned count are stale and must be ignored.
 */
export function glowFloraCaps(
  camX: number,
  camZ: number,
  probes: FloraProbes,
  out: GlowFloraCap[],
  cap = FLORA_CAP_POOL,
): number {
  const originCx = Math.floor(camX / FLORA_CELL);
  const originCz = Math.floor(camZ / FLORA_CELL);
  let count = 0;
  for (let dz = -FLORA_CELL_RADIUS; dz <= FLORA_CELL_RADIUS; dz++) {
    for (let dx = -FLORA_CELL_RADIUS; dx <= FLORA_CELL_RADIUS; dx++) {
      if (count >= cap) return count;
      const cx = originCx + dx;
      const cz = originCz + dz;
      // Cluster centre first, so the density roll is taken against the realm
      // the cluster would actually stand in, not the one the cell corner is in.
      const centreX = (cx + probes.hash(cx, cz, 1)) * FLORA_CELL;
      const centreZ = (cz + probes.hash(cx, cz, 2)) * FLORA_CELL;
      const biome = probes.biomeAt(centreX, centreZ);
      if (probes.hash(cx, cz, 3) > FLORA_DENSITY[biome]) continue;
      const centreY = probes.groundAt(centreX, centreZ);
      if (probes.excluded(centreX, centreZ, centreY)) continue;
      const capCount = CAPS_MIN + Math.floor(probes.hash(cx, cz, 4) * (CAPS_MAX - CAPS_MIN + 1));
      for (let i = 0; i < capCount && count < cap; i++) {
        const angle = probes.hash(cx, cz, 10 + i) * Math.PI * 2;
        const reach = Math.sqrt(probes.hash(cx, cz, 30 + i)) * CLUSTER_SPREAD;
        const x = centreX + Math.cos(angle) * reach;
        const z = centreZ + Math.sin(angle) * reach;
        const y = probes.groundAt(x, z);
        if (probes.excluded(x, z, y)) continue;
        const slot = out[count];
        const variant = probes.hash(cx, cz, 50 + i);
        const scale = 0.62 + probes.hash(cx, cz, 70 + i) * 0.75;
        const yaw = probes.hash(cx, cz, 90 + i) * Math.PI * 2;
        if (slot === undefined) out.push({ x, y, z, scale, yaw, variant });
        else {
          slot.x = x;
          slot.y = y;
          slot.z = z;
          slot.scale = scale;
          slot.yaw = yaw;
          slot.variant = variant;
        }
        count++;
      }
    }
  }
  return count;
}

/** Whether the camera has left the cell its last flora fill was built for. */
export function floraCellChanged(
  camX: number,
  camZ: number,
  lastCx: number,
  lastCz: number,
): boolean {
  return Math.floor(camX / FLORA_CELL) !== lastCx || Math.floor(camZ / FLORA_CELL) !== lastCz;
}

/** The cell a camera position falls in, for the caller to remember. */
export function floraCellOf(camX: number, camZ: number): { cx: number; cz: number } {
  return { cx: Math.floor(camX / FLORA_CELL), cz: Math.floor(camZ / FLORA_CELL) };
}

// ---------------------------------------------------------------------------
// Fireflies
// ---------------------------------------------------------------------------

/** How high above the waterline a spot still counts as a water edge. */
const SHORE_BAND = 2.6;
/** Realms leafy enough for fireflies away from any water. */
const FIREFLY_INLAND: ReadonlySet<BiomeId> = new Set([
  'vale',
  'marsh',
  'fen',
  'jungle',
  'garden',
  'night',
  'dusk',
]);

/**
 * Is this a spot a firefly would settle? Water edges anywhere in the world (the
 * brief's "near water edges"), plus anywhere at all in the leafy realms, so the
 * forests are not bare between their ponds. Never over open water, and never on
 * bare rock or snow, where a drifting bug reads as a rendering fault.
 */
export function fireflyHabitat(groundY: number, waterLevel: number, biome: BiomeId): boolean {
  if (groundY <= waterLevel) return false;
  if (groundY < waterLevel + SHORE_BAND) return true;
  return FIREFLY_INLAND.has(biome);
}

/**
 * A firefly's own brightness at a moment, 0..1: a slow blink that spends most
 * of its cycle dark, which is what makes a scattering of them read as insects
 * rather than as fairy lights on a string. `phase` spreads the pool out so they
 * never pulse in unison.
 */
export function fireflyBlink(time: number, phase: number): number {
  const cycle = (time * 0.55 + phase) % 1;
  // a short bright lobe (the flash) inside a long dark remainder
  if (cycle > 0.34) return 0;
  const t = cycle / 0.34;
  return Math.sin(t * Math.PI) ** 2;
}
