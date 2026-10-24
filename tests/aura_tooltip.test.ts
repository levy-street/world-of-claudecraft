import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import type { Entity } from '../src/sim/types';
import { MAX_LEVEL } from '../src/sim/types';
import { renderAuraTooltipBodyHtml } from '../src/ui/aura_tooltip';
import { resolvedAuraTooltipBodyHtml } from '../src/ui/aura_tooltip_body';
import type { AuraInput } from '../src/ui/auras_view';

const aura = (overrides: Partial<AuraInput> = {}): AuraInput => ({
  id: 'divine_ascension',
  name: 'Divine Ascension',
  kind: 'internal_cd',
  remaining: 30,
  value: 0,
  ...overrides,
});

describe('renderAuraTooltipBodyHtml', () => {
  it('resolves known ability prose with the current character power', () => {
    const ability = abilitiesKnownAt('priest', MAX_LEVEL).find((entry) => entry.def.id === 'renew');
    if (!ability) throw new Error('missing renew fixture');
    const effect = aura({ id: 'renew', kind: 'hot', value: 0 });
    const player = {
      spellPower: 0,
      healPower: 0,
      rangedPower: 0,
      attackPower: 0,
      auras: [],
    } as unknown as Entity;
    const render = () =>
      resolvedAuraTooltipBodyHtml(
        effect,
        player,
        () => ability,
        () => '<div class="tt-effect">Effect</div>',
      );
    const lowPower = render();
    player.healPower = 500;
    const highPower = render();
    expect(lowPower).toContain('tt-desc');
    expect(highPower).toContain('<div class="tt-effect">Effect</div>');
    expect(highPower).not.toBe(lowPower);
  });

  it('keeps effect-only aura bodies when no source ability can be resolved', () => {
    const player = {} as Entity;
    const effectHtml = () => '<div class="tt-effect">Runtime effect</div>';
    expect(resolvedAuraTooltipBodyHtml(aura(), player, () => null, effectHtml)).toBe(effectHtml());
    const { id: _id, ...withoutId } = aura();
    expect(resolvedAuraTooltipBodyHtml(withoutId, player, () => null, effectHtml)).toBe(
      effectHtml(),
    );
  });
  it('shows a known source ability description even when its aura kind has no descriptor', () => {
    expect(
      renderAuraTooltipBodyHtml(aura(), {
        abilityDescription: (id) =>
          id === 'divine_ascension' ? 'Spend Devotion & gain Ascension charges.' : null,
        effectHtml: () => '',
        escapeHtml: (text) => text.replaceAll('&', '&amp;'),
      }),
    ).toBe('<div class="tt-desc">Spend Devotion &amp; gain Ascension charges.</div>');
  });

  it('keeps the runtime effect summary after the full ability description', () => {
    expect(
      renderAuraTooltipBodyHtml(aura({ id: 'devotion_ward', kind: 'buff_dr', value: 0.05 }), {
        abilityDescription: () => 'Protects the group.',
        effectHtml: () => '<div class="tt-effect">Damage taken reduced by 5%</div>',
        escapeHtml: (text) => text,
      }),
    ).toBe(
      '<div class="tt-desc">Protects the group.</div><div class="tt-effect">Damage taken reduced by 5%</div>',
    );
  });

  it('still describes proc buffs that have no source ability definition', () => {
    expect(
      renderAuraTooltipBodyHtml(
        aura({ id: 'divine_steed_burst', kind: 'buff_speed', value: 1.3 }),
        {
          abilityDescription: () => null,
          effectHtml: () => '<div class="tt-effect">Movement speed increased by 30%</div>',
          escapeHtml: (text) => text,
        },
      ),
    ).toBe('<div class="tt-effect">Movement speed increased by 30%</div>');
  });

  it('does not combine individual Temporal Echo prose with group Echo mark rates', () => {
    expect(
      renderAuraTooltipBodyHtml(
        aura({
          id: 'temporal_echo',
          kind: 'temporal_echo',
          value: 0.13,
        }),
        {
          abilityDescription: () => 'Your Arcane damage heals one chosen ally for 40%.',
          effectHtml: () =>
            '<div class="tt-effect">Arcane damage heals this ally for 13% of the damage dealt.</div>',
          escapeHtml: (text) => text,
        },
      ),
    ).toBe(
      '<div class="tt-effect">Arcane damage heals this ally for 13% of the damage dealt.</div>',
    );
  });
});
