import type { HarborDeck } from '../sim/harbor_layout';
import type { SceneAttachFrame } from '../sim/types';

const SUPPORT_HEIGHT_EPSILON = 0.25;
const POSE_EPSILON = 0.0001;

export interface HarborDeckRiderShip {
  readonly target: string;
  readonly baseX: number;
  readonly baseY: number;
  readonly baseZ: number;
  readonly baseRot: number;
  readonly frame: SceneAttachFrame;
  readonly shipDecks: readonly HarborDeck[];
  readonly displaced: boolean;
}

export interface HarborDeckRiderCandidate {
  readonly entityId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly midInteraction: boolean;
}

export interface HarborDeckRiderResolution {
  entityId: number;
  target: string;
  mode: 'none' | 'ride' | 'hide';
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface HarborDeckRiderPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface HarborDeckRiderInteraction {
  readonly targetId: number | null;
  readonly castingAbility: unknown | null;
  readonly inCombat: boolean;
}

export function harborDeckRiderMidInteraction(entity: HarborDeckRiderInteraction): boolean {
  return entity.targetId !== null || entity.castingAbility !== null || entity.inCombat;
}

function supportedByDeck(candidate: HarborDeckRiderCandidate, deck: HarborDeck): boolean {
  return (
    Math.abs(candidate.x - deck.x) <= deck.hw &&
    Math.abs(candidate.z - deck.z) <= deck.hd &&
    Math.abs(candidate.y - deck.y) <= SUPPORT_HEIGHT_EPSILON
  );
}

function setUnchanged(
  candidate: HarborDeckRiderCandidate,
  out: HarborDeckRiderResolution,
): HarborDeckRiderResolution {
  out.entityId = candidate.entityId;
  out.target = '';
  out.mode = 'none';
  out.x = candidate.x;
  out.y = candidate.y;
  out.z = candidate.z;
  out.yaw = candidate.yaw;
  return out;
}

export function resolveHarborDeckRider(
  candidate: HarborDeckRiderCandidate,
  ships: Iterable<HarborDeckRiderShip>,
  out: HarborDeckRiderResolution,
): HarborDeckRiderResolution {
  setUnchanged(candidate, out);
  for (const ship of ships) {
    if (!ship.displaced) continue;
    let supported = false;
    for (const deck of ship.shipDecks) {
      if (supportedByDeck(candidate, deck)) {
        supported = true;
        break;
      }
    }
    if (!supported) continue;

    const baseCos = Math.cos(ship.baseRot);
    const baseSin = Math.sin(ship.baseRot);
    const dx = candidate.x - ship.baseX;
    const dz = candidate.z - ship.baseZ;
    const localX = dx * baseCos - dz * baseSin;
    const localZ = dx * baseSin + dz * baseCos;
    const liveCos = Math.cos(ship.frame.yaw);
    const liveSin = Math.sin(ship.frame.yaw);

    out.target = ship.target;
    out.mode = candidate.midInteraction ? 'hide' : 'ride';
    out.x = ship.frame.position.x + localX * liveCos + localZ * liveSin;
    out.y = ship.frame.position.y + candidate.y - ship.baseY;
    out.z = ship.frame.position.z - localX * liveSin + localZ * liveCos;
    out.yaw = candidate.yaw + ship.frame.yaw - ship.baseRot;
    return out;
  }
  return out;
}

export function deckRiderPoseMatches(
  expected: HarborDeckRiderResolution,
  actual: HarborDeckRiderPose,
  epsilon = POSE_EPSILON,
): boolean {
  return (
    Math.abs(expected.x - actual.x) <= epsilon &&
    Math.abs(expected.y - actual.y) <= epsilon &&
    Math.abs(expected.z - actual.z) <= epsilon &&
    Math.abs(expected.yaw - actual.yaw) <= epsilon
  );
}

export function missingDeckRiderWarning(
  expected: HarborDeckRiderResolution,
  actual: HarborDeckRiderPose,
): string | null {
  if (expected.mode !== 'ride' || deckRiderPoseMatches(expected, actual)) return null;
  return `Entity ${expected.entityId} is supported by displaced ship ${expected.target} without riding it.`;
}
