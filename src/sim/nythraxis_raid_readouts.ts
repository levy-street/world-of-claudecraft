// IWorld combat-facet readouts for the Nythraxis raid: project the live
// encounter state carried on the boss entity (entity.nythraxis) into the
// presentation arrays render/ui consume through the seam. Every collector is
// a pure read over the SimContext views (no rng, no mutation, no tick-phase
// work); Sim keeps thin getters that delegate here so the IWorld surface
// resolves unchanged. Sibling of ignivar_raid_readouts.ts.
import {
  type ActiveNythraxisGraveEruption,
  type ActiveNythraxisGraveFlame,
  activeNythraxisGraveEruptions,
  activeNythraxisGraveFlames,
  type NythraxisGraveEruptionState,
} from './nythraxis_grave_eruption';
import type { SimContext } from './sim_context';
import { type DungeonDifficulty, NYTHRAXIS_BOSS_ID, type NythraxisEncounterState } from './types';

// The eruption fields are optional on the encounter state type (hand-built
// test literals); a missing field reads as "nothing live".
function eruptionState(st: NythraxisEncounterState): NythraxisGraveEruptionState {
  return {
    eruptionCastKey: st.eruptionCastKey ?? 0,
    eruptionImpactRemaining: st.eruptionImpactRemaining ?? 0,
    eruptionPoints: st.eruptionPoints ?? [],
    graveFlames: st.graveFlames ?? [],
  };
}

export type {
  ActiveNythraxisGraveEruption,
  ActiveNythraxisGraveFlame,
} from './nythraxis_grave_eruption';

function nythraxisDifficulty(ctx: SimContext, bossId: number): DungeonDifficulty {
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(bossId));
  return inst?.difficulty === 'heroic' ? 'heroic' : 'normal';
}

export function collectActiveNythraxisGraveEruptions(
  ctx: SimContext,
): ActiveNythraxisGraveEruption[] {
  const warnings: ActiveNythraxisGraveEruption[] = [];
  for (const entity of ctx.entities.values()) {
    if (entity.templateId !== NYTHRAXIS_BOSS_ID || entity.dead || !entity.nythraxis) continue;
    warnings.push(...activeNythraxisGraveEruptions(entity.id, eruptionState(entity.nythraxis)));
  }
  return warnings;
}

export function collectActiveNythraxisGraveFlames(ctx: SimContext): ActiveNythraxisGraveFlame[] {
  const flames: ActiveNythraxisGraveFlame[] = [];
  for (const entity of ctx.entities.values()) {
    if (entity.templateId !== NYTHRAXIS_BOSS_ID || entity.dead || !entity.nythraxis) continue;
    flames.push(
      ...activeNythraxisGraveFlames(
        entity.id,
        eruptionState(entity.nythraxis),
        nythraxisDifficulty(ctx, entity.id),
      ),
    );
  }
  return flames;
}
