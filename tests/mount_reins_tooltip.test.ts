import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { Hud } from '../src/ui/hud';

interface TooltipHarness {
  sim: {
    player: { level: number };
    cfg: { playerClass: string };
    equipment: Record<string, string>;
  };
  itemTooltip(item: ItemDef, compare?: boolean): string;
}

describe('mount reins item tooltip', () => {
  it('advertises direct summon use exactly once and never mentions a picker', () => {
    const hud = Object.create(Hud.prototype) as unknown as TooltipHarness;
    hud.sim = {
      player: { level: 60 },
      cfg: { playerClass: 'warrior' },
      equipment: {},
    };

    const html = hud.itemTooltip(ITEMS.reins_grag_bear, false);

    expect(html.match(/Use to summon this mount\./g)).toHaveLength(1);
    expect(html).not.toContain('choose your mount');
  });
});
