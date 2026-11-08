/** Player-facing paths through the rules reference. Within each path the first
 * article introduces the activity and later links cover its specific mechanics. */
const sections = [
  {
    title: 'Character progression and combat',
    intro:
      'Choose a build, learn how combat resolves, and see what happens when you level up or die.',
    topics: [
      'Leveling and prestige',
      'Level experience',
      'Character stats',
      'Specialization and talents',
      'Combat',
      'Combat pets',
      'Hunter pets',
      'Death and recovery',
    ],
  },
  {
    title: 'Equipment and upgrades',
    intro: 'Manage your gear, compare set bonuses, and improve pieces you already own.',
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
    intro: 'Pick up quests, earn faction standing, and find your way between settlements.',
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
    intro: 'Find a group, choose a difficulty, or follow a clue to a reward chest.',
    topics: [
      'Dungeon Finder',
      'Heroic difficulty',
      'Delves',
      'Delve companions',
      'Buried hoards',
      'Hoard encounters',
      'Lockpicking',
      'Clue hunts',
      'Weekly Vault',
    ],
  },
  {
    title: 'Rifts',
    intro: 'Prepare for a rift, learn its floor objectives, and spend your rewards.',
    topics: ['Rifts', 'Rift floors', 'Rift first-clear rewards', 'Rift Forge'],
  },
  {
    title: 'Gathering and farming',
    intro: 'Find raw materials in the world or grow a crop at a farm patch.',
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
    intro: 'Choose a trade, check a recipe and its workstation, or take a work order.',
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
    intro: 'Buy or sell an item, send it to another player, or put it in storage.',
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
    intro: 'Coordinate with other players, share loot, or work together on a guild contract.',
    topics: ['Friends and chat', 'Parties', 'Party loot', 'Guilds', 'Guild contracts', 'Calendar'],
  },
  {
    title: 'Player versus player',
    intro:
      'Compare duels, battles in the open world and queued matches, then check what Honor buys.',
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
    intro: 'Track deeds and relics, find a companion, or change how your mount or weapon looks.',
    topics: [
      'Book of Deeds',
      'The Reliquary',
      'Companions',
      'Mount appearances',
      'Weapon appearances',
    ],
  },
  {
    title: 'Events and minigames',
    intro:
      'Visit the Card Master for a duel, or check the activities offered while Gourdlight Eve is active.',
    topics: ['Gourdlight Eve', 'The Card Master'],
  },
  {
    title: 'Retired and unavailable activities',
    intro:
      'Look up former rules and deeds. The Mount racing entry also explains the stable course retained in the riding lesson data.',
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
    intro: 'Check membership benefits, referrals, mobile controls and ways to play with agents.',
    topics: ['Membership', 'Referral cards', 'Mobile Play', 'Agents and Bots'],
  },
] as const;

export function systemDirectory(groups: ReadonlyMap<string, { title: string }>): string {
  const remaining = new Set(groups.keys());
  const body = [
    'Choose a system for its starting point, requirements, steps and rewards. Retired activities are listed separately with their former rules.',
  ];
  for (const section of sections) {
    const links: string[] = [];
    for (const topic of section.topics) {
      const page = groups.get(topic);
      if (!page) continue;
      if (!remaining.delete(topic)) throw new Error('Duplicate system directory entry: ' + topic);
      links.push(page.title === topic ? `* [[${topic}]]` : `* [[${page.title}|${topic}]]`);
    }
    if (links.length) body.push(`== ${section.title} ==\n${section.intro}\n\n${links.join('\n')}`);
  }
  if (remaining.size)
    throw new Error('Choose a system directory section for: ' + [...remaining].join(', '));
  return body.join('\n\n');
}
