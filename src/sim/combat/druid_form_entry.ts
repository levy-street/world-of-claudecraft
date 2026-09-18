// Druid form-entry buttons (v0.43): three abilities that PUT YOU IN a form as
// part of pressing them, rather than refusing unless you are already wearing it.
//
//   Stalk (prowl)        -> Cat Form, then stealth
//   Lunge (lunge)        -> Cat Form, then the gap closer
//   Bruin Rush (bear_charge) -> Bruin Form, then the rush
//
// All three are usable in and out of every form. The shift is the same form
// every other route produces, deliberately: it reads the authored form
// ability's own selfBuff for duration and value, and it stamps the aura with
// that FORM ABILITY's id (cat_form / bear_form), not the pressed button's.
// That id is what the form button's own toggle-off looks for (the selfBuff arm
// of effect_dispatch.ts finds the aura by `a.id === ability.id`), so a druid
// who entered Cat through Lunge can still press Cat Form once to stand up.
// Every other reader keys on the aura KIND and cannot tell the routes apart.
//
// What this deliberately does NOT do:
//   - charge the form button's own cost. These three bill their own cost (0 for
//     Stalk and Bruin Rush, 40 energy for Lunge) and nothing more.
//   - grant Loping Stride. The shift sprint belongs to the form BUTTONS
//     (FORM_ABILITY_IDS in druid_engines.ts); a stealth opener or a gap closer
//     that also sprinted would break its own pacing.
//
// Resource note, and it is why the cast gate consults this module: entering a
// form SWAPS the bar (entity.ts recalcPlayerStats sets Cat to a full 100 energy
// and Bruin to 0 rage). A Lunge pressed from caster or Bruin Form is therefore
// billed against the CAT energy it is about to have, never the mana or rage it
// is standing in, so the affordability gate must not weigh it against the old
// bar and refuse a press that would in fact be payable.
// Draws no rng.
import { ABILITIES } from '../data';
import { recalcPlayerStats } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type AuraKind, type Entity, isFormAuraKind } from '../types';
import type { DruidCombatForm } from './form_requirement';

/** Which form each button puts you in. The one table; adding a fourth
 *  form-entry button is an entry here, never another copy of the shift. */
export const DRUID_FORM_ENTRY: Readonly<Record<string, DruidCombatForm>> = {
  prowl: 'cat',
  lunge: 'cat',
  bear_charge: 'bear',
};

const FORM_ABILITY_ID: Record<DruidCombatForm, string> = {
  bear: 'bear_form',
  cat: 'cat_form',
};
const FORM_AURA_KIND: Record<DruidCombatForm, AuraKind> = {
  bear: 'form_bear',
  cat: 'form_cat',
};

/** The form this button enters, or null when it is not a form-entry button. */
export function druidFormEntryTarget(abilityId: string): DruidCombatForm | null {
  return DRUID_FORM_ENTRY[abilityId] ?? null;
}

/** Is a shift actually owed for this press? False when the button is not a
 *  form-entry button, the presser is not a druid, or the druid already wears
 *  the target form (pressing Lunge in Cat Form shifts nothing). */
export function druidFormEntryOwed(
  meta: Pick<PlayerMeta, 'cls'>,
  auras: readonly { kind: string }[],
  abilityId: string,
): boolean {
  const form = druidFormEntryTarget(abilityId);
  if (form === null || meta.cls !== 'druid') return false;
  return !auras.some((aura) => aura.kind === FORM_AURA_KIND[form]);
}

/** The authored self-buff of a form button, the ONE source of that form's
 *  duration and value, so a form retune carries to this route for free. */
function formSelfBuff(form: DruidCombatForm) {
  const def = ABILITIES[FORM_ABILITY_ID[form]];
  return def?.effects.find(
    (effect) => effect.type === 'selfBuff' && effect.kind === FORM_AURA_KIND[form],
  );
}

/** Put the druid in the form this button enters. Returns false and touches
 *  nothing when this press needs no shift. */
export function applyDruidFormEntry(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  abilityId: string,
): boolean {
  if (!druidFormEntryOwed(meta, p.auras, abilityId)) return false;
  const form = druidFormEntryTarget(abilityId);
  if (form === null) return false;
  const selfBuff = formSelfBuff(form);
  if (!selfBuff || selfBuff.type !== 'selfBuff') return false;
  const formDef = ABILITIES[FORM_ABILITY_ID[form]];
  const targetKind = FORM_AURA_KIND[form];
  // Forms are exclusive: drop whatever is worn, the way the selfBuff arm does
  // when one form shifts into another (splice plus a fade event each).
  for (let index = p.auras.length - 1; index >= 0; index--) {
    const aura = p.auras[index];
    if (!isFormAuraKind(aura.kind) || aura.kind === targetKind) continue;
    p.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
  }
  ctx.applyAura(p, {
    id: FORM_ABILITY_ID[form],
    name: formDef.name,
    kind: targetKind,
    remaining: selfBuff.duration,
    duration: selfBuff.duration,
    value: selfBuff.value,
    sourceId: p.id,
    school: formDef.school,
  });
  // The resource bar swaps and the mana pool parks here, exactly as it does on
  // the form button's own cast.
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  return true;
}
