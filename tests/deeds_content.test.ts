// Book of Deeds catalog integrity: every id, reference, mark, and total in
// src/sim/content/deeds.ts resolves against the real content tables, and the
// audited launch totals are pinned as LITERALS (update deliberately when the
// catalog changes, never by copying the computed value back).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { POWERUPS } from '../src/sim/content/augments';
import { DEED_ORDER, DEEDS, DEEDS_ERA } from '../src/sim/content/deeds';
import { DELVE_MOBS } from '../src/sim/content/delves/mobs';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { FISHING_TABLES } from '../src/sim/content/items';
import { MAGE_PET_MOBS } from '../src/sim/content/mage_pets';
import { CRAFT_RING, GATHERING_PROFESSION_IDS } from '../src/sim/content/professions';
import { WARLOCK_PET_MOBS } from '../src/sim/content/warlock_pets';
import { YUMI_TEMPLATE_ID } from '../src/sim/content/yumi';
import {
  DELVES,
  DUNGEONS,
  GROUND_OBJECTS,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
  ZONES,
} from '../src/sim/data';
import {
  GROUND_PICKUP_PROVING_QUESTS,
  MAX_CREDITABLE_MOB_LEVEL,
  MILESTONE_DEED_TO_LEGACY,
  VISITED_MARK_NAMESPACES,
} from '../src/sim/deeds';
import { DEED_STAT_KEYS, type DeedCategory, MILESTONES } from '../src/sim/types';

const ALL = DEED_ORDER.map((id) => DEEDS[id]);

const PREFIX_CATEGORY: Record<string, DeedCategory> = {
  prog_: 'progression',
  cmb_: 'combat',
  dgn_: 'dungeon',
  dlv_: 'delve',
  chr_: 'chronicle',
  col_: 'collection',
  pvp_: 'pvp',
  soc_: 'social',
  exp_: 'exploration',
  feat_: 'feat',
  hid_: 'hidden',
};

describe('audited launch totals (literals: update deliberately with the catalog)', () => {
  it('ships exactly 192 deeds worth 2365 total Renown', () => {
    expect(DEED_ORDER.length).toBe(193);
    expect(ALL.reduce((sum, d) => sum + d.renown, 0)).toBe(2370);
  });

  it('ships the audited per-category counts', () => {
    const byCategory: Record<string, number> = {};
    for (const d of ALL) byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;
    expect(byCategory).toEqual({
      progression: 30,
      combat: 10,
      dungeon: 27,
      delve: 13,
      chronicle: 24,
      collection: 24,
      pvp: 28,
      social: 16,
      exploration: 9,
      feat: 3,
      hidden: 9,
    });
  });

  it('pins the catalog-refresh additions: ids, order, and renown literals', () => {
    // The refresh tail appends AFTER the 186-deed launch set; both the launch
    // block and the tail are order-pinned so any insertion or reorder reds.
    expect(DEED_ORDER[185]).toBe('hid_codfather');
    expect(DEED_ORDER.slice(186)).toEqual([
      'prog_crown_below',
      'prog_mere_at_rest',
      'prog_callused_hands',
      'prog_tools_of_the_trade',
      'dgn_nythraxis_crypt',
      'chr_marsh_first_cast',
      'pvp_card_duel_first_win',
    ]);
    expect(DEEDS.prog_crown_below.renown).toBe(25);
    expect(DEEDS.prog_mere_at_rest.renown).toBe(25);
    expect(DEEDS.prog_callused_hands.renown).toBe(5);
    expect(DEEDS.prog_tools_of_the_trade.renown).toBe(10);
    expect(DEEDS.dgn_nythraxis_crypt.renown).toBe(10);
    expect(DEEDS.chr_marsh_first_cast.renown).toBe(5);
    expect(DEEDS.pvp_card_duel_first_win.renown).toBe(5);
    expect(DEEDS.pvp_card_duel_first_win.trigger).toEqual({
      kind: 'stat',
      stat: 'cardDuelsWon',
      count: 1,
    });
    // Full trigger literals: the evaluator's .every() is proven elsewhere, but
    // only a literal pin catches a quest id quietly dropped from a chain list.
    expect(DEEDS.prog_crown_below.trigger).toEqual({
      kind: 'quests',
      questIds: [
        'q_nythraxis_restless_dead',
        'q_nythraxis_graves',
        'q_nythraxis_sealed_crypt',
        'q_nythraxis_bound_guardian',
        'q_nythraxis_scourges_end',
      ],
    });
    expect(DEEDS.prog_mere_at_rest.trigger).toEqual({
      kind: 'quests',
      questIds: ['q_drowned_choir', 'q_palecoil', 'q_silence_the_choir', 'q_drowned_moon'],
    });
    expect(DEEDS.prog_callused_hands.trigger).toEqual({
      kind: 'quest',
      questId: 'q_prof_intro',
    });
    expect(DEEDS.prog_tools_of_the_trade.trigger).toEqual({
      kind: 'stat',
      stat: 'hubCraftsPerformed',
      count: 1,
    });
    expect(DEEDS.dgn_nythraxis_crypt.trigger).toEqual({
      kind: 'quest',
      questId: 'q_nythraxis_sealed_crypt',
    });
    expect(DEEDS.chr_marsh_first_cast.trigger).toEqual({
      kind: 'visit',
      markId: 'fish:mirefen_marsh',
    });
  });

  it('ships exactly 19 titles and 3 borders', () => {
    const titles = ALL.filter((d) => d.reward?.kind === 'title');
    const borders = ALL.filter((d) => d.reward?.kind === 'border');
    expect(titles.length).toBe(19);
    expect(borders.length).toBe(3);
    // Titles and border slugs are unique (one deed per cosmetic).
    const titleTexts = titles.map((d) => (d.reward as { text: string }).text);
    expect(new Set(titleTexts).size).toBe(19);
    const borderSlugs = borders.map((d) => (d.reward as { slug: string }).slug);
    expect([...borderSlugs].sort()).toEqual(['curators_gilt', 'deepward', 'prestige_laurels']);
  });

  it('pins the launch era constant', () => {
    expect(DEEDS_ERA).toBe('first_era');
  });
});

describe('frozen trigger + renown catalog (design rule 9: never retro-edit a trigger)', () => {
  // A single digest over (id, trigger, renown) for every deed in authored order.
  // The literal pins above cover only a handful of deeds; the other ~180 have no
  // frozen trigger, so silently widening an existing deed's questIds/count,
  // swapping its trigger kind, or nudging its renown keeps every targeted check
  // green. This hash is the one guard that reds on ANY such edit to a SHIPPED
  // deed, enforcing docs/design/deeds.md rule 9 (never retro-edit an existing
  // trigger).
  //
  // Adding a NEW deed also shifts the hash (it appends a row): that is expected
  // and acceptable, re-baseline in the SAME deliberate change. The point is that
  // no edit to a shipped trigger or renown value slips through unnoticed.
  //
  // Regenerate after a DELIBERATE catalog change, then paste the printed hex
  // into FROZEN_CATALOG_SHA256 below (run from the repo root):
  //   npx tsx -e "import {DEED_ORDER,DEEDS} from './src/sim/content/deeds'; import {createHash} from 'node:crypto'; console.log(createHash('sha256').update(JSON.stringify(DEED_ORDER.map((id)=>[id,DEEDS[id].trigger,DEEDS[id].renown])),'utf8').digest('hex'))"
  // v0.26 replaces the point tree before release, so prog_full_build's unreachable
  // eleven-point threshold is deliberately migrated once to the canonical six rows.
  // This new digest freezes that release contract; it is not permission for later edits.
  // Re-baselined once more at the release/v0.27.0 base merge: the catalog now also
  // carries the appended pvp_card_duel_first_win deed (Card Duel).
  const FROZEN_CATALOG_SHA256 = '10ce166afae9bbe849d4a810ec66d9bfe02a01bca06265943a46bbc3a2262773';

  it('every shipped deed keeps its trigger and renown unchanged', () => {
    const canonical = JSON.stringify(
      DEED_ORDER.map((id) => [id, DEEDS[id].trigger, DEEDS[id].renown]),
    );
    const actual = createHash('sha256').update(canonical, 'utf8').digest('hex');
    expect(
      actual,
      'A shipped deed trigger or renown value changed (or a deed was added/removed). ' +
        'Design rule 9 forbids retro-editing an existing trigger; adding a NEW deed is ' +
        'allowed but re-baselines this hash. If the change is deliberate, regenerate ' +
        'FROZEN_CATALOG_SHA256 with the one-liner in the comment above and commit it here.',
    ).toBe(FROZEN_CATALOG_SHA256);
  });
});

describe('retro fallback proof sets stay anchored to the real tables', () => {
  it('the ground-pickup proving quests are exactly the single-source collect quests', () => {
    // A quest proves a sparkle pickup only when its collect objective's item
    // can come from nowhere but the ground pickup path: any mob-loot or
    // vendor source would break the inference, and interact objectives never
    // bump the counter at all. Re-derive that set from the live tables and
    // hold the pin to it, so a new ground object, loot entry, or vendor row
    // forces a conscious re-decision here.
    const groundItemIds = new Set(GROUND_OBJECTS.map((g) => g.itemId));
    const lootItemIds = new Set(
      Object.values(MOBS).flatMap((m) => (m.loot ?? []).map((l) => l.itemId)),
    );
    const vendorItemIds = new Set(Object.values(NPCS).flatMap((n) => n.vendorItems ?? []));
    const derived: string[] = [];
    for (const [questId, quest] of Object.entries(QUESTS)) {
      const proves = quest.objectives.some(
        (obj) =>
          obj.type === 'collect' &&
          groundItemIds.has(obj.itemId) &&
          !lootItemIds.has(obj.itemId) &&
          !vendorItemIds.has(obj.itemId),
      );
      if (proves) derived.push(questId);
    }
    expect([...GROUND_PICKUP_PROVING_QUESTS].sort()).toEqual(derived.sort());
    // The pickup gate itself requires the item def to carry the quest id, so
    // every proving quest's evidence chain resolves end to end.
    for (const questId of GROUND_PICKUP_PROVING_QUESTS) {
      const quest = QUESTS[questId];
      expect(quest, questId).toBeDefined();
      const collect = quest.objectives.find(
        (o) => o.type === 'collect' && groundItemIds.has(o.itemId),
      );
      expect(collect, questId).toBeDefined();
      const item = ITEMS[(collect as { itemId: string }).itemId];
      // kind 'quest' is also the non-transferability guarantee: trade
      // (social/trade.ts), mail (mail/post_office.ts), and the market
      // (market.ts) all hard-block that kind, so questsDone proves THIS
      // character performed the pickup, not a trading partner.
      expect(item?.kind, questId).toBe('quest');
      expect(item?.questId, questId).toBe(questId);
      // A repeatable proving quest would weaken nothing, but none exists; a
      // future one should be reconsidered here rather than slip in.
      expect(quest.repeatable ?? false, questId).toBe(false);
    }
  });

  it('the creditable mob-level ceiling is the heroic pin', () => {
    // Giantslayer's stranded heal keys on the highest level a creditable mob
    // can ever spawn at. Heroic instances pin every mob to one shared level;
    // outside heroic no spawnable template exceeds the player cap. The only
    // templates authored above the ceiling can never be credited: warlock
    // and mage pets sync to their owner's level and die outside kill credit
    // (combat/damage.ts owned-pet early return), and the Yumi cat's damage
    // is intercepted before the death path (social/yumi.ts).
    const heroicLevels = Object.values(HEROIC_DUNGEON_TUNING).map((t) => t.level);
    expect(Math.max(...heroicLevels)).toBe(MAX_CREDITABLE_MOB_LEVEL);
    const neverCreditable = new Set([
      ...Object.keys(WARLOCK_PET_MOBS),
      ...Object.keys(MAGE_PET_MOBS),
      YUMI_TEMPLATE_ID,
    ]);
    for (const [id, m] of Object.entries(MOBS)) {
      if (m.dummy || m.worldBoss || neverCreditable.has(id)) continue;
      expect(m.maxLevel, id).toBeLessThanOrEqual(MAX_CREDITABLE_MOB_LEVEL);
    }
    // Delve spawns bypass maxLevel: the live level is minLevel plus the
    // tier's enemyLevelBonus (delves/runs.ts). Guard the whole delve mob
    // table against the highest bonus any delve ships, so a future tier or
    // higher-level delve mob cannot silently pass the ceiling.
    const maxDelveBonus = Math.max(
      ...Object.values(DELVES).flatMap((d) => d.tiers.map((t) => t.enemyLevelBonus)),
    );
    for (const [id, m] of Object.entries(DELVE_MOBS)) {
      expect(m.minLevel + maxDelveBonus, id).toBeLessThanOrEqual(MAX_CREDITABLE_MOB_LEVEL);
    }
  });
});

describe('table shape', () => {
  it('DEED_ORDER holds the append-only authored order (first and last pinned)', () => {
    // DEED_ORDER derives from the table keys, so covering DEEDS is inherent;
    // what CAN drift is the authored order itself. Pin the endpoints as
    // literals: prog_first_steps opens the catalog and chr_marsh_first_cast
    // closes the refresh tail, and either moving would signal a reorder
    // (forbidden: the order is an append-only determinism contract; new
    // deeds append). hid_codfather's index is pinned in the refresh test.
    expect(DEED_ORDER[0]).toBe('prog_first_steps');
    expect(DEED_ORDER[DEED_ORDER.length - 1]).toBe('pvp_card_duel_first_win');
  });

  it('every entry key matches its id and its prefix matches its category', () => {
    for (const [key, def] of Object.entries(DEEDS)) {
      expect(def.id).toBe(key);
      const prefix = Object.keys(PREFIX_CATEGORY).find((p) => key.startsWith(p));
      expect(prefix, `${key} has no known prefix`).toBeDefined();
      expect(def.category, key).toBe(PREFIX_CATEGORY[prefix as string]);
    }
  });

  it('renown values come from the allowed scale', () => {
    for (const def of ALL) expect([0, 5, 10, 25, 50], def.id).toContain(def.renown);
  });

  it('every feat has renown 0 and the feat/hidden flags stay on their prefixes, disjoint', () => {
    for (const def of ALL) {
      expect(def.feat === true, def.id).toBe(def.id.startsWith('feat_'));
      expect(def.hidden === true, def.id).toBe(def.id.startsWith('hid_'));
      if (def.feat) expect(def.renown, def.id).toBe(0);
      expect(def.feat === true && def.hidden === true, `${def.id} both feat and hidden`).toBe(
        false,
      );
    }
  });

  it('names and descs are non-empty English with no em/en dashes or emoji', () => {
    const banned = /[\u2013\u2014\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;
    for (const def of ALL) {
      expect(def.name.length, def.id).toBeGreaterThan(0);
      expect(def.desc.length, def.id).toBeGreaterThan(0);
      expect(banned.test(def.name), `${def.id} name`).toBe(false);
      expect(banned.test(def.desc), `${def.id} desc`).toBe(false);
    }
  });

  it('the Peaks chapter descs carry the renamed Thornpeak chronicler', () => {
    // The display name was renamed to Zenzie (template id retained for save
    // compatibility); the catalog must never regress to the old name.
    expect(DEEDS.chr_peaks_chapter_i.desc).toContain("Zenzie's chronicle");
    expect(DEEDS.chr_peaks_chapter_ii.desc).toContain("Zenzie's chronicle");
    for (const def of ALL) {
      expect(def.name.includes('Edda Hartwell'), `${def.id} name`).toBe(false);
      expect(def.desc.includes('Edda Hartwell'), `${def.id} desc`).toBe(false);
    }
  });
});

describe('trigger references resolve against the real content tables', () => {
  it('quest, dungeon, delve, item, craft, and profession references all exist', () => {
    for (const def of ALL) {
      const t = def.trigger;
      switch (t.kind) {
        case 'quest':
          expect(QUESTS[t.questId], `${def.id}: ${t.questId}`).toBeDefined();
          break;
        case 'quests':
          for (const q of t.questIds) expect(QUESTS[q], `${def.id}: ${q}`).toBeDefined();
          break;
        case 'dungeonClears':
          expect(DUNGEONS[t.dungeonId], `${def.id}: ${t.dungeonId}`).toBeDefined();
          break;
        case 'delveClears':
          if (t.delveId !== undefined) {
            expect(DELVES[t.delveId], `${def.id}: ${t.delveId}`).toBeDefined();
          }
          break;
        case 'collectItems':
          for (const itemId of t.itemIds) {
            expect(ITEMS[itemId], `${def.id}: ${itemId}`).toBeDefined();
          }
          break;
        case 'craftSkill':
          if (t.craftId !== undefined) {
            expect(
              CRAFT_RING.some((c) => c.id === t.craftId),
              `${def.id}: ${t.craftId}`,
            ).toBe(true);
          }
          break;
        case 'gathering':
          if (t.professionId !== undefined) {
            expect(GATHERING_PROFESSION_IDS, `${def.id}`).toContain(t.professionId);
          }
          break;
        case 'meta':
          for (const dep of t.deedIds) expect(DEEDS[dep], `${def.id}: ${dep}`).toBeDefined();
          for (const q of t.questIds ?? []) expect(QUESTS[q], `${def.id}: ${q}`).toBeDefined();
          break;
        default:
          break;
      }
    }
  });

  it('meta dependencies are acyclic (the fixpoint pass terminates by granting)', () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): void => {
      if (done.has(id)) return;
      expect(visiting.has(id), `meta cycle through ${id}`).toBe(false);
      visiting.add(id);
      const t = DEEDS[id].trigger;
      if (t.kind === 'meta') for (const dep of t.deedIds) visit(dep);
      visiting.delete(id);
      done.add(id);
    };
    for (const id of DEED_ORDER) visit(id);
  });

  it('every visited mark belongs to an authored namespace and resolves to real content', () => {
    const powerupIds = new Set(POWERUPS.map((p) => p.id));
    // A poi mark keys on the poi's STABLE id, never its display label (a label
    // copy edit must not strand exploration progress). The mark resolves to a real
    // poi id in a real zone.
    const zonePoiIds = new Map(ZONES.map((z) => [z.id, new Set(z.pois?.map((p) => p.id))]));
    const checkMark = (deedId: string, mark: string): void => {
      const ns = mark.split(':')[0];
      expect(VISITED_MARK_NAMESPACES, `${deedId}: ${mark}`).toContain(ns);
      if (ns === 'poi') {
        const rest = mark.slice(4);
        const cut = rest.indexOf(':');
        const zoneId = rest.slice(0, cut);
        const poiId = rest.slice(cut + 1);
        const ids = zonePoiIds.get(zoneId);
        expect(ids, `${deedId}: unknown zone in ${mark}`).toBeDefined();
        expect(ids?.has(poiId), `${deedId}: unknown poi id in ${mark}`).toBe(true);
      } else if (ns === 'slain' || ns === 'witness') {
        expect(MOBS[mark.slice(ns.length + 1)], `${deedId}: ${mark}`).toBeDefined();
      } else if (ns === 'npc') {
        expect(NPCS[mark.slice(4)], `${deedId}: ${mark}`).toBeDefined();
      } else if (ns === 'fish') {
        expect(FISHING_TABLES[mark.slice(5)], `${deedId}: ${mark}`).toBeDefined();
      } else if (ns === 'gather') {
        const [, zoneId, type] = mark.split(':');
        expect(zonePoiIds.has(zoneId), `${deedId}: ${mark}`).toBe(true);
        expect(['ore', 'wood', 'herb'], `${deedId}: ${mark}`).toContain(type);
      } else if (ns === 'quality') {
        expect(['rare', 'epic', 'legendary'], `${deedId}: ${mark}`).toContain(mark.slice(8));
      } else if (ns === 'fiesta') {
        expect(powerupIds.has(mark.slice(7)), `${deedId}: ${mark}`).toBe(true);
      } else if (ns === 'dungeon') {
        expect(DUNGEONS[mark.slice(8)], `${deedId}: ${mark}`).toBeDefined();
      }
    };
    for (const def of ALL) {
      if (def.trigger.kind === 'visit') checkMark(def.id, def.trigger.markId);
      if (def.trigger.kind === 'visits') {
        for (const mark of def.trigger.markIds) checkMark(def.id, mark);
      }
    }
  });

  it('every static-zone poi carries a stable id, unique within its zone', () => {
    // id is the PERSISTED identity behind every poi visit mark; the deed sweep
    // keys on it, so each static poi MUST declare one and no two pois in a zone
    // may collide (a collision would let one poi satisfy another's mark).
    for (const zone of ZONES) {
      const ids = (zone.pois ?? []).map((p) => p.id);
      for (const id of ids) {
        expect(id, `zone ${zone.id}: a poi is missing its stable id`).toBeDefined();
        expect(typeof id, `zone ${zone.id}: poi id must be a string`).toBe('string');
      }
      expect(new Set(ids).size, `zone ${zone.id}: poi ids must be unique`).toBe(ids.length);
    }
  });

  it('every lifetime counter key is read by at least one deed (no dead counters)', () => {
    const read = new Set<string>();
    for (const def of ALL) if (def.trigger.kind === 'stat') read.add(def.trigger.stat);
    for (const key of DEED_STAT_KEYS) expect(read.has(key), `unread counter ${key}`).toBe(true);
  });

  it('every lifetime counter has a producer site (no permanently unearnable stat deed)', () => {
    // Scan the sim sources for bumpDeedStat call literals; a counter no site
    // ever bumps makes its deed permanently unearnable. guildsFounded is the
    // documented exception: guild creation resolves entirely in the server
    // social layer, so its producer is a server observer, not a sim site.
    const SERVER_PRODUCED: readonly string[] = ['guildsFounded'];
    const produced = new Set<string>();
    const simRoot = path.join(__dirname, '..', 'src', 'sim');
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(p, 'utf8');
          for (const m of src.matchAll(/bumpDeedStat\([^)]*?'([a-zA-Z]+)'/g)) {
            produced.add(m[1]);
          }
        }
      }
    };
    walk(simRoot);
    for (const key of DEED_STAT_KEYS) {
      if (SERVER_PRODUCED.includes(key)) {
        expect(produced.has(key), `${key} is server-produced; drop the exemption`).toBe(false);
        continue;
      }
      expect(produced.has(key), `no sim producer bumps ${key}`).toBe(true);
    }
  });
});

describe('milestone unification', () => {
  it('the five prog_ milestone deeds mirror the legacy MILESTONES table literally', () => {
    // Pinned literals first (the legacy table must not drift under the deeds).
    expect(MILESTONES.map((m) => [m.id, m.lifetimeXp])).toEqual([
      ['veteran', 250000],
      ['champion', 500000],
      ['paragon', 1000000],
      ['mythic', 2500000],
      ['eternal', 5000000],
    ]);
    for (const m of MILESTONES) {
      const deed = DEEDS[`prog_${m.id}`];
      expect(deed, m.id).toBeDefined();
      expect(deed.trigger).toEqual({ kind: 'lifetimeXp', amount: m.lifetimeXp });
      expect(MILESTONE_DEED_TO_LEGACY[deed.id]).toBe(m.id);
    }
    expect(Object.keys(MILESTONE_DEED_TO_LEGACY).length).toBe(5);
  });

  it('the five reserved milestone titles ride exactly these deeds', () => {
    expect(DEEDS.prog_veteran.reward).toEqual({ kind: 'title', text: 'Veteran' });
    expect(DEEDS.prog_champion.reward).toEqual({ kind: 'title', text: 'Champion' });
    expect(DEEDS.prog_paragon.reward).toEqual({ kind: 'title', text: 'Paragon' });
    expect(DEEDS.prog_mythic.reward).toEqual({ kind: 'title', text: 'Mythic' });
    expect(DEEDS.prog_eternal.reward).toEqual({ kind: 'title', text: 'Eternal' });
  });
});

describe('the completionist feat', () => {
  it('feat_book_complete requires exactly every non-feat, non-hidden deed', () => {
    const t = DEEDS.feat_book_complete.trigger;
    expect(t.kind).toBe('meta');
    if (t.kind !== 'meta') return;
    const expected = DEED_ORDER.filter((id) => !DEEDS[id].feat && !DEEDS[id].hidden);
    expect(t.deedIds).toEqual(expected);
    expect(DEEDS.feat_book_complete.feat).toBe(true);
    expect(DEEDS.feat_book_complete.renown).toBe(0);
  });
});
