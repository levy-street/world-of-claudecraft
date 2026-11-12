// The skill event heart bar: the thin painter over heart_bar_view.ts. It builds
// the heart row once, beside the player frame's health bar, and on each update
// either shows the hearts (hiding the health bar) or restores the health bar.
// Every write rides the PainterHost elided writers, so an unchanged frame
// writes nothing.

import { t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import type { HeartBarView } from './heart_bar_view';

const HEART_PATH =
  'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.6.7-1.4 2.2-2.6 4.3-2.6 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z';

export class HeartBar {
  private row: HTMLElement | null = null;
  private hearts: HTMLElement[] = [];
  private healthBar: HTMLElement | null = null;

  constructor(
    private readonly writers: Pick<PainterHostWriters, 'setAttr' | 'setStyleProp'>,
    private readonly root: Pick<Document, 'getElementById' | 'createElement'> = document,
  ) {}

  /** Build the row on first use, beside #pf-hp's bar. Null without a frame. */
  private ensure(max: number): HTMLElement | null {
    if (this.row && this.hearts.length === max) return this.row;
    const fill = this.root.getElementById('pf-hp');
    const bar = fill?.parentElement ?? null;
    if (!bar?.parentElement) return null;
    this.healthBar = bar;
    if (!this.row) {
      this.row = this.root.createElement('div');
      this.row.id = 'pf-hearts';
      this.row.className = 'skill-event-hearts';
      this.row.setAttribute('role', 'meter');
      this.row.setAttribute('aria-valuemin', '0');
      bar.parentElement.insertBefore(this.row, bar.nextSibling);
    }
    this.row.replaceChildren();
    this.hearts = [];
    for (let i = 0; i < max; i++) {
      const heart = this.root.createElement('span');
      heart.className = 'skill-event-heart';
      heart.setAttribute('aria-hidden', 'true');
      heart.innerHTML = `<svg viewBox="0 0 24 24" focusable="false"><path d="${HEART_PATH}"/></svg>`;
      this.row.append(heart);
      this.hearts.push(heart);
    }
    this.row.setAttribute('aria-valuemax', String(max));
    return this.row;
  }

  paint(view: HeartBarView): void {
    const w = this.writers;
    if (!view.show) {
      if (this.row) w.setStyleProp(this.row, 'display', 'none');
      if (this.healthBar) w.setStyleProp(this.healthBar, 'display', '');
      return;
    }
    const row = this.ensure(view.max);
    if (!row || !this.healthBar) return;
    w.setStyleProp(this.healthBar, 'display', 'none');
    w.setStyleProp(row, 'display', '');
    w.setAttr(row, 'aria-valuenow', String(view.filled));
    w.setAttr(
      row,
      'aria-label',
      t('hud.skillEvent.heartsLabel', { count: view.filled, max: view.max }),
    );
    for (let i = 0; i < this.hearts.length; i++) {
      w.setAttr(this.hearts[i], 'data-state', i < view.filled ? 'full' : 'spent');
    }
  }
}
