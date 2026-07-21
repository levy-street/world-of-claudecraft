import type { SimContext } from '../sim_context';
import type { Aura, AuraKind, Entity, SetProc } from '../types';

export function applySetProcs(
  ctx: SimContext,
  source: Entity,
  target: Entity | null,
  trigger: SetProc['trigger'],
): void {
  const matching = source.setProcs.filter((proc) => proc.trigger === trigger);
  if (matching.length === 0) return;
  source.procReadyAt ??= {};

  for (const proc of matching) {
    if (proc.icd && ctx.time < (source.procReadyAt[proc.id] ?? 0)) continue;
    // Target-applied procs (the stacking bleeds) land on the struck enemy;
    // everything else buffs the wearer. A dead or absent recipient skips the
    // roll entirely: for self procs the wearer just acted so this never draws
    // differently than before, keeping the rng stream stable for old procs.
    const recipient = proc.applyTo === 'target' ? target : source;
    if (!recipient || recipient.dead) continue;
    if (!ctx.rng.chance(proc.chance)) continue;

    source.procReadyAt[proc.id] = ctx.time + (proc.icd ?? 0);
    const kind: AuraKind = proc.aura;
    // Stacking (maxStacks): reapplication bumps the stack count, scales the
    // magnitude linearly, and refreshes the duration; applyAura replaces the
    // prior record (same id + sourceId), so the stack count carries forward.
    const base = proc.value ?? 0;
    let stacks: number | undefined;
    if (proc.maxStacks) {
      const existing = recipient.auras.find((a) => a.id === proc.id && a.sourceId === source.id);
      stacks = Math.min(proc.maxStacks, (existing?.stacks ?? 0) + 1);
    }
    const aura: Aura = {
      id: proc.id,
      name: proc.name,
      kind,
      remaining: proc.duration,
      duration: proc.duration,
      value: stacks !== undefined ? base * stacks : base,
      ...(proc.tickInterval !== undefined ? { tickInterval: proc.tickInterval } : {}),
      ...(stacks !== undefined ? { stacks } : {}),
      sourceId: source.id,
      school: proc.school ?? 'arcane',
    };
    ctx.applyAura(recipient, aura);
  }
}
