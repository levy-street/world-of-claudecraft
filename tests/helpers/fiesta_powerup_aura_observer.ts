import { POWERUPS, type PowerupBuff, type PowerupDef } from '../../src/sim/content/augments';
import type { ArenaMatch, FiestaPowerup } from '../../src/sim/sim';
import type { SimContext } from '../../src/sim/sim_context';
import { fiestaGrabPowerup } from '../../src/sim/social/fiesta';
import type { Aura, Entity } from '../../src/sim/types';

export interface FiestaPowerupAuraObservation {
  definition: PowerupDef;
  buffs: readonly PowerupBuff[];
  auras: readonly Aura[];
}

/**
 * Observe the aura payloads emitted by the live Fiesta pickup producer.
 * The bot-marked match bypasses deed bookkeeping after the pickup is applied.
 */
export function observeFiestaPowerupAuras(): FiestaPowerupAuraObservation[] {
  const fighter = { id: 1 } as Entity;
  const match = { teamA: [fighter.id], teamB: [] } as unknown as ArenaMatch;

  return POWERUPS.map((definition, index) => {
    const auras: Aura[] = [];
    const ctx = {
      fiestaBotPids: [fighter.id],
      applyAura: (_target: Entity, aura: Aura) => auras.push(aura),
      emit: () => undefined,
    } as unknown as SimContext;
    const powerup: FiestaPowerup = {
      id: index + 1,
      defId: definition.id,
      x: 0,
      z: 0,
      state: 'ready',
      timer: 1,
    };

    fiestaGrabPowerup(ctx, match, fighter, powerup);
    return { definition, buffs: definition.buffs, auras };
  });
}
