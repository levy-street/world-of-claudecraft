// Shared force-taunt eligibility gate for hunter/warlock/mage pets.
//
// A pet can be made to hold aggro (manual /pettaunt, its auto-taunt toggle, or the
// passive AI's in-combat Growl arm in pet_ai.ts) only if it is actually built to
// tank: a melee pet with no explicit petCanTaunt: false override. Ranged pets
// (petRanged, e.g. warlock Emberkin/Spellhound/Wraithborn, mage Water Elemental) and
// the older petSpell-driven petRole: 'ranged_dps' pets (e.g. the zone1 Fire Demon)
// are squishy casters/skirmishers that stand off at range; they were never meant to
// pull aggro onto themselves.
//
// This single predicate is consumed by BOTH the player command surface
// (pet_commands.ts: petTaunt/setPetAutoTaunt/petTauntReadout) and the passive AI's
// in-combat taunt arm (pet_ai.ts updatePet). Before this module existed the two
// sides kept their own ad hoc checks (the AI gated on `!ranged`, the commands only
// checked `petCanTaunt === false`) and drifted apart: a ranged pet's /pettaunt
// either force-tainted it in melee range or, out of range, latched
// petManualTauntPending permanently true since the AI's consume condition could
// never see it clear. Route every taunt-eligibility check through here so the two
// surfaces cannot diverge again.
import { MOBS } from '../data';

export function petCanForceTaunt(templateId: string): boolean {
  const template = MOBS[templateId];
  if (!template) return true;
  if (template.petCanTaunt === false) return false;
  if (template.petRanged) return false;
  if (template.petRole === 'ranged_dps') return false;
  return true;
}
