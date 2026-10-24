import { describe, expect, it } from 'vitest';
import { auditBank, type BankLedgerAuditRow } from '../scripts/bank_audit.mjs';
import { personalBankSourceProjection } from '../server/personal_bank_source_projection';
import type { InvSlot } from '../src/sim/types';

const mixed: InvSlot = {
  itemId: 'minor_healing_potion',
  count: 5,
  materialSources: [
    { source: { signer: 'Ana' }, count: 2 },
    { source: { signer: 'Bru' }, count: 3 },
  ],
};

function ledger(id: number, signer: string, count: number): BankLedgerAuditRow {
  return {
    id,
    realm: 'Claudemoon',
    character_id: 1,
    op: 'deposit',
    item_id: 'minor_healing_potion',
    count,
    instance: { signer },
    copper_delta: 0,
    purchased_slots_after: 0,
    container: 'personal',
    container_id: null,
  };
}
function audit(slot: InvSlot) {
  return auditBank({
    ledgerRows: [ledger(1, 'Ana', 2), ledger(2, 'Bru', 3)],
    characters: [
      { id: 1, realm: 'Claudemoon', state: { bank: { inventory: [slot], purchasedSlots: 0 } } },
    ],
    guildBanks: [],
    projectPersonalSlot: personalBankSourceProjection,
  });
}

describe('personalBankSourceProjection', () => {
  it('reconciles historical signed deposits against canonical mixed saved state', () => {
    expect(audit(mixed)).toEqual([]);
    expect(
      audit({
        ...mixed,
        materialSources: [
          { source: { signer: 'Ana' }, count: 3 },
          { source: { signer: 'Bru' }, count: 2 },
        ],
      }),
    ).not.toEqual([]);
  });

  it('projects source counts without expanding units and retains unknown payload fields', () => {
    const payload = { future: { values: ['retained'] }, boundTo: 7 };
    const slot = {
      ...mixed,
      count: 1000000,
      instance: payload,
      materialSources: [{ source: { signer: 'Ana' }, count: 1000000 }],
    };
    const result = personalBankSourceProjection(slot);
    expect(result).toEqual([
      { itemId: 'minor_healing_potion', count: 1000000, instance: { ...payload, signer: 'Ana' } },
    ]);
    expect(result[0].instance).not.toBe(payload);
    expect(
      personalBankSourceProjection({
        itemId: slot.itemId,
        count: slot.count,
        instance: { ...payload, signer: 'Ana' },
      }),
    ).toEqual(result);
  });

  it('leaves actual material and nonconsumable audit identities intact', () => {
    for (const slot of [
      { itemId: 'iron_ore', count: 2, instance: { signer: 'Ana' } },
      { itemId: 'worn_sword', count: 1, instance: { signer: 'Ana' } },
    ]) {
      expect(personalBankSourceProjection(slot)).toEqual([slot]);
    }
  });
});
