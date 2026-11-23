// /dev bastion: playtest helpers for the Sunken Bastion rework (ALLOW_DEV_COMMANDS
// only: handleDevChat is reached through the ctx.devCommands gate like every
// /dev branch).
//
//   /dev bastion                         this help line
//   /dev bastion enter [normal|heroic]   claim a fresh run and step in
//   /dev bastion tp <area>               jump inside the run (enters first)
//   /dev bastion gates                   open every gate and seal for this run
//   /dev bastion kill <pack|boss|all>    kill a pack (f1 f2 fa fb f3 b1 b2 hermit bc
//                                        r1 r2 rc turnkey g1 g2 g3 gd k1 k2 k3 kc), a
//                                        boss (olen, ossick, vael) or everything
//   /dev bastion pack <pack>             jump to where a pack stands (or walks)
//   /dev bastion spawn <type>            raise one trash mob 10 yd ahead, pulled
//   /dev bastion trigger <mechanic>      fire a boss mechanic now (the boss must
//                                        be engaged): brine, bulwark, sentence,
//                                        oath, cage, anchor, shackle, veil, reap,
//                                        surge; intro, introshort, introskip bury
//                                        Vael for his entrance (or skip it)
//   /dev bastion reset                   free the run and claim a fresh one
//
// Areas: landing, flats, seagate, bailey, chapelyard, cisternyard, drawbridge,
// rampart, towerone, towertwo, bastion (or olen), postern, gaol, turnkey (the
// Gaol Turnkey), yard (or ossick), balconyone, balconytwo, court, crown (or vael).

import { SUNKEN_BASTION_ANCHORS } from '../content/sunken_bastion_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../data';
import { bastionDevTrigger } from '../encounters/sunken_bastion';
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

const DUNGEON_ID = 'sunken_bastion';

const A = SUNKEN_BASTION_ANCHORS;

export const SUNKEN_BASTION_DEV_AREAS: Readonly<Record<string, { x: number; z: number }>> = {
  landing: A.entry,
  flats: { x: -10, z: -196 },
  seagate: { x: 0, z: -138 },
  bailey: { x: 0, z: -124 },
  chapelyard: { x: -40, z: -110 },
  cisternyard: { x: 40, z: -110 },
  drawbridge: { x: 57, z: -52 },
  rampart: { x: 57, z: 14 },
  towerone: { x: 52, z: 20 },
  towertwo: { x: 52, z: 58 },
  bastion: { x: 57, z: 112 },
  olen: { x: 57, z: 112 },
  postern: { x: 26, z: 126 },
  gaol: { x: 2, z: 102 },
  turnkey: { x: -2, z: 74 },
  yard: { x: -2, z: 46 },
  ossick: { x: -2, z: 46 },
  balconyone: { x: -40, z: 20 },
  balconytwo: { x: -62, z: 64 },
  court: { x: -56, z: 136 },
  crown: { x: -16, z: 188 },
  vael: { x: -16, z: 188 },
};

const BOSS_ALIASES: Readonly<Record<string, string>> = {
  olen: 'knight_commander_olen',
  ossick: 'gaoler_ossick',
  vael: 'vael_the_mistcaller',
};

/** `/dev bastion spawn` names for each trash template. */
export const SUNKEN_BASTION_DEV_MOBS: Readonly<Record<string, string>> = {
  revenant: 'bastion_revenant',
  acolyte: 'tidebound_acolyte',
  watchman: 'drowned_watchman',
  arbalest: 'fogbound_arbalest',
  crawler: 'barnacle_crawler',
  warhound: 'bastion_warhound',
  mistweaver: 'mistweaver',
  sergeant: 'drowned_sergeant',
  prisoner: 'shackled_prisoner',
  turnkey: 'gaol_turnkey',
  hermit: 'turretback_hermit',
};

const HELP =
  '[dev] /dev bastion enter [normal|heroic] | tp <landing|flats|seagate|bailey|chapelyard|cisternyard|drawbridge|rampart|towerone|towertwo|bastion|olen|postern|gaol|turnkey|yard|ossick|balconyone|balconytwo|court|crown|vael> | gates | kill <f1|f2|fa|fb|f3|b1|b2|hermit|bc|r1|r2|rc|turnkey|g1|g2|g3|gd|k1|k2|k3|kc|olen|ossick|vael|all> | pack <id> | spawn <revenant|acolyte|watchman|arbalest|crawler|warhound|mistweaver|sergeant|prisoner|turnkey|hermit> | trigger <brine|bulwark|sentence|oath|cage|anchor|shackle|veil|reap|surge|intro|introshort|introskip> | reset';

/** Raise one trash mob ahead of the player, pulled at once. */
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

/** Handles `/dev bastion ...`; returns false for any other line. */
export function handleSunkenBastionDevChat(ctx: SimContext, raw: string, pid: number): boolean {
  const m = /^\/dev\s+bastion(?:\s+(\S+))?(?:\s+(\S+))?\s*$/i.exec(raw);
  if (!m) return false;
  const verb = (m[1] ?? '').toLowerCase();
  const arg = (m[2] ?? '').toLowerCase();
  if (verb === 'enter') {
    ctx.setDungeonDifficulty(arg === 'heroic' ? 'heroic' : 'normal', pid);
    if (enterDungeon(ctx, DUNGEON_ID, pid, true))
      log(
        ctx,
        pid,
        `[dev] Entering the Sunken Bastion (${arg === 'heroic' ? 'heroic' : 'normal'}).`,
      );
    return true;
  }
  if (verb === 'tp') {
    const area = SUNKEN_BASTION_DEV_AREAS[arg];
    if (!area) {
      ctx.error(pid, HELP);
      return true;
    }
    const inst = ensureInside(ctx, pid);
    const e = ctx.entities.get(pid);
    if (!inst || !e) {
      ctx.error(pid, '[dev] Could not enter the Sunken Bastion.');
      return true;
    }
    const o = instanceOrigin(DUNGEONS[DUNGEON_ID].index, inst.slot);
    displacePlayerForDev(ctx, e, o.x + area.x, o.z + area.z);
    log(ctx, pid, `[dev] Sunken Bastion: ${arg}.`);
    return true;
  }
  if (verb === 'gates') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    setDungeonGatesDevOpen(inst, true);
    log(ctx, pid, '[dev] Every Sunken Bastion gate and seal is open for this run.');
    return true;
  }
  if (verb === 'kill') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    const n = killMatching(ctx, pid, inst, arg || 'all');
    log(ctx, pid, `[dev] Killed ${n} Sunken Bastion mob${n === 1 ? '' : 's'} (${arg || 'all'}).`);
    return true;
  }
  if (verb === 'spawn') {
    const templateId = SUNKEN_BASTION_DEV_MOBS[arg];
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
    log(ctx, pid, `[dev] ${bastionDevTrigger(ctx, inst, arg)}`);
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
      spots.find(([dx, dz]) => ctx.groundPos(o.x + spawn.x + dx, o.z + spawn.z + dz).y > -20) ??
      spots[spots.length - 1];
    displacePlayerForDev(ctx, e, o.x + spawn.x + spot[0], o.z + spawn.z + spot[1]);
    log(ctx, pid, `[dev] Sunken Bastion: pack ${arg}.`);
    return true;
  }
  if (verb === 'reset') {
    const inst = claimFor(ctx, pid);
    if (inst) {
      leaveDungeon(ctx, pid);
      freeInstance(ctx, inst);
    }
    if (enterDungeon(ctx, DUNGEON_ID, pid, true))
      log(ctx, pid, '[dev] Sunken Bastion reset: a fresh run.');
    return true;
  }
  ctx.error(pid, HELP);
  return true;
}
