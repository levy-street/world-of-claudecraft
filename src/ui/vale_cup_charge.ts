// Thin DOM painter for the Vale Cup shoot power meter (the ValeCupBetting
// self-mounting-painter pattern): a fill bar + POWER label the stylesheet pins
// above the action bar, shown only while a shoot slot is held. Driven from
// hud.update() off the pure VcupChargeView; every per-tick write rides the
// PainterHost ELIDED writers (setDisplay / setWidth / toggleClass), and the only
// raw DOM write is the one-time structural mount (re-run by relocalize() on a
// language switch). The meter is aria-hidden: it visualizes a key the player is
// HOLDING, so it carries no focusable control and no live region.

import { esc } from './esc';
import { t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import type { VcupChargeView } from './vale_cup_charge_view';

export interface ValeCupChargeDeps {
  /** The HUD layer the meter mounts into (the #ui element). */
  layer(): HTMLElement | null;
  /** The mount id the stylesheet targets (#vcup-charge on the game entries). */
  rootId: string;
  writers: PainterHostWriters;
}

export class ValeCupCharge {
  private root: HTMLElement | null = null;
  private fillEl: HTMLElement | null = null;

  constructor(private readonly deps: ValeCupChargeDeps) {}

  /** Repaint from the pure view (the Hud owns the charge input state). */
  update(view: VcupChargeView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.root) w.setDisplay(this.root, 'none');
      return;
    }
    const root = this.ensureRoot();
    if (!root || !this.fillEl) return;
    w.setDisplay(root, 'block');
    w.setWidth(this.fillEl, `${(view.frac * 100).toFixed(1)}%`);
    // Tint from safe (green) through ideal (amber) to over-power (red).
    w.toggleClass(this.fillEl, 'over', view.over);
    w.toggleClass(this.fillEl, 'ideal', view.ideal);
  }

  /** Language switch: remount the structural children (the POWER label). */
  relocalize(): void {
    if (this.root) this.mount(this.root);
  }

  private mount(root: HTMLElement): void {
    root.innerHTML =
      `<span class="vcup-charge-label">${esc(t('hudChrome.vcup.shootPower'))}</span>` +
      `<span class="vcup-charge-fill"></span>`;
    this.fillEl = root.querySelector('.vcup-charge-fill');
  }

  private ensureRoot(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const el = document.createElement('div');
    el.id = this.deps.rootId;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    this.mount(el);
    layer.appendChild(el);
    this.root = el;
    return el;
  }
}
