// Layout pins for the ability tooltip body (src/ui/ability_tooltip_view.ts):
// the name | rank title row, the cost | range and cast | cooldown rows,
// requirements above the description, and the Shift detail block / hint.
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import type { ResolvedAbility } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/types';
import { abilityRequirementLines } from '../src/ui/ability_tooltip_lines';
import {
  type AbilityTooltipContext,
  type AbilityTooltipDetailMode,
  abilityTooltipHtml,
} from '../src/ui/ability_tooltip_view';

function ctx(detailMode: AbilityTooltipDetailMode): AbilityTooltipContext {
  return {
    player: {
      resourceType: 'mana',
      spellPower: 200,
      healPower: 150,
      rangedPower: 0,
      attackPower: 100,
      auras: [],
    },
    spec: null,
    auraEffectHtml: () => '<div class="tt-effect">aura line</div>',
    detailMode,
  };
}

function mageAbility(id: string): ResolvedAbility {
  const known = abilitiesKnownAt('mage', MAX_LEVEL).find((k) => k.def.id === id);
  if (!known) throw new Error(`missing mage ability ${id}`);
  return known;
}

describe('abilityTooltipHtml layout', () => {
  const fireball = mageAbility('fireball');

  it('puts the rank on the title row, right-aligned', () => {
    const html = abilityTooltipHtml(fireball, ctx('none'));
    expect(html.startsWith('<div class="tt-title tt-row"><span>')).toBe(true);
    expect(html).toMatch(/<span class="tt-sub tt-row-end">Rank \d+<\/span><\/div>/);
  });

  it('pairs cost with range and cast with cooldown on two-sided rows', () => {
    const html = abilityTooltipHtml(fireball, ctx('none'));
    expect(html).toContain(`<span>${fireball.cost} Mana</span>`);
    expect(html).toMatch(/<span class="tt-row-end">\d+ yd range<\/span>/);
    expect(html).toMatch(/<span>[\d.]+ sec cast<\/span>/);
  });

  it('places requirement lines before the description', () => {
    // Rogue finishers carry the "Consumes combo points" requirement line.
    const withReq = abilitiesKnownAt('rogue', MAX_LEVEL).find(
      (k) => abilityRequirementLines(k.def, null, k).length > 0,
    );
    if (!withReq) throw new Error('no rogue ability with a requirement line');
    const html = abilityTooltipHtml(withReq, ctx('none'));
    const req = html.indexOf('tt-req');
    expect(req).toBeGreaterThan(-1);
    expect(req).toBeLessThan(html.indexOf('tt-desc'));
  });

  it('hint mode shows only the Shift hint; details mode shows the block; none shows neither', () => {
    const hint = abilityTooltipHtml(fireball, ctx('hint'));
    expect(hint).toContain('Hold Shift for details');
    expect(hint).not.toContain('tt-details');

    const details = abilityTooltipHtml(fireball, ctx('details'));
    expect(details).toContain('<div class="tt-details">');
    expect(details).toContain('School: Fire');
    expect(details).not.toContain('Hold Shift for details');

    const none = abilityTooltipHtml(fireball, ctx('none'));
    expect(none).not.toContain('Hold Shift');
    expect(none).not.toContain('tt-details');
  });

  it('joins a multi-resource cost through the locale list formatter', () => {
    const dual: ResolvedAbility = { ...fireball, def: { ...fireball.def, devotionCost: 1 } };
    const html = abilityTooltipHtml(dual, ctx('none'));
    expect(html).toContain(`<span>${fireball.cost} Mana and 1 Devotion</span>`);
  });

  it('the detail block is the last thing in the tooltip', () => {
    const html = abilityTooltipHtml(fireball, ctx('details'));
    expect(html.indexOf('tt-details')).toBeGreaterThan(html.indexOf('tt-desc'));
    expect(html.endsWith('</div></div>')).toBe(true);
  });
});
