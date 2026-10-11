// /dev temple: playtest helpers for the Drowned Temple rework (ALLOW_DEV_COMMANDS
// only: handleDevChat is reached through the ctx.devCommands gate like every
// /dev branch).
//
//   /dev temple                          this help line
//   /dev temple enter [normal|heroic]    claim a fresh run and step in
//   /dev temple tp <area>                jump inside the run (enters first)
//   /dev temple gates                    open every gate and seal for this run
//   /dev temple kill <pack|boss|all>     kill a pack (g1 to g13, pa pb pc, hydra),
//                                        a boss (selthe, colossus, ysolei) or all
//   /dev temple pack <pack>              jump to where a pack stands (or walks)
//   /dev temple spawn <type>             raise one mob 10 yd ahead, pulled
//   /dev temple trigger <mechanic>       fire a boss mechanic now (the boss must
//                                        be engaged); see the help line
//   /dev temple reset                    free the run and claim a fresh one
//
// Areas: landing, steps, causeway, stones, island, colonnade, veil, court
// (or selthe), terraces, terracehigh, ledge, grotto, pool (or hydra), prism,
// prismhigh, terrace (or colossus), bridge, altarlanding, altar (or ysolei).
// Each boss name lands beside that boss, on its floor.

import { DROWNED_TEMPLE_ANCHORS } from '../content/drowned_temple_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../data';
import { templeDevTrigger } from '../encounters/drowned_temple';
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

const DUNGEON_ID = 'drowned_temple';

const A = DROWNED_TEMPLE_ANCHORS;

export const DROWNED_TEMPLE_DEV_AREAS: Readonly<Record<string, { x: number; z: number }>> = {
  landing: A.entry,
  steps: { x: -24, z: -180 },
  causeway: { x: -6, z: -148 },
  stones: { x: -6, z: -134 },
  island: { x: 2, z: -104 },
  colonnade: { x: 0, z: -76 },
  veil: { x: 0, z: -40 },
  court: { x: 0, z: -20 },
  selthe: { x: 0, z: -20 },
  terraces: { x: -40, z: 16 },
  terracehigh: { x: -64, z: 52 },
  ledge: { x: 42, z: 17 },
  grotto: { x: 74, z: 54 },
  pool: { x: 0, z: 72 },
  hydra: { x: 0, z: 72 },
  prism: { x: 30, z: 125 },
  prismhigh: { x: 58, z: 152 },
  terrace: { x: 80, z: 190 },
  colossus: { x: 80, z: 190 },
  bridge: { x: 50, z: 208 },
  altarlanding: { x: 36, z: 208 },
  altar: { x: 4, z: 206 },
  ysolei: { x: 4, z: 206 },
};

const BOSS_ALIASES: Readonly<Record<string, string>> = {
  selthe: 'choirmother_selthe',
  colossus: 'tideglass_colossus',
  ysolei: 'ysolei',
};

/** `/dev temple spawn` names for each creature. */
export const DROWNED_TEMPLE_DEV_MOBS: Readonly<Record<string, string>> = {
  templeguard: 'drowned_templeguard',
  acolyte: 'pale_choir_acolyte',
  lurker: 'glimmerscale_lurker',
  sentinel: 'pearlguard_sentinel',
  // The Moonmantle Ray (the sentinel's id, its new body and name).
  manta: 'pearlguard_sentinel',
  snapper: 'lagoon_snapper',
  wraith: 'ice_wraith',
  // The name it had while it was the Lagoon Eel.
  eel: 'ice_wraith',
  siren: 'moonlit_siren',
  wisp: 'tidewisp',
  pilgrim: 'drowned_pilgrim',
  moonspawn: 'moonspawn',
  reflection: 'tideglass_reflection',
};

const HELP =
  '[dev] /dev temple enter [normal|heroic] | tp <landing|steps|causeway|stones|island|colonnade|veil|court|selthe|terraces|terracehigh|ledge|grotto|pool|hydra|prism|prismhigh|terrace|colossus|bridge|altarlanding|altar|ysolei> | gates | kill <g1..g13|pa|pb|pc|hydra|selthe|colossus|ysolei|trash|all> | pack <id> | spawn <templeguard|acolyte|lurker|sentinel|snapper|wraith|siren|wisp|pilgrim|moonspawn|reflection> | trigger <chorus|solo|duet|bolt|aria|surge|breath|spit|torrent|tsunami|regrow|reflections|lance|fracture|undertow|flood> | reset';

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

function killMatching(ctx: SimContext, pid: number, inst: InstanceSlot, what: string): number {
  const killer = ctx.entities.get(pid) ?? null;
  const boss = BOSS_ALIASES[what];
  let killed = 0;
  DUNGEONS[DUNGEON_ID].spawns.forEach((spawn, i) => {
    const hit =
      what === 'all' ||
      // Every pack and patrol, the bosses and the Hydra left standing.
      (what === 'trash' && spawn.packId !== undefined && spawn.packId !== 'hydra') ||
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

/** Handles `/dev temple ...`; returns false for any other line. */
export function handleDrownedTempleDevChat(ctx: SimContext, raw: string, pid: number): boolean {
  const m = /^\/dev\s+temple(?:\s+(\S+))?(?:\s+(\S+))?\s*$/i.exec(raw);
  if (!m) return false;
  const verb = (m[1] ?? '').toLowerCase();
  const arg = (m[2] ?? '').toLowerCase();
  if (verb === 'enter') {
    ctx.setDungeonDifficulty(arg === 'heroic' ? 'heroic' : 'normal', pid);
    if (enterDungeon(ctx, DUNGEON_ID, pid, true))
      log(
        ctx,
        pid,
        `[dev] Entering the Drowned Temple (${arg === 'heroic' ? 'heroic' : 'normal'}).`,
      );
    return true;
  }
  if (verb === 'tp') {
    const area = DROWNED_TEMPLE_DEV_AREAS[arg];
    if (!area) {
      ctx.error(pid, HELP);
      return true;
    }
    const inst = ensureInside(ctx, pid);
    const e = ctx.entities.get(pid);
    if (!inst || !e) {
      ctx.error(pid, '[dev] Could not enter the Drowned Temple.');
      return true;
    }
    const o = instanceOrigin(DUNGEONS[DUNGEON_ID].index, inst.slot);
    displacePlayerForDev(ctx, e, o.x + area.x, o.z + area.z);
    log(ctx, pid, `[dev] Drowned Temple: ${arg}.`);
    return true;
  }
  if (verb === 'gates') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    setDungeonGatesDevOpen(inst, true);
    log(ctx, pid, '[dev] Every Drowned Temple gate and seal is open for this run.');
    return true;
  }
  if (verb === 'kill') {
    const inst = ensureInside(ctx, pid);
    if (!inst) return true;
    const n = killMatching(ctx, pid, inst, arg || 'all');
    log(ctx, pid, `[dev] Killed ${n} Drowned Temple mob${n === 1 ? '' : 's'} (${arg || 'all'}).`);
    return true;
  }
  if (verb === 'spawn') {
    const templateId = DROWNED_TEMPLE_DEV_MOBS[arg];
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
    log(ctx, pid, `[dev] ${templeDevTrigger(ctx, inst, arg)}`);
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
    log(ctx, pid, `[dev] Drowned Temple: pack ${arg}.`);
    return true;
  }
  if (verb === 'reset') {
    const inst = claimFor(ctx, pid);
    if (inst) {
      leaveDungeon(ctx, pid);
      freeInstance(ctx, inst);
    }
    if (enterDungeon(ctx, DUNGEON_ID, pid, true))
      log(ctx, pid, '[dev] Drowned Temple reset: a fresh run.');
    return true;
  }
  ctx.error(pid, HELP);
  return true;
}
