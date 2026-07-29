// WoW-style breath mirror bar: a blue bar top-center that appears when the
// player's head goes under, drains over BREATH_SECONDS, flashes red while
// drowning, and refills fast (and fades away) once they surface.
//
// Display-only: the value is the HUD's own mirror of the sim's breath clock
// (src/sim/breath.ts stepBreathUsedSeconds), stepped by main.ts from the same
// constants the sim damages with — no wire traffic, no sim reads. The bar
// lingers for a beat after refilling so the recovery is visible.

import { t } from './i18n';

const LINGER_SECONDS = 1.2;

export class BreathBar {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private linger = 0;
  private shown = false;
  private flashedDrowning = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'breath-bar';
    this.root.setAttribute('aria-hidden', 'true');
    this.fill = document.createElement('div');
    this.fill.className = 'breath-bar-fill';
    this.label = document.createElement('div');
    this.label.className = 'breath-bar-label';
    this.root.append(this.fill, this.label);
    parent.appendChild(this.root);
  }

  /** One frame: `fraction` 1 = full lungs, 0 = empty; `submerged` = head under. */
  update(fraction: number, submerged: boolean, dt: number): void {
    const drowning = submerged && fraction <= 0;
    const active = submerged || fraction < 1;
    this.linger = active ? LINGER_SECONDS : Math.max(0, this.linger - dt);
    const show = active || this.linger > 0;
    if (show !== this.shown) {
      this.shown = show;
      this.root.classList.toggle('breath-bar-show', show);
    }
    if (!show) return;
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    if (drowning !== this.flashedDrowning) {
      this.flashedDrowning = drowning;
      this.root.classList.toggle('breath-bar-drowning', drowning);
      this.label.textContent = drowning
        ? t('hudChrome.breath.drowning')
        : t('hudChrome.breath.label');
    } else if (!this.label.textContent) {
      this.label.textContent = t('hudChrome.breath.label');
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
