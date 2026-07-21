import { describe, expect, it } from 'vitest';

import { updateDelveCompanion } from '../src/sim/delves/companion';
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
    const bark = sim.tick().find((e) => e.type === 'companionBark' && e.barkId === 'boss_pull');
    expect(bark).toBeDefined();
  });

  it('barks a run_start greeting when the companion spawns', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const bark = sim.tick().find((e) => e.type === 'companionBark' && e.barkId === 'run_start');
    expect(bark).toBeDefined();
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
    // The event itself carries the speaker (hud must not depend on the mutable
    // companionState mirror, which can be momentarily null online).
    expect(first?.type === 'companionBark' ? first.companionId : null).toBe('companion_tessa');
    // Re-trigger the same pull; the dedup guard must suppress a repeat bark.
    (sim as any).aggroMob(boss, sim.player, false);
    const second = sim.tick().find((e) => e.type === 'companionBark' && e.barkId === 'boss_pull');
    expect(second).toBeUndefined();
  });

  it('rank 3 revives the fallen owner once per run at half health', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    const meta = (sim as any).players.get(sim.playerId);
    meta.companionUpgrades.companion_tessa = 3;
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const companion = sim.entities.get(run.companion!.entityId)!;
    const p = sim.player;
    p.dead = true;
    p.hp = 0;
    updateDelveCompanion((sim as any).ctx, companion);
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(Math.max(1, Math.round(p.maxHp * 0.5)));
    expect(run.companionReviveUsed).toBe(true);
    expect(sim.entities.has(companion.id)).toBe(true); // she stays with the run
    // Second death in the same run: the boon is spent, so the pre-existing
    // dead-owner despawn behavior applies unchanged.
    p.dead = true;
    p.hp = 0;
    updateDelveCompanion((sim as any).ctx, companion);
    expect(p.dead).toBe(true);
    expect(sim.entities.has(companion.id)).toBe(false);
  });

  it('rank 3 revive clears a movement intent held at death (issue 1651)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    const meta = (sim as any).players.get(sim.playerId);
    meta.companionUpgrades.companion_tessa = 3;
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const companion = sim.entities.get(run.companion!.entityId)!;
    const p = sim.player;
    // Hold forward, then die: handleDeath does not zero moveInput, so the flag
    // survives the dead interval and would re-activate the tick after the revive.
    meta.moveInput.forward = true;
    p.dead = true;
    p.hp = 0;
    updateDelveCompanion((sim as any).ctx, companion);
    expect(p.dead).toBe(false);
    expect(run.companionReviveUsed).toBe(true);
    // The revived owner must not auto-walk from the stale intent.
    expect(meta.moveInput.forward).toBe(false);
  });

  it('below rank 3 a dead owner still despawns the companion (no revive)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const companion = sim.entities.get(run.companion!.entityId)!;
    const p = sim.player;
    p.dead = true;
    p.hp = 0;
    updateDelveCompanion((sim as any).ctx, companion);
    expect(p.dead).toBe(true);
    expect(run.companionReviveUsed).toBe(false);
    expect(sim.entities.has(companion.id)).toBe(false);
  });

  it('rank 3 revive does not recharge by leaving and re-entering the run', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    const meta = (sim as any).players.get(sim.playerId);
    meta.companionUpgrades.companion_tessa = 3;
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const companion = sim.entities.get(run.companion!.entityId)!;
    const p = sim.player;
    p.dead = true;
    p.hp = 0;
    updateDelveCompanion((sim as any).ctx, companion);
    expect(p.dead).toBe(false); // boon spent on the first death
    expect(run.companionReviveUsed).toBe(true);
    // Door-cycle: leave (despawns the companion and re-mints its state on
    // re-entry) and rejoin the SAME claimed run; the spent flag lives on the
    // run, so the re-minted companion must not bring a fresh revive.
    sim.leaveDelve();
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run2 = sim.delveRunForPlayer(sim.playerId)!;
    expect(run2).toBe(run); // rejoined, not re-claimed
    expect(run2.companionReviveUsed).toBe(true);
    const companion2 = sim.entities.get(run2.companion!.entityId)!;
    p.dead = true;
    p.hp = 0;
    updateDelveCompanion((sim as any).ctx, companion2);
    expect(p.dead).toBe(true); // no second revive in the same run
  });

  it('companion respawns after an in-delve player death and release', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    expect(run.companion).toBeDefined();
    const oldId = run.companion!.entityId;

    // Kill the owner and advance a couple of ticks so the mob-AI pass runs the
    // owner-dead arm of updateDelveCompanion, which drops the companion entity
    // before the player's spirit is released (mirrors the live sequence).
    sim.player.dead = true;
    sim.player.hp = 0;
    sim.tick();
    sim.tick();
    expect(sim.entities.has(oldId)).toBe(false);

    sim.releaseSpirit();

    expect(run.companion).toBeDefined();
    expect(run.companion!.entityId).not.toBe(oldId);
    expect(sim.entities.has(run.companion!.entityId)).toBe(true);
    expect(sim.companionState).not.toBeNull();
  });

  it('companion respawns after death in the Drowned Litany (Edda Reedhand)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(14);
    teleport(sim, 0, 0);
    sim.enterDelve('drowned_litany', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    expect(run.companion?.companionId).toBe('companion_edda');
    const oldId = run.companion!.entityId;

    sim.player.dead = true;
    sim.player.hp = 0;
    sim.tick();
    sim.tick();
    expect(sim.entities.has(oldId)).toBe(false);

    sim.releaseSpirit();

    expect(run.companion?.companionId).toBe('companion_edda');
    expect(run.companion!.entityId).not.toBe(oldId);
    expect(sim.entities.has(run.companion!.entityId)).toBe(true);
  });

  it('respawning the companion after death does not recharge the rank 3 revive boon', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    const meta = (sim as any).players.get(sim.playerId);
    meta.companionUpgrades.companion_tessa = 3;
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const companion = sim.entities.get(run.companion!.entityId)!;

    // Spend the once-per-run revive first.
    sim.player.dead = true;
    sim.player.hp = 0;
    updateDelveCompanion((sim as any).ctx, companion);
    expect(sim.player.dead).toBe(false);
    expect(run.companionReviveUsed).toBe(true);

    // A real death now (revive already spent) drops the companion; release
    // should respawn her but must not reset the spent flag.
    sim.player.dead = true;
    sim.player.hp = 0;
    sim.tick();
    sim.tick();
    sim.releaseSpirit();

    expect(run.companionReviveUsed).toBe(true);
    expect(run.companion).toBeDefined();
    expect(sim.entities.has(run.companion!.entityId)).toBe(true);
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

  // Direct module-import tests: drive the moved updateDelveCompanion(ctx, companion)
  // straight against the live SimContext, proving src/sim/delves/companion.ts is the
  // owner (no Sim method involved) across the heal, heel, and combat arms.
  it('(module) heals the lowest-HP owner by the rank-scaled percent', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    teleport(sim, 0, 0);
    const meta = (sim as any).players.get(sim.playerId);
    meta.companionUpgrades.companion_tessa = 2; // DELVE_COMPANION_HEAL_PCT[2] = 0.08
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const companion = sim.entities.get(run.companion!.entityId)!;
    const p = sim.player;
    p.hp = Math.max(1, Math.round(p.maxHp * 0.5));
    companion.pos = { ...p.pos }; // within DELVE_COMPANION_HEAL_RANGE
    companion.prevPos = { ...companion.pos };
    companion.wanderTimer = 0; // heal cadence due this call
    const before = p.hp;
    updateDelveCompanion((sim as any).ctx, companion);
    const expected = Math.min(p.maxHp - before, Math.round(p.maxHp * 0.08));
    expect(expected).toBeGreaterThan(0);
    expect(p.hp).toBe(before + expected);
  });

  it('(module) heels toward the owner when not in combat', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    teleport(sim, 0, 0);
    sim.enterDelve('collapsed_reliquary', 'normal');
    const run = sim.delveRunForPlayer(sim.playerId)!;
    const companion = sim.entities.get(run.companion!.entityId)!;
    const p = sim.player;
    p.targetId = null;
    p.autoAttack = false;
    p.inCombat = false;
    // Drop hostile mobs so combatTarget is null and the heel arm runs.
    for (const [id, e] of [...sim.entities]) {
      if (e.kind === 'mob' && e.hostile) sim.entities.delete(id);
    }
    companion.pos = { x: p.pos.x + 10, y: p.pos.y, z: p.pos.z }; // > DELVE_COMPANION_FOLLOW (4)
    companion.prevPos = { ...companion.pos };
    companion.wanderTimer = 999; // keep the heal arm out of it
    const d0 = Math.hypot(companion.pos.x - p.pos.x, companion.pos.z - p.pos.z);
    updateDelveCompanion((sim as any).ctx, companion);
    const d1 = Math.hypot(companion.pos.x - p.pos.x, companion.pos.z - p.pos.z);
    expect(d1).toBeLessThan(d0); // moved toward the owner via ctx.moveToward
  });

  it('(module) acquires the owner target and swings it via mobSwing', () => {
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
    sim.player.targetId = mob.id; // companion prefers the owner's target
    companion.pos = { ...mob.pos };
    companion.prevPos = { ...companion.pos };
    companion.swingTimer = 0;
    for (let i = 0; i < 60; i++) {
      updateDelveCompanion((sim as any).ctx, companion);
      if (mob.hp < hpBefore) break;
    }
    expect(mob.hp).toBeLessThan(hpBefore);
  });
});
