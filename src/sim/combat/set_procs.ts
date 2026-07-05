import type { SimContext } from '../sim_context';
import type { Aura, AuraKind, Entity, SetProc } from '../types';

export function applySetProcs(
  ctx: SimContext,
  source: Entity,
  _target: Entity | null,
  trigger: SetProc['trigger'],
): void {
  const matching = source.setProcs.filter((proc) => proc.trigger === trigger);
  if (matching.length === 0) return;
  source.procReadyAt ??= {};

  for (const proc of matching) {
    if (proc.icd && ctx.time < (source.procReadyAt[proc.id] ?? 0)) continue;
    if (!ctx.rng.chance(proc.chance)) continue;

    source.procReadyAt[proc.id] = ctx.time + (proc.icd ?? 0);
    const kind: AuraKind = proc.aura;
    const aura: Aura = {
      id: proc.id,
      name: proc.name,
      kind,
      remaining: proc.duration,
      duration: proc.duration,
      value: proc.value ?? 0,
      sourceId: source.id,
      school: 'arcane',
    };
    ctx.applyAura(source, aura);
  }
}
