// GUILD_TREND_LETTERS content completeness pins. Split from
// tests/professions_trend.test.ts along describe boundaries for CI shard
// balance (a pure move).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUILD_TREND_LETTERS } from '../src/sim/content/letters';
import { ARCHETYPE_PAIR_TARGETS } from '../src/sim/professions/archetype';

describe('GUILD_TREND_LETTERS content pins', () => {
  it('covers all ten pair ids with unique, scheme-following letter ids', () => {
    expect(Object.keys(GUILD_TREND_LETTERS).sort()).toEqual([...ARCHETYPE_PAIR_TARGETS].sort());
    const ids = ARCHETYPE_PAIR_TARGETS.map((pairId) => GUILD_TREND_LETTERS[pairId]?.letterId);
    expect(new Set(ids).size).toBe(ARCHETYPE_PAIR_TARGETS.length);
    for (const pairId of ARCHETYPE_PAIR_TARGETS) {
      expect(GUILD_TREND_LETTERS[pairId]?.letterId).toBe(`guild_trend_${pairId.replace('+', '_')}`);
    }
  });

  it('every letter body names Haldren', () => {
    for (const pairId of ARCHETYPE_PAIR_TARGETS) {
      const body = GUILD_TREND_LETTERS[pairId]?.body ?? '';
      expect(body.includes('Haldren'), `${pairId}: body should name Haldren`).toBe(true);
    }
  });

  it('every letter id is registered in the LETTER_IDS table of world_entity_i18n.ts', () => {
    // LETTER_IDS is a module-private const, so pin it by source scan (the
    // localization_coverage precedent for reading this file by path).
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/world_entity_i18n.ts'), 'utf8');
    const start = src.indexOf('const LETTER_IDS = [');
    expect(start, 'the LETTER_IDS declaration should exist').toBeGreaterThan(-1);
    const end = src.indexOf(']', start);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    for (const pairId of ARCHETYPE_PAIR_TARGETS) {
      const letterId = `guild_trend_${pairId.replace('+', '_')}`;
      expect(
        block.includes(`'${letterId}'`),
        `${letterId} missing from LETTER_IDS in src/ui/world_entity_i18n.ts`,
      ).toBe(true);
    }
  });
});
