/** Player-facing paths through the rules reference. Within each path the first
 * article introduces the activity and later links cover its specific mechanics. */
const sections = [
  {
    title: 'Character progression and combat',
    intro: 'Pick a build, learn how fights work, and see what happens when you level up or die.',
    topics: [
      'Leveling and prestige',
      'Level experience',
      'Character stats',
      'Specialization and talents',
      'Combat',
      'Death and recovery',
    ],
  },
  {
    title: 'Pets and companions',
    intro:
      'Tame or summon a pet that fights for you. Take a companion into delves to fight beside you. Or collect a companion that just follows you around for fun.',
    topics: ['Combat pets', 'Hunter pets', 'Delve companions', 'Companions'],
  },
  {
    title: 'Equipment and upgrades',
    intro: 'Look after your gear, compare set bonuses, and make the pieces you own better.',
    topics: [
      'Equipment and inventory',
      'Equipment sets',
      'Vanguard equipment',
      'Equipment enchants',
      'Perfecting and promotion',
    ],
  },
  {
    title: 'Questing and travel',
    intro: 'Pick up quests, earn standing with factions, and find your way from town to town.',
    topics: [
      'Questing',
      'Faction standing',
      'Overworld passages',
      'Swimming and climbing',
      'Ferries',
      'Mounts and riding',
      'Allied Hearthstone',
    ],
  },
  {
    title: 'Dungeons, delves and treasure',
    intro: 'Find a group, pick a difficulty, or follow a clue to a treasure chest.',
    topics: [
      'Dungeon Finder',
      'Heroic difficulty',
      'Delves',
      'Buried hoards',
      'Hoard encounters',
      'Lockpicking',
      'Clue hunts',
      'Weekly Vault',
    ],
  },
  {
    title: 'Rifts',
    intro: 'Get ready for a rift, learn the goal on each floor, and spend your rewards.',
    topics: ['Rifts', 'Rift floors', 'Rift first-clear rewards', 'Rift Forge'],
  },
  {
    title: 'Gathering and farming',
    intro: 'Find materials out in the world, or grow crops at a farm patch.',
    topics: [
      'Harvesting and gathering',
      'Mining',
      'Logging',
      'Herbalism',
      'Fishing',
      'Farming',
      'Farm crops',
    ],
  },
  {
    title: 'Crafting professions',
    intro: 'Pick a craft, check a recipe and where to make it, or take a work order.',
    topics: [
      'Professions',
      'Crafting recipes',
      'Crafting stations',
      'Profession work orders',
      'Masterwork crafting',
      'Alchemy',
      'Armorcrafting',
      'Cooking',
      'Enchanting',
      'Engineering',
      'Inscription',
      'Jewelcrafting',
      'Leatherworking',
      'Tailoring',
      'Weaponcrafting',
    ],
  },
  {
    title: 'Trade, currency and storage',
    intro: 'Buy or sell items, send them to other players, or store them safely.',
    topics: [
      'Vendors and currencies',
      'Trading',
      'World Market',
      'Mail',
      'Banking',
      'Bank courier',
      'Materials Vault',
    ],
  },
  {
    title: 'Parties, guilds and communication',
    intro: 'Team up with other players, share loot, or work together on a guild contract.',
    topics: ['Friends and chat', 'Parties', 'Party loot', 'Guilds', 'Guild contracts', 'Calendar'],
  },
  {
    title: 'Player versus player',
    intro:
      'Fight other players in duels, out in the open world or in matches you queue for. Then see what you can buy with Honor.',
    topics: [
      'Duels',
      'World PvP',
      'Ashen Coliseum',
      'Thornhollow battleground',
      'King of the Hill',
      'Honor and Warfare gear',
    ],
  },
  {
    title: 'Collections and appearances',
    intro: 'Keep track of deeds and relics, or change how your mount or weapon looks.',
    topics: ['Book of Deeds', 'The Reliquary', 'Mount appearances', 'Weapon appearances'],
  },
  {
    title: 'Events and minigames',
    intro:
      'Visit the Card Master for a card duel, or see what you can do while Gourdlight Eve is on.',
    topics: ['Gourdlight Eve', 'The Card Master'],
  },
  {
    title: 'Retired and unavailable activities',
    intro:
      'Read the old rules and deeds for activities you can no longer play. The Mount racing page also explains the jumping course that is still used in the riding lesson.',
    topics: [
      'Protect Yumi',
      'Fiesta arena',
      'Fiesta augments',
      'Fiesta power-ups',
      'Vale Cup',
      'Mount racing',
    ],
  },
  {
    title: 'Account and play options',
    intro:
      'See what membership gives you, how inviting friends works, how to play on a phone or tablet, and how computer programs (agents) can play.',
    topics: ['Membership', 'Referral cards', 'Mobile Play', 'Agents and Bots'],
  },
] as const;

// Directory labels where the page name alone is ambiguous.
const TOPIC_LABELS: Record<string, string> = { Companions: 'Cosmetic companions' };

/** Topic pages listed under one systems path, minus its overview articles. */
export function directoryTopics(title: string, skip: readonly string[] = []): string[] {
  return (sections.find((s) => s.title === title)?.topics ?? []).filter((t) => !skip.includes(t));
}

export function systemDirectory(groups: ReadonlyMap<string, { title: string }>): string {
  const remaining = new Set(groups.keys());
  const body = [
    'Pick a topic to learn where to start, what you need, what to do and what you get. Activities you can no longer play have their own list, with their old rules.',
  ];
  for (const section of sections) {
    const links: string[] = [];
    for (const topic of section.topics) {
      const page = groups.get(topic);
      if (!page) continue;
      if (!remaining.delete(topic)) throw new Error('Duplicate system directory entry: ' + topic);
      const label = TOPIC_LABELS[topic] ?? topic;
      links.push(page.title === label ? `* [[${label}]]` : `* [[${page.title}|${label}]]`);
    }
    if (links.length) body.push(`== ${section.title} ==\n${section.intro}\n\n${links.join('\n')}`);
  }
  if (remaining.size)
    throw new Error('Choose a system directory section for: ' + [...remaining].join(', '));
  return body.join('\n\n');
}
