import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({ insertBankLedgerRow: vi.fn(), insertBankLedgerRows: vi.fn() }));

import { createBankVaultLedgerGuardCoordinator } from '../server/bank_vault_ledger_guard';
import {
  type CourierWireSim,
  courierBankExchangeFor,
  dispatchCourierCommand,
  emitCourierSelfKeys,
  readCourierDispatch,
} from '../server/courier_wire';
import type { StorageAdmissionSession } from '../server/storage_admission';
import {
  applyCourierSelfWire,
  decodeCourierData,
  decodeCourierPose,
} from '../src/net/courier_wire';
import type { CourierInfo } from '../src/sim/courier';
import type { BankInfo } from '../src/world_api/bank';

const info = (): CourierInfo => ({
  phase: 'ready',
  x: 10,
  z: 20,
  bankerId: null,
  travelDistance: 0,
  remainingDistance: 0,
  cargo: [],
  withdrawals: [],
  revision: 1,
  active: true,
  inventoryRevision: 1,
  bankRevision: 1,
  bankSlots: [{ itemId: 'wolf_fang', count: 3 }],
  bankCapacity: 24,
});
function host() {
  let value: CourierInfo | null = info();
  let rev: string | null = '1:1:true';
  const sim: CourierWireSim = {
    courierDispatch: vi.fn(),
    courierInfoFor: vi.fn(() => value),
    courierPoseFor: vi.fn(
      () =>
        value && {
          phase: value.phase,
          x: value.x,
          z: value.z,
          bankerId: value.bankerId,
          travelDistance: value.travelDistance,
          remainingDistance: value.remainingDistance,
          inventoryRevision: value.inventoryRevision,
        },
    ),
    courierWireRevisionFor: () => rev,
    courierBankInfoFor: vi.fn(() => null),
    meta: () => ({ characterId: 10 }),
  };
  return {
    sim,
    set: (next: CourierInfo | null, revision = rev) => {
      value = next;
      rev = revision;
    },
  };
}
const request = () => ({
  t: 'cmd',
  cmd: 'courier_dispatch',
  deposits: [{ index: 0, fingerprint: 'copy' }],
  withdrawals: [],
});
describe('courier wire validation and owner mirror', () => {
  it('dispatches bounded whole-stack intents only for the supplied session pid', () => {
    const { sim } = host();
    dispatchCourierCommand(sim, request(), 17);
    expect(sim.courierDispatch).toHaveBeenCalledWith(
      { deposits: [{ index: 0, fingerprint: 'copy' }], withdrawals: [] },
      17,
    );
    dispatchCourierCommand(sim, { ...request(), pid: 99 }, 17);
    dispatchCourierCommand(sim, { ...request(), accountId: 99 }, 17);
    expect(sim.courierDispatch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { deposits: [] },
    { deposits: [{ index: -1, fingerprint: 'x' }] },
    { deposits: [{ index: 0.5, fingerprint: 'x' }] },
    { deposits: [{ index: 0, fingerprint: '' }] },
    { deposits: [{ index: 0, fingerprint: 'x', count: 99 }] },
    {
      deposits: [
        { index: 0, fingerprint: 'x' },
        { index: 0, fingerprint: 'y' },
      ],
    },
    { deposits: Array.from({ length: 25 }, (_, index) => ({ index, fingerprint: 'x' })) },
    {
      deposits: Array.from({ length: 4 }, (_, index) => ({ index, fingerprint: 'x'.repeat(4000) })),
    },
  ])('rejects malformed, duplicate or excessive selections: %j', (patch) => {
    expect(readCourierDispatch({ ...request(), ...patch })).toBeNull();
  });
  it('limits the combined directions and the UTF-8 payload bytes', () => {
    const deposits = Array.from({ length: 12 }, (_, index) => ({ index, fingerprint: 'x' }));
    expect(readCourierDispatch({ ...request(), deposits, withdrawals: deposits })).not.toBeNull();
    expect(
      readCourierDispatch({
        ...request(),
        deposits,
        withdrawals: [...deposits, { index: 13, fingerprint: 'x' }],
      }),
    ).toBeNull();
    expect(
      readCourierDispatch({
        ...request(),
        deposits: [{ index: 0, fingerprint: '\u754c'.repeat(4096) }],
      }),
    ).toBeNull();
  });
  it('round-trips heavy data once, movement changes only pose, and null clears', () => {
    const { sim, set } = host();
    const sent: Record<string, string> = {};
    const session = {
      pid: 17,
      lastSent: sent,
      lastCourierWireRevision: null as string | number | null,
    };
    const target = { courierInfo: null as CourierInfo | null };
    let frame: Record<string, unknown> = {};
    const emit = (key: string, value: unknown) => {
      const raw = JSON.stringify(value);
      if (sent[key] !== raw) {
        sent[key] = raw;
        frame[key] = JSON.parse(raw);
      }
    };
    emitCourierSelfKeys(emit, sim, session);
    applyCourierSelfWire(target, frame);
    expect(target.courierInfo).toEqual(info());
    frame = {};
    set({ ...info(), x: 11, travelDistance: 8, remainingDistance: 100 });
    for (let n = 0; n < 100; n++) emitCourierSelfKeys(emit, sim, session);
    expect(frame).toEqual({
      courier: {
        phase: 'ready',
        x: 11,
        z: 20,
        bankerId: null,
        inventoryRevision: 1,
        travelDistance: 8,
        remainingDistance: 100,
      },
    });
    expect(sim.courierInfoFor).toHaveBeenCalledTimes(1);
    expect(sim.courierInfoFor).toHaveBeenCalledWith(17);
    applyCourierSelfWire(target, frame);
    expect(target.courierInfo?.x).toBe(11);
    expect(target.courierInfo?.travelDistance).toBe(8);
    expect(target.courierInfo?.remainingDistance).toBe(100);
    expect(target.courierInfo?.bankSlots).toEqual([{ itemId: 'wolf_fang', count: 3 }]);
    frame = {};
    set({ ...info(), bankSlots: [], revision: 2 }, '2:2:true');
    emitCourierSelfKeys(emit, sim, session);
    applyCourierSelfWire(target, frame);
    expect(target.courierInfo?.bankSlots).toEqual([]);
    frame = {};
    set(null, null);
    emitCourierSelfKeys(emit, sim, session);
    applyCourierSelfWire(target, frame);
    expect(target.courierInfo).toBeNull();
  });
  it.each([
    { travelDistance: -1 },
    { travelDistance: 8.01 },
    { travelDistance: Infinity },
    { travelDistance: NaN },
    { travelDistance: undefined },
    { travelDistance: '8' },
    { remainingDistance: -1 },
    { remainingDistance: Infinity },
    { remainingDistance: NaN },
    { remainingDistance: undefined },
    { remainingDistance: '0' },
  ])('rejects malformed scalar motion metadata without changing the mirror: %j', (patch) => {
    const pose = {
      phase: 'outbound',
      x: 1,
      z: 2,
      bankerId: 2,
      inventoryRevision: 1,
      travelDistance: 8,
      remainingDistance: 100,
    };
    expect(decodeCourierPose(pose)).toEqual(pose);
    const target = { courierInfo: info() as CourierInfo | null };
    const before = target.courierInfo;
    applyCourierSelfWire(target, { courier: { ...pose, ...patch } });
    expect(target.courierInfo).toBe(before);
    expect(decodeCourierPose({ ...pose, ...patch })).toBeUndefined();
  });
  it('retains omitted data and refuses malformed nested rows or pose', () => {
    const target = { courierInfo: info() as CourierInfo | null };
    applyCourierSelfWire(target, {});
    const before = target.courierInfo;
    applyCourierSelfWire(target, {
      courier: { phase: 'ready', x: null, z: 20, bankerId: null, inventoryRevision: 1 },
    });
    expect(target.courierInfo).toBe(before);
    expect(
      decodeCourierPose({ phase: 'unknown', x: 1, z: 2, bankerId: null, inventoryRevision: 1 }),
    ).toBeUndefined();
    const { phase, x, z, bankerId, inventoryRevision, travelDistance, remainingDistance, ...data } =
      info();
    expect(
      decodeCourierData({ ...data, cargo: [{ itemId: 'wolf_fang', count: -1 }] }),
    ).toBeUndefined();
    expect(
      decodeCourierData({ ...data, cargo: Array(25).fill({ itemId: 'wolf_fang', count: 1 }) }),
    ).toBeUndefined();
    expect(decodeCourierData({ ...data, active: 'true' })).toBeUndefined();
  });
});

function ledgerRig() {
  const { sim } = host();
  const rows: unknown[][] = [];
  const fail = vi.fn();
  const cancel = vi.fn(() => true);
  const commit = vi.fn((batch: readonly unknown[]) => {
    rows.push([...batch]);
    return true;
  });
  const admission = { tryReserve: vi.fn(() => ({ commit, cancel, failAfterMutation: fail })) };
  const guard = createBankVaultLedgerGuardCoordinator(() => 0);
  const runtime = guard.createRuntime(20, admission, vi.fn());
  const session = {
    pid: 17,
    characterId: 10,
    accountId: 20,
    left: false,
    escrowQuarantined: false,
    bankLedgerJournal: { outbox: { owner: { characterId: 10, accountId: 20 } } },
    bankVaultLedgerGuard: runtime,
  } as unknown as StorageAdmissionSession;
  const bank = {
    slots: [{ itemId: 'wolf_fang', count: 3 }],
    purchasedSlots: 0,
    nextExpansionCost: 500,
  } as BankInfo;
  sim.courierBankInfoFor = () => structuredClone(bank);
  return { sim, session, bank, rows, admission, fail, cancel, commit };
}
describe('courier admitted bank exchange', () => {
  it('signals post-mutation failure and never cancels when a reservation rejects commit', () => {
    const rig = ledgerRig();
    const commit = vi.fn(() => false);
    const failAfterMutation = vi.fn();
    const cancel = vi.fn(() => true);
    rig.session.bankVaultLedgerGuard = {
      ...rig.session.bankVaultLedgerGuard,
      admission: { tryReserve: () => ({ commit, failAfterMutation, cancel }) },
    };
    const deposit = vi.fn(() => {
      rig.bank.slots[0].count += 2;
    });
    const withdraw = vi.fn(() => {
      rig.bank.slots[0].count -= 1;
    });
    expect(() => courierBankExchangeFor(rig.sim, rig.session, 17, deposit, withdraw)).toThrow(
      'courier bank ledger commit refused',
    );
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(rig.bank.slots[0].count).toBe(4);
    expect(commit).toHaveBeenCalledWith([
      expect.objectContaining({ op: 'deposit', count: 2 }),
      expect.objectContaining({ op: 'withdraw', count: 1 }),
    ]);
    expect(failAfterMutation).toHaveBeenCalledTimes(1);
    expect(failAfterMutation).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'courier bank ledger commit refused' }),
    );
    expect(cancel).not.toHaveBeenCalled();
  });

  it('reserves before mutation and records both net-zero legs', () => {
    const rig = ledgerRig();
    const result = courierBankExchangeFor(
      rig.sim,
      rig.session,
      17,
      () => {
        expect(rig.admission.tryReserve).toHaveBeenCalledWith(24, 0, 'personal');
        rig.bank.slots[0].count += 2;
      },
      () => {
        rig.bank.slots[0].count -= 2;
      },
    );
    expect(result).toBe(true);
    expect(rig.rows).toHaveLength(1);
    expect(rig.rows[0]).toMatchObject([
      { op: 'deposit', itemId: 'wolf_fang', count: 2, characterId: 10, accountId: 20 },
      { op: 'withdraw', itemId: 'wolf_fang', count: 2, characterId: 10, accountId: 20 },
    ]);
  });
  it('refuses without mutation when the journal has no capacity', () => {
    const rig = ledgerRig();
    rig.session.bankVaultLedgerGuard = {
      ...rig.session.bankVaultLedgerGuard,
      admission: { tryReserve: () => null },
    };
    const deposit = vi.fn();
    const withdraw = vi.fn();
    expect(courierBankExchangeFor(rig.sim, rig.session, 17, deposit, withdraw)).toBe(false);
    expect(deposit).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
  });
  it.each(['left', 'escrowQuarantined', 'character', 'account', 'pid'] as const)(
    'refuses a stale or quarantined owner fence: %s',
    (kind) => {
      const rig = ledgerRig();
      if (kind === 'left' || kind === 'escrowQuarantined') rig.session[kind] = true;
      if (kind === 'character') rig.session.characterId = 11;
      if (kind === 'account') rig.session.accountId = 21;
      if (kind === 'pid') rig.session.pid = 18;
      const mutate = vi.fn();
      expect(courierBankExchangeFor(rig.sim, rig.session, 17, mutate, mutate)).toBe(false);
      expect(mutate).not.toHaveBeenCalled();
      expect(rig.admission.tryReserve).not.toHaveBeenCalled();
    },
  );
  it('quarantines a throwing mutation and never refunds ambiguous custody', () => {
    const rig = ledgerRig();
    const error = new Error('mutation failed');
    expect(() =>
      courierBankExchangeFor(
        rig.sim,
        rig.session,
        17,
        () => {
          throw error;
        },
        vi.fn(),
      ),
    ).toThrow(error);
    expect(rig.fail).toHaveBeenCalledWith(error);
    expect(rig.cancel).not.toHaveBeenCalled();
  });
});
