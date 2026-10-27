// The Smith's Heart pulls like a raid, not like a five-player run: pulling a
// guardian brings only its own fight (the Hammer's is the Hammer Council: the
// Guardian, the Slabwright and the Seam Singer, one authored pack), never
// every mob of the claim. The dungeons' premature-boss punish
// (instances/boss_chain_pull.ts) stays off here, so the Hammer guardian on the
// Quarry floor no longer wakes the Ring, the Breath, the Quench and the Heat.

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { DUNGEONS } from '../src/sim/data';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import { Sim } from '../src/sim/sim';

describe("Smith's Heart guardian pull", () => {
  it('does not opt into the dungeon chain pull', () => {
    expect(DUNGEONS[SMITH_HEART_DUNGEON].bossChainPull).toBeUndefined();
  });

  it('pulling the Hammer guardian wakes its council and leaves the rest of the raid asleep', () => {
    const sim = new Sim({ seed: 17, playerClass: 'warrior', autoEquip: false, devCommands: true });
    const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
    dev('/dev heart enter');
    dev('/dev heart tp pit');
    sim.player.devGod = true;
    const boss = [...sim.ctx.entities.values()].find(
      (e) =>
        e.templateId === 'heart_hammer_guardian' &&
        !e.dead &&
        Math.abs(e.pos.x - sim.player.pos.x) < 200,
    );
    expect(boss).toBeDefined();
    if (!boss) return;
    sim.player.pos.x = boss.pos.x + 2;
    sim.player.pos.z = boss.pos.z;
    sim.player.pos.y = boss.pos.y;
    sim.targetEntity(boss.id);
    sim.startAutoAttack();
    for (let i = 0; i < 100; i++) sim.tick();
    expect(boss.aiState === 'chase' || boss.aiState === 'attack').toBe(true);
    const awake: string[] = [];
    for (const e of sim.ctx.entities.values()) {
      if (e.kind !== 'mob' || e.dead || e.id === boss.id) continue;
      if (Math.hypot(e.pos.x - boss.pos.x, e.pos.z - boss.pos.z) > 600) continue;
      if (e.aiState !== 'idle') awake.push(e.templateId);
    }
    expect(awake.sort()).toEqual(['heart_seam_singer', 'heart_slabwright']);
  });
});
