// Source Cave spec generation: turns a ranked contributor roster into a complete,
// deterministic cave (a single arena room + contributor mobs with tier-derived
// level / elite / boss flags ringed around a centre reboot button + reward chest). Pure and
// host-agnostic: it draws ONLY from its own salted Rng, so the same roster + seed
// yields the same cave on every host. No Sim wiring here; a later phase consumes
// the spec.

import { DELVE_MODULE_LAYOUTS, type DelveModuleId } from '../delve_layout';
import { DUNGEON_WALL_X } from '../dungeon_layout';
import { Rng } from '../rng';
import { sourceCaveCombatRoles } from './combatants';
import { sourceCaveMobProfileForMergedPrs, sourceCaveMobProfileForTier } from './tier_profiles';
import type { SourceCaveMobSpec, SourceCaveRosterEntry, SourceCaveSpec } from './types';

// --- Tuning constants (change numbers HERE, never inline) --------------------

/**
 * Salt XORed into the caller's seed so the cave draws from its OWN deterministic
 * stream, never a shared Sim rng. Any fixed non-zero constant works: determinism
 * depends on it being fixed, not on its value.
 */
const SOURCE_CAVE_SALT = 0x50c0cafe;

/** The cave's one room: a square arena with a centre dais (delve_layout.ts). */
const SOURCE_CAVE_ARENA_MODULE: DelveModuleId = 'source_cave_arena';

/** Minimum pairwise distance between two mobs in the cave, in yards. */
export const SOURCE_CAVE_MOB_MIN_DIST = 6;

// Concentric-ring placement: contributor mobs ring outward from the boss's
// centre dais, strongest rank closest to the centre. Radial step and same-ring
// arc spacing both sit just above the min-distance floor (denser than a doubled-up
// grid would give), keeping mobs close without stacking; the actual realized
// minimum is pinned by a placement test, not by this arithmetic alone (see spec test).
const RING_RADIAL_STEP = SOURCE_CAVE_MOB_MIN_DIST + 2; // 8
const RING_ARC_SPACING = SOURCE_CAVE_MOB_MIN_DIST + 2; // 8
// Clears the centre dais and the large reboot button with room to spare.
const RING_INNER_RADIUS = 14;
// Wall clearance kept between the outermost ring and the arena's own walls.
const ARENA_WALL_CLEARANCE = 5;

// Entrance anchoring: the DOOR (exit portal) hugs the south wall at a fixed
// inset (user decision; the room itself was shrunk to fit the worst-case rings,
// delve_layout.ts), while the SPAWN point sits deeper into the room so the
// third-person camera has floor behind the player instead of clipping through
// the wall (user report: entering showed only wall bricks). The spawn depth
// yields to the rings when a huge roster needs the space.
const SOURCE_CAVE_EXIT_WALL_INSET = 3;
// Preferred spawn depth from the wall: enough room for the default chase-camera
// distance before it crosses the wall plane.
const SOURCE_CAVE_ENTRY_WALL_INSET_MAX = 14;
// Gap always kept between the spawn and the outermost ring, so a player never
// materializes inside a mob (asserted at spec-build time).
const SOURCE_CAVE_ENTRY_RING_GAP = 4;
// The reward chest's dedicated alcove: inset from the NORTH wall, under the
// banners next to the archive crates, far across the room from the centre
// button so a click near one can never resolve onto the other (the generic
// interact command re-scans for the nearest lootable object).
const SOURCE_CAVE_CHEST_ALCOVE_WALL_INSET = 6;

// --- Public helpers ----------------------------------------------------------

/** The arena's usable placement radius (walls minus clearance). Throws if unknown. */
export function sourceCaveArenaUsableRadius(): number {
  const layout = DELVE_MODULE_LAYOUTS[SOURCE_CAVE_ARENA_MODULE];
  if (!layout) throw new Error('Source cave arena layout is missing');
  const halfDepth = (layout.zMax - layout.zMin) / 2;
  const halfWidth = layout.wallX ?? DUNGEON_WALL_X;
  return Math.min(halfDepth, halfWidth) - ARENA_WALL_CLEARANCE;
}

/** Farthest placed mob from the arena centre (0 for an empty or boss-only roster). */
export function sourceCaveOuterRingRadius(spec: SourceCaveSpec): number {
  let max = 0;
  for (const m of spec.mobs) {
    const r = Math.hypot(m.x, m.z);
    if (r > max) max = r;
  }
  return max;
}

/**
 * Arena-local z of the entrance/spawn point: SOURCE_CAVE_ENTRY_WALL_INSET_MAX
 * deep into the room (camera clearance), pushed back toward the wall only when
 * an oversized roster's outer ring needs that space (never closer than
 * SOURCE_CAVE_ENTRY_RING_GAP to the ring). Negative z, matching the arena's
 * zMin-is-the-door convention; the door/exit visual stays AT the wall.
 */
export function sourceCaveEntryZ(spec: SourceCaveSpec): number {
  const layout = DELVE_MODULE_LAYOUTS[SOURCE_CAVE_ARENA_MODULE];
  const deep = layout.zMin + SOURCE_CAVE_ENTRY_WALL_INSET_MAX;
  const ringLimit = -(sourceCaveOuterRingRadius(spec) + SOURCE_CAVE_ENTRY_RING_GAP);
  return Math.min(deep, ringLimit);
}

/** Arena-local z of the reward chest's alcove, inset from the NORTH wall. */
export function sourceCaveChestLocalZ(): number {
  const layout = DELVE_MODULE_LAYOUTS[SOURCE_CAVE_ARENA_MODULE];
  return layout.zMax - SOURCE_CAVE_CHEST_ALCOVE_WALL_INSET;
}

/** Arena-local z of the exit portal: between the spawn and the south wall. */
export function sourceCaveExitZ(_spec: SourceCaveSpec): number {
  const layout = DELVE_MODULE_LAYOUTS[SOURCE_CAVE_ARENA_MODULE];
  return layout.zMin + SOURCE_CAVE_EXIT_WALL_INSET;
}

// --- Spec generation ---------------------------------------------------------

/**
 * Build a complete, deterministic Source Cave spec from a contributor roster.
 * An empty roster yields a minimal valid cave: the arena room, no mobs, a chest
 * at the centre dais. Pure: all randomness flows through one salted Rng.
 */
export function buildSourceCaveSpec(
  roster: readonly SourceCaveRosterEntry[],
  seed: number,
): SourceCaveSpec {
  const rng = new Rng((seed ^ SOURCE_CAVE_SALT) >>> 0);
  const modules: string[] = [SOURCE_CAVE_ARENA_MODULE];

  // Weakest first, boss (the single top-ranked entry, by identity) last. Tiebreak
  // by login keeps the order input-independent (precondition: a real contributor
  // roster has unique logins).
  const ranked = [...roster].sort(
    (a, b) => b.rank - a.rank || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0),
  );
  const bossEntry = ranked.length > 0 ? ranked[ranked.length - 1] : null;
  const nonBoss = bossEntry ? ranked.slice(0, ranked.length - 1) : ranked;
  // Strongest first: the ring fill below seats the strongest non-boss tier
  // closest to the centre, weakest in the outermost ring.
  const byStrength = [...nonBoss].reverse();

  // Seat every contributor around the centre button, including the boss. The
  // output order stays strongest non-boss first and boss last for wire stability;
  // a map assigns the strength-ordered ring positions without putting the boss
  // back on the centre dais.
  const placementOrder = bossEntry ? [bossEntry, ...byStrength] : byStrength;
  const points = placeInRings(rng, placementOrder.length);
  const positions = new Map(placementOrder.map((entry, i) => [entry, points[i]]));
  const outputOrder = bossEntry ? [...byStrength, bossEntry] : byStrength;
  const placedMobs: Array<Omit<SourceCaveMobSpec, 'combatant' | 'combatTier'>> = outputOrder.map(
    (entry) => {
      const boss = entry === bossEntry;
      const profile = sourceCaveMobProfileForMergedPrs(entry.mergedPrs, boss);
      const point = positions.get(entry);
      if (!point) throw new Error(`Source cave placement missing for ${entry.login}`);
      return {
        login: entry.login,
        mergedPrs: entry.mergedPrs,
        rank: entry.rank,
        level: profile.level,
        elite: profile.elite,
        boss: profile.boss,
        moduleIndex: 0,
        x: point.x,
        z: point.z,
      };
    },
  );
  const combatRoles = sourceCaveCombatRoles(placedMobs);
  const mobs: SourceCaveMobSpec[] = placedMobs.map((mob) => {
    const combatTier = combatRoles.get(mob.login) ?? null;
    const profile = combatTier ? sourceCaveMobProfileForTier(combatTier, mob.boss) : null;
    return {
      ...mob,
      combatant: combatTier !== null,
      combatTier,
      ...(profile ? { level: profile.level, elite: profile.elite } : {}),
    };
  });

  const arenaLayout = DELVE_MODULE_LAYOUTS[SOURCE_CAVE_ARENA_MODULE];
  const spec: SourceCaveSpec = {
    modules,
    mobs,
    chestPos: { x: arenaLayout.dais.x, z: arenaLayout.dais.z },
  };
  assertEntryFitsInsideWalls(spec, arenaLayout);
  return spec;
}

/**
 * The arena's own size (delve_layout.ts's SOURCE_CAVE_ARENA_HALF) is the
 * smallest value provably safe for the worst-case rings plus the wall-anchored
 * spawn (see that file's derivation comment). Re-derive the check here against
 * the ACTUAL roster this spec was built from, so a future change to the ring or
 * inset constants that squeezes the spawn into the outer ring fails loudly at
 * spec-build time instead of silently spawning players inside a mob.
 *
 * Epsilon: when the ring limit governs, sourceCaveEntryZ places the spawn at
 * exactly outer + GAP, and re-deriving `(outer + GAP) - outer` in doubles can
 * come out a few ulps under GAP (the outer radius is irrational after
 * roundCoord). Tolerate that; a real constants regression misses by whole
 * units, not 1e-15.
 */
function assertEntryFitsInsideWalls(spec: SourceCaveSpec, _arenaLayout: { zMin: number }): void {
  const gap = Math.abs(sourceCaveEntryZ(spec)) - sourceCaveOuterRingRadius(spec);
  if (gap < SOURCE_CAVE_ENTRY_RING_GAP - 1e-9) {
    throw new Error(
      `Source cave arena too small: ${spec.mobs.length} mobs leave only ${gap.toFixed(1)}u at the door`,
    );
  }
}

/**
 * Place `count` mobs in concentric rings around the arena centre (the reboot
 * button's position), starting at RING_INNER_RADIUS and stepping outward by
 * RING_RADIAL_STEP. Each ring's capacity comes from its own circumference at
 * RING_ARC_SPACING, so ring count falls out of the roster size instead of being
 * hand-tuned. Each ring gets its own rng-drawn rotation so rings don't align
 * radially; positions within a ring are evenly spaced (no per-mob jitter, so the
 * arc-spacing floor is exact, not probabilistic).
 */
function placeInRings(rng: Rng, count: number): Array<{ x: number; z: number }> {
  const usableRadius = sourceCaveArenaUsableRadius();
  const out: Array<{ x: number; z: number }> = [];
  let remaining = count;
  let ring = 0;
  while (remaining > 0) {
    const radius = RING_INNER_RADIUS + ring * RING_RADIAL_STEP;
    if (radius > usableRadius) {
      throw new Error(`Source cave arena too small for ${count} mobs`);
    }
    const capacity = Math.max(1, Math.floor((2 * Math.PI * radius) / RING_ARC_SPACING));
    const take = Math.min(capacity, remaining);
    const phase = rng.range(0, 2 * Math.PI);
    for (let i = 0; i < take; i++) {
      const theta = phase + (i * 2 * Math.PI) / take;
      out.push({
        x: roundCoord(radius * Math.cos(theta)),
        z: roundCoord(radius * Math.sin(theta)),
      });
    }
    remaining -= take;
    ring++;
  }
  return out;
}

/** Round to an integer coordinate, normalizing -0 to 0 so wire round-trips match. */
function roundCoord(v: number): number {
  const r = Math.round(v);
  return r === 0 ? 0 : r;
}
