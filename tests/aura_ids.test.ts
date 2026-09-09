// The one place a helpful effect's aura id comes from (src/sim/combat/aura_ids.ts).
//
// The dispatcher used to spell these rules inline; they moved out so the HUD's
// aura-track catalog could compute the same ids from the content. Each rule is
// pinned on the literal it produces, with the content case that motivated it,
// so a change here has to be argued on both sides at once.

import { describe, expect, it } from 'vitest';
import { absorbAuraId, buffTargetAuraId, selfBuffAuraId } from '../src/sim/combat/aura_ids';
import { ABILITIES } from '../src/sim/data';
import type { AbilityDef } from '../src/sim/types';

const abilities = ABILITIES as Record<string, AbilityDef>;

describe('selfBuffAuraId', () => {
  it('keeps the bare ability id for the primary self-buff and suffixes companions by kind', () => {
    // Arcane Power: spell damage AND haste. The first selfBuff kind on the def is
    // the primary; the second must not collide with it, or applyAura's
    // (id, sourceId) dedup would evict one.
    const arcanePower = abilities.arcane_power;
    expect(arcanePower).toBeDefined();
    expect(selfBuffAuraId(arcanePower, { kind: 'buff_spelldmg' })).toBe('arcane_power');
    expect(selfBuffAuraId(arcanePower, { kind: 'buff_spellhaste' })).toBe(
      'arcane_power_buff_spellhaste',
    );
  });

  it('lets an explicit auraId win over both arms', () => {
    // Raised Guard's mitigation lands as raised_guard_dr even though it is the
    // primary (and only) self-buff.
    const raisedGuard = abilities.raised_guard;
    expect(raisedGuard).toBeDefined();
    expect(selfBuffAuraId(raisedGuard, { kind: 'buff_dr_phys', auraId: 'raised_guard_dr' })).toBe(
      'raised_guard_dr',
    );
    // Synthetic: an auraId on a companion also wins over the kind suffix.
    const ability = {
      id: 'x',
      effects: [{ type: 'selfBuff', kind: 'a' }] as unknown as AbilityDef['effects'],
    };
    expect(selfBuffAuraId(ability, { kind: 'b', auraId: 'named' })).toBe('named');
    expect(selfBuffAuraId(ability, { kind: 'b' })).toBe('x_b');
    expect(selfBuffAuraId(ability, { kind: 'a' })).toBe('x');
  });
});

describe('absorbAuraId', () => {
  it('suffixes an absorb that rides beside a stasis self-buff, and only then', () => {
    const stasis = {
      id: 'ice_block',
      effects: [{ type: 'selfBuff', kind: 'stasis' }] as unknown as AbilityDef['effects'],
    };
    const plain = {
      id: 'power_word_shield',
      effects: [] as unknown as AbilityDef['effects'],
    };
    expect(absorbAuraId(stasis, {})).toBe('ice_block_absorb');
    expect(absorbAuraId(plain, {})).toBe('power_word_shield');
  });

  it('lets an explicit auraId win', () => {
    // Hallowed Wall: a block self-buff plus an absorb named holy_shield_absorb.
    const holyShield = abilities.holy_shield;
    expect(holyShield).toBeDefined();
    expect(absorbAuraId(holyShield, { auraId: 'holy_shield_absorb' })).toBe('holy_shield_absorb');
  });
});

describe('buffTargetAuraId', () => {
  it('keeps the bare id for the first buffTarget of a cast and positions the rest', () => {
    const ability = { id: 'bless' };
    expect(buffTargetAuraId(ability, { kind: 'buff_ap' }, 0)).toBe('bless');
    expect(buffTargetAuraId(ability, { kind: 'buff_armor' }, 1)).toBe('bless_buff_armor_1');
    expect(buffTargetAuraId(ability, { kind: 'buff_armor' }, 2)).toBe('bless_buff_armor_2');
  });
});
