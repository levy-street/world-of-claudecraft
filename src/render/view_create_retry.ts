interface RetryEntry {
  entityId: number;
  retryAt: number;
}

/** Cooldown state for fail-soft character builds in per-frame render paths. */
export class ViewCreateRetryGate {
  private entries = new Map<string, RetryEntry>();

  constructor(private readonly cooldownMs: number) {}

  get size(): number {
    return this.entries.size;
  }

  canAttempt(entityId: number, slot: string, now: number): boolean {
    const key = this.key(entityId, slot);
    const entry = this.entries.get(key);
    if (!entry) return true;
    if (now < entry.retryAt) return false;
    this.entries.delete(key);
    return true;
  }

  markFailed(entityId: number, slot: string, now: number): void {
    this.entries.set(this.key(entityId, slot), {
      entityId,
      retryAt: now + this.cooldownMs,
    });
  }

  markSucceeded(entityId: number, slot: string): void {
    this.entries.delete(this.key(entityId, slot));
  }

  prune(now: number, activeEntities: { has(id: number): boolean }): void {
    for (const [key, entry] of this.entries) {
      if (now >= entry.retryAt || !activeEntities.has(entry.entityId)) this.entries.delete(key);
    }
  }

  private key(entityId: number, slot: string): string {
    return `${entityId}:${slot}`;
  }
}
