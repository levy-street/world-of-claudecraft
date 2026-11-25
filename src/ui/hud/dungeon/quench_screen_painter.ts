// The Guardian of the Quench's screen effects: the thin painter (pure view:
// quench_screen_view.ts). One self-mounted full-screen overlay with two
// layers: the frost border, whose reach rides the `--hqs-frost` custom
// property (0 to 1; the stylesheet turns it into how far the frost creeps in),
// and the water's blue tint, shown by the `is-submerged` class. It sits under
// the HUD frames (the same band as the low-health vignette), never covers the
// screen's middle, never takes the pointer and is hidden from assistive tech
// (the cold bar and its alert say the same in words). The skeleton is built
// once; every per-frame value rides the PainterHost elided writers, so a
// still frame writes nothing.

import type { PainterHostWriters } from '../../painter_host';
import type { QuenchScreenView } from './quench_screen_view';

export interface QuenchScreenDeps {
  /** The HUD layer the overlay mounts into (null before the HUD exists). */
  layer: () => HTMLElement | null;
  writers: PainterHostWriters;
}

export class QuenchScreenOverlay {
  private el: HTMLElement | null = null;

  constructor(private readonly deps: QuenchScreenDeps) {}

  paint(view: QuenchScreenView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.el) w.setDisplay(this.el, 'none');
      return;
    }
    const el = this.ensure();
    if (!el) return;
    w.setDisplay(el, 'block');
    w.setStyleProp(el, '--hqs-frost', view.frost.toFixed(2));
    w.toggleClass(el, 'is-frozen', view.frozen);
    w.toggleClass(el, 'is-submerged', view.submerged);
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
  }

  private ensure(): HTMLElement | null {
    if (this.el) return this.el;
    const layer = this.deps.layer();
    if (!layer) return null;
    const doc = layer.ownerDocument;
    const el = doc.createElement('div');
    el.id = 'heart-quench-screen';
    el.setAttribute('aria-hidden', 'true');
    const water = doc.createElement('div');
    water.className = 'hqs-water';
    const frost = doc.createElement('div');
    frost.className = 'hqs-frost';
    el.append(water, frost);
    layer.appendChild(el);
    this.el = el;
    return el;
  }
}
