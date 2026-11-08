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
const riftEntrance = 'Follow the realm announcement to the portal in the named zone';
const riftDescent = 'Clear the enemies and puzzle on your current floor, then take its descent';
const hoardDig = 'Read your map and walk to its own X. Use it there to dig';
const hoardBoss = 'Enter the portal and follow the private hoard to its guardian';
const hoardChest = 'Open your reward chest inside the cleared hoard';
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
      'Start steps 1 and 2 from the Finder anywhere. These doors are alternatives. Use the entrance for your selected activity. The Finder rewards you with a group when the proposal is accepted; encounter loot comes from bosses inside your chosen run.',
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
      'Example route through the Hollow Crypt. Start step 1 from your portrait outside the instance. The boss pin marks its starting position; loot the corpse if it moved during combat. Other Heroic runs have their own dungeon articles.',
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
      'Choose one board. The order of the earlier chambers changes by run. Instance pins use the final chamber as their local frame. At the Litany shrines use the order shown in your own rite.',
    ],
  },
  'Delve companions': {
    points: [...halven('Start'), ...halven(1), ...halven(2)],
    notes: [
      'Use either board to select or upgrade your healer. Step 3 follows your character inside the delve. The healer joins you when you enter, and a purchased upgrade takes effect without a hand-in.',
    ],
  },
  'Buried hoards': {
    points: [],
    flow: [hoardDig, hoardBoss, hoardChest],
    notes: [
      'Use the X on your own map. Digging creates the entrance at that site, and the chest is inside the private room. These positions depend on your map and run.',
    ],
  },
  'Hoard encounters': {
    points: [],
    flow: [hoardBoss, 'Defeat the guardian using its encounter instructions', hoardChest],
    notes: [
      'The map rarity and seed select the room and guardian. Your reward chest is placed inside your own hoard after the kill.',
    ],
  },
  Lockpicking: {
    points: [
      room('Start', reliquary, reliquaryChest, 'Example lock: final reward chest'),
      room(1, reliquary, reliquaryChest, 'Select an ante'),
      room('Reward', reliquary, reliquaryChest, 'Chest reward'),
    ],
    notes: [
      'This is the fixed delve chest. Steps 2 and 3 take place on its lock board. For a rift cache, use the cache you find on the current floor; its position changes each run.',
    ],
  },
  'Clue hunts': {
    points: cluePoints,
    notes: [
      'Example route for Ashes at the Gate. Start step 1 anywhere by using a scroll in your bags. Follow the clue numbers printed beside the pins. If you drew a different hunt, its linked article gives its own sequence and dig coordinates.',
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
      'Earn your weekly milestones in the qualifying activities before visiting the keeper after reset. All claim steps use the same window.',
    ],
  },
  Rifts: {
    points: [],
    flow: [riftEntrance, riftDescent, 'Loot the final boss and take the exit'],
    notes: [
      'A live portal chooses its own site, and each run generates its own rooms. Use your live map, tracker and opened descents for this run.',
    ],
  },
  'Rift floors': {
    points: [],
    flow: [
      'Enter the open rift and read your current floor tracker',
      riftDescent,
      'Follow the next floor until the final boss; loot it where it falls',
    ],
    notes: [
      'The enemies, puzzle, descent and boss belong to the generated instance. Completing an ordinary floor opens its descent.',
    ],
  },
  'Rift first-clear rewards': {
    points: [
      npcPin(
        2,
        'riftwright_maelis',
        'Optional stop after winning: improve your band at the Rift Forge',
      ),
    ],
    flow: [
      riftEntrance,
      'Clear the floors and defeat the final boss first',
      'Loot the final corpse for shared items and your personal band, Essence and any gem',
    ],
    notes: [
      'The reward is collected inside the changing rift. Maelis is an optional stop afterward.',
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
      'The forging actions take place in one window. Equip the band from your bags in step 3.',
    ],
  },
  Duels: {
    points: [],
    flow: [
      'Meet your chosen opponent within 30 yards',
      'Challenge and accept at the meeting spot',
      'Finish the fight there; the game announces the winner',
    ],
    notes: ['You choose the meeting point. A duel gives no item or coin to collect.'],
  },
  'World PvP': {
    points: [],
    flow: [
      'In an eligible overworld zone, enable World PvP',
      'Find and fight another eligible flagged player',
      'Receive any kill payout at the fight; disarm outside combat and the active hill',
    ],
    notes: [
      'Both players move. The reward is credited where the fight happens. The Proving Shore is excluded.',
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
      'Queue from PvP anywhere. The map shows the Ashen Coliseum floor when assigned. Opponents move after the start. Any rating, Honor and match credit are awarded at the result; there is no turn-in.',
    ],
  },
  'Thornhollow battleground': {
    points: BG_BASES.flatMap((b) => [
      room(
        1,
        'Thornhollow Fields',
        b.spawns[0],
        BG_TEAM_NAMES[b.team] + ' keep: one arrival position',
      ),
      room(
        2,
        'Thornhollow Fields',
        b.flag,
        BG_TEAM_NAMES[b.team] +
          ' flag stand: steal here if this is the enemy keep; score here if it is yours',
      ),
    ]),
    notes: [
      'Queue from PvP anywhere. On assignment, use your team name to identify your home keep. Return the enemy flag to your own stand. Stay until the result for automatic match credit and Honor.',
    ],
  },
  'King of the Hill': {
    points: [],
    flow: [
      'Read the zone announcement and use /hill for the live location',
      'Enter the active 50-yard circle and capture it',
      'Remain inside while holding for Honor; weekly credit is awarded when the hill ends',
    ],
    notes: [
      'A site is selected in The Drakelands, The Frostveil Reach or The Amberfall. The exact hill changes between events.',
    ],
  },
  'Honor and Warfare gear': {
    points: [...vendors('Start'), ...vendors(1), ...vendors('Reward')],
    notes: [
      'Choose either quartermaster. Buy at the same counter in step 2. Equip your purchase from your bags in step 3.',
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
        ? [worldPin(3, field.x, field.z, 'Old Thatchgrin: earn a sheaf at the seasonal field')]
        : []),
      ...hester('Reward', 'exchange five sheaves for the broom or collect purchases'),
    ],
    notes: [
      'Visit the matching counter and eligible townspeople in any of the three towns. The field and stalls appear only during the event. Sweets come from the townsperson; the broom exchange takes place with Hester.',
    ],
  },
  'The Card Master': {
    points: [
      npcPin('Start', 'card_master'),
      npcPin(1, 'card_master', 'Queue at the dealer'),
      npcPin('Reward', 'card_master', 'The match records the win at the card table'),
    ],
    notes: [
      'Play steps 2 and 3 on the card board. A qualifying deed is recorded as soon as the match ends.',
    ],
  },
};
