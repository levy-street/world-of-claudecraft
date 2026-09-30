// When the Fire and Fly arena is worth building ahead of the teleport, read from
// the world alone. The signal is the player TARGETING Master Gunner Alder: every
// way into his dialog (a click, the nearby-interaction key, a pad pick) targets
// him in the frame the dialog opens (src/game/interactions.ts), and the dialog's
// reading plus the trial pick is the lead the prebuild links in. Nearness alone
// would not do: he stands on the road at the Evergarden gate, and the quest row
// mints within its 40 yd area for every eligible player walking through.
// Eligibility is the dialog's own: alive, the quest's level, and a row to play
// for (active) or to practice (completed).

import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_NPC_ID,
  FIRE_AND_FLY_QUEST_ID,
  WORLD_QUEST_FIRE_AND_FLY,
} from '../sim/content/world_quest_fire_and_fly';

/** How far from Alder a lingering target still counts (the quest's area). */
export const ARENA_INTENT_REACH = WORLD_QUEST_FIRE_AND_FLY.area.radius;
/** Walking this far from Alder drops a built copy at once. */
export const ARENA_RELEASE_REACH = 80;
/** How long a copy outlives its intent (target moved on, dialog long closed). */
export const ARENA_INTENT_LAPSE_MS = 20_000;

export interface ArenaIntentWorld {
  readonly player: {
    readonly pos?: { readonly x: number; readonly z: number };
    readonly level?: number;
    readonly dead?: boolean;
    readonly ghost?: boolean;
    readonly targetId?: number | null;
  };
  readonly worldQuestLog?: ReadonlyMap<string, { readonly state: 'active' | 'completed' }>;
  readonly turretSession?: unknown;
}

export interface ArenaPrebuildState {
  built: boolean;
  /** When the intent last held, while a copy stands. */
  lastIntentMs: number;
}

export type ArenaPrebuildVerdict = 'build' | 'release' | 'hold';

export function createArenaPrebuildState(): ArenaPrebuildState {
  return { built: false, lastIntentMs: 0 };
}

function distanceToAlder(world: ArenaIntentWorld): number {
  const pos = world.player.pos;
  if (!pos) return Number.POSITIVE_INFINITY;
  return Math.hypot(pos.x - FIRE_AND_FLY_NPC_DEF.pos.x, pos.z - FIRE_AND_FLY_NPC_DEF.pos.z);
}

/** The player shows intent to take a trial right now. */
export function fireAndFlyArenaIntent(world: ArenaIntentWorld): boolean {
  const player = world.player;
  if (player.targetId !== FIRE_AND_FLY_NPC_ID) return false;
  if (world.turretSession || player.dead || player.ghost) return false;
  if ((player.level ?? 0) < WORLD_QUEST_FIRE_AND_FLY.minLevel) return false;
  const row = world.worldQuestLog?.get(FIRE_AND_FLY_QUEST_ID);
  if (row?.state !== 'active' && row?.state !== 'completed') return false;
  return distanceToAlder(world) <= ARENA_INTENT_REACH;
}

/**
 * One frame's decision, and the state it leaves. A copy is released once the
 * player is seated (the live arena then links as a cache hit: its materials are
 * page-lifetime), once they walk away, or once the intent has lapsed long enough.
 */
export function stepArenaPrebuild(
  state: ArenaPrebuildState,
  world: ArenaIntentWorld,
  nowMs: number,
): ArenaPrebuildVerdict {
  const intent = fireAndFlyArenaIntent(world);
  if (!state.built) {
    if (!intent) return 'hold';
    state.built = true;
    state.lastIntentMs = nowMs;
    return 'build';
  }
  if (intent) {
    state.lastIntentMs = nowMs;
    return 'hold';
  }
  if (
    world.turretSession ||
    distanceToAlder(world) > ARENA_RELEASE_REACH ||
    nowMs - state.lastIntentMs >= ARENA_INTENT_LAPSE_MS
  ) {
    state.built = false;
    return 'release';
  }
  return 'hold';
}
