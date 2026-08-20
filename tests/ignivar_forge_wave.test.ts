import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS,
  IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE,
  IGNIVAR_FORGE_WAVE_RANGE,
  ignivarForgeWaveRadius,
  ignivarPointInForgeWaveGap,
  ignivarPointSweptByForgeWave,
} from '../src/sim/ignivar_forge_wave';

describe('Ignivar Forge Wave geometry', () => {
  it('expands linearly from the boss to the arena edge', () => {
    expect(IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS).toBe(3);
    expect(IGNIVAR_FORGE_WAVE_RANGE).toBe(72);
    expect(ignivarForgeWaveRadius(IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS)).toBe(0);
    expect(ignivarForgeWaveRadius(IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS / 2)).toBe(36);
    expect(ignivarForgeWaveRadius(0)).toBe(72);
  });

  it('cuts two opposite safe gaps out of the expanding fire wall', () => {
    const origin = { x: 4, z: -3 };
    const facing = Math.PI / 4;
    const pointAt = (angle: number, radius: number) => ({
      x: origin.x + Math.sin(angle) * radius,
      z: origin.z + Math.cos(angle) * radius,
    });

    expect(IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE).toBe(Math.PI / 12);
    expect(ignivarPointInForgeWaveGap(origin, facing, pointAt(facing, 10))).toBe(true);
    expect(ignivarPointInForgeWaveGap(origin, facing, pointAt(facing + Math.PI, 10))).toBe(true);
    expect(ignivarPointInForgeWaveGap(origin, facing, pointAt(facing + Math.PI / 2, 10))).toBe(
      false,
    );
    expect(
      ignivarPointInForgeWaveGap(
        origin,
        facing,
        pointAt(facing + IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE, 10),
      ),
    ).toBe(true);
    expect(
      ignivarPointInForgeWaveGap(
        origin,
        facing,
        pointAt(facing + IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE + 1e-4, 10),
      ),
    ).toBe(false);
    expect(ignivarPointSweptByForgeWave(origin, facing, 9, 10, pointAt(facing, 10))).toBe(false);
    expect(
      ignivarPointSweptByForgeWave(origin, facing, 9, 10, pointAt(facing + Math.PI / 2, 10)),
    ).toBe(true);
    expect(
      ignivarPointSweptByForgeWave(origin, facing, 9, 10, pointAt(facing + Math.PI / 2, 14)),
    ).toBe(false);
    expect(
      ignivarPointSweptByForgeWave(origin, facing, 9, 10, pointAt(facing + Math.PI / 2, 8.25)),
    ).toBe(true);
    expect(
      ignivarPointSweptByForgeWave(origin, facing, 9, 10, pointAt(facing + Math.PI / 2, 10.75)),
    ).toBe(true);
    expect(
      ignivarPointSweptByForgeWave(origin, facing, 9, 10, pointAt(facing + Math.PI / 2, 8.249)),
    ).toBe(false);
    expect(
      ignivarPointSweptByForgeWave(origin, facing, 9, 10, pointAt(facing + Math.PI / 2, 10.751)),
    ).toBe(false);
  });
});
