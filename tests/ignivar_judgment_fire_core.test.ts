import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_JUDGMENT_FIRE_HIGH_INITIAL_COUNT,
  IGNIVAR_JUDGMENT_FIRE_LOW_INITIAL_COUNT,
  IGNIVAR_JUDGMENT_FIRE_SAFE_PADDING,
  ignivarJudgmentFireAllowsSmoke,
  ignivarJudgmentFireInitialCount,
  ignivarJudgmentFireRate,
  writeIgnivarJudgmentFireSample,
} from '../src/render/ignivar_judgment_fire_core';
import {
  IGNIVAR_JUDGMENT_ARENA_RADIUS,
  IGNIVAR_JUDGMENT_SHELTER_RADIUS,
} from '../src/sim/ignivar_forge_judgment';

describe('Ignivar Judgment ground fire field', () => {
  it('keeps every deterministic flame inside the arena and visibly outside the safe refuge', () => {
    expect(IGNIVAR_JUDGMENT_FIRE_SAFE_PADDING).toBe(1.35);
    const safe = { x: 13.25, z: -8.5 };
    const sample = { x: 0, z: 0 };
    const firstRun: Array<[number, number]> = [];
    for (let serial = 0; serial < 4096; serial++) {
      expect(writeIgnivarJudgmentFireSample(serial, safe.x, safe.z, sample)).toBe(true);
      expect(Math.hypot(sample.x, sample.z)).toBeLessThan(IGNIVAR_JUDGMENT_ARENA_RADIUS);
      expect(Math.hypot(sample.x - safe.x, sample.z - safe.z)).toBeGreaterThanOrEqual(
        IGNIVAR_JUDGMENT_SHELTER_RADIUS + IGNIVAR_JUDGMENT_FIRE_SAFE_PADDING,
      );
      if (serial < 32) firstRun.push([sample.x, sample.z]);
    }

    const replay = { x: 0, z: 0 };
    expect(
      firstRun.map((_, serial) => {
        writeIgnivarJudgmentFireSample(serial, safe.x, safe.z, replay);
        return [replay.x, replay.z];
      }),
    ).toEqual(firstRun);
  });

  it('pins bounded monotone density and sheds only cosmetic smoke at low quality', () => {
    expect(IGNIVAR_JUDGMENT_FIRE_LOW_INITIAL_COUNT).toBe(136);
    expect(IGNIVAR_JUDGMENT_FIRE_HIGH_INITIAL_COUNT).toBe(288);
    expect(ignivarJudgmentFireInitialCount(0)).toBe(136);
    expect(ignivarJudgmentFireInitialCount(1)).toBe(288);
    expect(ignivarJudgmentFireInitialCount(0)).toBeLessThan(ignivarJudgmentFireInitialCount(0.5));
    expect(ignivarJudgmentFireInitialCount(0.5)).toBeLessThan(ignivarJudgmentFireInitialCount(1));
    expect(ignivarJudgmentFireRate(0)).toBe(110);
    expect(ignivarJudgmentFireRate(1)).toBe(230);
    expect(ignivarJudgmentFireAllowsSmoke(0)).toBe(false);
    expect(ignivarJudgmentFireAllowsSmoke(0.66)).toBe(false);
    expect(ignivarJudgmentFireAllowsSmoke(0.67)).toBe(true);
  });
});
