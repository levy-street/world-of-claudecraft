export type WarriorFuryStateKind = 0 | 1 | 2;
export interface WarriorFuryStateAura {
  id: string;
  kind?: string;
  remaining?: number;
  duration?: number;
  charges?: number;
}
export function warriorFuryStateKind(aura: WarriorFuryStateAura): WarriorFuryStateKind | null {
  if (!Number.isFinite(aura.remaining) || !(aura.remaining! > 0)) return null;
  if (aura.id === 'fury_enrage' && aura.kind === 'enrage') return 0;
  if (aura.id === 'furious_mending' && aura.kind === 'buff_dr') return 1;
  if (
    aura.id === 'bladed_echo' &&
    aura.kind === 'aoe_echo' &&
    Number.isFinite(aura.charges) &&
    aura.charges! > 0
  )
    return 2;
  return null;
}
export function warriorFuryStateAge(aura: WarriorFuryStateAura): number {
  return Number.isFinite(aura.duration) && aura.duration! > 0
    ? Math.max(0, aura.duration! - Math.max(0, aura.remaining ?? 0))
    : 0.35;
}
export function warriorEchoCount(charges: number | undefined): number {
  return Number.isFinite(charges) ? Math.min(2, Math.max(0, Math.floor(charges!))) : 0;
}
