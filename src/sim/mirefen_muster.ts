// The Mirefen muster, alive: the squads Warden Fenwick sent to contain Balgath.
//
// The camps and posts are data (src/sim/content/mirefen_muster.ts). This module is the
// army's whole lifecycle, driven once per tick from the world-boss scheduler pass
// (world_boss.ts), which is the one place that already knows whether the Foreman exists:
//
//   - MUSTER: on the live worlds (the realm server and the offline client, which opt in
//     with SimConfig.mirefenMuster) the army is raised on the FIRST pass, whether Balgath
//     is up, asleep, dead until dawn, or not spawned yet: the camps are the fen's, not the
//     fight's, and the weapon rack has to be there for anyone who walks up to it. Worlds
//     that do not opt in (the parity goldens, the RL env, bare test Sims) still raise it
//     the first time a Balgath exists (the scheduler's own spawn, or a dev spawn found by
//     a once-a-second scan), so no entity id moves in a world that never sees him. Once
//     raised it stays.
//   - STANCE: soldiers face him while he is within sight, and while he is ENGAGED and
//     close they brace (aggroTargetId on him, which is what the renderer reads to raise
//     the shield once and hold the guard). The brace has a release band a few yards
//     wider than its entry, so a giant pacing on the edge of it never flickers the guard
//     up and down. They never attack him, never enter combat (mob/muster_soldier.ts) and
//     never start the fight: only a player does.
//   - CHEERS: the moment his eye is put out, and the moment he falls, every soldier in
//     earshot cheers (the overhead emote channel players already use).
//   - WRECKAGE: every area blow he lands kills the soldiers standing in it (the arrival
//     slam, and the smash, stomp, hammer and cleave: mob/boss_collateral.ts, lethal to a
//     soldier by rule). A picket whose squad is already all down is RAZED, and his circuit
//     skips it (muster_picket_razed.ts, mob/warpath.ts), so he never marches on a camp of
//     corpses. The dead stay down for the WHOLE fight, and never rise while he is
//     engaged. They stand back up a few seconds after he FALLS, or once a reset pull has stayed
//     quiet for MUSTER_STAND_DOWN_SECONDS (a brief evade or leash blip mid-fight is not
//     the end of the pull: re-engaging calls the stand-down off), or at the next dawn if
//     he is not fighting, so the fen is never left without its muster for long.
//   - LOANS: the muster pike sweep (muster_pike.ts) rides the same pass, because "the pull
//     is over" is decided here, by the same rule the fallen stand up on: his death takes
//     the pikes back at once, any other end only once the stand-down has run quiet, so a
//     brief evade blip mid-fight never snatches a pike out of a raider's hands.
//
// State lives on Sim (MusterArmyState, a live SimContext view). Draws no rng: every spawn
// is at a fixed post with a fixed facing and a fixed level, every rule is arithmetic.

import {
  MUSTER_BOSS_TEMPLATE_ID,
  MUSTER_CAMPS,
  MUSTER_COMMANDER_NPC,
  MUSTER_COMMANDER_NPC_ID,
  MUSTER_RACK,
  MUSTER_RACK_NAME,
  MUSTER_RACK_TEMPLATE_ID,
} from './content/mirefen_muster';
import { MUSTER_PIKE_DRAWN_EVENT } from './content/mirefen_muster_quests';
import { MOBS } from './data';
import { createGroundObject, createMob, createNpc } from './entity';
import { isShardpikeItem } from './lance_balance_core';
import { eyeWardBlinded } from './mob/eye_ward';
import { tickMusterDrill } from './muster_drill';
import { raiseMusterEffigy, tickMusterEffigy } from './muster_effigy';
import { type LentPikes, takeMusterPike, tickLentPikes } from './muster_pike';
import { onQuestEventForQuests } from './quests/quest_credit';
import type { SimContext } from './sim_context';
import { angleTo, dist2d, type Entity, normAngle } from './types';

export { MUSTER_BOSS_TEMPLATE_ID };
/** Seconds after he FALLS before the fallen stand back up (time for the raid to see what
 *  he did, short enough that the fen looks manned again while the corpse is looted). */
export const MUSTER_RESPAWN_DELAY = 12;
/** Seconds a pull that ended WITHOUT his death (an evade, a leash, a wipe) must stay quiet
 *  before the fallen stand back up. Long on purpose: a raid that loses him for a moment
 *  and re-engages is still in the same fight, and the bodies it left must still be there.
 *  Any re-engage inside this window calls the stand-down off. */
export const MUSTER_STAND_DOWN_SECONDS = 150;
/** Soldiers turn to watch him inside this. */
export const MUSTER_WATCH_RANGE = 75;
/** ...and raise their guard inside this while he is engaged. */
export const MUSTER_BRACE_RANGE = 45;
/** A raised guard is lowered only once he is out past this (the hysteresis band that keeps
 *  a giant pacing on the brace edge from flickering the guard up and down). */
export const MUSTER_BRACE_RELEASE_RANGE = 52;
/** A cheer carries this far from him. */
export const MUSTER_CHEER_RANGE = 90;
/** How long one cheer holds the emote channel. */
export const MUSTER_CHEER_SECONDS = 3.2;
/** Soldiers re-aim at him only once he has moved this far round them (radians). */
export const MUSTER_FACING_STEP = 0.15;
/** A boss spawned outside the scheduler (dev tooling) is looked for this often. */
const BOSS_SCAN_EVERY_TICKS = 20;

export interface MusterArmyState {
  /** Every soldier ever raised, in post order. Empty until the muster is raised. */
  soldierIds: number[];
  /** Each soldier's resting facing (his camp's), parallel to soldierIds. */
  homeFacing: number[];
  /** The command camp's weapon rack (a ground object), once raised. */
  rackId: number | null;
  /** The Balgath the muster is watching, while one exists. */
  bossId: number | null;
  /** He was engaged on the previous pass: the falling edge is "the pull ended". */
  engaged: boolean;
  /** Edge detectors for the two cheers. */
  blinded: boolean;
  bossDead: boolean;
  /** Sim time the fallen stand back up, or null while nobody is due. Always null while he
   *  is engaged: nobody rises mid-fight. */
  respawnAt: number | null;
  /** Live muster pike loans (muster_pike.ts). */
  lent: LentPikes;
  /** The entity roster version the last dev-spawn scan saw (resolveBoss). */
  scannedRoster: number;
  /** The Muster Commander (the quest NPC at the command camp), once raised. */
  commanderId: number | null;
  /** The drill yard's effigy, the Straw Foreman (muster_effigy.ts), once raised. */
  effigyId: number | null;
  /** The drill yard's mallet man (muster_drill.ts), once raised. */
  drillmasterId: number | null;
  /** Sim time his next mallet blow is due, or his next look round while at ease
   *  (muster_drill.ts). */
  drillNextPoundAt: number;
  /** A set is under way: someone is couched in the yard and he is on the beat. */
  drillTraining: boolean;
  /** Each player's open window on the effigy: player id -> sim time it closes. */
  effigyWindows: Map<number, number>;
}

export function freshMusterArmy(): MusterArmyState {
  return {
    soldierIds: [],
    homeFacing: [],
    rackId: null,
    bossId: null,
    engaged: false,
    blinded: false,
    bossDead: false,
    respawnAt: null,
    lent: new Map(),
    scannedRoster: -1,
    commanderId: null,
    effigyId: null,
    drillmasterId: null,
    drillNextPoundAt: 0,
    drillTraining: false,
    effigyWindows: new Map(),
  };
}

/** Is the muster up in this world? */
export function musterRaised(army: MusterArmyState): boolean {
  return army.soldierIds.length > 0;
}

/**
 * One pass, from the world-boss scheduler. `scheduled` is the scheduler's own live Balgath
 * (null when its slot is empty); `dawn` is the scheduler's sunrise edge.
 */
export function tickMusterArmy(
  ctx: SimContext,
  army: MusterArmyState,
  scheduled: Entity | null,
  dawn: boolean,
): void {
  const boss = resolveBoss(ctx, army, scheduled);
  // The opt-in raise is the built-in fen's: an editor document has no muster camps.
  const atBoot = ctx.cfg.mirefenMuster && ctx.cfg.world === undefined;
  if (!musterRaised(army) && (boss || atBoot)) raiseMuster(ctx, army);
  if (!musterRaised(army)) return;

  const engaged = !!boss && !boss.dead && !boss.asleep && boss.inCombat;
  const pullEnded = army.engaged && !engaged;
  army.engaged = engaged;

  const blinded = !!boss && !boss.dead && eyeWardBlinded(ctx, boss);
  const bossDead = !!boss && boss.dead;
  const fell = bossDead && !army.bossDead;
  const cheer = (blinded && !army.blinded) || fell;
  army.blinded = blinded;
  army.bossDead = bossDead;
  army.respawnAt = nextStandUp(army.respawnAt, ctx.time, { engaged, fell, pullEnded, dawn });

  const standUp = army.respawnAt !== null && ctx.time >= army.respawnAt;
  for (let i = 0; i < army.soldierIds.length; i++) {
    const s = ctx.entities.get(army.soldierIds[i]);
    if (!s) continue;
    if (s.dead) {
      // Down until the muster stands him up: the ordinary in-place respawn must never
      // bring a soldier back mid-fight, and his body stays where the fist left it.
      s.respawnTimer = Number.POSITIVE_INFINITY;
      if (standUp) reform(ctx, s, army.homeFacing[i]);
      continue;
    }
    holdStance(s, boss, engaged, army.homeFacing[i]);
    if (cheer && boss && dist2d(s.pos, boss.pos) <= MUSTER_CHEER_RANGE) startCheer(ctx, s);
    else if (s.overheadEmoteId !== null && ctx.time >= s.overheadEmoteUntil) {
      s.overheadEmoteId = null;
    }
  }
  if (standUp) army.respawnAt = null;

  // The pull is over when he falls, or when the stand-down clock says so (a reset that has
  // stayed quiet, or a free dawn): the same moment the fallen rise, never on a blip.
  tickLentPikes(ctx, army.lent, fell || standUp);
  // The drill yard: the effigy's plank hide and every player's window on it, then the
  // drillmaster's mallet.
  tickMusterEffigy(ctx, army);
  tickMusterDrill(ctx, army);
}

/** The rack was used: lend a pike (interaction.ts routes both the interact key and the
 *  rack click here). True when a pike went into the player's hands. */
export function useMusterRack(ctx: SimContext, army: MusterArmyState, pid: number): boolean {
  const took = takeMusterPike(ctx, army.lent, pid);
  // The pike drill's first step (content/mirefen_muster_quests.ts): a player who leaves the
  // rack with a Shardpike in hand has done it, including one already carrying Skerrit's.
  const meta = ctx.players.get(pid);
  if (meta && isShardpikeItem(meta.equipment.mainhand)) {
    onQuestEventForQuests(ctx, meta, MUSTER_PIKE_DRAWN_EVENT);
  }
  return took;
}

/** Is this entity the muster's weapon rack? */
export function isMusterRack(e: Entity): boolean {
  return e.kind === 'object' && e.templateId === MUSTER_RACK_TEMPLATE_ID;
}

function resolveBoss(ctx: SimContext, army: MusterArmyState, scheduled: Entity | null) {
  if (scheduled && scheduled.templateId === MUSTER_BOSS_TEMPLATE_ID) {
    army.bossId = scheduled.id;
    return scheduled;
  }
  if (army.bossId !== null) {
    const held = ctx.entities.get(army.bossId);
    if (held && held.templateId === MUSTER_BOSS_TEMPLATE_ID) return held;
    army.bossId = null;
  }
  // No scheduled boss: a dev spawn (the boss test drive, /dev tooling) is still a Balgath
  // the muster should answer. A once-a-second scan is the whole cost, and only while no
  // boss is known; the live realm's scheduler hands him over directly.
  // And only when the roster has changed since the last look: a world that never spawns
  // him (the RL env, a long respawn gap on the live realm) pays nothing per second.
  if (ctx.tickCount % BOSS_SCAN_EVERY_TICKS !== 0) return null;
  if (army.scannedRoster === ctx.entityRosterVersion) return null;
  army.scannedRoster = ctx.entityRosterVersion;
  for (const e of ctx.entities.values()) {
    if (e.kind === 'mob' && e.templateId === MUSTER_BOSS_TEMPLATE_ID) {
      army.bossId = e.id;
      return e;
    }
  }
  return null;
}

function raiseMuster(ctx: SimContext, army: MusterArmyState): void {
  for (const camp of MUSTER_CAMPS) {
    for (const slot of camp.soldiers) {
      const pos = ctx.groundPos(camp.center.x + slot.dx, camp.center.z + slot.dz);
      const facing = slot.facing ?? camp.facing;
      if (slot.templateId === MUSTER_COMMANDER_NPC_ID) {
        // The commander is an NPC (the muster's quests), raised at his post with his men.
        const npc = createNpc(ctx.nextId++, MUSTER_COMMANDER_NPC, pos);
        npc.facing = facing;
        npc.prevFacing = facing;
        ctx.addEntity(npc);
        army.commanderId = npc.id;
        continue;
      }
      const template = MOBS[slot.templateId];
      if (!template) continue;
      const mob = createMob(ctx.nextId++, template, template.maxLevel, pos);
      mob.hostile = false;
      mob.facing = facing;
      mob.prevFacing = facing;
      mob.idleStationary = true;
      ctx.addEntity(mob);
      army.soldierIds.push(mob.id);
      army.homeFacing.push(facing);
      if (slot.templateId === 'muster_drillmaster') army.drillmasterId = mob.id;
    }
  }
  raiseMusterEffigy(ctx, army);
  const rack = createGroundObject(
    ctx.nextId++,
    '',
    MUSTER_RACK_NAME,
    ctx.groundPos(MUSTER_RACK.x, MUSTER_RACK.z),
  );
  rack.templateId = MUSTER_RACK_TEMPLATE_ID;
  rack.objectItemId = null;
  rack.lootable = true; // interactable
  rack.facing = MUSTER_RACK.facing;
  rack.prevFacing = MUSTER_RACK.facing;
  ctx.addEntity(rack);
  army.rackId = rack.id;
}

/** What moved the stand-up clock this pass (tickMusterArmy's edges). */
export interface StandUpEdges {
  /** He is in a live fight right now. */
  engaged: boolean;
  /** He died since the previous pass. */
  fell: boolean;
  /** He stopped being engaged since the previous pass (an evade, a leash, a wipe, a death). */
  pullEnded: boolean;
  /** The scheduler's sunrise edge. */
  dawn: boolean;
}

/**
 * When the fallen stand back up, as a pure function of the previous answer and this pass's
 * edges. Nobody rises while he is engaged (a pending stand-up is called off, which is what
 * makes a brief evade blip harmless); his death is the true end (a short delay); any other
 * end of the pull waits out MUSTER_STAND_DOWN_SECONDS of quiet; and a sunrise he is not
 * fighting through stands them up at once.
 */
export function nextStandUp(
  current: number | null,
  now: number,
  edges: StandUpEdges,
): number | null {
  if (edges.engaged) return null;
  let at = current;
  if (edges.fell) at = now + MUSTER_RESPAWN_DELAY;
  else if (edges.pullEnded) at = now + MUSTER_STAND_DOWN_SECONDS;
  if (edges.dawn) at = now;
  return at;
}

/** A living soldier's stance for this tick: watch him, brace while he is on them. */
function holdStance(s: Entity, boss: Entity | null, engaged: boolean, home: number): void {
  const watching =
    !!boss && !boss.dead && !boss.asleep && dist2d(s.pos, boss.pos) <= MUSTER_WATCH_RANGE;
  const want = watching && boss ? angleTo(s.pos, boss.pos) : home;
  // Turned in steps rather than tracked every tick: 36 bodies re-aiming 20 times a second
  // at a walking giant is 36 facing deltas per snapshot for every viewer in range, for a
  // turn nobody can see. A step this size is a head-turn the renderer's facing smoothing
  // eases anyway.
  if (Math.abs(normAngle(want - s.facing)) > MUSTER_FACING_STEP) s.facing = want;
  // Raised inside the brace range, lowered only past the wider release range: the guard is
  // a state the renderer raises ONCE and holds, so it must not blink on the band's edge.
  const braced = s.aggroTargetId !== null && boss !== null && s.aggroTargetId === boss.id;
  const reach = braced ? MUSTER_BRACE_RELEASE_RANGE : MUSTER_BRACE_RANGE;
  s.aggroTargetId = engaged && boss && dist2d(s.pos, boss.pos) <= reach ? boss.id : null;
}

function startCheer(ctx: SimContext, s: Entity): void {
  s.overheadEmoteId = 'cheer';
  s.overheadEmoteSeq += 1;
  s.overheadEmoteUntil = ctx.time + MUSTER_CHEER_SECONDS;
}

/** Stand a fallen soldier back up on his post, friendly, facing his camp's way. */
function reform(ctx: SimContext, s: Entity, home: number): void {
  ctx.respawnMob(s);
  s.hostile = false;
  s.aggroTargetId = null;
  s.facing = home;
  s.prevFacing = home;
  s.overheadEmoteId = null;
}
