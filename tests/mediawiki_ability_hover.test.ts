import { describe, expect, it } from 'vitest';
import { itemActionSource } from '../scripts/mediawiki/ability_access';
import { abilityHover } from '../scripts/mediawiki/ability_hover';
import { ABILITIES } from '../src/sim/data';

describe('reference spellbook tooltips', () => {
  it('shows the HUD rank, dynamic cost, range, cast, target and neutral healing', () => {
    const html = abilityHover(ABILITIES.holy_light);
    for (const line of [
      '<div class="tt-title">Mending Light</div>',
      '<div class="tt-sub">Rank 1</div>',
      '25 Mana &nbsp; 30 yd range',
      '1.5 sec cast',
      '42 to 51',
      'Friendly target',
    ])
      expect(html).toContain(line);
  });

  it('uses form resources and includes the HUD’s resolved aura effect', () => {
    expect(abilityHover(ABILITIES.lunge)).toContain('40 Energy');
    expect(abilityHover(ABILITIES.maul)).toContain('15 Rage');
    expect(abilityHover(ABILITIES.frenzied_regeneration)).toContain(
      'Bruin (10 Rage) · Cat (10 Energy)',
    );
    expect(abilityHover(ABILITIES.lightning_shield)).toContain(
      '<div class="tt-effect">Deals 13 Nature damage to attackers</div>',
    );
  });

  it('renders every visible spellbook definition without unresolved values', () => {
    const spells = Object.values(ABILITIES).filter(
      (def) => !def.hiddenFromPlayer && !itemActionSource(def),
    );
    expect(spells.length).toBeGreaterThan(300);
    for (const spell of spells) {
      const html = abilityHover(spell);
      expect(html, spell.id).toMatch(/^<div class="tt-title">.+?<\/div>/);
      expect(html, spell.id).toContain('class="tt-desc"');
      expect(html, spell.id).not.toMatch(/\b(?:undefined|NaN|Infinity)\b|\$[dobt]\b|\{[A-Za-z]+\}/);
    }
  });
});
