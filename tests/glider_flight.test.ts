import { describe, expect, it } from 'vitest';
import { GLIDER_COURSE, GLIDER_LAUNCH_SITE } from '../src/sim/content/world_quest_glider';
import { createPlayer } from '../src/sim/entity';
import {
  createGliderFlightState,
  GLIDER_BASE_FORWARD_SPEED,
  GLIDER_BASE_SINK_RATE,
  type GliderCourseDef,
  scoreGliderFlight,
  tickGliderFlight,
} from '../src/sim/minigames/glider_flight';
import { emptyMoveInput, normAngle } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const TEST_COURSE: GliderCourseDef = {
  id: 'test_course',
  rings: [
    { id: 1, x: 0, y: 50, z: 20, radius: 5.0, boostY: 6.0 },
    { id: 2, x: 0, y: 40, z: 50, radius: 5.0, boostY: 6.0 },
  ],
  landingPad: { x: 0, y: 10, z: 100, radius: 8.0 },
  minRings: 1,
};

describe('Glider Flight Minigame', () => {
  it('initializes in countdown phase by default, then transitions to flying', () => {
    const state = createGliderFlightState(true);
    expect(state.phase).toBe('countdown');
    expect(state.countdownTicks).toBeGreaterThan(0);
    expect(state.passedRings).toEqual([]);

    const player = createPlayer(1, 'warrior', { x: 0, y: 60, z: 0 }, 'Test');
    for (let i = 0; i < 60; i++) {
      tickGliderFlight(state, player, emptyMoveInput(), TEST_COURSE, WORLD_SEED);
    }
    expect(state.phase).toBe('flying');
    expect(state.tick).toBe(0);
    expect(state.speed).toBe(GLIDER_BASE_FORWARD_SPEED);
    expect(state.vy).toBe(GLIDER_BASE_SINK_RATE);
  });

  it('steers facing left and right with turn or strafe inputs', () => {
    const state = createGliderFlightState(false);
    const player = createPlayer(1, 'warrior', { x: 0, y: 60, z: 0 }, 'Test');
    player.facing = 0;

    const input = emptyMoveInput();
    input.turnLeft = true;

    tickGliderFlight(state, player, input, TEST_COURSE, WORLD_SEED);
    expect(player.facing).toBeGreaterThan(0);

    const afterLeft = player.facing;
    input.turnLeft = false;
    input.turnRight = true;
    tickGliderFlight(state, player, input, TEST_COURSE, WORLD_SEED);
    expect(player.facing).toBeLessThan(afterLeft);
  });

  it('explicit dive and surface exchange altitude and speed', () => {
    const flat: GliderCourseDef = {
      ...TEST_COURSE,
      rings: [{ id: 1, x: 0, y: 100, z: 100, radius: 5, boostY: 0 }],
      landingPad: { x: 0, y: 100, z: 200, radius: 10 },
    };
    function fly(dive: boolean, surface: boolean) {
      const state = createGliderFlightState(false);
      const player = createPlayer(1, 'warrior', { x: 0, y: 100, z: 0 }, 'Test');
      player.facing = 0;
      for (let i = 0; i < 20; i++)
        tickGliderFlight(state, player, { ...emptyMoveInput(), dive, surface }, flat, WORLD_SEED);
      return { state, player };
    }
    const neutral = fly(false, false),
      down = fly(true, false),
      up = fly(false, true);
    expect(down.player.pos.y).toBeLessThan(neutral.player.pos.y);
    expect(up.player.pos.y).toBeGreaterThan(neutral.player.pos.y);
    expect(down.state.speed).toBeGreaterThan(neutral.state.speed);
    expect(up.state.speed).toBeLessThan(neutral.state.speed);
  });

  it('S brakes forward flight without requiring a climb', () => {
    const state = createGliderFlightState(false);
    const player = createPlayer(1, 'warrior', { x: 0, y: 100, z: 0 }, 'Test');
    player.facing = 0;
    for (let i = 0; i < 20; i++)
      tickGliderFlight(state, player, { ...emptyMoveInput(), back: true }, TEST_COURSE, WORLD_SEED);
    expect(state.speed).toBeLessThan(GLIDER_BASE_FORWARD_SPEED);
    expect(state.speed).toBeGreaterThanOrEqual(8);
    expect(state.vy).toBeLessThan(0);
  });

  it('detects ring collision without a vertical teleport and records ring ID', () => {
    const state = createGliderFlightState(false);
    const player = createPlayer(1, 'warrior', { x: 0, y: 48, z: 19 }, 'Test');
    player.facing = 0; // facing +z toward ring 1 at z: 20

    tickGliderFlight(state, player, emptyMoveInput(), TEST_COURSE, WORLD_SEED);

    expect(state.passedRings).toContain(1);
    expect(state.recentRingPassed?.id).toBe(1);
    expect(Math.abs(player.pos.y - 48)).toBeLessThan(0.5);
  });

  it('sets phase to won when landing safely on the landing pad with required rings', () => {
    const state = createGliderFlightState(false);
    state.passedRings = [1, 2];
    const player = createPlayer(
      1,
      'warrior',
      { x: 0, y: groundHeight(0, 98, WORLD_SEED) + 1, z: 98 },
      'Test',
    );
    player.facing = 0;

    tickGliderFlight(state, player, emptyMoveInput(), TEST_COURSE, WORLD_SEED);

    expect(state.phase).toBe('won');
    expect(state.result).toBeDefined();
    expect(state.result?.rating).toBeDefined();
    expect(player.vx).toBe(0);
    expect(player.vy).toBe(0);
    expect(player.vz).toBe(0);
  });

  it('sets phase to failed when landing on destination pad without enough rings', () => {
    const state = createGliderFlightState(false);
    // Over pad at z: 100 with 0 rings passed (minRings is 1)
    const player = createPlayer(
      1,
      'warrior',
      { x: 0, y: groundHeight(0, 100, WORLD_SEED) + 1, z: 100 },
      'Test',
    );

    tickGliderFlight(state, player, emptyMoveInput(), TEST_COURSE, WORLD_SEED);

    expect(state.phase).toBe('failed');
    expect(player.vx).toBe(0);
    expect(player.vy).toBe(0);
    expect(player.vz).toBe(0);
  });

  it('fails on terrain contact without granting artificial lift up the ground', () => {
    const state = createGliderFlightState(false);
    const groundY = groundHeight(0, 40, WORLD_SEED);
    const player = createPlayer(1, 'warrior', { x: 0, y: groundY + 0.5, z: 40 }, 'Test');
    tickGliderFlight(state, player, emptyMoveInput(), TEST_COURSE, WORLD_SEED);
    expect(player.pos.y).toBeLessThanOrEqual(groundY + 0.5);
    expect(state.vy).toBeLessThan(0);
    expect(state.phase).toBe('failed');
    expect(player.vy).toBe(0);
  });

  it('computes ratings and scores properly', () => {
    const gold = scoreGliderFlight(6, 6, 18.5);
    expect(gold.rating).toBe('gold');
    expect(gold.score).toBeGreaterThan(1500);

    const silver = scoreGliderFlight(5, 6, 24);
    expect(silver.rating).toBe('silver');

    const bronze = scoreGliderFlight(3, 6, 40);
    expect(bronze.rating).toBe('bronze');
  });
});

describe('energy-controlled authored glider flight', () => {
  it('W cannot create powered flight or extra vertical lift', () => {
    const flat: GliderCourseDef = {
      id: 'flat',
      rings: [
        { id: 1, x: 0, y: 100, z: 30, radius: 4, boostY: 0 },
        { id: 2, x: 0, y: 100, z: 100, radius: 4, boostY: 0 },
      ],
      landingPad: { x: 0, y: 100, z: 200, radius: 10 },
      minRings: 2,
    };
    function fly(forward: boolean) {
      const state = createGliderFlightState(false);
      const player = createPlayer(1, 'warrior', { x: 0, y: 100, z: 0 }, 'Pilot');
      player.facing = 0;
      for (let i = 0; i < 15; i++)
        tickGliderFlight(state, player, { ...emptyMoveInput(), forward }, flat, WORLD_SEED);
      return { state, player };
    }
    const neutral = fly(false),
      boost = fly(true);
    expect(boost.state.speed).toBe(neutral.state.speed);
    expect(boost.player.pos.y).toBeCloseTo(neutral.player.pos.y, 8);
  });
  it.each([false, true])(
    'flies the actual coastal circuit using steering and pitch, with W=%s',
    (forward) => {
      const state = createGliderFlightState(true);
      const player = createPlayer(1, 'warrior', { ...GLIDER_LAUNCH_SITE.playerLaunch }, 'Pilot');
      player.facing = GLIDER_LAUNCH_SITE.playerFacing;
      for (let i = 0; i < 2600 && (state.phase === 'flying' || state.phase === 'countdown'); i++) {
        const target =
          GLIDER_COURSE.rings.find((r) => !state.passedRings.includes(r.id)) ??
          GLIDER_COURSE.landingPad;
        const difference = normAngle(
          Math.atan2(target.x - player.pos.x, target.z - player.pos.z) - player.facing,
        );
        const input = {
          ...emptyMoveInput(),
          forward,
          turnLeft: difference > 0.06,
          turnRight: difference < -0.06,
          gliderPitch: Math.max(
            -1,
            Math.min(
              1,
              ((target.y - player.pos.y) * 1.5 + 0.55) / (target.y > player.pos.y ? 7 : 14),
            ),
          ),
        };
        const oldY = player.pos.y;
        tickGliderFlight(state, player, input, GLIDER_COURSE, WORLD_SEED);
        if (state.phase === 'flying')
          expect(Math.abs(player.pos.y - oldY)).toBeLessThanOrEqual(0.81);
      }
      expect(state.phase).toBe('won');
      expect(state.passedRings).toEqual(GLIDER_COURSE.rings.map((r) => r.id));
      expect(state.result?.elapsedSeconds).toBeGreaterThan(30);
      expect(state.result?.elapsedSeconds).toBeLessThan(110);
      expect(state.windBoosts?.length).toBeGreaterThan(0);
    },
  );
  it('sweeps across small rings between ticks and never credits one twice', () => {
    const course: GliderCourseDef = {
      id: 'sweep',
      rings: [
        { id: 1, x: 0, y: 100, z: 0.55, radius: 0.1, boostY: 200 },
        { id: 2, x: 0, y: 100, z: 100, radius: 1, boostY: 0 },
      ],
      landingPad: { x: 0, y: 100, z: 200, radius: 10 },
      minRings: 1,
    };
    const state = createGliderFlightState(false),
      player = createPlayer(1, 'warrior', { x: 0, y: 100, z: 0 }, 'Pilot');
    player.facing = 0;
    tickGliderFlight(state, player, emptyMoveInput(), course, WORLD_SEED);
    expect(state.passedRings).toEqual([1]);
    expect(player.pos.y).toBeLessThan(100);
    player.facing = Math.PI;
    tickGliderFlight(state, player, emptyMoveInput(), course, WORLD_SEED);
    expect(state.passedRings).toEqual([1]);
  });
  it('opposing inputs cancel and leaving the course sideways fails without teleporting through it', () => {
    const course: GliderCourseDef = {
      id: 'bounds',
      rings: [{ id: 1, x: 0, y: 100, z: 100, radius: 5, boostY: 0 }],
      landingPad: { x: 0, y: 100, z: 200, radius: 10 },
      minRings: 1,
    };
    const state = createGliderFlightState(false),
      player = createPlayer(1, 'warrior', { x: 0, y: 100, z: 0 }, 'Pilot');
    player.facing = Math.PI / 2;
    const hostile = {
      ...emptyMoveInput(),
      forward: true,
      back: true,
      turnLeft: true,
      turnRight: true,
      dive: true,
      surface: true,
    };
    tickGliderFlight(state, player, hostile, course, WORLD_SEED);
    expect(player.facing).toBe(Math.PI / 2);
    expect(state.speed).toBeCloseTo(GLIDER_BASE_FORWARD_SPEED, 1);
    expect(player.pos.y).toBeLessThan(100);
    for (let i = 0; i < 100 && state.phase === 'flying'; i++)
      tickGliderFlight(state, player, hostile, course, WORLD_SEED);
    expect(state.phase).toBe('failed');
    expect(player.pos.x).toBeGreaterThan(55);
    expect(player.pos.z).toBeCloseTo(0);
    const terminal = { ...player.pos };
    tickGliderFlight(state, player, hostile, course, WORLD_SEED);
    expect(player.pos).toEqual(terminal);
  });
  it('authors a long progressive course with clear rings and coherent medals', () => {
    expect(GLIDER_COURSE.rings).toHaveLength(20);
    expect(GLIDER_COURSE.minRings).toBe(18);
    const points = [
      GLIDER_LAUNCH_SITE.playerLaunch,
      ...GLIDER_COURSE.rings,
      GLIDER_COURSE.landingPad,
    ];
    let distance = 0;
    for (let i = 1; i < points.length; i++)
      distance += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    expect(distance).toBeGreaterThan(1250);
    expect(distance).toBeLessThan(1400);
    for (let i = 0; i < GLIDER_COURSE.rings.length; i++) {
      const ring = GLIDER_COURSE.rings[i];
      expect(ring.y - ring.radius - groundHeight(ring.x, ring.z, WORLD_SEED)).toBeGreaterThan(2);
      if (i) expect(ring.radius).toBeLessThanOrEqual(GLIDER_COURSE.rings[i - 1].radius);
    }
    expect(scoreGliderFlight(20, 20, 51, GLIDER_COURSE.medals).rating).toBe('gold');
    expect(scoreGliderFlight(19, 20, 60, GLIDER_COURSE.medals).rating).toBe('silver');
    expect(scoreGliderFlight(18, 20, 80, GLIDER_COURSE.medals).rating).toBe('bronze');
  });
});
