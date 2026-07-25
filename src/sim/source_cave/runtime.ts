// Source Cave runtime registration: turns the pure Phase-1 spec into the live
// pieces the Sim needs, WITHOUT mutating the frozen DUNGEONS / DUNGEON_LIST
// module constants. The cave is a runtime dungeon: it uses the dungeon ENGINE
// (instance slots, enter/leave/door-trigger, empty-timeout free) but a delve-style
// module-assembled INTERIOR, so it physically lives in the delve x-band at a
// reserved delve index and its colliders resolve through the existing delve module
// path (delveModuleLocal / delveModuleColliders). See docs/the-source-cave/state.md.

import { DELVE_X_MIN, delveModuleZOffset, delveOrigin } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity, MobTemplate } from '../types';
import { SOURCE_CAVE_PLACEHOLDER_ROSTER } from './placeholder_roster';
import { buildSourceCaveSpec } from './spec';
import { sourceCaveMobTemplate } from './templates';
import type { SourceCaveRosterEntry, SourceCaveSpec } from './types';

/** The runtime dungeon id. Never added to the frozen DUNGEONS record. */
export const SOURCE_CAVE_DUNGEON_ID = 'source_cave';
const SOURCE_CAVE_TEMPLATE_PREFIX = 'source_cave_';

/**
 * Reserved delve-band index for the cave (world x = DELVE_X_MIN + index*600 =
 * 6000). Real delves occupy indices 0 and 1 (x 4800 / 5400), so the cave takes
 * the first free lane past them. Because this x is in the delve band,
 * isDelvePos() is true for cave positions and the delve collider resolver
 * handles the cave for free.
 *
 * The lane has moved twice, both times because a neighbouring band grew into it,
 * and both times the symptom was the same: isDelvePos() stops covering the cave,
 * so it silently loses collider resolution (walls stop holding) while everything
 * else still works. Index 8 (x 9600) was the original pick until the Yumi Maze
 * band claimed 8000..12000; index 5 (x 7800) held until the Vale Cup practice
 * band's west edge became isDelvePos()'s east cap. Sitting immediately after the
 * real delves is the durable spot: this lane can only be squeezed by a NEW delve,
 * which would move the cave deliberately rather than silently. VC_PRACTICE_BAND_X_MIN
 * (data.ts) is pinned a full lane past it, and tests/source_cave_spec.test.ts
 * asserts isDelvePos() over the cave's whole footprint so a future band move reds
 * here instead of at a collision bug.
 */
export const SOURCE_CAVE_DELVE_INDEX = 2;

/**
 * Reserved entity id for the overworld cave door, mirroring the Vale Cup
 * groundskeeper precedent (VALE_CUP_BRAM_ID = 1e9). Spawned OUTSIDE the nextId
 * sequence so the parity goldens' pinned id order and the ctor rng draw order are
 * both preserved. Two above Bram's (1e9 + 1 is FURY_ENTITY_ID, the PvP honor
 * NPC), well above the live nextId (low thousands).
 */
export const SOURCE_CAVE_DOOR_ID = 1_000_000_002;

/** Concurrent copies of the cave the world hosts (mirrors INSTANCE_SLOT_COUNT). */
export const SOURCE_CAVE_SLOT_COUNT = 24;

/**
 * Overworld entrance position (relocated per user decision, resolves O3 in
 * docs/the-source-cave/state.md; was {x: 165, z: -120}, Phase 3's provisional
 * spot). The ctor nudges it onto walkable land via findSafePos, so the exact
 * value only needs to be roughly clear of other content. The entrance visual is
 * a well (render/door_portal.ts), not the generic dungeon-door arch.
 */
export const SOURCE_CAVE_DOOR_POS = { x: -140.05, z: 463.43 } as const;

// The entrance/exit arena-local z anchors are computed dynamically from the
// actual roster (source_cave/spec.ts's sourceCaveEntryZ/sourceCaveExitZ), not a
// fixed inset here: a fixed wall-anchored offset would size the walk-in gap for
// the arena's worst-case roster headroom rather than the cave actually generated.

/** A DungeonDef-shaped runtime definition (only the fields the cave engine reads). */
export interface SourceCaveRuntimeDef {
  id: string;
  name: string;
  /** Overworld entrance portal (nudged onto land in the ctor). */
  doorPos: { x: number; z: number };
  suggestedPlayers: number;
  /** English placeholders finalized (and i18n-keyed) in Phase 3; emitted via variable. */
  enterText: string;
  leaveText: string;
  /** Level gate checked at the door (Phase 3). */
  minLevel: number;
}

/** Everything one Sim needs to place and run the cave. Generated once at ctor. */
export interface SourceCaveRuntime {
  def: SourceCaveRuntimeDef;
  spec: SourceCaveSpec;
  /** One synthesized template per spec mob, index-aligned with spec.mobs. */
  templates: MobTemplate[];
}

/** The reserved runtime def. */
export const SOURCE_CAVE_DEF: SourceCaveRuntimeDef = {
  id: SOURCE_CAVE_DUNGEON_ID,
  name: 'The Open Source',
  doorPos: SOURCE_CAVE_DOOR_POS,
  suggestedPlayers: 10,
  enterText: 'You step into The Open Source.',
  leaveText: 'You leave The Open Source.',
  minLevel: 20,
};

/** Instance-slot origin for the cave, a pure function of the reserved delve index. */
export function sourceCaveOrigin(slot: number): { x: number; z: number } {
  return delveOrigin(SOURCE_CAVE_DELVE_INDEX, slot);
}

// World-space point for a module-local (x, z) inside module `moduleIndex`, using
// the delve module z-stack (origin + per-module z-offset + local z). Mirrors
// spawnDelveModule's formula so the cave lays out exactly like a delve interior.
// Lives here (not dungeon.ts) so both the dungeon controller and clear.ts can
// share it without a dungeon <-> clear import cycle.
export function moduleWorldPoint(
  ctx: SimContext,
  cave: SourceCaveRuntime,
  origin: { x: number; z: number },
  moduleIndex: number,
  localX: number,
  localZ: number,
) {
  const zBase = delveModuleZOffset(cave.spec.modules, moduleIndex);
  return ctx.groundPos(origin.x + localX, origin.z + zBase + localZ);
}

/**
 * Is this world-x inside the cave's reserved delve sub-band? Narrows the generic
 * delve band to the cave's own 600u lane, so cave-specific code (module supply,
 * later the death/lockout paths) can tell the cave apart from a real delve.
 */
export function isSourceCavePos(x: number): boolean {
  return Math.round((x - DELVE_X_MIN) / 600) === SOURCE_CAVE_DELVE_INDEX;
}

/**
 * True when `entity` is a live Source Cave mob: a plain geometric check (mob
 * kind + unowned + isSourceCavePos on the entity's own position) shared by
 * every display surface (the render-side nameplate painter, the ui-side
 * target frame core) that needs to route a cave mob into its verbatim-name/
 * rank branch. Lives here, not in `src/ui/`, so both `render/` and `ui/` can
 * import the SAME predicate through the sanctioned sim/ edge instead of each
 * hand-deriving it, which is what let the two surfaces drift apart before.
 * The `ownerId` clause excludes a hypothetical owned pet standing in the
 * cave's x-band (pets are never contributor mobs).
 */
export function isSourceCaveMobEntity(entity: Entity): boolean {
  return entity.kind === 'mob' && entity.ownerId === null && isSourceCavePos(entity.pos.x);
}

/** Extract the contributor login from a Source Cave synthetic template id. */
export function sourceCaveLoginFromTemplateId(templateId: string): string | null {
  if (!templateId.startsWith(SOURCE_CAVE_TEMPLATE_PREFIX)) return null;
  const login = templateId.slice(SOURCE_CAVE_TEMPLATE_PREFIX.length);
  return login.length > 0 ? login : null;
}

export interface SourceCaveMobRank {
  elite: boolean;
  boss: boolean;
}

export interface SourceCaveMobRankEntry extends SourceCaveMobRank {
  login: string;
}

/** Resolve synthetic-template rank flags against a projected contributor roster. */
export function sourceCaveMobRankForTemplate(
  templateId: string,
  mobs: readonly SourceCaveMobRankEntry[] | undefined,
): SourceCaveMobRank {
  const login = sourceCaveLoginFromTemplateId(templateId);
  const entry = login ? mobs?.find((mob) => mob.login === login) : undefined;
  return { elite: entry?.elite ?? false, boss: entry?.boss ?? false };
}

/**
 * Build the live cave for one Sim from a roster and the Sim seed. Pure with
 * respect to the shared Sim rng: buildSourceCaveSpec draws only from its own
 * salted stream, and template synthesis draws nothing, so calling this in the
 * ctor never perturbs the shared draw order.
 */
export function buildSourceCaveRuntime(
  roster: readonly SourceCaveRosterEntry[],
  seed: number,
): SourceCaveRuntime {
  const spec = buildSourceCaveSpec(roster, seed);
  const templates = spec.mobs.map(sourceCaveMobTemplate);
  return { def: SOURCE_CAVE_DEF, spec, templates };
}

/** The default roster when no live GitHub roster is injected (offline / headless). */
export { SOURCE_CAVE_PLACEHOLDER_ROSTER };
