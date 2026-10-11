import {
  SHADOW_BOMB_RESIDUAL_DURATION,
  SHADOW_BOMB_RESIDUAL_FRACTION,
  SHADOW_BOMB_RESIDUAL_INTERVAL,
} from '../../content/priest_shadow_tuning';
import { zoneAt } from '../../data';
import type { GroundAoE } from '../../entity_roster';
import { claimedSlotOf } from '../../instances/instance_combat_hold';
import type { SimContext } from '../../sim_context';
import { CAST_COMPLETE_EPS, DT, type Entity, type Vec3 } from '../../types';
import { hasShadowTalent } from './shadow_talents';
import { spiritBombResidualBlocked } from './spirit_bomb_raid';
import { PRIEST_TALENT_IDS } from './talents';

function sourceClaim(ctx: SimContext, source: Entity): string | null {
  const slot = claimedSlotOf(ctx, source);
  return slot ? `${slot.dungeonId}:${slot.slot}:${slot.partyKey}:${slot.claimedAt ?? 0}` : null;
}

/** One fixed region per completed cast, including a resisted initial explosion. */
export function spawnSpiritBombResidual(
  ctx: SimContext,
  priest: Entity,
  center: Vec3,
  radius: number,
  noncriticalInput: number,
  threat: { flat?: number; mult?: number },
): void {
  if (!hasShadowTalent(ctx, priest, PRIEST_TALENT_IDS.incarnateSpirit)) return;
  const pulses = Math.round(SHADOW_BOMB_RESIDUAL_DURATION / SHADOW_BOMB_RESIDUAL_INTERVAL);
  const damage = (noncriticalInput * SHADOW_BOMB_RESIDUAL_FRACTION) / pulses;
  ctx.groundAoEs.push({
    sourceId: priest.id,
    pos: { ...center },
    radius,
    min: damage,
    max: damage,
    // The ground driver decrements before dispatch; keep the pulse at six seconds.
    remaining: SHADOW_BOMB_RESIDUAL_DURATION + DT,
    interval: SHADOW_BOMB_RESIDUAL_INTERVAL,
    tickTimer: SHADOW_BOMB_RESIDUAL_INTERVAL,
    school: 'shadow',
    ability: 'Tithe Bomb',
    abilityId: 'spirit_bomb',
    threat,
    spiritBombResidual: {
      sourceClaim: sourceClaim(ctx, priest),
      sourceOrigin: { ...priest.pos },
      sourceZoneId: zoneAt(priest.pos.x, priest.pos.z).id,
      pulses,
    },
  });
  ctx.emit({
    type: 'spellfxAt',
    x: center.x,
    z: center.z,
    school: 'shadow',
    fx: 'runeCircle',
    radius,
    duration: SHADOW_BOMB_RESIDUAL_DURATION,
    sourceId: priest.id,
    ability: 'spirit_bomb',
  });
}

export function clearSpiritBombResidual(ctx: SimContext, sourceId: number): void {
  for (let i = ctx.groundAoEs.length - 1; i >= 0; i--) {
    const zone = ctx.groundAoEs[i];
    if (zone.sourceId !== sourceId || !zone.spiritBombResidual) continue;
    // The active ground driver can hold this reference during nested damage.
    zone.remaining = 0;
    zone.spiritBombResidual.pulses = 0;
  }
}

/** Returns true when the marked region is finished or its owner is no longer eligible. */
export function tickSpiritBombResidual(ctx: SimContext, zone: GroundAoE): boolean {
  const state = zone.spiritBombResidual;
  if (!state) return false;
  const source = ctx.entities.get(zone.sourceId) ?? null;
  if (
    !source ||
    !hasShadowTalent(ctx, source, PRIEST_TALENT_IDS.incarnateSpirit) ||
    sourceClaim(ctx, source) !== state.sourceClaim ||
    zoneAt(source.pos.x, source.pos.z).id !== state.sourceZoneId ||
    (source.pos.x - state.sourceOrigin.x) ** 2 + (source.pos.z - state.sourceOrigin.z) ** 2 >
      300 ** 2
  )
    return true;
  zone.tickTimer -= DT;
  while (zone.tickTimer <= CAST_COMPLETE_EPS && state.pulses > 0 && zone.remaining > 0) {
    zone.tickTimer += zone.interval;
    state.pulses--;
    const targets = ctx
      .hostilesInRadius(source, zone.pos, zone.radius)
      .filter(
        (target) => ctx.hasLineOfSight(source, target) && !spiritBombResidualBlocked(ctx, target),
      );
    const capScale = targets.length > 5 ? 5 / targets.length : 1;
    for (const target of targets) {
      if (zone.remaining <= 0 || source.dead) break;
      ctx.dealDamage(
        source,
        target,
        Math.round(zone.min * capScale),
        false,
        'shadow',
        'Tithe Bomb',
        'hit',
        true,
        zone.threat,
        false,
        false,
        false,
        'spirit_bomb',
        true,
      );
    }
  }
  return state.pulses <= 0 || zone.remaining <= CAST_COMPLETE_EPS;
}
