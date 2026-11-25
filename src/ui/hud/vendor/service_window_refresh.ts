// The service-window family's slow-band refresh latch: the copper vendor,
// the heroic, crucible and WARFARE quartermasters, the training ladder and
// the unbind list. Every one of them is a full-subtree painter Hud repaints
// through repaintOpenServiceWindows, but before this latch only their own
// action events and the online inventory hook reached that repaint, so an
// open window priced against a snapshot: offline loot copper, honor gained
// online, a reputation step or a quest accept never re-priced it, and a train
// Learn lost to a disconnect stayed disabled past its TTL until something
// else moved.
//
// The signature (service_window_refresh_core.ts) is built ONLY while some
// service window is shown.
//
// The latch never rebuilds under a live interaction: an open custom-amount
// buy prompt (it holds the vendor root inert) or a purchase / unbind confirm
// dialog skips the poll WITHOUT moving the latch, so the next poll after it
// closes catches up.

import {
  type ServiceTrainLearns,
  type ServiceWindowWorld,
  serviceWindowSig,
} from './service_window_refresh_core';

/** The service-window roots, each shown with `display: block`. The three
 *  shop tenants share `#vendor-window`. */
const SERVICE_ROOT_IDS = ['vendor-window', 'warfare-window', 'train-window', 'unbind-window'];

/** Whether any service-window root is shown. */
export function serviceWindowShown(doc: Document = document): boolean {
  return SERVICE_ROOT_IDS.some((id) => doc.getElementById(id)?.style.display === 'block');
}

/** A live interaction a rebuild must not run under: the custom-amount buy
 *  prompt or the shared confirm dialog (purchase and unbind confirms). */
function serviceInteractionOpen(doc: Document = document): boolean {
  return (
    doc.querySelector('.buy-quantity-prompt') !== null ||
    doc.getElementById('confirm-dialog') !== null
  );
}

export class ServiceWindowRefresh {
  private lastSig: string | null = null;
  /** True while refreshIfChanged's own repaint runs: the signature it just
   *  latched is current, so the repaint's relatch skips a second build. */
  private repainting = false;

  /** `repaint` is Hud.repaintOpenServiceWindows, which re-latches through
   *  {@link relatch}, so an explicit repaint never earns a second rebuild. */
  constructor(private readonly repaint: () => void) {}

  /** The slow-band poll: repaint the open family when its data moved.
   *  Returns whether it repainted. */
  refreshIfChanged(world: ServiceWindowWorld, learns: ServiceTrainLearns, nowMs: number): boolean {
    if (!serviceWindowShown()) {
      this.lastSig = null;
      return false;
    }
    if (serviceInteractionOpen()) return false;
    const sig = serviceWindowSig(world, learns, nowMs);
    if (sig === this.lastSig) return false;
    this.lastSig = sig;
    this.repainting = true;
    try {
      this.repaint();
    } finally {
      this.repainting = false;
    }
    return true;
  }

  /** Re-latch after an explicit repaint (the action events, the inventory
   *  hook, the language switch), so the next poll does not rebuild again. */
  relatch(world: ServiceWindowWorld, learns: ServiceTrainLearns, nowMs: number): void {
    if (this.repainting) return;
    this.lastSig = serviceWindowShown() ? serviceWindowSig(world, learns, nowMs) : null;
  }
}
