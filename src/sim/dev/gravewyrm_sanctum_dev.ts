// /dev sanctum: playtest helpers for the Gravewyrm Sanctum, the Ice Tomb of the
// Wyrm (ALLOW_DEV_COMMANDS only: handleDevChat is reached through the
// ctx.devCommands gate like every /dev branch).
//
//   /dev sanctum                          this help line
//   /dev sanctum enter [normal|heroic]    claim a fresh run and step in
//   /dev sanctum tp <area|boss>           jump inside the run (enters first)
//   /dev sanctum gates                    open every gate and seal for this run
//   /dev sanctum kill <pack|boss|all>     kill a pack (g1 to g12, pa pb pc pd;
//                                         pa is the Sledge Tusker), a boss
//                                         (korgath, velkhar, korzul), the
//                                         trash, or all
//   /dev sanctum pack <pack>              jump to where a pack stands (or walks)
//   /dev sanctum spawn <type>             raise one mob 10 yd ahead, pulled
//   /dev sanctum trigger <mechanic>       fire an engaged Tusker's mechanic now:
//                                         sweep, trample, spill, enrage; or an
//                                         engaged Korgath's: maul, flail,
//                                         charge, bellow, strain, stomp,
//                                         enrage, break <tool>, rerivet <tool>
//                                         (hammer, tongs, anvil, bellows)
//   /dev sanctum face <0..8>              set the Calving Face's crack step
//                                         (0 arrival, 1 Tusker dead, 2 to 5
//                                         chains, 6 Korgath, 7 Velkhar, 8 the
//                                         wyrm torn free)
//   /dev sanctum reset                    free the run and claim a fresh one
//
// Areas: landing, court, road (or tusker), upper, lower, fork, serac,
// seraclower, anchor, anchorlower, terrace (or korgath), bridge, works,
// workslower, vault (or velkhar), shore, lake (or korzul). Each boss name lands
// beside that boss, on its floor.

import { GRAVEWYRM_SANCTUM_ANCHORS } from '../content/gravewyrm_sanctum_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../data';
import {
  enrageTusker,
  KORGATH_ID,
  KORZUL_ID,
  korgathDevTrigger,
  korzulDevTrigger,
  SLEDGE_TUSKER_ID,
  sanctumStoryTemplate,
  spillBraziers,
  startTrample,
  startTuskSweep,
  storyMarkers,
  tuskerState,
  VELKHAR_ID,
  velkharDevTrigger,
} from '../encounters/gravewyrm_sanctum';
import { bossEngaged, claimBoss } from '../encounters/gravewyrm_sanctum/claim';
import { createMob } from '../entity';
import {
  applyDungeonMobTuning,
  mobLevelForDungeonDifficulty,
  mobTemplateForDungeonDifficulty,
} from '../instances/difficulty';
import { setDungeonGatesDevOpen } from '../instances/dungeon_gates';
import { claimedInstanceAt, enterDungeon, freeInstance, leaveDungeon } from '../instances/dungeons';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { displacePlayerForDev } from './dev_displace';

const DUNGEON_ID = 'gravewyrm_sanctum';

const A = GRAVEWYRM_SANCTUM_ANCHORS;

export const GRAVEWYRM_SANCTUM_DEV_AREAS: Readonly<Record<string, { x: number; z: number }>> = {
  landing: A.entry,
  court: { x: 0, z: -196 },
  road: { x: -8, z: -165 },
  tusker: { x: -8, z: -165 },
  upper: { x: -30, z: -150 },
  lower: { x: 18, z: -104 },
  fork: { x: 0, z: -74 },
  serac: { x: -66, z: -80 },
  seraclower: { x: -82, z: -40 },
  anchor: { x: 66, z: -80 },
  anchorlower: { x: 84, z: -40 },
  terrace: { x: -14, z: -22 },
  korgath: { x: -14, z: -22 },
  bridge: { x: 0, z: -4 },
  works: { x: 0, z: 36 },
  workslower: { x: 0, z: 66 },
  vault: { x: 0, z: 92 },
  velkhar: { x: 0, z: 92 },
  shore: { x: 0, z: 134 },
  lake: { x: 0, z: 152 },
  korzul: { x: 0, z: 152 },
};

const BOSS_ALIASES: Readonly<Record<string, string>> = {
  korgath: 'korgath_the_bound',
  velkhar: 'grand_necromancer_velkhar',
  korzul: 'korzul_the_gravewyrm',
  tusker: SLEDGE_TUSKER_ID,
};

/** `/dev sanctum spawn` names for each creature. */
export const GRAVEWYRM_SANCTUM_DEV_MOBS: Readonly<Record<string, string>> = {
  boneguard: 'sanctum_boneguard',
  scaleguard: 'sanctum_drakonid',
  thawcaller: 'broodsworn_thawcaller',
  goadsmith: 'broodsworn_goadsmith',
  pyretender: 'broodsworn_pyre_tender',
  brazier: 'soul_brazier',
  whelp: 'rime_whelp',
  ogre: 'ogre_sledge_hauler',
  splinter: 'glacier_splinter',
  bonewalker: 'raised_bonewalker',
  tusker: SLEDGE_TUSKER_ID,
};

const HELP =
  '[dev] /dev sanctum enter [normal|heroic] | tp <landing|court|road|tusker|upper|lower|fork|serac|seraclower|anchor|anchorlower|terrace|korgath|bridge|works|workslower|vault|velkhar|shore|lake|korzul> | gates | kill <g1..g12|pa|pb|pc|pd|tusker|korgath|velkhar|korzul|trash|all> | pack <id> | spawn <boneguard|scaleguard|thawcaller|goadsmith|pyretender|brazier|whelp|ogre|splinter|bonewalker|tusker> | trigger <sweep|trample|spill|enrage|maul|flail|charge|bellow|strain|stomp|break <tool>|rerivet <tool>> | face <0..8> | reset';

/** Raise one mob ahead of the player, pulled at once. */
function devSpawn(ctx: SimContext, pid: number, inst: InstanceSlot, templateId: string): boolean {
  const me = ctx.entities.get(pid);
  const template = MOBS[templateId];
  if (!me || !template) return false;
  const x = me.pos.x + Math.sin(me.facing) * 10;
  const z = me.pos.z + Math.cos(me.facing) * 10;
  const mob = createMob(
    ctx.nextId++,
    mobTemplateForDungeonDifficulty(template, DUNGEON_ID, inst.difficulty),
    mobLevelForDungeonDifficulty(DUNGEON_ID, inst.difficulty, template.minLevel),
    ctx.groundPos(x, z),
  );
  applyDungeonMobTuning(mob, DUNGEON_ID, inst.difficulty);
  mob.facing = me.facing + Math.PI;
  mob.prevFacing = mob.facing;
  ctx.addEntity(mob);
  inst.mobIds.push(mob.id);
  ctx.aggroMob(mob, me, false);
  return true;
}

function log(ctx: SimContext, pid: number, text: string): void {
  ctx.emit({ type: 'log', text, pid });
}

function claimFor(ctx: SimContext, pid: number): InstanceSlot | null {
  const e = ctx.entities.get(pid);
  if (!e) return null;
  const inst = claimedInstanceAt(ctx, e.pos);
  return inst?.dungeonId === DUNGEON_ID ? inst : null;
}

function ensureInside(ctx: SimContext, pid: number): InstanceSlot | null {
  const inside = claimFor(ctx, pid);
  if (inside) return inside;
  if (!enterDungeon(ctx, DUNGEON_ID, pid, true)) return null;
  return claimFor(ctx, pid);
}

/** Kill the placements a `/dev sanctum kill` names. Returns how many fell. */
export function killSanctumMatching(
  ctx: SimContext,
  pid: number,
  inst: InstanceSlot,
  what: string,
): number {
  const killer = ctx.entities.get(pid) ?? null;
  const boss = BOSS_ALIASES[what];
  let killed = 0;
  DUNGEONS[DUNGEON_ID].spawns.forEach((spawn, i) => {
    const hit =
      what === 'all' ||
      // Every pack and patrol (the Tusker included), never a boss.
      (what === 'trash' && spawn.packId !== undefined) ||
      (boss !== undefined && spawn.mobId === boss) ||
      (spawn.packId !== undefined && spawn.packId === what);
    if (!hit) return;
    const mob = ctx.entities.get(inst.mobIds[i]);
    if (!mob || mob.dead) return;
    ctx.handleDeath(mob, killer);
    killed++;
  });
  return killed;
}

/** `/dev sanctum trigger <mechanic>`: fire an engaged Sledge Tusker's mechanic
 *  now, cutting whatever bar runs so it always shows. */
export function sanctumDevTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string {
  // An engaged boss answers first (each owns its own mechanic names).
  for (const [id, trigger] of [
    [KORGATH_ID, korgathDevTrigger],
    [VELKHAR_ID, velkharDevTrigger],
    [KORZUL_ID, korzulDevTrigger],
  ] as const) {
    const boss = claimBoss(ctx, inst, id);
    if (!boss || boss.dead || !bossEngaged(boss)) continue;
    const reply = trigger(ctx, inst, boss, what);
    if (reply !== null) return reply;
  }
  const tusker = claimBoss(ctx, inst, SLEDGE_TUSKER_ID);
  if (!tusker || tusker.dead || !bossEngaged(tusker))
    return 'Pull the Sledge Tusker first (sweep, trample, spill, enrage).';
  const st = tuskerState(tusker, false);
  if (tusker.castingAbility !== null) {
    tusker.castingAbility = null;
    tusker.castRemaining = 0;
  }
  st.charge = null;
  st.lane = null;
  if (what === 'sweep') return startTuskSweep(tusker, st) ? 'Tusk Sweep.' : 'The Tusker is busy.';
  if (what === 'trample')
    return startTrample(ctx, inst, tusker, st) ? 'Trample.' : 'Nobody to trample.';
  if (what === 'spill') {
    spillBraziers(ctx, inst, tusker, st);
    return 'Spilled Braziers.';
  }
  if (what === 'enrage') {
    enrageTusker(ctx, tusker, st);
    return 'Enrage.';
  }
  return 'Mechanics: sweep, trample, spill, enrage (the Sledge Tusker).';
}

/** Handles `/dev sanctum ...`; returns false for any other line. */
export function handleGravewyrmSanctumDevChat(ctx: SimContext, raw: string, pid: number): boolean {
  // Everything after the verb is its argument, however many words it runs to
  // (`trigger break hammer`, `trigger crack 5`): one capture of the rest of
  // the line, case-folded with its inner whitespace collapsed, so no word
  // count drops the line out of /dev sanctum into the unknown-command path.
  const m = /^\/dev\s+sanctum(?:\s+(\S+))?(?:\s+(.*?))?\s*$/i.exec(raw);
  if (!m) return false;
  const verb = (m[1] ?? '').toLowerCase();
  const arg = (m[2] ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (verb === 'enter') {
    ctx.setDungeonDifficulty(arg === 'heroic' ? 'heroic' : 'normal', pid);
    if (enterDungeon(ctx, DUNGEON_ID, pid, true))
      log(
        ctx,
        pid,
        `[dev] Entering the Gravewyrm Sanctum (${arg === 'heroic' ? 'heroic' : 'normal'}).`,
      );
    return true;
  }
  if (verb === 'tp') {
    const area = GRAVEWYRM_SANCTUM_DEV_AREAS[arg];
    if (!area) {
      ctx.error(pid, HELP);
      return true;
    }
    const inst = ensureInside(ctx, pid);
    const e = ctx.entities.get(pid);
    if (!inst || !e) {
      ctx.error(pid, '[dev] Could not enter the Gravewyrm Sanctum.');
      return true;
    }
    const o = instanceOrigin(DUNGEONS[DUNGEON_ID].index, inst.slot);
    displacePlayerForDev(ctx, e, o.x + area.x, o.z + area.z);
    log(ctx, pid, `[dev] Gravewyrm Sanctum: ${arg}.`);
    return true;
  }
  if (verb === 'gates') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    setDungeonGatesDevOpen(inst, true);
    log(ctx, pid, '[dev] Every Gravewyrm Sanctum gate and seal is open for this run.');
    return true;
  }
  if (verb === 'kill') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    const n = killSanctumMatching(ctx, pid, inst, arg || 'all');
    log(
      ctx,
      pid,
      `[dev] Killed ${n} Gravewyrm Sanctum mob${n === 1 ? '' : 's'} (${arg || 'all'}).`,
    );
    return true;
  }
  if (verb === 'spawn') {
    const templateId = GRAVEWYRM_SANCTUM_DEV_MOBS[arg];
    const inst = templateId ? ensureInside(ctx, pid) : null;
    if (!templateId || !inst) {
      ctx.error(pid, HELP);
      return true;
    }
    if (devSpawn(ctx, pid, inst, templateId))
      log(ctx, pid, `[dev] Spawned ${MOBS[templateId].name}.`);
    return true;
  }
  if (verb === 'trigger') {
    const inst = claimFor(ctx, pid);
    if (!inst) {
      ctx.error(pid, HELP);
      return true;
    }
    log(ctx, pid, `[dev] ${sanctumDevTrigger(ctx, inst, arg)}`);
    return true;
  }
  if (verb === 'face') {
    const step = Number(arg);
    const inst = Number.isInteger(step) && step >= 0 && step <= 8 ? ensureInside(ctx, pid) : null;
    if (!inst) {
      ctx.error(pid, HELP);
      return true;
    }
    // A dev step may also go DOWN (the run's own latch only ever rises).
    for (const marker of storyMarkers(ctx, inst)) marker.templateId = sanctumStoryTemplate(step);
    log(ctx, pid, `[dev] The Calving Face: crack step ${step}.`);
    return true;
  }
  if (verb === 'pack') {
    const spawn = DUNGEONS[DUNGEON_ID].spawns.find((s) => s.packId === arg);
    const inst = spawn ? ensureInside(ctx, pid) : null;
    const e = ctx.entities.get(pid);
    if (!spawn || !inst || !e) {
      ctx.error(pid, HELP);
      return true;
    }
    // Stand a little off the pack on its own floor (south first, toward the gate).
    const o = instanceOrigin(DUNGEONS[DUNGEON_ID].index, inst.slot);
    const floor = ctx.groundPos(o.x + spawn.x, o.z + spawn.z).y;
    const spots: [number, number][] = [
      [0, -16],
      [0, 16],
      [-16, 0],
      [16, 0],
      [0, -8],
      [0, 8],
      [0, 0],
    ];
    const spot =
      spots.find(
        ([dx, dz]) => Math.abs(ctx.groundPos(o.x + spawn.x + dx, o.z + spawn.z + dz).y - floor) < 2,
      ) ?? spots[spots.length - 1];
    displacePlayerForDev(ctx, e, o.x + spawn.x + spot[0], o.z + spawn.z + spot[1]);
    log(ctx, pid, `[dev] Gravewyrm Sanctum: pack ${arg}.`);
    return true;
  }
  if (verb === 'reset') {
    const inst = claimFor(ctx, pid);
    if (inst) {
      leaveDungeon(ctx, pid);
      freeInstance(ctx, inst);
    }
    if (enterDungeon(ctx, DUNGEON_ID, pid, true))
      log(ctx, pid, '[dev] Gravewyrm Sanctum reset: a fresh run.');
    return true;
  }
  ctx.error(pid, HELP);
  return true;
}
