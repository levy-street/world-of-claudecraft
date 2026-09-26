// The live player hover card (src/ui/player_tooltip.ts) against the REAL
// English catalog: the spec line must name the spec through the talent
// catalog keyed by class, and the resolvers must keep the card's old fallback
// for an unknown class id.
import { describe, expect, it } from 'vitest';
import { talentsFor } from '../src/sim/content/talents';
import { playerHoverTooltipHtml } from '../src/ui/player_tooltip';
import type { PlayerTooltipSource } from '../src/ui/player_tooltip_view';

const source = (over: Partial<PlayerTooltipSource> = {}): PlayerTooltipSource => ({
  id: 3,
  name: 'Maribel',
  level: 40,
  templateId: 'priest',
  guild: '',
  pledgeGuild: '',
  title: null,
  specId: null,
  ...over,
});

describe('playerHoverTooltipHtml', () => {
  it('shows the level and class line for an unspecced player, with no spec line', () => {
    const html = playerHoverTooltipHtml(source());
    expect(html).toContain('Level 40 Priest');
    expect(html).not.toContain('tt-player-spec');
  });

  it('names every spec of every class with its role, keyed by class', () => {
    for (const cls of ['warrior', 'paladin', 'priest', 'shaman', 'druid'] as const) {
      for (const spec of talentsFor(cls)?.specs ?? []) {
        const html = playerHoverTooltipHtml(source({ templateId: cls, specId: spec.id }));
        const role = { tank: 'Tank', healer: 'Healer', dps: 'Damage' }[spec.role];
        expect(html, `${cls}/${spec.id}`).toContain(`tt-player-spec">${spec.name} (`);
        expect(html, `${cls}/${spec.id}`).toContain(role);
      }
    }
  });

  it('renders the guild in classic brackets, escaped', () => {
    expect(playerHoverTooltipHtml(source({ guild: 'Order of Dawn' }))).toContain(
      '&lt;Order of Dawn&gt;',
    );
  });

  it('drops a spec id the class does not own instead of printing a raw id', () => {
    const html = playerHoverTooltipHtml(source({ templateId: 'mage', specId: 'holy' }));
    expect(html).not.toContain('tt-player-spec');
    expect(html).not.toContain('holy');
  });

  it('keeps the raw class id as the class label for an unknown class', () => {
    const html = playerHoverTooltipHtml(source({ templateId: 'toString', specId: 'holy' }));
    expect(html).toContain('Level 40 toString');
    expect(html).not.toContain('tt-player-spec');
  });
});
