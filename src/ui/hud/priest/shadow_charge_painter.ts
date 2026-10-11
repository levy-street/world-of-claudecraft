import type { PainterHostWriters } from '../../painter_host';
import type { ShadowChargeState } from './shadow_charge_view';

export interface ShadowChargeElements {
  frame: HTMLElement;
  gloomRoot: HTMLElement;
  gloomCount: HTMLElement;
  gloomPips: readonly HTMLElement[];
  bombRoot: HTMLElement;
  bombFill: HTMLElement;
  bombOrbFill: HTMLElement;
  bombCount: HTMLElement;
  readyLabel: HTMLElement;
}

export class ShadowChargePainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly elements: ShadowChargeElements,
  ) {}

  paint(state: ShadowChargeState): void {
    const el = this.elements;
    this.writers.setDisplay(el.frame, state.visible ? 'flex' : 'none');
    this.writers.setAttr(el.frame, 'aria-hidden', state.visible ? 'false' : 'true');
    this.writers.setDisplay(el.bombRoot, state.bombVisible ? 'flex' : 'none');
    this.writers.setAttr(el.bombRoot, 'aria-hidden', state.bombVisible ? 'false' : 'true');
    this.writers.setText(el.gloomCount, state.gloomCount);
    this.writers.setAttr(el.gloomRoot, 'aria-valuenow', String(state.gloomtithe));
    this.writers.setAttr(el.gloomRoot, 'aria-valuetext', state.gloomStatus);
    for (let i = 0; i < el.gloomPips.length; i++) {
      this.writers.toggleClass(el.gloomPips[i], 'on', i < state.gloomtithe);
    }
    this.writers.setText(el.bombCount, state.bombCount);
    this.writers.setAttr(el.bombRoot, 'aria-valuenow', String(state.bombProgress));
    this.writers.setAttr(el.bombRoot, 'aria-valuetext', state.bombStatus);
    this.writers.setStyleProp(el.bombFill, '--priest-progress', state.bombFill.toFixed(3));
    this.writers.setTransform(el.bombOrbFill, `scaleY(${state.bombFill.toFixed(3)})`);
    this.writers.toggleClass(el.bombRoot, 'ready', state.ready);
    this.writers.toggleClass(el.frame, 'bomb-learned', state.bombVisible);
    this.writers.setStyleProp(el.readyLabel, 'visibility', state.ready ? 'visible' : 'hidden');
  }
}
