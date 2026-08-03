import { describe, expect, it } from 'vitest';

import {
  auditBank,
  type BankAuditFinding,
  type BankLedgerAuditRow,
  formatReport,
  GUILD_BUY_POSITIONS,
  OPEN_BANK_SLOTS_AFTER,
} from '../scripts/bank_audit.mjs';
import { GUILD_BANK_LADDER_POSITIONS, GUILD_BANK_RUNG_SLOTS } from '../src/sim/guild_bank';

// Fill a bank_ledger row's defaults (snake_case, as Postgres returns it); pass only
// the fields a case cares about. Every row is 'personal' with realm Claudemoon.
function L(o: Partial<BankLedgerAuditRow>): BankLedgerAuditRow {
  return {
    id: 0,
    realm: 'Claudemoon',
    character_id: 1,
    op: 'deposit',
    item_id: null,
    count: null,
    instance: null,
    copper_delta: 0,
    purchased_slots_after: 0,
    container: 'personal',
    container_id: null,
    ...o,
  };
}

const findingKindsFor = (findings: BankAuditFinding[], characterId: number) =>
  findings.filter((f) => f.characterId === characterId).map((f) => f.kind);

describe('auditBank', () => {
  it('a clean ledger that reconstructs the bank state yields zero findings', () => {
    const clean = {
      ledgerRows: [
        { id: 1, character_id: 1, op: 'deposit', item_id: 'wolf_fang', count: 2 },
        { id: 2, character_id: 1, op: 'deposit', item_id: 'wolf_fang', count: 3 },
        { id: 3, character_id: 1, op: 'withdraw', item_id: 'wolf_fang', count: 1 },
        { id: 4, character_id: 1, op: 'buy_slots', copper_delta: -500, purchased_slots_after: 6 },
      ].map(L),
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: { bank: { inventory: [{ itemId: 'wolf_fang', count: 4 }], purchasedSlots: 6 } },
        },
      ],
    };
    expect(auditBank(clean)).toEqual([]);
  });

  it('each planted anomaly yields exactly its finding, grouped per character', () => {
    const planted = {
      ledgerRows: [
        // character 10 (absent from characters): withdrew what was never deposited.
        { id: 1, character_id: 10, op: 'withdraw', item_id: 'wolf_fang', count: 3 },
        // character 20: purchased_slots_after regresses 6 -> 0 across id order.
        {
          id: 2,
          character_id: 20,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 1,
          purchased_slots_after: 6,
        },
        {
          id: 3,
          character_id: 20,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 1,
          purchased_slots_after: 0,
        },
        // character 30 (absent from characters): a negative count row, net kept
        // non-negative by the prior deposit so ONLY the shape finding fires.
        { id: 4, character_id: 30, op: 'deposit', item_id: 'wolf_fang', count: 5 },
        { id: 5, character_id: 30, op: 'withdraw', item_id: 'wolf_fang', count: -1 },
      ].map(L),
      characters: [
        // character 20's bank matches its ledger net, isolating the regression.
        {
          id: 20,
          realm: 'Claudemoon',
          state: { bank: { inventory: [{ itemId: 'wolf_fang', count: 2 }], purchasedSlots: 0 } },
        },
        // character 40 holds an item its (empty) ledger never recorded.
        {
          id: 40,
          realm: 'Claudemoon',
          state: { bank: { inventory: [{ itemId: 'iron_ore', count: 3 }], purchasedSlots: 0 } },
        },
      ],
    };

    const findings = auditBank(planted);
    expect(findings).toHaveLength(4);
    expect(findingKindsFor(findings, 10)).toEqual(['negative_net']);
    expect(findingKindsFor(findings, 20)).toEqual(['purchased_regression']);
    expect(findingKindsFor(findings, 30)).toEqual(['bad_count']);
    expect(findingKindsFor(findings, 40)).toEqual(['ledger_state_mismatch']);

    // The finding shape carries container / realm / characterId / kind / detail.
    expect(findings.find((f) => f.characterId === 40)).toMatchObject({
      container: 'personal',
      realm: 'Claudemoon',
      characterId: 40,
      kind: 'ledger_state_mismatch',
    });
    for (const f of findings) expect(typeof f.detail).toBe('string');
  });

  it('reconciles ledger activity against an EMPTY bank when the state has none', () => {
    // Ledger rows for a character whose persisted state carries no bank at all is
    // a corruption signature (found live in QA verification: the audit used
    // to SKIP bankless characters entirely). A pre-bank character with no ledger
    // activity must still be skipped, never flagged.
    const findings = auditBank({
      ledgerRows: [
        { id: 1, character_id: 50, op: 'deposit', item_id: 'wolf_fang', count: 5 },
        { id: 2, character_id: 50, op: 'buy_slots', copper_delta: -500, purchased_slots_after: 6 },
        { id: 3, character_id: 51, op: 'deposit', item_id: 'iron_ore', count: 2 },
      ].map(L),
      characters: [
        { id: 50, realm: 'Claudemoon', state: null }, // NULL state, ledger activity
        { id: 51, realm: 'Claudemoon', state: { pos: { x: 0, z: 0 } } }, // state without bank
        { id: 52, realm: 'Claudemoon', state: null }, // pre-bank, no activity: skipped
      ],
    });
    expect(findingKindsFor(findings, 50)).toEqual(['ledger_state_mismatch', 'purchased_mismatch']);
    expect(findingKindsFor(findings, 51)).toEqual(['ledger_state_mismatch']);
    expect(findingKindsFor(findings, 52)).toEqual([]);
  });

  it('flags a negative count in the persisted bank state itself', () => {
    const findings = auditBank({
      ledgerRows: [],
      characters: [
        {
          id: 5,
          realm: 'Claudemoon',
          state: { bank: { inventory: [{ itemId: 'wolf_fang', count: -2 }], purchasedSlots: 0 } },
        },
      ],
    });
    // A negative state count (shape) plus the net-vs-state mismatch it implies.
    expect(findingKindsFor(findings, 5)).toContain('negative_state_count');
  });

  it('flags each remaining row-shape anomaly exactly once', () => {
    // One anomaly per character (all absent from characters, nets non-negative)
    // so each row isolates exactly its own shape finding.
    const findings = auditBank({
      ledgerRows: [
        // Deposit with a positive count but no item id.
        { id: 1, character_id: 60, op: 'deposit', count: 2 },
        // Item op carrying copper.
        {
          id: 2,
          character_id: 61,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 1,
          copper_delta: 25,
        },
        // Buy carrying an item count.
        {
          id: 3,
          character_id: 62,
          op: 'buy_slots',
          count: 3,
          copper_delta: -500,
          purchased_slots_after: 6,
        },
        // Free buy: copper_delta 0 pins the >= boundary (a buy must cost copper).
        { id: 4, character_id: 63, op: 'buy_slots', copper_delta: 0, purchased_slots_after: 6 },
      ].map(L),
      characters: [],
    });
    expect(findings).toHaveLength(4);
    expect(findingKindsFor(findings, 60)).toEqual(['missing_item_id']);
    expect(findingKindsFor(findings, 61)).toEqual(['copper_on_item_op']);
    expect(findingKindsFor(findings, 62)).toEqual(['count_on_buy']);
    expect(findingKindsFor(findings, 63)).toEqual(['nonnegative_buy_cost']);
  });
});

describe('formatReport', () => {
  const rows = [L({ id: 1, character_id: 1, op: 'deposit', item_id: 'wolf_fang', count: 2 })];

  it('renders one FINDING line per anomaly plus the per-container summary', () => {
    const finding: BankAuditFinding = {
      container: 'personal',
      realm: 'Claudemoon',
      characterId: 9,
      kind: 'negative_net',
      detail: 'net -3 of wolf_fang',
    };
    const report = formatReport(rows, [finding]);
    expect(report).toContain('container personal: ledger rows 1: findings 1');
    expect(report).toContain(
      'FINDING: container personal: realm Claudemoon: character 9: negative_net: net -3 of wolf_fang',
    );
    expect(report).not.toContain('OK:');
  });

  it('renders the OK line and no FINDING lines on clean data', () => {
    const report = formatReport(rows, []);
    expect(report).toContain('OK: no shape or conservation anomalies found.');
    expect(report).not.toContain('FINDING:');
  });
});

// ---------------------------------------------------------------------------
// Guild container rows (Guild Bank Phase 3): grouped per GUILD (container_id,
// the anonymous exchange pipe), treasury replay, and book reconciliation.
// ---------------------------------------------------------------------------

// A guild row: container 'guild', keyed by container_id.
function G(o: Partial<BankLedgerAuditRow>): BankLedgerAuditRow {
  return L({ container: 'guild', container_id: 913, ...o });
}

const guildKindsFor = (findings: BankAuditFinding[], guildId: number) =>
  findings.filter((f) => f.guildId === guildId).map((f) => f.kind);

describe('the audit ladder mirror (lockstep with src/sim/guild_bank.ts)', () => {
  it('pins the dependency-free .mjs ladder literals to the sim tables', () => {
    // bank_audit.mjs redeclares the ladder (it never imports the TS sim); a
    // retune landing on one side without the other reddens here instead of
    // silently mis-flagging (or missing) rows.
    expect(OPEN_BANK_SLOTS_AFTER).toBe(GUILD_BANK_RUNG_SLOTS[0]);
    // Guild buy_slots (rungs 1+) after-positions are every ladder position
    // past the opened base.
    expect([...GUILD_BUY_POSITIONS]).toEqual([...GUILD_BANK_LADDER_POSITIONS].slice(2));
  });
});

describe('auditBank (guild container)', () => {
  it('a clean cross-officer session reconciles against the guild book with zero findings', () => {
    // Officer 1 deposits gold and an item; officer 2 withdraws part of the
    // item and buys an expansion from the treasury; the book matches the net.
    const findings = auditBank({
      ledgerRows: [
        G({ id: 1, character_id: 1, op: 'create_fee', copper_delta: -10000 }),
        G({
          id: 2,
          character_id: 1,
          op: 'open_bank',
          copper_delta: -90000,
          purchased_slots_after: 24,
        }),
        G({
          id: 3,
          character_id: 1,
          op: 'deposit_gold',
          copper_delta: 80000,
          purchased_slots_after: 24,
        }),
        G({
          id: 4,
          character_id: 1,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 5,
          purchased_slots_after: 24,
        }),
        G({
          id: 5,
          character_id: 2,
          op: 'withdraw',
          item_id: 'wolf_fang',
          count: 2,
          purchased_slots_after: 24,
        }),
        G({
          id: 6,
          character_id: 2,
          op: 'buy_slots',
          copper_delta: -25000,
          purchased_slots_after: 30,
        }),
        G({
          id: 7,
          character_id: 2,
          op: 'withdraw_gold',
          copper_delta: -10000,
          purchased_slots_after: 30,
        }),
      ],
      characters: [],
      guildBanks: [
        {
          guild_id: 913,
          realm: 'Claudemoon',
          data: {
            treasury: 45000,
            inventory: [{ itemId: 'wolf_fang', count: 3 }],
            purchasedSlots: 30,
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('conservation holds per GUILD, not per character: a cross-officer withdraw is clean', () => {
    // Officer 2 withdraws what officer 1 deposited. A per-character grouping
    // (the personal rule) would flag officer 2 with negative_net; the pipe
    // grouping must not.
    const findings = auditBank({
      ledgerRows: [
        G({ id: 1, character_id: 1, op: 'deposit', item_id: 'wolf_fang', count: 3 }),
        G({ id: 2, character_id: 2, op: 'withdraw', item_id: 'wolf_fang', count: 3 }),
      ],
      characters: [],
    });
    expect(findings).toEqual([]);
  });

  it('flags a guild withdraw of items that were never deposited (negative_net)', () => {
    const findings = auditBank({
      ledgerRows: [G({ id: 1, character_id: 2, op: 'withdraw', item_id: 'wolf_fang', count: 1 })],
      characters: [],
    });
    expect(guildKindsFor(findings, 913)).toEqual(['negative_net']);
    expect(findings[0]).toMatchObject({ container: 'guild', characterId: null, guildId: 913 });
  });

  it('flags a treasury that goes negative in replay (more copper out than in)', () => {
    const findings = auditBank({
      ledgerRows: [
        G({ id: 1, character_id: 1, op: 'deposit_gold', copper_delta: 5000 }),
        G({ id: 2, character_id: 2, op: 'withdraw_gold', copper_delta: -8000 }),
      ],
      characters: [],
    });
    expect(guildKindsFor(findings, 913)).toEqual(['negative_treasury']);
  });

  it('create_fee and open_bank are PURSE copper, excluded from the treasury replay', () => {
    const findings = auditBank({
      ledgerRows: [
        // If either purse op counted, the replay would go negative and flag
        // (and the final treasury would mismatch the book).
        G({ id: 1, character_id: 1, op: 'create_fee', copper_delta: -10000 }),
        G({
          id: 2,
          character_id: 1,
          op: 'open_bank',
          copper_delta: -90000,
          purchased_slots_after: 24,
        }),
        G({
          id: 3,
          character_id: 1,
          op: 'deposit_gold',
          copper_delta: 100,
          purchased_slots_after: 24,
        }),
      ],
      characters: [],
      guildBanks: [
        {
          guild_id: 913,
          realm: 'Claudemoon',
          data: { treasury: 100, inventory: [], purchasedSlots: 24 },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('flags a guild buy_slots landing off the ladder, and a second open_bank row', () => {
    const findings = auditBank({
      ledgerRows: [
        // Fund guild 80's treasury first so the position finding is isolated
        // (a bare buy would also trip negative_treasury).
        G({ id: 90, character_id: 1, op: 'deposit_gold', copper_delta: 25000, container_id: 80 }),
        // A guild expansion can never land below the opened base + one rung.
        G({
          id: 91,
          character_id: 1,
          op: 'buy_slots',
          copper_delta: -25000,
          purchased_slots_after: 6,
          container_id: 80,
        }),
        // Two openings for one guild: a reverted (fenced-out) opening left its
        // row, or corruption; an operator should look either way.
        G({
          id: 2,
          character_id: 1,
          op: 'open_bank',
          copper_delta: -90000,
          purchased_slots_after: 24,
          container_id: 81,
        }),
        G({
          id: 3,
          character_id: 2,
          op: 'open_bank',
          copper_delta: -90000,
          purchased_slots_after: 24,
          container_id: 81,
        }),
        // The PERSONAL ladder keeps its own positions: a personal buy_slots at
        // 6 must NOT trip the guild position check.
        L({
          id: 4,
          character_id: 9,
          op: 'buy_slots',
          copper_delta: -500,
          purchased_slots_after: 6,
        }),
      ],
      characters: [
        {
          id: 9,
          realm: 'Claudemoon',
          state: { bank: { inventory: [], purchasedSlots: 6 } },
        },
      ],
    });
    expect(guildKindsFor(findings, 80)).toEqual(['bad_buy_position']);
    expect(guildKindsFor(findings, 81)).toEqual(['multiple_open_bank']);
    expect(findingKindsFor(findings, 9)).toEqual([]);
  });

  it('reconciles books against replay: item, treasury, and purchased mismatches', () => {
    const findings = auditBank({
      ledgerRows: [
        G({ id: 1, character_id: 1, op: 'deposit_gold', copper_delta: 500 }),
        G({ id: 2, character_id: 1, op: 'deposit', item_id: 'wolf_fang', count: 1 }),
      ],
      characters: [],
      guildBanks: [
        {
          guild_id: 913,
          realm: 'Claudemoon',
          data: {
            treasury: 999, // ledger says 500
            inventory: [{ itemId: 'wolf_fang', count: 4 }], // ledger says 1
            purchasedSlots: 6, // ledger says 0
          },
        },
      ],
    });
    expect(guildKindsFor(findings, 913).sort()).toEqual([
      'ledger_state_mismatch',
      'purchased_mismatch',
      'treasury_mismatch',
    ]);
  });

  it('a book holding items with NO ledger rows is the corruption signature', () => {
    const findings = auditBank({
      ledgerRows: [],
      characters: [],
      guildBanks: [
        {
          guild_id: 44,
          realm: 'Claudemoon',
          data: { treasury: 7, inventory: [{ itemId: 'iron_ore', count: 2 }], purchasedSlots: 0 },
        },
      ],
    });
    expect(guildKindsFor(findings, 44).sort()).toEqual([
      'ledger_state_mismatch',
      'treasury_mismatch',
    ]);
  });

  it('a disbanded guild (rows, no book) reconciles items+treasury against empty and skips purchased', () => {
    const findings = auditBank({
      ledgerRows: [
        G({
          id: 1,
          character_id: 1,
          op: 'open_bank',
          copper_delta: -90000,
          purchased_slots_after: 24,
        }),
        G({
          id: 2,
          character_id: 1,
          op: 'deposit_gold',
          copper_delta: 25000,
          purchased_slots_after: 24,
        }),
        G({
          id: 3,
          character_id: 1,
          op: 'buy_slots',
          copper_delta: -25000,
          purchased_slots_after: 30,
        }),
        G({
          id: 4,
          character_id: 1,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 1,
          purchased_slots_after: 30,
        }),
        G({
          id: 5,
          character_id: 2,
          op: 'withdraw',
          item_id: 'wolf_fang',
          count: 1,
          purchased_slots_after: 30,
        }),
      ],
      characters: [],
      guildBanks: [], // the guilds DELETE cascaded the book away
    });
    // Net items 0, treasury 0, purchased 30 with no row: all clean by design.
    expect(findings).toEqual([]);
  });

  it('flags each guild-only shape anomaly exactly once', () => {
    const findings = auditBank({
      ledgerRows: [
        // deposit_gold with the wrong sign (0 pins the <= boundary and keeps
        // the treasury replay at zero, isolating the shape finding).
        G({ id: 1, character_id: 1, op: 'deposit_gold', copper_delta: 0, container_id: 70 }),
        // withdraw_gold with the wrong sign.
        G({ id: 2, character_id: 1, op: 'withdraw_gold', copper_delta: 5, container_id: 71 }),
        // gold op carrying item fields.
        G({
          id: 3,
          character_id: 1,
          op: 'deposit_gold',
          copper_delta: 5,
          item_id: 'wolf_fang',
          count: 1,
          container_id: 72,
        }),
        // create_fee that charged nothing (or positive).
        G({ id: 4, character_id: 1, op: 'create_fee', copper_delta: 0, container_id: 73 }),
        // create_fee claiming expansions at birth.
        G({
          id: 5,
          character_id: 1,
          op: 'create_fee',
          copper_delta: -100000,
          purchased_slots_after: 6,
          container_id: 74,
        }),
        // a gold op smuggled into the personal container.
        L({ id: 6, character_id: 1, op: 'deposit_gold', copper_delta: 5 }),
        // a guild row with no guild id.
        G({
          id: 7,
          character_id: 1,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 1,
          container_id: null,
        }),
        // open_bank that charged nothing (or positive).
        G({
          id: 8,
          character_id: 1,
          op: 'open_bank',
          copper_delta: 0,
          purchased_slots_after: 24,
          container_id: 75,
        }),
        // open_bank carrying a count.
        G({
          id: 9,
          character_id: 1,
          op: 'open_bank',
          copper_delta: -90000,
          count: 1,
          purchased_slots_after: 24,
          container_id: 76,
        }),
        // open_bank granting anything but the 24-slot rung-0 base.
        G({
          id: 10,
          character_id: 1,
          op: 'open_bank',
          copper_delta: -90000,
          purchased_slots_after: 30,
          container_id: 77,
        }),
        // open_bank smuggled into the personal container.
        L({ id: 11, character_id: 1, op: 'open_bank', copper_delta: -90000 }),
      ],
      characters: [],
    });
    expect(guildKindsFor(findings, 70)).toEqual(['bad_gold_delta']);
    expect(guildKindsFor(findings, 71)).toEqual(['bad_gold_delta']);
    expect(guildKindsFor(findings, 72)).toEqual(['item_on_gold_op']);
    expect(guildKindsFor(findings, 73)).toEqual(['nonnegative_create_fee']);
    expect(guildKindsFor(findings, 74)).toEqual(['slots_on_create_fee']);
    expect(guildKindsFor(findings, 75)).toEqual(['nonnegative_open_cost']);
    expect(guildKindsFor(findings, 76)).toEqual(['count_on_open']);
    expect(guildKindsFor(findings, 77)).toEqual(['bad_open_slots']);
    expect(findings.filter((f) => f.kind === 'gold_op_outside_guild').map((f) => f.detail)).toEqual(
      [expect.stringContaining('deposit_gold row 6'), expect.stringContaining('open_bank row 11')],
    );
    expect(findings.some((f) => f.kind === 'missing_container_id')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// admin_purge: the operator escape hatch for a permanently unwithdrawable
// (dormant) guild bank slot. It removes items, so the item replay must account
// for it; without that arm the purged copy reads as an unexplained shortfall
// against the live book forever.
// ---------------------------------------------------------------------------

describe('auditBank (guild container, admin_purge)', () => {
  it('replays a purge as a REMOVAL: the book reconciles with zero findings', () => {
    const findings = auditBank({
      ledgerRows: [
        G({
          id: 1,
          character_id: 1,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 5,
          purchased_slots_after: 24,
        }),
        G({
          id: 2,
          character_id: 1,
          op: 'admin_purge',
          item_id: 'wolf_fang',
          count: 2,
          purchased_slots_after: 24,
        }),
      ],
      characters: [],
      guildBanks: [
        {
          guild_id: 913,
          realm: 'Claudemoon',
          data: {
            treasury: 0,
            inventory: [{ itemId: 'wolf_fang', count: 3 }],
            purchasedSlots: 24,
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('WITHOUT the purge row the same book would not reconcile (the arm is load-bearing)', () => {
    // The decisive control for the case above: drop only the admin_purge row
    // and the replay over-counts the book by exactly the purged copies.
    const findings = auditBank({
      ledgerRows: [
        G({
          id: 1,
          character_id: 1,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 5,
          purchased_slots_after: 24,
        }),
      ],
      characters: [],
      guildBanks: [
        {
          guild_id: 913,
          realm: 'Claudemoon',
          data: {
            treasury: 0,
            inventory: [{ itemId: 'wolf_fang', count: 3 }],
            purchasedSlots: 24,
          },
        },
      ],
    });
    expect(guildKindsFor(findings, 913).length).toBeGreaterThan(0);
  });

  it('moves NO treasury copper: a purge alone leaves the treasury replay at zero', () => {
    const findings = auditBank({
      ledgerRows: [
        G({
          id: 1,
          character_id: 1,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 1,
          purchased_slots_after: 24,
        }),
        G({
          id: 2,
          character_id: 1,
          op: 'admin_purge',
          item_id: 'wolf_fang',
          count: 1,
          purchased_slots_after: 24,
        }),
      ],
      characters: [],
      guildBanks: [
        {
          guild_id: 913,
          realm: 'Claudemoon',
          data: { treasury: 0, inventory: [], purchasedSlots: 24 },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('shape-checks a purge row like any other item op (count, item_id, copper)', () => {
    const findings = auditBank({
      ledgerRows: [
        G({ id: 1, character_id: 1, op: 'admin_purge', item_id: null, count: 0, copper_delta: 7 }),
      ],
      characters: [],
    });
    expect(new Set(guildKindsFor(findings, 913))).toEqual(
      new Set(['bad_count', 'missing_item_id', 'copper_on_item_op']),
    );
  });

  it('is a GUILD-only op: a personal-container purge row is flagged', () => {
    const findings = auditBank({
      ledgerRows: [
        L({ id: 1, character_id: 1, op: 'admin_purge', item_id: 'wolf_fang', count: 1 }),
      ],
      characters: [],
    });
    expect(findingKindsFor(findings, 1)).toContain('gold_op_outside_guild');
  });
});

describe('formatReport (guild rows)', () => {
  it('summarizes the guild container and names the guild in FINDING lines', () => {
    const rows = [G({ id: 1, character_id: 1, op: 'deposit', item_id: 'wolf_fang', count: 2 })];
    const finding: BankAuditFinding = {
      container: 'guild',
      realm: 'Claudemoon',
      characterId: null,
      guildId: 913,
      kind: 'negative_treasury',
      detail: 'treasury fell to -1 at row 9',
    };
    const report = formatReport(rows, [finding]);
    expect(report).toContain('container guild: ledger rows 1: findings 1');
    expect(report).toContain(
      'FINDING: container guild: realm Claudemoon: guild 913: negative_treasury: treasury fell to -1 at row 9',
    );
  });
});
