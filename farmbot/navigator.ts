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
  // Wiggle suggestion when escalation is 'wiggle': keep moving, hop, and
  // strafe. The strafe side alternates per consecutive stuck event (tracked
  // internally) so repeated wiggles do not grind the same wall edge.
  input: Partial<MoveInput>;
}

export interface StuckDetectorOptions {
  // How long displacement may stay under epsilon before stuck is reported.
  windowMs?: number;
  // Horizontal yards of displacement that count as progress.
  epsilon?: number;
  // Consecutive stuck events before recommending a blacklist.
  blacklistAfter?: number;
}

const DEFAULT_WINDOW_MS = 4000;
const DEFAULT_EPSILON = 0.5;
const DEFAULT_BLACKLIST_AFTER = 2;

// Feed (pos, nowMs) each decision tick while traveling toward a target. If
// the horizontal displacement over a rolling window stays under epsilon, the
// bot is presumed snagged: the first report suggests a wiggle, and after
// `blacklistAfter` consecutive reports with no progress the detector
// recommends blacklisting the current target. Call reset() whenever the
// target changes, and do not feed it while intentionally stationary
// (harvesting, fishing, fighting): stillness is only meaningful while
// traveling.
export class StuckDetector {
  private readonly windowMs: number;
  private readonly epsilon: number;
  private readonly blacklistAfter: number;
  private anchor: NavPos | null = null;
  private anchorMs = 0;
  private stuckCount = 0;

  constructor(opts: StuckDetectorOptions = {}) {
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.epsilon = opts.epsilon ?? DEFAULT_EPSILON;
    this.blacklistAfter = opts.blacklistAfter ?? DEFAULT_BLACKLIST_AFTER;
  }

  reset(): void {
    this.anchor = null;
    this.stuckCount = 0;
  }

  update(pos: NavPos, nowMs: number): StuckResult {
    if (this.anchor === null) {
      this.anchor = { x: pos.x, z: pos.z };
      this.anchorMs = nowMs;
      return { stuck: false, escalation: 'none', input: {} };
    }
    if (distance2(pos, this.anchor) >= this.epsilon * this.epsilon) {
      // Progress: re-anchor the window and clear the escalation streak.
      this.anchor = { x: pos.x, z: pos.z };
      this.anchorMs = nowMs;
      this.stuckCount = 0;
      return { stuck: false, escalation: 'none', input: {} };
    }
    if (nowMs - this.anchorMs < this.windowMs) {
      return { stuck: false, escalation: 'none', input: {} };
    }
    // Stuck. Re-anchor so the next window measures whether the wiggle worked.
    this.stuckCount += 1;
    this.anchor = { x: pos.x, z: pos.z };
    this.anchorMs = nowMs;
    if (this.stuckCount >= this.blacklistAfter) {
      return { stuck: true, escalation: 'blacklist', input: {} };
    }
    return {
      stuck: true,
      escalation: 'wiggle',
      input: {
        forward: true,
        jump: true,
        strafeLeft: this.stuckCount % 2 === 1,
        strafeRight: this.stuckCount % 2 === 0,
      },
    };
  }
}
