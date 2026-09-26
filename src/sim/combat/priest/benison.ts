import type { PlayerMeta } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { SERAPHIC_VIGIL_ID } from './presentation';
import { hasPriestTalent, PRIEST_TALENT_IDS } from './talents';

export { SERAPHIC_VIGIL_ID } from './presentation';
export const SERAPHIC_VIGIL_THRESHOLD = 0.35;

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
