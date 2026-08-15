import { grantAbilityDevotion } from '../paladin_devotion';
import type { SimContext } from '../sim_context';
import { type AbilityDef, type AbilityEffect, DT, type Entity, type Vec3 } from '../types';
import { sweptLanding } from './heroic_leap';
import { VALKYRS_CALLING_FLIGHT_AURA_ID } from './paladin_valkyrs_calling_state';

export const VALKYRS_CALLING_ASCENT_DURATION = 0.5;
export const VALKYRS_CALLING_APPROACH_DURATION = 1;
export const VALKYRS_CALLING_DESCENT_DURATION = 0.5;
export const VALKYRS_CALLING_FLIGHT_DURATION =
  VALKYRS_CALLING_ASCENT_DURATION +
  VALKYRS_CALLING_APPROACH_DURATION +
  VALKYRS_CALLING_DESCENT_DURATION;

const VALKYRS_CALLING_ALTITUDE = 7;
const EXTERNAL_RELOCATION_EPSILON = 0.05;
const VALKYRS_CALLING_DEVOTION_GAIN = 1;

type ValkyrsCallingEffect = Extract<AbilityEffect, { type: 'valkyrsCalling' }>;

function smoothstep(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

function pointOnFlight(entity: Entity, elapsed: number): Vec3 {
  const flight = entity.valkyrsCalling;
  if (!flight) return { ...entity.pos };

  const cruiseY = Math.max(flight.from.y, flight.to.y) + VALKYRS_CALLING_ALTITUDE;
  if (elapsed <= VALKYRS_CALLING_ASCENT_DURATION) {
    const progress = smoothstep(elapsed / VALKYRS_CALLING_ASCENT_DURATION);
    return {
      x: flight.from.x,
      y: flight.from.y + (cruiseY - flight.from.y) * progress,
      z: flight.from.z,
    };
  }

  const approachElapsed = elapsed - VALKYRS_CALLING_ASCENT_DURATION;
  if (approachElapsed <= VALKYRS_CALLING_APPROACH_DURATION) {
    const progress = smoothstep(approachElapsed / VALKYRS_CALLING_APPROACH_DURATION);
    return {
      x: flight.from.x + (flight.to.x - flight.from.x) * progress,
      y: cruiseY + Math.sin(progress * Math.PI) * 0.75,
      z: flight.from.z + (flight.to.z - flight.from.z) * progress,
    };
  }

  const descentElapsed =
    elapsed - VALKYRS_CALLING_ASCENT_DURATION - VALKYRS_CALLING_APPROACH_DURATION;
  const progress = smoothstep(descentElapsed / VALKYRS_CALLING_DESCENT_DURATION);
  return {
    x: flight.to.x,
    y: cruiseY + (flight.to.y - cruiseY) * progress,
    z: flight.to.z,
  };
}

function wasExternallyRelocated(entity: Entity): boolean {
  const expected = pointOnFlight(entity, entity.valkyrsCalling?.elapsed ?? 0);
  return (
    Math.hypot(entity.pos.x - expected.x, entity.pos.y - expected.y, entity.pos.z - expected.z) >
    EXTERNAL_RELOCATION_EPSILON
  );
}

function clearFlightAura(ctx: SimContext, entity: Entity): void {
  const index = entity.auras.findIndex(
    (aura) => aura.id === VALKYRS_CALLING_FLIGHT_AURA_ID && aura.sourceId === entity.id,
  );
  if (index < 0) return;
  const [aura] = entity.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
}

export function armValkyrsCalling(
  ctx: SimContext,
  entity: Entity,
  target: Entity,
  effect: ValkyrsCallingEffect,
  ability: Pick<AbilityDef, 'id' | 'name' | 'school'>,
): void {
  const landing = sweptLanding(ctx, entity, target.pos);
  entity.chargeTargetId = null;
  entity.chargePath = [];
  entity.leap = null;
  entity.valkyrsCalling = {
    from: { ...entity.pos },
    to: landing,
    elapsed: 0,
    landingAoe: {
      min: effect.min,
      max: effect.max,
      radius: effect.radius,
      softCap: effect.softCap,
    },
    abilityName: ability.name,
    school: ability.school,
    ascended: effect.ascended === true,
  };
  entity.jumping = true;
  entity.vy = 0;
  ctx.applyAura(entity, {
    id: VALKYRS_CALLING_FLIGHT_AURA_ID,
    name: ability.name,
    kind: 'internal_cd',
    // Queued abilities resolve before aura ticking, so keep one authoritative tick of
    // headroom. Landing/cancellation still removes this marker explicitly.
    remaining: VALKYRS_CALLING_FLIGHT_DURATION + DT,
    duration: VALKYRS_CALLING_FLIGHT_DURATION + DT,
    value: 0,
    sourceId: entity.id,
    school: ability.school,
  });
  ctx.emit({
    type: 'spellfxAt',
    x: entity.pos.x,
    z: entity.pos.z,
    school: ability.school,
    fx: 'nova',
    radius: 3,
  });
}

export function advanceValkyrsCalling(ctx: SimContext, entity: Entity): boolean {
  const flight = entity.valkyrsCalling;
  if (!flight) return false;
  if (entity.dead || wasExternallyRelocated(entity)) {
    entity.valkyrsCalling = null;
    entity.jumping = false;
    clearFlightAura(ctx, entity);
    return false;
  }

  flight.elapsed = Math.min(VALKYRS_CALLING_FLIGHT_DURATION, flight.elapsed + DT);
  entity.pos = pointOnFlight(entity, flight.elapsed);
  entity.onGround = false;
  entity.jumping = true;
  entity.vy = 0;
  const facingX = flight.to.x - entity.pos.x;
  const facingZ = flight.to.z - entity.pos.z;
  if (Math.hypot(facingX, facingZ) > 1e-6) entity.facing = Math.atan2(facingX, facingZ);

  if (flight.elapsed < VALKYRS_CALLING_FLIGHT_DURATION) return true;

  entity.pos = { ...flight.to };
  entity.onGround = true;
  entity.jumping = false;
  entity.fallStartY = entity.pos.y;
  entity.valkyrsCalling = null;
  clearFlightAura(ctx, entity);

  ctx.emit({
    type: 'spellfxAt',
    x: entity.pos.x,
    z: entity.pos.z,
    school: flight.school,
    fx: 'nova',
    radius: flight.landingAoe.radius,
  });
  if (flight.ascended) {
    ctx.emit({
      type: 'spellfx',
      sourceId: entity.id,
      targetId: entity.id,
      school: 'holy',
      fx: 'paladinAscensionImpact',
      ability: 'valkyrs_calling',
      impact: 'area',
    });
  }

  const victims = ctx
    .hostilesInRadius(entity, entity.pos, flight.landingAoe.radius)
    .filter((target) => ctx.hasLineOfSight(entity, target));
  const capScale =
    victims.length > flight.landingAoe.softCap ? flight.landingAoe.softCap / victims.length : 1;
  let dealtEffectiveDamage = false;
  for (const target of victims) {
    const damage = Math.round(
      ctx.rng.range(flight.landingAoe.min, flight.landingAoe.max) * capScale,
    );
    const hpBefore = target.hp;
    ctx.dealDamage(
      entity,
      target,
      damage,
      false,
      flight.school,
      flight.abilityName,
      'hit',
      false,
      undefined,
      true,
      false,
      false,
      'valkyrs_calling',
      true,
    );
    if (target.hp < hpBefore) dealtEffectiveDamage = true;
  }
  if (dealtEffectiveDamage) grantAbilityDevotion(entity, VALKYRS_CALLING_DEVOTION_GAIN);
  return true;
}
