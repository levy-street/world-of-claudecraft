// Pins the English Nythraxis Raid Boss Guide prose (src/ui/i18n.catalog/hud_chrome.ts)
// against the live mechanics: heroic Grave Flame burns out on a finite timer (no more
// "permanent" floor fire), every offensive Nythraxis effect reads purple on both
// difficulties, Soulfire is gone from the guide because it is gone from the fight
// (v0.42.2), and Bone Spike tells the raid about its per-raider cooldown.

import { describe, expect, it } from 'vitest';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

const nythraxis = hudChromeStrings.raidBossGuide.nythraxis;

describe('Nythraxis raid boss guide prose: second playtest tuning', () => {
  it('describes heroic Grave Flame as a finite burn, not a permanent floor fire', () => {
    expect(nythraxis.graveEruptionHeroicSummary).toContain('{flameHeroic}');
    expect(nythraxis.graveEruptionHeroicSummary).not.toMatch(/rest of the phase/i);
    expect(nythraxis.graveEruptionHeroicSummary).not.toMatch(/never goes? out/i);
  });

  it('says nothing about Soulfire anywhere in the guide: the pools are gone from the fight', () => {
    // The row itself is gone (no key), and no other row still tells the raid
    // to rotate off, leave, or avoid Soul Rend fire.
    expect(Object.keys(nythraxis).some((k) => /soulfire/i.test(k))).toBe(false);
    for (const [k, prose] of Object.entries(nythraxis)) {
      expect(prose, k).not.toMatch(/soulfire/i);
    }
    expect(nythraxis.soulRendResponse).not.toMatch(/fire|pool/i);
    expect(hudChromeStrings.finder.mech).not.toHaveProperty('soulfire');
  });

  it('leaves Normal Grave Flame prose untouched', () => {
    expect(nythraxis.graveEruptionSummary).toContain('{flameNormal}');
  });

  it('says nothing about Gravefire anywhere in the guide: the line is gone from the fight', () => {
    expect(Object.keys(nythraxis).some((k) => /gravefire/i.test(k))).toBe(false);
    for (const [k, prose] of Object.entries(nythraxis)) {
      expect(prose, k).not.toMatch(/gravefire|grave-fire/i);
    }
    expect(hudChromeStrings.finder.mech).not.toHaveProperty('gravefire');
  });

  it('tells the raid a spike is a ward: hits to shatter on both difficulties', () => {
    expect(nythraxis.boneSpikeSummary).toContain('{hitsNormal}');
    expect(nythraxis.boneSpikeHeroicSummary).toContain('{hitsHeroic}');
    for (const prose of [nythraxis.boneSpikeSummary, nythraxis.boneSpikeHeroicSummary]) {
      expect(prose).toMatch(/hits from anyone, whatever the hits deal/i);
    }
    expect(nythraxis.boneSpikeResponse).toMatch(/hits from anyone/i);
  });

  it("places the sigil beside the boss on the raid's left or right, alternating", () => {
    for (const prose of [nythraxis.bindingSigilSummary, nythraxis.bindingSigilHeroicSummary]) {
      expect(prose).toContain('{sideOffset}');
      expect(prose).not.toMatch(/\{minDist\}|\{maxDist\}/);
      expect(prose).toMatch(/left or right/i);
      expect(prose).toMatch(/switching sides every cast/i);
    }
  });

  it('tells the raid about the per-raider Bone Spike cooldown on both difficulties', () => {
    for (const prose of [nythraxis.boneSpikeSummary, nythraxis.boneSpikeHeroicSummary]) {
      expect(prose).toContain('{cooldown}');
      expect(prose).toMatch(/cannot be chosen again for \{cooldown\} sec/i);
    }
  });

  it('directs the Soul Rend finder chip to stack, not spread, matching the live stack-damage-split mechanic', () => {
    const soulRendChip = hudChromeStrings.finder.mech.soul_rend;
    expect(soulRendChip).toMatch(/stack together/i);
    expect(soulRendChip).toMatch(/split the damage/i);
    expect(soulRendChip).not.toMatch(/fire|spread/i);
  });
});
