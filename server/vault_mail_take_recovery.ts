// Heal an emptied in-memory vault letter after its paired save failed and a
// fresh character session loaded the durable pre-take character snapshot.

import type { VaultMailRecoveryLetter } from '../src/sim/mail/post_office';
import type { Sim } from '../src/sim/sim';
import { pool } from './db';
import { REALM } from './realm';
import { loadVaultMailRecovery } from './vault_mail_recovery_db';
import type { VaultMailTakeGuard } from './vault_mail_take_guard';

const RETRY_MS = 5_000;
const PERMIT_WAIT_MS = 10_000;
const MAX_ACTIVE = 2;
const MAX_QUEUED = 64;

export class VaultMailTakeRecovery {
  private readonly inFlight = new Set<number>();
  private readonly queued = new Map<number, { ref: string; nextAt: number }>();
  // Lightweight IDs only, bounded by the guard's already-blocked characters.
  // Unlike permit waiters, overflow must remain eligible without another login.
  private readonly overflow = new Set<number>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private refused = 0;

  constructor(
    private readonly guard: VaultMailTakeGuard,
    private readonly sim: () => Sim,
    private readonly withPermit: <T>(run: () => Promise<T>, signal?: AbortSignal) => Promise<T>,
    private readonly load: (
      characterId: number,
      custodyRef: string,
    ) => Promise<VaultMailRecoveryLetter | null> = (characterId, custodyRef) =>
      loadVaultMailRecovery(pool, REALM, characterId, custodyRef),
  ) {}

  joinError(characterId: number): string | null {
    const error = this.guard.joinError(characterId, false);
    if (error) this.recover(characterId);
    return error;
  }

  recover(characterId: number): void {
    const ref = this.guard.recoveryRef(characterId);
    if (
      !ref ||
      this.inFlight.has(characterId) ||
      this.queued.has(characterId) ||
      this.overflow.has(characterId)
    )
      return;
    if (this.queued.size >= MAX_QUEUED) {
      this.refused++;
      this.overflow.add(characterId);
      return;
    }
    this.queued.set(characterId, { ref, nextAt: 0 });
    this.drain();
  }

  stats(): { active: number; queued: number; overflow: number; refused: number } {
    return {
      active: this.inFlight.size,
      queued: this.queued.size,
      overflow: this.overflow.size,
      refused: this.refused,
    };
  }

  private drain(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const now = Date.now();
    for (const [characterId, pending] of this.queued) {
      if (this.inFlight.size >= MAX_ACTIVE) break;
      if (pending.nextAt > now) continue;
      this.queued.delete(characterId);
      if (this.guard.recoveryRef(characterId) !== pending.ref) continue;
      this.start(characterId, pending.ref);
    }
    while (this.queued.size < MAX_QUEUED && this.overflow.size > 0) {
      const characterId = this.overflow.values().next().value as number;
      this.overflow.delete(characterId);
      const ref = this.guard.recoveryRef(characterId);
      if (ref && !this.inFlight.has(characterId)) this.queued.set(characterId, { ref, nextAt: 0 });
    }
    if (this.inFlight.size >= MAX_ACTIVE || this.queued.size === 0) return;
    const nextAt = Math.min(...[...this.queued.values()].map((entry) => entry.nextAt));
    this.retryTimer = setTimeout(() => this.drain(), Math.max(1, nextAt - Date.now()));
    this.retryTimer.unref();
  }

  private start(characterId: number, ref: string): void {
    this.inFlight.add(characterId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PERMIT_WAIT_MS);
    timeout.unref();
    void this.withPermit(() => this.load(characterId, ref), controller.signal)
      .then((source) => {
        if (this.guard.recoveryRef(characterId) !== ref) return;
        if (source && !this.sim().postOffice.restoreVaultLetter(String(characterId), ref, source))
          throw new Error(`vault mail ${ref} could not be restored`);
        this.guard.recovered(characterId, ref);
      })
      .catch((error) => {
        console.error(`vault mail recovery ${characterId}:`, error);
        if (this.guard.recoveryRef(characterId) === ref) {
          if (this.queued.size < MAX_QUEUED)
            this.queued.set(characterId, { ref, nextAt: Date.now() + RETRY_MS });
          else this.overflow.add(characterId);
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        this.inFlight.delete(characterId);
        this.drain();
      });
  }
}
