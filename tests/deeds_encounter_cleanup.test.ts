// Book of Deeds per-attempt encounter teardown. deedRuntime.encounters and the
// mender-taint set are keyed by boss entity id; entity ids are monotonic and never
// reused, so any despawn that fails to clear these leaks the entry forever (the 1 Hz
// proximity sweep then re-scans it every second). Two guards close that: the central
// dropEntityFromRoster seam every despawn passes through (freeInstance, freeDelveRun,
// spawnDelveModule all drop bosses through it), and a belt-and-braces prune in the
// sweep for any despawn path that bypassed the seam.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { onBossAddsSummonedForDeeds, onDamageDealtForDeeds, updateDeeds } from '../src/sim/deeds';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, Vec3 } from '../src/sim/types';

function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function spawnMob(sim: Sim, templateId: string, pos: Vec3, level = 10): Entity {
  const e = createMob(sim.ctx.nextId++, MOBS[templateId], level, pos);
  sim.addEntity(e);
  return e;
}

describe('deed encounter teardown', () => {
  it("dropEntityFromRoster clears a despawned mob's encounter and mender taint, but keeps bloatPending", () => {
    const sim = makeSim();
    const boss = spawnMob(sim, 'deacon_varric', { x: 0, y: 0, z: 0 });
    // An add-summon taint mints the per-attempt encounter entry.
    onBossAddsSummonedForDeeds(sim.ctx, boss, [777]);
    expect(sim.ctx.deedRuntime.encounters.has(boss.id)).toBe(true);
    // Seed the two sibling per-mob runtime maps to prove SELECTIVE cleanup.
    sim.ctx.deedRuntime.menderTainted.add(boss.id);
    sim.ctx.deedRuntime.bloatPending.set(boss.id, 42);
    // freeInstance / freeDelveRun / spawnDelveModule all drop bosses through this seam.
    sim.ctx.dropEntity(boss.id);
    expect(sim.ctx.deedRuntime.encounters.has(boss.id)).toBe(false);
    expect(sim.ctx.deedRuntime.menderTainted.has(boss.id)).toBe(false);
    // bloatPending is deliberately left: its delayed death-throes blast may still
    // resolve against the already-dropped corpse.
    expect(sim.ctx.deedRuntime.bloatPending.has(boss.id)).toBe(true);
  });

  it('the 1 Hz sweep prunes an encounter whose boss entity has vanished', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    const boss = spawnMob(sim, 'morthen', { x: player.pos.x + 2, y: 0, z: player.pos.z });
    // A damage tick on a participant-tracked boss opens the encounter entry.
    onDamageDealtForDeeds(sim.ctx, player, boss, 10, false, 'hit');
    expect(sim.ctx.deedRuntime.encounters.has(boss.id)).toBe(true);
    // A despawn path that bypassed the roster seam: the entity is simply gone.
    sim.entities.delete(boss.id);
    sim.tickCount = 20; // land the 1 Hz sweep exactly
    updateDeeds(sim.ctx);
    expect(sim.ctx.deedRuntime.encounters.has(boss.id)).toBe(false);
  });

  it('the sweep does NOT prune an active attempt whose boss is still alive', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    const boss = spawnMob(sim, 'morthen', { x: player.pos.x + 2, y: 0, z: player.pos.z });
    onDamageDealtForDeeds(sim.ctx, player, boss, 10, false, 'hit');
    expect(sim.ctx.deedRuntime.encounters.has(boss.id)).toBe(true);
    sim.tickCount = 20;
    updateDeeds(sim.ctx);
    expect(sim.ctx.deedRuntime.encounters.has(boss.id)).toBe(true);
  });
});
