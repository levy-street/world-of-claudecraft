// The Riftbound band tooltip painter (src/ui/rift_band_tooltip.ts): the
// per-copy item-level readout, the rank/upgrade/socket lines, and the gem's
// own socket-bonus line, each rendered through the catalog.
import { describe, expect, it } from 'vitest';
import { RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import { ITEMS } from '../src/sim/data';
import { itemLevel, itemScore } from '../src/sim/item_level';
import {
  RIFT_GEM_RATING,
  RIFT_GEM_RATING_STAT,
  riftBandItemLevel,
} from '../src/sim/rift/band_ladder';
import { createRiftGearInstance } from '../src/sim/rift/progression';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';
import { Hud } from '../src/ui/hud';
import { t } from '../src/ui/i18n';
import { itemNumber } from '../src/ui/item_instance_tooltip';
import {
  itemLevelReadout,
  riftBandTooltipLines,
  riftGemTooltipLines,
} from '../src/ui/rift_band_tooltip';

describe('rift band tooltip: item level readout', () => {
  it('an authored piece reads exactly what item_level.ts derives for it', () => {
    const ring = ITEMS.seal_of_the_forgewall;
    expect(itemLevelReadout(ring)).toEqual({ level: itemLevel(ring), score: itemScore(ring) });
    // A sourceless piece has no readout (the tooltip omits the lines).
    const shell = ITEMS.riftbound_band_of_might;
    expect(itemLevelReadout(shell)).toBeUndefined();
  });

  it('a band copy reads its ladder level and scores its rolled line', () => {
    const band = createRiftGearInstance('tt', 'A', 'warrior', 1, 3);
    const readout = itemLevelReadout(ITEMS[band.itemId], band.instance);
    const rolled = band.instance.rolled?.stats ?? {};
    expect(readout).toEqual({
      level: riftBandItemLevel('A', 3),
      score: (rolled.str ?? 0) + (rolled.sta ?? 0),
    });
    // Gem ratings are off the score, like every rating line in itemScore.
    band.instance.rift?.gems.push('rift_gem_verdant');
    band.instance.rolled = { stats: { ...rolled, hitRating: RIFT_GEM_RATING } };
    expect(itemLevelReadout(ITEMS[band.itemId], band.instance)?.score).toBe(readout?.score);
  });
});

describe('rift band tooltip: lines', () => {
  it('renders the rank, upgrade, and socket lines for a band and nothing for a plain copy', () => {
    const band = createRiftGearInstance('tt', 'S', 'mage', 1, 2);
    band.instance.rift?.gems.push('rift_gem_azure');
    const html = riftBandTooltipLines(band.instance);
    expect(html).toContain(t('hudChrome.itemSoulbound'));
    expect(html).toContain(t('hudChrome.itemTooltip.riftTier', { tier: 'S' }));
    expect(html).toContain(t('hudChrome.itemTooltip.riftUpgrade', { level: '2', max: '5' }));
    expect(html).toContain(t('hudChrome.itemTooltip.riftSockets', { used: '1', total: '2' }));
    expect(riftBandTooltipLines({ rolled: { stats: { str: 1 } } })).toBe('');
    expect(riftBandTooltipLines(undefined)).toBe('');
  });

  it("a gem's tooltip states the socket bonus its colour grants", () => {
    for (const gemId of RIFT_GEM_IDS) {
      const html = riftGemTooltipLines(ITEMS[gemId]);
      expect(html).toContain(t('hudChrome.itemTooltip.riftGemSocket'));
      expect(html).toContain(
        t('itemUi.tooltip.stat', {
          value: String(RIFT_GEM_RATING),
          stat: t(`hudChrome.statInfo.names.${RIFT_GEM_RATING_STAT[gemId]}`),
        }),
      );
    }
    expect(riftGemTooltipLines(ITEMS.rift_essence)).toBe('');
    expect(riftGemTooltipLines(ITEMS.seal_of_the_forgewall)).toBe('');
  });
});

// The live Hud tooltip wiring: itemTooltip must actually call itemLevelReadout
// for the Item Level / Score lines, not just leave it importable and tested in
// isolation. A band copy has no drop-source itemLevel (item_level.ts's
// itemInstanceLevel returns undefined for it), so a wiring that skipped
// itemLevelReadout would silently drop the whole readout for band gear while
// leaving it intact for ordinary drops, the way tests/masterwrought_tooltip.ts
// and tests/weapon_type_tooltip.ts drive Hud.prototype directly (no
// constructor, no DOM).
interface TooltipHarness {
  sim: {
    player: { level: number };
    cfg: { playerClass: string };
    equipment: Record<string, string>;
  };
  optionsHooks: { settings: { get(key: string): unknown } } | null;
  itemTooltip(item: ItemDef, compare?: boolean, instance?: ItemInstancePayload): string;
}

function harness(): TooltipHarness {
  const hud = Object.create(Hud.prototype) as unknown as TooltipHarness;
  hud.sim = { player: { level: 80 }, cfg: { playerClass: 'warrior' }, equipment: {} };
  hud.optionsHooks = { settings: { get: (key) => key === 'showItemLevel' } };
  return hud;
}

describe('rift band tooltip: the live Hud wiring', () => {
  it('renders the Item Level / Score lines for an ordinary drop (sanity)', () => {
    const ring = ITEMS.seal_of_the_forgewall;
    const html = harness().itemTooltip(ring, false);
    expect(html).toContain(
      t('hudChrome.options.itemLevelLine', { level: itemNumber(itemLevel(ring) as number) }),
    );
    expect(html).toContain(
      t('hudChrome.options.itemScoreLine', { score: itemNumber(itemScore(ring), 1) }),
    );
  });

  it('renders the Item Level / Score lines for a Riftbound band copy, priced off its own ladder', () => {
    const band = createRiftGearInstance('tt', 'A', 'warrior', 1, 3);
    band.instance.rolled = { quality: 'epic', stats: { str: 12, sta: 7 } };
    const item = ITEMS[band.itemId];
    const html = harness().itemTooltip(item, false, band.instance);
    const readout = itemLevelReadout(item, band.instance);
    expect(readout).toEqual({ level: riftBandItemLevel('A', 3), score: 19 });
    expect(html).toContain(
      t('hudChrome.options.itemLevelLine', { level: itemNumber(readout?.level as number) }),
    );
    expect(html).toContain(
      t('hudChrome.options.itemScoreLine', { score: itemNumber(readout?.score as number, 1) }),
    );
  });
});
