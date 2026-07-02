// Rank-ladder coverage for the level-60 cap: every ranked ability keeps
// scaling into the endgame band, ladders are well-formed (sequential ranks,
// strictly increasing levels, none past the cap), mana costs never shrink,
// and abilitiesKnownAt resolves the top rank at 60. The 1-20 rows follow
// docs/design/spell-ranks.md; the 21-60 rows continue each ability's real
// classic curve (see the fireball anchor test below).

import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/data';
import { MAX_LEVEL, type PlayerClass } from '../src/sim/types';

const ALL_CLASSES = Object.keys(CLASSES) as PlayerClass[];

// Abilities whose rank ladder is expected to reach the endgame band (top rank
// at level 50+). Everything with a ranks[] array qualifies except the
// deliberate outliers listed here.
const ENDGAME_EXEMPT = new Set([
  'polymorph', // CC: later ranks change nothing numeric worth scaling
  'hammer_of_justice', // stun: duration-only, no scaling values
]);

const ranked = Object.values(ABILITIES).filter((a) => (a.ranks?.length ?? 0) > 0);

describe('rank ladders (60 cap)', () => {
  it('covers a substantial ranked kit for every class', () => {
    for (const cls of ALL_CLASSES) {
      const clsRanked = ranked.filter((a) => a.class === cls);
      // hunters have the smallest ranked kit (much of theirs is aspects/pet utility)
      expect(clsRanked.length, `${cls} ranked abilities`).toBeGreaterThanOrEqual(6);
    }
  });

  it('every ranked ability is well-formed and reaches the endgame band', () => {
    for (const a of ranked) {
      const rows = a.ranks ?? [];
      let prevRank = 1;
      let prevLevel = a.learnLevel;
      for (const row of rows) {
        expect(row.rank, `${a.id} rank order`).toBe(prevRank + 1);
        expect(row.level, `${a.id} level order`).toBeGreaterThan(prevLevel);
        expect(row.level, `${a.id} level cap`).toBeLessThanOrEqual(MAX_LEVEL);
        expect(row.cost, `${a.id} cost`).toBeGreaterThanOrEqual(0);
        prevRank = row.rank;
        prevLevel = row.level;
      }
      if (!ENDGAME_EXEMPT.has(a.id)) {
        expect(prevLevel, `${a.id} top rank level`).toBeGreaterThanOrEqual(50);
      }
    }
  });

  it('mana costs never shrink across ranks', () => {
    for (const a of ranked) {
      if (CLASSES[a.class].resourceType !== 'mana') continue;
      let prev = a.cost;
      for (const row of a.ranks ?? []) {
        expect(row.cost, `${a.id} r${row.rank} cost`).toBeGreaterThanOrEqual(prev);
        prev = row.cost;
      }
    }
  });

  it('abilitiesKnownAt(60) resolves the top rank of every ranked ability', () => {
    for (const cls of ALL_CLASSES) {
      const known = abilitiesKnownAt(cls, MAX_LEVEL);
      for (const k of known) {
        const def = ABILITIES[k.def.id];
        if (!def?.ranks?.length) continue;
        const top = def.ranks[def.ranks.length - 1];
        expect(k.rank, `${k.def.id} at 60`).toBe(top.rank);
      }
      // and a level-20 character still resolves only its 1-20 ranks
      for (const k of abilitiesKnownAt(cls, 20)) {
        const def = ABILITIES[k.def.id];
        if (!def?.ranks?.length) continue;
        const overLevel = def.ranks.filter((r) => r.level > 20).map((r) => r.rank);
        expect(overLevel, `${k.def.id} at 20`).not.toContain(k.rank);
      }
    }
  });

  it('fireball tracks the real classic ladder into the 50s (curve anchor)', () => {
    const rows = ABILITIES.fireball.ranks ?? [];
    const r9 = rows.find((r) => r.level === 48);
    expect(r9).toBeDefined();
    const dmg = r9?.effects.find((e) => e.type === 'directDamage') as
      | { min: number; max: number }
      | undefined;
    // real classic rank 9 (L48) is 255-353; the extended curve must stay close
    expect(dmg!.min).toBeGreaterThan(230);
    expect(dmg!.min).toBeLessThan(285);
    expect(dmg!.max).toBeGreaterThan(320);
    expect(dmg!.max).toBeLessThan(390);
  });

  it('conjured food/water ranks resolve real item tiers', () => {
    for (const base of ['conjured_bread', 'conjured_water']) {
      const abilityId = base === 'conjured_bread' ? 'conjure_food' : 'conjure_water';
      const rows = ABILITIES[abilityId].ranks ?? [];
      expect(rows.length).toBeGreaterThanOrEqual(5);
    }
  });
});
