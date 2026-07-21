import { esc } from './esc';

export interface PlayerTooltipModel {
  name: string;
  classLabel: string;
  classColor: string;
  level: number;
  guild?: string;
}

export interface PlayerTooltipI18n {
  t: (key: string, params?: Record<string, string>) => string;
  fmt: (value: number, opts?: Intl.NumberFormatOptions) => string;
}

export function playerTooltipHtml(m: PlayerTooltipModel, deps: PlayerTooltipI18n): string {
  const level = deps.fmt(m.level, { maximumFractionDigits: 0 });
  const title = `<div class="tt-title" style="color:${m.classColor}">${esc(m.name)}</div>`;
  const levelClass = `<div class="tt-sub">${esc(
    deps.t('itemUi.equipment.levelClass', { level, className: m.classLabel }),
  )}</div>`;
  const guild = m.guild ? `<div class="tt-sub">${esc(m.guild)}</div>` : '';
  return title + levelClass + guild;
}
