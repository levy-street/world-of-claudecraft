// Bounded in-memory trail of store-window visibility flips, readable from the
// browser console as window.wocStoreStackDiag(). Field diagnostic for the
// intermittent opaque black rectangle over the play area: the best-evidence
// hypothesis is a stranded compositor layer of #claudium-window or
// #daily-rewards-window, which no DOM probe can observe after the fact. This
// trail lets a report be correlated with the store lifecycle ("a store window
// closed moments before the rectangle appeared") without any server round
// trip. Dev-channel only: nothing here is player-facing.

export interface StoreStackSample {
  at: number; // Date.now() at the transition
  store: boolean; // #daily-rewards-window visible
  claudium: boolean; // #claudium-window visible
  stacked: boolean; // both visible at once (the old body.store-stack-open state)
}

const MAX_SAMPLES = 40;

export class StoreStackDiag {
  private readonly samples: StoreStackSample[] = [];

  /** Append a sample; identical consecutive states collapse into one entry. */
  record(store: boolean, claudium: boolean, stacked: boolean, at: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && last.store === store && last.claudium === claudium && last.stacked === stacked) {
      return;
    }
    this.samples.push({ at, store, claudium, stacked });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  trail(): readonly StoreStackSample[] {
    return this.samples;
  }
}

const diag = new StoreStackDiag();
let installed = false;

/** HUD hook: one call per visibility sync, self-installs the console reader. */
export function recordStoreStackSample(store: boolean, claudium: boolean, stacked: boolean): void {
  diag.record(store, claudium, stacked, Date.now());
  if (!installed && typeof window !== 'undefined') {
    installed = true;
    (
      window as unknown as { wocStoreStackDiag?: () => readonly StoreStackSample[] }
    ).wocStoreStackDiag = () => diag.trail();
  }
}
