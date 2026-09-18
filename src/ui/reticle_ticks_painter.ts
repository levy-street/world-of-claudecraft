// Paints the reticle tick ring: a shallow arc of marks above screen centre, one
// per proc the player routed to this channel, unlit until it fires.
//
// Thin by contract. Every angle and slot decision lives in reticle_ticks_core;
// this file owns only nodes and writes, and every write goes through the elided
// PainterHost writers, so a frame where nothing changed touches no DOM. The ring
// radius is the sheet's (--tick-radius on #reticle-ticks in components.css), not
// a per-frame write: nothing here needs to know it.
//
// The ring is decorative chrome for a screen reader (the aura strip and the combat
// log already announce the same events in text), so the root is aria-hidden rather
// than adding a second, noisier announcement of every proc.

import type { PainterHostWriters } from './painter_host';
import type { ReticleTicksState } from './reticle_ticks_core';

export class ReticleTicksPainter {
  private readonly nodes: HTMLElement[] = [];

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly root: HTMLElement,
  ) {}

  /** Build the ring container. Creation-time DOM only. */
  static buildRoot(doc: Document = document): HTMLElement {
    const el = doc.createElement('div');
    el.id = 'reticle-ticks';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  paint(state: ReticleTicksState): void {
    // Grow the pool only to the high-water count; never shrink it, so slot node
    // references stay stable and the writers' per-element caches stay warm.
    while (this.nodes.length < state.count) {
      const el = this.root.ownerDocument.createElement('span');
      el.className = 'reticle-tick';
      this.root.appendChild(el);
      this.nodes.push(el);
    }
    for (let i = 0; i < this.nodes.length; i++) {
      const el = this.nodes[i];
      const slot = i < state.count ? state.slots[i] : null;
      this.writers.toggleClass(el, 'present', slot !== null);
      // Written for EVERY pooled node, present or not: .reticle-tick.lit paints at
      // full opacity on its own, so a node that just left the ring with its lit
      // state still on would keep glowing at its old angle until the pool grew
      // again. Unrouting or unwatching a proc while its aura is up hit exactly that.
      this.writers.toggleClass(el, 'lit', slot?.active === true);
      if (!slot) continue;
      this.writers.setStyleProp(el, '--tick-angle', `${slot.angleDeg}deg`);
      this.writers.setStyleProp(el, '--tick-color', slot.color);
    }
  }
}
