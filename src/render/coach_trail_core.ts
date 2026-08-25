// Pure model for the Proving Shore's golden ground trail and target glow:
// WHERE the guiding ribbon runs for the rail's current station, and WHICH
// NPC deserves the "press me next" golden treatment. The island coaches a
// player who has never played the genre; the card and the arrow ask them to
// read and to infer, the trail just paints the walk on the ground.
//
// Waypoints are authored content coordinates (the same constants the sim
// spawns from), so the trail needs no live entity scan: every station's
// route is static, and the consumer (coach_trail.ts) rebuilds its draped
// ribbon only when the station key changes. Reads the same IWorld quest
// facets as quest_beacon_core.ts beside it.
//
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); driven
// directly by tests/coach_trail_core.test.ts.

import {
  BOOTCAMP_COURSE_CHECKPOINTS,
  PROVING_SHORE_ARRIVAL,
  PROVING_SHORE_NPCS,
  PROVING_SHORE_OBJECTS,
  PROVING_SHORE_QUEST_ORDER,
  PROVING_SHORE_QUESTS,
} from '../sim/content/proving_shore';
/** The IWorld quest facets this core reads (quest_beacon_core's reader plus
 *  the objective counts the gauntlet leg keys on). */
export interface CoachGuideReader {
  questState(id: string): string;
  questLog: ReadonlyMap<
    string,
    { state: string; counts?: readonly number[]; creditedObjects?: readonly string[] }
  >;
  /** The viewer's own position, and their corpse while they are a ghost.
   *  Optional so the existing callers and fixtures are unchanged; the death
   *  lesson's route back is the only thing that reads them. */
  playerPos?: { x: number; z: number };
  corpsePos?: { x: number; z: number } | null;
}

export interface CoachTrailPlan {
  /** Stable identity for the ribbon cache: rebuild only when this changes. */
  key: string;
  /** The route, in walk order (at least two points). */
  points: readonly { x: number; z: number }[];
}

/** Mirrors bootcamp_view.ts COACH_ACTIVE_TARGETS for the two kill lessons
 *  (a render core cannot import ui/): the effigy yard and the scuttler
 *  strand's anchor. */
const STRIKE_YARD = { x: -336, z: -14 };
const SCUTTLER_STRAND = { x: -380, z: -42 };
/** The tide pool (interactions/crab_summon.ts CRAB_SUMMON_SITE; a render core
 *  mirrors the coordinate, tests/coach_trail_core.test.ts pins them equal). */
const CRAB_POOL = { x: -398, z: -17 };
/** The signpost's reading spot (the noticeboard sentinel's authored stand). */
const SIGNPOST_SPOT = { x: -312, z: 42.5 };

function npcPos(id: string): { x: number; z: number } {
  return PROVING_SHORE_NPCS[id].pos;
}

function cratePoints(): readonly { x: number; z: number }[] {
  const line = PROVING_SHORE_OBJECTS.find((o) => o.itemId === 'ps_castaway_crate');
  return line ? line.positions : [];
}

function bellPoint(): { x: number; z: number } {
  const bell = PROVING_SHORE_OBJECTS.find((o) => o.itemId === 'ps_ferry_bell');
  return bell?.positions.find((p) => p.x < -180) ?? { x: -279, z: -10 };
}

/** Where each quest's ACTIVE leg ends (the hand-back leg starts there). */
function activeEnd(questId: string): { x: number; z: number } {
  switch (questId) {
    case PROVING_SHORE_QUEST_ORDER[0]: {
      const last = BOOTCAMP_COURSE_CHECKPOINTS[BOOTCAMP_COURSE_CHECKPOINTS.length - 1];
      return last ?? PROVING_SHORE_ARRIVAL;
    }
    case 'q_ps_strike_true':
      return STRIKE_YARD;
    case 'q_ps_shell_and_claw':
      return SCUTTLER_STRAND;
    case 'q_ps_mother_of_pearl':
      return CRAB_POOL;
    case 'q_ps_the_wreck_line': {
      const crates = cratePoints();
      return crates[crates.length - 1] ?? npcPos(PROVING_SHORE_QUESTS[questId].giverNpcId);
    }
    case 'q_ps_the_signpost':
      return SIGNPOST_SPOT;
    default:
      return npcPos(PROVING_SHORE_QUESTS[questId].giverNpcId);
  }
}

/** The first rail quest still moving, mirrored from the ui coach so both
 *  layers agree about the station without a cross-layer import. */
function railFocus(world: CoachGuideReader): { questId: string; state: string } | null {
  for (const questId of PROVING_SHORE_QUEST_ORDER) {
    if (world.questLog.get(questId)?.state === 'active') return { questId, state: 'active' };
    const state = world.questState(questId);
    if (state === 'available' || state === 'ready') return { questId, state };
  }
  return null;
}

/**
 * The golden route for the current station, or null when the station has no
 * meaningful walk (buying at the stall you are standing at) or the rail is
 * neither moving nor just graduated.
 */
export function coachTrailPlan(
  world: CoachGuideReader,
  gauntletCounts: number,
): CoachTrailPlan | null {
  // A ghost has exactly one route worth painting: back to its own body. It
  // beats every station route below, because while you are dead nothing else
  // on the island is reachable anyway (CX asked for this walk to be shown,
  // not just described).
  if (world.corpsePos && world.playerPos) {
    return {
      key: 'corpse-run',
      points: [
        { x: world.playerPos.x, z: world.playerPos.z },
        { x: world.corpsePos.x, z: world.corpsePos.z },
      ],
    };
  }
  const focus = railFocus(world);
  if (!focus) {
    // Graduated and still ashore: paint the walk to the ferry bell.
    const last = PROVING_SHORE_QUEST_ORDER[PROVING_SHORE_QUEST_ORDER.length - 1];
    if (world.questState(last) === 'done') {
      const turnIn = npcPos(PROVING_SHORE_QUESTS[last].turnInNpcId);
      return { key: 'bell', points: [turnIn, bellPoint()] };
    }
    return null;
  }
  const quest = PROVING_SHORE_QUESTS[focus.questId];
  const order = PROVING_SHORE_QUEST_ORDER;
  if (focus.state === 'available') {
    const idx = order.indexOf(focus.questId);
    const from =
      idx <= 0
        ? { x: PROVING_SHORE_ARRIVAL.x, z: PROVING_SHORE_ARRIVAL.z }
        : npcPos(PROVING_SHORE_QUESTS[order[idx - 1]].turnInNpcId);
    // Same-NPC legs (the relay's norm: every hand-in NPC is the next giver)
    // yield a zero-length ribbon the consumer draws as nothing; the plan
    // still keys the station so the glow and card stay in step.
    return { key: `${focus.questId}:available`, points: [from, npcPos(quest.giverNpcId)] };
  }
  if (focus.state === 'ready') {
    return {
      key: `${focus.questId}:ready`,
      points: [activeEnd(focus.questId), npcPos(quest.turnInNpcId)],
    };
  }
  // Active legs.
  if (focus.questId === order[0]) {
    // The gauntlet lanes: through the flags in running order, then across to
    // the overseer once every flag is tagged (the camera lesson's walk).
    if (gauntletCounts >= BOOTCAMP_COURSE_CHECKPOINTS.length) {
      return {
        key: `${focus.questId}:handoff`,
        points: [activeEnd(focus.questId), npcPos(quest.turnInNpcId)],
      };
    }
    return {
      key: `${focus.questId}:lanes`,
      points: [npcPos(quest.giverNpcId), ...BOOTCAMP_COURSE_CHECKPOINTS],
    };
  }
  if (focus.questId === 'q_ps_strike_true') {
    return { key: 'strike:active', points: [npcPos(quest.giverNpcId), STRIKE_YARD] };
  }
  if (focus.questId === 'q_ps_shell_and_claw') {
    return { key: 'shell:active', points: [npcPos(quest.giverNpcId), SCUTTLER_STRAND] };
  }
  if (focus.questId === 'q_ps_mother_of_pearl') {
    return { key: 'pearl:active', points: [npcPos(quest.giverNpcId), CRAB_POOL] };
  }
  if (focus.questId === 'q_ps_the_wreck_line') {
    // The crate haul: giver, crate to crate in authored order, then the
    // turn-in stall, exactly the "gold lines leading to each box" ask.
    return {
      key: 'wreck:active',
      points: [npcPos(quest.giverNpcId), ...cratePoints(), npcPos(quest.turnInNpcId)],
    };
  }
  if (focus.questId === 'q_ps_the_signpost') {
    return { key: 'signpost:active', points: [npcPos(quest.giverNpcId), SIGNPOST_SPOT] };
  }
  if (focus.questId === 'q_ps_set_sail') {
    return { key: 'sail:active', points: [npcPos(quest.giverNpcId), npcPos(quest.turnInNpcId)] };
  }
  return null;
}

/** Planar distance from (x, z) to the trail polyline: the min over its
 *  segments (point-to-segment, not point-to-vertex, so walking BETWEEN two
 *  far-apart waypoints still counts as on the path). The ferryman's
 *  veer-off nudge keys on this. */
export function distanceToTrail(
  points: readonly { x: number; z: number }[],
  x: number,
  z: number,
): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  let best = Math.hypot(points[0].x - x, points[0].z - z);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lenSq = abx * abx + abz * abz;
    const t =
      lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / lenSq));
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const d = Math.hypot(px - x, pz - z);
    if (d < best) best = d;
  }
  return best;
}

/** The ONE island NPC who is the rail's current pressing target (the giver
 *  on the way in, the turn-in once the task is done): the golden-glow NPC.
 *  Null while a task is mid-flight (the glow would point at nothing useful)
 *  and off the rail entirely. */
export function coachTargetNpcId(world: CoachGuideReader): string | null {
  const focus = railFocus(world);
  if (!focus) return null;
  const quest = PROVING_SHORE_QUESTS[focus.questId];
  if (focus.state === 'available') return quest.giverNpcId;
  if (focus.state === 'ready') return quest.turnInNpcId;
  return null;
}

export interface CoachGuides {
  plan: CoachTrailPlan | null;
  glowNpcId: string | null;
  /** The glow NPC's authored stand (island NPCs are stationary), the target
   *  ring's and aura's world anchor. */
  glowNpcPos: { x: number; z: number } | null;
  /** A NON-character objective's world anchor: the current gauntlet flag,
   *  the signpost, the ferry bell. Carries the vertical light beam. */
  beamAt: { x: number; z: number } | null;
  /** True on the crate haul: the beam follows the nearest LIVE crate, which
   *  only the consumer can resolve (it needs the entity roster). */
  beamAtNearestCrate: boolean;
  /** True on the pearl detour: once the king is DOWN the beam leaves the pool
   *  and stands on his corpse, because the pearl is on him and looting it is
   *  the step players were missing (CX: "still doesn't tell me to loot Mister
   *  Crabs to pick up the quest item. This is key."). Resolved by the
   *  consumer, which has the entity roster; falls back to `beamAt` (the pool)
   *  while no corpse is on the sand. */
  beamAtCrabCorpse: boolean;
  /** The kill lessons' quarry ground: a wide pulsing ring around the whole
   *  camp (the effigy yard, the scuttler strand), so "go fight THERE" reads
   *  from across the shore. */
  areaRing: { x: number; z: number; radius: number } | null;
}

/** The two kill camps' authored centers and how wide their rings draw. */
const KILL_AREA_RINGS: Readonly<Record<string, { x: number; z: number; radius: number }>> = {
  q_ps_strike_true: { ...STRIKE_YARD, radius: 9 },
  q_ps_shell_and_claw: { ...SCUTTLER_STRAND, radius: 11 },
  // The pearl detour: the ring marks the tide pool the summon happens at
  // (and the fight, since the king spawns in it).
  q_ps_mother_of_pearl: { ...CRAB_POOL, radius: 8 },
};

/** The non-character objective the vertical beam should stand over, or null
 *  when the station's target is an NPC (they get the aura instead). */
function beamTarget(
  world: CoachGuideReader,
  gauntletCounts: number,
): { at: { x: number; z: number } | null; nearestCrate: boolean; crabCorpse: boolean } {
  const focus = railFocus(world);
  if (!focus) {
    const last = PROVING_SHORE_QUEST_ORDER[PROVING_SHORE_QUEST_ORDER.length - 1];
    if (world.questState(last) === 'done')
      return { at: bellPoint(), nearestCrate: false, crabCorpse: false };
    return { at: null, nearestCrate: false, crabCorpse: false };
  }
  if (focus.state !== 'active') return { at: null, nearestCrate: false, crabCorpse: false };
  if (focus.questId === PROVING_SHORE_QUEST_ORDER[0]) {
    // Mid-lanes: the beam stands on the CURRENT flag. Once every flag is
    // tagged the target is Overseer Pell, an NPC: aura, not beam.
    if (gauntletCounts < BOOTCAMP_COURSE_CHECKPOINTS.length) {
      return {
        at: BOOTCAMP_COURSE_CHECKPOINTS[gauntletCounts] ?? null,
        nearestCrate: false,
        crabCorpse: false,
      };
    }
    return { at: null, nearestCrate: false, crabCorpse: false };
  }
  // The pearl detour's target is a spot of water, never a character: the
  // beam stands on the pool while the king is up (he spawns inside it, so it
  // keeps marking the fight too), and moves onto his CORPSE once he is down,
  // because the prize is on him and the loot is the step players missed.
  if (focus.questId === 'q_ps_mother_of_pearl') {
    return { at: CRAB_POOL, nearestCrate: false, crabCorpse: true };
  }
  if (focus.questId === 'q_ps_the_wreck_line') {
    return { at: null, nearestCrate: true, crabCorpse: false };
  }
  if (focus.questId === 'q_ps_the_signpost') {
    return { at: SIGNPOST_SPOT, nearestCrate: false, crabCorpse: false };
  }
  return { at: null, nearestCrate: false, crabCorpse: false };
}

/** One per-frame read for the renderer: the trail plan plus the golden
 *  target NPC, derived together so they can never disagree about the
 *  station. */
export function coachGuides(world: CoachGuideReader): CoachGuides {
  const gauntletCounts = world.questLog.get(PROVING_SHORE_QUEST_ORDER[0])?.counts?.[0] ?? 0;
  const glowNpcId = coachTargetNpcId(world);
  const beam = beamTarget(world, gauntletCounts);
  const focus = railFocus(world);
  const areaRing = focus?.state === 'active' ? (KILL_AREA_RINGS[focus.questId] ?? null) : null;
  return {
    plan: coachTrailPlan(world, gauntletCounts),
    glowNpcId,
    glowNpcPos: glowNpcId ? PROVING_SHORE_NPCS[glowNpcId].pos : null,
    beamAt: beam.at,
    beamAtNearestCrate: beam.nearestCrate,
    beamAtCrabCorpse: beam.crabCorpse,
    areaRing,
  };
}
