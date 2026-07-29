// Node-side WebSocket clients cannot import the TypeScript world API directly.
// Keep this discriminator in lockstep with src/world_api.ts; the paired Vitest
// freshness contract fails whenever the authoritative layout epoch changes.
export const ONLINE_WORLD_AUTH_TYPE = 'auth-world-5';

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
