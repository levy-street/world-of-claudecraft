export interface PaladinSunVerdictAuraSource {
  id: string;
  kind: string;
  value: number;
  sourceId: number;
}

export interface PaladinSunVerdictVisualSource {
  dead: boolean;
  auras: ReadonlyArray<PaladinSunVerdictAuraSource>;
}

export interface PaladinSunVerdictVisualPlan {
  active: boolean;
  charges: number;
  imminent: boolean;
}

export function selectPaladinSunVerdictAura(
  selected: PaladinSunVerdictAuraSource | null,
  candidate: PaladinSunVerdictAuraSource,
  viewerId: number,
): PaladinSunVerdictAuraSource | null {
  if (candidate.id !== 'sun_gods_verdict' || candidate.kind !== 'sun_verdict') return selected;
  if (candidate.sourceId === viewerId) return candidate;
  if (selected?.sourceId === viewerId) return selected;
  return !selected || candidate.value > selected.value ? candidate : selected;
}

export function paladinSunVerdictVisualPlanForAuraInto(
  dead: boolean,
  selected: PaladinSunVerdictAuraSource | null,
  out: PaladinSunVerdictVisualPlan,
): PaladinSunVerdictVisualPlan {
  if (dead || !selected) {
    out.active = false;
    out.charges = 0;
    out.imminent = false;
    return out;
  }

  const charges = Math.max(0, Math.min(3, Math.floor(selected.value)));
  out.active = true;
  out.charges = charges;
  out.imminent = charges >= 2;
  return out;
}

export function paladinSunVerdictVisualPlanInto(
  entity: PaladinSunVerdictVisualSource,
  viewerId: number,
  out: PaladinSunVerdictVisualPlan,
): PaladinSunVerdictVisualPlan {
  let selected: PaladinSunVerdictAuraSource | null = null;
  for (const aura of entity.auras) {
    selected = selectPaladinSunVerdictAura(selected, aura, viewerId);
  }
  return paladinSunVerdictVisualPlanForAuraInto(entity.dead, selected, out);
}
