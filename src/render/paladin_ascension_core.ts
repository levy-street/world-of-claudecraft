import { MAX_ASCENSION_CHARGES } from '../sim/paladin_devotion';
import { valkyrFlightElapsed, valkyrVanished } from './paladin_valkyrs_calling_core';

export interface PaladinAscensionVisualSource {
  templateId: string;
  dead: boolean;
  paladinDevotion?: {
    ascensionCharges: number;
    ascensionRemaining: number;
  };
  auras?: ReadonlyArray<{ id: string; kind: string; remaining?: number; duration?: number }>;
  valkyrsCalling?: { elapsed: number } | null;
}

export interface PaladinAscensionVisualPlan {
  active: boolean;
  charges: number;
  lastCharge: boolean;
  /** Avenging Wrath's wings are already spread (Avenging Wrath, Life Covenant
   * or Valkyr's Calling): Ascension's own wings take the lower pair. */
  wrathWings?: boolean;
  /** Out of sight mid-flight (Valkyr's Calling): the halo, circle and wings go
   * with the Paladin's body. */
  vanished?: boolean;
  /** False for another player's Ascension: its column's flash dims further
   * (paladin_flash.ts). Unset reads as the local player's own. */
  local?: boolean;
}

/** The auras that spread the Avenging Wrath wings (paladin_avenging_wrath_visual). */
function wrathWingsSpread(auras: PaladinAscensionVisualSource['auras']): boolean {
  if (!auras) return false;
  for (const aura of auras)
    if (aura.id === 'avenging_wrath' || aura.id === 'valkyrs_calling_flight') return true;
  return false;
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
    out.wrathWings = false;
    out.vanished = false;
    return out;
  }
  const charges = Math.max(
    1,
    Math.min(MAX_ASCENSION_CHARGES, Math.floor(devotion.ascensionCharges)),
  );
  out.active = true;
  out.charges = charges;
  out.lastCharge = charges === 1;
  out.wrathWings = wrathWingsSpread(entity.auras);
  out.vanished = valkyrVanished(
    valkyrFlightElapsed({ auras: entity.auras ?? [], valkyrsCalling: entity.valkyrsCalling }),
  );
  return out;
}
