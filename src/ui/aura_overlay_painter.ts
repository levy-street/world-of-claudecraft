import { type AuraOverlayProcDef, auraOverlayProcAura } from './aura_overlay_view';
import { formatNumber } from './i18n';
import type { PainterHostWriters } from './painter_host';

export interface AuraOverlayPaintTarget {
  def: AuraOverlayProcDef;
  el: HTMLElement;
  timer: HTMLElement;
}

export interface AuraOverlayPaintAura {
  id?: string;
  kind: string;
  remaining: number;
  duration: number;
}

export class AuraOverlayPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly targets: readonly AuraOverlayPaintTarget[],
  ) {}

  paint(
    auras: readonly AuraOverlayPaintAura[],
    supplementalAuras: readonly AuraOverlayPaintAura[] = [],
  ): void {
    for (const target of this.targets) {
      const aura =
        auraOverlayProcAura(target.def, auras) ??
        auraOverlayProcAura(target.def, supplementalAuras);
      const active = aura !== undefined;
      this.writers.toggleClass(target.el, 'active', active);
      if (aura && Number.isFinite(aura.remaining) && aura.duration > 0) {
        const remaining = Math.max(0, aura.remaining);
        const ratio = Math.min(1, remaining / aura.duration);
        this.writers.setText(target.timer, formatNumber(Math.ceil(remaining)));
        this.writers.setStyleProp(
          target.timer,
          '--aura-remaining-ratio',
          `${(ratio * 100).toFixed(4)}%`,
        );
      } else {
        this.writers.setText(target.timer, '');
        this.writers.setStyleProp(target.timer, '--aura-remaining-ratio', '0%');
      }
    }
  }
}
