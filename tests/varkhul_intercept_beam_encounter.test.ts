import { describe, expect, it } from 'vitest';
import {
  updateVarkhulEncounter,
  VARKHUL_BOSS_ID,
  VARKHUL_INTERCEPT_BEAM_CAST_ID,
  VARKHUL_INTERCEPT_BEAM_CAST_SECONDS,
  VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID,
  VARKHUL_INTERCEPT_BEAM_DEBUFF_DAMAGE_TAKEN,
  VARKHUL_INTERCEPT_BEAM_DEBUFF_SECONDS,
} from '../src/sim/encounters/varkhul';
import { IGNIVAR_SECOND_WING_ID } from '../src/sim/ignivar_raid_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';
import { VARKHUL_SHARED_PYRE_AURA_ID } from '../src/sim/varkhul_shared_pyre';

function encounter(heroic = false): { sim: Sim; boss: Entity } {
  const sim = new Sim({ seed: 9417, playerClass: 'warrior', devCommands: true });
  expect(enterDungeon(sim.ctx, IGNIVAR_SECOND_WING_ID, sim.player.id, true)).toBe(true);
  const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
  if (!instance) throw new Error('Inner Crucible instance missing');
  instance.difficulty = heroic ? 'heroic' : 'normal';
  const boss = instance.mobIds
    .map((id) => sim.entities.get(id))
    .find((entity) => entity?.templateId === VARKHUL_BOSS_ID);
  if (!boss) throw new Error('Varkhul missing');
  const tankMeta = sim.players.get(sim.player.id);
  if (!tankMeta) throw new Error('Tank metadata missing');
  tankMeta.talentMods.role = 'tank';
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  boss.swingTimer = 999;
  sim.player.pos = sim.ctx.groundPos(boss.pos.x, boss.pos.z + 5);
  sim.player.prevPos = { ...sim.player.pos };
  return { sim, boss };
}

function addDps(sim: Sim, boss: Entity, name: string): Entity {
  const pid = sim.addPlayer('mage', name);
  const meta = sim.players.get(pid);
  const player = meta ? sim.entities.get(meta.entityId) : undefined;
  if (!meta || !player) throw new Error(`${name} missing`);
  meta.talentMods.role = 'dps';
  player.pos = sim.ctx.groundPos(boss.pos.x, boss.pos.z + 20);
  player.prevPos = { ...player.pos };
  return player;
}

function armOnlyInterceptBeam(sim: Sim, boss: Entity): NonNullable<Entity['varkhul']> {
  updateVarkhulEncounter(sim.ctx, boss);
  const state = boss.varkhul;
  if (!state) throw new Error('Varkhul state missing');
  state.makersBrandTimer = 999;
  state.frontalTimer = 999;
  state.cinderOrbsTimer = 999;
  state.forgestormTimer = 999;
  state.sharedPyreTimer = 999;
  state.anvilTimer = 999;
  state.sharedPyreTimer = 999;
  state.interceptBeamTimer = DT;
  return state;
}

describe('Varkhul Tempering Ray encounter integration', () => {
  it('starts on the exact first-cast tick when no other major mechanic is active', () => {
    const { sim, boss } = encounter();
    addDps(sim, boss, 'Cadence Smith');
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.makersBrandTimer = 999;
    state.frontalTimer = 999;
    state.cinderOrbsTimer = 999;
    state.forgestormTimer = 999;
    state.anvilTimer = 999;
    state.sharedPyreTimer = 999;
    state.interceptBeamTimer = 17;

    for (let tick = 0; tick < 339; tick++) {
      updateVarkhulEncounter(sim.ctx, boss);
      expect(state.majorAbility).toBe('none');
    }
    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.majorAbility).toBe('interceptBeam');
    expect(boss.castingAbility).toBe(VARKHUL_INTERCEPT_BEAM_CAST_ID);
  });

  it('recasts after exactly 32 active seconds and rotates away from a wounded target', () => {
    const { sim, boss } = encounter();
    const firstDps = addDps(sim, boss, 'First Smith');
    const secondDps = addDps(sim, boss, 'Second Smith');
    firstDps.damageImmune = true;
    secondDps.damageImmune = true;
    const state = armOnlyInterceptBeam(sim, boss);

    updateVarkhulEncounter(sim.ctx, boss);
    const firstTargetId = state.interceptBeamTargetId;
    expect([firstDps.id, secondDps.id]).toContain(firstTargetId);
    sim.player.pos = sim.ctx.groundPos(boss.pos.x + 8, boss.pos.z + 8);
    state.interceptBeamCastRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    const firstTarget = sim.entities.get(firstTargetId as number);
    expect(firstTarget?.auras).toContainEqual(
      expect.objectContaining({ id: VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID, remaining: 30 }),
    );
    expect(state.interceptBeamTimer).toBe(32);

    for (let tick = 0; tick < 639; tick++) {
      updateVarkhulEncounter(sim.ctx, boss);
      expect(state.majorAbility).toBe('none');
      expect(sim.activeVarkhulAssemblies[0].interceptBeam).toBeNull();
    }
    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.majorAbility).toBe('interceptBeam');
    expect(state.interceptBeamTargetId).not.toBe(firstTargetId);
    expect([firstDps.id, secondDps.id]).toContain(state.interceptBeamTargetId);
  });

  it('does not start during another major or an active forge-beam window', () => {
    const major = encounter();
    addDps(major.sim, major.boss, 'Serialized Smith');
    const majorState = armOnlyInterceptBeam(major.sim, major.boss);
    majorState.frontalTimer = DT;
    updateVarkhulEncounter(major.sim.ctx, major.boss);
    expect(majorState.majorAbility).toBe('frontal');
    expect(majorState.interceptBeamTargetId).toBeNull();
    const timerDuringMajor = majorState.interceptBeamTimer;
    updateVarkhulEncounter(major.sim.ctx, major.boss);
    expect(majorState.majorAbility).toBe('frontal');
    expect(majorState.interceptBeamTimer).toBe(timerDuringMajor);

    const forge = encounter();
    addDps(forge.sim, forge.boss, 'Forge Window Smith');
    const forgeState = armOnlyInterceptBeam(forge.sim, forge.boss);
    forgeState.interceptBeamTimer = 1.7;
    forgeState.forgeBeamWindow = 'teaching_left';
    forgeState.forgeBeamWindowRemaining = 99;
    forgeState.assemblyForgeBeamActiveMask = 1;
    forgeState.assemblyForgeBeamWarmupRemaining = 1;
    updateVarkhulEncounter(forge.sim.ctx, forge.boss);
    expect(forgeState.majorAbility).toBe('none');
    expect(forgeState.interceptBeamTimer).toBe(1.7);
    expect(forgeState.interceptBeamTargetId).toBeNull();
  });

  it('runs a due Tempering Ray before Shared Pyre and never starts both together', () => {
    const { sim, boss } = encounter();
    const target = addDps(sim, boss, 'Serialized Pyre Smith');
    const state = armOnlyInterceptBeam(sim, boss);
    state.sharedPyreTimer = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.majorAbility).toBe('interceptBeam');
    expect(state.interceptBeamTargetId).toBe(target.id);
    expect(state.sharedPyreTargetId).toBeNull();
    expect(target.auras.some((aura) => aura.id === VARKHUL_SHARED_PYRE_AURA_ID)).toBe(false);

    state.interceptBeamCastRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.majorAbility).toBe('none');
    expect(state.sharedPyreTargetId).toBeNull();

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.majorAbility).toBe('sharedPyre');
    expect(state.interceptBeamTargetId).toBeNull();
    expect(state.sharedPyreTargetId).toBe(target.id);
    expect(target.auras.some((aura) => aura.id === VARKHUL_SHARED_PYRE_AURA_ID)).toBe(true);
  });

  it('fixates a non-tank, follows their movement, and publishes the current interceptor', () => {
    const { sim, boss } = encounter();
    const target = addDps(sim, boss, 'Marked Smith');
    const state = armOnlyInterceptBeam(sim, boss);

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.majorAbility).toBe('interceptBeam');
    expect(boss).toMatchObject({
      castingAbility: VARKHUL_INTERCEPT_BEAM_CAST_ID,
      castTargetId: target.id,
      castTotal: VARKHUL_INTERCEPT_BEAM_CAST_SECONDS,
    });
    expect(sim.activeVarkhulAssemblies[0].interceptBeam).toMatchObject({
      sourceId: boss.id,
      targetId: target.id,
      blockerId: sim.player.id,
      targetX: target.pos.x,
      targetZ: target.pos.z,
    });

    target.pos = sim.ctx.groundPos(boss.pos.x + 14, boss.pos.z + 14);
    sim.player.pos = sim.ctx.groundPos(boss.pos.x + 7, boss.pos.z + 7);
    updateVarkhulEncounter(sim.ctx, boss);

    expect(boss.castAim).toEqual(target.pos);
    expect(sim.activeVarkhulAssemblies[0].interceptBeam).toMatchObject({
      targetX: target.pos.x,
      targetZ: target.pos.z,
      blockerId: sim.player.id,
      blockerX: sim.player.pos.x,
      blockerZ: sim.player.pos.z,
    });
  });

  it('excludes the current aggro target even when that player has no tank role', () => {
    const { sim, boss } = encounter();
    const aggroMeta = sim.players.get(sim.player.id);
    if (!aggroMeta) throw new Error('Aggro player metadata missing');
    aggroMeta.talentMods.role = 'dps';
    const eligible = addDps(sim, boss, 'Eligible Smith');
    const state = armOnlyInterceptBeam(sim, boss);
    state.interceptBeamCastKey = 1;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(boss.aggroTargetId).toBe(sim.player.id);
    expect(state.interceptBeamTargetId).toBe(eligible.id);
  });

  it('excludes an authored off-tank even when that player does not hold aggro', () => {
    const { sim, boss } = encounter();
    const offTank = addDps(sim, boss, 'Off Tank');
    const offTankMeta = sim.players.get(offTank.id);
    if (!offTankMeta) throw new Error('Off-tank metadata missing');
    offTankMeta.talentMods.role = 'tank';
    const eligible = addDps(sim, boss, 'Eligible Smith');
    const state = armOnlyInterceptBeam(sim, boss);
    state.interceptBeamCastKey = 1;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(boss.aggroTargetId).toBe(sim.player.id);
    expect(state.interceptBeamTargetId).toBe(eligible.id);
  });

  it('hits and scars the first interceptor while leaving the marked player untouched', () => {
    const { sim, boss } = encounter();
    const target = addDps(sim, boss, 'Protected Smith');
    const state = armOnlyInterceptBeam(sim, boss);
    updateVarkhulEncounter(sim.ctx, boss);
    sim.player.damageImmune = false;
    sim.player.hp = sim.player.maxHp;
    target.hp = target.maxHp;
    const tankHp = sim.player.hp;
    const targetHp = target.hp;
    state.interceptBeamCastRemaining = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(tankHp - Math.ceil(sim.player.maxHp * 0.7));
    expect(target.hp).toBe(targetHp);
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({
        id: VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID,
        kind: 'vuln_source',
        remaining: 30,
        value: VARKHUL_INTERCEPT_BEAM_DEBUFF_DAMAGE_TAKEN,
        sourceId: boss.id,
      }),
    );
    expect(VARKHUL_INTERCEPT_BEAM_DEBUFF_SECONDS).toBe(30);
    expect(state).toMatchObject({
      majorAbility: 'none',
      interceptBeamTargetId: null,
      interceptBeamBlockerId: null,
    });
    expect(sim.activeVarkhulAssemblies[0].interceptBeam).toBeNull();
  });

  it('punishes the marked player when nobody intercepts and lets immunity soak the hit', () => {
    const first = encounter();
    const exposedTarget = addDps(first.sim, first.boss, 'Exposed Smith');
    const exposedState = armOnlyInterceptBeam(first.sim, first.boss);
    updateVarkhulEncounter(first.sim.ctx, first.boss);
    first.sim.player.pos = first.sim.ctx.groundPos(first.boss.pos.x + 8, first.boss.pos.z + 8);
    exposedTarget.damageImmune = false;
    exposedTarget.hp = exposedTarget.maxHp;
    exposedState.interceptBeamCastRemaining = DT;

    updateVarkhulEncounter(first.sim.ctx, first.boss);

    expect(exposedTarget.hp).toBe(exposedTarget.maxHp - Math.ceil(exposedTarget.maxHp * 0.9));
    expect(exposedTarget.auras).toContainEqual(
      expect.objectContaining({ id: VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID }),
    );

    const second = encounter(true);
    const immuneTarget = addDps(second.sim, second.boss, 'Immune Target');
    const immuneSoaker = second.sim.player;
    const immuneState = armOnlyInterceptBeam(second.sim, second.boss);
    updateVarkhulEncounter(second.sim.ctx, second.boss);
    immuneSoaker.damageImmune = true;
    immuneSoaker.hp = immuneSoaker.maxHp;
    immuneState.interceptBeamCastRemaining = DT;

    updateVarkhulEncounter(second.sim.ctx, second.boss);

    expect(immuneSoaker.hp).toBe(immuneSoaker.maxHp);
    expect(immuneTarget.hp).toBe(immuneTarget.maxHp);
    expect(immuneSoaker.auras).toContainEqual(
      expect.objectContaining({ id: VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID }),
    );
  });

  it('applies the real Heroic blocked damage instead of the Normal fallback', () => {
    const { sim, boss } = encounter(true);
    addDps(sim, boss, 'Heroic Mark');
    const state = armOnlyInterceptBeam(sim, boss);
    updateVarkhulEncounter(sim.ctx, boss);
    sim.player.maxHp = 1_000;
    sim.player.hp = 1_000;
    sim.player.damageImmune = false;
    state.interceptBeamCastRemaining = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    // The Heroic raid damage multiplier raises the 85% base hit to 98.5% here;
    // falling back to the Normal 70% branch would leave substantially more health.
    expect(sim.player.hp).toBe(15);
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID, remaining: 30 }),
    );
  });

  it('refreshes one existing Tempered Wound instead of duplicating it on a repeat hit', () => {
    const { sim, boss } = encounter();
    const target = addDps(sim, boss, 'Repeat Smith');
    target.damageImmune = true;
    sim.player.pos = sim.ctx.groundPos(boss.pos.x + 8, boss.pos.z + 8);
    const state = armOnlyInterceptBeam(sim, boss);

    updateVarkhulEncounter(sim.ctx, boss);
    state.interceptBeamCastRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    let wounds = target.auras.filter(
      (aura) => aura.id === VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID && aura.sourceId === boss.id,
    );
    expect(wounds).toHaveLength(1);
    wounds[0].remaining = 7;
    wounds[0].duration = 7;

    state.interceptBeamTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.interceptBeamTargetId).toBe(target.id);
    state.interceptBeamCastRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);

    wounds = target.auras.filter(
      (aura) => aura.id === VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID && aura.sourceId === boss.id,
    );
    expect(wounds).toHaveLength(1);
    expect(wounds[0]).toMatchObject({
      remaining: 30,
      duration: 30,
      value: VARKHUL_INTERCEPT_BEAM_DEBUFF_DAMAGE_TAKEN,
    });
  });

  it('clears the ray when its target dies or Assembly and Meltdown take authority', () => {
    const death = encounter();
    const deathTarget = addDps(death.sim, death.boss, 'Doomed Smith');
    const deathState = armOnlyInterceptBeam(death.sim, death.boss);
    updateVarkhulEncounter(death.sim.ctx, death.boss);
    expect(deathState.interceptBeamTargetId).toBe(deathTarget.id);
    deathTarget.dead = true;
    deathTarget.hp = 0;
    updateVarkhulEncounter(death.sim.ctx, death.boss);
    expect(deathState).toMatchObject({
      majorAbility: 'none',
      interceptBeamTargetId: null,
      interceptBeamBlockerId: null,
      interceptBeamCastRemaining: 0,
    });
    expect(death.boss.castingAbility).toBeNull();
    expect(death.sim.activeVarkhulAssemblies[0].interceptBeam).toBeNull();

    const assembly = encounter();
    addDps(assembly.sim, assembly.boss, 'Assembly Smith');
    const assemblyState = armOnlyInterceptBeam(assembly.sim, assembly.boss);
    updateVarkhulEncounter(assembly.sim.ctx, assembly.boss);
    assembly.boss.hp = Math.floor(assembly.boss.maxHp * 0.5);
    updateVarkhulEncounter(assembly.sim.ctx, assembly.boss);
    expect(assemblyState.assemblyPhase).toBe('adds');
    expect(assemblyState.majorAbility).toBe('none');
    expect(assemblyState.interceptBeamTargetId).toBeNull();
    expect(assembly.boss.castingAbility).toBeNull();
    expect(assembly.sim.activeVarkhulAssemblies[0].interceptBeam).toBeNull();

    const meltdown = encounter(true);
    addDps(meltdown.sim, meltdown.boss, 'Meltdown Smith');
    const meltdownState = armOnlyInterceptBeam(meltdown.sim, meltdown.boss);
    updateVarkhulEncounter(meltdown.sim.ctx, meltdown.boss);
    for (const meta of meltdown.sim.players.values()) {
      const player = meltdown.sim.entities.get(meta.entityId);
      if (player) player.damageImmune = true;
    }
    meltdownState.forgeBeamWindow = 'final_left';
    meltdownState.forgeBeamWindowRemaining = 99;
    meltdownState.assemblyForgeBeamActiveMask = 1;
    meltdownState.assemblyForgeBeamWarmupRemaining = 0;
    meltdownState.assemblyForgeOverheat = 1;
    updateVarkhulEncounter(meltdown.sim.ctx, meltdown.boss);
    expect(meltdownState.forgeBeamWindow).toBe('meltdown');
    expect(meltdownState.assemblyForgeMeltdownRemaining).toBeGreaterThan(0);
    expect(meltdownState.majorAbility).toBe('none');
    expect(meltdownState.interceptBeamTargetId).toBeNull();
    expect(meltdown.boss.castingAbility).toBeNull();
    expect(meltdown.sim.activeVarkhulAssemblies[0].interceptBeam).toBeNull();
  });
});
