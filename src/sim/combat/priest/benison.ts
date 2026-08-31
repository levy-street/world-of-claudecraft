import {
  BENISON_4PC_MEND_DURATION_SEC,
  BENISON_4PC_MEND_PCT_MAX,
  BENISON_4PC_MEND_TICK_INTERVAL_SEC,
} from '../../content/ignivar_set_bonuses';
import type { PlayerMeta } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { wearsSetBonus } from '../set_bonus_wearer';
import { SERAPHIC_VIGIL_ID } from './presentation';
import { hasPriestTalent, PRIEST_TALENT_IDS } from './talents';

export { SERAPHIC_VIGIL_ID } from './presentation';
export const SERAPHIC_VIGIL_THRESHOLD = 0.35;

/** Benison Dawnweave 4pc: the fixed mend aura id. A retrigger inside the
 *  running mend replaces the undrained remainder (same-id refresh semantics,
 *  the Oathpyre 4pc posture, disclosed by the set doc). */
export const BENISON_4PC_MEND_AURA_ID = 'benison_dawnweave_mend';

/** Benison Dawnweave 4pc: when a Vigil triggers, its ally is also mended for
 *  15 percent of the ALLY'S max health over 10 sec (5 ticks, one every 2
 *  sec; the per-tick amount snapshots the ally's max health at the trigger).
 *  Hooked at the vigil-trigger POINT in damage.ts beside
 *  priestOnVigilTriggered, which stays talent-gated for Incarnate Spirit;
 *  this set arm gates on the wearer flag instead, so the two coexist (Twin
 *  Covenant's second Vigil charge mends its own ally the same way). The aura
 *  NAME deliberately reuses the localized 'Seraphic Vigil' ability string
 *  (the mend is the Vigil's payoff; a new aura name would need a full
 *  sim_i18n dictionary row across every locale). Draws no rng. */
export function benisonMendOnVigilTriggered(ctx: SimContext, priest: Entity, ally: Entity): void {
  if (!wearsSetBonus(ctx, priest, 'benison_dawnweave', 4)) return;
  const ticks = BENISON_4PC_MEND_DURATION_SEC / BENISON_4PC_MEND_TICK_INTERVAL_SEC;
  ctx.applyAura(ally, {
    id: BENISON_4PC_MEND_AURA_ID,
    name: 'Seraphic Vigil',
    kind: 'hot',
    remaining: BENISON_4PC_MEND_DURATION_SEC,
    duration: BENISON_4PC_MEND_DURATION_SEC,
    value: Math.max(1, Math.round((ally.maxHp * BENISON_4PC_MEND_PCT_MAX) / ticks)),
    tickInterval: BENISON_4PC_MEND_TICK_INTERVAL_SEC,
    tickTimer: BENISON_4PC_MEND_TICK_INTERVAL_SEC,
    sourceId: priest.id,
    school: 'holy',
  });
}

/** Remove this priest's Vigils except for the newly selected ally. */
export function stripOtherSeraphicVigils(
  ctx: SimContext,
  priestId: number,
  keepTargetId: number,
): void {
  for (const entity of ctx.entities.values()) {
    if (entity.id === keepTargetId) continue;
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (aura.id !== SERAPHIC_VIGIL_ID || aura.sourceId !== priestId) continue;
      entity.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    }
  }
}

/** Class-scoped post-cast hook. The generic heal_echo primitive owns triggering. */
export function benisonAfterAbility(
  ctx: SimContext,
  priest: Entity,
  meta: PlayerMeta,
  target: Entity | null,
  abilityId: string,
): void {
  if (
    meta.cls !== 'priest' ||
    meta.talents.spec !== 'holy' ||
    abilityId !== SERAPHIC_VIGIL_ID ||
    !target ||
    target.dead
  )
    return;

  if (!hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.twinCovenant)) {
    stripOtherSeraphicVigils(ctx, priest.id, target.id);
  } else {
    const others = [...ctx.entities.values()].filter(
      (entity) =>
        entity.id !== target.id &&
        entity.auras.some((aura) => aura.id === SERAPHIC_VIGIL_ID && aura.sourceId === priest.id),
    );
    if (others.length >= 2) {
      const remove = others[0];
      const index = remove.auras.findIndex(
        (aura) => aura.id === SERAPHIC_VIGIL_ID && aura.sourceId === priest.id,
      );
      if (index >= 0) {
        const aura = remove.auras[index];
        remove.auras.splice(index, 1);
        ctx.emit({ type: 'aura', targetId: remove.id, name: aura.name, gained: false });
      }
    }
  }
  const vigil = target.auras.find(
    (aura) => aura.id === SERAPHIC_VIGIL_ID && aura.sourceId === priest.id,
  );
  if (vigil) vigil.value2 = SERAPHIC_VIGIL_THRESHOLD;
}
