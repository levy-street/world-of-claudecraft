import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { finderActivity } from '../src/sim/content/dungeon_finder';
import { NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS } from '../src/sim/nythraxis_dread_curse';
import type { SimEvent } from '../src/sim/types';
import {
  dispatchNythraxisCalloutSfx,
  dispatchRaidCalloutSfx,
  nythraxisCalloutCue,
  nythraxisCalloutSfxPlan,
} from '../src/ui/combat_sfx';
import { setLanguage, type TranslationKey, t } from '../src/ui/i18n';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import { type NythraxisCallout, nythraxisCalloutKey } from '../src/ui/nythraxis_callout';
import { raidCalloutKey } from '../src/ui/raid_callout';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

type NythraxisCalloutEvent = Extract<SimEvent, { type: 'nythraxisCallout' }>;

const CALLS: readonly NythraxisCallout[] = [
  'impaled',
  'youAreImpaled',
  'spikeBroken',
  'dreadCurseSwap',
  'sigilAppears',
  'sigilBound',
  'sigilUnbound',
  'gravefireTarget',
  'kingsWrath',
  'boneStormBegins',
  'boneStormCharge',
  'boneStormEnds',
  'crownEndures60',
  'crownEndures30',
  'crownEndures10',
  'crownEndures',
];

const hudSource = () => readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('Nythraxis encounter callouts', () => {
  it('maps every structured authority event to a catalogued top-banner key', () => {
    expect(CALLS.map((call) => nythraxisCalloutKey(call))).toEqual([
      'hudChrome.nythraxisCallout.impaled',
      'hudChrome.nythraxisCallout.youAreImpaled',
      'hudChrome.nythraxisCallout.spikeBroken',
      'hudChrome.nythraxisCallout.dreadCurseSwap',
      'hudChrome.nythraxisCallout.sigilAppears',
      'hudChrome.nythraxisCallout.sigilBound',
      'hudChrome.nythraxisCallout.sigilUnbound',
      'hudChrome.nythraxisCallout.gravefireTarget',
      'hudChrome.nythraxisCallout.kingsWrath',
      'hudChrome.nythraxisCallout.boneStormBegins',
      'hudChrome.nythraxisCallout.boneStormCharge',
      'hudChrome.nythraxisCallout.boneStormEnds',
      'hudChrome.nythraxisCallout.crownEndures60',
      'hudChrome.nythraxisCallout.crownEndures30',
      'hudChrome.nythraxisCallout.crownEndures10',
      'hudChrome.nythraxisCallout.crownEndures',
    ]);
  });

  it('has an English catalog row behind every call and renders it through t()', () => {
    setLanguage('en');
    expect(Object.keys(hudChromeStrings.nythraxisCallout).sort()).toEqual([...CALLS].sort());
    expect(t(nythraxisCalloutKey('impaled') as TranslationKey)).toBe(
      'Bone Spikes! Free the impaled!',
    );
    expect(t(nythraxisCalloutKey('youAreImpaled') as TranslationKey)).toBe(
      'You are impaled! Hold on!',
    );
    expect(t(nythraxisCalloutKey('spikeBroken') as TranslationKey)).toBe('Spike shattered!');
    expect(t(nythraxisCalloutKey('dreadCurseSwap') as TranslationKey)).toBe(
      'Dread Curse: swap tanks!',
    );
    expect(t(nythraxisCalloutKey('sigilAppears') as TranslationKey)).toBe(
      'A Binding Sigil flares! Drag Nythraxis onto it!',
    );
    expect(t(nythraxisCalloutKey('sigilBound') as TranslationKey)).toBe(
      'Nythraxis is bound! Burn him!',
    );
    expect(t(nythraxisCalloutKey('sigilUnbound') as TranslationKey)).toBe(
      'The sigil fades unbound! Nythraxis grows stronger!',
    );
    expect(t(nythraxisCalloutKey('gravefireTarget') as TranslationKey)).toBe(
      'Gravefire races toward you! Sidestep!',
    );
    expect(t(nythraxisCalloutKey('kingsWrath') as TranslationKey)).toBe(
      'The King rises in wrath! Everything hits harder now!',
    );
    expect(t(nythraxisCalloutKey('boneStormBegins') as TranslationKey)).toBe(
      'Bone Storm! Spread out and run!',
    );
    expect(t(nythraxisCalloutKey('boneStormCharge') as TranslationKey)).toBe(
      'Nythraxis is charging YOU! Run!',
    );
    expect(t(nythraxisCalloutKey('boneStormEnds') as TranslationKey)).toBe(
      'Bone Storm over. Tanks, pick him up!',
    );
    expect(t(nythraxisCalloutKey('crownEndures60') as TranslationKey)).toBe(
      'One minute until The Crown Endures!',
    );
    expect(t(nythraxisCalloutKey('crownEndures30') as TranslationKey)).toBe(
      'Thirty seconds until The Crown Endures!',
    );
    expect(t(nythraxisCalloutKey('crownEndures10') as TranslationKey)).toBe(
      'Ten seconds! Burn him!',
    );
    expect(t(nythraxisCalloutKey('crownEndures') as TranslationKey)).toBe(
      'The Crown Endures! Nythraxis is enraged!',
    );
  });

  it('routes both raid callout families through the one banner-key selector', () => {
    expect(raidCalloutKey({ type: 'nythraxisCallout', sourceId: 1, call: 'spikeBroken' })).toBe(
      'hudChrome.nythraxisCallout.spikeBroken',
    );
    expect(raidCalloutKey({ type: 'varkhulCallout', sourceId: 1, call: 'heat90' })).toBe(
      'hudChrome.varkhulCallout.heat90',
    );
  });

  it('announces the aria-hidden top banner through the combat live region too', () => {
    const hud = hudSource();
    const arm = hud.slice(hud.indexOf("case 'nythraxisCallout': {"), hud.indexOf("case 'chat':"));
    expect(arm).toContain('raidCalloutKey(ev)');
    expect(arm).toContain('this.questBanner.show(text);');
    expect(arm).toContain('this.combatAnnouncer.push(text, performance.now());');
  });

  it('gives every warning a sampled cue and plays it from the boss position', () => {
    expect(nythraxisCalloutCue('impaled')).toBe('impact_bone');
    expect(nythraxisCalloutCue('youAreImpaled')).toBe('impact_bone');
    expect(nythraxisCalloutCue('spikeBroken')).toBe('ui_achievement');
    expect(nythraxisCalloutCue('dreadCurseSwap')).toBe('impact_shadow');
    expect(nythraxisCalloutCue('sigilAppears')).toBe('impact_arcane');
    expect(nythraxisCalloutCue('sigilBound')).toBe('impact_arcane');
    expect(nythraxisCalloutCue('sigilUnbound')).toBe('impact_shadow');
    expect(nythraxisCalloutCue('gravefireTarget')).toBe('impact_shadow');
    expect(nythraxisCalloutCue('kingsWrath')).toBe('impact_shadow');
    expect(nythraxisCalloutCue('boneStormBegins')).toBe('impact_bone');
    expect(nythraxisCalloutCue('boneStormCharge')).toBe('impact_bone');
    expect(nythraxisCalloutCue('boneStormEnds')).toBe('impact_bone');
    expect(nythraxisCalloutCue('crownEndures60')).toBe('impact_shadow');
    expect(nythraxisCalloutCue('crownEndures30')).toBe('impact_shadow');
    expect(nythraxisCalloutCue('crownEndures10')).toBe('impact_shadow');
    expect(nythraxisCalloutCue('crownEndures')).toBe('impact_shadow');

    const event = {
      type: 'nythraxisCallout',
      pid: 1,
      sourceId: 42,
      call: 'dreadCurseSwap',
    } as const satisfies NythraxisCalloutEvent;
    const entityOf = (entityId: number) =>
      entityId === 42 ? { pos: { x: 4, y: 5, z: 6 } } : undefined;
    expect(nythraxisCalloutSfxPlan(event, entityOf)).toEqual({
      cue: 'impact_shadow',
      x: 4,
      y: 5,
      z: 6,
      gain: 0.9,
      cooldown: 0.08,
      jitter: false,
    });
    expect(nythraxisCalloutSfxPlan(event, () => undefined)).toBeNull();

    const sink = vi.fn();
    expect(dispatchNythraxisCalloutSfx(event, entityOf, sink)).toBe(true);
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ cue: 'impact_shadow', x: 4 }));
    expect(dispatchNythraxisCalloutSfx(event, () => undefined, sink)).toBe(false);
    expect(sink).toHaveBeenCalledOnce();
  });

  it('shares the HUD arm with the Varkhul callouts through the raid dispatcher', () => {
    const play = vi.fn();
    const entityOf = (entityId: number) =>
      entityId === 7 ? { pos: { x: 1, y: 2, z: 3 } } : undefined;
    expect(
      dispatchRaidCalloutSfx(
        { type: 'nythraxisCallout', sourceId: 7, call: 'impaled' },
        entityOf,
        play,
      ),
    ).toBe(true);
    expect(play).toHaveBeenLastCalledWith('impact_bone', 1, 2, 3, 0.9, {
      cooldown: 0.08,
      jitter: false,
    });
    expect(
      dispatchRaidCalloutSfx(
        { type: 'varkhulCallout', sourceId: 7, call: 'worldfireClosing' },
        entityOf,
        play,
      ),
    ).toBe(true);
    expect(play).toHaveBeenLastCalledWith('rift_lava_tick', 1, 2, 3, 0.9, {
      cooldown: 0.08,
      jitter: false,
    });
    expect(
      dispatchRaidCalloutSfx(
        { type: 'nythraxisCallout', sourceId: 8, call: 'impaled' },
        entityOf,
        play,
      ),
    ).toBe(false);
    expect(play).toHaveBeenCalledTimes(2);

    const hud = hudSource();
    expect(hud).toContain("case 'nythraxisCallout'");
    expect(hud).toContain('dispatchRaidCalloutSfx(');
  });
});

describe('Nythraxis sim English is matched client-side', () => {
  it.each([
    'Gravebreaker',
    'Soul Rend',
    'Deathless Rage',
    'Deathless Rage Interrupted',
    'Soul Ward',
    "King's Wrath",
    'Bone Storm',
    'Bone Slam',
    'The Crown Endures',
    'Dread Curse',
    'Bone Spike',
    'Impaled',
    'Grave Eruption',
    'Grave Flame',
    'Binding Sigil',
    'Deathless Ascension',
    'Bound',
    'Unbound',
    'Gravefire',
    'Soulfire',
    "Malric's Mending",
    'Royal Cleave',
  ])('recognizes the cast or aura name %s', (name) => {
    setLanguage('en');
    // A null here means the buff frame and combat log would fall back to the raw
    // English string in every locale (the localizeSimAuraName contract).
    expect(localizeSimAuraName(name)).toBe(name);
  });
});

describe('Nythraxis dungeon finder blurbs', () => {
  it('spells the Dread Curse swap point from the encounter constant', () => {
    expect(hudChromeStrings.finder.mech.dread_curse).toContain(
      `swap at ${NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS} stacks`,
    );
    expect(hudChromeStrings.finder.mech.dread_curse).not.toMatch(/heroic only/i);
  });

  it('has a blurb for every mechanic key both raid previews list', () => {
    setLanguage('en');
    const keys = new Set<string>();
    for (const id of ['nythraxis_boss_arena_normal', 'nythraxis_boss_arena_heroic']) {
      for (const encounter of finderActivity(id)?.encounters ?? []) {
        for (const mechanic of encounter.mechanics) keys.add(mechanic);
      }
    }
    for (const mechanic of [
      'bone_spike',
      'grave_eruption',
      'binding_sigil',
      'gravefire',
      'soulfire',
      'kings_wrath',
      'bone_storm',
      'crown_endures',
      'dread_curse',
    ]) {
      expect(keys.has(mechanic), mechanic).toBe(true);
    }
    // The guard waves and the heroic court are switched off with the adds
    // (NYTHRAXIS_ADDS_ENABLED in src/sim/types.ts), so neither preview lists them.
    for (const add of ['raise_fallen', 'deathless_court']) {
      expect(keys.has(add), add).toBe(false);
    }
    for (const mechanic of keys) {
      const text = t(`hudChrome.finder.mech.${mechanic}` as TranslationKey);
      expect(text, mechanic).toMatch(/\S/);
    }
    expect(hudChromeStrings.finder.mech.deathless_court).toMatch(/heroic only/i);
  });
});
