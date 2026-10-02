// The Mirefen muster: the army Warden Fenwick sent out from Fenbridge to contain Balgath.
//
// Data only (the behavior lives in src/sim/mirefen_muster.ts and src/sim/muster_pike.ts;
// the camp art in src/render/muster_camps.ts reads the same records). Nobody at Fenbridge
// knows where the Foreman came from (Brother Aldric's fallen star, the barrow he dug, or
// something older under Varkhul's forges), only that he walks, and that a line of pikes
// is the one thing the fen has that he cannot shrug off. So the muster ringed the Starfall
// Crater with pickets, and he spends his days smashing them.
//
// Every coordinate below was MEASURED, not eyeballed, against the live heightfield and
// the mob camp table, and tests/mirefen_muster.test.ts re-measures it:
//   - every camp sits on dry ground (1.5+ yards above the fen's waterline across its
//     whole footprint) outside every declared water body and outside the crater bowl;
//   - every camp is at least 29 yards clear of the edge of every wildlife camp (the
//     largest idle aggro radius is 20, plus margin), so a quester standing at a picket
//     cannot pull the Widow Thicket spiders onto the muster;
//   - every post stands outside Balgath's aggro radius of his bed in the crater, so a
//     player walking up to a soldier never pulls him (only players start that fight);
//   - the four PICKETS are Balgath's warpath circuit (content/zone2.ts, in the order of
//     MUSTER_CIRCUIT), and every leg between them, plus the opening leg from his lair,
//     is dry end to end (tests/warpath.test.ts).
// The COMMAND camp is deliberately OFF the circuit: it holds the weapon rack, so it has
// to be the one place a player can walk up to without standing in an arrival slam.

import type { MobTemplate, NpcDef } from '../types';

/** The boss the muster exists to contain (world_boss.ts WORLD_BOSSES, content/zone2.ts). */
export const MUSTER_BOSS_TEMPLATE_ID = 'balgath_cyclops';

export type MusterCampId = 'rim' | 'west' | 'south' | 'crater' | 'command';

export type MusterSoldierTemplateId =
  | 'muster_footman'
  | 'muster_chaplain'
  | 'muster_sergeant'
  | 'muster_drillmaster';

/** The command camp's leader: an NPC (he gives the muster's quests), not a soldier mob. */
export const MUSTER_COMMANDER_NPC_ID = 'muster_commander';
/** Template id of the Straw Foreman, the drill yard's training effigy (below). */
export const MUSTER_EFFIGY_TEMPLATE_ID = 'muster_effigy';

/** Who holds a post: a soldier (a mob template) or the commander (an NPC). */
export type MusterPostId = MusterSoldierTemplateId | typeof MUSTER_COMMANDER_NPC_ID;

export interface MusterSoldierSlot {
  templateId: MusterPostId;
  /** World-space offset from the camp centre, in yards. */
  dx: number;
  dz: number;
  /** This post's own resting heading, when it is not the camp's (the drillmaster faces
   *  the stake he pounds, not the gate). */
  facing?: number;
}

export interface MusterCampDef {
  id: MusterCampId;
  /** Camp centre (world x/z; y is grounded at spawn). */
  center: { x: number; z: number };
  /** The heading the camp's gate and its soldiers face at rest (sim convention:
   *  forward is (sin f, cos f), so 0 looks north along +z). */
  facing: number;
  /** A warpath stop (a picket) rather than the command camp. */
  onCircuit: boolean;
  /** Who stands here. The inner ring (within 5.5 yd of the centre) is what an arrival
   *  slam lands on; the two sentries stand 19+ yd out and live to see the next lap. */
  soldiers: readonly MusterSoldierSlot[];
  /** Ground the camp layout must leave bare (the command camp's drill yard, round the
   *  effigy). Circles in world XZ. */
  reserved?: readonly { x: number; z: number; r: number }[];
}

/** Inside this of a picket's centre stands the squad an arrival slam takes. */
export const MUSTER_INNER_RADIUS = 5.5;

/** A picket squad: five in the inner ring, two sentries posted out on the flanks. */
function picket(sentryA: [number, number], sentryB: [number, number]): MusterSoldierSlot[] {
  return [
    { templateId: 'muster_footman', dx: 0, dz: 3.2 },
    { templateId: 'muster_footman', dx: 3.0, dz: -1.2 },
    { templateId: 'muster_footman', dx: -3.0, dz: -1.2 },
    { templateId: 'muster_chaplain', dx: 1.6, dz: 0.6 },
    { templateId: 'muster_chaplain', dx: -1.6, dz: 0.6 },
    { templateId: 'muster_sergeant', dx: sentryA[0], dz: sentryA[1] },
    { templateId: 'muster_footman', dx: sentryB[0], dz: sentryB[1] },
  ];
}

// ---------------------------------------------------------------------------
// The drill yard (the command camp's back west corner)
// ---------------------------------------------------------------------------

/**
 * The Straw Foreman: the training effigy the soldiers built of him, about half his height,
 * with a lantern for an eye (src/sim/muster_effigy.ts runs the drill). It stands in the
 * command camp's back west corner, its own yard away from the Commander and the rack, its
 * face turned toward the middle of the camp: a player who walks over from the rack has the
 * target in front of them, and behind it is only the palisade and the trees (never the
 * south picket's squad, whose nameplates would crowd the lesson). Measured, like every post
 * here: dry ground, clear of every camp piece (the camp layout keeps MUSTER_DRILL_YARD bare)
 * and deep inside the command camp's keep-out circle, so the real Foreman never walks
 * through the lesson (tests/muster_effigy.test.ts).
 */
export const MUSTER_EFFIGY_POST = { x: 140.1, z: 199.5, facing: 0.95 } as const;
/** Ground the camp layout leaves bare round the effigy (its legs, props and fallen planks). */
export const MUSTER_EFFIGY_CLEAR_RADIUS = 2.2;
/** Yards from the effigy's face to the trainee's mark on the drill lane. */
export const MUSTER_DRILL_LANE_REACH = 7;
/** The trainee's mark: straight out from the effigy's face, MUSTER_DRILL_LANE_REACH away. */
export const MUSTER_DRILL_LANE = Object.freeze({
  x: MUSTER_EFFIGY_POST.x + Math.sin(MUSTER_EFFIGY_POST.facing) * MUSTER_DRILL_LANE_REACH,
  z: MUSTER_EFFIGY_POST.z + Math.cos(MUSTER_EFFIGY_POST.facing) * MUSTER_DRILL_LANE_REACH,
  /** A trainee on the mark faces the effigy. */
  facing: MUSTER_EFFIGY_POST.facing + Math.PI,
});
/**
 * The drillmaster's post: off the lane's back flank (the side away from the Commander),
 * about halfway down it, turned to face the lane. His mallet lands on the ground a stride
 * in front of him (src/sim/muster_drill.ts), between him and the trainee and well clear of
 * the effigy, so a blow reads as a stake driven into the yard, never as a swing at the dummy.
 */
export const MUSTER_DRILL_POST: {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
} = (() => {
  const f = MUSTER_EFFIGY_POST.facing;
  // along the lane (out from the effigy's face) and across it (its back flank)
  const along = { x: Math.sin(f), z: Math.cos(f) };
  const across = { x: Math.cos(f), z: -Math.sin(f) };
  const x = MUSTER_EFFIGY_POST.x + along.x * 3.5 + across.x * 4;
  const z = MUSTER_EFFIGY_POST.z + along.z * 3.5 + across.z * 4;
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  // turned to face the trainee's mark: the mallet lands between them, the effigy well
  // off to his side
  const facing = Math.atan2(along.x * 3.5 - across.x * 4, along.z * 3.5 - across.z * 4);
  return Object.freeze({ x: r3(x), z: r3(z), facing: r3(facing) });
})();
/**
 * The drill yard: the ground the camp layout keeps bare of every piece (tents, clutter,
 * walls), so the effigy, the lane and the drillmaster stand in their own open square and
 * their nameplates and the balance meter read cleanly. Centred between the effigy and the
 * trainee's mark, wide enough to take in both and the drillmaster's stake.
 */
export const MUSTER_DRILL_YARD = Object.freeze({
  x: (MUSTER_EFFIGY_POST.x + MUSTER_DRILL_LANE.x) / 2,
  z: (MUSTER_EFFIGY_POST.z + MUSTER_DRILL_LANE.z) / 2,
  r: 5.6,
});

export const MUSTER_CAMPS: readonly MusterCampDef[] = [
  {
    // On the crater's west rim, where the muster first dug in to watch him sleep.
    id: 'rim',
    center: { x: 121, z: 298 },
    facing: 2.95,
    onCircuit: true,
    soldiers: picket([-8, -18], [10, -17]),
  },
  {
    // Out on the dry flats toward the Widow Thicket road, the long leg's far end.
    id: 'west',
    center: { x: 104, z: 248 },
    facing: 1.04,
    onCircuit: true,
    soldiers: picket([-17, -10], [6, -19]),
  },
  {
    // At the foot of the southern rise, below the command camp. Its east sentry is posted
    // out toward the crater road, not up against the command camp's palisade, so the two
    // camps' soldiers never crowd one view.
    id: 'south',
    center: { x: 122, z: 226 },
    facing: 0.17,
    onCircuit: true,
    soldiers: picket([-19.5, -4], [18, 7.5]),
  },
  {
    // On the crater's south-west rim, 40 yards south of his bed in the bowl, in the one gap
    // in the rim's trees wide enough for a squad.
    id: 'crater',
    center: { x: 140, z: 268 },
    facing: -2.03,
    onCircuit: true,
    soldiers: picket([-12, -16], [6, -19]),
  },
  {
    // The command camp on the southern rise, with the weapon rack. Never a warpath stop.
    // Kept sparse on purpose: the Commander by the rack, the drillmaster in his yard, and
    // three soldiers with a job (the gate guard, the watch at the tower's foot, the
    // chaplain by the tents), so every nameplate here reads on its own.
    id: 'command',
    center: { x: 149, z: 206 },
    facing: -0.36,
    onCircuit: false,
    soldiers: [
      { templateId: MUSTER_COMMANDER_NPC_ID, dx: 0.5, dz: 2.5 },
      // Inside the gate, on its west post.
      { templateId: 'muster_footman', dx: -1.1, dz: 12.5 },
      // At the foot of the watchtower on the front east corner (muster_camp_layout.ts), on
      // its gate side.
      { templateId: 'muster_sergeant', dx: 5.8, dz: 7.2 },
      // Among the tents at the back of the camp.
      { templateId: 'muster_chaplain', dx: 4.2, dz: -6.8 },
      // The drill yard's mallet man, off the lane's flank.
      {
        templateId: 'muster_drillmaster',
        dx: MUSTER_DRILL_POST.x - 149,
        dz: MUSTER_DRILL_POST.z - 206,
        facing: MUSTER_DRILL_POST.facing,
      },
    ],
    reserved: [
      { x: MUSTER_EFFIGY_POST.x, z: MUSTER_EFFIGY_POST.z, r: MUSTER_EFFIGY_CLEAR_RADIUS },
      MUSTER_DRILL_YARD,
    ],
  },
];

/** Balgath's circuit, in walking order (the warpath destinations mirror it exactly). */
export const MUSTER_CIRCUIT: readonly MusterCampId[] = ['rim', 'west', 'south', 'crater'];

/** The weapon rack at the command camp: where anyone picks up a muster pike. */
export const MUSTER_RACK = { x: 146, z: 211, facing: -0.2 } as const;

/**
 * The muster's reach. A muster pike is lent for THIS fight: carried outside this circle
 * (the crater, all four pickets and the command camp, with room to kite him around them)
 * it is reclaimed, and the weapons it displaced go back in the player's hands. Fenbridge
 * is 130 yards away, well outside, so the pike never leaves the fen with anyone.
 */
export const MUSTER_PIKE_LEASH = { x: 124, z: 256, radius: 92 } as const;

export function musterCamp(id: MusterCampId): MusterCampDef {
  const camp = MUSTER_CAMPS.find((c) => c.id === id);
  if (!camp) throw new Error(`unknown muster camp ${id}`);
  return camp;
}

/**
 * The circle Balgath never sets foot in: the command camp, whose rack is the one place a
 * player walks up to without standing in his way. He phases through walls, so its palisade
 * cannot keep him out; this circle does (MobTemplate.keepOut, mob/keep_out.ts), for every
 * way he moves: a warpath leg, a focus-phase chase, a leash return, the walk to his bed.
 * Sized from the camp plan: its outermost piece reaches about 18.8 yards from the centre,
 * his body is about 3 yards across the shoulders from its middle, and the rest is margin
 * (tests/muster_camp_colliders.test.ts re-measures all three, and that every leg and his
 * walk home from every stop stays well clear of it).
 */
export const MUSTER_COMMAND_KEEP_OUT: {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
} = Object.freeze({
  x: musterCamp('command').center.x,
  z: musterCamp('command').center.z,
  radius: 24,
});

// ---------------------------------------------------------------------------
// The soldiers
// ---------------------------------------------------------------------------

/**
 * The muster's soldiers. Set dressing with a job: they stand their posts, face the Foreman,
 * brace when he comes, cheer when his eye goes out, and die in heaps where his fists land.
 * `musterSoldier` puts them on their own arm of the mob AI (never hostile, never in combat,
 * never on a hate table), so the stats below only size the corpse a slam leaves: nobody can
 * attack them, and every area blow the boss lands (the arrival slam, the smash, the stomp, the
 * hammer, the cleave) is lethal to them by rule (mob/boss_collateral.ts).
 * No loot and no experience, because nothing a player does can kill one.
 */
function soldier(
  id: MusterSoldierTemplateId,
  name: string,
  level: number,
  color: number,
): MobTemplate {
  return {
    id,
    name,
    minLevel: level,
    maxLevel: level,
    family: 'humanoid',
    musterSoldier: true,
    idleStationary: true,
    hpBase: 60,
    hpPerLevel: 22,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 2.0,
    armorPerLevel: 12,
    moveSpeed: 0,
    aggroRadius: 0,
    xpMult: 0,
    loot: [],
    scale: 1.0,
    color,
  };
}

export const MUSTER_MOBS: Record<MusterSoldierTemplateId | 'muster_effigy', MobTemplate> = {
  muster_footman: soldier('muster_footman', 'Muster Footman', 12, 0x8a3b2e),
  muster_chaplain: soldier('muster_chaplain', 'Muster Chaplain', 12, 0xd8cdb0),
  muster_sergeant: soldier('muster_sergeant', 'Muster Sergeant', 13, 0x7a2f25),
  // The drill yard's mallet man: he drives a stake beside the effigy, and every blow
  // shakes the ground under a couched pike the way a real slam does (muster_effigy.ts).
  muster_drillmaster: soldier('muster_drillmaster', 'Muster Drillmaster', 13, 0x7f3a28),
  // The Straw Foreman (below). Not a soldier: a practice target.
  muster_effigy: effigy(),
};

/**
 * The Muster Commander: the camp's leader, and the NPC the muster's three quests hang on
 * (content/mirefen_muster_quests.ts). Dynamic: the muster raises him with the rest of the
 * army (src/sim/mirefen_muster.ts) at his post in the command camp, so the world-init
 * entity order (and every golden pinned to it) never moves; `fixedPost` tells the map he
 * is always found at `pos` all the same.
 * "Commander", not "Captain": Muster Captain is a named unit in another game (Kings of
 * War's Halflings), and the originality rule forbids reusing a full name in the same role.
 */
export const MUSTER_COMMANDER_NPC: NpcDef = {
  id: MUSTER_COMMANDER_NPC_ID,
  name: 'Muster Commander',
  title: 'Fenbridge Muster',
  pos: { x: 149.5, z: 208.5 },
  facing: -0.36,
  color: 0x9c4a2c,
  questIds: ['q_muster_summons', 'q_muster_pike_drill', 'q_muster_trophy'],
  greeting:
    'Pikes first, $C, then everyone. That is the whole of it, and it has kept this camp alive.',
  dynamic: true,
  fixedPost: true,
};

// ---------------------------------------------------------------------------
// The training effigy
// ---------------------------------------------------------------------------

/**
 * The Straw Foreman. A practice target (`dummy`: never moves, aggros or swings, heals back
 * to full after a quiet spell, and its damage feeds the meters) wearing a plank "hide"
 * that turns away most of every blow, exactly as Barrowhide does on the real one, until a
 * pike puts its lantern out. Everything past that (the plank hide, the per-player window,
 * the drillmaster's pounding) is src/sim/muster_effigy.ts. The pool is the practice row's
 * 999,999: never felled for real.
 */
function effigy(): MobTemplate {
  return {
    id: MUSTER_EFFIGY_TEMPLATE_ID,
    name: 'Straw Foreman',
    minLevel: 20,
    maxLevel: 20,
    family: 'humanoid',
    dummy: true,
    idleStationary: true,
    hpBase: 999999,
    hpPerLevel: 0,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 2.0,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    xpMult: 0,
    loot: [],
    scale: 1.0,
    respawnSeconds: 10,
    ccImmune: true,
    slowImmune: true,
    color: 0xb08a4e,
  };
}

/** Ground-object template id of the command camp's weapon rack. */
export const MUSTER_RACK_TEMPLATE_ID = 'muster_weapon_rack';
/** The rack's display name (the object label; localized by the client entity resolver). */
export const MUSTER_RACK_NAME = 'Muster Weapon Rack';
