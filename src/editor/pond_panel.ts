import { formatNumber, t } from '../ui/i18n';
import { el, slider } from './dom';
import './pond_panel.css';
import { POND_DEPTH_MAX, POND_DEPTH_MIN, POND_RADIUS_MAX, POND_RADIUS_MIN } from './pond_core';

export interface PondPanelDeps {
  getPondRadius(): number;
  setPondRadius(value: number): void;
  getPondDepth(): number;
  setPondDepth(value: number): void;
}

/** Tool settings only; the app owns the armed pond and its document command. */
export function pondPanel(deps: PondPanelDeps): HTMLElement {
  const root = el('section', 'ed-section ed-pond-panel');
  root.appendChild(el('h2', 'ed-section-title', t('editor.pond.title')));
  root.appendChild(el('p', 'ed-hint', t('editor.pond.hint')));
  const format = (value: number): string =>
    formatNumber(value, { maximumFractionDigits: 1, useGrouping: false });
  const parse = (text: string): number | null => {
    if (!text.trim()) return null;
    const value = Number(text.trim().replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  };
  root.appendChild(
    slider(t('editor.pond.radius'), {
      min: POND_RADIUS_MIN,
      max: POND_RADIUS_MAX,
      step: 0.5,
      value: deps.getPondRadius(),
      onInput: deps.setPondRadius,
      format,
      parse,
    }).root,
  );
  root.appendChild(
    slider(t('editor.pond.depth'), {
      min: POND_DEPTH_MIN,
      max: POND_DEPTH_MAX,
      step: 0.5,
      value: deps.getPondDepth(),
      onInput: deps.setPondDepth,
      format,
      parse,
    }).root,
  );
  return root;
}
