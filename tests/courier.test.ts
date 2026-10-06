import { describe, expect, it, vi } from 'vitest';
import { emptyBankState } from '../src/sim/bank';
import {
  courierDispatch,
  courierInfoFor,
  courierPayloadFits,
  courierPoseFor,
  courierSlotFingerprint,
  courierSummon,
  courierWireRevisionFor,
  sanitizeCourierState,
  savedCourierState,
  updateCourier,
} from '../src/sim/courier';
import { INSTANCE_X_BASE } from '../src/sim/data';
import { perfectMembershipArmour } from '../src/sim/membership_armour_progression';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { cloneInvSlot, DT, type Entity, type InvSlot } from '../src/sim/types';

// A narrow live seam fixture: only fields the courier owns/reads are supplied.
// Real container movement and persistence sanitizers are never mocked.
function fixture() {
  const player = { id: 1, pos: { x: 0, y: 0, z: 0 }, dead: false } as Entity;
  const banker = { id: 2, kind: 'npc', pos: { x: 17.5, y: 0, z: 0 }, dead: false } as Entity;
  const meta = {
    entityId: 1,
    name: 'Courier test',
    inventory: [],
    bank: emptyBankState(),
    bags: [null, null, null, null],
    bankWireRev: 0,
    wireRev: 0,
    membershipExpiresAt: 1000,
  } as unknown as PlayerMeta;
  const ctx = {
    time: 0,
    players: new Map([[1, meta]]),
    entities: new Map([
      [1, player],
      [2, banker],
    ]),
    bankerIds: [2],
    resolve: () => ({ meta, e: player }),
    emit: vi.fn(),
    onInventoryChangedForQuests: vi.fn(),
  } as unknown as SimContext;
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) updateCourier(ctx, meta, player);
  };
  courierSummon(ctx, 1);
  return { ctx, meta, player, banker, tick };
}
const selection = (slots: InvSlot[], index = 0) => ({
  index,
  fingerprint: courierSlotFingerprint(slots[index]),
});
const food = (count = 1): InvSlot => ({ itemId: 'baked_bread', count });
const meat = (count = 1): InvSlot => ({ itemId: 'roasted_boar', count });

describe('membership courier custody', () => {
  it('keeps a whole cargo stack when only partial merge room exists, then delivers when the whole stack fits', () => {
    const f = fixture();
    f.meta.inventory = [food(19), ...Array.from({ length: 15 }, () => meat(20))];
    const courier = f.meta.courier!;
    courier.phase = 'waiting';
    courier.cargo = [food(2)];
    const revision = courier.revision;
    f.tick();
    expect(f.meta.inventory[0].count).toBe(19);
    expect(courier.cargo).toEqual([food(2)]);
    expect(courier.revision).toBe(revision);
    expect(f.ctx.onInventoryChangedForQuests).not.toHaveBeenCalled();
    // The shared container mover is all-or-nothing for a selected whole stack.
    f.meta.inventory[0].count = 18;
    f.tick(20);
    expect(f.meta.inventory[0].count).toBe(20);
    expect(f.meta.inventory).toHaveLength(16);
    expect(courier.cargo).toEqual([]);
    expect(courier.phase).toBe('ready');
    expect(courier.revision).toBe(revision + 1);
    expect(f.ctx.onInventoryChangedForQuests).toHaveBeenCalledTimes(1);
  });

  it.each(['deposit', 'withdraw'] as const)(
    'atomically refuses a mixed request containing a quest-item %s',
    (direction) => {
      const f = fixture();
      const questItem = { itemId: 'clue_scroll', count: 1 };
      f.meta.inventory = [food(), questItem];
      f.meta.bank.inventory = [meat(), cloneInvSlot(questItem)];
      const inventoryBefore = f.meta.inventory.map(cloneInvSlot);
      const bankBefore = f.meta.bank.inventory.map(cloneInvSlot);
      const courierBefore = savedCourierState(f.meta.courier!);
      const deposits = [selection(f.meta.inventory)];
      const withdrawals = [selection(f.meta.bank.inventory)];
      if (direction === 'deposit') deposits.push(selection(f.meta.inventory, 1));
      else withdrawals.push(selection(f.meta.bank.inventory, 1));
      expect(courierDispatch(f.ctx, { deposits, withdrawals }, 1)).toBe(false);
      expect(f.meta.inventory).toEqual(inventoryBefore);
      expect(f.meta.bank.inventory).toEqual(bankBefore);
      expect(f.meta.courier).toEqual(courierBefore);
      expect(f.ctx.onInventoryChangedForQuests).not.toHaveBeenCalled();
    },
  );

  it.each([
    { bank: food(2), deposit: food(3) },
    {
      bank: { ...food(2), instance: { craftedBy: 'test' } },
      deposit: { ...food(3), instance: { craftedBy: 'test' } },
    },
    {
      bank: {
        itemId: 'wolf_fang',
        count: 2,
        materialSources: [{ source: { signer: 'bank' }, count: 2 }],
      },
      deposit: {
        itemId: 'wolf_fang',
        count: 3,
        materialSources: [{ source: { signer: 'cargo' }, count: 3 }],
      },
    },
  ])(
    'withdraws only the selected original units when its own deposit tops up that stack: %j',
    ({ bank, deposit }) => {
      const f = fixture();
      f.meta.bank.inventory = [cloneInvSlot(bank as InvSlot)];
      f.meta.inventory = [cloneInvSlot(deposit as InvSlot)];
      const phases: InvSlot[][] = [];
      Object.assign(f.ctx, {
        courierBankExchange: (_pid: number, put: () => void, take: () => void) => {
          put();
          phases.push(f.meta.bank.inventory.map(cloneInvSlot));
          take();
          phases.push(f.meta.bank.inventory.map(cloneInvSlot));
          return true;
        },
      });
      expect(
        courierDispatch(
          f.ctx,
          {
            deposits: [selection(f.meta.inventory)],
            withdrawals: [selection(f.meta.bank.inventory)],
          },
          1,
        ),
      ).toBe(true);
      f.tick(40);
      expect(phases[0][0].count).toBe(5);
      expect(phases[1][0].count).toBe(3);
      expect(f.meta.inventory).toEqual([bank]);
      expect(f.meta.bank.inventory).toEqual([deposit]);
    },
  );

  it('reuses heavy projections during flight and invalidates only ready bank changes', () => {
    const f = fixture();
    const first = courierInfoFor(f.ctx, 1)!;
    expect(courierInfoFor(f.ctx, 1)).toBe(first);
    f.meta.bank.inventory = [food()];
    f.meta.bankWireRev++;
    const bankChanged = courierInfoFor(f.ctx, 1)!;
    expect(bankChanged).not.toBe(first);
    expect(bankChanged.bankSlots).toEqual([food()]);
    f.meta.wireRev++;
    expect(courierInfoFor(f.ctx, 1)).toBe(bankChanged);
    expect(bankChanged.inventoryRevision).toBe(1);
    courierDispatch(f.ctx, { deposits: [], withdrawals: [selection(f.meta.bank.inventory)] }, 1);
    const flying = courierInfoFor(f.ctx, 1)!;
    const oldX = flying.x;
    f.tick(5);
    expect(courierInfoFor(f.ctx, 1)).toBe(flying);
    expect(flying.x).toBeGreaterThan(oldX);
  });

  it('unrelated broad wire revisions never clone a grown ready bank', () => {
    const f = fixture();
    f.meta.bank.inventory = Array.from({ length: 10000 }, () => food());
    const bankMap = vi.spyOn(f.meta.bank.inventory, 'map');
    const first = courierInfoFor(f.ctx, 1)!;
    const revision = courierWireRevisionFor(f.ctx, 1);
    expect(bankMap).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 100; i++) {
      f.meta.wireRev = i;
      expect(courierWireRevisionFor(f.ctx, 1)).toBe(revision);
      expect(courierInfoFor(f.ctx, 1)).toBe(first);
      expect(first.inventoryRevision).toBe(i);
      expect(courierPoseFor(f.ctx, 1)?.inventoryRevision).toBe(i);
    }
    expect(bankMap).toHaveBeenCalledTimes(1);
    f.meta.bankWireRev++;
    expect(courierInfoFor(f.ctx, 1)).not.toBe(first);
    expect(bankMap).toHaveBeenCalledTimes(2);
  });
  it('travels at 17.5 units/second, deposits at the banker and delivers only on return', () => {
    const f = fixture();
    f.meta.inventory = [food(3)];
    f.meta.bank.inventory = [meat(2)];
    expect(
      courierDispatch(
        f.ctx,
        {
          deposits: [selection(f.meta.inventory)],
          withdrawals: [selection(f.meta.bank.inventory)],
        },
        1,
      ),
    ).toBe(true);
    expect(f.meta.inventory).toEqual([]);
    expect(f.meta.bank.inventory).toEqual([meat(2)]);
    f.tick(10);
    expect(f.meta.courier!.x).toBeCloseTo(8.75);
    expect(f.meta.courier!.phase).toBe('outbound');
    f.tick(10);
    expect(f.meta.bank.inventory).toEqual([food(3)]);
    expect(f.meta.courier!.cargo).toEqual([meat(2)]);
    expect(f.meta.inventory).toEqual([]);
    f.tick(20);
    expect(f.meta.inventory).toEqual([meat(2)]);
    expect(f.meta.courier!.phase).toBe('ready');
  });

  it('chooses the nearest banker once and chases the moving owner on return', () => {
    const f = fixture();
    f.ctx.entities.set(3, { ...f.banker, id: 3, pos: { x: 7, y: 0, z: 0 } });
    f.ctx.bankerIds.push(3);
    f.meta.inventory = [food()];
    courierDispatch(f.ctx, { deposits: [selection(f.meta.inventory)], withdrawals: [] }, 1);
    expect(f.meta.courier!.bankerId).toBe(3);
    f.tick(8);
    f.player.pos.z = 7;
    f.tick(20);
    expect(f.meta.courier!.phase).toBe('ready');
    expect(f.meta.courier!.z).toBe(7);
  });

  it('preserves soulbound instance and crafted provenance through save and return', () => {
    const f = fixture();
    const slot: InvSlot = {
      itemId: 'membership_helmet',
      count: 1,
      craftedRecipeId: 'recipe_test',
      instance: { perfected: true },
    };
    f.meta.bank.inventory = [slot];
    courierDispatch(f.ctx, { deposits: [], withdrawals: [selection(f.meta.bank.inventory)] }, 1);
    f.tick(20);
    const snapshot = savedCourierState(f.meta.courier!);
    f.meta.courier = sanitizeCourierState(snapshot, f.meta.name, [], 1);
    f.tick(20);
    expect(f.meta.inventory).toEqual([slot]);
    expect(snapshot.cargo).toEqual([slot]);
  });

  it('preserves exact material source composition on the round trip', () => {
    const f = fixture();
    const slot: InvSlot = {
      itemId: 'wolf_fang',
      count: 3,
      materialSources: [
        { source: {}, count: 1 },
        { source: { signer: 'a' }, count: 2 },
      ],
    };
    f.meta.inventory = [slot];
    courierDispatch(f.ctx, { deposits: [selection(f.meta.inventory)], withdrawals: [] }, 1);
    f.tick(40);
    expect(f.meta.bank.inventory[0].materialSources).toEqual(slot.materialSources);
    courierDispatch(f.ctx, { deposits: [], withdrawals: [selection(f.meta.bank.inventory)] }, 1);
    f.tick(40);
    expect(f.meta.inventory[0].materialSources).toEqual(slot.materialSources);
    expect(f.meta.inventory[0].count).toBe(3);
  });

  it('returns deposits that cannot fit and keeps cargo while bags are full', () => {
    const f = fixture();
    f.meta.inventory = [food()];
    f.meta.bank.inventory = Array.from({ length: 24 }, () => meat(20));
    courierDispatch(f.ctx, { deposits: [selection(f.meta.inventory)], withdrawals: [] }, 1);
    f.meta.inventory = Array.from({ length: 16 }, () => meat(20));
    f.tick(40);
    expect(f.meta.courier!.phase).toBe('waiting');
    expect(f.meta.courier!.cargo).toEqual([food()]);
    const rev = f.meta.courier!.revision;
    f.meta.inventory.pop();
    f.tick(19);
    expect(f.meta.courier!.cargo).toEqual([food()]);
    expect(f.meta.courier!.revision).toBe(rev);
    f.tick(1);
    expect(f.meta.courier!.phase).toBe('ready');
    expect(f.meta.inventory.at(-1)).toEqual(food());
  });

  it('requires audit admission before either bank phase and retries once a second', () => {
    const f = fixture();
    f.meta.inventory = [food()];
    let admitted = false;
    const hook = vi.fn((_pid, deposit, withdraw) => {
      if (!admitted) return false;
      deposit();
      withdraw();
      return true;
    });
    Object.assign(f.ctx, { courierBankExchange: hook });
    courierDispatch(f.ctx, { deposits: [selection(f.meta.inventory)], withdrawals: [] }, 1);
    f.tick(39);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(f.meta.bank.inventory).toEqual([]);
    expect(f.meta.courier!.cargo).toEqual([food()]);
    admitted = true;
    f.tick();
    expect(hook).toHaveBeenCalledTimes(2);
    expect(f.meta.bank.inventory).toEqual([food()]);
  });

  it('a refused arrival performs no bank slot reads or fingerprint work', () => {
    const f = fixture();
    f.meta.bank.inventory = [food()];
    courierDispatch(f.ctx, { deposits: [], withdrawals: [selection(f.meta.bank.inventory)] }, 1);
    f.meta.bank.inventory = new Proxy(f.meta.bank.inventory, {
      get(target, key, receiver) {
        if (/^\d+$/.test(String(key))) throw new Error('Refused arrival inspected bank inventory');
        return Reflect.get(target, key, receiver);
      },
    });
    const admit = vi.fn(() => false);
    Object.assign(f.ctx, { courierBankExchange: admit });
    f.tick(40);
    expect(admit).toHaveBeenCalledTimes(2);
    expect(f.meta.courier!.phase).toBe('outbound');
  });

  it('finishes custody after expiry but refuses another dispatch or a new summon', () => {
    const f = fixture();
    f.meta.bank.inventory = [food()];
    courierDispatch(f.ctx, { deposits: [], withdrawals: [selection(f.meta.bank.inventory)] }, 1);
    f.meta.membershipExpiresAt = 0;
    f.tick(40);
    expect(f.meta.inventory).toEqual([food()]);
    expect(
      courierDispatch(f.ctx, { deposits: [selection(f.meta.inventory)], withdrawals: [] }, 1),
    ).toBe(false);
    expect(courierSummon(f.ctx, 1)).toBe(true);
    delete f.meta.courier;
    expect(courierSummon(f.ctx, 1)).toBe(false);
  });

  it('does not carry items into an instance or deliver to a dead owner', () => {
    const f = fixture();
    f.meta.bank.inventory = [food()];
    courierDispatch(f.ctx, { deposits: [], withdrawals: [selection(f.meta.bank.inventory)] }, 1);
    f.tick(20);
    f.player.pos.x = INSTANCE_X_BASE + 900;
    f.tick(100);
    expect(f.meta.courier!.x).toBe(17.5);
    f.player.pos.x = 0;
    f.player.dead = true;
    f.tick(100);
    expect(f.meta.inventory).toEqual([]);
    f.player.dead = false;
    f.tick(20);
    expect(f.meta.inventory).toEqual([food()]);
    f.player.pos.x = INSTANCE_X_BASE + 900;
    expect(
      courierDispatch(f.ctx, { deposits: [selection(f.meta.inventory)], withdrawals: [] }, 1),
    ).toBe(false);
  });

  it('refuses stale selections and does not substitute a changed bank stack at arrival', () => {
    const f = fixture();
    f.meta.inventory = [food(2)];
    const stale = selection(f.meta.inventory);
    f.meta.inventory[0].count = 3;
    expect(courierDispatch(f.ctx, { deposits: [stale], withdrawals: [] }, 1)).toBe(false);
    f.meta.bank.inventory = [meat()];
    courierDispatch(f.ctx, { deposits: [], withdrawals: [selection(f.meta.bank.inventory)] }, 1);
    f.meta.bank.inventory[0].count = 2;
    f.tick(40);
    expect(f.meta.bank.inventory).toEqual([meat(2)]);
    expect(f.meta.inventory).toEqual([food(3)]);
  });

  it('refuses duplicate, oversized and over-budget selections without mutating custody', () => {
    const f = fixture();
    f.meta.inventory = [food()];
    const pick = selection(f.meta.inventory);
    for (const deposits of [
      [pick, pick],
      Array.from({ length: 25 }, (_, index) => ({ ...pick, index })),
      [{ ...pick, fingerprint: 'x'.repeat(12289) }],
    ]) {
      expect(courierDispatch(f.ctx, { deposits, withdrawals: [] }, 1)).toBe(false);
      expect(f.meta.inventory).toEqual([food()]);
      expect(f.meta.courier!.cargo).toEqual([]);
    }
  });

  it('returns existing cargo safely if its destination banker disappears', () => {
    const f = fixture();
    f.meta.inventory = [food()];
    courierDispatch(f.ctx, { deposits: [selection(f.meta.inventory)], withdrawals: [] }, 1);
    f.tick(5);
    f.ctx.entities.delete(2);
    f.tick(10);
    expect(f.meta.inventory).toEqual([food()]);
    expect(f.meta.courier!.phase).toBe('ready');
  });

  it('does not exchange at a saved NPC id that is no longer a banker anchor', () => {
    const f = fixture();
    f.meta.inventory = [food()];
    courierDispatch(f.ctx, { deposits: [selection(f.meta.inventory)], withdrawals: [] }, 1);
    f.ctx.bankerIds.length = 0;
    f.tick(40);
    expect(f.meta.inventory).toEqual([food()]);
    expect(f.meta.bank.inventory).toEqual([]);
    expect(f.meta.courier!.phase).toBe('ready');
  });

  it('boundary clones cargo and gates heavy reads independently of flight position', () => {
    const f = fixture();
    f.meta.inventory = [food()];
    courierDispatch(f.ctx, { deposits: [selection(f.meta.inventory)], withdrawals: [] }, 1);
    const revision = courierWireRevisionFor(f.ctx, 1);
    f.tick(5);
    expect(courierWireRevisionFor(f.ctx, 1)).toBe(revision);
    const info = courierInfoFor(f.ctx, 1)!;
    info.cargo[0].count = 100;
    expect(f.meta.courier!.cargo[0].count).toBe(1);
    expect(info.bankSlots).toEqual([]);
  });

  it('freezes a saved outbound trip and restores independent inventory objects', () => {
    const f = fixture();
    f.meta.inventory = [food(4)];
    courierDispatch(f.ctx, { deposits: [selection(f.meta.inventory)], withdrawals: [] }, 1);
    f.tick(5);
    const save = savedCourierState(f.meta.courier!);
    f.meta.courier = sanitizeCourierState(save);
    expect(f.meta.courier!.x).toBeCloseTo(17.5 * DT * 5);
    expect(f.meta.courier!.cargo[0]).not.toBe(save.cargo[0]);
    f.tick(35);
    expect(f.meta.bank.inventory).toEqual([food(4)]);
    expect(save.cargo).toEqual([food(4)]);
  });

  it('rejects oversized saved custody instead of silently deleting owned items', () => {
    expect(() =>
      sanitizeCourierState({ cargo: Array.from({ length: 25 }, () => cloneInvSlot(food())) }),
    ).toThrow('capacity');
    expect(sanitizeCourierState(undefined)).toBeUndefined();
    const repaired = sanitizeCourierState({ phase: 'junk', x: NaN, cargo: [food()] });
    expect(repaired!.cargo).toEqual([food()]);
    expect(repaired!.phase).toBe('waiting');
  });

  it('drops malformed excess requests while preserving all 24 owned cargo stacks', () => {
    const cargo = Array.from({ length: 24 }, () => food());
    const loaded = sanitizeCourierState({
      phase: 'outbound',
      x: 0,
      z: 0,
      cargo,
      withdrawals: [{ index: 0, fingerprint: 'bad' }],
    })!;
    expect(loaded.cargo).toEqual(cargo);
    expect(loaded.withdrawals).toEqual([]);
  });

  it('accepted near-limit requests remain loadable after flight coordinates grow', () => {
    const f = fixture();
    const bankSlot = { ...food(), instance: { craftedBy: 'x'.repeat(11000) } } as InvSlot;
    f.meta.bank.inventory = [bankSlot];
    f.meta.inventory = [{ itemId: 'membership_helmet', count: 1 }];
    f.meta.equipment = {};
    f.meta.equipmentInstance = {};
    const request = {
      deposits: [selection(f.meta.inventory)],
      withdrawals: [selection(f.meta.bank.inventory)],
    };
    expect(courierDispatch(f.ctx, request, 1)).toBe(true);
    f.banker.pos.z = 8.123456789;
    f.tick(7);
    perfectMembershipArmour(f.meta, 20);
    const saved = savedCourierState(f.meta.courier!);
    expect(courierPayloadFits(saved)).toBe(true);
    const restored = sanitizeCourierState(saved)!;
    expect(restored.x).toBe(saved.x);
    expect(restored.z).toBe(saved.z);
    expect(restored.withdrawals).toEqual(request.withdrawals);
    expect(restored.cargo[0].instance?.perfected).toBe(true);
  });

  it('refuses a withdrawal whose legacy stack splitting would exceed custody bytes', () => {
    const f = fixture();
    const slot = { ...food(400), craftedRecipeId: 'x'.repeat(600) };
    f.meta.bank.inventory = [slot];
    expect(
      courierDispatch(f.ctx, { deposits: [], withdrawals: [selection(f.meta.bank.inventory)] }, 1),
    ).toBe(true);
    f.tick(40);
    expect(f.meta.inventory).toEqual([]);
    expect(f.meta.bank.inventory).toEqual([slot]);
    expect(f.meta.courier!.cargo).toEqual([]);
    expect(f.meta.courier!.phase).toBe('ready');
  });
});
