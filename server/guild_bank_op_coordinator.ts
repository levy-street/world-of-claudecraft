// The synchronous host coordinator for one guild-bank mutation. This is the
// only place that pairs a live book mutation with its pre-reserved ledger
// evidence and escrow replay sidecar. The staged command is committed with the
// character and book by their later fenced save as one transaction. This
// module stays independent of GameServer: the host supplies the narrow Sim
// reads, lifecycle predicates, notices, scheduling, and fixed-cardinality
// observability sinks it owns.

import { type GuildBankOpDelta, guildBankRungsBought } from '../src/sim/guild_bank';
import type { InvSlot } from '../src/sim/types';
import type { GuildBankInfo } from '../src/world_api';
import { buildGuildBankLedgerRows, diffGuildBankOp, type GuildBankLedgerOp } from './bank_ledger';
import type { BankLedgerAdmission } from './bank_ledger_admission';
import {
  type CounterpartyActor,
  type CounterpartyMovement,
  counterpartyIdle,
  counterpartyMovement,
  counterpartyOrphan,
  counterpartyOrphanEvidence,
  counterpartySnapshot,
  stampCounterpartyDeltas,
} from './guild_bank_counterparty';

export type GuildBankOpTarget =
  | { readonly pid: number }
  | { readonly guildId: number; readonly actorAccountId: number };

export interface GuildBankOpSessionPort {
  readonly characterId: number;
  readonly accountId: number;
  readonly bankLedgerJournal: {
    readonly admission: BankLedgerAdmission;
  };
  readonly unflushedGuildBankOps: Map<number, GuildBankOpDelta[]>;
}

export interface GuildBankOpSimPort {
  meta(pid: number):
    | {
        readonly copper: number;
        readonly inventory: readonly InvSlot[];
        readonly guildMembership?: { readonly guildId: number } | null;
      }
    | null
    | undefined;
  guildBankInfoFor(pid: number): GuildBankInfo | null;
  guildBankInfoForGuild(guildId: number): GuildBankInfo | null;
}

export interface GuildBankOpHostPort {
  readonly sim: GuildBankOpSimPort;
  readonly guildBankDeleteInFlight: (guildId: number) => boolean;
  readonly sendPlayerNotice: (text: string) => void;
  readonly bankLedgerNeedsSave: () => boolean;
  readonly scheduleBankLedgerHighWaterSave: () => void;
  readonly markGuildBankDirty: (guildId: number) => void;
  readonly recordGuildBankIncident: (kind: 'counterparty_orphan') => void;
  readonly logError: (message: string) => void;
}

/**
 * Run one guild-bank operation inside its pre-mutation admission and
 * before/after evidence bracket.
 *
 * Player targets derive both guild authority and counterparty state from the
 * live Sim. Operator targets name the guild and operator account explicitly;
 * their session is only the fenced character-save carrier.
 */
export function runGuildBankOp(
  host: GuildBankOpHostPort,
  session: GuildBankOpSessionPort,
  target: GuildBankOpTarget,
  op: GuildBankLedgerOp,
  run: () => void,
): void {
  const playerTarget = 'pid' in target;
  const actingGuildId = playerTarget
    ? host.sim.meta(target.pid)?.guildMembership?.guildId
    : target.guildId;
  if (actingGuildId !== undefined && host.guildBankDeleteInFlight(actingGuildId)) {
    if (playerTarget) {
      host.sendPlayerNotice('The guild bank is closing. Try again in a moment.');
    }
    return;
  }

  const reservation = session.bankLedgerJournal.admission.tryReserve(2, 2, 'guild');
  if (!reservation) {
    if (playerTarget) host.sendPlayerNotice('You are busy. Try again in a moment.');
    return;
  }

  const readBook = (): GuildBankInfo | null =>
    playerTarget
      ? host.sim.guildBankInfoFor(target.pid)
      : host.sim.guildBankInfoForGuild(target.guildId);
  const readCounterparty = () => {
    if (!playerTarget) return null;
    const meta = host.sim.meta(target.pid);
    const actor: CounterpartyActor | null = meta
      ? { copper: meta.copper, inventory: meta.inventory }
      : null;
    return counterpartySnapshot(actor);
  };

  let before: GuildBankInfo | null;
  let actorBefore: ReturnType<typeof readCounterparty>;
  try {
    before = readBook();
    actorBefore = readCounterparty();
  } catch (error) {
    reservation.cancel();
    throw error;
  }

  try {
    run();
  } catch (error) {
    reservation.failAfterMutation(error);
    throw error;
  }

  let after: GuildBankInfo | null;
  try {
    after = readBook();
  } catch (error) {
    reservation.failAfterMutation(error);
    throw error;
  }

  try {
    const movement = counterpartyMovement(actorBefore, readCounterparty());
    const effectiveOp: GuildBankLedgerOp =
      op === 'buy_slots' && before !== null && guildBankRungsBought(before.purchasedSlots) === 0
        ? 'open_bank'
        : op;
    const deltas = diffGuildBankOp(effectiveOp, before, after);
    const guildId = playerTarget
      ? host.sim.meta(target.pid)?.guildMembership?.guildId
      : target.guildId;
    const who = playerTarget
      ? session
      : { characterId: session.characterId, accountId: target.actorAccountId };

    const orphanRows = (unaccounted: CounterpartyMovement) => {
      if (guildId === undefined || counterpartyIdle(unaccounted)) return [];
      const orphan = counterpartyOrphan(unaccounted);
      if (!orphan) return [];
      host.recordGuildBankIncident('counterparty_orphan');
      host.logError(
        `guild bank counterparty orphan on ${effectiveOp} for guild ${guildId} (character ${session.characterId}): the acting character's purse/bags moved value no ledger row accounts for (copper ${orphan.copperDelta}${orphan.itemId ? `, ${orphan.count} x ${orphan.itemId}` : ''})`,
      );
      return buildGuildBankLedgerRows('counterparty_orphan', who, guildId, [
        {
          itemId: orphan.itemId,
          count: orphan.count,
          instance: counterpartyOrphanEvidence(effectiveOp, unaccounted),
          copperDelta: 0,
          purchasedSlotsBefore: after?.purchasedSlots ?? before?.purchasedSlots ?? 0,
          purchasedSlotsAfter: after?.purchasedSlots ?? before?.purchasedSlots ?? 0,
          counterpartyCopperDelta: orphan.copperDelta,
          counterpartyCount: orphan.count ?? 0,
        },
      ]);
    };

    if (deltas.length === 0) {
      const rows = orphanRows(movement);
      if (rows.length > 0) reservation.commit(rows);
      else reservation.cancel();
      if (host.bankLedgerNeedsSave()) host.scheduleBankLedgerHighWaterSave();
      return;
    }

    if (guildId === undefined) {
      reservation.failAfterMutation(new Error('guild bank mutation lost its guild identity'));
      return;
    }

    const unaccounted = stampCounterpartyDeltas(deltas, movement);
    const guildDeltas: GuildBankOpDelta[] = deltas.map((delta) => ({
      op: effectiveOp,
      itemId: delta.itemId,
      count: delta.count,
      instance: (delta.instance ?? null) as GuildBankOpDelta['instance'],
      craftedRecipeId: delta.craftedRecipeId ?? null,
      copperDelta: delta.copperDelta,
      purchasedSlotsBefore: delta.purchasedSlotsBefore ?? 0,
      purchasedSlotsAfter: delta.purchasedSlotsAfter,
    }));

    host.markGuildBankDirty(guildId);
    const log = session.unflushedGuildBankOps.get(guildId) ?? [];
    log.push(...guildDeltas);
    session.unflushedGuildBankOps.set(guildId, log);
    const rows = [
      ...buildGuildBankLedgerRows(effectiveOp, who, guildId, deltas),
      ...orphanRows(unaccounted),
    ];
    // Operator targets declare their staff attribution on the effect so the
    // outbox owner check validates rows against the PASSED actor, never
    // against the rows' own self-consistent accountId.
    reservation.commit(rows, {
      guildId,
      deltas: guildDeltas,
      ...(playerTarget ? {} : { actorAccountId: target.actorAccountId }),
    });
    if (host.bankLedgerNeedsSave()) host.scheduleBankLedgerHighWaterSave();
  } catch (error) {
    reservation.failAfterMutation(error);
    throw error;
  }
}
