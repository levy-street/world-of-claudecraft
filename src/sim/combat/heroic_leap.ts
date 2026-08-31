import { MANTLE_REACH, resolvePosition, seatGroundedAt } from '../colliders';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../pathfind';
import type { SimContext } from '../sim_context';
import { type AbilityDef, DT, type Entity, type Vec3 } from '../types';
import { groundHeight, terrainSteepnessAt, waterLevelAt } from '../world';
import { hasUnbreakableMovementLock } from './cc';

const SWEEP_STEP = 0.5;
const FLIGHT_DURATION = 0.6;
const FLIGHT_APEX = 3.2;
const EXTERNAL_RELOCATION_EPSILON = 0.05;

/** The one sweep body both the live cast and the preview run: steps toward the
 * aim, refusing deep water and unclimbable rises, resolving each step through
 * the caller's collision resolvers (grounded, then at the flight crest for
 * props the arc clears), and seating the end point on whatever stands there. */
function sweepLeapLanding(
  seed: number,
  fromX: number,
  fromZ: number,
  fromFeetY: number,
  to: { x: number; z: number },
  resolveGrounded: (x: number, z: number) => { x: number; z: number },
  resolveAtCrest: (x: number, z: number) => { x: number; z: number },
): { x: number; y: number; z: number } {
  const dx = to.x - fromX;
  const dz = to.z - fromZ;
  const distance = Math.hypot(dx, dz);
  let safeX = fromX;
  let safeZ = fromZ;
  let previousGround = groundHeight(fromX, fromZ, seed);

  if (distance > 1e-6) {
    const steps = Math.max(1, Math.ceil(distance / SWEEP_STEP));
    for (let index = 1; index <= steps; index++) {
      const progress = index / steps;
      const nextX = fromX + dx * progress;
      const nextZ = fromZ + dz * progress;
      const step = Math.hypot(nextX - safeX, nextZ - safeZ);
      const nextGround = groundHeight(nextX, nextZ, seed);
      if (nextGround < waterLevelAt(nextX, nextZ, seed) - PLAYER_SWIM_DEPTH) break;
      if (
        nextGround > previousGround &&
        step > 1e-6 &&
        ((nextGround - previousGround) / step > PLAYER_MAX_CLIMB_SLOPE ||
          terrainSteepnessAt(nextX, nextZ, seed) > PLAYER_MAX_CLIMB_SLOPE)
      ) {
        break;
      }

      const resolved = resolveGrounded(nextX, nextZ);
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
        const over = resolveAtCrest(nextX, nextZ);
        if (Math.hypot(over.x - nextX, over.z - nextZ) > PLAYER_BODY_RADIUS * 0.25) break;
        safeX = nextX;
        safeZ = nextZ;
        previousGround = groundHeight(safeX, safeZ, seed);
        continue;
      }

      safeX = resolved.x;
      safeZ = resolved.z;
      previousGround = groundHeight(safeX, safeZ, seed);
    }
  }

  // Support-aware seat: the sweep above passes over props under the arc's
  // crest, so the end point may sit on a standable top (land ON it, at its
  // sampled sloped height) or inside a passed-over footprint (nudge clear)
  // instead of embedding at terrain. The crest is the honest feet height for
  // the gate: the body descends from there onto whatever is below.
  const seat = seatGroundedAt(seed, safeX, safeZ, PLAYER_BODY_RADIUS, fromFeetY + FLIGHT_APEX);
  return { x: seat.x, y: seat.y, z: seat.z };
}

/**
 * Preview arm over the shared sweep: the caller's REAL feet height and
 * airborne state feed the same mover-height rule the live resolver applies
 * (colliders moverHeightFor: lift MANTLE_REACH while airborne). Still
 * seed-derived only: live delve modules, doors, and rift walls are per-Sim
 * state a preview cannot see, so those arms can diverge from the cast.
 */
export function computeHeroicLeapLanding(
  seed: number,
  from: { x: number; y: number; z: number; onGround: boolean },
  to: { x: number; z: number },
): { x: number; z: number } {
  const lift = from.onGround ? 0 : MANTLE_REACH;
  const landing = sweepLeapLanding(
    seed,
    from.x,
    from.z,
    from.y,
    to,
    (x, z) =>
      resolvePosition(seed, x, z, PLAYER_BODY_RADIUS, false, undefined, { y: from.y, lift }),
    (x, z) =>
      resolvePosition(seed, x, z, PLAYER_BODY_RADIUS, false, undefined, {
        y: from.y + FLIGHT_APEX,
        lift: 0,
      }),
  );
  return { x: landing.x, z: landing.z };
}

/** The IWorld placement-preview gate both hosts delegate to: leap gets the
 *  mirrored landing, every other ability keeps its own point. */
export function heroicLeapPlacementPreview(
  seed: number,
  caster: { pos: { x: number; y: number; z: number }; onGround: boolean },
  abilityId: string,
  point: { x: number; z: number },
): { x: number; z: number } {
  if (abilityId !== 'heroic_leap') return point;
  return computeHeroicLeapLanding(
    seed,
    { x: caster.pos.x, y: caster.pos.y, z: caster.pos.z, onGround: caster.onGround },
    point,
  );
}

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
  return sweepLeapLanding(
    ctx.cfg.seed,
    entity.pos.x,
    entity.pos.z,
    entity.pos.y,
    aim,
    (x, z) => ctx.resolveMovePoint(x, z, PLAYER_BODY_RADIUS, entity),
    (x, z) =>
      resolvePosition(
        ctx.cfg.seed,
        x,
        z,
        PLAYER_BODY_RADIUS,
        false,
        undefined,
        { y: entity.pos.y + FLIGHT_APEX, lift: 0 },
        ctx.riftCollisionToken,
      ),
  );
}

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
