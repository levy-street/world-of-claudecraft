// The ability tooltip body every ability surface shows (action bar, spellbook,
// cooldown manager, stance bar, death recap, talent previews). Extracted from
// hud.ts (the monolith ratchet): it reads only the resolved ability, the live
// player snapshot, and the viewer's spec, so the coordinator is a thin caller.
//
// Layout, top to bottom:
//   1. name, with the rank right-aligned on the same line
//   2. cost | range, then cast | cooldown, each as a two-sided row
//   3. requirement and targeting lines (what must be true to press it)
//   4. the description, then the resolved buff / aura effect lines
//   5. the Shift-held detail block, or a one-line hint that it exists
//
// Pure and DOM-free (a registered UI_PURE_CORES entry): returns escaped HTML.

import type { ResolvedAbility } from '../sim/sim';
import type { Entity } from '../sim/types';
import { type AbilityScaling, abilityScalingOf } from './ability_damage';
import {
  abilityDisplayDescription,
  abilityEffectAuraInput,
  abilityEffectText,
  formatAbilityNumber,
} from './ability_description';
import { abilityDisplayName } from './ability_display_name';
import { abilityTooltipDetailLines } from './ability_tooltip_detail_core';
import {
  abilityCastLine,
  abilityRangeLine,
  abilityRequirementLines,
  playerSpellHasteFrac,
  resourceDisplayName,
} from './ability_tooltip_lines';
import type { AuraEffectInput } from './aura_effect';
import { esc } from './esc';
import { formatList, t } from './i18n';

/** How the Shift detail block shows: the block itself, a hint that it exists
 *  (desktop pointer, Shift up), or nothing (touch, where Shift cannot be held). */
export type AbilityTooltipDetailMode = 'details' | 'hint' | 'none';

export interface AbilityTooltipContext {
  player: Pick<
    Entity,
    'resourceType' | 'spellPower' | 'healPower' | 'rangedPower' | 'attackPower' | 'auras'
  > &
    Partial<Pick<Entity, 'spellHaste'>>;
  spec: string | null | undefined;
  /** The HUD's localized aura-effect line (it owns the descriptor + school lookup). */
  auraEffectHtml(input: AuraEffectInput & { id?: string }): string;
  detailMode: AbilityTooltipDetailMode;
}

function row(left: string | null, right: string | null): string {
  if (!left && !right) return '';
  return (
    `<div class="tt-stat tt-row">` +
    `<span>${left ? esc(left) : ''}</span>` +
    `<span class="tt-row-end">${right ? esc(right) : ''}</span>` +
    `</div>`
  );
}

function costText(res: ResolvedAbility, ctx: AbilityTooltipContext): string | null {
  const a = res.def;
  const parts: string[] = [];
  if (res.cost > 0) {
    parts.push(
      t('abilityUi.tooltip.cost', {
        cost: formatAbilityNumber(res.cost),
        resource: resourceDisplayName(ctx.player.resourceType),
      }),
    );
  }
  if (a.devotionCost) {
    parts.push(
      t('abilityUi.tooltip.cost', {
        cost: formatAbilityNumber(a.devotionCost),
        resource: t('abilityUi.resources.devotion'),
      }),
    );
  }
  if ((a.ruinCost ?? 0) > 0) {
    parts.push(t('abilityUi.tooltip.ruinCost', { cost: formatAbilityNumber(a.ruinCost ?? 0) }));
  }
  return parts.length ? formatList(parts) : null;
}

function effectLinesHtml(res: ResolvedAbility, ctx: AbilityTooltipContext): string {
  if (res.def.tooltipOmitEffectLines) return '';
  let html = '';
  // Resolved buff/aura effect line(s). Reads the RESOLVED effect value, so a
  // buff's tooltip reflects rank AND talents that strengthen it (Improved
  // Devotion Aura / Aspect of the Hawk / Fortitude via buffPct), which the
  // static description cannot.
  for (const eff of res.effects) {
    const resolvedAuraEffect = abilityEffectAuraInput(eff);
    if (resolvedAuraEffect) {
      html += ctx.auraEffectHtml(resolvedAuraEffect);
    } else if (eff.type === 'selfBuff' || eff.type === 'buffTarget') {
      // Pass the ability id so the effect line can resolve its damage school
      // (the {school} placeholder in the thorns/dot/absorb summaries).
      html += ctx.auraEffectHtml({ kind: eff.kind, value: eff.value, id: res.def.id });
    } else if (eff.type === 'partyMeleeBuff') {
      // Sanguine Aura: surface the same composite line the buff icon shows.
      html += ctx.auraEffectHtml({
        kind: 'sanguine',
        value: eff.attackSpeedMult,
        value2: eff.dmgPct,
      });
    }
  }
  return html;
}

function detailHtml(res: ResolvedAbility, scaling: AbilityScaling, mode: AbilityTooltipDetailMode) {
  if (mode === 'none') return '';
  const lines = abilityTooltipDetailLines(res, scaling);
  if (lines.length === 0) return '';
  if (mode === 'hint') {
    return `<div class="tt-sub tt-detail-hint">${esc(t('hudChrome.abilityTooltipDetail.hint'))}</div>`;
  }
  return `<div class="tt-details">${lines.map((line) => `<div class="tt-sub">${esc(line)}</div>`).join('')}</div>`;
}

export function abilityTooltipHtml(res: ResolvedAbility, ctx: AbilityTooltipContext): string {
  const a = res.def;
  const scaling = abilityScalingOf(ctx.player);
  let html =
    `<div class="tt-title tt-row">` +
    `<span>${esc(abilityDisplayName(a))}</span>` +
    `<span class="tt-sub tt-row-end">${esc(t('abilityUi.tooltip.rank', { rank: formatAbilityNumber(res.rank) }))}</span>` +
    `</div>`;
  html += row(costText(res, ctx), abilityRangeLine(a));
  // The RESOLVED cooldown (res.cooldown), not res.def.cooldown, so talents that
  // reduce it (Improved Mortal Strike, Barrage, ...) show their effect.
  html += row(
    abilityCastLine(res, playerSpellHasteFrac(ctx.player)),
    res.cooldown > 0
      ? t('abilityUi.tooltip.cooldownSeconds', { seconds: formatAbilityNumber(res.cooldown) })
      : null,
  );
  // Pass the RESOLVED ability, not just its def: a talent that retires a
  // requirement (Cheap Trick on Gut Punch) must retire its line with it.
  const requirements = abilityRequirementLines(a, ctx.spec, res);
  if (requirements.length) {
    html += requirements.map((line) => `<div class="tt-sub tt-req">${esc(line)}</div>`).join('');
  }
  const damageText = abilityEffectText(res, scaling);
  html += `<div class="tt-desc">${esc(abilityDisplayDescription(res, damageText, scaling, undefined, ctx.spec))}</div>`;
  html += effectLinesHtml(res, ctx);
  html += detailHtml(res, scaling, ctx.detailMode);
  return html;
}
