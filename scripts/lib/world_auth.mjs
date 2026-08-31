// Node-side WebSocket clients cannot import the TypeScript world API directly.
// Keep this discriminator in lockstep with src/world_api.ts; the paired Vitest
// freshness contract fails whenever the authoritative layout epoch changes.
export const ONLINE_WORLD_AUTH_TYPE = 'auth-world-25';

// The rejection the server sends when the discriminator above is NOT the epoch
// it speaks. Mirrors ONLINE_WORLD_INCOMPATIBLE_MESSAGE in src/world_api.ts and
// is held byte-identical by the same freshness contract; the OTA layout preflight
// (scripts/ota/check_server_layout.mjs) reads it to tell an epoch mismatch apart
// from an ordinary auth rejection.
export const ONLINE_WORLD_INCOMPATIBLE_MESSAGE =
  'Game and server versions are incompatible. Reload or update, then try again.';

export function worldAuthMessage(token, character) {
  return { t: ONLINE_WORLD_AUTH_TYPE, token, character };
}

// Chat, and every "/dev ..." cheat that rides it, is a COMMAND, not a frame
// type: the server's `case 'chat'` sits in the cmd switch (server/game.ts), so
// a top-level { t: 'chat' } frame matches nothing and is dropped in silence,
// leaving the script believing its bots were levelled, geared or god-moded.
// The live client sends `this.cmd({ cmd: 'chat', text })` (src/net/online.ts);
// Node clients speak the same shape through here.
export function chatCommandMessage(text) {
  return { t: 'cmd', cmd: 'chat', text };
}
