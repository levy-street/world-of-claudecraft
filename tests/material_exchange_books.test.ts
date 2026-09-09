import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const gathered = { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' } };
const stock = (): InvSlot => ({
  itemId: 'copper_ore',
  count: 5,
  materialSources: [
    { source: {}, count: 2 },
    { source: gathered, count: 3 },
  ],
});
const setup = () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
  const meta = sim.players.get(sim.playerId)!;
  meta.inventory.splice(0, meta.inventory.length, stock());
  meta.copper = 1000;
  return sim;
};
describe('material custody through the exchange books', () => {
  it('keeps bulk listing sources through save, reload and cancellation', () => {
    const sim = setup();
    const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant')!;
    sim.entities.get(sim.playerId)!.pos = { ...merchant.pos };
    sim.marketList('copper_ore', 5, 50);
    const listing = sim.marketListings.find((l) => !l.house)!;
    expect(listing.materialSources).toEqual(stock().materialSources);
    expect(sim.inventory).toEqual([]);
    const saved = sim.serializeMarket();
    const other = setup();
    other.inventory.splice(0);
    other.entities.get(other.playerId)!.pos = { ...merchant.pos };
    other.loadMarket(saved);
    const restored = other.marketListings.find((l) => !l.house)!;
    expect(restored.materialSources).toEqual(stock().materialSources);
    other.marketCancel(restored.id);
    expect(other.inventory).toEqual([stock()]);
  });
  it('keeps a premium material unit when the canonical escrow payload is empty', () => {
    const sim = setup();
    const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant')!;
    sim.entities.get(sim.playerId)!.pos = { ...merchant.pos };
    sim.addItemInstance('copper_ore', { signer: 'Ana' }, undefined, 1);
    sim.marketListInstance('copper_ore', 50, { signer: 'Ana' });
    const listing = sim.marketListings.find((l) => !l.house)!;
    expect(listing).toBeDefined();
    expect(listing.materialSources).toEqual([{ source: { signer: 'Ana' }, count: 1 }]);
    sim.marketCancel(listing.id);
    expect(sim.countItem('copper_ore')).toBe(6);
  });
  it('keeps gathered units through a plain mail request and a reload', () => {
    const sim = setup();
    const box = sim.entities.get(sim.postOffice.mailboxIds[0])!;
    sim.entities.get(sim.playerId)!.pos = { ...box.pos };
    sim.postOffice.mailSendResolved({ key: '22', name: 'Bru' }, 'Materials', '', 0, [
      { itemId: 'copper_ore', count: 5 },
    ]);
    const letter = sim.postOffice.mail.find((m) => m.recipientKey === '22')!;
    expect(letter.items).toEqual([stock()]);
    const saved = sim.serializeMail();
    const other = setup();
    other.loadMail(saved);
    expect(other.postOffice.mail.find((m) => m.recipientKey === '22')!.items).toEqual([stock()]);
  });
});
