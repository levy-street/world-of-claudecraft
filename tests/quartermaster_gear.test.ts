import { describe, expect, it } from 'vitest';
import { ITEMS, MOBS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

// The Quartermaster's Consignment has 10 uncommon gear pieces. Eight are stocked
// by The Merchant on the World Market; two drop from Vale threats.
const VENDOR = [
  'roadwardens_helm',
  'wayfarers_hood',
  'acolytes_circlet',
  'reinforced_pauldrons',
  'embroidered_mantle',
  'sturdy_belt',
  'silk_sash',
  'roughspun_gloves',
] as const;

const DROPS: Record<string, string> = {
  gorraks_cleaver: 'gorrak',
  mossy_handwraps: 'tunnel_rat',
};

const ALL = [...VENDOR, ...Object.keys(DROPS)];

describe("Quartermaster's Consignment gear pack", () => {
  it('defines all 10 items as equippable uncommon gear', () => {
    expect(ALL.length).toBe(10);
    for (const id of ALL) {
      const def = ITEMS[id];
      expect(def, id).toBeTruthy();
      expect(def.quality, id).toBe('uncommon');
      // every piece is equippable: armor/weapon with a slot
      expect(['weapon', 'armor'], id).toContain(def.kind);
      expect(def.slot, id).toBeTruthy();
      if (def.kind === 'armor') expect(def.stats, id).toBeTruthy();
      if (def.kind === 'weapon') expect(def.weapon, id).toBeTruthy();
    }
  });

  it("stocks the eight consignment pieces on the Merchant's standing market", () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const house = sim.marketListings.filter((l) => l.house);
    for (const id of VENDOR) {
      expect(
        house.some((l) => l.itemId === id),
        `${id} on market`,
      ).toBe(true);
    }
  });

  it('attaches the two looted pieces to the right mobs', () => {
    for (const [item, mobId] of Object.entries(DROPS)) {
      const mob = MOBS[mobId];
      expect(mob, mobId).toBeTruthy();
      expect(
        mob.loot.some((l) => l.itemId === item),
        `${item} drops from ${mobId}`,
      ).toBe(true);
    }
  });

  it('localizes every new item name in a non-English locale', async () => {
    // Lazy locale flip: await the de_DE chunk so tEntity's synchronous read resolves the
    // German item names instead of the English fallback.
    await ensureLocaleLoaded('de_DE');
    setLanguage('de_DE');
    try {
      for (const id of ALL) {
        const de = tEntity({ kind: 'item', id, field: 'name' });
        expect(de.trim().length, id).toBeGreaterThan(0);
        expect(de, id).not.toBe(ITEMS[id].name); // a real German translation, not English
      }
    } finally {
      setLanguage('en');
    }
  });
});
