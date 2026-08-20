import { describe, expect, it } from 'vitest';
import { isDispellableAura } from '../src/sim/aura_classify';
import { TALENT_ABILITIES_V2_B } from '../src/sim/content/talent_abilities_v2_b';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { IGNIVAR_LAYOUT } from '../src/sim/dungeon_layout';
import {
  IGNIVAR_APOCALYPSE_ADD_ID,
  IGNIVAR_APOCALYPSE_CAST_ID,
  IGNIVAR_APOCALYPSE_CAST_SECONDS,
  IGNIVAR_APOCALYPSE_HP_THRESHOLD,
  IGNIVAR_BRAND_AURA_ID,
  IGNIVAR_BRAND_EVERY,
  IGNIVAR_BRAND_MAX_STACKS,
  IGNIVAR_BRAND_TARGETS_NORMAL,
  IGNIVAR_CLEANSING_BACKLASH_DAMAGE_MAX_HP,
  IGNIVAR_CLEANSING_BACKLASH_ID,
  IGNIVAR_CONDUIT_ACTIVE_SECONDS,
  IGNIVAR_FIRST_ROTATING_RAYS_SECONDS,
  IGNIVAR_FIRST_SKYFIRE_SECONDS,
  IGNIVAR_FIRST_SOAK_SECONDS,
  IGNIVAR_FORGE_STRIKE_EVERY,
  IGNIVAR_FORGE_STRIKE_MAX_HP,
  IGNIVAR_FORGE_WAVE_CAST_ID,
  IGNIVAR_FRONTAL_CAST_ID,
  IGNIVAR_FRONTAL_CAST_SECONDS,
  IGNIVAR_FRONTAL_EVERY,
  IGNIVAR_FRONTAL_VFX_DISTANCE,
  IGNIVAR_LAST_INFERNO_AURA_ID,
  IGNIVAR_LAST_INFERNO_HP_THRESHOLD,
  IGNIVAR_LAST_INFERNO_SECONDS,
  IGNIVAR_MAJOR_ABILITY_GAP_SECONDS,
  IGNIVAR_MOLTEN_ARMOR_AURA_ID,
  IGNIVAR_MOLTEN_ARMOR_DURATION,
  IGNIVAR_MOLTEN_ARMOR_PER_STACK,
  IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS,
  IGNIVAR_ROTATING_RAYS_ANGULAR_SPEED,
  IGNIVAR_ROTATING_RAYS_CAST_ID,
  IGNIVAR_ROTATING_RAYS_DAMAGE_MAX_HP,
  IGNIVAR_ROTATING_RAYS_EVERY,
  IGNIVAR_ROTATING_RAYS_PULSE_SECONDS,
  IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS,
  IGNIVAR_SKYFIRE_CAST_ID,
  IGNIVAR_SKYFIRE_CAST_SECONDS,
  IGNIVAR_SKYFIRE_CONE_COUNT,
  IGNIVAR_SKYFIRE_DAMAGE_MAX_HP,
  IGNIVAR_SKYFIRE_EVERY,
  IGNIVAR_SKYFIRE_HALF_ANGLE,
  IGNIVAR_SKYFIRE_RANGE,
  IGNIVAR_SOAK_AURA_ID,
  IGNIVAR_SOAK_CAST_SECONDS,
  IGNIVAR_SOAK_EVERY,
  IGNIVAR_SOAK_RADIUS,
  IGNIVAR_SOAK_REQUIRED_PLAYERS,
  IGNIVAR_SOAK_SHARED_MAX_HP,
  resetIgnivarEncounter,
  updateIgnivarEncounter,
} from '../src/sim/encounters/ignivar';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import { IGNIVAR_WATER_CONDUIT_TEMPLATES } from '../src/sim/ignivar_arena';
import {
  IGNIVAR_FORGE_CHAINS_ATTACH_GRACE_SECONDS,
  IGNIVAR_FORGE_CHAINS_AURA_ID,
  IGNIVAR_FORGE_CHAINS_BREAK_DISTANCE,
  IGNIVAR_FORGE_CHAINS_DURATION_SECONDS,
  IGNIVAR_FORGE_CHAINS_EVERY,
  IGNIVAR_FORGE_CHAINS_FIRST_SECONDS,
  IGNIVAR_FORGE_CHAINS_PAIR_COUNT,
  IGNIVAR_FORGE_CHAINS_STRAIN_SECONDS,
  updateIgnivarForgeChains,
} from '../src/sim/ignivar_forge_chains';
import {
  IGNIVAR_FIRST_FORGE_WAVE_SECONDS,
  IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS,
  IGNIVAR_FORGE_WAVE_DAMAGE_MAX_HP,
  IGNIVAR_FORGE_WAVE_EVERY,
  IGNIVAR_FORGE_WAVE_KNOCKBACK,
  IGNIVAR_FORGE_WAVE_RANGE,
  IGNIVAR_FORGE_WAVE_WINDUP_SECONDS,
} from '../src/sim/ignivar_forge_wave';
import {
  IGNIVAR_FIRST_METEOR_SECONDS,
  IGNIVAR_METEOR_CAST_ID,
  IGNIVAR_METEOR_COUNT,
  IGNIVAR_METEOR_DAMAGE_MAX_HP,
  IGNIVAR_METEOR_EVERY,
  IGNIVAR_METEOR_RADIUS,
  IGNIVAR_METEOR_REVEAL_DELAY_SECONDS,
  IGNIVAR_METEOR_TELEGRAPH_SECONDS,
} from '../src/sim/ignivar_meteors';
import { enterDungeon, leaveDungeon } from '../src/sim/instances/dungeons';
import { Rng } from '../src/sim/rng';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import {
  DT,
  dist2d,
  type Entity,
  IGNIVAR_BOSS_ID,
  type PlayerClass,
  type SimEvent,
} from '../src/sim/types';

function claimedEncounter(seed = 42): {
  sim: Sim;
  boss: NonNullable<ReturnType<Sim['entities']['get']>>;
  conduit: NonNullable<ReturnType<Sim['entities']['get']>>;
} {
  const sim = new Sim({ seed, playerClass: 'warrior', devCommands: true });
  expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', sim.player.id, true)).toBe(true);
  const boss = [...sim.entities.values()].find((e) => e.templateId === IGNIVAR_BOSS_ID);
  if (!boss) throw new Error('Ignivar did not spawn');
  const conduit = [...sim.entities.values()].find(
    (e) => e.templateId === IGNIVAR_WATER_CONDUIT_TEMPLATES.ready && e.pos.x < boss.pos.x,
  );
  if (!conduit) throw new Error('Ignivar conduit did not spawn');
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  return { sim, boss, conduit };
}

function claimedHeroicEncounter(seed = 42): ReturnType<typeof claimedEncounter> {
  const sim = new Sim({ seed, playerClass: 'warrior', devCommands: true });
  sim.setDungeonDifficulty('heroic', sim.player.id);
  expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', sim.player.id, true)).toBe(true);
  const instance = sim.instances.find((entry) => entry.dungeonId === 'ignivar_raid_arena');
  expect(instance?.difficulty).toBe('heroic');
  const boss = [...sim.entities.values()].find((e) => e.templateId === IGNIVAR_BOSS_ID);
  if (!boss) throw new Error('Heroic Ignivar did not spawn');
  const conduit = [...sim.entities.values()].find(
    (e) => e.templateId === IGNIVAR_WATER_CONDUIT_TEMPLATES.ready && e.pos.x < boss.pos.x,
  );
  if (!conduit) throw new Error('Heroic Ignivar conduit did not spawn');
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  return { sim, boss, conduit };
}

function isolateForgeChains(boss: ReturnType<typeof claimedEncounter>['boss'], timer = 0): void {
  if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
  boss.ignivar.brandTimer = 999;
  boss.ignivar.forgeStrikeTimer = 999;
  boss.ignivar.frontalTimer = 999;
  boss.ignivar.skyfireTimer = 999;
  boss.ignivar.meteorTimer = 999;
  boss.ignivar.rotatingRaysTimer = 999;
  boss.ignivar.forgeWaveTimer = 999;
  boss.ignivar.soakTimer = 999;
  boss.ignivar.forgeChainsTimer = timer;
}

function addEncounterPlayer(
  sim: Sim,
  boss: NonNullable<ReturnType<Sim['entities']['get']>>,
  name: string,
  cls: PlayerClass = 'priest',
) {
  const pid = sim.addPlayer(cls, name);
  const player = sim.entities.get(sim.players.get(pid)?.entityId ?? -1);
  if (!player) throw new Error(`${name} did not spawn`);
  player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + 2 };
  player.prevPos = { ...player.pos };
  return player;
}

function applyIgnivarBrand(player: Entity, boss: Entity): void {
  player.auras.push({
    id: IGNIVAR_BRAND_AURA_ID,
    name: 'Brand of the Pyre',
    kind: 'dot',
    remaining: 600,
    duration: 600,
    value: 1,
    sourceId: boss.id,
    school: 'fire',
    encounterOwned: true,
  });
}

function prepareConduitCleanse(sim: Sim, boss: Entity, conduit: Entity): void {
  updateIgnivarEncounter(sim.ctx, boss);
  if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
  boss.ignivar.brandTimer = 999;
  boss.ignivar.forgeStrikeTimer = 999;
  boss.ignivar.frontalTimer = 999;
  boss.ignivar.skyfireTimer = 999;
  boss.ignivar.meteorTimer = 999;
  boss.ignivar.rotatingRaysTimer = 999;
  boss.ignivar.forgeWaveTimer = 999;
  boss.ignivar.soakTimer = 999;
  boss.ignivar.forgeChainsTimer = 999;
  boss.swingTimer = 999;
  conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
  boss.ignivar.conduitTimers.north_west = 5;
}

function forgeWaveCadenceTrace(seed: number) {
  const { sim, boss } = claimedEncounter(seed);
  const party = [
    sim.player,
    addEncounterPlayer(sim, boss, 'Cadence Two'),
    addEncounterPlayer(sim, boss, 'Cadence Three'),
    addEncounterPlayer(sim, boss, 'Cadence Four'),
  ];
  const casts: Array<{
    startTick: number;
    endTick: number;
    facingSlot: number;
    windupFrames: number;
    activeFrames: number;
  }> = [];
  let current: (typeof casts)[number] | null = null;
  let wasWave = false;
  for (let tick = 0; tick < 3_000; tick++) {
    for (const player of party) {
      player.hp = player.maxHp;
      player.dead = false;
    }
    updateIgnivarEncounter(sim.ctx, boss);
    const isWave = boss.castingAbility === IGNIVAR_FORGE_WAVE_CAST_ID;
    if (isWave && !wasWave) {
      if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
      current = {
        startTick: tick,
        endTick: -1,
        facingSlot: Math.round(boss.ignivar.forgeWaveFacing / (Math.PI / 4)),
        windupFrames: 0,
        activeFrames: 0,
      };
      casts.push(current);
    }
    if (isWave && current) {
      if (boss.channeling) current.activeFrames++;
      else current.windupFrames++;
    }
    if (!isWave && wasWave && current) {
      current.endTick = tick;
      current = null;
      if (casts.length === 2) break;
    }
    wasWave = isWave;
  }
  return casts;
}

describe('Ignivar encounter', () => {
  it('applies the provisional Heroic tuning through the real boss and Heart spawn path', () => {
    const { sim, boss } = claimedHeroicEncounter();

    expect(boss.maxHp).toBe(175_000);
    expect(boss.weapon).toEqual({ min: 619, max: 968, speed: 2.6 });
    expect(boss.stats.armor).toBe(1_058);
    expect(boss.mechanicDamageMult).toBe(2);
    expect(boss.mechanicHealMult).toBe(2.5);

    boss.hp = Math.floor(boss.maxHp * IGNIVAR_APOCALYPSE_HP_THRESHOLD);
    updateIgnivarEncounter(sim.ctx, boss);
    const heart = [...sim.entities.values()].find(
      (entity) => entity.templateId === IGNIVAR_APOCALYPSE_ADD_ID,
    );

    expect(heart?.maxHp).toBe(17_500);
    expect(heart?.weapon).toEqual({ min: 0, max: 0, speed: 2.6 });
    expect(heart?.stats.armor).toBe(302);
    expect(heart?.mechanicDamageMult).toBe(2);
    expect(heart?.mechanicHealMult).toBe(2.5);
  });

  it('keeps Chains of the Forge exclusive to Heroic difficulty', () => {
    const { sim, boss } = claimedEncounter();
    const first = addEncounterPlayer(sim, boss, 'Normal Chain One');
    const second = addEncounterPlayer(sim, boss, 'Normal Chain Two');
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);

    updateIgnivarEncounter(sim.ctx, boss);

    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(second.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
  });

  it('holds a due Heroic chain behind an active major cast and its six-second gap', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const first = addEncounterPlayer(sim, boss, 'Spaced Chain One');
    const second = addEncounterPlayer(sim, boss, 'Spaced Chain Two');
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.frontalCastRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(second.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(boss.ignivar.forgeChainsTimer).toBe(IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
  });

  it('lets an armed Falling Cinders impact finish before a due Heroic chain starts', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const first = addEncounterPlayer(sim, boss, 'Meteor Chain One');
    const second = addEncounterPlayer(sim, boss, 'Meteor Chain Two');
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.meteorPoints = [{ x: boss.pos.x + 10, z: boss.pos.z }];
    boss.ignivar.meteorImpactRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(second.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(boss.ignivar.meteorImpactRemaining).toBe(0);
    expect(boss.ignivar.meteorPoints).toEqual([]);

    updateIgnivarEncounter(sim.ctx, boss);

    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
    expect(second.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
  });

  it('starts Heroic chains at 18 seconds and rearms them for exactly 32 seconds', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const first = addEncounterPlayer(sim, boss, 'Cadence Chain One');
    const second = addEncounterPlayer(sim, boss, 'Cadence Chain Two');

    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    isolateForgeChains(boss, boss.ignivar.forgeChainsTimer);
    const firstActivationTicks = Math.ceil(IGNIVAR_FORGE_CHAINS_FIRST_SECONDS / DT);
    for (let tick = 1; tick < firstActivationTicks - 1; tick++) {
      updateIgnivarEncounter(sim.ctx, boss);
    }
    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);

    updateIgnivarEncounter(sim.ctx, boss);

    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
    boss.ignivar.forgeChainsRemaining = DT;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar.forgeChainsTimer).toBe(IGNIVAR_FORGE_CHAINS_EVERY);

    second.pos = { ...first.pos };
    second.prevPos = { ...second.pos };
    const repeatTicks = Math.ceil(IGNIVAR_FORGE_CHAINS_EVERY / DT);
    for (let tick = 0; tick < repeatTicks - 1; tick++) {
      updateIgnivarEncounter(sim.ctx, boss);
    }
    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);

    updateIgnivarEncounter(sim.ctx, boss);

    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
  });

  it('executes both linked players when a Heroic chain is stretched too far', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const first = addEncounterPlayer(sim, boss, 'Heroic Chain One');
    const second = addEncounterPlayer(sim, boss, 'Heroic Chain Two');
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);

    updateIgnivarEncounter(sim.ctx, boss);

    const firstChain = first.auras.find((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID);
    const secondChain = second.auras.find((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID);
    expect(firstChain?.value2).toBe(second.id);
    expect(secondChain?.value2).toBe(first.id);
    expect(firstChain?.duration).toBe(IGNIVAR_FORGE_CHAINS_DURATION_SECONDS);

    second.pos.x = first.pos.x + IGNIVAR_FORGE_CHAINS_BREAK_DISTANCE;
    updateIgnivarEncounter(sim.ctx, boss);

    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
    expect(second.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.forgeChainsAttachGraceRemaining = 0;
    const pairIndex = boss.ignivar.forgeChainsPlayerIds?.findIndex((pair) =>
      pair.includes(first.id),
    );
    if (pairIndex === undefined || pairIndex < 0) throw new Error('Chain pair was not retained');
    boss.ignivar.forgeChainsStrainSeconds[pairIndex] = IGNIVAR_FORGE_CHAINS_STRAIN_SECONDS - DT * 2;
    updateIgnivarEncounter(sim.ctx, boss);

    expect(first.dead).toBe(false);
    expect(second.dead).toBe(false);
    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
    expect(second.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
    expect(boss.ignivar.forgeChainsStrainSeconds[pairIndex]).toBeCloseTo(
      IGNIVAR_FORGE_CHAINS_STRAIN_SECONDS - DT,
    );
    boss.ignivar.forgeChainsRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(second.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(first.dead).toBe(true);
    expect(first.hp).toBe(0);
    expect(second.dead).toBe(true);
    expect(second.hp).toBe(0);
  });

  it('preserves explicit GM and dev invulnerability when a chain severs', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const god = addEncounterPlayer(sim, boss, 'Invulnerable Chain God');
    const profiler = addEncounterPlayer(sim, boss, 'Invulnerable Chain Profiler');
    const gm = addEncounterPlayer(sim, boss, 'Invulnerable Chain GM');
    const mortal = addEncounterPlayer(sim, boss, 'Mortal Chain Partner');
    god.devGod = true;
    profiler.profilerInvulnerable = true;
    gm.gm = true;
    const positions = [
      [god, -20, 0],
      [profiler, 20, 0],
      [gm, -20, 20],
      [mortal, 20, 20],
    ] as const;
    for (const [player, x, z] of positions) {
      player.pos = { x, y: 0, z };
      player.prevPos = { ...player.pos };
    }
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.forgeChainsPlayerIds = [
      [god.id, profiler.id],
      [gm.id, mortal.id],
    ];
    boss.ignivar.forgeChainsRemaining = 1;
    boss.ignivar.forgeChainsAttachGraceRemaining = 0;
    boss.ignivar.forgeChainsStrainSeconds = positions
      .slice(0, 2)
      .map(() => IGNIVAR_FORGE_CHAINS_STRAIN_SECONDS - DT);
    boss.ignivar.forgeChainsLastPositions = positions.map(([player, x, z]) => ({
      playerId: player.id,
      x,
      z,
    }));

    const result = updateIgnivarForgeChains(
      sim.ctx,
      boss,
      boss.ignivar,
      positions.map(([player]) => player),
      false,
    );

    expect(result).toBe('resolved');
    expect(god.dead).toBe(false);
    expect(profiler.dead).toBe(false);
    expect(gm.dead).toBe(false);
    expect(mortal.dead).toBe(true);
  });

  it('links every player into five proximity pairs in a full Heroic raid', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const players = Array.from({ length: 9 }, (_, index) =>
      addEncounterPlayer(sim, boss, `Heroic Chain Group ${index + 1}`),
    );
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);

    updateIgnivarEncounter(sim.ctx, boss);

    const linkedPlayers = [sim.player, ...players].filter((player) =>
      player.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID),
    );
    expect(linkedPlayers).toHaveLength(10);
    expect(boss.ignivar?.forgeChainsPlayerIds).toHaveLength(5);
    const partnerIds = linkedPlayers.map(
      (player) => player.auras.find((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)?.value2,
    );
    expect(new Set(partnerIds).size).toBe(10);
  });

  it('breaks a Heroic chain and kills a third player who crosses it', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const first = addEncounterPlayer(sim, boss, 'Chain Crossing First');
    first.pos = { x: boss.pos.x + 1, y: boss.pos.y, z: boss.pos.z + 2 };
    first.prevPos = { ...first.pos };
    const partner = addEncounterPlayer(sim, boss, 'Chain Crossing Partner');
    partner.pos = { x: boss.pos.x + 5, y: boss.pos.y, z: boss.pos.z + 2 };
    partner.prevPos = { ...partner.pos };
    const intruder = addEncounterPlayer(sim, boss, 'Chain Crossing Intruder');
    intruder.pos = { x: boss.pos.x + 3, y: boss.pos.y, z: boss.pos.z + 7 };
    intruder.prevPos = { ...intruder.pos };
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);

    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar?.forgeChainsPlayerIds).toContainEqual([first.id, partner.id]);
    expect(intruder.auras.find((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)?.value2).toBe(
      sim.player.id,
    );
    intruder.pos = { x: boss.pos.x + 3, y: boss.pos.y, z: boss.pos.z - 3 };
    // Render interpolation history is deliberately stationary: Chains owns
    // its authoritative previous-position sample instead of trusting prevPos.
    intruder.prevPos = { ...intruder.pos };

    updateIgnivarEncounter(sim.ctx, boss);

    expect(intruder.dead).toBe(true);
    expect(intruder.hp).toBe(0);
    expect(first.dead).toBe(false);
    expect(partner.dead).toBe(false);
    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(partner.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(boss.ignivar?.forgeChainsPlayerIds).toBeNull();
  });

  it('resolves every simultaneous crossing during the chains final active tick', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const first = addEncounterPlayer(sim, boss, 'Simultaneous Chain First');
    const second = addEncounterPlayer(sim, boss, 'Simultaneous Chain Second');
    const third = addEncounterPlayer(sim, boss, 'Simultaneous Chain Third');
    const fourth = addEncounterPlayer(sim, boss, 'Simultaneous Chain Fourth');
    const firstIntruder = addEncounterPlayer(sim, boss, 'Simultaneous Intruder One');
    const secondIntruder = addEncounterPlayer(sim, boss, 'Simultaneous Intruder Two');
    const positions = [
      [first, -5, 0],
      [second, 5, 0],
      [third, -5, 10],
      [fourth, 5, 10],
      [firstIntruder, 0, 2],
      [secondIntruder, 0, 12],
    ] as const;
    for (const [player, x, z] of positions) {
      player.pos = { x, y: 0, z };
      player.prevPos = { ...player.pos };
    }
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.forgeChainsPlayerIds = [
      [first.id, second.id],
      [third.id, fourth.id],
    ];
    boss.ignivar.forgeChainsRemaining = DT;
    boss.ignivar.forgeChainsAttachGraceRemaining = 0;
    boss.ignivar.forgeChainsStrainSeconds = [0, 0];
    boss.ignivar.forgeChainsLastPositions = positions.map(([player, x, z]) => ({
      playerId: player.id,
      x,
      z: player.id === firstIntruder.id ? -2 : player.id === secondIntruder.id ? 8 : z,
    }));

    const result = updateIgnivarForgeChains(
      sim.ctx,
      boss,
      boss.ignivar,
      positions.map(([player]) => player),
      false,
    );

    expect(result).toBe('resolved');
    expect(firstIntruder.dead).toBe(true);
    expect(secondIntruder.dead).toBe(true);
    expect([first, second, third, fourth].every((player) => !player.dead)).toBe(true);
    expect(boss.ignivar.forgeChainsPlayerIds).toBeNull();
  });

  it('attaches a distant Heroic pair before allowing the tether to strain', () => {
    const { sim, boss } = claimedHeroicEncounter();
    sim.player.pos = { x: boss.pos.x - 20, y: boss.pos.y, z: boss.pos.z };
    sim.player.prevPos = { ...sim.player.pos };
    const partner = addEncounterPlayer(sim, boss, 'Distant Chain Partner');
    partner.pos = { x: boss.pos.x + 20, y: boss.pos.y, z: boss.pos.z };
    partner.prevPos = { ...partner.pos };
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);

    updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.auras.find((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)?.value2).toBe(
      partner.id,
    );
    expect(partner.hp).toBe(partner.maxHp);
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    const pairIndex = boss.ignivar.forgeChainsPlayerIds?.findIndex((pair) =>
      pair.includes(sim.player.id),
    );
    if (pairIndex === undefined || pairIndex < 0) throw new Error('Distant pair was not retained');
    boss.ignivar.forgeChainsAttachGraceRemaining = 0;
    boss.ignivar.forgeChainsStrainSeconds[pairIndex] = IGNIVAR_FORGE_CHAINS_STRAIN_SECONDS / 2;
    partner.pos = { ...sim.player.pos, x: sim.player.pos.x + 2 };
    partner.prevPos = { ...partner.pos };

    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar.forgeChainsStrainSeconds[pairIndex]).toBe(0);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
  });

  it('resolves safely when linked Heroic players stay together until expiry', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const first = addEncounterPlayer(sim, boss, 'Failed Chain One');
    const second = addEncounterPlayer(sim, boss, 'Failed Chain Two');
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.forgeChainsRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(first.hp).toBe(first.maxHp);
    expect(second.hp).toBe(second.maxHp);
    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(second.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
  });

  it('clears an active Heroic chain when the encounter resets', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const first = addEncounterPlayer(sim, boss, 'Reset Chain One');
    const second = addEncounterPlayer(sim, boss, 'Reset Chain Two');
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);
    updateIgnivarEncounter(sim.ctx, boss);
    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);
    expect(second.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(true);

    resetIgnivarEncounter(sim.ctx, boss);

    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(second.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
    expect(boss.ignivar).toBeUndefined();
  });

  it('finishes an active Heroic chain before Last Inferno can begin', () => {
    const { sim, boss } = claimedHeroicEncounter();
    addEncounterPlayer(sim, boss, 'Phase Chain One');
    addEncounterPlayer(sim, boss, 'Phase Chain Two');
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.forgeJudgmentPhase = 'done';
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_LAST_INFERNO_HP_THRESHOLD);

    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar.forgeChainsPlayerIds).not.toBeNull();
    expect(boss.ignivar.lastInfernoTriggered).toBe(false);
  });

  it('cancels Heroic chains without damage when either partner leaves the arena', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const first = addEncounterPlayer(sim, boss, 'Leaving Chain One');
    const second = addEncounterPlayer(sim, boss, 'Leaving Chain Two');
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    const firstHp = first.hp;
    const secondHp = second.hp;

    leaveDungeon(sim.ctx, first.id);
    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar.forgeChainsPlayerIds).toBeNull();
    expect(first.hp).toBe(firstHp);
    expect(second.hp).toBe(secondHp);
    expect(second.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
  });

  it('cancels Heroic chains without damage when the second partner leaves the arena', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const first = addEncounterPlayer(sim, boss, 'Staying Chain Partner');
    const second = addEncounterPlayer(sim, boss, 'Second Leaving Chain Partner');
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    const firstHp = first.hp;
    const secondHp = second.hp;

    leaveDungeon(sim.ctx, second.id);
    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar.forgeChainsPlayerIds).toBeNull();
    expect(first.hp).toBe(firstHp);
    expect(second.hp).toBe(secondHp);
    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
  });

  it('cancels Heroic chains without damage when the second partner dies', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const first = addEncounterPlayer(sim, boss, 'Living Chain Partner');
    const second = addEncounterPlayer(sim, boss, 'Dead Chain Partner');
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    const firstHp = first.hp;
    second.dead = true;
    second.hp = 0;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar.forgeChainsPlayerIds).toBeNull();
    expect(first.hp).toBe(firstHp);
    expect(first.auras.some((aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID)).toBe(false);
  });

  it('ships the Normal cadence as explicit tuning constants', () => {
    expect(IGNIVAR_FORGE_CHAINS_FIRST_SECONDS).toBe(18);
    expect(IGNIVAR_FORGE_CHAINS_EVERY).toBe(32);
    expect(IGNIVAR_FORGE_CHAINS_DURATION_SECONDS).toBe(8);
    expect(IGNIVAR_FORGE_CHAINS_BREAK_DISTANCE).toBe(10);
    expect(IGNIVAR_FORGE_CHAINS_PAIR_COUNT).toBe(5);
    expect(IGNIVAR_FORGE_CHAINS_ATTACH_GRACE_SECONDS).toBe(2.5);
    expect(IGNIVAR_FORGE_CHAINS_STRAIN_SECONDS).toBe(0.75);
    expect(IGNIVAR_BRAND_TARGETS_NORMAL).toBe(3);
    expect(IGNIVAR_BRAND_EVERY).toBe(28);
    expect(IGNIVAR_BRAND_MAX_STACKS).toBe(3);
    expect(IGNIVAR_FORGE_STRIKE_EVERY).toBe(14);
    expect(IGNIVAR_FORGE_STRIKE_MAX_HP).toBe(0.35);
    expect(IGNIVAR_MAJOR_ABILITY_GAP_SECONDS).toBe(6);
    expect(IGNIVAR_FIRST_FORGE_WAVE_SECONDS).toBe(44);
    expect(IGNIVAR_FORGE_WAVE_EVERY).toBe(46);
    expect(IGNIVAR_FORGE_WAVE_WINDUP_SECONDS).toBe(2.5);
    expect(IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS).toBe(3);
    expect(IGNIVAR_FORGE_WAVE_DAMAGE_MAX_HP).toBe(0.35);
    expect(IGNIVAR_FORGE_WAVE_KNOCKBACK).toBe(4);
    expect(IGNIVAR_MOLTEN_ARMOR_DURATION).toBe(30);
    expect(IGNIVAR_MOLTEN_ARMOR_PER_STACK).toBe(0.35);
    expect(IGNIVAR_FRONTAL_CAST_SECONDS).toBe(3);
    expect(IGNIVAR_CONDUIT_ACTIVE_SECONDS).toBe(10);
    expect(IGNIVAR_LAST_INFERNO_HP_THRESHOLD).toBe(0.2);
    expect(IGNIVAR_LAST_INFERNO_SECONDS).toBe(45);
    expect(IGNIVAR_SKYFIRE_CAST_SECONDS).toBe(3);
    expect(IGNIVAR_FIRST_SKYFIRE_SECONDS).toBe(16);
    expect(IGNIVAR_SKYFIRE_EVERY).toBe(20);
    expect(IGNIVAR_SKYFIRE_DAMAGE_MAX_HP).toBe(0.45);
    expect(IGNIVAR_SKYFIRE_RANGE).toBe(24);
    expect(IGNIVAR_SKYFIRE_HALF_ANGLE).toBe(Math.PI / 10);
    expect(IGNIVAR_SKYFIRE_CONE_COUNT).toBe(3);
    expect(IGNIVAR_FIRST_METEOR_SECONDS).toBe(13);
    expect(IGNIVAR_METEOR_EVERY).toBe(17);
    expect(IGNIVAR_METEOR_TELEGRAPH_SECONDS).toBe(2.5);
    expect(IGNIVAR_METEOR_REVEAL_DELAY_SECONDS).toBe(0.75);
    expect(IGNIVAR_METEOR_DAMAGE_MAX_HP).toBe(0.35);
    expect(IGNIVAR_FIRST_ROTATING_RAYS_SECONDS).toBe(32);
    expect(IGNIVAR_ROTATING_RAYS_EVERY).toBe(40);
    expect(IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS).toBe(2);
    expect(IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS).toBe(8);
    expect(IGNIVAR_ROTATING_RAYS_ANGULAR_SPEED).toBe(Math.PI / 10);
    expect(IGNIVAR_ROTATING_RAYS_PULSE_SECONDS).toBe(0.5);
    expect(IGNIVAR_ROTATING_RAYS_DAMAGE_MAX_HP).toBe(0.2);
    expect(IGNIVAR_SOAK_CAST_SECONDS).toBe(6);
    expect(IGNIVAR_FIRST_SOAK_SECONDS).toBe(24);
    expect(IGNIVAR_SOAK_EVERY).toBe(34);
    expect(IGNIVAR_SOAK_REQUIRED_PLAYERS).toBe(4);
    expect(IGNIVAR_SOAK_RADIUS).toBe(5.5);
    expect(IGNIVAR_SOAK_SHARED_MAX_HP).toBe(1.2);
  });

  it('expands Forge Wave once through unsafe arcs while opposite gaps remain safe', () => {
    const { sim, boss } = claimedEncounter();
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.forgeWaveTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.castingAbility).toBe(IGNIVAR_FORGE_WAVE_CAST_ID);
    expect(boss.castTotal).toBe(IGNIVAR_FORGE_WAVE_WINDUP_SECONDS);
    expect(boss.channeling).toBe(false);
    const lockedFacing = boss.ignivar.forgeWaveFacing;

    const safe = addEncounterPlayer(sim, boss, 'Safe Gap');
    const secondUnsafe = addEncounterPlayer(sim, boss, 'Second Unsafe');
    const pointAt = (angle: number, radius: number) => ({
      x: boss.pos.x + Math.sin(angle) * radius,
      y: boss.pos.y,
      z: boss.pos.z + Math.cos(angle) * radius,
    });
    sim.player.pos = pointAt(lockedFacing + Math.PI / 2, 10);
    sim.player.prevPos = { ...sim.player.pos };
    safe.pos = pointAt(lockedFacing, 10);
    safe.prevPos = { ...safe.pos };
    secondUnsafe.pos = pointAt(lockedFacing - Math.PI / 2, 10);
    secondUnsafe.prevPos = { ...secondUnsafe.pos };

    boss.ignivar.forgeWaveWindupRemaining = 0.01;
    const releaseEvents = sim.tick();
    const releaseBursts = releaseEvents.filter(
      (event): event is Extract<SimEvent, { type: 'spellfxAt' }> =>
        event.type === 'spellfxAt' && event.ability === IGNIVAR_FORGE_WAVE_CAST_ID,
    );
    expect(releaseBursts).toHaveLength(1);
    expect(releaseBursts[0]).toMatchObject({
      x: boss.pos.x,
      z: boss.pos.z,
      school: 'fire',
      fx: 'burst',
      sourceId: boss.id,
    });
    expect(releaseBursts[0]?.radius).toBeUndefined();
    expect(boss.channeling).toBe(true);
    expect(boss.castTotal).toBe(IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS);

    boss.ignivar.forgeWaveRadius = 9;
    boss.ignivar.forgeWaveActiveRemaining =
      IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS * (1 - 10 / IGNIVAR_FORGE_WAVE_RANGE) + DT;
    const unsafeHp = sim.player.hp;
    const secondUnsafeHp = secondUnsafe.hp;
    const safeHp = safe.hp;
    const unsafeDistance = Math.hypot(sim.player.pos.x - boss.pos.x, sim.player.pos.z - boss.pos.z);
    updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(
      unsafeHp - Math.ceil(sim.player.maxHp * IGNIVAR_FORGE_WAVE_DAMAGE_MAX_HP),
    );
    const pushedDistance = Math.hypot(sim.player.pos.x - boss.pos.x, sim.player.pos.z - boss.pos.z);
    expect(pushedDistance).toBeCloseTo(unsafeDistance + IGNIVAR_FORGE_WAVE_KNOCKBACK, 5);
    expect(safe.hp).toBe(safeHp);
    expect(secondUnsafe.hp).toBe(
      secondUnsafeHp - Math.ceil(secondUnsafe.maxHp * IGNIVAR_FORGE_WAVE_DAMAGE_MAX_HP),
    );
    expect(boss.ignivar.forgeWaveHitPlayerIds).toEqual([sim.player.id, secondUnsafe.id]);
    expect(boss.facing).toBe(lockedFacing);

    const hpAfterFirstHit = sim.player.hp;
    const secondHpAfterFirstHit = secondUnsafe.hp;
    const nextRadius = boss.ignivar.forgeWaveRadius + 0.5;
    sim.player.pos = pointAt(lockedFacing + Math.PI / 2, nextRadius);
    sim.player.prevPos = { ...sim.player.pos };
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.hp).toBe(hpAfterFirstHit);
    expect(secondUnsafe.hp).toBe(secondHpAfterFirstHit);

    boss.ignivar.forgeWaveActiveRemaining = DT;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.castingAbility).toBeNull();
    expect(boss.channeling).toBe(false);
    expect(boss.castTotal).toBe(0);
    expect(boss.castRemaining).toBe(0);
    expect(boss.castTargetId).toBeNull();
    expect(boss.castAim).toBeNull();
  });

  it.each([
    {
      name: 'straight wall',
      bossOffset: { x: -25, z: 0 },
      victimOffset: { x: 25, z: 0 },
    },
    {
      name: 'diagonal wall',
      bossOffset: { x: -22, z: -22 },
      victimOffset: { x: 22, z: 22 },
    },
  ])(
    'sweeps the opposite $name, damages once, and only nudges its victim',
    ({ bossOffset, victimOffset }) => {
      const { sim, boss } = claimedEncounter(8126);
      const origin = instanceOrigin(DUNGEONS.ignivar_raid_arena.index, 0);
      boss.pos = { x: origin.x + bossOffset.x, y: boss.pos.y, z: origin.z + bossOffset.z };
      sim.player.pos = {
        x: origin.x + victimOffset.x,
        y: sim.player.pos.y,
        z: origin.z + victimOffset.z,
      };
      sim.player.prevPos = { ...sim.player.pos };
      updateIgnivarEncounter(sim.ctx, boss);
      if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
      boss.ignivar.frontalTimer = 999;
      boss.ignivar.skyfireTimer = 999;
      boss.ignivar.rotatingRaysTimer = 999;
      boss.ignivar.forgeWaveWindupRemaining = 0;
      boss.ignivar.forgeWaveActiveRemaining = IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS;
      boss.ignivar.forgeWaveFacing = 0;
      boss.ignivar.forgeWaveRadius = 0;
      boss.ignivar.forgeWaveHitPlayerIds = [];
      boss.castingAbility = IGNIVAR_FORGE_WAVE_CAST_ID;
      boss.channeling = true;
      const hpBefore = sim.player.hp;
      const positionBefore = { ...sim.player.pos };

      for (let tick = 0; tick < IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS / DT; tick++) {
        updateIgnivarEncounter(sim.ctx, boss);
      }

      const shell = IGNIVAR_LAYOUT.shellPolygon;
      if (!shell) throw new Error('Ignivar arena polygon is missing');
      const roomDiameter = Math.max(
        ...shell.flatMap((from) => shell.map((to) => Math.hypot(to.x - from.x, to.z - from.z))),
      );
      expect(IGNIVAR_FORGE_WAVE_RANGE).toBeGreaterThanOrEqual(roomDiameter);
      expect(IGNIVAR_FORGE_WAVE_KNOCKBACK).toBeLessThan(IGNIVAR_FORGE_WAVE_RANGE / 10);
      expect(sim.player.hp).toBe(
        hpBefore - Math.ceil(sim.player.maxHp * IGNIVAR_FORGE_WAVE_DAMAGE_MAX_HP),
      );
      expect(
        Math.hypot(sim.player.pos.x - positionBefore.x, sim.player.pos.z - positionBefore.z),
      ).toBeLessThanOrEqual(IGNIVAR_FORGE_WAVE_KNOCKBACK);
      const localX = sim.player.pos.x - origin.x;
      const localZ = sim.player.pos.z - origin.z;
      expect(polygonContainsPoint(shell, localX, localZ)).toBe(true);
    },
  );

  it('replays the complete Forge Wave windup, sweep, and cadence deterministically', () => {
    const first = forgeWaveCadenceTrace(418);
    expect(forgeWaveCadenceTrace(418)).toEqual(first);
    expect(first).toEqual([
      {
        startTick: 1023,
        endTick: 1133,
        facingSlot: 6,
        windupFrames: 50,
        activeFrames: 60,
      },
      {
        startTick: 2179,
        endTick: 2289,
        facingSlot: 1,
        windupFrames: 50,
        activeFrames: 60,
      },
    ]);
  });

  it('warns before three rays rotate, damages crossings, and reverses the next cast', () => {
    const { sim, boss } = claimedEncounter(8120);
    const safePlayer = addEncounterPlayer(sim, boss, 'Ray Gap');
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 999;
    boss.ignivar.rotatingRaysTimer = 0;
    boss.swingTimer = 999;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.castingAbility).toBe(IGNIVAR_ROTATING_RAYS_CAST_ID);
    expect(boss.castTotal).toBe(
      IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS + IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS,
    );
    expect(boss.ignivar.rotatingRaysDirection).toBe(1);
    const lockedFacing = boss.ignivar.rotatingRaysFacing;
    sim.player.hp = sim.player.maxHp;
    safePlayer.hp = safePlayer.maxHp;
    sim.player.pos = {
      x: boss.pos.x + Math.sin(lockedFacing) * 15,
      y: boss.pos.y,
      z: boss.pos.z + Math.cos(lockedFacing) * 15,
    };
    safePlayer.pos = {
      x: boss.pos.x + Math.sin(lockedFacing + Math.PI / 3) * 15,
      y: boss.pos.y,
      z: boss.pos.z + Math.cos(lockedFacing + Math.PI / 3) * 15,
    };
    boss.ignivar.rotatingRaysWindupRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(safePlayer.hp).toBe(safePlayer.maxHp);
    expect(boss.facing).toBeCloseTo(lockedFacing, 8);

    const damagingFacing = lockedFacing + IGNIVAR_ROTATING_RAYS_ANGULAR_SPEED * DT;
    sim.player.pos = {
      x: boss.pos.x + Math.sin(damagingFacing) * 15,
      y: boss.pos.y,
      z: boss.pos.z + Math.cos(damagingFacing) * 15,
    };
    safePlayer.pos = {
      x: boss.pos.x + Math.sin(damagingFacing + Math.PI / 3) * 15,
      y: boss.pos.y,
      z: boss.pos.z + Math.cos(damagingFacing + Math.PI / 3) * 15,
    };
    boss.ignivar.rotatingRaysPulseTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.facing).toBeCloseTo(damagingFacing, 8);
    expect(sim.player.hp).toBe(
      sim.player.maxHp - Math.ceil(sim.player.maxHp * IGNIVAR_ROTATING_RAYS_DAMAGE_MAX_HP),
    );
    expect(safePlayer.hp).toBe(safePlayer.maxHp);

    boss.ignivar.rotatingRaysActiveRemaining = DT;
    boss.ignivar.rotatingRaysPulseTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.castingAbility).toBeNull();
    boss.ignivar.rotatingRaysTimer = 0;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar.rotatingRaysDirection).toBe(-1);
  });

  it('keeps a clear gap after Revolving Inferno and does not overlap Shared Pyre', () => {
    const { sim, boss } = claimedEncounter(8122);
    sim.player.devGod = true;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.rotatingRaysTimer = 0;
    boss.ignivar.forgeWaveTimer = 999;
    boss.ignivar.soakTimer = 999;
    boss.swingTimer = 999;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.castingAbility).toBe(IGNIVAR_ROTATING_RAYS_CAST_ID);

    boss.ignivar.frontalTimer = 0;
    boss.ignivar.skyfireTimer = 0;
    boss.ignivar.forgeWaveTimer = 0;
    boss.ignivar.soakTimer = 0;
    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.castingAbility).toBe(IGNIVAR_ROTATING_RAYS_CAST_ID);
    expect(boss.ignivar.soakTargetId).toBeNull();
    expect(boss.ignivar.soakTimer).toBe(0);

    boss.ignivar.rotatingRaysWindupRemaining = 0;
    boss.ignivar.rotatingRaysActiveRemaining = DT;
    boss.ignivar.rotatingRaysPulseTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.castingAbility).toBeNull();
    expect(boss.ignivar.frontalTimer).toBeGreaterThanOrEqual(IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
    expect(boss.ignivar.skyfireTimer).toBeGreaterThanOrEqual(IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
    expect(boss.ignivar.forgeWaveTimer).toBeGreaterThanOrEqual(IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
    expect(boss.ignivar.soakTimer).toBeGreaterThanOrEqual(IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
  });

  it('applies the six-second gap after every cast-based major ability', () => {
    const assertReleaseGap = (
      seed: number,
      primeRelease: (boss: ReturnType<typeof claimedEncounter>['boss']) => void,
    ) => {
      const { sim, boss } = claimedEncounter(seed);
      sim.player.devGod = true;
      updateIgnivarEncounter(sim.ctx, boss);
      if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
      boss.ignivar.brandTimer = 999;
      boss.ignivar.forgeStrikeTimer = 999;
      boss.ignivar.frontalTimer = 999;
      boss.ignivar.skyfireTimer = 0;
      boss.ignivar.rotatingRaysTimer = 999;
      boss.ignivar.forgeWaveTimer = 999;
      boss.ignivar.soakTimer = 999;
      boss.swingTimer = 999;
      primeRelease(boss);

      updateIgnivarEncounter(sim.ctx, boss);

      expect(boss.castingAbility).toBeNull();
      expect(boss.ignivar.skyfireTimer).toBeGreaterThanOrEqual(6);
    };

    assertReleaseGap(8123, (boss) => {
      if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
      boss.ignivar.frontalCastRemaining = DT;
    });
    assertReleaseGap(8124, (boss) => {
      if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
      boss.ignivar.skyfireCastRemaining = DT;
    });
    assertReleaseGap(8125, (boss) => {
      if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
      boss.ignivar.forgeWaveActiveRemaining = DT;
    });
  });

  it('keeps Revolving Inferno active for ten seconds and turns the rays by 144 degrees', () => {
    const { sim, boss } = claimedEncounter(8121);
    sim.player.devGod = true;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 999;
    boss.ignivar.overlapTimer = 999;
    boss.ignivar.rotatingRaysTimer = 0;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    const startFacing = boss.ignivar.rotatingRaysFacing;

    let castTicks = 0;
    while (boss.castingAbility === IGNIVAR_ROTATING_RAYS_CAST_ID && castTicks < 400) {
      updateIgnivarEncounter(sim.ctx, boss);
      castTicks++;
    }

    expect(castTicks * DT).toBeCloseTo(
      IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS + IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS,
      5,
    );
    expect(boss.ignivar.rotatingRaysFacing - startFacing).toBeCloseTo(
      IGNIVAR_ROTATING_RAYS_ANGULAR_SPEED * IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS,
      8,
    );
    expect(boss.ignivar.rotatingRaysTimer).toBeCloseTo(
      IGNIVAR_ROTATING_RAYS_EVERY -
        IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS -
        IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS,
      5,
    );
  });

  it('restores the boss facing when the encounter resets during rotating rays', () => {
    const { sim, boss } = claimedEncounter(8126);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 999;
    boss.ignivar.rotatingRaysTimer = 0;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    const lockedBossFacing = boss.ignivar.rotatingRaysBossFacing;
    boss.ignivar.rotatingRaysWindupRemaining = 0;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.facing).not.toBeCloseTo(lockedBossFacing, 8);

    resetIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar).toBeUndefined();
    expect(boss.facing).toBeCloseTo(lockedBossFacing, 8);
  });

  it('pulses an active rotating ray every half second without floating-point drift', () => {
    const { sim, boss } = claimedEncounter(8122);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 999;
    boss.ignivar.overlapTimer = 999;
    boss.ignivar.rotatingRaysTimer = 0;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    boss.ignivar.rotatingRaysWindupRemaining = 0;
    const pulseTicks: number[] = [];

    for (let tick = 1; tick <= 21; tick++) {
      const nextFacing =
        boss.ignivar.rotatingRaysFacing +
        boss.ignivar.rotatingRaysDirection * IGNIVAR_ROTATING_RAYS_ANGULAR_SPEED * DT;
      sim.player.pos = {
        x: boss.pos.x + Math.sin(nextFacing) * 15,
        y: boss.pos.y,
        z: boss.pos.z + Math.cos(nextFacing) * 15,
      };
      sim.player.hp = sim.player.maxHp;
      updateIgnivarEncounter(sim.ctx, boss);
      if (sim.player.hp < sim.player.maxHp) pulseTicks.push(tick);
    }

    expect(pulseTicks).toEqual([1, 11, 21]);
  });

  it('telegraphs three skyfire cones, then releases three fire eruptions at cast end', () => {
    const { sim, boss } = claimedEncounter(8102);
    const safePlayer = addEncounterPlayer(sim, boss, 'Safe Raider');
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.soakTimer = 999;
    boss.ignivar.skyfireTimer = 0;

    const events = sim.tick();

    expect(boss.castingAbility).toBe(IGNIVAR_SKYFIRE_CAST_ID);
    expect(boss.castTotal).toBe(IGNIVAR_SKYFIRE_CAST_SECONDS);
    expect(
      events.some(
        (event) =>
          event.type === 'spellfxAt' &&
          (event.fx === 'meteorFall' || event.fx === 'ambientMeteorFall'),
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'spellfxAt' &&
          event.fx === 'burst' &&
          event.ability === IGNIVAR_SKYFIRE_CAST_ID,
      ),
    ).toBe(false);
    const facing = boss.ignivar.skyfireFacing;
    const conePlayers = [
      sim.player,
      addEncounterPlayer(sim, boss, 'Second Cone'),
      addEncounterPlayer(sim, boss, 'Third Cone'),
    ];
    const gapPlayers = [
      safePlayer,
      addEncounterPlayer(sim, boss, 'Second Gap'),
      addEncounterPlayer(sim, boss, 'Third Gap'),
    ];
    for (let index = 0; index < conePlayers.length; index++) {
      const angle = facing + (index * Math.PI * 2) / IGNIVAR_SKYFIRE_CONE_COUNT;
      conePlayers[index].pos = {
        x: boss.pos.x + Math.sin(angle) * 12,
        y: boss.pos.y,
        z: boss.pos.z + Math.cos(angle) * 12,
      };
    }
    for (let index = 0; index < gapPlayers.length; index++) {
      const angle = facing + Math.PI / 3 + (index * Math.PI * 2) / IGNIVAR_SKYFIRE_CONE_COUNT;
      gapPlayers[index].pos = {
        x: boss.pos.x + Math.sin(angle) * 12,
        y: boss.pos.y,
        z: boss.pos.z + Math.cos(angle) * 12,
      };
    }
    for (const player of [...conePlayers, ...gapPlayers]) player.hp = player.maxHp;
    const midCastEvents = sim.tick();
    expect(boss.castingAbility).toBe(IGNIVAR_SKYFIRE_CAST_ID);
    expect(boss.ignivar.skyfireCastRemaining).toBeGreaterThan(DT);
    expect(
      midCastEvents.some(
        (event) =>
          event.type === 'spellfxAt' &&
          event.fx === 'burst' &&
          event.ability === IGNIVAR_SKYFIRE_CAST_ID,
      ),
    ).toBe(false);
    boss.ignivar.skyfireCastRemaining = DT;
    const lockedFacing = boss.ignivar.skyfireFacing;
    safePlayer.pos = { x: boss.pos.x - 12, y: boss.pos.y, z: boss.pos.z };

    const releaseEvents = sim.tick();

    const fireEruptions = releaseEvents.filter(
      (event): event is Extract<SimEvent, { type: 'spellfxAt' }> =>
        event.type === 'spellfxAt' &&
        event.fx === 'burst' &&
        event.ability === IGNIVAR_SKYFIRE_CAST_ID,
    );
    expect(fireEruptions).toHaveLength(IGNIVAR_SKYFIRE_CONE_COUNT);
    for (let cone = 0; cone < IGNIVAR_SKYFIRE_CONE_COUNT; cone++) {
      const eruption = fireEruptions[cone];
      const eruptionFacing = lockedFacing + (cone * Math.PI * 2) / IGNIVAR_SKYFIRE_CONE_COUNT;
      expect(eruption.x).toBeCloseTo(
        boss.pos.x + Math.sin(eruptionFacing) * IGNIVAR_SKYFIRE_RANGE,
        8,
      );
      expect(eruption.z).toBeCloseTo(
        boss.pos.z + Math.cos(eruptionFacing) * IGNIVAR_SKYFIRE_RANGE,
        8,
      );
      expect(eruption.school).toBe('fire');
      expect(eruption.sourceId).toBe(boss.id);
      expect(eruption.radius).toBeUndefined();
    }

    for (const player of conePlayers) {
      expect(player.hp).toBe(
        player.maxHp - Math.ceil(player.maxHp * IGNIVAR_SKYFIRE_DAMAGE_MAX_HP),
      );
    }
    for (const player of gapPlayers) expect(player.hp).toBe(player.maxHp);
    expect(boss.ignivar.skyfireFacing).toBe(lockedFacing);
    expect(boss.castingAbility).toBeNull();
  });

  it('warns with red meteor circles independently, then damages only on impact', () => {
    const { sim, boss } = claimedEncounter(8103);
    const safePlayer = addEncounterPlayer(sim, boss, 'Meteor Safe');
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.soakTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.forgeWaveTimer = 999;
    boss.ignivar.skyfireTimer = 0;
    boss.ignivar.meteorTimer = 0;
    boss.swingTimer = 999;
    sim.player.hp = sim.player.maxHp;
    safePlayer.hp = safePlayer.maxHp;

    const events = sim.tick();

    expect(boss.castingAbility).toBe(IGNIVAR_SKYFIRE_CAST_ID);
    const warnings = events.filter(
      (event): event is Extract<SimEvent, { type: 'spellfxAt' }> =>
        event.type === 'spellfxAt' &&
        event.fx === 'meteorFall' &&
        event.ability === IGNIVAR_METEOR_CAST_ID,
    );
    expect(warnings).toHaveLength(IGNIVAR_METEOR_COUNT);
    expect(warnings.every((warning) => warning.radius === IGNIVAR_METEOR_RADIUS)).toBe(true);
    expect(warnings.every((warning) => warning.duration === IGNIVAR_METEOR_TELEGRAPH_SECONDS)).toBe(
      true,
    );
    expect(
      warnings.every((warning) => warning.warningLead === IGNIVAR_METEOR_REVEAL_DELAY_SECONDS),
    ).toBe(true);
    expect(warnings.map((warning) => warning.persistentId)).toEqual(
      sim.activeIgnivarMeteors.map((warning) => warning.id),
    );
    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(boss.ignivar.meteorTimer).toBeCloseTo(IGNIVAR_METEOR_EVERY, 8);

    const impact = boss.ignivar.meteorPoints[0];
    sim.player.pos = { x: impact.x, y: boss.pos.y, z: impact.z };
    safePlayer.pos = { ...boss.pos };
    sim.tick();
    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(safePlayer.hp).toBe(safePlayer.maxHp);

    boss.ignivar.meteorImpactRemaining = DT;
    const impactEvents = sim
      .tick()
      .filter(
        (event): event is Extract<SimEvent, { type: 'spellfxAt' }> =>
          event.type === 'spellfxAt' && event.fx === 'meteorImpact',
      );

    expect(sim.player.hp).toBe(
      sim.player.maxHp - Math.ceil(sim.player.maxHp * IGNIVAR_METEOR_DAMAGE_MAX_HP),
    );
    expect(safePlayer.hp).toBe(safePlayer.maxHp);
    expect(impactEvents.map((event) => event.persistentId)).toEqual(
      warnings.map((warning) => warning.persistentId),
    );
    expect(boss.ignivar.meteorPoints).toEqual([]);
  });

  it('starts Falling Cinders naturally after 13 seconds and every 17 seconds thereafter', () => {
    const { sim, boss } = claimedEncounter(8104);
    sim.player.devGod = true;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.forgeWaveTimer = 999;
    boss.ignivar.overlapTimer = 999;
    boss.swingTimer = 999;
    const warningTicks: number[] = [];

    for (let tick = 1; tick <= 650 && warningTicks.length < 2; tick++) {
      const events = sim.tick();
      if (
        events.some(
          (event) =>
            event.type === 'spellfxAt' &&
            event.fx === 'meteorFall' &&
            event.ability === IGNIVAR_METEOR_CAST_ID,
        )
      ) {
        warningTicks.push(tick);
      }
    }

    expect(warningTicks).toEqual([259, 599]);
  });

  it('keeps Rain of Cinders on cadence without crowding another major ability', () => {
    const { sim, boss } = claimedEncounter(8110);
    sim.player.devGod = true;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.soakTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.overlapTimer = 999;
    boss.swingTimer = 999;
    sim.player.pos = { x: boss.pos.x + 30, y: boss.pos.y, z: boss.pos.z };
    const starts: number[] = [];
    let previous: string | null = boss.castingAbility;

    for (let i = 0; i < 1_400 && starts.length < 2; i++) {
      sim.tick();
      if (boss.castingAbility === IGNIVAR_SKYFIRE_CAST_ID && previous !== boss.castingAbility) {
        starts.push(sim.time);
      }
      previous = boss.castingAbility;
    }

    expect(starts).toHaveLength(2);
    expect(starts[0]).toBeGreaterThanOrEqual(IGNIVAR_FIRST_SKYFIRE_SECONDS);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(IGNIVAR_SKYFIRE_EVERY);
  });

  it('marks a non-tank for a four-player soak and splits its damage', () => {
    const { sim, boss } = claimedEncounter(8103);
    const offTank = addEncounterPlayer(sim, boss, 'Off Tank', 'paladin');
    sim.setPlayerLevel(20, offTank.id);
    expect(sim.setSpec('protection', offTank.id)).toBe(true);
    const raiders = [
      offTank,
      addEncounterPlayer(sim, boss, 'Soaker One'),
      addEncounterPlayer(sim, boss, 'Soaker Two'),
      addEncounterPlayer(sim, boss, 'Soaker Three'),
      addEncounterPlayer(sim, boss, 'Soaker Four'),
    ];
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);

    const marked = sim.entities.get(boss.ignivar.soakTargetId ?? -1);
    if (!marked) throw new Error('Ignivar did not mark a soak target');
    expect(marked.id).not.toBe(sim.player.id);
    expect(marked.id).not.toBe(offTank.id);
    const soakAura = marked.auras.find((aura) => aura.id === IGNIVAR_SOAK_AURA_ID);
    expect(soakAura).toBeDefined();
    if (!soakAura) throw new Error('Shared Pyre aura was not applied');
    expect(soakAura.school).toBe('physical');
    expect(isDispellableAura(soakAura, false)).toBe(false);
    expect(isDispellableAura({ ...soakAura, encounterOwned: undefined }, false)).toBe(false);
    const soakers = [marked, ...raiders.filter((player) => player.id !== marked.id).slice(0, 3)];
    const outsider = raiders.find((player) => !soakers.includes(player));
    if (!outsider) throw new Error('Soak outsider was not found');
    for (const player of soakers) {
      player.pos = { ...marked.pos };
      player.hp = player.maxHp;
    }
    outsider.pos = { x: marked.pos.x + 20, y: marked.pos.y, z: marked.pos.z };
    outsider.hp = outsider.maxHp;
    boss.ignivar.soakRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    for (const player of soakers) {
      expect(player.hp).toBe(
        player.maxHp -
          Math.ceil(player.maxHp * (IGNIVAR_SOAK_SHARED_MAX_HP / IGNIVAR_SOAK_REQUIRED_PLAYERS)),
      );
    }
    expect(outsider.hp).toBe(outsider.maxHp);
    expect(marked.auras.some((aura) => aura.id === IGNIVAR_SOAK_AURA_ID)).toBe(false);
    expect(boss.ignivar.soakTargetId).toBeNull();
  });

  it('splits Shared Pyre only across players inside even when fewer than four gather', () => {
    const { sim, boss } = claimedEncounter(8104);
    const markedCandidate = addEncounterPlayer(sim, boss, 'Marked Candidate');
    const secondRaider = addEncounterPlayer(sim, boss, 'Second Raider');
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 0;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    const marked = sim.entities.get(boss.ignivar.soakTargetId ?? -1);
    if (!marked) throw new Error('Ignivar did not mark a soak target');
    const raiders = [sim.player, markedCandidate, secondRaider];
    const companion = raiders.find((player) => player.id !== marked.id);
    const outsider = raiders.find(
      (player) => player.id !== marked.id && player.id !== companion?.id,
    );
    if (!companion || !outsider) throw new Error('Shared Pyre test roster is incomplete');
    for (const player of raiders) player.hp = player.maxHp;
    companion.pos = { ...marked.pos };
    outsider.pos = {
      x: marked.pos.x + 20,
      y: marked.pos.y,
      z: marked.pos.z,
    };
    boss.ignivar.soakRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    for (const player of [marked, companion]) {
      expect(player.hp).toBe(
        player.maxHp - Math.ceil(player.maxHp * (IGNIVAR_SOAK_SHARED_MAX_HP / 2)),
      );
    }
    expect(outsider.hp).toBe(outsider.maxHp);
    expect(marked.auras.some((aura) => aura.id === IGNIVAR_SOAK_AURA_ID)).toBe(false);
    expect(boss.ignivar.soakTargetId).toBeNull();
  });

  it('lets one immune marked player nullify Shared Pyre without damaging the raid', () => {
    const { sim, boss } = claimedEncounter(8127);
    const outsider = addEncounterPlayer(sim, boss, 'Immune Soak Witness');
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 0;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    const marked = sim.entities.get(boss.ignivar.soakTargetId ?? -1);
    if (!marked) throw new Error('Ignivar did not mark a soak target');
    const witness = marked.id === outsider.id ? sim.player : outsider;
    marked.pos = { ...boss.pos, x: boss.pos.x + 2 };
    witness.pos = { ...boss.pos, x: boss.pos.x - 20 };
    marked.hp = marked.maxHp;
    witness.hp = witness.maxHp;
    marked.auras.push({
      id: 'ice_block',
      name: 'Cold Coffin',
      kind: 'stasis',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: marked.id,
      school: 'frost',
    });
    boss.ignivar.soakRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(marked.hp).toBe(marked.maxHp);
    expect(witness.hp).toBe(witness.maxHp);
    expect(boss.ignivar.soakTargetId).toBeNull();
  });

  it('prefers an unbranded non-tank as the Shared Pyre target', () => {
    const { sim, boss } = claimedEncounter(8111);
    const branded = addEncounterPlayer(sim, boss, 'Branded Raider');
    const unbranded = addEncounterPlayer(sim, boss, 'Unbranded Raider');
    branded.auras.push({
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 10,
      duration: 10,
      value: 1,
      sourceId: boss.id,
      school: 'fire',
    });
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar.soakTargetId).toBe(unbranded.id);
  });

  it('splits a successful Shared Pyre across every player inside, including a fifth', () => {
    const { sim, boss } = claimedEncounter(8112);
    const raiders = Array.from({ length: 5 }, (_, index) =>
      addEncounterPlayer(sim, boss, `Five-player Soaker ${index + 1}`),
    );
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 0;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    const marked = sim.entities.get(boss.ignivar.soakTargetId ?? -1);
    if (!marked) throw new Error('Ignivar did not mark a soak target');
    for (const player of raiders) {
      player.pos = { ...marked.pos };
      player.hp = player.maxHp;
    }
    sim.player.pos = { x: marked.pos.x + 20, y: marked.pos.y, z: marked.pos.z };
    boss.ignivar.soakRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    for (const player of raiders) {
      expect(player.hp).toBe(player.maxHp - Math.ceil(player.maxHp * (1.2 / 5)));
    }
  });

  it("still splits Shared Pyre at the marked player's position if they die", () => {
    const { sim, boss } = claimedEncounter(8113);
    const raiders = Array.from({ length: 5 }, (_, index) =>
      addEncounterPlayer(sim, boss, `Survivor ${index + 1}`),
    );
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 0;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    const marked = sim.entities.get(boss.ignivar.soakTargetId ?? -1);
    if (!marked) throw new Error('Ignivar did not mark a soak target');
    marked.dead = true;
    marked.hp = 0;
    const survivors = [sim.player, ...raiders.filter((player) => player.id !== marked.id)];
    for (const player of survivors) {
      player.pos = { ...marked.pos };
      player.hp = player.maxHp;
    }
    boss.ignivar.soakRemaining = DT;

    updateIgnivarEncounter(sim.ctx, boss);

    for (const player of survivors) {
      expect(player.hp).toBe(
        player.maxHp - Math.ceil(player.maxHp * (IGNIVAR_SOAK_SHARED_MAX_HP / survivors.length)),
      );
    }
    expect(marked.auras.some((aura) => aura.id === IGNIVAR_SOAK_AURA_ID)).toBe(false);
    expect(boss.ignivar.soakTargetId).toBeNull();
  });

  it('never chains a follow-up ability on the Shared Pyre resolution tick', () => {
    const { sim, boss } = claimedEncounter(8114);
    const raiders = Array.from({ length: 5 }, (_, index) =>
      addEncounterPlayer(sim, boss, `Follow-up Raider ${index + 1}`),
    );
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.soakTimer = 0;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    const marked = sim.entities.get(boss.ignivar.soakTargetId ?? -1);
    if (!marked) throw new Error('Ignivar did not mark a soak target');
    const soakers = [marked, ...raiders.filter((player) => player.id !== marked.id).slice(0, 3)];
    for (const player of soakers) {
      player.pos = { ...marked.pos };
      player.hp = player.maxHp;
    }
    marked.hp = 1;
    boss.ignivar.soakRemaining = DT;
    boss.ignivar.brandTimer = 0;
    boss.ignivar.skyfireTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(marked.dead).toBe(true);
    expect(marked.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(boss.castingAbility).toBeNull();
    expect(boss.ignivar.skyfireTimer).toBeGreaterThanOrEqual(IGNIVAR_MAJOR_ABILITY_GAP_SECONDS);
  });

  it('keeps other major abilities paused while Shared Pyre is active', () => {
    const { sim, boss } = claimedEncounter(8116);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 0;
    boss.ignivar.skyfireTimer = 0;
    boss.ignivar.rotatingRaysTimer = 0;
    boss.ignivar.forgeWaveTimer = 0;
    boss.ignivar.soakTargetId = sim.player.id;
    boss.ignivar.soakRemaining = 1;
    boss.swingTimer = 999;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar.soakRemaining).toBeCloseTo(1 - DT, 8);
    expect(boss.castingAbility).toBeNull();
    expect(boss.ignivar.frontalTimer).toBe(0);
    expect(boss.ignivar.skyfireTimer).toBe(0);
    expect(boss.ignivar.rotatingRaysTimer).toBe(0);
    expect(boss.ignivar.forgeWaveTimer).toBe(0);
  });

  it('starts Shared Pyre at 24 seconds and begins its cooldown after resolution', () => {
    const { sim, boss } = claimedEncounter(8115);
    const raiders = Array.from({ length: 4 }, (_, index) =>
      addEncounterPlayer(sim, boss, `Cadence Raider ${index + 1}`),
    );
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.forgeWaveTimer = 999;
    boss.ignivar.overlapTimer = 999;
    boss.swingTimer = 999;
    const starts: number[] = [];
    let priorTarget = boss.ignivar.soakTargetId;

    for (let i = 0; i < 1_600 && starts.length < 2; i++) {
      for (const player of [sim.player, ...raiders]) player.hp = player.maxHp;
      sim.tick();
      const targetId = boss.ignivar.soakTargetId;
      if (targetId !== null && priorTarget === null) starts.push(sim.time);
      const marked = targetId === null ? undefined : sim.entities.get(targetId);
      if (marked) {
        for (const player of [sim.player, ...raiders]) player.pos = { ...marked.pos };
      }
      priorTarget = targetId;
    }

    expect(starts).toHaveLength(2);
    expect(starts[0]).toBeCloseTo(IGNIVAR_FIRST_SOAK_SECONDS, 1);
    expect(starts[1] - starts[0]).toBeCloseTo(IGNIVAR_SOAK_CAST_SECONDS + IGNIVAR_SOAK_EVERY, 1);
  });

  it('marks every available player when fewer than three are present', () => {
    const { sim, boss } = claimedEncounter();
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);

    const brand = sim.player.auras.find((a) => a.id === IGNIVAR_BRAND_AURA_ID);
    expect(brand).toMatchObject({
      kind: 'dot',
      tickInterval: 2,
      sourceId: boss.id,
      encounterOwned: true,
    });
    if (!brand) throw new Error('Ignivar brand was not applied');
    expect(isDispellableAura(brand, false)).toBe(false);
    const hpBeforeTick = sim.player.hp;
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.swingTimer = 999;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.player.hp).toBe(hpBeforeTick - Math.ceil(sim.player.maxHp * 0.05));
  });

  it('ramps each uncleansed Brand tick from one to three stacks without exceeding the cap', () => {
    const { sim, boss } = claimedEncounter();
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 0;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.overlapTimer = 999;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    const brand = sim.player.auras.find((aura) => aura.id === IGNIVAR_BRAND_AURA_ID);
    if (!brand) throw new Error('Ignivar brand was not applied');
    const base = Math.ceil(sim.player.maxHp * 0.05);
    expect(brand).toMatchObject({ stacks: 1, value: base });

    const startingHp = sim.player.hp;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.player.hp).toBe(startingHp - base);
    expect(brand).toMatchObject({ stacks: 2, value: base * 2 });

    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.player.hp).toBe(startingHp - base * 3);
    expect(brand).toMatchObject({ stacks: 3, value: base * 3 });

    sim.player.hp = sim.player.maxHp;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.player.hp).toBe(sim.player.maxHp - base * 3);
    expect(brand).toMatchObject({
      stacks: IGNIVAR_BRAND_MAX_STACKS,
      value: base * 3,
    });
  });

  it('does not reset an uncleansed Brand when that player is selected again', () => {
    const { sim, boss } = claimedEncounter();
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 0;
    updateIgnivarEncounter(sim.ctx, boss);
    const brand = sim.player.auras.find((aura) => aura.id === IGNIVAR_BRAND_AURA_ID);
    if (!brand) throw new Error('Ignivar brand was not applied');
    brand.stacks = 3;
    brand.value *= 3;
    brand.tickTimer = 0.75;
    brand.remaining = 1;
    const rampedValue = brand.value;

    boss.ignivar.brandTimer = 0;
    updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.auras.filter((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toHaveLength(1);
    expect(brand).toMatchObject({
      stacks: 3,
      value: rampedValue,
      tickTimer: 0.75,
      remaining: 600,
    });
  });

  it('makes Forge Strike force a tank swap at two Molten Armor stacks', () => {
    const { sim, boss } = claimedEncounter();
    const secondTankPid = sim.addPlayer('paladin', 'Second Tank');
    sim.setPlayerLevel(20);
    sim.setPlayerLevel(20, secondTankPid);
    const secondTank = sim.entities.get(sim.players.get(secondTankPid)?.entityId ?? -1);
    if (!secondTank) throw new Error('Second tank did not spawn');
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 2 };
    secondTank.pos = { ...sim.player.pos };
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.overlapTimer = 999;
    boss.swingTimer = 999;
    boss.ignivar.forgeStrikeTimer = 0;
    sim.player.hp = sim.player.maxHp;
    secondTank.hp = secondTank.maxHp;
    const firstTankHp = sim.player.hp;

    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.hp).toBe(
      firstTankHp - Math.ceil(sim.player.maxHp * IGNIVAR_FORGE_STRIKE_MAX_HP),
    );
    expect(sim.player.auras.find((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID)).toMatchObject(
      {
        stacks: 1,
        value: IGNIVAR_MOLTEN_ARMOR_PER_STACK,
        remaining: IGNIVAR_MOLTEN_ARMOR_DURATION,
        encounterOwned: true,
      },
    );
    expect(boss.ignivar.forgeStrikeTimer).toBe(IGNIVAR_FORGE_STRIKE_EVERY);

    boss.ignivar.forgeStrikeTimer = 0;
    const hpBeforeSecond = sim.player.hp;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.hp).toBe(
      hpBeforeSecond -
        Math.round(
          Math.ceil(sim.player.maxHp * IGNIVAR_FORGE_STRIKE_MAX_HP) *
            (1 + IGNIVAR_MOLTEN_ARMOR_PER_STACK),
        ),
    );
    expect(sim.player.auras.find((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID)?.stacks).toBe(
      2,
    );

    boss.forcedTargetId = secondTank.id;
    boss.forcedTargetTimer = 3;
    boss.ignivar.forgeStrikeTimer = 0;
    const secondTankHp = secondTank.hp;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(secondTank.hp).toBe(
      secondTankHp - Math.ceil(secondTank.maxHp * IGNIVAR_FORGE_STRIKE_MAX_HP),
    );
    expect(secondTank.auras.find((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID)?.stacks).toBe(
      1,
    );
  });

  it('makes two real Forge Strike stacks amplify Ignivar melee swings by seventy percent', () => {
    const normal = claimedEncounter(7441);
    const molten = claimedEncounter(7441);
    normal.sim.setPlayerLevel(20);
    molten.sim.setPlayerLevel(20);
    normal.sim.player.maxHp = 1_000_000;
    normal.sim.player.hp = normal.sim.player.maxHp;
    molten.sim.player.maxHp = 1_000_000;
    molten.sim.player.hp = molten.sim.player.maxHp;
    molten.sim.player.pos = {
      x: molten.boss.pos.x,
      y: molten.boss.pos.y,
      z: molten.boss.pos.z - 2,
    };
    updateIgnivarEncounter(molten.sim.ctx, molten.boss);
    if (!molten.boss.ignivar) throw new Error('Ignivar state was not initialized');
    molten.boss.ignivar.brandTimer = 999;
    molten.boss.ignivar.frontalTimer = 999;
    molten.boss.ignivar.overlapTimer = 999;
    molten.boss.swingTimer = 999;
    molten.boss.ignivar.forgeStrikeTimer = 0;
    updateIgnivarEncounter(molten.sim.ctx, molten.boss);
    molten.boss.ignivar.forgeStrikeTimer = 0;
    updateIgnivarEncounter(molten.sim.ctx, molten.boss);
    expect(
      molten.sim.player.auras.find((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID),
    ).toMatchObject({ stacks: 2, value: 0.7 });
    molten.sim.player.hp = molten.sim.player.maxHp;
    normal.sim.rng = new Rng(1907);
    molten.sim.rng = new Rng(1907);

    const normalHp = normal.sim.player.hp;
    const moltenHp = molten.sim.player.hp;
    for (let attempt = 0; attempt < 20 && normal.sim.player.hp === normalHp; attempt++) {
      normal.sim.ctx.mobSwing(normal.boss, normal.sim.player);
      molten.sim.ctx.mobSwing(molten.boss, molten.sim.player);
    }
    const normalDamage = normalHp - normal.sim.player.hp;
    const moltenDamage = moltenHp - molten.sim.player.hp;

    expect(normalDamage).toBeGreaterThan(0);
    expect(moltenDamage / normalDamage).toBeCloseTo(1.7, 1);
  });

  it('holds a due Forge Strike out of melee, then repeats exactly fourteen seconds after landing', () => {
    const { sim, boss } = claimedEncounter();
    sim.setPlayerLevel(20);
    sim.player.devGod = true;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.overlapTimer = 999;
    boss.swingTimer = 999;
    boss.ignivar.forgeStrikeTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID)).toBe(false);
    expect(boss.ignivar.forgeStrikeTimer).toBeLessThanOrEqual(0);

    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 2 };
    updateIgnivarEncounter(sim.ctx, boss);
    const armor = sim.player.auras.find((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID);
    expect(armor?.stacks).toBe(1);
    for (let i = 0; i < 279; i++) updateIgnivarEncounter(sim.ctx, boss);
    expect(armor?.stacks).toBe(1);
    updateIgnivarEncounter(sim.ctx, boss);
    expect(armor?.stacks).toBe(2);
  });

  it('retargets a living tank before a melee swing when Forge Strike kills its target', () => {
    const { sim, boss } = claimedEncounter();
    const secondTankPid = sim.addPlayer('paladin', 'Second Tank');
    sim.setPlayerLevel(20);
    sim.setPlayerLevel(20, secondTankPid);
    const secondTank = sim.entities.get(sim.players.get(secondTankPid)?.entityId ?? -1);
    if (!secondTank) throw new Error('Second tank did not spawn');
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 2 };
    secondTank.pos = { ...sim.player.pos };
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.overlapTimer = 999;
    boss.ignivar.forgeStrikeTimer = 0;
    boss.forcedTargetId = sim.player.id;
    boss.forcedTargetTimer = 3;
    boss.swingTimer = 0;
    sim.player.hp = 1;
    const secondTankHp = secondTank.hp;
    let draws = 0;
    sim.rng.setObserver(() => draws++);

    updateIgnivarEncounter(sim.ctx, boss);
    sim.rng.setObserver(null);

    expect(sim.player.dead).toBe(true);
    expect(boss.aggroTargetId).toBe(secondTank.id);
    expect(secondTank.hp).toBeLessThan(secondTankHp);
    expect(boss.swingTimer).toBeGreaterThan(0);
    expect(draws).toBeGreaterThan(0);
  });

  it('retargets a living tank before starting a frontal when Forge Strike kills its target', () => {
    const { sim, boss } = claimedEncounter();
    const secondTankPid = sim.addPlayer('paladin', 'Second Tank');
    sim.setPlayerLevel(20);
    sim.setPlayerLevel(20, secondTankPid);
    const secondTank = sim.entities.get(sim.players.get(secondTankPid)?.entityId ?? -1);
    if (!secondTank) throw new Error('Second tank did not spawn');
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 2 };
    secondTank.pos = { ...sim.player.pos };
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 0;
    boss.ignivar.overlapTimer = 999;
    boss.ignivar.forgeStrikeTimer = 0;
    boss.forcedTargetId = sim.player.id;
    boss.forcedTargetTimer = 3;
    sim.player.hp = 1;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.dead).toBe(true);
    expect(boss.aggroTargetId).toBe(secondTank.id);
    expect(boss.castingAbility).toBe(IGNIVAR_FRONTAL_CAST_ID);
    expect(boss.castTargetId).toBe(secondTank.id);
    expect(boss.castAim).toEqual(secondTank.pos);
  });

  it('retargets a living ally before starting a frontal when Brand overlap kills its target', () => {
    const { sim, boss } = claimedEncounter();
    const allyPid = sim.addPlayer('paladin', 'Surviving Tank');
    const ally = sim.entities.get(sim.players.get(allyPid)?.entityId ?? -1);
    if (!ally) throw new Error('Surviving tank did not spawn');
    sim.setPlayerLevel(20);
    sim.setPlayerLevel(20, allyPid);
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 2 };
    ally.pos = { ...sim.player.pos };
    sim.player.auras.push({
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 600,
      duration: 600,
      value: 1,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 0;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.overlapTimer = 0;
    boss.forcedTargetId = sim.player.id;
    boss.forcedTargetTimer = 3;
    sim.player.hp = 1;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.dead).toBe(true);
    expect(ally.dead).toBe(false);
    expect(boss.aggroTargetId).toBe(ally.id);
    expect(boss.castingAbility).toBe(IGNIVAR_FRONTAL_CAST_ID);
    expect(boss.castTargetId).toBe(ally.id);
    expect(boss.castAim).toEqual(ally.pos);
  });

  it('stops the mechanic tick without RNG or casts when Brand overlap leaves no living target', () => {
    const { sim, boss } = claimedEncounter();
    const allyPid = sim.addPlayer('priest', 'Last Ally');
    const ally = sim.entities.get(sim.players.get(allyPid)?.entityId ?? -1);
    if (!ally) throw new Error('Last ally did not spawn');
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 2 };
    ally.pos = { ...sim.player.pos };
    sim.player.auras.push({
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 600,
      duration: 600,
      value: 1,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 0;
    boss.ignivar.forgeStrikeTimer = 0;
    boss.ignivar.overlapTimer = 0;
    boss.swingTimer = 0;
    sim.player.hp = 1;
    ally.hp = 1;
    let draws = 0;
    sim.rng.setObserver(() => draws++);

    updateIgnivarEncounter(sim.ctx, boss);
    sim.rng.setObserver(null);

    expect(sim.player.dead).toBe(true);
    expect(ally.dead).toBe(true);
    expect(boss.castingAbility).toBeNull();
    expect(boss.swingTimer).toBe(0);
    expect(draws).toBe(0);
  });

  it('keeps Molten Armor and Shared Pyre out of water and removes both on reset', () => {
    const { sim, boss, conduit } = claimedEncounter();
    sim.setPlayerLevel(20);
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 2 };
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.forgeStrikeTimer = 0;
    boss.swingTimer = 999;
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
    boss.ignivar.conduitTimers.north_west = 5;

    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID)).toBe(true);
    sim.player.auras.push({
      id: IGNIVAR_SOAK_AURA_ID,
      name: 'Shared Pyre',
      kind: 'vulnerability',
      remaining: IGNIVAR_SOAK_CAST_SECONDS,
      duration: IGNIVAR_SOAK_CAST_SECONDS,
      value: 0,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    sim.player.pos = { ...conduit.pos };
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID)).toBe(true);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_SOAK_AURA_ID)).toBe(true);

    resetIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID)).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_SOAK_AURA_ID)).toBe(false);
  });

  it('survives a real friendly dispel effect and still requires encounter water', () => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'warlock',
      autoEquip: true,
      devCommands: true,
    });
    sim.setPlayerLevel(20);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', sim.player.id, true)).toBe(true);
    const boss = [...sim.entities.values()].find((e) => e.templateId === IGNIVAR_BOSS_ID);
    if (!boss) throw new Error('Ignivar did not spawn');
    sim.player.auras.push({
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 600,
      duration: 600,
      value: 1,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    const meta = sim.meta(sim.player.id);
    if (!meta) throw new Error('missing player metadata');
    const def = TALENT_ABILITIES_V2_B.voidfeast;
    const resolved: ResolvedAbility = {
      def,
      rank: 1,
      cost: def.cost,
      castTime: def.castTime,
      cooldown: def.cooldown,
      effects: def.effects,
      threatFlat: 0,
      threatMult: 1,
    };
    sim.ctx.runEffects(sim.player, meta, sim.player, resolved);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
  });

  it('runs the encounter through the production mob tick dispatcher', () => {
    const { sim, boss } = claimedEncounter();
    sim.player.devGod = true;

    for (let i = 0; i < 45; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);

    for (let i = 0; i < 120; i++) sim.tick();
    expect(boss.castingAbility).toBe(IGNIVAR_FRONTAL_CAST_ID);
    expect(boss.ignivar?.frontalCastRemaining).toBeGreaterThan(0);
  });

  it('holds the boss at the arena center without wandering before combat', () => {
    const sim = new Sim({ seed: 990, playerClass: 'warrior', devCommands: true });
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', sim.player.id, true)).toBe(true);
    const boss = [...sim.entities.values()].find((entity) => entity.templateId === IGNIVAR_BOSS_ID);
    if (!boss) throw new Error('Ignivar did not spawn');
    expect(boss.inCombat).toBe(false);
    expect(boss.aiState).toBe('idle');
    boss.wanderTimer = 0;
    boss.wanderTarget = null;
    const center = { ...boss.spawnPos };

    sim.tick();

    expect(boss.inCombat).toBe(false);
    expect(boss.pos).toEqual(center);
    expect(boss.prevPos).toEqual(center);
    expect(boss.wanderTarget).toBeNull();
  });

  it('chases the tank between mechanics when the tank moves out of melee', () => {
    const { sim, boss } = claimedEncounter(991);
    const destination = {
      x: boss.pos.x + 18,
      y: boss.pos.y,
      z: boss.pos.z,
    };
    sim.player.pos = destination;
    sim.player.prevPos = { ...destination };
    const distanceBefore = dist2d(boss.pos, sim.player.pos);
    const positionBefore = { ...boss.pos };

    sim.tick();

    expect(boss.moveSpeed).toBeGreaterThan(0);
    expect(boss.aiState).toBe('chase');
    expect(boss.pos).not.toEqual(positionBefore);
    expect(dist2d(boss.pos, sim.player.pos)).toBeLessThan(distanceBefore);
  });

  it('does not drift when the tank is already in melee and follows a forced tank over a bystander', () => {
    const melee = claimedEncounter(992);
    melee.sim.player.pos = {
      x: melee.boss.pos.x + 2,
      y: melee.boss.pos.y,
      z: melee.boss.pos.z,
    };
    melee.sim.player.prevPos = { ...melee.sim.player.pos };
    const meleeOrigin = { ...melee.boss.pos };

    melee.sim.tick();

    expect(melee.boss.pos).toEqual(meleeOrigin);
    expect(melee.boss.aiState).toBe('attack');
    expect(melee.boss.facing).toBeCloseTo(Math.PI / 2, 8);

    const forced = claimedEncounter(993);
    const forcedTank = addEncounterPlayer(forced.sim, forced.boss, 'Forced Tank', 'paladin');
    forced.sim.player.pos = {
      x: forced.boss.pos.x + 2,
      y: forced.boss.pos.y,
      z: forced.boss.pos.z,
    };
    forcedTank.pos = {
      x: forced.boss.pos.x + 18,
      y: forced.boss.pos.y,
      z: forced.boss.pos.z,
    };
    forcedTank.prevPos = { ...forcedTank.pos };
    forced.boss.forcedTargetId = forcedTank.id;
    forced.boss.forcedTargetTimer = 10;
    const forcedDistanceBefore = dist2d(forced.boss.pos, forcedTank.pos);

    forced.sim.tick();

    expect(forced.boss.aggroTargetId).toBe(forcedTank.id);
    expect(dist2d(forced.boss.pos, forcedTank.pos)).toBeLessThan(forcedDistanceBefore);
  });

  it('keeps the boss stationary through every major mechanic in the production dispatcher', () => {
    const mechanics = [
      'frontal',
      'skyfire',
      'rotating rays',
      'forge wave',
      'shared pyre',
      'judgment',
    ];
    for (let mechanicIndex = 0; mechanicIndex < mechanics.length; mechanicIndex++) {
      const mechanic = mechanics[mechanicIndex];
      const { sim, boss } = claimedEncounter(1_100 + mechanicIndex);
      sim.player.devGod = true;
      updateIgnivarEncounter(sim.ctx, boss);
      if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
      const st = boss.ignivar;
      st.apocalypseTriggered = true;
      st.apocalypseResolved = true;
      st.apocalypseAddId = null;
      st.brandTimer = 999;
      st.forgeStrikeTimer = 999;
      st.frontalTimer = 999;
      st.skyfireTimer = 999;
      st.meteorTimer = 999;
      st.rotatingRaysTimer = 999;
      st.forgeWaveTimer = 999;
      st.soakTimer = 999;
      st.overlapTimer = 999;
      boss.swingTimer = 999;
      sim.player.pos = {
        x: boss.pos.x + 18,
        y: boss.pos.y,
        z: boss.pos.z,
      };
      sim.player.prevPos = { ...sim.player.pos };

      if (mechanic === 'frontal') st.frontalTimer = 0;
      else if (mechanic === 'skyfire') st.skyfireTimer = 0;
      else if (mechanic === 'rotating rays') st.rotatingRaysTimer = 0;
      else if (mechanic === 'forge wave') st.forgeWaveTimer = 0;
      else if (mechanic === 'shared pyre') st.soakTimer = 0;
      else boss.hp = Math.floor(boss.maxHp * 0.45);

      const origin = { ...boss.pos };
      sim.tick();
      expect(boss.pos, `${mechanic} start`).toEqual(origin);
      if (mechanic === 'rotating rays') {
        st.rotatingRaysWindupRemaining = 0;
        st.rotatingRaysActiveRemaining = 1;
        st.rotatingRaysPulseTimer = 1;
      } else if (mechanic === 'forge wave') {
        st.forgeWaveWindupRemaining = 0;
        st.forgeWaveActiveRemaining = 1;
      } else if (mechanic === 'judgment') {
        st.forgeJudgmentPhase = 'active';
        st.forgeJudgmentRemaining = 1;
        st.forgeJudgmentPulseTimer = 1;
      }
      sim.tick();
      expect(boss.pos, `${mechanic} active`).toEqual(origin);
    }
  });

  it('locks a visible frontal, activates the aimed conduit, and cleanses its water zone', () => {
    const { sim, boss, conduit } = claimedEncounter();
    const bystanderPid = sim.addPlayer('mage', 'Bystander');
    const bystanderMeta = sim.players.get(bystanderPid);
    const bystander = bystanderMeta ? sim.entities.get(bystanderMeta.entityId) : undefined;
    if (!bystander) throw new Error('Raid bystander did not spawn');
    const origin = instanceOrigin(DUNGEONS.ignivar_raid_arena.index, 0);
    sim.player.pos.x = origin.x - 18;
    sim.player.pos.z = origin.z + 18;
    bystander.pos = { x: origin.x + 18, y: 0, z: origin.z - 18 };
    boss.facing = Math.atan2(sim.player.pos.x - boss.pos.x, sim.player.pos.z - boss.pos.z);
    sim.player.auras.push({
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 600,
      duration: 600,
      value: 1,
      tickInterval: 2,
      tickTimer: 2,
      sourceId: boss.id,
      school: 'fire',
      finalDamage: true,
    });
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.frontalTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.castingAbility).toBe(IGNIVAR_FRONTAL_CAST_ID);
    expect(boss.castTotal).toBe(IGNIVAR_FRONTAL_CAST_SECONDS);
    const hpBeforeFrontal = sim.player.hp;
    const bystanderHp = bystander.hp;
    boss.ignivar.frontalCastRemaining = 0.01;
    const events = sim.tick();

    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.active);
    expect(sim.player.hp).toBe(hpBeforeFrontal - Math.ceil(sim.player.maxHp * 0.3));
    expect(bystander.hp).toBe(bystanderHp);
    expect(IGNIVAR_FRONTAL_VFX_DISTANCE).toBe(30);
    const blasts = events.filter(
      (event): event is Extract<SimEvent, { type: 'spellfxAt' }> =>
        event.type === 'spellfxAt' &&
        event.ability === IGNIVAR_FRONTAL_CAST_ID &&
        event.fx === 'burst',
    );
    expect(blasts).toHaveLength(1);
    const blast = blasts[0];
    expect(blast).toBeDefined();
    if (!blast) throw new Error('Searing Torrent did not emit its frontal VFX');
    expect(blast.sourceId).toBe(boss.id);
    expect(blast.school).toBe('fire');
    expect(blast.radius).toBeUndefined();
    const blastDx = blast.x - boss.pos.x;
    const blastDz = blast.z - boss.pos.z;
    expect(Math.hypot(blastDx, blastDz)).toBeCloseTo(IGNIVAR_FRONTAL_VFX_DISTANCE, 8);
    expect(
      (blastDx * Math.sin(boss.ignivar.frontalFacing) +
        blastDz * Math.cos(boss.ignivar.frontalFacing)) /
        IGNIVAR_FRONTAL_VFX_DISTANCE,
    ).toBeCloseTo(1, 8);
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((a) => a.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
    sim.player.auras.push({
      id: 'control_debuff',
      name: 'Control Debuff',
      kind: 'slow',
      remaining: 5,
      duration: 5,
      value: 0.5,
      sourceId: boss.id,
      school: 'physical',
    });
    sim.player.pos.x = conduit.pos.x;
    sim.player.pos.z = conduit.pos.z;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((a) => a.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(sim.player.auras.some((a) => a.id === 'control_debuff')).toBe(true);
  });

  it('tracks a moving tank until release so the tank can redirect the frontal', () => {
    const { sim, boss } = claimedEncounter(8128);
    const origin = instanceOrigin(DUNGEONS.ignivar_raid_arena.index, 0);
    const conduits = [...sim.entities.values()].filter((entity) =>
      Object.values(IGNIVAR_WATER_CONDUIT_TEMPLATES).includes(
        entity.templateId as (typeof IGNIVAR_WATER_CONDUIT_TEMPLATES)[keyof typeof IGNIVAR_WATER_CONDUIT_TEMPLATES],
      ),
    );
    const northWest = conduits.find(
      (conduit) => conduit.pos.x < origin.x && conduit.pos.z > origin.z,
    );
    const northEast = conduits.find(
      (conduit) => conduit.pos.x > origin.x && conduit.pos.z > origin.z,
    );
    const southEast = conduits.find(
      (conduit) => conduit.pos.x > origin.x && conduit.pos.z < origin.z,
    );
    if (!northWest || !northEast || !southEast) {
      throw new Error('Redirect conduits did not spawn');
    }
    sim.player.pos = { ...northWest.pos };
    sim.player.prevPos = { ...sim.player.pos };
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.frontalTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);
    const initialFacing = boss.ignivar.frontalFacing;
    sim.player.pos = { ...northEast.pos };
    sim.player.prevPos = { ...sim.player.pos };
    updateIgnivarEncounter(sim.ctx, boss);

    const redirectedFacing = Math.atan2(
      sim.player.pos.x - boss.pos.x,
      sim.player.pos.z - boss.pos.z,
    );
    expect(boss.ignivar.frontalFacing).not.toBeCloseTo(initialFacing, 5);
    expect(boss.ignivar.frontalFacing).toBeCloseTo(redirectedFacing, 8);
    expect(boss.facing).toBeCloseTo(redirectedFacing, 8);
    expect(boss.castAim).toEqual(sim.player.pos);

    sim.player.pos = { ...southEast.pos };
    sim.player.prevPos = { ...sim.player.pos };
    boss.ignivar.frontalCastRemaining = DT;
    updateIgnivarEncounter(sim.ctx, boss);

    const releaseFacing = Math.atan2(sim.player.pos.x - boss.pos.x, sim.player.pos.z - boss.pos.z);
    expect(boss.facing).toBeCloseTo(releaseFacing, 8);
    expect(northWest.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.ready);
    expect(northEast.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.ready);
    expect(southEast.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.active);
  });

  it('does not reactivate a spent conduit hit by another frontal', () => {
    const { sim, boss, conduit } = claimedEncounter(8129);
    sim.player.pos = { ...conduit.pos };
    sim.player.prevPos = { ...sim.player.pos };
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.frontalTimer = 0;
    updateIgnivarEncounter(sim.ctx, boss);
    boss.ignivar.frontalCastRemaining = DT;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.active);

    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown;
    boss.ignivar.conduitTimers.north_west = 20;
    boss.ignivar.frontalTimer = 0;
    updateIgnivarEncounter(sim.ctx, boss);
    boss.ignivar.frontalCastRemaining = DT;
    updateIgnivarEncounter(sim.ctx, boss);

    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown);
    expect(boss.ignivar.conduitTimers.north_west).toBeUndefined();
  });

  it('only cleanses inside an active conduit, never ready or cooldown water', () => {
    const { sim, boss, conduit } = claimedEncounter();
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.swingTimer = 999;
    sim.player.pos = { ...conduit.pos };
    const applyBrand = () => {
      sim.player.auras = sim.player.auras.filter((aura) => aura.id !== IGNIVAR_BRAND_AURA_ID);
      sim.player.auras.push({
        id: IGNIVAR_BRAND_AURA_ID,
        name: 'Brand of the Pyre',
        kind: 'dot',
        remaining: 600,
        duration: 600,
        value: 1,
        sourceId: boss.id,
        school: 'fire',
        encounterOwned: true,
      });
    };

    applyBrand();
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown;
    boss.ignivar.conduitTimers.north_west = 20;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
    boss.ignivar.conduitTimers.north_west = 5;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
  });

  it('keeps Normal Cleansing Backlash damage-free', () => {
    const { sim, boss, conduit } = claimedEncounter();
    const cleanser = addEncounterPlayer(sim, boss, 'Normal Cleanser');
    prepareConduitCleanse(sim, boss, conduit);
    cleanser.pos = { ...conduit.pos };
    applyIgnivarBrand(cleanser, boss);
    const playerHp = sim.player.hp;
    const cleanserHp = cleanser.hp;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(cleanser.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(cleanser.hp).toBe(cleanserHp);
    expect(sim.player.hp).toBe(playerHp);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
  });

  it('damages every living raid member once for one Heroic Cleansing Backlash', () => {
    const { sim, boss, conduit } = claimedHeroicEncounter();
    const cleanser = addEncounterPlayer(sim, boss, 'Heroic Cleanser');
    expect(IGNIVAR_CLEANSING_BACKLASH_DAMAGE_MAX_HP).toBe(0.18);
    expect(IGNIVAR_CLEANSING_BACKLASH_ID).toBe('Cleansing Backlash');
    prepareConduitCleanse(sim, boss, conduit);
    cleanser.pos = { ...conduit.pos };
    for (const player of [sim.player, cleanser]) {
      player.maxHp = 1_000;
      player.hp = player.maxHp;
    }
    applyIgnivarBrand(cleanser, boss);

    const events = sim.tick();

    const expectedDamage = 1_000 * IGNIVAR_CLEANSING_BACKLASH_DAMAGE_MAX_HP;
    expect(cleanser.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(cleanser.hp).toBe(1_000 - expectedDamage);
    expect(sim.player.hp).toBe(1_000 - expectedDamage);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(
      events.filter(
        (event) => event.type === 'damage' && event.ability === IGNIVAR_CLEANSING_BACKLASH_ID,
      ),
    ).toHaveLength(2);
  });

  it('stacks simultaneous Heroic Cleansing Backlashes independently', () => {
    const { sim, boss, conduit } = claimedHeroicEncounter();
    const firstCleanser = addEncounterPlayer(sim, boss, 'First Heroic Cleanser');
    const secondCleanser = addEncounterPlayer(sim, boss, 'Second Heroic Cleanser');
    prepareConduitCleanse(sim, boss, conduit);
    firstCleanser.pos = { ...conduit.pos };
    secondCleanser.pos = { ...conduit.pos };
    const players = [sim.player, firstCleanser, secondCleanser];
    for (const player of players) {
      player.maxHp = 1_000;
      player.hp = player.maxHp;
    }
    applyIgnivarBrand(firstCleanser, boss);
    applyIgnivarBrand(secondCleanser, boss);

    const events = sim.tick();

    const expectedDamage = 2 * 1_000 * IGNIVAR_CLEANSING_BACKLASH_DAMAGE_MAX_HP;
    for (const player of players) expect(player.hp).toBe(1_000 - expectedDamage);
    expect(firstCleanser.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(secondCleanser.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(
      events.filter(
        (event) => event.type === 'damage' && event.ability === IGNIVAR_CLEANSING_BACKLASH_ID,
      ),
    ).toHaveLength(6);
  });

  it('keeps active conduits ticking and cleansing during Heroic Forge Chains', () => {
    const { sim, boss, conduit } = claimedHeroicEncounter();
    const cleanser = addEncounterPlayer(sim, boss, 'Chained Cleanser');
    const partner = addEncounterPlayer(sim, boss, 'Chained Partner');
    updateIgnivarEncounter(sim.ctx, boss);
    isolateForgeChains(boss);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar?.forgeChainsPlayerIds) throw new Error('Forge Chains did not activate');

    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
    boss.ignivar.conduitTimers.north_west = 5;
    cleanser.pos = { ...conduit.pos };
    cleanser.prevPos = { ...cleanser.pos };
    const players = [sim.player, cleanser, partner];
    for (const player of players) {
      player.maxHp = 1_000;
      player.hp = player.maxHp;
    }
    applyIgnivarBrand(cleanser, boss);

    const events = sim.tick();

    expect(boss.ignivar.conduitTimers.north_west).toBeCloseTo(5 - DT);
    expect(cleanser.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    for (const player of players) {
      expect(player.hp).toBe(1_000 - Math.ceil(1_000 * IGNIVAR_CLEANSING_BACKLASH_DAMAGE_MAX_HP));
    }
    expect(
      events.filter(
        (event) => event.type === 'damage' && event.ability === IGNIVAR_CLEANSING_BACKLASH_ID,
      ),
    ).toHaveLength(players.length);
  });

  it('freezes active conduits and cleansing throughout Forge Judgment', () => {
    const { sim, boss, conduit } = claimedHeroicEncounter();
    const cleanser = addEncounterPlayer(sim, boss, 'Judgment Cleanser');
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.forgeJudgmentPhase = 'active';
    boss.ignivar.forgeJudgmentRemaining = 1;
    boss.ignivar.forgeJudgmentPulseTimer = 1;
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
    boss.ignivar.conduitTimers.north_west = 5;
    cleanser.pos = { ...conduit.pos };
    cleanser.prevPos = { ...cleanser.pos };
    applyIgnivarBrand(cleanser, boss);

    const events = sim.tick();

    expect(boss.ignivar.conduitTimers.north_west).toBe(5);
    expect(cleanser.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
    expect(
      events.some(
        (event) => event.type === 'damage' && event.ability === IGNIVAR_CLEANSING_BACKLASH_ID,
      ),
    ).toBe(false);
  });

  it('ticks and resolves a conduit before the final Last Inferno wipe', () => {
    const { sim, boss, conduit } = claimedHeroicEncounter();
    const cleanser = addEncounterPlayer(sim, boss, 'Last Inferno Cleanser');
    sim.player.devGod = true;
    cleanser.devGod = true;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.lastInfernoTriggered = true;
    boss.ignivar.lastInfernoResolved = false;
    boss.ignivar.lastInfernoRemaining = DT;
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
    boss.ignivar.conduitTimers.north_west = 5;
    cleanser.pos = { ...conduit.pos };
    cleanser.prevPos = { ...cleanser.pos };
    applyIgnivarBrand(cleanser, boss);

    const events = sim.tick();
    const damageAbilities = events
      .filter((event) => event.type === 'damage')
      .map((event) => event.ability);

    expect(boss.ignivar.conduitTimers.north_west).toBeCloseTo(5 - DT);
    expect(cleanser.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(damageAbilities).toContain(IGNIVAR_CLEANSING_BACKLASH_ID);
    expect(damageAbilities.indexOf(IGNIVAR_CLEANSING_BACKLASH_ID)).toBeLessThan(
      damageAbilities.indexOf('Last Inferno'),
    );
    expect(boss.ignivar.lastInfernoResolved).toBe(true);
  });

  it('excludes dead raid members from Heroic Cleansing Backlash', () => {
    const { sim, boss, conduit } = claimedHeroicEncounter();
    const cleanser = addEncounterPlayer(sim, boss, 'Living Heroic Cleanser');
    const deadPlayer = addEncounterPlayer(sim, boss, 'Dead Heroic Raider');
    prepareConduitCleanse(sim, boss, conduit);
    cleanser.pos = { ...conduit.pos };
    deadPlayer.pos = { ...conduit.pos };
    for (const player of [sim.player, cleanser]) {
      player.maxHp = 1_000;
      player.hp = player.maxHp;
    }
    deadPlayer.dead = true;
    deadPlayer.hp = 0;
    applyIgnivarBrand(cleanser, boss);
    applyIgnivarBrand(deadPlayer, boss);

    const events = sim.tick();

    const expectedDamage = 1_000 * IGNIVAR_CLEANSING_BACKLASH_DAMAGE_MAX_HP;
    expect(sim.player.hp).toBe(1_000 - expectedDamage);
    expect(cleanser.hp).toBe(1_000 - expectedDamage);
    expect(deadPlayer.hp).toBe(0);
    expect(deadPlayer.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'damage' &&
          event.ability === IGNIVAR_CLEANSING_BACKLASH_ID &&
          event.targetId === deadPlayer.id,
      ),
    ).toBe(false);
  });

  it('damages an overlapping Heroic ally without propagating Brand', () => {
    const { sim, boss } = claimedHeroicEncounter();
    const allyPid = sim.addPlayer('priest', 'Waterbearer');
    const allyMeta = sim.players.get(allyPid);
    const ally = allyMeta ? sim.entities.get(allyMeta.entityId) : undefined;
    if (!ally) throw new Error('Raid ally did not spawn');
    const origin = instanceOrigin(DUNGEONS.ignivar_raid_arena.index, 0);
    sim.player.pos = { x: origin.x + 15, y: 0, z: origin.z };
    ally.pos = { ...sim.player.pos };
    boss.swingTimer = 999;
    sim.player.auras.push({
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 600,
      duration: 600,
      value: 1,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.overlapTimer = 0;
    const carrierHp = sim.player.hp;
    const allyHp = ally.hp;

    updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.hp).toBe(carrierHp - Math.ceil(sim.player.maxHp * 0.06));
    expect(ally.hp).toBe(allyHp - Math.ceil(ally.maxHp * 0.06));
    expect(ally.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    ally.pos.x += 10;
    boss.ignivar.overlapTimer = 0;
    const separatedCarrierHp = sim.player.hp;
    const separatedAllyHp = ally.hp;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.hp).toBe(separatedCarrierHp);
    expect(ally.hp).toBe(separatedAllyHp);
  });

  it('preserves the exact pull during combat-exit memory but cleans brands outside on reset', () => {
    const { sim, boss, conduit } = claimedEncounter();
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    sim.player.auras.push({
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 600,
      duration: 600,
      value: 1,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
    boss.ignivar.conduitTimers.north_west = 7;
    boss.combatExitHoldUntil = sim.ctx.time + 5;
    sim.player.pos = { x: 0, y: 0, z: 0 };

    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.aiState).toBe('evade');
    expect(boss.ignivar).toBeDefined();
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.active);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);

    boss.combatExitHoldUntil = sim.ctx.time;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar).toBeUndefined();
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.ready);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
  });

  it('removes encounter-owned player auras immediately when leaving the development raid', () => {
    const { sim, boss } = claimedEncounter();
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 0;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
    sim.player.auras.push({
      id: IGNIVAR_MOLTEN_ARMOR_AURA_ID,
      name: 'Molten Armor',
      kind: 'vulnerability',
      remaining: 30,
      duration: 30,
      value: IGNIVAR_MOLTEN_ARMOR_PER_STACK,
      stacks: 2,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });

    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);

    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID)).toBe(false);
  });

  it('cleans brands, casts, and conduit state immediately when Ignivar dies', () => {
    const { sim, boss, conduit } = claimedEncounter();
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.apocalypseTriggered = true;
    boss.ignivar.apocalypseResolved = true;
    boss.ignivar.forgeJudgmentPhase = 'done';
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_LAST_INFERNO_HP_THRESHOLD);
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.enraged).toBe(true);
    boss.ignivar.frontalCastRemaining = 2;
    boss.castingAbility = IGNIVAR_FRONTAL_CAST_ID;
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
    sim.player.auras.push({
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 600,
      duration: 600,
      value: 1,
      sourceId: boss.id,
      school: 'fire',
      encounterOwned: true,
    });

    boss.dead = true;
    sim.tick();

    expect(boss.ignivar).toBeUndefined();
    expect(boss.enraged).toBe(false);
    expect(boss.auras.some((aura) => aura.id === IGNIVAR_LAST_INFERNO_AURA_ID)).toBe(false);
    expect(boss.castingAbility).toBeNull();
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.ready);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
  });

  it('ticks the frontal cadence during its cast and honors forced-target threat', () => {
    const { sim, boss } = claimedEncounter();
    const tankPid = sim.addPlayer('paladin', 'Second Tank');
    const tankMeta = sim.players.get(tankPid);
    const tank = tankMeta ? sim.entities.get(tankMeta.entityId) : undefined;
    if (!tank) throw new Error('Second tank did not spawn');
    tank.pos = { ...sim.player.pos };
    boss.forcedTargetId = tank.id;
    boss.forcedTargetTimer = 3;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.aggroTargetId).toBe(tank.id);
    expect(boss.forcedTargetTimer).toBeLessThan(3);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.frontalTimer = 0;

    updateIgnivarEncounter(sim.ctx, boss);
    let sawRelease = false;
    let secondCastTicks = 0;
    for (let i = 1; i <= 600; i++) {
      updateIgnivarEncounter(sim.ctx, boss);
      if (boss.castingAbility === null) sawRelease = true;
      if (sawRelease && boss.castingAbility === IGNIVAR_FRONTAL_CAST_ID) {
        secondCastTicks = i;
        break;
      }
    }

    expect(secondCastTicks * DT).toBeCloseTo(IGNIVAR_FRONTAL_EVERY, 5);
  });

  it('selects exactly three unique targets deterministically from a ten-player raid', () => {
    const selectTargets = (seed: number): number[] => {
      const { sim, boss } = claimedEncounter(seed);
      const origin = instanceOrigin(DUNGEONS.ignivar_raid_arena.index, 0);
      for (let i = 1; i < 10; i++) sim.addPlayer(i % 2 === 0 ? 'mage' : 'priest', `Raider ${i}`);
      for (const meta of sim.players.values()) {
        const player = sim.entities.get(meta.entityId);
        if (player) player.pos = { x: origin.x + 15, y: 0, z: origin.z };
      }
      boss.swingTimer = 999;
      updateIgnivarEncounter(sim.ctx, boss);
      if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
      boss.ignivar.brandTimer = 0;
      boss.ignivar.frontalTimer = 999;
      updateIgnivarEncounter(sim.ctx, boss);
      return [...sim.players.values()]
        .map((meta) => sim.entities.get(meta.entityId))
        .filter((player) => player?.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID))
        .map((player) => player?.id ?? -1)
        .sort((a, b) => a - b);
    };

    const first = selectTargets(99);
    expect(first).toHaveLength(IGNIVAR_BRAND_TARGETS_NORMAL);
    expect(new Set(first).size).toBe(IGNIVAR_BRAND_TARGETS_NORMAL);
    expect(selectTargets(99)).toEqual(first);
  });

  it('honors the ten-second active window and leaves the conduit spent for the pull', () => {
    const { sim, boss, conduit } = claimedEncounter();
    sim.player.devGod = true;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.swingTimer = 999;
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
    boss.ignivar.conduitTimers.north_west = IGNIVAR_CONDUIT_ACTIVE_SECONDS;

    let activeTicks = 0;
    while (conduit.templateId === IGNIVAR_WATER_CONDUIT_TEMPLATES.active && activeTicks < 1_000) {
      updateIgnivarEncounter(sim.ctx, boss);
      activeTicks++;
    }
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown);
    expect(activeTicks * DT).toBeCloseTo(IGNIVAR_CONDUIT_ACTIVE_SECONDS, 5);

    for (let tick = 0; tick < 40 / DT; tick++) updateIgnivarEncounter(sim.ctx, boss);
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown);
    expect(boss.ignivar.conduitTimers.north_west).toBeUndefined();
  });

  it('only re-arms a spent conduit when the encounter resets', () => {
    const { sim, boss, conduit } = claimedEncounter();
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
    boss.ignivar.conduitTimers.north_west = 0.01;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown);
    boss.ignivar.conduitTimers.north_west = 0.01;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.cooldown);

    sim.player.auras.push({
      id: IGNIVAR_BRAND_AURA_ID,
      name: 'Brand of the Pyre',
      kind: 'dot',
      remaining: 600,
      duration: 600,
      value: 1,
      sourceId: boss.id,
      school: 'fire',
    });
    resetIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar).toBeUndefined();
    expect(boss.castingAbility).toBeNull();
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.ready);
    expect(sim.player.auras.some((a) => a.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
  });

  it('starts Last Inferno at twenty percent and replaces overlapping normal mechanics', () => {
    const { sim, boss } = claimedEncounter();
    sim.player.devGod = true;
    const normalSwingInterval = boss.weapon.speed * sim.ctx.swingIntervalMult(boss);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.apocalypseTriggered = true;
    boss.ignivar.apocalypseResolved = true;
    boss.ignivar.forgeJudgmentPhase = 'done';
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_LAST_INFERNO_HP_THRESHOLD) + 1;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.enraged).toBe(false);
    expect(boss.ignivar?.lastInfernoTriggered).toBe(false);

    boss.hp = Math.floor(boss.maxHp * IGNIVAR_LAST_INFERNO_HP_THRESHOLD);
    boss.ignivar.brandTimer = DT;
    boss.ignivar.frontalTimer = DT;
    boss.ignivar.forgeStrikeTimer = DT;
    boss.ignivar.forgeWaveTimer = DT;
    boss.ignivar.soakTimer = DT;
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 2 };
    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.enraged).toBe(true);
    expect(boss.ignivar.lastInfernoTriggered).toBe(true);
    expect(boss.ignivar.lastInfernoRemaining).toBe(IGNIVAR_LAST_INFERNO_SECONDS);
    expect(boss.auras.find((aura) => aura.id === IGNIVAR_LAST_INFERNO_AURA_ID)).toMatchObject({
      remaining: IGNIVAR_LAST_INFERNO_SECONDS,
      value: 1.2,
      encounterOwned: true,
    });
    expect(boss.weapon.speed * sim.ctx.swingIntervalMult(boss)).toBeCloseTo(
      normalSwingInterval / 1.2,
      5,
    );
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_MOLTEN_ARMOR_AURA_ID)).toBe(false);
    expect(boss.castingAbility).toBeNull();
    expect(boss.ignivar.forgeWaveTimer).toBe(DT);
    expect(boss.ignivar.soakTimer).toBe(DT);
    expect(boss.ignivar.finalNextFrontal).toBe('searing');

    boss.ignivar.meteorTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.finalFrontalTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar.forgeWaveTimer).toBe(DT);
    expect(boss.ignivar.soakTimer).toBe(DT);
    expect(boss.castingAbility).toBeNull();
  });

  it('waits for Shared Pyre to resolve before entering Last Inferno', () => {
    const { sim, boss } = claimedEncounter(9218);
    sim.player.devGod = true;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.apocalypseTriggered = true;
    boss.ignivar.apocalypseResolved = true;
    boss.ignivar.forgeJudgmentPhase = 'done';
    boss.ignivar.brandTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.skyfireTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.forgeWaveTimer = 999;
    boss.ignivar.soakTargetId = sim.player.id;
    boss.ignivar.soakRemaining = DT;
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_LAST_INFERNO_HP_THRESHOLD);

    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar.lastInfernoTriggered).toBe(false);
    expect(boss.ignivar.soakTargetId).toBeNull();

    let ticksUntilFirstFinalCast = 0;
    while (boss.castingAbility === null && ticksUntilFirstFinalCast < 200) {
      updateIgnivarEncounter(sim.ctx, boss);
      ticksUntilFirstFinalCast++;
    }

    expect(boss.ignivar.lastInfernoTriggered).toBe(true);
    expect(ticksUntilFirstFinalCast * DT).toBeGreaterThanOrEqual(6);
    expect(boss.castingAbility).toBe(IGNIVAR_FRONTAL_CAST_ID);
  });

  it('increases Ignivar melee damage by thirty-five percent during Last Inferno', () => {
    const normal = claimedEncounter(9217);
    const enraged = claimedEncounter(9217);
    normal.sim.setPlayerLevel(20);
    enraged.sim.setPlayerLevel(20);
    normal.boss.enraged = false;
    enraged.boss.enraged = true;
    normal.sim.player.maxHp = 1_000_000;
    normal.sim.player.hp = normal.sim.player.maxHp;
    enraged.sim.player.maxHp = 1_000_000;
    enraged.sim.player.hp = enraged.sim.player.maxHp;

    const normalHp = normal.sim.player.hp;
    const enragedHp = enraged.sim.player.hp;
    for (let attempt = 0; attempt < 20; attempt++) {
      normal.sim.ctx.mobSwing(normal.boss, normal.sim.player);
      enraged.sim.ctx.mobSwing(enraged.boss, enraged.sim.player);
    }
    const normalDamage = normalHp - normal.sim.player.hp;
    const enragedDamage = enragedHp - enraged.sim.player.hp;

    expect(normalDamage).toBeGreaterThan(0);
    expect(enragedDamage).toBeGreaterThan(normalDamage);
    expect(enragedDamage / normalDamage).toBeCloseTo(1.35, 1);
  });

  it('wipes the claimed raid exactly when the forty-five-second Last Inferno expires', () => {
    const { sim, boss } = claimedEncounter();
    const outsiderPid = sim.addPlayer('mage', 'Outsider');
    const outsider = sim.entities.get(sim.players.get(outsiderPid)?.entityId ?? -1);
    if (!outsider) throw new Error('Outsider did not spawn');
    outsider.pos = { x: 0, y: 0, z: 0 };
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.apocalypseTriggered = true;
    boss.ignivar.apocalypseResolved = true;
    boss.ignivar.forgeJudgmentPhase = 'done';
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_LAST_INFERNO_HP_THRESHOLD);
    updateIgnivarEncounter(sim.ctx, boss);
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.meteorTimer = 999;
    boss.ignivar.finalFrontalTimer = 999;
    boss.swingTimer = 999;

    const preWipeTicks = Math.round(IGNIVAR_LAST_INFERNO_SECONDS / DT) - 1;
    for (let i = 0; i < preWipeTicks; i++) updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.dead).toBe(false);
    expect(boss.ignivar.lastInfernoRemaining).toBeCloseTo(DT, 5);

    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.dead).toBe(true);
    expect(outsider.dead).toBe(false);
    expect(boss.ignivar.lastInfernoResolved).toBe(true);
  });

  it('announces Last Inferno without taking over the boss cast bar', () => {
    const { sim, boss } = claimedEncounter();
    sim.player.devGod = true;
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.apocalypseTriggered = true;
    boss.ignivar.apocalypseResolved = true;
    boss.ignivar.forgeJudgmentPhase = 'done';
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.ignivar.forgeStrikeTimer = 999;
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_LAST_INFERNO_HP_THRESHOLD);

    const events = sim.tick();

    expect(boss.castingAbility).toBeNull();
    expect(
      events.some(
        (event) =>
          event.type === 'chat' &&
          event.channel === 'yell' &&
          event.text === 'The last flame consumes all!',
      ),
    ).toBe(true);

    const nextEvents = sim.tick();
    expect(
      nextEvents.some(
        (event) =>
          event.type === 'chat' &&
          event.channel === 'yell' &&
          event.text === 'The last flame consumes all!',
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'spellfx' &&
          event.sourceId === boss.id &&
          event.targetId === boss.id &&
          event.fx === 'nova',
      ),
    ).toBe(true);
  });

  it('ships one Normal Apocalypse add at the sixty-five-percent health gate', () => {
    expect(IGNIVAR_APOCALYPSE_HP_THRESHOLD).toBe(0.65);
    expect(IGNIVAR_APOCALYPSE_CAST_SECONDS).toBe(20);

    const { sim, boss } = claimedEncounter();
    sim.player.devGod = true;
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_APOCALYPSE_HP_THRESHOLD) + 1;
    updateIgnivarEncounter(sim.ctx, boss);
    expect(
      [...sim.entities.values()].filter(
        (entity) => entity.templateId === IGNIVAR_APOCALYPSE_ADD_ID,
      ),
    ).toHaveLength(0);
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_APOCALYPSE_HP_THRESHOLD);

    updateIgnivarEncounter(sim.ctx, boss);

    const adds = [...sim.entities.values()].filter(
      (entity) => entity.templateId === IGNIVAR_APOCALYPSE_ADD_ID,
    );
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({
      hostile: true,
      inCombat: true,
      castingAbility: IGNIVAR_APOCALYPSE_CAST_ID,
      castTotal: IGNIVAR_APOCALYPSE_CAST_SECONDS,
      castRemaining: IGNIVAR_APOCALYPSE_CAST_SECONDS,
      channeling: true,
    });
    expect(boss).toMatchObject({
      hostile: true,
      inCombat: true,
      aiState: 'attack',
    });
    expect(boss.ignivar?.apocalypseAddId).toBe(adds[0].id);
    expect(boss.summonedIds).toContain(adds[0].id);
    for (let i = 0; i < 50; i++) updateIgnivarEncounter(sim.ctx, boss);
    expect(
      [...sim.entities.values()].filter(
        (entity) => entity.templateId === IGNIVAR_APOCALYPSE_ADD_ID,
      ),
    ).toHaveLength(1);
  });

  it('announces Apocalypse with a raid-wide yell and a location-safe spawn effect', () => {
    const { sim, boss } = claimedEncounter();
    sim.player.devGod = true;
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_APOCALYPSE_HP_THRESHOLD);

    const events = sim.tick();
    const add = [...sim.entities.values()].find(
      (entity) => entity.templateId === IGNIVAR_APOCALYPSE_ADD_ID,
    );
    if (!add) throw new Error('Apocalypse add did not spawn');
    expect(
      events.some(
        (event) =>
          event.type === 'chat' &&
          event.channel === 'yell' &&
          event.text === 'The Heart of the End awakens. Let the world burn!',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'spellfxAt' &&
          event.x === add.pos.x &&
          event.z === add.pos.z &&
          event.fx === 'nova',
      ),
    ).toBe(true);

    const nextEvents = sim.tick();
    expect(
      nextEvents.some(
        (event) =>
          event.type === 'chat' &&
          event.channel === 'yell' &&
          event.text === 'The Heart of the End awakens. Let the world burn!',
      ),
    ).toBe(false);
  });

  it('keeps the Apocalypse add stationary and non-attacking while Ignivar stays active', () => {
    const { sim, boss } = claimedEncounter();
    sim.player.devGod = true;
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_APOCALYPSE_HP_THRESHOLD);
    updateIgnivarEncounter(sim.ctx, boss);
    const add = [...sim.entities.values()].find(
      (entity) => entity.templateId === IGNIVAR_APOCALYPSE_ADD_ID,
    );
    if (!add) throw new Error('Apocalypse add did not spawn');
    const spawn = { ...add.pos };
    const swingBefore = add.swingTimer;
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = DT;
    boss.ignivar.frontalTimer = DT;

    updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
    expect(boss.castingAbility).toBe(IGNIVAR_FRONTAL_CAST_ID);

    for (let i = 0; i < 40; i++) sim.tick();

    expect(add.pos).toEqual(spawn);
    expect(add.swingTimer).toBe(swingBefore);
    expect(add.castingAbility).toBe(IGNIVAR_APOCALYPSE_CAST_ID);
    expect(add.castRemaining).toBeLessThan(IGNIVAR_APOCALYPSE_CAST_SECONDS);
    expect(boss.inCombat).toBe(true);
    expect(boss.aiState).toBe('attack');
  });

  it('cancels Apocalypse when the add dies and never summons it twice in one pull', () => {
    const { sim, boss } = claimedEncounter();
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_APOCALYPSE_HP_THRESHOLD);
    updateIgnivarEncounter(sim.ctx, boss);
    const add = [...sim.entities.values()].find(
      (entity) => entity.templateId === IGNIVAR_APOCALYPSE_ADD_ID,
    );
    if (!add) throw new Error('Apocalypse add did not spawn');

    sim.ctx.dealDamage(
      sim.player,
      add,
      add.maxHp * 100,
      false,
      'physical',
      'Test Kill',
      'hit',
      true,
    );
    expect(add.dead).toBe(true);
    const hpBefore = sim.player.hp;
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.swingTimer = 999;

    const ticksPastOriginalDeadline = Math.round(IGNIVAR_APOCALYPSE_CAST_SECONDS / DT) + 1;
    for (let i = 0; i < ticksPastOriginalDeadline; i++) updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.dead).toBe(false);
    expect(sim.player.hp).toBe(hpBefore);
    expect(boss.ignivar?.apocalypseResolved).toBe(true);
    expect(
      [...sim.entities.values()].filter(
        (entity) => entity.templateId === IGNIVAR_APOCALYPSE_ADD_ID && !entity.dead,
      ),
    ).toHaveLength(0);
  });

  it('wipes only living players inside the claimed arena when Apocalypse completes', () => {
    const { sim, boss } = claimedEncounter();
    const raiderPid = sim.addPlayer('priest', 'Raid Healer');
    const outsiderPid = sim.addPlayer('mage', 'Outsider');
    const raider = sim.entities.get(sim.players.get(raiderPid)?.entityId ?? -1);
    const outsider = sim.entities.get(sim.players.get(outsiderPid)?.entityId ?? -1);
    if (!raider || !outsider) throw new Error('Test players did not spawn');
    raider.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 12 };
    outsider.pos = { x: 0, y: 0, z: 0 };
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_APOCALYPSE_HP_THRESHOLD);
    updateIgnivarEncounter(sim.ctx, boss);
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.brandTimer = 999;
    boss.ignivar.frontalTimer = 999;
    boss.swingTimer = 999;

    const preWipeTicks = Math.round(IGNIVAR_APOCALYPSE_CAST_SECONDS / DT) - 1;
    for (let i = 0; i < preWipeTicks; i++) updateIgnivarEncounter(sim.ctx, boss);
    expect(sim.player.dead).toBe(false);
    expect(raider.dead).toBe(false);
    expect(boss.ignivar.apocalypseCastRemaining).toBeCloseTo(DT, 5);

    updateIgnivarEncounter(sim.ctx, boss);

    expect(sim.player.dead).toBe(true);
    expect(raider.dead).toBe(true);
    expect(outsider.dead).toBe(false);
    expect(boss.ignivar.apocalypseResolved).toBe(true);
  });

  it('despawns the Apocalypse add on reset and rearms it for a fresh pull', () => {
    const { sim, boss } = claimedEncounter();
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_APOCALYPSE_HP_THRESHOLD);
    updateIgnivarEncounter(sim.ctx, boss);
    const firstAddId = boss.ignivar?.apocalypseAddId;
    if (firstAddId === null || firstAddId === undefined) {
      throw new Error('Apocalypse add did not spawn');
    }
    sim.player.targetId = firstAddId;

    resetIgnivarEncounter(sim.ctx, boss);

    expect(sim.entities.has(firstAddId)).toBe(false);
    expect(sim.player.targetId).toBeNull();
    expect(boss.summonedIds).toEqual([]);
    updateIgnivarEncounter(sim.ctx, boss);
    const secondAddId = boss.ignivar?.apocalypseAddId;
    expect(secondAddId).not.toBeNull();
    expect(secondAddId).not.toBe(firstAddId);
    expect(sim.entities.get(secondAddId ?? -1)?.templateId).toBe(IGNIVAR_APOCALYPSE_ADD_ID);
  });
});
