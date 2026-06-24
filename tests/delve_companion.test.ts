import { describe, expect, it } from 'vitest';

import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

function makeSim(cls: 'hunter' | 'warrior' = 'warrior', seed = 42) {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}

function teleport(sim: Sim, x: number, z: number) {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

describe('delve companions', () => {
  it('solo enter spawns Acolyte Tessa', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    expect(run.companion?.companionId).toBe('companion_tessa');
    expect(sim.companionState?.companionId).toBe('companion_tessa');
  });

  it('companion level scales with purchased rank (50/75/100% of owner level)', () => {
    for (const [rank, expected] of [
      [1, 10],
      [2, 15],
      [3, 20],
    ] as const) {
      const sim = makeSim();
      sim.setPlayerLevel(20);
      const meta = (sim as any).players.get(sim.playerId);
      meta.companionUpgrades.companion_tessa = rank;
      teleport(sim, 0, 0);
      sim.enterDelve('collapsed_reliquary', 'normal');
      const run = sim.delveRunForPlayer(sim.playerId)!;
      const companion = sim.entities.get(run.companion!.entityId)!;
      expect(companion.level).toBe(expected);
    }
  });

  it('solid props block movement; pressure plates stay walkable', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);

    // A cracked grave pushes the player out of its footprint.
    const grave = [...sim.entities.values()].find((e) => e.templateId === 'delve_cracked_grave')!;
    expect(grave).toBeDefined();
    const pushed = (sim as any).clampDelveDoors(run, grave.pos.x, grave.pos.z, 0.5);
    expect(Math.hypot(pushed.x - grave.pos.x, pushed.z - grave.pos.z)).toBeGreaterThanOrEqual(1.4);

    // A pressure plate is NOT solid, you must be able to stand on it to trigger it.
    const plate = [...sim.entities.values()].find((e) => e.templateId === 'delve_pressure_plate')!;
    expect(plate).toBeDefined();
    const onPlate = (sim as any).clampDelveDoors(run, plate.pos.x, plate.pos.z, 0.5);
    expect(onPlate.x).toBeCloseTo(plate.pos.x);
    expect(onPlate.z).toBeCloseTo(plate.pos.z);

    // A point well clear of any prop is unchanged.
    const clear = (sim as any).clampDelveDoors(run, grave.pos.x + 20, grave.pos.z, 0.5);
    expect(clear.x).toBeCloseTo(grave.pos.x + 20);
  });

  it('stows hunter pet on enter and restores on leave', () => {
    const sim = makeSim('hunter');
    sim.setPlayerLevel(10);
    const boar = [...sim.entities.values()].find(
      (e) => e.templateId === 'wild_boar' && e.ownerId === null,
    );
    (sim as any).completeTame(sim.player, boar!);
    expect(sim.petOf(sim.playerId)?.templateId).toBe('wild_boar');
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    expect(sim.petOf(sim.playerId)).toBeNull();
    sim.leaveDelve();
    expect(sim.petOf(sim.playerId)?.templateId).toBe('wild_boar');
  });

  it('serializes the stowed pet while in a delve (no pet loss on mid-delve disconnect/save)', () => {
    const sim = makeSim('hunter');
    sim.setPlayerLevel(10);
    const boar = [...sim.entities.values()].find(
      (e) => e.templateId === 'wild_boar' && e.ownerId === null,
    );
    (sim as any).completeTame(sim.player, boar!);
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    // The live pet is despawned (stowed) while inside the delve...
    expect(sim.petOf(sim.playerId)).toBeNull();
    // ...but a save taken right now (autosave / disconnect / shutdown saveAll) must
    // still persist it from the stash, or the pet is lost when the character reloads.
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.pet?.templateId).toBe('wild_boar');
  });

  it('barks on boss pull', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const boss = [...sim.entities.values()].find((e) => e.templateId === 'deacon_varric');
    (sim as any).aggroMob(boss, sim.player, false);
    const bark = sim.tick().find((e) => e.type === 'companionBark');
    expect(bark?.barkId).toBe('boss_pull');
  });

  it('does not repeat a bark id within a run (dedup guard)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['reliquary_finale'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const boss = [...sim.entities.values()].find((e) => e.templateId === 'deacon_varric');
    (sim as any).aggroMob(boss, sim.player, false);
    const first = sim.tick().find((e) => e.type === 'companionBark' && e.barkId === 'boss_pull');
    expect(first).toBeDefined();
    // Re-trigger the same pull; the dedup guard must suppress a repeat bark.
    (sim as any).aggroMob(boss, sim.player, false);
    const second = sim.tick().find((e) => e.type === 'companionBark' && e.barkId === 'boss_pull');
    expect(second).toBeUndefined();
  });

  it('companion upgrade rank 2 costs 3 marks (Marks only, no copper)', () => {
    const sim = makeSim();
    const meta = (sim as any).players.get(sim.playerId);
    meta.delveMarks = 10;
    meta.copper = 100;
    sim.companionUpgrade('companion_tessa');
    expect(meta.companionUpgrades.companion_tessa).toBe(2);
    expect(meta.delveMarks).toBe(7);
    expect(meta.copper).toBe(100);
  });

  it('companion upgrade is a no-op without enough marks or for an unknown companion', () => {
    const sim = makeSim();
    const meta = (sim as any).players.get(sim.playerId);
    meta.companionUpgrades.companion_tessa = 1;
    meta.delveMarks = 2; // rank 2 costs 3 Marks, so this is short
    sim.companionUpgrade('companion_tessa');
    expect(meta.companionUpgrades.companion_tessa).toBe(1); // rank unchanged
    expect(meta.delveMarks).toBe(2); // marks not debited
    sim.companionUpgrade('no_such_companion');
    expect(meta.companionUpgrades.companion_tessa).toBe(1);
    expect(meta.delveMarks).toBe(2);
  });

  it('companion damages hostile mobs in combat', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    run.modules = ['reliquary_sunken_ossuary'];
    run.moduleIndex = 0;
    (sim as any).spawnDelveModule(run);
    const companion = sim.entities.get(run.companion!.entityId)!;
    const mob = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.hostile && e.templateId !== 'acolyte_tessa',
    )!;
    expect(mob).toBeDefined();
    const hpBefore = mob.hp;
    sim.player.targetId = mob.id;
    sim.player.autoAttack = true;
    sim.player.inCombat = true;
    mob.aggroTargetId = sim.playerId;
    companion.pos = { ...mob.pos };
    companion.prevPos = { ...companion.pos };
    companion.swingTimer = 0;
    for (let i = 0; i < 20 * 3; i++) {
      sim.tick();
      if (mob.hp < hpBefore) break;
    }
    expect(mob.hp).toBeLessThan(hpBefore);
  });

  it('companion heals owner on interval', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const companion = sim.entities.get(run.companion!.entityId)!;
    sim.player.hp = Math.max(1, Math.round(sim.player.maxHp * 0.5));
    companion.wanderTimer = 0;
    for (let i = 0; i < 20 * 4; i++) {
      sim.tick();
      if (sim.player.hp > Math.round(sim.player.maxHp * 0.5)) break;
    }
    expect(sim.player.hp).toBeGreaterThan(Math.round(sim.player.maxHp * 0.5));
  });
});
