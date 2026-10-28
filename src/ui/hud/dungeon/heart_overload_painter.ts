// The Masterless Strength's raid HUD: the thin painter of the four Overload
// bars (pure view: heart_overload_view.ts). A self-mounted panel at the top
// of the screen, under the target frame's row: a title, one row per quarter
// (its name, its bar, its percent; the quarter the boss drinks highlighted in
// its vein's colour, a bar near bursting throbbing), and a foot line with
// Taking Root's seconds (or that the boss can be dragged), Vein-Shaken's and
// Heart Unbound's; part 2's call and Splinters, the enrage or the fury, the
// poured elements (the bars held through an intermission, off in the final
// phase). The skeleton is built once; every per-frame value rides
// the PainterHost elided writers, so a still frame writes nothing. It never
// takes the pointer.

import type { PainterHostWriters } from '../../painter_host';
import type { OverloadView } from './heart_overload_view';

export interface HeartOverloadDeps {
  /** The HUD layer the panel mounts into (null before the HUD exists). */
  layer: () => HTMLElement | null;
  writers: PainterHostWriters;
}

interface RowSlots {
  row: HTMLElement;
  label: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  pct: HTMLElement;
}

interface Slots {
  title: HTMLElement;
  rows: RowSlots[];
  root: HTMLElement;
  shaken: HTMLElement;
  unbound: HTMLElement;
  phase: HTMLElement;
  splinters: HTMLElement;
  poured: HTMLElement;
}

export class HeartOverloadPanel {
  private el: HTMLElement | null = null;
  private slots: Slots | null = null;

  constructor(private readonly deps: HeartOverloadDeps) {}

  paint(view: OverloadView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.el) w.setDisplay(this.el, 'none');
      return;
    }
    const el = this.ensure(view.rows);
    const slots = this.slots;
    if (!el || !slots) return;
    w.setDisplay(el, 'flex');
    w.setAttr(el, 'aria-label', view.groupAria);
    w.setText(slots.title, view.title);
    w.toggleClass(el, 'is-frozen', view.frozen);
    w.toggleClass(el, 'is-off', view.barsOff);
    view.rows.forEach((r, i) => {
      const s = slots.rows[i];
      if (!s) return;
      w.toggleClass(s.row, 'is-active', r.active);
      w.toggleClass(s.row, 'is-danger', r.danger);
      w.toggleClass(s.row, 'is-awake', r.awake);
      w.setText(s.label, r.label);
      w.setText(s.pct, `${r.pct}%`);
      w.setWidth(s.fill, `${r.pct}%`);
      w.setAttr(s.bar, 'aria-valuenow', String(r.pct));
      w.setAttr(s.bar, 'aria-valuetext', r.aria);
    });
    w.toggleClass(slots.root, 'is-rooted', view.rooted);
    w.setText(slots.root, view.root);
    w.setStyleProp(slots.root, 'display', view.root ? 'inline' : 'none');
    w.setText(slots.phase, view.phase);
    w.setStyleProp(slots.phase, 'display', view.phase ? 'inline' : 'none');
    w.toggleClass(slots.phase, 'is-urgent', view.phaseUrgent);
    w.setText(slots.splinters, view.splinters);
    w.setStyleProp(slots.splinters, 'display', view.splinters ? 'inline' : 'none');
    w.setText(slots.poured, view.poured);
    w.setStyleProp(slots.poured, 'display', view.poured ? 'block' : 'none');
    w.setText(slots.shaken, view.shaken);
    w.setStyleProp(slots.shaken, 'display', view.shaken ? 'inline' : 'none');
    w.setText(slots.unbound, view.unbound);
    w.setStyleProp(slots.unbound, 'display', view.unbound ? 'inline' : 'none');
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
    this.slots = null;
  }

  private ensure(veins: readonly { vein: string }[]): HTMLElement | null {
    if (this.el) return this.el;
    const layer = this.deps.layer();
    if (!layer) return null;
    const doc = layer.ownerDocument;
    const el = doc.createElement('div');
    el.id = 'heart-overload';
    el.className = 'ui-panel-strong heart-overload';
    el.setAttribute('role', 'group');
    const title = doc.createElement('div');
    title.className = 'ho-title ui-cin';
    const list = doc.createElement('div');
    list.className = 'ho-rows';
    const rows: RowSlots[] = [];
    for (const { vein } of veins) {
      const row = doc.createElement('div');
      row.className = `ho-row is-${vein}`;
      const label = doc.createElement('span');
      label.className = 'ho-label';
      const bar = doc.createElement('div');
      bar.className = 'ui-bar ho-bar';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      const fill = doc.createElement('div');
      fill.className = 'ui-bar-fill ho-fill';
      bar.append(fill);
      const pct = doc.createElement('span');
      pct.className = 'ho-pct';
      row.append(label, bar, pct);
      list.append(row);
      rows.push({ row, label, bar, fill, pct });
    }
    const foot = doc.createElement('div');
    foot.className = 'ho-foot';
    const root = doc.createElement('span');
    root.className = 'ho-root';
    const shaken = doc.createElement('span');
    shaken.className = 'ho-shaken';
    const unbound = doc.createElement('span');
    unbound.className = 'ho-unbound';
    const phase = doc.createElement('span');
    phase.className = 'ho-phase';
    const splinters = doc.createElement('span');
    splinters.className = 'ho-splinters';
    foot.append(phase, splinters, root, shaken, unbound);
    const poured = doc.createElement('div');
    poured.className = 'ho-poured';
    el.append(title, list, foot, poured);
    layer.appendChild(el);
    this.el = el;
    this.slots = { title, rows, root, shaken, unbound, phase, splinters, poured };
    return el;
  }
}
