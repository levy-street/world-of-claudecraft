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
  const roots = [
    'Items',
    'Quests',
    'Mobs',
    'Abilities',
    'NPCs',
    'Zones',
    'Dungeons',
    'Classes',
    'Gameplay Systems',
  ];
  const trails = new Map();
  for (const title of roots) {
    if (!pages.has(title)) continue;
    const root = { title, label: title === 'Mobs' ? 'Enemies' : title };
    const queue = [[root]];
    const visited = new Set();
    for (let i = 0; i < queue.length; i++) {
      const trail = queue[i],
        here = trail[trail.length - 1].title;
      if (visited.has(here)) continue;
      visited.add(here);
      const page = pages.get(here);
      for (const line of page.text.split('\n')) {
        if (!line.startsWith('* ')) continue;
        const child = directoryLink(line.slice(2));
        if (
          !child ||
          roots.includes(child.title) ||
          visited.has(child.title) ||
          !pages.has(child.title)
        )
          continue;
        if (isCollection(page) && pages.get(child.title).categories[0] !== page.title) continue;
        if (!trails.has(child.title)) trails.set(child.title, trail);
        if (isDirectory(pages.get(child.title))) queue.push([...trail, child]);
      }
    }
  }
  return trails;
}
