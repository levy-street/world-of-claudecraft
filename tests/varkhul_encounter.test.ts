import { describe, expect, it } from 'vitest';
import {
  clearVarkhulEncounterAuras,
  pointInVarkhulAnvilLane,
  pointInVarkhulBlueprintLane,
  resetVarkhulEncounter,
  selectVarkhulBlueprintTargets,
  updateVarkhulEncounter,
  VARKHUL_ANVILS_DECREE_CAST_ID,
  VARKHUL_ANVILS_DECREE_LANE_MAX_HP,
  VARKHUL_ANVILS_DECREE_RAIDWIDE_MAX_HP,
  VARKHUL_ANVILS_DECREE_STRIKES,
  VARKHUL_BOSS_ID,
  VARKHUL_CINDER_ARTIFICER_ID,
  VARKHUL_CRUCIBLE_WARDEN_ID,
  VARKHUL_EMBER_SENTINEL_ID,
  VARKHUL_FORGE_LOCAL_POS,
  VARKHUL_FORGESTORM_CAST_ID,
  VARKHUL_FORGESTORM_DAMAGE_MAX_HP,
  VARKHUL_FORGESTORM_IMPACTS_PER_WAVE,
  VARKHUL_FORGESTORM_WARNING_SECONDS,
  VARKHUL_FORGESTORM_WAVES,
  VARKHUL_LIVING_BLUEPRINT_AURA_ID,
  VARKHUL_LIVING_BLUEPRINT_TARGETS,
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
  VARKHUL_MASTERS_ASSEMBLY_AURA_ID,
  VARKHUL_MASTERS_ASSEMBLY_CAST_ID,
  VARKHUL_MASTERS_ASSEMBLY_SECONDS,
  VARKHUL_WARDEN_SHIELD_AURA_ID,
  varkhulForgestormPattern,
} from '../src/sim/encounters/varkhul';
import { IGNIVAR_SECOND_WING_ID } from '../src/sim/ignivar_raid_ids';
import { enterDungeon, leaveDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type PlayerClass } from '../src/sim/types';

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
  boss.varkhul.blueprintTimer = 999;
  boss.varkhul.forgestormTimer = 999;
  boss.varkhul.anvilTimer = 999;
  boss.swingTimer = Number.POSITIVE_INFINITY;
  return boss.varkhul;
}

describe('Varkhul encounter geometry and selection', () => {
  it('selects three non-tanks in a deterministic rotating order', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      dead: false,
    })) as Entity[];
    const tanks = new Set([1, 2]);

    expect(selectVarkhulBlueprintTargets(players, tanks, 0).map((player) => player.id)).toEqual([
      3, 4, 5,
    ]);
    expect(selectVarkhulBlueprintTargets(players, tanks, 2).map((player) => player.id)).toEqual([
      5, 6, 3,
    ]);
    expect(VARKHUL_LIVING_BLUEPRINT_TARGETS).toBe(3);
  });

  it('keeps the marker center safe while resolving diagonal Blueprint lanes', () => {
    const origin = { x: 0, z: 0 };
    expect(pointInVarkhulBlueprintLane(origin, origin)).toBe(false);
    expect(pointInVarkhulBlueprintLane(origin, { x: 8, z: 8 })).toBe(true);
    expect(pointInVarkhulBlueprintLane(origin, { x: 8, z: 0 })).toBe(false);
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
    expect(VARKHUL_FORGESTORM_WAVES).toBe(3);
    expect(VARKHUL_ANVILS_DECREE_STRIKES).toBe(3);
    expect(VARKHUL_MASTERS_ASSEMBLY_SECONDS).toBe(20);
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

  it('uses aura marks for Blueprint and resolves its four-second X warning once', () => {
    const { sim, boss } = claimedEncounter(43);
    const players = [
      sim.player,
      addEncounterPlayer(sim, boss, 'Blueprint One'),
      addEncounterPlayer(sim, boss, 'Blueprint Two'),
      addEncounterPlayer(sim, boss, 'Blueprint Three'),
      addEncounterPlayer(sim, boss, 'Blueprint Four'),
    ];
    for (const player of players) {
      player.maxHp = 1_000;
      player.hp = 1_000;
    }
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.blueprintTimer = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    const marked = players.filter((player) =>
      player.auras.some((aura) => aura.id === VARKHUL_LIVING_BLUEPRINT_AURA_ID),
    );
    expect(marked).toHaveLength(3);
    expect(marked).not.toContain(sim.player);
    expect(boss.castingAbility).toBe('Living Blueprint');
    const origin = marked[0];
    const victim = players.find(
      (player) => !marked.includes(player) && player.id !== sim.player.id,
    );
    if (!origin || !victim) throw new Error('Blueprint test roster is incomplete');
    origin.pos = { x: boss.pos.x - 20, y: boss.pos.y, z: boss.pos.z - 20 };
    marked[1].pos = { x: boss.pos.x + 24, y: boss.pos.y, z: boss.pos.z - 13 };
    marked[2].pos = { x: boss.pos.x + 18, y: boss.pos.y, z: boss.pos.z + 22 };
    victim.pos = { x: origin.pos.x + 8, y: origin.pos.y, z: origin.pos.z + 8 };
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z };
    state.blueprintRemaining = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(victim.hp).toBe(600);
    expect(
      marked.every(
        (player) => !player.auras.some((aura) => aura.id === VARKHUL_LIVING_BLUEPRINT_AURA_ID),
      ),
    ).toBe(true);
    expect(state.majorAbility).toBe('none');
  });

  it('publishes five GroundAoE warnings before each Forgestorm impact', () => {
    const { sim, boss } = claimedEncounter(44);
    sim.player.maxHp = 1_000;
    sim.player.hp = 1_000;
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.forgestormTimer = DT;

    updateVarkhulEncounter(sim.ctx, boss);

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
    expect(warnings[0].remaining).toBeCloseTo(VARKHUL_FORGESTORM_WARNING_SECONDS + DT * 2, 5);
    sim.player.pos = { ...state.forgestormPoints[0] };
    state.forgestormWarningRemaining = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(1_000 - 1_000 * VARKHUL_FORGESTORM_DAMAGE_MAX_HP);
    expect(state.forgestormWaveIndex).toBe(1);
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

  it('returns to the forge and resolves raidwide plus avoidable Anvil lanes', () => {
    const { sim, boss } = claimedEncounter(45);
    const safePlayer = addEncounterPlayer(sim, boss, 'Safe Raider');
    for (const player of [sim.player, safePlayer]) {
      player.maxHp = 1_000;
      player.hp = 1_000;
    }
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.anvilTimer = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('Inner Crucible instance disappeared');
    const origin = sim.ctx.instanceOriginOf(instance);
    expect(boss.castingAbility).toBe(VARKHUL_ANVILS_DECREE_CAST_ID);
    expect(boss.pos.x).toBeCloseTo(origin.x + VARKHUL_FORGE_LOCAL_POS.x, 5);
    expect(boss.pos.z).toBeCloseTo(origin.z + VARKHUL_FORGE_LOCAL_POS.z, 5);
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + 8 };
    safePlayer.pos = { ...boss.pos };
    expect(pointInVarkhulAnvilLane(boss.pos, state.anvilFacing, sim.player.pos)).toBe(true);
    expect(pointInVarkhulAnvilLane(boss.pos, state.anvilFacing, safePlayer.pos)).toBe(false);
    state.anvilStrikeRemaining = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(
      1_000 - 1_000 * (VARKHUL_ANVILS_DECREE_RAIDWIDE_MAX_HP + VARKHUL_ANVILS_DECREE_LANE_MAX_HP),
    );
    expect(safePlayer.hp).toBe(1_000 - 1_000 * VARKHUL_ANVILS_DECREE_RAIDWIDE_MAX_HP);

    sim.player.pos = { ...boss.pos };
    safePlayer.pos = { ...boss.pos };
    for (let strike = 1; strike < 3; strike++) {
      state.anvilStrikeRemaining = DT;
      updateVarkhulEncounter(sim.ctx, boss);
    }
    expect(state.anvilStrikeIndex).toBe(3);
    expect(state.majorAbility).toBe('none');
    expect(boss.castingAbility).toBeNull();
    expect(safePlayer.hp).toBe(700);
  });

  it('shields the 50% assembly, exposes its artificer after the warden dies, and resumes when clear', () => {
    const { sim, boss } = claimedEncounter(46);
    updateVarkhulEncounter(sim.ctx, boss);
    isolateMechanics(boss);
    boss.hp = Math.floor(boss.maxHp * 0.5);

    updateVarkhulEncounter(sim.ctx, boss);

    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state disappeared');
    const adds = state.assemblyAddIds.map((id) => sim.entities.get(id)).filter(Boolean) as Entity[];
    expect(adds.map((add) => add.templateId).sort()).toEqual(
      [VARKHUL_EMBER_SENTINEL_ID, VARKHUL_CRUCIBLE_WARDEN_ID, VARKHUL_CINDER_ARTIFICER_ID].sort(),
    );
    expect(boss.auras.some((aura) => aura.id === VARKHUL_MASTERS_ASSEMBLY_AURA_ID)).toBe(true);
    const warden = adds.find((add) => add.templateId === VARKHUL_CRUCIBLE_WARDEN_ID);
    const artificer = adds.find((add) => add.templateId === VARKHUL_CINDER_ARTIFICER_ID);
    if (!warden || !artificer) throw new Error('Assembly roles did not spawn');
    expect(artificer.castingAbility).toBe(VARKHUL_MASTERS_ASSEMBLY_CAST_ID);
    expect(artificer.auras.some((aura) => aura.id === VARKHUL_WARDEN_SHIELD_AURA_ID)).toBe(true);

    warden.dead = true;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(artificer.auras.some((aura) => aura.id === VARKHUL_WARDEN_SHIELD_AURA_ID)).toBe(false);
    for (const add of adds) add.dead = true;
    updateVarkhulEncounter(sim.ctx, boss);
    expect(boss.auras.some((aura) => aura.id === VARKHUL_MASTERS_ASSEMBLY_AURA_ID)).toBe(false);
    expect(state.assemblyAddIds).toEqual([]);
  });

  it("lets the Assembly artificer's twenty-second cast wipe the raid", () => {
    const { sim, boss } = claimedEncounter(461);
    updateVarkhulEncounter(sim.ctx, boss);
    isolateMechanics(boss);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    sim.player.hp = sim.player.maxHp;

    updateVarkhulEncounter(sim.ctx, boss);

    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state disappeared');
    const artificer = state.assemblyAddIds
      .map((id) => sim.entities.get(id))
      .find((add) => add?.templateId === VARKHUL_CINDER_ARTIFICER_ID);
    expect(artificer?.castingAbility).toBe(VARKHUL_MASTERS_ASSEMBLY_CAST_ID);
    state.assemblyRemaining = DT;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(state.assemblyWipeResolved).toBe(true);
    expect(sim.player.dead).toBe(true);
  });

  it('accelerates non-tank mechanics at 20% and wipes when Masterpiece expires', () => {
    const { sim, boss } = claimedEncounter(47);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = isolateMechanics(boss);
    state.assemblyTriggered = true;
    boss.hp = Math.floor(boss.maxHp * 0.2);
    state.blueprintTimer = 10;
    state.forgestormTimer = 10;
    state.anvilTimer = 10;
    state.makersBrandTimer = 10;

    updateVarkhulEncounter(sim.ctx, boss);

    expect(boss.auras.some((aura) => aura.id === VARKHUL_MASTERPIECE_UNBOUND_AURA_ID)).toBe(true);
    expect(state.blueprintTimer).toBeCloseTo(10 - DT * 1.25, 5);
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

  it('despawns Assembly adds and clears boss-sourced auras from displaced players on reset', () => {
    const { sim, boss } = claimedEncounter(49);
    const displaced = addEncounterPlayer(sim, boss, 'Displaced Raider');
    updateVarkhulEncounter(sim.ctx, boss);
    isolateMechanics(boss);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state disappeared');
    const addIds = [...state.assemblyAddIds];
    expect(addIds).toHaveLength(3);
    displaced.auras.push({
      id: VARKHUL_LIVING_BLUEPRINT_AURA_ID,
      name: 'Living Blueprint',
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
        id: VARKHUL_LIVING_BLUEPRINT_AURA_ID,
        name: 'Living Blueprint',
        kind: 'vulnerability',
        remaining: 4,
        duration: 4,
        value: 0,
        sourceId: boss.id,
        school: 'fire',
        encounterOwned: true,
      },
    );

    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);

    expect(
      sim.player.auras.some(
        (aura) =>
          aura.id === VARKHUL_MAKERS_BRAND_AURA_ID || aura.id === VARKHUL_LIVING_BLUEPRINT_AURA_ID,
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
