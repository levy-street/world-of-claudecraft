import { describe, expect, it } from 'vitest';
import { renderAuraTooltipBodyHtml } from '../src/ui/aura_tooltip';
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
});
