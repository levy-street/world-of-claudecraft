import { afterEach, describe, expect, it } from 'vitest';
import {
  emptyPriestMarkerState,
  priestActionGlowActive,
  priestMarkerStateForAuras,
} from '../src/sim/combat/priest/presentation';
import { auraDisplayNameFromSource } from '../src/ui/aura_display_name';
import { setLanguage } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

afterEach(() => setLanguage('en'));

describe('Priest relationship presentation', () => {
  it('projects every persistent relationship marker and the five-stage Gloomtithe bank', () => {
    const out = emptyPriestMarkerState();
    const state = priestMarkerStateForAuras(
      [
        { id: 'priest_doctrine', kind: 'doctrine' },
        { id: 'seraphic_vigil', kind: 'heal_echo' },
        { id: 'shadow_word_pain', kind: 'dot' },
        { id: 'priest_effigy', kind: 'hex' },
        { id: 'priest_gloomtithe', kind: 'gloomtithe', stacks: 5 },
      ],
      out,
    );

    expect(state).toBe(out);
    expect(state).toEqual({
      doctrine: true,
      vigil: true,
      dirge: true,
      effigy: true,
      gloomtitheStacks: 5,
      summonReady: true,
    });
  });

  it('glows only Tithefiend at the full five-stack bank', () => {
    expect(
      priestActionGlowActive(
        [{ id: 'priest_gloomtithe', kind: 'gloomtithe', stacks: 5 }],
        'summon_tithefiend',
      ),
    ).toBe(true);
    expect(
      priestActionGlowActive(
        [{ id: 'priest_gloomtithe', kind: 'gloomtithe', stacks: 4 }],
        'summon_tithefiend',
      ),
    ).toBe(false);
    expect(
      priestActionGlowActive(
        [{ id: 'priest_gloomtithe', kind: 'gloomtithe', stacks: 5 }],
        'mind_blast',
      ),
    ).toBe(false);
  });

  it('localizes every new visible Vespers state and guardian name', () => {
    setLanguage('zh_CN');

    expect(auraDisplayNameFromSource('Effigy')).not.toBe('Effigy');
    expect(auraDisplayNameFromSource('Gloomtithe')).not.toBe('Gloomtithe');
    expect(localizeSimAuraName('Tithefiend')).not.toBe('Tithefiend');
  });
});
