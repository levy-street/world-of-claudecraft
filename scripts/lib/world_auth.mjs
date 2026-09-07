// Node-side WebSocket clients cannot import the TypeScript world API directly.
// Keep this discriminator in lockstep with src/world_api.ts; the paired Vitest
// freshness contract fails whenever the authoritative layout epoch changes.
export const ONLINE_WORLD_AUTH_TYPE = 'auth-world-29';

// The rejection the server sends when the discriminator above is NOT the epoch
// it speaks. Mirrors ONLINE_WORLD_INCOMPATIBLE_MESSAGE in src/world_api.ts and
// is held byte-identical by the same freshness contract; the OTA layout preflight
// (scripts/ota/check_server_layout.mjs) reads it to tell an epoch mismatch apart
// from an ordinary auth rejection.
export const ONLINE_WORLD_INCOMPATIBLE_MESSAGE =
  'Game and server versions are incompatible. Reload or update, then try again.';

// The movement wire is a REQUIRED capability: server/ws_auth.ts refuses a
// handshake that does not offer this exact number with the incompatible message
// above, BEFORE it looks at the token. Keep it in lockstep with
// MOVEMENT_WIRE_VERSION in src/world_api.ts (same freshness contract as the
// discriminator). Omitting it here would reject every Node client, and would
// make the OTA layout preflight read a healthy server as an epoch mismatch.
export const MOVEMENT_WIRE_VERSION = 2;

export function worldAuthMessage(token, character) {
  return { t: ONLINE_WORLD_AUTH_TYPE, token, character, movementWire: MOVEMENT_WIRE_VERSION };
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

/** The fixed client tick the real client samples on (src/game/input_tick_sampler.ts). */
export const MOVEMENT_FRAME_INTERVAL_MS = 50;

/**
 * A Node client's movement send path. The server consumes movement off a
 * per-tick timeline keyed on `ct` (server/movement_input_timeline_v2.ts): a
 * frame WITHOUT `ct` is parsed, counted against the rate limits, and then never
 * enqueued, so a bare `{ t: 'input', mi }` moves nobody and never advances
 * `lastInputAt`. Node clients therefore stream the same shape the real client
 * does: one frame per fixed tick, carrying a monotone `ct` from 0.
 *
 * The stream HOLDS the last intent and heading, so a held intent keeps the bot
 * moving until `set({})` or `stop()`, exactly like the client's unconditional
 * per-tick frames. `set` also emits at once so a latency-sensitive script keeps
 * its timing, and restarts the tick phase from that instant so the steady rate
 * stays one frame per tick rather than doubling on every change.
 *
 * `send` is the script's own frame sender (its `send`/`ws.send` wrapper).
 */
export function createMovementInputStream(send) {
  let clientTick = 0;
  let moveInput = {};
  let facing;
  let timer = null;
  const emit = () => {
    send({
      t: 'input',
      ct: clientTick++,
      mi: moveInput,
      ...(facing !== undefined ? { facing } : {}),
    });
  };
  const arm = () => {
    timer = setInterval(emit, MOVEMENT_FRAME_INTERVAL_MS);
    // Never hold the process open: a script that is done must be able to exit
    // without an explicit stop() on every path out.
    timer.unref?.();
  };
  return {
    start() {
      if (timer) return;
      arm();
    },
    set(nextMoveInput = {}, nextFacing = undefined) {
      moveInput = nextMoveInput;
      facing = nextFacing;
      emit();
      if (timer) {
        clearInterval(timer);
        arm();
      }
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
