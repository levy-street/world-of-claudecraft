// Pure composition seam for the body of a buff/debuff tooltip. The HUD supplies
// localized, resolved ability prose and the existing runtime aura-effect line;
// this module decides how they combine without importing the DOM or i18n runtime.

import { ECHO_GROUP_CONVERT_SINGLE } from '../sim/combat/chronomancy';

export interface AuraTooltipInput {
  id: string;
  kind?: string;
  value?: number;
  echoGroup?: boolean;
}

export interface AuraTooltipBodyDeps<T extends AuraTooltipInput> {
  abilityDescription(id: string): string | null;
  effectHtml(aura: T): string;
  escapeHtml(text: string): string;
}

export function renderAuraTooltipBodyHtml<T extends AuraTooltipInput>(
  aura: T,
  deps: AuraTooltipBodyDeps<T>,
): string {
  const description = suppressAbilityDescription(aura)
    ? null
    : deps.abilityDescription(aura.id)?.trim();
  const descriptionHtml = description
    ? `<div class="tt-desc">${deps.escapeHtml(description)}</div>`
    : '';
  return descriptionHtml + deps.effectHtml(aura);
}

function suppressAbilityDescription(aura: AuraTooltipInput): boolean {
  if (aura.id !== 'temporal_echo' || aura.kind !== 'temporal_echo') return false;
  return (
    aura.echoGroup === true || (aura.value !== undefined && aura.value <= ECHO_GROUP_CONVERT_SINGLE)
  );
}

/** The tooltip's trailing lines: the countdown (suppressed for a MODE aura, same
 * rule as the suppressed strip label) plus the optional "who applied this" caster
 * line (the See-who-buffs feature: several casters' copies of the same buff, e.g.
 * two paladins' Blessings, are told apart at a glance). Off unless the player has
 * opted into showAuraCaster; blank whenever the caster cannot be resolved (an
 * old server's mirror, or a sourceId matching no live entity), never fabricated.
 * `secondsRemainingText`/`casterLineText` return ALREADY localized + escaped
 * text, so this module stays i18n/DOM-free like its sibling above. */
export interface AuraTooltipFooterDeps {
  secondsRemainingText(seconds: number): string;
  showCaster(): boolean;
  /** '' when the sourceId resolves to no live entity: never fabricated. */
  caster(sourceId: number | undefined): string;
  casterLineText(name: string): string;
}

export function auraTooltipFooterHtml(
  toggle: boolean,
  remaining: number,
  sourceId: number | undefined,
  deps: AuraTooltipFooterDeps,
): string {
  const durationHtml = toggle
    ? ''
    : `<div class="tt-sub">${deps.secondsRemainingText(remaining)}</div>`;
  const casterName = deps.showCaster() ? deps.caster(sourceId) : '';
  const casterHtml = casterName
    ? `<div class="tt-sub tt-aura-source">${deps.casterLineText(casterName)}</div>`
    : '';
  return durationHtml + casterHtml;
}
