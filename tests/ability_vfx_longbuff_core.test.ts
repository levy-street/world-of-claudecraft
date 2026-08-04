// The long-buff VFX policy (maintainer ruling 2026-08-04): a buff worn for
// LONG_BUFF_VFX_SECONDS or more communicates nothing actionable, so it must be
// SILENT while held: no orbit band, no ground disc, no held shell. Cast-moment
// feedback (swirl, shell flash, linger) stays. The threshold is safe because
// the content has a natural gap: every buff is either <= 60s or >= 300s.
// Forms and stealth (buff style morph/veil) are identity states and keep their
// reads; an authored buff.persist opt-in is the one escape hatch.
import { describe, expect, it } from 'vitest';
import type { AbilityVfxFullSpec } from '../src/render/ability_vfx_core';
import { ABILITY_VFX_FULL_SPECS } from '../src/render/ability_vfx_full_specs';
import {
  buffAuraDurationSec,
  holdsBuffVfxWhileWorn,
  LONG_BUFF_VFX_SECONDS,
} from '../src/render/ability_vfx_longbuff_core';
import { ABILITY_VFX_SPECS } from '../src/render/ability_vfx_specs';
import { ABILITIES } from '../src/sim/data';

describe('buffAuraDurationSec', () => {
  it('reads the max aura duration from the ability content', () => {
    // 30 min party stat buff (buffTarget) and the aoeAlly suffix family.
    expect(buffAuraDurationSec('arcane_intellect')).toBe(1800);
    expect(buffAuraDurationSec('trueshot_aura')).toBe(1800);
    // 60s absorb, ranked: every rank row stays 60.
    expect(buffAuraDurationSec('ice_barrier')).toBe(60);
  });

  it('returns 0 for an unknown ability or one that grants no aura', () => {
    expect(buffAuraDurationSec('no_such_ability')).toBe(0);
    expect(buffAuraDurationSec('sinister_strike')).toBe(0);
  });
});

describe('holdsBuffVfxWhileWorn', () => {
  const full = (id: string): AbilityVfxFullSpec | undefined => ABILITY_VFX_FULL_SPECS[id];

  it('silences long stat buffs while worn', () => {
    expect(holdsBuffVfxWhileWorn('arcane_intellect', full('arcane_intellect'))).toBe(false);
    expect(holdsBuffVfxWhileWorn('power_word_fortitude', full('power_word_fortitude'))).toBe(false);
    expect(holdsBuffVfxWhileWorn('lightning_shield', full('lightning_shield'))).toBe(false);
    expect(holdsBuffVfxWhileWorn('instant_poison', full('instant_poison'))).toBe(false);
  });

  it('keeps every buff under the threshold', () => {
    expect(holdsBuffVfxWhileWorn('ice_barrier', full('ice_barrier'))).toBe(true);
    expect(holdsBuffVfxWhileWorn('presence_of_mind', full('presence_of_mind'))).toBe(true);
    expect(holdsBuffVfxWhileWorn('evasion', full('evasion'))).toBe(true);
    expect(holdsBuffVfxWhileWorn('no_such_ability', undefined)).toBe(true);
  });

  it('exempts identity states: morph forms and veils hold their reads at any duration', () => {
    expect(holdsBuffVfxWhileWorn('shadowform', full('shadowform'))).toBe(true);
    expect(holdsBuffVfxWhileWorn('bear_form', full('bear_form'))).toBe(true);
    expect(holdsBuffVfxWhileWorn('stealth', full('stealth'))).toBe(true);
  });

  it('honors the authored persist opt-in on a long buff', () => {
    const persisted: AbilityVfxFullSpec = {
      archetype: 'buff',
      palette: 'arcane',
      buff: { style: 'raise', orbit: 'halo', persist: true },
    };
    expect(holdsBuffVfxWhileWorn('arcane_intellect', persisted)).toBe(true);
  });

  // The forward-looking rule: this pin sweeps EVERY authored spec against the
  // live ability content. A future long-duration buff that authors held-read
  // DNA lands in the computed set and fails here until its author either keeps
  // the default (acknowledge the silence by adding the id below), shortens the
  // buff, or opts out explicitly (buff.persist / morph / veil).
  it('pins the exact set of silenced long-buff specs', () => {
    const ids = new Set([
      ...Object.keys(ABILITY_VFX_SPECS),
      ...Object.keys(ABILITY_VFX_FULL_SPECS),
    ]);
    const silenced: string[] = [];
    for (const id of ids) {
      const f = ABILITY_VFX_FULL_SPECS[id];
      const spec = ABILITY_VFX_SPECS[id];
      const heldDna =
        f?.buff !== undefined ||
        f?.archetype === 'buff' ||
        f?.barrier === true ||
        f?.debuff?.orbit !== undefined ||
        spec?.bo !== undefined;
      if (!heldDna) continue;
      if (!holdsBuffVfxWhileWorn(id, f)) silenced.push(id);
    }
    // Note: the three warrior stances are pinned here at the policy level but
    // already paint nothing at runtime (isPassiveAura drops them before the
    // gate); the pin is over authored specs, not painter consequences.
    expect(silenced.sort()).toEqual([
      'arcane_intellect',
      'aspect_of_the_cheetah',
      'aspect_of_the_hawk',
      'aspect_of_the_monkey',
      'aspect_of_the_wild',
      'battle_shout',
      'battle_stance',
      'berserker_stance',
      'blessing_of_might',
      'deadly_poison',
      'defensive_stance',
      'demon_skin',
      'devotion_aura',
      'flametongue_weapon',
      'frost_armor',
      'frostbrand_weapon',
      'instant_poison',
      'lightning_shield',
      'mark_of_the_wild',
      'power_word_fortitude',
      'retribution_aura',
      'righteous_fury',
      'rockbiter_weapon',
      'thorns',
      'trueshot_aura',
    ]);
  });

  it('pins the threshold', () => {
    expect(LONG_BUFF_VFX_SECONDS).toBe(300);
  });

  // The threshold's whole safety argument: no buff aura is authored strictly
  // between the short-buff ceiling (60s) and the threshold, so 300s cannot
  // misclassify. A future 61..299s buff fails here and forces the author to
  // decide which side of the policy it belongs on.
  it('verifies the natural content gap: no buff aura sits in 61..299s', () => {
    const inGap: string[] = [];
    for (const id of Object.keys(ABILITIES)) {
      const d = buffAuraDurationSec(id);
      if (d > 60 && d < LONG_BUFF_VFX_SECONDS) inGap.push(`${id}:${d}`);
    }
    expect(inGap).toEqual([]);
  });
});
