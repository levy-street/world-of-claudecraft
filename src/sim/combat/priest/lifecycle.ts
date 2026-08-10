import type { SimContext } from '../../sim_context';
import { stripOtherSeraphicVigils } from './benison';
import { stripDoctrineLinks } from './doctrine';
import { cleanupVespers } from './vespers';

function stripPriestTalentAuras(ctx: SimContext, priestId: number): void {
  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (aura.sourceId !== priestId || !aura.id.startsWith('priest_')) continue;
      ctx.applyNonPlayerStatAura(entity, aura, -1);
      entity.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    }
  }
}

/** Clears only source-owned Priest transient state. Safe to call repeatedly. */
export function cleanupPriestState(ctx: SimContext, priestId: number): void {
  if (ctx.players.get(priestId)?.cls !== 'priest') return;
  stripPriestTalentAuras(ctx, priestId);
  stripDoctrineLinks(ctx, priestId);
  stripOtherSeraphicVigils(ctx, priestId, -1);
  cleanupVespers(ctx, priestId);
}
