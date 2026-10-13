// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { encounterGuideHtml } from '../src/ui/dungeon_encounter_guide';
import { t } from '../src/ui/i18n';

function markup(
  mobId: string,
  mechanics: string[] = [],
  difficulty: 'normal' | 'heroic' = 'normal',
) {
  const root = document.createElement('div');
  root.innerHTML = encounterGuideHtml({ mobId, mechanics }, difficulty);
  return root;
}

describe('catalogue encounter guide', () => {
  it('covers every advertised encounter mechanic without missing keys or unfilled values', () => {
    for (const activity of FINDER_ACTIVITIES) {
      for (const encounter of activity.encounters) {
        const root = markup(encounter.mobId, [...encounter.mechanics], activity.difficulty);
        expect(root.textContent).not.toMatch(/hudChrome\.|\{[a-zA-Z]+\}/);
        if (encounter.mechanics.length) {
          expect(root.textContent).not.toContain(t('hudChrome.finder.guideUnavailable'));
          expect(root.querySelectorAll('.df-encounter-guide-mechanic').length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('uses difficulty-specific raid phases and real numerical interpolation', () => {
    const normal = markup('ignivar_herald_of_the_last_flame');
    const heroic = markup('ignivar_herald_of_the_last_flame', [], 'heroic');
    expect(normal.querySelectorAll('.df-encounter-guide-phase')).toHaveLength(4);
    expect(normal.textContent).not.toContain('Chains of the Forge');
    expect(heroic.textContent).toContain('Chains of the Forge');
    expect(normal.textContent).toContain('20%');
    expect(heroic.textContent).toContain('Cleansing Backlash');
    expect(normal.querySelector('.df-encounter-guide-response')?.textContent).toContain(
      'What to do',
    );
  });

  it('does not offer false frontal or spread counterplay for radial dungeon damage', () => {
    expect(markup('knight_commander_olen', ['reaping_arc']).textContent).toContain(
      'standing behind the boss alone does not prevent this splash damage',
    );
    expect(markup('korzul_the_gravewyrm', ['grave_inferno']).textContent).toContain(
      'Spreading out inside the fire does not protect you',
    );
    expect(markup('corrupted_priest_malric', ['profane_mending']).textContent).toContain(
      'not a cast to interrupt',
    );
  });

  it('does not invent mechanics for encounters with no authored strategy', () => {
    const root = markup('sexton_marrow');
    expect(root.textContent).toBe(t('hudChrome.finder.guideUnavailable'));
    expect(root.querySelector('.df-encounter-guide-mechanic')).toBeNull();
  });

  it('escapes unknown mechanic content and safely falls back without executing markup', () => {
    const root = markup('unknown', ['<img src=x onerror=alert(1)>']);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('[onerror]')).toBeNull();
    expect(root.textContent).toContain(t('hudChrome.finder.guideUnavailable'));
  });
});
