// Pins the English Nythraxis Raid Boss Guide prose (src/ui/i18n.catalog/hud_chrome.ts)
// against the second playtest tuning pass: heroic Grave Flame and Soulfire burn out on
// a finite timer (no more "permanent" floor fire), heroic Soulfire pools group by the
// Soul Rend stack point instead of overlapping into stacked damage (Normal keeps one
// pool per marked raider and still stacks overlapping ticks, unchanged), and every
// offensive Nythraxis effect reads purple on both difficulties.

import { describe, expect, it } from 'vitest';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

const nythraxis = hudChromeStrings.raidBossGuide.nythraxis;

describe('Nythraxis raid boss guide prose: second playtest tuning', () => {
  it('describes heroic Grave Flame as a finite burn, not a permanent floor fire', () => {
    expect(nythraxis.graveEruptionHeroicSummary).toContain('{flameHeroic}');
    expect(nythraxis.graveEruptionHeroicSummary).not.toMatch(/rest of the phase/i);
    expect(nythraxis.graveEruptionHeroicSummary).not.toMatch(/never goes? out/i);
  });

  it('describes heroic Soulfire as a finite burn, not a permanent floor fire', () => {
    expect(nythraxis.soulfireHeroicSummary).toContain('{secondsHeroic}');
    expect(nythraxis.soulfireHeroicSummary).not.toMatch(/rest of the phase/i);
    expect(nythraxis.soulfireHeroicSummary).not.toMatch(/never go(es)? out/i);
  });

  it('groups Soulfire into one pool per stacked mark group on Heroic only', () => {
    expect(nythraxis.soulfireHeroicSummary).toMatch(/one pool.*per stacked group/i);
    expect(nythraxis.soulfireHeroicSummary).toMatch(/only one tick/i);
  });

  it('keeps Normal Soulfire one pool per mark, with overlapping pools still stacking', () => {
    expect(nythraxis.soulfireSummary).not.toMatch(/per stacked group/i);
    expect(nythraxis.soulfireSummary).not.toMatch(/only one tick/i);
    expect(nythraxis.soulfireSummary).toMatch(/pool of purple fire .* where each mark stood/i);
    expect(nythraxis.soulfireSummary).toMatch(/tick from each one/i);
  });

  it('leaves Normal Grave Flame prose untouched by the heroic-only Soulfire fix', () => {
    expect(nythraxis.graveEruptionSummary).toContain('{flameNormal}');
  });

  it('reads every offensive Nythraxis fire as purple on both difficulties', () => {
    expect(nythraxis.soulfireSummary).toMatch(/purple fire/i);
    expect(nythraxis.soulfireHeroicSummary).toMatch(/purple fire/i);
    expect(nythraxis.gravefireSummary).toMatch(/violet grave-fire/i);
    expect(nythraxis.gravefireHeroicSummary).toMatch(/violet grave-fire/i);
  });

  it('directs the Soul Rend finder chip to stack, not spread, matching the live stack-damage-split mechanic', () => {
    const soulRendChip = hudChromeStrings.finder.mech.soul_rend;
    expect(soulRendChip).toMatch(/stack together/i);
    expect(soulRendChip).toMatch(/leave the fire/i);
    expect(soulRendChip).not.toMatch(/spread/i);
  });
});
