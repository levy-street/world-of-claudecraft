// The farmer NPCs' counters, PURCHASED (the farming go-live): for each of the
// four farmers and each row on their stock, a funded character standing at
// the NPC buys one through the real purchase path (Sim.buyItem, the same call
// the vendor window makes) and walks away with one more of the item and
// exactly buyValue less copper. This is the dead-row trap made executable
// (D11): a row without a positive buyValue RENDERS in the vendor grid and
// REFUSES at purchase ('That item is not for sale.'), and no content pin on
// vendorItems can see that; only a purchase can. brook_carrot (the D9 fee
// vegetable) and compost (the husk trade's other half) are among the rows
// probed by construction, since the walk covers every row on every counter.

import { describe, expect, it } from 'vitest';
import { ITEMS, NPCS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, NpcDef, SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const FARMER_IDS = ['farmer_jessica', 'farmer_teasel', 'farmer_hollis', 'farmer_verbena'] as const;
const FUNDS = 100_000;
const FAR = 20;

function farmerEntity(sim: Sim, templateId: string): Entity {
  const entity = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === templateId,
  );
  if (!entity) throw new Error(`farmer ${templateId} did not spawn`);
  return entity;
}

function standAt(sim: Sim, pid: number, x: number, z: number): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error('missing player');
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function errorsSince(sim: Sim, from: number): string[] {
  return sim.events
    .slice(from)
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

describe('the farmer counters, purchased row by row', () => {
  it('the walk covers the four farmers and every one has stock (non-vacuity)', () => {
    for (const id of FARMER_IDS) {
      const def: NpcDef | undefined = NPCS[id];
      expect(def, id).toBeDefined();
      expect(def.farmer, id).toBe(true);
      expect(def.vendorItems?.length ?? 0, `${id} has rows`).toBeGreaterThan(0);
    }
    // The two rows the go-live doctrine names explicitly are really on the
    // walk: the D9 fee vegetable and the husk trade's compost.
    expect(NPCS.farmer_jessica.vendorItems).toContain('brook_carrot');
    for (const id of FARMER_IDS) expect(NPCS[id].vendorItems, id).toContain('compost');
    // The walk's WIDTH as literals: the per-row cases below are generated
    // from the live stock, so a dropped row would delete its own case; the
    // exact-stock table lives in tests/professions_zone_rollout.test.ts,
    // this pin keeps the purchase walk honest on its own (Phase 9 QA).
    const rowCounts: Record<string, number> = {
      farmer_jessica: 5,
      farmer_teasel: 3,
      farmer_hollis: 1,
      farmer_verbena: 1,
    };
    for (const id of FARMER_IDS) {
      expect(NPCS[id].vendorItems?.length, `${id} row count`).toBe(rowCounts[id]);
    }
  });

  for (const farmerId of FARMER_IDS) {
    for (const itemId of NPCS[farmerId].vendorItems ?? []) {
      it(`${farmerId} sells ${itemId}: one more in the bags, exactly buyValue less copper`, () => {
        const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
        const pid = sim.addPlayer('warrior', 'Buyer');
        const meta = sim.players.get(pid);
        if (!meta) throw new Error('missing meta');
        meta.copper = FUNDS;
        const npc = farmerEntity(sim, farmerId);
        standAt(sim, pid, npc.pos.x + 1, npc.pos.z);
        const price = ITEMS[itemId]?.buyValue ?? 0;
        expect(price, `${itemId} needs a positive buyValue`).toBeGreaterThan(0);
        const before = sim.countItem(itemId, pid);
        const from = sim.events.length;
        sim.buyItem(npc.id, itemId, undefined, pid);
        expect(errorsSince(sim, from), `${farmerId}/${itemId} refused`).toEqual([]);
        expect(sim.countItem(itemId, pid)).toBe(before + 1);
        expect(meta.copper).toBe(FUNDS - price);
        // And the purchase announced itself the way every vendor buy does.
        expect(
          sim.events
            .slice(from)
            .some((e) => e.type === 'vendor' && e.action === 'buy' && e.itemId === itemId),
        ).toBe(true);
      });
    }
  }

  it('20 yd from the farmer the same funded buyer is refused: Too far away, nothing bought', () => {
    // The negative arm on the FIRST row of every farmer (the reach is the
    // NPC's, not the row's), so the positive arms above are proven to depend
    // on standing at the counter rather than passing by accident.
    for (const farmerId of FARMER_IDS) {
      const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
      const pid = sim.addPlayer('warrior', 'Buyer');
      const meta = sim.players.get(pid);
      if (!meta) throw new Error('missing meta');
      meta.copper = FUNDS;
      const npc = farmerEntity(sim, farmerId);
      const itemId = (NPCS[farmerId].vendorItems ?? [])[0];
      standAt(sim, pid, npc.pos.x + FAR, npc.pos.z);
      const from = sim.events.length;
      sim.buyItem(npc.id, itemId, undefined, pid);
      expect(errorsSince(sim, from), farmerId).toEqual(['Too far away.']);
      expect(sim.countItem(itemId, pid), farmerId).toBe(0);
      expect(meta.copper, farmerId).toBe(FUNDS);
    }
  });

  it('a row that is not on the counter is refused: the farmers do not sell each other stock', () => {
    // Hollis stocks compost alone: asking him for a tier-1 seed (Jessica's
    // row) is 'not sold here', so the positive arms above are per counter.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Buyer');
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing meta');
    meta.copper = FUNDS;
    const hollis = farmerEntity(sim, 'farmer_hollis');
    standAt(sim, pid, hollis.pos.x + 1, hollis.pos.z);
    const from = sim.events.length;
    sim.buyItem(hollis.id, 'vale_wheat_seed', undefined, pid);
    expect(errorsSince(sim, from)).toEqual(['That item is not sold here.']);
    expect(sim.countItem('vale_wheat_seed', pid)).toBe(0);
    expect(meta.copper).toBe(FUNDS);
  });
});
