// The Guardian of the Quench's ice-state indicator: the thin painter of its
// badge and the water's frost veil (pure view: quench_ice_view.ts). A
// self-mounted badge at the top of the screen (a round dial with the state's
// glyph: a snowflake on the ice, a cracked plate on breaking ice, waves in
// the water; a short label and the seconds in the water under it) and a
// full-screen veil (a frosted blue edge and a light blue tint) shown while
// the player is in the water. Skeletons built once; every per-frame value
// rides the PainterHost elided writers, so a still frame writes nothing.
// Neither takes the pointer. Shown on every graphics preset.

import type { PainterHostWriters } from '../../painter_host';
import type { QuenchIceState, QuenchIceView } from './quench_ice_view';

export interface QuenchIceDeps {
  /** The HUD layer the badge and the veil mount into (null before the HUD exists). */
  layer: () => HTMLElement | null;
  writers: PainterHostWriters;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Each state's glyph (a 24 x 24 box centred on 0), drawn once. */
const GLYPHS: Readonly<Record<QuenchIceState, string>> = {
  // A six-armed snowflake.
  ice: 'M0 -10 V10 M-8.7 -5 L8.7 5 M-8.7 5 L8.7 -5 M0 -10 L-2.5 -7 M0 -10 L2.5 -7 M0 10 L-2.5 7 M0 10 L2.5 7',
  // A plate splitting: a jagged crack across a round slab.
  breaking:
    'M-9 0 A9 9 0 1 1 9 0 A9 9 0 1 1 -9 0 M-6 -7 L-2 -2 L-5 2 L0 5 L-1 9 M2 -9 L1 -4 L5 -1 L3 3 L8 6',
  // Waves of water.
  water:
    'M-10 -3 Q-7.5 -6 -5 -3 T0 -3 T5 -3 T10 -3 M-10 3 Q-7.5 0 -5 3 T0 3 T5 3 T10 3 M-10 9 Q-7.5 6 -5 9 T0 9 T5 9 T10 9',
};

export class QuenchIceBadge {
  private el: HTMLElement | null = null;
  private veil: HTMLElement | null = null;
  private label: HTMLElement | null = null;
  private seconds: HTMLElement | null = null;

  constructor(private readonly deps: QuenchIceDeps) {}

  paint(view: QuenchIceView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.el) w.setDisplay(this.el, 'none');
      if (this.veil) w.toggleClass(this.veil, 'is-on', false);
      return;
    }
    const el = this.ensure();
    if (!el || !this.label || !this.seconds || !this.veil) return;
    w.setDisplay(el, 'flex');
    w.toggleClass(el, 'is-ice', view.state === 'ice');
    w.toggleClass(el, 'is-breaking', view.state === 'breaking');
    w.toggleClass(el, 'is-water', view.state === 'water');
    w.setText(this.label, view.label);
    w.setText(this.seconds, view.seconds);
    w.setDisplay(this.seconds, view.seconds ? 'block' : 'none');
    w.toggleClass(this.veil, 'is-on', view.veil);
  }

  dispose(): void {
    this.el?.remove();
    this.veil?.remove();
    this.el = null;
    this.veil = null;
    this.label = null;
    this.seconds = null;
  }

  private ensure(): HTMLElement | null {
    if (this.el) return this.el;
    const layer = this.deps.layer();
    if (!layer) return null;
    const doc = layer.ownerDocument;
    // The water's veil first, under the badge.
    const veil = doc.createElement('div');
    veil.id = 'heart-quench-veil';
    veil.setAttribute('aria-hidden', 'true');
    layer.appendChild(veil);
    const el = doc.createElement('div');
    el.id = 'heart-quench-ice';
    el.className = 'ui-panel-strong heart-quench-ice is-ice';
    el.setAttribute('aria-hidden', 'true');
    const dial = doc.createElement('div');
    dial.className = 'hqi-dial';
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-12 -12 24 24');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    for (const k of Object.keys(GLYPHS) as QuenchIceState[]) {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', GLYPHS[k]);
      // Shown by the badge's state class (components.css), never a write here.
      path.setAttribute('class', `hqi-glyph hqi-glyph-${k}`);
      svg.appendChild(path);
    }
    dial.appendChild(svg);
    const label = doc.createElement('div');
    label.className = 'hqi-label';
    const seconds = doc.createElement('div');
    seconds.className = 'hqi-seconds';
    el.append(dial, label, seconds);
    layer.appendChild(el);
    this.el = el;
    this.veil = veil;
    this.label = label;
    this.seconds = seconds;
    return el;
  }
}
