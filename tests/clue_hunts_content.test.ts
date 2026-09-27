// Clue Scrolls (world quests, Stage 3): the authored starter pool in
// src/sim/content/clue_hunts.ts pinned against the real content tables and the
// i18n catalog, so a hunt can never point at a landmark, NPC, item or emote
// that does not exist, dig outside its zone, or ship a step without prose.
// The prose checks read the catalog SOURCE modules (the English domain and the
// five non-Latin overlays) rather than the runtime t(), so they are decisive
// whether or not the resolved i18n bundles have been regenerated.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clueHuntFaction } from '../src/sim/clue_scrolls';
import {
  CLUE_HUNTS,
  CLUE_HUNTS_BY_ID,
  CLUE_SCROLL_ITEM_ID,
  CLUE_SCROLL_MIN_LEVEL,
  CLUE_SCROLL_STACK_MAX,
  CLUE_STEP_RADIUS,
  type ClueStepDef,
  TREASURE_CASKET_ITEM_ID,
} from '../src/sim/content/clue_hunts';
import { DEEDS } from '../src/sim/content/deeds';
import { RELIQUARY_HORIZON_TITLES } from '../src/sim/content/reliquary';
import { ITEMS, NPCS, WORLD_SIZE, ZONES } from '../src/sim/data';
import type { NpcDef, ZoneDef } from '../src/sim/types';
import { clueStrings } from '../src/ui/i18n.catalog/clues';
import { en } from '../src/ui/i18n.catalog/index';
import { ja_JP } from '../src/ui/i18n.locales/ja_JP';
import { ko_KR } from '../src/ui/i18n.locales/ko_KR';
import { ru_RU } from '../src/ui/i18n.locales/ru_RU';
import { zh_CN } from '../src/ui/i18n.locales/zh_CN';
import { zh_TW } from '../src/ui/i18n.locales/zh_TW';
import { DEED_ART_PENDING, ITEM_IMAGE_IDS } from '../src/ui/icons';

const repoRoot = path.resolve(__dirname, '..');

/** The zones the starter pool may use: the level 16+ bracket. */
const HUNT_ZONES = [
  'drakelands',
  'frostveil',
  'amberfall',
  'willowfen',
  'nightbloom',
  'wraithwood',
  'palmreach',
  'evergarden',
  'galecrest',
] as const;

const NON_LATIN: Record<string, Partial<Record<string, string>>> = {
  zh_CN: zh_CN as Partial<Record<string, string>>,
  zh_TW: zh_TW as Partial<Record<string, string>>,
  ja_JP: ja_JP as Partial<Record<string, string>>,
  ko_KR: ko_KR as Partial<Record<string, string>>,
  ru_RU: ru_RU as Partial<Record<string, string>>,
};

function zoneById(id: string): ZoneDef {
  const zone = (Object.values(ZONES) as ZoneDef[]).find((z) => z.id === id);
  if (!zone) throw new Error(`zone ${id} not in ZONES`);
  return zone;
}

function zoneRect(zone: ZoneDef): { xMin: number; xMax: number; zMin: number; zMax: number } {
  return {
    xMin: zone.xMin ?? -WORLD_SIZE / 2,
    xMax: zone.xMax ?? WORLD_SIZE / 2,
    zMin: zone.zMin,
    zMax: zone.zMax,
  };
}

function zoneOfPos(pos: { x: number; z: number }): string | undefined {
  return HUNT_ZONES.find((id) => {
    const r = zoneRect(zoneById(id));
    return pos.x >= r.xMin && pos.x <= r.xMax && pos.z >= r.zMin && pos.z <= r.zMax;
  });
}

/** The zones a step touches (an npc step is placed by the NPC's position). */
function stepZones(step: ClueStepDef): string[] {
  switch (step.kind) {
    case 'landmark':
    case 'emote':
    case 'dig':
      return [step.zoneId];
    case 'npc':
    case 'deliver': {
      const npc = (NPCS as Record<string, NpcDef>)[step.npcId];
      const zone = npc ? zoneOfPos(npc.pos) : undefined;
      return zone ? [zone] : [];
    }
  }
}

/** The EMOTES keys of src/sim/social/chat.ts (the table is module-private). */
function chatEmoteKeys(): string[] {
  const source = readFileSync(path.join(repoRoot, 'src/sim/social/chat.ts'), 'utf8');
  const block = /const EMOTES: Record<string, EmoteDef> = \{([\s\S]*?)\n\};/.exec(source);
  if (!block) throw new Error('EMOTES table not found in chat.ts');
  return [...block[1].matchAll(/^\s+([a-z]+): \{/gm)].map((m) => m[1]);
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('clue hunt starter pool: shape', () => {
  it('ships eight hunts with unique, frozen-shaped ids and a by-id index', () => {
    expect(CLUE_HUNTS).toHaveLength(8);
    const ids = CLUE_HUNTS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^hunt_[a-z]+_[a-z_]+$/);
    expect(Object.keys(CLUE_HUNTS_BY_ID).sort()).toEqual([...ids].sort());
    expect(Object.isFrozen(CLUE_HUNTS_BY_ID)).toBe(true);
    // The pool as authored, in order: a save carries one of these ids.
    expect(ids).toEqual([
      'hunt_drakelands_gate_ashes',
      'hunt_frostveil_aurora_vigil',
      'hunt_amberfall_lantern_ferry',
      'hunt_willowfen_fenwitch_salt',
      'hunt_nightbloom_sleepless_vigil',
      'hunt_wraithwood_mournstone_candles',
      'hunt_palmreach_sunken_idol',
      'hunt_evergarden_beacon_road',
    ]);
  });

  it('every hunt has 3 or 4 steps, ends with a dig, and names its zone in its id', () => {
    for (const hunt of CLUE_HUNTS) {
      expect(hunt.steps.length, hunt.id).toBeGreaterThanOrEqual(3);
      expect(hunt.steps.length, hunt.id).toBeLessThanOrEqual(4);
      expect(hunt.steps.at(-1)?.kind, `${hunt.id} ends with a dig`).toBe('dig');
      expect(
        hunt.steps.filter((s) => s.kind === 'dig'),
        `${hunt.id} digs once`,
      ).toHaveLength(1);
      const zone = hunt.id.split('_')[1];
      expect(HUNT_ZONES, `${hunt.id} names a bracket zone`).toContain(zone);
      expect(stepZones(hunt.steps[0]), `${hunt.id} starts in its named zone`).toContain(zone);
    }
  });

  it('every hunt stays inside at most two zones, all in the level 16+ bracket', () => {
    for (const hunt of CLUE_HUNTS) {
      const zones = new Set(hunt.steps.flatMap(stepZones));
      expect(zones.size, `${hunt.id} zones: ${[...zones].join(',')}`).toBeGreaterThanOrEqual(1);
      expect(zones.size, `${hunt.id} zones: ${[...zones].join(',')}`).toBeLessThanOrEqual(2);
      for (const z of zones) {
        expect(HUNT_ZONES, `${hunt.id} zone ${z}`).toContain(z);
        expect(zoneById(z).levelRange[0], `${z} is a 16+ zone`).toBeGreaterThanOrEqual(
          CLUE_SCROLL_MIN_LEVEL,
        );
      }
    }
  });

  it('the pool uses every step family, and each family appears in more than one hunt', () => {
    const byKind = new Map<string, Set<string>>();
    for (const hunt of CLUE_HUNTS)
      for (const step of hunt.steps) {
        if (!byKind.has(step.kind)) byKind.set(step.kind, new Set());
        byKind.get(step.kind)?.add(hunt.id);
      }
    expect([...byKind.keys()].sort()).toEqual(['deliver', 'dig', 'emote', 'landmark', 'npc']);
    for (const [kind, hunts] of byKind) expect(hunts.size, kind).toBeGreaterThan(1);
  });
});

describe('clue hunt starter pool: referential integrity', () => {
  it('landmark and emote steps name a real poi id of the zone they name', () => {
    for (const hunt of CLUE_HUNTS)
      for (const step of hunt.steps) {
        if (step.kind !== 'landmark' && step.kind !== 'emote') continue;
        const zone = zoneById(step.zoneId);
        const poi = zone.pois.find((p) => p.id === step.poiId);
        expect(poi, `${hunt.id}: ${step.poiId} is a poi of ${step.zoneId}`).toBeDefined();
        expect(poi?.hideOnMap, `${hunt.id}: ${step.poiId} shows on the map`).toBeFalsy();
      }
  });

  it('npc and deliver steps name an open-world NPC standing in a bracket zone', () => {
    for (const hunt of CLUE_HUNTS)
      for (const step of hunt.steps) {
        if (step.kind !== 'npc' && step.kind !== 'deliver') continue;
        const npc = (NPCS as Record<string, NpcDef>)[step.npcId];
        expect(npc, `${hunt.id}: NPC ${step.npcId} exists`).toBeDefined();
        expect(
          zoneOfPos(npc.pos),
          `${hunt.id}: ${step.npcId} stands in a bracket zone`,
        ).toBeDefined();
      }
  });

  it('deliver steps ask for 1 to 3 of a cheap, unbound, obtainable item', () => {
    for (const hunt of CLUE_HUNTS)
      for (const step of hunt.steps) {
        if (step.kind !== 'deliver') continue;
        const item = ITEMS[step.itemId];
        expect(item, `${hunt.id}: item ${step.itemId} exists`).toBeDefined();
        expect(step.count, `${hunt.id}: ${step.itemId} count`).toBeGreaterThanOrEqual(1);
        expect(step.count, `${hunt.id}: ${step.itemId} count`).toBeLessThanOrEqual(3);
        expect(item.soulbound, `${hunt.id}: ${step.itemId} is not soulbound`).toBeFalsy();
        expect(item.sellValue, `${hunt.id}: ${step.itemId} is cheap`).toBeLessThanOrEqual(10);
        expect(['common', undefined], `${hunt.id}: ${step.itemId} is common`).toContain(
          item.quality,
        );
        // Obtainable: some NPC vendor stocks it, or a class starts with it.
        const vendored = (Object.values(NPCS) as NpcDef[]).some((n) =>
          n.vendorItems?.includes(step.itemId),
        );
        expect(vendored, `${hunt.id}: ${step.itemId} is vendor stock`).toBe(true);
      }
  });

  it('emote steps use a real chat EMOTES key', () => {
    const keys = chatEmoteKeys();
    // Decisive guard on the source parse: the table as shipped.
    expect(keys).toContain('wave');
    expect(keys.length).toBeGreaterThanOrEqual(16);
    for (const hunt of CLUE_HUNTS)
      for (const step of hunt.steps) {
        if (step.kind !== 'emote') continue;
        expect(keys, `${hunt.id}: emote ${step.emote}`).toContain(step.emote);
      }
  });

  it('dig spots sit inside their zone, near but not on a landmark, and clear of lakes', () => {
    for (const hunt of CLUE_HUNTS)
      for (const step of hunt.steps) {
        if (step.kind !== 'dig') continue;
        const zone = zoneById(step.zoneId);
        const r = zoneRect(zone);
        expect(step.x, `${hunt.id} dig x`).toBeGreaterThan(r.xMin);
        expect(step.x, `${hunt.id} dig x`).toBeLessThan(r.xMax);
        expect(step.z, `${hunt.id} dig z`).toBeGreaterThan(r.zMin);
        expect(step.z, `${hunt.id} dig z`).toBeLessThan(r.zMax);
        expect(zoneOfPos(step), `${hunt.id} dig resolves to its zone`).toBe(step.zoneId);
        const nearest = Math.min(...zone.pois.map((p) => dist(p, step)));
        // Off the landmark's own step radius, but within a short walk of one so
        // the riddle can point at it.
        expect(nearest, `${hunt.id} dig is not on a landmark`).toBeGreaterThan(CLUE_STEP_RADIUS);
        expect(nearest, `${hunt.id} dig is near a landmark`).toBeLessThan(40);
        for (const lake of zone.lakes)
          expect(dist(lake, step), `${hunt.id} dig is out of the water`).toBeGreaterThan(
            lake.radius + CLUE_STEP_RADIUS,
          );
        expect(dist(zone.hub, step), `${hunt.id} dig is outside the hub`).toBeGreaterThan(
          zone.hub.radius,
        );
      }
  });
});

describe('clue hunt prose (clues.<huntId>.<step> and .title)', () => {
  const clues = clueStrings as unknown as Record<string, Record<string, string>>;
  const wordy = (v: string) => /[a-z]{4,}/.test(v.replace(/\{[^}]*\}/g, ''));

  it('is registered under the clues namespace of the English catalog', () => {
    expect((en as unknown as { clues: unknown }).clues).toBe(clueStrings);
  });

  it('every hunt has an English title and one riddle per step, and no orphan prose', () => {
    for (const hunt of CLUE_HUNTS) {
      const block = clues[hunt.id];
      expect(block, `clues.${hunt.id}`).toBeDefined();
      expect(typeof block.title, `clues.${hunt.id}.title`).toBe('string');
      expect(block.title.length).toBeGreaterThan(0);
      hunt.steps.forEach((step, i) => {
        const text = block[String(i)];
        expect(typeof text, `clues.${hunt.id}.${i}`).toBe('string');
        // One or two sentences of real prose, never a coordinate.
        expect(text.length, `clues.${hunt.id}.${i}`).toBeGreaterThan(40);
        expect(text, `clues.${hunt.id}.${i} carries no coordinates`).not.toMatch(/-?\d{3,}/);
        expect(wordy(text)).toBe(true);
        if (step.kind === 'deliver') {
          const itemName = ITEMS[step.itemId].name;
          expect(text, `clues.${hunt.id}.${i} names the item`).toContain(itemName);
          expect(text, `clues.${hunt.id}.${i} names the count`).toContain(`${step.count} x `);
        }
        if (step.kind === 'npc' || step.kind === 'deliver') {
          const npc = (NPCS as Record<string, NpcDef>)[step.npcId];
          expect(text, `clues.${hunt.id}.${i} names the NPC`).toContain(npc.name);
        }
        if (step.kind === 'emote') {
          expect(text.toLowerCase(), `clues.${hunt.id}.${i} names the emote`).toContain(step.emote);
        }
        if (step.kind === 'dig') {
          expect(text, `clues.${hunt.id}.${i} says to dig`).toMatch(/dig/i);
        }
      });
      // No prose for a step that does not exist.
      const stepKeys = Object.keys(block).filter((k) => k !== 'title');
      expect(stepKeys.map(Number).sort((a, b) => a - b)).toEqual(hunt.steps.map((_, i) => i));
    }
    // No prose for a hunt that does not exist (the items block is the one non-hunt key).
    const huntKeys = Object.keys(clues).filter((k) => k !== 'items');
    expect(huntKeys.sort()).toEqual(CLUE_HUNTS.map((h) => h.id).sort());
  });

  it('carries the two item descriptions', () => {
    expect(wordy(clueStrings.items.clue_scroll.desc)).toBe(true);
    expect(wordy(clueStrings.items.treasure_casket.desc)).toBe(true);
  });

  it('every clues.* key has its five non-Latin fills (M16), none byte-equal to the English', () => {
    const flatEn: Record<string, string> = {
      'clues.items.clue_scroll.desc': clueStrings.items.clue_scroll.desc,
      'clues.items.treasure_casket.desc': clueStrings.items.treasure_casket.desc,
    };
    for (const hunt of CLUE_HUNTS) {
      flatEn[`clues.${hunt.id}.title`] = clues[hunt.id].title;
      hunt.steps.forEach((_, i) => {
        flatEn[`clues.${hunt.id}.${i}`] = clues[hunt.id][String(i)];
      });
    }
    expect(Object.keys(flatEn)).toHaveLength(2 + 8 + 30);
    for (const [lang, table] of Object.entries(NON_LATIN))
      for (const [key, english] of Object.entries(flatEn)) {
        const fill = table[key];
        expect(typeof fill, `${lang} ${key}`).toBe('string');
        expect(fill, `${lang} ${key} is translated`).not.toBe(english);
        expect(fill?.length, `${lang} ${key} is not empty`).toBeGreaterThan(0);
      }
  });
});

describe('clue scroll items and deeds (the content records this feature carries)', () => {
  it('the scroll and the casket are usable quest-kind soulbound items with painted art', () => {
    const scroll = ITEMS[CLUE_SCROLL_ITEM_ID];
    const casket = ITEMS[TREASURE_CASKET_ITEM_ID];
    expect(scroll).toMatchObject({
      id: 'clue_scroll',
      name: 'Clue Scroll',
      kind: 'quest',
      quality: 'rare',
      use: { type: 'clueScroll' },
      stackSize: CLUE_SCROLL_STACK_MAX,
      sellValue: 0,
      soulbound: true,
      noVendorSell: true,
      noMarketList: true,
      noDiscard: false,
    });
    expect(casket).toMatchObject({
      id: 'treasure_casket',
      name: 'Treasure Casket',
      kind: 'quest',
      quality: 'epic',
      use: { type: 'clueCasket' },
      stackSize: 1,
      sellValue: 0,
      soulbound: true,
      noVendorSell: true,
      noMarketList: true,
      noDiscard: false,
    });
    for (const id of [CLUE_SCROLL_ITEM_ID, TREASURE_CASKET_ITEM_ID]) {
      expect(ITEM_IMAGE_IDS.has(id), `${id} has painted art`).toBe(true);
      expect(() =>
        readFileSync(path.join(repoRoot, 'public/ui/items', `${id}.webp`)),
      ).not.toThrow();
      expect(en.entities.items[id as 'clue_scroll'].name).toBe(ITEMS[id].name);
      for (const [lang, table] of Object.entries(NON_LATIN)) {
        const fill = table[`entities.items.${id}.name`];
        expect(typeof fill, `${lang} ${id} name fill`).toBe('string');
        expect(fill, `${lang} ${id} name fill is translated`).not.toBe(ITEMS[id].name);
      }
    }
  });

  it('the two casket deeds read the clueCasketsOpened meter, the tenth grants Treasure Hunter', () => {
    expect(DEEDS.exp_clue_first_casket).toMatchObject({
      name: 'Treasure Found',
      category: 'exploration',
      renown: 10,
      trigger: { kind: 'meter', meter: 'clueCasketsOpened', amount: 1 },
    });
    expect(DEEDS.exp_clue_first_casket.reward).toBeUndefined();
    expect(DEEDS.exp_clue_ten_caskets).toMatchObject({
      name: 'Treasure Hunter',
      category: 'exploration',
      renown: 25,
      trigger: { kind: 'meter', meter: 'clueCasketsOpened', amount: 10 },
      reward: { kind: 'title', text: 'Treasure Hunter' },
    });
    expect(RELIQUARY_HORIZON_TITLES).toContain('exp_clue_ten_caskets');
    expect(DEED_ART_PENDING.has('exp_clue_first_casket')).toBe(true);
    expect(DEED_ART_PENDING.has('exp_clue_ten_caskets')).toBe(true);
  });
});

describe('clue hunt starter pool: the standing a finished hunt pays', () => {
  it('every hunt digs in a zone a faction owns, so the finish always pays standing', () => {
    for (const hunt of CLUE_HUNTS) {
      expect(clueHuntFaction(hunt), `${hunt.id} pays a faction`).not.toBeNull();
    }
    // The pool spreads across all three factions, not just one.
    expect(new Set(CLUE_HUNTS.map((hunt) => clueHuntFaction(hunt))).size).toBe(3);
  });
});
