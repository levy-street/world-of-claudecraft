import { describe, expect, it } from 'vitest';

import {
  resetVarkhulEncounter,
  updateVarkhulAssemblyAutomaton,
  updateVarkhulEncounter,
  VARKHUL_BOSS_ID,
  VARKHUL_CINDER_ARTIFICER_ID,
  VARKHUL_CINDER_ORBS_AURA_ID,
  VARKHUL_CRUCIBLE_WARDEN_ID,
  VARKHUL_DEATH_YELL,
  VARKHUL_EMBER_SENTINEL_ID,
  VARKHUL_FORGE_BEAM_EXPOSURE_AURA_ID,
  VARKHUL_FORGE_HAMMER_ABILITY_ID,
  VARKHUL_FORGE_HAMMER_EVERY_SECONDS,
  VARKHUL_FORGE_HAMMER_FIRST_SECONDS,
  VARKHUL_FORGE_MELTDOWN_ABILITY_ID,
  VARKHUL_FORGE_PORTAL_ABILITY_ID,
  VARKHUL_FORGESTORM_CAST_ID,
  VARKHUL_MAKERS_BRAND_AURA_ID,
  VARKHUL_MASTERPIECE_UNBOUND_AURA_ID,
} from '../src/sim/encounters/varkhul';
import { VARKHUL_DIALOGUE } from '../src/sim/encounters/varkhul_dialogue';
import { IGNIVAR_SECOND_WING_ID } from '../src/sim/ignivar_raid_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, MELEE_RANGE } from '../src/sim/types';
import { activeVarkhulAssembly } from '../src/sim/varkhul_assembly';
import {
  VARKHUL_CINDER_ARTIFICER_FIRST_SECONDS,
  VARKHUL_CINDER_ARTIFICER_PORTAL_TELEGRAPH_SECONDS,
  VARKHUL_CINDER_ARTIFICER_REPEAT_SECONDS,
  VARKHUL_CINDER_REPAIR_CAST_ID,
  VARKHUL_CINDER_REPAIR_CHANNEL_SECONDS,
  VARKHUL_CINDER_REPAIR_END_ANIMATION_ID,
  VARKHUL_CINDER_REPAIR_RETRY_SECONDS,
  VARKHUL_CINDER_REPAIR_START_ANIMATION_ID,
  VARKHUL_CINDER_REPAIR_TICK_SECONDS,
  varkhulCinderRepairTickAmount,
} from '../src/sim/varkhul_cinder_artificer';
import {
  VARKHUL_FORGE_BEAM_BLOCK_DAMAGE_TICK_SECONDS,
  VARKHUL_FORGE_BEAM_WARMUP_SECONDS,
  VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS,
  varkhulForgeBeamExposureResetSeconds,
  varkhulForgeMeltdownInitialDamageMaxHp,
  varkhulForgeMeltdownTickDamageMaxHp,
} from '../src/sim/varkhul_forge_beams';
import {
  VARKHUL_FORGE_ADD_WAVE_DELAY_HEROIC_SECONDS,
  VARKHUL_FORGE_ADD_WAVE_DELAY_NORMAL_SECONDS,
  VARKHUL_FORGE_INTERMISSION_SECONDS_HEROIC,
  VARKHUL_FORGE_INTERMISSION_SECONDS_NORMAL,
  VARKHUL_FORGE_INTERMISSION_WARNING_SECONDS,
  VARKHUL_FORGE_LOCAL_POS,
  VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS,
  VARKHUL_FORGE_PRESSURE_BEAM_SECONDS,
  VARKHUL_FORGE_PRESSURE_HP_THRESHOLD,
  VARKHUL_FORGE_TEACHING_BEAM_SECONDS,
  VARKHUL_FORGE_TEACHING_GAP_SECONDS,
  VARKHUL_WORK_FACING,
  VARKHUL_WORK_LOCAL_POS,
} from '../src/sim/varkhul_forge_intermission';
import { VARKHUL_SHARED_PYRE_AURA_ID } from '../src/sim/varkhul_shared_pyre';
import {
  VARKHUL_WORLDFIRE_ABILITY_ID,
  VARKHUL_WORLDFIRE_DAMAGE_MAX_HP,
  VARKHUL_WORLDFIRE_FULL_DAMAGE_MAX_HP,
} from '../src/sim/varkhul_worldfire';

function claimedEncounter(seed: number, heroic = false, engage = true): { sim: Sim; boss: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', devCommands: true });
  expect(enterDungeon(sim.ctx, IGNIVAR_SECOND_WING_ID, sim.player.id, true)).toBe(true);
  const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
  if (!instance) throw new Error('Inner Crucible did not claim an instance');
  instance.difficulty = heroic ? 'heroic' : 'normal';
  const boss = instance.mobIds
    .map((id) => sim.entities.get(id))
    .find((entity) => entity?.templateId === VARKHUL_BOSS_ID);
  if (!boss) throw new Error('Inner Crucible did not spawn Varkhul');
  sim.player.damageImmune = true;
  if (engage) {
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = sim.player.id;
    boss.swingTimer = 999;
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 2 };
    sim.player.prevPos = { ...sim.player.pos };
  }
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('Local player metadata missing');
  meta.talentMods.role = 'tank';
  return { sim, boss };
}

function addTank(sim: Sim, boss: Entity, name: string): Entity {
  return addEncounterPlayer(sim, boss, name, 'tank');
}

function rekeyBoss(sim: Sim, boss: Entity, nextId: number): void {
  const instance = sim.instances.find((entry) => entry.mobIds.includes(boss.id));
  if (!instance) throw new Error('Varkhul instance missing');
  const mobIndex = instance.mobIds.indexOf(boss.id);
  sim.entities.delete(boss.id);
  boss.id = nextId;
  instance.mobIds[mobIndex] = nextId;
  sim.entities.set(nextId, boss);
}

function addEncounterPlayer(
  sim: Sim,
  boss: Entity,
  name: string,
  role: 'tank' | 'healer' | 'dps' = 'dps',
): Entity {
  const pid = sim.addPlayer(
    role === 'healer' ? 'priest' : role === 'dps' ? 'mage' : 'warrior',
    name,
  );
  const meta = sim.players.get(pid);
  const player = meta ? sim.entities.get(meta.entityId) : undefined;
  if (!meta || !player) throw new Error(`${name} did not spawn`);
  meta.talentMods.role = role;
  player.damageImmune = true;
  player.pos = { x: boss.pos.x + 2, y: boss.pos.y, z: boss.pos.z - 2 };
  player.prevPos = { ...player.pos };
  return player;
}

describe('Varkhul forge pillars and add intermission', () => {
  it('names his unseen master once when Varkhul dies', () => {
    const { sim, boss } = claimedEncounter(699);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.makersBrandTimer = 999;
    state.frontalTimer = 999;
    state.cinderOrbsTimer = 999;
    state.forgestormTimer = DT;
    state.sharedPyreTimer = 999;
    state.anvilTimer = 999;
    state.interceptBeamTimer = 999;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(sim.ctx.groundAoEs.some((effect) => effect.sourceId === boss.id)).toBe(true);
    sim.player.damageImmune = false;
    const hpBeforeDeath = sim.player.hp;

    boss.dead = true;
    const deathEvents = sim.tick();

    expect(
      deathEvents.filter(
        (event) =>
          event.type === 'chat' && event.channel === 'yell' && event.text === VARKHUL_DEATH_YELL,
      ),
    ).toHaveLength(1);
    expect(boss.varkhul).toBeUndefined();
    expect(sim.ctx.groundAoEs.some((effect) => effect.sourceId === boss.id)).toBe(false);
    expect(
      sim
        .tick()
        .filter(
          (event) =>
            event.type === 'chat' && event.channel === 'yell' && event.text === VARKHUL_DEATH_YELL,
        ),
    ).toHaveLength(0);
    expect(sim.player.hp).toBe(hpBeforeDeath);
  });

  it('keeps the authored boss set-piece in front of the anvil, facing away from the raid', () => {
    const { sim, boss } = claimedEncounter(701, false, false);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('instance missing');
    const origin = sim.ctx.instanceOriginOf(instance);
    sim.tick();
    expect(boss.pos.x).toBeCloseTo(origin.x + VARKHUL_WORK_LOCAL_POS.x, 5);
    expect(boss.pos.z).toBeCloseTo(origin.z + VARKHUL_WORK_LOCAL_POS.z, 5);
    expect(boss.facing).toBe(VARKHUL_WORK_FACING);
    expect(sim.activeVarkhulAssemblies).toEqual([
      expect.objectContaining({
        bossId: boss.id,
        phase: 'idle',
        forgeOverheat: 0,
        forgeBeamActiveMask: 0,
        forgeBeams: [
          expect.objectContaining({ index: 0, active: false, blocked: false }),
          expect.objectContaining({ index: 1, active: false, blocked: false }),
        ],
      }),
    ]);

    boss.facing = 1;
    boss.prevFacing = 1;
    boss.inCombat = true;
    boss.aiState = 'evade';
    sim.ctx.resetEvadingMob(boss);
    expect(boss.facing).toBe(VARKHUL_WORK_FACING);
    expect(boss.prevFacing).toBe(VARKHUL_WORK_FACING);

    boss.facing = 1;
    boss.prevFacing = 1;
    boss.dead = true;
    sim.ctx.respawnMob(boss);
    expect(boss.pos.x).toBeCloseTo(origin.x + VARKHUL_WORK_LOCAL_POS.x, 5);
    expect(boss.pos.z).toBeCloseTo(origin.z + VARKHUL_WORK_LOCAL_POS.z, 5);
    expect(boss.facing).toBe(VARKHUL_WORK_FACING);
    expect(boss.prevFacing).toBe(VARKHUL_WORK_FACING);
  });

  it("walks to the forge before opening the Master's Assembly portals", () => {
    const { sim, boss } = claimedEncounter(704);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    const instance = sim.instances.find((entry) => entry.mobIds.includes(boss.id));
    if (!state || !instance) throw new Error('Varkhul fixture missing');
    const origin = sim.ctx.instanceOriginOf(instance);
    const work = { x: origin.x + VARKHUL_WORK_LOCAL_POS.x, z: origin.z + VARKHUL_WORK_LOCAL_POS.z };
    boss.pos = sim.ctx.groundPos(work.x - 12, work.z);
    boss.prevPos = { ...boss.pos };
    sim.player.pos = sim.ctx.groundPos(boss.pos.x, boss.pos.z - 2);
    sim.player.prevPos = { ...sim.player.pos };
    boss.hp = Math.floor(boss.maxHp * 0.5);
    const distanceBefore = Math.hypot(boss.pos.x - work.x, boss.pos.z - work.z);

    updateVarkhulEncounter(sim.ctx, boss);

    const distanceAfterFirstStep = Math.hypot(boss.pos.x - work.x, boss.pos.z - work.z);
    expect(state.assemblyTriggered).toBe(true);
    expect(state.assemblyPhase).toBe('idle');
    expect(distanceAfterFirstStep).toBeLessThan(distanceBefore);
    expect(distanceAfterFirstStep).toBeGreaterThan(0.3);
    expect(state.assemblyPortalSpawns).toHaveLength(0);

    for (let tick = 0; tick < 100 && state.assemblyPhase === 'idle'; tick++) {
      const before = { ...boss.pos };
      updateVarkhulEncounter(sim.ctx, boss);
      expect(Math.hypot(boss.pos.x - before.x, boss.pos.z - before.z)).toBeLessThanOrEqual(
        boss.moveSpeed * DT + 1e-6,
      );
    }

    expect(state.assemblyPhase).toBe('adds');
    expect(Math.hypot(boss.pos.x - work.x, boss.pos.z - work.z)).toBeLessThanOrEqual(0.3);
    expect(state.assemblyPortalSpawns.length).toBeGreaterThan(0);
    expect(
      sim.events.some(
        (event) =>
          event.type === 'chat' &&
          event.channel === 'yell' &&
          event.text === VARKHUL_DIALOGUE.assembly,
      ),
    ).toBe(true);
  });

  it("cancels an active Shared Pyre when Master's Assembly starts", () => {
    const { sim, boss } = claimedEncounter(705);
    const dps = addEncounterPlayer(sim, boss, 'Assembly Pyre Target');
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.makersBrandTimer = 999;
    state.frontalTimer = 999;
    state.cinderOrbsTimer = 999;
    state.forgestormTimer = 999;
    state.sharedPyreTimer = DT;
    state.anvilTimer = 999;
    state.interceptBeamTimer = 999;

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.majorAbility).toBe('sharedPyre');
    expect(state.sharedPyreTargetId).toBe(dps.id);
    expect(dps.auras.some((aura) => aura.id === VARKHUL_SHARED_PYRE_AURA_ID)).toBe(true);

    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.assemblyTriggered).toBe(true);
    expect(state.majorAbility).toBe('none');
    expect(state.sharedPyreTargetId).toBeNull();
    expect(state.sharedPyreRemaining).toBe(0);
    expect(boss.castingAbility).toBeNull();
    expect(dps.auras.some((aura) => aura.id === VARKHUL_SHARED_PYRE_AURA_ID)).toBe(false);
    expect(state.assemblyPortalSpawns.length).toBeGreaterThan(0);
  });

  it('swings and strikes the anvil with a bounded metal-impact cue throughout the intermission', () => {
    const { sim, boss } = claimedEncounter(700);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    const instance = sim.instances.find((entry) => entry.mobIds.includes(boss.id));
    if (!instance) throw new Error('Varkhul instance missing');
    const origin = sim.ctx.instanceOriginOf(instance);
    state.assemblyForgeHammerTimer = DT;
    const before = sim.events.length;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(sim.events.slice(before)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'spellfxAt',
          x: origin.x + VARKHUL_FORGE_LOCAL_POS.x,
          z: origin.z + VARKHUL_FORGE_LOCAL_POS.z,
          sourceId: boss.id,
          ability: VARKHUL_FORGE_HAMMER_ABILITY_ID,
          fx: 'burst',
          school: 'fire',
          radius: 2.4,
          duration: 0.7,
          sfxKey: 'impact_metal',
        }),
      ]),
    );
    expect(state.assemblyForgeHammerTimer).toBeCloseTo(VARKHUL_FORGE_HAMMER_EVERY_SECONDS, 8);
    expect(boss.aiState).toBe('idle');
  });

  it('starts the first hammer strike at 0.6 seconds and repeats every two seconds', () => {
    const { sim, boss } = claimedEncounter(741);
    const hammerEvents = () =>
      sim.events.filter(
        (event) => event.type === 'spellfxAt' && event.ability === VARKHUL_FORGE_HAMMER_ABILITY_ID,
      );
    boss.hp = Math.floor(boss.maxHp * 0.5);

    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    expect(VARKHUL_FORGE_HAMMER_FIRST_SECONDS).toBe(0.6);
    expect(VARKHUL_FORGE_HAMMER_EVERY_SECONDS).toBe(2);
    expect(hammerEvents()).toHaveLength(0);
    for (let tick = 0; tick < 10; tick++) updateVarkhulEncounter(sim.ctx, boss);
    expect(hammerEvents()).toHaveLength(0);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(hammerEvents()).toHaveLength(1);
    for (let tick = 0; tick < 39; tick++) updateVarkhulEncounter(sim.ctx, boss);
    expect(hammerEvents()).toHaveLength(1);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(hammerEvents()).toHaveLength(2);
  });

  it('schedules Cinder Artificers independently from the ordinary add waves', () => {
    const { sim, boss } = claimedEncounter(744, true);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    for (const id of state.assemblyAddIds) {
      const add = sim.entities.get(id);
      if (add && add.templateId !== VARKHUL_CINDER_ARTIFICER_ID) add.dead = true;
    }
    const nextWaveIndex = state.assemblyNextWaveIndex;
    state.assemblyNextWaveRemaining = DT;
    state.assemblyArtificerNextSpawnRemaining = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.assemblyNextWaveIndex).toBe(nextWaveIndex + 1);
    expect(state.assemblyPortalSpawns.some((pending) => pending.wave === nextWaveIndex)).toBe(true);
    expect(state.assemblyArtificerPortalSpawns).toEqual([{ portalIndex: 0, remaining: 2 }]);
    expect(state.assemblyArtificerSpawnIndex).toBe(1);
    expect(state.assemblyArtificerNextSpawnRemaining).toBe(VARKHUL_CINDER_ARTIFICER_REPEAT_SECONDS);
    expect(
      sim.events.filter(
        (event) => event.type === 'varkhulCallout' && event.call === 'artificerApproaches',
      ),
    ).toHaveLength(1);

    const ordinaryRemaining = state.assemblyNextWaveRemaining;
    const artificerRemaining = state.assemblyArtificerNextSpawnRemaining;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyNextWaveRemaining).toBeCloseTo(ordinaryRemaining - DT, 8);
    expect(state.assemblyArtificerNextSpawnRemaining).toBeCloseTo(artificerRemaining - DT, 8);

    state.assemblyArtificerPortalSpawns[0].remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    const artificer = state.assemblyAddIds
      .map((id) => sim.entities.get(id))
      .find((add) => add?.templateId === VARKHUL_CINDER_ARTIFICER_ID);
    if (!artificer) throw new Error('Cinder Artificer did not emerge');
    expect(artificer.maxHp).toBe(6_488);
    expect(artificer.mechanicDamageMult).toBe(1);
    expect(artificer.rangedDamageMult).toBeUndefined();
    expect(artificer.ccImmune).not.toBe(true);
    expect(artificer.slowImmune).not.toBe(true);
    expect(artificer.ignoreHardLeash).toBe(true);
    expect(artificer.aggroTargetId).toBe(boss.id);
  });

  it('selects the independent Artificer portal without consuming shared RNG', () => {
    const { sim, boss } = claimedEncounter(747);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyNextWaveRemaining = 999;
    state.assemblyArtificerNextSpawnRemaining = DT;
    const draws: number[] = [];
    sim.rng.setObserver((value) => draws.push(value));

    updateVarkhulEncounter(sim.ctx, boss);
    sim.rng.setObserver(null);

    expect(draws).toEqual([]);
    expect(state.assemblyArtificerPortalSpawns).toEqual([{ portalIndex: 0, remaining: 2 }]);
    expect(state.assemblyArtificerSpawnIndex).toBe(1);
  });

  it('opens the first Artificer portal at 10 seconds, spawns it two seconds later, and repeats at 18 seconds', () => {
    const { sim, boss } = claimedEncounter(742);
    boss.hp = Math.floor(boss.maxHp * 0.5);

    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyForgeBeamWarmupRemaining = 999;
    expect(VARKHUL_CINDER_ARTIFICER_FIRST_SECONDS).toBe(10);
    expect(VARKHUL_CINDER_ARTIFICER_PORTAL_TELEGRAPH_SECONDS).toBe(2);
    expect(VARKHUL_CINDER_ARTIFICER_REPEAT_SECONDS).toBe(18);
    expect(state.assemblyArtificerNextSpawnRemaining).toBeCloseTo(9.95, 8);

    for (let tick = 0; tick < 198; tick++) updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyArtificerPortalSpawns).toEqual([]);
    expect(state.assemblyArtificerSpawnIndex).toBe(0);
    const firstQueueEventStart = sim.events.length;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyArtificerPortalSpawns).toEqual([{ portalIndex: 0, remaining: 2 }]);
    expect(state.assemblyArtificerSpawnIndex).toBe(1);
    expect(
      sim.events
        .slice(firstQueueEventStart)
        .filter(
          (event) =>
            event.type === 'spellfxAt' && event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID,
        ),
    ).toHaveLength(1);

    for (let tick = 0; tick < 39; tick++) updateVarkhulEncounter(sim.ctx, boss);
    expect(
      state.assemblyAddIds.some(
        (id) => sim.entities.get(id)?.templateId === VARKHUL_CINDER_ARTIFICER_ID,
      ),
    ).toBe(false);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(
      state.assemblyAddIds.filter(
        (id) => sim.entities.get(id)?.templateId === VARKHUL_CINDER_ARTIFICER_ID,
      ),
    ).toHaveLength(1);

    for (let tick = 0; tick < 319; tick++) updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyArtificerSpawnIndex).toBe(1);
    const secondQueueEventStart = sim.events.length;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyArtificerSpawnIndex).toBe(2);
    expect(state.assemblyArtificerPortalSpawns).toEqual([{ portalIndex: 1, remaining: 2 }]);
    expect(
      sim.events
        .slice(secondQueueEventStart)
        .filter(
          (event) =>
            event.type === 'spellfxAt' && event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID,
        ),
    ).toHaveLength(1);
  });

  it('only opens an Artificer portal when the full warning and repair window remains', () => {
    const setupDuePortal = (seed: number, remaining: number) => {
      const { sim, boss } = claimedEncounter(seed, true);
      boss.hp = Math.floor(boss.maxHp * 0.5);
      updateVarkhulEncounter(sim.ctx, boss);
      const state = boss.varkhul;
      if (!state) throw new Error('Varkhul state missing');
      state.assemblyForgeBeamWarmupRemaining = 999;
      state.assemblyRemaining = remaining;
      state.assemblyArtificerNextSpawnRemaining = DT;
      updateVarkhulEncounter(sim.ctx, boss);
      return { state };
    };

    const fair = setupDuePortal(
      748,
      VARKHUL_CINDER_ARTIFICER_PORTAL_TELEGRAPH_SECONDS +
        VARKHUL_CINDER_REPAIR_CHANNEL_SECONDS +
        DT,
    );
    expect(fair.state.assemblyArtificerPortalSpawns).toEqual([
      { portalIndex: 0, remaining: VARKHUL_CINDER_ARTIFICER_PORTAL_TELEGRAPH_SECONDS },
    ]);
    expect(fair.state.assemblyArtificerSpawnIndex).toBe(1);

    const tooLate = setupDuePortal(
      749,
      VARKHUL_CINDER_ARTIFICER_PORTAL_TELEGRAPH_SECONDS + VARKHUL_CINDER_REPAIR_CHANNEL_SECONDS,
    );
    expect(tooLate.state.assemblyArtificerPortalSpawns).toEqual([]);
    expect(tooLate.state.assemblyArtificerSpawnIndex).toBe(0);
    expect(tooLate.state.assemblyArtificerNextSpawnRemaining).toBe(
      VARKHUL_CINDER_ARTIFICER_REPEAT_SECONDS,
    );
  });

  it('lets control stop the Artificer, then plays start, loop and end around a real repair', () => {
    const { sim, boss } = claimedEncounter(745, true);
    sim.setPlayerLevel(20);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyArtificerPortalSpawns = [{ portalIndex: 2, remaining: DT }];
    updateVarkhulEncounter(sim.ctx, boss);
    const artificer = state.assemblyAddIds
      .map((id) => sim.entities.get(id))
      .find((add) => add?.templateId === VARKHUL_CINDER_ARTIFICER_ID);
    if (!artificer) throw new Error('Cinder Artificer did not emerge');

    const beforeRoot = { ...artificer.pos };
    sim.ctx.applyAura(artificer, {
      id: 'test_artificer_root',
      name: 'Test Root',
      kind: 'root',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: sim.player.id,
      school: 'frost',
    });
    updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    expect(artificer.pos).toEqual(beforeRoot);
    expect(artificer.aiState).toBe('chase');
    artificer.auras = artificer.auras.filter((aura) => aura.id !== 'test_artificer_root');

    const beforeSlow = { ...artificer.pos };
    sim.ctx.applyAura(artificer, {
      id: 'test_artificer_slow',
      name: 'Test Slow',
      kind: 'slow',
      remaining: 5,
      duration: 5,
      value: 0.5,
      sourceId: sim.player.id,
      school: 'frost',
    });
    updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    const slowedStep = Math.hypot(artificer.pos.x - beforeSlow.x, artificer.pos.z - beforeSlow.z);
    expect(slowedStep).toBeGreaterThan(0);
    expect(slowedStep).toBeLessThanOrEqual(artificer.moveSpeed * DT * 0.51);

    artificer.auras = artificer.auras.filter((aura) => aura.id !== 'test_artificer_slow');
    artificer.bigCastTimer = 0;
    boss.hp = Math.floor(boss.maxHp * 0.3);
    const hpBefore = boss.hp;
    const eventStart = sim.events.length;

    for (
      let tick = 0;
      tick < 200 && artificer.castingAbility !== VARKHUL_CINDER_REPAIR_CAST_ID;
      tick++
    ) {
      updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    }

    expect(artificer.castingAbility).toBe(VARKHUL_CINDER_REPAIR_CAST_ID);
    expect(artificer.castTargetId).toBe(boss.id);
    expect(artificer.castRemaining).toBe(VARKHUL_CINDER_REPAIR_CHANNEL_SECONDS);
    expect(artificer.channeling).toBe(true);
    expect(artificer.channelTickTimer).toBe(VARKHUL_CINDER_REPAIR_TICK_SECONDS);
    expect(sim.events.slice(eventStart)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'spellfx',
          sourceId: artificer.id,
          targetId: boss.id,
          fx: 'windup',
          ability: VARKHUL_CINDER_REPAIR_START_ANIMATION_ID,
        }),
        expect.objectContaining({
          type: 'spellfx',
          sourceId: artificer.id,
          targetId: boss.id,
          fx: 'beam',
        }),
      ]),
    );

    const beamEvents = () =>
      sim.events
        .slice(eventStart)
        .filter(
          (event) =>
            event.type === 'spellfx' &&
            event.sourceId === artificer.id &&
            event.fx === 'beam' &&
            event.ability === VARKHUL_CINDER_REPAIR_CAST_ID,
        );
    expect(beamEvents()).toHaveLength(1);
    for (let tick = 0; tick < VARKHUL_CINDER_REPAIR_TICK_SECONDS / DT - 1; tick++) {
      updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    }
    expect(beamEvents()).toHaveLength(1);
    expect(boss.hp).toBe(hpBefore);
    updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    expect(beamEvents()).toHaveLength(2);
    const tickHeal = varkhulCinderRepairTickAmount(boss.maxHp, state.assemblyRuneDifficulty);
    expect(boss.hp).toBe(hpBefore + tickHeal);

    for (
      let tick = VARKHUL_CINDER_REPAIR_TICK_SECONDS / DT;
      tick < VARKHUL_CINDER_REPAIR_CHANNEL_SECONDS / DT - 1;
      tick++
    ) {
      updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    }
    expect(artificer.castingAbility).toBe(VARKHUL_CINDER_REPAIR_CAST_ID);
    const completionStart = sim.events.length;
    updateVarkhulAssemblyAutomaton(sim.ctx, artificer);

    expect(boss.hp).toBe(
      hpBefore +
        tickHeal * (VARKHUL_CINDER_REPAIR_CHANNEL_SECONDS / VARKHUL_CINDER_REPAIR_TICK_SECONDS),
    );
    expect(artificer.castingAbility).toBeNull();
    expect(artificer.channeling).toBe(false);
    expect(artificer.bigCastTimer).toBe(VARKHUL_CINDER_REPAIR_RETRY_SECONDS);
    expect(sim.events.slice(completionStart)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'spellfx',
          sourceId: artificer.id,
          targetId: boss.id,
          fx: 'windup',
          ability: VARKHUL_CINDER_REPAIR_END_ANIMATION_ID,
        }),
        expect.objectContaining({ type: 'heal2', targetId: boss.id }),
      ]),
    );

    artificer.bigCastTimer = 0;
    updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    expect(artificer.castingAbility).toBe(VARKHUL_CINDER_REPAIR_CAST_ID);
    const hpBeforeStun = boss.hp;
    const stunEventStart = sim.events.length;
    sim.ctx.applyAura(artificer, {
      id: 'test_artificer_stun',
      name: 'Test Stun',
      kind: 'stun',
      remaining: 2,
      duration: 2,
      value: 0,
      sourceId: sim.player.id,
      school: 'physical',
    });
    updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    expect(artificer.castingAbility).toBeNull();
    expect(artificer.channeling).toBe(false);
    expect(boss.hp).toBe(hpBeforeStun);
    expect(
      sim.events
        .slice(stunEventStart)
        .some(
          (event) =>
            (event.type === 'spellfx' &&
              (event.ability === VARKHUL_CINDER_REPAIR_END_ANIMATION_ID || event.fx === 'nova')) ||
            (event.type === 'heal2' && event.targetId === boss.id),
        ),
    ).toBe(false);

    artificer.auras = artificer.auras.filter((aura) => aura.id !== 'test_artificer_stun');
    artificer.bigCastTimer = 0;
    updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    expect(artificer.castingAbility).toBe(VARKHUL_CINDER_REPAIR_CAST_ID);
    const meta = sim.players.get(sim.playerId);
    const resolved = (
      sim as unknown as { resolvedAbility(id: string, pid: number): unknown }
    ).resolvedAbility('pummel', sim.playerId);
    if (!meta || !resolved) throw new Error('Pummel did not resolve');
    (
      sim.ctx as unknown as {
        runEffects(
          player: Entity,
          playerMeta: typeof meta,
          target: Entity,
          resolved: unknown,
        ): void;
      }
    ).runEffects(sim.player, meta, artificer, resolved);
    expect(artificer.castingAbility).toBeNull();
    expect(artificer.auras).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'lockout', school: 'fire' })]),
    );
    const hpAfterInterrupt = boss.hp;
    const interruptEventStart = sim.events.length;
    artificer.bigCastTimer = 0;
    updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    expect(artificer.castingAbility).toBeNull();
    expect(boss.hp).toBe(hpAfterInterrupt);
    expect(
      sim.events
        .slice(interruptEventStart)
        .some(
          (event) =>
            (event.type === 'spellfx' &&
              (event.ability === VARKHUL_CINDER_REPAIR_END_ANIMATION_ID || event.fx === 'nova')) ||
            (event.type === 'heal2' && event.targetId === boss.id),
        ),
    ).toBe(false);

    artificer.auras = artificer.auras.filter((aura) => aura.kind !== 'lockout');
    sim.ctx.applyAura(artificer, {
      id: 'test_artificer_silence',
      name: 'Test Silence',
      kind: 'silence',
      remaining: 2,
      duration: 2,
      value: 0,
      sourceId: sim.player.id,
      school: 'arcane',
    });
    artificer.bigCastTimer = 0;
    updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    expect(artificer.castingAbility).toBeNull();
  });

  it('repairs two percent each second for six seconds in Normal', () => {
    const { sim, boss } = claimedEncounter(743);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyArtificerPortalSpawns = [{ portalIndex: 1, remaining: DT }];
    updateVarkhulEncounter(sim.ctx, boss);
    const artificer = state.assemblyAddIds
      .map((id) => sim.entities.get(id))
      .find((add) => add?.templateId === VARKHUL_CINDER_ARTIFICER_ID);
    if (!artificer) throw new Error('Cinder Artificer did not emerge');
    artificer.pos = { x: boss.pos.x + 3, y: boss.pos.y, z: boss.pos.z };
    artificer.prevPos = { ...artificer.pos };
    artificer.bigCastTimer = 0;
    boss.hp = Math.floor(boss.maxHp * 0.25);
    const hpBefore = boss.hp;

    updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    const tickHeal = varkhulCinderRepairTickAmount(boss.maxHp, 'normal');
    for (let second = 1; second <= 6; second++) {
      for (let tick = 1; tick < VARKHUL_CINDER_REPAIR_TICK_SECONDS / DT; tick++) {
        updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
      }
      expect(boss.hp - hpBefore).toBe(tickHeal * (second - 1));
      updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
      expect(boss.hp - hpBefore).toBe(tickHeal * second);
    }

    expect(boss.hp - hpBefore).toBe(Math.round(boss.maxHp * 0.12));
    expect(state.assemblyArtificerRepaired).toBe(true);
  });

  it('keeps earned repair ticks but stops all future healing after interruption', () => {
    const { sim, boss } = claimedEncounter(751);
    boss.hp = Math.floor(boss.maxHp * 0.25);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyArtificerPortalSpawns = [{ portalIndex: 1, remaining: DT }];
    updateVarkhulEncounter(sim.ctx, boss);
    const artificer = state.assemblyAddIds
      .map((id) => sim.entities.get(id))
      .find((add) => add?.templateId === VARKHUL_CINDER_ARTIFICER_ID);
    if (!artificer) throw new Error('Cinder Artificer did not emerge');
    artificer.pos = { x: boss.pos.x + 3, y: boss.pos.y, z: boss.pos.z };
    artificer.prevPos = { ...artificer.pos };
    artificer.bigCastTimer = 0;
    const hpBefore = boss.hp;

    updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    for (let tick = 0; tick < (2 * VARKHUL_CINDER_REPAIR_TICK_SECONDS) / DT; tick++) {
      updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
    }
    const earnedHp = boss.hp;
    expect(earnedHp - hpBefore).toBe(2 * varkhulCinderRepairTickAmount(boss.maxHp, 'normal'));

    sim.ctx.applyAura(artificer, {
      id: 'test_partial_repair_silence',
      name: 'Test Partial Repair Silence',
      kind: 'silence',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: sim.player.id,
      school: 'arcane',
    });
    for (let tick = 0; tick < 130; tick++) updateVarkhulAssemblyAutomaton(sim.ctx, artificer);

    expect(boss.hp).toBe(earnedHp);
    expect(artificer.castingAbility).toBeNull();
    expect(state.assemblyArtificerRepaired).toBe(true);
  });

  it.each(['silence', 'range', 'boss-death'] as const)(
    'cancels an active repair on %s without a heal, nova, or ChannelEnd',
    (cancelMode) => {
      const { sim, boss } = claimedEncounter(
        cancelMode === 'silence' ? 748 : cancelMode === 'range' ? 749 : 750,
        true,
      );
      boss.hp = Math.floor(boss.maxHp * 0.5);
      updateVarkhulEncounter(sim.ctx, boss);
      const state = boss.varkhul;
      if (!state) throw new Error('Varkhul state missing');
      state.assemblyArtificerPortalSpawns = [{ portalIndex: 0, remaining: DT }];
      updateVarkhulEncounter(sim.ctx, boss);
      const artificer = state.assemblyAddIds
        .map((id) => sim.entities.get(id))
        .find((add) => add?.templateId === VARKHUL_CINDER_ARTIFICER_ID);
      if (!artificer) throw new Error('Cinder Artificer did not emerge');
      artificer.pos = { x: boss.pos.x + 3, y: boss.pos.y, z: boss.pos.z };
      artificer.prevPos = { ...artificer.pos };
      artificer.bigCastTimer = 0;
      updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
      expect(artificer.castingAbility).toBe(VARKHUL_CINDER_REPAIR_CAST_ID);
      const hpBefore = boss.hp;
      const eventStart = sim.events.length;

      if (cancelMode === 'silence') {
        sim.ctx.applyAura(artificer, {
          id: 'test_active_artificer_silence',
          name: 'Test Active Silence',
          kind: 'silence',
          remaining: 10,
          duration: 10,
          value: 0,
          sourceId: sim.player.id,
          school: 'arcane',
        });
      } else if (cancelMode === 'range') {
        artificer.pos = { x: boss.pos.x + 10, y: boss.pos.y, z: boss.pos.z };
        artificer.prevPos = { ...artificer.pos };
        sim.ctx.applyAura(artificer, {
          id: 'test_out_of_range_root',
          name: 'Test Out Of Range Root',
          kind: 'root',
          remaining: 10,
          duration: 10,
          value: 0,
          sourceId: sim.player.id,
          school: 'frost',
        });
      } else {
        boss.dead = true;
      }
      for (let tick = 0; tick < 130; tick++) {
        updateVarkhulAssemblyAutomaton(sim.ctx, artificer);
      }

      expect(artificer.castingAbility).toBeNull();
      expect(artificer.channeling).toBe(false);
      expect(boss.hp).toBe(hpBefore);
      expect(state.assemblyArtificerRepaired).toBe(false);
      expect(
        sim.events
          .slice(eventStart)
          .some(
            (event) =>
              (event.type === 'spellfx' &&
                (event.ability === VARKHUL_CINDER_REPAIR_END_ANIMATION_ID ||
                  event.fx === 'nova')) ||
              (event.type === 'heal2' && event.targetId === boss.id),
          ),
      ).toBe(false);
    },
  );

  it('requires a living independent Artificer to die before the intermission ends', () => {
    const { sim, boss } = claimedEncounter(746);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyArtificerPortalSpawns = [{ portalIndex: 3, remaining: DT }];
    updateVarkhulEncounter(sim.ctx, boss);
    const artificer = state.assemblyAddIds
      .map((id) => sim.entities.get(id))
      .find((add) => add?.templateId === VARKHUL_CINDER_ARTIFICER_ID);
    if (!artificer) throw new Error('Cinder Artificer did not emerge');
    for (const id of state.assemblyAddIds) {
      const add = sim.entities.get(id);
      if (add && add.id !== artificer.id) add.dead = true;
    }
    state.assemblyPortalSpawns = [];
    state.assemblyNextWaveIndex = state.assemblyIntermissionWaves;
    state.assemblyArtificerNextSpawnRemaining = 999;
    state.assemblyArtificerSpawnIndex = 3;
    const spawnedAddIds = [...state.assemblyAddIds];
    expect(spawnedAddIds.every((id) => boss.summonedIds.includes(id))).toBe(true);

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyPhase).toBe('adds');

    artificer.dead = true;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyPhase).toBe('stunned');
    expect(state.assemblyAddIds).toEqual([]);
    expect(state.assemblyPortalSpawns).toEqual([]);
    expect(state.assemblyArtificerPortalSpawns).toEqual([]);
    expect(state.assemblyArtificerNextSpawnRemaining).toBe(0);
    expect(state.assemblyArtificerSpawnIndex).toBe(0);
    expect(spawnedAddIds.every((id) => !sim.entities.has(id))).toBe(true);
    expect(spawnedAddIds.every((id) => !boss.summonedIds.includes(id))).toBe(true);
  });

  it.each([
    { heroic: false, seed: 707 },
    { heroic: true, seed: 708 },
  ])(
    'runs one complete $heroic Meltdown before rearming the intermission beams',
    ({ heroic, seed }) => {
      const { sim, boss } = claimedEncounter(seed, heroic);
      const originalDealDamage = sim.ctx.dealDamage;
      const meltdownDamage: number[] = [];
      sim.ctx.dealDamage = ((...args: Parameters<typeof originalDealDamage>) => {
        const [source, target, amount, , , ability] = args;
        if (
          source?.id === boss.id &&
          target.id === sim.player.id &&
          ability === VARKHUL_FORGE_MELTDOWN_ABILITY_ID
        ) {
          meltdownDamage.push(amount);
          return;
        }
        return originalDealDamage(...args);
      }) as typeof sim.ctx.dealDamage;

      boss.hp = Math.floor(boss.maxHp * 0.5);
      updateVarkhulEncounter(sim.ctx, boss);
      const state = boss.varkhul;
      if (!state) throw new Error('Varkhul state missing');
      state.assemblyForgeBeamWarmupRemaining = 0;
      state.assemblyForgeOverheat = 0.999;
      updateVarkhulEncounter(sim.ctx, boss);

      expect(state.assemblyForgeMeltdownRemaining).toBe(VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS);
      expect(meltdownDamage).toEqual([
        Math.ceil(
          sim.player.maxHp * varkhulForgeMeltdownInitialDamageMaxHp(heroic ? 'heroic' : 'normal'),
        ),
      ]);

      let previousRemaining = state.assemblyForgeMeltdownRemaining;
      for (let tick = 0; tick < VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS / DT; tick++) {
        updateVarkhulEncounter(sim.ctx, boss);
        expect(state.assemblyForgeMeltdownRemaining).toBeLessThan(previousRemaining);
        previousRemaining = state.assemblyForgeMeltdownRemaining;
        if (tick + 1 < VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS / DT) {
          expect(state.assemblyForgeOverheat).toBe(1);
          expect(state.forgeBeamWindow).toBe('meltdown');
          expect(state.assemblyForgeBeamActiveMask).toBe(0);
        }
        expect(
          sim.player.auras.some((aura) => aura.id === VARKHUL_FORGE_BEAM_EXPOSURE_AURA_ID),
        ).toBe(false);
      }

      const pulseDamage = Math.ceil(
        sim.player.maxHp * varkhulForgeMeltdownTickDamageMaxHp(heroic ? 'heroic' : 'normal'),
      );
      expect(meltdownDamage).toEqual([
        Math.ceil(
          sim.player.maxHp * varkhulForgeMeltdownInitialDamageMaxHp(heroic ? 'heroic' : 'normal'),
        ),
        ...Array.from({ length: 5 }, () => pulseDamage),
      ]);
      expect(state.assemblyForgeMeltdownRemaining).toBe(0);
      expect(state.assemblyForgeOverheat).toBe(0);
      expect(state.assemblyPhase).toBe('adds');
      expect(boss.damageImmune).toBe(true);
      expect(state.forgeBeamWindow).toBe('intermission_left');
      expect(state.assemblyForgeBeamActiveMask).toBe(1);
      expect(state.assemblyForgeBeamWarmupRemaining).toBe(VARKHUL_FORGE_BEAM_WARMUP_SECONDS);

      for (let tick = 0; tick < 20; tick++) updateVarkhulEncounter(sim.ctx, boss);
      expect(meltdownDamage).toHaveLength(6);
      expect(state.assemblyForgeOverheat).toBe(0);
    },
  );

  it('keeps the terminal Meltdown vent atomic when a retained Quake completes that tick', () => {
    const { sim, boss } = claimedEncounter(740, true);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    const warden = state.assemblyAddIds
      .map((id) => sim.entities.get(id))
      .find((add) => add?.templateId === VARKHUL_CRUCIBLE_WARDEN_ID);
    if (!warden) throw new Error('Crucible Warden did not emerge');
    state.assemblyForgeOverheat = 1;
    state.assemblyForgeMeltdownRemaining = DT;
    state.assemblyForgeMeltdownTickTimer = 999;
    state.forgeBeamWindow = 'meltdown';
    state.assemblyForgeBeamActiveMask = 3;
    warden.castingAbility = 'crucible_quake';
    warden.castTotal = 2.5;
    warden.castRemaining = DT;
    warden.swingTimer = 999;

    sim.tick();

    expect(warden.castingAbility).toBeNull();
    expect(state.assemblyForgeMeltdownRemaining).toBe(0);
    expect(state.assemblyForgeOverheat).toBe(0);
    expect(state.assemblyForgeVentedThisTick).toBe(true);
    expect(state.assemblyForgeBeamWarmupRemaining).toBe(VARKHUL_FORGE_BEAM_WARMUP_SECONDS);
  });

  it('pauses Meltdown, then resumes pending and future portals with a fresh pillar warning', () => {
    const { sim, boss } = claimedEncounter(731, true);
    const instance = sim.instances.find((entry) => entry.mobIds.includes(boss.id));
    if (!instance) throw new Error('Varkhul instance missing');
    const origin = sim.ctx.instanceOriginOf(instance);
    sim.player.pos = sim.ctx.groundPos(origin.x, origin.z - 30);
    sim.player.prevPos = { ...sim.player.pos };
    boss.hp = Math.floor(boss.maxHp * 0.5);

    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    const liveAddIds = [...state.assemblyAddIds];
    expect(liveAddIds.length).toBeGreaterThan(0);

    state.assemblyNextWaveRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyPortalSpawns.length).toBeGreaterThan(0);
    expect(state.assemblyNextWaveIndex).toBeLessThan(state.assemblyIntermissionWaves);
    state.assemblyArtificerPortalSpawns = [{ portalIndex: 0, remaining: 1.35 }];
    state.assemblyArtificerNextSpawnRemaining = 9.3;
    const pendingBeforeMeltdown = state.assemblyPortalSpawns.map((pending) => ({ ...pending }));
    const artificerPendingBeforeMeltdown = state.assemblyArtificerPortalSpawns.map((pending) => ({
      ...pending,
    }));
    const artificerNextBeforeMeltdown = state.assemblyArtificerNextSpawnRemaining;
    const nextWaveIndexBeforeMeltdown = state.assemblyNextWaveIndex;
    const nextWaveRemainingBeforeMeltdown = state.assemblyNextWaveRemaining;
    const intermissionWavesBeforeMeltdown = state.assemblyIntermissionWaves;
    const assemblyRemainingBeforeMeltdown = state.assemblyRemaining;
    expect(sim.activeVarkhulForgePortalTelegraphs).toHaveLength(4);
    const portalEventCount = sim.events.filter(
      (event) => event.type === 'spellfxAt' && event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID,
    ).length;
    const chargingCalloutsBeforeMeltdown = sim.events.filter(
      (event) => event.type === 'varkhulCallout' && event.call === 'leftPillarCharging',
    ).length;
    const portalCalloutsBeforeMeltdown = sim.events.filter(
      (event) => event.type === 'varkhulCallout' && event.call === 'portalsOpening',
    ).length;

    state.assemblyForgeBeamWarmupRemaining = 0;
    state.assemblyForgeOverheat = 0.999;
    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.assemblyPhase).toBe('adds');
    expect(boss.damageImmune).toBe(true);
    expect(state.assemblyForgeMeltdownRemaining).toBe(VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS);
    expect(state.assemblyAddIds).toEqual(liveAddIds);
    expect(liveAddIds.every((id) => sim.entities.has(id))).toBe(true);
    expect(liveAddIds.every((id) => boss.summonedIds.includes(id))).toBe(true);
    expect(state.assemblyPortalSpawns).toEqual(pendingBeforeMeltdown);
    expect(state.assemblyArtificerPortalSpawns).toEqual(artificerPendingBeforeMeltdown);
    expect(state.assemblyArtificerNextSpawnRemaining).toBe(artificerNextBeforeMeltdown);
    expect(state.assemblyNextWaveIndex).toBe(nextWaveIndexBeforeMeltdown);
    expect(state.assemblyNextWaveRemaining).toBe(nextWaveRemainingBeforeMeltdown);
    expect(state.assemblyIntermissionWaves).toBe(intermissionWavesBeforeMeltdown);
    expect(state.assemblyRemaining).toBe(assemblyRemainingBeforeMeltdown);
    expect(sim.activeVarkhulForgePortalTelegraphs).toEqual([]);

    const meltdownTicks = VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS / DT;
    for (let tick = 1; tick < meltdownTicks; tick++) {
      updateVarkhulEncounter(sim.ctx, boss);
    }
    expect(state.assemblyForgeMeltdownRemaining).toBeGreaterThan(0);
    expect(state.assemblyPortalSpawns).toEqual(pendingBeforeMeltdown);
    expect(state.assemblyArtificerPortalSpawns).toEqual(artificerPendingBeforeMeltdown);
    expect(
      sim.events.filter(
        (event) => event.type === 'spellfxAt' && event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID,
      ),
    ).toHaveLength(portalEventCount);

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyAddIds).toEqual(liveAddIds);
    expect(liveAddIds.every((id) => sim.entities.has(id))).toBe(true);
    expect(liveAddIds.every((id) => boss.summonedIds.includes(id))).toBe(true);
    expect(state.assemblyPhase).toBe('adds');
    expect(boss.damageImmune).toBe(true);
    expect(state.assemblyForgeMeltdownRemaining).toBe(0);
    expect(state.assemblyForgeOverheat).toBe(0);
    expect(state.forgeBeamWindow).toBe('intermission_left');
    expect(state.assemblyForgeBeamActiveMask).toBe(1);
    expect(state.assemblyForgeBeamWarmupRemaining).toBe(VARKHUL_FORGE_BEAM_WARMUP_SECONDS);
    expect(state.assemblyPortalSpawns).toEqual(pendingBeforeMeltdown);
    expect(state.assemblyArtificerPortalSpawns).toEqual(artificerPendingBeforeMeltdown);
    expect(state.assemblyArtificerNextSpawnRemaining).toBe(artificerNextBeforeMeltdown);
    expect(state.assemblyNextWaveIndex).toBe(nextWaveIndexBeforeMeltdown);
    expect(state.assemblyNextWaveRemaining).toBe(nextWaveRemainingBeforeMeltdown);
    expect(state.assemblyRemaining).toBe(assemblyRemainingBeforeMeltdown);
    expect(state.assemblyWipeResolved).toBe(false);
    expect(
      sim.events.filter(
        (event) => event.type === 'spellfxAt' && event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID,
      ),
    ).toHaveLength(portalEventCount + 4);
    const resumedPortalEvents = sim.events
      .filter(
        (event) => event.type === 'spellfxAt' && event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID,
      )
      .slice(portalEventCount);
    const resumedPortalCoordinates = resumedPortalEvents.flatMap((event) =>
      event.type === 'spellfxAt' ? [`${event.x.toFixed(5)},${event.z.toFixed(5)}`] : [],
    );
    expect(new Set(resumedPortalCoordinates).size).toBe(4);
    expect([...resumedPortalCoordinates].sort()).toEqual(
      VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS.map(
        (portal) => `${(origin.x + portal.x).toFixed(5)},${(origin.z + portal.z).toFixed(5)}`,
      ).sort(),
    );
    const authoritativePortalTelegraphs = sim.activeVarkhulForgePortalTelegraphs;
    expect(authoritativePortalTelegraphs).toHaveLength(4);
    expect(
      authoritativePortalTelegraphs
        .map((event) => `${event.x.toFixed(5)},${event.z.toFixed(5)}`)
        .sort(),
    ).toEqual(
      VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS.map(
        (portal) => `${(origin.x + portal.x).toFixed(5)},${(origin.z + portal.z).toFixed(5)}`,
      ).sort(),
    );
    for (const event of authoritativePortalTelegraphs) {
      expect(event).toMatchObject({
        type: 'spellfxAt',
        school: 'fire',
        fx: 'burst',
        sourceId: boss.id,
        radius: 4,
        ability: VARKHUL_FORGE_PORTAL_ABILITY_ID,
      });
      expect(event.duration).toBeCloseTo(pendingBeforeMeltdown[0].remaining, 8);
    }
    expect(
      resumedPortalEvents.every(
        (event) =>
          event.type === 'spellfxAt' &&
          Math.abs((event.duration ?? 0) - pendingBeforeMeltdown[0].remaining) < 1e-8,
      ),
    ).toBe(true);
    expect(
      sim.events.filter(
        (event) => event.type === 'varkhulCallout' && event.call === 'leftPillarCharging',
      ),
    ).toHaveLength(chargingCalloutsBeforeMeltdown + 1);
    expect(
      sim.events.filter(
        (event) => event.type === 'varkhulCallout' && event.call === 'portalsOpening',
      ),
    ).toHaveLength(portalCalloutsBeforeMeltdown + 1);

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyPortalSpawns[0]?.remaining).toBeCloseTo(
      pendingBeforeMeltdown[0].remaining - DT,
      5,
    );
    expect(state.assemblyArtificerPortalSpawns[0]?.remaining).toBeCloseTo(
      artificerPendingBeforeMeltdown[0].remaining - DT,
      5,
    );
    expect(state.assemblyArtificerNextSpawnRemaining).toBeCloseTo(
      artificerNextBeforeMeltdown - DT,
      5,
    );
    expect(state.assemblyNextWaveRemaining).toBeCloseTo(nextWaveRemainingBeforeMeltdown - DT, 5);
    expect(state.assemblyRemaining).toBeCloseTo(assemblyRemainingBeforeMeltdown - DT, 5);

    for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyAddIds.length).toBeGreaterThan(liveAddIds.length);
    state.assemblyNextWaveRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyNextWaveIndex).toBe(nextWaveIndexBeforeMeltdown + 1);
    expect(
      sim.events.filter(
        (event) => event.type === 'spellfxAt' && event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID,
      ),
    ).toHaveLength(portalEventCount + 8);

    const ignitionCalloutsBeforeResume = sim.events.filter(
      (event) => event.type === 'varkhulCallout' && event.call === 'leftPillar',
    ).length;
    const ticksUntilIgnition = Math.round(state.assemblyForgeBeamWarmupRemaining / DT);
    for (let tick = 1; tick < ticksUntilIgnition; tick++) {
      updateVarkhulEncounter(sim.ctx, boss);
      expect(
        sim.events.filter(
          (event) => event.type === 'varkhulCallout' && event.call === 'leftPillar',
        ),
      ).toHaveLength(ignitionCalloutsBeforeResume);
    }
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyForgeBeamWarmupRemaining).toBe(0);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([null, null]);
    expect(
      sim.events.filter((event) => event.type === 'varkhulCallout' && event.call === 'leftPillar'),
    ).toHaveLength(ignitionCalloutsBeforeResume + 1);

    expect(state.assemblyNextWaveIndex).toBe(nextWaveIndexBeforeMeltdown + 1);
    expect(state.assemblyNextWaveIndex).toBeLessThan(state.assemblyIntermissionWaves);
    expect(state.assemblyPortalSpawns).toEqual([]);

    state.assemblyRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyRemaining).toBe(0);
    expect(state.assemblyWipeResolved).toBe(true);
    expect(state.assemblyForgeMeltdownRemaining).toBe(VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS);
    for (let tick = 0; tick < VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS / DT; tick++) {
      updateVarkhulEncounter(sim.ctx, boss);
    }
    expect(state.assemblyForgeMeltdownRemaining).toBe(0);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyForgeMeltdownRemaining).toBe(0);
    expect(state.assemblyForgeBeamWarmupRemaining).toBeCloseTo(
      VARKHUL_FORGE_BEAM_WARMUP_SECONDS - DT,
      5,
    );

    state.assemblyNextWaveIndex = state.assemblyIntermissionWaves;
    for (const id of state.assemblyAddIds) {
      const add = sim.entities.get(id);
      if (add) add.dead = true;
    }
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyPhase).toBe('stunned');
    expect(state.assemblyStunRemaining).toBe(15);
    expect(boss.damageImmune).toBe(false);
    expect(
      sim.events.some(
        (event) =>
          event.type === 'chat' &&
          event.channel === 'yell' &&
          event.text === VARKHUL_DIALOGUE.addsDefeated,
      ),
    ).toBe(true);
  });

  it('ends the trigger tick at Meltdown before Brand, Masterpiece, or another major can run', () => {
    const { sim, boss } = claimedEncounter(720);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyTriggered = true;
    state.assemblyPhase = 'done';
    state.forgeBeamFinalTriggered = true;
    state.forgeBeamWindow = 'final_left';
    state.forgeBeamWindowRemaining = 8;
    state.assemblyForgeBeamActiveMask = 1;
    state.assemblyForgeBeamWarmupRemaining = 0;
    state.assemblyForgeOverheat = 0.999;
    state.majorAbility = 'forgestorm';
    state.forgestormWarningRemaining = DT;
    state.forgestormPoints = [{ ...sim.player.pos }];
    state.makersBrandTimer = DT;
    state.frontalTimer = DT;
    state.cinderOrbsTimer = DT;
    state.forgestormTimer = DT;
    state.anvilTimer = DT;
    boss.castingAbility = 'forgestorm';
    boss.castRemaining = DT;
    boss.hp = boss.maxHp * 0.19;

    const originalDealDamage = sim.ctx.dealDamage;
    const bossDamageAbilities: Array<string | null | undefined> = [];
    sim.ctx.dealDamage = ((...args: Parameters<typeof originalDealDamage>) => {
      const [source, target, , , , ability] = args;
      if (source?.id === boss.id && target.id === sim.player.id) {
        bossDamageAbilities.push(ability);
        return;
      }
      return originalDealDamage(...args);
    }) as typeof sim.ctx.dealDamage;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.assemblyForgeMeltdownRemaining).toBe(VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS);
    expect(bossDamageAbilities).toEqual([VARKHUL_FORGE_MELTDOWN_ABILITY_ID]);
    expect(state.majorAbility).toBe('none');
    expect(boss.castingAbility).toBeNull();
    expect(state.makersBrandTimer).toBe(DT);
  });

  it('preserves the 50% floor through a teaching Meltdown and still starts the add phase', () => {
    const { sim, boss } = claimedEncounter(709);
    boss.hp = Math.floor(boss.maxHp * 0.79);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyForgeBeamWarmupRemaining = 0;
    state.assemblyForgeOverheat = 0.999;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyForgeMeltdownRemaining).toBe(VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS);
    expect(boss.damageFloorHp).toBe(Math.ceil(boss.maxHp * 0.5));

    for (let tick = 0; tick < VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS / DT; tick++) {
      updateVarkhulEncounter(sim.ctx, boss);
      expect(boss.damageFloorHp).toBe(Math.ceil(boss.maxHp * 0.5));
    }
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyPhase).toBe('adds');
    expect(boss.damageImmune).toBe(true);
  });

  it('runs the 80% lesson in order, pauses majors, then loops both 20% pillars with majors live', () => {
    const { sim, boss } = claimedEncounter(710);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.frontalTimer = 10;
    state.cinderOrbsTimer = 10;
    state.forgestormTimer = 10;
    state.sharedPyreTimer = 10;
    state.anvilTimer = 10;
    state.interceptBeamTimer = 10;
    boss.hp = Math.floor(boss.maxHp * 0.8);

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('teaching_left');
    expect(state.assemblyForgeBeamActiveMask).toBe(1);
    expect([
      state.frontalTimer,
      state.cinderOrbsTimer,
      state.forgestormTimer,
      state.sharedPyreTimer,
      state.anvilTimer,
      state.interceptBeamTimer,
    ]).toEqual([10, 10, 10, 10, 10, 10]);
    const majorTimers = () => [
      state.frontalTimer,
      state.cinderOrbsTimer,
      state.forgestormTimer,
      state.sharedPyreTimer,
      state.anvilTimer,
      state.interceptBeamTimer,
    ];
    const teachingPausedTimers = majorTimers();

    state.assemblyForgeBeamWarmupRemaining = 0;
    state.forgeBeamWindowRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('teaching_gap');
    expect(state.forgeBeamWindowRemaining).toBe(VARKHUL_FORGE_TEACHING_GAP_SECONDS);
    expect(state.assemblyForgeBeamActiveMask).toBe(0);
    expect(majorTimers()).toEqual(teachingPausedTimers);
    state.forgeBeamWindowRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('teaching_right');
    expect(state.forgeBeamWindowRemaining).toBe(VARKHUL_FORGE_TEACHING_BEAM_SECONDS);
    expect(state.assemblyForgeBeamActiveMask).toBe(2);
    expect(majorTimers()).toEqual(teachingPausedTimers);
    state.assemblyForgeBeamWarmupRemaining = 0;
    state.forgeBeamWindowRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('idle');
    expect(state.assemblyForgeBeamActiveMask).toBe(0);

    state.assemblyTriggered = true;
    state.assemblyPhase = 'done';
    state.makersBrandTimer = 10;
    boss.damageFloorHp = undefined;
    boss.hp = Math.floor(boss.maxHp * 0.2);
    const frontalBeforeFinal = state.frontalTimer;
    const brandBeforeFinal = state.makersBrandTimer;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('final_left');
    expect(state.assemblyForgeBeamActiveMask).toBe(1);
    expect(state.frontalTimer).toBeLessThan(frontalBeforeFinal);
    expect(state.makersBrandTimer).toBeLessThan(brandBeforeFinal);

    state.assemblyForgeBeamWarmupRemaining = 0;
    state.forgeBeamWindowRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('final_gap_left');
    expect(state.assemblyForgeBeamActiveMask).toBe(0);
    const timersAfterFinalLeft = majorTimers();
    expect(timersAfterFinalLeft.every((timer, index) => timer < teachingPausedTimers[index])).toBe(
      true,
    );
    state.forgeBeamWindowRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('final_right');
    expect(state.assemblyForgeBeamActiveMask).toBe(2);
    const timersAfterFinalGapLeft = majorTimers();
    expect(
      timersAfterFinalGapLeft.every((timer, index) => timer < timersAfterFinalLeft[index]),
    ).toBe(true);
    state.assemblyForgeBeamWarmupRemaining = 0;
    state.forgeBeamWindowRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('final_gap_right');
    expect(state.assemblyForgeBeamActiveMask).toBe(0);
    const timersAfterFinalRight = majorTimers();
    expect(
      timersAfterFinalRight.every((timer, index) => timer < timersAfterFinalGapLeft[index]),
    ).toBe(true);
    state.forgeBeamWindowRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('final_left');
    expect(state.assemblyForgeBeamActiveMask).toBe(1);
    expect(majorTimers().every((timer, index) => timer < timersAfterFinalRight[index])).toBe(true);
    expect(
      sim.events.filter((event) => event.type === 'varkhulCallout').map((event) => event.call),
    ).toEqual(expect.arrayContaining(['leftPillarCharging', 'rightPillarCharging']));
  });

  it.each([
    { heroic: false, seed: 726, bossId: 10_000_000, window: 'pressure_left', mask: 1 },
    { heroic: false, seed: 736, bossId: 10_000_001, window: 'pressure_right', mask: 2 },
    { heroic: true, seed: 746, bossId: 10_000_002, window: 'pressure_left', mask: 1 },
    { heroic: true, seed: 756, bossId: 10_000_003, window: 'pressure_right', mask: 2 },
  ] as const)(
    'adds the $window six-second pillar soak at 35% on $heroic',
    ({ heroic, seed, bossId, window, mask }) => {
      const { sim, boss } = claimedEncounter(seed, heroic);
      rekeyBoss(sim, boss, bossId);
      updateVarkhulEncounter(sim.ctx, boss);
      const state = boss.varkhul;
      if (!state) throw new Error('Varkhul state missing');
      state.assemblyTriggered = true;
      state.assemblyPhase = 'done';
      state.forgeBeamTeachingTriggered = true;
      boss.damageFloorHp = undefined;
      boss.hp = Math.floor(boss.maxHp * VARKHUL_FORGE_PRESSURE_HP_THRESHOLD);
      state.frontalTimer = 10;

      updateVarkhulEncounter(sim.ctx, boss);

      expect(state.forgeBeamPressureTriggered).toBe(true);
      expect(state.forgeBeamWindow).toBe(window);
      expect(state.forgeBeamWindowRemaining).toBe(VARKHUL_FORGE_PRESSURE_BEAM_SECONDS);
      expect(state.assemblyForgeBeamActiveMask).toBe(mask);
      expect(state.assemblyForgeBeamWarmupRemaining).toBeCloseTo(3 - DT, 8);
      expect(state.frontalTimer).toBe(10);
      expect(
        sim.events.some(
          (event) =>
            event.type === 'varkhulCallout' &&
            event.call ===
              (window === 'pressure_left' ? 'leftPillarCharging' : 'rightPillarCharging'),
        ),
      ).toBe(true);

      state.assemblyForgeBeamWarmupRemaining = 0;
      state.forgeBeamWindowRemaining = 2 * DT;
      updateVarkhulEncounter(sim.ctx, boss);
      expect(state.forgeBeamWindow).toBe(window);
      expect(state.frontalTimer).toBe(10);
      updateVarkhulEncounter(sim.ctx, boss);
      expect(state.forgeBeamWindow).toBe('idle');
    },
  );

  it('keeps the Normal 20% finale soak cycle', () => {
    const heroic = false;
    const seed = 737;
    const { sim, boss } = claimedEncounter(seed, heroic);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyTriggered = true;
    state.assemblyPhase = 'done';
    state.forgeBeamTeachingTriggered = true;
    state.forgeBeamPressureTriggered = true;
    state.forgeBeamWindow = 'pressure_left';
    state.forgeBeamWindowRemaining = 4;
    state.assemblyForgeBeamActiveMask = 1;
    state.assemblyForgeBeamWarmupRemaining = 0;
    state.majorAbility = 'frontal';
    state.frontalCastRemaining = 1;
    state.frontalTargetId = sim.player.id;
    state.frontalFacing = boss.facing;
    boss.castingAbility = "Forgefather's Sweep";
    boss.castRemaining = 1;
    boss.damageFloorHp = undefined;
    boss.hp = Math.floor(boss.maxHp * 0.2);

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.masterpieceTriggered).toBe(true);
    expect(state.forgeBeamWindow).toBe('pressure_left');
    expect(state.majorAbility).toBe('frontal');
    expect(state.frontalCastRemaining).toBeCloseTo(1 - DT * 1.25, 8);
    expect(boss.castingAbility).toBe("Forgefather's Sweep");

    state.frontalCastRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.majorAbility).toBe('none');
    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.forgeBeamWindow).toBe('final_left');
    expect(state.forgeBeamWindowRemaining).toBe(8);
    expect(state.assemblyForgeBeamActiveMask).toBe(1);
    expect(
      sim.events.some(
        (event) => event.type === 'varkhulCallout' && event.call === 'worldfireBegins',
      ),
    ).toBe(false);
  });

  it('shuts down Heroic pillars and forge heat when Worldfire begins', () => {
    const { sim, boss } = claimedEncounter(747, true);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyTriggered = true;
    state.assemblyPhase = 'done';
    state.forgeBeamTeachingTriggered = true;
    state.forgeBeamPressureTriggered = true;
    state.forgeBeamWindow = 'pressure_left';
    state.forgeBeamWindowRemaining = 4;
    state.assemblyForgeBeamActiveMask = 1;
    state.assemblyForgeBeamWarmupRemaining = 0;
    state.assemblyForgeBeamBlockerIds[0] = sim.player.id;
    state.assemblyForgeOverheat = 0.84;
    boss.damageFloorHp = undefined;
    boss.hp = Math.floor(boss.maxHp * 0.2);

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.masterpieceTriggered).toBe(true);
    expect(state.forgeBeamWindow).toBe('idle');
    expect(state.forgeBeamWindowRemaining).toBe(0);
    expect(state.assemblyForgeBeamActiveMask).toBe(0);
    expect(state.assemblyForgeBeamWarmupRemaining).toBe(0);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([null, null]);
    expect(state.assemblyForgeOverheat).toBe(0);
    expect(
      sim.events.some(
        (event) => event.type === 'varkhulCallout' && event.call === 'worldfireBegins',
      ),
    ).toBe(true);
    expect(
      sim.events.some(
        (event) =>
          event.type === 'chat' &&
          event.channel === 'yell' &&
          event.text === VARKHUL_DIALOGUE.masterpiece,
      ),
    ).toBe(true);

    state.assemblyForgeOverheat = 0.4;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('idle');
    expect(state.assemblyForgeBeamActiveMask).toBe(0);
    expect(state.assemblyForgeOverheat).toBe(0);
  });

  it.each(['cinderOrbs', 'forgestorm', 'interceptBeam'] as const)(
    'cancels an active %s sequence when Heroic Worldfire begins',
    (majorAbility) => {
      const { sim, boss } = claimedEncounter(
        760 + ['cinderOrbs', 'forgestorm', 'interceptBeam'].indexOf(majorAbility),
        true,
      );
      updateVarkhulEncounter(sim.ctx, boss);
      const state = boss.varkhul;
      if (!state) throw new Error('Varkhul state missing');
      state.assemblyTriggered = true;
      state.assemblyPhase = 'done';
      state.forgeBeamTeachingTriggered = true;
      state.forgeBeamPressureTriggered = true;
      state.majorAbility = majorAbility;
      state.cinderOrbsMarkRemaining = 1;
      state.cinderOrbsTargetIds = [sim.player.id];
      state.forgestormWarningRemaining = 1;
      state.forgestormPoints = [{ ...sim.player.pos }];
      state.interceptBeamCastRemaining = 1;
      state.interceptBeamTargetId = sim.player.id;
      state.interceptBeamBlockerId = sim.player.id;
      if (majorAbility === 'cinderOrbs') {
        sim.player.auras.push({
          id: VARKHUL_CINDER_ORBS_AURA_ID,
          name: 'Cinder Orbs',
          kind: 'vulnerability',
          remaining: 1,
          duration: 1,
          value: 0,
          sourceId: boss.id,
          school: 'fire',
          encounterOwned: true,
        });
      }
      if (majorAbility === 'forgestorm') {
        sim.ctx.groundAoEs.push({
          sourceId: boss.id,
          abilityId: VARKHUL_FORGESTORM_CAST_ID,
          ability: VARKHUL_FORGESTORM_CAST_ID,
          pos: { ...sim.player.pos },
          radius: 4,
          min: 0,
          max: 0,
          remaining: 1,
          interval: 999,
          tickTimer: 999,
          school: 'fire',
        });
      }
      boss.castingAbility = `active-${majorAbility}`;
      boss.castRemaining = 1;
      boss.damageFloorHp = undefined;
      boss.hp = Math.floor(boss.maxHp * 0.2);

      updateVarkhulEncounter(sim.ctx, boss);

      expect(state.majorAbility).toBe('none');
      expect(state.cinderOrbsMarkRemaining).toBe(0);
      expect(state.cinderOrbsTargetIds).toEqual([]);
      expect(state.forgestormWarningRemaining).toBe(0);
      expect(state.forgestormPoints).toEqual([]);
      expect(state.interceptBeamCastRemaining).toBe(0);
      expect(state.interceptBeamTargetId).toBeNull();
      expect(state.interceptBeamBlockerId).toBeNull();
      expect(boss.castingAbility).toBeNull();
      expect(
        sim.player.auras.some(
          (aura) => aura.id === VARKHUL_CINDER_ORBS_AURA_ID && aura.sourceId === boss.id,
        ),
      ).toBe(false);
      expect(
        sim.ctx.groundAoEs.filter(
          (effect) =>
            effect.sourceId === boss.id && effect.abilityId === VARKHUL_FORGESTORM_CAST_ID,
        ),
      ).toEqual([]);
    },
  );

  it.each(['cinderOrbs', 'forgestorm', 'interceptBeam', 'anvil'] as const)(
    'preserves an active %s sequence when Normal crosses 20%%',
    (majorAbility) => {
      const { sim, boss } = claimedEncounter(
        770 + ['cinderOrbs', 'forgestorm', 'interceptBeam', 'anvil'].indexOf(majorAbility),
      );
      updateVarkhulEncounter(sim.ctx, boss);
      const state = boss.varkhul;
      if (!state) throw new Error('Varkhul state missing');
      state.assemblyTriggered = true;
      state.assemblyPhase = 'done';
      state.forgeBeamTeachingTriggered = true;
      state.forgeBeamPressureTriggered = true;
      state.majorAbility = majorAbility;
      state.cinderOrbsMarkRemaining = 1;
      state.cinderOrbsTargetIds = [sim.player.id];
      state.forgestormWarningRemaining = 1;
      state.forgestormPoints = [{ ...sim.player.pos }];
      state.interceptBeamCastRemaining = 1;
      state.interceptBeamTargetId = sim.player.id;
      state.anvilStrikeRemaining = 1;
      boss.castingAbility = `active-${majorAbility}`;
      boss.castRemaining = 1;
      boss.damageFloorHp = undefined;
      boss.hp = Math.floor(boss.maxHp * 0.2);

      updateVarkhulEncounter(sim.ctx, boss);

      expect(state.masterpieceTriggered).toBe(true);
      expect(state.majorAbility).toBe(majorAbility);
      if (majorAbility === 'forgestorm') expect(boss.castingAbility).toBeNull();
      else expect(boss.castingAbility).not.toBeNull();
      if (majorAbility === 'cinderOrbs') expect(state.cinderOrbsMarkRemaining).toBeLessThan(1);
      if (majorAbility === 'forgestorm') expect(state.forgestormWarningRemaining).toBeLessThan(1);
      if (majorAbility === 'interceptBeam') {
        expect(state.interceptBeamCastRemaining).toBeLessThan(1);
      }
      if (majorAbility === 'anvil') expect(state.anvilStrikeRemaining).toBeLessThan(1);
    },
  );

  it('keeps only frontals, Anvil meteors, and melee during Heroic Worldfire', () => {
    const { sim, boss } = claimedEncounter(748, true);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyTriggered = true;
    state.assemblyPhase = 'done';
    state.forgeBeamTeachingTriggered = true;
    state.forgeBeamPressureTriggered = true;
    // manufactured deep mid-fight state: the walk-in staging is long over
    state.engage.phase = 'done';
    boss.damageFloorHp = undefined;
    boss.hp = Math.floor(boss.maxHp * 0.2);
    updateVarkhulEncounter(sim.ctx, boss);

    state.makersBrandTimer = DT;
    state.cinderOrbsTimer = DT;
    state.forgestormTimer = DT;
    state.interceptBeamTimer = DT;
    state.frontalTimer = 999;
    state.anvilTimer = 999;
    state.masterpiecePulseTimer = DT;
    const abilities: Array<string | null | undefined> = [];
    const originalDealDamage = sim.ctx.dealDamage;
    sim.ctx.dealDamage = ((...args: Parameters<typeof originalDealDamage>) => {
      abilities.push(args[5]);
      return originalDealDamage(...args);
    }) as typeof sim.ctx.dealDamage;
    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.majorAbility).toBe('none');
    expect(state.makersBrandTimer).toBe(DT);
    expect(state.cinderOrbsTimer).toBe(DT);
    expect(state.forgestormTimer).toBe(DT);
    expect(state.interceptBeamTimer).toBe(DT);
    expect(abilities).not.toContain('Living Forge');
    expect(
      sim.player.auras.some(
        (aura) => aura.id === VARKHUL_MAKERS_BRAND_AURA_ID && aura.sourceId === boss.id,
      ),
    ).toBe(false);

    sim.player.damageImmune = false;
    const healthBeforeMelee = sim.player.hp;
    boss.swingTimer = 0;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(sim.player.hp).toBeLessThan(healthBeforeMelee);
    sim.player.damageImmune = true;
    sim.player.dead = false;
    sim.player.hp = sim.player.maxHp;

    state.frontalTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.majorAbility).toBe('frontal');
    state.frontalCastRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.majorAbility).toBe('none');
    expect(abilities).toContain("Forgefather's Sweep");

    state.frontalTimer = 999;
    state.anvilTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.majorAbility).toBe('anvil');
    expect(state.anvilMeteorCastKey).toBeGreaterThan(0);
    state.anvilStrikeRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.anvilMeteorBatches).toHaveLength(1);
    const meteorBatch = state.anvilMeteorBatches[0];
    sim.player.pos = { ...meteorBatch.points[0] };
    sim.player.prevPos = { ...sim.player.pos };
    meteorBatch.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(
      sim.events.some(
        (event) =>
          event.type === 'spellfxAt' &&
          event.fx === 'meteorImpact' &&
          event.ability === 'Hammerfall Meteors',
      ),
    ).toBe(true);
  });

  it('fills the Heroic room in six bands and makes the last three seconds lethal', () => {
    const { sim, boss } = claimedEncounter(727, true);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('Inner Crucible instance missing');
    const center = sim.ctx.instanceOriginOf(instance);
    const outer = addEncounterPlayer(sim, boss, 'OuterWorldfireTarget');
    sim.player.pos = sim.ctx.groundPos(center.x, center.z);
    sim.player.prevPos = { ...sim.player.pos };
    outer.pos = sim.ctx.groundPos(center.x + 37, center.z);
    outer.prevPos = { ...outer.pos };
    state.assemblyTriggered = true;
    state.assemblyPhase = 'done';
    state.forgeBeamTeachingTriggered = true;
    state.forgeBeamPressureTriggered = true;
    boss.damageFloorHp = undefined;
    boss.hp = Math.floor(boss.maxHp * 0.2);

    const worldfireHits: Array<{ targetId: number; amount: number }> = [];
    const originalDealDamage = sim.ctx.dealDamage;
    sim.ctx.dealDamage = ((...args: Parameters<typeof originalDealDamage>) => {
      const [, target, amount, , , ability] = args;
      if (ability === VARKHUL_WORLDFIRE_ABILITY_ID) {
        worldfireHits.push({ targetId: target.id, amount });
        return;
      }
      return originalDealDamage(...args);
    }) as typeof sim.ctx.dealDamage;

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.masterpieceTriggered).toBe(true);
    expect(state.masterpieceWorldfireStage).toBe(0);
    expect(
      sim.events.some(
        (event) => event.type === 'varkhulCallout' && event.call === 'worldfireBegins',
      ),
    ).toBe(true);

    state.masterpiecePulseTimer = 999;
    state.masterpieceWorldfireTickTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(worldfireHits).toEqual([
      {
        targetId: outer.id,
        amount: Math.ceil(outer.maxHp * VARKHUL_WORLDFIRE_DAMAGE_MAX_HP),
      },
    ]);

    state.masterpieceRemaining = 17 + DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.masterpieceWorldfireStage).toBe(4);
    expect(
      sim.events.some(
        (event) => event.type === 'varkhulCallout' && event.call === 'worldfireClosing',
      ),
    ).toBe(true);

    worldfireHits.length = 0;
    state.masterpieceRemaining = 3 + DT;
    state.masterpieceWorldfireTickTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.masterpieceWorldfireStage).toBe(6);
    expect(worldfireHits).toEqual(
      expect.arrayContaining([
        {
          targetId: sim.player.id,
          amount: Math.ceil(sim.player.maxHp * VARKHUL_WORLDFIRE_FULL_DAMAGE_MAX_HP),
        },
        {
          targetId: outer.id,
          amount: Math.ceil(outer.maxHp * VARKHUL_WORLDFIRE_FULL_DAMAGE_MAX_HP),
        },
      ]),
    );
    expect(
      sim.events.some(
        (event) => event.type === 'varkhulCallout' && event.call === 'worldfireConsumed',
      ),
    ).toBe(true);
  });

  it('keeps full-room Heroic Worldfire burning after a dev-invulnerable raid survives the deadline', () => {
    const { sim, boss } = claimedEncounter(755, true);
    // The terminal wipe now force-kills through ordinary immunity
    // (encounter_wipe.ts), so the only sanctioned deadline survivor is a
    // dev/GM invulnerable player; the persistent Worldfire serves exactly
    // that survivor.
    sim.player.devGod = true;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyTriggered = true;
    state.assemblyPhase = 'done';
    state.forgeBeamTeachingTriggered = true;
    state.forgeBeamPressureTriggered = true;
    boss.damageFloorHp = undefined;
    boss.hp = Math.floor(boss.maxHp * 0.2);
    updateVarkhulEncounter(sim.ctx, boss);
    const aura = boss.auras.find((entry) => entry.id === VARKHUL_MASTERPIECE_UNBOUND_AURA_ID);
    if (!aura) throw new Error('Masterpiece Unbound aura missing');
    state.masterpieceRemaining = DT;
    state.masterpieceWorldfireStage = 6;
    state.masterpieceWorldfireTickTimer = DT;
    state.masterpiecePulseTimer = 999;
    aura.remaining = DT;
    const worldfireHits: number[] = [];
    const wipeHits: number[] = [];
    const originalDealDamage = sim.ctx.dealDamage;
    sim.ctx.dealDamage = ((...args: Parameters<typeof originalDealDamage>) => {
      const [, target, , , , ability] = args;
      if (ability === VARKHUL_WORLDFIRE_ABILITY_ID) worldfireHits.push(target.id);
      if (ability === 'Masterpiece Unbound') wipeHits.push(target.id);
    }) as typeof sim.ctx.dealDamage;

    sim.tick();
    expect(state.masterpieceWipeResolved).toBe(true);
    expect(state.masterpieceRemaining).toBe(0);
    expect(wipeHits).toEqual([sim.player.id]);
    expect(worldfireHits).toEqual([sim.player.id]);
    worldfireHits.length = 0;

    for (let tick = 0; tick < 100; tick++) sim.tick();

    expect(worldfireHits).toHaveLength(5);
    expect(worldfireHits.every((targetId) => targetId === sim.player.id)).toBe(true);
    expect(wipeHits).toEqual([sim.player.id]);
    expect(state.masterpieceWorldfireStage).toBe(6);
    const persistentMarker = boss.auras.find(
      (entry) => entry.id === VARKHUL_MASTERPIECE_UNBOUND_AURA_ID,
    );
    expect(persistentMarker).toMatchObject({
      remaining: Number.POSITIVE_INFINITY,
      duration: Number.POSITIVE_INFINITY,
      permanent: true,
    });

    resetVarkhulEncounter(sim.ctx, boss);
    expect(boss.auras.some((entry) => entry.id === VARKHUL_MASTERPIECE_UNBOUND_AURA_ID)).toBe(
      false,
    );
  });

  it('ticks Heroic Worldfire naturally once per second without an early pulse', () => {
    const { sim, boss } = claimedEncounter(738, true);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('Inner Crucible instance missing');
    const center = sim.ctx.instanceOriginOf(instance);
    sim.player.pos = sim.ctx.groundPos(center.x + 37, center.z);
    sim.player.prevPos = { ...sim.player.pos };
    state.assemblyTriggered = true;
    state.assemblyPhase = 'done';
    state.forgeBeamTeachingTriggered = true;
    state.forgeBeamPressureTriggered = true;
    boss.damageFloorHp = undefined;
    boss.hp = Math.floor(boss.maxHp * 0.2);
    const hits: number[] = [];
    const originalDealDamage = sim.ctx.dealDamage;
    sim.ctx.dealDamage = ((...args: Parameters<typeof originalDealDamage>) => {
      if (args[5] === VARKHUL_WORLDFIRE_ABILITY_ID) {
        hits.push(args[2]);
        return;
      }
      return originalDealDamage(...args);
    }) as typeof sim.ctx.dealDamage;

    updateVarkhulEncounter(sim.ctx, boss);
    expect(hits).toEqual([]);
    for (let tick = 0; tick < 18; tick++) updateVarkhulEncounter(sim.ctx, boss);
    expect(hits).toEqual([]);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(hits).toHaveLength(1);
    hits.length = 0;
    for (let tick = 0; tick < 19; tick++) updateVarkhulEncounter(sim.ctx, boss);
    expect(hits).toEqual([]);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(hits).toHaveLength(1);
  });

  it('keeps Worldfire Heroic-only while Normal retains the ordinary 45-second burn', () => {
    const { sim, boss } = claimedEncounter(728, false);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyTriggered = true;
    state.assemblyPhase = 'done';
    state.forgeBeamTeachingTriggered = true;
    state.forgeBeamPressureTriggered = true;
    boss.damageFloorHp = undefined;
    boss.hp = Math.floor(boss.maxHp * 0.2);
    const worldfireHits: number[] = [];
    const originalDealDamage = sim.ctx.dealDamage;
    sim.ctx.dealDamage = ((...args: Parameters<typeof originalDealDamage>) => {
      if (args[5] === VARKHUL_WORLDFIRE_ABILITY_ID) worldfireHits.push(args[2]);
      return originalDealDamage(...args);
    }) as typeof sim.ctx.dealDamage;
    updateVarkhulEncounter(sim.ctx, boss);
    state.masterpieceWorldfireTickTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.masterpieceTriggered).toBe(true);
    expect(state.masterpieceWorldfireStage).toBe(0);
    expect(
      sim.events.some(
        (event) => event.type === 'varkhulCallout' && event.call.startsWith('worldfire'),
      ),
    ).toBe(false);
    expect(worldfireHits).toEqual([]);
  });

  it('does not let Forge Meltdown or forge heat return during Heroic Worldfire', () => {
    const { sim, boss } = claimedEncounter(729, true);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyTriggered = true;
    state.assemblyPhase = 'done';
    state.forgeBeamTeachingTriggered = true;
    state.forgeBeamPressureTriggered = true;
    boss.damageFloorHp = undefined;
    boss.hp = Math.floor(boss.maxHp * 0.2);
    updateVarkhulEncounter(sim.ctx, boss);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('Inner Crucible instance missing');
    const center = sim.ctx.instanceOriginOf(instance);
    sim.player.pos = sim.ctx.groundPos(center.x + 37, center.z);
    sim.player.prevPos = { ...sim.player.pos };
    const worldfireHits: number[] = [];
    const originalDealDamage = sim.ctx.dealDamage;
    sim.ctx.dealDamage = ((...args: Parameters<typeof originalDealDamage>) => {
      if (args[5] === VARKHUL_WORLDFIRE_ABILITY_ID) {
        worldfireHits.push(args[2]);
        return;
      }
      return originalDealDamage(...args);
    }) as typeof sim.ctx.dealDamage;
    state.assemblyForgeMeltdownRemaining = 2;
    state.assemblyForgeMeltdownTickTimer = 999;
    state.forgeBeamWindow = 'meltdown';
    state.assemblyForgeBeamActiveMask = 3;
    state.assemblyForgeOverheat = 1;
    state.masterpieceRemaining = 17 + DT;
    state.masterpieceWorldfireTickTimer = DT;
    const before = state.masterpieceRemaining;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.assemblyForgeMeltdownRemaining).toBe(0);
    expect(state.forgeBeamWindow).toBe('idle');
    expect(state.assemblyForgeBeamActiveMask).toBe(0);
    expect(state.assemblyForgeOverheat).toBe(0);
    expect(state.masterpieceRemaining).toBeCloseTo(before - DT, 8);
    expect(worldfireHits).toHaveLength(1);
    expect(state.masterpieceWorldfireStage).toBe(4);
    expect(
      sim.events.some(
        (event) => event.type === 'varkhulCallout' && event.call === 'worldfireClosing',
      ),
    ).toBe(true);
  });

  it('does not trigger the 80%, 50%, 35%, or 20% windows just above their thresholds', () => {
    const teaching = claimedEncounter(721);
    updateVarkhulEncounter(teaching.sim.ctx, teaching.boss);
    const teachingState = teaching.boss.varkhul;
    if (!teachingState) throw new Error('Teaching state missing');
    teaching.boss.hp = teaching.boss.maxHp * 0.8001;
    updateVarkhulEncounter(teaching.sim.ctx, teaching.boss);
    expect(teachingState.forgeBeamTeachingTriggered).toBe(false);
    teaching.boss.hp = teaching.boss.maxHp * 0.8;
    updateVarkhulEncounter(teaching.sim.ctx, teaching.boss);
    expect(teachingState.forgeBeamWindow).toBe('teaching_left');

    const intermission = claimedEncounter(722);
    intermission.boss.hp = intermission.boss.maxHp * 0.5001;
    updateVarkhulEncounter(intermission.sim.ctx, intermission.boss);
    expect(intermission.boss.varkhul?.assemblyTriggered).toBe(false);
    intermission.boss.hp = intermission.boss.maxHp * 0.5;
    updateVarkhulEncounter(intermission.sim.ctx, intermission.boss);
    expect(intermission.boss.varkhul?.assemblyPhase).toBe('adds');

    const pressure = claimedEncounter(739);
    updateVarkhulEncounter(pressure.sim.ctx, pressure.boss);
    const pressureState = pressure.boss.varkhul;
    if (!pressureState) throw new Error('Pressure state missing');
    pressureState.assemblyTriggered = true;
    pressureState.assemblyPhase = 'done';
    pressureState.forgeBeamTeachingTriggered = true;
    pressure.boss.damageFloorHp = undefined;
    pressure.boss.hp = pressure.boss.maxHp * 0.3501;
    updateVarkhulEncounter(pressure.sim.ctx, pressure.boss);
    expect(pressureState.forgeBeamPressureTriggered).toBe(false);
    pressure.boss.hp = pressure.boss.maxHp * 0.35;
    updateVarkhulEncounter(pressure.sim.ctx, pressure.boss);
    expect(pressureState.forgeBeamPressureTriggered).toBe(true);

    const final = claimedEncounter(723);
    updateVarkhulEncounter(final.sim.ctx, final.boss);
    const finalState = final.boss.varkhul;
    if (!finalState) throw new Error('Final state missing');
    finalState.assemblyTriggered = true;
    finalState.assemblyPhase = 'done';
    final.boss.damageFloorHp = undefined;
    final.boss.hp = final.boss.maxHp * 0.2001;
    updateVarkhulEncounter(final.sim.ctx, final.boss);
    expect(finalState.forgeBeamFinalTriggered).toBe(false);
    final.boss.hp = final.boss.maxHp * 0.2;
    updateVarkhulEncounter(final.sim.ctx, final.boss);
    expect(finalState.forgeBeamWindow).toBe('final_left');
  });

  it('uses the full three-second warmup before a player can block or take exposure damage', () => {
    const { sim, boss } = claimedEncounter(724);
    const instance = sim.instances.find((entry) => entry.mobIds.includes(boss.id));
    if (!instance) throw new Error('Varkhul instance missing');
    const origin = sim.ctx.instanceOriginOf(instance);
    sim.player.pos = sim.ctx.groundPos(
      origin.x + VARKHUL_FORGE_LOCAL_POS.x - 14,
      origin.z + VARKHUL_FORGE_LOCAL_POS.z,
    );
    sim.player.prevPos = { ...sim.player.pos };
    boss.hp = boss.maxHp * 0.8;

    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    expect(state.assemblyForgeBeamWarmupRemaining).toBeCloseTo(
      VARKHUL_FORGE_BEAM_WARMUP_SECONDS - DT,
      5,
    );
    expect(
      sim.events.filter((event) => event.type === 'varkhulCallout').map((event) => event.call),
    ).toEqual(expect.arrayContaining(['leftPillarCharging']));
    expect(
      sim.events.some((event) => event.type === 'varkhulCallout' && event.call === 'leftPillar'),
    ).toBe(false);
    for (let tick = 1; tick < VARKHUL_FORGE_BEAM_WARMUP_SECONDS / DT; tick++) {
      expect(state.assemblyForgeBeamBlockerIds).toEqual([null, null]);
      expect(state.assemblyForgeOverheat).toBe(0);
      expect(sim.player.auras.some((aura) => aura.id === VARKHUL_FORGE_BEAM_EXPOSURE_AURA_ID)).toBe(
        false,
      );
      updateVarkhulEncounter(sim.ctx, boss);
    }
    expect(state.assemblyForgeBeamWarmupRemaining).toBe(0);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([null, null]);
    expect(
      sim.events.filter((event) => event.type === 'varkhulCallout' && event.call === 'leftPillar'),
    ).toHaveLength(1);

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([sim.player.id, null]);
  });

  it('keeps Varkhul in player melee range while his tank soaks a pillar', () => {
    const { sim, boss } = claimedEncounter(754);
    const instance = sim.instances.find((entry) => entry.mobIds.includes(boss.id));
    if (!instance) throw new Error('Varkhul instance missing');
    const origin = sim.ctx.instanceOriginOf(instance);
    sim.player.pos = sim.ctx.groundPos(
      origin.x + VARKHUL_FORGE_LOCAL_POS.x - 14,
      origin.z + VARKHUL_FORGE_LOCAL_POS.z,
    );
    sim.player.prevPos = { ...sim.player.pos };
    boss.hp = boss.maxHp * 0.8;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyForgeBeamWarmupRemaining = 0;
    state.forgeBeamWindowRemaining = 8;

    for (let tick = 0; tick < 80; tick++) sim.tick();

    expect(state.assemblyForgeBeamBlockerIds[0]).toBe(sim.player.id);
    expect(
      Math.hypot(boss.pos.x - sim.player.pos.x, boss.pos.z - sim.player.pos.z),
    ).toBeLessThanOrEqual(MELEE_RANGE);
  });

  it('delays the right-pillar ignition and blocker until its full warmup completes', () => {
    const { sim, boss } = claimedEncounter(732);
    const instance = sim.instances.find((entry) => entry.mobIds.includes(boss.id));
    if (!instance) throw new Error('Varkhul instance missing');
    const origin = sim.ctx.instanceOriginOf(instance);
    sim.player.pos = sim.ctx.groundPos(
      origin.x + VARKHUL_FORGE_LOCAL_POS.x + 14,
      origin.z + VARKHUL_FORGE_LOCAL_POS.z,
    );
    sim.player.prevPos = { ...sim.player.pos };
    boss.hp = boss.maxHp * 0.8;

    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyForgeBeamWarmupRemaining = 0;
    state.forgeBeamWindowRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    state.forgeBeamWindowRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.forgeBeamWindow).toBe('teaching_right');
    expect(state.assemblyForgeBeamWarmupRemaining).toBe(VARKHUL_FORGE_BEAM_WARMUP_SECONDS);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([null, null]);
    expect(
      sim.events.filter(
        (event) => event.type === 'varkhulCallout' && event.call === 'rightPillarCharging',
      ),
    ).toHaveLength(1);
    expect(
      sim.events.filter((event) => event.type === 'varkhulCallout' && event.call === 'rightPillar'),
    ).toHaveLength(0);

    for (let tick = 0; tick < VARKHUL_FORGE_BEAM_WARMUP_SECONDS / DT; tick++) {
      expect(state.assemblyForgeBeamBlockerIds).toEqual([null, null]);
      updateVarkhulEncounter(sim.ctx, boss);
    }
    expect(state.assemblyForgeBeamWarmupRemaining).toBe(0);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([null, null]);
    expect(
      sim.events.filter((event) => event.type === 'varkhulCallout' && event.call === 'rightPillar'),
    ).toHaveLength(1);

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([null, sim.player.id]);
  });

  it('warms the first pillar, warns the next for two seconds, then hands off with zero overlap', () => {
    const { sim, boss } = claimedEncounter(733);
    const rightBlocker = addTank(sim, boss, 'BothWarmupRightBlocker');
    const instance = sim.instances.find((entry) => entry.mobIds.includes(boss.id));
    if (!instance) throw new Error('Varkhul instance missing');
    const origin = sim.ctx.instanceOriginOf(instance);
    const forgeX = origin.x + VARKHUL_FORGE_LOCAL_POS.x;
    const forgeZ = origin.z + VARKHUL_FORGE_LOCAL_POS.z;
    sim.player.pos = sim.ctx.groundPos(forgeX - 14, forgeZ);
    sim.player.prevPos = { ...sim.player.pos };
    rightBlocker.pos = sim.ctx.groundPos(forgeX + 14, forgeZ);
    rightBlocker.prevPos = { ...rightBlocker.pos };
    boss.hp = Math.floor(boss.maxHp * 0.5);

    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    expect(state.forgeBeamWindow).toBe('intermission_left');
    expect(state.assemblyForgeBeamActiveMask).toBe(1);
    expect(state.assemblyForgeBeamWarningMask).toBe(0);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([null, null]);
    expect(
      sim.events.filter(
        (event) => event.type === 'varkhulCallout' && event.call === 'leftPillarCharging',
      ),
    ).toHaveLength(2);
    expect(
      sim.events.filter((event) => event.type === 'varkhulCallout' && event.call === 'leftPillar'),
    ).toHaveLength(0);

    for (let tick = 1; tick < VARKHUL_FORGE_BEAM_WARMUP_SECONDS / DT; tick++) {
      expect(state.assemblyForgeBeamBlockerIds).toEqual([null, null]);
      updateVarkhulEncounter(sim.ctx, boss);
    }
    expect(state.assemblyForgeBeamWarmupRemaining).toBe(0);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([null, null]);
    expect(
      sim.events.filter((event) => event.type === 'varkhulCallout' && event.call === 'leftPillar'),
    ).toHaveLength(2);

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([sim.player.id, null]);
    state.forgeBeamWindowRemaining = VARKHUL_FORGE_INTERMISSION_WARNING_SECONDS + DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('intermission_left');
    expect(state.assemblyForgeBeamActiveMask).toBe(1);
    expect(state.assemblyForgeBeamWarningMask).toBe(2);
    expect(
      sim.events.filter(
        (event) => event.type === 'varkhulCallout' && event.call === 'rightPillarCharging',
      ),
    ).toHaveLength(2);
    expect(
      activeVarkhulAssembly(boss.id, state, { x: forgeX, z: forgeZ }, boss.pos, (entityId) =>
        sim.entities.get(entityId),
      )?.forgeBeams,
    ).toEqual([
      expect.objectContaining({ index: 0, active: true, warning: false }),
      expect.objectContaining({ index: 1, active: false, warning: true }),
    ]);

    state.forgeBeamWindowRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgeBeamWindow).toBe('intermission_right');
    expect(state.assemblyForgeBeamActiveMask).toBe(2);
    expect(state.assemblyForgeBeamWarningMask).toBe(0);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([null, null]);
    expect(
      sim.events.filter((event) => event.type === 'varkhulCallout' && event.call === 'rightPillar'),
    ).toHaveLength(2);

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyForgeBeamBlockerIds).toEqual([null, rightBlocker.id]);
  });

  it('waits for a Normal wave to die, then telegraphs the next wave after three seconds', () => {
    const { sim, boss } = claimedEncounter(712);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.assemblyArtificerNextSpawnRemaining = 999;
    const portalEvents = () =>
      sim.events.filter(
        (event) => event.type === 'spellfxAt' && event.ability === VARKHUL_FORGE_PORTAL_ABILITY_ID,
      );
    expect(state.assemblyIntermissionWaves).toBe(3);
    state.engage.phase = 'done';
    expect(portalEvents()).toHaveLength(4);
    expect(sim.activeVarkhulAssemblies[0]).toMatchObject({
      addWave: 1,
      addWaves: 3,
      addsRemaining: 4,
    });
    for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyAddIds).toHaveLength(4);

    state.assemblyNextWaveRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyNextWaveIndex).toBe(1);
    expect(state.assemblyNextWaveRemaining).toBe(VARKHUL_FORGE_ADD_WAVE_DELAY_NORMAL_SECONDS);
    expect(state.assemblyPortalSpawns).toEqual([]);

    for (const id of state.assemblyAddIds) {
      const add = sim.entities.get(id);
      if (add) add.dead = true;
    }
    for (let tick = 1; tick < VARKHUL_FORGE_ADD_WAVE_DELAY_NORMAL_SECONDS / DT; tick++) {
      updateVarkhulEncounter(sim.ctx, boss);
    }
    expect(state.assemblyNextWaveIndex).toBe(1);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyNextWaveIndex).toBe(2);
    expect(state.assemblyPortalSpawns).toHaveLength(4);
    expect(portalEvents()).toHaveLength(8);
    expect(sim.activeVarkhulAssemblies[0]).toMatchObject({ addWave: 2, addsRemaining: 4 });
  });

  it('overlaps Heroic waves after fourteen seconds or queues early when the prior wave dies', () => {
    const timed = claimedEncounter(711, true);
    timed.boss.hp = Math.floor(timed.boss.maxHp * 0.5);
    updateVarkhulEncounter(timed.sim.ctx, timed.boss);
    const timedState = timed.boss.varkhul;
    if (!timedState) throw new Error('Varkhul state missing');
    timedState.engage.phase = 'done';
    timedState.assemblyArtificerNextSpawnRemaining = 999;
    for (const pending of timedState.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(timed.sim.ctx, timed.boss);
    expect(timedState.assemblyAddIds).toHaveLength(5);
    timedState.assemblyNextWaveRemaining = DT;
    updateVarkhulEncounter(timed.sim.ctx, timed.boss);
    expect(timedState.assemblyNextWaveIndex).toBe(2);
    expect(timedState.assemblyPortalSpawns).toHaveLength(5);
    expect(timedState.assemblyNextWaveRemaining).toBe(VARKHUL_FORGE_ADD_WAVE_DELAY_HEROIC_SECONDS);

    const early = claimedEncounter(713, true);
    early.boss.hp = Math.floor(early.boss.maxHp * 0.5);
    updateVarkhulEncounter(early.sim.ctx, early.boss);
    const earlyState = early.boss.varkhul;
    if (!earlyState) throw new Error('Varkhul state missing');
    earlyState.assemblyArtificerNextSpawnRemaining = 999;
    for (const pending of earlyState.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(early.sim.ctx, early.boss);
    for (const id of earlyState.assemblyAddIds) {
      const add = early.sim.entities.get(id);
      if (add) add.dead = true;
    }
    earlyState.assemblyNextWaveRemaining = 13;
    updateVarkhulEncounter(early.sim.ctx, early.boss);
    expect(earlyState.assemblyNextWaveIndex).toBe(2);
    expect(earlyState.assemblyPortalSpawns).toHaveLength(5);
  });

  it('waits for future and pending waves even when every add already spawned is dead', () => {
    const { sim, boss } = claimedEncounter(725);
    boss.hp = boss.maxHp * 0.5;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');

    const spawnPendingAndKill = () => {
      for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
      updateVarkhulEncounter(sim.ctx, boss);
      for (const id of state.assemblyAddIds) {
        const add = sim.entities.get(id);
        if (add) add.dead = true;
      }
    };

    spawnPendingAndKill();
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyPhase).toBe('adds');
    expect(state.assemblyNextWaveIndex).toBe(1);
    expect(state.assemblyPortalSpawns).toEqual([]);

    state.assemblyNextWaveRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    spawnPendingAndKill();
    state.assemblyNextWaveRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyNextWaveIndex).toBe(state.assemblyIntermissionWaves);
    expect(state.assemblyPortalSpawns.length).toBeGreaterThan(0);
    expect(state.assemblyPhase).toBe('adds');

    spawnPendingAndKill();
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyPhase).toBe('stunned');
  });

  it.each([
    { heroic: false, seconds: VARKHUL_FORGE_INTERMISSION_SECONDS_NORMAL },
    { heroic: true, seconds: VARKHUL_FORGE_INTERMISSION_SECONDS_HEROIC },
  ])(
    'times out the full $seconds-second intermission exactly and keeps living adds in combat',
    ({ heroic, seconds }) => {
      const { sim, boss } = claimedEncounter(heroic ? 713 : 714, heroic);
      const rightBlocker = addTank(sim, boss, 'TimeoutRightBlocker');
      const instance = sim.instances.find((entry) => entry.mobIds.includes(boss.id));
      if (!instance) throw new Error('Varkhul instance missing');
      const origin = sim.ctx.instanceOriginOf(instance);
      const forgeX = origin.x + VARKHUL_FORGE_LOCAL_POS.x;
      const forgeZ = origin.z + VARKHUL_FORGE_LOCAL_POS.z;
      sim.player.pos = sim.ctx.groundPos(forgeX - 14, forgeZ);
      sim.player.prevPos = { ...sim.player.pos };
      rightBlocker.pos = sim.ctx.groundPos(forgeX + 14, forgeZ);
      rightBlocker.prevPos = { ...rightBlocker.pos };
      boss.hp = Math.floor(boss.maxHp * 0.5);
      updateVarkhulEncounter(sim.ctx, boss);
      const state = boss.varkhul;
      if (!state) throw new Error('Varkhul state missing');
      for (let tick = 1; tick < seconds / DT - 1; tick++) {
        updateVarkhulEncounter(sim.ctx, boss);
      }
      expect(state.assemblyRemaining).toBeCloseTo(DT, 4);
      expect(state.assemblyForgeMeltdownRemaining).toBe(0);
      const liveAddIds = [...state.assemblyAddIds];
      expect(liveAddIds.length).toBeGreaterThan(0);
      expect(liveAddIds.some((id) => sim.entities.has(id))).toBe(true);

      updateVarkhulEncounter(sim.ctx, boss);
      expect(state.assemblyRemaining).toBe(0);
      expect(state.assemblyForgeMeltdownRemaining).toBe(VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS);
      expect(liveAddIds.every((id) => sim.entities.has(id))).toBe(true);
      expect(liveAddIds.every((id) => boss.summonedIds.includes(id))).toBe(true);
      expect(state.assemblyAddIds).toEqual(liveAddIds);
      expect(state.assemblyPortalSpawns).toEqual([]);
      const retainedWarden = liveAddIds
        .map((id) => sim.entities.get(id))
        .find((add) => add?.templateId === VARKHUL_CRUCIBLE_WARDEN_ID);
      if (!retainedWarden) throw new Error('Meltdown did not retain a Crucible Warden');
      retainedWarden.bigCastTimer = DT;
      sim.tick();
      expect(retainedWarden.inCombat).toBe(true);
      expect(retainedWarden.castingAbility).toBe('crucible_quake');
      for (let tick = 0; tick < VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS / DT; tick++) {
        updateVarkhulEncounter(sim.ctx, boss);
      }
      expect(liveAddIds.every((id) => sim.entities.has(id))).toBe(true);
      expect(state.assemblyPhase).toBe('adds');
      expect(state.assemblyForgeMeltdownRemaining).toBe(0);
      expect(state.assemblyWipeResolved).toBe(true);
      expect(state.assemblyForgeBeamWarmupRemaining).toBeCloseTo(
        VARKHUL_FORGE_BEAM_WARMUP_SECONDS - DT,
        5,
      );
      resetVarkhulEncounter(sim.ctx, boss);
      expect(liveAddIds.every((id) => !sim.entities.has(id))).toBe(true);
    },
  );

  it('telegraphs four portals, spawns twenty Heroic combat adds, and sends them to the top tank', () => {
    const { sim, boss } = claimedEncounter(702, true);
    const topTank = addTank(sim, boss, 'TopTank');
    const deadTank = addTank(sim, boss, 'DeadTank');
    const highThreatDps = addEncounterPlayer(sim, boss, 'HighThreatDps');
    deadTank.dead = true;
    boss.threat.set(sim.player.id, 50);
    boss.threat.set(topTank.id, 100);
    boss.threat.set(deadTank.id, 10_000);
    boss.threat.set(highThreatDps.id, 5_000);
    boss.hp = Math.floor(boss.maxHp * 0.5);

    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    expect(state.assemblyPhase).toBe('adds');
    expect(state.assemblyRemaining).toBeCloseTo(VARKHUL_FORGE_INTERMISSION_SECONDS_HEROIC - DT, 5);
    expect(state.assemblyForgeBeamActiveMask).toBe(1);
    expect(state.assemblyPortalSpawns).toHaveLength(5);
    expect(new Set(state.assemblyPortalSpawns.map((spawn) => spawn.spawnIndex)).size).toBe(5);
    expect(state.assemblyAddIds).toEqual([]);
    expect(
      sim.events.filter((event) => event.type === 'varkhulCallout').map((event) => event.call),
    ).toEqual(expect.arrayContaining(['leftPillarCharging', 'portalsOpening']));
    for (const player of [sim.player, topTank, deadTank, highThreatDps]) {
      expect(
        sim.events.filter(
          (event) =>
            event.type === 'varkhulCallout' &&
            event.pid === player.id &&
            (event.call === 'leftPillarCharging' || event.call === 'portalsOpening'),
        ),
      ).toHaveLength(2);
    }
    const instance = sim.instances.find((entry) => entry.mobIds.includes(boss.id));
    if (!instance) throw new Error('Varkhul instance missing');
    expect(boss.pos.z - sim.ctx.instanceOriginOf(instance).z).toBeCloseTo(
      VARKHUL_WORK_LOCAL_POS.z,
      5,
    );
    expect(boss.facing).toBe(VARKHUL_WORK_FACING);

    expect(state.assemblyAddIds).toEqual([]);
    state.assemblyForgeBeamWarmupRemaining = DT;
    for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyAddIds).toHaveLength(5);
    for (const player of [sim.player, topTank, deadTank, highThreatDps]) {
      expect(
        sim.events.some(
          (event) =>
            event.type === 'varkhulCallout' &&
            event.pid === player.id &&
            event.call === 'leftPillar',
        ),
      ).toBe(true);
    }

    for (let wave = 1; wave < 4; wave++) {
      state.assemblyNextWaveRemaining = DT;
      updateVarkhulEncounter(sim.ctx, boss);
      expect(state.assemblyPortalSpawns).toHaveLength(5);
      for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
      updateVarkhulEncounter(sim.ctx, boss);
    }

    const adds = state.assemblyAddIds.map((id) => sim.entities.get(id)).filter(Boolean) as Entity[];
    expect(adds).toHaveLength(20);
    expect(adds.filter((add) => add.templateId === VARKHUL_CRUCIBLE_WARDEN_ID)).toHaveLength(4);
    expect(adds.filter((add) => add.templateId === VARKHUL_EMBER_SENTINEL_ID)).toHaveLength(16);
    expect(adds.some((add) => add.templateId === VARKHUL_CINDER_ARTIFICER_ID)).toBe(false);
    expect(adds.every((add) => add.aggroTargetId === topTank.id)).toBe(true);
    expect(adds.every((add) => (add.threat.get(topTank.id) ?? 0) >= 100)).toBe(true);
    expect(state.assemblyPhase).toBe('adds');

    for (const add of adds) add.dead = true;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyPhase).toBe('stunned');
    expect(state.assemblyPortalSpawns).toEqual([]);
    expect(state.assemblyForgeBeamActiveMask).toBe(0);
    for (const player of [sim.player, topTank, deadTank, highThreatDps]) {
      expect(
        sim.events.some(
          (event) =>
            event.type === 'varkhulCallout' &&
            event.pid === player.id &&
            event.call === 'addsDefeated',
        ),
      ).toBe(true);
    }
  });

  it('ramps one-second soak damage and records the long Heroic exposure reset', () => {
    const { sim, boss } = claimedEncounter(703, true);
    sim.player.damageImmune = false;
    boss.hp = Math.floor(boss.maxHp * 0.79);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    expect(state.assemblyRuneDifficulty).toBe('heroic');
    expect(state.forgeBeamWindow).toBe('teaching_left');
    expect(
      sim.events.some(
        (event) => event.type === 'varkhulCallout' && event.call === 'leftPillarCharging',
      ),
    ).toBe(true);
    const forge = { x: boss.pos.x, z: boss.pos.z + 6 };
    sim.player.pos = { x: forge.x - 14, y: sim.player.pos.y, z: forge.z };
    sim.player.prevPos = { ...sim.player.pos };
    state.assemblyForgeBeamWarmupRemaining = 0;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.assemblyForgeBeamBlockerIds[0]).toBe(sim.player.id);
    state.assemblyForgeBeamDamageTimers[0] = DT;
    const hpBeforeFirst = sim.player.hp;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(hpBeforeFirst - sim.player.hp).toBe(Math.ceil(sim.player.maxHp * 0.1));
    const exposure = sim.player.auras.find(
      (aura) => aura.id === VARKHUL_FORGE_BEAM_EXPOSURE_AURA_ID,
    );
    expect(exposure?.stacks).toBe(1);
    expect(exposure?.remaining).toBe(60);

    state.assemblyForgeBeamDamageTimers[0] = DT;
    const hpBeforeSecond = sim.player.hp;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(hpBeforeSecond - sim.player.hp).toBe(Math.ceil(sim.player.maxHp * 0.13));
    expect(exposure?.stacks).toBe(2);
    expect(exposure?.remaining).toBe(60);
    expect(VARKHUL_FORGE_BEAM_BLOCK_DAMAGE_TICK_SECONDS).toBe(1);
  });

  it.each([
    { heroic: false, resetSeconds: 10 },
    { heroic: true, resetSeconds: 60 },
  ])(
    'keeps exposure until the $resetSeconds-second reset and restarts the next soak at stack one',
    ({ heroic, resetSeconds }) => {
      const { sim, boss } = claimedEncounter(heroic ? 715 : 716, heroic);
      boss.hp = Math.floor(boss.maxHp * 0.79);
      updateVarkhulEncounter(sim.ctx, boss);
      const state = boss.varkhul;
      if (!state) throw new Error('Varkhul state missing');
      const instance = sim.instances.find((entry) => entry.mobIds.includes(boss.id));
      if (!instance) throw new Error('Varkhul instance missing');
      const origin = sim.ctx.instanceOriginOf(instance);
      const forgeX = origin.x + VARKHUL_FORGE_LOCAL_POS.x;
      const forgeZ = origin.z + VARKHUL_FORGE_LOCAL_POS.z;
      sim.player.pos = sim.ctx.groundPos(forgeX - 14, forgeZ);
      sim.player.prevPos = { ...sim.player.pos };
      state.assemblyForgeBeamWarmupRemaining = 0;
      state.assemblyForgeBeamBlockerIds[0] = sim.player.id;
      state.assemblyForgeBeamDamageTimers[0] = DT;
      updateVarkhulEncounter(sim.ctx, boss);
      expect(varkhulForgeBeamExposureResetSeconds(state.assemblyRuneDifficulty)).toBe(resetSeconds);
      expect(
        sim.player.auras.find((aura) => aura.id === VARKHUL_FORGE_BEAM_EXPOSURE_AURA_ID),
      ).toMatchObject({ stacks: 1, remaining: resetSeconds });

      sim.player.damageImmune = true;
      sim.player.pos = sim.ctx.groundPos(boss.pos.x, boss.pos.z - 2);
      sim.player.prevPos = { ...sim.player.pos };
      for (let tick = 0; tick < resetSeconds / DT - 1; tick++) sim.tick();
      expect(
        sim.player.auras.find((aura) => aura.id === VARKHUL_FORGE_BEAM_EXPOSURE_AURA_ID),
      ).toMatchObject({ stacks: 1, remaining: expect.any(Number) });
      sim.tick();
      expect(sim.player.auras.some((aura) => aura.id === VARKHUL_FORGE_BEAM_EXPOSURE_AURA_ID)).toBe(
        false,
      );

      state.majorAbility = 'none';
      state.forgeBeamWindow = 'teaching_left';
      state.forgeBeamWindowRemaining = 999;
      state.assemblyForgeBeamActiveMask = 1;
      state.assemblyForgeBeamWarmupRemaining = 0;
      state.assemblyForgeBeamBlockerIds[0] = sim.player.id;
      state.assemblyForgeBeamDamageTimers[0] = DT;
      sim.player.pos = sim.ctx.groundPos(forgeX - 14, forgeZ);
      sim.player.prevPos = { ...sim.player.pos };
      updateVarkhulEncounter(sim.ctx, boss);
      expect(
        sim.player.auras.find((aura) => aura.id === VARKHUL_FORGE_BEAM_EXPOSURE_AURA_ID),
      ).toMatchObject({ stacks: 1, remaining: resetSeconds });
    },
  );

  it('cools idle Normal heat, preserves Heroic heat, and announces both danger thresholds once', () => {
    const normal = claimedEncounter(705);
    updateVarkhulEncounter(normal.sim.ctx, normal.boss);
    if (!normal.boss.varkhul) throw new Error('Normal Varkhul state missing');
    normal.boss.varkhul.assemblyForgeOverheat = 0.4;
    updateVarkhulEncounter(normal.sim.ctx, normal.boss);
    expect(normal.boss.varkhul.assemblyForgeOverheat).toBeCloseTo(0.3985, 8);

    const heroic = claimedEncounter(706, true);
    updateVarkhulEncounter(heroic.sim.ctx, heroic.boss);
    if (!heroic.boss.varkhul) throw new Error('Heroic Varkhul state missing');
    heroic.boss.varkhul.assemblyForgeOverheat = 0.4;
    updateVarkhulEncounter(heroic.sim.ctx, heroic.boss);
    expect(heroic.boss.varkhul.assemblyForgeOverheat).toBe(0.4);

    normal.boss.hp = Math.floor(normal.boss.maxHp * 0.79);
    normal.boss.varkhul.assemblyForgeOverheat = 0.748;
    updateVarkhulEncounter(normal.sim.ctx, normal.boss);
    normal.boss.varkhul.assemblyForgeBeamWarmupRemaining = 0;
    updateVarkhulEncounter(normal.sim.ctx, normal.boss);
    normal.boss.varkhul.assemblyForgeOverheat = 0.898;
    updateVarkhulEncounter(normal.sim.ctx, normal.boss);
    updateVarkhulEncounter(normal.sim.ctx, normal.boss);
    const warnings = normal.sim.events
      .filter((event) => event.type === 'varkhulCallout')
      .map((event) => event.call)
      .filter((call) => call === 'heat75' || call === 'heat90');
    expect(warnings).toEqual(['heat75', 'heat90']);
  });

  it('lets a portal Sentinel cross the room, retarget by threat, and obey a taunt', () => {
    const { sim, boss } = claimedEncounter(717);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    state.assemblyForgeBeamWarmupRemaining = 999;
    const sentinels = state.assemblyAddIds
      .map((id) => sim.entities.get(id))
      .filter((add): add is Entity => add?.templateId === VARKHUL_EMBER_SENTINEL_ID);
    const sentinel = sentinels.sort(
      (first, second) =>
        Math.hypot(second.pos.x - sim.player.pos.x, second.pos.z - sim.player.pos.z) -
        Math.hypot(first.pos.x - sim.player.pos.x, first.pos.z - sim.player.pos.z),
    )[0];
    if (!sentinel) throw new Error('Ember Sentinel did not emerge');
    expect(sentinel.mechanicDamageMult).toBeUndefined();
    for (const addId of state.assemblyAddIds) {
      const add = sim.entities.get(addId);
      if (add && add.id !== sentinel.id) add.dead = true;
    }
    const startDistance = Math.hypot(
      sentinel.pos.x - sim.player.pos.x,
      sentinel.pos.z - sim.player.pos.z,
    );
    expect(startDistance).toBeGreaterThan(18);
    for (let tick = 0; tick < 180 && !sentinel.dead; tick++) {
      sim.tick();
      expect(sentinel.aiState).not.toBe('evade');
      if (Math.hypot(sentinel.pos.x - sim.player.pos.x, sentinel.pos.z - sim.player.pos.z) < 6) {
        break;
      }
    }
    expect(
      Math.hypot(sentinel.pos.x - sim.player.pos.x, sentinel.pos.z - sim.player.pos.z),
    ).toBeLessThan(6);

    const challenger = addTank(sim, boss, 'SentinelChallenger');
    sentinel.threat.clear();
    sentinel.threat.set(sim.player.id, 10);
    sentinel.threat.set(challenger.id, 10_000);
    sentinel.aggroTargetId = sim.player.id;
    sim.tick();
    expect(sentinel.aggroTargetId).toBe(challenger.id);

    sentinel.forcedTargetId = sim.player.id;
    sentinel.forcedTargetTimer = DT / 2;
    sim.tick();
    expect(sentinel.aggroTargetId).toBe(sim.player.id);
    sim.tick();
    expect(sentinel.forcedTargetId).toBeNull();
    expect(sentinel.aggroTargetId).toBe(challenger.id);
  });

  it('makes each portal Warden pursue, melee, cast Quake, and recast on cadence', () => {
    const { sim, boss } = claimedEncounter(704, true);
    sim.player.autoAttack = false;
    sim.player.damageImmune = false;
    sim.player.maxHp = 100_000;
    sim.player.hp = sim.player.maxHp;
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    const warden = state.assemblyAddIds
      .map((id) => sim.entities.get(id))
      .find((add) => add?.templateId === VARKHUL_CRUCIBLE_WARDEN_ID);
    if (!warden) throw new Error('Crucible Warden did not emerge');
    expect(warden.maxHp).toBe(4_011);
    expect(warden.mechanicDamageMult).toBeCloseTo((92.2 * 1.25) / 99.8, 12);
    state.assemblyForgeBeamWarmupRemaining = 999;

    const challenger = addTank(sim, boss, 'WardenChallenger');
    warden.threat.clear();
    warden.threat.set(sim.player.id, 10);
    warden.threat.set(challenger.id, 10_000);
    warden.aggroTargetId = sim.player.id;
    sim.tick();
    expect(warden.aggroTargetId).toBe(challenger.id);
    warden.forcedTargetId = sim.player.id;
    warden.forcedTargetTimer = DT / 2;
    sim.tick();
    expect(warden.aggroTargetId).toBe(sim.player.id);
    sim.tick();
    expect(warden.forcedTargetId).toBeNull();
    expect(warden.aggroTargetId).toBe(challenger.id);
    warden.threat.clear();
    warden.threat.set(sim.player.id, 10_000);
    warden.aggroTargetId = sim.player.id;

    for (const addId of state.assemblyAddIds) {
      const add = sim.entities.get(addId);
      if (add && add.id !== warden.id) add.dead = true;
    }

    sim.player.pos = sim.ctx.groundPos(warden.pos.x + 10, warden.pos.z);
    sim.player.prevPos = { ...sim.player.pos };
    const beforePursuit = Math.hypot(
      warden.pos.x - sim.player.pos.x,
      warden.pos.z - sim.player.pos.z,
    );
    sim.tick();
    expect(
      Math.hypot(warden.pos.x - sim.player.pos.x, warden.pos.z - sim.player.pos.z),
    ).toBeLessThan(beforePursuit);

    sim.player.pos = sim.ctx.groundPos(warden.pos.x + 1, warden.pos.z);
    sim.player.prevPos = { ...sim.player.pos };
    warden.bigCastTimer = DT;
    warden.swingTimer = 0;
    const hpBeforeMelee = sim.player.hp;
    const quakeStartEvents = sim.tick();
    expect(sim.player.hp).toBeLessThan(hpBeforeMelee);
    expect(warden.castingAbility).toBe('crucible_quake');
    expect(quakeStartEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'spellfx',
          sourceId: warden.id,
          targetId: warden.id,
          fx: 'windup',
          ability: 'crucible_quake',
        }),
      ]),
    );
    const firstCastStartedAt = sim.ctx.time;

    sim.player.pos = sim.ctx.groundPos(warden.pos.x + 10, warden.pos.z);
    sim.player.prevPos = { ...sim.player.pos };
    const castRemainingBeforePursuit = warden.castRemaining;
    const distanceBeforeCastPursuit = Math.hypot(
      warden.pos.x - sim.player.pos.x,
      warden.pos.z - sim.player.pos.z,
    );
    sim.tick();
    expect(
      Math.hypot(warden.pos.x - sim.player.pos.x, warden.pos.z - sim.player.pos.z),
    ).toBeLessThan(distanceBeforeCastPursuit);
    expect(warden.castRemaining).toBeLessThan(castRemainingBeforePursuit);
    expect(warden.castingAbility).toBe('crucible_quake');

    sim.player.pos = sim.ctx.groundPos(warden.pos.x + 1, warden.pos.z);
    sim.player.prevPos = { ...sim.player.pos };
    warden.swingTimer = 0;
    const hpBeforeCastingMelee = sim.player.hp;
    sim.tick();
    expect(sim.player.hp).toBeLessThan(hpBeforeCastingMelee);
    expect(warden.castingAbility).toBe('crucible_quake');

    warden.swingTimer = 999;
    state.assemblyForgeOverheat = 0.2;
    const quakeDamage: number[] = [];
    for (let tick = 0; tick < 60 && warden.castingAbility === 'crucible_quake'; tick++) {
      for (const event of sim.tick()) {
        if (
          event.type === 'damage' &&
          event.sourceId === warden.id &&
          event.ability === 'Crucible Quake'
        ) {
          quakeDamage.push(event.amount);
        }
      }
    }
    expect(warden.castingAbility).toBeNull();
    expect(quakeDamage).toHaveLength(1);
    expect(quakeDamage[0]).toBeGreaterThanOrEqual(260);
    expect(quakeDamage[0]).toBeLessThanOrEqual(330);
    expect(state.assemblyForgeOverheat).toBeCloseTo(0.3, 8);
    for (let tick = 0; tick < 240 && warden.castingAbility !== 'crucible_quake'; tick++) {
      sim.tick();
    }
    expect(warden.castingAbility).toBe('crucible_quake');
    expect(sim.ctx.time - firstCastStartedAt).toBeCloseTo(12, 4);

    state.assemblyPhase = 'done';
    state.assemblyForgeOverheat = 0.3;
    warden.castRemaining = DT;
    sim.tick();
    expect(warden.castingAbility).toBeNull();
    expect(state.assemblyForgeOverheat).toBeCloseTo(0.3, 8);
  });

  it('lets Pummel interrupt Quake, applies fire lockout, and preserves its 12-second cadence', () => {
    const { sim, boss } = claimedEncounter(718);
    sim.setPlayerLevel(20);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    state.assemblyForgeBeamWarmupRemaining = 999;
    const warden = state.assemblyAddIds
      .map((id) => sim.entities.get(id))
      .find((add) => add?.templateId === VARKHUL_CRUCIBLE_WARDEN_ID);
    if (!warden) throw new Error('Crucible Warden did not emerge');
    for (const addId of state.assemblyAddIds) {
      const add = sim.entities.get(addId);
      if (add && add.id !== warden.id) add.dead = true;
    }
    sim.player.pos = sim.ctx.groundPos(warden.pos.x + 1, warden.pos.z);
    sim.player.prevPos = { ...sim.player.pos };
    warden.swingTimer = 999;
    warden.bigCastTimer = DT;
    state.assemblyForgeOverheat = 0.2;
    sim.tick();
    expect(warden.castingAbility).toBe('crucible_quake');
    const firstCastStartedAt = sim.ctx.time;

    const meta = sim.players.get(sim.playerId);
    const resolved = (
      sim as unknown as { resolvedAbility(id: string, pid: number): unknown }
    ).resolvedAbility('pummel', sim.playerId);
    if (!meta || !resolved) throw new Error('Pummel did not resolve');
    (
      sim.ctx as unknown as {
        runEffects(
          player: Entity,
          playerMeta: typeof meta,
          target: Entity,
          resolved: unknown,
        ): void;
      }
    ).runEffects(sim.player, meta, warden, resolved);
    expect(warden.castingAbility).toBeNull();
    expect(warden.auras).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'lockout', school: 'fire' })]),
    );
    expect(state.assemblyForgeOverheat).toBe(0.2);

    for (let tick = 0; tick < 239; tick++) {
      sim.tick();
      expect(warden.castingAbility).toBeNull();
    }
    sim.tick();
    expect(warden.castingAbility).toBe('crucible_quake');
    expect(sim.ctx.time - firstCastStartedAt).toBeCloseTo(12, 4);
  });

  it('replays Warden and Artificer portals, casts, heals, IDs, and rng draws for the same seed', () => {
    const run = () => {
      const { sim, boss } = claimedEncounter(719, true);
      boss.hp = Math.floor(boss.maxHp * 0.5);
      updateVarkhulEncounter(sim.ctx, boss);
      const state = boss.varkhul;
      if (!state) throw new Error('Varkhul state missing');
      for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
      updateVarkhulEncounter(sim.ctx, boss);
      state.assemblyForgeBeamWarmupRemaining = 999;
      const warden = state.assemblyAddIds
        .map((id) => sim.entities.get(id))
        .find((add) => add?.templateId === VARKHUL_CRUCIBLE_WARDEN_ID);
      if (!warden) throw new Error('Crucible Warden did not emerge');
      for (const addId of state.assemblyAddIds) {
        const add = sim.entities.get(addId);
        if (add && add.id !== warden.id) add.dead = true;
      }
      sim.player.pos = sim.ctx.groundPos(warden.pos.x + 1, warden.pos.z);
      sim.player.prevPos = { ...sim.player.pos };
      warden.swingTimer = 999;
      warden.bigCastTimer = DT;
      const draws: number[] = [];
      sim.rng.setObserver((value) => draws.push(value));
      const quakeEvents: unknown[] = [];
      const artificerEvents: unknown[] = [];
      for (let tick = 0; tick < 520; tick++) {
        const events = sim.tick();
        quakeEvents.push(
          ...events.filter((event) => event.type === 'spellfx' && event.sourceId === warden.id),
        );
        artificerEvents.push(
          ...events.filter(
            (event) =>
              (event.type === 'spellfx' &&
                (event.ability === VARKHUL_CINDER_REPAIR_START_ANIMATION_ID ||
                  event.ability === VARKHUL_CINDER_REPAIR_CAST_ID ||
                  event.ability === VARKHUL_CINDER_REPAIR_END_ANIMATION_ID)) ||
              (event.type === 'heal2' && event.ability === VARKHUL_CINDER_REPAIR_CAST_ID),
          ),
        );
      }
      sim.rng.setObserver(null);
      const artificerIds = state.assemblyAddIds.filter(
        (id) => sim.entities.get(id)?.templateId === VARKHUL_CINDER_ARTIFICER_ID,
      );
      return {
        draws,
        addIds: [...state.assemblyAddIds],
        targetId: warden.aggroTargetId,
        quakeEvents,
        artificerEvents,
        artificerIds,
        artificerPending: state.assemblyArtificerPortalSpawns.map((pending) => ({ ...pending })),
        artificerSpawnIndex: state.assemblyArtificerSpawnIndex,
        artificerTimer: state.assemblyArtificerNextSpawnRemaining,
        artificerRepaired: state.assemblyArtificerRepaired,
        bossHp: boss.hp,
        phase: state.assemblyPhase,
        bigCastTimer: warden.bigCastTimer,
      };
    };

    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first.draws.length).toBeGreaterThan(0);
    expect(first.quakeEvents.length).toBeGreaterThan(0);
    expect(first.artificerIds.length).toBeGreaterThan(0);
    expect(first.artificerEvents.length).toBeGreaterThan(2);
    expect(first.artificerRepaired).toBe(true);
  });
});
