import { describe, expect, it } from 'vitest';
import {
  gearedArrivalBotFixture,
  gearedArrivalFixtureManifest,
  gearedArrivalFixtureSha256,
} from '../scripts/profiler/geared_arrival_fixture.mjs';
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../src/render/characters/modular';
import { sanitizeAppearance } from '../src/world_api/appearance';

describe('geared arrival fixture', () => {
  it('is deterministic and gives every bot a complete authored look', () => {
    const left = gearedArrivalFixtureManifest(20);
    const right = gearedArrivalFixtureManifest(20);
    expect(left).toEqual(right);
    expect(gearedArrivalFixtureSha256(20)).toBe(
      '668d677b4d65f78e97c374b03b740a3ba6c885e49852b144369f5f7f3cab5c4f',
    );
    for (const bot of left) {
      expect(sanitizeAppearance(bot.appearance)).toEqual(bot.appearance);
      expect(Object.keys(bot.appearance).sort()).toEqual(Object.keys(DEFAULT_APPEARANCE).sort());
    }
  });

  it('uses real renderer ids instead of values that silently clamp to defaults', () => {
    for (const bot of gearedArrivalFixtureManifest(20)) {
      expect(normalizeAppearance(bot.appearance)).toEqual(bot.appearance);
    }
  });

  it('varies geometry, morphs, materials, colours, weapons and helmet state', () => {
    const fixture = gearedArrivalFixtureManifest(20);
    const unique = (value) => new Set(fixture.map(value)).size;
    expect(unique((bot) => bot.appearance.gender)).toBe(2);
    expect(unique((bot) => bot.appearance.hair)).toBeGreaterThanOrEqual(15);
    expect(unique((bot) => bot.appearance.eyeShape)).toBeGreaterThanOrEqual(8);
    expect(unique((bot) => bot.appearance.outfit)).toBeGreaterThanOrEqual(15);
    expect(unique((bot) => JSON.stringify(bot.appearance.face))).toBe(20);
    expect(unique((bot) => JSON.stringify(bot.appearance.body))).toBe(20);
    expect(unique((bot) => bot.skin)).toBe(20);
    expect(unique((bot) => bot.weapon)).toBe(5);
    expect(unique((bot) => bot.helmHidden)).toBe(2);
  });

  it('rejects invalid manifest cardinalities', () => {
    expect(() => gearedArrivalFixtureManifest(-1)).toThrow(/non-negative/);
    expect(() => gearedArrivalFixtureManifest(1.5)).toThrow(/non-negative/);
  });

  it('returns independent documents so one bot cannot mutate another fixture leg', () => {
    const first = gearedArrivalBotFixture(3);
    const second = gearedArrivalBotFixture(3);
    first.appearance.face.jaw = 99;
    first.skins.push('mutated');
    expect(second.appearance.face.jaw).not.toBe(99);
    expect(second.skins).not.toContain('mutated');
  });
});
