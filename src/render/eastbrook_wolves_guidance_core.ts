// Mainland continuation of the island trail, after confirmed manual acceptance.
import { ZONE1_CAMPS } from '../sim/content/zone1';
import { zoneContaining } from '../sim/data';
import { EASTBROOK_NPC_PLACEMENTS_BY_ID } from '../sim/eastbrook_layout';
import { FERRY_BELL_TOWN_LANDING } from '../sim/interactions/ferry_bell';
import type { CoachGuides } from './coach_trail_core';

export interface WolvesGuideReader {
  questLog: ReadonlyMap<string, { state: string }>;
  /** Completed quest ids: a finished Wolves at the Door answers before the
   *  zone scan or any questState() read, so a veteran costs one Set lookup
   *  per frame and never the online read (which allocates per call). */
  questsDone?: ReadonlySet<string>;
  player: { pos: { x: number; z: number }; dead?: boolean; ghost?: boolean } | null | undefined;
  questState?(questId: string): string;
}

export const WOLVES_QUEST_ID = 'q_wolves';
const MARSHAL_POS = EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position;
// A missing camp (a content rename) degrades to no guidance rather than a
// module-load throw taking the client down; the core test pins the camp.
const camp = ZONE1_CAMPS.find((c) => c.mobId === 'forest_wolf') ?? null;
export const WOLF_RUN_CAMP = camp ? { ...camp.center, radius: camp.radius } : null;
// Clear of the graveyard fence even after the trail's curve smoothing.
export const WOLVES_ROUTE: readonly { x: number; z: number }[] = WOLF_RUN_CAMP
  ? [MARSHAL_POS, { x: -14.5, z: -72.5 }, { x: -14.5, z: -53.5 }, WOLF_RUN_CAMP]
  : [];
const EMPTY: CoachGuides = {
  plan: null,
  glowNpcId: null,
  glowNpcPos: null,
  areaRing: null,
  beamAt: null,
  beamAtNearestCrate: false,
  beamAtCrabCorpse: false,
};
const ACTIVE: CoachGuides = WOLF_RUN_CAMP
  ? { ...EMPTY, plan: { key: 'wolves:active', points: WOLVES_ROUTE }, areaRing: WOLF_RUN_CAMP }
  : EMPTY;
const OFFER: CoachGuides = {
  ...EMPTY,
  plan: { key: 'wolves:offer', points: [FERRY_BELL_TOWN_LANDING, MARSHAL_POS] },
  glowNpcId: 'marshal_redbrook',
  glowNpcPos: MARSHAL_POS,
};
const READY: CoachGuides = WOLF_RUN_CAMP
  ? {
      ...EMPTY,
      plan: { key: 'wolves:ready', points: [...WOLVES_ROUTE].reverse() },
      glowNpcId: 'marshal_redbrook',
      glowNpcPos: MARSHAL_POS,
    }
  : EMPTY;

/** `isDismissed` (the guidance setting and the quest's tracking flag) is a
 *  thunk so it is read only once the free guards have passed: a veteran, a
 *  ghost or a character outside Eastbrook never pays it. */
export function eastbrookWolvesGuide(
  world: WolvesGuideReader,
  isDismissed: () => boolean,
): CoachGuides {
  const p = world.player;
  if (!p || p.dead || p.ghost) return EMPTY;
  // Cheapest reads first. The confirmed log retains ready during an online
  // hand-in, while questState() temporarily reports active until the command
  // is acknowledged; a finished quest is a Set lookup and never reaches the
  // zone scan or the questState() read.
  const state = world.questLog.get(WOLVES_QUEST_ID)?.state;
  if (!state && world.questsDone?.has(WOLVES_QUEST_ID)) return EMPTY;
  if (zoneContaining(p.pos.x, p.pos.z)?.id !== 'eastbrook_vale') return EMPTY;
  if (isDismissed()) return EMPTY;
  if (!state && world.questState?.(WOLVES_QUEST_ID) === 'available') return OFFER;
  return state === 'active' ? ACTIVE : state === 'ready' ? READY : EMPTY;
}
