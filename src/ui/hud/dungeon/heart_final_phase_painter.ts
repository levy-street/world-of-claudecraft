// The Masterless Strength's raid HUD: the thin painter of its phase readout
// (pure view: heart_final_phase_view.ts). A self-mounted panel at the top of
// the screen: part 2's heading, a foot line with the call's or the enrage's
// clock, the living Splinters and Vein-Shaken's seconds, and the poured
// elements. The Overload bars are the room's now (the ring round the central
// well, src/render/smith_heart_fx/final_overload_ring.ts). The skeleton is
// built once; every per-frame value rides the PainterHost elided writers, so
// a still frame writes nothing. It never takes the pointer.

import type { PainterHostWriters } from '../../painter_host';
import type { FinalPhaseView } from './heart_final_phase_view';

export interface HeartFinalPhaseDeps {
  /** The HUD layer the panel mounts into (null before the HUD exists). */
  layer: () => HTMLElement | null;
  writers: PainterHostWriters;
}

interface Slots {
  title: HTMLElement;
  shaken: HTMLElement;
  phase: HTMLElement;
  splinters: HTMLElement;
  poured: HTMLElement;
}

export class HeartFinalPhasePanel {
  private el: HTMLElement | null = null;
  private slots: Slots | null = null;

  constructor(private readonly deps: HeartFinalPhaseDeps) {}

  paint(view: FinalPhaseView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.el) w.setDisplay(this.el, 'none');
      return;
    }
    const el = this.ensure();
    const slots = this.slots;
    if (!el || !slots) return;
    w.setDisplay(el, 'flex');
    w.setText(slots.title, view.title);
    w.setStyleProp(slots.title, 'display', view.title ? 'block' : 'none');
    w.setText(slots.phase, view.phase);
    w.setStyleProp(slots.phase, 'display', view.phase ? 'inline' : 'none');
    w.toggleClass(slots.phase, 'is-urgent', view.phaseUrgent);
    w.setText(slots.splinters, view.splinters);
    w.setStyleProp(slots.splinters, 'display', view.splinters ? 'inline' : 'none');
    w.setText(slots.shaken, view.shaken);
    w.setStyleProp(slots.shaken, 'display', view.shaken ? 'inline' : 'none');
    w.setText(slots.poured, view.poured);
    w.setStyleProp(slots.poured, 'display', view.poured ? 'block' : 'none');
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
    this.slots = null;
  }

  private ensure(): HTMLElement | null {
    if (this.el) return this.el;
    const layer = this.deps.layer();
    if (!layer) return null;
    const doc = layer.ownerDocument;
    const el = doc.createElement('div');
    el.id = 'heart-final-phase';
    el.className = 'ui-panel-strong heart-final-phase';
    const title = doc.createElement('div');
    title.className = 'hfp-title ui-cin';
    const foot = doc.createElement('div');
    foot.className = 'hfp-foot';
    const phase = doc.createElement('span');
    phase.className = 'hfp-phase';
    const splinters = doc.createElement('span');
    splinters.className = 'hfp-splinters';
    const shaken = doc.createElement('span');
    shaken.className = 'hfp-shaken';
    foot.append(phase, splinters, shaken);
    const poured = doc.createElement('div');
    poured.className = 'hfp-poured';
    el.append(title, foot, poured);
    layer.appendChild(el);
    this.el = el;
    this.slots = { title, shaken, phase, splinters, poured };
    return el;
  }
}
