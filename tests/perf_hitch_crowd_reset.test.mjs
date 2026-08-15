import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as crowdResetModule from '../scripts/lib/perf_hitch_crowd_reset.mjs';
import {
  assertCrowdResetEvidence,
  assertNoRateLimiterErrors,
  buildCrowdInfluxPositions,
  buildCrowdInfluxValidation,
  buildCrowdResetTargets,
  createCrowdCommandLedger,
  crowdCommandSignature,
  HITCH_CROWD_CHAT_RETRY_MS,
  HITCH_CROWD_COMBAT_QUIET_MS,
  HITCH_CROWD_COMMAND_RETRY_MS,
  HITCH_CROWD_FACING,
  HITCH_CROWD_FACING_TOLERANCE,
  HITCH_CROWD_INFLUX_MOTION_RADIUS,
  HITCH_CROWD_INFLUX_MOVE_INTERVAL_MS,
  HITCH_CROWD_INFLUX_MOVE_STEPS,
  HITCH_CROWD_INFLUX_START_RADIUS,
  HITCH_CROWD_INFLUX_X,
  HITCH_CROWD_INFLUX_Z,
  HITCH_CROWD_MOUNT_GRANT_READBACK_MS,
  HITCH_CROWD_PARKING_COLUMNS,
  HITCH_CROWD_PARKING_SPACING,
  HITCH_CROWD_PARKING_TOLERANCE,
  HITCH_CROWD_PARKING_X,
  HITCH_CROWD_PARKING_Z,
  observeCrowdResetState,
  paceCrowdResetActions,
  planCrowdMountReadinessActions,
  planCrowdRecoveryActions,
  planCrowdResetActions,
  validateCrowdRecoveryState,
  validateCrowdResetState,
} from '../scripts/lib/perf_hitch_crowd_reset.mjs';
import { isBlocked, moverHeight, resolveMovement } from '../src/sim/colliders.ts';
import { MOUNTS } from '../src/sim/content/mounts.ts';
import { MAX_AGGRO_RADIUS, MAX_WANDER_RADIUS } from '../src/sim/mob/aggro_ranges.ts';
import {
  PLAYER_BODY_RADIUS,
  PLAYER_MAX_CLIMB_SLOPE,
  PLAYER_SWIM_DEPTH,
} from '../src/sim/pathfind.ts';
import { moveSpeedMult, stepPlayerMotion } from '../src/sim/player_motion.ts';
import { rideSteepnessAt } from '../src/sim/ride_height.ts';
import { Sim } from '../src/sim/sim.ts';
import { RUN_SPEED } from '../src/sim/types.ts';
import { groundHeight, terrainHeight, waterLevelAt } from '../src/sim/world.ts';
import { WORLD_SEED } from '../src/sim/world_seed.ts';

// Behavioral standability probe: run the sim's real player movement kernel
// with idle input from a candidate cell and report how far the body settles
// from where it was placed. This is the exact drift class that broke bot 11 at
// the old 75,1407 cell (a steep-slope slide of 2.95 units on x): the kernel's
// steep-slope gate, terrain wall standoff, and static collision all apply, so
// a nonzero displacement means the cell is not standable.
let settleActorPrototype = null;
function settleDisplacement(x, z, steps = 60) {
  if (!settleActorPrototype) {
    settleActorPrototype = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' }).player;
  }
  const deps = {
    seed: WORLD_SEED,
    moveSpeedMult: (entity) => moveSpeedMult(entity, 0),
    resolveMove: (fromX, fromZ, nx, nz, radius, entity, ignoreFences) =>
      resolveMovement(
        WORLD_SEED,
        fromX,
        fromZ,
        nx,
        nz,
        radius,
        ignoreFences,
        undefined,
        moverHeight(entity),
      ),
    resolvedAbility: () => null,
    cancelCast: () => {},
    standUp: () => {},
    dealDamage: () => {},
  };
  const idle = {
    forward: false,
    back: false,
    turnLeft: false,
    turnRight: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
    dive: false,
    surface: false,
  };
  const actor = {
    ...settleActorPrototype,
    pos: { x, y: terrainHeight(x, z, WORLD_SEED), z },
    prevPos: { x, y: terrainHeight(x, z, WORLD_SEED), z },
    onGround: true,
    vx: 0,
    vz: 0,
    vy: 0,
    fallStartY: terrainHeight(x, z, WORLD_SEED),
    mountKey: '',
    mountCastRemaining: 0,
    auras: [],
  };
  for (let step = 0; step < steps; step += 1) {
    actor.prevPos = { ...actor.pos };
    stepPlayerMotion(deps, actor, idle);
  }
  return Math.hypot(actor.pos.x - x, actor.pos.z - z);
}

// A standable cell holds a stationary body: within the kernel's slope limit at
// the cell (rideSteepnessAt drives the steep-slide gate) and no measurable
// settle displacement over three simulated seconds.
function expectStandable(x, z, label) {
  expect(rideSteepnessAt(x, z, WORLD_SEED), `${label} slope stability`).toBeLessThanOrEqual(
    PLAYER_MAX_CLIMB_SLOPE,
  );
  expect(settleDisplacement(x, z), `${label} idle settle displacement`).toBeLessThanOrEqual(0.05);
}

const rows = [
  {
    index: 0,
    cls: 'warrior',
    skin: 3,
    weaponType: 'sword',
    weaponSkin: 'cinderbrand_sword',
    mountItem: 'reins_valorsteed',
  },
  {
    index: 5,
    cls: 'mage',
    skin: 7,
    weaponType: 'staff',
    weaponSkin: 'cosmarch_staff',
    mountItem: 'reins_stormfeather_griffin',
  },
];

describe('crowd-influx run reset', () => {
  it('builds deterministic steady-state targets outside the measured interest radius', () => {
    const first = buildCrowdResetTargets(rows);
    const second = buildCrowdResetTargets(rows);

    expect(first).toEqual(second);
    expect(first).toEqual([
      {
        botIndex: 0,
        parking: { x: 39, z: 1401 },
        facing: 0,
        level: 20,
        auraIds: ['battle_stance'],
        skin: 3,
        weaponType: 'sword',
        weaponSkin: 'cinderbrand_sword',
        mountItem: 'reins_valorsteed',
        mountKey: 'valorsteed',
      },
      {
        botIndex: 5,
        parking: { x: 69, z: 1401 },
        facing: 0,
        level: 20,
        auraIds: [],
        skin: 7,
        weaponType: 'staff',
        weaponSkin: 'cosmarch_staff',
        mountItem: 'reins_stormfeather_griffin',
        mountKey: 'stormfeather_griffin',
      },
    ]);
  });

  it('parks the full roster on dry, collision-clear, standable ground with disjoint tolerances', () => {
    const parkingRows = Array.from({ length: 36 }, (_, index) => ({
      index,
      cls: 'mage',
      skin: 0,
      weaponType: 'staff',
      weaponSkin: 'brasscrown_staff',
      mountItem: 'reins_valorsteed',
    }));
    const targets = buildCrowdResetTargets(parkingRows);

    expect({
      x: HITCH_CROWD_PARKING_X,
      z: HITCH_CROWD_PARKING_Z,
      columns: HITCH_CROWD_PARKING_COLUMNS,
      spacing: HITCH_CROWD_PARKING_SPACING,
      tolerance: HITCH_CROWD_PARKING_TOLERANCE,
      facing: HITCH_CROWD_FACING,
      facingTolerance: HITCH_CROWD_FACING_TOLERANCE,
    }).toEqual({
      x: 39,
      z: 1401,
      columns: 6,
      spacing: 6,
      tolerance: 2,
      facing: 0,
      facingTolerance: 0.01,
    });
    expect(HITCH_CROWD_PARKING_SPACING).toBeGreaterThan(2 * HITCH_CROWD_PARKING_TOLERANCE);
    expect(targets[6]).toMatchObject({ parking: { x: 39, z: 1407 } });
    for (const target of targets) {
      const { x, z } = target.parking;
      expect(Math.hypot(x, z), `bot ${target.botIndex} interest distance`).toBeGreaterThan(90);
      expect(
        groundHeight(x, z, WORLD_SEED),
        `bot ${target.botIndex} dry parking`,
      ).toBeGreaterThanOrEqual(waterLevelAt(x, z, WORLD_SEED) - PLAYER_SWIM_DEPTH);
      expect(
        isBlocked(WORLD_SEED, x, z, PLAYER_BODY_RADIUS),
        `bot ${target.botIndex} static collision`,
      ).toBe(false);
      expectStandable(x, z, `bot ${target.botIndex} parking`);
    }
  });

  it('keeps parking and the full influx motion envelope outside every hostile aggro reach', () => {
    const parkingRows = Array.from({ length: 36 }, (_, index) => ({
      index,
      cls: 'mage',
      skin: 0,
      weaponType: 'staff',
      weaponSkin: 'brasscrown_staff',
      mountItem: 'reins_valorsteed',
    }));
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
      worldBossAtBoot: true,
      riftPortals: true,
    });
    sim.tick();
    const hostileHomes = [...sim.entities.values()].filter(
      (entity) =>
        entity.kind === 'mob' && entity.hostile && !entity.dead && !entity.friendlyPracticeTarget,
    );
    const minimumHomeDistance = MAX_AGGRO_RADIUS + MAX_WANDER_RADIUS;
    const assertAggroFree = (point, extraClearance, label) => {
      for (const hostile of hostileHomes) {
        expect(
          Math.hypot(point.x - hostile.spawnPos.x, point.z - hostile.spawnPos.z),
          `${label} versus ${hostile.templateId}`,
        ).toBeGreaterThan(minimumHomeDistance + extraClearance);
      }
    };

    for (const target of buildCrowdResetTargets(parkingRows)) {
      assertAggroFree(target.parking, 0, `bot ${target.botIndex} parking`);
    }
    expect({
      x: HITCH_CROWD_INFLUX_X,
      z: HITCH_CROWD_INFLUX_Z,
      motionRadius: HITCH_CROWD_INFLUX_MOTION_RADIUS,
      startRadius: HITCH_CROWD_INFLUX_START_RADIUS,
      moveIntervalMs: HITCH_CROWD_INFLUX_MOVE_INTERVAL_MS,
      moveSteps: HITCH_CROWD_INFLUX_MOVE_STEPS,
      combatQuietMs: HITCH_CROWD_COMBAT_QUIET_MS,
    }).toEqual({
      x: -113,
      z: 1413,
      motionRadius: 50,
      startRadius: 9,
      moveIntervalMs: 250,
      moveSteps: 12,
      combatQuietMs: 6000,
    });
    const fastestMountedSpeed =
      RUN_SPEED * (1 + Math.max(...Object.values(MOUNTS).map((mount) => mount.moveSpeedPct)));
    const maximumPathLength =
      fastestMountedSpeed *
      ((HITCH_CROWD_INFLUX_MOVE_INTERVAL_MS * HITCH_CROWD_INFLUX_MOVE_STEPS) / 1_000);
    expect(HITCH_CROWD_INFLUX_START_RADIUS + maximumPathLength).toBeLessThanOrEqual(
      HITCH_CROWD_INFLUX_MOTION_RADIUS,
    );
    assertAggroFree(
      { x: HITCH_CROWD_INFLUX_X, z: HITCH_CROWD_INFLUX_Z },
      HITCH_CROWD_INFLUX_MOTION_RADIUS,
      'influx motion envelope',
    );
    for (const [index, point] of buildCrowdInfluxPositions(36).entries()) {
      expect(
        isBlocked(WORLD_SEED, point.x, point.z, PLAYER_BODY_RADIUS),
        `influx bot ${index} static collision`,
      ).toBe(false);
      expect(
        groundHeight(point.x, point.z, WORLD_SEED),
        `influx bot ${index} dry ground`,
      ).toBeGreaterThan(waterLevelAt(point.x, point.z, WORLD_SEED) + 0.6);
      expectStandable(point.x, point.z, `influx bot ${index}`);
    }
    expectStandable(HITCH_CROWD_INFLUX_X, HITCH_CROWD_INFLUX_Z, 'influx center');
    expect(
      Math.hypot(
        HITCH_CROWD_INFLUX_X - HITCH_CROWD_PARKING_X,
        HITCH_CROWD_INFLUX_Z - HITCH_CROWD_PARKING_Z,
      ),
    ).toBeGreaterThan(100);
  });

  it('reads sparse live fields without retaining cleared mount or weapon state', () => {
    expect(
      observeCrowdResetState({
        botIndex: 5,
        frame: { x: 261, z: 256, f: 0, lv: 20, target: null, auto: false, queued: null },
        profilerInvulnerable: false,
      }),
    ).toEqual({
      botIndex: 5,
      x: 261,
      z: 256,
      facing: 0,
      level: 20,
      skin: 0,
      weaponSkin: null,
      mountKey: '',
      mountCastRemaining: 0,
      mountCastKey: '',
      weaponStowed: false,
      auraIds: [],
      targetId: null,
      autoAttack: false,
      queuedOnSwing: null,
      casting: false,
      inCombat: false,
      dead: false,
      ghost: false,
      profilerInvulnerable: false,
      ridingTrained: false,
      bagItemIds: [],
    });
  });

  it('reads every populated reset field plus the event-derived combat signal', () => {
    expect(
      observeCrowdResetState({
        botIndex: 5,
        profilerInvulnerable: true,
        inCombat: true,
        frame: {
          x: 261.25,
          z: 256.5,
          f: 0.12,
          lv: 19,
          sk: 7,
          wsk: 'cosmarch_staff',
          mnt: 'stormfeather_griffin',
          mcr: 0.75,
          mck: 'valorsteed',
          ws: 1,
          auras: [{ id: 'arcane_intellect' }, { id: 'arcane_intellect' }, { id: 8 }],
          target: 91,
          auto: true,
          queued: 'fire_blast',
          cast: 'fireball',
          dead: 1,
          gh: 1,
          mntRtd: true,
          inv: [{ itemId: 'reins_stormfeather_griffin', count: 1 }],
        },
      }),
    ).toEqual({
      botIndex: 5,
      x: 261.25,
      z: 256.5,
      facing: 0.12,
      level: 19,
      skin: 7,
      weaponSkin: 'cosmarch_staff',
      mountKey: 'stormfeather_griffin',
      mountCastRemaining: 0.75,
      mountCastKey: 'valorsteed',
      weaponStowed: true,
      auraIds: ['arcane_intellect'],
      targetId: 91,
      autoAttack: true,
      queuedOnSwing: 'fire_blast',
      casting: true,
      inCombat: true,
      dead: true,
      ghost: true,
      profilerInvulnerable: true,
      ridingTrained: true,
      bagItemIds: ['reins_stormfeather_griffin'],
    });
  });

  it('plans dead recovery through a sickness-free healer resurrection sequence', () => {
    const [target] = buildCrowdResetTargets(rows);
    const base = {
      botIndex: target.botIndex,
      x: 0,
      z: 0,
      facing: 0,
      level: 20,
      skin: 0,
      weaponSkin: null,
      mountKey: '',
      mountCastRemaining: 0,
      mountCastKey: '',
      weaponStowed: false,
      auraIds: [],
      targetId: null,
      autoAttack: false,
      queuedOnSwing: null,
      casting: false,
      dead: true,
      ghost: false,
      profilerInvulnerable: false,
    };

    expect(planCrowdRecoveryActions([target], [base])).toEqual([
      { botIndex: 0, kind: 'command', payload: { cmd: 'dev_level', level: 1 } },
    ]);
    expect(planCrowdRecoveryActions([target], [{ ...base, level: 1 }])).toEqual([
      { botIndex: 0, kind: 'command', payload: { cmd: 'release' } },
    ]);
    expect(
      planCrowdRecoveryActions([target], [{ ...base, level: 1, dead: false, ghost: true }]),
    ).toEqual([{ botIndex: 0, kind: 'command', payload: { cmd: 'resurrect_healer' } }]);
    expect(
      planCrowdRecoveryActions(
        [target],
        [{ ...base, level: 1, dead: false, ghost: false, profilerInvulnerable: true }],
      ),
    ).toEqual([{ botIndex: 0, kind: 'command', payload: { cmd: 'dev_level', level: 20 } }]);
  });

  it('requires every bot alive, sickness-free, level 20, and profiler-invulnerable', () => {
    const [target] = buildCrowdResetTargets(rows);
    const valid = {
      botIndex: target.botIndex,
      x: 0,
      z: 0,
      facing: 0,
      level: target.level,
      skin: 0,
      weaponSkin: null,
      mountKey: '',
      mountCastRemaining: 0,
      mountCastKey: '',
      weaponStowed: false,
      auraIds: [],
      targetId: null,
      autoAttack: false,
      queuedOnSwing: null,
      casting: false,
      inCombat: false,
      dead: false,
      ghost: false,
      profilerInvulnerable: true,
      ridingTrained: true,
      bagItemIds: [target.mountItem],
    };

    expect(validateCrowdRecoveryState([target], [valid])).toEqual({
      ok: true,
      phase: 'recovery',
      bots: 1,
      failures: [],
    });
    const cases = [
      ['dead', { dead: true }, 'remained dead or ghosted'],
      ['ghost', { ghost: true }, 'remained dead or ghosted'],
      ['level', { level: 1 }, 'recovery level expected 20'],
      ['protection', { profilerInvulnerable: false }, 'profiler invulnerability was not armed'],
      ['riding', { ridingTrained: false }, 'riding training was not granted'],
      [
        'reins',
        { bagItemIds: ['reins_grag_bear'] },
        `mount reins ${target.mountItem} were not in bags`,
      ],
      ['sickness', { auraIds: ['resurrection_sickness'] }, 'recovery sickness remained'],
      ['unstuck sickness', { auraIds: ['unstuck_sickness'] }, 'recovery sickness remained'],
    ];
    for (const [label, patch, expected] of cases) {
      const verdict = validateCrowdRecoveryState([target], [{ ...valid, ...patch }]);
      expect(verdict.ok, label).toBe(false);
      expect(verdict.failures.join('; '), label).toContain(expected);
    }
  });

  it('plans a neutral reset through existing deterministic command surfaces', () => {
    const [target] = buildCrowdResetTargets(rows);
    const dirty = {
      botIndex: 0,
      x: 0,
      z: 0,
      facing: 1,
      level: 20,
      skin: 6,
      weaponSkin: 'old_sword',
      mountKey: 'grag_bear',
      mountCastRemaining: 0,
      mountCastKey: '',
      weaponStowed: true,
      auraIds: ['battle_stance', 'battle_stance', 'power_word_fortitude'],
      targetId: 99,
      autoAttack: true,
      queuedOnSwing: 'heroic_strike',
      casting: true,
      dead: false,
      ghost: false,
    };

    expect(planCrowdResetActions([target], [dirty], 'neutral')).toEqual([
      { botIndex: 0, kind: 'input', move: { f: 1 }, facing: 0 },
      { botIndex: 0, kind: 'command', payload: { cmd: 'target', id: null } },
      {
        botIndex: 0,
        kind: 'command',
        payload: { cmd: 'dev_teleport', x: HITCH_CROWD_PARKING_X, z: HITCH_CROWD_PARKING_Z },
      },
      {
        botIndex: 0,
        kind: 'command',
        payload: { cmd: 'chat', text: '/dev combatreset' },
      },
      { botIndex: 0, kind: 'command', payload: { cmd: 'change_skin', skin: 0 } },
      {
        botIndex: 0,
        kind: 'command',
        payload: { cmd: 'change_weapon_skin', skin: null, wtype: 'sword' },
      },
      { botIndex: 0, kind: 'command', payload: { cmd: 'mount_toggle' } },
      { botIndex: 0, kind: 'command', payload: { cmd: 'stow_weapon' } },
      {
        botIndex: 0,
        kind: 'command',
        payload: { cmd: 'cancel_aura', aura: 'power_word_fortitude' },
      },
    ]);
  });

  it('actively clears authoritative combat even when presentation fields are already neutral', () => {
    const [target] = buildCrowdResetTargets(rows);
    const inCombat = {
      botIndex: target.botIndex,
      x: target.parking.x,
      z: target.parking.z,
      facing: target.facing,
      level: target.level,
      skin: 0,
      weaponSkin: null,
      mountKey: '',
      mountCastRemaining: 0,
      mountCastKey: '',
      weaponStowed: false,
      auraIds: [...target.auraIds],
      targetId: null,
      autoAttack: false,
      queuedOnSwing: null,
      casting: false,
      inCombat: true,
      dead: false,
      ghost: false,
    };

    expect(
      planCrowdResetActions([target], [inCombat], 'neutral').filter(
        (action) => action.kind === 'command' && action.payload.text === '/dev combatreset',
      ),
    ).toEqual([
      {
        botIndex: target.botIndex,
        kind: 'command',
        payload: { cmd: 'chat', text: '/dev combatreset' },
      },
    ]);
  });

  it('re-applies a fresh class aura cleared by death recovery', () => {
    const [target] = buildCrowdResetTargets(rows);
    const recovered = {
      botIndex: target.botIndex,
      x: target.parking.x,
      z: target.parking.z,
      facing: target.facing,
      level: target.level,
      skin: 0,
      weaponSkin: null,
      mountKey: '',
      mountCastRemaining: 0,
      mountCastKey: '',
      weaponStowed: false,
      auraIds: [],
      targetId: null,
      autoAttack: false,
      queuedOnSwing: null,
      casting: false,
      inCombat: false,
      dead: false,
      ghost: false,
      profilerInvulnerable: true,
    };

    expect(
      planCrowdResetActions([target], [recovered], 'neutral').filter(
        (action) => action.kind === 'command' && action.payload.cmd === 'cast',
      ),
    ).toEqual([
      {
        botIndex: target.botIndex,
        kind: 'command',
        payload: { cmd: 'cast', ability: 'battle_stance' },
      },
    ]);
  });

  it('clears a selected target explicitly and moves to interrupt an active cast', () => {
    const [target] = buildCrowdResetTargets(rows);
    const castingAtTarget = {
      botIndex: 0,
      x: HITCH_CROWD_PARKING_X,
      z: HITCH_CROWD_PARKING_Z,
      facing: 0,
      level: 20,
      skin: target.skin,
      weaponSkin: target.weaponSkin,
      mountKey: target.mountKey,
      mountCastRemaining: 0,
      mountCastKey: '',
      weaponStowed: false,
      auraIds: ['battle_stance'],
      targetId: 99,
      autoAttack: false,
      queuedOnSwing: null,
      casting: true,
      dead: false,
      ghost: false,
    };

    expect(planCrowdResetActions([target], [castingAtTarget], 'presented')).toEqual([
      { botIndex: 0, kind: 'input', move: { f: 1 }, facing: 0 },
      { botIndex: 0, kind: 'command', payload: { cmd: 'target', id: null } },
      {
        botIndex: 0,
        kind: 'command',
        payload: { cmd: 'chat', text: '/dev combatreset' },
      },
    ]);
  });

  it('cancels an in-flight mount before reapplying the fixed presentation', () => {
    const [target] = buildCrowdResetTargets(rows);
    const summoningWrongMount = {
      botIndex: 0,
      x: HITCH_CROWD_PARKING_X,
      z: HITCH_CROWD_PARKING_Z,
      facing: 0,
      level: 20,
      skin: 0,
      weaponSkin: null,
      mountKey: '',
      mountCastRemaining: 0.9,
      mountCastKey: 'grag_bear',
      weaponStowed: false,
      auraIds: [...target.auraIds],
      targetId: null,
      autoAttack: false,
      queuedOnSwing: null,
      casting: false,
      inCombat: false,
      dead: false,
      ghost: false,
    };

    expect(planCrowdResetActions([target], [summoningWrongMount], 'presented')).toEqual([
      { botIndex: 0, kind: 'input', move: { f: 1 }, facing: 0 },
    ]);
  });

  it('settles presentation before summoning and leaves an in-flight summon untouched', () => {
    const [target, otherTarget] = buildCrowdResetTargets(rows);
    const ready = {
      botIndex: 0,
      x: target.parking.x,
      z: target.parking.z,
      facing: 0,
      level: target.level,
      skin: target.skin,
      weaponSkin: target.weaponSkin,
      mountKey: '',
      mountCastRemaining: 0,
      mountCastKey: '',
      weaponStowed: false,
      auraIds: [...target.auraIds],
      targetId: null,
      autoAttack: false,
      queuedOnSwing: null,
      casting: false,
      inCombat: false,
      dead: false,
      ghost: false,
    };

    expect(
      planCrowdResetActions(
        [target],
        [{ ...ready, x: target.parking.x + HITCH_CROWD_PARKING_TOLERANCE + 0.01 }],
        'presented',
        { presentedAlignedBotIds: new Set() },
      ),
    ).toEqual([
      { botIndex: 0, kind: 'input', move: {}, facing: 0 },
      {
        botIndex: 0,
        kind: 'command',
        payload: { cmd: 'dev_teleport', x: target.parking.x, z: target.parking.z },
      },
    ]);
    expect(
      planCrowdResetActions([target], [{ ...ready, facing: 0.02 }], 'presented', {
        presentedAlignedBotIds: new Set(),
      }),
    ).toEqual([{ botIndex: 0, kind: 'input', move: {}, facing: 0 }]);
    expect(
      planCrowdResetActions([target], [ready], 'presented', {
        presentedAlignedBotIds: new Set(),
      }),
    ).toEqual([{ botIndex: 0, kind: 'input', move: {}, facing: 0 }]);
    expect(
      planCrowdResetActions([target], [ready], 'presented', {
        presentedAlignedBotIds: new Set([0]),
      }),
    ).toEqual([{ botIndex: 0, kind: 'command', payload: { cmd: 'use', item: target.mountItem } }]);
    expect(
      planCrowdResetActions(
        [target],
        [
          {
            ...ready,
            facing: 0.02,
            mountCastRemaining: 0.8,
            mountCastKey: target.mountKey,
          },
        ],
        'presented',
        { presentedAlignedBotIds: new Set([0]) },
      ),
    ).toEqual([]);

    const otherReady = {
      ...ready,
      botIndex: otherTarget.botIndex,
      x: otherTarget.parking.x,
      z: otherTarget.parking.z,
      skin: otherTarget.skin,
      weaponSkin: otherTarget.weaponSkin,
      auraIds: [...otherTarget.auraIds],
    };
    expect(
      planCrowdResetActions(
        [target, otherTarget],
        [
          {
            ...ready,
            facing: 0.02,
            mountCastRemaining: 0.8,
            mountCastKey: target.mountKey,
          },
          otherReady,
        ],
        'presented',
        { presentedAlignedBotIds: new Set([target.botIndex, otherTarget.botIndex]) },
      ),
    ).toEqual([
      {
        botIndex: otherTarget.botIndex,
        kind: 'command',
        payload: { cmd: 'use', item: otherTarget.mountItem },
      },
    ]);

    const retryHoldUntilByBot = new Map([[0, 5_000]]);
    expect(
      planCrowdResetActions([target], [{ ...ready, facing: 0.02 }], 'presented', {
        nowMs: 4_999,
        presentedAlignedBotIds: new Set([0]),
        mountRetryHoldUntilByBot: retryHoldUntilByBot,
      }),
    ).toEqual([]);
    expect(
      planCrowdResetActions([target], [{ ...ready, facing: 0.02 }], 'presented', {
        nowMs: 5_000,
        presentedAlignedBotIds: new Set([0]),
        mountRetryHoldUntilByBot: retryHoldUntilByBot,
      }),
    ).toEqual([{ botIndex: 0, kind: 'command', payload: { cmd: 'use', item: target.mountItem } }]);
  });

  it('fails closed until every neutral and presented field converges', () => {
    const targets = buildCrowdResetTargets(rows);
    const neutral = targets.map((target) => ({
      botIndex: target.botIndex,
      x: target.parking.x,
      z: target.parking.z,
      facing: target.facing,
      level: target.level,
      skin: 0,
      weaponSkin: null,
      mountKey: '',
      mountCastRemaining: 0,
      mountCastKey: '',
      weaponStowed: false,
      auraIds: [...target.auraIds],
      targetId: null,
      autoAttack: false,
      queuedOnSwing: null,
      casting: false,
      inCombat: false,
      dead: false,
      ghost: false,
    }));
    const presented = neutral.map((state, index) => ({
      ...state,
      skin: targets[index].skin,
      weaponSkin: targets[index].weaponSkin,
      mountKey: targets[index].mountKey,
    }));

    expect(validateCrowdResetState(targets, neutral, 'neutral')).toEqual({
      ok: true,
      phase: 'neutral',
      bots: 2,
      failures: [],
    });
    expect(validateCrowdResetState(targets, presented, 'presented')).toEqual({
      ok: true,
      phase: 'presented',
      bots: 2,
      failures: [],
    });
    expect(
      validateCrowdResetState(targets, [{ ...neutral[0], inCombat: true }, neutral[1]], 'neutral'),
    ).toEqual({
      ok: false,
      phase: 'neutral',
      bots: 2,
      failures: ['bot 0 remained in combat'],
    });

    const stale = presented.map((state) => ({ ...state }));
    stale[1].mountKey = '';
    stale[1].auraIds = ['resurrection_sickness'];
    expect(validateCrowdResetState(targets, stale, 'presented')).toEqual({
      ok: false,
      phase: 'presented',
      bots: 2,
      failures: [
        'bot 5 mount expected stormfeather_griffin, got none',
        'bot 5 auras expected empty, got resurrection_sickness',
      ],
    });
  });

  it('fails closed for each independent reset invariant', () => {
    const [target] = buildCrowdResetTargets(rows);
    const valid = {
      botIndex: target.botIndex,
      x: target.parking.x,
      z: target.parking.z,
      facing: target.facing,
      level: target.level,
      skin: target.skin,
      weaponSkin: target.weaponSkin,
      mountKey: target.mountKey,
      mountCastRemaining: 0,
      mountCastKey: '',
      weaponStowed: false,
      auraIds: [...target.auraIds],
      targetId: null,
      autoAttack: false,
      queuedOnSwing: null,
      casting: false,
      inCombat: false,
      dead: false,
      ghost: false,
    };
    const cases = [
      [
        'parking',
        { x: target.parking.x + HITCH_CROWD_PARKING_TOLERANCE + 0.01 },
        'parking expected',
      ],
      [
        'parking z',
        { z: target.parking.z + HITCH_CROWD_PARKING_TOLERANCE + 0.01 },
        'parking expected',
      ],
      ['parking non-finite x', { x: Number.NaN }, 'parking expected'],
      ['parking non-finite z', { z: Number.POSITIVE_INFINITY }, 'parking expected'],
      [
        'facing',
        { facing: target.facing + HITCH_CROWD_FACING_TOLERANCE + 0.001 },
        'facing expected',
      ],
      ['facing non-finite', { facing: Number.NaN }, 'facing expected'],
      ['level', { level: 19 }, 'level expected'],
      ['skin', { skin: target.skin + 1 }, 'skin expected'],
      ['weapon skin', { weaponSkin: 'wrong' }, 'weapon skin expected'],
      ['mount', { mountKey: '' }, 'mount expected'],
      ['mount remaining', { mountCastRemaining: 0.25 }, 'mount transition expected idle'],
      ['mount key', { mountCastKey: 'wrong' }, 'mount transition expected idle'],
      ['stow', { weaponStowed: true }, 'weapon remained stowed'],
      ['aura', { auraIds: [...target.auraIds, 'extra'] }, 'auras expected'],
      ['target', { targetId: 91 }, 'combat presentation did not clear'],
      ['auto attack', { autoAttack: true }, 'combat presentation did not clear'],
      ['queued swing', { queuedOnSwing: 'heroic_strike' }, 'combat presentation did not clear'],
      ['cast', { casting: true }, 'combat presentation did not clear'],
      ['combat', { inCombat: true }, 'remained in combat'],
      ['dead', { dead: true }, 'remained dead or ghosted'],
      ['ghost', { ghost: true }, 'remained dead or ghosted'],
    ];

    for (const [label, patch, expected] of cases) {
      const verdict = validateCrowdResetState([target], [{ ...valid, ...patch }], 'presented');
      expect(verdict.ok, label).toBe(false);
      expect(verdict.failures.join('; '), label).toContain(expected);
    }

    expect(
      validateCrowdResetState(
        [target],
        [
          {
            ...valid,
            x: target.parking.x + 2,
            z: target.parking.z - 2,
            facing: target.facing + 0.01,
          },
        ],
        'presented',
      ).ok,
    ).toBe(true);
    expect(validateCrowdResetState([target], [], 'presented')).toEqual({
      ok: false,
      phase: 'presented',
      bots: 1,
      failures: ['bot 0 snapshot unavailable'],
    });
  });

  it('rejects incomplete reset evidence before influx and retains complete evidence', () => {
    expect(() => assertCrowdResetEvidence(null, 24)).toThrow(
      /reset evidence is incomplete before influx/,
    );

    const reset = {
      bots: 24,
      recovery: { ok: true, phase: 'recovery', bots: 24, failures: [], attempts: 2 },
      neutral: { ok: true, phase: 'neutral', bots: 24, failures: [], attempts: 2 },
      presented: { ok: true, phase: 'presented', bots: 24, failures: [], attempts: 1 },
    };
    const incomplete = [
      { label: 'recovery verdict', patch: { recovery: { ...reset.recovery, ok: false } } },
      { label: 'neutral verdict', patch: { neutral: { ...reset.neutral, ok: false } } },
      { label: 'presented verdict', patch: { presented: { ...reset.presented, ok: false } } },
      { label: 'top-level count', patch: { bots: 23 } },
      { label: 'recovery count', patch: { recovery: { ...reset.recovery, bots: 23 } } },
      { label: 'neutral count', patch: { neutral: { ...reset.neutral, bots: 23 } } },
      { label: 'presented count', patch: { presented: { ...reset.presented, bots: 23 } } },
    ];
    for (const { label, patch } of incomplete) {
      expect(() => assertCrowdResetEvidence({ ...reset, ...patch }, 24), label).toThrow(
        /reset evidence is incomplete before influx/,
      );
    }

    const quiet = { quietSamples: 2, active: 0 };
    const validation = buildCrowdInfluxValidation({
      cosmetics: { players: 24, skins: 8, weaponSkins: 13, mounts: 5 },
      quiet,
      reset,
      botCount: 24,
    });

    expect(validation).toEqual({
      players: 24,
      skins: 8,
      weaponSkins: 13,
      mounts: 5,
      quiet,
      reset,
      serverErrors: [],
    });
    expect(validation.reset).toBe(reset);

    const benignTails = [{ botIndex: 3, errors: ['You cannot do that while in combat.'] }];
    expect(
      buildCrowdInfluxValidation({
        cosmetics: { players: 24, skins: 8, weaponSkins: 13, mounts: 5 },
        quiet,
        reset,
        botCount: 24,
        serverErrors: benignTails,
      }).serverErrors,
    ).toBe(benignTails);
  });

  it('fails influx validation on any server rate limiter text in the error tails', () => {
    const reset = {
      bots: 24,
      recovery: { ok: true, phase: 'recovery', bots: 24, failures: [], attempts: 1 },
      neutral: { ok: true, phase: 'neutral', bots: 24, failures: [], attempts: 1 },
      presented: { ok: true, phase: 'presented', bots: 24, failures: [], attempts: 1 },
    };
    const rateTexts = [
      'You are sending messages too quickly. Slow down.',
      'Chat locked for 20s because you are sending messages too quickly.',
      'Chat is on cooldown for 16s.',
    ];
    for (const text of rateTexts) {
      expect(
        () =>
          buildCrowdInfluxValidation({
            cosmetics: { players: 24, skins: 8, weaponSkins: 13, mounts: 5 },
            quiet: {},
            reset,
            botCount: 24,
            serverErrors: [{ botIndex: 7, errors: ['benign refusal', text] }],
          }),
        text,
      ).toThrow(/bot 7 tripped the server message rate limiter/);
    }
    expect(assertNoRateLimiterErrors(undefined)).toEqual([]);
    expect(
      assertNoRateLimiterErrors([{ botIndex: 1, errors: ['Target is too far away.'] }]),
    ).toHaveLength(1);
  });

  it('retains the existing influx cosmetic validity thresholds', () => {
    const reset = {
      bots: 24,
      recovery: { ok: true, phase: 'recovery', bots: 24, failures: [], attempts: 1 },
      neutral: { ok: true, phase: 'neutral', bots: 24, failures: [], attempts: 1 },
      presented: { ok: true, phase: 'presented', bots: 24, failures: [], attempts: 1 },
    };
    const build = (cosmetics) =>
      buildCrowdInfluxValidation({ cosmetics, quiet: {}, reset, botCount: 24 });

    expect(() => build({ players: 18, skins: 8, weaponSkins: 13, mounts: 5 })).toThrow(
      /rendered only 18\/24 bots/,
    );
    expect(() => build({ players: 24, skins: 3, weaponSkins: 13, mounts: 5 })).toThrow(
      /cosmetic variety is incomplete/,
    );
    expect(() => build({ players: 24, skins: 8, weaponSkins: 3, mounts: 5 })).toThrow(
      /cosmetic variety is incomplete/,
    );
    expect(() => build({ players: 24, skins: 8, weaponSkins: 13, mounts: 2 })).toThrow(
      /cosmetic variety is incomplete/,
    );
  });
});

describe('crowd reset command pacing', () => {
  const chat = (botIndex, text) => ({ botIndex, kind: 'command', payload: { cmd: 'chat', text } });
  const teleport = (botIndex) => ({
    botIndex,
    kind: 'command',
    payload: { cmd: 'dev_teleport', x: 1, z: 2 },
  });
  const idleInput = (botIndex) => ({ botIndex, kind: 'input', move: {}, facing: 0 });

  it('pins the pacing windows beneath the server per-connection budgets', () => {
    // The server chat ladder (server/game.ts consumeChatToken) refills one
    // token per 3000 ms (CHAT_RATE_REFILL_PER_SECOND = 1/3) over a burst of 5,
    // and three consecutive refusals lock chat for 20 s. Chat spacing must sit
    // strictly above that refill period so a bot's bucket can never run dry.
    expect(HITCH_CROWD_CHAT_RETRY_MS).toBeGreaterThan(3_000);
    expect({
      chatRetryMs: HITCH_CROWD_CHAT_RETRY_MS,
      commandRetryMs: HITCH_CROWD_COMMAND_RETRY_MS,
      mountGrantReadbackMs: HITCH_CROWD_MOUNT_GRANT_READBACK_MS,
    }).toEqual({ chatRetryMs: 3_500, commandRetryMs: 2_500, mountGrantReadbackMs: 1_000 });
  });

  it('issues a command once and retries only after its class quiet window', () => {
    const ledger = createCrowdCommandLedger();

    expect(paceCrowdResetActions(ledger, [teleport(0)], 0)).toEqual([teleport(0)]);
    expect(paceCrowdResetActions(ledger, [teleport(0)], 200)).toEqual([]);
    expect(paceCrowdResetActions(ledger, [teleport(0)], HITCH_CROWD_COMMAND_RETRY_MS - 1)).toEqual(
      [],
    );
    expect(paceCrowdResetActions(ledger, [teleport(0)], HITCH_CROWD_COMMAND_RETRY_MS)).toEqual([
      teleport(0),
    ]);
    expect(paceCrowdResetActions(ledger, [chat(0, '/dev combatreset')], 0)).toEqual([
      chat(0, '/dev combatreset'),
    ]);
    expect(
      paceCrowdResetActions(ledger, [chat(0, '/dev combatreset')], HITCH_CROWD_CHAT_RETRY_MS - 1),
    ).toEqual([]);
    expect(
      paceCrowdResetActions(ledger, [chat(0, '/dev combatreset')], HITCH_CROWD_CHAT_RETRY_MS),
    ).toEqual([chat(0, '/dev combatreset')]);
  });

  it('spaces all of one bot chat sends at the chat window even across texts', () => {
    const ledger = createCrowdCommandLedger();

    expect(paceCrowdResetActions(ledger, [chat(0, '/dev mounts')], 0)).toEqual([
      chat(0, '/dev mounts'),
    ]);
    // A DIFFERENT chat text for the same bot still waits out the whole-lane
    // spacing: two distinct texts back to back would beat the ladder refill.
    expect(paceCrowdResetActions(ledger, [chat(0, '/dev combatreset')], 200)).toEqual([]);
    // Another bot's chat budget is independent (per-connection ladders).
    expect(paceCrowdResetActions(ledger, [chat(1, '/dev combatreset')], 200)).toEqual([
      chat(1, '/dev combatreset'),
    ]);
    expect(
      paceCrowdResetActions(ledger, [chat(0, '/dev combatreset')], HITCH_CROWD_CHAT_RETRY_MS),
    ).toEqual([chat(0, '/dev combatreset')]);
  });

  it('never paces input frames and keys command signatures per bot', () => {
    const ledger = createCrowdCommandLedger();

    expect(paceCrowdResetActions(ledger, [idleInput(0), teleport(0)], 0)).toEqual([
      idleInput(0),
      teleport(0),
    ]);
    expect(paceCrowdResetActions(ledger, [idleInput(0), teleport(0)], 200)).toEqual([idleInput(0)]);
    expect(paceCrowdResetActions(ledger, [teleport(1)], 200)).toEqual([teleport(1)]);
    expect(crowdCommandSignature(0, { cmd: 'dev_teleport', x: 1, z: 2 })).not.toBe(
      crowdCommandSignature(1, { cmd: 'dev_teleport', x: 1, z: 2 }),
    );
    expect(crowdCommandSignature(0, { cmd: 'dev_teleport', x: 1, z: 2 })).toBe(
      crowdCommandSignature(0, { z: 2, x: 1, cmd: 'dev_teleport' }),
    );
  });

  it('plans the riding grant, then the reins fallback after the readback window', () => {
    const [target] = buildCrowdResetTargets(rows);
    const base = {
      botIndex: target.botIndex,
      ridingTrained: false,
      bagItemIds: [],
    };
    const ledger = createCrowdCommandLedger();
    const grant = {
      botIndex: target.botIndex,
      kind: 'command',
      payload: { cmd: 'chat', text: '/dev mounts' },
    };
    const give = {
      botIndex: target.botIndex,
      kind: 'command',
      payload: { cmd: 'dev_give', item: target.mountItem, count: 1 },
    };

    // Untrained with no grant issued yet: the grant goes first, alone; the
    // dev_give fallback must wait for the grant's snapshot readback.
    expect(planCrowdMountReadinessActions([target], [base], ledger, 0)).toEqual([grant]);
    paceCrowdResetActions(ledger, [grant], 0);
    expect(
      planCrowdMountReadinessActions(
        [target],
        [{ ...base, ridingTrained: true }],
        ledger,
        HITCH_CROWD_MOUNT_GRANT_READBACK_MS - 1,
      ),
    ).toEqual([]);
    expect(
      planCrowdMountReadinessActions(
        [target],
        [{ ...base, ridingTrained: true }],
        ledger,
        HITCH_CROWD_MOUNT_GRANT_READBACK_MS,
      ),
    ).toEqual([give]);
    // A still-untrained bot keeps planning the grant (the ledger owns pacing)
    // and the fallback alongside it once the readback window has passed.
    expect(
      planCrowdMountReadinessActions([target], [base], ledger, HITCH_CROWD_MOUNT_GRANT_READBACK_MS),
    ).toEqual([grant, give]);
    // Already trained with no grant pending: the reins fallback is immediate.
    expect(
      planCrowdMountReadinessActions(
        [target],
        [{ ...base, ridingTrained: true }],
        createCrowdCommandLedger(),
        0,
      ),
    ).toEqual([give]);
    // Fully ready: nothing to send.
    expect(
      planCrowdMountReadinessActions(
        [target],
        [{ ...base, ridingTrained: true, bagItemIds: [target.mountItem] }],
        createCrowdCommandLedger(),
        0,
      ),
    ).toEqual([]);
  });

  it('declares every runtime export in the hand-written .d.mts', () => {
    // The tests/market_filler_listings.test.ts pattern: anchored at line start
    // so a commented-out declaration cannot match, compared as a sorted set so
    // the sweep runs both ways and a stale declaration fails too.
    const dts = readFileSync(
      new URL('../scripts/lib/perf_hitch_crowd_reset.d.mts', import.meta.url),
      'utf8',
    );
    const declared = [...dts.matchAll(/^export (?:declare )?(?:function|const) (\w+)/gm)]
      .map((match) => match[1])
      .sort();
    expect(declared).toEqual(Object.keys(crowdResetModule).sort());
  });
});
