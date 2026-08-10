import type { PainterHostWriters } from './painter_host';
import type { PaladinDevotionState } from './paladin_devotion_view';

const READY_CLASS = 'ready';
const ASCENDED_CLASS = 'ascended';
const LAST_CHARGE_CLASS = 'last-charge';
const CHARGE_ACTIVE_CLASS = 'on';

export class PaladinDevotionPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly frame: HTMLElement,
    private readonly root: HTMLElement,
    private readonly fill: HTMLElement,
    private readonly label: HTMLElement,
    private readonly charges: HTMLCollection,
    private readonly status: HTMLElement,
  ) {}

  paint(state: PaladinDevotionState): void {
    this.writers.setDisplay(this.frame, state.visible ? 'flex' : 'none');
    this.writers.setStyleProp(this.fill, '--devotion-scale', state.fillFrac.toFixed(3));
    this.writers.setText(this.label, state.label);
    this.writers.setAttr(this.root, 'aria-valuenow', String(state.value));
    this.writers.setAttr(this.root, 'aria-valuetext', state.ariaValueText);
    this.writers.setText(this.status, state.announcement);
    this.writers.toggleClass(this.root, READY_CLASS, state.ready);
    this.writers.toggleClass(this.root, ASCENDED_CLASS, state.ascended);
    this.writers.toggleClass(this.root, LAST_CHARGE_CLASS, state.lastCharge);
    for (let index = 0; index < this.charges.length; index++) {
      this.writers.toggleClass(
        this.charges[index] as HTMLElement,
        CHARGE_ACTIVE_CLASS,
        state.ascended && index < state.charges,
      );
    }
  }
}
