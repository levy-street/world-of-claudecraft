import { describe, expect, it } from 'vitest';
import {
  biomePrecipitation,
  createAmbienceState,
  sampleAmbienceInto,
} from '../src/render/ambience_state_core';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import { groundHeight, waterLevelAt, zoneBiomeAt } from '../src/sim/world';

describe('ambience_state_core', () => {
  it('maps each weathered biome to its precipitation', () => {
    expect(biomePrecipitation('peaks', false, true)).toBe('snow');
    expect(biomePrecipitation('frost', false, true)).toBe('snow');
    expect(biomePrecipitation('marsh', false, true)).toBe('rain');
    expect(biomePrecipitation('haunt', false, true)).toBe('rain');
    expect(biomePrecipitation('forest' as never, false, true)).toBeNull();
  });

  it('no precipitation with weather off or inside an instance', () => {
    expect(biomePrecipitation('peaks', false, false)).toBeNull();
    expect(biomePrecipitation('marsh', true, true)).toBeNull();
  });

  it('samples the same state the inline renderer code computed', () => {
    const seed = 1234;
    const out = createAmbienceState();
    for (const [x, z] of [
      [0, 0],
      [-281, 40],
      [150, -320],
      [DUNGEON_X_THRESHOLD + 50, 10],
    ]) {
      const s = sampleAmbienceInto(out, x, z, seed, true);
      expect(s).toBe(out); // refilled in place, no per-frame allocation
      const inDungeon = x > DUNGEON_X_THRESHOLD;
      expect(s.inDungeon).toBe(inDungeon);
      expect(s.biome).toBe(zoneBiomeAt(x, z));
      expect(s.precip).toBe(biomePrecipitation(s.biome, inDungeon, true));
      expect(s.nearWater).toBe(
        !inDungeon && groundHeight(x, z, seed) < waterLevelAt(x, z, seed) + 0.4,
      );
    }
  });

  it('never reports water inside an instance', () => {
    const s = sampleAmbienceInto(createAmbienceState(), DUNGEON_X_THRESHOLD + 5, 0, 1, true);
    expect(s.inDungeon).toBe(true);
    expect(s.nearWater).toBe(false);
  });
});
