// HOSTILE AUDIT PROBE (throwaway): capacity/stacking, ladder integrity, and
// malicious-client input against the guild bank. Assertions state the SAFE
// expectation; a FAILING assertion is the finding.
import { describe, expect, it } from 'vitest';
import { bankDeposit, bankWithdraw } from '../src/sim/bank';
import { BUILTIN_WORLD } from '../src/sim/data';
import type { GuildBankOpDelta, GuildRank } from '../src/sim/guild_bank';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';

const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'] as const;
const WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: Object.fromEntries(BANKERS.map((id) => [id, BUILTIN_WORLD.npcs[id]])),
  groundObjects: [],
};
const GUILD_ID = 7;

function moveToBanker(sim: Sim, pid = sim.playerId): Entity {
  let banker: Entity | null = null;
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === BANKERS[0]) banker = e;
  }
  if (!banker) throw new Error('banker is not spawned');
  const p = sim.entities.get(pid);
  if (!p) throw new Error('missing player');
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  return banker;
}

function makeOfficerSim(
  opts: { rank?: GuildRank; treasury?: number; purchasedSlots?: number } = {},
): Sim {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false, world: WORLD });
  moveToBanker(sim);
  sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: opts.rank ?? 'officer' });
  sim.loadGuildBank(GUILD_ID, {
    treasury: opts.treasury ?? 100_000,
    inventory: [],
    purchasedSlots: opts.purchasedSlots ?? 24,
  });
  return sim;
}

const meta = (sim: Sim) => {
  const m = sim.players.get(sim.playerId);
  if (!m) throw new Error('missing meta');
  return m;
};
const book = (sim: Sim) => {
  const b = sim.guildBanks.get(GUILD_ID);
  if (!b) throw new Error('missing book');
  return b;
};

// ---------------------------------------------------------------------------
// E: craftedRecipeId provenance across the INSTANCED arm of moveBetweenContainers
// ---------------------------------------------------------------------------
describe('PROBE E1: crafted provenance on an instanced slot', () => {
  it('E1a: a deposit keeps craftedRecipeId on a slot that also carries an instance payload', () => {
    const sim = makeOfficerSim();
    meta(sim).inventory.length = 0;
    meta(sim).inventory.push({
      itemId: 'wolf_fang',
      count: 3,
      instance: { signer: 'Ana' },
      craftedRecipeId: 'jerky',
    });
    sim.guildBankDepositFor(sim.playerId, 0);
    expect(book(sim).inventory).toEqual([
      { itemId: 'wolf_fang', count: 3, instance: { signer: 'Ana' }, craftedRecipeId: 'jerky' },
    ]);
  });

  it('E1b: a crafted+instanced deposit does NOT merge into a same-payload UNCRAFTED book stack', () => {
    const sim = makeOfficerSim();
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 15, instance: { signer: 'Ana' } });
    meta(sim).inventory.length = 0;
    meta(sim).inventory.push({
      itemId: 'wolf_fang',
      count: 5,
      instance: { signer: 'Ana' },
      craftedRecipeId: 'jerky',
    });
    sim.guildBankDepositFor(sim.playerId, 0);
    // Safe outcome: two separate slots (provenance is a stacking dimension).
    expect(book(sim).inventory.length).toBe(2);
  });

  it('E1c: the same strip in the PERSONAL bank (shared moveBetweenContainers)', () => {
    const sim = makeOfficerSim();
    meta(sim).inventory.length = 0;
    meta(sim).inventory.push({
      itemId: 'wolf_fang',
      count: 3,
      instance: { signer: 'Ana' },
      craftedRecipeId: 'jerky',
    });
    bankDeposit(sim.ctx, 0, undefined, sim.playerId);
    expect(meta(sim).bank.inventory).toEqual([
      { itemId: 'wolf_fang', count: 3, instance: { signer: 'Ana' }, craftedRecipeId: 'jerky' },
    ]);
  });

  it('E1d: a guild-bank round trip returns the marker to the bags', () => {
    const sim = makeOfficerSim();
    meta(sim).inventory.length = 0;
    meta(sim).inventory.push({
      itemId: 'wolf_fang',
      count: 3,
      instance: { signer: 'Ana' },
      craftedRecipeId: 'jerky',
    });
    sim.guildBankDepositFor(sim.playerId, 0);
    sim.guildBankWithdrawFor(sim.playerId, 0);
    expect(meta(sim).inventory[0]).toEqual({
      itemId: 'wolf_fang',
      count: 3,
      instance: { signer: 'Ana' },
      craftedRecipeId: 'jerky',
    });
  });

  it('E1e: the PLAIN arm (control) does keep the marker', () => {
    const sim = makeOfficerSim();
    meta(sim).inventory.length = 0;
    meta(sim).inventory.push({ itemId: 'wolf_fang', count: 3, craftedRecipeId: 'jerky' });
    sim.guildBankDepositFor(sim.playerId, 0);
    expect(book(sim).inventory).toEqual([
      { itemId: 'wolf_fang', count: 3, craftedRecipeId: 'jerky' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// G: ladder integrity through the revert path
// ---------------------------------------------------------------------------
const openDelta: GuildBankOpDelta = {
  op: 'open_bank',
  itemId: null,
  count: null,
  instance: null,
  copperDelta: -90_000,
  purchasedSlotsBefore: 0,
  purchasedSlotsAfter: 24,
};
const buyDelta = (price: number, before = 24, after = 30): GuildBankOpDelta => ({
  op: 'buy_slots',
  itemId: null,
  count: null,
  instance: null,
  copperDelta: -price,
  purchasedSlotsBefore: before,
  purchasedSlotsAfter: after,
});

describe('PROBE G: purchasedSlots ladder through revertGuildBankDeltas', () => {
  it('G1: reverting the OPENING session before the expander leaves 24 unpaid slots', () => {
    // Server-level setup this models (server/game.ts reconcileUnflushableGuildBooks):
    // session A opened the bank (0 -> 24, purse-paid), session B bought rung 1
    // (24 -> 30, treasury-paid), and a third session C holds an unflushed dirty
    // mark for the same guild throughout, so BOTH fence-outs take the surgical
    // REVERT arm rather than the evict-and-reload arm.
    const sim = makeOfficerSim({ purchasedSlots: 0, treasury: 0 });
    book(sim).purchasedSlots = 30;
    book(sim).treasury = 0; // B's 25_000 left the treasury
    // A fences out first: its open_bank delta is reverted while the book sits at 30.
    sim.revertGuildBankDeltas(GUILD_ID, [openDelta]);
    // B fences out next: its buy_slots delta is reverted (30 -> 24, +25_000).
    sim.revertGuildBankDeltas(GUILD_ID, [buyDelta(25_000)]);
    // Safe outcome: nobody's purchase survived, so the bank is CLOSED again.
    expect(book(sim).purchasedSlots).toBe(0);
  });

  it('G2: the other fence-out order is consistent (control)', () => {
    const sim = makeOfficerSim({ purchasedSlots: 0, treasury: 0 });
    book(sim).purchasedSlots = 30;
    sim.revertGuildBankDeltas(GUILD_ID, [buyDelta(25_000)]);
    sim.revertGuildBankDeltas(GUILD_ID, [openDelta]);
    expect(book(sim).purchasedSlots).toBe(0);
    expect(book(sim).treasury).toBe(25_000);
  });

  it('G3: no live sequence strands a NON-ladder purchasedSlots', () => {
    const positions = [0, 24, 30, 36, 42, 48, 54, 60];
    for (const start of positions) {
      for (const d of [openDelta, buyDelta(25_000), buyDelta(1_000_000, 54, 60)]) {
        const sim = makeOfficerSim({ purchasedSlots: 0, treasury: 0 });
        book(sim).purchasedSlots = start;
        sim.revertGuildBankDeltas(GUILD_ID, [d]);
        expect(positions, `${start} / ${d.op}`).toContain(book(sim).purchasedSlots);
      }
    }
  });

  it('G4: buying at the ladder top is refused and takes no copper', () => {
    const sim = makeOfficerSim({ purchasedSlots: 60, treasury: 1_000_000_000 });
    const before = book(sim).treasury;
    sim.guildBankBuySlotsFor(sim.playerId);
    expect(book(sim).purchasedSlots).toBe(60);
    expect(book(sim).treasury).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// H: malicious-client shapes reaching the sim (server shape check is typeof only)
// ---------------------------------------------------------------------------
const HOSTILE_NUMBERS = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -1,
  -0,
  0,
  0.5,
  2.5,
  1e9,
  1e308,
  Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER + 2,
  -1e308,
];

function conserved(sim: Sim): string {
  const b = book(sim);
  return JSON.stringify({
    copper: meta(sim).copper,
    inv: meta(sim).inventory,
    treasury: b.treasury,
    bookInv: b.inventory,
    slots: b.purchasedSlots,
  });
}

describe('PROBE H: hostile scalars never mint or vaporize', () => {
  it('H1: hostile slot/count on deposit conserve the item total', () => {
    for (const slot of HOSTILE_NUMBERS) {
      for (const count of [...HOSTILE_NUMBERS, undefined]) {
        const sim = makeOfficerSim();
        meta(sim).inventory.length = 0;
        meta(sim).inventory.push({ itemId: 'wolf_fang', count: 10 });
        book(sim).inventory.push({ itemId: 'wolf_fang', count: 10 });
        sim.guildBankDepositFor(sim.playerId, slot, count);
        const total =
          meta(sim).inventory.reduce((a, s) => a + s.count, 0) +
          book(sim).inventory.reduce((a, s) => a + s.count, 0);
        expect(total, `slot=${slot} count=${count}`).toBe(20);
      }
    }
  });

  it('H2: hostile slot/count on withdraw conserve the item total', () => {
    for (const slot of HOSTILE_NUMBERS) {
      for (const count of [...HOSTILE_NUMBERS, undefined]) {
        const sim = makeOfficerSim();
        meta(sim).inventory.length = 0;
        meta(sim).inventory.push({ itemId: 'wolf_fang', count: 10 });
        book(sim).inventory.push({ itemId: 'wolf_fang', count: 10 });
        sim.guildBankWithdrawFor(sim.playerId, slot, count);
        const total =
          meta(sim).inventory.reduce((a, s) => a + s.count, 0) +
          book(sim).inventory.reduce((a, s) => a + s.count, 0);
        expect(total, `slot=${slot} count=${count}`).toBe(20);
      }
    }
  });

  it('H3: hostile gold amounts conserve copper', () => {
    for (const amount of HOSTILE_NUMBERS) {
      for (const op of ['dep', 'wd'] as const) {
        const sim = makeOfficerSim({ treasury: 500_000 });
        meta(sim).copper = 500_000;
        if (op === 'dep') sim.guildBankDepositGoldFor(sim.playerId, amount);
        else sim.guildBankWithdrawGoldFor(sim.playerId, amount);
        expect(meta(sim).copper + book(sim).treasury, `${op} ${amount}`).toBe(1_000_000);
        expect(Number.isSafeInteger(meta(sim).copper), `${op} ${amount} purse`).toBe(true);
        expect(Number.isSafeInteger(book(sim).treasury), `${op} ${amount} treasury`).toBe(true);
      }
    }
  });

  it('H4: pipelined duplicate withdraws in one tick cannot over-draw a stack', () => {
    const sim = makeOfficerSim();
    meta(sim).inventory.length = 0;
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 5 });
    for (let i = 0; i < 10; i++) sim.guildBankWithdrawFor(sim.playerId, 0, 5);
    const total =
      meta(sim).inventory.reduce((a, s) => a + s.count, 0) +
      book(sim).inventory.reduce((a, s) => a + s.count, 0);
    expect(total).toBe(5);
  });

  it('H5: an over-capacity book still refuses a NEW-slot deposit', () => {
    const sim = makeOfficerSim({ purchasedSlots: 24 });
    for (let i = 0; i < 30; i++) book(sim).inventory.push({ itemId: `mystery_${i}`, count: 1 });
    meta(sim).inventory.length = 0;
    meta(sim).inventory.push({ itemId: 'wolf_fang', count: 1 });
    sim.guildBankDepositFor(sim.playerId, 0);
    expect(book(sim).inventory.length).toBe(30);
    expect(meta(sim).inventory.length).toBe(1);
  });

  it('H6: withdrawing an unknown item id out of the book works and conserves', () => {
    const sim = makeOfficerSim();
    meta(sim).inventory.length = 0;
    book(sim).inventory.push({ itemId: 'removed_content_xyz', count: 3 });
    sim.guildBankWithdrawFor(sim.playerId, 0);
    expect(book(sim).inventory.length).toBe(0);
    expect(meta(sim).inventory).toEqual([{ itemId: 'removed_content_xyz', count: 3 }]);
  });
});

// ---------------------------------------------------------------------------
// E: revert-path stack caps and the personal-bank control
// ---------------------------------------------------------------------------
describe('PROBE E2: revert path grants', () => {
  it('E2a: a withdraw-undo respects the stack cap', () => {
    const sim = makeOfficerSim();
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 15 });
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'withdraw',
        itemId: 'wolf_fang',
        count: 15,
        instance: null,
        craftedRecipeId: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    for (const s of book(sim).inventory) expect(s.count).toBeLessThanOrEqual(20);
  });

  it('E2b: a deposit-undo of an unknown item id removes it', () => {
    const sim = makeOfficerSim();
    book(sim).inventory.push({ itemId: 'removed_content_xyz', count: 3 });
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'deposit',
        itemId: 'removed_content_xyz',
        count: 3,
        instance: null,
        craftedRecipeId: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    expect(book(sim).inventory).toEqual([]);
  });

  it('E2c: bankWithdraw control for the instanced+crafted slot', () => {
    const sim = makeOfficerSim();
    meta(sim).bank.inventory.push({
      itemId: 'wolf_fang',
      count: 3,
      instance: { signer: 'Ana' },
      craftedRecipeId: 'jerky',
    });
    meta(sim).inventory.length = 0;
    bankWithdraw(sim.ctx, 0, undefined, sim.playerId);
    expect(meta(sim).inventory[0]).toEqual({
      itemId: 'wolf_fang',
      count: 3,
      instance: { signer: 'Ana' },
      craftedRecipeId: 'jerky',
    });
  });
});

// ---------------------------------------------------------------------------
// E3: the fitsAfterSwap class: does the FIT CHECK ever disagree with the GRANT?
// Deterministic sweep over source/dest shapes on both directions.
// ---------------------------------------------------------------------------
type Shape = { itemId: string; count: number; instance?: unknown; craftedRecipeId?: string };
const SHAPES: Shape[] = [
  { itemId: 'wolf_fang', count: 1 },
  { itemId: 'wolf_fang', count: 7 },
  { itemId: 'wolf_fang', count: 20 },
  { itemId: 'wolf_fang', count: 45 },
  { itemId: 'wolf_fang', count: 3, craftedRecipeId: 'r1' },
  { itemId: 'wolf_fang', count: 3, instance: { signer: 'Ana' } },
  { itemId: 'wolf_fang', count: 3, instance: { signer: 'Ana' }, craftedRecipeId: 'r1' },
  { itemId: 'wolf_fang', count: 2, instance: { signer: 'Ana', charges: { zap: 2 } } },
  { itemId: 'worn_sword', count: 1, instance: { signer: 'Ana' } },
  { itemId: 'removed_content_xyz', count: 9 },
  { itemId: 'removed_content_xyz', count: 9, instance: { signer: 'Ana' } },
];

describe('PROBE E3: fit-vs-grant divergence sweep', () => {
  it('E3a: deposit never overflows the book beyond its pre-existing length', () => {
    for (const src of SHAPES) {
      for (const dst of SHAPES) {
        for (const cap of [0, 24, 30]) {
          for (const count of [undefined, 1, 3, 1000]) {
            const sim = makeOfficerSim({ purchasedSlots: cap });
            meta(sim).inventory.length = 0;
            meta(sim).inventory.push(JSON.parse(JSON.stringify(src)));
            book(sim).inventory.push(JSON.parse(JSON.stringify(dst)));
            const lenBefore = book(sim).inventory.length;
            const unitsBefore =
              meta(sim).inventory.reduce((a, s) => a + s.count, 0) +
              book(sim).inventory.reduce((a, s) => a + s.count, 0);
            sim.guildBankDepositFor(sim.playerId, 0, count);
            const unitsAfter =
              meta(sim).inventory.reduce((a, s) => a + s.count, 0) +
              book(sim).inventory.reduce((a, s) => a + s.count, 0);
            const tag = `${JSON.stringify(src)}->${JSON.stringify(dst)} cap=${cap} n=${count}`;
            expect(unitsAfter, `units ${tag}`).toBe(unitsBefore);
            expect(book(sim).inventory.length, `len ${tag}`).toBeLessThanOrEqual(
              Math.max(cap, lenBefore),
            );
          }
        }
      }
    }
  });

  it('E3b: withdraw never overflows the bags beyond their pre-existing length', () => {
    for (const src of SHAPES) {
      for (const dst of SHAPES) {
        for (const count of [undefined, 1, 3, 1000]) {
          const sim = makeOfficerSim();
          const bagCap = 16; // backpack only, autoEquip false
          meta(sim).inventory.length = 0;
          meta(sim).inventory.push(JSON.parse(JSON.stringify(dst)));
          book(sim).inventory.push(JSON.parse(JSON.stringify(src)));
          const lenBefore = meta(sim).inventory.length;
          const unitsBefore =
            meta(sim).inventory.reduce((a, s) => a + s.count, 0) +
            book(sim).inventory.reduce((a, s) => a + s.count, 0);
          sim.guildBankWithdrawFor(sim.playerId, 0, count);
          const unitsAfter =
            meta(sim).inventory.reduce((a, s) => a + s.count, 0) +
            book(sim).inventory.reduce((a, s) => a + s.count, 0);
          const tag = `${JSON.stringify(src)}->${JSON.stringify(dst)} n=${count}`;
          expect(unitsAfter, `units ${tag}`).toBe(unitsBefore);
          expect(meta(sim).inventory.length, `len ${tag}`).toBeLessThanOrEqual(
            Math.max(bagCap, lenBefore),
          );
        }
      }
    }
  });

  it('E3c: no slot ever exceeds its stack cap after a move', () => {
    for (const src of SHAPES) {
      for (const dst of SHAPES) {
        const sim = makeOfficerSim();
        meta(sim).inventory.length = 0;
        meta(sim).inventory.push(JSON.parse(JSON.stringify(src)));
        book(sim).inventory.push(JSON.parse(JSON.stringify(dst)));
        const capBefore = Math.max(
          ...book(sim).inventory.map((s) => s.count),
          ...meta(sim).inventory.map((s) => s.count),
        );
        sim.guildBankDepositFor(sim.playerId, 0);
        const after = Math.max(
          ...book(sim).inventory.map((s) => s.count),
          ...meta(sim).inventory.map((s) => s.count),
          0,
        );
        expect(after, `${JSON.stringify(src)}->${JSON.stringify(dst)}`).toBeLessThanOrEqual(
          Math.max(capBefore, 20),
        );
      }
    }
  });
});
