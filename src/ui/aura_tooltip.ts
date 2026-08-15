// Pure composition seam for the body of a buff/debuff tooltip. The HUD supplies
// localized, resolved ability prose and the existing runtime aura-effect line;
// this module decides how they combine without importing the DOM or i18n runtime.

export interface AuraTooltipInput {
  id: string;
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
  const description = deps.abilityDescription(aura.id)?.trim();
  const descriptionHtml = description
    ? `<div class="tt-desc">${deps.escapeHtml(description)}</div>`
    : '';
  return descriptionHtml + deps.effectHtml(aura);
}
