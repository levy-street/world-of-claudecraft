// Keep the family navigation small. Inside a catalog, the generated indexes determine the path.
export const subjects = [
  [
    'Equipment and crafting',
    [
      ['Items', 'Items', 'Browse equipment by slot, consumables and materials'],
      ['Crafting recipes', 'Crafting recipes', 'Ingredients, skill requirements and crafted items'],
      ['Professions', 'Professions', 'Learn trades and progress in your craft'],
    ],
  ],
  [
    'World and adventures',
    [
      ['Quests', 'Quests', 'Find a quest by starting zone or activity'],
      ['Zones', 'Zones', 'Level ranges, settlements and points of interest'],
      ['Dungeons', 'Dungeons and raids', 'Entrances, encounters and difficulty'],
      ['Mobs', 'Enemies', 'Creature families, bosses and loot'],
      ['NPCs', 'NPCs', 'Quest givers, services and vendors'],
    ],
  ],
  [
    'Characters and combat',
    [
      ['Classes', 'Classes', 'Starting stats and class kits'],
      ['Abilities', 'Abilities', 'Costs, ranks and scaling by class'],
      ['Specializations', 'Specializations', 'Masteries and build choices'],
      ['Talent choices', 'Talent choices', 'Options at each level'],
    ],
  ],
  [
    'Systems and collections',
    [
      ['Gameplay Systems', 'Game systems', 'Find the rules for an activity'],
      ['Book of Deeds', 'Book of Deeds', 'Deed requirements and rewards'],
      ['Mounts and riding', 'Mounts and riding', 'Training and mount collections'],
      ['The Reliquary', 'The Reliquary', 'Relics and collection progress'],
    ],
  ],
];

// The page heading players see. Hub titles stay stable for links; only the label changes.
const HUB_HEADINGS = { Dungeons: 'Dungeons and raids', Mobs: 'Enemies' };
export function displayTitle(title) {
  return (
    HUB_HEADINGS[title] ??
    title.replace(/ \((?:Items|Abilities|NPCs|Enemies) index\)(?: \(\d+\))?$/, '')
  );
}

// The first few entry names a group page lists, so a tile can say what is inside it.
export function tilePreview(text, limit = 3) {
  const names = [];
  for (const match of text.matchAll(
    /^\* (?:<woc-art [^>]*\/> )?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gm,
  )) {
    const name = match[2] ?? match[1];
    if (!names.includes(name)) names.push(name);
    if (names.length === limit) break;
  }
  return names;
}

// Hubs built as tables (a class per row); their cells link the pages they index.
const TABLE_HUBS = new Set(['Specializations', 'Talent choices']);

export function directoryLink(line) {
  const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(line);
  return match ? { title: match[1], label: match[2] ?? match[1] } : null;
}

export function isCollection(page) {
  return (
    page.categories.includes('Collection directories') ||
    (page.categories.includes('Systems') && page.text.includes('== Entries =='))
  );
}

export function isDirectory(page) {
  return (
    page &&
    (page.categories.includes('Portals') ||
      isCollection(page) ||
      ['Gameplay Systems', 'World quests', 'Weekly quests'].includes(page.title))
  );
}

// Build real return paths from registry-generated directory links. Links embedded in
// article prose (a reagent, quest reward, etc.) never become a navigational parent.
export function browseTrails(pages) {
  // Same hubs as the left navigation, specific collections before the systems hub that
  // also lists them, so a deed reads Book of Deeds and not Game systems.
  const roots = [
    'Items',
    'Crafting recipes',
    'Professions',
    'Quests',
    'Mobs',
    'Abilities',
    'NPCs',
    'Zones',
    'Dungeons',
    'Classes',
    'Specializations',
    'Talent choices',
    'Book of Deeds',
    'Mounts and riding',
    'The Reliquary',
    'Gameplay Systems',
  ];
  const isRaid = (page) => page?.categories.includes('Raids');
  const childLinks = (page) => {
    const links = [];
    for (const line of page.text.split('\n')) {
      if (line.startsWith('* ')) {
        const child = directoryLink(line.slice(2));
        if (child) links.push(child);
      } else if (TABLE_HUBS.has(page.title) && /^[|!]/.test(line)) {
        for (const m of line.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g))
          links.push({ title: m[1], label: m[2] ?? m[1] });
      }
    }
    return links;
  };
  const trails = new Map();
  for (const title of roots) {
    if (!pages.has(title)) continue;
    const root = { title, label: displayTitle(title) };
    const queue = [[root]];
    const visited = new Set();
    for (let i = 0; i < queue.length; i++) {
      const trail = queue[i],
        here = trail[trail.length - 1].title;
      if (visited.has(here)) continue;
      visited.add(here);
      const page = pages.get(here);
      for (const child of childLinks(page)) {
        if (roots.includes(child.title) || visited.has(child.title) || !pages.has(child.title))
          continue;
        const target = pages.get(child.title);
        if (isCollection(page) && target.categories[0] !== page.title) continue;
        // A raid page is an article, but its room list is the only way into its rooms.
        if (isRaid(page) && !target.categories.includes('Dungeons')) continue;
        if (!trails.has(child.title)) trails.set(child.title, trail);
        if (isDirectory(target) || isRaid(target)) queue.push([...trail, child]);
      }
    }
  }
  return trails;
}
