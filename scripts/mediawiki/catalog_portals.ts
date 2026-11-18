import { FINDER_ACTIVITIES } from '../../src/sim/content/dungeon_finder';
import {
  ABILITIES,
  ALL_RECIPES,
  BUILTIN_WORLD,
  CLASSES,
  DUNGEON_LIST,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
  ZONES,
  zoneContaining,
} from '../../src/sim/data';
import { weaponHand } from '../../src/sim/equipment_rules';
import { npcRoleFor } from '../../src/sim/npc_role';
import { WORLD_PVP_SKULL_BAG_ITEM_ID } from '../../src/sim/pvp/world_pvp_trophy';
import {
  type ItemDef,
  type MobFamily,
  type PlayerClass,
  questTurnInNpcIds,
} from '../../src/sim/types';
import { craftNameKey, craftNameText } from '../../src/ui/hud/professions/craft_name_view';
import { abilityIndexGroup, MEMBERSHIP_GROUP } from './ability_access';
import { hoardBosses, riftBosses } from './boss_groups';
import { type ClassAbilityGroup, classAbilityGroup } from './class_ability_sections';
import { addClassGearViews, BY_CLASS } from './class_gear';
import { creatureRole, FRIENDLY_GROUPS, ROLE_SECTIONS } from './creature_role';
import { raidName, raidRooms } from './dungeon_catalog';
import { type ArticleTools, words } from './entity_format';
import { addEnemyZoneIndexes, addVendorDirectory } from './hub_directories';
import { addInstanceLootPages } from './instance_loot';
import { addItemBrowseViews, BY_QUALITY, BY_WEAPON_TYPE, MORE_WAYS } from './item_browse_views';
import { itemPlacement, offhandSection } from './item_catalog_groups';
import { addGearPages } from './item_tables';
import { homeZones } from './npc_article';
import { npcHubServices } from './npc_hub_services';
import { npcServiceLabel } from './npc_service';
import { wikiItemKind } from './wiki_item_kind';

type Writer = Pick<ArticleTools, 'add' | 'section' | 'bullets' | 'link' | 'titleBy'> & {
  reserve(title: string): string;
  usedTitles?: Set<string>;
};
type Root = 'Items' | 'Mobs' | 'Abilities' | 'NPCs';
type Member = { title: string; name: string; section: string; key?: string; id?: string };
type Builder = (title: string, members: Member[]) => void;

const display = (value: string) => {
  const s = words(value);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const rootLabel = (root: Root) => (root === 'Mobs' ? 'Enemies' : root);
const collate = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

function catalog(w: Writer, root: Root, intro: string, order: string[] = []) {
  const rank = (facet: string) => {
    const i = order.indexOf(facet);
    return i < 0 ? order.length : i;
  };
  const groups = new Map<string, Map<string, Map<string, Member>>>();
  const builders = new Map<string, Builder>();
  const labelOrder = new Map<string, string[]>();
  const extras = new Map<string, () => string[]>();
  return {
    /** A section of ready-made links to pages written elsewhere, made when the hub is. */
    extra(facet: string, lines: () => string[]) {
      extras.set(facet, lines);
    },
    /** Lists a section's groups in this order instead of A to Z. */
    order(facet: string, labels: string[]) {
      labelOrder.set(facet, labels);
    },
    /** Lets one group write its own page (and pages under it) instead of a plain list. */
    build(facet: string, label: string, builder: Builder) {
      builders.set(facet + '|' + label, builder);
    },
    file(facet: string, label: string, member: Member) {
      const buckets = groups.get(facet) ?? new Map<string, Map<string, Member>>();
      const entries = buckets.get(label) ?? new Map<string, Member>();
      entries.set(member.key ?? member.title, member);
      buckets.set(label, entries);
      groups.set(facet, buckets);
    },
    publish() {
      const parts = [intro];
      const facets = [...new Set([...groups.keys(), ...extras.keys()])];
      for (const facet of facets.sort((a, b) => rank(a) - rank(b))) {
        const made = extras.get(facet);
        if (made) {
          const lines = made();
          if (lines.length) parts.push(w.section(facet, w.bullets(lines)));
          continue;
        }
        const buckets = groups.get(facet)!;
        const children: string[] = [];
        const labels = labelOrder.get(facet) ?? [];
        const at = (label: string) =>
          labels.includes(label) ? labels.indexOf(label) : Number.MAX_SAFE_INTEGER;
        for (const [label, members] of [...buckets].sort(
          ([a], [b]) => at(a) - at(b) || collate(a, b),
        )) {
          const title = w.reserve(label + ' (' + rootLabel(root) + ' index)');
          const custom = builders.get(facet + '|' + label);
          if (custom) {
            custom(title, [...members.values()]);
            children.push(w.link(title, label) + ' (' + members.size + ')');
            continue;
          }
          const grouped = new Map<string, string[]>();
          for (const m of [...members.values()].sort(
            (a, b) => collate(a.name, b.name) || collate(a.title, b.title),
          )) {
            const lines = grouped.get(m.section) ?? [];
            lines.push(w.link(m.title, m.name));
            grouped.set(m.section, lines);
          }
          const content = [...grouped]
            .sort(([a], [b]) => collate(a, b))
            .map(([section, lines]) => w.section(section, w.bullets(lines)))
            .join('');
          w.add(title, w.link(root, 'Browse ' + rootLabel(root).toLowerCase()) + '\n\n' + content, [
            'Portals',
          ]);
          children.push(w.link(title, label) + ' (' + members.size + ')');
        }
        parts.push(w.section(facet, w.bullets(children)));
      }
      w.add(root, parts.join('\n\n'), ['Portals']);
    },
  };
}

const gearSlots: Record<string, string> = {
  helmet: 'Head armor',
  neck: 'Necklaces',
  shoulder: 'Shoulder armor',
  chest: 'Chest armor',
  waist: 'Belts',
  legs: 'Leg armor',
  gloves: 'Gloves',
  feet: 'Footwear',
  ring: 'Rings',
  ring1: 'Rings',
  ring2: 'Rings',
  trinket: 'Trinkets',
  offhand: 'Off-hand equipment',
  mainhand: 'Main-hand equipment',
};
// Heroic copies share their Normal item's name; say which one a row is.
const itemName = (item: ItemDef) =>
  item.heroicOf || item.heroic ? item.name + ' (Heroic)' : item.name;

function itemPortal(w: Writer) {
  const c = catalog(
    w,
    'Items',
    'Find gear by the slot you want to fill, find supplies for a profession, or look up an item you can use. Materials are also listed under each craft that uses them.',
    [
      'Weapons',
      'Armor, jewelry and off-hands',
      BY_WEAPON_TYPE,
      'Consumables',
      'Professions and supplies',
      'Currencies and tokens',
      'Collections and appearance',
      'Bags and travel',
      'Adventure and trade',
      'Ingredients by profession',
      // After the existing sections, so an item keeps its slot or kind page as its
      // breadcrumb even when a quality page also lists it.
      BY_CLASS,
      BY_QUALITY,
      MORE_WAYS,
    ],
  );
  const ingredients = new Map<string, Set<string>>();
  for (const recipe of ALL_RECIPES)
    for (const reagent of recipe.reagents) {
      const crafts = ingredients.get(reagent.itemId) ?? new Set<string>();
      crafts.add(
        craftNameKey(recipe.professionId)
          ? craftNameText(recipe.professionId)
          : display(recipe.professionId),
      );
      ingredients.set(reagent.itemId, crafts);
    }
  for (const [id, title] of w.titleBy.item) {
    const item = ITEMS[id];
    const entry = {
      title,
      name: itemName(item),
      section: display(item.quality ?? 'common'),
      id,
    };
    if (item.kind === 'armor' || item.kind === 'held_offhand') {
      const slot = gearSlots[item.slot ?? 'offhand'];
      c.file('Armor, jewelry and off-hands', slot, {
        ...entry,
        section: offhandSection(item) || (item.armorType ? display(item.armorType) : entry.section),
      });
    } else if (item.kind === 'weapon') {
      const hands = {
        mainhand: 'Main-hand weapons',
        onehand: 'One-handed weapons',
        twohand: 'Two-handed weapons',
      };
      c.file('Weapons', hands[weaponHand(item) ?? 'onehand'], entry);
    } else {
      const [facet, label] =
        item.id === WORLD_PVP_SKULL_BAG_ITEM_ID ? ['Bags and travel', 'Bags'] : itemPlacement(item);
      c.file(
        facet,
        label,
        label === 'Materials' ? { ...entry, section: wikiItemKind(item) } : entry,
      );
    }
    for (const craft of ingredients.get(id) ?? [])
      c.file('Ingredients by profession', craft + ' ingredients', entry);
  }
  // Gear is browsed in layers (slot, type, quality), each with a sortable stat table.
  const gear = (facet: string, label: string, weapon: boolean) =>
    c.build(facet, label, (title, members) =>
      addGearPages(
        w,
        title,
        label,
        members.map((m) => ({ id: m.id!, title: m.title, name: m.name })),
        weapon,
        'Items',
      ),
    );
  for (const slot of new Set(Object.values(gearSlots)))
    gear('Armor, jewelry and off-hands', slot, false);
  for (const hands of ['Main-hand weapons', 'One-handed weapons', 'Two-handed weapons'])
    gear('Weapons', hands, true);
  // Cross-slot views: by quality, weapon type, source and equipment set group.
  addItemBrowseViews(w, c);
  const classGear = addClassGearViews(w, c);
  c.publish();
  return classGear;
}

const families: Record<MobFamily, string> = {
  beast: 'Beasts',
  humanoid: 'Humanoids',
  mudfin: 'Mudfins',
  spider: 'Spiders',
  burrower: 'Burrowers',
  undead: 'Undead',
  troll: 'Trolls',
  ogre: 'Ogres',
  elemental: 'Elementals',
  dragonkin: 'Dragonkin',
  demon: 'Demons',
  reptile: 'Reptiles',
};
function enemyPortal(w: Writer) {
  const c = catalog(
    w,
    'Mobs',
    'Find an enemy by its family, how tough it is, or the dungeon, raid, rift or buried hoard it is in. One enemy can be in more than one list. Companions, pets, practice targets and people you escort are not here. They are listed with the friendly characters under NPCs.',
    [
      'Creature families',
      'Encounter rank',
      'Rift and hoard bosses',
      'Dungeon spawn lists',
      'Raid spawn lists',
      // Last, so an enemy keeps its family page as its breadcrumb.
      'By zone',
    ],
  );
  // A raid's rooms are one place to a player; list their spawns under the raid.
  const raidOf = new Map<string, string>();
  for (const a of FINDER_ACTIVITIES.filter((f) => f.kind === 'raid'))
    for (const room of raidRooms(a)) raidOf.set(room.id, raidName(a));
  // Where each boss is fought, so the Bosses list is grouped by activity.
  const rift = riftBosses();
  const hoard = hoardBosses();
  const dungeonOf = new Map<string, string>();
  for (const d of DUNGEON_LIST)
    for (const spawn of d.spawns)
      if (!dungeonOf.has(spawn.mobId))
        dungeonOf.set(spawn.mobId, raidOf.has(d.id) ? 'Raid bosses' : 'Dungeon bosses');
  const bossGroups = (id: string): string[] => {
    const groups = [
      ...(MOBS[id].worldBoss ? ['World bosses'] : []),
      ...(dungeonOf.has(id) ? [dungeonOf.get(id)!] : []),
      ...(rift.some((b) => b.mobId === id) ? ['Rift bosses'] : []),
      ...(hoard.some((b) => b.mobId === id) ? ['Hoard bosses'] : []),
    ];
    // Anything left is a boss fought out in the world (a zone or quest boss).
    return groups.length ? groups : ['Open world bosses'];
  };
  for (const [id, title] of w.titleBy.mob) {
    if (creatureRole(id) !== 'enemy') continue;
    const m = MOBS[id];
    const family = families[m.family];
    const entry = { title, name: m.name, section: family };
    const rank = m.boss
      ? 'Bosses'
      : m.rare
        ? 'Rare enemies'
        : m.elite
          ? 'Elites'
          : 'Normal enemies';
    c.file('Creature families', family, { ...entry, section: rank });
    // A boss can also be elite or rare; list it under every rank a player might search.
    if (m.boss)
      for (const group of bossGroups(id))
        c.file('Encounter rank', 'Bosses', { ...entry, section: group, key: title + '@' + group });
    if (m.elite) c.file('Encounter rank', 'Elites', entry);
    if (m.rare) c.file('Encounter rank', 'Rare enemies', entry);
    if (!m.boss && !m.elite && !m.rare) c.file('Encounter rank', 'Normal enemies', entry);
  }
  // Rift and hoard bosses get their own lists, by the floor or the kind of hoard.
  for (const [label, bosses] of [
    ['Rift bosses', rift],
    ['Hoard bosses', hoard],
  ] as const)
    for (const b of bosses) {
      const title = w.titleBy.mob.get(b.mobId);
      if (title)
        c.file('Rift and hoard bosses', label, {
          title,
          name: MOBS[b.mobId].name,
          section: b.place,
          key: title + '@' + b.place,
        });
    }
  for (const d of DUNGEON_LIST)
    for (const spawn of d.spawns) {
      const m = MOBS[spawn.mobId],
        title = w.titleBy.mob.get(spawn.mobId);
      if (!title || !m || creatureRole(spawn.mobId) !== 'enemy') continue;
      const raid = raidOf.get(d.id);
      c.file(raid ? 'Raid spawn lists' : 'Dungeon spawn lists', raid ?? d.name, {
        title,
        name: m.name,
        section: raid ? d.name : families[m.family],
        key: title + '@' + d.id,
      });
    }
  const zones = new Map<string, string>();
  c.extra('By zone', () =>
    [...addEnemyZoneIndexes(w)].map(([id, z]) => {
      zones.set(id, z.title);
      return w.link(z.title, ZONES.find((zone) => zone.id === id)!.name) + ' (' + z.count + ')';
    }),
  );
  c.publish();
  return zones;
}

// Index headings for spellbook entries outside the base kit; same split as the class page.
const EXTRA_SECTIONS: Record<ClassAbilityGroup, string> = {
  'Class spellbook': 'Other actions',
  'Specialization abilities': 'Specialization abilities',
  'Talent choices': 'Talent abilities',
  'Quest abilities': 'Quest abilities',
  'Conditional replacements': 'Conditional replacements',
  'Additional class actions': 'Other actions',
  'Membership ability': 'Other actions',
};

function abilityPortal(w: Writer) {
  const c = catalog(
    w,
    'Abilities',
    'Pick a class to see its spellbook, including its extra class actions. The spell school lists group abilities from every class by school. Open an ability to see how to unlock it, its ranks, its cost and how it grows stronger with your stats.',
    ['Class spellbooks', 'Other sources', 'Schools'],
  );
  for (const [id, title] of w.titleBy.ability) {
    const ability = ABILITIES[id];
    const cls = abilityIndexGroup(ability),
      school = display(ability.school);
    const otherSource = cls === 'Item actions' || cls === MEMBERSHIP_GROUP;
    c.file(otherSource ? 'Other sources' : 'Class spellbooks', cls, {
      title,
      name: ability.name,
      section: otherSource
        ? cls
        : CLASSES[ability.class].abilities.includes(id)
          ? 'Level ' + ability.learnLevel
          : EXTRA_SECTIONS[classAbilityGroup(ability)],
    });
    c.file('Schools', school, { title, name: ability.name, section: cls });
  }
  c.publish();
}

function npcPortal(w: Writer) {
  const c = catalog(
    w,
    'NPCs',
    'Look for the service you need, or look by place. A quest contact can be in both the quest givers list and the hand-in list. Friendly creatures lists companions, pets, practice targets and people you escort.',
    // Breadcrumbs follow the first section that lists a page, so place comes first.
    [
      'Zones',
      'Dungeons and raids',
      'Other locations',
      'Services',
      'Quest contacts',
      'Friendly creatures',
      // Last, so an NPC keeps its zone page as its breadcrumb.
      'Shops',
    ],
  );
  const givers = new Set(Object.values(QUESTS).map((q) => q.giverNpcId));
  const recipients = new Set(Object.values(QUESTS).flatMap(questTurnInNpcIds));
  for (const [id, title] of w.titleBy.npc) {
    const n = BUILTIN_WORLD.npcs[id] ?? NPCS[id];
    const role = npcRoleFor(n);
    const service = role ? npcServiceLabel(role) : 'Other residents';
    const services = npcHubServices(n);
    // A system-spawned NPC still stands at its authored post. The origin is the
    // placeholder for NPCs with no post (raid walk-ins, the spirit healer).
    // The same zones the NPC's own page names, so the index and the page always agree.
    const zones = homeZones(id).map((z) => z.name);
    const zone = zones[0];
    const rooms = DUNGEON_LIST.filter((d) => d.npcs?.some((s) => s.npcId === id)).map(
      (d) => d.name,
    );
    const entry = { title, name: n.name, section: zone ?? rooms[0] ?? 'Activities' };
    for (const name of zones) c.file('Zones', name, { ...entry, section: service });
    for (const room of rooms) c.file('Dungeons and raids', room, { ...entry, section: service });
    if (!zone && !rooms.length)
      c.file('Other locations', 'Events and activities', { ...entry, section: service });
    for (const label of services) c.file('Services', label, entry);
    if (givers.has(id)) c.file('Quest contacts', 'Quest givers', entry);
    if (recipients.has(id)) c.file('Quest contacts', 'Quest hand-ins', entry);
  }
  for (const [id, title] of w.titleBy.mob) {
    const role = creatureRole(id);
    if (role === 'enemy') continue;
    c.file('Friendly creatures', FRIENDLY_GROUPS[role], {
      title,
      name: MOBS[id].name,
      section: ROLE_SECTIONS[role],
    });
  }
  c.extra('Shops', () => {
    const vendors = addVendorDirectory(w);
    return [w.link(vendors.title, 'All vendors') + ' (' + vendors.count + ')'];
  });
  c.publish();
}

/** Writes the hubs. Returns the pages other builders link: class gear and enemies by zone. */
export function addCatalogPortals(w: Writer): {
  classGear: Map<PlayerClass, string>;
  enemyIndex: Map<string, string>;
} {
  const classGear = itemPortal(w);
  // Linked from the Dungeons and raids hub and from each dungeon and raid page.
  addInstanceLootPages(w);
  const enemyIndex = enemyPortal(w);
  abilityPortal(w);
  npcPortal(w);
  return { classGear, enemyIndex };
}
