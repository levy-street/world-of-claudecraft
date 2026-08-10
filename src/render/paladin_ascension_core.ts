export interface PaladinAscensionVisualSource {
  templateId: string;
  dead: boolean;
  paladinDevotion?: {
    ascensionCharges: number;
    ascensionRemaining: number;
  };
}

export interface PaladinAscensionVisualPlan {
  active: boolean;
  charges: number;
  lastCharge: boolean;
}

export function paladinAscensionVisualPlanInto(
  entity: PaladinAscensionVisualSource,
  out: PaladinAscensionVisualPlan,
): PaladinAscensionVisualPlan {
  const devotion = entity.paladinDevotion;
  if (
    entity.templateId !== 'paladin' ||
    entity.dead ||
    !devotion ||
    devotion.ascensionRemaining <= 0 ||
    devotion.ascensionCharges <= 0
  ) {
    out.active = false;
    out.charges = 0;
    out.lastCharge = false;
    return out;
  }
  const charges = Math.max(1, Math.min(5, Math.floor(devotion.ascensionCharges)));
  out.active = true;
  out.charges = charges;
  out.lastCharge = charges === 1;
  return out;
}
