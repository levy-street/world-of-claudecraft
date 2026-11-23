// King of the Hill bar: the pure, DOM-free view core. Turns the IWorld hill
// readout plus the local player's position into what the bar paints: whether
// it shows at all (only in the hill's zone), the phase (announced or risen),
// who holds the hill from the viewer's seat, the two headcounts the contest is
// decided on, the contest clock against its capture length, the distance to
// the circle, whether the viewer counts at all (parties only),
// and the structural signature the painter rebuilds its skeleton on. The
// painter (hill_bar_painter.ts) only paints; every decision is here.

import { HILL_CAPTURE_SECONDS } from '../../../sim/pvp';
import type {
  HillCalloutInfo,
  HillInfo,
  HillPhaseInfo,
  HillSide,
  HillStandingInfo,
} from '../../../world_api';

export interface HillBarLive {
  visible: true;
  /** Structural identity: rebuild the skeleton only when this changes. */
  sig: string;
  zoneId: string;
  phase: HillPhaseInfo;
  /** Whether the viewer counts on the hill (a raid member does not). */
  standing: HillStandingInfo;
  holder: HillSide;
  challenger: HillSide;
  /** The viewer's group inside, and the count they are measured against:
   *  the holder's members inside, or the largest rival's while unheld. */
  yours: number;
  theirs: number;
  /** Whole seconds of majority banked, of `capture`. */
  contest: number;
  /** The shown clock is paused (its group is inside but not leading). */
  contestPaused: boolean;
  capture: number;
  /** 0..1, for the progress fill. */
  contestFraction: number;
  inside: boolean;
  /** Whole yards from the viewer to the circle's edge; 0 inside. */
  distanceYards: number;
  /** Whole minutes to the rise (warning) or the fall (risen). */
  minutesLeft: number;
  /** The latest fresh announcer call (src/sim/pvp/hill_bounty.ts), or null. */
  callout: HillCalloutInfo | null;
}

export interface HillBarHidden {
  visible: false;
  sig: string;
}

export type HillBarView = HillBarLive | HillBarHidden;

const HIDDEN: HillBarHidden = { visible: false, sig: 'hidden' };

/** Announce entry or activation only for viewers eligible for the PvP flag.
 * Raid members cannot capture, but entering still flags them. */
export function shouldAnnounceHillPvp(previous: HillBarView | null, next: HillBarView): boolean {
  return hillPvpExposed(next) && !hillPvpExposed(previous);
}

function hillPvpExposed(view: HillBarView | null): boolean {
  return !!view?.visible && view.phase === 'active' && view.inside && view.standing !== 'level';
}

/** The count the viewer's group is measured against (the bar's right-hand
 *  number): the holder's present members while another group holds it, else
 *  the largest other group inside (the rival that pauses or threatens). */
export function hillRivalCount(
  info: Pick<HillInfo, 'holder' | 'holderCount' | 'rivalCount'>,
): number {
  // `?? 0`: a server from before rivalCount (a rolling deploy) omits it.
  return info.holder === 'other' ? info.holderCount : (info.rivalCount ?? 0);
}

/** Whole yards from a point to the circle's edge, 0 inside. */
export function hillEdgeDistance(
  info: Pick<HillInfo, 'x' | 'z' | 'radius'>,
  px: number,
  pz: number,
): number {
  const d = Math.hypot(px - info.x, pz - info.z) - info.radius;
  return d <= 0 ? 0 : Math.round(d);
}

export function buildHillBarView(
  info: HillInfo | null,
  playerPos: { x: number; z: number } | null,
): HillBarView {
  if (!info || !info.inZone) return HIDDEN;
  const distanceYards = playerPos ? hillEdgeDistance(info, playerPos.x, playerPos.z) : 0;
  const contest = Math.max(0, Math.min(HILL_CAPTURE_SECONDS, info.contest));
  return {
    visible: true,
    sig: `${info.zoneId}|${info.x},${info.z}|${info.phase}|${info.standing}|${info.holder}|${info.challenger}|${info.inside ? 1 : 0}`,
    zoneId: info.zoneId,
    phase: info.phase,
    standing: info.standing,
    holder: info.holder,
    challenger: info.challenger,
    yours: info.yourCount,
    theirs: hillRivalCount(info),
    contest,
    contestPaused: info.contestPaused === true,
    capture: HILL_CAPTURE_SECONDS,
    contestFraction: HILL_CAPTURE_SECONDS > 0 ? contest / HILL_CAPTURE_SECONDS : 0,
    inside: info.inside,
    distanceYards,
    minutesLeft: info.minutesLeft,
    callout: info.callout ?? null,
  };
}

/** The call to announce this frame: a fresh callout the bar has not shown
 *  yet (each id exactly once), else null. */
export function hillCalloutToShow(
  shownId: string | null,
  view: HillBarView,
): HillCalloutInfo | null {
  if (!view.visible || !view.callout || view.callout.id === shownId) return null;
  return view.callout;
}
