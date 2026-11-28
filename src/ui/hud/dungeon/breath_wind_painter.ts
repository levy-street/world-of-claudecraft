// The Guardian of the Breath's wind indicator: the thin painter of its badge
// (pure view: breath_wind_view.ts). A self-mounted badge at the top of the
// screen: a round dial with an arrow turned the way the wind carries you
// (up is straight ahead) and a short label under it. The skeleton is built
// once; every per-frame value rides the PainterHost elided writers, so a
// still frame writes nothing. It never takes the pointer. Shown on every
// graphics preset (the wind's way is information a player acts on).

import type { PainterHostWriters } from '../../painter_host';
import type { BreathWindView } from './breath_wind_view';

export interface BreathWindDeps {
  /** The HUD layer the badge mounts into (null before the HUD exists). */
  layer: () => HTMLElement | null;
  writers: PainterHostWriters;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class BreathWindBadge {
  private el: HTMLElement | null = null;
  private arrow: HTMLElement | null = null;
  private label: HTMLElement | null = null;

  constructor(private readonly deps: BreathWindDeps) {}

  paint(view: BreathWindView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.el) w.setDisplay(this.el, 'none');
      return;
    }
    const el = this.ensure();
    if (!el || !this.arrow || !this.label) return;
    w.setDisplay(el, 'flex');
    w.setTransform(this.arrow, `rotate(${view.rotDeg}deg)`);
    w.toggleClass(el, 'is-turning', view.turning);
    w.setText(this.label, view.label);
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
    this.arrow = null;
    this.label = null;
  }

  private ensure(): HTMLElement | null {
    if (this.el) return this.el;
    const layer = this.deps.layer();
    if (!layer) return null;
    const doc = layer.ownerDocument;
    const el = doc.createElement('div');
    el.id = 'heart-breath-wind';
    el.className = 'ui-panel-strong heart-breath-wind';
    el.setAttribute('aria-hidden', 'true');
    const dial = doc.createElement('div');
    dial.className = 'hbw-dial';
    const arrow = doc.createElement('div');
    arrow.className = 'hbw-arrow';
    // A broad arrow, its point up (ahead), drawn once.
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-12 -12 24 24');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M0 -10 L8 1 L3 1 L3 9 L-3 9 L-3 1 L-8 1 Z');
    path.setAttribute('class', 'hbw-arrow-shape');
    svg.appendChild(path);
    arrow.appendChild(svg);
    dial.appendChild(arrow);
    const label = doc.createElement('div');
    label.className = 'hbw-label';
    el.append(dial, label);
    layer.appendChild(el);
    this.el = el;
    this.arrow = arrow;
    this.label = label;
    return el;
  }
}
