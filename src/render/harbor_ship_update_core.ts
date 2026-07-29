import {
  type DeckStandInRuntimeHandle,
  deckStandInAction,
  disposeDeckStandIn,
} from './harbor_deck_stand_in_core';

export interface HarborShipUpdaterOptions<
  TPlayer,
  TVisual,
  THandle extends DeckStandInRuntimeHandle<TVisual>,
> {
  handles: () => Iterable<THandle>;
  isRealLocalPlayer: (player: TPlayer) => boolean;
  createStandIn: (handle: THandle, player: TPlayer) => TVisual | null;
  updateStandIn: (visual: TVisual, dt: number) => void;
  disposeStandIn: (visual: TVisual) => void;
  updateMotion: (handle: THandle) => void;
}

/**
 * Bind the per-frame harbor updater once. All callbacks are stable module-time
 * dependencies, so the returned render hot path allocates no closures and
 * traverses the ship registry only once per frame.
 */
export function createHarborShipUpdater<
  TPlayer,
  TVisual,
  THandle extends DeckStandInRuntimeHandle<TVisual>,
>(
  options: HarborShipUpdaterOptions<TPlayer, TVisual, THandle>,
): (player: TPlayer, dt: number) => boolean {
  return (player, dt) => {
    const realLocalPlayer = options.isRealLocalPlayer(player);
    let standInActive = false;
    for (const handle of options.handles()) {
      const cueLive = handle.cueStartSec !== null && handle.segment !== null;
      const action = deckStandInAction(cueLive, handle.deckStandIn !== null, realLocalPlayer);
      if (action === 'build') handle.deckStandIn = options.createStandIn(handle, player);
      else if (action === 'dispose') disposeDeckStandIn(handle, options.disposeStandIn);
      if (handle.deckStandIn) {
        standInActive = true;
        options.updateStandIn(handle.deckStandIn, dt);
      }
      options.updateMotion(handle);
    }
    return standInActive;
  };
}
