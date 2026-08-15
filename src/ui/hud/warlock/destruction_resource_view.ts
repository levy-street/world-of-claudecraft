import { RUIN_MAX, ruinAmountFromAuras } from '../../../sim/combat/destruction';

export function destructionRuinPips(
  spec: string | null,
  auras: readonly { kind: string; stacks?: number }[],
): number {
  if (spec !== 'destruction') return 0;
  return Math.min(RUIN_MAX, ruinAmountFromAuras(auras));
}
