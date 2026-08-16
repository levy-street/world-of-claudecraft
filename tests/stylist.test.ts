// The Stylist's counter (src/sim/stylist.ts): buying a character-redesign
// credit. Driven through the Sim facade (buyRedesignCreditFor), the same surface
// the server dispatch and the online client use, so what these tests exercise is
// the real authoritative path rather than the module in isolation.
//
// stylist_verena is real content; this file drives it as-is.

import { describe, expect, it } from 'vitest';
import { redesignPriceCopper } from '../src/sim/content/redesign_pricing';
import { STYLIST_NPC_ID } from '../src/sim/content/stylist';
import { BUILTIN_WORLD, NPCS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { MAX_REDESIGN_CREDITS, redesignCreditsOf } from '../src/sim/stylist';
import type { WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// Only the Stylist is looked up here: no camps, no ground objects, no other NPCs.
const STYLIST_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: { [STYLIST_NPC_ID]: NPCS[STYLIST_NPC_ID] },
  groundObjects: [],
};

const makeSim = (seed = 1) =>
  new Sim({ seed, playerClass: 'warrior', autoEquip: true, world: STYLIST_TEST_WORLD });

function stylistOf(sim: Sim) {
  const npc = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === STYLIST_NPC_ID,
  );
  expect(npc, 'stylist_verena must be a live NPC entity').toBeDefined();
  return npc!;
}

function teleport(sim: Sim, x: number, z: number): void {
  sim.player.pos.x = x;
  sim.player.pos.z = z;
  sim.player.pos.y = terrainHeight(x, z, sim.cfg.seed);
  sim.player.prevPos = { ...sim.player.pos };
}

function standAtStylist(sim: Sim): void {
  const npc = stylistOf(sim);
  teleport(sim, npc.pos.x, npc.pos.z);
}

function metaOf(sim: Sim) {
  return sim.players.get(sim.playerId)!;
}

/** Stand at the counter with enough copper to buy `count` credits at this level. */
function readyBuyer(sim: Sim, count = 1) {
  standAtStylist(sim);
  const meta = metaOf(sim);
  meta.copper = redesignPriceCopper(sim.player.level) * count;
  return meta;
}

function buy(sim: Sim) {
  sim.buyRedesignCreditFor(stylistOf(sim).id, sim.playerId);
  return sim.tick();
}

describe('Stylist redesign credit purchase', () => {
  it('charges the band price and grants exactly one credit', () => {
    const sim = makeSim();
    const meta = readyBuyer(sim);
    const price = redesignPriceCopper(sim.player.level);
    const events = buy(sim);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(meta.copper).toBe(0);
    expect(redesignCreditsOf(meta)).toBe(1);
    // The charge is exactly the band price, not a rounded or doubled one.
    expect(price - meta.copper).toBe(price);
  });

  it('stacks: credits are an integer, so buying twice holds two', () => {
    const sim = makeSim();
    const meta = readyBuyer(sim, 2);
    buy(sim);
    buy(sim);
    expect(redesignCreditsOf(meta)).toBe(2);
    expect(meta.copper).toBe(0);
  });

  it('refuses on insufficient funds without charging or crediting', () => {
    const sim = makeSim();
    standAtStylist(sim);
    const meta = metaOf(sim);
    meta.copper = redesignPriceCopper(sim.player.level) - 1;
    const before = meta.copper;
    const events = buy(sim);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    // Neither half of the transaction happened: the standard vendor refusal.
    expect(meta.copper).toBe(before);
    expect(redesignCreditsOf(meta)).toBe(0);
  });

  it('refuses out of range, so a client cannot buy from across the zone', () => {
    const sim = makeSim();
    const meta = readyBuyer(sim);
    const before = meta.copper;
    const npc = stylistOf(sim);
    teleport(sim, npc.pos.x + 40, npc.pos.z);
    const events = buy(sim);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(meta.copper).toBe(before);
    expect(redesignCreditsOf(meta)).toBe(0);
  });

  it('refuses while dead, matching the rest of the vendor family', () => {
    const sim = makeSim();
    const meta = readyBuyer(sim);
    const before = meta.copper;
    sim.player.dead = true;
    const events = buy(sim);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(meta.copper).toBe(before);
    expect(redesignCreditsOf(meta)).toBe(0);
  });

  it('refuses a non-Stylist npc id: the client never names the counter', () => {
    const sim = makeSim();
    const meta = readyBuyer(sim);
    const before = meta.copper;
    // The player's own entity id is a live entity that is not the Stylist.
    sim.buyRedesignCreditFor(sim.playerId, sim.playerId);
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(meta.copper).toBe(before);
    expect(redesignCreditsOf(meta)).toBe(0);
  });

  it('refuses past the credit cap instead of inflating the stored integer', () => {
    const sim = makeSim();
    const meta = readyBuyer(sim);
    meta.redesignCredits = MAX_REDESIGN_CREDITS;
    const before = meta.copper;
    const events = buy(sim);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(meta.copper).toBe(before);
    expect(redesignCreditsOf(meta)).toBe(MAX_REDESIGN_CREDITS);
  });

  it('prices off the buyer level at purchase time, and a held credit never reprices', () => {
    const sim = makeSim();
    standAtStylist(sim);
    const meta = metaOf(sim);
    // Buy cheap at level 1...
    const lowPrice = redesignPriceCopper(sim.player.level);
    meta.copper = lowPrice;
    buy(sim);
    expect(redesignCreditsOf(meta)).toBe(1);
    // ...then out-level the band. The credit already bought is untouched: it is
    // worth one redesign regardless of what the counter now charges.
    sim.setPlayerLevel(20);
    expect(redesignPriceCopper(sim.player.level)).toBeGreaterThan(lowPrice);
    expect(redesignCreditsOf(meta)).toBe(1);
  });

  it('round-trips through the save blob, and absent means zero', () => {
    const sim = makeSim();
    readyBuyer(sim);
    buy(sim);
    const saved = sim.serializeCharacter(sim.playerId)!;
    expect(saved.redesignCredits).toBe(1);

    // A real value survives the round trip onto a freshly joined character.
    const restored = makeSim();
    const restoredPid = restored.addPlayer('warrior', 'Restored', { state: saved });
    expect(redesignCreditsOf(restored.players.get(restoredPid)!)).toBe(1);

    // A pre-feature blob carries no key at all: it must load as zero, not throw
    // and not undefined-compare its way into a free redesign.
    const { redesignCredits: _omitted, ...withoutCredits } = saved;
    const fresh = makeSim();
    const freshPid = fresh.addPlayer('warrior', 'Fresh', { state: withoutCredits });
    expect(redesignCreditsOf(fresh.players.get(freshPid)!)).toBe(0);
  });

  it('omits the key entirely while zero, so a pre-feature save stays byte-equal', () => {
    const sim = makeSim();
    expect('redesignCredits' in sim.serializeCharacter(sim.playerId)!).toBe(false);
  });

  it('clamps a hostile persisted value rather than trusting stored JSON', () => {
    const sim = makeSim();
    const saved = sim.serializeCharacter(sim.playerId)!;
    // Untrusted persisted JSON: a negative, fractional, or non-finite count must
    // never reach the credit compare as-is.
    for (const hostile of [-5, Number.NaN]) {
      const loaded = makeSim();
      const pid = loaded.addPlayer('warrior', 'Hostile', {
        state: { ...saved, redesignCredits: hostile },
      });
      const credits = redesignCreditsOf(loaded.players.get(pid)!);
      expect(Number.isInteger(credits)).toBe(true);
      expect(credits).toBe(0);
    }
    // A fractional value floors rather than being discarded.
    const loaded = makeSim();
    const pid = loaded.addPlayer('warrior', 'Fractional', {
      state: { ...saved, redesignCredits: 3.7 },
    });
    expect(redesignCreditsOf(loaded.players.get(pid)!)).toBe(3);
  });
});
