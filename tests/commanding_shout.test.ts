import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';

// Bolstering Cry (commanding_shout) was RETIRED from the warrior kit 2026-07-08
// (owner decision: too many warrior shouts). Its ABILITIES def is kept dormant
// like rend (Deep Gash), but no warrior learns it under any spec or level.
const specMods = (spec: string | null) =>
  computeTalentModifiers('warrior', { ...emptyAllocation(), spec: spec ?? null });

describe('Commanding Shout (retired from the kit)', () => {
  it('keeps its dormant def: a free physical stamina self-buff still tagged prot', () => {
    const def = ABILITIES['commanding_shout'];
    expect(def).toBeTruthy();
    expect(def.class).toBe('warrior');
    expect(def.school).toBe('physical');
    expect(def.cost).toBe(0);
    expect(def.specs).toEqual(['prot']);
    expect(def.exclusiveGroup).toBeUndefined();
    expect(def.effects).toEqual([{ type: 'selfBuff', kind: 'buff_sta', value: 6, duration: 3600 }]);
  });

  it('is no longer learnable by any warrior spec at any level (removed from every kit list)', () => {
    for (const spec of [null, 'arms', 'fury', 'prot']) {
      const ids = abilitiesKnownAt('warrior', 20, specMods(spec)).map((k) => k.def.id);
      expect(ids, spec ?? 'no-spec').not.toContain('commanding_shout');
    }
  });
});
