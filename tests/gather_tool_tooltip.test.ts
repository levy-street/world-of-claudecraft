// Gathering-implement item tooltip lines (#2343): the pure string-builder
// composed inside Hud.itemTooltip. English copy asserted directly (the
// gather_node_tooltip.test.ts idiom); numbers must mirror the sim's own
// tuning constants (bite 1.5s and reel 0.75s per rod tier above 1, catch
// band b at rod tier b+1 over the 0/100/200 thresholds), never re-invented.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  FISH_BITE_DELAY_MAX_SEC,
  FISH_BITE_DELAY_MIN_SEC,
  FISH_BITE_DELAY_ROD_REDUCTION_SEC,
  fishingRodBandFor,
} from '../src/sim/professions/fishing';
import { gatherToolTooltipLines } from '../src/ui/gather_tool_tooltip';

describe('gatherToolTooltipLines: picks, axes, sickles', () => {
  it('a tier-1 pick states its kind, requirement, and use, with no speed line', () => {
    const html = gatherToolTooltipLines(ITEMS.copper_mining_pick);
    expect(html).toContain('<div class="tt-sub">Mining tool (tier 1)</div>');
    expect(html).toContain('<div class="tt-desc">Required to mine ore veins up to tier 1.</div>');
    expect(html).toContain('<div class="tt-desc">Use: Mine a nearby ore vein.</div>');
    expect(html).not.toContain('Gathers faster');
  });

  it('a tier-2 pick adds the speed line (0.4s per tier above the node)', () => {
    const html = gatherToolTooltipLines(ITEMS.iron_mining_pick);
    expect(html).toContain('<div class="tt-sub">Mining tool (tier 2)</div>');
    expect(html).toContain('<div class="tt-desc">Required to mine ore veins up to tier 2.</div>');
    expect(html).toContain('<div class="tt-desc">Gathers faster at nodes below tier 2.</div>');
  });

  it('land tools above tier 1 carry the wield requirement line; rods and the entry tools never do (R22)', () => {
    // The same "Requires {craft} {skill}" line the vendor's advisory sub-line
    // renders, read from the one wield table the harvest gate enforces.
    expect(gatherToolTooltipLines(ITEMS.iron_mining_pick)).toContain(
      '<div class="tt-desc">Requires Mining 40</div>',
    );
    expect(gatherToolTooltipLines(ITEMS.mithril_mining_pick)).toContain(
      '<div class="tt-desc">Requires Mining 70</div>',
    );
    expect(gatherToolTooltipLines(ITEMS.thorium_mining_pick)).toContain(
      '<div class="tt-desc">Requires Mining 85</div>',
    );
    expect(gatherToolTooltipLines(ITEMS.arcanite_mining_pick)).toContain(
      '<div class="tt-desc">Requires Mining 100</div>',
    );
    expect(gatherToolTooltipLines(ITEMS.ironbark_axe)).toContain(
      '<div class="tt-desc">Requires Logging 70</div>',
    );
    // Tier 1 asks nothing; rods are exempt at every tier.
    expect(gatherToolTooltipLines(ITEMS.copper_mining_pick)).not.toContain('Requires Mining');
    expect(gatherToolTooltipLines(ITEMS.tidewrought_fishing_rod)).not.toContain('Requires');
    expect(gatherToolTooltipLines(ITEMS.simple_fishing_pole)).not.toContain('Requires');
  });

  it('axes and sickles speak their own trade', () => {
    const axe = gatherToolTooltipLines(ITEMS.handaxe);
    expect(axe).toContain('<div class="tt-sub">Logging tool (tier 1)</div>');
    expect(axe).toContain(
      '<div class="tt-desc">Required to fell timber stands up to tier 1.</div>',
    );
    expect(axe).toContain('<div class="tt-desc">Use: Fell a nearby timber stand.</div>');
    const sickle = gatherToolTooltipLines(ITEMS.gathering_sickle);
    expect(sickle).toContain('<div class="tt-sub">Herbalism tool (tier 1)</div>');
    expect(sickle).toContain(
      '<div class="tt-desc">Required to gather herb patches up to tier 1.</div>',
    );
    expect(sickle).toContain('<div class="tt-desc">Use: Gather from a nearby herb patch.</div>');
  });
});

describe('gatherToolTooltipLines: fishing implements', () => {
  it('the simple pole keeps its use line and gains the required-to-fish line', () => {
    const html = gatherToolTooltipLines(ITEMS.simple_fishing_pole);
    expect(html).toContain('<div class="tt-desc">Use: Fish in nearby waters.</div>');
    expect(html).toContain('<div class="tt-desc">Required to fish.</div>');
    expect(html).not.toContain('Fishing rod (tier'); // the pole is not a tiered rod
    expect(html).not.toContain('Fish bite'); // and confers no bite bonus
  });

  it('the tier-2 rod states its exact bite, reel, and catch-band bonuses', () => {
    const html = gatherToolTooltipLines(ITEMS.ironreel_fishing_rod);
    expect(html).toContain('<div class="tt-sub">Fishing rod (tier 2)</div>');
    expect(html).toContain('<div class="tt-desc">Use: Fish in nearby waters.</div>');
    expect(html).toContain('<div class="tt-desc">Required to fish.</div>');
    // The access line, the same statement a pick makes about vein tiers. Its
    // absence was the reason a player could only learn the water refuses them
    // by being refused.
    expect(html).toContain('<div class="tt-desc">Required to fish waters up to tier 2.</div>');
    expect(html).toContain('<div class="tt-desc">Fish bite up to 1.5s sooner.</div>');
    // 0.75 is the TIER bonus alone: the ironreel is common, so its rarity rung
    // adds nothing. That is what makes the rods below decisive, since they are
    // the same tier ladder with a non-zero rarity term on top.
    expect(html).toContain('<div class="tt-desc">Extends the reel window by 0.75s.</div>');
    expect(html).toContain(
      '<div class="tt-desc">Unlocks richer catch tables at fishing skill 100 and above.</div>',
    );
  });

  it('the tier-3 rod scales every bonus (3s bite, 1.75s reel, skill 200)', () => {
    const html = gatherToolTooltipLines(ITEMS.silverstream_fishing_rod);
    expect(html).toContain('<div class="tt-sub">Fishing rod (tier 3)</div>');
    expect(html).toContain('<div class="tt-desc">Required to fish waters up to tier 3.</div>');
    expect(html).toContain('<div class="tt-desc">Fish bite up to 3s sooner.</div>');
    // 1.75, not 1.5: two tier rungs at 0.75 plus one UNCOMMON rarity rung at
    // 0.25. A tooltip reading the tier alone would under-promise the rod its
    // owner is holding.
    expect(html).toContain('<div class="tt-desc">Extends the reel window by 1.75s.</div>');
    expect(html).toContain(
      '<div class="tt-desc">Unlocks richer catch tables at fishing skill 200 and above.</div>',
    );
  });

  it('the crafted rods keep scaling their bonuses and stop claiming a band they do not open', () => {
    // There are three catch bands and a rod of tier T opens band T - 1, so
    // tier 3 already reaches the last one. The band index used to be clamped,
    // which made every rod above tier 3 repeat "skill 200 and above": a line
    // that is true of the rod BELOW it and tells the owner of a crafted rod
    // they bought something they already had. The bite and reel lines are the
    // real gains and must still scale.
    const stormreel = gatherToolTooltipLines(ITEMS.stormreel_fishing_rod);
    expect(stormreel).toContain('<div class="tt-sub">Fishing rod (tier 4)</div>');
    expect(stormreel).toContain('<div class="tt-desc">Required to fish waters up to tier 4.</div>');
    expect(stormreel).toContain('<div class="tt-desc">Fish bite up to 4.5s sooner.</div>');
    // 2.75: three tier rungs (2.25) plus RARE, two rarity rungs (0.5).
    expect(stormreel).toContain('<div class="tt-desc">Extends the reel window by 2.75s.</div>');
    expect(stormreel).not.toContain('Unlocks richer catch tables');

    const tidewrought = gatherToolTooltipLines(ITEMS.tidewrought_fishing_rod);
    expect(tidewrought).toContain('<div class="tt-sub">Fishing rod (tier 5)</div>');
    // 5s, not the 6s the raw 1.5-per-tier product gives: the sim floors the
    // bite window at FISH_BITE_DELAY_MIN_SEC, so the fifth rung's last 1.5
    // seconds buy nothing and the copy must not sell them.
    expect(tidewrought).toContain('<div class="tt-desc">Fish bite up to 5s sooner.</div>');
    expect(tidewrought).not.toContain('Fish bite up to 6s sooner.');
    // Tier 4 still lands strictly inside the clamp, so the two arms of the
    // clamp are both live rather than one being dead.
    expect(FISH_BITE_DELAY_MAX_SEC - FISH_BITE_DELAY_ROD_REDUCTION_SEC * 3).toBeGreaterThan(
      FISH_BITE_DELAY_MIN_SEC,
    );
    expect(FISH_BITE_DELAY_MAX_SEC - FISH_BITE_DELAY_ROD_REDUCTION_SEC * 4).toBeLessThan(
      FISH_BITE_DELAY_MIN_SEC,
    );
    // 3.75: four tier rungs (3) plus EPIC, three rarity rungs (0.75). Unlike
    // the bite line directly above, the reel window has no clamp, so the top
    // rung really does buy its full width and the copy may sell it.
    expect(tidewrought).toContain('<div class="tt-desc">Extends the reel window by 3.75s.</div>');
    expect(tidewrought).not.toContain('Unlocks richer catch tables');
    // The rarity term is what separates these two rods' reel lines by more
    // than the tier step alone, so a regression that dropped `item.quality` at
    // the call site would land both on the tier-only numbers.
    expect(stormreel).not.toContain('Extends the reel window by 2.25s.');
    expect(tidewrought).not.toContain('Extends the reel window by 3s.');
  });

  it('the band line appears exactly where the sim says a rod raises the ceiling', () => {
    // The tooltip and the engine now read ONE function for where the ladder
    // ends, so this walks every shipped rod tier and asserts they agree,
    // rather than trusting two copies of "there are three bands".
    let sawLine = 0;
    let sawNone = 0;
    for (const def of Object.values(ITEMS)) {
      const use = def.use;
      if (use?.type !== 'gatherTool' || use.professionId !== 'fishing') continue;
      const raises = fishingRodBandFor(use.tier) > fishingRodBandFor(use.tier - 1);
      const html = gatherToolTooltipLines(def);
      expect(html.includes('Unlocks richer catch tables'), `${def.id} band line`).toBe(raises);
      if (raises) sawLine += 1;
      else sawNone += 1;
    }
    // Both arms are live: two rods raise the ceiling, two do not.
    expect([sawLine, sawNone]).toEqual([2, 2]);
  });
});

describe('gatherToolTooltipLines: everything else', () => {
  it('renders nothing for non-implement items', () => {
    expect(gatherToolTooltipLines(ITEMS.copper_ore)).toBe('');
    expect(gatherToolTooltipLines(ITEMS.lesser_healing_potion)).toBe('');
  });
});

describe('hud composition source pin', () => {
  it('Hud.itemTooltip composes the module (one line, never inline logic)', () => {
    // Whole-line // comments are stripped before scanning so the negative pin
    // is not tripped by prose (the comment-gameable trap; block comments are
    // left alone: a /* strip would misfire on string and regex literals).
    const hudSrc = readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    expect(hudSrc).toContain('gatherToolTooltipLines(item)');
    // The legacy inline pole arm is gone: the module owns the fishing lines.
    expect(hudSrc).not.toContain("item.use?.type === 'fishing'");
  });
});
