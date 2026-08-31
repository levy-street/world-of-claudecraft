import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const cliDb = vi.hoisted(() => ({ events: [] as string[] }));

vi.mock('pg', () => ({
  Pool: class {
    async connect() {
      cliDb.events.push('connect');
      return {
        query: async (statement: string) => {
          const sql = statement.replace(/\s+/g, ' ').trim();
          cliDb.events.push(`query:${sql}`);
          if (sql.includes('FROM storage_purchases') && sql.includes('ORDER BY')) {
            throw new Error('forced storage read failure');
          }
          if (sql.includes("to_regclass('bank_ledger')")) {
            return {
              rows: [
                { column_name: 'counterparty_copper_delta' },
                { column_name: 'counterparty_count' },
              ],
            };
          }
          if (sql.includes("to_regclass('storage_purchases')")) {
            return { rows: [{ present: true }] };
          }
          return { rows: [] };
        },
        release: () => cliDb.events.push('release'),
      };
    }

    async end() {
      cliDb.events.push('pool.end');
    }
  },
}));

import {
  BANK_SOCKET_PRICES as AUDIT_BANK_SOCKET_PRICES,
  auditBank,
  auditStoragePurchases,
  type BankAuditFinding,
  type BankLedgerAuditRow,
  COUNTERPARTY_ORPHAN_OP,
  counterpartySelectList,
  formatReport,
  formatStoragePurchaseReport,
  GUILD_BUY_POSITIONS,
  KNOWN_CONTAINERS,
  KNOWN_OPS,
  OPEN_BANK_SLOTS_AFTER,
  STORAGE_PURCHASE_REPORT_LIMIT,
  STORAGE_PURCHASE_STATUSES,
  STORAGE_PURCHASE_STRANDED_HOURS,
  type StoragePurchaseAuditRow,
  VAULT_MAX_RUNG,
} from '../scripts/bank_audit.mjs';
import { BANK_SOCKET_PRICES } from '../src/sim/bank';
import { GUILD_BANK_LADDER_POSITIONS, GUILD_BANK_RUNG_SLOTS } from '../src/sim/guild_bank';
import { VAULT_UPGRADE_PRICES } from '../src/sim/materials_vault';

// A raw-source .toContain() is comment-gameable: commenting the pinned line out
// leaves its text sitting in the comment, so the pin stays falsely green while
// the code is dead. Strip whole-line /* */ blocks (line-anchored, so a '/*'
// inside a // comment cannot open a false block), then // line comments,
// keeping :// protocol slashes. (The same helper tests/server/tunables.test.ts
// uses.)
const codeOnly = (src: string): string =>
  src.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

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

  it('the claudium buy rail: zero copper is clean, any copper is flagged', () => {
    // Bank Storage phase 11 added this branch and nothing exercised either
    // arm, so both were unkilled: the exemption could be inverted or deleted
    // with the audit suite green. A claudium buy_slots row moves NO copper
    // (its debit lives in the service-side claudium_ledger), so exactly 0 is
    // the whole contract.
    const clean = auditBank({
      ledgerRows: [
        L({
          id: 1,
          character_id: 60,
          op: 'buy_slots',
          item_id: 'strongbox_rung_01',
          instance: { paidWith: 'claudium' },
          copper_delta: 0,
          purchased_slots_after: 6,
        }),
      ],
      characters: [],
    });
    expect(findingKindsFor(clean, 60)).toEqual([]);
    // The SAME row shape a gold buy would use is a defect on the claudium
    // rail: copper moved where none may.
    const dirty = auditBank({
      ledgerRows: [
        L({
          id: 2,
          character_id: 61,
          op: 'buy_slots',
          item_id: 'strongbox_rung_01',
          instance: { paidWith: 'claudium' },
          copper_delta: -500,
          purchased_slots_after: 6,
        }),
      ],
      characters: [],
    });
    expect(findingKindsFor(dirty, 61)).toEqual(['copper_on_claudium_buy']);
    // And the exemption must not leak to the OTHER rails: an unstamped or
    // gold-stamped free buy still trips nonnegative_buy_cost, which is what
    // the claudium arm is carving an exception out of.
    for (const instance of [null, { paidWith: 'gold' }]) {
      const free = auditBank({
        ledgerRows: [
          L({
            id: 3,
            character_id: 62,
            op: 'buy_slots',
            instance,
            copper_delta: 0,
            purchased_slots_after: 6,
          }),
        ],
        characters: [],
      });
      expect(findingKindsFor(free, 62)).toEqual(['nonnegative_buy_cost']);
    }
  });

  it('the claudium exemption is PERSONAL-only: a stamped guild or vault row is itself a finding', () => {
    // Without the container scope a forged guild row carrying
    // {"paidWith":"claudium"} inherits the zero-copper exemption and walks
    // past nonnegative_buy_cost, which is the only check standing between the
    // audit and a free guild expansion. Guild and vault rails are single-rail
    // by design and stay unstamped, so the stamp itself is the anomaly.
    const guild = auditBank({
      ledgerRows: [
        L({
          id: 1,
          character_id: 70,
          op: 'buy_slots',
          container: 'guild',
          container_id: 913,
          instance: { paidWith: 'claudium' },
          copper_delta: 0,
          purchased_slots_after: 1,
        }),
      ],
      characters: [],
    });
    // Both fire: the stamp is wrong AND the free buy is no longer exempt.
    expect(guild.map((f) => f.kind)).toContain('claudium_rail_off_personal');
    expect(guild.map((f) => f.kind)).toContain('nonnegative_buy_cost');
    const vault = auditBank({
      ledgerRows: [
        V({
          id: 1,
          character_id: 71,
          op: 'buy_slots',
          instance: { paidWith: 'claudium' },
          copper_delta: 0,
          purchased_slots_after: 1,
        }),
      ],
      characters: [],
    });
    expect(vault.map((f) => f.kind)).toContain('claudium_rail_off_personal');
    expect(vault.map((f) => f.kind)).toContain('nonnegative_buy_cost');
  });

  it('flags a row whose container no reconciliation pass knows', () => {
    // A typo'd container is the one shape that used to escape everything: the
    // grouping pass builds it a group, but personal / vault / guild each
    // reconcile on their own literal, so the row moved value no pass read and
    // no finding named. It must surface as itself, not as silence.
    const findings = auditBank({
      ledgerRows: [
        L({
          id: 1,
          character_id: 1,
          op: 'deposit',
          item_id: 'copper_ore',
          count: 3,
          container: 'vualt',
        }),
      ],
      characters: [],
    });
    expect(findings.map((f) => f.kind)).toEqual(['unknown_container']);
    expect(findings[0]).toMatchObject({ container: 'vualt', realm: 'Claudemoon', characterId: 1 });
    // The detail names the row and the offending value, so an operator can
    // find the writer that produced it.
    expect(findings[0].detail).toContain('row 1');
    expect(findings[0].detail).toContain('vualt');
    // The three known containers stay silent on this check.
    for (const container of ['personal', 'vault', 'guild']) {
      const known = auditBank({
        ledgerRows: [
          L({
            id: 1,
            character_id: 1,
            op: 'deposit',
            item_id: 'copper_ore',
            count: 3,
            container,
            container_id: container === 'guild' ? 913 : null,
          }),
        ],
        characters: [],
      });
      expect(`${container}:${known.map((f) => f.kind).join(',')}`).toBe(`${container}:`);
    }
  });
});

// ---------------------------------------------------------------------------
// The Materials Vault container (Bank Storage Phase 2). Vault rows reuse the
// personal op vocabulary ('deposit' / 'withdraw' / 'buy_slots') and group per
// character like the personal bank, but reconcile against characters.state.vault:
// pooled stock plus an identity-preserving special multiset, and an `upgrades`
// rung that purchased_slots_after mirrors.
// ---------------------------------------------------------------------------

// A vault row's defaults: container 'vault' with no container_id. NOTE: L's
// purchased_slots_after default is 0, which the vault rung tripwire reads as
// out-of-ladder on a buy_slots row, so a vault buy_slots fixture must always
// set an explicit rung (1..VAULT_MAX_RUNG) unless the tripwire is its target.
function V(o: Partial<BankLedgerAuditRow>): BankLedgerAuditRow {
  return L({ container: 'vault', ...o });
}

describe('auditBank (vault container)', () => {
  it('a clean vault round trip reconciles against state.vault with zero findings', () => {
    expect(
      auditBank({
        ledgerRows: [
          {
            id: 1,
            character_id: 1,
            op: 'buy_slots',
            copper_delta: -20000,
            purchased_slots_after: 1,
          },
          {
            id: 2,
            character_id: 1,
            op: 'deposit',
            item_id: 'copper_ore',
            count: 6,
            purchased_slots_after: 1,
          },
          {
            id: 3,
            character_id: 1,
            op: 'withdraw',
            item_id: 'copper_ore',
            count: 2,
            purchased_slots_after: 1,
          },
          {
            id: 4,
            character_id: 1,
            op: 'buy_slots',
            copper_delta: -50000,
            purchased_slots_after: 2,
          },
        ].map(V),
        characters: [
          {
            id: 1,
            realm: 'Claudemoon',
            state: { vault: { stock: { copper_ore: 4 }, upgrades: 2 } },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('reconciles pooled and exact-versioned special identities as separate multisets', () => {
    const identity = {
      vaultSpecial: 1,
      instance: { signer: 'Ada', rolled: { quality: 'rare' } },
      craftedRecipeId: 'smelt_copper',
    };
    expect(
      auditBank({
        ledgerRows: [
          V({
            id: 1,
            character_id: 1,
            op: 'deposit',
            item_id: 'copper_ore',
            count: 4,
            purchased_slots_after: 1,
          }),
          V({
            id: 2,
            character_id: 1,
            op: 'deposit',
            item_id: 'copper_ore',
            count: 3,
            instance: identity,
            purchased_slots_after: 1,
          }),
          V({
            id: 3,
            character_id: 1,
            op: 'withdraw',
            item_id: 'copper_ore',
            count: 1,
            instance: identity,
            purchased_slots_after: 1,
          }),
        ],
        characters: [
          {
            id: 1,
            realm: 'Claudemoon',
            state: {
              vault: {
                stock: { copper_ore: 4 },
                special: [
                  {
                    itemId: 'copper_ore',
                    count: 2,
                    instance: identity.instance,
                    craftedRecipeId: 'smelt_copper',
                  },
                ],
                upgrades: 1,
              },
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('flags a tampered state.vault stock as a ledger_state_mismatch', () => {
    const findings = auditBank({
      ledgerRows: [
        {
          id: 1,
          character_id: 1,
          op: 'deposit',
          item_id: 'copper_ore',
          count: 6,
          purchased_slots_after: 1,
        },
      ].map(V),
      characters: [
        // The stock claims 9 where the ledger only ever explains 6: three
        // copies appeared without an op, the mint signature this audit exists
        // for.
        {
          id: 1,
          realm: 'Claudemoon',
          state: { vault: { stock: { copper_ore: 9 }, upgrades: 1 } },
        },
      ],
    });
    expect(findingKindsFor(findings, 1)).toEqual(['ledger_state_mismatch']);
    expect(findings[0]).toMatchObject({ container: 'vault', realm: 'Claudemoon', characterId: 1 });
    expect(findings[0].detail).toContain('copper_ore');
    expect(findings[0].detail).toContain('state vault');
  });

  it('flags an out-of-ladder or non-integer vault rung as bad_buy_position', () => {
    // The vault ladder is exactly rungs 1..VAULT_MAX_RUNG, so a writer-bug row
    // outside it is caught AT the row, not only downstream where the final
    // state happens to disagree. State matches the tampered rung in each red
    // fixture so the tripwire, not purchased_mismatch, is what fires.
    for (const rung of [6, 0, 2.5]) {
      const findings = auditBank({
        ledgerRows: [
          {
            id: 1,
            character_id: 1,
            op: 'buy_slots',
            copper_delta: -20000,
            purchased_slots_after: rung,
          },
        ].map(V),
        characters: [
          { id: 1, realm: 'Claudemoon', state: { vault: { stock: {}, upgrades: rung } } },
        ],
      });
      expect(findingKindsFor(findings, 1), `rung ${rung}`).toEqual(['bad_buy_position']);
      expect(findings[0].detail).toContain('vault buy_slots row 1');
    }
    // The boundary control: the TOP rung is legal and fires nothing.
    expect(
      auditBank({
        ledgerRows: [
          {
            id: 1,
            character_id: 1,
            op: 'buy_slots',
            copper_delta: -400000,
            purchased_slots_after: 5,
          },
        ].map(V),
        characters: [{ id: 1, realm: 'Claudemoon', state: { vault: { stock: {}, upgrades: 5 } } }],
      }),
    ).toEqual([]);
  });

  it('reconciles a prototype-named stock key parsed from JSON, and reds when the counts differ', () => {
    // vaultStateMultiset indexes stock[itemId] directly, which is correct for
    // JSON.parse-created OWN keys (a dormant '__proto__' arrives as a data
    // property from Postgres jsonb). The state arrives as a JSON STRING here,
    // the fixture shape a pg_dump restore hands over, so the parse path is the
    // real one; this pins that a future rewrite (spread merge, keyed rebuild)
    // does not turn the dormant key into a prototype write or a zero-read.
    const rows = [
      {
        id: 1,
        character_id: 1,
        op: 'deposit',
        item_id: '__proto__',
        count: 3,
        purchased_slots_after: 1,
      },
    ].map(V);
    expect(
      auditBank({
        ledgerRows: rows,
        characters: [
          {
            id: 1,
            realm: 'Claudemoon',
            state: '{"vault":{"stock":{"__proto__":3},"upgrades":1}}',
          },
        ],
      }),
    ).toEqual([]);
    const findings = auditBank({
      ledgerRows: rows,
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: '{"vault":{"stock":{"__proto__":5},"upgrades":1}}',
        },
      ],
    });
    expect(findingKindsFor(findings, 1)).toEqual(['ledger_state_mismatch']);
    expect(findings[0].detail).toContain('__proto__');
  });

  it('flags a withdraw of material that was never deposited (negative_net)', () => {
    const findings = auditBank({
      ledgerRows: [
        {
          id: 1,
          character_id: 1,
          op: 'withdraw',
          item_id: 'iron_ore',
          count: 3,
          purchased_slots_after: 1,
        },
      ].map(V),
      characters: [{ id: 1, realm: 'Claudemoon', state: { vault: { stock: {}, upgrades: 1 } } }],
    });
    expect(findingKindsFor(findings, 1)).toEqual(['negative_net', 'ledger_state_mismatch']);
  });

  it('flags a rung that REGRESSES across the row order and a final rung that disagrees with state', () => {
    const findings = auditBank({
      ledgerRows: [
        // character 1: the rung ladder walks backwards, which no legitimate op
        // can do (a vault is never downgraded).
        { id: 1, character_id: 1, op: 'buy_slots', copper_delta: -20000, purchased_slots_after: 2 },
        { id: 2, character_id: 1, op: 'buy_slots', copper_delta: -50000, purchased_slots_after: 1 },
        // character 2: a coherent ladder whose final rung the state contradicts.
        { id: 3, character_id: 2, op: 'buy_slots', copper_delta: -20000, purchased_slots_after: 1 },
      ].map(V),
      characters: [
        // Rung 1 matches character 1's LAST row, isolating the regression.
        { id: 1, realm: 'Claudemoon', state: { vault: { stock: {}, upgrades: 1 } } },
        { id: 2, realm: 'Claudemoon', state: { vault: { stock: {}, upgrades: 4 } } },
      ],
    });
    expect(findingKindsFor(findings, 1)).toEqual(['purchased_regression']);
    expect(findingKindsFor(findings, 2)).toEqual(['purchased_mismatch']);
    expect(findings.find((f) => f.characterId === 2)?.detail).toContain('state vault upgrades 4');
  });

  it('reconciles vault rows against an EMPTY vault when the state carries none', () => {
    // The personal container's corruption signature, in this container: rows
    // claiming materials or rungs the save does not show must be reported, not
    // skipped. A character with neither is a pre-vault save and stays silent.
    const findings = auditBank({
      ledgerRows: [
        {
          id: 1,
          character_id: 50,
          op: 'deposit',
          item_id: 'copper_ore',
          count: 5,
          purchased_slots_after: 1,
        },
        {
          id: 2,
          character_id: 50,
          op: 'buy_slots',
          copper_delta: -20000,
          purchased_slots_after: 1,
        },
        {
          id: 3,
          character_id: 51,
          op: 'deposit',
          item_id: 'iron_ore',
          count: 2,
          purchased_slots_after: 1,
        },
      ].map(V),
      characters: [
        { id: 50, realm: 'Claudemoon', state: null }, // NULL state, vault activity
        { id: 51, realm: 'Claudemoon', state: { pos: { x: 0, z: 0 } } }, // state, no vault
        { id: 52, realm: 'Claudemoon', state: null }, // pre-vault, no activity: skipped
      ],
    });
    expect(findingKindsFor(findings, 50)).toEqual(['ledger_state_mismatch', 'purchased_mismatch']);
    // Character 51 flags BOTH too, and that is the honest answer rather than an
    // over-report: a deposit can only happen at rung 1 or above (a locked vault
    // refuses every deposit), so a row claiming rung 1 against a save with no
    // vault at all contradicts the state on the ladder as well as the stock.
    expect(findingKindsFor(findings, 51)).toEqual(['ledger_state_mismatch', 'purchased_mismatch']);
    expect(findingKindsFor(findings, 52)).toEqual([]);
  });

  it('reads an ARRAY-shaped stock as empty and still reports the honest mismatch', () => {
    // The likely wrong guess is the bank's slot-list shape. Reading it as
    // empty rather than throwing is what keeps the reconciliation running: a
    // crash here would take the whole audit down instead of naming the one
    // character whose vault got written in the wrong shape.
    //
    // The stock is a NON-EMPTY slot list on purpose. An empty [] would prove
    // nothing: Object.keys([]) is already [], so it walks to the same empty
    // multiset with or without the Array.isArray guard. With a slot in it, an
    // audit missing that guard walks the ARRAY INDEX '0' as an item id and
    // reports a second, nonsense mismatch beside the real one.
    const findings = auditBank({
      ledgerRows: [
        V({
          id: 1,
          character_id: 1,
          op: 'deposit',
          item_id: 'copper_ore',
          count: 3,
          purchased_slots_after: 1,
        }),
      ],
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: { vault: { stock: [{ itemId: 'copper_ore', count: 3 }], upgrades: 1 } },
        },
      ],
    });
    // Exactly ONE finding, and it names the real item: the wrong-shaped stock
    // held nothing the audit could read, so the ledger's 3 is unreconciled.
    expect(findingKindsFor(findings, 1)).toEqual(['ledger_state_mismatch']);
    expect(findings[0].detail).toContain('item copper_ore');
    expect(findings[0].detail).toContain('ledger net 3 does not match state vault 0');
  });

  it('parses a state delivered as a JSON STRING, and survives a malformed one', () => {
    const rows = [
      V({
        id: 1,
        character_id: 1,
        op: 'deposit',
        item_id: 'copper_ore',
        count: 4,
        purchased_slots_after: 1,
      }),
    ];
    // characters.state arrives parsed from Postgres, but a fixture (or a
    // driver configured without JSON parsing) hands it over as text. The
    // tolerant parse must reconcile that exactly like the object, so a clean
    // round trip stays clean rather than reading as a bankless character.
    expect(
      auditBank({
        ledgerRows: rows,
        characters: [
          {
            id: 1,
            realm: 'Claudemoon',
            state: JSON.stringify({ vault: { stock: { copper_ore: 4 }, upgrades: 1 } }),
          },
        ],
      }),
    ).toEqual([]);
    // Garbage text hits the catch arm: the character reads as having NO vault,
    // which reconciles against an empty one and REPORTS both gaps. An audit
    // that threw on one corrupt row would tell an operator nothing about the
    // rest of the table.
    const findings = auditBank({
      ledgerRows: rows,
      characters: [{ id: 1, realm: 'Claudemoon', state: '{not json' }],
    });
    expect(findingKindsFor(findings, 1)).toEqual(['ledger_state_mismatch', 'purchased_mismatch']);
  });

  it('flags a negative count in the persisted vault stock itself', () => {
    const findings = auditBank({
      ledgerRows: [],
      characters: [
        {
          id: 5,
          realm: 'Claudemoon',
          state: { vault: { stock: { copper_ore: -2 }, upgrades: 1 } },
        },
      ],
    });
    expect(findingKindsFor(findings, 5)).toContain('negative_state_count');
    expect(findings.every((f) => f.container === 'vault')).toBe(true);
  });

  it('flags a negative count in persisted special storage itself', () => {
    const findings = auditBank({
      ledgerRows: [],
      characters: [
        {
          id: 6,
          realm: 'Claudemoon',
          state: {
            vault: {
              stock: {},
              special: [{ itemId: 'copper_ore', count: -2, instance: { signer: 'Ada' } }],
              upgrades: 1,
            },
          },
        },
      ],
    });
    expect(findingKindsFor(findings, 6)).toContain('negative_state_count');
    expect(findingKindsFor(findings, 6)).toContain('ledger_state_mismatch');
  });

  it('keeps the two per-character containers SEPARATE: neither replay papers over the other', () => {
    // The same item id in both stores. The personal bank is short by 2 and the
    // vault is long by 2, so a replay that pooled the containers would net to
    // zero and report a clean character. Each must flag on its own side.
    const findings = auditBank({
      ledgerRows: [
        L({ id: 1, character_id: 1, op: 'deposit', item_id: 'copper_ore', count: 5 }),
        V({
          id: 2,
          character_id: 1,
          op: 'deposit',
          item_id: 'copper_ore',
          count: 5,
          purchased_slots_after: 1,
        }),
      ],
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: {
            bank: { inventory: [{ itemId: 'copper_ore', count: 3 }], purchasedSlots: 0 },
            vault: { stock: { copper_ore: 7 }, upgrades: 1 },
          },
        },
      ],
    });
    expect(findings.map((f) => `${f.container}:${f.kind}`).sort()).toEqual([
      'personal:ledger_state_mismatch',
      'vault:ledger_state_mismatch',
    ]);
  });

  it('a character whose two containers each reconcile is clean, with no cross-container leakage', () => {
    expect(
      auditBank({
        ledgerRows: [
          L({ id: 1, character_id: 1, op: 'deposit', item_id: 'copper_ore', count: 5 }),
          L({
            id: 2,
            character_id: 1,
            op: 'buy_slots',
            copper_delta: -500,
            purchased_slots_after: 6,
          }),
          V({
            id: 3,
            character_id: 1,
            op: 'deposit',
            item_id: 'copper_ore',
            count: 4,
            purchased_slots_after: 1,
          }),
          V({
            id: 4,
            character_id: 1,
            op: 'buy_slots',
            copper_delta: -50000,
            purchased_slots_after: 2,
          }),
        ],
        characters: [
          {
            id: 1,
            realm: 'Claudemoon',
            state: {
              // The bank's ladder is SLOTS (6) and the vault's is RUNGS (2):
              // a reconciliation that read one container's ladder against the
              // other's state would red here.
              bank: { inventory: [{ itemId: 'copper_ore', count: 5 }], purchasedSlots: 6 },
              vault: { stock: { copper_ore: 4 }, upgrades: 2 },
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('shape-checks a vault row like any other item op, and never asks it for a container_id', () => {
    const findings = auditBank({
      ledgerRows: [
        V({ id: 1, character_id: 60, op: 'deposit', count: 2, purchased_slots_after: 1 }),
        V({
          id: 2,
          character_id: 61,
          op: 'deposit',
          item_id: 'copper_ore',
          count: 1,
          copper_delta: 25,
          purchased_slots_after: 1,
        }),
        V({ id: 3, character_id: 62, op: 'buy_slots', copper_delta: 0, purchased_slots_after: 1 }),
      ],
      characters: [],
    });
    expect(findingKindsFor(findings, 60)).toEqual(['missing_item_id']);
    expect(findingKindsFor(findings, 61)).toEqual(['copper_on_item_op']);
    expect(findingKindsFor(findings, 62)).toEqual(['nonnegative_buy_cost']);
    // container_id is a GUILD requirement; a null on a vault row is correct and
    // must not raise missing_container_id.
    expect(findings.map((f) => f.kind)).not.toContain('missing_container_id');
  });

  it('flags ANY non-guild row that carries a container_id: neither has a second key', () => {
    // Both per-character containers hardcode null because the character is the
    // group key (server/db.ts states the contract on BankLedgerRow). A non-null
    // one is a writer inventing a second key that the per-character grouping
    // would then ignore, so the row would reconcile under the wrong identity
    // with nothing saying so. The check is keyed on "not guild" rather than on
    // 'vault' alone: a personal row is the same hazard, and there is no
    // legitimate non-guild population with a container_id to false-positive on.
    const findings = auditBank({
      ledgerRows: [
        V({
          id: 1,
          character_id: 1,
          op: 'deposit',
          item_id: 'copper_ore',
          count: 2,
          purchased_slots_after: 1,
          container_id: 913,
        }),
      ],
      characters: [
        { id: 1, realm: 'Claudemoon', state: { vault: { stock: { copper_ore: 2 }, upgrades: 1 } } },
      ],
    });
    // Only the new shape finding: the replay itself still reconciles, which is
    // exactly why nothing else would have caught this.
    expect(findingKindsFor(findings, 1)).toEqual(['unexpected_container_id']);
    expect(findings[0].detail).toContain('vault row 1');
    expect(findings[0].detail).toContain('913');
    expect(findings.map((f) => f.kind)).not.toContain('missing_container_id');

    // The PERSONAL arm of the same check, which the vault-only form missed.
    const personal = auditBank({
      ledgerRows: [
        L({
          id: 1,
          character_id: 1,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 2,
          container_id: 913,
        }),
      ],
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: { bank: { inventory: [{ itemId: 'wolf_fang', count: 2 }], purchasedSlots: 0 } },
        },
      ],
    });
    expect(findingKindsFor(personal, 1)).toEqual(['unexpected_container_id']);
    expect(personal[0].detail).toContain('personal row 1');
    expect(personal[0].detail).toContain('913');

    // A GUILD row with a container_id is the correct shape and stays silent on
    // this check: the widened condition must not have swallowed the exemption.
    const guild = auditBank({
      ledgerRows: [
        L({
          id: 1,
          character_id: 1,
          op: 'deposit',
          item_id: 'wolf_fang',
          count: 2,
          container: 'guild',
          container_id: 913,
        }),
      ],
      characters: [],
    });
    expect(guild.map((f) => f.kind)).not.toContain('unexpected_container_id');
  });

  it('accepts only the exact special identity wrapper on vault deposit/withdraw rows', () => {
    const identity = {
      vaultSpecial: 1,
      instance: { signer: 'Ada' },
      craftedRecipeId: null,
    };
    const clean = auditBank({
      ledgerRows: [
        V({
          id: 1,
          character_id: 1,
          op: 'deposit',
          item_id: 'copper_ore',
          count: 2,
          purchased_slots_after: 1,
          instance: identity,
        }),
        L({
          id: 2,
          character_id: 2,
          op: 'deposit',
          item_id: 'iron_sword',
          count: 1,
          instance: { ilvl: 5 },
        }),
      ],
      characters: [],
    });
    expect(clean.map((f) => f.kind)).not.toContain('unexpected_instance');

    for (const instance of [
      { ilvl: 5 },
      { ...identity, vaultSpecial: 2 },
      { ...identity, extra: true },
      { vaultSpecial: 1, instance: { signer: 'Ada' } },
    ]) {
      const findings = auditBank({
        ledgerRows: [
          V({
            id: 1,
            character_id: 1,
            op: 'deposit',
            item_id: 'copper_ore',
            count: 2,
            purchased_slots_after: 1,
            instance,
          }),
        ],
        characters: [],
      });
      expect(
        findings.map((f) => f.kind),
        JSON.stringify(instance),
      ).toContain('unexpected_instance');
    }

    const craft = auditBank({
      ledgerRows: [
        V({
          id: 1,
          character_id: 1,
          op: 'craft_consume',
          item_id: 'copper_ore',
          count: 1,
          purchased_slots_after: 1,
          instance: identity,
        }),
      ],
      characters: [],
    });
    expect(craft.map((f) => f.kind)).toContain('unexpected_instance');
  });

  it('a guild-only op wearing the vault container is flagged', () => {
    // deposit_gold has no meaning in a per-character material store; the
    // container guard must catch it rather than let it into a vault replay.
    const findings = auditBank({
      ledgerRows: [V({ id: 1, character_id: 1, op: 'deposit_gold', copper_delta: 100 })],
      characters: [],
    });
    expect(findings.map((f) => f.kind)).toContain('gold_op_outside_guild');
  });

  it('formatReport names the vault container in its summary and FINDING lines', () => {
    const rows = [
      V({
        id: 1,
        character_id: 1,
        op: 'deposit',
        item_id: 'copper_ore',
        count: 6,
        purchased_slots_after: 1,
      }),
    ];
    const findings = auditBank({
      ledgerRows: rows,
      characters: [
        { id: 1, realm: 'Claudemoon', state: { vault: { stock: { copper_ore: 9 }, upgrades: 1 } } },
      ],
    });
    const report = formatReport(rows, findings);
    expect(report).toContain('container vault: ledger rows 1: findings 1');
    expect(report).toContain('FINDING: container vault: realm Claudemoon: character 1:');
    // The counterparty summary lines are GUILD-only: a personal-style container
    // records no counterparty side, so claiming "N unbalanceable rows" for it
    // would invent a gap that does not exist.
    expect(report).not.toContain('container vault: rows with no recorded counterparty side');
  });
});

// ---------------------------------------------------------------------------
// Vault craft consumption (Bank Storage Phase 04): op 'craft_consume' rows
// written through the reservation journal at admission time
// (bankLedgerJournal.reserveVaultConsumption; the tick-side
// recordVaultCraftConsume observer is retired), replayed as removals beside
// deposit/withdraw.
// ---------------------------------------------------------------------------
describe('auditBank (vault craft consumption, Phase 04)', () => {
  it('a history with craft_consume rows reconciles against state.vault with zero findings', () => {
    expect(
      auditBank({
        ledgerRows: [
          {
            id: 1,
            character_id: 1,
            op: 'buy_slots',
            copper_delta: -20000,
            purchased_slots_after: 1,
          },
          {
            id: 2,
            character_id: 1,
            op: 'deposit',
            item_id: 'copper_ore',
            count: 6,
            purchased_slots_after: 1,
          },
          {
            id: 3,
            character_id: 1,
            op: 'craft_consume',
            item_id: 'copper_ore',
            count: 4,
            purchased_slots_after: 1,
          },
        ].map(V),
        characters: [
          {
            id: 1,
            realm: 'Claudemoon',
            state: { vault: { stock: { copper_ore: 2 }, upgrades: 1 } },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('a row drawn to zero reconciles against the DELETED stock key, not a written 0', () => {
    // The consumption writer deletes a key it zeroes (the vaultWithdraw shape),
    // so the honest final state has NO copper_ore key at all. A written 0 would
    // also reconcile (0 == 0), which is exactly why the delete rule is pinned
    // sim-side; this arm pins that the audit accepts the deleted-key shape.
    expect(
      auditBank({
        ledgerRows: [
          {
            id: 1,
            character_id: 1,
            op: 'buy_slots',
            copper_delta: -20000,
            purchased_slots_after: 1,
          },
          {
            id: 2,
            character_id: 1,
            op: 'deposit',
            item_id: 'copper_ore',
            count: 6,
            purchased_slots_after: 1,
          },
          {
            id: 3,
            character_id: 1,
            op: 'craft_consume',
            item_id: 'copper_ore',
            count: 6,
            purchased_slots_after: 1,
          },
        ].map(V),
        characters: [{ id: 1, realm: 'Claudemoon', state: { vault: { stock: {}, upgrades: 1 } } }],
      }),
    ).toEqual([]);
  });

  it('an UNLEDGERED consumption reads as ledger_state_mismatch (why the recorder exists)', () => {
    // The Phase 04 handoff's failure mode, pinned on purpose: if a craft
    // consumed vault stock and no craft_consume row landed, the state is
    // LOWER than the replayed net and the character reconciles dirty forever.
    const findings = auditBank({
      ledgerRows: [
        { id: 1, character_id: 1, op: 'buy_slots', copper_delta: -20000, purchased_slots_after: 1 },
        {
          id: 2,
          character_id: 1,
          op: 'deposit',
          item_id: 'copper_ore',
          count: 6,
          purchased_slots_after: 1,
        },
      ].map(V),
      characters: [
        { id: 1, realm: 'Claudemoon', state: { vault: { stock: { copper_ore: 2 }, upgrades: 1 } } },
      ],
    });
    expect(findingKindsFor(findings, 1)).toEqual(['ledger_state_mismatch']);
    expect(findings[0].detail).toContain('copper_ore');
  });

  it('shape arms: bad_count, missing_item_id, and copper_on_item_op each fire per dimension', () => {
    for (const [row, kind] of [
      [{ id: 1, op: 'craft_consume', item_id: 'copper_ore', count: 0 }, 'bad_count'],
      [{ id: 1, op: 'craft_consume', item_id: 'copper_ore', count: -2 }, 'bad_count'],
      [{ id: 1, op: 'craft_consume', count: 2 }, 'missing_item_id'],
      [
        { id: 1, op: 'craft_consume', item_id: 'copper_ore', count: 2, copper_delta: -5 },
        'copper_on_item_op',
      ],
    ] as const) {
      const findings = auditBank({
        ledgerRows: [V({ purchased_slots_after: 1, ...row })],
        characters: [
          {
            id: 1,
            realm: 'Claudemoon',
            state: { vault: { stock: { copper_ore: 2 }, upgrades: 1 } },
          },
        ],
      });
      expect(
        findingKindsFor(findings, 1).includes(kind),
        `${JSON.stringify(row)} should raise ${kind}`,
      ).toBe(true);
    }
  });

  it('craft_consume outside the vault container raises vault_op_outside_vault', () => {
    // Personal replay nets the removal (3 in, 2 consumed, state shows 1) so
    // the guard is the ONLY finding: the fixture isolates the container rule.
    const findings = auditBank({
      ledgerRows: [
        L({ id: 1, character_id: 1, op: 'deposit', item_id: 'wolf_fang', count: 3 }),
        L({ id: 2, character_id: 1, op: 'craft_consume', item_id: 'wolf_fang', count: 2 }),
      ],
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: { bank: { inventory: [{ itemId: 'wolf_fang', count: 1 }], purchasedSlots: 0 } },
        },
      ],
    });
    expect(findingKindsFor(findings, 1)).toEqual(['vault_op_outside_vault']);
    expect(findings[0].detail).toContain("craft_consume row 2 has container 'personal'");
    // The GUILD arm of the same comparison (the coverage audit's nit): the
    // guard keys on container !== 'vault', so a guild-container craft row
    // must trip it identically.
    const guildFindings = auditBank({
      ledgerRows: [
        G({ id: 1, character_id: 1, op: 'deposit', item_id: 'wolf_fang', count: 3 }),
        G({ id: 2, character_id: 1, op: 'craft_consume', item_id: 'wolf_fang', count: 2 }),
      ],
      characters: [],
      guildBanks: [],
    });
    expect(
      guildFindings.filter((f) => f.kind === 'vault_op_outside_vault').map((f) => f.detail),
    ).toEqual([expect.stringContaining("craft_consume row 2 has container 'guild'")]);
  });

  it('an op the vocabulary does not know raises unknown_op instead of vanishing', () => {
    // The op-side twin of unknown_container, added with this phase: before it,
    // an unrecognized op got no shape checks and no replay, silently.
    const findings = auditBank({
      ledgerRows: [V({ id: 1, op: 'transmute', item_id: 'copper_ore', count: 2 })],
      characters: [],
    });
    expect(findingKindsFor(findings, 1)).toEqual(['unknown_op']);
    expect(findings[0].detail).toContain("1 row(s) carry an unrecognized op 'transmute'");
    expect(findings[0].detail).toContain('first at row 1');
  });

  it('a SYSTEMATIC unknown op dedupes to ONE finding per op value with the count (F4)', () => {
    // The flaggedNegative discipline: a typo'd writer (or an old audit behind
    // a newer server) makes an entire op class unknown, and per-row emission
    // on a keep-forever table would flood the report exactly when an operator
    // most needs it. One finding per VALUE, count in the detail.
    const findings = auditBank({
      ledgerRows: [
        V({ id: 1, op: 'transmute', item_id: 'copper_ore', count: 2 }),
        V({ id: 2, op: 'transmute', item_id: 'tin_ore', count: 1 }),
        V({ id: 3, op: 'transmute', item_id: 'iron_ore', count: 4, character_id: 2 }),
        V({ id: 4, op: 'evaporate', item_id: 'iron_ore', count: 4 }),
      ],
      characters: [],
    });
    const unknown = findings.filter((f) => f.kind === 'unknown_op');
    expect(unknown).toHaveLength(2);
    expect(unknown[0].detail).toContain("3 row(s) carry an unrecognized op 'transmute'");
    expect(unknown[0].detail).toContain('first at row 1');
    expect(unknown[1].detail).toContain("1 row(s) carry an unrecognized op 'evaporate'");
    // The reach clause: the finding names the FIRST row's group but must say
    // how many container/character groups the op class spans, or an operator
    // filtering by character reads a systematic writer bug as one character's
    // corruption (rows 1+2 are one character, row 3 another).
    expect(unknown[0].detail).toContain('across 2 container/character group(s)');
    expect(unknown[1].detail).toContain('across 1 container/character group(s)');
  });

  it('every KNOWN op passes the vocabulary chain without an unknown_op finding (F5)', () => {
    // A table-driven guard over the full BankLedgerRow.op union: restructuring
    // the shape chain so a legitimate op falls off it would otherwise turn
    // that op into a per-value finding storm with no red test. Each fixture is
    // minimally valid for its op's own shape arm; the assertion is ONLY about
    // unknown_op (other shape findings are each arm's own suites' business).
    const KNOWN_OP_ROWS: BankLedgerAuditRow[] = [
      V({ id: 1, op: 'deposit', item_id: 'copper_ore', count: 2, purchased_slots_after: 1 }),
      V({ id: 2, op: 'withdraw', item_id: 'copper_ore', count: 1, purchased_slots_after: 1 }),
      V({ id: 3, op: 'buy_slots', copper_delta: -20000, purchased_slots_after: 1 }),
      V({
        id: 4,
        op: 'craft_consume',
        item_id: 'copper_ore',
        count: 1,
        purchased_slots_after: 1,
      }),
      G({ id: 5, op: 'deposit_gold', copper_delta: 500 }),
      G({ id: 6, op: 'withdraw_gold', copper_delta: -200 }),
      G({ id: 7, op: 'create_fee', copper_delta: -1000, purchased_slots_after: 0 }),
      G({ id: 8, op: 'open_bank', copper_delta: -5000, purchased_slots_after: 24 }),
      G({ id: 9, op: 'admin_purge', item_id: 'wolf_fang', count: 1 }),
      G({ id: 10, op: 'escrow_deficit', copper_delta: -100 }),
      G({ id: 11, op: 'counterparty_orphan' }),
      // The bank socket trio (phase 07): personal-container rows, each
      // minimally valid for its own shape arm (the unlock at the first
      // ladder price, the movers at exactly one bag).
      L({ id: 12, op: 'unlock_socket', copper_delta: -1000000, purchased_slots_after: 0 }),
      L({ id: 13, op: 'socket_bag', item_id: 'travelers_knapsack', count: 1 }),
      L({ id: 14, op: 'unsocket_bag', item_id: 'travelers_knapsack', count: 1 }),
    ];
    // The fixture is forced to track KNOWN_OPS: an op added to the set with no
    // fixture row here reds THIS assertion, and a fixture row whose op the
    // chain has no arm for reds the zero-unknown_op assertion below. Together
    // with the db.ts lockstep scrape this closes the two-way vocabulary chain
    // union -> KNOWN_OPS -> fixture -> shape arms.
    expect(KNOWN_OP_ROWS.map((r) => String(r.op)).sort()).toEqual(Array.from(KNOWN_OPS).sort());
    const findings = auditBank({ ledgerRows: KNOWN_OP_ROWS, characters: [] });
    expect(findings.filter((f) => f.kind === 'unknown_op')).toEqual([]);
  });

  it('craft_consume rows participate in the rung monotonicity scan', () => {
    // purchased_slots_after on a craft row carries the live rung; a regressed
    // value is a tampered row and must trip exactly like any other vault row.
    const findings = auditBank({
      ledgerRows: [
        { id: 1, character_id: 1, op: 'buy_slots', copper_delta: -50000, purchased_slots_after: 2 },
        {
          id: 2,
          character_id: 1,
          op: 'craft_consume',
          item_id: 'copper_ore',
          count: 1,
          purchased_slots_after: 1,
        },
      ].map(V),
      characters: [],
    });
    expect(findingKindsFor(findings, 1)).toContain('purchased_regression');
  });

  it('consuming more than was ever deposited raises negative_net', () => {
    const findings = auditBank({
      ledgerRows: [
        V({
          id: 1,
          character_id: 1,
          op: 'craft_consume',
          item_id: 'copper_ore',
          count: 3,
          purchased_slots_after: 1,
        }),
      ],
      characters: [],
    });
    expect(findingKindsFor(findings, 1)).toEqual(['negative_net']);
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
    // The vault ladder's top rung, the same redeclaration hazard: a sixth
    // upgrade landing in materials_vault.ts without the .mjs mirror would make
    // the tripwire flag every legitimate rung-6 purchase.
    expect(VAULT_MAX_RUNG).toBe(VAULT_UPGRADE_PRICES.length);
    // The bank socket ladder (phase 07), the same hazard again: a socket
    // price retune landing in bank.ts without the .mjs mirror would make the
    // per-position price check flag every legitimate unlock.
    expect([...AUDIT_BANK_SOCKET_PRICES]).toEqual([...BANK_SOCKET_PRICES]);
  });
});

describe('the audit op vocabulary (lockstep with server/db.ts)', () => {
  it('pins the .mjs KNOWN_OPS set to the BankLedgerRow op union', () => {
    // Same redeclaration hazard as the container set below: the .mjs never
    // imports the TS server, so a NEW op added to BankLedgerRow.op (plus
    // a writer) with no audit arm would red NO test before this pin existed;
    // the new op's rows would surface only as runtime unknown_op findings in
    // production audits (one-way coverage). The db.ts side is scraped from
    // RAW SOURCE (a type union is erased at runtime): the declaration is
    // sliced from the BankLedgerRow interface head to the union's terminating
    // semicolon AFTER comment-stripping, so a commented-out member cannot
    // stay counted, and the multi-line member list is tolerated (no
    // single-line literal arm to break on a reformat).
    const dbSrc = codeOnly(readFileSync(new URL('../server/db.ts', import.meta.url), 'utf8'));
    const ifaceStart = dbSrc.indexOf('export interface BankLedgerRow {');
    expect(ifaceStart).toBeGreaterThan(-1);
    const opStart = dbSrc.indexOf('\n  op:', ifaceStart) + 1;
    expect(
      opStart,
      'the op: field anchor (newline plus two-space indent, so a field merely ENDING in op cannot reroute the slice)',
    ).toBeGreaterThan(ifaceStart);
    const opEnd = dbSrc.indexOf(';', opStart);
    expect(opEnd).toBeGreaterThan(opStart);
    const unionBody = dbSrc.slice(opStart, opEnd);
    const members = Array.from(unionBody.matchAll(/'([a-z_]+)'/g), (m) => m[1]);
    // Set equality in BOTH directions: a union member the audit does not know
    // reds here, and a KNOWN_OPS entry the union dropped reds here too.
    expect(members.sort()).toEqual(Array.from(KNOWN_OPS).sort());
  });
});

describe('the audit container vocabulary (lockstep with server/db.ts)', () => {
  it('pins the .mjs container set to the BankLedgerRow union', () => {
    // Same redeclaration hazard as the ladder above: the .mjs never imports the
    // TS server, so the writer's vocabulary (BankLedgerRow.container) and the
    // auditor's (KNOWN_CONTAINERS) are two independent literals. Widening ONE
    // is the failure that matters: a new container the writer emits but the
    // auditor does not know gets a group that no reconciliation pass reads
    // (only unknown_container names it), and a container the auditor knows but
    // no writer emits is a dead branch pretending to be coverage.
    expect(Array.from(KNOWN_CONTAINERS).sort()).toEqual(['guild', 'personal', 'vault']);
    // The db.ts side by RAW SOURCE, not by an imported type (a type union is
    // erased at runtime and cannot be asserted on). Single-line literal arm:
    // the union is written on one line, so this reds the moment a fourth
    // member is added or one is removed.
    const dbSrc = readFileSync(new URL('../server/db.ts', import.meta.url), 'utf8');
    expect(codeOnly(dbSrc)).toContain("  container: 'personal' | 'guild' | 'vault';");
  });
});

describe('the characters read (source pin)', () => {
  it('projects BOTH per-character container slices out of the state blob', () => {
    // The audit reconciles two independent stores per character. Dropping
    // either extraction would not fail: the missing slice would read as "no
    // state" and reconcile that whole container against an empty one, turning
    // every real mismatch in it into silence.
    //
    // Pinned by RAW SOURCE (the repo's source-pin idiom, tests/server/
    // tunables.test.ts), not through the imported constant: the imported value
    // is what the module evaluated, so an assertion on it is a constant
    // self-comparison that a rewritten projection would satisfy just as well.
    // Comments are stripped first, so a commented-out projection cannot keep
    // this green.
    const auditSrc = codeOnly(
      readFileSync(new URL('../scripts/bank_audit.mjs', import.meta.url), 'utf8'),
    );
    // The constant is only load-bearing if main() still runs it.
    expect(auditSrc).toContain('await client.query(CHARACTERS_SQL)');
    // Then the declaration's own BODY, sliced to its closing backtick, so an
    // arm matching somewhere else in the file (a neighbouring query, a prose
    // mention) can never satisfy it.
    const declStart = auditSrc.indexOf('export const CHARACTERS_SQL = `');
    expect(declStart).toBeGreaterThan(-1);
    const declEnd = auditSrc.indexOf('`;', declStart);
    expect(declEnd).toBeGreaterThan(declStart);
    const body = auditSrc.slice(declStart, declEnd);
    // Both slices in ONE single-line literal arm: dropping either one reds.
    expect(body).toContain(
      "jsonb_build_object('bank', state->'bank', 'vault', state->'vault') AS state",
    );
    expect(body).toContain('FROM characters');
  });
});

describe('the CLI snapshot boundary', () => {
  it('reconciles every table through one read-only repeatable-read client', () => {
    const auditSrc = codeOnly(
      readFileSync(new URL('../scripts/bank_audit.mjs', import.meta.url), 'utf8'),
    );
    expect(auditSrc).toContain(
      "await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')",
    );
    expect(auditSrc).toContain("await client.query('COMMIT')");
    expect(auditSrc).toContain("await client.query('ROLLBACK')");
    expect(auditSrc).not.toContain('await pool.query(');
  });

  it('begins before every read and rolls back then releases after a failed read', async () => {
    const scriptPath = fileURLToPath(new URL('../scripts/bank_audit.mjs', import.meta.url));
    const previousArgv1 = process.argv[1];
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousExitCode = process.exitCode;
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cliDb.events.length = 0;

    try {
      process.argv[1] = scriptPath;
      process.env.DATABASE_URL = 'postgres://bank-audit-test';
      vi.resetModules();
      await import('../scripts/bank_audit.mjs');
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

      const queries = cliDb.events.filter((event) => event.startsWith('query:'));
      expect(queries[0]).toBe('query:BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const reads = queries.filter((event) => event.startsWith('query:SELECT'));
      expect(reads).toHaveLength(6);
      expect(reads.every((event) => queries.indexOf(event) > 0)).toBe(true);

      const failedRead = cliDb.events.findIndex(
        (event) => event.includes('FROM storage_purchases') && event.includes('ORDER BY'),
      );
      const rollback = cliDb.events.indexOf('query:ROLLBACK');
      const release = cliDb.events.indexOf('release');
      const poolEnd = cliDb.events.indexOf('pool.end');
      expect(failedRead).toBeGreaterThan(0);
      expect(rollback).toBeGreaterThan(failedRead);
      expect(release).toBeGreaterThan(rollback);
      expect(poolEnd).toBeGreaterThan(release);
      expect(cliDb.events).not.toContain('query:COMMIT');
    } finally {
      process.argv[1] = previousArgv1;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      process.exitCode = previousExitCode;
      exit.mockRestore();
      log.mockRestore();
      error.mockRestore();
      vi.resetModules();
    }
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

  it('allows a delayed guild bystander row without hiding ladder-command regressions', () => {
    const book = [
      {
        guild_id: 913,
        realm: 'Claudemoon',
        data: { treasury: 1_000, inventory: [], purchasedSlots: 30 },
      },
    ];
    const delayedBystander = auditBank({
      ledgerRows: [
        G({ id: 1, op: 'open_bank', copper_delta: -90_000, purchased_slots_after: 24 }),
        G({ id: 2, op: 'deposit_gold', copper_delta: 25_000, purchased_slots_after: 24 }),
        G({ id: 3, op: 'buy_slots', copper_delta: -25_000, purchased_slots_after: 30 }),
        // This officer acted before row 3 but saved afterwards. It moved no
        // ladder state, so its captured rung is a legitimate stale witness.
        G({ id: 4, op: 'deposit_gold', copper_delta: 1_000, purchased_slots_after: 24 }),
      ],
      characters: [],
      guildBanks: book,
    });
    expect(delayedBystander).toEqual([]);

    const regressedPurchase = auditBank({
      ledgerRows: [
        G({ id: 1, op: 'open_bank', copper_delta: -90_000, purchased_slots_after: 24 }),
        G({ id: 2, op: 'deposit_gold', copper_delta: 50_000, purchased_slots_after: 24 }),
        G({ id: 3, op: 'buy_slots', copper_delta: -25_000, purchased_slots_after: 30 }),
        G({ id: 4, op: 'buy_slots', copper_delta: -25_000, purchased_slots_after: 24 }),
      ],
      characters: [],
      guildBanks: [
        {
          guild_id: 913,
          realm: 'Claudemoon',
          data: { treasury: 0, inventory: [], purchasedSlots: 30 },
        },
      ],
    });
    expect(guildKindsFor(regressedPurchase, 913)).toContain('purchased_regression');
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

  it('accepts a netted-rescue round trip while still rejecting a negative final guild net', () => {
    const clean = auditBank({
      ledgerRows: [
        G({ id: 1, op: 'deposit', item_id: 'wolf_fang', count: 3 }),
        G({ id: 2, op: 'withdraw', item_id: 'wolf_fang', count: 3 }),
        // A later transaction withdrew and returned the same copies. Its
        // ordered replay can dip below zero, while the DB's netted rescue
        // applies the equivalent zero-net batch safely.
        G({ id: 3, op: 'withdraw', item_id: 'wolf_fang', count: 3 }),
        G({ id: 4, op: 'deposit', item_id: 'wolf_fang', count: 3 }),
      ],
      characters: [],
      guildBanks: [
        {
          guild_id: 913,
          realm: 'Claudemoon',
          data: { treasury: 0, inventory: [], purchasedSlots: 0 },
        },
      ],
    });
    expect(clean).toEqual([]);

    const corrupt = auditBank({
      ledgerRows: [G({ id: 1, op: 'withdraw', item_id: 'wolf_fang', count: 1 })],
      characters: [],
    });
    expect(guildKindsFor(corrupt, 913)).toEqual(['negative_net']);
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

  it('accepts a transient negative treasury that later cross-officer activity restores', () => {
    const findings = auditBank({
      ledgerRows: [
        G({ id: 1, character_id: 2, op: 'withdraw_gold', copper_delta: -8_000 }),
        G({ id: 2, character_id: 1, op: 'deposit_gold', copper_delta: 10_000 }),
      ],
      characters: [],
      guildBanks: [
        {
          guild_id: 913,
          realm: 'Claudemoon',
          data: { treasury: 2_000, inventory: [], purchasedSlots: 0 },
        },
      ],
    });
    expect(findings).toEqual([]);
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

// ---------------------------------------------------------------------------
// The bank socket store (Bank Storage phase 07): unlock_socket replays the
// copper ladder against state.bank.unlockedSockets; socket_bag / unsocket_bag
// replay the socketed-bag multiset against state.bank.socketBags, in maps
// SEPARATE from the slot replay's.
// ---------------------------------------------------------------------------
describe('auditBank (bank socket store, Phase 07)', () => {
  it('a clean socket history reconciles against state.bank with zero findings', () => {
    // Two unlocks at the exact ladder prices, one bag socketed and left, a
    // second socketed and taken back out (the swap writes exactly this row
    // pair), beside an ordinary slot deposit so both replays coexist.
    const findings = auditBank({
      ledgerRows: [
        L({ id: 1, op: 'unlock_socket', copper_delta: -1000000, purchased_slots_after: 0 }),
        L({ id: 2, op: 'unlock_socket', copper_delta: -2000000, purchased_slots_after: 0 }),
        L({ id: 3, op: 'socket_bag', item_id: 'bag_a', count: 1 }),
        L({ id: 4, op: 'socket_bag', item_id: 'bag_b', count: 1 }),
        L({ id: 5, op: 'unsocket_bag', item_id: 'bag_b', count: 1 }),
        L({ id: 6, op: 'deposit', item_id: 'wolf_fang', count: 3 }),
      ],
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: {
            bank: {
              inventory: [{ itemId: 'wolf_fang', count: 3 }],
              purchasedSlots: 0,
              unlockedSockets: 2,
              socketBags: ['bag_a', null, null, null],
            },
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('keeps the socket store and the slot bank SEPARATE for the same bag id', () => {
    // The same bag id sits in a slot AS an item and in a socket AS capacity:
    // both replays reconcile independently.
    const rows = [
      L({ id: 1, op: 'unlock_socket', copper_delta: -1000000, purchased_slots_after: 0 }),
      L({ id: 2, op: 'deposit', item_id: 'bag_a', count: 1 }),
      L({ id: 3, op: 'socket_bag', item_id: 'bag_a', count: 1 }),
    ];
    const stateFor = (socketBags: (string | null)[]) => [
      {
        id: 1,
        realm: 'Claudemoon',
        state: {
          bank: {
            inventory: [{ itemId: 'bag_a', count: 1 }],
            purchasedSlots: 0,
            unlockedSockets: 1,
            socketBags,
          },
        },
      },
    ];
    expect(
      auditBank({ ledgerRows: rows, characters: stateFor(['bag_a', null, null, null]) }),
    ).toEqual([]);
    // The discriminating arm: the slot side still balances, but the socket
    // store lost its copy, and the SEPARATE replay is what catches it (a
    // merged multiset would read 1 ledger vs 1 state and stay silent).
    const findings = auditBank({
      ledgerRows: rows,
      characters: stateFor([null, null, null, null]),
    });
    expect(findingKindsFor(findings, 1)).toEqual(['socket_ledger_state_mismatch']);
    expect(findings[0].detail).toContain(
      'bag_a: socket ledger net 1 does not match state socketBags 0',
    );
  });

  it('flags an unsocket of a bag that was never socketed (negative_socket_net)', () => {
    const findings = auditBank({
      ledgerRows: [L({ id: 1, op: 'unsocket_bag', item_id: 'bag_a', count: 1 })],
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: { bank: { inventory: [], purchasedSlots: 0 } },
        },
      ],
    });
    // The mint signature in B, then the net (-1 vs 0) mismatch in C: both are
    // real, separately-worded facts about the same forged row.
    expect(findingKindsFor(findings, 1).sort()).toEqual(
      ['negative_socket_net', 'socket_ledger_state_mismatch'].sort(),
    );
  });

  it('flags a wrong-price unlock and a fifth unlock past the ladder', () => {
    const wrongPrice = auditBank({
      ledgerRows: [
        L({ id: 1, op: 'unlock_socket', copper_delta: -999999, purchased_slots_after: 0 }),
      ],
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: { bank: { inventory: [], purchasedSlots: 0, unlockedSockets: 1 } },
        },
      ],
    });
    expect(findingKindsFor(wrongPrice, 1)).toEqual(['bad_socket_price']);
    expect(wrongPrice[0].detail).toContain('expected -1000000');

    const pastLadder = auditBank({
      ledgerRows: [
        L({ id: 1, op: 'unlock_socket', copper_delta: -1000000, purchased_slots_after: 0 }),
        L({ id: 2, op: 'unlock_socket', copper_delta: -2000000, purchased_slots_after: 0 }),
        L({ id: 3, op: 'unlock_socket', copper_delta: -3500000, purchased_slots_after: 0 }),
        L({ id: 4, op: 'unlock_socket', copper_delta: -5000000, purchased_slots_after: 0 }),
        L({ id: 5, op: 'unlock_socket', copper_delta: -5000000, purchased_slots_after: 0 }),
      ],
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: { bank: { inventory: [], purchasedSlots: 0, unlockedSockets: 4 } },
        },
      ],
    });
    // The fifth row is past the four-rung ladder AND makes the unlock count
    // disagree with the state's ceiling-clamped 4.
    expect(findingKindsFor(pastLadder, 1).sort()).toEqual(
      ['socket_unlock_mismatch', 'socket_unlock_past_ladder'].sort(),
    );
  });

  it('flags socket state no ledger row explains (the birth-complete direction)', () => {
    // A state.bank holding a socketed bag and an unlocked rung with ZERO
    // socket rows: rows claim nothing, the state claims both. The ordinary
    // deposit row is NOT what admits the character to the reconciliation
    // pass (persisted bank state alone does that: the pass gate is
    // `!bank && !hasLedgerActivity`, pinned by the ledgerRows: [] arm
    // earlier in this file); it BALANCES the fixture's wolf_fang slot so the
    // slot replay reconciles clean and the assertion below stays an exact
    // two-finding set, proving the socket findings coexist with an
    // otherwise-healthy slot history rather than riding a noisy one.
    const findings = auditBank({
      ledgerRows: [L({ id: 1, op: 'deposit', item_id: 'wolf_fang', count: 1 })],
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: {
            bank: {
              inventory: [{ itemId: 'wolf_fang', count: 1 }],
              purchasedSlots: 0,
              unlockedSockets: 1,
              socketBags: ['bag_a', null, null, null],
            },
          },
        },
      ],
    });
    expect(findingKindsFor(findings, 1).sort()).toEqual(
      ['socket_ledger_state_mismatch', 'socket_unlock_mismatch'].sort(),
    );
  });

  it('shape-checks each socket-row dimension independently', () => {
    const findings = auditBank({
      ledgerRows: [
        // A two-bag socket move cannot exist (sockets hold one bare id).
        L({ id: 1, op: 'socket_bag', item_id: 'bag_a', count: 2 }),
        // A socket move with no bag named.
        L({ id: 2, op: 'unsocket_bag', count: 1 }),
        // A socket move carrying copper.
        L({ id: 3, op: 'socket_bag', item_id: 'bag_a', count: 1, copper_delta: -5 }),
        // An unlock carrying item fields / a count / non-negative copper.
        L({ id: 4, op: 'unlock_socket', item_id: 'bag_a', copper_delta: -1000000 }),
        L({ id: 5, op: 'unlock_socket', count: 1, copper_delta: -2000000 }),
        L({ id: 6, op: 'unlock_socket', copper_delta: 0 }),
        // A socket row carrying an instance payload: sockets store bare ids
        // (the sim's #2837 peek refuses a payload-bearing bag), so this is a
        // mint signature the count reconcile would otherwise absorb.
        L({
          id: 7,
          op: 'socket_bag',
          item_id: 'bag_a',
          count: 1,
          instance: { signer: 'Minty' },
        }),
      ],
      characters: [],
    });
    // Each kind BOUND to the row designed to produce it (a bare
    // kinds.toContain would let a cross-trip on a neighbouring row keep a
    // deleted check green): the detail string names the row id.
    const detailOf = (kind: string) =>
      findings
        .filter((f) => f.kind === kind)
        .map((f) => f.detail)
        .join('\n');
    expect(detailOf('bad_count')).toContain('row 1');
    expect(detailOf('missing_item_id')).toContain('row 2');
    expect(detailOf('copper_on_item_op')).toContain('row 3');
    expect(detailOf('item_on_gold_op')).toContain('row 4');
    expect(detailOf('count_on_buy')).toContain('row 5');
    expect(detailOf('nonnegative_buy_cost')).toContain('row 6');
    expect(detailOf('unexpected_instance')).toContain('row 7');
    // No socket row falls off the vocabulary chain.
    expect(findings.map((f) => f.kind)).not.toContain('unknown_op');
  });

  it('flags a socket op on any container but personal', () => {
    const findings = auditBank({
      ledgerRows: [
        V({ id: 1, op: 'socket_bag', item_id: 'bag_a', count: 1 }),
        G({ id: 2, op: 'unlock_socket', copper_delta: -1000000, purchased_slots_after: 24 }),
      ],
      characters: [],
      guildBanks: [],
    });
    const outside = findings.filter((f) => f.kind === 'socket_op_outside_personal');
    expect(outside.map((f) => f.detail)).toEqual([
      expect.stringContaining("socket_bag row 1 has container 'vault'"),
      expect.stringContaining("unlock_socket row 2 has container 'guild'"),
    ]);
  });

  it('socket rows participate in the rung monotonicity scan as bystanders', () => {
    // Every socket row stamps purchased_slots_after with the live SLOT ladder
    // position (recordBankSocketOp's bystander rule); a writer stamping
    // something else (a socket count) reads as a ladder regression here.
    const findings = auditBank({
      ledgerRows: [
        L({ id: 1, op: 'buy_slots', copper_delta: -500, purchased_slots_after: 6 }),
        L({ id: 2, op: 'unlock_socket', copper_delta: -1000000, purchased_slots_after: 1 }),
      ],
      characters: [
        {
          id: 1,
          realm: 'Claudemoon',
          state: { bank: { inventory: [], purchasedSlots: 6, unlockedSockets: 1 } },
        },
      ],
    });
    expect(findingKindsFor(findings, 1)).toContain('purchased_regression');
  });
});

// Bank Storage phase 14: the operator surface for storage_purchases. Before it
// there was no admin route, no metric, and nothing in this tool read `status`;
// the only signal that a player had been charged and held no slots was a
// console warn on a server nobody was tailing.
describe('the storage purchase operator arm', () => {
  const HOUR = 3_600_000;
  const NOW = Date.parse('2026-08-22T12:00:00Z');
  const agoIso = (hours: number): string => new Date(NOW - hours * HOUR).toISOString();

  /** One storage_purchases row as pg returns it; pass only what a case cares
   *  about. */
  const P = (o: Partial<StoragePurchaseAuditRow>): StoragePurchaseAuditRow => ({
    id: 1,
    realm: 'Claudemoon',
    account_id: 7,
    character_id: 42,
    item_id: 'strongbox_rung_01',
    expected_cost_claudium: 100,
    idempotency_key: 'key-1',
    status: 'pending',
    created_at: agoIso(1),
    resolved_at: null,
    ...o,
  });

  it('reports an unresolved row: the player was charged and holds no slots', () => {
    const findings = auditStoragePurchases({
      rows: [P({ status: 'unresolved', resolved_at: agoIso(5), idempotency_key: 'stuck-1' })],
      nowMs: NOW,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('storage_purchase_unresolved');
    // The operator needs to identify the purchase and the player from the line
    // alone, so each of those is asserted rather than the sentence as a whole.
    expect(findings[0].characterId).toBe(42);
    expect(findings[0].accountId).toBe(7);
    expect(findings[0].key).toBe('stuck-1');
    expect(findings[0].detail).toContain('stuck-1');
    expect(findings[0].detail).toContain('strongbox_rung_01');
    expect(findings[0].detail).toContain('100 Claudium');
    expect(findings[0].detail).toContain('5h');
    // The remediation has to name phase 14's OWN expected cause: after the
    // ambiguity yield, the usual way a row lands here is that the player bought
    // that rung with gold while the purchase was open, and granting by hand in
    // that case over-grants the ladder.
    expect(findings[0].detail).toContain('bank_ledger');
  });

  it('a pending row is an incident only once it is old enough to be one', () => {
    // The threshold's BOTH sides, because a report that flagged every in-flight
    // purchase would be noise an operator learns to ignore.
    const fresh = auditStoragePurchases({
      rows: [P({ created_at: agoIso(STORAGE_PURCHASE_STRANDED_HOURS - 1) })],
      nowMs: NOW,
    });
    expect(fresh).toEqual([]);
    const stranded = auditStoragePurchases({
      rows: [P({ created_at: agoIso(STORAGE_PURCHASE_STRANDED_HOURS), idempotency_key: 'old-1' })],
      nowMs: NOW,
    });
    expect(stranded).toHaveLength(1);
    expect(stranded[0].kind).toBe('storage_purchase_stranded');
    expect(stranded[0].key).toBe('old-1');
    // It says what the benign explanation is, so nobody treats a returning
    // player's row as a money incident.
    expect(stranded[0].detail).toContain('has not come back');
  });

  // THE LITERAL ANCHOR. Both arms above express the boundary THROUGH
  // STORAGE_PURCHASE_STRANDED_HOURS, so they follow the constant wherever it
  // goes: dropping it to an hour moves the fixtures with it and both stay
  // green. What that would actually do is turn every ordinary offline player
  // into a reported incident, which is the failure mode that makes an operator
  // stop reading the report at all. This arm fixes the age in the FIXTURE
  // instead, so the threshold cannot be tightened without a decision.
  // The CLI's own query is not reachable from these unit arms (it needs a live
  // pool), so its ORDER BY is pinned as anchored SOURCE text. A source pin is
  // weaker than an executed one and is used here only because the alternative
  // is no pin at all: what it protects is the property that a truncated report
  // can never hide a charged player. The clause is anchored contiguously with
  // its own LIMIT so the pin cannot drift onto some other statement.
  it('reads UNRESOLVED storage rows before PENDING ones, so truncation cannot hide a debit', () => {
    const src = readFileSync(new URL('../scripts/bank_audit.mjs', import.meta.url), 'utf8');
    const clause =
      "WHERE status <> 'applied'\n          ORDER BY (status = 'unresolved') DESC, id\n          LIMIT $1";
    expect(src.split(clause).length - 1).toBe(1);
    // The plain id ordering it replaced is gone, so a revert fails here rather
    // than silently changing which rows an operator gets to see.
    expect(src).not.toContain('ORDER BY id\n          LIMIT $1');
  });

  it("reports whole-table totals over a truncated read, not the slice's own tally", () => {
    // The incident that truncates this report is a mass-pending event, which is
    // exactly when an operator needs the real numbers. Counting the SLICE would
    // answer "unresolved 2" when the table holds 40, and the count would look
    // like a measurement rather than an artefact of the limit.
    const rows = [P({ status: 'unresolved', resolved_at: agoIso(5) })];
    const totals = [
      { status: 'pending', n: 900 },
      { status: 'unresolved', n: 40 },
    ];
    const withTotals = formatStoragePurchaseReport(rows, [], true, totals);
    expect(withTotals).toContain('pending 900');
    expect(withTotals).toContain('unresolved 40');
    expect(withTotals).toContain('of 940');
    // The truncation notice has to say WHICH rows were dropped, because the
    // read is ordered so the money-losing ones never are.
    expect(withTotals).toContain('UNRESOLVED rows are read first');
    // Without totals it still works, describing only what it read.
    const sliceOnly = formatStoragePurchaseReport(rows, [], false);
    expect(sliceOnly).toContain('unresolved 1');
  });

  it('does not turn an ordinary offline character into an incident', () => {
    expect(STORAGE_PURCHASE_STRANDED_HOURS).toBe(24);
    // Long enough that a login-recovery cycle and an ambiguity backoff both
    // fit inside it; short enough to still surface a genuinely stuck row the
    // same day.
    expect(STORAGE_PURCHASE_STRANDED_HOURS).toBeGreaterThanOrEqual(12);
    expect(STORAGE_PURCHASE_STRANDED_HOURS).toBeLessThanOrEqual(72);
    // A player who bought a rung and logged out six hours ago is ordinary
    // in-flight work, whatever the constant is retuned to inside that band.
    expect(auditStoragePurchases({ rows: [P({ created_at: agoIso(6) })], nowMs: NOW })).toEqual([]);
  });

  it('never reports the terminal happy path, and always reports an unknown status', () => {
    expect(
      auditStoragePurchases({
        rows: [P({ status: 'applied', resolved_at: agoIso(900) })],
        nowMs: NOW,
      }),
    ).toEqual([]);
    // The database CHECK rejects these values now. The audit still reports one
    // if a stale schema, disabled constraint, or corrupt restore exposes it.
    for (const status of ['refused', 'settled']) {
      const odd = auditStoragePurchases({ rows: [P({ status })], nowMs: NOW });
      expect(odd).toHaveLength(1);
      expect(odd[0].kind).toBe('storage_purchase_bad_status');
      expect(odd[0].detail).toContain(JSON.stringify(status));
    }
  });

  it('reads a Date as readily as a string, and never invents an age it cannot read', () => {
    const asDate = auditStoragePurchases({
      rows: [P({ created_at: new Date(NOW - 48 * HOUR) })],
      nowMs: NOW,
    });
    expect(asDate).toHaveLength(1);
    expect(asDate[0].detail).toContain('48h');
    // An unreadable timestamp must still SURFACE the row (a stranded purchase
    // with a corrupt created_at is not less of an incident) and must not print
    // a made-up number.
    const broken = auditStoragePurchases({ rows: [P({ created_at: null })], nowMs: NOW });
    expect(broken).toHaveLength(1);
    expect(broken[0].kind).toBe('storage_purchase_stranded');
    expect(broken[0].detail).toContain('an unreadable age');
    expect(broken[0].detail).not.toMatch(/\bNaNh?\b/);
  });

  it('the report says what it READ, so a clean section is not mistaken for an unqueried one', () => {
    const rows = [P({ status: 'pending' }), P({ status: 'pending' }), P({ status: 'unresolved' })];
    const clean = formatStoragePurchaseReport([], []);
    expect(clean).toContain('open rows read 0');
    expect(clean).toContain('OK: no unresolved or stranded storage purchases.');
    const noisy = formatStoragePurchaseReport(
      rows,
      auditStoragePurchases({ rows: [rows[2]], nowMs: NOW }),
    );
    expect(noisy).toContain('open rows read 3');
    expect(noisy).toContain('pending 2');
    expect(noisy).toContain('unresolved 1');
    expect(noisy).toContain('findings 1');
    expect(noisy).toContain('FINDING: storage purchase: realm Claudemoon: character 42:');
    expect(noisy).not.toContain('OK: no unresolved');
  });

  it('says so when it truncates, rather than printing a tidy prefix', () => {
    // A truncated report that LOOKS complete is worse than none: the incident
    // that makes this report interesting is the one that could make it huge.
    const clean = formatStoragePurchaseReport([P({})], [], false);
    expect(clean).not.toContain('TRUNCATED');
    const cut = formatStoragePurchaseReport([P({})], [], true);
    expect(cut).toContain('TRUNCATED');
    expect(cut).toContain(String(STORAGE_PURCHASE_REPORT_LIMIT));
    expect(cut).toContain('NOT listed');
    // The warning leads, so it cannot be lost under a long finding list.
    expect(cut.split('\n')[0]).toContain('TRUNCATED');
  });

  it('main() reads one row past the limit so it can TELL that it truncated', () => {
    // Off-by-one that matters: asking for exactly the limit makes a full page
    // indistinguishable from a truncated one, so the report would go quiet at
    // precisely the wrong moment.
    const src = codeOnly(
      readFileSync(new URL('../scripts/bank_audit.mjs', import.meta.url), 'utf8'),
    );
    expect(src).toContain('STORAGE_PURCHASE_REPORT_LIMIT + 1');
    expect(src).toContain('purchases.rows.length > STORAGE_PURCHASE_REPORT_LIMIT');
    expect(src).toContain('LIMIT $1');
  });

  it('pins the .mjs status vocabulary to StoragePurchaseStatus', () => {
    // Same redeclaration hazard as KNOWN_OPS: the .mjs never imports the TS
    // server, so a status added there with no audit arm would be reported as
    // bad_status in production instead of being understood.
    const src = codeOnly(
      readFileSync(new URL('../server/storage_purchase_db.ts', import.meta.url), 'utf8'),
    );
    const start = src.indexOf('export type StoragePurchaseStatus');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf(';', start);
    expect(end).toBeGreaterThan(start);
    const members = Array.from(src.slice(start, end).matchAll(/'([a-z_]+)'/g), (m) => m[1]);
    expect(members.sort()).toEqual(Array.from(STORAGE_PURCHASE_STATUSES).sort());
  });

  it('main() degrades on a database with no storage_purchases, and reads only OPEN rows', () => {
    // Both are source pins because main() talks to Postgres; the executed twin
    // lives in the database-gated suite. Comment-stripped, so commenting the
    // guard out cannot leave the pin green over dead code.
    const src = codeOnly(
      readFileSync(new URL('../scripts/bank_audit.mjs', import.meta.url), 'utf8'),
    );
    expect(src).toContain("SELECT to_regclass('storage_purchases') IS NOT NULL AS present");
    expect(src).toContain("WHERE status <> 'applied'");
    expect(src).not.toContain("status <> 'refused'");
    // The exit code has to count BOTH sets, or an unresolved purchase would
    // print and still exit 0 on an otherwise clean ledger.
    expect(src).toContain('findings.length + storageFindings.length > 0 ? 1 : 0');
  });
});
