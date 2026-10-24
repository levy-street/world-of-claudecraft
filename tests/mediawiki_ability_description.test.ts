import { describe, expect, it } from 'vitest';
import { mediawikiAbilityDescription } from '../scripts/mediawiki/ability_description';
import { ABILITIES } from '../src/sim/data';

describe('MediaWiki Bear Trap static damage reference', () => {
  it('labels the zero-power rounded total and preserves placement limits', () => {
    const description = mediawikiAbilityDescription(ABILITIES.bear_trap);
    expect(description).toContain('85 Physical damage at zero Ranged Attack Power over 15 sec');
    expect(description).toContain('5 times, once every 3 sec');
    expect(description).toContain('each tick is rounded to a whole number');
    expect(description).toContain('Damage increases with Ranged Attack Power.');
    expect(description).toContain('Placing another replaces it.');
    expect(description).toContain('It can coexist with your Frostjaw Trap.');
    expect(description).not.toMatch(/\$d|\{damage\}/);
  });

  it('preserves other ability descriptions verbatim', () => {
    expect(mediawikiAbilityDescription(ABILITIES.scatterbolt)).toBe(
      ABILITIES.scatterbolt.description,
    );
    expect(mediawikiAbilityDescription(ABILITIES.fireball)).toBe(ABILITIES.fireball.description);
  });
});
