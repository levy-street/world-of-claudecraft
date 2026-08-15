import { resolvePosition, seatGroundedAt } from '../colliders';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../pathfind';
import type { SimContext } from '../sim_context';
import { type AbilityDef, DT, type Entity, type Vec3 } from '../types';
import { groundHeight, terrainSteepnessAt, waterLevelAt } from '../world';
import { hasUnbreakableMovementLock } from './cc';

const SWEEP_STEP = 0.5;
const FLIGHT_DURATION = 0.6;
const FLIGHT_APEX = 3.2;
const EXTERNAL_RELOCATION_EPSILON = 0.05;

function pointOnFlight(entity: Entity, elapsed: number): Vec3 {
  const flight = entity.leap;
  if (!flight) return { ...entity.pos };
  const progress = Math.min(1, elapsed / flight.duration);
  const groundY = flight.from.y + (flight.to.y - flight.from.y) * progress;
  return {
    x: flight.from.x + (flight.to.x - flight.from.x) * progress,
    y: groundY + flight.apex * 4 * progress * (1 - progress),
    z: flight.from.z + (flight.to.z - flight.from.z) * progress,
  };
}

function wasExternallyRelocated(entity: Entity): boolean {
  const expected = pointOnFlight(entity, entity.leap?.elapsed ?? 0);
  return (
    Math.hypot(entity.pos.x - expected.x, entity.pos.y - expected.y, entity.pos.z - expected.z) >
    EXTERNAL_RELOCATION_EPSILON
  );
}

export function sweptLanding(ctx: SimContext, entity: Entity, aim: Vec3): Vec3 {
  const fromFeetY = entity.pos.y;
  const fromX = entity.pos.x;
  const fromZ = entity.pos.z;
  const dx = aim.x - fromX;
  const dz = aim.z - fromZ;
  const distance = Math.hypot(dx, dz);
  let safeX = fromX;
  let safeZ = fromZ;
  let previousGround = groundHeight(fromX, fromZ, ctx.cfg.seed);

  if (distance > 1e-6) {
    const steps = Math.max(1, Math.ceil(distance / SWEEP_STEP));
    for (let index = 1; index <= steps; index++) {
      const progress = index / steps;
      const nextX = fromX + dx * progress;
      const nextZ = fromZ + dz * progress;
      const step = Math.hypot(nextX - safeX, nextZ - safeZ);
      const nextGround = groundHeight(nextX, nextZ, ctx.cfg.seed);
      if (nextGround < waterLevelAt(nextX, nextZ, ctx.cfg.seed) - PLAYER_SWIM_DEPTH) break;
      if (
        nextGround > previousGround &&
        step > 1e-6 &&
        ((nextGround - previousGround) / step > PLAYER_MAX_CLIMB_SLOPE ||
          terrainSteepnessAt(nextX, nextZ, ctx.cfg.seed) > PLAYER_MAX_CLIMB_SLOPE)
      ) {
        break;
      }

      const resolved = ctx.resolveMovePoint(nextX, nextZ, PLAYER_BODY_RADIUS, entity);
      const moved = Math.hypot(resolved.x - safeX, resolved.z - safeZ);
      const diverted =
        Math.hypot(resolved.x - nextX, resolved.z - nextZ) > PLAYER_BODY_RADIUS * 0.25;
      if (diverted || moved < step * 0.5) {
        // The grounded resolve treats every prop as a wall, but the flight
        // arc rises FLIGHT_APEX above the takeoff line: anything with a
        // movement top under that crest (a stall canopy, a crate stack) is
        // flown OVER, not hit. Re-resolve the point at crest height; if it
        // comes back clean the sweep continues across the prop and the seat
        // below lands the body on its top. A genuine full-height blocker
        // still diverts the crest resolve and ends the sweep at its face.
        const crest = fromFeetY + FLIGHT_APEX;
        const over = resolvePosition(
          ctx.cfg.seed,
          nextX,
          nextZ,
          PLAYER_BODY_RADIUS,
          false,
          undefined,
          { y: crest, lift: 0 },
          ctx.riftCollisionToken,
        );
        if (Math.hypot(over.x - nextX, over.z - nextZ) > PLAYER_BODY_RADIUS * 0.25) break;
        safeX = nextX;
        safeZ = nextZ;
        previousGround = groundHeight(safeX, safeZ, ctx.cfg.seed);
        continue;
      }

      safeX = resolved.x;
      safeZ = resolved.z;
      previousGround = groundHeight(safeX, safeZ, ctx.cfg.seed);
    }
  }

  // Support-aware seat: the sweep above passes over props under the arc's
  // crest, so the end point may sit on a standable top (land ON it, at its
  // sampled sloped height) or inside a passed-over footprint (nudge clear)
  // instead of embedding at terrain. The crest is the honest feet height for
  // the gate: the body descends from there onto whatever is below.
  const seat = seatGroundedAt(
    ctx.cfg.seed,
    safeX,
    safeZ,
    PLAYER_BODY_RADIUS,
    fromFeetY + FLIGHT_APEX,
  );
  return { x: seat.x, y: seat.y, z: seat.z };
}

/** Instant relocation through the same collision/terrain sweep as Heroic Leap. */
export function relocateSwept(ctx: SimContext, entity: Entity, aim: Vec3): void {
  const landing = sweptLanding(ctx, entity, aim);
  entity.pos = landing;
  entity.vy = 0;
  entity.onGround = true;
  entity.fallStartY = landing.y;
  entity.chargeTargetId = null;
  entity.chargePath = [];
}

export function armHeroicLeap(
  ctx: SimContext,
  entity: Entity,
  aim: Vec3,
  landingAoe: { min: number; max: number; radius: number },
  ability: Pick<AbilityDef, 'id' | 'name' | 'school'>,
): void {
  if (hasUnbreakableMovementLock(entity)) return;
  const landing = sweptLanding(ctx, entity, aim);
  entity.chargeTargetId = null;
  entity.chargePath = [];
  entity.leap = {
    from: { ...entity.pos },
    to: landing,
    elapsed: 0,
    duration: FLIGHT_DURATION,
    apex: FLIGHT_APEX,
    landingAoe: { ...landingAoe },
    abilityName: ability.name,
    abilityId: ability.id,
    school: ability.school,
  };
}

export function advanceHeroicLeap(ctx: SimContext, entity: Entity): boolean {
  const flight = entity.leap;
  if (!flight) return false;
  if (entity.dead || hasUnbreakableMovementLock(entity) || wasExternallyRelocated(entity)) {
    entity.leap = null;
    return false;
  }

  flight.elapsed += DT;
  entity.pos = pointOnFlight(entity, flight.elapsed);
  entity.onGround = false;
  entity.vy = 0;

  if (flight.elapsed < flight.duration) return true;

  entity.pos = { ...flight.to };
  entity.onGround = true;
  entity.jumping = false;
  entity.fallStartY = entity.pos.y;
  entity.leap = null;
  ctx.emit({
    type: 'spellfxAt',
    x: entity.pos.x,
    z: entity.pos.z,
    school: flight.school,
    fx: 'nova',
    radius: flight.landingAoe.radius,
    ability: flight.abilityId,
  });
  for (const target of ctx.hostilesInRadius(entity, entity.pos, flight.landingAoe.radius)) {
    if (!ctx.hasLineOfSight(entity, target)) continue;
    const damage = Math.round(ctx.rng.range(flight.landingAoe.min, flight.landingAoe.max));
    ctx.dealDamage(entity, target, damage, false, flight.school, flight.abilityName, 'hit');
  }
  return true;
}
