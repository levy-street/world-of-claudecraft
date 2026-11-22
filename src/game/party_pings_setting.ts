// The "Enable Pings" preference (settings.partyPings, default on), read on the
// hot paths that gate every ping surface: the ping key and wheel (sending is
// blocked client-side while it is off) and everything others' pings draw for
// this player (the world icon, the sound, the chat line, the minimap mark).
// A client-side preference only: the server still delivers the group's pings,
// this player's client simply shows none of them.
//
// CACHED like tapMenusEnabled (src/ui/hud/tap_menu.ts), because the renderer
// asks every frame: building a Settings re-reads localStorage. The cache drops
// on every persisted settings write (Settings.save broadcasts
// SETTINGS_CHANGE_EVENT), so the options row takes effect without a reload.
// With no window (a Node test) nothing is cached and every call reads fresh.

import { SETTINGS_CHANGE_EVENT, Settings } from './settings';

let cached: boolean | null = null;
let watching = false;

export function partyPingsEnabled(): boolean {
  if (typeof window === 'undefined') return new Settings().get('partyPings');
  if (!watching) {
    watching = true;
    window.addEventListener(SETTINGS_CHANGE_EVENT, () => {
      cached = null;
    });
  }
  if (cached === null) cached = new Settings().get('partyPings');
  return cached;
}
