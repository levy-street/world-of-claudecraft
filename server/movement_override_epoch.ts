import type { PlayerMeta, Sim } from '../src/sim/sim';
import { DT, type Entity, RUN_SPEED, type Vec3 } from '../src/sim/types';

const OVERRIDE_CC_KINDS = new Set(['stun', 'root', 'incapacitate', 'polymorph']);
const POSITION_EPSILON = 1e-9;

export interface MovementOverrideSignature {
  crowdControlled: boolean;
  charging: boolean;
  following: boolean;
  heroicLeaping: boolean;
  valkyrsCalling: boolean;
  mountRaceLocked: boolean;
  climbing: boolean;
  moveSpeedMult: number;
}

export interface MovementOverrideSessionState {
  pid: number;
  movementWireVersion: 1 | 2;
  movementOverrideSignature: MovementOverrideSignature | null;
  movementOverrideEpoch: number;
  movementOverrideActive: boolean;
  movementMoveSpeedMult: number;
  movementAuthoritativePosition: Vec3 | null;
}

export function createMovementOverrideSessionState(): Pick<
  MovementOverrideSessionState,
  | 'movementOverrideSignature'
  | 'movementOverrideEpoch'
  | 'movementOverrideActive'
  | 'movementMoveSpeedMult'
  | 'movementAuthoritativePosition'
> {
  return {
    movementOverrideSignature: null,
    movementOverrideEpoch: 0,
    movementOverrideActive: false,
    movementMoveSpeedMult: 1,
    movementAuthoritativePosition: null,
  };
}

export function computeOverrideSignature(
  entity: Entity,
  meta: Pick<PlayerMeta, 'mountRace'>,
  moveSpeedMult: number,
): MovementOverrideSignature {
  return fillOverrideSignature(
    {
      crowdControlled: false,
      charging: false,
      following: false,
      heroicLeaping: false,
      valkyrsCalling: false,
      mountRaceLocked: false,
      climbing: false,
      moveSpeedMult: 1,
    },
    entity,
    meta,
    moveSpeedMult,
  );
}

export function fillOverrideSignature(
  target: MovementOverrideSignature,
  entity: Entity,
  meta: Pick<PlayerMeta, 'mountRace'>,
  moveSpeedMult: number,
): MovementOverrideSignature {
  // Fear uses kind incapacitate, so it rides the crowd-control arm.
  target.crowdControlled = entity.auras.some((aura) => OVERRIDE_CC_KINDS.has(aura.kind));
  target.charging = entity.chargeTargetId !== null;
  target.following = entity.followTargetId !== null;
  target.heroicLeaping = entity.leap != null;
  target.valkyrsCalling = entity.valkyrsCalling != null;
  target.mountRaceLocked = meta.mountRace?.phase === 'countdown';
  target.climbing = entity.climb != null;
  target.moveSpeedMult = moveSpeedMult;
  return target;
}

function overrideBits(signature: MovementOverrideSignature): number {
  return (
    (signature.crowdControlled ? 1 : 0) |
    (signature.charging ? 2 : 0) |
    (signature.following ? 4 : 0) |
    (signature.heroicLeaping ? 8 : 0) |
    (signature.valkyrsCalling ? 16 : 0) |
    (signature.mountRaceLocked ? 32 : 0) |
    (signature.climbing ? 64 : 0)
  );
}

export function overrideActive(signature: MovementOverrideSignature): boolean {
  return overrideBits(signature) !== 0;
}

function positionDiscontinuous(
  entity: Entity,
  previousPosition: Vec3,
  active: boolean,
  moveSpeedMult: number,
  previousActive: boolean,
  previousMoveSpeedMult: number,
): boolean {
  const dx = entity.pos.x - previousPosition.x;
  const dy = entity.pos.y - previousPosition.y;
  const dz = entity.pos.z - previousPosition.z;
  const movedSq = dx * dx + dy * dy + dz * dz;
  if (movedSq <= POSITION_EPSILON) return false;
  if (
    entity.pos.x === entity.prevPos.x &&
    entity.pos.y === entity.prevPos.y &&
    entity.pos.z === entity.prevPos.z
  ) {
    return true;
  }
  if (active || previousActive) {
    return false;
  }
  const maxIntentStep = RUN_SPEED * Math.max(moveSpeedMult, previousMoveSpeedMult) * DT;
  return Math.hypot(dx, dz) > maxIntentStep + POSITION_EPSILON;
}

export function updateMovementOverrideEpochs(
  sim: Pick<Sim, 'entities' | 'meta' | 'moveSpeedMult'>,
  sessions: Iterable<MovementOverrideSessionState>,
): void {
  for (const session of sessions) {
    if (session.movementWireVersion !== 2) continue;
    const entity = sim.entities.get(session.pid);
    const meta = sim.meta(session.pid);
    if (!entity || !meta) continue;
    const moveSpeedMult = sim.moveSpeedMult(entity);
    const signature = session.movementOverrideSignature;
    const previousBits = signature ? overrideBits(signature) : 0;
    const previousActive = previousBits !== 0;
    const previousMoveSpeedMult = signature?.moveSpeedMult ?? 0;
    const nextSignature = signature
      ? fillOverrideSignature(signature, entity, meta, moveSpeedMult)
      : computeOverrideSignature(entity, meta, moveSpeedMult);
    const active = overrideActive(nextSignature);
    const signatureChanged =
      signature !== null &&
      (previousBits !== overrideBits(nextSignature) || previousMoveSpeedMult !== moveSpeedMult);
    const discontinuous =
      session.movementAuthoritativePosition !== null &&
      positionDiscontinuous(
        entity,
        session.movementAuthoritativePosition,
        active,
        moveSpeedMult,
        previousActive,
        previousMoveSpeedMult,
      );
    if (signatureChanged || discontinuous) session.movementOverrideEpoch++;
    session.movementOverrideSignature = nextSignature;
    session.movementOverrideActive = active;
    session.movementMoveSpeedMult = moveSpeedMult;
    if (session.movementAuthoritativePosition) {
      session.movementAuthoritativePosition.x = entity.pos.x;
      session.movementAuthoritativePosition.y = entity.pos.y;
      session.movementAuthoritativePosition.z = entity.pos.z;
    } else {
      session.movementAuthoritativePosition = { ...entity.pos };
    }
  }
}
