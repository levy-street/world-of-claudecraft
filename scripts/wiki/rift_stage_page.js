// Browser-side rift staging for scripts/wiki/render_attack_snapshots.mjs. Imported through
// Vite into the live offline client, so these are the game's own rift modules (the same
// instances the running Sim uses). A rift boss only runs its rank kit, its mechanic
// spacing and its windup rings when it was spawned by a real rift floor
// (src/sim/rift/runs.ts spawnRiftFloor stamps riftMechanicSpacing / riftMechanicLimit),
// so a boss is staged by entering a real rift at the chosen rank and walking it down to
// the floor that holds the boss. Nothing here changes game code: it calls the rift's own
// entry and descent functions and clears the trash between the player and the boss the
// way a fight would (handleDeath).

import { RIFT_THEMES } from '../../src/sim/content/rift/themes.ts';
import { RIFT_RANK_BASE_LEVEL } from '../../src/sim/rift/ranks.ts';
import { generateRiftPlan, isSetPieceSeed } from '../../src/sim/rift/rift_gen.ts';
import { descendRift, enterRift, riftInstanceAtPos } from '../../src/sim/rift/runs.ts';

const MAX_SEED = 200_000;

/** A seed whose rift ends on `bossId`'s theme (or, for a citadel boss, a set-piece seed). */
export function seedFor(bossId, rank, citadel) {
  const baseLevel = RIFT_RANK_BASE_LEVEL[rank];
  const themeId = citadel ? null : RIFT_THEMES.find((t) => t.boss === bossId)?.id;
  if (!citadel && !themeId) return null;
  for (let seed = 1; seed < MAX_SEED; seed++) {
    if (citadel) {
      if (isSetPieceSeed(seed)) return { seed, baseLevel };
      continue;
    }
    if (isSetPieceSeed(seed)) continue;
    const plan = generateRiftPlan(seed, baseLevel);
    if (plan.themeId === themeId) return { seed, baseLevel };
  }
  return null;
}

/** Enter the rift, descend to the floor that holds `bossId`, clear its other mobs, and
 *  stand the player a few yards from the boss. Resolves the boss entity id, or null. */
export function stageRiftBoss(bossId, seed, baseLevel) {
  const world = window.__game.world;
  const ctx = world.ctx;
  const pid = world.playerId;
  enterRift(ctx, seed, baseLevel, pid);
  for (let guard = 0; guard < 12; guard++) {
    const p = world.player;
    const inst = riftInstanceAtPos(ctx, p.pos);
    if (!inst) return { error: 'not inside a rift after entry' };
    const boss = inst.mobIds
      .map((id) => ctx.entities.get(id))
      .find((e) => e && !e.dead && e.templateId === bossId);
    if (boss) {
      for (const id of [...inst.mobIds]) {
        const e = ctx.entities.get(id);
        if (e && !e.dead && e !== boss) ctx.handleDeath(e, p);
      }
      const d = 7;
      const g = ctx.groundPos(boss.pos.x, boss.pos.z + d);
      p.pos = { ...g };
      p.prevPos = { ...g };
      ctx.aggroMob(boss, p, false);
      return { id: boss.id, floor: inst.floorIndex, floors: inst.floorCount };
    }
    if (inst.floorIndex >= inst.floorCount - 1)
      return {
        error: 'boss not on any floor',
        seedWanted: seed,
        instSeed: inst.seed,
        floor: inst.floorIndex,
        mobs: inst.mobIds.map((id) => ctx.entities.get(id)?.templateId),
      };
    inst.descentOpen = true;
    descendRift(ctx, pid);
  }
  return { error: 'descent did not reach the boss' };
}

/** Leave whatever rift the player stands in (between bosses). */
export async function leaveAnyRift() {
  const { leaveRift } = await import('../../src/sim/rift/runs.ts');
  leaveRift(window.__game.world.ctx, window.__game.world.playerId);
}
