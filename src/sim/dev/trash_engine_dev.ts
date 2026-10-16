// /dev trashkit: playtest helpers for the trash engine's generic pieces
// (src/sim/mob/trash_kit/CLAUDE.md "Engine pieces"), in any claimed dungeon
// (ALLOW_DEV_COMMANDS only: handleDevChat is reached through the
// ctx.devCommands gate like every /dev branch).
//
//   /dev trashkit                    this help line
//   /dev trashkit demo               lend your target the demonstration kit
//                                    (engine_demo.ts: the line-of-sight nova
//                                    and the walker orb) and pull it
//   /dev trashkit cast <key>         your target (a kit mob in the fight)
//                                    starts that kit cast now: reanimate,
//                                    brand, cone, nova, walker, tailLash,
//                                    toss, goad, mend, call, ...
//   /dev trashkit wall               drop an Ice Slab combat wall 6 yd ahead
//   /dev trashkit pool <kind>        spill a hazard 5 yd ahead: boiling (the
//                                    Scaleguard's, burns players) or soulfire
//                                    (a toppled brazier's, burns mobs)
//   /dev trashkit split              drop your target just under its split
//   /dev trashkit freeze             take one stack of Creeping Rime
//   /dev trashkit brand              take a Branding Iron's brand
//   /dev trashkit quench             jump to the nearest quench pool
//   /dev trashkit clear              take the lent kit back off your target

import { DUNGEONS, instanceOrigin, MOBS } from '../data';
import { claimedInstanceAt } from '../instances/dungeons';
import { spawnCombatWall } from '../mob/trash_kit/combat_walls';
import { TRASH_ENGINE_DEMO_KIT } from '../mob/trash_kit/engine_demo';
import { applyFreezeStack } from '../mob/trash_kit/freeze_stacks';
import { spawnKitHazard } from '../mob/trash_kit/kit_hazard';
import { SANCTUM_ICE_SLAB } from '../mob/trash_kit/sanctum_cast_ids';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { displacePlayerForDev } from './dev_displace';

const HELP =
  '[dev] /dev trashkit demo | cast <key> | wall | pool <boiling|soulfire> | split | freeze | brand | quench | clear';

function log(ctx: SimContext, pid: number, text: string): void {
  ctx.emit({ type: 'log', text, pid });
}

/** The caller's target, when it is a living mob. */
function targetMob(ctx: SimContext, me: Entity): Entity | null {
  const t = me.targetId !== null ? ctx.entities.get(me.targetId) : undefined;
  return t && t.kind === 'mob' && !t.dead ? t : null;
}

function ahead(me: Entity, yards: number): { x: number; z: number } {
  return {
    x: me.pos.x + Math.sin(me.facing) * yards,
    z: me.pos.z + Math.cos(me.facing) * yards,
  };
}

export function handleTrashEngineDevChat(ctx: SimContext, raw: string, pid: number): boolean {
  const m = /^\/dev\s+trashkit(?:\s+(\S+))?(?:\s+(\S+))?\s*$/i.exec(raw);
  if (!m) return false;
  const verb = (m[1] ?? '').toLowerCase();
  const arg = m[2] ?? '';
  const me = ctx.entities.get(pid);
  if (!me) return true;
  const inst = claimedInstanceAt(ctx, me.pos);
  if (!verb) {
    ctx.error(pid, HELP);
    return true;
  }
  if (!inst) {
    ctx.error(pid, '[dev] Stand inside a claimed dungeon first.');
    return true;
  }
  const target = targetMob(ctx, me);
  switch (verb) {
    case 'demo': {
      if (!target) break;
      target.devTrashKit = TRASH_ENGINE_DEMO_KIT;
      target.trashKit = undefined;
      ctx.aggroMob(target, me, false);
      log(ctx, pid, `[dev] ${target.name} now carries the engine demo kit (nova, walker).`);
      return true;
    }
    case 'clear': {
      if (!target) break;
      target.devTrashKit = undefined;
      target.trashKit = undefined;
      log(ctx, pid, `[dev] ${target.name} is back on its own kit.`);
      return true;
    }
    case 'cast': {
      const st = target?.trashKit;
      if (!target || !st) {
        ctx.error(pid, '[dev] Target a kit mob that is in the fight.');
        return true;
      }
      if (!(arg in st.timers)) {
        ctx.error(pid, `[dev] ${target.name} has no kit cast "${arg}".`);
        return true;
      }
      st.timers[arg] = 0;
      log(ctx, pid, `[dev] ${target.name} casts ${arg} as soon as it can.`);
      return true;
    }
    case 'wall': {
      const at = ahead(me, 6);
      spawnCombatWall(ctx, inst, SANCTUM_ICE_SLAB, 'Ice Slab', at.x, at.z, me.facing, 15);
      log(ctx, pid, '[dev] An Ice Slab crashes down ahead (15 s).');
      return true;
    }
    case 'pool': {
      const at = ahead(me, 5);
      const kind = arg.toLowerCase();
      const spill = MOBS.soul_brazier?.trashKit?.usable?.effect;
      const def =
        kind === 'soulfire'
          ? spill?.kind === 'topple'
            ? spill.hazard
            : undefined
          : MOBS.sanctum_drakonid?.trashKit?.breathPool?.hazard;
      if (!def) break;
      spawnKitHazard(ctx, inst, me, def, at.x, at.z);
      log(ctx, pid, `[dev] ${def.name} spills ahead.`);
      return true;
    }
    case 'split': {
      const def = target ? (target.devTrashKit ?? MOBS[target.templateId]?.trashKit)?.split : null;
      if (!target || !def) {
        ctx.error(pid, '[dev] Target a mob that splits (a Glacier Splinter).');
        return true;
      }
      target.hp = Math.max(1, Math.floor(target.maxHp * def.belowHpPct) - 1);
      log(ctx, pid, `[dev] ${target.name} drops under its split.`);
      return true;
    }
    case 'freeze': {
      const def = MOBS.rime_whelp?.trashKit?.cone?.freezeStack;
      if (!def) break;
      applyFreezeStack(ctx, target ?? me, me, def, 'frost');
      return true;
    }
    case 'brand': {
      const def = MOBS.broodsworn_goadsmith?.trashKit?.brand;
      if (!def) break;
      ctx.applyAura(me, {
        id: def.auraId,
        name: def.auraName,
        kind: 'dot',
        remaining: def.seconds,
        duration: def.seconds,
        value: def.perTick,
        tickInterval: def.interval,
        tickTimer: def.interval,
        // Credited to the target so the quench recognises its kit's brand;
        // with no target it stays a plain burn.
        sourceId: target?.id ?? me.id,
        school: def.school,
      });
      return true;
    }
    case 'quench': {
      const dungeon = DUNGEONS[inst.dungeonId];
      const zones = dungeon?.quenchZones ?? [];
      const o = instanceOrigin(dungeon.index, inst.slot);
      let best: { x: number; z: number } | null = null;
      let bestD = Infinity;
      for (const q of zones) {
        const d = Math.hypot(me.pos.x - o.x - q.x, me.pos.z - o.z - q.z);
        if (d < bestD) {
          bestD = d;
          best = { x: o.x + q.x, z: o.z + q.z };
        }
      }
      if (!best) {
        ctx.error(pid, '[dev] This dungeon has no quench pools.');
        return true;
      }
      displacePlayerForDev(ctx, me, best.x, best.z);
      return true;
    }
  }
  ctx.error(pid, HELP);
  return true;
}
