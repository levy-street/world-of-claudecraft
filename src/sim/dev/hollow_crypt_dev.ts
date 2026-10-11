// /dev crypt: playtest helpers for the Hollow Crypt rework (ALLOW_DEV_COMMANDS
// only: handleDevChat is reached through the ctx.devCommands gate like every
// /dev branch).
//
//   /dev crypt                         this help line
//   /dev crypt enter [normal|heroic]   claim a fresh run and step in
//   /dev crypt tp <area>               jump inside the run (enters first)
//   /dev crypt gates                   open every gate and seal for this run
//   /dev crypt kill <pack|boss|all>    kill a pack (c1..c4, p1, drake, p2,
//                                      w1..w4, e1..e3, q1, q2, s1), marrow,
//                                      rimeweb, ilvane, morthen, or everything
//   /dev crypt pack <pack>             jump to where a pack stands (or flies)
//   /dev crypt spawn <type>            raise one trash mob 10 yd ahead, pulled:
//                                      warrior, adept, cutthroat, necromancer,
//                                      minion, brute, gargoyle (on a perch),
//                                      caller, crow, drake (lands from the sky),
//                                      widow; spawned mobs share one pack, so a
//                                      spawned necromancer rules spawned warriors
//   /dev crypt reset                   free the run and claim a fresh one
//   /dev crypt rise [skip]             wake Morthen's entrance now (or skip it:
//                                      he stands ready at the altar)
//   /dev crypt wyrm                    skip the entrance and slay Morthen: the
//                                      Knellwyrm finale starts (pyre, flight in)
//   /dev crypt trigger <strafe|bellow|knell> fire an engaged Knellwyrm's mechanic
//                                      now (knell: the heroic Burning Knell flight)
//   /dev crypt pull <marrow|lady|ilvane|morthen> open the gates, stand in the
//                                      boss's arena and pull it (Morthen skips
//                                      his entrance first)
//   /dev crypt trigger <shovel|grave|blow|toll>       Sexton Marrow now
//   /dev crypt trigger <lament|embrace|freeze>        the Lady of the Bonechill
//   /dev crypt trigger <dirge|organ|crescendo>        Cantor Ilvane
//   /dev crypt trigger <pulse|gravecall|rite|candle|reap|grasp>  Morthen (rite:
//                                      the Rite of the Unquiet now; candle: relight
//                                      the next candle; reap: his Last Rites sweep;
//                                      grasp: Grasp of the Grave)
//   /dev crypt hp <percent>            set every engaged boss to a share of its
//                                      health (66, 50, 33, 29: the phases; Morthen
//                                      64 for the Rite, 34 for his Last Rites)
//
// Areas: landing, cloister, grille, processional, yard, bellyard (marrow),
// gallery, rim, web (rimeweb), choir, loft (ilvane), stair, bonestair, ring
// (morthen).

import { HOLLOW_CRYPT_ANCHORS } from '../content/hollow_crypt_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../data';
import { cryptDevTrigger } from '../encounters/hollow_crypt';
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

const DUNGEON_ID = 'hollow_crypt';

export const HOLLOW_CRYPT_DEV_AREAS: Readonly<Record<string, { x: number; z: number }>> = {
  landing: HOLLOW_CRYPT_ANCHORS.entry,
  cloister: { x: 0, z: -74 },
  grille: { x: 0, z: 12 },
  processional: { x: 0, z: 40 },
  yard: { x: -60, z: 42 },
  bellyard: { x: -82, z: 104 },
  marrow: { x: -82, z: 104 },
  gallery: { x: 62, z: 30 },
  rim: { x: 105, z: 40 },
  web: { x: 80, z: 98 },
  rimeweb: { x: 80, z: 98 },
  lady: { x: 80, z: 98 },
  choir: { x: 0, z: 122 },
  loft: { x: 0, z: 152 },
  ilvane: { x: 0, z: 152 },
  stair: { x: 36, z: 161 },
  bonestair: { x: 64, z: 190 },
  ring: { x: 4, z: 226 },
  morthen: { x: 4, z: 226 },
};

const BOSS_ALIASES: Readonly<Record<string, string>> = {
  marrow: 'sexton_marrow',
  rimeweb: 'rimeweb',
  lady: 'rimeweb',
  ilvane: 'cantor_ilvane',
  morthen: 'morthen',
};

/** `/dev crypt spawn` names for each trash template. */
export const HOLLOW_CRYPT_DEV_MOBS: Readonly<Record<string, string>> = {
  warrior: 'crypt_ossuary_warrior',
  adept: 'crypt_gravecaller_adept',
  cutthroat: 'crypt_ossuary_cutthroat',
  necromancer: 'crypt_gravecaller_necromancer',
  minion: 'crypt_bone_minion',
  brute: 'crypt_bone_brute',
  gargoyle: 'crypt_chapel_gargoyle',
  caller: 'crypt_crow_caller',
  crow: 'crypt_carrion_crow',
  drake: 'crypt_ossuary_drake',
  widow: 'bonechill_widow',
};

const HELP =
  '[dev] /dev crypt enter [normal|heroic] | tp <landing|cloister|grille|processional|yard|bellyard|gallery|rim|web|choir|loft|stair|bonestair|ring> | gates | kill <c1..c4|p1|drake|p2|w1..w4|e1..e3|q1|q2|s1|marrow|rimeweb|ilvane|morthen|all> | pack <id> | spawn <warrior|adept|cutthroat|necromancer|minion|brute|gargoyle|caller|crow|drake|widow> | pull <marrow|lady|ilvane|morthen> | hp <percent> | rise [skip] | wyrm | trigger <shovel|grave|blow|toll|lament|embrace|freeze|dirge|organ|crescendo|pulse|gravecall|rite|candle|reap|grasp|strafe|bellow|knell> | reset';

/** Raise one trash mob ahead of the player, pulled at once (a gargoyle starts
 *  on a perch and a drake high in the sky, so both show their descent). */
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
  // One dev pack: a spawned necromancer rules spawned warriors (Reassemble,
  // Grave Rupture read the pack).
  mob.dungeonPackId = 'dev';
  mob.facing = me.facing + Math.PI;
  mob.prevFacing = mob.facing;
  const lift = template.trashKit?.perch ? 12 : template.trashKit?.land ? 20 : 0;
  if (template.trashKit?.perch) mob.perchY = mob.pos.y + lift;
  mob.pos.y += lift;
  mob.prevPos.y = mob.pos.y;
  if (lift > 0) mob.airY = mob.pos.y;
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

function killMatching(ctx: SimContext, pid: number, inst: InstanceSlot, what: string): number {
  const killer = ctx.entities.get(pid) ?? null;
  const boss = BOSS_ALIASES[what];
  let killed = 0;
  DUNGEONS[DUNGEON_ID].spawns.forEach((spawn, i) => {
    const hit =
      what === 'all' ||
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

/** Handles `/dev crypt ...`; returns false for any other line. */
export function handleHollowCryptDevChat(ctx: SimContext, raw: string, pid: number): boolean {
  const m = /^\/dev\s+crypt(?:\s+(\S+))?(?:\s+(\S+))?\s*$/i.exec(raw);
  if (!m) return false;
  const verb = (m[1] ?? '').toLowerCase();
  const arg = (m[2] ?? '').toLowerCase();
  if (verb === 'enter') {
    ctx.setDungeonDifficulty(arg === 'heroic' ? 'heroic' : 'normal', pid);
    if (enterDungeon(ctx, DUNGEON_ID, pid, true))
      log(ctx, pid, `[dev] Entering the Hollow Crypt (${arg === 'heroic' ? 'heroic' : 'normal'}).`);
    return true;
  }
  if (verb === 'tp') {
    const area = HOLLOW_CRYPT_DEV_AREAS[arg];
    if (!area) {
      ctx.error(pid, HELP);
      return true;
    }
    const inst = ensureInside(ctx, pid);
    const e = ctx.entities.get(pid);
    if (!inst || !e) {
      ctx.error(pid, '[dev] Could not enter the Hollow Crypt.');
      return true;
    }
    const o = instanceOrigin(DUNGEONS[DUNGEON_ID].index, inst.slot);
    displacePlayerForDev(ctx, e, o.x + area.x, o.z + area.z);
    log(ctx, pid, `[dev] Hollow Crypt: ${arg}.`);
    return true;
  }
  if (verb === 'gates') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    setDungeonGatesDevOpen(inst, true);
    log(ctx, pid, '[dev] Every Hollow Crypt gate and seal is open for this run.');
    return true;
  }
  if (verb === 'kill') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    const n = killMatching(ctx, pid, inst, arg || 'all');
    log(ctx, pid, `[dev] Killed ${n} Hollow Crypt mob${n === 1 ? '' : 's'} (${arg || 'all'}).`);
    return true;
  }
  if (verb === 'spawn') {
    const templateId = HOLLOW_CRYPT_DEV_MOBS[arg];
    const inst = templateId ? ensureInside(ctx, pid) : null;
    if (!templateId || !inst) {
      ctx.error(pid, HELP);
      return true;
    }
    if (devSpawn(ctx, pid, inst, templateId))
      log(ctx, pid, `[dev] Spawned ${MOBS[templateId].name}.`);
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
    // Stand a little off the pack on the floor (south first, toward the entrance).
    const o = instanceOrigin(DUNGEONS[DUNGEON_ID].index, inst.slot);
    const spots: [number, number][] = [
      [0, -16],
      [0, 16],
      [-16, 0],
      [16, 0],
      [0, -8],
      [0, 0],
    ];
    const spot =
      spots.find(([dx, dz]) => ctx.groundPos(o.x + spawn.x + dx, o.z + spawn.z + dz).y > -30) ??
      spots[spots.length - 1];
    displacePlayerForDev(ctx, e, o.x + spawn.x + spot[0], o.z + spawn.z + spot[1]);
    log(ctx, pid, `[dev] Hollow Crypt: pack ${arg}.`);
    return true;
  }
  if (verb === 'rise' || verb === 'wyrm' || verb === 'trigger') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    if (verb === 'rise') {
      log(ctx, pid, `[dev] ${cryptDevTrigger(ctx, inst, arg === 'skip' ? 'skip' : 'rise')}`);
      return true;
    }
    if (verb === 'wyrm') {
      cryptDevTrigger(ctx, inst, 'skip');
      const n = killMatching(ctx, pid, inst, 'morthen');
      log(
        ctx,
        pid,
        n > 0 ? '[dev] Morthen falls: the Knellwyrm is coming.' : '[dev] Morthen is already dead.',
      );
      return true;
    }
    log(ctx, pid, `[dev] ${cryptDevTrigger(ctx, inst, arg)}`);
    return true;
  }
  if (verb === 'pull') {
    const bossId = BOSS_ALIASES[arg];
    const area = HOLLOW_CRYPT_DEV_AREAS[arg];
    if (!bossId || !area) {
      ctx.error(pid, HELP);
      return true;
    }
    const inst = ensureInside(ctx, pid);
    const me = ctx.entities.get(pid);
    if (!inst || !me) return true;
    setDungeonGatesDevOpen(inst, true);
    const o = instanceOrigin(DUNGEONS[DUNGEON_ID].index, inst.slot);
    // Morthen: skip his entrance (he stands ready at the altar), then step in
    // south of him, inside the ring.
    if (bossId === 'morthen') cryptDevTrigger(ctx, inst, 'skip');
    const at = bossId === 'morthen' ? { x: 0, z: 200 } : area;
    displacePlayerForDev(ctx, me, o.x + at.x, o.z + at.z);
    const boss = inst.mobIds
      .map((id) => ctx.entities.get(id))
      .find((e) => e?.templateId === bossId && !e.dead);
    if (!boss) {
      log(ctx, pid, `[dev] ${arg} is already dead: /dev crypt reset for a fresh run.`);
      return true;
    }
    ctx.aggroMob(boss, me, false);
    log(ctx, pid, `[dev] Pulled ${MOBS[bossId].name}.`);
    return true;
  }
  if (verb === 'hp') {
    const pct = Number(arg);
    const inst = claimFor(ctx, pid);
    if (!inst || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
      ctx.error(pid, HELP);
      return true;
    }
    let n = 0;
    for (const id of inst.mobIds) {
      const e = ctx.entities.get(id);
      if (!e || e.dead || !e.inCombat) continue;
      if (
        e.templateId !== 'sexton_marrow' &&
        e.templateId !== 'rimeweb' &&
        e.templateId !== 'cantor_ilvane' &&
        e.templateId !== 'morthen' &&
        e.templateId !== 'crypt_knellwyrm'
      )
        continue;
      e.hp = Math.max(1, Math.floor((e.maxHp * pct) / 100));
      n++;
    }
    log(ctx, pid, `[dev] Set ${n} engaged boss${n === 1 ? '' : 'es'} to ${pct}% health.`);
    return true;
  }
  if (verb === 'reset') {
    const inst = claimFor(ctx, pid);
    if (inst) {
      leaveDungeon(ctx, pid);
      freeInstance(ctx, inst);
    }
    if (enterDungeon(ctx, DUNGEON_ID, pid, true))
      log(ctx, pid, '[dev] Hollow Crypt reset: a fresh run.');
    return true;
  }
  ctx.error(pid, HELP);
  return true;
}
