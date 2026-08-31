import { kickStoragePurchaseRecovery } from './storage_purchases';

/**
 * Bounded, allocation-free traversal of the live session table for recovery
 * keys that could not fit in the keyed coordinator. The source remains owned
 * by GameServer; this class retains only its current iterator.
 */
interface RecoverySession {
  characterId: number;
  left: boolean;
  storageRecoveryAdmissionPending?: boolean;
}

export class StorageRecoverySessionSweep<Session extends RecoverySession> {
  private iterator: Iterator<Session> | null = null;

  constructor(
    private readonly sessions: ReadonlyMap<unknown, Session>,
    private readonly perTurn = 2,
  ) {}

  run(): void {
    this.iterator ??= this.sessions.values();
    for (let checked = 0; checked < this.perTurn; checked++) {
      const next = this.iterator.next();
      if (next.done) {
        this.iterator = null;
        return;
      }
      if (!next.value.left && next.value.storageRecoveryAdmissionPending) {
        // viaSweep marks this as the throttled retry lane: a saturated
        // coordinator costs at most one host construction per character per
        // SWEEP_KICK_RETRY_MS from here; login/settle kicks stay immediate.
        kickStoragePurchaseRecovery(next.value.characterId, { viaSweep: true });
      }
    }
  }
}
