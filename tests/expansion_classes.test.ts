import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { ROW_TREES } from '../src/sim/content/talent_rows';
import { TALENTS } from '../src/sim/content/talents';
import { ALL_CLASSES, MAX_LEVEL, xpForLevel } from '../src/sim/types';

describe('Ashen Bloom class foundations', () => {
  it('offers every playable class in offline and online character creation', () => {
    const entries = {
      index: readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
      play: readFileSync(new URL('../play.html', import.meta.url), 'utf8'),
    };
    const roster = (html: string, panelId: string): string[] => {
      const endId = panelId === 'offline-select' ? 'offline-skin-row' : 'online-skin-row';
      const panel = html.match(new RegExp(`<div id="${panelId}"[\\s\\S]*?<div id="${endId}"`))?.[0];
      expect(panel, `${panelId} panel`).toBeDefined();
      return [...(panel ?? '').matchAll(/class="mini-class" data-class="([^"]+)"/g)].map(
        (match) => match[1],
      );
    };

    expect(roster(entries.index, 'offline-select')).toEqual(ALL_CLASSES);
    expect(roster(entries.index, 'charcreate-panel')).toEqual(ALL_CLASSES);
    expect(roster(entries.play, 'charcreate-panel')).toEqual(ALL_CLASSES);
  });

  it('raises the real level cap to 40 with a growing expansion XP curve', () => {
    expect(MAX_LEVEL).toBe(40);
    expect(xpForLevel(21)).toBeGreaterThan(xpForLevel(20));
    expect(xpForLevel(40)).toBeGreaterThan(xpForLevel(39));
  });

  it('registers both new playable classes in every core class catalog', () => {
    for (const cls of ['gravecaller', 'briar_warden'] as const) {
      expect(ALL_CLASSES).toContain(cls);
      expect(CLASSES[cls].id).toBe(cls);
      expect(TALENTS[cls].class).toBe(cls);
      expect(TALENTS[cls].specs).toHaveLength(3);
      expect(ROW_TREES[cls]).toHaveLength(6);
    }
  });

  it('gives Gravecaller a level-spanning attrition kit', () => {
    const known = new Map(
      abilitiesKnownAt('gravecaller', MAX_LEVEL).map((entry) => [entry.def.id, entry]),
    );
    expect(known.get('pestilent_bolt')?.rank).toBe(5);
    expect(known.has('the_wasting')).toBe(true);
    expect(known.has('soul_siphon')).toBe(true);
    expect(known.has('plague_wind')).toBe(true);
    expect(known.has('deaths_bargain')).toBe(true);
  });

  it('gives Briar Warden permanent and burst unlimited damage shields', () => {
    const known = new Map(
      abilitiesKnownAt('briar_warden', MAX_LEVEL).map((entry) => [entry.def.id, entry]),
    );
    expect(known.get('briar_skin')?.rank).toBe(5);
    expect(known.has('walking_calamity')).toBe(true);
    for (const id of ['briar_skin', 'barbed_aegis', 'vindictive_growth', 'walking_calamity']) {
      const thorns = ABILITIES[id].effects.find(
        (effect) =>
          (effect.type === 'selfBuff' || effect.type === 'buffTarget') && effect.kind === 'thorns',
      );
      expect(thorns).toBeDefined();
      expect('charges' in (thorns ?? {})).toBe(false);
    }
  });

  it('adds a level-30 Ashen Bloom ability to every original class', () => {
    const expansionAbilityByClass = {
      warrior: 'gravebreaker',
      paladin: 'last_light',
      hunter: 'blackfletch',
      rogue: 'duskstep',
      priest: 'memorial_grace',
      shaman: 'ancestor_storm',
      mage: 'cinder_comet',
      warlock: 'funeral_pyre',
      druid: 'crown_of_briars',
    } as const;
    for (const [cls, abilityId] of Object.entries(expansionAbilityByClass)) {
      expect(CLASSES[cls as keyof typeof CLASSES].abilities).toContain(abilityId);
      expect(ABILITIES[abilityId].learnLevel).toBe(30);
      expect(ABILITIES[abilityId].class).toBe(cls);
    }
  });
});
