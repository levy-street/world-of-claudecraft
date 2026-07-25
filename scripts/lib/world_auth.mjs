// Node-side WebSocket clients cannot import the TypeScript world API directly.
// Keep this discriminator in lockstep with src/world_api.ts; the paired Vitest
// freshness contract fails whenever the authoritative layout epoch changes.
export const ONLINE_WORLD_AUTH_TYPE = 'auth-world-3';

export function worldAuthMessage(token, character) {
  return { t: ONLINE_WORLD_AUTH_TYPE, token, character };
}
