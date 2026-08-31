import { describe, expect, it } from 'vitest';
import {
  VARKHUL_ASSEMBLY_CORE_BASE_DAMAGE,
  VARKHUL_ASSEMBLY_CORE_WINDOW_SECONDS,
  VARKHUL_ASSEMBLY_FORGE_MAX_HP,
  VARKHUL_ASSEMBLY_RUNE_ALIGNMENT_RADIANS,
  VARKHUL_ASSEMBLY_RUNE_CONTROL_ARM_SECONDS,
  VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET,
  VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS,
  VARKHUL_ASSEMBLY_RUNE_COUNT,
  VARKHUL_ASSEMBLY_RUNE_LOCK_HOLD_SECONDS,
  VARKHUL_ASSEMBLY_RUNE_RING_FORWARD_OFFSET,
  VARKHUL_ASSEMBLY_RUNE_SECOND_WAVE_MIN_SECONDS_HEROIC,
  VARKHUL_ASSEMBLY_RUNE_SPEED_HEROIC,
  VARKHUL_ASSEMBLY_RUNE_SPEED_NORMAL,
  VARKHUL_ASSEMBLY_RUNE_STATION_RING_RADIUS,
  VARKHUL_ASSEMBLY_RUNE_TRACK_COUNT,
  VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS,
  VARKHUL_ASSEMBLY_UNSTABLE_REACTION_DAMAGE,
  varkhulAssemblyAdjacentRuneSymbols,
  varkhulAssemblyAdvanceControlHold,
  varkhulAssemblyAdvanceRuneAlignment,
  varkhulAssemblyBestRuneControl,
  varkhulAssemblyBurdenDamageMaxHp,
  varkhulAssemblyFireballPattern,
  varkhulAssemblyRounds,
  varkhulAssemblyRuneAligned,
  varkhulAssemblyRuneAssignments,
  varkhulAssemblyRuneControlAt,
  varkhulAssemblyRuneControlPosition,
  varkhulAssemblyRuneOutcome,
  varkhulAssemblyRuneRemainingAfterWaveAdvance,
  varkhulAssemblyRuneRescuePlayerIds,
  varkhulAssemblyRuneSeconds,
  varkhulAssemblyRuneSlots,
  varkhulAssemblyRuneStartAngle,
  varkhulAssemblyRuneStation,
  varkhulAssemblyRuneTargetAngle,
  varkhulAssemblyRuneWave,
  varkhulAssemblyStepRune,
} from '../src/sim/varkhul_assembly';

describe("Varkhul Master's Assembly", () => {
  it('pins the three-core forge break contract', () => {
    expect(VARKHUL_ASSEMBLY_FORGE_MAX_HP).toBe(100);
    expect(VARKHUL_ASSEMBLY_CORE_BASE_DAMAGE).toBe(20);
    expect(VARKHUL_ASSEMBLY_UNSTABLE_REACTION_DAMAGE).toBe(40);
    expect(VARKHUL_ASSEMBLY_CORE_WINDOW_SECONDS).toBe(6);
  });

  it('ramps the carrier burden by two percent per tick with a ten-percent cap', () => {
    expect(varkhulAssemblyBurdenDamageMaxHp(1)).toBe(0.02);
    expect(varkhulAssemblyBurdenDamageMaxHp(3)).toBe(0.06);
    expect(varkhulAssemblyBurdenDamageMaxHp(99)).toBe(0.1);
  });

  it('assigns ten raiders ten deterministic and unique rune symbols', () => {
    const players = Array.from({ length: 10 }, (_, index) => index + 11);
    const assignments = varkhulAssemblyRuneAssignments(players, 901, 1);
    expect(assignments).toEqual(varkhulAssemblyRuneAssignments(players, 901, 1));
    expect(assignments).toHaveLength(VARKHUL_ASSEMBLY_RUNE_COUNT);
    expect(new Set(assignments.map((assignment) => assignment.playerId)).size).toBe(10);
    expect(new Set(assignments.map((assignment) => assignment.symbol)).size).toBe(10);
    expect(assignments.map((assignment) => assignment.symbol).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, index) => index),
    );
  });

  it('places ten individual rune stations on a compact clock in front of the forge', () => {
    const origin = { x: 50, z: 80 };
    expect(VARKHUL_ASSEMBLY_RUNE_TRACK_COUNT).toBe(10);
    expect(VARKHUL_ASSEMBLY_RUNE_STATION_RING_RADIUS).toBe(15.5);
    expect(VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS).toBe(3);
    expect(VARKHUL_ASSEMBLY_RUNE_RING_FORWARD_OFFSET).toBe(2);
    const slots = varkhulAssemblyRuneSlots('normal', 0);
    const stations = Array.from({ length: VARKHUL_ASSEMBLY_RUNE_COUNT }, (_, symbol) =>
      varkhulAssemblyRuneStation(origin, slots[symbol]),
    );
    expect(new Set(stations.map((station) => station.trackIndex))).toEqual(
      new Set(Array.from({ length: 10 }, (_, slot) => slot)),
    );
    expect(new Set(stations.map((station) => station.trackRadius))).toEqual(new Set([3]));
    const center = { x: origin.x, z: origin.z + VARKHUL_ASSEMBLY_RUNE_RING_FORWARD_OFFSET };
    for (const station of stations) {
      expect(Math.hypot(station.x - center.x, station.z - center.z)).toBeCloseTo(
        VARKHUL_ASSEMBLY_RUNE_STATION_RING_RADIUS,
        5,
      );
      expect(Math.hypot(Math.sin(station.ownerAngle), Math.cos(station.ownerAngle))).toBeCloseTo(
        1,
        5,
      );
    }
    expect(
      new Set(stations.map((station) => `${station.x.toFixed(4)}:${station.z.toFixed(4)}`)).size,
    ).toBe(10);
    expect(stations.reduce((sum, station) => sum + station.x, 0) / stations.length).toBeCloseTo(
      center.x,
      5,
    );
    expect(stations.reduce((sum, station) => sum + station.z, 0) / stations.length).toBeCloseTo(
      center.z,
      5,
    );
    const ownerAngles = stations.map((station) => station.ownerAngle).sort((a, b) => a - b);
    expect(new Set(ownerAngles.map((angle) => angle.toFixed(6))).size).toBe(10);
    for (let slot = 0; slot < VARKHUL_ASSEMBLY_RUNE_COUNT; slot++) {
      expect(ownerAngles[slot]).toBeCloseTo(
        Math.PI / VARKHUL_ASSEMBLY_RUNE_COUNT +
          slot * ((Math.PI * 2) / VARKHUL_ASSEMBLY_RUNE_COUNT),
        5,
      );
    }
    expect(stations.slice(0, 5).every((station) => station.trackIndex % 2 === 0)).toBe(true);
    expect(stations.slice(5).every((station) => station.trackIndex % 2 === 1)).toBe(true);
    const ordered = [...stations].sort((first, second) => first.ownerAngle - second.ownerAngle);
    for (let index = 0; index < ordered.length; index++) {
      const first = ordered[index];
      const second = ordered[(index + 1) % ordered.length];
      expect(Math.hypot(first.x - second.x, first.z - second.z)).toBeGreaterThan(
        2 *
          (VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS +
            VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET +
            VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS),
      );
    }
  });

  it('keeps Normal positions stable and deterministically reshuffles Heroic positions per pull', () => {
    expect(varkhulAssemblyRuneSlots('normal', 0)).toEqual([0, 2, 4, 6, 8, 1, 3, 5, 7, 9]);
    expect(varkhulAssemblyRuneSlots('normal', 99)).toEqual(varkhulAssemblyRuneSlots('normal', 0));
    const firstHeroic = varkhulAssemblyRuneSlots('heroic', 0);
    const secondHeroic = varkhulAssemblyRuneSlots('heroic', 1);
    expect(firstHeroic).toEqual(varkhulAssemblyRuneSlots('heroic', 0));
    expect(firstHeroic).not.toEqual(secondHeroic);
    expect([...firstHeroic].sort((a, b) => a - b)).toEqual(
      Array.from({ length: VARKHUL_ASSEMBLY_RUNE_COUNT }, (_, slot) => slot),
    );
    expect([...secondHeroic].sort((a, b) => a - b)).toEqual(
      Array.from({ length: VARKHUL_ASSEMBLY_RUNE_COUNT }, (_, slot) => slot),
    );
    for (let symbol = 0; symbol < VARKHUL_ASSEMBLY_RUNE_COUNT; symbol++) {
      expect(firstHeroic[symbol] % 2).toBe(varkhulAssemblyRuneWave(symbol, 2));
      expect(secondHeroic[symbol] % 2).toBe(varkhulAssemblyRuneWave(symbol, 2));
    }
    for (const slots of [firstHeroic, secondHeroic]) {
      for (let symbol = 0; symbol < VARKHUL_ASSEMBLY_RUNE_COUNT; symbol++) {
        const adjacentSymbols = varkhulAssemblyAdjacentRuneSymbols(symbol, slots);
        expect(adjacentSymbols).not.toContain(-1);
        expect(
          adjacentSymbols.every(
            (adjacent) =>
              varkhulAssemblyRuneWave(adjacent, 2) !== varkhulAssemblyRuneWave(symbol, 2),
          ),
        ).toBe(true);
      }
    }
    const assignments = Array.from({ length: 10 }, (_, symbol) => ({
      playerId: 100 + symbol,
      symbol,
    }));
    expect(varkhulAssemblyRuneRescuePlayerIds(0, assignments, firstHeroic)).toEqual(
      varkhulAssemblyAdjacentRuneSymbols(0, firstHeroic).map((symbol) => 100 + symbol),
    );
    expect(varkhulAssemblyRuneSlots('heroic', 11_013)).not.toEqual(
      varkhulAssemblyRuneSlots('heroic', 11_014),
    );
  });

  it('moves the left and right controls with the glyph instead of letting a player stand still', () => {
    const station = varkhulAssemblyRuneStation({ x: 4, z: 9 }, 4);
    const glyphAngle = Math.PI / 3;
    const left = varkhulAssemblyRuneControlPosition(
      station,
      station.trackRadius,
      glyphAngle,
      'counterclockwise',
    );
    const right = varkhulAssemblyRuneControlPosition(
      station,
      station.trackRadius,
      glyphAngle,
      'clockwise',
    );
    expect(Math.hypot(left.x - station.x, left.z - station.z)).toBeCloseTo(
      station.trackRadius - VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET,
      5,
    );
    expect(Math.hypot(right.x - station.x, right.z - station.z)).toBeCloseTo(
      station.trackRadius + VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET,
      5,
    );
    expect(varkhulAssemblyRuneControlAt(station, station.trackRadius, glyphAngle, left)).toBe(
      'counterclockwise',
    );
    expect(varkhulAssemblyRuneControlAt(station, station.trackRadius, glyphAngle, right)).toBe(
      'clockwise',
    );
    expect(
      varkhulAssemblyRuneControlAt(station, station.trackRadius, glyphAngle, {
        x: left.x + VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS + 0.001,
        z: left.z,
      }),
    ).toBe('off');
    const movedLeft = varkhulAssemblyRuneControlPosition(
      station,
      station.trackRadius,
      glyphAngle + 0.5,
      'counterclockwise',
    );
    expect(varkhulAssemblyRuneControlAt(station, station.trackRadius, glyphAngle + 0.5, left)).toBe(
      'off',
    );
    expect(
      varkhulAssemblyRuneControlAt(station, station.trackRadius, glyphAngle + 0.5, movedLeft),
    ).toBe('counterclockwise');
  });

  it('requires a deliberate control arm and a separate socket stabilization hold', () => {
    expect(VARKHUL_ASSEMBLY_RUNE_CONTROL_ARM_SECONDS).toBe(0.6);
    expect(VARKHUL_ASSEMBLY_RUNE_LOCK_HOLD_SECONDS).toBe(0.8);
    let hold = varkhulAssemblyAdvanceControlHold('off', 0, 'clockwise', 0.59);
    expect(hold).toMatchObject({ control: 'clockwise', engaged: false });
    expect(hold.progress).toBeCloseTo(0.59 / 0.6, 5);
    hold = varkhulAssemblyAdvanceControlHold(hold.control, hold.seconds, 'clockwise', 0.01);
    expect(hold).toMatchObject({ control: 'clockwise', seconds: 0.6, progress: 1, engaged: true });
    const switched = varkhulAssemblyAdvanceControlHold(
      hold.control,
      hold.seconds,
      'counterclockwise',
      0.05,
    );
    expect(switched).toMatchObject({ control: 'counterclockwise', seconds: 0.05, engaged: false });
    expect(varkhulAssemblyAdvanceControlHold(switched.control, switched.seconds, 'off', 1)).toEqual(
      {
        control: 'off',
        seconds: 0,
        progress: 0,
        engaged: false,
      },
    );
    expect(varkhulAssemblyAdvanceRuneAlignment(0.75, true, true, 0.05)).toBe(0.8);
    expect(varkhulAssemblyAdvanceRuneAlignment(0.75, true, false, 0.05)).toBe(0);
    expect(varkhulAssemblyAdvanceRuneAlignment(0.75, false, true, 0.05)).toBe(0);
  });

  it('gives every rune a readable short route and a punishing long route in either direction', () => {
    const targets = Array.from({ length: VARKHUL_ASSEMBLY_RUNE_COUNT }, (_, symbol) =>
      varkhulAssemblyRuneTargetAngle(901, symbol, 1),
    );
    expect(targets).toEqual(
      Array.from({ length: VARKHUL_ASSEMBLY_RUNE_COUNT }, (_, symbol) =>
        varkhulAssemblyRuneTargetAngle(901, symbol, 1),
      ),
    );
    expect(new Set(targets.map((angle) => angle.toFixed(4))).size).toBeGreaterThanOrEqual(8);
    const bestControls = new Set<string>();
    targets.forEach((target, symbol) => {
      const start = varkhulAssemblyRuneStartAngle(901, symbol, 1);
      expect(varkhulAssemblyRuneAligned(start, target)).toBe(false);
      const shortRoute = Math.abs(Math.atan2(Math.sin(start - target), Math.cos(start - target)));
      expect(shortRoute).toBeGreaterThanOrEqual(Math.PI / 3);
      expect(shortRoute).toBeLessThanOrEqual(Math.PI / 2);
      expect(Math.PI * 2 - shortRoute).toBeGreaterThanOrEqual((Math.PI * 3) / 2);
      bestControls.add(varkhulAssemblyBestRuneControl(start, target));
    });
    expect(bestControls).toEqual(new Set(['clockwise', 'counterclockwise']));
  });

  it('rotates in both directions, stops in neutral space, and snaps when it crosses the socket', () => {
    const target = 0;
    const start = -0.2;
    expect(varkhulAssemblyStepRune(start, 'off', 'normal', 0.5, target)).toBe(start);
    expect(varkhulAssemblyStepRune(start, 'counterclockwise', 'normal', 0.05, target)).toBeLessThan(
      start,
    );
    expect(varkhulAssemblyStepRune(start, 'clockwise', 'normal', 0.05, target)).toBeGreaterThan(
      start,
    );
    expect(varkhulAssemblyStepRune(-0.01, 'clockwise', 'normal', 1, target)).toBe(target);
    expect(varkhulAssemblyStepRune(0.01, 'counterclockwise', 'normal', 1, target)).toBe(target);
    expect(varkhulAssemblyRuneAligned(VARKHUL_ASSEMBLY_RUNE_ALIGNMENT_RADIANS, target)).toBe(true);
    expect(
      varkhulAssemblyRuneAligned(VARKHUL_ASSEMBLY_RUNE_ALIGNMENT_RADIANS + 0.001, target),
    ).toBe(false);
  });

  it('turns deliberately on Normal and even slower on Heroic', () => {
    expect(VARKHUL_ASSEMBLY_RUNE_SPEED_NORMAL).toBeCloseTo(Math.PI / 10, 10);
    expect(VARKHUL_ASSEMBLY_RUNE_SPEED_HEROIC).toBeCloseTo(Math.PI / 20, 10);
    const target = Math.PI;
    const normal = varkhulAssemblyStepRune(0, 'clockwise', 'normal', 0.5, target);
    const heroic = varkhulAssemblyStepRune(0, 'clockwise', 'heroic', 0.5, target);
    expect(normal).toBeCloseTo(VARKHUL_ASSEMBLY_RUNE_SPEED_NORMAL * 0.5, 5);
    expect(heroic).toBeCloseTo(VARKHUL_ASSEMBLY_RUNE_SPEED_HEROIC * 0.5, 5);
    expect(normal).toBeCloseTo(heroic * 2, 10);
  });

  it('makes the short route viable across two waves while the wrong Heroic route consumes the clock', () => {
    for (let symbol = 0; symbol < VARKHUL_ASSEMBLY_RUNE_COUNT; symbol++) {
      const target = varkhulAssemblyRuneTargetAngle(902, symbol, 2);
      const start = varkhulAssemblyRuneStartAngle(902, symbol, 2);
      const best = varkhulAssemblyBestRuneControl(start, target);
      const wrong = best === 'clockwise' ? 'counterclockwise' : 'clockwise';

      expect(varkhulAssemblyStepRune(start, best, 'normal', 6, target)).toBe(target);
      expect(varkhulAssemblyStepRune(start, wrong, 'normal', 6, target)).not.toBe(target);
      expect(varkhulAssemblyStepRune(start, best, 'heroic', 12, target)).toBe(target);
      expect(varkhulAssemblyStepRune(start, wrong, 'heroic', 28, target)).not.toBe(target);
    }
  });

  it('keeps every Heroic reshuffle solvable after the center teleport', () => {
    const roomCenter = { x: 0, z: 0 };
    const playerMoveSpeed = 7;
    const teleportRadius = 3;
    let worstBudget = { bossId: 0, layoutKey: 0, seconds: 0 };

    for (let bossId = 1; bossId <= 10_000; bossId++) {
      for (let layoutKey = 0; layoutKey < 10; layoutKey++) {
        const slots = varkhulAssemblyRuneSlots('heroic', layoutKey);
        let totalSeconds = 0;
        for (let wave = 0; wave < 2; wave++) {
          let slowestRuneSeconds = 0;
          for (let symbol = 0; symbol < VARKHUL_ASSEMBLY_RUNE_COUNT; symbol++) {
            if (varkhulAssemblyRuneWave(symbol, 2) !== wave) continue;
            const station = varkhulAssemblyRuneStation(roomCenter, slots[symbol]);
            const approachAngle = Math.atan2(station.x - roomCenter.x, station.z - roomCenter.z);
            const teleport = {
              x: roomCenter.x + Math.sin(approachAngle) * teleportRadius,
              z: roomCenter.z + Math.cos(approachAngle) * teleportRadius,
            };
            const sequenceKey = layoutKey * 2 + wave;
            const start = varkhulAssemblyRuneStartAngle(bossId, symbol, sequenceKey);
            const target = varkhulAssemblyRuneTargetAngle(bossId, symbol, sequenceKey);
            const control = varkhulAssemblyBestRuneControl(start, target);
            const pad = varkhulAssemblyRuneControlPosition(
              station,
              station.trackRadius,
              start,
              control,
            );
            const walkTicks = Math.ceil(
              Math.max(
                0,
                Math.hypot(pad.x - teleport.x, pad.z - teleport.z) -
                  VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS,
              ) /
                playerMoveSpeed /
                0.05,
            );
            const shortRoute = Math.abs(
              Math.atan2(Math.sin(start - target), Math.cos(start - target)),
            );
            const rotationTicks = Math.ceil(
              Math.max(0, shortRoute - VARKHUL_ASSEMBLY_RUNE_ALIGNMENT_RADIANS) /
                VARKHUL_ASSEMBLY_RUNE_SPEED_HEROIC /
                0.05,
            );
            slowestRuneSeconds = Math.max(
              slowestRuneSeconds,
              walkTicks * 0.05 +
                VARKHUL_ASSEMBLY_RUNE_CONTROL_ARM_SECONDS +
                rotationTicks * 0.05 +
                VARKHUL_ASSEMBLY_RUNE_LOCK_HOLD_SECONDS,
            );
          }
          totalSeconds += slowestRuneSeconds;
        }
        if (totalSeconds > worstBudget.seconds) {
          worstBudget = { bossId, layoutKey, seconds: totalSeconds };
        }
      }
    }

    expect(worstBudget.seconds).toBeGreaterThan(26);
    expect(worstBudget.seconds).toBeLessThanOrEqual(27);
    expect(worstBudget.seconds).toBeLessThan(varkhulAssemblyRuneSeconds('heroic'));
  });

  it('always resolves the timed interface against the number of assigned runes', () => {
    expect(varkhulAssemblyRuneOutcome(10)).toBe('full');
    expect(varkhulAssemblyRuneOutcome(9)).toBe('partial');
    expect(varkhulAssemblyRuneOutcome(6)).toBe('partial');
    expect(varkhulAssemblyRuneOutcome(5)).toBe('failed');
  });

  it('uses two ordered waves and guarantees Heroic wave two a practical time floor', () => {
    expect(varkhulAssemblyRounds('normal')).toBe(2);
    expect(varkhulAssemblyRounds('heroic')).toBe(2);
    expect(varkhulAssemblyRuneSeconds('normal')).toBe(25);
    expect(varkhulAssemblyRuneSeconds('heroic')).toBe(30);
    expect(VARKHUL_ASSEMBLY_RUNE_SECOND_WAVE_MIN_SECONDS_HEROIC).toBe(20);
    expect(varkhulAssemblyRuneRemainingAfterWaveAdvance('heroic', 12.4)).toBe(20);
    expect(varkhulAssemblyRuneRemainingAfterWaveAdvance('heroic', 23.4)).toBe(23.4);
    expect(varkhulAssemblyRuneRemainingAfterWaveAdvance('normal', 12.4)).toBe(12.4);
    expect(Array.from({ length: 10 }, (_, symbol) => varkhulAssemblyRuneWave(symbol, 2))).toEqual([
      0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
    ]);
  });

  it('sends more reusable crossing fireballs through the Heroic rune phase', () => {
    const forge = { x: 20, z: 40 };
    const normal = varkhulAssemblyFireballPattern(forge, 'normal', 0, 2);
    const heroic = varkhulAssemblyFireballPattern(forge, 'heroic', 0, 2);
    expect(normal).toHaveLength(3);
    expect(heroic).toHaveLength(5);
    for (const fireball of heroic) {
      expect(Math.hypot(fireball.x - forge.x, fireball.z - forge.z)).toBeCloseTo(31, 5);
      expect(Math.hypot(fireball.dirX, fireball.dirZ)).toBeCloseTo(1, 5);
      expect(
        (fireball.x - forge.x) * fireball.dirX + (fireball.z - forge.z) * fireball.dirZ,
      ).toBeLessThan(0);
    }
  });
});
