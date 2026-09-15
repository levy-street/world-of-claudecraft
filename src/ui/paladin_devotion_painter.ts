import type { PainterHostWriters } from './painter_host';
import type { PaladinDevotionState } from './paladin_devotion_view';
import { DEVOTION_LAST_CHARGE_CLASS } from './root_state_classes';

const READY_CLASS = 'ready';
const ASCENDED_CLASS = 'ascended';
const LAST_CHARGE_CLASS = 'last-charge';
const CHARGE_ACTIVE_CLASS = 'on';
/** Stamped on the frame's HUD host while the medallion is live, so the cross
 *  hotbar can part its halves and seat the medallion as its keystone in pad mode. */
const HOST_LIVE_CLASS = 'devotion-live';

export class PaladinDevotionPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly frame: HTMLElement,
    private readonly root: HTMLElement,
    private readonly fill: HTMLElement,
    private readonly label: HTMLElement,
    private readonly charges: HTMLCollection,
    private readonly status: HTMLElement,
  ) {
    this.host = frame.parentElement ?? frame;
    this.body = frame.ownerDocument.body;
  }

  private readonly host: HTMLElement;
  /** The action bar's empowered buttons read the last-charge state off body
   *  (they sit outside the medallion), so the painter stamps it there too. */
  private readonly body: HTMLElement;

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
    this.writers.toggleClass(this.host, HOST_LIVE_CLASS, state.visible);
    this.writers.toggleClass(this.body, DEVOTION_LAST_CHARGE_CLASS, state.lastCharge);
  }
}
