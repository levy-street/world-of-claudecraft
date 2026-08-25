// The one shared entry into the wallet connect/verify flow.
//
// main.ts owns the woc:wallet-verify listener and the whole connect/verify
// arc; every HUD surface that offers a connect button (bags, daily rewards,
// the WOC Store, the Exchange banner) dispatches through here so the event
// name cannot drift per caller. Extracted from hud.ts on the rule of three
// (the Exchange banner was the fourth copy of the dispatch).

export function requestWalletVerify(): void {
  window.dispatchEvent(new CustomEvent('woc:wallet-verify'));
}
