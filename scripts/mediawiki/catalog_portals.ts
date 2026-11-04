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
  zoneContaining,
} from '../../src/sim/data';
import { weaponHand } from '../../src/sim/equipment_rules';
import { npcRoleFor } from '../../src/sim/npc_role';
import { type ItemDef, type MobFamily, questTurnInNpcIds } from '../../src/sim/types';
import { t } from '../../src/ui/i18n';
import { abilityIndexGroup } from './ability_access';
import { type ArticleTools, words } from './entity_format';

type Writer = Pick<ArticleTools, 'add' | 'section' | 'bullets' | 'link' | 'titleBy'> & {
  reserve(title: string): string;
};
type Root = 'Items' | 'Mobs' | 'Abilities' | 'NPCs';
type Member = { title: string; name: string; section: string };

const display = (value: string) => {
  const s = words(value);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const rootLabel = (root: Root) => (root === 'Mobs' ? 'Enemies' : root);
const collate = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

function catalog(w: Writer, root: Root, intro: string) {
  const groups = new Map<string, Map<string, Map<string, Member>>>();
  return {
    file(facet: string, label: string, member: Member) {
      const buckets = groups.get(facet) ?? new Map<string, Map<string, Member>>();
      const entries = buckets.get(label) ?? new Map<string, Member>();
      entries.set(member.title, member);
      buckets.set(label, entries);
      groups.set(facet, buckets);
    },
    publish() {
      const parts = [intro];
      for (const [facet, buckets] of groups) {
        const children: string[] = [];
        for (const [label, members] of [...buckets].sort(([a], [b]) => collate(a, b))) {
          const title = w.reserve(label + ' (' + rootLabel(root) + ' index)');
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
const kinds: Record<
  Exclude<ItemDef['kind'], 'weapon' | 'armor' | 'held_offhand'>,
  [string, string]
> = {
  food: ['Consumables', 'Food'],
  drink: ['Consumables', 'Drinks'],
  potion: ['Consumables', 'Potions'],
  elixir: ['Consumables', 'Elixirs'],
  flask: ['Consumables', 'Flasks'],
  scroll: ['Consumables', 'Scrolls'],
  tool: ['Professions and supplies', 'Tools and supplies'],
  recipe: ['Professions and supplies', 'Crafting patterns'],
  bag: ['Storage and collections', 'Bags'],
  mount: ['Storage and collections', 'Mount items'],
  buddy: ['Storage and collections', 'Companion items'],
  buddy_cosmetic: ['Storage and collections', 'Companion cosmetics'],
  quest: ['Adventure and trade', 'Quest items'],
  junk: ['Adventure and trade', 'Trade goods and junk'],
};
function itemPortal(w: Writer) {
  const c = catalog(
    w,
    'Items',
    'Browse gear by the slot you want to fill, find supplies for a profession, or look up an item you can use. Materials also appear under the crafts that consume them.',
  );
  const ingredients = new Map<string, Set<string>>();
  for (const recipe of ALL_RECIPES)
    for (const reagent of recipe.reagents) {
      const crafts = ingredients.get(reagent.itemId) ?? new Set<string>();
      crafts.add(display(recipe.professionId));
      ingredients.set(reagent.itemId, crafts);
    }
  for (const [id, title] of w.titleBy.item) {
    const item = ITEMS[id];
    const entry = { title, name: item.name, section: display(item.quality ?? 'common') };
    if (item.kind === 'armor' || item.kind === 'held_offhand') {
      const slot = gearSlots[item.slot ?? 'offhand'];
      c.file('Armor, jewelry and off-hands', slot, {
        ...entry,
        section: item.armorType ? display(item.armorType) : entry.section,
      });
    } else if (item.kind === 'weapon') {
      const hands = {
        mainhand: 'Main-hand weapons',
        onehand: 'One-handed weapons',
        twohand: 'Two-handed weapons',
      };
      c.file('Weapons', hands[weaponHand(item) ?? 'onehand'], entry);
    } else {
      const [section, label] = kinds[item.kind];
      c.file(section, label, entry);
    }
    for (const craft of ingredients.get(id) ?? [])
      c.file('Ingredients by profession', craft + ' ingredients', entry);
  }
  c.publish();
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
    'Find a creature by family, encounter rank or dungeon. A creature can appear in more than one list.',
  );
  for (const [id, title] of w.titleBy.mob) {
    const m = MOBS[id];
    const family = families[m.family];
    const entry = { title, name: m.name, section: family };
    const rank = m.boss
      ? 'Bosses'
      : m.rare
        ? 'Rare enemies'
        : m.elite
          ? 'Elites'
          : 'Other creatures';
    c.file('Creature families', family, { ...entry, section: rank });
    if (m.boss) c.file('Encounter rank', 'Bosses', entry);
    if (m.elite) c.file('Encounter rank', 'Elites', entry);
    if (m.rare) c.file('Encounter rank', 'Rare enemies', entry);
    if (!m.boss && !m.elite && !m.rare) c.file('Encounter rank', 'Other creatures', entry);
  }
  for (const d of DUNGEON_LIST)
    for (const spawn of d.spawns) {
      const m = MOBS[spawn.mobId],
        title = w.titleBy.mob.get(spawn.mobId);
      if (title && m)
        c.file('Dungeon spawn lists', d.name, { title, name: m.name, section: families[m.family] });
    }
  c.publish();
}

function abilityPortal(w: Writer) {
  const c = catalog(
    w,
    'Abilities',
    'Choose a class for its spellbook, including granted actions. The spell school index groups abilities across all classes. Open an ability for its unlock conditions, ranks, costs and scaling.',
  );
  for (const [id, title] of w.titleBy.ability) {
    const ability = ABILITIES[id];
    const cls = abilityIndexGroup(ability),
      school = display(ability.school);
    c.file(cls === 'Item actions' ? 'Other sources' : 'Class spellbooks', cls, {
      title,
      name: ability.name,
      section: CLASSES[ability.class].abilities.includes(id)
        ? 'Level ' + ability.learnLevel
        : 'Additional actions',
    });
    c.file('Schools', school, { title, name: ability.name, section: cls });
  }
  c.publish();
}

function npcPortal(w: Writer) {
  const c = catalog(
    w,
    'NPCs',
    'Look for the service you need or browse by location. Quest contacts can appear in both the starting and hand-in lists.',
  );
  const givers = new Set(Object.values(QUESTS).map((q) => q.giverNpcId));
  const recipients = new Set(Object.values(QUESTS).flatMap(questTurnInNpcIds));
  for (const [id, title] of w.titleBy.npc) {
    const n = BUILTIN_WORLD.npcs[id] ?? NPCS[id];
    const role = npcRoleFor(n);
    const service = role ? t(`hudChrome.nameplate.npcRole.${role}`) : 'Other residents';
    const zone =
      !n.dynamic || n.fixedPost || n.weeklyEmissary
        ? zoneContaining(n.pos.x, n.pos.z)?.name
        : undefined;
    const rooms = DUNGEON_LIST.filter((d) => d.npcs?.some((s) => s.npcId === id)).map(
      (d) => d.name,
    );
    const areas = zone ? [zone, ...rooms] : rooms.length ? rooms : ['Activity-dependent locations'];
    const entry = { title, name: n.name, section: areas[0] };
    for (const location of areas) c.file('Locations', location, { ...entry, section: service });
    if (role) c.file('Services', service, entry);
    if (givers.has(id)) c.file('Quest contacts', 'Quest givers', entry);
    if (recipients.has(id)) c.file('Quest contacts', 'Quest hand-ins', entry);
  }
  c.publish();
}

export function addCatalogPortals(w: Writer) {
  itemPortal(w);
  enemyPortal(w);
  abilityPortal(w);
  npcPortal(w);
}
