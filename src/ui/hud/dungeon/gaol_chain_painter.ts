// Gaoler Ossick's chain alert: the thin painter over gaol_chain_view.ts. A
// self-mounted panel in the Iron Cage prompt's slot (the two never share a
// fight), shown while a chain asks something of the local player: the title,
// the links left (an anchor's chain), the line saying what to do, the bar (the chain broken so far, or the
// shackle's reach used, drawn hot once the pair strains it). The skeleton is
// built once; every per-frame value rides the PainterHost elided writers, so a
// still frame writes nothing.

import type { PainterHostWriters } from '../../painter_host';
import type { GaolChainView } from './gaol_chain_view';

export interface GaolChainDeps {
  /** The HUD layer the panel mounts into (null before the HUD exists). */
  layer: () => HTMLElement | null;
  writers: PainterHostWriters;
}

interface Slots {
  title: HTMLElement;
  count: HTMLElement;
  line: HTMLElement;
  hint: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
}

const KINDS = ['anchored', 'ally', 'shackled', 'strained'] as const;

export class GaolChainAlert {
  private root: HTMLElement | null = null;
  private slots: Slots | null = null;

  constructor(private readonly deps: GaolChainDeps) {}

  paint(view: GaolChainView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.root) w.setDisplay(this.root, 'none');
      return;
    }
    const root = this.ensureRoot();
    const slots = this.slots;
    if (!root || !slots) return;
    w.setDisplay(root, 'flex');
    for (const k of KINDS) w.toggleClass(root, `is-${k}`, view.kind === k);
    w.setText(slots.title, view.title);
    w.setText(slots.count, view.count);
    w.setStyleProp(slots.count, 'display', view.count ? '' : 'none');
    w.setText(slots.line, view.line);
    w.setText(slots.hint, view.hint);
    w.setStyleProp(slots.hint, 'display', view.hint ? '' : 'none');
    w.setWidth(slots.fill, `${(view.progress * 100).toFixed(1)}%`);
    w.setAttr(slots.bar, 'aria-valuenow', String(Math.round(view.progress * 100)));
    w.setAttr(slots.bar, 'aria-valuetext', view.progressAria);
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.slots = null;
  }

  private ensureRoot(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const doc = layer.ownerDocument;
    const root = doc.createElement('div');
    root.id = 'bastion-chain-alert';
    root.className = 'ui-panel-strong bastion-chain-alert';
    const title = doc.createElement('div');
    title.className = 'bca-title ui-cin';
    const count = doc.createElement('div');
    count.className = 'bca-count ui-cin';
    const line = doc.createElement('div');
    line.className = 'bca-line';
    const hint = doc.createElement('div');
    hint.className = 'bca-hint';
    const bar = doc.createElement('div');
    bar.className = 'ui-bar bca-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    const fill = doc.createElement('div');
    fill.className = 'ui-bar-fill bca-fill';
    bar.append(fill);
    root.append(title, count, line, bar, hint);
    layer.appendChild(root);
    this.root = root;
    this.slots = { title, count, line, bar, fill, hint };
    return root;
  }
}
