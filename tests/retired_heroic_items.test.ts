// v0.25.0 replaced the standalone heroic Nythraxis drops with the heroic loot
// swap and deleted their four ItemDefs outright. Players who earned them during
// the v0.24.x window still carry the ids in persisted equipment, bags, bank,
// mail, and market listings; with no def the paperdoll slot rendered as Empty
// and the item granted zero stats (the live "Nightfang Harness is missing"
// incident, 2026-07-14). The ids must stay defined forever so those saves
// resolve, but they are retired: never on a loot source, never variant-cloned.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DELVE_SHOPS } from '../src/sim/content/delves/shop';
import { HEROIC_BOSS_LOOT, RETIRED_HEROIC_ITEMS } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { FURY_STOCK } from '../src/sim/content/pvp_honor';
import { ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import type { MailSave } from '../src/sim/mail/post_office';
import type { MarketSave } from '../src/sim/market';
import { type CharacterState, Sim } from '../src/sim/sim';
import type { ItemDef } from '../src/sim/types';
import { buildPaperdollView } from '../src/ui/char_view';

const RETIRED_IDS = [
  'deathless_warguard_legmail',
  'scourgehide_carapace',
  'soulforged_warplate',
  'soulrend_diadem',
] as const;

type RetiredId = (typeof RETIRED_IDS)[number];

const EXPECTED_RETIRED_ITEMS: Record<RetiredId, ItemDef> = {
  deathless_warguard_legmail: {
    id: 'deathless_warguard_legmail',
    name: 'Deathless Warguard Legmail',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 315, str: 11, sta: 9 },
    sellValue: 13_000,
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  scourgehide_carapace: {
    id: 'scourgehide_carapace',
    name: 'Scourgehide Carapace',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 172, agi: 12, sta: 10 },
    sellValue: 14_000,
    requiredClass: ['rogue', 'hunter', 'druid'],
  },
  soulforged_warplate: {
    id: 'soulforged_warplate',
    name: 'Soulforged Warplate',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 335, int: 12, spi: 10 },
    sellValue: 14_000,
    requiredClass: ['paladin', 'shaman'],
  },
  soulrend_diadem: {
    id: 'soulrend_diadem',
    name: 'Soulrend Diadem',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'epic',
    requiredLevel: 20,
    stats: { armor: 76, int: 10, spi: 8 },
    sellValue: 12_000,
    requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
};

const simRoot = fileURLToPath(new URL('../src/sim', import.meta.url));
const retiredDefsFile = join(simRoot, 'content', 'heroic_loot.ts');

function walkTypeScript(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkTypeScript(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

function legacyRogueState(equipment: CharacterState['equipment']): CharacterState {
  return {
    level: 20,
    xp: 0,
    copper: 123,
    hp: 1,
    resource: 0,
    pos: { x: 0, z: 0 },
    facing: 0,
    equipment,
    inventory: [{ itemId: 'scourgehide_carapace', count: 2 }],
    bags: [null, null, null, null],
    bank: {
      inventory: [{ itemId: 'scourgehide_carapace', count: 3 }],
      purchasedSlots: 0,
      bonusSlots: 0,
    },
    questLog: [],
    questsDone: [],
  };
}

function loadLegacyRogue(equipment: CharacterState['equipment']) {
  const sim = new Sim({ seed: 42, playerClass: 'rogue', noPlayer: true });
  const pid = sim.addPlayer('rogue', 'Legacy', { state: legacyRogueState(equipment) });
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error('legacy player entity was not created');
  return { sim, pid, entity };
}

describe('retired heroic items: the four ids v0.25.0 orphaned resolve again', () => {
  it('retires exactly the four orphaned ids, each merged into ITEMS', () => {
    expect(Object.keys(RETIRED_HEROIC_ITEMS).sort()).toEqual([...RETIRED_IDS]);
    for (const id of RETIRED_IDS) {
      expect(ITEMS[id]).toBe(RETIRED_HEROIC_ITEMS[id]);
    }
  });

  it('restores each complete def with its exact v0.24.2 identity', () => {
    expect(RETIRED_HEROIC_ITEMS).toEqual(EXPECTED_RETIRED_ITEMS);
  });

  it('keeps every retired id off every registered acquisition path', () => {
    const obtainableIds = new Set<string>();
    for (const mob of Object.values(MOBS)) {
      for (const entry of mob.loot ?? []) {
        if (entry.itemId) obtainableIds.add(entry.itemId);
      }
    }
    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorItems ?? []) obtainableIds.add(itemId);
    }
    for (const entries of Object.values(HEROIC_BOSS_LOOT)) {
      for (const entry of entries) {
        if (entry.itemId) obtainableIds.add(entry.itemId);
      }
    }
    for (const offer of HEROIC_VENDOR_STOCK) obtainableIds.add(offer.itemId);
    for (const itemId of FURY_STOCK) obtainableIds.add(itemId);
    for (const entries of Object.values(DELVE_SHOPS)) {
      for (const entry of entries) obtainableIds.add(entry.itemId);
    }
    for (const quest of Object.values(QUESTS)) {
      for (const itemId of Object.values(quest.itemRewards ?? {})) {
        if (itemId) obtainableIds.add(itemId);
      }
    }
    for (const id of RETIRED_IDS) {
      expect(obtainableIds.has(id)).toBe(false);
    }
  });

  it('allows retired ids only in their save-compat definition module', () => {
    const productionFiles = walkTypeScript(simRoot).filter((path) => path !== retiredDefsFile);
    for (const path of productionFiles) {
      const source = readFileSync(path, 'utf8');
      for (const id of RETIRED_IDS) expect(source).not.toContain(id);
    }
  });

  it('generates no heroic variants for retired items (they are save-compat only)', () => {
    for (const id of RETIRED_IDS) {
      expect(ITEMS[`heroic_${id}`]).toBeUndefined();
    }
    const variantsOfRetiredItems = Object.values(ITEMS).filter(
      (item) => item.heroicOf && RETIRED_IDS.includes(item.heroicOf as RetiredId),
    );
    expect(variantsOfRetiredItems).toEqual([]);
  });

  it('rehydrates equipped, inventory, and bank copies with stats and entity mirrors intact', () => {
    const equipped = loadLegacyRogue({ chest: 'scourgehide_carapace' });
    const unequipped = loadLegacyRogue({});

    expect(equipped.sim.players.get(equipped.pid)?.equipment).toEqual({
      chest: 'scourgehide_carapace',
    });
    expect(equipped.entity.equippedItems).toEqual({ chest: 'scourgehide_carapace' });
    expect(equipped.entity.stats.agi).toBe(unequipped.entity.stats.agi + 12);
    expect(equipped.entity.stats.sta).toBe(unequipped.entity.stats.sta + 10);
    expect(equipped.entity.stats.armor).toBe(unequipped.entity.stats.armor + 196);
    expect(equipped.entity.maxHp).toBe(unequipped.entity.maxHp + 100);

    const saved = equipped.sim.serializeCharacter(equipped.pid);
    if (!saved) throw new Error('legacy player was not serialized');
    expect(saved.equipment).toEqual({ chest: 'scourgehide_carapace' });
    expect(saved.inventory).toEqual([{ itemId: 'scourgehide_carapace', count: 2 }]);
    expect(saved.bank?.inventory).toEqual([{ itemId: 'scourgehide_carapace', count: 3 }]);
  });

  it('preserves retired ids through persisted mail and market round-trips', () => {
    const marketSave: MarketSave = {
      listings: [
        {
          id: 7,
          sellerKey: 'legacy-seller',
          sellerName: 'Legacy Seller',
          itemId: 'soulrend_diadem',
          count: 1,
          price: 12_345,
          secondsLeft: 600,
        },
      ],
      collections: [
        {
          key: 'legacy-seller',
          copper: 77,
          items: [{ itemId: 'soulforged_warplate', count: 1 }],
        },
      ],
      nextListingId: 8,
    };
    const mailSave: MailSave = {
      mail: [
        {
          id: 9,
          recipientKey: 'legacy-recipient',
          recipientName: 'Legacy Recipient',
          senderName: 'Legacy Sender',
          kind: 'player',
          subject: 'Old gear',
          body: '',
          copper: 0,
          items: [{ itemId: 'deathless_warguard_legmail', count: 1 }],
          deliverIn: 0,
          secondsLeft: -1,
          read: false,
        },
      ],
      nextMailId: 10,
    };
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });

    sim.loadMarket(marketSave);
    sim.loadMail(mailSave);

    const reserializedMarket = sim.serializeMarket();
    expect(reserializedMarket.listings).toEqual(marketSave.listings);
    expect(reserializedMarket.collections).toEqual(marketSave.collections);
    expect(sim.serializeMail()).toEqual(mailSave);
  });

  it('renders a real paperdoll cell for an equipped retired id (the Empty-slot regression)', () => {
    const view = buildPaperdollView({ chest: 'scourgehide_carapace' }, ITEMS);
    expect(view.left[3].slot).toBe('chest');
    expect(view.left[3].item).toBe(ITEMS.scourgehide_carapace);
  });
});
