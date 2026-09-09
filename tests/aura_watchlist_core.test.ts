import { describe, expect, it } from 'vitest';
import { isToggleAura } from '../src/sim/aura_classify';
import { ABILITIES } from '../src/sim/content/classes';
import type { AbilityDef, AbilityEffect } from '../src/sim/types';
import type { AuraOverlayProcDef } from '../src/ui/aura_overlay_view';
import {
  abilitySelfAuraSignature,
  auraWatchOptions,
  sanitizeWatchedIds,
  toggleWatchedId,
  WATCHED_PROC_PREFIX,
  watchedAuraProcDefs,
  watchedProcAbilityId,
  watchedProcId,
} from '../src/ui/aura_watchlist_core';

const def = (id: string, effects: AbilityEffect[]): Pick<AbilityDef, 'id' | 'effects'> => ({
  id,
  effects,
});
const knownOf = (...defs: Pick<AbilityDef, 'id' | 'effects'>[]) => defs.map((d) => ({ def: d }));

describe('watched proc ids', () => {
  it('round-trips an ability id through the reserved namespace', () => {
    expect(watchedProcId('bloodrage')).toBe(`${WATCHED_PROC_PREFIX}bloodrage`);
    expect(watchedProcAbilityId(watchedProcId('bloodrage'))).toBe('bloodrage');
  });

  it('never claims an authored proc id, including one that merely contains the prefix', () => {
    expect(watchedProcAbilityId('hot_streak')).toBeNull();
    expect(watchedProcAbilityId('revenge_free')).toBeNull();
    expect(watchedProcAbilityId('sudden_watch:death')).toBeNull();
    // A bare prefix names no ability, so it is not a watched id either.
    expect(watchedProcAbilityId(WATCHED_PROC_PREFIX)).toBeNull();
  });
});

describe('abilitySelfAuraSignature', () => {
  it('rides the ability id for a primary self-buff and the explicit id when the effect names one', () => {
    expect(
      abilitySelfAuraSignature(
        def('x', [{ type: 'selfBuff', kind: 'buff_ap', value: 60, duration: 20 }]),
      ),
    ).toEqual({ auraKind: 'buff_ap', auraId: 'x' });
    expect(
      abilitySelfAuraSignature(
        def('x', [
          { type: 'selfBuff', kind: 'buff_dr_phys', value: 0.2, duration: 6, auraId: 'x_dr' },
        ]),
      ),
    ).toEqual({ auraKind: 'buff_dr_phys', auraId: 'x_dr' });
  });

  it('reports only the FIRST self-buff, matching the sim primary-vs-companion id rule', () => {
    // effect_dispatch gives the primary the bare id and suffixes every companion,
    // so watching the second kind by the bare id would match nothing.
    expect(
      abilitySelfAuraSignature(
        def('arcane_power', [
          { type: 'selfBuff', kind: 'buff_spellpower', value: 30, duration: 15 },
          { type: 'selfBuff', kind: 'buff_haste', value: 0.2, duration: 15 },
        ]),
      ),
    ).toEqual({ auraKind: 'buff_spellpower', auraId: 'arcane_power' });
  });

  it('derives absorb and imbue shields, suffixing an absorb that rides a stasis self-buff', () => {
    expect(
      abilitySelfAuraSignature(def('shield', [{ type: 'absorb', amount: 100, duration: 10 }])),
    ).toEqual({ auraKind: 'absorb', auraId: 'shield' });
    expect(
      abilitySelfAuraSignature(
        def('ice_block', [
          { type: 'selfBuff', kind: 'stasis', value: 1, duration: 8 },
          { type: 'absorb', amount: 100, duration: 8 },
        ]),
      ),
      // The stasis self-buff comes first, so the stasis aura is what is watched;
      // the suffix rule only decides the absorb id when no self-buff precedes it.
    ).toEqual({ auraKind: 'stasis', auraId: 'ice_block' });
    expect(
      abilitySelfAuraSignature(
        def('ice_block', [
          { type: 'absorb', amount: 100, duration: 8 },
          { type: 'selfBuff', kind: 'stasis', value: 1, duration: 8 },
        ]),
      ),
    ).toEqual({ auraKind: 'absorb', auraId: 'ice_block_absorb' });
    expect(
      abilitySelfAuraSignature(def('rockbiter', [{ type: 'imbue', bonus: 10, duration: 300 }])),
    ).toEqual({ auraKind: 'imbue', auraId: 'rockbiter' });
  });

  it('reports nothing for a TOGGLE, whose 3600s duration is scaffolding not a countdown', () => {
    // The overlay prints a countdown from the aura's remaining time. A stance or a
    // form is backed by a 3600s duration the buff bar deliberately never shows, so
    // watching one would put a ticking "3,599" on screen. Same classifier the buff
    // bar uses, so the two surfaces cannot drift.
    expect(abilitySelfAuraSignature(ABILITIES.battle_stance)).toBeNull();
    expect(abilitySelfAuraSignature(ABILITIES.defensive_stance)).toBeNull();
    expect(abilitySelfAuraSignature(ABILITIES.ghost_wolf)).toBeNull();
    expect(
      abilitySelfAuraSignature(
        def('cat_form', [{ type: 'selfBuff', kind: 'form_cat', value: 1, duration: 3600 }]),
      ),
    ).toBeNull();
    // Greater Invisibility rides the stealth kind but is a real 20s buff, so it
    // stays watchable: the timed-id override survives the move to the sim leaf.
    expect(
      abilitySelfAuraSignature(
        def('greater_invisibility', [
          { type: 'selfBuff', kind: 'stealth', value: 1, duration: 20 },
        ]),
      ),
    ).toEqual({ auraKind: 'stealth', auraId: 'greater_invisibility' });
  });

  it('keeps a toggle out of the picker rows entirely', () => {
    const options = auraWatchOptions(
      knownOf(ABILITIES.battle_stance, ABILITIES.recklessness),
      [],
      [],
    );
    expect(options.map((o) => o.abilityId)).toEqual(['recklessness']);
  });

  it('derives every OTHER effect family that parks an aura on the caster', () => {
    // Found by auditing the shipped kit against effect_dispatch: these were real
    // procs the picker silently omitted, so "any spell that buffs you" was untrue
    // until they were added. Ids and kinds are the ones the sim actually applies.
    expect(abilitySelfAuraSignature(ABILITIES.slice_and_dice)).toEqual({
      auraKind: 'buff_haste',
      auraId: 'slice_and_dice',
    });
    expect(abilitySelfAuraSignature(ABILITIES.iron_resolve)).toEqual({
      auraKind: 'absorb',
      auraId: 'iron_resolve',
    });
    expect(abilitySelfAuraSignature(ABILITIES.greater_invisibility)).toEqual({
      auraKind: 'stealth',
      auraId: 'greater_invisibility',
    });
    expect(abilitySelfAuraSignature(ABILITIES.sanguine_aura)).toEqual({
      auraKind: 'sanguine',
      auraId: 'sanguine_aura',
    });
    // The enrage proc rides a FIXED aura id, not the ability's.
    expect(abilitySelfAuraSignature(ABILITIES.bloodthirst)).toEqual({
      auraKind: 'enrage',
      auraId: 'fury_enrage',
    });
  });

  it('leaves no shipped self-aura ability underivable except deliberate toggles', () => {
    // The completeness claim, checked against the whole shipped kit rather than a
    // handful of examples: every ability carrying an effect family that parks an
    // aura on its caster must yield a signature, unless it is a toggle.
    const SELF_AURA_EFFECTS = new Set([
      'selfBuff',
      'absorb',
      'imbue',
      'finisherHaste',
      'absorbSpentResource',
      'greaterInvisibility',
      'partyMeleeBuff',
      'enrageChance',
    ]);
    const underivable: string[] = [];
    for (const ability of Object.values(ABILITIES)) {
      if (!ability.effects.some((effect) => SELF_AURA_EFFECTS.has(effect.type))) continue;
      if (abilitySelfAuraSignature(ability)) continue;
      const toggle = ability.effects.some(
        (effect) =>
          effect.type === 'selfBuff' && isToggleAura(effect.kind, effect.auraId ?? ability.id),
      );
      if (!toggle) underivable.push(ability.id);
    }
    expect(underivable).toEqual([]);
  });

  it('reports nothing for an ability that parks no aura on the caster', () => {
    expect(
      abilitySelfAuraSignature(def('sinister_strike', [{ type: 'weaponStrike', bonus: 40 }])),
    ).toBeNull();
    expect(
      abilitySelfAuraSignature(
        def('rend', [{ type: 'applyDebuff', kind: 'debuff_ap', value: 40, duration: 30 }]),
      ),
    ).toBeNull();
    expect(abilitySelfAuraSignature(def('nothing', []))).toBeNull();
  });

  it('matches the aura real shipped abilities actually apply', () => {
    // Pinned to literals, not re-derived from the same effect data: these are the
    // exact (kind, id) pairs effect_dispatch parks on the player, and the overlay
    // matches on them. Raised Guard is the load-bearing one, since its self-buff
    // names an explicit auraId that differs from the ability id.
    expect(abilitySelfAuraSignature(ABILITIES.raised_guard)).toEqual({
      auraKind: 'buff_dr_phys',
      auraId: 'raised_guard_dr',
    });
    expect(abilitySelfAuraSignature(ABILITIES.recklessness)).toEqual({
      auraKind: 'buff_reckless',
      auraId: 'recklessness',
    });
    expect(abilitySelfAuraSignature(ABILITIES.power_word_shield)).toEqual({
      auraKind: 'absorb',
      auraId: 'power_word_shield',
    });
    expect(abilitySelfAuraSignature(ABILITIES.rockbiter_weapon)).toEqual({
      auraKind: 'imbue',
      auraId: 'rockbiter_weapon',
    });
    // A pure attack still parks nothing on the caster.
    expect(abilitySelfAuraSignature(ABILITIES.sinister_strike)).toBeNull();
  });
});

describe('auraWatchOptions', () => {
  const buff = (id: string, kind = 'buff_ap'): Pick<AbilityDef, 'id' | 'effects'> =>
    def(id, [{ type: 'selfBuff', kind: kind as never, value: 1, duration: 10 }]);

  it('offers every self-aura spell, skips the rest, and flags the picked ones', () => {
    const options = auraWatchOptions(
      knownOf(
        buff('bloodrage'),
        def('strike', [{ type: 'weaponStrike', bonus: 1 }]),
        buff('shout'),
      ),
      [],
      [watchedProcId('shout')],
    );
    expect(options.map((o) => o.abilityId)).toEqual(['bloodrage', 'shout']);
    expect(options.map((o) => o.watched)).toEqual([false, true]);
    expect(options[0]).toMatchObject({
      procId: 'watch:bloodrage',
      auraKind: 'buff_ap',
      auraId: 'bloodrage',
    });
  });

  it('drops a spell an authored proc already watches, by id or by bare kind', () => {
    const authored: Pick<AuraOverlayProcDef, 'auraKind' | 'auraId'>[] = [
      { auraKind: 'absorb', auraId: 'iron_resolve' },
      { auraKind: 'enrage', auraId: undefined },
    ];
    const options = auraWatchOptions(
      knownOf(
        def('iron_resolve', [{ type: 'absorb', amount: 1, duration: 1 }]),
        def('other_shield', [{ type: 'absorb', amount: 1, duration: 1 }]),
        buff('red_harvest', 'enrage'),
      ),
      authored,
      [],
    );
    // Same kind but a different id is NOT covered by the id-pinned authored def...
    expect(options.map((o) => o.abilityId)).toEqual(['other_shield']);
    // ...while the id-less authored def swallows every aura of its kind, which is
    // exactly how auraOverlayProcAura matches.
  });

  it('reports one row per ability id even when the known list repeats one', () => {
    const options = auraWatchOptions(knownOf(buff('bloodrage'), buff('bloodrage')), [], []);
    expect(options).toHaveLength(1);
  });

  it('leaves a watched id that is no longer known out of the rows without touching storage', () => {
    const stored = [watchedProcId('bloodrage'), watchedProcId('respecced_away')];
    const options = auraWatchOptions(knownOf(buff('bloodrage')), [], stored);
    expect(options.map((o) => o.procId)).toEqual([watchedProcId('bloodrage')]);
    expect(stored).toHaveLength(2);
  });
});

describe('watchedAuraProcDefs', () => {
  it('builds a class-themed def for each picked row and nothing for the rest', () => {
    const options = auraWatchOptions(
      knownOf(
        def('bloodrage', [{ type: 'selfBuff', kind: 'buff_ap', value: 1, duration: 10 }]),
        def('shout', [{ type: 'selfBuff', kind: 'buff_ap', value: 1, duration: 10 }]),
      ),
      [],
      [watchedProcId('shout')],
    );
    expect(watchedAuraProcDefs('warrior', options)).toEqual([
      {
        id: 'watch:shout',
        auraKind: 'buff_ap',
        auraId: 'shout',
        iconAbilityId: 'shout',
        theme: 'warrior',
        labelKey: null,
      },
    ]);
    expect(watchedAuraProcDefs('druid', options)[0].theme).toBe('druid');
  });
});

describe('watchlist storage helpers', () => {
  it('keeps only watched-prefixed strings, deduped, in order', () => {
    expect(sanitizeWatchedIds(['watch:a', 'hot_streak', 'watch:a', 7, null, 'watch:b'])).toEqual([
      'watch:a',
      'watch:b',
    ]);
  });

  it('degrades a corrupt or absent stored value to an empty list', () => {
    expect(sanitizeWatchedIds(undefined)).toEqual([]);
    expect(sanitizeWatchedIds('watch:a')).toEqual([]);
    expect(sanitizeWatchedIds({ 0: 'watch:a' })).toEqual([]);
  });

  it('adds, removes, and returns the SAME reference for a no-op toggle', () => {
    const ids = ['watch:a'];
    expect(toggleWatchedId(ids, 'watch:b', true)).toEqual(['watch:a', 'watch:b']);
    expect(toggleWatchedId(ids, 'watch:a', false)).toEqual([]);
    expect(toggleWatchedId(ids, 'watch:a', true)).toBe(ids);
    expect(toggleWatchedId(ids, 'watch:b', false)).toBe(ids);
  });
});
