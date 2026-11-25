// The Guardian of the Quench's screen effects: the thin painter (pure view:
// quench_screen_view.ts). One self-mounted full-screen overlay with two
// layers: the frost border, whose reach rides the `--hqs-frost` custom
// property (0 to 1; the stylesheet turns it into how far the frost creeps in),
// and the water's blue tint, shown by the `is-submerged` class. It mounts just
// before the `before` anchor (the nameplates layer, outside the HUD root), so
// it paints over the 3D world but under the nameplates and EVERY HUD frame;
// it never covers the screen's middle, never takes the pointer and is hidden
// from assistive tech (the cold bar and its alert say the same in words). The skeleton is built
// once; every per-frame value rides the PainterHost elided writers, so a
// still frame writes nothing.

import type { PainterHostWriters } from '../../painter_host';
import { QUENCH_FROST_STEPS, type QuenchScreenView } from './quench_screen_view';

/** The frost's reach as the custom property's text, one per step (no string
 *  built a frame). */
const FROST_TEXT: readonly string[] = Array.from({ length: QUENCH_FROST_STEPS + 1 }, (_, i) =>
  (i / QUENCH_FROST_STEPS).toFixed(2),
);

export interface QuenchScreenDeps {
  /** The HUD layer: the fallback parent when there is no `before` anchor
   *  (null before the HUD exists). */
  layer: () => HTMLElement | null;
  /** The element the overlay mounts just before (its sibling), so it stacks
   *  under that element and everything above it. */
  before?: () => HTMLElement | null;
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
    const step = Math.max(
      0,
      Math.min(QUENCH_FROST_STEPS, Math.round(view.frost * QUENCH_FROST_STEPS)),
    );
    w.setStyleProp(el, '--hqs-frost', FROST_TEXT[step]);
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
    const anchor = this.deps.before?.() ?? null;
    if (anchor?.parentNode) anchor.parentNode.insertBefore(el, anchor);
    else layer.appendChild(el);
    this.el = el;
    return el;
  }
}
