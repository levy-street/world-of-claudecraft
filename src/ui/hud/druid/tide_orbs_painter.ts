import type { PainterHostWriters } from '../../painter_host';
import type { TideOrbsState, TidePlace } from './tide_orbs_view';

const TIDE_PLACES: readonly TidePlace[] = ['top', 'below'];

export interface TideOrbsElements {
  frame: HTMLElement;
  sunRoot: HTMLElement;
  sunOrbs: readonly HTMLElement[];
  moonRoot: HTMLElement;
  moonOrbs: readonly HTMLElement[];
  gem: HTMLElement;
  /** The screen-edge glow overlay (shown only under the tidewheel-edge-glow
   *  body class, see hud.druid.css). */
  edge: HTMLElement;
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
    w.toggleClass(el.edge, 'on', state.visible);
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
    // A bank at 3 or more has its payoff ready: its orbs breathe and the
    // edge pulses once as it gets there.
    const sunReady = state.sunReady;
    const moonReady = state.moonReady;
    w.toggleClass(el.sunRoot, 'ready', sunReady);
    w.toggleClass(el.moonRoot, 'ready', moonReady);
    // Eclipse layout: the bank on top sits full size above the gem, the
    // other small below it.
    for (const place of TIDE_PLACES) {
      w.toggleClass(el.sunRoot, `place-${place}`, state.sunPlace === place);
      w.toggleClass(el.moonRoot, `place-${place}`, state.moonPlace === place);
    }
    w.toggleClass(el.frame, 'charging-sun', state.next === 'sun');
    w.toggleClass(el.frame, 'charging-moon', state.next === 'moon');
    // The gem shows the spell to cast next, in that spell's color: Skyfall
    // (moon) during Sunrise, Wildbolt (sun) during Moonrise.
    w.toggleClass(el.gem, 'sun', state.next === 'sun');
    w.toggleClass(el.gem, 'moon', state.next === 'moon');
    w.setAttr(el.gem, 'aria-label', state.windowStatus);
    w.setStyleProp(el.gem, '--tide-window-left', state.windowLeft.toFixed(3));
    w.toggleClass(el.edge, 'sun', state.next === 'sun');
    w.toggleClass(el.edge, 'moon', state.next === 'moon');
    w.setStyleProp(el.edge, '--tide-edge-strength', state.edgeStrength.toFixed(3));
    // A faint flash plays once as a payoff becomes ready, a strong one as the
    // bank caps (each class re-adds, and so replays, every time the bank
    // reaches that count again).
    w.toggleClass(el.edge, 'ready-sun', sunReady);
    w.toggleClass(el.edge, 'ready-moon', moonReady);
    w.toggleClass(el.edge, 'max-sun', state.sunMax);
    w.toggleClass(el.edge, 'max-moon', state.moonMax);
  }
}
