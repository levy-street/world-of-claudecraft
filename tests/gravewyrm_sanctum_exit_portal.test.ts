// Korzul's exit must be earned, stand on the lake's permanent rim, belong to
// its own claim only, and go away on a reset. Walking into it is pinned in
// gravewyrm_sanctum_access.test.ts.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  GRAVEWYRM_HEIGHTS,
  GRAVEWYRM_SANCTUM_FIELD,
} from '../src/sim/content/gravewyrm_sanctum_layout';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';
import {
  claimedInstanceAt,
  enterDungeon,
  leaveDungeon,
  resetDungeonInstances,
  spawnBossExitPortal,
} from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { DungeonDifficulty, Entity, WorldContent } from '../src/sim/types';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const DUNGEON = DUNGEONS.gravewyrm_sanctum;

function setup(difficulty: DungeonDifficulty) {
  const sim = new Sim({ seed: 41, playerClass: 'warrior', noPlayer: true, world: WORLD });
  const pid = sim.addPlayer('warrior', 'Shorewalker');
  sim.setPlayerLevel(20, pid);
  sim.setDungeonDifficulty(difficulty, pid);
  expect(enterDungeon(sim.ctx, DUNGEON.id, pid)).toBe(true);
  const player = sim.entities.get(pid);
  if (!player) throw new Error('No player');
  const inst = claimedInstanceAt(sim.ctx, player.pos);
  if (!inst) throw new Error('No Sanctum claim');
  const origin = instanceOrigin(DUNGEON.index, inst.slot);
  const boss = (templateId: string): Entity => {
    const mob = inst.mobIds
      .map((id) => sim.entities.get(id))
      .find((e) => e?.templateId === templateId);
    if (!mob) throw new Error(`No ${templateId}`);
    return mob;
  };
  return { sim, pid, player, inst, origin, boss };
}

describe.each(['normal', 'heroic'] as const)('the Sanctum exit on %s', (difficulty) => {
  it('opens once on Korzul death, on the solid lake rim, only for that claim', () => {
    const { sim, player, inst, origin, boss } = setup(difficulty);
    const otherPid = sim.addPlayer('warrior', 'Otherwalker');
    sim.setPlayerLevel(20, otherPid);
    sim.setDungeonDifficulty(difficulty, otherPid);
    expect(enterDungeon(sim.ctx, DUNGEON.id, otherPid)).toBe(true);
    const other = sim.entities.get(otherPid);
    if (!other) throw new Error('No second player');
    const otherInst = claimedInstanceAt(sim.ctx, other.pos);
    if (!otherInst) throw new Error('No second Sanctum claim');
    expect(otherInst).not.toBe(inst);
    for (const id of ['korgath_the_bound', 'grand_necromancer_velkhar']) {
      sim.ctx.handleDeath(boss(id), player);
      expect(inst.bossExitId).toBeNull();
    }
    const korzul = boss('korzul_the_gravewyrm');
    sim.ctx.handleDeath(korzul, player);
    const exitId = inst.bossExitId;
    if (exitId === null) throw new Error('Korzul did not open an exit');
    const exit = sim.entities.get(exitId);
    if (!exit) throw new Error('No spawned exit entity');
    expect(exit.templateId).toBe('dungeon_exit');
    expect(exit.dungeonId).toBe(DUNGEON.id);
    expect(exit.pos.x - origin.x).toBeCloseTo(-42, 5);
    expect(exit.pos.z - origin.z).toBeCloseTo(192, 5);
    expect(exit.pos.y).toBe(GRAVEWYRM_HEIGHTS.lake);
    expect(authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, -42, 192)).toBe(GRAVEWYRM_HEIGHTS.lake);
    expect(isBlocked(sim.cfg.seed, exit.pos.x, exit.pos.z, 0.5)).toBe(false);
    expect(inst.objectIds.filter((id) => id === exitId)).toHaveLength(1);
    expect(otherInst.bossExitId).toBeNull();
    expect(otherInst.objectIds).not.toContain(exitId);
    // The spawning seam is idempotent even if a death callback is delivered twice.
    spawnBossExitPortal(sim.ctx, korzul);
    expect(inst.bossExitId).toBe(exitId);
    expect(inst.objectIds.filter((id) => id === exitId)).toHaveLength(1);
    expect(
      inst.objectIds.filter((id) => sim.entities.get(id)?.templateId === 'dungeon_exit'),
    ).toHaveLength(1);
  });

  it('removes the old boss portal during a real difficulty reset', () => {
    const { sim, pid, player, inst, boss } = setup(difficulty);
    sim.ctx.handleDeath(boss('korzul_the_gravewyrm'), player);
    const exitId = inst.bossExitId;
    const claimId = inst.exitId;
    if (exitId === null) throw new Error('No boss exit');
    leaveDungeon(sim.ctx, pid);
    // Reset requires all loot to have been collected and everyone to be outside.
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id);
      if (mob) {
        mob.lootable = false;
        mob.loot = { copper: 0, items: [] };
      }
    }
    const nextDifficulty = difficulty === 'normal' ? 'heroic' : 'normal';
    sim.setDungeonDifficulty(nextDifficulty, pid);
    resetDungeonInstances(sim.ctx, pid);
    expect(inst.exitId).not.toBe(claimId);
    expect(inst.difficulty).toBe(nextDifficulty);
    expect(inst.bossExitId).toBeNull();
    expect(inst.objectIds).not.toContain(exitId);
    expect(sim.entities.has(exitId)).toBe(false);
  });
});
