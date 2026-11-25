import { BG_BASES, BG_TEAM_NAMES } from '../../src/sim/battleground_layout';
import { CLUE_HUNTS, CLUE_STEP_RADIUS } from '../../src/sim/content/clue_hunts';
import { COLLAPSED_RELIQUARY_MODULES } from '../../src/sim/content/delves/collapsed_reliquary';
import { DROWNED_LITANY_MODULES } from '../../src/sim/content/delves/drowned_litany';
import { FINDER_ACTIVITIES } from '../../src/sim/content/dungeon_finder';
import { TRICK_OR_TREAT_NPCS } from '../../src/sim/content/gourdlight_eve';
import { DUNGEONS, MOBS, ZONES } from '../../src/sim/data';
import { LITANY_APSE_LAYOUT, RELIQUARY_FINALE_LAYOUT } from '../../src/sim/delve_layout';
import { riteSiteLocalOffsets } from '../../src/sim/delves/drowned_litany_rite';
import {
  ARENA_SPAWN_A,
  ARENA_SPAWN_B,
  ARENA_SPAWNS_A_2v2,
  ARENA_SPAWNS_B_2v2,
} from '../../src/sim/dungeon_layout';
import { resolveScarecrowField } from '../../src/sim/seasonal/scarecrow_field';
import { resolvedKeeperPosts } from '../../src/sim/seasonal_keeper_posts';
import { WORLD_SEED } from '../../src/sim/world_seed';
import { npcPin, type SystemRoute, type SystemStep, worldPin } from './system_route_points';

const room = (step: SystemStep, frame: string, p: { x: number; z: number }, label: string) => ({
  step,
  frame,
  x: p.x,
  z: p.z,
  label,
});
const crypt = DUNGEONS.hollow_crypt;
const morthen = crypt.spawns.find((s) => s.mobId === 'morthen')!;
const riftEntrance = 'Follow the realm message to the portal in the zone it names';
const riftDescent = 'Beat the enemies and solve the puzzle on your floor, then take the way down';
const hoardDig = 'Read your map and walk to its X. Use the map there to dig';
const hoardBoss = 'Go through the portal and follow your private hoard to its guardian';
const hoardChest = 'Open your reward chest inside the hoard after the guardian falls';
const halven = (step: SystemStep) => [
  npcPin(step, 'brother_halven', 'Brother Halven: Collapsed Reliquary board'),
  npcPin(step, 'brother_halven_marsh', 'Brother Halven: Drowned Litany board'),
];
const vendors = (step: SystemStep) => [
  npcPin(step, 'fury', 'FURY: Eastbrook Honor shop'),
  npcPin(step, 'warmarshal_draven_kole', 'Warmarshal Draven Kole: Highwatch Honor shop'),
];
const reliquary = 'The Collapsed Reliquary, final chamber';
const litany = 'The Drowned Litany, final chamber';
const reliquaryDais = RELIQUARY_FINALE_LAYOUT.dais!;
const reliquaryChest = { x: 0, z: reliquaryDais.z - 14 }; // delves/runs.ts, spawn reward chest
const rite = riteSiteLocalOffsets(LITANY_APSE_LAYOUT.dais!);
const finaleBoss = (frame: string, spawn: { mobId: string; x: number; z: number }) =>
  room(2, frame, spawn, 'Defeat ' + MOBS[spawn.mobId].name);
const field = resolveScarecrowField(WORLD_SEED);
const stalls = resolvedKeeperPosts(WORLD_SEED);
const hester = (step: SystemStep, action: string) =>
  stalls.map((s) => worldPin(step, s.pos.x, s.pos.z, 'Hester Gourdwick: ' + action));
const exampleHunt = CLUE_HUNTS.find((h) => h.id === 'hunt_drakelands_gate_ashes')!;
const cluePoints = exampleHunt.steps.flatMap((s, i) => {
  const ordinal = 'Ashes at the Gate, clue ' + (i + 1) + ': ';
  if (s.kind === 'dig')
    return [
      worldPin(3, s.x, s.z, ordinal + 'dig with a scroll', CLUE_STEP_RADIUS),
      worldPin('Reward', s.x, s.z, 'Receive the Treasure Casket here; open it in your bags'),
    ];
  if (s.kind === 'landmark' || s.kind === 'emote') {
    const poi = ZONES.find((z) => z.id === s.zoneId)!.pois.find((p) => p.id === s.poiId)!;
    return [worldPin(2, poi.x, poi.z, ordinal + 'visit ' + poi.label, CLUE_STEP_RADIUS)];
  }
  return [
    npcPin(
      2,
      s.npcId,
      ordinal +
        (s.kind === 'deliver'
          ? 'give two Baked Bread to Quartermaster Sela'
          : 'speak to Scout Yerrin'),
    ),
  ];
});

export const activityRoutes: Record<string, SystemRoute> = {
  'Dungeon Finder': {
    points: [...new Set(FINDER_ACTIVITIES.map((a) => a.entranceDungeonId))].map((id) => {
      const d = DUNGEONS[id];
      return worldPin(3, d.doorPos.x, d.doorPos.z, 'Entrance for ' + d.name);
    }),
    notes: [
      'You can do steps 1 and 2 from the Finder anywhere. You only need one of these doors: use the entrance for the activity you picked. The Finder gives you a group when everyone accepts. Loot comes from the bosses inside your run.',
    ],
  },
  'Heroic difficulty': {
    points: [
      worldPin(2, crypt.doorPos.x, crypt.doorPos.z, 'Example Heroic entrance: ' + crypt.name),
      room(2, crypt.name, morthen, 'Final boss spawn: ' + MOBS[morthen.mobId].name),
      room('Reward', crypt.name, morthen, 'Loot the final boss where it falls'),
      npcPin(3, 'heroic_quartermaster', 'Quartermaster Vex: spend your Heroic Marks here'),
    ],
    notes: [
      'This example route goes through the Hollow Crypt. Do step 1 from your portrait, outside the dungeon. The boss pin shows where the boss starts. If it moved during the fight, loot its body where it fell. Other Heroic runs are on their own dungeon pages.',
    ],
  },
  Delves: {
    points: [
      ...halven('Start'),
      ...halven(1),
      finaleBoss(reliquary, COLLAPSED_RELIQUARY_MODULES.reliquary_finale.spawnSets[0].spawns[0]),
      finaleBoss(litany, DROWNED_LITANY_MODULES.litany_apse.spawnSets[0].spawns[0]),
      room(3, reliquary, reliquaryChest, 'Pick the lock'),
      room('Reward', reliquary, reliquaryChest, 'Collect the clear rewards'),
      room(3, litany, rite.reliquary, 'Begin the shrine rite'),
      ...Object.entries(rite.shrines).map(([kind, p]) =>
        room(3, litany, p, 'Rite shrine: ' + kind.slice('rite_shrine_'.length)),
      ),
      room('Reward', litany, rite.reliquary, 'Collect your loot at the open reliquary'),
    ],
    notes: [
      'Pick one board. The earlier chambers come in a different order each run. Pins inside the delve use coordinates that start from the final chamber. At the Litany shrines, use the order your own rite shows you.',
    ],
  },
  'Delve companions': {
    points: [...halven('Start'), ...halven(1), ...halven(2)],
    notes: [
      'Use either board to pick or upgrade your healer. Step 3 happens with you inside the delve. The healer joins you when you go in. An upgrade you buy works right away, with nothing to hand in.',
    ],
  },
  'Buried hoards': {
    points: [],
    flow: [hoardDig, hoardBoss, hoardChest],
    notes: [
      'Use the X on your own map. Digging opens the entrance at that spot. The chest is inside your private room. These places depend on your map and your run.',
    ],
  },
  'Hoard encounters': {
    points: [],
    flow: [hoardBoss, 'Defeat the guardian using its encounter instructions', hoardChest],
    notes: [
      'The map’s rarity and its random seed pick the room and the guardian. After the kill, your reward chest appears inside your own hoard.',
    ],
  },
  Lockpicking: {
    points: [
      room('Start', reliquary, reliquaryChest, 'Example lock: final reward chest'),
      room(1, reliquary, reliquaryChest, 'Select an ante'),
      room('Reward', reliquary, reliquaryChest, 'Chest reward'),
    ],
    notes: [
      'This is the delve chest, which is always in the same place. Steps 2 and 3 happen on its lock board. For a rift cache, use the cache you find on your floor. It is in a different place each run.',
    ],
  },
  'Clue hunts': {
    points: cluePoints,
    notes: [
      'This example route is for Ashes at the Gate. Do step 1 anywhere by using a scroll in your bags. Follow the clue numbers next to the pins. If you got a different hunt, its own page lists its steps and dig coordinates.',
    ],
  },
  'Weekly Vault': {
    points: [
      npcPin('Start', 'eastbrook_vault_keeper'),
      npcPin(1, 'eastbrook_vault_keeper', 'Open Weekly Rewards'),
      npcPin(2, 'eastbrook_vault_keeper', 'Reveal choices and confirm one claim'),
      npcPin('Reward', 'eastbrook_vault_keeper', 'Receive your selected item'),
    ],
    notes: [
      'Reach your weekly goals in activities that count. Then visit the Keeper after the reset. Every claim step happens in the same window.',
    ],
  },
  Rifts: {
    points: [],
    flow: [riftEntrance, riftDescent, 'Loot the final boss and take the exit'],
    notes: [
      'Each portal picks its own spot, and each run makes its own rooms. Use your map, your tracker and the ways down that open in this run.',
    ],
  },
  'Rift floors': {
    points: [],
    flow: [
      'Go into the open rift and read the tracker for your floor',
      riftDescent,
      'Keep going floor by floor to the final boss. Loot it where it falls',
    ],
    notes: [
      'The enemies, puzzle, way down and boss are made fresh for each run. Finishing a normal floor opens its way down.',
    ],
  },
  'Rift first-clear rewards': {
    points: [
      npcPin(
        2,
        'riftwright_maelis',
        'Optional stop after you win: make your band better at the Rift Forge',
      ),
    ],
    flow: [
      riftEntrance,
      'Clear the floors and defeat the final boss before any other group',
      'Loot the final boss for shared items, plus your own band, Essence and any gem',
    ],
    notes: [
      'You pick up the reward inside the rift, which is different every time. Visiting Maelis afterward is optional.',
    ],
  },
  'Rift Forge': {
    points: [
      npcPin('Start', 'riftwright_maelis'),
      npcPin(1, 'riftwright_maelis', 'Upgrade a band in your bag'),
      npcPin(2, 'riftwright_maelis', 'Socket a gem'),
      npcPin('Reward', 'riftwright_maelis', 'The band in your bag gains the upgrade or socket'),
    ],
    notes: [
      'Everything at the forge happens in one window. In step 3, put the band on from your bags.',
    ],
  },
  Duels: {
    points: [],
    flow: [
      'Meet the player you want to fight, within 30 yards',
      'Send the challenge and accept it where you meet',
      'Finish the fight there. The game says who won',
    ],
    notes: ['You pick where to meet. A duel gives no item or coin to collect.'],
  },
  'World PvP': {
    points: [],
    flow: [
      'In an outdoor zone that allows it, turn on World PvP',
      'Find and fight another flagged player who counts for rewards',
      'Get any kill reward where the fight happens. Turn your flag off when you are out of combat and out of the active hill',
    ],
    notes: [
      'Both players move around, so there is no fixed spot. The reward is given where the fight happens. The Proving Shore does not count.',
    ],
  },
  'Ashen Coliseum': {
    points: [
      room(2, 'Ashen Coliseum', ARENA_SPAWN_A, '1v1: side A arrives'),
      room(2, 'Ashen Coliseum', ARENA_SPAWN_B, '1v1: side B arrives'),
      ...ARENA_SPAWNS_A_2v2.map((p) => room(2, 'Ashen Coliseum', p, '2v2: side A arrives')),
      ...ARENA_SPAWNS_B_2v2.map((p) => room(2, 'Ashen Coliseum', p, '2v2: side B arrives')),
    ],
    notes: [
      'You can join the queue from the PvP window anywhere. The map shows the Ashen Coliseum floor once you are placed in a match. Your opponents move once the fight starts. Rating, Honor and match credit are given at the result. There is nothing to hand in.',
    ],
  },
  'Thornhollow battleground': {
    points: BG_BASES.flatMap((b) => [
      room(
        1,
        'Thornhollow Fields',
        b.spawns[0],
        BG_TEAM_NAMES[b.team] + ' keep: one place where you arrive',
      ),
      room(
        2,
        'Thornhollow Fields',
        b.flag,
        BG_TEAM_NAMES[b.team] +
          ' flag stand: grab the flag here if this is the enemy keep, or score here if it is yours',
      ),
    ]),
    notes: [
      'You can join the queue from the PvP window anywhere. When you are placed in a match, your team name tells you which keep is yours. Bring the enemy flag back to your own stand. Stay until the result. Match credit and Honor are then given to you automatically.',
    ],
  },
  'King of the Hill': {
    points: [],
    flow: [
      'Read the realm message for the zone, and type /hill to see where the hill is now',
      'Enter the active 50-yard circle and capture it',
      'Stay inside while your party holds it to earn Honor. Weekly credit is given when the hill ends',
    ],
    notes: [
      'The hill is in The Drakelands, The Frostveil Reach or The Amberfall. Its exact spot changes each time.',
    ],
  },
  'Honor and Warfare gear': {
    points: [...vendors('Start'), ...vendors(1), ...vendors('Reward')],
    notes: [
      'Go to either quartermaster. In step 2, buy at the same counter. In step 3, put on what you bought from your bags.',
    ],
  },
  'Gourdlight Eve': {
    points: [
      ...hester('Start', 'seasonal counter'),
      ...Object.values(TRICK_OR_TREAT_NPCS).map((ids) =>
        npcPin(1, ids[0], 'Example trick-or-treat stop'),
      ),
      ...hester(2, 'exchange sweets'),
      ...(field
        ? [
            worldPin(
              3,
              field.x,
              field.z,
              'Old Thatchgrin: fight him at the seasonal field to earn a sheaf',
            ),
          ]
        : []),
      ...hester('Reward', 'trade five sheaves for the broom, or pick up what you bought'),
    ],
    notes: [
      'Visit the counter and the townspeople who take part in any of the three towns. The field and stalls only show up during the event. Sweets come from the townspeople. You trade for the broom with Hester.',
    ],
  },
  'The Card Master': {
    points: [
      npcPin('Start', 'card_master'),
      npcPin(1, 'card_master', 'Queue at the dealer'),
      npcPin('Reward', 'card_master', 'The match records the win at the card table'),
    ],
    notes: [
      'Play steps 2 and 3 on the card board. If you earn a deed, it is saved as soon as the match ends.',
    ],
  },
};
