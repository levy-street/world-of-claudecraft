import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  abilityVfxFullSpecFor,
  abilityVfxSpecFor,
} from '../src/render/ability_vfx/encounter_specs';
import { sharedUniforms } from '../src/render/gfx';
import { ignivarEncounterVisualPlan } from '../src/render/ignivar_encounter_core';
import { IGNIVAR_FIRE_BEAM_CORE_NAME } from '../src/render/ignivar_fire_beams';
import {
  buildIgnivarForgeJudgmentVisual,
  IGNIVAR_JUDGMENT_FIRE_NAME,
  IGNIVAR_JUDGMENT_SAFE_MARKER_NAME,
  IGNIVAR_JUDGMENT_SHELTERS_NAME,
  IGNIVAR_JUDGMENT_VISUAL_NAME,
  IGNIVAR_JUDGMENT_WARNINGS_NAME,
  ignivarForgeGroundFireGlsl,
  ignivarForgeShelterClipGlsl,
  syncIgnivarForgeJudgmentVisual,
} from '../src/render/ignivar_forge_judgment';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  IGNIVAR_APOCALYPSE_HP_THRESHOLD,
  IGNIVAR_BRAND_AURA_ID,
  IGNIVAR_FINAL_FIRST_ROTATING_RAYS_SECONDS,
  IGNIVAR_FINAL_FRONTAL_EVERY,
  IGNIVAR_FINAL_METEOR_EVERY,
  IGNIVAR_FINAL_ROTATING_RAYS_EVERY,
  IGNIVAR_FINAL_ROTATING_RAYS_SPEED_MULTIPLIER,
  IGNIVAR_FRONTAL_CAST_ID,
  IGNIVAR_JUDGMENT_CAST_ID,
  IGNIVAR_LAST_INFERNO_AURA_ID,
  IGNIVAR_LAST_INFERNO_HP_THRESHOLD,
  IGNIVAR_ROTATING_RAYS_ANGULAR_SPEED,
  IGNIVAR_ROTATING_RAYS_CAST_ID,
  IGNIVAR_SKYFIRE_CAST_ID,
  updateIgnivarEncounter,
} from '../src/sim/encounters/ignivar';
import { IGNIVAR_WATER_CONDUIT_TEMPLATES } from '../src/sim/ignivar_arena';
import {
  IGNIVAR_JUDGMENT_ACTIVE_SECONDS,
  IGNIVAR_JUDGMENT_ARENA_RADIUS,
  IGNIVAR_JUDGMENT_BURN_DAMAGE_MAX_HP,
  IGNIVAR_JUDGMENT_DURATION_SECONDS,
  IGNIVAR_JUDGMENT_HP_THRESHOLD,
  IGNIVAR_JUDGMENT_PULSE_SECONDS,
  IGNIVAR_JUDGMENT_SHELTER_COUNT,
  IGNIVAR_JUDGMENT_SHELTER_RADIUS,
  IGNIVAR_JUDGMENT_WARNING_SECONDS,
  ignivarClosestForgeShelterIndex,
  ignivarForgeLayoutFacing,
  ignivarForgeLayoutFromFacing,
  ignivarForgeShelterOffsets,
  ignivarForgeShelterPoints,
  ignivarPointInForgeShelter,
  ignivarPointOnJudgmentFire,
} from '../src/sim/ignivar_forge_judgment';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import {
  DT,
  type Entity,
  IGNIVAR_BOSS_ID,
  type PlayerClass,
  type SimEvent,
} from '../src/sim/types';

function claimedEncounter(seed = 42, difficulty: 'normal' | 'heroic' = 'normal') {
  const sim = new Sim({ seed, playerClass: 'warrior', devCommands: true });
  if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', sim.player.id);
  expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', sim.player.id, true)).toBe(true);
  const boss = [...sim.entities.values()].find((entity) => entity.templateId === IGNIVAR_BOSS_ID);
  if (!boss) throw new Error('Ignivar did not spawn');
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  updateIgnivarEncounter(sim.ctx, boss);
  if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
  boss.ignivar.apocalypseTriggered = true;
  boss.ignivar.apocalypseResolved = true;
  boss.ignivar.apocalypseAddId = null;
  boss.ignivar.brandTimer = 999;
  boss.ignivar.forgeStrikeTimer = 999;
  boss.ignivar.frontalTimer = 999;
  boss.ignivar.skyfireTimer = 999;
  boss.ignivar.meteorTimer = 999;
  boss.ignivar.rotatingRaysTimer = 999;
  boss.ignivar.forgeWaveTimer = 999;
  boss.ignivar.soakTimer = 999;
  boss.ignivar.overlapTimer = 999;
  boss.swingTimer = 999;
  return { sim, boss };
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
  player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z };
  player.prevPos = { ...player.pos };
  return player;
}

function applyBrand(player: Entity, boss: Entity): void {
  player.auras.push({
    id: IGNIVAR_BRAND_AURA_ID,
    name: 'Brand of the Pyre',
    kind: 'dot',
    remaining: 600,
    duration: 600,
    value: Math.ceil(player.maxHp * 0.15),
    tickInterval: 2,
    tickTimer: 1,
    stacks: 3,
    maxTickStacks: 3,
    sourceId: boss.id,
    school: 'fire',
    finalDamage: true,
    encounterOwned: true,
  });
}

function finaleTrace(seed: number) {
  const { sim, boss } = claimedEncounter(seed);
  const second = addEncounterPlayer(sim, boss, 'Finale Two', 'mage');
  const third = addEncounterPlayer(sim, boss, 'Finale Three', 'priest');
  sim.player.devGod = true;
  second.devGod = true;
  third.devGod = true;
  sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 4 };
  second.pos = { x: boss.pos.x + 7, y: boss.pos.y, z: boss.pos.z + 5 };
  third.pos = { x: boss.pos.x - 9, y: boss.pos.y, z: boss.pos.z + 3 };
  if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
  boss.ignivar.forgeJudgmentPhase = 'done';
  boss.hp = Math.floor(boss.maxHp * IGNIVAR_LAST_INFERNO_HP_THRESHOLD);

  const casts: Array<{
    tick: number;
    id: string;
    facing: number;
    direction: number;
  }> = [];
  const meteors: Array<{ tick: number; x: number; z: number }> = [];
  let previousCast: string | null = null;
  for (let tick = 0; tick < 40 / DT; tick++) {
    const events = sim.tick();
    const cast = boss.castingAbility;
    if (cast !== null && cast !== previousCast) {
      casts.push({
        tick,
        id: cast,
        facing: Number(boss.facing.toFixed(6)),
        direction: boss.ignivar.rotatingRaysDirection,
      });
    }
    previousCast = cast;
    for (const event of events) {
      if (
        event.type !== 'spellfxAt' ||
        event.fx !== 'meteorFall' ||
        event.ability !== 'Falling Cinders'
      ) {
        continue;
      }
      meteors.push({
        tick,
        x: Number(event.x.toFixed(4)),
        z: Number(event.z.toFixed(4)),
      });
    }
  }
  return { casts, meteors };
}

describe('Ignivar Forge Judgment', () => {
  it('pins the phase timing and the exact shared shelter and fire geometry', () => {
    expect(IGNIVAR_JUDGMENT_SHELTER_COUNT).toBe(3);
    expect(IGNIVAR_JUDGMENT_HP_THRESHOLD).toBe(0.45);
    expect(IGNIVAR_JUDGMENT_WARNING_SECONDS).toBe(4);
    expect(IGNIVAR_JUDGMENT_ACTIVE_SECONDS).toBe(8);
    expect(IGNIVAR_JUDGMENT_DURATION_SECONDS).toBe(12);
    expect(IGNIVAR_JUDGMENT_SHELTER_RADIUS).toBe(5.5);
    expect(IGNIVAR_JUDGMENT_PULSE_SECONDS).toBe(0.5);
    expect(IGNIVAR_JUDGMENT_BURN_DAMAGE_MAX_HP).toBe(0.12);

    for (let slot = 0; slot < 24; slot++) {
      for (const safeIndex of [0, 1, 2] as const) {
        const facing = Number(ignivarForgeLayoutFacing(slot, safeIndex).toFixed(2));
        expect(ignivarForgeLayoutFromFacing(facing)).toEqual({
          rotation: (slot * Math.PI * 2) / 24,
          safeIndex,
        });
      }
    }

    const origin = { x: 100, z: -50 };
    const rotation = 0.73;
    const shelters = ignivarForgeShelterPoints(origin, rotation);
    expect(shelters).toHaveLength(3);
    expect(new Set(shelters.map((point) => `${point.x}:${point.z}`)).size).toBe(3);
    expect(ignivarForgeShelterPoints(origin, rotation + 0.5)).not.toEqual(shelters);
    for (let slot = 0; slot < 24; slot++) {
      const points = ignivarForgeShelterPoints(origin, (slot * Math.PI * 2) / 24);
      for (let first = 0; first < points.length; first++) {
        expect(
          Math.hypot(points[first].x - origin.x, points[first].z - origin.z),
        ).toBeLessThanOrEqual(IGNIVAR_JUDGMENT_ARENA_RADIUS - IGNIVAR_JUDGMENT_SHELTER_RADIUS);
        for (let second = first + 1; second < points.length; second++) {
          expect(
            Math.hypot(points[first].x - points[second].x, points[first].z - points[second].z),
          ).toBeGreaterThanOrEqual(IGNIVAR_JUDGMENT_SHELTER_RADIUS * 2);
        }
      }
    }
    const safeIndex = 1;
    const safe = shelters[safeIndex];
    expect(
      ignivarPointInForgeShelter(origin, rotation, safeIndex, {
        x: safe.x + IGNIVAR_JUDGMENT_SHELTER_RADIUS,
        z: safe.z,
      }),
    ).toBe(true);
    expect(
      ignivarPointInForgeShelter(origin, rotation, safeIndex, {
        x: safe.x + IGNIVAR_JUDGMENT_SHELTER_RADIUS + 0.01,
        z: safe.z,
      }),
    ).toBe(false);
    expect(ignivarClosestForgeShelterIndex(origin, rotation, safe)).toBe(safeIndex);
    expect(ignivarPointOnJudgmentFire(origin, rotation, safeIndex, origin)).toBe(true);
    expect(ignivarPointOnJudgmentFire(origin, rotation, safeIndex, safe)).toBe(false);
    expect(ignivarPointOnJudgmentFire(origin, rotation, safeIndex, shelters[0])).toBe(true);
    expect(
      ignivarPointOnJudgmentFire(origin, rotation, safeIndex, {
        x: origin.x + IGNIVAR_JUDGMENT_ARENA_RADIUS,
        z: origin.z,
      }),
    ).toBe(true);
    expect(
      ignivarPointOnJudgmentFire(origin, rotation, safeIndex, {
        x: origin.x + IGNIVAR_JUDGMENT_ARENA_RADIUS + 0.01,
        z: origin.z,
      }),
    ).toBe(false);
  });

  it('creates three random refuges, marks one safe, burns everywhere else and runs no rays', () => {
    const { sim, boss } = claimedEncounter(7301);
    sim.player.devGod = true;
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_JUDGMENT_HP_THRESHOLD) + 1;
    sim.tick();
    expect(boss.ignivar?.forgeJudgmentPhase).toBe('idle');

    boss.hp = Math.floor(boss.maxHp * IGNIVAR_JUDGMENT_HP_THRESHOLD);
    const warningEvents = sim.tick();
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    const origin = instanceOrigin(DUNGEONS.ignivar_raid_arena.index, 0);
    const shelters = ignivarForgeShelterPoints(origin, boss.ignivar.forgeJudgmentRotation);
    const safeIndex = boss.ignivar.forgeJudgmentSafeIndex;
    const safe = shelters[safeIndex];
    const decoys = shelters.filter((_, index) => index !== safeIndex);

    expect(boss.ignivar.forgeJudgmentPhase).toBe('warning');
    expect(boss.pos.x).toBe(origin.x);
    expect(boss.pos.z).toBe(origin.z);
    expect(boss.castingAbility).toBe(IGNIVAR_JUDGMENT_CAST_ID);
    expect(boss.castTotal).toBe(IGNIVAR_JUDGMENT_DURATION_SECONDS);
    expect(boss.channeling).toBe(false);
    expect(boss.castAim).toBeNull();
    expect(ignivarForgeLayoutFromFacing(boss.facing)).toEqual({
      rotation: boss.ignivar.forgeJudgmentRotation,
      safeIndex,
    });
    expect(
      warningEvents.filter(
        (event) =>
          event.type === 'spellfxAt' &&
          event.fx === 'meteorFall' &&
          event.ability === IGNIVAR_JUDGMENT_CAST_ID,
      ),
    ).toHaveLength(0);

    const wrongRefuge = addEncounterPlayer(sim, boss, 'Wrong Refuge');
    const otherWrongRefuge = addEncounterPlayer(sim, boss, 'Other Wrong Refuge');
    const exposed = addEncounterPlayer(sim, boss, 'Exposed Center');
    sim.player.pos = { x: safe.x, y: boss.pos.y, z: safe.z };
    wrongRefuge.pos = { x: decoys[0].x, y: boss.pos.y, z: decoys[0].z };
    otherWrongRefuge.pos = { x: decoys[1].x, y: boss.pos.y, z: decoys[1].z };
    exposed.pos = { x: origin.x, y: boss.pos.y, z: origin.z };
    const impactHealth = [sim.player, wrongRefuge, otherWrongRefuge, exposed].map(
      (player) => player.hp,
    );
    sim.player.devGod = false;
    boss.ignivar.forgeJudgmentRemaining = IGNIVAR_JUDGMENT_ACTIVE_SECONDS + DT;
    const impactEvents = sim.tick();
    expect(boss.ignivar.forgeJudgmentPhase).toBe('active');
    expect(boss.channeling).toBe(true);
    expect(boss.castingAbility).toBe(IGNIVAR_JUDGMENT_CAST_ID);
    expect(
      impactEvents
        .filter(
          (event): event is Extract<SimEvent, { type: 'spellfxAt' }> =>
            event.type === 'spellfxAt' &&
            event.fx === 'burst' &&
            event.ability === IGNIVAR_JUDGMENT_CAST_ID,
        )
        .map((event) => ({ x: event.x, z: event.z })),
    ).toEqual(decoys);
    expect([sim.player, wrongRefuge, otherWrongRefuge, exposed].map((player) => player.hp)).toEqual(
      impactHealth,
    );
    expect(boss.ignivar.rotatingRaysActiveRemaining).toBe(0);

    sim.player.hp = sim.player.maxHp;
    wrongRefuge.hp = wrongRefuge.maxHp;
    otherWrongRefuge.hp = otherWrongRefuge.maxHp;
    exposed.hp = exposed.maxHp;

    sim.tick();

    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(wrongRefuge.hp).toBe(
      wrongRefuge.maxHp - Math.ceil(wrongRefuge.maxHp * IGNIVAR_JUDGMENT_BURN_DAMAGE_MAX_HP),
    );
    expect(otherWrongRefuge.hp).toBe(
      otherWrongRefuge.maxHp -
        Math.ceil(otherWrongRefuge.maxHp * IGNIVAR_JUDGMENT_BURN_DAMAGE_MAX_HP),
    );
    expect(exposed.hp).toBe(
      exposed.maxHp - Math.ceil(exposed.maxHp * IGNIVAR_JUDGMENT_BURN_DAMAGE_MAX_HP),
    );
    expect(boss.ignivar.rotatingRaysActiveRemaining).toBe(0);
    expect(ignivarForgeLayoutFromFacing(boss.facing)).toEqual({
      rotation: boss.ignivar.forgeJudgmentRotation,
      safeIndex,
    });

    sim.player.devGod = true;
    wrongRefuge.devGod = true;
    otherWrongRefuge.devGod = true;
    exposed.devGod = true;
    boss.ignivar.forgeJudgmentRemaining = DT;
    boss.ignivar.forgeJudgmentPulseTimer = 999;
    const finishEvents = sim.tick();

    expect(boss.ignivar.forgeJudgmentPhase).toBe('done');
    expect(boss.castingAbility).toBeNull();
    expect(
      finishEvents.filter(
        (event) =>
          event.type === 'spellfxAt' &&
          event.fx === 'burst' &&
          event.ability === IGNIVAR_JUDGMENT_CAST_ID,
      ),
    ).toHaveLength(3);
  });

  it('keeps normal timers frozen for all 240 Judgment ticks and applies recovery floors', () => {
    const { sim, boss } = claimedEncounter(7305);
    sim.player.devGod = true;
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_JUDGMENT_HP_THRESHOLD);
    boss.ignivar.brandTimer = 11;
    boss.ignivar.frontalTimer = 1;
    boss.ignivar.skyfireTimer = 8;
    boss.ignivar.meteorTimer = 1;
    boss.ignivar.rotatingRaysTimer = 17;
    boss.ignivar.forgeWaveTimer = 1;
    boss.ignivar.soakTimer = 13;
    const brandedAlly = addEncounterPlayer(sim, boss, 'Branded Ally');
    brandedAlly.devGod = true;
    applyBrand(sim.player, boss);
    applyBrand(brandedAlly, boss);
    const conduit = [...sim.entities.values()].find(
      (entity) => entity.templateId === IGNIVAR_WATER_CONDUIT_TEMPLATES.ready,
    );
    if (!conduit) throw new Error('Ignivar conduit did not spawn');
    conduit.templateId = IGNIVAR_WATER_CONDUIT_TEMPLATES.active;
    boss.ignivar.conduitTimers.north_west = 5;

    sim.tick();
    expect(boss.ignivar.forgeJudgmentPhase).toBe('warning');
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(brandedAlly.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.active);
    expect(boss.ignivar.conduitTimers.north_west).toBe(5);
    for (let tick = 0; tick < IGNIVAR_JUDGMENT_WARNING_SECONDS / DT; tick++) sim.tick();
    expect(boss.ignivar.forgeJudgmentPhase).toBe('active');
    expect(boss.ignivar.forgeJudgmentPulseTimer).toBe(0);
    expect([
      boss.ignivar.brandTimer,
      boss.ignivar.frontalTimer,
      boss.ignivar.skyfireTimer,
      boss.ignivar.meteorTimer,
      boss.ignivar.rotatingRaysTimer,
      boss.ignivar.forgeWaveTimer,
      boss.ignivar.soakTimer,
    ]).toEqual([11, 1, 8, 1, 17, 1, 13]);
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.active);
    expect(boss.ignivar.conduitTimers.north_west).toBe(5);

    sim.tick();
    expect(boss.ignivar.forgeJudgmentPulseTimer).toBe(IGNIVAR_JUDGMENT_PULSE_SECONDS);
    for (let tick = 0; tick < 9; tick++) sim.tick();
    expect(boss.ignivar.forgeJudgmentPulseTimer).toBeCloseTo(DT, 8);
    sim.tick();
    expect(boss.ignivar.forgeJudgmentPulseTimer).toBe(IGNIVAR_JUDGMENT_PULSE_SECONDS);
    for (let tick = 11; tick < IGNIVAR_JUDGMENT_ACTIVE_SECONDS / DT - 1; tick++) {
      sim.tick();
    }

    expect(boss.ignivar.forgeJudgmentPhase).toBe('active');
    expect([
      boss.ignivar.brandTimer,
      boss.ignivar.frontalTimer,
      boss.ignivar.skyfireTimer,
      boss.ignivar.meteorTimer,
      boss.ignivar.rotatingRaysTimer,
      boss.ignivar.forgeWaveTimer,
      boss.ignivar.soakTimer,
    ]).toEqual([11, 1, 8, 1, 17, 1, 13]);
    sim.tick();

    expect(boss.ignivar.forgeJudgmentPhase).toBe('done');
    expect(boss.channeling).toBe(false);
    expect(boss.castingAbility).toBeNull();
    expect([
      boss.ignivar.brandTimer,
      boss.ignivar.frontalTimer,
      boss.ignivar.skyfireTimer,
      boss.ignivar.meteorTimer,
      boss.ignivar.rotatingRaysTimer,
      boss.ignivar.forgeWaveTimer,
      boss.ignivar.soakTimer,
    ]).toEqual([11, 4, 8, 7, 17, 20, 13]);
    expect(conduit.templateId).toBe(IGNIVAR_WATER_CONDUIT_TEMPLATES.active);
    expect(boss.ignivar.conduitTimers.north_west).toBe(5);
    sim.tick();
    expect(boss.ignivar.conduitTimers.north_west).toBe(5 - DT);
  });

  it('preserves every Brand when Heroic Judgment begins', () => {
    const { sim, boss } = claimedEncounter(7319, 'heroic');
    const brandedAlly = addEncounterPlayer(sim, boss, 'Heroic Branded Ally');
    sim.player.devGod = true;
    brandedAlly.devGod = true;
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    applyBrand(sim.player, boss);
    applyBrand(brandedAlly, boss);
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_JUDGMENT_HP_THRESHOLD);

    sim.tick();

    expect(boss.ignivar.forgeJudgmentPhase).toBe('warning');
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
    expect(brandedAlly.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);

    for (let tick = 0; tick < IGNIVAR_JUDGMENT_DURATION_SECONDS / DT; tick++) sim.tick();

    expect(boss.ignivar.forgeJudgmentPhase).toBe('done');
    expect(sim.player.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
    expect(brandedAlly.auras.some((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
  });

  it('draws the random layout deterministically from the encounter RNG', () => {
    const start = (seed: number) => {
      const { sim, boss } = claimedEncounter(seed);
      sim.player.devGod = true;
      if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
      boss.hp = Math.floor(boss.maxHp * IGNIVAR_JUDGMENT_HP_THRESHOLD);
      const events = sim.tick();
      return {
        rotation: boss.ignivar.forgeJudgmentRotation,
        safeIndex: boss.ignivar.forgeJudgmentSafeIndex,
        layout: ignivarForgeLayoutFromFacing(boss.facing),
        meteors: events.filter(
          (event) =>
            event.type === 'spellfxAt' &&
            event.fx === 'meteorFall' &&
            event.ability === IGNIVAR_JUDGMENT_CAST_ID,
        ),
      };
    };

    const first = start(7306);
    const repeated = start(7306);
    const second = start(7308);
    const third = start(7404);
    expect(repeated).toEqual(first);
    expect(second).not.toEqual(first);
    expect(new Set([first.safeIndex, second.safeIndex, third.safeIndex]).size).toBe(3);
  });

  it('deals repeated floor pulses on the exact half-second cadence', () => {
    const { sim, boss } = claimedEncounter(7307);
    const unsafe = addEncounterPlayer(sim, boss, 'Pulse Target');
    sim.player.devGod = true;
    unsafe.devGod = true;
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    const origin = instanceOrigin(DUNGEONS.ignivar_raid_arena.index, 0);
    unsafe.pos = {
      x: origin.x + IGNIVAR_JUDGMENT_ARENA_RADIUS,
      y: boss.pos.y,
      z: origin.z,
    };
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_JUDGMENT_HP_THRESHOLD);
    sim.tick();
    boss.ignivar.forgeJudgmentRemaining = IGNIVAR_JUDGMENT_ACTIVE_SECONDS + DT;
    sim.tick();
    unsafe.devGod = false;
    unsafe.hp = unsafe.maxHp;

    sim.tick();
    const onePulseHp = unsafe.maxHp - Math.ceil(unsafe.maxHp * 0.12);
    expect(unsafe.hp).toBe(onePulseHp);
    for (let tick = 0; tick < 9; tick++) sim.tick();
    expect(unsafe.hp).toBe(onePulseHp);
    sim.tick();
    expect(unsafe.hp).toBe(onePulseHp - Math.ceil(unsafe.maxHp * 0.12));
  });

  it('queues Judgment behind an already warned meteor instead of cancelling it', () => {
    const { sim, boss } = claimedEncounter(7304);
    sim.player.devGod = true;
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_JUDGMENT_HP_THRESHOLD);
    boss.ignivar.meteorPoints = [{ x: boss.pos.x + 10, z: boss.pos.z }];
    boss.ignivar.meteorImpactRemaining = DT;

    sim.tick();
    expect(boss.ignivar.forgeJudgmentPhase).toBe('idle');
    expect(boss.ignivar.meteorPoints).toEqual([]);

    sim.tick();
    expect(boss.ignivar.forgeJudgmentPhase).toBe('warning');
    expect(boss.castingAbility).toBe(IGNIVAR_JUDGMENT_CAST_ID);
  });

  it('waits independently for every active cast and Shared Pyre to clear', () => {
    const blockers = [
      'casting',
      'frontal',
      'skyfire',
      'raysWindup',
      'raysActive',
      'waveWindup',
      'waveActive',
      'soak',
    ] as const;
    for (const blocker of blockers) {
      const { sim, boss } = claimedEncounter(7310 + blockers.indexOf(blocker));
      sim.player.devGod = true;
      if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
      boss.hp = Math.floor(boss.maxHp * IGNIVAR_JUDGMENT_HP_THRESHOLD);
      if (blocker === 'casting') boss.castingAbility = IGNIVAR_FRONTAL_CAST_ID;
      if (blocker === 'frontal') boss.ignivar.frontalCastRemaining = DT;
      if (blocker === 'skyfire') boss.ignivar.skyfireCastRemaining = DT;
      if (blocker === 'raysWindup') boss.ignivar.rotatingRaysWindupRemaining = DT;
      if (blocker === 'raysActive') boss.ignivar.rotatingRaysActiveRemaining = DT;
      if (blocker === 'waveWindup') boss.ignivar.forgeWaveWindupRemaining = DT;
      if (blocker === 'waveActive') boss.ignivar.forgeWaveActiveRemaining = DT;
      if (blocker === 'soak') {
        boss.ignivar.soakTargetId = sim.player.id;
        boss.ignivar.soakRemaining = 1;
      }

      sim.tick();

      expect(boss.ignivar.forgeJudgmentPhase, blocker).toBe('idle');
    }
  });

  it('enters the twenty-percent finale and guarantees alternating frontals', () => {
    expect(IGNIVAR_LAST_INFERNO_HP_THRESHOLD).toBe(0.2);
    expect(IGNIVAR_FINAL_METEOR_EVERY).toBe(9);
    expect(IGNIVAR_FINAL_ROTATING_RAYS_EVERY).toBe(24);
    expect(IGNIVAR_FINAL_ROTATING_RAYS_SPEED_MULTIPLIER).toBe(1.6);
    expect(IGNIVAR_FINAL_FRONTAL_EVERY).toBe(8);

    const { sim, boss } = claimedEncounter(7302);
    sim.player.devGod = true;
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.forgeJudgmentPhase = 'done';
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_LAST_INFERNO_HP_THRESHOLD);
    sim.tick();

    expect(boss.ignivar.lastInfernoTriggered).toBe(true);
    expect(boss.ignivar.meteorTimer).toBeLessThanOrEqual(2);
    expect(boss.ignivar.rotatingRaysTimer).toBeLessThanOrEqual(
      IGNIVAR_FINAL_FIRST_ROTATING_RAYS_SECONDS,
    );

    boss.ignivar.meteorTimer = 999;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.finalFrontalTimer = 0;
    sim.tick();
    expect(boss.castingAbility).toBe(IGNIVAR_FRONTAL_CAST_ID);
    expect(boss.ignivar.finalFrontalTimer).toBe(IGNIVAR_FINAL_FRONTAL_EVERY);

    boss.ignivar.frontalCastRemaining = DT;
    sim.tick();
    boss.ignivar.finalFrontalTimer = 0;
    sim.tick();
    expect(boss.castingAbility).toBe(IGNIVAR_SKYFIRE_CAST_ID);
    expect(boss.ignivar.finalFrontalTimer).toBe(IGNIVAR_FINAL_FRONTAL_EVERY);

    boss.ignivar.skyfireCastRemaining = DT;
    sim.tick();
    boss.ignivar.finalFrontalTimer = 0;
    sim.tick();
    expect(boss.castingAbility).toBe(IGNIVAR_FRONTAL_CAST_ID);

    boss.ignivar.frontalCastRemaining = DT;
    sim.tick();
    boss.ignivar.finalFrontalTimer = 999;
    boss.ignivar.rotatingRaysTimer = 0;
    sim.tick();
    expect(boss.castingAbility).toBe(IGNIVAR_ROTATING_RAYS_CAST_ID);
    expect(boss.ignivar.rotatingRaysTimer).toBe(IGNIVAR_FINAL_ROTATING_RAYS_EVERY);
    boss.ignivar.rotatingRaysWindupRemaining = 0;
    const facing = boss.ignivar.rotatingRaysFacing;
    sim.tick();
    expect(Math.abs(boss.ignivar.rotatingRaysFacing - facing)).toBeCloseTo(
      IGNIVAR_ROTATING_RAYS_ANGULAR_SPEED * IGNIVAR_FINAL_ROTATING_RAYS_SPEED_MULTIPLIER * DT,
      8,
    );

    boss.ignivar.rotatingRaysActiveRemaining = 0;
    boss.castingAbility = null;
    boss.ignivar.rotatingRaysTimer = 999;
    boss.ignivar.meteorTimer = 0;
    sim.tick();
    expect(boss.ignivar.meteorTimer).toBeCloseTo(IGNIVAR_FINAL_METEOR_EVERY, 8);
  });

  it('runs a deterministic finale with independent meteors and spaced major abilities', () => {
    const first = finaleTrace(7320);
    expect({
      castTicks: first.casts.map((cast) => [cast.id, cast.tick]),
      meteorTicks: [...new Set(first.meteors.map((meteor) => meteor.tick))],
    }).toEqual({
      castTicks: [
        [IGNIVAR_FRONTAL_CAST_ID, 119],
        [IGNIVAR_ROTATING_RAYS_CAST_ID, 300],
        [IGNIVAR_SKYFIRE_CAST_ID, 620],
      ],
      meteorTicks: [39, 219, 399, 579, 759],
    });
    expect(finaleTrace(7320)).toEqual(first);
    expect(first.casts.filter((cast) => cast.id === IGNIVAR_ROTATING_RAYS_CAST_ID).length).toBe(1);
    expect(new Set(first.meteors.map((meteor) => meteor.tick)).size).toBeGreaterThanOrEqual(4);
    expect(
      first.casts
        .filter(
          (cast) => cast.id === IGNIVAR_FRONTAL_CAST_ID || cast.id === IGNIVAR_SKYFIRE_CAST_ID,
        )
        .map((cast) => cast.id),
    ).toEqual([IGNIVAR_FRONTAL_CAST_ID, IGNIVAR_SKYFIRE_CAST_ID]);
    const skyfireFacings = first.casts
      .filter((cast) => cast.id === IGNIVAR_SKYFIRE_CAST_ID)
      .map((cast) => cast.facing);
    expect(skyfireFacings).toHaveLength(1);
    expect(skyfireFacings.every((facing) => [0.950547, -1.249046].includes(facing))).toBe(true);
  }, 45_000);

  it('always resolves Judgment before the finale after a direct health drop', () => {
    const { sim, boss } = claimedEncounter(7303);
    sim.player.devGod = true;
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_APOCALYPSE_HP_THRESHOLD * 0.1);

    sim.tick();

    expect(boss.ignivar?.forgeJudgmentPhase).toBe('warning');
    expect(boss.ignivar?.lastInfernoTriggered).toBe(false);
    expect(boss.castingAbility).toBe(IGNIVAR_JUDGMENT_CAST_ID);
  });

  it('cannot start Judgment before Apocalypse has resolved', () => {
    const { sim, boss } = claimedEncounter(7321);
    sim.player.devGod = true;
    if (!boss.ignivar) throw new Error('Ignivar state was not initialized');
    boss.ignivar.apocalypseTriggered = false;
    boss.ignivar.apocalypseResolved = false;
    boss.hp = Math.floor(boss.maxHp * IGNIVAR_JUDGMENT_HP_THRESHOLD);

    sim.tick();

    expect(boss.ignivar.forgeJudgmentPhase).toBe('idle');
    expect(boss.castingAbility).not.toBe(IGNIVAR_JUDGMENT_CAST_ID);
  });

  it('keeps all actionable Judgment geometry visible through the shared render plan', () => {
    const layoutSlot = 3;
    const rotation = (layoutSlot * Math.PI * 2) / 24;
    const safeIndex = 2;
    const facing = ignivarForgeLayoutFacing(layoutSlot, safeIndex);
    const warning = ignivarEncounterVisualPlan({
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_JUDGMENT_CAST_ID,
      castRemaining: IGNIVAR_JUDGMENT_DURATION_SECONDS,
      castTotal: IGNIVAR_JUDGMENT_DURATION_SECONDS,
      channeling: false,
      facing,
      auras: [],
    });
    expect(warning.judgmentPhase).toBe('warning');
    expect(warning.judgmentRotation).toBe(rotation);
    expect(warning.judgmentSafeIndex).toBe(safeIndex);
    expect(warning.judgmentCueIntensity).toBe(0);
    expect(warning.judgmentCueRevealed).toBe(false);
    expect(warning.rotatingRaysVisible).toBe(false);

    const firstCue = ignivarEncounterVisualPlan({
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_JUDGMENT_CAST_ID,
      castRemaining: IGNIVAR_JUDGMENT_ACTIVE_SECONDS + IGNIVAR_JUDGMENT_WARNING_SECONDS * 0.86,
      castTotal: IGNIVAR_JUDGMENT_DURATION_SECONDS,
      channeling: false,
      facing,
      auras: [],
    });
    expect(firstCue.judgmentCueIntensity).toBeGreaterThan(0.9);
    expect(firstCue.judgmentCueRevealed).toBe(true);

    const secondCue = ignivarEncounterVisualPlan({
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_JUDGMENT_CAST_ID,
      castRemaining: IGNIVAR_JUDGMENT_ACTIVE_SECONDS + IGNIVAR_JUDGMENT_WARNING_SECONDS * 0.585,
      castTotal: IGNIVAR_JUDGMENT_DURATION_SECONDS,
      channeling: false,
      facing,
      auras: [],
    });
    expect(secondCue.judgmentCueIntensity).toBeGreaterThan(0.9);

    const memoryWindow = ignivarEncounterVisualPlan({
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_JUDGMENT_CAST_ID,
      castRemaining: IGNIVAR_JUDGMENT_ACTIVE_SECONDS + IGNIVAR_JUDGMENT_WARNING_SECONDS * 0.2,
      castTotal: IGNIVAR_JUDGMENT_DURATION_SECONDS,
      channeling: false,
      facing,
      auras: [],
    });
    expect(memoryWindow.judgmentCueIntensity).toBe(0);
    expect(memoryWindow.judgmentCueRevealed).toBe(true);

    const active = ignivarEncounterVisualPlan({
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: IGNIVAR_JUDGMENT_CAST_ID,
      castRemaining: IGNIVAR_JUDGMENT_ACTIVE_SECONDS,
      castTotal: IGNIVAR_JUDGMENT_DURATION_SECONDS,
      channeling: true,
      facing,
      auras: [],
    });
    expect(active.judgmentPhase).toBe('active');
    expect(active.rotatingRaysVisible).toBe(false);
    expect(active.judgmentSafeIndex).toBe(safeIndex);

    const finale = ignivarEncounterVisualPlan({
      kind: 'mob',
      templateId: IGNIVAR_BOSS_ID,
      castingAbility: null,
      auras: [{ id: IGNIVAR_LAST_INFERNO_AURA_ID }],
    });
    expect(finale.finalPhase).toBe(true);

    const visual = buildIgnivarForgeJudgmentVisual();
    expect(visual.name).toBe(IGNIVAR_JUDGMENT_VISUAL_NAME);
    expect(visual.getObjectByName(IGNIVAR_JUDGMENT_WARNINGS_NAME)?.children).toHaveLength(3);
    expect(visual.getObjectByName(IGNIVAR_JUDGMENT_SHELTERS_NAME)?.children).toHaveLength(3);
    syncIgnivarForgeJudgmentVisual(
      visual,
      warning.judgmentPhase,
      warning.judgmentRotation,
      warning.judgmentSafeIndex,
      1,
      firstCue.judgmentCueIntensity,
      firstCue.judgmentCueRevealed,
    );
    expect(visual.getObjectByName(IGNIVAR_JUDGMENT_WARNINGS_NAME)?.visible).toBe(true);
    expect(visual.getObjectByName(IGNIVAR_JUDGMENT_SHELTERS_NAME)?.visible).toBe(false);
    const warningGroups = visual.getObjectByName(IGNIVAR_JUDGMENT_WARNINGS_NAME)?.children ?? [];
    expect(
      warningGroups.map((group) =>
        (
          group.getObjectByName('ignivarForgeJudgmentWarningFill') as THREE.Mesh<
            THREE.BufferGeometry,
            THREE.MeshBasicMaterial
          >
        ).material.color.getHex(),
      ),
    ).toEqual([0xff1d08, 0xff1d08, 0xff1d08]);
    expect(
      warningGroups.map(
        (group) => group.getObjectByName(IGNIVAR_JUDGMENT_SAFE_MARKER_NAME)?.visible,
      ),
    ).toEqual([false, false, false]);
    expect(
      visual.getObjectByName('ignivarForgeJudgmentCues')?.children.map((cue) => cue.visible),
    ).toEqual([true, true, false]);
    visual.updateMatrixWorld(true);
    const offsets = ignivarForgeShelterOffsets(rotation);
    const cues = visual.getObjectByName('ignivarForgeJudgmentCues')?.children ?? [];
    for (let index = 0; index < cues.length; index++) {
      if (index === safeIndex) continue;
      const core = cues[index].getObjectByName(IGNIVAR_FIRE_BEAM_CORE_NAME) as THREE.Mesh;
      const positions = core.geometry.getAttribute('position');
      let beamEnd = 0;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        beamEnd = Math.max(beamEnd, positions.getZ(vertex));
      }
      const endpoint = cues[index].localToWorld(new THREE.Vector3(0, 0, beamEnd));
      expect(endpoint.x).toBeCloseTo(offsets[index].x, 5);
      expect(endpoint.z).toBeCloseTo(offsets[index].z, 5);
    }

    syncIgnivarForgeJudgmentVisual(
      visual,
      memoryWindow.judgmentPhase,
      memoryWindow.judgmentRotation,
      memoryWindow.judgmentSafeIndex,
      1,
      memoryWindow.judgmentCueIntensity,
      memoryWindow.judgmentCueRevealed,
    );
    expect(
      visual.getObjectByName('ignivarForgeJudgmentCues')?.children.map((cue) => cue.visible),
    ).toEqual([false, false, false]);
    expect(
      warningGroups.map(
        (group) => group.getObjectByName('ignivarForgeJudgmentDangerScar')?.visible,
      ),
    ).toEqual([true, true, false]);
    syncIgnivarForgeJudgmentVisual(
      visual,
      active.judgmentPhase,
      active.judgmentRotation,
      active.judgmentSafeIndex,
      1,
      active.judgmentCueIntensity,
      active.judgmentCueRevealed,
    );
    expect(visual.getObjectByName(IGNIVAR_JUDGMENT_WARNINGS_NAME)?.visible).toBe(false);
    expect(visual.getObjectByName(IGNIVAR_JUDGMENT_SHELTERS_NAME)?.visible).toBe(true);
    expect(visual.getObjectByName(IGNIVAR_JUDGMENT_FIRE_NAME)?.visible).toBe(true);
    const surface = visual.getObjectByName('ignivarForgeJudgmentFireSurface') as THREE.Mesh;
    const boundary = visual.getObjectByName('ignivarForgeJudgmentFireBoundary') as THREE.Mesh;
    expect((surface.material as THREE.Material).userData.ignivarShelterClip).toBe(true);
    expect((surface.material as THREE.Material).blending).toBe(THREE.NormalBlending);
    expect((surface.material as THREE.Material).userData.ignivarGroundFire).toBe(true);
    expect((surface.material as THREE.Material).userData.ignivarFireTime).toBe(
      sharedUniforms.uTime,
    );
    expect((surface.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x120503);
    expect(surface.rotation.x).toBe(0);
    const surfacePositions = surface.geometry.getAttribute('position');
    let maxAbsY = 0;
    let maxAbsZ = 0;
    for (let index = 0; index < surfacePositions.count; index++) {
      maxAbsY = Math.max(maxAbsY, Math.abs(surfacePositions.getY(index)));
      maxAbsZ = Math.max(maxAbsZ, Math.abs(surfacePositions.getZ(index)));
    }
    expect(maxAbsY).toBeLessThan(1e-5);
    expect(maxAbsZ).toBeGreaterThan(IGNIVAR_JUDGMENT_ARENA_RADIUS * 0.95);
    expect((boundary.material as THREE.Material).userData.ignivarShelterClip).toBeUndefined();
    expect(ignivarForgeShelterClipGlsl().match(/discard;/g)).toHaveLength(1);
    expect(ignivarForgeShelterClipGlsl()).toContain('uIgnivarSafeCenter');
    expect(ignivarForgeGroundFireGlsl()).toContain('ignivarCracks');
    expect(ignivarForgeGroundFireGlsl()).toContain('uTime');
    expect(ignivarForgeGroundFireGlsl()).not.toContain('uIgnivarFireTime');
    const safeOffset = ignivarForgeShelterPoints({ x: 0, z: 0 }, rotation)[safeIndex];
    const shaderCenter = (surface.material as THREE.Material).userData.ignivarSafeCenter as {
      value: THREE.Vector2;
    };
    expect(shaderCenter.value.x).toBeCloseTo(safeOffset.x, 8);
    expect(shaderCenter.value.y).toBeCloseTo(safeOffset.z, 8);
    const shelterGroups = visual.getObjectByName(IGNIVAR_JUDGMENT_SHELTERS_NAME)?.children ?? [];
    expect(
      shelterGroups.map(
        (group) => group.getObjectByName(IGNIVAR_JUDGMENT_SAFE_MARKER_NAME)?.visible,
      ),
    ).toEqual([false, false, true]);

    syncIgnivarForgeJudgmentVisual(visual, 'hidden', rotation, safeIndex, 1, 0, false);
    expect(visual.visible).toBe(false);
  });

  it('authors heavy forge VFX for Judgment and a persistent final-phase aura', () => {
    expect(abilityVfxSpecFor(IGNIVAR_JUDGMENT_CAST_ID)).toMatchObject({
      p: 'fire',
      pw: 1.9,
      a: 'burst',
    });
    expect(abilityVfxFullSpecFor(IGNIVAR_JUDGMENT_CAST_ID)).toMatchObject({
      archetype: 'burst',
      motifs: ['fissure', 'pillars'],
      impact: { smoke: true, sparks: 64, light: 4 },
      screenFx: true,
    });
    expect(abilityVfxSpecFor(IGNIVAR_LAST_INFERNO_AURA_ID)).toMatchObject({
      p: 'fire',
      a: 'buff',
      lg: 45,
    });
    expect(abilityVfxFullSpecFor(IGNIVAR_LAST_INFERNO_AURA_ID)).toMatchObject({
      archetype: 'buff',
      motifs: ['orbitals', 'pillars'],
      screenFx: true,
    });
  });
});
