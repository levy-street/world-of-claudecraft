// Gathering-implement item tooltip lines (#2343): the pure string-builder
// composed inside Hud.itemTooltip. English copy asserted directly (the
// gather_node_tooltip.test.ts idiom); numbers must mirror the sim's own
// tuning constants (bite 1.5s and reel 0.75s per rod tier above 1, catch
// band b at rod tier b+1 over the 0/100/200 thresholds), never re-invented.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
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
    expect(html).toContain('<div class="tt-desc">Fish bite up to 1.5s sooner.</div>');
    expect(html).toContain('<div class="tt-desc">Extends the reel window by 0.75s.</div>');
    expect(html).toContain(
      '<div class="tt-desc">Unlocks richer catch tables at fishing skill 100 and above.</div>',
    );
  });

  it('the tier-3 rod scales every bonus (3s bite, 1.5s reel, skill 200)', () => {
    const html = gatherToolTooltipLines(ITEMS.silverstream_fishing_rod);
    expect(html).toContain('<div class="tt-sub">Fishing rod (tier 3)</div>');
    expect(html).toContain('<div class="tt-desc">Fish bite up to 3s sooner.</div>');
    expect(html).toContain('<div class="tt-desc">Extends the reel window by 1.5s.</div>');
    expect(html).toContain(
      '<div class="tt-desc">Unlocks richer catch tables at fishing skill 200 and above.</div>',
    );
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
