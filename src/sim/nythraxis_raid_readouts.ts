// IWorld combat-facet readouts for the Nythraxis raid: project the live
// encounter state carried on the boss entity (entity.nythraxis) into the
// presentation arrays render/ui consume through the seam. Every collector is
// a pure read over the SimContext views (no rng, no mutation, no tick-phase
// work); Sim keeps thin getters that delegate here so the IWorld surface
// resolves unchanged. Sibling of ignivar_raid_readouts.ts.
import {
  type ActiveNythraxisBindingSigil,
  activeNythraxisBindingSigils,
} from './nythraxis_binding_sigil';
import {
  type ActiveNythraxisGraveEruption,
  type ActiveNythraxisGraveFlame,
  activeNythraxisGraveEruptions,
  activeNythraxisGraveFlames,
  type NythraxisGraveEruptionState,
} from './nythraxis_grave_eruption';
import { type ActiveNythraxisGravefire, activeNythraxisGravefires } from './nythraxis_gravefire';
import type { SimContext } from './sim_context';
import { type DungeonDifficulty, NYTHRAXIS_BOSS_ID, type NythraxisEncounterState } from './types';

export type { ActiveNythraxisBindingSigil } from './nythraxis_binding_sigil';
export type {
  ActiveNythraxisGraveEruption,
  ActiveNythraxisGraveFlame,
} from './nythraxis_grave_eruption';
export type { ActiveNythraxisGravefire } from './nythraxis_gravefire';

// The mechanic fields are optional on the encounter state type (hand-built
// test literals); a missing field reads as "nothing live".
function eruptionState(st: NythraxisEncounterState): NythraxisGraveEruptionState {
  return {
    eruptionCastKey: st.eruptionCastKey ?? 0,
    eruptionImpactRemaining: st.eruptionImpactRemaining ?? 0,
    eruptionPoints: st.eruptionPoints ?? [],
    graveFlames: st.graveFlames ?? [],
  };
}

function nythraxisDifficulty(ctx: SimContext, bossId: number): DungeonDifficulty {
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(bossId));
  return inst?.difficulty === 'heroic' ? 'heroic' : 'normal';
}

function* liveBosses(ctx: SimContext) {
  for (const entity of ctx.entities.values()) {
    if (entity.templateId !== NYTHRAXIS_BOSS_ID || entity.dead || !entity.nythraxis) continue;
    yield entity as typeof entity & { nythraxis: NythraxisEncounterState };
  }
}

export function collectActiveNythraxisGraveEruptions(
  ctx: SimContext,
): ActiveNythraxisGraveEruption[] {
  const warnings: ActiveNythraxisGraveEruption[] = [];
  for (const boss of liveBosses(ctx)) {
    warnings.push(...activeNythraxisGraveEruptions(boss.id, eruptionState(boss.nythraxis)));
  }
  return warnings;
}

export function collectActiveNythraxisGraveFlames(ctx: SimContext): ActiveNythraxisGraveFlame[] {
  const flames: ActiveNythraxisGraveFlame[] = [];
  for (const boss of liveBosses(ctx)) {
    flames.push(
      ...activeNythraxisGraveFlames(
        boss.id,
        eruptionState(boss.nythraxis),
        nythraxisDifficulty(ctx, boss.id),
      ),
    );
  }
  return flames;
}

export function collectActiveNythraxisGravefires(ctx: SimContext): ActiveNythraxisGravefire[] {
  const lines: ActiveNythraxisGravefire[] = [];
  for (const boss of liveBosses(ctx)) {
    lines.push(
      ...activeNythraxisGravefires(
        boss.id,
        boss.nythraxis.gravefires ?? [],
        nythraxisDifficulty(ctx, boss.id),
      ),
    );
  }
  return lines;
}

export function collectActiveNythraxisBindingSigils(
  ctx: SimContext,
): ActiveNythraxisBindingSigil[] {
  const sigils: ActiveNythraxisBindingSigil[] = [];
  for (const boss of liveBosses(ctx)) {
    sigils.push(
      ...activeNythraxisBindingSigils(
        boss.id,
        boss.nythraxis.sigil,
        nythraxisDifficulty(ctx, boss.id),
      ),
    );
  }
  return sigils;
}
