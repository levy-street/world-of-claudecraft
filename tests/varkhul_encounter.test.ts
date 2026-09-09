import { describe, expect, it } from 'vitest';
import { isPlayerRemovableAura } from '../src/sim/aura_classify';
import {
  clearVarkhulEncounterAuras,
  resetVarkhulEncounter,
  selectVarkhulCinderOrbTargets,
  updateVarkhulEncounter,
  VARKHUL_ANVILS_DECREE_CAST_ID,
  VARKHUL_ANVILS_DECREE_STRIKES,
  VARKHUL_BOSS_ID,
  VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP,
  VARKHUL_CINDER_FIRE_RADIUS,
  VARKHUL_CINDER_FIRE_TICK_SECONDS,
  VARKHUL_CINDER_ORB_DAMAGE_MAX_HP,
  VARKHUL_CINDER_ORB_DURATION,
  VARKHUL_CINDER_ORB_HIT_RADIUS,
  VARKHUL_CINDER_ORB_PROJECTILES_PER_TARGET,
  VARKHUL_CINDER_ORB_SPEED,
  VARKHUL_CINDER_ORBS_AURA_ID,
  VARKHUL_CINDER_ORBS_CAST_ID,
  VARKHUL_CINDER_ORBS_MARK_SECONDS,
  VARKHUL_CINDER_ORBS_TARGETS,
  VARKHUL_FORGE_LOCAL_POS,
  VARKHUL_FORGESTORM_CAST_ID,
  VARKHUL_FORGESTORM_DAMAGE_MAX_HP,
  VARKHUL_FORGESTORM_IMPACTS_PER_WAVE,
  VARKHUL_FORGESTORM_WARNING_SECONDS,
  VARKHUL_FORGESTORM_WAVES,
  VARKHUL_FRONTAL_CAST_ID,
  VARKHUL_FRONTAL_CAST_SECONDS,
  VARKHUL_FRONTAL_DAMAGE_MAX_HP_HEROIC,
  VARKHUL_FRONTAL_DAMAGE_MAX_HP_NORMAL,
  VARKHUL_FRONTAL_RECOVER_SECONDS,
  VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID,
  VARKHUL_INTERCEPT_BEAM_DEBUFF_DAMAGE_TAKEN,
  VARKHUL_INTERCEPT_BEAM_DEBUFF_NAME,
  VARKHUL_INTERCEPT_BEAM_DEBUFF_SECONDS,
  VARKHUL_MAKERS_BRAND_AURA_ID,
  VARKHUL_MAKERS_BRAND_DAMAGE_MAX_HP,
  VARKHUL_MAKERS_BRAND_DURATION,
  VARKHUL_MAKERS_BRAND_EVERY,
  VARKHUL_MAKERS_BRAND_MAX_STACKS,
  VARKHUL_MAKERS_BRAND_PER_STACK,
  VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS,
  VARKHUL_MASTERPIECE_UNBOUND_AURA_ID,
  VARKHUL_MASTERPIECE_UNBOUND_PULSE_MAX_HP,
  VARKHUL_MASTERPIECE_UNBOUND_PULSE_SECONDS,
  VARKHUL_MASTERPIECE_UNBOUND_SPEED_MULTIPLIER,
  VARKHUL_MASTERS_ASSEMBLY_SECONDS,
  VARKHUL_RED_HOT_METAL_ABSORB_AURA_ID,
  VARKHUL_RED_HOT_METAL_AURA_ID,
  VARKHUL_RED_HOT_METAL_DAMAGE_MAX_HP,
  VARKHUL_RED_HOT_METAL_DURATION,
  VARKHUL_RED_HOT_METAL_HEAL_ABSORB_MAX_HP,
  VARKHUL_RED_HOT_METAL_TICK_SECONDS,
  varkhulForgestormPattern,
} from '../src/sim/encounters/varkhul';
import { IGNIVAR_MOLTEN_ASSEMBLY_ID, IGNIVAR_SECOND_WING_ID } from '../src/sim/ignivar_raid_ids';
import { enterDungeon, leaveDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { revivePlayerAt } from '../src/sim/spirit';
import { DT, type Entity, type PlayerClass, type SimEvent } from '../src/sim/types';
import {
  VARKHUL_ANVIL_METEOR_CAST_ID,
  VARKHUL_ANVIL_METEOR_DAMAGE_MAX_HP,
  VARKHUL_ANVIL_METEOR_RADIUS,
} from '../src/sim/varkhul_anvil_meteors';
import { VARKHUL_WORK_LOCAL_POS } from '../src/sim/varkhul_forge_intermission';
import {
  VARKHUL_SHARED_PYRE_AURA_ID,
  VARKHUL_SHARED_PYRE_CAST_SECONDS,
  VARKHUL_SHARED_PYRE_NAME,
} from '../src/sim/varkhul_shared_pyre';

function claimedEncounter(seed = 42): { sim: Sim; boss: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', devCommands: true });
  expect(enterDungeon(sim.ctx, IGNIVAR_SECOND_WING_ID, sim.player.id, true)).toBe(true);
  const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
  if (!instance) throw new Error('Inner Crucible did not claim an instance');
  const bossIds = instance.mobIds.filter(
    (id) => sim.entities.get(id)?.templateId === VARKHUL_BOSS_ID,
  );
  expect(bossIds).toHaveLength(1);
  const boss = sim.entities.get(bossIds[0]);
  if (!boss) throw new Error('Inner Crucible did not spawn Varkhul');
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  boss.swingTimer = 999;
  sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + 2 };
  sim.player.prevPos = { ...sim.player.pos };
  return { sim, boss };
}

function addEncounterPlayer(
  sim: Sim,
  boss: Entity,
  name: string,
  cls: PlayerClass = 'priest',
): Entity {
  const pid = sim.addPlayer(cls, name);
  const player = sim.entities.get(sim.players.get(pid)?.entityId ?? -1);
  if (!player) throw new Error(`${name} did not spawn`);
  player.pos = { x: boss.pos.x + 2, y: boss.pos.y, z: boss.pos.z + 2 };
  player.prevPos = { ...player.pos };
  return player;
}

function isolateMechanics(boss: Entity): NonNullable<Entity['varkhul']> {
  if (!boss.varkhul) throw new Error('Varkhul state was not initialized');
  boss.varkhul.makersBrandTimer = 999;
  boss.varkhul.frontalTimer = 999;
  boss.varkhul.cinderOrbsTimer = 999;
  boss.varkhul.forgestormTimer = 999;
  boss.varkhul.sharedPyreTimer = 999;
  boss.varkhul.anvilTimer = 999;
  boss.varkhul.interceptBeamTimer = 999;
  // The walk-in staging is a mechanic too: it RUNS him to the arena center,
  // which shifts any geometry a test set up around his spawn. Complete it so
  // the mechanic under test sees a stationary boss.
  boss.varkhul.engage.phase = 'done';
  boss.swingTimer = Number.POSITIVE_INFINITY;
  return boss.varkhul;
}
function deterministicCinderOrbRun(seed: number) {
  const { sim, boss } = claimedEncounter(seed);
  const players = [
    sim.player,
    addEncounterPlayer(sim, boss, 'Determinism One'),
    addEncounterPlayer(sim, boss, 'Determinism Two'),
    addEncounterPlayer(sim, boss, 'Determinism Three'),
    addEncounterPlayer(sim, boss, 'Determinism Four'),
  ];
  updateVarkhulEncounter(sim.ctx, boss);
  const state = isolateMechanics(boss);
  state.cinderOrbsTimer = DT;
  updateVarkhulEncounter(sim.ctx, boss);
  const targetIds = [...state.cinderOrbsTargetIds];
  const offsets = [
    { x: -12, z: -12 },
    { x: 12, z: -12 },
    { x: 12, z: 12 },
  ];
  for (let index = 0; index < targetIds.length; index++) {
    const target = sim.entities.get(targetIds[index]);
    const offset = offsets[index];
    if (!target || !offset) throw new Error('Determinism target roster is incomplete');
    target.pos = sim.ctx.groundPos(boss.pos.x + offset.x, boss.pos.z + offset.z);
  }
  state.cinderOrbsMarkRemaining = DT;
  updateVarkhulEncounter(sim.ctx, boss);
  const fires = sim.activeVarkhulCinderFires.map((fire) => ({ ...fire }));
  const projectiles = sim.activeVarkhulCinderOrbProjectiles.map((projectile) => ({
    ...projectile,
  }));
  for (const player of players) player.pos = { ...boss.pos };
  for (let frame = 0; frame < VARKHUL_CINDER_ORB_DURATION / DT; frame++) {
    updateVarkhulEncounter(sim.ctx, boss);
  }
  const events = sim.events.flatMap((event) =>
    event.type === 'spellfxAt' && event.ability === VARKHUL_CINDER_ORBS_CAST_ID
      ? [
          {
            type: event.type,
            fx: event.fx,
            x: event.x,
            z: event.z,
            radius: event.radius,
          },
        ]
      : [],
  );
  return {
    targetIds,
    fires,
    projectiles,
    events,
    permanentFires: sim.activeVarkhulCinderFires,
    expiredProjectiles: sim.activeVarkhulCinderOrbProjectiles,
  };
}

describe('Varkhul encounter geometry and selection', () => {
  it('selects three non-tanks in a deterministic rotating order', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      dead: false,
    })) as Entity[];
    const tanks = new Set([1, 2]);

    expect(selectVarkhulCinderOrbTargets(players, tanks, 0).map((player) => player.id)).toEqual([
      3, 4, 5,
    ]);
    expect(selectVarkhulCinderOrbTargets(players, tanks, 2).map((player) => player.id)).toEqual([
      5, 6, 3,
    ]);
    expect(VARKHUL_CINDER_ORBS_TARGETS).toBe(3);
  });

  it('replays a full Cinder Orbs sequence identically for the same seed', () => {
    expect(deterministicCinderOrbRun(434)).toEqual(deterministicCinderOrbRun(434));
  });

  it('rotates a deterministic five-impact Forgestorm pattern per wave', () => {
    const origin = { x: 50, z: 75 };
    const first = varkhulForgestormPattern(3, 0, origin);
    const repeat = varkhulForgestormPattern(3, 0, origin);
    const next = varkhulForgestormPattern(3, 1, origin);

    expect(first).toEqual(repeat);
    expect(first).toHaveLength(VARKHUL_FORGESTORM_IMPACTS_PER_WAVE);
    expect(next).not.toEqual(first);
  });
});

describe('Varkhul encounter behavior', () => {
  it('spawns exactly once from the Inner Crucible roster and initializes through the mob tick', () => {
    const { sim, boss } = claimedEncounter(40);

    expect(boss.varkhul).toBeUndefined();
    sim.tick();

    expect(boss.varkhul).toBeDefined();
    expect(boss.inCombat).toBe(true);
    expect(
      sim.instances
        .find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID)
        ?.mobIds.filter((id) => sim.entities.get(id)?.templateId === VARKHUL_BOSS_ID),
    ).toEqual([boss.id]);
  });

  it('pins the player-facing Maker and Masterpiece tuning literally', () => {
    expect(VARKHUL_MAKERS_BRAND_EVERY).toBe(14);
    expect(VARKHUL_MAKERS_BRAND_DAMAGE_MAX_HP).toBe(0.3);
    expect(VARKHUL_MAKERS_BRAND_DURATION).toBe(30);
    expect(VARKHUL_MAKERS_BRAND_MAX_STACKS).toBe(3);
    expect(VARKHUL_MAKERS_BRAND_PER_STACK).toBe(0.35);
    expect(VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS).toBe(2);
    expect(VARKHUL_CINDER_ORBS_MARK_SECONDS).toBe(4);
    expect(VARKHUL_RED_HOT_METAL_DURATION).toBe(10);
    expect(VARKHUL_RED_HOT_METAL_TICK_SECONDS).toBe(2);
    expect(VARKHUL_RED_HOT_METAL_DAMAGE_MAX_HP).toBe(0.04);
    expect(VARKHUL_RED_HOT_METAL_HEAL_ABSORB_MAX_HP).toBe(0.3);
    expect(VARKHUL_CINDER_FIRE_RADIUS).toBe(3.5);
    expect(VARKHUL_CINDER_FIRE_TICK_SECONDS).toBe(1);
    expect(VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP).toBe(0.12);
    expect(VARKHUL_CINDER_ORB_PROJECTILES_PER_TARGET).toBe(6);
    expect(VARKHUL_CINDER_ORB_SPEED).toBe(9);
    expect(VARKHUL_CINDER_ORB_DURATION).toBe(5.5);
    expect(VARKHUL_CINDER_ORB_HIT_RADIUS).toBe(1.1);
    expect(VARKHUL_CINDER_ORB_DAMAGE_MAX_HP).toBe(0.35);
    expect(VARKHUL_FORGESTORM_WAVES).toBe(3);
    expect(VARKHUL_ANVILS_DECREE_STRIKES).toBe(3);
    expect(VARKHUL_MASTERS_ASSEMBLY_SECONDS).toBe(45);
    expect(VARKHUL_MASTERPIECE_UNBOUND_SPEED_MULTIPLIER).toBe(1.25);
    expect(VARKHUL_MASTERPIECE_UNBOUND_PULSE_SECONDS).toBe(3);
    expect(VARKHUL_MASTERPIECE_UNBOUND_PULSE_MAX_HP).toBe(0.05);
  });

  it('stacks source-gated Maker marks and moves the next mark after a taunt swap', () => {
    const { sim, boss } = claimedEncounter();
    boss.swingTimer = Number.POSITIVE_INFINITY;
    const offTank = addEncounterPlayer(sim, boss, 'Off Tank', 'paladin');
    const primaryMaxHp = sim.player.maxHp;
    const primaryBrandDamage = Math.ceil(primaryMaxHp * VARKHUL_MAKERS_BRAND_DAMAGE_MAX_HP);
    sim.player.hp = primaryMaxHp;
    offTank.hp = offTank.maxHp;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    sim.player.hp = primaryMaxHp;
    offTank.hp = offTank.maxHp;

    state.makersBrandTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    const brandFromBoss = () =>
      sim.player.auras.find(
        (aura) => aura.id === VARKHUL_MAKERS_BRAND_AURA_ID && aura.sourceId === boss.id,
      );
    let brand = brandFromBoss();
    expect(sim.player.hp).toBe(primaryMaxHp - primaryBrandDamage);
    expect(brand).toMatchObject({
      kind: 'vuln_source',
      sourceId: boss.id,
      stacks: 1,
      duration: VARKHUL_MAKERS_BRAND_DURATION,
      encounterOwned: true,
    });
    expect(brand?.value).toBeCloseTo(VARKHUL_MAKERS_BRAND_PER_STACK, 8);

    sim.player.hp = primaryMaxHp;
    state.makersBrandTimer = DT;
    boss.swingTimer = Number.POSITIVE_INFINITY;
    updateVarkhulEncounter(sim.ctx, boss);
    brand = brandFromBoss();
    expect(sim.player.hp).toBe(
      primaryMaxHp - Math.round(primaryBrandDamage * (1 + VARKHUL_MAKERS_BRAND_PER_STACK)),
    );
    expect(brand?.stacks).toBe(VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS);

    sim.player.auras.push({
      id: VARKHUL_MAKERS_BRAND_AURA_ID,
      name: 'Foreign Brand',
      kind: 'vuln_source',
      remaining: 99,
      duration: 99,
      value: 9,
      stacks: 9,
      sourceId: boss.id + 10_000,
      school: 'fire',
    });
    for (let cast = 0; cast < 2; cast++) {
      sim.player.hp = primaryMaxHp;
      state.makersBrandTimer = DT;
      updateVarkhulEncounter(sim.ctx, boss);
    }
    brand = brandFromBoss();
    expect(brand?.stacks).toBe(3);
    expect(brand?.value).toBeCloseTo(1.05, 8);
    expect(sim.player.auras.find((aura) => aura.sourceId === boss.id + 10_000)).toMatchObject({
      stacks: 9,
      value: 9,
      remaining: 99,
    });

    boss.aggroTargetId = offTank.id;
    boss.forcedTargetId = offTank.id;
    boss.forcedTargetTimer = 3;
    state.makersBrandTimer = DT;
    boss.swingTimer = Number.POSITIVE_INFINITY;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(offTank.auras.find((aura) => aura.id === VARKHUL_MAKERS_BRAND_AURA_ID)?.stacks).toBe(1);
    expect(brand?.stacks).toBe(VARKHUL_MAKERS_BRAND_MAX_STACKS);
  });

  it('marks three non-tanks, keeps fire at their spread positions, and emits radial orbs', () => {
    const { sim, boss } = claimedEncounter(43);
    const players = [
      sim.player,
      addEncounterPlayer(sim, boss, 'Cinder One'),
      addEncounterPlayer(sim, boss, 'Cinder Two'),
      addEncounterPlayer(sim, boss, 'Cinder Three'),
      addEncounterPlayer(sim, boss, 'Cinder Four'),
    ];
    for (const player of players) {
      player.maxHp = 1_000;
      player.hp = 1_000;
    }
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.cinderOrbsTimer = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    const marked = players.filter((player) =>
      player.auras.some((aura) => aura.id === VARKHUL_CINDER_ORBS_AURA_ID),
    );
    expect(marked).toHaveLength(3);
    expect(marked).not.toContain(sim.player);
    expect(boss.castingAbility).toBe(VARKHUL_CINDER_ORBS_CAST_ID);
    expect(state.cinderOrbsMarkRemaining).toBe(VARKHUL_CINDER_ORBS_MARK_SECONDS);
    for (const player of marked) {
      const mark = player.auras.find((aura) => aura.id === VARKHUL_CINDER_ORBS_AURA_ID);
      const metal = player.auras.find((aura) => aura.id === VARKHUL_RED_HOT_METAL_AURA_ID);
      const barrier = player.auras.find((aura) => aura.id === VARKHUL_RED_HOT_METAL_ABSORB_AURA_ID);
      expect(mark).toMatchObject({
        remaining: 4,
        duration: 4,
        encounterOwned: true,
      });
      expect(metal).toMatchObject({
        kind: 'dot',
        value: Math.ceil(player.maxHp * VARKHUL_RED_HOT_METAL_DAMAGE_MAX_HP),
        tickInterval: 2,
        duration: 10,
        encounterOwned: true,
      });
      expect(barrier).toMatchObject({
        kind: 'heal_absorb',
        value: Math.ceil(player.maxHp * VARKHUL_RED_HOT_METAL_HEAL_ABSORB_MAX_HP),
        duration: 10,
        encounterOwned: true,
      });
      expect(mark && isPlayerRemovableAura(mark)).toBe(false);
      expect(metal && isPlayerRemovableAura(metal)).toBe(false);
      expect(barrier && isPlayerRemovableAura(barrier)).toBe(false);
    }

    const firstMarked = marked[0];
    const healer = marked[1];
    const dot = firstMarked.auras.find((aura) => aura.id === VARKHUL_RED_HOT_METAL_AURA_ID);
    const absorb = firstMarked.auras.find(
      (aura) => aura.id === VARKHUL_RED_HOT_METAL_ABSORB_AURA_ID,
    );
    if (!dot || !absorb || !healer) throw new Error('Cinder Orbs test roster is incomplete');
    firstMarked.hp = firstMarked.maxHp;
    dot.tickTimer = DT;
    sim.tick();
    expect(firstMarked.hp).toBe(firstMarked.maxHp - dot.value);
    firstMarked.maxHp = 1_000;
    firstMarked.hp = 500;
    const firstHeal = Math.max(1, Math.floor(absorb.value / 2));
    const remainingAbsorb = absorb.value - firstHeal;
    const hpBehindBarrier = firstMarked.hp;
    sim.ctx.applyHeal(healer, firstMarked, firstHeal, 'Test Heal', null, false);
    expect(firstMarked.hp).toBe(hpBehindBarrier);
    expect(
      firstMarked.auras.find((aura) => aura.id === VARKHUL_RED_HOT_METAL_ABSORB_AURA_ID)?.value,
    ).toBe(remainingAbsorb);
    sim.ctx.applyHeal(healer, firstMarked, remainingAbsorb + 20, 'Test Heal', null, false);
    expect(firstMarked.hp).toBe(hpBehindBarrier + 20);
    expect(firstMarked.auras.some((aura) => aura.id === VARKHUL_RED_HOT_METAL_ABSORB_AURA_ID)).toBe(
      false,
    );
    expect(firstMarked.auras.some((aura) => aura.id === VARKHUL_RED_HOT_METAL_AURA_ID)).toBe(true);

    marked[0].pos = { x: boss.pos.x - 20, y: boss.pos.y, z: boss.pos.z - 20 };
    marked[1].pos = { x: boss.pos.x + 20, y: boss.pos.y, z: boss.pos.z - 20 };
    marked[2].pos = { x: boss.pos.x + 20, y: boss.pos.y, z: boss.pos.z + 20 };
    state.cinderOrbsMarkRemaining = DT * 2;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(sim.activeVarkhulCinderFires).toHaveLength(0);
    expect(sim.activeVarkhulCinderOrbProjectiles).toHaveLength(0);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(sim.activeVarkhulCinderFires).toHaveLength(3);
    expect(sim.activeVarkhulCinderOrbProjectiles).toHaveLength(18);
    expect(state.majorAbility).toBe('none');
    expect(state.cinderFires).toHaveLength(3);
    expect(state.cinderOrbProjectiles).toHaveLength(18);
    expect(
      marked.every(
        (player) => !player.auras.some((aura) => aura.id === VARKHUL_CINDER_ORBS_AURA_ID),
      ),
    ).toBe(true);
    expect(state.cinderFires.map((fire) => fire.pos)).toEqual(marked.map((player) => player.pos));
    for (let targetIndex = 0; targetIndex < marked.length; targetIndex++) {
      const fan = state.cinderOrbProjectiles.slice(
        targetIndex * VARKHUL_CINDER_ORB_PROJECTILES_PER_TARGET,
        (targetIndex + 1) * VARKHUL_CINDER_ORB_PROJECTILES_PER_TARGET,
      );
      expect(fan).toHaveLength(6);
      expect(fan.every((projectile) => projectile.ownerId === marked[targetIndex].id)).toBe(true);
      expect(fan.every((projectile) => projectile.pos.x === marked[targetIndex].pos.x)).toBe(true);
      expect(fan.every((projectile) => projectile.pos.z === marked[targetIndex].pos.z)).toBe(true);
      for (const projectile of fan) {
        expect(Math.hypot(projectile.dir.x, projectile.dir.z)).toBeCloseTo(1, 6);
      }
    }

    const fire = state.cinderFires[0];
    if (!fire) throw new Error('Cinder fire did not spawn');
    state.cinderOrbProjectiles = [];
    sim.player.pos = { ...fire.pos };
    sim.player.hp = 1_000;
    fire.tickTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(sim.player.hp).toBe(
      1_000 - Math.ceil(sim.player.maxHp * VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP),
    );
  });

  it('keeps the ground fire permanently and continues ticking after twelve seconds', () => {
    const { sim, boss } = claimedEncounter(431);
    sim.player.devGod = true;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.cinderFires.push({
      id: `${boss.id}:cinder-fire:persistent`,
      pos: { ...sim.player.pos },
      tickTimer: 1,
    });

    for (let frame = 0; frame < 12 / DT; frame++) {
      updateVarkhulEncounter(sim.ctx, boss);
    }

    expect(state.cinderFires).toHaveLength(1);
    sim.player.devGod = false;
    sim.player.maxHp = 1_000;
    sim.player.hp = 1_000;
    state.cinderFires[0].tickTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(sim.player.hp).toBe(
      1_000 - Math.ceil(sim.player.maxHp * VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP),
    );
  });

  it('damages the exact cinder fire edge but spares dead and outside players', () => {
    const { sim, boss } = claimedEncounter(433);
    const onEdge = addEncounterPlayer(sim, boss, 'Cinder Edge');
    const outside = addEncounterPlayer(sim, boss, 'Cinder Outside');
    const deadInside = addEncounterPlayer(sim, boss, 'Cinder Fallen');
    for (const player of [onEdge, outside, deadInside]) {
      player.maxHp = 1_000;
      player.hp = 1_000;
    }
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    const origin = { ...sim.player.pos };
    onEdge.pos = { ...origin, x: origin.x + VARKHUL_CINDER_FIRE_RADIUS };
    outside.pos = { ...origin, x: origin.x + VARKHUL_CINDER_FIRE_RADIUS + 0.001 };
    deadInside.pos = { ...origin };
    deadInside.dead = true;
    state.cinderFires.push({
      id: `${boss.id}:cinder-fire:boundary`,
      pos: origin,
      tickTimer: DT,
    });

    updateVarkhulEncounter(sim.ctx, boss);

    expect(onEdge.hp).toBe(1_000 - Math.ceil(1_000 * VARKHUL_CINDER_FIRE_DAMAGE_MAX_HP));
    expect(outside.hp).toBe(1_000);
    expect(deadInside.hp).toBe(1_000);
  });

  it('moves each orb across the room and damages each player at most once', () => {
    const { sim, boss } = claimedEncounter(435);
    const target = addEncounterPlayer(sim, boss, 'Orb Dodger');
    sim.player.pos = { ...boss.pos, x: boss.pos.x - 20 };
    target.maxHp = 1_000;
    target.hp = 1_000;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.cinderOrbProjectiles.push({
      id: `${boss.id}:cinder-orbs:collision:0`,
      ownerId: sim.player.id,
      pos: { ...target.pos, x: target.pos.x - VARKHUL_CINDER_ORB_SPEED * DT },
      dir: { x: 1, z: 0 },
      remaining: VARKHUL_CINDER_ORB_DURATION,
      hitPlayerIds: [sim.player.id],
    });

    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.cinderOrbProjectiles[0]?.pos.x).toBeCloseTo(target.pos.x, 6);
    const hpAfterHit = 1_000 - Math.ceil(1_000 * VARKHUL_CINDER_ORB_DAMAGE_MAX_HP);
    expect(target.hp).toBe(hpAfterHit);
    expect(state.cinderOrbProjectiles[0]?.hitPlayerIds).toContain(target.id);

    updateVarkhulEncounter(sim.ctx, boss);
    expect(target.hp).toBe(hpAfterHit);
  });

  it('routes Heroic cinder fire and orb damage through the live encounter path', () => {
    const { sim, boss } = claimedEncounter(437);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('Inner Crucible instance disappeared');
    instance.difficulty = 'heroic';
    sim.player.maxHp = 1_000;
    sim.player.hp = 1_000;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.cinderFires.push({
      id: `${boss.id}:cinder-fire:heroic`,
      pos: { ...sim.player.pos },
      tickTimer: DT,
    });

    updateVarkhulEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(750);
    state.cinderFires.length = 0;
    sim.player.hp = 1_000;
    state.cinderOrbProjectiles.push({
      id: `${boss.id}:cinder-orbs:heroic`,
      ownerId: boss.id,
      pos: { ...sim.player.pos, x: sim.player.pos.x - VARKHUL_CINDER_ORB_SPEED * DT },
      dir: { x: 1, z: 0 },
      remaining: VARKHUL_CINDER_ORB_DURATION,
      hitPlayerIds: [],
    });

    updateVarkhulEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(450);
  });

  it('waits instead of channeling Cinder Orbs when the tank is alone', () => {
    const { sim, boss } = claimedEncounter(436);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.cinderOrbsTimer = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.majorAbility).toBe('none');
    expect(state.cinderOrbsTargetIds).toEqual([]);
    expect(state.cinderOrbsTimer).toBe(2);
    expect(boss.castingAbility).toBeNull();
  });

  it('does not release fire or projectiles for a marked player who dies during the spread', () => {
    const { sim, boss } = claimedEncounter(434);
    const players = [
      sim.player,
      addEncounterPlayer(sim, boss, 'Cinder Living One'),
      addEncounterPlayer(sim, boss, 'Cinder Living Two'),
      addEncounterPlayer(sim, boss, 'Cinder Doomed'),
      addEncounterPlayer(sim, boss, 'Cinder Reserve'),
    ];
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.cinderOrbsTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    const marked = players.filter((player) => state.cinderOrbsTargetIds.includes(player.id));
    expect(marked).toHaveLength(3);
    const doomed = marked[1];
    doomed.dead = true;
    const survivingPositions = marked
      .filter((player) => player !== doomed)
      .map((_player, index) => ({
        x: boss.pos.x + 12 + index * 6,
        y: boss.pos.y,
        z: boss.pos.z + 9,
      }));
    for (let index = 0; index < survivingPositions.length; index++) {
      const survivor = marked.filter((player) => player !== doomed)[index];
      survivor.pos = survivingPositions[index];
    }
    state.cinderOrbsMarkRemaining = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.cinderFires).toHaveLength(2);
    expect(state.cinderFires.map((fire) => fire.pos)).toEqual(survivingPositions);
    expect(state.cinderOrbProjectiles).toHaveLength(12);
  });

  it('does not project cinder hazards from a dead Varkhul', () => {
    const { sim, boss } = claimedEncounter(432);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.cinderFires.push({
      id: `${boss.id}:cinder-fire:dead`,
      pos: { ...sim.player.pos },
      tickTimer: 0.5,
    });
    state.cinderOrbProjectiles.push({
      id: `${boss.id}:cinder-orbs:dead:0`,
      ownerId: boss.id,
      pos: { ...sim.player.pos },
      dir: { x: 1, z: 0 },
      remaining: 5,
      hitPlayerIds: [],
    });
    expect(sim.activeVarkhulCinderFires).toHaveLength(1);
    expect(sim.activeVarkhulCinderOrbProjectiles).toHaveLength(1);

    boss.dead = true;

    expect(sim.activeVarkhulCinderFires).toEqual([]);
    expect(sim.activeVarkhulCinderOrbProjectiles).toEqual([]);
  });

  it('publishes five GroundAoE warnings before each Forgestorm impact', () => {
    const { sim, boss } = claimedEncounter(44);
    sim.player.maxHp = 1_000;
    sim.player.hp = 1_000;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.forgestormTimer = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.majorAbility).toBe('forgestorm');
    expect(boss.castingAbility).toBeNull();
    expect(boss.castTotal).toBe(0);
    expect(boss.castRemaining).toBe(0);
    expect(boss.channeling).toBe(false);
    const warnings = sim.ctx.groundAoEs.filter(
      (effect) => effect.sourceId === boss.id && effect.abilityId === VARKHUL_FORGESTORM_CAST_ID,
    );
    expect(warnings).toHaveLength(VARKHUL_FORGESTORM_IMPACTS_PER_WAVE);
    expect(sim.activeVarkhulForgestormWarnings).toHaveLength(VARKHUL_FORGESTORM_IMPACTS_PER_WAVE);
    expect(sim.activeVarkhulForgestormWarnings[0]).toMatchObject({
      sourceId: boss.id,
      radius: 4,
      duration: VARKHUL_FORGESTORM_WARNING_SECONDS,
      remaining: VARKHUL_FORGESTORM_WARNING_SECONDS,
    });
    const firstWaveWarningIds = sim.activeVarkhulForgestormWarnings.map((warning) => warning.id);
    expect(warnings[0].remaining).toBeCloseTo(VARKHUL_FORGESTORM_WARNING_SECONDS + DT * 2, 5);
    sim.player.pos = { ...state.forgestormPoints[0] };
    state.forgestormWarningRemaining = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(1_000 - 1_000 * VARKHUL_FORGESTORM_DAMAGE_MAX_HP);
    expect(
      sim.events
        .filter(
          (event): event is Extract<SimEvent, { type: 'spellfxAt' }> => event.type === 'spellfxAt',
        )
        .filter(
          (event) => event.ability === VARKHUL_FORGESTORM_CAST_ID && event.fx === 'meteorImpact',
        )
        .map((event) => event.persistentId),
    ).toEqual(firstWaveWarningIds);
    expect(state.forgestormWaveIndex).toBe(1);
    expect(boss.castingAbility).toBeNull();
    expect(
      sim.ctx.groundAoEs.filter(
        (effect) => effect.sourceId === boss.id && effect.abilityId === VARKHUL_FORGESTORM_CAST_ID,
      ),
    ).toHaveLength(VARKHUL_FORGESTORM_IMPACTS_PER_WAVE);

    sim.player.pos = { ...boss.pos };
    state.forgestormWarningRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgestormWaveIndex).toBe(2);
    expect(
      sim.ctx.groundAoEs.filter(
        (effect) => effect.sourceId === boss.id && effect.abilityId === VARKHUL_FORGESTORM_CAST_ID,
      ),
    ).toHaveLength(VARKHUL_FORGESTORM_IMPACTS_PER_WAVE);

    state.forgestormWarningRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.majorAbility).toBe('none');
    expect(boss.castingAbility).toBeNull();
    expect(
      sim.ctx.groundAoEs.filter(
        (effect) => effect.sourceId === boss.id && effect.abilityId === VARKHUL_FORGESTORM_CAST_ID,
      ),
    ).toHaveLength(0);
  });

  it('applies the Heroic Forgestorm damage through the live encounter path', () => {
    const { sim, boss } = claimedEncounter(4401);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('Inner Crucible instance disappeared');
    instance.difficulty = 'heroic';
    sim.player.maxHp = 1_000;
    sim.player.hp = 1_000;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.forgestormTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    sim.player.pos = { ...state.forgestormPoints[0] };
    state.forgestormWarningRemaining = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(200);
  });

  it('cues the PowerUp windup one-shot at the start of every Forgestorm wave', () => {
    const { sim, boss } = claimedEncounter(44);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    const stormWindups = () =>
      sim.events.filter(
        (event) =>
          event.type === 'spellfx' &&
          event.fx === 'windup' &&
          event.ability === VARKHUL_FORGESTORM_CAST_ID,
      );

    state.forgestormTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.majorAbility).toBe('forgestorm');
    expect(stormWindups()).toHaveLength(1);
    expect(stormWindups()[0]).toMatchObject({ sourceId: boss.id, targetId: boss.id });

    // every later wave re-cues the pump; the resolve tick itself adds none
    state.forgestormWarningRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgestormWaveIndex).toBe(1);
    expect(stormWindups()).toHaveLength(2);
    state.forgestormWarningRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.forgestormWaveIndex).toBe(2);
    expect(stormWindups()).toHaveLength(3);
    state.forgestormWarningRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.majorAbility).toBe('none');
    expect(stormWindups()).toHaveLength(3);
  });

  it('casts Shared Pyre on a non-tank while preserving Forgestorm as a separate major', () => {
    const { sim, boss } = claimedEncounter(441);
    const raiders = [
      addEncounterPlayer(sim, boss, 'Pyre One'),
      addEncounterPlayer(sim, boss, 'Pyre Two'),
      addEncounterPlayer(sim, boss, 'Pyre Three'),
    ];
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.sharedPyreTimer = DT;
    state.forgestormTimer = 7;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.majorAbility).toBe('sharedPyre');
    expect(state.forgestormTimer).toBeCloseTo(7 - DT, 8);
    const target =
      state.sharedPyreTargetId === null ? undefined : sim.entities.get(state.sharedPyreTargetId);
    if (!target) throw new Error('Shared Pyre did not select a target');
    expect(raiders.map((player) => player.id)).toContain(target.id);
    expect(target.auras).toContainEqual(
      expect.objectContaining({
        id: VARKHUL_SHARED_PYRE_AURA_ID,
        name: VARKHUL_SHARED_PYRE_NAME,
        remaining: VARKHUL_SHARED_PYRE_CAST_SECONDS,
        stacks: 4,
        sourceId: boss.id,
      }),
    );
    for (const player of [sim.player, ...raiders]) {
      player.maxHp = 100_000;
      player.hp = 100_000;
      player.damageImmune = false;
      player.pos = { ...target.pos };
    }
    state.sharedPyreRemaining = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    for (const player of [sim.player, ...raiders]) expect(player.hp).toBe(65_000);
    expect(state.majorAbility).toBe('none');
    expect(state.sharedPyreTargetId).toBeNull();
    expect(target.auras.some((aura) => aura.id === VARKHUL_SHARED_PYRE_AURA_ID)).toBe(false);
  });

  it.each([
    { difficulty: 'normal' as const, splitDamage: 1.4 / 3 },
    { difficulty: 'heroic' as const, splitDamage: 2 / 3 },
  ])(
    'damages the whole raid for each missing $difficulty Shared Pyre soaker',
    ({ difficulty, splitDamage }) => {
      const { sim, boss } = claimedEncounter(difficulty === 'normal' ? 447 : 448);
      const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
      if (!instance) throw new Error('Inner Crucible instance disappeared');
      instance.difficulty = difficulty;
      const raiders = [
        addEncounterPlayer(sim, boss, 'Pyre Penalty One'),
        addEncounterPlayer(sim, boss, 'Pyre Penalty Two'),
        addEncounterPlayer(sim, boss, 'Pyre Penalty Three'),
        addEncounterPlayer(sim, boss, 'Pyre Penalty Four'),
      ];
      updateVarkhulEncounter(sim.ctx, boss);
      const state = isolateMechanics(boss);
      state.sharedPyreTimer = DT;
      updateVarkhulEncounter(sim.ctx, boss);

      const target =
        state.sharedPyreTargetId === null ? undefined : sim.entities.get(state.sharedPyreTargetId);
      if (!target) throw new Error('Shared Pyre did not select a target');
      const players = [sim.player, ...raiders];
      const others = players.filter((player) => player.id !== target.id);
      const soakers = [target, ...others.slice(0, 2)];
      const outsiders = others.slice(2);
      for (const player of players) {
        player.maxHp = 100_000;
        player.hp = 100_000;
        player.damageImmune = false;
      }
      for (const soaker of soakers) {
        soaker.pos = { ...target.pos };
        soaker.prevPos = { ...soaker.pos };
      }
      for (const outsider of outsiders) {
        outsider.pos = { ...target.pos, x: target.pos.x + 10 };
        outsider.prevPos = { ...outsider.pos };
      }
      const aura = target.auras.find((entry) => entry.id === VARKHUL_SHARED_PYRE_AURA_ID);
      expect(aura).toMatchObject({
        stacks: 4,
        value: 0,
        value2: difficulty === 'heroic' ? 2 : 1.4,
      });
      state.sharedPyreRemaining = DT;

      updateVarkhulEncounter(sim.ctx, boss);

      const raidPenalty = 15_000;
      const expectedSoakerHp = 100_000 - Math.ceil(100_000 * splitDamage) - raidPenalty;
      for (const soaker of soakers) expect(soaker.hp).toBe(expectedSoakerHp);
      for (const outsider of outsiders) expect(outsider.hp).toBe(100_000 - raidPenalty);
    },
  );

  it('cancels Shared Pyre without raid damage when its marked player dies', () => {
    const { sim, boss } = claimedEncounter(442);
    const raiders = [
      addEncounterPlayer(sim, boss, 'Fallen Pyre'),
      addEncounterPlayer(sim, boss, 'Living Pyre One'),
      addEncounterPlayer(sim, boss, 'Living Pyre Two'),
    ];
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.sharedPyreTimer = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    const target =
      state.sharedPyreTargetId === null ? undefined : sim.entities.get(state.sharedPyreTargetId);
    if (!target) throw new Error('Shared Pyre did not select a target');
    const survivors = [sim.player, ...raiders].filter((player) => player.id !== target.id);
    for (const player of [target, ...survivors]) {
      player.maxHp = 100_000;
      player.hp = 100_000;
      player.damageImmune = false;
      player.pos = { ...target.pos };
    }
    target.dead = true;
    target.hp = 0;
    sim.events.length = 0;

    updateVarkhulEncounter(sim.ctx, boss);

    for (const survivor of survivors) expect(survivor.hp).toBe(100_000);
    expect(
      sim.events.some(
        (event) =>
          event.type === 'spellfx' &&
          event.ability === VARKHUL_SHARED_PYRE_NAME &&
          event.fx === 'nova',
      ),
    ).toBe(false);
    expect(state.majorAbility).toBe('none');
    expect(state.sharedPyreTargetId).toBeNull();
    expect(boss.castingAbility).toBeNull();
    expect(target.auras.some((aura) => aura.id === VARKHUL_SHARED_PYRE_AURA_ID)).toBe(false);
  });

  it('cancels Shared Pyre immediately when its marked player leaves the world', () => {
    const { sim, boss } = claimedEncounter(446);
    const raiders = [
      addEncounterPlayer(sim, boss, 'Departing Pyre'),
      addEncounterPlayer(sim, boss, 'Remaining Pyre'),
    ];
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.sharedPyreTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);

    const targetId = state.sharedPyreTargetId;
    if (targetId === null) throw new Error('Shared Pyre did not select a target');
    const remainingBeforeLeave = state.sharedPyreRemaining;
    expect(remainingBeforeLeave).toBeGreaterThan(DT);
    sim.entities.delete(targetId);
    sim.events.length = 0;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.majorAbility).toBe('none');
    expect(state.sharedPyreTargetId).toBeNull();
    expect(state.sharedPyreRemaining).toBe(0);
    expect(boss.castingAbility).toBeNull();
    expect(
      sim.events.some(
        (event) => event.type === 'spellfx' && event.ability === VARKHUL_SHARED_PYRE_NAME,
      ),
    ).toBe(false);
    expect(raiders.some((player) => sim.entities.has(player.id))).toBe(true);
  });

  it('clears raid mechanics through a real death and corpse resurrection', () => {
    const { sim, boss } = claimedEncounter(443);
    addEncounterPlayer(sim, boss, 'Living Witness');
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    const encounterAuraIds = [
      VARKHUL_MAKERS_BRAND_AURA_ID,
      VARKHUL_RED_HOT_METAL_AURA_ID,
      VARKHUL_SHARED_PYRE_AURA_ID,
      VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID,
    ];
    sim.ctx.applyAura(sim.player, {
      id: VARKHUL_MAKERS_BRAND_AURA_ID,
      name: "Maker's Brand",
      kind: 'vuln_source',
      remaining: 30,
      duration: 30,
      value: 0.35,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    sim.ctx.applyAura(sim.player, {
      id: VARKHUL_RED_HOT_METAL_AURA_ID,
      name: 'Red-hot Metal',
      kind: 'dot',
      remaining: 10,
      duration: 10,
      value: 1,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    sim.ctx.applyAura(sim.player, {
      id: VARKHUL_SHARED_PYRE_AURA_ID,
      name: VARKHUL_SHARED_PYRE_NAME,
      kind: 'vulnerability',
      remaining: 6,
      duration: 6,
      value: 0,
      stacks: 4,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    sim.ctx.applyAura(sim.player, {
      id: VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID,
      name: VARKHUL_INTERCEPT_BEAM_DEBUFF_NAME,
      kind: 'vuln_source',
      remaining: 25,
      duration: 25,
      value: VARKHUL_INTERCEPT_BEAM_DEBUFF_DAMAGE_TAKEN,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });

    sim.ctx.dealDamage(
      boss,
      sim.player,
      sim.player.maxHp * 100,
      false,
      'fire',
      'Raid Test Kill',
      'hit',
      true,
    );

    expect(sim.player.dead).toBe(true);
    expect(sim.player.auras.some((aura) => encounterAuraIds.includes(aura.id))).toBe(false);
    expect(boss.varkhul).toBe(state);

    sim.releaseSpirit(sim.player.id);
    const corpse = sim.player.corpsePos;
    if (!corpse) throw new Error('Raid death did not leave a corpse');
    sim.player.pos = { ...corpse };
    sim.player.prevPos = { ...corpse };
    sim.rebucket(sim.player);
    sim.resurrectAtCorpse(sim.player.id);
    updateVarkhulEncounter(sim.ctx, boss);

    expect(sim.player.dead).toBe(false);
    expect(sim.player.ghost).toBe(false);
    expect(sim.player.hp).toBe(Math.round(sim.player.maxHp * 0.5));
    expect(sim.player.auras.some((aura) => encounterAuraIds.includes(aura.id))).toBe(false);
    expect(boss.varkhul).toBe(state);
  });

  it('resets a real all-dead wipe and starts the next pull without stale hazards', () => {
    const { sim, boss } = claimedEncounter(444);
    const raider = addEncounterPlayer(sim, boss, 'Wipe Witness');
    updateVarkhulEncounter(sim.ctx, boss);
    const firstState = isolateMechanics(boss);
    firstState.forgestormTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(sim.ctx.groundAoEs.some((effect) => effect.sourceId === boss.id)).toBe(true);

    sim.ctx.handleDeath(sim.player, boss);
    sim.ctx.handleDeath(raider, boss);
    updateVarkhulEncounter(sim.ctx, boss);

    expect(boss.varkhul).toBeUndefined();
    expect(boss.castingAbility).toBeNull();
    expect(sim.ctx.groundAoEs.some((effect) => effect.sourceId === boss.id)).toBe(false);

    revivePlayerAt(sim.ctx, sim.player.id, { ...boss.pos });
    revivePlayerAt(sim.ctx, raider.id, { ...boss.pos });
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = sim.player.id;
    boss.swingTimer = 999;
    updateVarkhulEncounter(sim.ctx, boss);

    expect(boss.varkhul).toBeDefined();
    expect(boss.varkhul).not.toBe(firstState);
    expect(boss.varkhul?.majorAbility).toBe('none');
    expect(boss.varkhul?.forgestormWaveIndex).toBe(0);
    expect(boss.varkhul?.sharedPyreTargetId).toBeNull();
    expect(sim.ctx.groundAoEs.some((effect) => effect.sourceId === boss.id)).toBe(false);
  });

  it.each([
    ['normal', [900, 800, 600]],
    ['heroic', [860, 720, 470]],
  ] as const)('scales the three Anvil raid hits on %s', (difficulty, expectedHp) => {
    const { sim, boss } = claimedEncounter(difficulty === 'normal' ? 451 : 452);
    const raider = addEncounterPlayer(sim, boss, `${difficulty} Anvil Raider`);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('Inner Crucible instance disappeared');
    instance.difficulty = difficulty;
    for (const player of [sim.player, raider]) {
      player.maxHp = 1_000;
      player.hp = 1_000;
      player.pos = { ...boss.pos };
    }
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.anvilTimer = DT;
    const origin = sim.ctx.instanceOriginOf(instance);
    const work = sim.ctx.groundPos(
      origin.x + VARKHUL_WORK_LOCAL_POS.x,
      origin.z + VARKHUL_WORK_LOCAL_POS.z,
    );
    boss.pos = sim.ctx.groundPos(work.x - 12, work.z - 9);
    boss.prevPos = { ...boss.pos };
    const distanceBefore = Math.hypot(boss.pos.x - work.x, boss.pos.z - work.z);
    updateVarkhulEncounter(sim.ctx, boss);

    const distanceAfterStart = Math.hypot(boss.pos.x - work.x, boss.pos.z - work.z);
    expect(state.majorAbility).toBe('anvil');
    expect(boss.castingAbility).toBeNull();
    expect(distanceAfterStart).toBeLessThan(distanceBefore);
    expect(distanceAfterStart).toBeGreaterThan(0);

    let walkTicks = 0;
    while (boss.castingAbility !== VARKHUL_ANVILS_DECREE_CAST_ID && walkTicks++ < 400) {
      updateVarkhulEncounter(sim.ctx, boss);
    }
    expect(walkTicks).toBeLessThan(400);
    expect(boss.castingAbility).toBe(VARKHUL_ANVILS_DECREE_CAST_ID);
    expect(Math.hypot(boss.pos.x - work.x, boss.pos.z - work.z)).toBeLessThan(0.1);
    sim.player.pos = { ...boss.pos };
    raider.pos = { ...boss.pos, z: boss.pos.z + 8 };

    for (let strike = 0; strike < expectedHp.length; strike++) {
      state.anvilStrikeRemaining = DT;
      updateVarkhulEncounter(sim.ctx, boss);
      expect(sim.player.hp).toBe(expectedHp[strike]);
      expect(raider.hp).toBe(expectedHp[strike]);
      const impacts = sim.events.filter(
        (event) => event.type === 'spellfxAt' && event.ability === VARKHUL_ANVILS_DECREE_CAST_ID,
      );
      expect(impacts).toHaveLength(strike + 1);
      expect(impacts[strike]).toMatchObject({
        x: origin.x + VARKHUL_FORGE_LOCAL_POS.x,
        z: origin.z + VARKHUL_FORGE_LOCAL_POS.z,
        school: 'fire',
        fx: 'nova',
        sourceId: boss.id,
      });
      expect('radius' in impacts[strike]).toBe(false);
      expect(
        sim.ctx.groundAoEs.filter((effect) => effect.abilityId === VARKHUL_ANVILS_DECREE_CAST_ID),
      ).toEqual([]);
    }
    expect(state.anvilStrikeIndex).toBe(3);
    expect(state.majorAbility).toBe('none');
    expect(boss.castingAbility).toBeNull();
  });

  it.each([
    ['normal', VARKHUL_FRONTAL_DAMAGE_MAX_HP_NORMAL],
    ['heroic', VARKHUL_FRONTAL_DAMAGE_MAX_HP_HEROIC],
  ] as const)(
    'locks the 120-degree frontal facing and deals %s damage only inside it',
    (difficulty, damage) => {
      const { sim, boss } = claimedEncounter(difficulty === 'normal' ? 453 : 454);
      const bait = addEncounterPlayer(sim, boss, `${difficulty} Frontal Bait`);
      const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
      if (!instance) throw new Error('Inner Crucible instance disappeared');
      instance.difficulty = difficulty;
      for (const player of [sim.player, bait]) {
        player.maxHp = 1_000;
        player.hp = 1_000;
      }
      updateVarkhulEncounter(sim.ctx, boss);
      const state = isolateMechanics(boss);
      // placed AFTER the staging is neutralized: the engage run on the first
      // update moves the boss, and the facing pin needs exact geometry
      bait.pos = sim.ctx.groundPos(boss.pos.x + 12, boss.pos.z);
      state.frontalTimer = DT;
      updateVarkhulEncounter(sim.ctx, boss);

      expect(boss.castingAbility).toBe(VARKHUL_FRONTAL_CAST_ID);
      expect(state.frontalFacing).toBeCloseTo(Math.PI / 2, 5);
      sim.player.pos = sim.ctx.groundPos(boss.pos.x + 10, boss.pos.z);
      bait.pos = sim.ctx.groundPos(boss.pos.x, boss.pos.z + 10);
      state.frontalCastRemaining = DT;
      updateVarkhulEncounter(sim.ctx, boss);

      expect(sim.player.hp).toBe(1_000 - 1_000 * damage);
      expect(bait.hp).toBe(1_000);
      expect(boss.castingAbility).toBeNull();
    },
  );

  it('stands his ground through the Slam recovery after the frontal, then runs', () => {
    const { sim, boss } = claimedEncounter(456);
    updateVarkhulEncounter(sim.ctx, boss, true);
    const state = isolateMechanics(boss);
    // park the target far, so any chase movement is unmistakable
    sim.player.pos = sim.ctx.groundPos(boss.pos.x, boss.pos.z - 30);
    state.frontalTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss, true);
    expect(boss.castingAbility).toBe(VARKHUL_FRONTAL_CAST_ID);
    state.frontalTimer = 999;
    const castTicks = Math.ceil(VARKHUL_FRONTAL_CAST_SECONDS / DT) + 1;
    for (let tick = 0; tick < castTicks && boss.castingAbility; tick++) {
      updateVarkhulEncounter(sim.ctx, boss, true);
    }
    expect(boss.castingAbility).toBeNull();
    expect(state.frontalRecoverRemaining).toBeCloseTo(VARKHUL_FRONTAL_RECOVER_SECONDS, 5);

    // the recovery window: no chase slide under the stand-back-up animation
    const held = { ...boss.pos };
    const recoverTicks = Math.round(VARKHUL_FRONTAL_RECOVER_SECONDS / DT);
    for (let tick = 0; tick < recoverTicks - 1; tick++) {
      updateVarkhulEncounter(sim.ctx, boss, true);
    }
    expect(boss.pos).toEqual(held);
    expect(state.frontalRecoverRemaining).toBeGreaterThan(0);

    // and only once it lapses does he run at the target again
    for (let tick = 0; tick < 4; tick++) updateVarkhulEncounter(sim.ctx, boss, true);
    expect(Math.hypot(boss.pos.x - held.x, boss.pos.z - held.z)).toBeGreaterThan(0.3);
  });

  it('schedules three dodgeable Heroic meteors after a hammer impact', () => {
    const { sim, boss } = claimedEncounter(455);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('Inner Crucible instance disappeared');
    instance.difficulty = 'heroic';
    sim.player.maxHp = 1_000;
    sim.player.hp = 1_000;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.anvilTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    state.anvilStrikeRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);

    expect(sim.activeVarkhulAnvilMeteors).toHaveLength(3);
    expect(
      sim.activeVarkhulAnvilMeteors.every(
        (warning) => warning.radius === VARKHUL_ANVIL_METEOR_RADIUS,
      ),
    ).toBe(true);
    const meteorBatch = state.anvilMeteorBatches[0];
    if (!meteorBatch) throw new Error('Heroic meteor batch was not scheduled');
    sim.player.pos = { ...meteorBatch.points[0] };
    const hpBeforeMeteor = sim.player.hp;
    meteorBatch.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(hpBeforeMeteor - 1_000 * VARKHUL_ANVIL_METEOR_DAMAGE_MAX_HP);
    expect(
      sim.events.filter(
        (event) => event.type === 'spellfxAt' && event.ability === VARKHUL_ANVIL_METEOR_CAST_ID,
      ),
    ).toHaveLength(3);
  });

  it('keeps all nine Heroic meteor impacts when enraged hammer warnings overlap', () => {
    const { sim, boss } = claimedEncounter(458);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('Inner Crucible instance disappeared');
    instance.difficulty = 'heroic';
    sim.player.profilerInvulnerable = true;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.assemblyTriggered = true;
    state.masterpieceTriggered = true;
    state.anvilTimer = DT;
    let maximumWarnings = 0;
    for (let tick = 0; tick < 240; tick++) {
      updateVarkhulEncounter(sim.ctx, boss);
      maximumWarnings = Math.max(maximumWarnings, sim.activeVarkhulAnvilMeteors.length);
    }

    expect(maximumWarnings).toBeGreaterThanOrEqual(6);
    expect(
      sim.events.filter(
        (event) => event.type === 'spellfxAt' && event.ability === VARKHUL_ANVIL_METEOR_CAST_ID,
      ),
    ).toHaveLength(9);
  });

  it('does not schedule hammer meteors in Normal', () => {
    const { sim, boss } = claimedEncounter(459);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.anvilTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    state.anvilStrikeRemaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.anvilMeteorBatches).toEqual([]);
    expect(sim.activeVarkhulAnvilMeteors).toEqual([]);
  });
  it('makes the Assembly threshold mandatory and immune to exact-copy and dev damage', () => {
    const { sim, boss } = claimedEncounter(462);
    updateVarkhulEncounter(sim.ctx, boss);
    isolateMechanics(boss);
    const floor = Math.ceil(boss.maxHp * 0.5);
    sim.ctx.dealDamage(
      sim.player,
      boss,
      boss.maxHp * 10,
      false,
      'shadow',
      'Threshold Burst',
      'hit',
    );
    sim.ctx.dealDamage(
      sim.player,
      boss,
      boss.maxHp * 10,
      false,
      'shadow',
      'Same Tick Burst',
      'hit',
    );
    expect(boss.hp).toBe(floor);
    expect(boss.dead).toBe(false);

    updateVarkhulEncounter(sim.ctx, boss);
    expect(boss.damageImmune).toBe(true);
    const hpDuringAssembly = boss.hp;
    sim.ctx.dealDamage(
      sim.player,
      boss,
      500,
      false,
      'shadow',
      'Ruinous Copy',
      'hit',
      false,
      undefined,
      true,
      false,
      false,
      null,
      false,
      undefined,
      true,
    );
    sim.player.oneShot = true;
    sim.ctx.dealDamage(sim.player, boss, 1, false, 'physical', 'Dev Smite', 'hit');
    expect(boss.hp).toBe(hpDuringAssembly);
  });
  it('accelerates non-tank mechanics at 20% and wipes when Masterpiece expires', () => {
    const { sim, boss } = claimedEncounter(47);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.assemblyTriggered = true;
    boss.hp = Math.floor(boss.maxHp * 0.2);
    state.cinderOrbsTimer = 10;
    state.forgestormTimer = 10;
    state.anvilTimer = 10;
    state.makersBrandTimer = 10;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(boss.auras.some((aura) => aura.id === VARKHUL_MASTERPIECE_UNBOUND_AURA_ID)).toBe(true);
    expect(state.cinderOrbsTimer).toBeCloseTo(10 - DT * 1.25, 5);
    expect(state.forgestormTimer).toBeCloseTo(10 - DT * 1.25, 5);
    expect(state.anvilTimer).toBeCloseTo(10 - DT * 1.25, 5);
    expect(state.makersBrandTimer).toBeCloseTo(10 - DT, 5);

    state.masterpiecePulseTimer = DT;
    sim.player.hp = sim.player.maxHp;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(sim.player.hp).toBe(
      sim.player.maxHp - Math.ceil(sim.player.maxHp * VARKHUL_MASTERPIECE_UNBOUND_PULSE_MAX_HP),
    );
    state.masterpieceRemaining = DT;
    sim.player.hp = sim.player.maxHp;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(sim.player.dead).toBe(true);
  });

  it('cleans in-claim auras, warnings, casts, and enrage on reset', () => {
    const { sim, boss } = claimedEncounter(48);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    sim.player.auras.push({
      id: VARKHUL_MAKERS_BRAND_AURA_ID,
      name: "Maker's Brand",
      kind: 'vuln_source',
      remaining: 30,
      duration: 30,
      value: 0.35,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    state.forgestormTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(sim.ctx.groundAoEs.some((effect) => effect.sourceId === boss.id)).toBe(true);

    resetVarkhulEncounter(sim.ctx, boss);

    expect(boss.varkhul).toBeUndefined();
    expect(boss.castingAbility).toBeNull();
    expect(boss.enraged).toBe(false);
    expect(sim.player.auras.some((aura) => aura.sourceId === boss.id)).toBe(false);
    expect(sim.ctx.groundAoEs.some((effect) => effect.sourceId === boss.id)).toBe(false);
  });

  it('recovers participating players long cooldowns when the pull wipes', () => {
    const { sim, boss } = claimedEncounter(481);
    sim.setPlayerLevel(20);
    const meta = sim.meta(sim.player.id);
    const longAbility = meta?.known.find((ability) => ability.cooldown >= 120);
    if (!longAbility) throw new Error('Expected a long Warrior cooldown');
    sim.player.cooldowns.set(longAbility.def.id, longAbility.cooldown);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(boss.varkhul?.attemptParticipantIds).toContain(sim.player.id);

    sim.player.dead = true;
    sim.player.hp = 0;
    updateVarkhulEncounter(sim.ctx, boss);

    expect(boss.varkhul).toBeUndefined();
    expect(sim.player.cooldowns.has(longAbility.def.id)).toBe(false);
  });

  it('does not reset a pre-pull visitor cooldown when another player later wipes', () => {
    const { sim, boss } = claimedEncounter(482);
    sim.setPlayerLevel(20);
    const visitorMeta = sim.meta(sim.player.id);
    const longAbility = visitorMeta?.known.find((ability) => ability.cooldown >= 120);
    if (!longAbility) throw new Error('Expected a long Warrior cooldown');
    sim.player.cooldowns.set(longAbility.def.id, longAbility.cooldown);
    boss.inCombat = false;
    boss.aiState = 'idle';
    boss.aggroTargetId = null;
    sim.player.pos = sim.ctx.groundPos(boss.pos.x, boss.pos.z - 31);
    sim.player.prevPos = { ...sim.player.pos };

    updateVarkhulEncounter(sim.ctx, boss);

    expect(boss.inCombat).toBe(false);
    expect(boss.varkhul?.attemptParticipantIds).toEqual([]);

    const raider = addEncounterPlayer(sim, boss, 'Actual Pull Raider');
    sim.player.pos = sim.ctx.groundPos(0, 0);
    sim.player.prevPos = { ...sim.player.pos };
    updateVarkhulEncounter(sim.ctx, boss);
    expect(boss.varkhul?.attemptParticipantIds).toEqual([raider.id]);

    raider.dead = true;
    raider.hp = 0;
    updateVarkhulEncounter(sim.ctx, boss);

    expect(boss.varkhul).toBeUndefined();
    expect(sim.player.cooldowns.get(longAbility.def.id)).toBe(longAbility.cooldown);
  });

  it('keeps long cooldowns when the encounter is reset without a wipe', () => {
    const { sim, boss } = claimedEncounter(483);
    sim.setPlayerLevel(20);
    const meta = sim.meta(sim.player.id);
    const longAbility = meta?.known.find((ability) => ability.cooldown >= 120);
    if (!longAbility) throw new Error('Expected a long Warrior cooldown');
    sim.player.cooldowns.set(longAbility.def.id, longAbility.cooldown);
    updateVarkhulEncounter(sim.ctx, boss);

    resetVarkhulEncounter(sim.ctx, boss);

    expect(sim.player.cooldowns.get(longAbility.def.id)).toBe(longAbility.cooldown);
  });

  it('despawns portal-wave adds and clears boss-sourced auras from displaced players on reset', () => {
    const { sim, boss } = claimedEncounter(49);
    const displaced = addEncounterPlayer(sim, boss, 'Displaced Raider');
    updateVarkhulEncounter(sim.ctx, boss);
    isolateMechanics(boss);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state disappeared');
    for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    const addIds = [...state.assemblyAddIds];
    expect(addIds).toHaveLength(4);
    displaced.auras.push({
      id: VARKHUL_CINDER_ORBS_AURA_ID,
      name: VARKHUL_CINDER_ORBS_CAST_ID,
      kind: 'vulnerability',
      remaining: 4,
      duration: 4,
      value: 0,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    displaced.pos = sim.ctx.groundPos(0, 0);
    displaced.prevPos = { ...displaced.pos };

    resetVarkhulEncounter(sim.ctx, boss);

    expect(addIds.every((id) => !sim.entities.has(id))).toBe(true);
    expect(displaced.auras.some((aura) => aura.sourceId === boss.id)).toBe(false);
  });

  it('clears both Varkhul encounter auras when a player leaves the Inner Crucible', () => {
    const { sim, boss } = claimedEncounter(50);
    sim.player.auras.push(
      {
        id: VARKHUL_MAKERS_BRAND_AURA_ID,
        name: "Maker's Brand",
        kind: 'vuln_source',
        remaining: 30,
        duration: 30,
        value: 0.35,
        sourceId: boss.id,
        school: 'fire',
        encounterOwned: true,
      },
      {
        id: VARKHUL_CINDER_ORBS_AURA_ID,
        name: VARKHUL_CINDER_ORBS_CAST_ID,
        kind: 'vulnerability',
        remaining: 4,
        duration: 4,
        value: 0,
        sourceId: boss.id,
        school: 'fire',
        encounterOwned: true,
      },
      {
        id: VARKHUL_RED_HOT_METAL_AURA_ID,
        name: 'Red-hot Metal',
        kind: 'dot',
        remaining: 10,
        duration: 10,
        value: 40,
        sourceId: boss.id,
        school: 'fire',
        encounterOwned: true,
      },
      {
        id: VARKHUL_RED_HOT_METAL_ABSORB_AURA_ID,
        name: 'Red-hot Metal Barrier',
        kind: 'heal_absorb',
        remaining: 10,
        duration: 10,
        value: 300,
        sourceId: boss.id,
        school: 'fire',
        encounterOwned: true,
      },
      {
        id: VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID,
        name: VARKHUL_INTERCEPT_BEAM_DEBUFF_NAME,
        kind: 'vuln_source',
        remaining: VARKHUL_INTERCEPT_BEAM_DEBUFF_SECONDS,
        duration: VARKHUL_INTERCEPT_BEAM_DEBUFF_SECONDS,
        value: VARKHUL_INTERCEPT_BEAM_DEBUFF_DAMAGE_TAKEN,
        sourceId: boss.id,
        school: 'fire',
        encounterOwned: true,
      },
    );

    // The exit portal is sealed while Varkhul is engaged, so the fight lulls
    // first; the assembly claim gives the crucible's floor-chain exit a live
    // room to route to, and stepping back in takes its real portal out.
    boss.inCombat = false;
    expect(enterDungeon(sim.ctx, IGNIVAR_MOLTEN_ASSEMBLY_ID, sim.player.id, true)).toBe(true);
    expect(enterDungeon(sim.ctx, IGNIVAR_SECOND_WING_ID, sim.player.id, true)).toBe(true);
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);

    expect(
      sim.player.auras.some(
        (aura) =>
          aura.id === VARKHUL_MAKERS_BRAND_AURA_ID ||
          aura.id === VARKHUL_CINDER_ORBS_AURA_ID ||
          aura.id === VARKHUL_RED_HOT_METAL_AURA_ID ||
          aura.id === VARKHUL_RED_HOT_METAL_ABSORB_AURA_ID ||
          aura.id === VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID,
      ),
    ).toBe(false);
  });
  it('can clear one retired boss source without touching another source', () => {
    const { sim, boss } = claimedEncounter(51);
    const otherSourceId = boss.id + 10_000;
    for (const sourceId of [boss.id, otherSourceId]) {
      sim.player.auras.push({
        id: VARKHUL_MAKERS_BRAND_AURA_ID,
        name: "Maker's Brand",
        kind: 'vuln_source',
        remaining: 30,
        duration: 30,
        value: 0.35,
        sourceId,
        school: 'fire',
        encounterOwned: true,
      });
    }

    clearVarkhulEncounterAuras(sim.player, boss.id);

    expect(sim.player.auras.filter((aura) => aura.id === VARKHUL_MAKERS_BRAND_AURA_ID)).toEqual([
      expect.objectContaining({ sourceId: otherSourceId }),
    ]);
  });
});

describe('Varkhul empty-raid reset and terminal wipe', () => {
  it('performs exactly one home reset for an all-dead raid and stops consuming rng', () => {
    const { sim, boss } = claimedEncounter(52);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(boss.varkhul).toBeDefined();
    // Drag him off the work spot the way a fight does before everyone drops.
    boss.pos = { x: boss.spawnPos.x + 8, y: boss.spawnPos.y, z: boss.spawnPos.z + 8 };
    boss.prevPos = { ...boss.pos };
    sim.player.dead = true;
    sim.player.hp = 0;
    const epochBefore = boss.evadeEpoch;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws += 1;
    });
    updateVarkhulEncounter(sim.ctx, boss);
    const drawsAfterReset = draws;
    expect(drawsAfterReset).toBeGreaterThan(0);
    expect(boss.evadeEpoch).toBe(epochBefore + 1);
    for (let i = 0; i < 3; i++) updateVarkhulEncounter(sim.ctx, boss);
    sim.rng.setObserver(null);

    expect(draws).toBe(drawsAfterReset);
    expect(boss.evadeEpoch).toBe(epochBefore + 1);
    expect(boss.varkhul).toBeUndefined();
    expect(boss.inCombat).toBe(false);
    expect(boss.aiState).toBe('idle');
    expect(boss.pos).toEqual(boss.spawnPos);
    expect(boss.prevPos).toEqual(boss.spawnPos);
  });

  it('holds the one-reset state through full ticks of an all-dead raid', () => {
    const { sim, boss } = claimedEncounter(53);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(boss.varkhul).toBeDefined();
    sim.player.dead = true;
    sim.player.hp = 0;
    sim.tick();
    const epochAfterWipe = boss.evadeEpoch;

    for (let i = 0; i < 40; i++) sim.tick();

    expect(boss.evadeEpoch).toBe(epochAfterWipe);
    expect(boss.varkhul).toBeUndefined();
    expect(boss.inCombat).toBe(false);
    expect(boss.pos).toEqual(boss.spawnPos);
  });

  it('never consumes rng for a spawned boss whose room is empty and unpulled', () => {
    const { sim, boss } = claimedEncounter(54);
    // claimedEncounter force-flags a pull; restore the fresh-spawn pose and
    // walk the only player out before the encounter state ever initializes.
    boss.inCombat = false;
    boss.aiState = 'idle';
    boss.aggroTargetId = null;
    sim.player.pos = sim.ctx.groundPos(0, 0);
    sim.player.prevPos = { ...sim.player.pos };
    const epochBefore = boss.evadeEpoch;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws += 1;
    });
    for (let i = 0; i < 3; i++) updateVarkhulEncounter(sim.ctx, boss);
    sim.rng.setObserver(null);

    expect(draws).toBe(0);
    expect(boss.evadeEpoch).toBe(epochBefore);
    expect(boss.varkhul).toBeUndefined();
    expect(boss.hp).toBe(boss.maxHp);
  });

  it('heals a damaged stateless boss with one reset before the empty-room gate latches', () => {
    const { sim, boss } = claimedEncounter(57);
    // Stateless (boss.varkhul never initialized), out of combat, empty room,
    // but NOT pristine: the gate must let one reset through to heal him.
    boss.inCombat = false;
    boss.aiState = 'idle';
    boss.aggroTargetId = null;
    sim.player.pos = sim.ctx.groundPos(0, 0);
    sim.player.prevPos = { ...sim.player.pos };
    boss.hp = boss.maxHp - 500;
    boss.auras.push({
      id: 'test_burn',
      name: 'Test Burn',
      kind: 'dot',
      remaining: 30,
      duration: 30,
      value: 1,
      sourceId: sim.player.id,
      school: 'fire',
    });
    const epochBefore = boss.evadeEpoch;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws += 1;
    });
    updateVarkhulEncounter(sim.ctx, boss);
    const drawsAfterReset = draws;
    expect(drawsAfterReset).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) updateVarkhulEncounter(sim.ctx, boss);
    sim.rng.setObserver(null);

    expect(draws).toBe(drawsAfterReset);
    expect(boss.evadeEpoch).toBe(epochBefore + 1);
    expect(boss.hp).toBe(boss.maxHp);
    expect(boss.auras).toEqual([]);
    expect(boss.pos).toEqual(boss.spawnPos);
  });

  it('filters a player already dead at Masterpiece resolution start out of the wipe', () => {
    const { sim, boss } = claimedEncounter(59);
    const fallen = addEncounterPlayer(sim, boss, 'Fallen Raider');
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.assemblyTriggered = true;
    boss.hp = Math.floor(boss.maxHp * 0.2);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.masterpieceTriggered).toBe(true);
    fallen.dead = true;
    fallen.hp = 0;
    state.masterpieceRemaining = DT;
    sim.player.hp = sim.player.maxHp;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.masterpieceWipeResolved).toBe(true);
    expect(sim.player.dead).toBe(true);
    // The eager alive-only filter (Ignivar's call-site semantics): no second
    // nova for someone already down when the wipe resolves.
    expect(
      sim.events.some(
        (event) => event.type === 'spellfx' && event.fx === 'nova' && event.targetId === fallen.id,
      ),
    ).toBe(false);
    expect(
      sim.events.some(
        (event) =>
          event.type === 'spellfx' && event.fx === 'nova' && event.targetId === sim.player.id,
      ),
    ).toBe(true);
  });

  it('kills a full-health Cold Coffin stasis player when Masterpiece Unbound expires', () => {
    const { sim, boss } = claimedEncounter(55);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.assemblyTriggered = true;
    boss.hp = Math.floor(boss.maxHp * 0.2);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.masterpieceTriggered).toBe(true);
    state.masterpieceRemaining = DT;
    sim.player.hp = sim.player.maxHp;
    sim.player.auras.push({
      id: 'ice_block',
      name: 'Cold Coffin',
      kind: 'stasis',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: sim.player.id,
      school: 'frost',
    });

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.masterpieceWipeResolved).toBe(true);
    expect(sim.player.dead).toBe(true);
    expect(sim.player.hp).toBe(0);
  });

  it('preserves dev and GM invulnerability through the Masterpiece Unbound wipe', () => {
    const { sim, boss } = claimedEncounter(56);
    const god = addEncounterPlayer(sim, boss, 'Wipe God');
    god.devGod = true;
    sim.player.gm = true;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.assemblyTriggered = true;
    boss.hp = Math.floor(boss.maxHp * 0.2);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(state.masterpieceTriggered).toBe(true);
    state.masterpieceRemaining = DT;
    sim.player.hp = sim.player.maxHp;
    god.hp = god.maxHp;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.masterpieceWipeResolved).toBe(true);
    expect(sim.player.dead).toBe(false);
    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(god.dead).toBe(false);
    expect(god.hp).toBe(god.maxHp);
  });
});
