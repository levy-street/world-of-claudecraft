// Materials Vault wire glue: the vault command dispatch bodies and the cvault
// snapshot cadence rule, extracted from server/game.ts behind narrow host
// interfaces (the module-first seam: none of this needs GameServer's private
// state). game.ts stays a thin consumer: its dispatch cases and self-block
// emission each keep a one-line call into this module. (The per-tick
// vaultCraftConsume batch that once lived here was the fire-and-forget
// observer the reservation journal replaced; the sim-side event stays, as
// the conservation sweep's expectation source, and routeEvents drops it from
// the client relay.)
//
// Wire posture (moved verbatim from the game.ts self-block emission):
// - `vault` rides beside `bank` on the same proximity gate and is
//   SELF-BLOCK-ONLY: a
//   private per-character store, so it never enters the interest-scoped
//   entity broadcast and rides only the ANCHOR session's self block. Under
//   moderator spectate the anchor is re-pointed at the spectated character,
//   so a spectating moderator sees the SPECTATED player's vault in their own
//   self block, exactly the posture bank and guildBank have. A cheap proximity
//   + revision signature runs every snapshot; the full identity-preserving
//   projection is cloned only when that signature changes or a fresh
//   connection has no lastSent value.
// - `cvault` (the craft-from-vault stock view, Bank Storage Phase 04) has the
//   SAME owner-only self-block posture, but is gated on the craft-draw
//   context predicate (src/sim/vault_craft_gate.ts) instead of banker
//   proximity, because crafting happens at stations and in the open world
//   where vaultInfo is deliberately null. The sim computes the gate
//   (server-authoritative; the client folds a non-null record into the
//   crafting window with zero context logic of its own), so entering an
//   instanced context flips it to an explicit null on the next evaluation
//   and the delta elides it while unchanged. Rows are pre-filtered to the
//   drawable rule, so the payload is bounded by the material set like the
//   vault key. SIGNATURE-GATED like vault, on the pair (vaultWireRevFor,
//   craftVaultDrawBlockedFor): every stock mutation bumps the rev and the
//   gate probe is a pure position/membership read, so the pair fully
//   determines whether the projection could have changed, and the expensive
//   projection clone runs only when it did. (This replaced the earlier 4 Hz
//   cadence rebuild, which re-cloned the projection for every connected
//   session four times a second whether or not anything changed; the gate
//   probe is cheap enough to run every snapshot since the derived west fast
//   path landed.) Off-signature snapshots omit the key, which the client
//   reads as unchanged.

import { MAX_INSTANCE_STRING_LENGTH } from '../src/sim/item_instance_load';
import type { VaultInfo, VaultSpecialRef } from '../src/world_api';
import { buildVaultLedgerRows, recordVaultOp } from './bank_ledger';
import type { BankLedgerAdmission, BankLedgerAdmissionHandle } from './bank_ledger_admission';
import { bankVaultLedgerMaxRows } from './bank_vault_ledger_guard';

/** The slice of Sim the vault dispatch bodies call; a narrow host interface
 *  so a Vitest drives the bodies without a GameServer. */
export interface VaultSim {
  ctx: {
    resolve(pid?: number): { meta: { entityId: number } } | null;
    error(id: number, text: string): void;
  };
  vaultInfoFor(pid?: number): VaultInfo | null;
  vaultDeposit(slot: number, count?: number, pid?: number): void;
  vaultWithdraw(itemId: string, count?: number, pid?: number): void;
  vaultWithdraw(
    itemId: string,
    count: number | undefined,
    special: VaultSpecialRef,
    pid: number,
  ): void;
  vaultDepositAll(pid?: number): void;
  vaultBuyUpgrade(pid?: number): void;
}

/** Narrow snapshot host: cheap revision/gate probes stay separate from the
 *  two potentially large boundary projections they guard. */
export interface VaultSelfWireSim {
  vaultInfoWireRevFor(pid: number): number | null;
  vaultWireRevFor(pid: number): number | null;
  /** Gate-only probe (no projection clone): the cvault signature's second
   *  half beside the rev, a pure position/membership read. */
  craftVaultDrawBlockedFor(pid: number): boolean;
  vaultInfoFor(pid: number): VaultInfo | null;
  craftVaultStockFor(pid: number): Record<string, number> | null;
}

export interface VaultSelfWireSession {
  lastSent: Readonly<Record<string, string>>;
  lastVaultWirePid: number | null;
  lastVaultWireRev: number | null;
  lastCvaultWirePid: number | null;
  lastCvaultWireRev: number | null;
  lastCvaultWireBlocked: boolean | null;
}

/** Emit the two owner-only vault self keys without rebuilding unchanged
 *  projections. Both signatures are probed every snapshot, so banker
 *  proximity flips (vault) and craft-gate flips (cvault) are immediate; the
 *  projections are cloned only when their signature moved or a fresh
 *  connection has no lastSent value. */
export function emitVaultSelfKeys(
  emit: (key: 'vault' | 'cvault', value: unknown) => void,
  sim: VaultSelfWireSim,
  session: VaultSelfWireSession,
  anchorPid: number,
): void {
  const vaultRev = sim.vaultInfoWireRevFor(anchorPid);
  if (
    session.lastSent.vault === undefined ||
    anchorPid !== session.lastVaultWirePid ||
    vaultRev !== session.lastVaultWireRev
  ) {
    emit('vault', vaultRev === null ? null : sim.vaultInfoFor(anchorPid));
    session.lastVaultWirePid = anchorPid;
    session.lastVaultWireRev = vaultRev;
  }

  const cvaultRev = sim.vaultWireRevFor(anchorPid);
  const cvaultBlocked = sim.craftVaultDrawBlockedFor(anchorPid);
  if (
    session.lastSent.cvault === undefined ||
    anchorPid !== session.lastCvaultWirePid ||
    cvaultRev !== session.lastCvaultWireRev ||
    cvaultBlocked !== session.lastCvaultWireBlocked
  ) {
    // A blocked gate IS the null answer craftVaultStockFor would compute, so
    // the blocked arm never pays the projection call just to learn that.
    emit('cvault', cvaultBlocked ? null : sim.craftVaultStockFor(anchorPid));
    session.lastCvaultWirePid = anchorPid;
    session.lastCvaultWireRev = cvaultRev;
    session.lastCvaultWireBlocked = cvaultBlocked;
  }
}

const SPECIAL_REF_KEYS = new Set(['index', 'instance', 'craftedRecipeId']);
const MAX_SPECIAL_REF_NODES = 1_024;
const MAX_SPECIAL_REF_DEPTH = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedJson(value: unknown): boolean {
  let nodes = 0;
  const visit = (current: unknown, depth: number): boolean => {
    if (++nodes > MAX_SPECIAL_REF_NODES || depth > MAX_SPECIAL_REF_DEPTH) return false;
    if (current === null || typeof current === 'boolean') return true;
    if (typeof current === 'string') return current.length <= MAX_INSTANCE_STRING_LENGTH;
    if (typeof current === 'number') return Number.isFinite(current);
    if (Array.isArray(current)) return current.every((entry) => visit(entry, depth + 1));
    if (!isRecord(current)) return false;
    return Object.entries(current).every(
      ([key, entry]) => key.length <= MAX_INSTANCE_STRING_LENGTH && visit(entry, depth + 1),
    );
  };
  return visit(value, 0);
}

/** Strictly decode the optional identity-bearing withdrawal selector. Unknown
 *  keys, advisory slot data, malformed payload trees, and lossy recipe markers
 *  all fail closed before the sim sees the request. */
export function decodeVaultSpecialRef(value: unknown): VaultSpecialRef | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !SPECIAL_REF_KEYS.has(key))) return null;
  if (!Number.isSafeInteger(value.index) || Number(value.index) < 0) return null;
  if (
    value.craftedRecipeId !== undefined &&
    (typeof value.craftedRecipeId !== 'string' ||
      value.craftedRecipeId === '' ||
      value.craftedRecipeId.length > MAX_INSTANCE_STRING_LENGTH)
  ) {
    return null;
  }
  if (
    value.instance !== undefined &&
    (!isRecord(value.instance) || !isBoundedJson(value.instance))
  ) {
    return null;
  }
  return value as unknown as VaultSpecialRef;
}

export type VaultCommandName =
  | 'vault_deposit'
  | 'vault_withdraw'
  | 'vault_deposit_all'
  | 'vault_buy_upgrade';

function refuseLedgerAdmission(sim: VaultSim, pid: number): void {
  const entityId = sim.ctx.resolve(pid)?.meta.entityId;
  if (entityId !== undefined) sim.ctx.error(entityId, 'You are busy.');
}

/** Undefined preserves the temporary legacy observer path. Null means the
 *  live session has no admission owner and must refuse before mutation. */
function reserveLedgerRows(
  admission: BankLedgerAdmission | null | undefined,
  sim: VaultSim,
  pid: number,
  command: VaultCommandName,
): BankLedgerAdmissionHandle | null | undefined {
  if (admission === undefined) return undefined;
  const reservation = admission?.tryReserve(bankVaultLedgerMaxRows(command), 0, 'vault') ?? null;
  if (!reservation) refuseLedgerAdmission(sim, pid);
  return reservation;
}

function runReservedSimCall<T>(
  reservation: BankLedgerAdmissionHandle | undefined,
  readBefore: () => T,
  mutate: () => void,
): T {
  let before: T;
  try {
    before = readBefore();
  } catch (err) {
    reservation?.cancel();
    throw err;
  }
  try {
    mutate();
    return before;
  } catch (err) {
    reservation?.failAfterMutation(err);
    throw err;
  }
}

function finishReservedSimCall<T>(
  reservation: BankLedgerAdmissionHandle | undefined,
  finish: () => T,
): T {
  try {
    return finish();
  } catch (err) {
    reservation?.failAfterMutation(err);
    throw err;
  }
}

/** The four vault command-case bodies, moved verbatim from dispatchMessage.
 *  Shape-only checks here (the bank_* idiom): the Sim owns every gameplay
 *  rule (banker proximity, material scope, the per-material cap, the exact
 *  upgrade copper). Deposit takes a carried-inventory index in `slot` with an
 *  optional partial `count`; withdraw is keyed by `itemId` because vault
 *  stock has no slots.
 *  The live bank_ledger path reserves bounded outbox capacity before mutation,
 *  then derives the exact command batch by DIFFING vaultInfoFor before and
 *  after. A refused/no-op call diffs empty and cancels its reservation.
 *  Undefined admission preserves the fire-and-forget recorder for isolated
 *  callers until every host supplies a character-owned outbox. */
export function dispatchVaultCommand(
  sim: VaultSim,
  who: { characterId: number; accountId: number },
  cmd: VaultCommandName,
  msg: Record<string, unknown>,
  pid: number,
  admission?: BankLedgerAdmission | null,
): void {
  switch (cmd) {
    case 'vault_deposit':
      if (typeof msg.slot === 'number') {
        const slot = msg.slot;
        const count = typeof msg.count === 'number' ? msg.count : undefined;
        const reservation = reserveLedgerRows(admission, sim, pid, 'vault_deposit');
        if (reservation === null) break;
        const before = runReservedSimCall(
          reservation,
          () => sim.vaultInfoFor(pid),
          () => sim.vaultDeposit(slot, count, pid),
        );
        finishReservedSimCall(reservation, () => {
          const after = sim.vaultInfoFor(pid);
          if (reservation) reservation.commit(buildVaultLedgerRows('deposit', who, before, after));
          else recordVaultOp('deposit', who, before, after);
        });
      }
      break;
    case 'vault_withdraw':
      if (typeof msg.itemId === 'string') {
        const itemId = msg.itemId;
        const special = msg.special === undefined ? undefined : decodeVaultSpecialRef(msg.special);
        if (special === null) break;
        const reservation = reserveLedgerRows(admission, sim, pid, 'vault_withdraw');
        if (reservation === null) break;
        const count = typeof msg.count === 'number' ? msg.count : undefined;
        const before = runReservedSimCall(
          reservation,
          () => sim.vaultInfoFor(pid),
          () => {
            if (special === undefined) sim.vaultWithdraw(itemId, count, pid);
            else sim.vaultWithdraw(itemId, count, special, pid);
          },
        );
        finishReservedSimCall(reservation, () => {
          const after = sim.vaultInfoFor(pid);
          if (reservation) reservation.commit(buildVaultLedgerRows('withdraw', who, before, after));
          else recordVaultOp('withdraw', who, before, after);
        });
      }
      break;
    case 'vault_deposit_all': {
      // Argument-free (the sweep takes the whole carried inventory), so no
      // shape guard; the Sim owns every per-slot rule. ONE before/after diff
      // spans the whole batch, so recordVaultOp writes the sweep's rows (one
      // per material moved) as ONE batched insert.
      const reservation = reserveLedgerRows(admission, sim, pid, 'vault_deposit_all');
      if (reservation === null) break;
      const before = runReservedSimCall(
        reservation,
        () => sim.vaultInfoFor(pid),
        () => sim.vaultDepositAll(pid),
      );
      finishReservedSimCall(reservation, () => {
        const after = sim.vaultInfoFor(pid);
        if (reservation) reservation.commit(buildVaultLedgerRows('deposit', who, before, after));
        else recordVaultOp('deposit', who, before, after);
      });
      break;
    }
    case 'vault_buy_upgrade': {
      const reservation = reserveLedgerRows(admission, sim, pid, 'vault_buy_upgrade');
      if (reservation === null) break;
      const before = runReservedSimCall(
        reservation,
        () => sim.vaultInfoFor(pid),
        () => sim.vaultBuyUpgrade(pid),
      );
      finishReservedSimCall(reservation, () => {
        const after = sim.vaultInfoFor(pid);
        if (reservation) reservation.commit(buildVaultLedgerRows('buy_slots', who, before, after));
        else recordVaultOp('buy_slots', who, before, after);
      });
      break;
    }
    default: {
      // Closes the union from this end too: a fifth VaultCommandName member
      // whose case is missing here is a compile error, never a silent drop.
      const unhandled: never = cmd;
      throw new Error(`unhandled vault command: ${unhandled as string}`);
    }
  }
}
