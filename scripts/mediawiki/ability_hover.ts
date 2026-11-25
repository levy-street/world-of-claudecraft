import { druidFormEntryTarget } from '../../src/sim/combat/druid_form_entry';
import { requiredForms } from '../../src/sim/combat/form_requirement';
import { CLASSES } from '../../src/sim/data';
import type { AbilityDef } from '../../src/sim/types';
import { formatAbilityNumber } from '../../src/ui/ability_description';
import { resourceDisplayName } from '../../src/ui/ability_tooltip_lines';
import { abilityTooltipHtml } from '../../src/ui/ability_tooltip_view';
import { esc } from '../../src/ui/esc';
import { t } from '../../src/ui/i18n';
import { referenceAbility } from './ability_builds';

/** The spellbook preview at its first rank, without active gear, talents, auras or haste. */
export function abilityHover(def: AbilityDef): string {
  const forms = requiredForms(def);
  const form = def.class === 'druid' ? (druidFormEntryTarget(def.id) ?? forms[0]) : undefined;
  const resource =
    form === 'bear' ? 'rage' : form === 'cat' ? 'energy' : CLASSES[def.class].resourceType;
  const html = abilityTooltipHtml(referenceAbility(def), resource, null);
  if (forms.length < 2 || !def.cost) return html;
  // A live character supplies its active form to the HUD. A static preview needs
  // the cost in both eligible pools so Cat druids can also read their cost.
  const costs = forms.map((f) => {
    const cost = t('abilityUi.tooltip.cost', {
      cost: formatAbilityNumber(def.cost),
      resource: resourceDisplayName(f === 'bear' ? 'rage' : 'energy'),
    });
    return t(`abilityUi.forms.${f}`) + ' (' + cost + ')';
  });
  return html + '<div class="tt-sub">' + esc(costs.join(' · ')) + '</div>';
}
