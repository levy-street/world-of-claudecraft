// Mainland continuation of the island trail, after confirmed manual acceptance.
//
// The trail follows Marshal Redbrook where he actually stands: a map can move
// him (a Studio map stands him on the quay beside the ferry bell), and the
// golden guidance must lead to the NPC the player can see. While he stands at
// his layout spot the hand-authored route below is used unchanged; anywhere
// else the route is worked out with the player pathfinder once per position
// and loaded world (a small cache, never per frame).
import { lineOfSightClear } from '../sim/colliders';
import { ZONE1_CAMPS } from '../sim/content/zone1';
import {
  getActiveWorldContent,
  getContentGeneration,
  isBuiltinWorldActive,
  zoneContaining,
} from '../sim/data';
import { EASTBROOK_NPC_PLACEMENTS_BY_ID } from '../sim/eastbrook_layout';
import { FERRY_BELL_TOWN_LANDING } from '../sim/interactions/ferry_bell';
import { findPlayerPath } from '../sim/pathfind';
import { WORLD_SEED } from '../sim/world_seed';
import type { CoachGuides } from './coach_trail_core';
import { wolfHuntArea } from './wolf_hunt_area_core';

/** The slice of a world entity the guide reads to find Marshal. */
export interface WolvesGuideEntity {
  kind: string;
  templateId?: string;
  dead?: boolean;
  pos: { x: number; z: number };
}

export interface WolvesGuideReader {
  questLog: ReadonlyMap<string, { state: string }>;
  /** Completed quest ids: a finished Wolves at the Door answers before the
   *  zone scan or any questState() read, so a veteran costs one Set lookup
   *  per frame and never the online read (which allocates per call). */
  questsDone?: ReadonlySet<string>;
  player: { pos: { x: number; z: number }; dead?: boolean; ghost?: boolean } | null | undefined;
  questState?(questId: string): string;
  /** The world's live entities, to find where Marshal actually stands. */
  entities?: ReadonlyMap<number, WolvesGuideEntity>;
}

type Point = { x: number; z: number };

export const WOLVES_QUEST_ID = 'q_wolves';
const MARSHAL_ID = 'marshal_redbrook';
const MARSHAL_POS = EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position;
// A missing camp (a content rename) degrades to no guidance rather than a
// module-load throw taking the client down; the core test pins the camp.
const camp = ZONE1_CAMPS.find((c) => c.mobId === 'forest_wolf') ?? null;
export const WOLF_RUN_CAMP = camp ? { ...camp.center, radius: camp.radius } : null;
// The trail leaves the square by the north road: round the west end of the
// smithy's forge shelter (the road swings out round it), and back over the
// rise behind the smithy, west of the road's lamp, before it bends up the
// Wolf Run. Clear of every collider by more than a body's width even after
// the trail's curve smoothing, and 2 yd round Chronicler Saul.
export const WOLVES_ROUTE: readonly Point[] = WOLF_RUN_CAMP
  ? [
      MARSHAL_POS,
      { x: 13.5, z: -93.5 },
      { x: 16.3, z: -83 },
      { x: 17.5, z: -76 },
      { x: 14, z: -69 },
      { x: 7.5, z: -61.5 },
      { x: 5, z: -52 },
      WOLF_RUN_CAMP,
    ]
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

interface WolvesPlans {
  offer: CoachGuides;
  active: CoachGuides;
  ready: CoachGuides;
}

function plansFrom(
  marshal: Point,
  offerPoints: readonly Point[],
  huntPoints: readonly Point[],
  keySuffix: string,
  huntArea = WOLF_RUN_CAMP,
): WolvesPlans {
  return {
    offer: {
      ...EMPTY,
      plan: { key: `wolves:offer${keySuffix}`, points: offerPoints },
      glowNpcId: MARSHAL_ID,
      glowNpcPos: marshal,
    },
    active: huntArea
      ? {
          ...EMPTY,
          plan: { key: `wolves:active${keySuffix}`, points: huntPoints },
          areaRing: huntArea,
        }
      : EMPTY,
    ready: huntArea
      ? {
          ...EMPTY,
          plan: { key: `wolves:ready${keySuffix}`, points: [...huntPoints].reverse() },
          glowNpcId: MARSHAL_ID,
          glowNpcPos: marshal,
        }
      : EMPTY,
  };
}

/** Marshal at his layout spot: the authored plans, built once. */
const LAYOUT_PLANS = plansFrom(
  MARSHAL_POS,
  [FERRY_BELL_TOWN_LANDING, MARSHAL_POS],
  WOLVES_ROUTE,
  '',
);

/** Within this of the layout spot, Marshal counts as standing on it. */
const LAYOUT_TOLERANCE_YD = 1;
/** The search box for a town-wide route (the default 128 yd box is too small
 *  for the quay to the Wolf Run). */
const ROUTE_SPAN_YD = 256;

/** `from` to `to`: straight when nothing stands between them, else the
 *  pathfinder's walk; a failed search degrades to the straight line rather
 *  than no guidance. Always starts at `from` and ends at `to`. */
function routeBetween(from: Point, to: Point): Point[] {
  const a = { x: from.x, z: from.z };
  const b = { x: to.x, z: to.z };
  if (lineOfSightClear(WORLD_SEED, a, b)) return [a, b];
  const path = findPlayerPath(WORLD_SEED, a, b, ROUTE_SPAN_YD);
  const middle = path.slice(0, -1).map((p) => ({ x: p.x, z: p.z }));
  return [a, ...middle, b];
}

/** Recently worked-out plans, newest first. Each search costs tens of ms on
 *  the render thread, so a handful are kept: Marshal walking back and forth
 *  between two spots, or a map switch and back, never pays twice. */
const PLAN_CACHE_SIZE = 6;
/** Marshal within this of a cached position reuses its plans: online
 *  interpolation jitter (and a nudge in the editor) never re-runs a search. */
const REUSE_RADIUS_YD = 0.75;
const planCache: { at: Point; generation: number; plans: WolvesPlans }[] = [];

/** The plans for Marshal standing at `marshal`: the authored ones at his
 *  layout spot, otherwise worked out once per position and loaded world
 *  (the content generation changes whenever a different map is activated,
 *  so a route never outlives the colliders it was found against). */
function plansFor(marshal: Point): WolvesPlans {
  if (
    isBuiltinWorldActive() &&
    Math.hypot(marshal.x - MARSHAL_POS.x, marshal.z - MARSHAL_POS.z) <= LAYOUT_TOLERANCE_YD
  ) {
    return LAYOUT_PLANS;
  }
  const generation = getContentGeneration();
  const hit = planCache.findIndex(
    (entry) =>
      entry.generation === generation &&
      Math.hypot(marshal.x - entry.at.x, marshal.z - entry.at.z) <= REUSE_RADIUS_YD,
  );
  if (hit >= 0) {
    const [entry] = planCache.splice(hit, 1);
    planCache.unshift(entry);
    return entry.plans;
  }
  const where = { x: marshal.x, z: marshal.z };
  const key = `@${Math.round(where.x * 2) / 2},${Math.round(where.z * 2) / 2}#${generation}`;
  const offer = routeBetween(FERRY_BELL_TOWN_LANDING, where);
  const huntArea = isBuiltinWorldActive()
    ? WOLF_RUN_CAMP
    : wolfHuntArea(
        getActiveWorldContent().camps.filter(
          (camp) => zoneContaining(camp.center.x, camp.center.z)?.id === 'eastbrook_vale',
        ),
      );
  // The hunt ends on the camp itself (its ring carries the radius), as the
  // authored route does.
  const hunt = huntArea ? [...routeBetween(where, huntArea).slice(0, -1), huntArea] : [];
  const plans = plansFrom(where, offer, hunt, key, huntArea);
  planCache.unshift({ at: where, generation, plans });
  if (planCache.length > PLAN_CACHE_SIZE) planCache.length = PLAN_CACHE_SIZE;
  return plans;
}

/** The live entity id last seen as Marshal: re-checked in O(1) each frame. */
let marshalEntityId: number | null = null;
/** Frames to wait before scanning again for an absent Marshal: online he is
 *  outside the interest range for much of the vale, and a full entity scan
 *  every frame while he is away would be wasted work. */
const ABSENT_RESCAN_FRAMES = 30;
let absentFrames = 0;

/** Where Marshal stands right now, or null when he is not in the world
 *  (dead, not spawned, or outside an online interest range). */
function liveMarshal(entities: ReadonlyMap<number, WolvesGuideEntity> | undefined): Point | null {
  if (!entities) return null;
  if (marshalEntityId !== null) {
    const known = entities.get(marshalEntityId);
    if (known && known.kind === 'npc' && known.templateId === MARSHAL_ID && !known.dead) {
      return known.pos;
    }
    marshalEntityId = null;
    absentFrames = 0;
  }
  if (absentFrames > 0) {
    absentFrames--;
    return null;
  }
  for (const [id, entity] of entities) {
    if (entity.kind === 'npc' && entity.templateId === MARSHAL_ID && !entity.dead) {
      marshalEntityId = id;
      return entity.pos;
    }
  }
  absentFrames = ABSENT_RESCAN_FRAMES;
  return null;
}

/** Test seam: forget the cached plans and the remembered Marshal entity. */
export function resetWolvesGuideCache(): void {
  planCache.length = 0;
  marshalEntityId = null;
  absentFrames = 0;
}

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
  const marshal = liveMarshal(world.entities) ?? getActiveWorldContent().npcs[MARSHAL_ID]?.pos;
  if (!marshal) return EMPTY;
  const plans = plansFor(marshal);
  if (!state && world.questState?.(WOLVES_QUEST_ID) === 'available') return plans.offer;
  return state === 'active' ? plans.active : state === 'ready' ? plans.ready : EMPTY;
}
