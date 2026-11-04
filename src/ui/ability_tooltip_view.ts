import { ABILITIES } from '../sim/data';
import type { ResolvedAbility } from '../sim/resolved_ability';
import type { Entity, ResourceType } from '../sim/types';
import { abilityScalingOf } from './ability_damage';
import {
  abilityDisplayDescription,
  abilityEffectAuraInput,
  abilityEffectText,
  formatAbilityNumber,
} from './ability_description';
import { abilityDisplayName } from './ability_display_name';
import {
  abilityCastLine,
  abilityRangeLine,
  abilityRequirementLines,
  playerSpellHasteFrac,
  resourceDisplayName,
} from './ability_tooltip_lines';
import {
  type AuraEffectInput,
  auraEffectDescriptor,
  auraEffectMaximumFractionDigits,
} from './aura_effect';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import type { TrinketAuraViewer } from './trinket_aura_effect';

export function auraEffectTooltipHtml(
  a: AuraEffectInput & { id?: string },
  player?: TrinketAuraViewer,
): string {
  const effect = auraEffectDescriptor(a, player);
  if (!effect) return '';
  const values: Record<string, string> = {};
  if (effect.nums) {
    for (const [k, n] of Object.entries(effect.nums)) {
      values[k] = formatNumber(n, {
        maximumFractionDigits: auraEffectMaximumFractionDigits(n),
      });
    }
  }
  // Resolve the {school} placeholder in the dot/absorb/thorns summaries. Prefer
  // the SOURCE ability's school: it is authoritative and always present
  // client-side, unlike the aura's own school, which the ability-tooltip call
  // site omits (only kind+value) and the online wire mirror drops. Without this
  // a magic reflect like Lightning Shield read a raw "{school}" (ability tooltip)
  // or the wrong "Physical" (online buff frame) instead of its real school.
  const school = (a.id ? ABILITIES[a.id]?.school : undefined) ?? effect.school;
  if (school) {
    values.school = t(`hudChrome.auraEffect.school.${school}` as TranslationKey);
  }
  return `<div class="tt-effect">${esc(t(effect.key as TranslationKey, values))}</div>`;
}

export function abilityTooltipHtml(
  res: ResolvedAbility,
  resourceType: ResourceType | null,
  spec: string | null,
  player?: Entity,
): string {
  const a = res.def;
  const scaling = player ? abilityScalingOf(player) : undefined;
  const damageText = abilityEffectText(res, scaling);
  let html = `<div class="tt-title">${esc(abilityDisplayName(a))}</div>`;
  html += `<div class="tt-sub">${esc(t('abilityUi.tooltip.rank', { rank: formatAbilityNumber(res.rank) }))}</div>`;
  const costLine: string[] = [];
  if (res.cost > 0) {
    costLine.push(
      t('abilityUi.tooltip.cost', {
        cost: formatAbilityNumber(res.cost),
        resource: resourceDisplayName(resourceType),
      }),
    );
  }
  if (a.devotionCost) {
    costLine.push(
      t('abilityUi.tooltip.cost', {
        cost: formatAbilityNumber(a.devotionCost),
        resource: t('abilityUi.resources.devotion'),
      }),
    );
  }
  if ((a.ruinCost ?? 0) > 0) {
    costLine.push(
      t('abilityUi.tooltip.ruinCost', {
        cost: formatAbilityNumber(a.ruinCost ?? 0),
      }),
    );
  }
  const rangeLine = abilityRangeLine(a);
  if (rangeLine) costLine.push(rangeLine);
  if (costLine.length) html += `<div class="tt-stat">${costLine.map(esc).join(' &nbsp; ')}</div>`;
  const castLine = [abilityCastLine(res, playerSpellHasteFrac(player))];
  // Use the RESOLVED cooldown (res.cooldown), not res.def.cooldown, so talents that
  // reduce cooldown (Improved Mortal Strike, Barrage, Improved Fire Blast, ...) show
  // their effect in the tooltip.
  if (res.cooldown > 0)
    castLine.push(
      t('abilityUi.tooltip.cooldownSeconds', {
        seconds: formatAbilityNumber(res.cooldown),
      }),
    );
  html += `<div class="tt-stat">${castLine.map(esc).join(' &nbsp; ')}</div>`;
  html += `<div class="tt-desc">${esc(abilityDisplayDescription(res, damageText, scaling, undefined, spec))}</div>`;
  // Resolved buff/aura effect line(s). Reads the RESOLVED effect value, so a buff's
  // tooltip reflects rank AND talents that strengthen it (Improved Devotion Aura /
  // Aspect of the Hawk / Fortitude via buffPct) - which the static description can't.
  for (const eff of res.effects) {
    if (res.def.tooltipOmitEffectLines) break;
    const resolvedAuraEffect = abilityEffectAuraInput(eff);
    if (resolvedAuraEffect) {
      html += auraEffectTooltipHtml(resolvedAuraEffect, player);
    } else if (eff.type === 'selfBuff' || eff.type === 'buffTarget') {
      // Pass the ability id so the effect line can resolve its damage school
      // (the {school} placeholder in the thorns/dot/absorb summaries).
      html += auraEffectTooltipHtml(
        {
          kind: eff.kind,
          value: eff.value,
          id: a.id,
        },
        player,
      );
    } else if (eff.type === 'partyMeleeBuff') {
      // Sanguine Aura: surface the same composite line the buff icon shows.
      html += auraEffectTooltipHtml(
        {
          kind: 'sanguine',
          value: eff.attackSpeedMult,
          value2: eff.dmgPct,
        },
        player,
      );
    }
  }
  // Pass the RESOLVED ability, not just its def: a talent that retires a
  // requirement (Cheap Trick on Gut Punch) must retire its line with it, the
  // same way the resolved cost / cast / cooldown above beat the def's.
  const requirements = abilityRequirementLines(a, spec, res);
  if (requirements.length) {
    html += requirements.map((line) => `<div class="tt-sub">${esc(line)}</div>`).join('');
  }
  return html;
}
