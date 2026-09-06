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
    aura.echoGroup === true ||
    (aura.value !== undefined && aura.value <= ECHO_GROUP_CONVERT_SINGLE)
  );
}
