// Mainland continuation of the island trail, after confirmed manual acceptance.
import { ZONE1_CAMPS } from '../sim/content/zone1';
import { zoneContaining } from '../sim/data';
import { EASTBROOK_NPC_PLACEMENTS_BY_ID } from '../sim/eastbrook_layout';
import { FERRY_BELL_TOWN_LANDING } from '../sim/interactions/ferry_bell';
import type { CoachGuides } from './coach_trail_core';

export interface WolvesGuideReader {
  questLog: ReadonlyMap<string, { state: string }>;
  player: { pos: { x: number; z: number }; dead?: boolean; ghost?: boolean } | null | undefined;
  questState?(questId: string): string;
}

export const WOLVES_QUEST_ID = 'q_wolves';
const MARSHAL_POS = EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position;
const camp = ZONE1_CAMPS.find((c) => c.mobId === 'forest_wolf');
if (!camp) throw new Error('Missing Eastbrook forest wolf camp');
export const WOLF_RUN_CAMP = { ...camp.center, radius: camp.radius };
// Clear of the graveyard fence even after the trail's curve smoothing.
export const WOLVES_ROUTE = [
  MARSHAL_POS,
  { x: -14.5, z: -72.5 },
  { x: -14.5, z: -53.5 },
  WOLF_RUN_CAMP,
];
const EMPTY: CoachGuides = {
  plan: null,
  glowNpcId: null,
  glowNpcPos: null,
  areaRing: null,
  beamAt: null,
  beamAtNearestCrate: false,
  beamAtCrabCorpse: false,
};
const ACTIVE: CoachGuides = {
  ...EMPTY,
  plan: { key: 'wolves:active', points: WOLVES_ROUTE },
  glowNpcId: null,
  glowNpcPos: null,
  areaRing: WOLF_RUN_CAMP,
};
const OFFER: CoachGuides = {
  ...EMPTY,
  plan: { key: 'wolves:offer', points: [FERRY_BELL_TOWN_LANDING, MARSHAL_POS] },
  glowNpcId: 'marshal_redbrook',
  glowNpcPos: MARSHAL_POS,
};
const READY: CoachGuides = {
  ...EMPTY,
  plan: { key: 'wolves:ready', points: [...WOLVES_ROUTE].reverse() },
  glowNpcId: 'marshal_redbrook',
  glowNpcPos: MARSHAL_POS,
};

export function eastbrookWolvesGuide(world: WolvesGuideReader, dismissed: boolean): CoachGuides {
  const p = world.player;
  if (
    dismissed ||
    !p ||
    p.dead ||
    p.ghost ||
    zoneContaining(p.pos.x, p.pos.z)?.id !== 'eastbrook_vale'
  )
    return EMPTY;
  // The confirmed log retains ready during an online hand-in. questState()
  // temporarily reports active while that command awaits acknowledgment.
  const state = world.questLog.get(WOLVES_QUEST_ID)?.state;
  if (!state && world.questState?.(WOLVES_QUEST_ID) === 'available') return OFFER;
  return state === 'active' ? ACTIVE : state === 'ready' ? READY : EMPTY;
}
