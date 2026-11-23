interface FlairCommandState {
  nextAllowed: WeakMap<object, number>;
  activeAccounts: Set<number>;
}

const hosts = new WeakMap<object, FlairCommandState>();

/** Bound settings reads/writes without queuing work behind a slow database. */
export function acquireFlairCommand(
  host: object,
  session: { accountId: number },
  nowSec: number,
): (() => void) | null {
  let state = hosts.get(host);
  if (!state) {
    state = { nextAllowed: new WeakMap(), activeAccounts: new Set() };
    hosts.set(host, state);
  }
  if (
    nowSec < (state.nextAllowed.get(session) ?? -Infinity) ||
    state.activeAccounts.has(session.accountId)
  ) {
    return null;
  }
  state.nextAllowed.set(session, nowSec + 1);
  state.activeAccounts.add(session.accountId);
  return () => state.activeAccounts.delete(session.accountId);
}
