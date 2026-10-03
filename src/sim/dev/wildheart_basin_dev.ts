// /dev wildheart: playtest helpers for the Wildheart Basin (ALLOW_DEV_COMMANDS
// only: handleDevChat is reached through the ctx.devCommands gate like every
// /dev branch).
//
//   /dev wildheart                          this help line
//   /dev wildheart enter [normal|heroic]    claim a fresh run and step in
//   /dev wildheart tp <area|boss>           jump inside the run (enters first)
//   /dev wildheart gates                    open every gate and seal for this run
//   /dev wildheart kill <pack|boss|all>     kill a pack (g1 to g13, pa pb pc pd;
//                                           pa is the Great Saurian), a boss
//                                           (beastmaster with his jaguar,
//                                           gorgebloom, zulgar), the trash, or all
//   /dev wildheart pack <pack>              jump to where a pack stands (or walks)
//   /dev wildheart spawn <type>             raise one mob 10 yd ahead, pulled
//   /dev wildheart trigger <mechanic>       fire an engaged encounter's mechanic
//                                           now: tail, stomp, howdah, enrage (the
//                                           Great Saurian); quake, stalk, hunt,
//                                           ward, heel (the Beastmaster); seeds,
//                                           pods, pollinate, lash, gorge (the
//                                           Gorgebloom); pulse, spirit, prey,
//                                           endhunt, ambush (Zulgar)
//   /dev wildheart reset                    free the run and claim a fresh one
//
// Areas: landing, fern, bank, ford (or saurian), steps, hunt, huntupper, pits
// (or beastmaster), ledge, behindfalls, falls (or gorgebloom), causeway,
// island, plaza, convergence, stair, shrinestair, shrine (or zulgar). Each boss
// name lands beside that boss, on its floor.

import { WILDHEART_BASIN_ANCHORS } from '../content/wildheart_basin_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../data';
import { wildheartDevTrigger } from '../encounters/wildheart_basin';
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

const DUNGEON_ID = 'wildheart_basin';

const A = WILDHEART_BASIN_ANCHORS;

export const WILDHEART_DEV_AREAS: Readonly<Record<string, { x: number; z: number }>> = {
  landing: A.entry,
  fern: { x: -31, z: -199 },
  bank: { x: 16, z: -146 },
  ford: { x: 20, z: -138 },
  saurian: { x: -18, z: -138 },
  steps: { x: 56, z: -124 },
  hunt: { x: -84, z: -72 },
  huntupper: { x: -90, z: -30 },
  pits: { x: -86, z: 16 },
  beastmaster: { x: -86, z: 16 },
  ledge: { x: 84, z: -74 },
  behindfalls: { x: 100, z: -40 },
  falls: { x: 92, z: 24 },
  gorgebloom: { x: 92, z: 24 },
  causeway: { x: 0, z: -84 },
  island: { x: 0, z: -44 },
  plaza: { x: 10, z: 10 },
  convergence: { x: 0, z: 96 },
  stair: { x: 0, z: 104 },
  shrinestair: { x: 0, z: 164 },
  shrine: { x: 0, z: 200 },
  zulgar: { x: 0, z: 200 },
};

const BOSS_ALIASES: Readonly<Record<string, readonly string[]>> = {
  beastmaster: ['wildheart_beastmaster', 'fanglord_jaguar'],
  jaguar: ['fanglord_jaguar'],
  gorgebloom: ['the_gorgebloom'],
  zulgar: ['wildheart_high_priest'],
  saurian: ['great_saurian'],
};

/** `/dev wildheart spawn` names for each creature. */
export const WILDHEART_DEV_MOBS: Readonly<Record<string, string>> = {
  stalker: 'wildheart_stalker',
  ravager: 'wildheart_ravager',
  hexcaller: 'wildheart_hexcaller',
  binder: 'sunbone_totem_binder',
  totem: 'sunbone_totem',
  raptor: 'basin_raptor',
  toad: 'spore_toad',
  lasher: 'vine_lasher',
  saurian: 'great_saurian',
  rider: 'howdah_hexcaller',
  jaguar: 'fanglord_jaguar',
  sprout: 'thorn_sprout',
};

const HELP =
  '[dev] /dev wildheart enter [normal|heroic] | tp <landing|fern|bank|ford|saurian|steps|hunt|huntupper|pits|beastmaster|ledge|behindfalls|falls|gorgebloom|causeway|island|plaza|convergence|stair|shrinestair|shrine|zulgar> | gates | kill <g1..g13|pa|pb|pc|pd|saurian|beastmaster|jaguar|gorgebloom|zulgar|trash|all> | pack <id> | spawn <stalker|ravager|hexcaller|binder|totem|raptor|toad|lasher|saurian|rider|jaguar|sprout> | trigger <tail|stomp|howdah|enrage|quake|stalk|hunt|ward|heel|seeds|pods|pollinate|lash|gorge|pulse|spirit|prey|endhunt|ambush> | reset';

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

/** Kill the placements a `/dev wildheart kill` names. Returns how many fell. */
export function killWildheartMatching(
  ctx: SimContext,
  pid: number,
  inst: InstanceSlot,
  what: string,
): number {
  const killer = ctx.entities.get(pid) ?? null;
  const bosses = BOSS_ALIASES[what];
  let killed = 0;
  DUNGEONS[DUNGEON_ID].spawns.forEach((spawn, i) => {
    const hit =
      what === 'all' ||
      // Every pack and patrol (the Saurian included), never a boss.
      (what === 'trash' && spawn.packId !== undefined && spawn.packId !== 'beastmaster') ||
      (bosses?.includes(spawn.mobId) ?? false) ||
      (spawn.packId !== undefined && spawn.packId === what);
    if (!hit) return;
    const mob = ctx.entities.get(inst.mobIds[i]);
    if (!mob || mob.dead) return;
    ctx.handleDeath(mob, killer);
    killed++;
  });
  return killed;
}

/** Handles `/dev wildheart ...`; returns false for any other line. */
export function handleWildheartBasinDevChat(ctx: SimContext, raw: string, pid: number): boolean {
  const m = /^\/dev\s+wildheart(?:\s+(\S+))?(?:\s+(\S+))?\s*$/i.exec(raw);
  if (!m) return false;
  const verb = (m[1] ?? '').toLowerCase();
  const arg = (m[2] ?? '').toLowerCase();
  if (verb === 'enter') {
    ctx.setDungeonDifficulty(arg === 'heroic' ? 'heroic' : 'normal', pid);
    if (enterDungeon(ctx, DUNGEON_ID, pid, true))
      log(
        ctx,
        pid,
        `[dev] Entering the Wildheart Basin (${arg === 'heroic' ? 'heroic' : 'normal'}).`,
      );
    return true;
  }
  if (verb === 'tp') {
    const area = WILDHEART_DEV_AREAS[arg];
    if (!area) {
      ctx.error(pid, HELP);
      return true;
    }
    const inst = ensureInside(ctx, pid);
    const e = ctx.entities.get(pid);
    if (!inst || !e) {
      ctx.error(pid, '[dev] Could not enter the Wildheart Basin.');
      return true;
    }
    const o = instanceOrigin(DUNGEONS[DUNGEON_ID].index, inst.slot);
    displacePlayerForDev(ctx, e, o.x + area.x, o.z + area.z);
    log(ctx, pid, `[dev] Wildheart Basin: ${arg}.`);
    return true;
  }
  if (verb === 'gates') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    setDungeonGatesDevOpen(inst, true);
    log(ctx, pid, '[dev] Every Wildheart Basin gate and seal is open for this run.');
    return true;
  }
  if (verb === 'kill') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    const n = killWildheartMatching(ctx, pid, inst, arg || 'all');
    log(ctx, pid, `[dev] Killed ${n} Wildheart Basin mob${n === 1 ? '' : 's'} (${arg || 'all'}).`);
    return true;
  }
  if (verb === 'spawn') {
    const templateId = WILDHEART_DEV_MOBS[arg];
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
    log(ctx, pid, `[dev] ${wildheartDevTrigger(ctx, inst, arg)}`);
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
    // Stand a little off the pack on its own floor (south first, toward the maw).
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
    log(ctx, pid, `[dev] Wildheart Basin: pack ${arg}.`);
    return true;
  }
  if (verb === 'reset') {
    const inst = claimFor(ctx, pid);
    if (inst) {
      leaveDungeon(ctx, pid);
      freeInstance(ctx, inst);
    }
    if (enterDungeon(ctx, DUNGEON_ID, pid, true))
      log(ctx, pid, '[dev] Wildheart Basin reset: a fresh run.');
    return true;
  }
  ctx.error(pid, HELP);
  return true;
}
