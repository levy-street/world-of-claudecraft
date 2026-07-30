import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type AuraSigilState,
  SIGIL_AURA_IDS,
  auraSigilStateForAuras,
} from '../src/render/aura_sigil_visual';

// The derivation half of the aura sigil. The THREE.js half needs a GL context, so
// what is pinned here is the part that decides WHETHER a sigil shows and in what
// colour — including the rule that only the caster is marked, and the guard that
// keeps the render-side id set from drifting away from the sim's exclusive groups.

const CASTER = 7;

function aura(id: string, school: string, sourceId = CASTER) {
  return { id, school, sourceId };
}

describe('auraSigilStateForAuras', () => {
  it('marks the caster of a paladin aura with a holy sigil', () => {
    expect(auraSigilStateForAuras(CASTER, [aura('devotion_aura', 'holy')])).toEqual({
      id: 'devotion_aura',
      school: 'holy',
    });
  });

  it('does NOT mark a party member carrying someone else s aura', () => {
    // Steadfast Aura and Iron Bellow are party buffs: every member carries the
    // aura, but only the paladin standing at its centre wears the ring.
    const buffed = auraSigilStateForAuras(99, [aura('devotion_aura', 'holy', CASTER)]);
    expect(buffed).toBeNull();
  });

  it('colours each exclusive family from the aura s own school', () => {
    expect(auraSigilStateForAuras(CASTER, [aura('battle_stance', 'physical')])?.school).toBe(
      'physical',
    );
    expect(auraSigilStateForAuras(CASTER, [aura('battle_shout', 'physical')])?.school).toBe(
      'physical',
    );
    expect(auraSigilStateForAuras(CASTER, [aura('aspect_of_the_hawk', 'nature')])?.school).toBe(
      'nature',
    );
    expect(auraSigilStateForAuras(CASTER, [aura('retribution_aura', 'holy')])?.school).toBe('holy');
  });

  it('ignores auras outside the sigil set', () => {
    expect(auraSigilStateForAuras(CASTER, [aura('rend', 'physical')])).toBeNull();
    expect(auraSigilStateForAuras(CASTER, [])).toBeNull();
  });

  it('ignores a sigil aura whose school it cannot paint', () => {
    expect(auraSigilStateForAuras(CASTER, [aura('battle_stance', 'chaos')])).toBeNull();
  });

  it('takes the first matching aura when several are present', () => {
    // The sim's exclusiveGroup rule means this should not happen within one
    // family, but a paladin in a stance-like state must still resolve to one.
    const state = auraSigilStateForAuras(CASTER, [
      aura('battle_stance', 'physical'),
      aura('devotion_aura', 'holy'),
    ]);
    expect(state?.id).toBe('battle_stance');
  });

  it('reuses the caller s scratch object instead of allocating', () => {
    const scratch: AuraSigilState = { id: '', school: 'holy' };
    const first = auraSigilStateForAuras(CASTER, [aura('devotion_aura', 'holy')], scratch);
    const second = auraSigilStateForAuras(CASTER, [aura('battle_stance', 'physical')], scratch);
    expect(first).toBe(scratch);
    expect(second).toBe(scratch);
    expect(scratch.id).toBe('battle_stance');
    expect(scratch.school).toBe('physical');
  });
});

describe('SIGIL_AURA_IDS', () => {
  it('matches every exclusiveGroup self-buff in the sim, exactly', () => {
    // The renderer may not value-import from src/sim (tests/architecture.test.ts),
    // so the id set is a literal. This reads the sim's own source and fails the
    // moment a new stance/aura/aspect is added without a sigil, or one is removed.
    const src = readFileSync(join(__dirname, '../src/sim/content/classes.ts'), 'utf8');
    const starts: Array<[string, number]> = [];
    const re = /^ {2}([a-z0-9_]+): \{/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) starts.push([m[1], m.index]);

    const withGroup = new Set<string>();
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1][1] : src.length;
      const body = src.slice(starts[i][1], end);
      if (/\n {4}exclusiveGroup: '/.test(body)) withGroup.add(starts[i][0]);
    }

    expect(withGroup.size).toBeGreaterThan(0);
    expect([...withGroup].sort()).toEqual([...SIGIL_AURA_IDS].sort());
  });
});
