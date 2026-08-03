// How often the bot's background loops run.
//
// These live outside main.ts because main.ts calls main() at module scope, so a
// test cannot import a constant from there without booting the whole bot (real
// env, real Discord REST, a real WebSocket). Keeping them here lets the suite
// pin the cadences directly.
//
// Values only: no env parsing, no derived timers. As of Phase 3 the runtime
// consumer is bot/config.ts, which layers the D13 env overrides on top of these
// as its fallbacks (main.ts reads the resolved BotConfig fields, never these
// constants); the suite still imports them directly to pin them.

export const ROLE_SYNC_INTERVAL_MS = 5 * 60_000;
export const PRESENCE_DEBOUNCE_MS = 4_000;

/**
 * The consolidated outbox poll, ACTIVE: how often the bot picks up queued work
 * (in-game "!" posts, the activity feed, reward-winner days, link changes) while
 * there is any. It is the cadence the three separate 3 s poll loops it replaces
 * each ran at, so a busy bot delivers exactly as promptly as before on a quarter
 * of the requests.
 */
export const OUTBOX_POLL_MS = 3_000;

/**
 * The same poll, IDLE: where the cadence decays to once the drains come back
 * empty (D1). This is the first task to use the scheduler's active-to-idle
 * backoff, and the pair is the point: a bot with nothing queued costs a wake
 * every fifteen seconds instead of twenty polls a minute, and the first item to
 * arrive snaps it straight back to OUTBOX_POLL_MS, so the quiet-hours saving
 * costs no latency at all when something finally happens.
 */
export const OUTBOX_IDLE_MS = 15_000;

/**
 * How long the linked-member sweep waits between SLICES while a pass is live.
 *
 * The pass itself still runs every ROLE_SYNC_INTERVAL_MS; this is the pacing
 * INSIDE one, and it is what turns the sweep from a single burst into a spread.
 * The old sweep asked about every online member in one tick, so a thousand
 * concurrent players meant a thousand reads and up to a thousand Discord writes
 * queued at once; at this cadence one pass over the same population is a few
 * hundred requests spread across a couple of minutes, which the rate governor
 * can pace without ever reaching its queue depth.
 */
export const SWEEP_SLICE_MS = 3_000;

/**
 * How often the bot re-stamps its liveness file (D15).
 *
 * It is the fastest loop the bot runs, and it costs one small local write: the
 * file's mtime is the container healthcheck's only evidence that the scheduler
 * is still turning, so the interval sets how quickly a wedged bot is noticed.
 * The stale window the healthcheck compares against is deliberately several of
 * these, so a single slow tick is never mistaken for a dead process.
 */
export const HEARTBEAT_INTERVAL_MS = 30_000;
