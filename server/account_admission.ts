// Process-local admission fencing. A disconnect must also cancel handshakes
// that authenticated earlier but have not joined the live client collection.
// Only active handshakes are retained, never bearers or historical account IDs.
interface Authority {
  accountId: number;
  scope: string;
}

export class AccountAdmissionTracker {
  private readonly pending = new Map<number, Set<{ valid: boolean }>>();

  get activeAccounts(): number {
    return this.pending.size;
  }

  begin(accountId: number) {
    let group = this.pending.get(accountId);
    if (!group) {
      group = new Set();
      this.pending.set(accountId, group);
    }
    const probe = { valid: true };
    group.add(probe);
    return {
      // Call synchronously AFTER the last awaited token read. The read may
      // return an older snapshot even though disconnect invalidated this probe.
      allows: (authority: Authority | null): boolean =>
        probe.valid && authority?.accountId === accountId && authority.scope === 'full',
      release: (): void => {
        probe.valid = false;
        group.delete(probe);
        if (group.size === 0 && this.pending.get(accountId) === group) {
          this.pending.delete(accountId);
        }
      },
    };
  }

  invalidate(accountId: number): void {
    for (const probe of this.pending.get(accountId) ?? []) probe.valid = false;
  }
}

// Scope the fence to the GameServer object, shared by ws_auth and disconnect.
// A WeakMap avoids retaining a disposed realm instance or coupling the pure
// tracker to the GameServer module. This does not broadcast across processes.
const trackers = new WeakMap<object, AccountAdmissionTracker>();

export function accountAdmissionsFor(game: object): AccountAdmissionTracker {
  let tracker = trackers.get(game);
  if (!tracker) {
    tracker = new AccountAdmissionTracker();
    trackers.set(game, tracker);
  }
  return tracker;
}
