// Per-item isolation for the server's hot loops. The 50 ms tick callback and the
// snapshot/event broadcast loops iterate every session unguarded, so a throw while
// building or routing for one player's state unwinds the whole call and starves
// every remaining session of snapshots/events for that tick. A condition that
// persistently throws for one player would starve all players until that player
// disconnects, which violates "one socket must not be able to crash the loop"
// (server/CLAUDE.md). Run each item's body in its own try/catch: log and skip just
// that item, never the rest.

// Run `body` for every item, isolating each iteration. A throw in one item's body
// is handed to `onError` (log and skip) and never stops the remaining items.
export function forEachGuarded<T>(
  items: Iterable<T>,
  body: (item: T) => void,
  onError: (err: unknown, item: T) => void,
): void {
  for (const item of items) {
    try {
      body(item);
    } catch (err) {
      onError(err, item);
    }
  }
}

// Run a single body in its own try/catch. A throw is handed to `onError` instead
// of propagating, so a transient failure self-heals on the next call.
export function runGuarded(body: () => void, onError: (err: unknown) => void): void {
  try {
    body();
  } catch (err) {
    onError(err);
  }
}
