import { describe, expect, it, vi } from 'vitest';
import type { BankLedgerAdmissionHandle } from '../../server/bank_ledger_admission';
import {
  type GuildBankOpHostPort,
  type GuildBankOpSessionPort,
  runGuildBankOp,
} from '../../server/guild_bank_op_coordinator';
import type { InvSlot } from '../../src/sim/types';
import type { GuildBankInfo } from '../../src/world_api';

const book = (overrides: Partial<GuildBankInfo> = {}): GuildBankInfo => ({
  treasury: 0,
  slots: [],
  capacity: 24,
  purchasedSlots: 24,
  nextExpansionPrice: 1_000,
  canEdit: true,
  ...overrides,
});

const slot = (itemId: string, count: number): InvSlot => ({ itemId, count });

function makeRig() {
  const state: {
    playerBook: GuildBankInfo | null;
    guildBook: GuildBankInfo | null;
    meta: {
      copper: number;
      inventory: readonly InvSlot[];
      guildMembership: { guildId: number } | null;
    } | null;
  } = {
    playerBook: book(),
    guildBook: book(),
    meta: { copper: 10_000, inventory: [], guildMembership: { guildId: 23 } },
  };

  const commit = vi.fn<BankLedgerAdmissionHandle['commit']>(() => true);
  const cancel = vi.fn<BankLedgerAdmissionHandle['cancel']>(() => true);
  const failAfterMutation = vi.fn<BankLedgerAdmissionHandle['failAfterMutation']>();
  const reservation: BankLedgerAdmissionHandle = { commit, cancel, failAfterMutation };
  const tryReserve = vi.fn((): BankLedgerAdmissionHandle | null => reservation);
  const meta = vi.fn(() => state.meta);
  const guildBankInfoFor = vi.fn(() => state.playerBook);
  const guildBankInfoForGuild = vi.fn(() => state.guildBook);
  const guildBankDeleteInFlight = vi.fn(() => false);
  const sendPlayerNotice = vi.fn();
  const bankLedgerNeedsSave = vi.fn(() => false);
  const scheduleBankLedgerHighWaterSave = vi.fn();
  const markGuildBankDirty = vi.fn();
  const recordGuildBankIncident = vi.fn();
  const logError = vi.fn();
  const host: GuildBankOpHostPort = {
    sim: { meta, guildBankInfoFor, guildBankInfoForGuild },
    guildBankDeleteInFlight,
    sendPlayerNotice,
    bankLedgerNeedsSave,
    scheduleBankLedgerHighWaterSave,
    markGuildBankDirty,
    recordGuildBankIncident,
    logError,
  };
  const session: GuildBankOpSessionPort = {
    characterId: 7,
    accountId: 19,
    bankLedgerJournal: { admission: { tryReserve } },
    unflushedGuildBankOps: new Map(),
  };

  return {
    state,
    host,
    session,
    reservation,
    commit,
    cancel,
    failAfterMutation,
    tryReserve,
    meta,
    guildBankInfoFor,
    guildBankInfoForGuild,
    guildBankDeleteInFlight,
    sendPlayerNotice,
    bankLedgerNeedsSave,
    scheduleBankLedgerHighWaterSave,
    markGuildBankDirty,
    recordGuildBankIncident,
    logError,
  };
}

describe('guild-bank op coordinator', () => {
  it('refuses a player mutation during the delete window before admission', () => {
    const rig = makeRig();
    rig.guildBankDeleteInFlight.mockReturnValue(true);
    const run = vi.fn();

    runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit', run);

    expect(rig.guildBankDeleteInFlight).toHaveBeenCalledWith(23);
    expect(rig.sendPlayerNotice).toHaveBeenCalledWith(
      'The guild bank is closing. Try again in a moment.',
    );
    expect(rig.tryReserve).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('propagates a membership-read failure before taking any reservation', () => {
    const rig = makeRig();
    const error = new Error('membership read failed');
    rig.meta.mockImplementationOnce(() => {
      throw error;
    });

    expect(() => runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit', vi.fn())).toThrow(
      error,
    );
    expect(rig.tryReserve).not.toHaveBeenCalled();
    expect(rig.cancel).not.toHaveBeenCalled();
    expect(rig.failAfterMutation).not.toHaveBeenCalled();
  });

  it('refuses an operator mutation during the delete window without a player notice', () => {
    const rig = makeRig();
    rig.guildBankDeleteInFlight.mockReturnValue(true);
    const run = vi.fn();

    runGuildBankOp(rig.host, rig.session, { guildId: 41, actorAccountId: 97 }, 'admin_purge', run);

    expect(rig.guildBankDeleteInFlight).toHaveBeenCalledWith(41);
    expect(rig.meta).not.toHaveBeenCalled();
    expect(rig.sendPlayerNotice).not.toHaveBeenCalled();
    expect(rig.tryReserve).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a player when admission is full and prices the full guild bracket', () => {
    const rig = makeRig();
    rig.tryReserve.mockReturnValue(null);
    const run = vi.fn();

    runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'withdraw_gold', run);

    expect(rig.tryReserve).toHaveBeenCalledWith(2, 2, 'guild');
    expect(rig.sendPlayerNotice).toHaveBeenCalledWith('You are busy. Try again in a moment.');
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps an operator admission refusal silent', () => {
    const rig = makeRig();
    rig.tryReserve.mockReturnValue(null);

    runGuildBankOp(
      rig.host,
      rig.session,
      { guildId: 41, actorAccountId: 97 },
      'admin_purge',
      vi.fn(),
    );

    expect(rig.sendPlayerNotice).not.toHaveBeenCalled();
    expect(rig.cancel).not.toHaveBeenCalled();
    expect(rig.failAfterMutation).not.toHaveBeenCalled();
  });

  it('cancels the reservation when the before book read throws', () => {
    const rig = makeRig();
    const error = new Error('before book failed');
    rig.guildBankInfoFor.mockImplementation(() => {
      throw error;
    });
    const run = vi.fn();

    expect(() => runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit', run)).toThrow(error);
    expect(rig.cancel).toHaveBeenCalledTimes(1);
    expect(rig.failAfterMutation).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('cancels the reservation when the before counterparty snapshot throws', () => {
    const rig = makeRig();
    const error = new Error('before actor failed');
    rig.meta
      .mockImplementationOnce(() => rig.state.meta)
      .mockImplementationOnce(() => {
        throw error;
      });

    expect(() => runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit', vi.fn())).toThrow(
      error,
    );
    expect(rig.cancel).toHaveBeenCalledTimes(1);
    expect(rig.failAfterMutation).not.toHaveBeenCalled();
  });

  it('fails after mutation and rethrows when the sim operation throws', () => {
    const rig = makeRig();
    const error = new Error('run failed');
    const run = vi.fn(() => {
      throw error;
    });

    expect(() => runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit', run)).toThrow(error);
    expect(rig.cancel).not.toHaveBeenCalled();
    expect(rig.failAfterMutation).toHaveBeenCalledWith(error);
    expect(rig.guildBankInfoFor).toHaveBeenCalledTimes(1);
  });

  it('fails after mutation and rethrows when the after book read throws', () => {
    const rig = makeRig();
    const error = new Error('after book failed');
    rig.guildBankInfoFor
      .mockImplementationOnce(() => rig.state.playerBook)
      .mockImplementationOnce(() => {
        throw error;
      });

    expect(() => runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit', vi.fn())).toThrow(
      error,
    );
    expect(rig.cancel).not.toHaveBeenCalled();
    expect(rig.failAfterMutation).toHaveBeenCalledWith(error);
  });

  it('fails after mutation and rethrows when the after counterparty read throws', () => {
    const rig = makeRig();
    const error = new Error('after actor failed');
    rig.meta
      .mockImplementationOnce(() => rig.state.meta)
      .mockImplementationOnce(() => rig.state.meta)
      .mockImplementationOnce(() => {
        throw error;
      });

    expect(() => runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit', vi.fn())).toThrow(
      error,
    );
    expect(rig.failAfterMutation).toHaveBeenCalledWith(error);
    expect(rig.cancel).not.toHaveBeenCalled();
  });

  it('cancels a no-op without scheduling a save below high water', () => {
    const rig = makeRig();

    runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit_gold', vi.fn());

    expect(rig.cancel).toHaveBeenCalledTimes(1);
    expect(rig.commit).not.toHaveBeenCalled();
    expect(rig.markGuildBankDirty).not.toHaveBeenCalled();
    expect(rig.session.unflushedGuildBankOps.size).toBe(0);
    expect(rig.bankLedgerNeedsSave).toHaveBeenCalledTimes(1);
    expect(rig.scheduleBankLedgerHighWaterSave).not.toHaveBeenCalled();
    expect(rig.failAfterMutation).not.toHaveBeenCalled();
  });

  it('records a no-book-diff counterparty orphan without a guild replay sidecar', () => {
    const rig = makeRig();
    rig.state.meta = {
      copper: 500,
      inventory: [slot('copper_ore', 3)],
      guildMembership: { guildId: 23 },
    };
    rig.bankLedgerNeedsSave.mockReturnValue(true);
    const run = () => {
      rig.state.meta = {
        copper: 450,
        inventory: [slot('copper_ore', 1)],
        guildMembership: { guildId: 23 },
      };
    };

    runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'withdraw', run);

    expect(rig.recordGuildBankIncident).toHaveBeenCalledWith('counterparty_orphan');
    expect(rig.logError).toHaveBeenCalledWith(
      "guild bank counterparty orphan on withdraw for guild 23 (character 7): the acting character's purse/bags moved value no ledger row accounts for (copper -50, -2 x copper_ore)",
    );
    expect(rig.commit).toHaveBeenCalledTimes(1);
    const [rows, sidecar] = rig.commit.mock.calls[0] ?? [];
    expect(sidecar).toBeUndefined();
    expect(rows).toEqual([
      expect.objectContaining({
        characterId: 7,
        accountId: 19,
        op: 'counterparty_orphan',
        container: 'guild',
        containerId: 23,
        itemId: 'copper_ore',
        count: -2,
        copperDelta: 0,
        counterpartyCopperDelta: -50,
        counterpartyCount: -2,
        instance: {
          attemptedOp: 'withdraw',
          copper: -50,
          items: { copper_ore: -2 },
        },
      }),
    ]);
    expect(rig.markGuildBankDirty).not.toHaveBeenCalled();
    expect(rig.session.unflushedGuildBankOps.size).toBe(0);
    expect(rig.scheduleBankLedgerHighWaterSave).toHaveBeenCalledTimes(1);
  });

  it('classifies a non-position rung zero as open_bank and stages its exact replay delta', () => {
    const rig = makeRig();
    rig.state.playerBook = book({
      capacity: 0,
      purchasedSlots: 1,
      nextExpansionPrice: 900,
    });
    rig.state.meta = {
      copper: 1_000,
      inventory: [],
      guildMembership: { guildId: 23 },
    };
    rig.bankLedgerNeedsSave.mockReturnValue(true);
    const run = () => {
      rig.state.playerBook = book({
        capacity: 24,
        purchasedSlots: 24,
        nextExpansionPrice: 1_500,
      });
      rig.state.meta = {
        copper: 100,
        inventory: [],
        guildMembership: { guildId: 23 },
      };
    };

    runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'buy_slots', run);

    expect(rig.markGuildBankDirty).toHaveBeenCalledWith(23);
    const log = rig.session.unflushedGuildBankOps.get(23);
    expect(log).toEqual([
      {
        op: 'open_bank',
        itemId: null,
        count: null,
        instance: null,
        craftedRecipeId: null,
        copperDelta: -900,
        purchasedSlotsBefore: 1,
        purchasedSlotsAfter: 24,
      },
    ]);
    const [rows, sidecar] = rig.commit.mock.calls[0] ?? [];
    expect(rows).toEqual([
      expect.objectContaining({
        characterId: 7,
        accountId: 19,
        op: 'open_bank',
        containerId: 23,
        copperDelta: -900,
        counterpartyCopperDelta: -900,
        counterpartyCount: 0,
      }),
    ]);
    expect(sidecar).toEqual({ guildId: 23, deltas: log });
    expect(sidecar?.deltas).not.toBe(log);
    expect(sidecar?.deltas[0]).toBe(log?.[0]);
    expect(rig.scheduleBankLedgerHighWaterSave).toHaveBeenCalledTimes(1);
  });

  it('keeps later slot purchases classified as treasury-paid buy_slots', () => {
    const rig = makeRig();
    rig.state.playerBook = book({
      treasury: 2_000,
      capacity: 24,
      purchasedSlots: 24,
      nextExpansionPrice: 1_500,
    });
    rig.state.meta = {
      copper: 500,
      inventory: [],
      guildMembership: { guildId: 23 },
    };
    const run = () => {
      rig.state.playerBook = book({
        treasury: 500,
        capacity: 30,
        purchasedSlots: 30,
        nextExpansionPrice: 3_000,
      });
    };

    runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'buy_slots', run);

    const [rows, sidecar] = rig.commit.mock.calls[0] ?? [];
    expect(rows).toEqual([
      expect.objectContaining({
        op: 'buy_slots',
        copperDelta: -1_500,
        counterpartyCopperDelta: 0,
        counterpartyCount: 0,
      }),
    ]);
    expect(sidecar?.deltas).toEqual([
      expect.objectContaining({
        op: 'buy_slots',
        purchasedSlotsBefore: 24,
        purchasedSlotsAfter: 30,
      }),
    ]);
  });

  it('appends one successful player delta and stamps the acting bag movement', () => {
    const rig = makeRig();
    const prior = {
      op: 'deposit_gold' as const,
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: 100,
      purchasedSlotsBefore: 24,
      purchasedSlotsAfter: 24,
    };
    rig.session.unflushedGuildBankOps.set(23, [prior]);
    rig.state.playerBook = book({ slots: [] });
    const carried: InvSlot = {
      itemId: 'copper_ore',
      count: 2,
      instance: { signer: 'Ada', charges: { temper: 3 } },
      craftedRecipeId: 'smelt_copper',
    };
    const liveInventory = [carried];
    const liveActor = {
      copper: 500,
      inventory: liveInventory,
      guildMembership: { guildId: 23 },
    };
    rig.state.meta = liveActor;
    const run = () => {
      rig.state.playerBook = book({ slots: [{ ...carried }] });
      liveInventory.splice(0, liveInventory.length);
    };

    runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit', run);

    const log = rig.session.unflushedGuildBankOps.get(23);
    expect(log).toHaveLength(2);
    expect(log?.[0]).toBe(prior);
    expect(log?.[1]).toEqual({
      op: 'deposit',
      itemId: 'copper_ore',
      count: 2,
      instance: { signer: 'Ada', charges: { temper: 3 } },
      craftedRecipeId: 'smelt_copper',
      copperDelta: 0,
      purchasedSlotsBefore: 24,
      purchasedSlotsAfter: 24,
    });
    const [rows, sidecar] = rig.commit.mock.calls[0] ?? [];
    expect(rows).toEqual([
      expect.objectContaining({
        op: 'deposit',
        itemId: 'copper_ore',
        count: 2,
        counterpartyCopperDelta: 0,
        counterpartyCount: -2,
      }),
    ]);
    expect(sidecar).toEqual({ guildId: 23, deltas: [log?.[1]] });
    expect(sidecar?.deltas[0]).toBe(log?.[1]);
    expect(rig.recordGuildBankIncident).not.toHaveBeenCalled();
    expect(rig.bankLedgerNeedsSave).toHaveBeenCalledTimes(1);
    expect(rig.scheduleBankLedgerHighWaterSave).not.toHaveBeenCalled();
  });

  it('attributes an operator purge to the operator account and keeps the carrier character', () => {
    const rig = makeRig();
    rig.state.guildBook = book({ slots: [slot('stuck_relic', 2)] });
    const run = () => {
      rig.state.guildBook = book({ slots: [slot('stuck_relic', 1)] });
    };

    runGuildBankOp(rig.host, rig.session, { guildId: 41, actorAccountId: 97 }, 'admin_purge', run);

    expect(rig.meta).not.toHaveBeenCalled();
    expect(rig.guildBankInfoFor).not.toHaveBeenCalled();
    expect(rig.guildBankInfoForGuild).toHaveBeenCalledTimes(2);
    const [rows, sidecar] = rig.commit.mock.calls[0] ?? [];
    expect(rows).toEqual([
      expect.objectContaining({
        characterId: 7,
        accountId: 97,
        op: 'admin_purge',
        containerId: 41,
        itemId: 'stuck_relic',
        count: 1,
        counterpartyCopperDelta: 0,
        counterpartyCount: 0,
      }),
    ]);
    expect(sidecar).toEqual({
      guildId: 41,
      // The staff attribution rides the effect explicitly (PR #3670): the
      // outbox owner check validates rows against THIS declared value.
      actorAccountId: 97,
      deltas: [
        expect.objectContaining({
          op: 'admin_purge',
          itemId: 'stuck_relic',
          count: 1,
        }),
      ],
    });
  });

  it('adds an orphan follow-on row for counterparty movement no book delta claims', () => {
    const rig = makeRig();
    rig.state.playerBook = book({ slots: [] });
    rig.state.meta = {
      copper: 500,
      inventory: [slot('copper_ore', 1), slot('silver_ore', 1)],
      guildMembership: { guildId: 23 },
    };
    const run = () => {
      rig.state.playerBook = book({ slots: [slot('copper_ore', 1)] });
      rig.state.meta = { copper: 490, inventory: [], guildMembership: { guildId: 23 } };
    };

    runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit', run);

    const [rows, sidecar] = rig.commit.mock.calls[0] ?? [];
    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toEqual(
      expect.objectContaining({
        op: 'deposit',
        itemId: 'copper_ore',
        counterpartyCopperDelta: -10,
        counterpartyCount: -1,
      }),
    );
    expect(rows?.[1]).toEqual(
      expect.objectContaining({
        op: 'counterparty_orphan',
        itemId: 'silver_ore',
        count: -1,
        counterpartyCopperDelta: 0,
        counterpartyCount: -1,
        instance: {
          attemptedOp: 'deposit',
          copper: 0,
          items: { silver_ore: -1 },
        },
      }),
    );
    expect(sidecar?.deltas).toHaveLength(1);
    expect(rig.recordGuildBankIncident).toHaveBeenCalledTimes(1);
    expect(rig.logError).toHaveBeenCalledWith(
      "guild bank counterparty orphan on deposit for guild 23 (character 7): the acting character's purse/bags moved value no ledger row accounts for (copper 0, -1 x silver_ore)",
    );
  });

  it('fails closed when a successful player mutation loses its guild identity', () => {
    const rig = makeRig();
    rig.state.playerBook = book({ treasury: 0 });
    rig.state.meta = { copper: 500, inventory: [], guildMembership: { guildId: 23 } };
    rig.meta
      .mockImplementationOnce(() => rig.state.meta)
      .mockImplementationOnce(() => rig.state.meta)
      .mockImplementationOnce(() => rig.state.meta)
      .mockImplementationOnce(() => null);
    const run = () => {
      rig.state.playerBook = book({ treasury: 100 });
      rig.state.meta = { copper: 400, inventory: [], guildMembership: { guildId: 23 } };
    };

    runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit_gold', run);

    expect(rig.failAfterMutation).toHaveBeenCalledTimes(1);
    expect(rig.failAfterMutation.mock.calls[0]?.[0]).toEqual(
      new Error('guild bank mutation lost its guild identity'),
    );
    expect(rig.commit).not.toHaveBeenCalled();
    expect(rig.cancel).not.toHaveBeenCalled();
    expect(rig.markGuildBankDirty).not.toHaveBeenCalled();
    expect(rig.session.unflushedGuildBankOps.size).toBe(0);
    expect(rig.bankLedgerNeedsSave).not.toHaveBeenCalled();
  });

  it('keeps exact dirty and log staging when ledger commit throws, then fails closed', () => {
    const rig = makeRig();
    const error = new Error('commit projection failed');
    rig.state.playerBook = book({ treasury: 0 });
    rig.state.meta = { copper: 500, inventory: [], guildMembership: { guildId: 23 } };
    rig.commit.mockImplementation(() => {
      expect(rig.markGuildBankDirty).toHaveBeenCalledWith(23);
      expect(rig.session.unflushedGuildBankOps.get(23)).toEqual([
        expect.objectContaining({ op: 'deposit_gold', copperDelta: 100 }),
      ]);
      throw error;
    });
    const run = () => {
      rig.state.playerBook = book({ treasury: 100 });
      rig.state.meta = { copper: 400, inventory: [], guildMembership: { guildId: 23 } };
    };

    expect(() => runGuildBankOp(rig.host, rig.session, { pid: 5 }, 'deposit_gold', run)).toThrow(
      error,
    );
    expect(rig.failAfterMutation).toHaveBeenCalledWith(error);
    expect(rig.session.unflushedGuildBankOps.get(23)).toHaveLength(1);
    expect(rig.bankLedgerNeedsSave).not.toHaveBeenCalled();
  });
});
