// The world-boss spawn primitive and the dev boss drop, moved out of sim.ts under the
// monolith ratchet. Both allocate the entity id off `ctx.nextId` exactly as
// `this.nextId++` did on Sim, draw no rng (level is the template maximum, facing is
// fixed), and add the mob through the shared roster entry, so moving them here changes
// no id, no draw and no event order.
//
// Kept apart from world_boss.ts on purpose: that registry is read by world generation
// (terrain_calm_anchors.ts), and this file pulls in entity.ts (createMob) and the zone
// table, which a bundle that only wants the boss list must not drag along.

import { MOBS, zoneAt } from './data';
import { isDaylightPhase } from './day_night';
import { createMob } from './entity';
import type { SimContext } from './sim_context';
import type { WorldBossDef } from './world_boss';

/** Spawn one scheduled world boss at its fixed point. Null when its template is gone. */
export function spawnWorldBoss(ctx: SimContext, def: WorldBossDef): number | null {
  const template = MOBS[def.templateId];
  if (!template) return null;
  const pos = ctx.groundPos(def.pos.x, def.pos.z);
  const mob = createMob(ctx.nextId++, template, template.maxLevel, pos);
  mob.facing = 0;
  mob.prevFacing = 0;
  // World bosses use participant HP scaling (see scaleWorldBossHp), so their pool
  // starts at the def base rather than the template's level-formula HP.
  mob.maxHp = def.hpScale.base;
  mob.hp = def.hpScale.base;
  // A slumbering boss spawned into the NIGHT (a realm booting after dark) is already
  // in bed: neutral and asleep at his spawn point, with the "rises" announcement held
  // back for the dawn wake that actually opens the fight (mob/slumber.ts). Spawned
  // into the day he rises awake, exactly like every other world boss.
  const phase = ctx.dayNightPhase();
  const asleep = !!template.slumber && phase !== null && !isDaylightPhase(phase);
  if (template.slumber) mob.asleep = asleep;
  if (asleep) mob.hostile = false;
  ctx.addEntity(mob);
  // Anchorless log (no pid, no entityId) => routeEvents broadcasts to every
  // connected player as a system notice. Localized by sim_i18n's worldBossSpawn
  // RULE (matched on this exact literal shape). It names the boss's OWN zone: the
  // literal used to hardcode Thornpeak Heights, which was wrong the moment a second
  // world boss rose anywhere else.
  if (!asleep) {
    ctx.emit({
      type: 'log',
      text: `${template.name} rises over ${zoneAt(mob.pos.x, mob.pos.z).name}!`,
      color: '#ffd100',
    });
  }
  return mob.id;
}

/**
 * Drop a mob template into the world at an exact spot, for a dev playtest.
 *
 * Sibling of spawnDevBot / spawnDevVendor and dev-only for the same reason: it
 * bypasses every spawner (camps, world-boss scheduler, rift stamping) and answers to
 * a caller rather than to the world's own rules. Its one consumer is the boss
 * test-drive URL param (src/game/boss_test_drive.ts), which is DEV-build gated.
 *
 * Draws no rng, so calling it cannot perturb the shared draw stream and desync a
 * seeded run: the level is the template's own maximum and the facing is fixed, the
 * same discipline spawnWorldBoss keeps for the same reason.
 */
export function spawnDevBoss(ctx: SimContext, templateId: string, x: number, z: number): number {
  const template = MOBS[templateId];
  if (!template) return -1;
  const mob = createMob(ctx.nextId++, template, template.maxLevel, ctx.groundPos(x, z));
  mob.facing = 0;
  mob.prevFacing = 0;
  // A dev-spawned sleeper is dropped in awake, wherever the clock is: the slumber
  // driver puts him to bed on its own if it is night (mob/slumber.ts), which is exactly
  // what a test drive of the sleep set piece wants to watch happen.
  if (template.slumber) mob.asleep = false;
  ctx.addEntity(mob);
  return mob.id;
}
