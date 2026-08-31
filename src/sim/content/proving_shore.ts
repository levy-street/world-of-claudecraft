// The Proving Shore (levels 1-2). A small tutorial island in the starter sea
// WEST of Eastbrook Vale (negative x; the compass renders +x as east, see
// src/ui/compass.ts: facing 0 = +Z = north, bearing 90 = east = +x), the
// free mirror of the Farshore's slot on the opposite column. New
// characters are offered passage here by Wayfarer Bryn at the Eastbrook
// spawn (the tutorial greeting dialog, src/sim/tutorial/greeting.ts); the
// island itself is a training camp: an on-rails quest chain that teaches
// fighting, looting, then the two mechanics lessons (the professions wheel,
// the bank and bag slots, each explained in dialogue with its facts mirrored
// from the sim, and each naming the literal key or click it needs), pays enough
// copper to buy the bank lesson's Linen Pouch mid-chain AND the full tier-1
// gathering tool set at the vale's own counters after (the island vendor
// deliberately stocks NO professions tools, the R37 rule
// tests/professions_zone_rollout.test.ts enforces), and pays enough quest
// experience that a graduate steps onto the vale at level 3, ready for the
// vale's own opening chain (the XP window is pinned in
// tests/proving_shore_content.test.ts). The way back is the Old Pier's clicked ferry bell
// (setting graduates down in Eastbrook town), and the vale west strand's
// twin bell rings a returning player back in for a refresher. Terrain: the
// PS_* tables in world.ts (biome 'vale': the island shares the vale's sky
// and palette; its song is its own dawn cue, the proving_shore zone theme,
// a supplied stream-only track wired in src/game/music_tracks.ts with its
// audition record under docs/music/proving-shore-candidates).

import type {
  CampDef,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  PortalDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';
import { emptyZoneProps } from '../types';

/** The island's zone rectangle, the one source for the ZoneDef below and the
 *  isOnProvingShore predicate. */
const PROVING_SHORE_RECT = { xMin: -540, xMax: -180, zMin: -180, zMax: 180 } as const;

/** Whether a world position lies inside the Proving Shore's zone rectangle.
 *  The island shares its x column (xMin -540 / xMax -180) with four mainland
 *  zones (Willowfen, Palmreach, Nightbloom, Amberfall) that differ only by z,
 *  so EVERY island gate, sim-side or client-side, must test BOTH axes through
 *  this one predicate; a bare `x < -180` check puts level 18 to 20 zones on
 *  the tutorial rail. */
export function isOnProvingShore(x: number, z: number): boolean {
  return (
    x >= PROVING_SHORE_RECT.xMin &&
    x < PROVING_SHORE_RECT.xMax &&
    z >= PROVING_SHORE_RECT.zMin &&
    z < PROVING_SHORE_RECT.zMax
  );
}

export const PROVING_SHORE_ZONE: ZoneDef = {
  id: 'proving_shore',
  name: 'The Proving Shore',
  ...PROVING_SHORE_RECT,
  levelRange: [1, 2],
  biome: 'vale',
  hub: { x: -300, z: 50, radius: 14, name: 'Dawnrest Camp' },
  graveyard: { x: -324, z: 58 },
  lakes: [],
  pois: [
    { x: -300, z: 50, label: 'Dawnrest Camp', id: 'dawnrest_camp' },
    { x: -280, z: 0, label: 'The Old Pier', id: 'the_old_pier' },
    { x: -336, z: -14, label: 'The Practice Yard', id: 'the_practice_yard' },
    { x: -380, z: -42, label: 'The Wreck Line', id: 'the_wreck_line' },
    { x: -306, z: -22, label: 'The Gauntlet', id: 'the_gauntlet' },
  ],
  welcome:
    'The Proving Shore asks nothing of you but time. Learn the camp, strike the effigies, walk the wreck line, and when you are ready, Ferryman Odo will see you across to the vale.',
  welcomeQuestId: 'q_ps_the_gauntlet',
};

export const PROVING_SHORE_ROADS: { x: number; z: number }[][] = [
  [
    { x: -280, z: 2 },
    { x: -290, z: 26 },
    { x: -300, z: 48 },
  ], // the Old Pier -> Dawnrest Camp
  [
    { x: -298, z: 46 },
    { x: -290, z: 14 },
    { x: -286, z: -14 },
  ], // Dawnrest Camp -> the Gauntlet's gate (the movement course on the south strand)
  [
    { x: -286, z: -16 },
    { x: -296, z: -16 },
    { x: -308, z: -16 },
    { x: -308, z: -24 },
    { x: -308, z: -32 },
    { x: -318, z: -32 },
    { x: -328, z: -32 },
    { x: -334, z: -32.5 },
  ], // the Gauntlet's own running line: lane 1 west, lane 2 south, lane 3 west.
  //   Authored as a road on purpose: the dirt track paints the running line
  //   between the walls, and road-side flora suppression (world.ts
  //   terrainCalmAt, foliage roadDistance gates) keeps trees out of the lanes.
  [
    { x: -311, z: -13 },
    { x: -308, z: -16 },
  ], // the Gauntlet's north-west corner pocket: the running line's spline
  //   rounds the L inward, and the 5 yd tree-suppression band around it
  //   left this outer corner unswept, so a pine could stand inside the walls.
  [
    { x: -311, z: -29 },
    { x: -308, z: -32 },
  ], // the same sweep for the second elbow's outer corner pocket.
  [
    { x: -300, z: 48 },
    { x: -310, z: 46 },
    { x: -318, z: 44 },
    { x: -325, z: 42 },
  ], // Dawnrest Camp -> Bursar Wick's strongbox desk
  [
    { x: -334, z: -10 },
    { x: -352, z: -18 },
    { x: -370, z: -28 },
    { x: -390, z: -33 },
    { x: -383, z: -41 },
  ], // the Practice Yard -> the Wreck Line (the south-west strand)
  [
    { x: -335, z: -33 },
    { x: -337, z: -24 },
    { x: -336, z: -14 },
  ], // the Gauntlet's finish (Overseer Pell) -> the Practice Yard
  [
    { x: -380, z: -41 },
    { x: -388, z: -28 },
    { x: -370, z: -14 },
    { x: -354, z: -3 },
    { x: -339, z: 9 },
  ], // the Wreck Line -> Tidewarden Nel's watch on the north rise
  [
    { x: -339, z: 9 },
    { x: -333, z: 20 },
    { x: -326, z: 30 },
    { x: -318, z: 38 },
    { x: -314, z: 44 },
  ], // Tidewarden Nel -> Dawnrest Camp, past the castaway crates, through the
  //   camp fence's south-west gate
] as { x: number; z: number }[][];

// No walk-in portals: the ferry crossing is a pair of CLICKED bells
// (PROVING_SHORE_OBJECTS ps_ferry_bell, routed by
// src/sim/interactions/ferry_bell.ts), so nobody is ever teleported by
// wandering over a trigger. The island bell sets the player down in
// Eastbrook TOWN (beside the spawn square); the vale-strand bell rings a
// returning player back to the island arrival for a refresher. The tutorial
// greeting's accept path (sim/tutorial/greeting.ts) still lands at
// PROVING_SHORE_ARRIVAL.
export const PROVING_SHORE_PORTALS: PortalDef[] = [];

/** Where the tutorial greeting's accept path sets a new adventurer down: at
 *  the Gauntlet's open east mouth, facing due east (forward = (-sin f,
 *  cos f), so -PI/2 points at +x), toward the pier, the ferry bell, and the
 *  water they just crossed. The client snaps the chase camera to this facing
 *  on any teleport-scale displacement (game/teleport_camera.ts), and the
 *  first-visit arrival cinematic settles onto the same view. */
export const PROVING_SHORE_ARRIVAL = { x: -281, z: -18, facing: -Math.PI / 2 } as const;

export const PROVING_SHORE_MOBS: Record<string, MobTemplate> = {
  // Built to be hit: the practice yard's straw-and-timber targets. True
  // dummies (types.ts MobTemplate.dummy): attackable, but they never move,
  // aggro, or retaliate, and they stand back up in seconds so a class never
  // queues for a target.
  training_effigy: {
    id: 'training_effigy',
    name: 'Training Effigy',
    minLevel: 1,
    maxLevel: 1,
    family: 'humanoid',
    hpBase: 26,
    hpPerLevel: 0,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 2.5,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    dummy: true,
    // A splinter of copper in the stuffing: every camp-spawned mob carries an
    // unconditional copper entry (the progression-test floor), and a first
    // kill that pays SOMETHING teaches looting better than an empty corpse.
    loot: [{ copper: 1, chance: 1 }],
    scale: 1.0,
    color: 0x9a7b4f,
    respawnSeconds: 5,
  },
  // The wreck line's salvage-pickers: the island's one honest hazard, and a
  // gentle one. Short aggro, light pinch, a few coppers in the shell.
  shore_scuttler: {
    id: 'shore_scuttler',
    name: 'Shore Scuttler',
    minLevel: 1,
    maxLevel: 2,
    family: 'beast',
    hpBase: 18,
    hpPerLevel: 6,
    dmgBase: 3,
    dmgPerLevel: 1,
    attackSpeed: 2.0,
    armorPerLevel: 4,
    moveSpeed: 7,
    // Very short leash ON PURPOSE: a newcomer looting the wreck line should
    // only ever fight the crab they walked onto, never a pile.
    aggroRadius: 2,
    loot: [{ copper: 4, chance: 1 }],
    scale: 0.8,
    color: 0x7a5a3a,
    // Quick respawn for a lesson mob: three recruits can share the wreck
    // line without waiting out the world's default corpse timer.
    respawnSeconds: 7,
    // Every beast carries a harvestable component (the economy_yield rule);
    // crab meat, the tide_scuttler precedent.
    componentTags: ['meat'],
  },
  // The old king of the shallows: the island's summon-only miniboss
  // (interactions/crab_summon.ts calls him out of the tide pool at the
  // strand's west end; no camp spawns him, the aldren idiom). Sized for a
  // level 2 recruit fighting alone, with an owner tap that preserves the
  // summoner's credit while allowing passers-by to help with the fight.
  mister_crabs: {
    id: 'mister_crabs',
    name: 'Mister Crabs',
    minLevel: 2,
    maxLevel: 2,
    family: 'beast',
    hpBase: 42,
    hpPerLevel: 0,
    // Harder per pinch than a scuttler (4 per 2.0s): the quest copy promises
    // it, and 6 per 2.4s is still a safe long fight for a level 2 recruit.
    dmgBase: 6,
    dmgPerLevel: 0,
    attackSpeed: 2.4,
    armorPerLevel: 6,
    // Slower than a recruit's run on purpose: a caster who keeps walking
    // backward can keep casting, the lesson their combat card teaches.
    moveSpeed: 6.2,
    aggroRadius: 10,
    canSwim: true,
    // Taming swaps a wild mob onto the ordinary pet respawn lifecycle, which
    // would bypass this lure summon’s unconditional five-minute lifetime.
    untameable: true,
    loot: [
      // Quest-gated like the pearl. The summon is repeatable while the quest
      // is active (the no-strand rule), which makes this a reviewed and
      // accepted micro-faucet: ~30 copper per full summon-kill cycle, well
      // under any economy ceiling, and it closes at the hand-in.
      { copper: 30, chance: 1, questId: 'q_ps_mother_of_pearl' },
      // The prize remains for quest holders only (LootEntry.questId). Helpers
      // may damage him, while the summon-time owner tap preserves the caller's
      // corpse and kill credit.
      { itemId: 'ps_lustrous_pearl', chance: 1, questId: 'q_ps_mother_of_pearl' },
    ],
    scale: 1.7,
    color: 0xb0402a,
    componentTags: ['meat'],
  },
};

export const PROVING_SHORE_NPCS: Record<string, NpcDef> = {
  // The greeter stands at the EASTBROOK spawn, not on the island: she is the
  // face of the tutorial greeting dialog (sim/tutorial/greeting.ts) and the
  // signpost back to the ferry for anyone who skipped it.
  wayfarer_bryn: {
    id: 'wayfarer_bryn',
    name: 'Wayfarer Bryn',
    title: 'Harbor Guide',
    pos: { x: 6, z: -7 },
    // Facing the town square's middle from her spot southeast of it
    // (forward = (-sin f, cos f), so 0.7 rad points toward (0, 0)).
    facing: 0.7,
    color: 0x8a6a9a,
    questIds: [],
    greeting:
      'Eastbrook takes all comers, friend. And for the unsteady, there is always the Proving Shore: the ferry bell by the Ravenpost mailbox rings you across any day of the year, and its twin on the island rings you home.',
  },
  instructor_maren: {
    id: 'instructor_maren',
    name: 'Instructor Maren',
    title: 'Proving Master',
    // The camp's east anchor, at the junction where all three roads meet,
    // facing south-east down the pier road to greet each new arrival.
    pos: { x: -299, z: 49 },
    facing: (-3 * Math.PI) / 4,
    color: 0x6b4a8a,
    questIds: ['q_ps_pouch_and_purse', 'q_ps_the_signpost', 'q_ps_the_long_walk', 'q_ps_set_sail'],
    greeting:
      'Every hero the vale has ever thanked stood where you stand now, $C, and not one of them knew which end of a blade to hold. That is what this shore is for. Ask, practice, and fail where failing is free.',
  },
  quartermaster_finch: {
    id: 'quartermaster_finch',
    name: 'Quartermaster Finch',
    title: 'Camp Outfitter',
    // Behind her stall on the camp's north edge (the old second tent's
    // ground), facing south over the counter into the muster ground. Kept a
    // step south of the perimeter rail, which crosses z 57.8 at this x.
    pos: { x: -312, z: 57.2 },
    facing: Math.PI,
    color: 0x6b6b3a,
    // The stall sells EXACTLY the bank lesson's Linen Pouch: no provisions
    // (a newcomer who spent their lesson copper on bread was softlocked out
    // of the pouch purchase) and NEVER professions tools (the R37 vendor
    // rule): the chain's copper is sized so a graduate buys the full tier-1
    // tool kit from the vale's own counters on arrival. The pouch is
    // quest-gated so an early buy cannot strand the lesson's copper
    // (types.ts vendorQuestGates).
    vendorItems: ['linen_pouch'],
    vendorQuestGates: { linen_pouch: 'q_ps_pouch_and_purse' },
    questIds: ['q_ps_the_wreck_line', 'q_ps_pouch_and_purse'],
    greeting:
      'My counter keeps exactly one thing for sale, $N: a spare pouch for what you pick up along the way, when your lesson calls for it. Everything else here is salvage bound for the vale. Coin buys the pouch, and work earns the coin. That is the whole economy, and it never gets more complicated. Only bigger.',
  },
  // The camp's Gilded Strongbox desk: a real banker (the same vault as every
  // town bursar), and the voice of the bank-and-bags lesson.
  bursar_wick: {
    id: 'bursar_wick',
    name: 'Bursar Wick',
    title: 'The Gilded Strongbox',
    // The strongbox desk holds the camp's quiet west end, up its own spur of
    // the camp path, facing north-west out over the water at his back wall.
    pos: { x: -325, z: 42 },
    facing: Math.PI / 4,
    color: 0xc9a227,
    // No questIds ON PURPOSE: clicking a banker opens the bank window, not
    // the quest gossip, so no quest can give or hand in at him. His teaching
    // rides q_ps_pouch_and_purse's completion at Maren, which points here.
    questIds: [],
    banker: true,
    greeting:
      'The Gilded Strongbox keeps a desk even here, $N. Whatever you deposit with me waits in the same vault behind every bursar in every town, safe from wolves, water, and your own worse judgment.',
  },
  ferryman_odo: {
    id: 'ferryman_odo',
    name: 'Ferryman Odo',
    title: 'Keeper of the Crossing',
    // Between his pier and the Gauntlet's mouth, facing south over the
    // arrival point so every newcomer lands in front of him.
    pos: { x: -284, z: -9 },
    facing: Math.PI,
    color: 0x4a6a8a,
    questIds: ['q_ps_set_sail'],
    greeting:
      'Fresh off the crossing, $N? Warden Tam keeps the Gauntlet on the strand just south of my pier: run his lanes first and your legs will thank you. Every keeper on this shore hands you to the next when your work is done, and the card at the top of your screen always knows the way. When the vale calls you back, ring the bell standing beside my pier and the crossing will set you down in Eastbrook town.',
  },
  // The Gauntlet's keeper: the first pair of hands a newcomer is sent to,
  // standing beside the course's open east mouth, where the arrival facing
  // points. He GIVES the chain's head quest (q_ps_the_gauntlet, credited
  // sim-side as the runner passes his flags in order,
  // tutorial/gauntlet_run.ts); his overseer at the far end takes the run in.
  warden_tam: {
    id: 'warden_tam',
    name: 'Warden Tam',
    title: 'Keeper of the Gauntlet',
    pos: { x: -283, z: -21 },
    // Facing the pier landing, greeting each new arrival as they walk down.
    facing: 0.05,
    color: 0x8a5a3a,
    questIds: ['q_ps_the_gauntlet'],
    greeting:
      'These lanes are the Gauntlet, $N, and every adventurer the vale respects has run them. The lantern posts stay lit all night, so the lanes never close.',
  },
  // The far end of the lanes: takes the run in, sends the runner up his path
  // to the practice yard.
  overseer_pell: {
    id: 'overseer_pell',
    name: 'Overseer Pell',
    title: 'Gauntlet Overseer',
    pos: { x: -337, z: -33 },
    // Facing west, toward the yard path every finished run climbs next.
    facing: Math.PI / 2,
    color: 0x5a6a3a,
    questIds: ['q_ps_the_gauntlet', 'q_ps_strike_true'],
    greeting:
      'I clock every run that comes down these lanes, $N, and I have seen far worse footwork. The path behind me climbs to the practice yard: that is where footwork turns into swordwork.',
  },
  // The practice yard's master: takes the effigy lesson in, points the
  // recruit down the long path to the wreck line's scuttlers.
  drillmaster_rook: {
    id: 'drillmaster_rook',
    name: 'Drillmaster Rook',
    title: 'Yard Master',
    pos: { x: -345, z: -11 },
    // On the yard's west shoulder where the wreck-line path sets out, facing
    // south-west down that path.
    facing: (3 * Math.PI) / 4,
    color: 0x7a4a4a,
    questIds: ['q_ps_strike_true', 'q_ps_hone_the_edge', 'q_ps_shell_and_claw'],
    greeting:
      'Straw first, shells second, $N. An effigy teaches your arm the swing; the scuttlers down the strand teach it to land on something that minds.',
  },
  // The strand's watcher, standing just up the path from the wreck line's
  // scuttlers: takes the cull in on the spot and sends the salvage up the
  // long rise to Dawnrest Camp.
  tidewarden_nel: {
    id: 'tidewarden_nel',
    name: 'Tidewarden Nel',
    title: 'Keeper of the Strand',
    pos: { x: -371, z: -13 },
    // Facing south-west down her path toward the wreck line.
    facing: (3 * Math.PI) / 4,
    color: 0x3a6a6a,
    questIds: ['q_ps_shell_and_claw', 'q_ps_mother_of_pearl', 'q_ps_the_wreck_line'],
    greeting:
      'The tide takes and the tide pays, $N. I keep the tally of both: what the scuttlers pinch off the wrecks, and what honest hands carry back up this path.',
  },
};

export const PROVING_SHORE_QUESTS: Record<string, QuestDef> = {
  // The chain's head: Warden Tam's run of his own lanes. The objective is an
  // 'interact' keyed on the sentinel ps_gauntlet_flag with NO live ground
  // entity (the riding-lesson idiom, mounts_training.ts): the flags the
  // player sees are decorProps dressing, and tutorial/gauntlet_run.ts
  // credits one count per flag passed in running order, so the tracker
  // reads "Gauntlet flag passed: 2/3" as they run. The bootcamp coachmark
  // (ui/bootcamp.ts) rides the same counts for its lesson ladder. Overseer
  // Pell takes the run in at the lanes' far end, so the hand-in IS the
  // finish line.
  q_ps_the_gauntlet: {
    id: 'q_ps_the_gauntlet',
    name: 'Run the Gauntlet',
    giverNpcId: 'warden_tam',
    turnInNpcId: 'overseer_pell',
    text: 'Every pair of legs the vale respects has run these lanes first, $N. Walk the first lane west to its flag, swing yourself around, walk the south lane to the second, then sidestep the last lane to the red flag. Pass the flags in order, and the card at the top of your screen will show you every button as you go. Overseer Pell clocks every run from the far end: when the red flag is behind you, he is standing right there to take it in.',
    completionText:
      'I clocked that run, $N, and I have failed faster feet. The Gauntlet is yours. The path behind me climbs to the practice yard, where Drillmaster Rook turns footwork into swordwork: he has your next task.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'ps_gauntlet_flag',
        count: 3,
        label: 'Gauntlet flag passed',
      },
    ],
    // The rail's XP is budgeted as one number: quest XP (1140 total) plus the
    // kill XP the objectives force (one effigy, three scuttlers, the tide-pool
    // king) crosses the
    // level 3 threshold AT the final hand-in, never before (the window is
    // pinned in tests/proving_shore_content.test.ts).
    xpReward: 100,
    copperReward: 40,
    itemRewards: {},
  },
  q_ps_strike_true: {
    id: 'q_ps_strike_true',
    name: 'Strike True',
    giverNpcId: 'overseer_pell',
    turnInNpcId: 'drillmaster_rook',
    text: 'Footwork first, now the arm, $N. The practice yard sits up the path behind me, and its straw effigies were built to be hit. If you lose the way, press M to open the map: every task you carry is marked on it. Walk up to an effigy and left-click it: that makes it your target, and its name will appear at the top of your screen. Only then press 1, or click the first icon on the action bar along the bottom, to swing. Keep striking until one gives out; it will not swing back, effigies never do. Drillmaster Rook watches the yard from its west shoulder, where the strand path sets out: press F on him to hand the fell in.',
    completionText:
      'One clean fell, and your grip already surer. Remember the feel of it, $N: target, strike, and keep striking. Straw never minds. The next thing you swing at will.',
    objectives: [
      { type: 'kill', targetMobId: 'training_effigy', count: 1, label: 'Training Effigy felled' },
    ],
    xpReward: 60,
    copperReward: 60,
    itemRewards: {},
    requiresQuest: 'q_ps_the_gauntlet',
  },
  // The yard's second drill: the action bar. Strike True teaches the swing,
  // which is not the game; a player who leaves the island auto-attacking has
  // learned the wrong lesson. The objective is a sentinel interact with no
  // ground entity of its own (the ps_gauntlet_flag idiom): credit rides the
  // damage the class's OWN attack deals, in tutorial/ability_drill.ts, so an
  // autoattack counts for nothing. The coach card names each class's button
  // from the live kit rather than saying "press 1" at a mage, and a warrior
  // standing in the yard is loaned the rage their press bills, because
  // Reaver Strike is greyed out at zero rage exactly when the coach points
  // at it.
  q_ps_hone_the_edge: {
    id: 'q_ps_hone_the_edge',
    name: 'Hone the Edge',
    giverNpcId: 'drillmaster_rook',
    turnInNpcId: 'drillmaster_rook',
    text: 'A swing is a swing, $N, and straw will take it all day. That is not what wins you anything. Look at the row of buttons along the bottom of your screen: that row is your craft, and every one of them does something your arm alone cannot. You have one already. Turn back to the effigies and use it: pick your target, then press the button the yard marks for you, three times over. Do not simply hack at the straw; make the thing you know how to do actually happen. Then come back to me.',
    completionText:
      'Now you are fighting instead of flailing. That row grows every level you take, $N, and the ones who live longest are the ones who read it. Straw does not care which button you used. The vale will.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'ps_ability_drill',
        count: 3,
        label: 'Ability landed on an effigy',
      },
    ],
    xpReward: 60,
    copperReward: 60,
    itemRewards: {},
    requiresQuest: 'q_ps_strike_true',
  },
  // The first real fight: the wreck line's scuttlers pinch back, which is the
  // whole lesson after a target that never did.
  q_ps_shell_and_claw: {
    id: 'q_ps_shell_and_claw',
    name: 'Shell and Claw',
    giverNpcId: 'drillmaster_rook',
    turnInNpcId: 'tidewarden_nel',
    text: 'Straw never minds, $N, so here is something that does. Shore scuttlers pick over the wreck line on the far strand: follow the path west from my yard and it walks you straight to them. They pinch back, so watch your health bar and keep swinging: left-click one to make it your target, then use the ability the yard taught you (the coach names your button), and do not stop until its shell cracks. Three will do. Then climb the path up the north rise: Tidewarden Nel keeps the strand tally, and she counts your shells.',
    completionText:
      'Three shells cracked and all your fingers kept: a fair first fight, $N. The scuttlers pinch off the wrecks faster than the tide brings salvage in, so every one you cull is coin someone keeps.',
    objectives: [
      { type: 'kill', targetMobId: 'shore_scuttler', count: 3, label: 'Shore Scuttler culled' },
    ],
    xpReward: 170,
    copperReward: 80,
    itemRewards: {},
    requiresQuest: 'q_ps_hone_the_edge',
  },
  // The miniboss lesson: using an item from the bags, a fight that asks for
  // more than three swings, and looting a corpse for a QUEST item rather
  // than coin. Nel grants the reusable Briny Lure on accept (requiredItems,
  // re-granted if lost); the summon itself is gated in
  // interactions/crab_summon.ts (at the pool, quest active, boss not up),
  // and the pearl drops for quest holders only, so the chain can never
  // strand. The reward is the island's keepsake ring, whose completion text
  // walks the equip lesson (B to buckle it on, C to admire it).
  q_ps_mother_of_pearl: {
    id: 'q_ps_mother_of_pearl',
    name: 'Mother of Pearl',
    giverNpcId: 'tidewarden_nel',
    turnInNpcId: 'tidewarden_nel',
    text: "Three shells cracked, $N, but the wreck line keeps a king, and he sits on a prize worth more than every crate on this strand. Take this Briny Lure to the tide pool at the strand's far west end, past the wrecks. Stand at the water's edge, press B to open your bags, and left-click the lure to wake him. Mister Crabs pinches far harder than his little cousins, so watch your health bar, keep striking, and back away up the sand if you need your breath. When he falls, walk right up to his shell and press F to loot the Lustrous Pearl off him. Bring that pearl back to me.",
    completionText:
      'The Lustrous Pearl, pried off the old king of the shallows himself. My father tipped his hat to that crab every morning of his working life; some respect is owed. Hold still... there. Strung, set, and yours, $N: the Mother of Pearl. Press B to open your bags and left-click the ring to slide it on, then press C to open your character sheet and see it sitting on your hand. A slight thing, but every part of you the better for wearing it.',
    objectives: [
      { type: 'kill', targetMobId: 'mister_crabs', count: 1, label: 'Mister Crabs slain' },
      { type: 'collect', itemId: 'ps_lustrous_pearl', count: 1, label: 'Lustrous Pearl claimed' },
    ],
    requiredItems: ['ps_briny_lure'],
    xpReward: 150,
    copperReward: 60,
    // EVERY class, not three. The ring is the island's keepsake and the
    // vehicle for its equip lesson, so a paladin or a druid finishing the
    // detour used to get the completion text about sliding it on and no ring
    // to slide (and the equip lesson never fired for them at all).
    itemRewards: {
      warrior: 'mother_of_pearl',
      paladin: 'mother_of_pearl',
      rogue: 'mother_of_pearl',
      hunter: 'mother_of_pearl',
      mage: 'mother_of_pearl',
      warlock: 'mother_of_pearl',
      priest: 'mother_of_pearl',
      shaman: 'mother_of_pearl',
      druid: 'mother_of_pearl',
    },
    requiresQuest: 'q_ps_shell_and_claw',
  },
  q_ps_the_wreck_line: {
    id: 'q_ps_the_wreck_line',
    name: 'The Wreck Line',
    giverNpcId: 'tidewarden_nel',
    turnInNpcId: 'quartermaster_finch',
    text: 'My porters haul salvage off the old wrecks and carry it up the rise toward Dawnrest Camp, $N, and half the crates never finish the climb: they get set down along the path and forgotten. Follow my path toward the camp and you will walk right past the strays. Opening one is simple: walk up to a crate until its name shows, then press F, or left-click the crate itself, and it will give up what it holds. Six of them will clear the line, and remember F is the same key for every chest, node and doorway you will ever meet. Quartermaster Finch keeps the camp stall and buys every stick of salvage: hand the haul to her.',
    completionText:
      'Rope, tar, and half a wheel of cheese the sea somehow spared: I will take the lot, $N. A back that carries what it finds is worth more to this camp than any blade, and yours just cleared the whole line in one climb.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'ps_castaway_crate',
        count: 6,
        label: 'Castaway Crate opened',
      },
    ],
    xpReward: 160,
    copperReward: 80,
    itemRewards: {},
    requiresQuest: 'q_ps_mother_of_pearl',
  },
  // The bank and bags lesson. Facts mirrored from the sim: the implicit
  // 16-slot backpack plus four bag sockets pooling capacity (BAG_SOCKETS,
  // src/sim/bags.ts), the shared bank vault behind every bursar with
  // purchasable extra slots (src/sim/bank.ts), and the Linen Pouch as the
  // cheapest vendor bag (6 slots, content/items.ts). The chain's copper
  // before this quest is sized to afford the pouch when it unlocks. Finch
  // gives it (she sells the pouch), Maren takes the hand-in and speaks the
  // vault half, pointing at Bursar Wick's strongbox desk (a banker's click
  // opens the bank, not the quest gossip, so Wick cannot hold a turn-in).
  // The Linen Pouch is quest-gated at Finch's stall (vendorQuestGates
  // above), so it cannot be bought, equipped, and stranded early.
  q_ps_pouch_and_purse: {
    id: 'q_ps_pouch_and_purse',
    name: 'Pouch and Purse',
    giverNpcId: 'quartermaster_finch',
    turnInNpcId: 'instructor_maren',
    text: 'One more lesson before the vale, $N, and it is the one that keeps adventurers alive: what you carry. Your backpack holds sixteen slots, and beside it wait four empty bag loops; every bag you buckle on adds its own space to the pool. So: press F on me again to open my stall, left-click the Linen Pouch in my wares to buy it, then press B to open your bags and left-click the pouch there to buckle it into a free loop. Instructor Maren drills by the muster fire a few steps east: show her the pouch on your belt.',
    completionText:
      'A fine pouch. Buckle it on if you have not already: press B to open your bags, then left-click the pouch to seat it in a free bag loop, and six more slots are yours to fill with trouble. Now the half of the lesson no bag can hold, $N: what you cannot carry, the Gilded Strongbox keeps. Bursar Wick keeps his strongbox desk up the west path, and he opens the same vault every bursar in every town shares; more vault space can be bought once your purse grows into it. Keep your valuables banked and your bags roomy. A full pack has ended more adventures than any wolf ever did.',
    objectives: [{ type: 'collect', itemId: 'linen_pouch', count: 1, label: 'Linen Pouch bought' }],
    // OWNERSHIP, not delivery (types.ts keepsCollectedItems): the quest tells
    // the player to buckle the pouch on, so it must still count once worn in
    // a bag socket, and Maren must not take back the bag Finch just taught
    // them to wear.
    keepsCollectedItems: true,
    xpReward: 170,
    copperReward: 120,
    itemRewards: {},
    requiresQuest: 'q_ps_the_wreck_line',
  },
  // The reading-the-boards habit: one clicked look at the camp's guild
  // signpost. The objective is an 'interact' keyed on the sentinel
  // ps_guild_signpost with NO live ground entity of its own (the
  // ps_gauntlet_flag idiom): the board the player clicks is the camp's real
  // noticeboard service (content/noticeboards.ts PROVING_SHORE_NOTICEBOARD),
  // and tutorial/signpost_read.ts credits the read from inside the board's
  // interaction arm, so the quest, the board, and the notice feedback can
  // never disagree.
  q_ps_the_signpost: {
    id: 'q_ps_the_signpost',
    name: 'Word on the Wind',
    giverNpcId: 'instructor_maren',
    turnInNpcId: 'instructor_maren',
    text: 'One habit left to learn, $N, and it needs no blade: read the boards. The guild signpost stands at the camp gate a few steps south-west of my fire, and guilds and travelling crews post their calls on it. Walk up to its face and press F, or left-click it, to read what is posted, then come back and tell me what the wind carried in. A board like it stands in every town you will ever walk into.',
    completionText:
      'So now you know how word moves in the vale, $N: not by couriers, by boards. Check them in every town you pass; half an adventure starts as three lines of ink on one.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'ps_guild_signpost',
        count: 1,
        label: 'Guild signpost read',
      },
    ],
    xpReward: 70,
    copperReward: 30,
    itemRewards: {},
    requiresQuest: 'q_ps_pouch_and_purse',
  },
  // The last lesson, and the one nobody wants to meet for the first time
  // with a wolf still chewing on them. The death is SCRIPTED and consented
  // to (walk to the stone, press interact) and free of consequence: this
  // game charges no durability on death. Credit lands on either
  // resurrection path so the lesson cannot strand a player who took the
  // Spirit Healer, though the copy sends them to their body.
  q_ps_the_long_walk: {
    id: 'q_ps_the_long_walk',
    name: 'The Long Walk',
    giverNpcId: 'instructor_maren',
    turnInNpcId: 'instructor_maren',
    text: 'One lesson left, $N, and it is the one I cannot tell you: you have to have done it once. You are going to die out there. Everyone does, and it is not the end of anything. Take this Passing Stone. Press B to open your bags and left-click it, and it will lay you down right where you stand. Then follow the instructions on your screen: release your spirit, walk back to your own body, and step into it. Your body waits, the walk is free, and you lose nothing by making it.',
    completionText:
      'And back you come, no worse for it. Remember what that felt like, $N, because the next time it happens there will be teeth involved and no one standing by to explain. Your body waits, the walk is free, and the only thing death really costs you is the time it takes to come back.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'ps_passing_stone',
        count: 1,
        label: 'Walked back from the dead',
      },
    ],
    requiredItems: ['ps_passing_stone'],
    xpReward: 60,
    copperReward: 30,
    itemRewards: {},
    requiresQuest: 'q_ps_the_signpost',
  },
  q_ps_set_sail: {
    id: 'q_ps_set_sail',
    name: 'Set Sail',
    giverNpcId: 'instructor_maren',
    turnInNpcId: 'ferryman_odo',
    text: 'There is nothing left on this shore you have not already run, beaten, opened, or bought, $N. You are ready, and Eastbrook has real work waiting. Walk back down the shore road to the pier, press F on Ferryman Odo, and tell him I said you have earned your crossing. Press L any time you lose track of what you owe whom: that is your quest log.',
    completionText:
      'Maren said that, did she? High praise from a woman who once made me practice mooring knots for a week. Ring the bell standing beside my pier whenever you are ready, $N, and the crossing will set you down in the middle of Eastbrook town. Mind the wolves.',
    objectives: [
      { type: 'interact', targetNpcId: 'ferryman_odo', count: 1, label: 'Report to Ferryman Odo' },
    ],
    xpReward: 150,
    copperReward: 50,
    itemRewards: {},
    requiresQuest: 'q_ps_the_long_walk',
  },
};

// Strict chain order: the shore is on rails by design, one NPC handing the
// newcomer to the next around the island: the run, the swing, the first real
// fight, the salvage haul, the bags, and the crossing home. Every step's
// text names the exact key or click it needs, so a player who has never held
// a mouse for this genre is never guessing. The chain's XP (with the kill XP
// its objectives force) lands a graduate at level 3 on the vale.
export const PROVING_SHORE_QUEST_ORDER: string[] = [
  'q_ps_the_gauntlet',
  'q_ps_strike_true',
  'q_ps_hone_the_edge',
  'q_ps_shell_and_claw',
  'q_ps_mother_of_pearl',
  'q_ps_the_wreck_line',
  'q_ps_pouch_and_purse',
  'q_ps_the_signpost',
  'q_ps_the_long_walk',
  'q_ps_set_sail',
];

export const PROVING_SHORE_ITEMS: Record<string, ItemDef> = {
  ps_castaway_crate: {
    id: 'ps_castaway_crate',
    name: 'Castaway Crate',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_ps_the_wreck_line',
    noVendorSell: true,
  },
  // The ferry bells are rung, never looted (interactions/ferry_bell.ts routes
  // the click before the pickup path); the item record exists so the world
  // object has a name and the pickup-lines rule stays satisfied defensively,
  // the gullhaven_watchbell + murloc_hut precedent.
  ps_ferry_bell: {
    id: 'ps_ferry_bell',
    name: 'Ferry Bell',
    kind: 'quest',
    sellValue: 0,
    noVendorSell: true,
  },
  // The death lesson's rite stone (q_ps_the_long_walk): Instructor Maren
  // hands it over on accept, and using it from the bags lays the player down
  // where they stand. A carried single-use item rather than a fixture in the
  // world, because a new player who has been told to "go and die" needs the
  // thing that does it in their hand, not somewhere to walk to (CX).
  // requiredItems re-grants it if it is somehow lost, so the lesson can
  // never strand.
  ps_passing_stone: {
    id: 'ps_passing_stone',
    name: 'Passing Stone',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_ps_the_long_walk',
    use: { type: 'passingStone' },
    noVendorSell: true,
  },
  // The tide-pool summon (q_ps_mother_of_pearl): the reusable lure Nel hands
  // over on accept (requiredItems re-grants it if lost) and the pearl the
  // king drops for quest holders only. Both quest-bound, never sold.
  ps_briny_lure: {
    id: 'ps_briny_lure',
    name: 'Briny Lure',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_ps_mother_of_pearl',
    use: { type: 'summon' },
    noVendorSell: true,
  },
  ps_lustrous_pearl: {
    id: 'ps_lustrous_pearl',
    name: 'Lustrous Pearl',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_ps_mother_of_pearl',
    noVendorSell: true,
  },
  // The prize: plus one to everything, the island's keepsake. One ring for
  // every class (all three reward archetypes name it), and deliberately
  // slight, so the first real drop on the vale still feels like a step up.
  mother_of_pearl: {
    id: 'mother_of_pearl',
    name: 'Mother of Pearl',
    kind: 'armor',
    slot: 'ring',
    quality: 'uncommon',
    requiredLevel: 1,
    stats: { str: 1, agi: 1, sta: 1, int: 1, spi: 1 },
    sellValue: 50,
  },
};
// Note there is deliberately NO ItemDef for ps_gauntlet_flag or
// ps_guild_signpost: like the riding lesson's train_valorsteed, both are pure
// sentinel objective keys with no live object and no item of their own,
// credited by position in tutorial/gauntlet_run.ts and by the noticeboard
// interaction arm through tutorial/signpost_read.ts.

// Every camp draws from its own private rng sub-stream (offStream), so
// adding the tutorial island leaves the rest of the world's generation
// bit-identical.
export const PROVING_SHORE_CAMPS: CampDef[] = [
  // A wide, airy yard: five effigies spread over about ten yards, so no two
  // recruits ever crowd one target. Five single-mob camps rather than one
  // count-5 camp ON PURPOSE: a camp spawns AT its center (the radius is only
  // the wander leash), and an effigy never wanders (moveSpeed 0), so a
  // shared center would stack all five on one point forever.
  { mobId: 'training_effigy', center: { x: -336, z: -14 }, radius: 4, count: 1, offStream: true },
  { mobId: 'training_effigy', center: { x: -341, z: -17 }, radius: 4, count: 1, offStream: true },
  { mobId: 'training_effigy', center: { x: -331, z: -11 }, radius: 4, count: 1, offStream: true },
  { mobId: 'training_effigy', center: { x: -334, z: -20 }, radius: 4, count: 1, offStream: true },
  { mobId: 'training_effigy', center: { x: -339, z: -9 }, radius: 4, count: 1, offStream: true },
  // The wreck line lives on the FAR strand past the practice yard (the path
  // from the yard leads straight to it), leaving the south strand nearest
  // camp free for the Gauntlet movement course. Counts stay halved: the
  // wreck line is a looting lesson, and a crate ringed by crabs turned it
  // into a fight the quest never asked for.
  // Three well-separated pairs on the island's SOUTH-WEST strand, anchored
  // at (-380, -42): a full thirty yards from Tidewarden Nel's watch on the
  // north rise, so her path stays a safe walk and the cull ground reads as
  // its own place. Ten-plus yards between camps: with the very short aggro
  // leash above, each crab met along the strand is a single fight, and a
  // bad pull has room to retreat.
  { mobId: 'shore_scuttler', center: { x: -380, z: -42 }, radius: 4, count: 2, offStream: true },
  { mobId: 'shore_scuttler', center: { x: -372, z: -48 }, radius: 4, count: 2, offStream: true },
  { mobId: 'shore_scuttler', center: { x: -390, z: -40 }, radius: 4, count: 2, offStream: true },
];

export const PROVING_SHORE_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'ps_castaway_crate',
    name: 'Castaway Crate',
    // The Wreck Line (q_ps_the_wreck_line): the porters' strays, set down the
    // whole way along Tidewarden Nel's path up the rise toward Dawnrest Camp,
    // so collecting them IS the walk to the hand-in at Finch's stall. Six
    // crates for a count of six: clearing the line is the quest, and an
    // opened crate respawns (interaction.ts OBJECT_RESPAWN) so a shared
    // island never strands the last one.
    positions: [
      { x: -362, z: -8 },
      { x: -352, z: -2 },
      { x: -345, z: 4 },
      { x: -334, z: 17 },
      { x: -327, z: 24 },
      { x: -320, z: 31 },
    ],
  },
  {
    itemId: 'ps_ferry_bell',
    name: 'Ferry Bell',
    // The clicked crossing (interactions/ferry_bell.ts): the Old Pier's bell
    // rings a player to Eastbrook town, and its twin INSIDE town (beside the
    // harbor's Ravenpost mailbox at (-10, -98), on its seaward side, clear of
    // the posting spot at (-10, -96.9)) rings a returning player back to the
    // island arrival. The twin moved with the mailbox when the New Eastbrook
    // program rebuilt the town around the quay.
    //
    // The island bell stands on the dry ground between the pier head and the
    // Gauntlet's mouth, a few steps from Ferryman Odo (his completion note
    // says "the bell standing beside my pier"), clear of the dock planks and
    // of the arrival point at (-281, -18).
    positions: [
      { x: -279, z: -10 },
      { x: -7.5, z: -100 },
    ],
  },
];

export const PROVING_SHORE_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Dawnrest Camp: a training camp, not a town, spread wide so nothing
  // crowds anything. Finch's stall holds the old second tent's ground on the
  // north edge, Maren's tent sits by the muster fire, and the strongbox desk
  // anchors the far west end.
  stalls: [{ x: -312, z: 55.6, rot: Math.PI, r: 1.6 }],
  campfires: [
    [-302, 50], // the muster fire
    [-334, -10], // the practice yard's brazier
    // The Gauntlet carries NO ground fires: its night light is the lantern
    // posts along the fence lines (the kcasTorch decorProps below, lit by
    // the renderer's torch-glow pass).
  ],
  tents: [
    // Maren's tent, pulled inside the fence beside the muster fire (its old
    // spot at (-295, 45) sat against the east rail).
    { x: -299, z: 52.5, rot: 0.4, scale: 1 },
  ],
  fences: [
    // The camp's own rail fence, run along the dry shoulder of the plateau
    // and around the graveyard, with two gates where the roads pass: the
    // south-east gap (the pier and Gauntlet roads, crossing near x -296)
    // and the south gap (the practice-yard road, crossing near x -305).
    // The practice yard itself is OPEN ground now; its old pen rails are
    // gone so drilling players never snag on a corner post.
    { x1: -330, z1: 39, x2: -330, z2: 61 }, // west run
    { x1: -330, z1: 61, x2: -318, z2: 61 }, // north run, behind the graveyard
    { x1: -318, z1: 61, x2: -314, z2: 58 }, // north-east shoulder
    { x1: -314, z1: 58, x2: -304, z2: 57 }, // north run, behind the mailbox
    { x1: -304, z1: 57, x2: -297, z2: 52 }, // shoreline shoulder
    { x1: -297, z1: 52, x2: -294, z2: 44 }, // east run
    { x1: -294, z1: 44, x2: -294, z2: 40 }, // east run, to the pier gate
    // South run: one gate only, at the south-west corner where Tidewarden
    // Nel's path climbs into camp (x -313..-319). The old practice-yard gate
    // is fenced back over: its road is gone, and a gap with no path through
    // it just reads as a broken fence.
    { x1: -299, z1: 39, x2: -313, z2: 39 }, // south run, east of Nel's gate
    { x1: -319, z1: 39, x2: -330, z2: 39 }, // south run, west of Nel's gate
    // The Gauntlet: an L of two fenced lanes on the south strand, entered
    // from the east gate beside Warden Tam. Lane 1 runs west (hold forward),
    // lane 2 runs south off its end (strafe left while still facing west),
    // lane 3 runs west again to the red finish flag. The walls are the
    // course: they make the running line unmissable and keep a wanderer on
    // it. The south-east wall corner slants to (-304, -33) because the
    // straight corner at (-304, -36) stands in the shallows.
    // Lane 1's north wall starts at x -292: the stretch from -283 to -292 is
    // OPEN, so the pier landing walks straight into the course's wide east
    // mouth instead of hunting for a gap.
    { x1: -292, z1: -12, x2: -312, z2: -12 }, // lane 1 north wall
    { x1: -284, z1: -20, x2: -304, z2: -20 }, // lane 1 south wall
    { x1: -312, z1: -12, x2: -312, z2: -28 }, // lane 2 west wall
    { x1: -304, z1: -20, x2: -304, z2: -33 }, // lane 2 east wall
    // Lane 3's north wall stops short of the finish: its old west end at
    // (-335, -28) jutted into the yard path a finishing run walks up to
    // Overseer Pell, and a runner rounding the red flag snagged on it.
    { x1: -312, z1: -28, x2: -330, z2: -28 }, // lane 3 north wall
    { x1: -304, z1: -33, x2: -335, z2: -36 }, // lane 3 south wall, to the finish
    //   (the west end past the red flag stays open: Overseer Pell stands
    //   there, and the finish line hands straight onto his yard path)
    // The parkour hurdle: one low rail straight ACROSS lane 2, wall to wall,
    // so the run south cannot walk around it. Fence colliders are isFence
    // (colliders.ts), which the movement kernel's airborne path clears, so
    // the only way past is the jump the coach's Space bubble asks for
    // (BOOTCAMP_PARKOUR below pins the obstacle line the bubble anchors to).
    { x1: -312, z1: -23, x2: -304, z2: -23 }, // lane 2 hurdle rail
  ],
  // The parkour LEDGE: a double-stacked wall of salvage crates ACROSS lane 2
  // past the hurdle, shoulder to shoulder so there is no slipping between
  // them. Two units high puts every top in the ledge-climb band
  // (src/sim/climb.ts: taller than the jump-mantle can vault, inside the
  // grab reach), so the only way over is the real climb move: jump at the
  // wall, grab the lip, pull up, hop down the far side. The island's first
  // taste of parkour, right after the fence jump, exactly the playtest ask.
  crates: [
    [-311.2, -27, 2],
    [-310.1, -27, 2],
    [-309, -27, 2],
    [-307.9, -27, 2],
    [-306.8, -27, 2],
    [-305.7, -27, 2],
    [-304.6, -27, 2],
  ],
  // The Gauntlet's flags mark its corners (pure dressing: no collider, no
  // entity; the bootcamp overlay detects arrival by position against the
  // same coordinates, pinned to BOOTCAMP_COURSE_CHECKPOINTS below), and
  // torches dress the walls between the corner braziers.
  decorProps: [
    { key: 'hexFlag', x: -308, z: -16 },
    { key: 'hexFlag', x: -308, z: -32 },
    { key: 'hexFlagRed', x: -334, z: -32.5 },
    // A muster flag beside every quest giver on the rail (Tam, Pell, Rook,
    // Nel, Finch, Maren), planted a stride to their flank so each stop on
    // the relay reads as a station from across the ground. All six stand
    // OUTSIDE the course rectangle the checkpoint pin sweeps
    // (tests/proving_shore_content.test.ts).
    { key: 'hexFlag', x: -281.5, z: -21.5 },
    { key: 'hexFlag', x: -338.5, z: -31.5 },
    { key: 'hexFlag', x: -346.5, z: -12 },
    { key: 'hexFlag', x: -372.5, z: -14 },
    { key: 'hexFlag', x: -310.5, z: 56 },
    { key: 'hexFlag', x: -297.5, z: 48.5 },
    // A lit lantern post BEHIND each quest giver (1.6 yd opposite their
    // authored facing; forward = (-sin f, cos f)), so every station stays
    // readable after dark, plus one on the camp-gate corner at (-320, 40)
    // (the moved gate light: the road-planned lamp near the signpost's face
    // is suppressed by the board's own collider clearance,
    // render/streetlamp_layout.ts). All lit by the renderer's torch-glow
    // pass (render/decor_torch_fx.ts).
    { key: 'kcasTorch', x: -282.9, z: -22.6 },
    // Pell's lantern stands at his flank, not on the lane a finishing run
    // walks up to him (his station flag holds the other flank).
    { key: 'kcasTorch', x: -337, z: -35 },
    { key: 'kcasTorch', x: -343.9, z: -9.9 },
    { key: 'kcasTorch', x: -369.9, z: -11.9 },
    { key: 'kcasTorch', x: -312, z: 58.8 },
    { key: 'kcasTorch', x: -300.1, z: 50.1 },
    { key: 'kcasTorch', x: -320, z: 40 },
    { key: 'kcasTorch', x: -290, z: -12 },
    { key: 'kcasTorch', x: -300, z: -12 },
    { key: 'kcasTorch', x: -310, z: -12 },
    { key: 'kcasTorch', x: -290, z: -20 },
    { key: 'kcasTorch', x: -300, z: -20 },
    { key: 'kcasTorch', x: -312, z: -18 },
    { key: 'kcasTorch', x: -304, z: -26 },
    { key: 'kcasTorch', x: -318, z: -28 },
    { key: 'kcasTorch', x: -326, z: -28 },
    { key: 'kcasTorch', x: -312, z: -35.5 },
    { key: 'kcasTorch', x: -320, z: -35.8 },
    { key: 'kcasTorch', x: -328, z: -36 },
    { key: 'kcasTorch', x: -334, z: -36 },
  ],
  // The Old Pier, scaled up to read against a character: the classic pier is
  // a rowboat jetty, and this one is the island's whole front door
  // (dock_layout.ts normalizes the walkable-deck maths through the scale, so
  // collision ground and footstep routing grow with the planks). Anchored ON
  // the shore in the canonical dock orientation (the anchor is the land end;
  // the shore-seating rule steps the seaward sections DOWN toward the water),
  // where the old jetty met the sand, with the long run heading out to sea.
  docks: [
    {
      x: -277.3,
      z: -1.1,
      rot: 1.4 - Math.PI,
      scale: 1.75,
      hutLocal: { x: 40, z: 40, hw: 0, hd: 0 },
    },
  ],
  graveyards: [{ x: -324, z: 58 }],
};

/** The Gauntlet's checkpoint flags, in running order: lane 1's corner, lane
 *  2's corner, then the red finish. The bootcamp overlay
 *  (src/ui/bootcamp_view.ts) walks a player through these by proximity, one
 *  ordered lesson per lane; each entry mirrors a decorProps flag above
 *  (tests/proving_shore_content.test.ts pins the two lists equal). */
export const BOOTCAMP_COURSE_CHECKPOINTS: readonly { x: number; z: number }[] = [
  { x: -308, z: -16 },
  { x: -308, z: -32 },
  { x: -334, z: -32.5 },
];
