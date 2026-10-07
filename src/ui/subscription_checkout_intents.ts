import type { GameSubscriptionPlan } from '../subscription_contract';

/** Durable retry identity. Storage and randomness belong to the browser adapter. */
export class SubscriptionCheckoutIntents {
  private readonly keys = new Map<GameSubscriptionPlan, string>();
  private readonly started = new Set<GameSubscriptionPlan>();
  private readonly retired = new Map<GameSubscriptionPlan, string>();
  private accountId: number | undefined;
  constructor(
    private readonly storage: {
      read(key: string): string | null;
      write(key: string, value: string): void;
      remove(key: string): void;
      mint(): string;
    },
  ) {}
  scope(accountId?: number, reset = false): void {
    const next = Number.isSafeInteger(accountId) && Number(accountId) > 0 ? accountId : undefined;
    if (next === this.accountId && !reset) return;
    this.accountId = next;
    this.keys.clear();
    this.started.clear();
    this.retired.clear();
  }
  private storageKey(plan: GameSubscriptionPlan): string {
    return `woc.subscription.${this.accountId}.${plan}.pending`;
  }
  key(plan: GameSubscriptionPlan): string {
    let key = this.keys.get(plan);
    if (key) return key;
    try {
      const saved = this.accountId === undefined ? null : this.storage.read(this.storageKey(plan));
      if (saved && saved !== this.retired.get(plan) && /^[A-Za-z0-9_.:-]{1,200}$/.test(saved)) {
        key = saved;
        this.started.add(plan);
      }
    } catch {
      /* Storage can be disabled. Keep this session's retry key. */
    }
    key ??= this.storage.mint();
    this.keys.set(plan, key);
    return key;
  }
  pending(plan: GameSubscriptionPlan): boolean {
    this.key(plan);
    return this.started.has(plan);
  }
  start(plan: GameSubscriptionPlan): string {
    const key = this.key(plan);
    this.started.add(plan);
    try {
      if (this.accountId !== undefined) this.storage.write(this.storageKey(plan), key);
    } catch {
      /* Session-only retry. */
    }
    return key;
  }
  complete(plan: GameSubscriptionPlan): void {
    const key = this.keys.get(plan);
    if (key) this.retired.set(plan, key);
    this.keys.delete(plan);
    this.started.delete(plan);
    try {
      if (this.accountId !== undefined) this.storage.remove(this.storageKey(plan));
    } catch {
      /* Receipt replay remains safe. */
    }
  }
}
