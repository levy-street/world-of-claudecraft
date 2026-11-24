import type { PainterHostWriters } from '../../painter_host';
import type { TideOrbsState } from './tide_orbs_view';

export interface TideOrbsElements {
  frame: HTMLElement;
  sunRoot: HTMLElement;
  sunOrbs: readonly HTMLElement[];
  moonRoot: HTMLElement;
  moonOrbs: readonly HTMLElement[];
  gem: HTMLElement;
}

export class TideOrbsPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly elements: TideOrbsElements,
  ) {}

  paint(state: TideOrbsState): void {
    const el = this.elements;
    const w = this.writers;
    w.setDisplay(el.frame, state.visible ? 'flex' : 'none');
    w.setAttr(el.frame, 'aria-hidden', state.visible ? 'false' : 'true');
    if (!state.visible) return;
    w.setAttr(el.sunRoot, 'aria-valuenow', String(state.suntide));
    w.setAttr(el.sunRoot, 'aria-valuetext', state.sunStatus);
    w.setAttr(el.moonRoot, 'aria-valuenow', String(state.moontide));
    w.setAttr(el.moonRoot, 'aria-valuetext', state.moonStatus);
    for (let i = 0; i < el.sunOrbs.length; i++) {
      w.toggleClass(el.sunOrbs[i], 'on', i < state.suntide);
    }
    for (let i = 0; i < el.moonOrbs.length; i++) {
      w.toggleClass(el.moonOrbs[i], 'on', i < state.moontide);
    }
    w.toggleClass(el.sunRoot, 'full', state.suntide >= el.sunOrbs.length);
    w.toggleClass(el.moonRoot, 'full', state.moontide >= el.moonOrbs.length);
    w.toggleClass(el.gem, 'sun', state.window === 'sun');
    w.toggleClass(el.gem, 'moon', state.window === 'moon');
    w.setAttr(el.gem, 'aria-label', state.windowStatus);
    w.setStyleProp(el.gem, '--tide-window-left', state.windowLeft.toFixed(3));
  }
}
