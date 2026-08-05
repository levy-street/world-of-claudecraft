// Pure (IO-free) navigation logic for the farm bot: picking the next gather
// node to work (nearest ready node matching the configured zone/types/tier,
// skipping blacklisted ones), straight-line steering toward a target as an
// absolute facing plus a MoveInput fragment, and a deterministic stuck
// detector that escalates from a wiggle suggestion to a blacklist
// recommendation. There is no pathfinding on purpose: the world is mostly
// open, and a node that cannot be reached in a straight line gets blacklisted
// so the route moves on. Kept IO-free (time is a parameter, never read) so the
// whole module is unit-tested without a sim; the brain feeds it live positions
// each decision tick.

import {
  type GatherNodeDef,
  type GatherNodeType,
  INTERACT_RANGE,
  type MoveInput,
} from '../src/sim/types';

export interface NavPos {
  x: number;
  z: number;
}

// Squared horizontal distance; the hot comparisons (nearest node, arrive
// check) never need the real length, so the sqrt is skipped.
export function distance2(a: NavPos, b: NavPos): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return dx * dx + dz * dz;
}

export function distance(a: NavPos, b: NavPos): number {
  return Math.sqrt(distance2(a, b));
}

export interface PickNodeOptions {
  types: Set<GatherNodeType>;
  maxTier: number;
  zoneId: string;
  // Type preference order: candidates sort by (index in this list, then
  // distance). A type absent from the list sorts after every listed type.
  // Omitted means pure nearest-first.
  priority?: readonly GatherNodeType[];
  // Config-level node-id filters, independent of the runtime stuck/denial
  // blacklist: blacklistIds are never picked; a non-empty whitelistIds picks
  // only listed ids (empty or omitted means all ids allowed).
  blacklistIds?: ReadonlySet<string>;
  whitelistIds?: ReadonlySet<string>;
}

function priorityIndex(priority: readonly GatherNodeType[], type: GatherNodeType): number {
  const i = priority.indexOf(type);
  return i === -1 ? priority.length : i;
}

// All eligible nodes, sorted by (priority index, distance): the ordered
// candidate list pickNextNode picks from. Exposed for callers that want to
// choose among the top few themselves (the brain's human-jitter pick).
export function pickNextNodeCandidates(
  nodes: GatherNodeDef[],
  pos: NavPos,
  opts: PickNodeOptions,
  isReady: (nodeId: string) => boolean,
  blacklisted: (nodeId: string) => boolean,
): GatherNodeDef[] {
  const eligible: { node: GatherNodeDef; pri: number; d2: number }[] = [];
  for (const node of nodes) {
    if (node.zoneId !== opts.zoneId) continue;
    if (!opts.types.has(node.type)) continue;
    if (node.tier > opts.maxTier) continue;
    if (opts.blacklistIds?.has(node.id)) continue;
    if (opts.whitelistIds && opts.whitelistIds.size > 0 && !opts.whitelistIds.has(node.id))
      continue;
    if (blacklisted(node.id)) continue;
    if (!isReady(node.id)) continue;
    eligible.push({
      node,
      pri: opts.priority ? priorityIndex(opts.priority, node.type) : 0,
      d2: distance2(pos, node.pos),
    });
  }
  eligible.sort((a, b) => a.pri - b.pri || a.d2 - b.d2);
  return eligible.map((e) => e.node);
}

// Best node to work next: in the configured zone, of a wanted type, at or
// under the tier cap, allowed by the config id filters, ready to harvest per
// `isReady`, and not blacklisted. Among the candidates the winner sorts by
// (priority index, distance). Returns null when nothing qualifies (all nodes
// on cooldown or unreachable); the caller decides how to spend the wait
// (fish, idle, patrol).
export function pickNextNode(
  nodes: GatherNodeDef[],
  pos: NavPos,
  opts: PickNodeOptions,
  isReady: (nodeId: string) => boolean,
  blacklisted: (nodeId: string) => boolean,
): GatherNodeDef | null {
  return pickNextNodeCandidates(nodes, pos, opts, isReady, blacklisted)[0] ?? null;
}

export interface SteerResult {
  // Absolute facing toward the target, radians, following the sim convention
  // (src/sim/player_motion.ts): facing f points along (sin f, cos f) in (x, z),
  // so the angle toward a delta is atan2(dx, dz).
  facing: number;
  // Movement intent for the caller to merge into the input stream: forward is
  // held while traveling and released on arrival.
  input: Partial<MoveInput>;
  arrived: boolean;
}

// Steers from `pos` toward `target` in a straight line. `arrived` once within
// `arriveRange` (default INTERACT_RANGE, close enough to harvest/interact).
// The current `facing` is taken for signature symmetry with the caller's tick
// state; the steering itself is absolute and does not integrate the old value.
export function steerToward(
  pos: NavPos,
  facing: number,
  target: NavPos,
  arriveRange = INTERACT_RANGE,
): SteerResult {
  void facing;
  const desired = Math.atan2(target.x - pos.x, target.z - pos.z);
  const arrived = distance2(pos, target) <= arriveRange * arriveRange;
  return {
    facing: desired,
    input: { forward: !arrived },
    arrived,
  };
}

export type StuckEscalation = 'none' | 'wiggle' | 'blacklist';

export interface StuckResult {
  stuck: boolean;
  escalation: StuckEscalation;
  // Recovery maneuver when escalation is 'wiggle'. The brain applies this
  // input (and optional facing) instead of the steer-toward-target input for
  // the hold window so a reverse/side step is not immediately overwritten.
  input: Partial<MoveInput>;
  // Absolute facing override for the recovery step (radians). When set the
  // brain aims this way instead of toward the travel target.
  facing?: number;
  // Short label for logs ('back', 'strafe-left', 'reverse', ...).
  label?: string;
  // True only on the tick a new recovery maneuver begins (for one-shot logs).
  started?: boolean;
}

export interface StuckDetectorOptions {
  // How long displacement may stay under epsilon before stuck is reported.
  windowMs?: number;
  // Horizontal yards of displacement that count as progress while free.
  epsilon?: number;
  // Once snagged, this much displacement from the snag origin is required to
  // count as free. Micro-slides along a wall (0.5-2 yd) must not reset the
  // recovery streak or the bot wiggles forever without blacklisting.
  freeEpsilon?: number;
  // Consecutive failed recoveries before recommending a blacklist.
  blacklistAfter?: number;
  // How long each recovery maneuver is held before trying the next.
  recoveryMs?: number;
}

export interface StuckUpdateOptions {
  // Facing the bot was aiming while traveling (steerToward result). Recovery
  // maneuvers that reverse or side-step are built relative to this.
  travelFacing?: number;
  // Optional [0,1) source. When set, maneuvers are chosen randomly among the
  // catalog instead of cycling deterministically by attempt index.
  rng?: () => number;
}

const DEFAULT_WINDOW_MS = 4000;
const DEFAULT_EPSILON = 0.5;
// Real "got free" distance once a snag is declared (see freeEpsilon above).
const DEFAULT_FREE_EPSILON = 3;
// Enough attempts to cycle back / sides / reverse before giving up on the target.
const DEFAULT_BLACKLIST_AFTER = 6;
const DEFAULT_RECOVERY_MS = 1800;

export interface StuckManeuver {
  input: Partial<MoveInput>;
  facing?: number;
  label: string;
}

// Catalog of unstick experiments relative to the intended travel facing.
// Pure so tests can pin the cycle without standing up the detector.
export function pickStuckManeuver(
  attempt: number,
  travelFacing: number,
  rng?: () => number,
): StuckManeuver {
  const catalog: StuckManeuver[] = [
    { label: 'back', input: { forward: false, back: true, jump: true } },
    {
      label: 'back-left',
      input: { forward: false, back: true, strafeLeft: true, jump: true },
    },
    {
      label: 'back-right',
      input: { forward: false, back: true, strafeRight: true, jump: true },
    },
    {
      label: 'strafe-left',
      input: { forward: true, strafeLeft: true, jump: true },
    },
    {
      label: 'strafe-right',
      input: { forward: true, strafeRight: true, jump: true },
    },
    {
      label: 'reverse',
      input: { forward: true, jump: true },
      facing: travelFacing + Math.PI,
    },
    {
      label: 'side-left',
      input: { forward: true, jump: true },
      facing: travelFacing + Math.PI / 2,
    },
    {
      label: 'side-right',
      input: { forward: true, jump: true },
      facing: travelFacing - Math.PI / 2,
    },
    {
      label: 'back-diagonal',
      input: { forward: false, back: true, strafeLeft: true, jump: true },
      facing: travelFacing + (Math.PI * 3) / 4,
    },
  ];
  if (rng) {
    const i = Math.min(catalog.length - 1, Math.floor(rng() * catalog.length));
    return catalog[i]!;
  }
  // attempt is 1-based (first recovery = 1).
  const idx = Math.max(0, attempt - 1) % catalog.length;
  return catalog[idx]!;
}

// Feed (pos, nowMs) each decision tick while traveling toward a target. If
// the horizontal displacement over a rolling window stays under epsilon, the
// bot is presumed snagged: recovery holds a back/side/reverse maneuver for
// recoveryMs, then tries another (deterministic cycle, or random when rng is
// given). After `blacklistAfter` failed recoveries the detector recommends
// blacklisting the current target. Call reset() whenever the target changes,
// and do not feed it while intentionally stationary (harvesting, fishing,
// fighting): stillness is only meaningful while traveling.
export class StuckDetector {
  private readonly windowMs: number;
  private readonly epsilon: number;
  private readonly freeEpsilon: number;
  private readonly blacklistAfter: number;
  private readonly recoveryMs: number;
  private anchor: NavPos | null = null;
  private anchorMs = 0;
  // Position where the snag was declared; freeEpsilon is measured from here.
  private snagOrigin: NavPos | null = null;
  // When the quiet window first expired (null while free / not yet stuck).
  private stuckSinceMs: number | null = null;
  // Cached maneuver for the current attempt so rng does not re-roll every tick.
  private activeAttempt = 0;
  private active: StuckManeuver | null = null;

  constructor(opts: StuckDetectorOptions = {}) {
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.epsilon = opts.epsilon ?? DEFAULT_EPSILON;
    this.freeEpsilon = opts.freeEpsilon ?? DEFAULT_FREE_EPSILON;
    this.blacklistAfter = opts.blacklistAfter ?? DEFAULT_BLACKLIST_AFTER;
    this.recoveryMs = opts.recoveryMs ?? DEFAULT_RECOVERY_MS;
  }

  reset(): void {
    this.anchor = null;
    this.anchorMs = 0;
    this.snagOrigin = null;
    this.stuckSinceMs = null;
    this.activeAttempt = 0;
    this.active = null;
  }

  update(pos: NavPos, nowMs: number, opts: StuckUpdateOptions = {}): StuckResult {
    const travelFacing = opts.travelFacing ?? 0;

    if (this.anchor === null) {
      this.anchor = { x: pos.x, z: pos.z };
      this.anchorMs = nowMs;
      return { stuck: false, escalation: 'none', input: {} };
    }

    // Already snagged: only real escape clears the streak. Sliding 1 yd along
    // a wall must not restart attempt 1 forever (the live wiggle-spam bug).
    if (this.stuckSinceMs !== null && this.snagOrigin) {
      if (distance2(pos, this.snagOrigin) >= this.freeEpsilon * this.freeEpsilon) {
        this.anchor = { x: pos.x, z: pos.z };
        this.anchorMs = nowMs;
        this.snagOrigin = null;
        this.stuckSinceMs = null;
        this.activeAttempt = 0;
        this.active = null;
        return { stuck: false, escalation: 'none', input: {} };
      }
    } else if (distance2(pos, this.anchor) >= this.epsilon * this.epsilon) {
      // Free travel: normal progress re-anchors the quiet window.
      this.anchor = { x: pos.x, z: pos.z };
      this.anchorMs = nowMs;
      return { stuck: false, escalation: 'none', input: {} };
    }

    if (this.stuckSinceMs === null) {
      if (nowMs - this.anchorMs < this.windowMs) {
        return { stuck: false, escalation: 'none', input: {} };
      }
      // Quiet window expired: declare the snag here.
      this.stuckSinceMs = this.anchorMs + this.windowMs;
      this.snagOrigin = { x: pos.x, z: pos.z };
    }

    const elapsed = Math.max(0, nowMs - this.stuckSinceMs);
    const attempt = Math.floor(elapsed / this.recoveryMs) + 1;

    if (attempt >= this.blacklistAfter) {
      this.active = null;
      this.activeAttempt = 0;
      return { stuck: true, escalation: 'blacklist', input: {} };
    }

    const started = attempt !== this.activeAttempt || this.active === null;
    if (started) {
      this.active = pickStuckManeuver(attempt, travelFacing, opts.rng);
      this.activeAttempt = attempt;
    }
    const maneuver = this.active!;
    return {
      stuck: true,
      escalation: 'wiggle',
      input: maneuver.input,
      facing: maneuver.facing,
      label: maneuver.label,
      started,
    };
  }
}
