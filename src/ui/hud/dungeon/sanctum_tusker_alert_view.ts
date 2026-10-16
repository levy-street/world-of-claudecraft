// The Sledge Tusker's part of the Gravewyrm Sanctum alert (sanctum_alert_view.ts
// calls it): what its bait rework asks of the local player right now, read off
// what the sim mirrors (encounters/gravewyrm_sanctum: its Trample bar and
// locked facing, its Stuck in the Ice window, the ice outcrop objects whose
// template id carries their state, the soulfire trail and patch objects).
// Pure and DOM-free; it returns the kind, the line and the bar, and the Sanctum
// view dresses them.
//
// Priority: you are the Trample's target while its lane still follows you
// (the main teaching: lead the charge into an ice outcrop, then step aside;
// its bar counts down to the lock); standing in the painted Trample lane;
// standing in soulfire; the Tusker stuck in the ice (the damage window); a
// Trample that will end in an outcrop (you are clear of it); and, for the
// first seconds of a pull while an outcrop still stands, the one-line lesson
// of the bait.

import {
  SANCTUM_ICE_OUTCROP,
  SANCTUM_SOULFIRE_PATCH,
  SANCTUM_SOULFIRE_TRAIL,
  TUSKER_TUNING as T,
  TUSKER_STUCK_EXPOSED,
  TUSKER_TRAMPLE,
} from '../../../sim/encounters/gravewyrm_sanctum/ids';
import {
  inTrail,
  type OutcropSpot,
  trampleAimLocked,
} from '../../../sim/encounters/gravewyrm_sanctum/tusker_road';
import { planTrampleLaneWorld } from '../../../sim/encounters/gravewyrm_sanctum/tusker_road_world';
import type { TuskerLane } from '../../../sim/types';
import { formatNumber, t } from '../../i18n';

/** The share Stuck in the Ice adds to the damage it takes, for the lines. */
function stuckPct(): string {
  return formatNumber(Math.round(T.stuckVuln * 100), { maximumFractionDigits: 0 });
}

// Reused every frame of a Trample bar (the view runs each frame): the
// standing outcrops, their spot pool and the planned lane.
const STANDING: OutcropSpot[] = [];
const SPOTS: OutcropSpot[] = [];
const LANE: TuskerLane = { x: 0, z: 0, yaw: 0, length: 0, reach: 0, outcropId: null };

export type TuskerAlertKind =
  | 'trample-lead'
  | 'trample'
  | 'soulfire'
  | 'stuck'
  | 'trample-bait'
  | 'bait-hint';

export const TUSKER_ALERT_KINDS: readonly TuskerAlertKind[] = [
  'trample-lead',
  'trample',
  'soulfire',
  'stuck',
  'trample-bait',
  'bait-hint',
];

/** Seconds into a pull the bait's lesson stays up: until its first Trample. */
export const TUSKER_HINT_SECONDS = T.trampleFirst;
/** Extra yards round a lane or a fire a warning still fires at (a warning
 *  errs toward telling). */
const EDGE_MARGIN = 0.75;

interface TuskerAlertAura {
  id: string;
  remaining?: number;
  duration?: number;
}

/** A body the Tusker's alert reads (the Tusker, an outcrop, a fire). */
export interface TuskerAlertEntity {
  id?: number;
  templateId?: string;
  dead?: boolean;
  pos?: { x: number; z: number };
  facing?: number;
  scale?: number;
  auras?: readonly TuskerAlertAura[];
  castingAbility?: string | null;
  castRemaining?: number;
  castTotal?: number;
  castTargetId?: number | null;
  inCombat?: boolean;
}

export interface TuskerAlertScene {
  tusker: TuskerAlertEntity | null;
  /** The ice outcrop objects (any state). */
  outcrops: readonly TuskerAlertEntity[];
  /** The soulfire on the road: trail and patch objects. */
  roadFires: readonly TuskerAlertEntity[];
  /** The caller's clock when this pull was first seen (null out of combat). */
  tuskerPulledAt: number | null;
}

/** What the Tusker asks, before the Sanctum view dresses it. */
export interface TuskerAlert {
  kind: TuskerAlertKind;
  line: string;
  /** 0 to 1, or null for no bar. */
  progress: number | null;
  /** The seconds the bar stands for, or null. */
  seconds: number | null;
}

function share(left: number | undefined, total: number | undefined): number | null {
  if (!total || total <= 0 || left === undefined) return null;
  return Math.max(0, Math.min(1, left / total));
}

/** Is `p` in the strip `length` yards from `from` along `yaw`, `half` either side? */
function inStrip(
  from: { x: number; z: number },
  yaw: number,
  length: number,
  half: number,
  p: { x: number; z: number },
): boolean {
  const dx = p.x - from.x;
  const dz = p.z - from.z;
  const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const side = Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw));
  return along >= -EDGE_MARGIN && along <= length + EDGE_MARGIN && side <= half;
}

/** Does `p` stand in soulfire (a trail's strip or a spilled patch)? */
export function inRoadFire(
  fires: readonly TuskerAlertEntity[],
  p: { x: number; z: number },
): boolean {
  for (const fire of fires) {
    if (!fire.pos) continue;
    if (fire.templateId === SANCTUM_SOULFIRE_TRAIL) {
      if (inTrail(fire.pos.x, fire.pos.z, fire.facing ?? 0, fire.scale ?? 0, p.x, p.z)) return true;
    } else if (fire.templateId === SANCTUM_SOULFIRE_PATCH) {
      if (Math.hypot(p.x - fire.pos.x, p.z - fire.pos.z) <= (fire.scale ?? T.patchRadius))
        return true;
    }
  }
  return false;
}

/** The Tusker's alert for a player standing at `me` (entity `selfId`), or
 *  null when it asks nothing of them. `now` is the caller's clock (the
 *  scene's own). */
export function buildTuskerAlert(
  scene: TuskerAlertScene,
  me: { x: number; z: number },
  now: number | undefined,
  selfId?: number,
): TuskerAlert | null {
  const tusker = scene.tusker && !scene.tusker.dead ? scene.tusker : null;
  // You are the Trample's target and its lane still follows you: lead it
  // into an ice outcrop, then step aside. The bar counts down to the lock.
  // With every outcrop spent there is nothing to lead it into: the plain
  // lane rules below say step out.
  if (
    tusker &&
    tusker.castingAbility === TUSKER_TRAMPLE &&
    selfId !== undefined &&
    tusker.castTargetId === selfId &&
    !trampleAimLocked(tusker.castRemaining ?? 0) &&
    scene.outcrops.some((o) => o.templateId === SANCTUM_ICE_OUTCROP)
  ) {
    const left = Math.max(0, (tusker.castRemaining ?? 0) - T.trampleLock);
    return {
      kind: 'trample-lead',
      line: t('hudChrome.sanctumAlert.trampleLeadLine'),
      progress: share(left, (tusker.castTotal || T.trampleCast) - T.trampleLock),
      seconds: left,
    };
  }
  // The painted lane: the plan the sim made, from what the client mirrors.
  let baited = false;
  if (tusker?.pos && tusker.castingAbility === TUSKER_TRAMPLE) {
    const standing = STANDING;
    standing.length = 0;
    for (const o of scene.outcrops) {
      if (o.templateId !== SANCTUM_ICE_OUTCROP || !o.pos || o.id === undefined) continue;
      let spot = SPOTS[standing.length];
      if (!spot) {
        spot = { id: 0, x: 0, z: 0 };
        SPOTS[standing.length] = spot;
      }
      spot.id = o.id;
      spot.x = o.pos.x;
      spot.z = o.pos.z;
      standing.push(spot);
    }
    const yaw = tusker.facing ?? 0;
    const lane = planTrampleLaneWorld(tusker.pos.x, tusker.pos.z, yaw, standing, LANE);
    if (inStrip(tusker.pos, yaw, lane.reach, T.trampleHalfWidth + EDGE_MARGIN, me))
      return {
        kind: 'trample',
        line: t('hudChrome.sanctumAlert.trampleLine'),
        progress: share(tusker.castRemaining, tusker.castTotal),
        seconds: tusker.castRemaining ?? null,
      };
    baited = lane.outcropId !== null;
  }
  if (inRoadFire(scene.roadFires, me))
    return {
      kind: 'soulfire',
      line: t('hudChrome.sanctumAlert.soulfireLine'),
      progress: null,
      seconds: null,
    };
  if (!tusker) return null;
  const stuck = tusker.auras?.find((a) => a.id === TUSKER_STUCK_EXPOSED);
  if (stuck)
    return {
      kind: 'stuck',
      line: t('hudChrome.sanctumAlert.stuckLine', { pct: stuckPct() }),
      progress: share(stuck.remaining, stuck.duration),
      seconds: stuck.remaining ?? null,
    };
  if (baited)
    return {
      kind: 'trample-bait',
      line: t('hudChrome.sanctumAlert.trampleBaitLine'),
      progress: share(tusker.castRemaining, tusker.castTotal),
      seconds: tusker.castRemaining ?? null,
    };
  // The lesson, for the first seconds of a pull while a bait is still to be had.
  if (now === undefined || scene.tuskerPulledAt === null || !tusker.inCombat) return null;
  const age = now - scene.tuskerPulledAt;
  if (age < 0 || age > TUSKER_HINT_SECONDS) return null;
  if (!scene.outcrops.some((o) => o.templateId === SANCTUM_ICE_OUTCROP)) return null;
  return {
    kind: 'bait-hint',
    line: t('hudChrome.sanctumAlert.baitHintLine', {
      pct: stuckPct(),
      seconds: formatNumber(T.stuckSeconds, { maximumFractionDigits: 0 }),
    }),
    progress: 1 - age / TUSKER_HINT_SECONDS,
    seconds: TUSKER_HINT_SECONDS - age,
  };
}
