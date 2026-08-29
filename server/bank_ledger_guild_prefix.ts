import type { GuildBankOpDelta } from '../src/sim/guild_bank';
import type { BankLedgerProjectionSurface } from './bank_ledger_admission';
import type {
  BankLedgerOutboxSnapshot,
  SerializedBankLedgerGuildDelta,
} from './bank_ledger_outbox';

/** The character-owned guild operation log needed to verify a durable prefix. */
export interface GuildLedgerPrefixSource {
  readonly unflushedGuildBankOps: ReadonlyMap<number, readonly GuildBankOpDelta[]>;
}

/** The three character-owned maps changed when a durable prefix is consumed. */
export interface GuildLedgerPrefixState {
  readonly unflushedGuildBankOps: Map<number, GuildBankOpDelta[]>;
  readonly dirtyGuildBanks: { delete(guildId: number): boolean };
  readonly guildBankDeficitSkips: { delete(guildId: number): boolean };
}

function guildDeltaMatches(
  live: GuildBankOpDelta,
  durable: SerializedBankLedgerGuildDelta,
): boolean {
  return (
    live.op === durable.op &&
    live.itemId === durable.itemId &&
    live.count === durable.count &&
    (live.instance == null
      ? durable.instanceJson === null
      : JSON.stringify(live.instance) === durable.instanceJson) &&
    (live.craftedRecipeId ?? null) === durable.craftedRecipeId &&
    live.copperDelta === durable.copperDelta &&
    live.purchasedSlotsBefore === durable.purchasedSlotsBefore &&
    live.purchasedSlotsAfter === durable.purchasedSlotsAfter
  );
}

/** Pick the most specific fixed-cardinality incident series carried by a snapshot. */
export function ledgerProjectionSurface(
  snapshot: Pick<BankLedgerOutboxSnapshot, 'batches'>,
): BankLedgerProjectionSurface {
  let sawVault = false;
  for (const batch of snapshot.batches) {
    for (const row of batch.rows) {
      if (row.container === 'guild') return 'guild';
      if (row.container === 'vault') sawVault = true;
    }
  }
  return sawVault ? 'vault' : 'personal';
}

/**
 * Find the guilds whose committed prefix contains at least one selected
 * player-visible operation. The caller supplies the projection allowlist so
 * this pure receipt helper does not depend on the cached-read implementation.
 */
export function guildLedgerIdsForOps(
  batches: BankLedgerOutboxSnapshot['batches'],
  selectedOps: readonly string[],
): readonly number[] {
  let guildIds: Set<number> | undefined;
  for (const batch of batches) {
    for (const row of batch.rows) {
      if (row.container === 'guild' && row.containerId !== null && selectedOps.includes(row.op)) {
        if (!guildIds) guildIds = new Set();
        guildIds.add(row.containerId);
      }
    }
  }
  return guildIds ? [...guildIds].sort((left, right) => left - right) : [];
}

/** Visit each selected committed guild once, in deterministic id order. */
export function visitGuildLedgerIdsForOps(
  batches: BankLedgerOutboxSnapshot['batches'],
  selectedOps: readonly string[],
  visit: (guildId: number) => void,
): void {
  for (const guildId of guildLedgerIdsForOps(batches, selectedOps)) visit(guildId);
}

/**
 * Verify every durable guild sidecar against the matching ordered live prefix.
 * Repeated batches for one guild advance a cumulative offset in batch order.
 */
export function guildLedgerPrefixCounts(
  source: GuildLedgerPrefixSource,
  batches: BankLedgerOutboxSnapshot['batches'],
): Map<number, number> | null {
  const counts = new Map<number, number>();
  for (const batch of batches) {
    const effect = batch.guildEffect;
    if (!effect) continue;
    const offset = counts.get(effect.guildId) ?? 0;
    const log = source.unflushedGuildBankOps.get(effect.guildId);
    if (!log || offset + effect.deltas.length > log.length) return null;
    for (let index = 0; index < effect.deltas.length; index++) {
      const live = log[offset + index];
      const durable = effect.deltas[index];
      if (!live || !durable || !guildDeltaMatches(live, durable)) return null;
    }
    counts.set(effect.guildId, offset + effect.deltas.length);
  }
  return counts;
}

/** Consume a verified durable prefix and retire sidecar state only for empty logs. */
export function consumeCommittedGuildLedgerPrefix(
  state: GuildLedgerPrefixState,
  counts: ReadonlyMap<number, number>,
): void {
  for (const [guildId, count] of counts) {
    const log = state.unflushedGuildBankOps.get(guildId);
    if (!log) continue;
    log.splice(0, count);
    if (log.length === 0) {
      state.unflushedGuildBankOps.delete(guildId);
      state.dirtyGuildBanks.delete(guildId);
      state.guildBankDeficitSkips.delete(guildId);
    }
  }
}
