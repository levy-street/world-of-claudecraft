import { describe, expect, it } from 'vitest';

import {
  auditBank,
  type BankAuditFinding,
  type BankLedgerAuditRow,
  COUNTERPARTY_ORPHAN_OP,
  counterpartySelectList,
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

// ---------------------------------------------------------------------------
// The COUNTERPARTY (payer/payee) balance: book side + counterparty side + sink
// = 0, per op. This is the ONLY check here that can see across the purse/book
// boundary; everything else reconciles the book against rows derived from the
// book, which is self-consistent by construction.
// ---------------------------------------------------------------------------
/** The same guild session, with each op's counterparty side filled in. */
const BALANCED_SESSION: BankLedgerAuditRow[] = [
  // The founder's purse paid the creation fee, and the fee left the world.
  G({ id: 1, op: 'create_fee', copper_delta: -10_000, counterparty_copper_delta: -10_000 }),
  // Ladder rung 0: the opening officer's own purse, also burned.
  G({
    id: 2,
    op: 'open_bank',
    copper_delta: -90_000,
    purchased_slots_after: 24,
    counterparty_copper_delta: -90_000,
  }),
  // The purse is the exact mirror of the treasury, both directions.
  G({
    id: 3,
    op: 'deposit_gold',
    copper_delta: 80_000,
    purchased_slots_after: 24,
    counterparty_copper_delta: -80_000,
  }),
  G({
    id: 4,
    op: 'withdraw_gold',
    copper_delta: -30_000,
    purchased_slots_after: 24,
    counterparty_copper_delta: 30_000,
  }),
  // The bags are the exact mirror of the book, both directions.
  G({
    id: 5,
    op: 'deposit',
    item_id: 'wolf_fang',
    count: 5,
    purchased_slots_after: 24,
    counterparty_copper_delta: 0,
    counterparty_count: -5,
  }),
  G({
    id: 6,
    op: 'withdraw',
    item_id: 'wolf_fang',
    count: 2,
    purchased_slots_after: 24,
    counterparty_copper_delta: 0,
    counterparty_count: 2,
  }),
  // A treasury-paid expansion moves no purse at all; the price is burned.
  G({
    id: 7,
    op: 'buy_slots',
    copper_delta: -25_000,
    purchased_slots_after: 30,
    counterparty_copper_delta: 0,
  }),
  // An operator purge hands the copy to nobody: it is destroyed.
  G({
    id: 8,
    op: 'admin_purge',
    item_id: 'wolf_fang',
    count: 1,
    purchased_slots_after: 30,
    counterparty_copper_delta: 0,
    counterparty_count: 0,
  }),
];

const BALANCED_BOOK = [
  {
    guild_id: 913,
    realm: 'Claudemoon',
    data: { treasury: 25_000, inventory: [{ itemId: 'wolf_fang', count: 2 }], purchasedSlots: 30 },
  },
];

/** Strip the counterparty side off every row: this is EXACTLY the ledger this
 *  audit had before the columns existed, and it is the control every case
 *  below runs against. */
const withoutCounterparty = (rows: BankLedgerAuditRow[]): BankLedgerAuditRow[] =>
  rows.map((r) => ({ ...r, counterparty_copper_delta: null, counterparty_count: null }));

describe('auditBank (the counterparty balance)', () => {
  it('a known-good session with both halves recorded reports CLEAN', () => {
    expect(
      auditBank({ ledgerRows: BALANCED_SESSION, characters: [], guildBanks: BALANCED_BOOK }),
    ).toEqual([]);
  });

  it('CATCHES a withdraw whose purse gained more than the treasury lost', () => {
    // The synthetic mint, as a ledger fixture: the treasury gave up 30_000 and
    // the acting purse received 45_000. The book side alone is impeccable.
    const rows = BALANCED_SESSION.map((r) =>
      r.id === 4 ? { ...r, counterparty_copper_delta: 45_000 } : r,
    );
    const findings = auditBank({ ledgerRows: rows, characters: [], guildBanks: BALANCED_BOOK });
    expect(findings.map((f) => f.kind)).toEqual(['counterparty_copper_imbalance']);
    expect(findings[0].detail).toContain('15000 MINTED');
    expect(findings[0]).toMatchObject({ container: 'guild', guildId: 913 });

    // THE CONTROL. Remove the check's input and the report goes silent on the
    // same data: the book still reconciles perfectly against the ledger,
    // because the book is not where the 15_000 went. That is the structural
    // gap this column closes, demonstrated rather than asserted.
    expect(
      auditBank({
        ledgerRows: withoutCounterparty(rows),
        characters: [],
        guildBanks: BALANCED_BOOK,
      }),
    ).toEqual([]);
  });

  it('CATCHES a deposit whose bags gave up fewer copies than the book gained', () => {
    const rows = BALANCED_SESSION.map((r) => (r.id === 5 ? { ...r, counterparty_count: -2 } : r));
    const findings = auditBank({ ledgerRows: rows, characters: [], guildBanks: BALANCED_BOOK });
    expect(findings.map((f) => f.kind)).toEqual(['counterparty_item_imbalance']);
    expect(findings[0].detail).toContain('3 MINTED');
    expect(
      auditBank({
        ledgerRows: withoutCounterparty(rows),
        characters: [],
        guildBanks: BALANCED_BOOK,
      }),
    ).toEqual([]);
  });

  it('CATCHES value DESTROYED as readily as value minted', () => {
    // Direction matters to an operator: a withdraw whose purse received less
    // than the treasury paid out is a player being robbed, not a dupe.
    const rows = BALANCED_SESSION.map((r) =>
      r.id === 4 ? { ...r, counterparty_copper_delta: 10_000 } : r,
    );
    const findings = auditBank({ ledgerRows: rows, characters: [], guildBanks: BALANCED_BOOK });
    expect(findings[0].detail).toContain('-20000 DESTROYED');
  });

  it('checks EVERY op arm, not only the gold ones', () => {
    // Per-dimension negatives: each op's own balance must be load-bearing, so
    // one broken row per op must produce exactly one finding.
    const perOp: [number, Partial<BankLedgerAuditRow>, string][] = [
      [1, { counterparty_copper_delta: 0 }, 'create_fee'], // fee charged to nobody
      [2, { counterparty_copper_delta: 0 }, 'open_bank'], // rung 0 opened for free
      [3, { counterparty_copper_delta: 0 }, 'deposit_gold'], // treasury filled from nowhere
      [7, { counterparty_copper_delta: -25_000 }, 'buy_slots'], // charged twice
      [8, { counterparty_count: 1 }, 'admin_purge'], // purge that handed the copy over
    ];
    for (const [id, patch, op] of perOp) {
      const rows = BALANCED_SESSION.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const kinds = auditBank({
        ledgerRows: rows,
        characters: [],
        guildBanks: BALANCED_BOOK,
      }).map((f) => f.kind);
      expect(`${op}:${kinds.join(',')}`).toBe(
        `${op}:counterparty_${id === 8 ? 'item' : 'copper'}_imbalance`,
      );
    }
  });

  it('SKIPS a row with no recorded counterparty side rather than reading it as balanced', () => {
    // Pre-feature rows and personal-container rows carry NULL. Treating an
    // absence as a zero would call every legacy row balanced, which is exactly
    // the false all-clear this check exists to stop being possible.
    expect(
      auditBank({
        ledgerRows: withoutCounterparty(BALANCED_SESSION),
        characters: [],
        guildBanks: BALANCED_BOOK,
      }),
    ).toEqual([]);
    // A HALF-recorded row is still checked: recording one column is enough to
    // claim the op was measured, so the other reads as the zero it says it is.
    const halfRecorded = BALANCED_SESSION.map((r) =>
      r.id === 4 ? { ...r, counterparty_copper_delta: null, counterparty_count: 0 } : r,
    );
    expect(
      auditBank({ ledgerRows: halfRecorded, characters: [], guildBanks: BALANCED_BOOK }).map(
        (f) => f.kind,
      ),
    ).toEqual(['counterparty_copper_imbalance']);
  });

  it('never balances a PERSONAL row: that container records no counterparty side', () => {
    const rows = [
      L({ id: 1, op: 'deposit', item_id: 'wolf_fang', count: 2, counterparty_count: 999 }),
    ];
    expect(
      auditBank({
        ledgerRows: rows,
        characters: [
          {
            id: 1,
            realm: 'Claudemoon',
            state: { bank: { inventory: [{ itemId: 'wolf_fang', count: 2 }], purchasedSlots: 0 } },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('reports a counterparty_orphan row outright and keeps it out of every replay', () => {
    const rows = [
      ...BALANCED_SESSION,
      G({
        id: 99,
        op: COUNTERPARTY_ORPHAN_OP,
        item_id: null,
        count: null,
        copper_delta: 0,
        purchased_slots_after: 0, // must NOT drag the ladder monotonicity back
        counterparty_copper_delta: 12_345,
        counterparty_count: 0,
        instance: { attemptedOp: 'withdraw_gold', copper: 12_345, items: {} },
      }),
    ];
    const findings = auditBank({ ledgerRows: rows, characters: [], guildBanks: BALANCED_BOOK });
    // Exactly one finding: the orphan itself. The treasury replay, the item
    // replay, and the ladder scan all ignore it, because the value it
    // describes moved OUTSIDE the book, which is why it was invisible before.
    expect(findings.map((f) => f.kind)).toEqual(['counterparty_orphan']);
    expect(findings[0].detail).toContain('12345 copper into the purse');
    expect(findings[0].detail).toContain('did not move at all');
  });

  it('DEGRADES rather than dying on a database that predates the columns', () => {
    // DEPLOY.md tells operators to run this tool after a restore, so a restored
    // pg_dump (or a replica that has not booted the new schema) is exactly the
    // incident it exists for. Naming a missing column unconditionally would
    // fail the whole audit precisely then.
    expect(counterpartySelectList(['counterparty_copper_delta', 'counterparty_count'])).toBe(
      'counterparty_copper_delta, counterparty_count',
    );
    expect(counterpartySelectList([])).toBe(
      'NULL::bigint AS counterparty_copper_delta, NULL::int AS counterparty_count',
    );
    // A half-migrated database (one ALTER applied, the other not) still reads.
    expect(counterpartySelectList(['counterparty_copper_delta'])).toBe(
      'counterparty_copper_delta, NULL::int AS counterparty_count',
    );
    // The aliases are what keep the row shape stable, so the NULLs land in the
    // skip path rather than reading as an unrecognized column.
    for (const list of [
      counterpartySelectList([]),
      counterpartySelectList(['counterparty_count']),
    ]) {
      expect(list).toContain('AS counterparty_copper_delta');
    }
  });

  it('reports how many guild rows it could NOT balance, so silence is never mistaken for proof', () => {
    const report = formatReport(
      withoutCounterparty(BALANCED_SESSION),
      auditBank({
        ledgerRows: withoutCounterparty(BALANCED_SESSION),
        characters: [],
        guildBanks: BALANCED_BOOK,
      }),
    );
    expect(report).toContain(
      'container guild: rows with no recorded counterparty side (pre-feature, unbalanceable): 8',
    );
    // And it names the HIGHEST id lacking one, so an operator can tell a frozen
    // historical gap from one a live write site is still growing.
    expect(report).toContain('container guild: highest id with no counterparty side: 8');
    // A fully recorded ledger reports zero unbalanceable rows, and says nothing
    // about a highest id (there is none).
    const clean = formatReport(BALANCED_SESSION, []);
    expect(clean).toContain('unbalanceable): 0');
    expect(clean).not.toContain('highest id with no counterparty side');
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

describe('the escrow-rollback anomaly row', () => {
  // ONE row per rollback event, and its numbers are SIGNED: an operator has to
  // be able to tell work that was taking value OUT of the book (the shape that
  // would have minted, had the save been allowed to commit its character half
  // without its book half) from work that was putting value IN.
  const guildRow = (o: Partial<BankLedgerAuditRow>): BankLedgerAuditRow =>
    L({ container: 'guild', container_id: 913, ...o });

  it('is REPORTED, and takes no part in the item, treasury, or ladder replays', () => {
    const findings = auditBank({
      ledgerRows: [
        guildRow({ id: 1, op: 'deposit_gold', copper_delta: 5_000, purchased_slots_after: 24 }),
        // The anomaly: 250 copper reached a purse the book never lost.
        guildRow({
          id: 2,
          op: 'escrow_deficit',
          copper_delta: -250,
          // Deliberately 0 while the guild sits at 24: an anomaly row carries
          // no ladder position and must not read as a ladder regression.
          purchased_slots_after: 0,
        }),
      ],
      characters: [],
      guildBanks: [
        {
          guild_id: 913,
          realm: 'Claudemoon',
          data: { treasury: 5_000, inventory: [], purchasedSlots: 24 },
        },
      ],
    });
    expect(findings.map((f) => f.kind)).toEqual(['escrow_deficit']);
    expect(findings[0].detail).toContain('250 copper');
    expect(findings[0].guildId).toBe(913);
  });

  it('names the missing copies on an item shortfall', () => {
    const findings = auditBank({
      ledgerRows: [
        guildRow({ id: 1, op: 'deposit', item_id: 'wolf_fang', count: 4 }),
        guildRow({ id: 2, op: 'withdraw', item_id: 'wolf_fang', count: 4 }),
        guildRow({ id: 3, op: 'escrow_deficit', item_id: 'wolf_fang', count: 4 }),
      ],
      characters: [],
      guildBanks: [{ guild_id: 913, realm: 'Claudemoon', data: { treasury: 0, inventory: [] } }],
    });
    expect(findings.map((f) => f.kind)).toEqual(['escrow_deficit']);
    expect(findings[0].detail).toContain('4 x wolf_fang');
  });

  it('is a GUILD-container op: one on the personal container is flagged', () => {
    const findings = auditBank({
      ledgerRows: [L({ id: 1, op: 'escrow_deficit', copper_delta: -1 })],
      characters: [],
      guildBanks: [],
    });
    expect(findings.map((f) => f.kind).sort()).toEqual(
      ['escrow_deficit', 'gold_op_outside_guild'].sort(),
    );
  });
});
