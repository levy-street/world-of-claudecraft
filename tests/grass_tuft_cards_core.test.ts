import { describe, expect, it } from 'vitest';
import { gfxInternalsForTest } from '../src/render/gfx';
import {
  GRASS_CARDS_FULL,
  GRASS_CARDS_LEAN,
  GRASS_CARDS_MID,
  grassCardCount,
  grassTuftCards,
  grassTuftHasCap,
  grassTuftTriangles,
  TRIANGLES_PER_GRASS_CARD,
} from '../src/render/grass_tuft_cards_core';

const TIERS = ['low', 'medium', 'high', 'ultra', 'insane'] as const;

// The weak-integrated-GPU adapter string that puts a MEDIUM session on the lean
// foliage path (gfx.ts isWeakIntegratedGpu).
const WEAK_IGPU = { gpuRenderer: 'ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11)' };

describe('grass tuft card ladder', () => {
  it('sheds the sky-facing cap before the 45-degree breaker', () => {
    // The shed ORDER is the whole point: the two uprights are the tuft, the
    // diagonal breaks their cross, and the cap is what the carpet tiers already
    // collapse near the player, so it goes first.
    expect(grassTuftCards(GRASS_CARDS_FULL, true).map((c) => c.id)).toEqual([
      'upright',
      'upright-cross',
      'diagonal',
      'cap',
    ]);
    expect(grassTuftCards(GRASS_CARDS_MID, true).map((c) => c.id)).toEqual([
      'upright',
      'upright-cross',
      'diagonal',
    ]);
    expect(grassTuftCards(GRASS_CARDS_LEAN, true).map((c) => c.id)).toEqual([
      'upright',
      'upright-cross',
    ]);
  });

  it('carries the aCap attribute value only on the cap card', () => {
    const full = grassTuftCards(GRASS_CARDS_FULL, true);
    expect(full.filter((c) => c.cap === 1).map((c) => c.id)).toEqual(['cap']);
    expect(grassTuftCards(GRASS_CARDS_MID, true).every((c) => c.cap === 0)).toBe(true);
    expect(grassTuftHasCap(GRASS_CARDS_FULL)).toBe(true);
    expect(grassTuftHasCap(GRASS_CARDS_MID)).toBe(false);
    expect(grassTuftHasCap(GRASS_CARDS_LEAN)).toBe(false);
  });

  it('keeps the shipped placement of every card byte for byte', () => {
    // Pinned so a refactor of the merge loop in foliage.ts cannot silently move
    // a card: these are the exact numbers the inline PlaneGeometry chain used.
    const [upright, cross, diagonal, cap] = grassTuftCards(GRASS_CARDS_FULL, true);
    expect(upright).toEqual({
      id: 'upright',
      width: 1.45,
      height: 0.9,
      preRotX: 0,
      liftY: 0.4,
      rotZ: 0,
      rotY: 0,
      cap: 0,
    });
    expect(cross.rotY).toBeCloseTo(Math.PI / 2, 12);
    expect({ w: cross.width, h: cross.height, lift: cross.liftY }).toEqual({
      w: 1.45,
      h: 0.9,
      lift: 0.4,
    });
    expect({
      w: diagonal.width,
      h: diagonal.height,
      lift: diagonal.liftY,
      z: diagonal.rotZ,
    }).toEqual({ w: 1.15, h: 1.05, lift: 0.45, z: 0.12 });
    expect(diagonal.rotY).toBeCloseTo(Math.PI / 4, 12);
    expect({ w: cap.width, h: cap.height, lift: cap.liftY }).toEqual({
      w: 1.05,
      h: 1.05,
      lift: 0.34,
    });
    expect(cap.preRotX).toBeCloseTo(-Math.PI / 2 + 0.18, 12);
    // The cap lies down BEFORE it is lifted; swapping the two would sink it.
    expect(cap.preRotX).not.toBe(0);
    expect(cap.rotZ).toBe(0);
    expect(cap.rotY).toBe(0);
  });

  it('keeps the lean silhouette and its lowPlus art bump off the lush sizes', () => {
    const lean = grassTuftCards(GRASS_CARDS_LEAN, false, 1.08);
    expect(lean.every((c) => c.id === 'upright' || c.id === 'upright-cross')).toBe(true);
    expect(lean[0].width).toBeCloseTo(1.1 * 1.08, 12);
    expect(lean[0].height).toBeCloseTo(0.7 * 1.08, 12);
    expect(lean[0].liftY).toBeCloseTo(0.35 * 1.08, 12);
    // lowPlus never reaches a lush tier's card sizes.
    expect(grassTuftCards(GRASS_CARDS_FULL, true, 1.08)[0].width).toBe(1.45);
  });

  it('never hands a LEAN tuft the lush-only diagonal or cap, whatever it is asked for', () => {
    // The diagonal (1.15 x 1.05, lift 0.45) and the cap are authored at lush
    // proportions only. On a lean tuft, whose uprights are 0.756 tall lifted
    // 0.378, a 1.05-tall breaker stands visibly out the top; and a lean
    // session runs the lean model set precisely because its hardware cannot
    // afford extra cards. Before the count was a knob this was structural
    // (the extra cards were built inside an `if (lush)`), and it stays
    // structural: the Advanced Foliage Density dial can raise the knob on a
    // low tier, so a rule the caller has to remember is not enough.
    for (const asked of [GRASS_CARDS_MID, GRASS_CARDS_FULL, 99]) {
      expect(
        grassTuftCards(asked, false).map((c) => c.id),
        `asked ${asked}`,
      ).toEqual(['upright', 'upright-cross']);
      expect(grassCardCount(asked, false)).toBe(GRASS_CARDS_LEAN);
      expect(grassTuftTriangles(asked, false)).toBe(4);
      expect(grassTuftHasCap(asked, false)).toBe(false);
    }
    // No card the lean arm can emit carries an unscaled lush size.
    for (const card of grassTuftCards(GRASS_CARDS_FULL, false, 1.08)) {
      expect(card.width, card.id).toBeCloseTo(1.1 * 1.08, 12);
    }
  });

  it('clamps a stray knob value onto the shipped ladder, always downward', () => {
    expect(grassCardCount(0)).toBe(GRASS_CARDS_LEAN);
    expect(grassCardCount(9)).toBe(GRASS_CARDS_FULL);
    expect(grassCardCount(3.7)).toBe(GRASS_CARDS_MID);
    // A cost knob fails to the CHEAPEST rung, the same direction
    // canopy_detail_tier_core.ts takes: failing open is how a garbage value
    // ends up charging the weakest hardware the most.
    expect(grassCardCount(Number.NaN)).toBe(GRASS_CARDS_LEAN);
    expect(grassCardCount(Number.POSITIVE_INFINITY)).toBe(GRASS_CARDS_LEAN);
  });
});

describe('grass tuft triangle cost per tier', () => {
  // Every card is one double-sided PlaneGeometry: two triangles.
  it('prices a card at two triangles', () => {
    expect(TRIANGLES_PER_GRASS_CARD).toBe(2);
    expect(grassTuftTriangles(GRASS_CARDS_LEAN)).toBe(4);
    expect(grassTuftTriangles(GRASS_CARDS_MID)).toBe(6);
    expect(grassTuftTriangles(GRASS_CARDS_FULL)).toBe(8);
  });

  it('pins the per-tier tuft geometry the live build merges', () => {
    const cardsFor = (tier: (typeof TIERS)[number], hints?: { gpuRenderer: string }) =>
      gfxInternalsForTest.settingsFor(tier, hints).grassCardsPerTuft;
    expect(TIERS.map((tier) => [tier, cardsFor(tier), grassTuftTriangles(cardsFor(tier))])).toEqual(
      [
        ['low', 2, 4],
        ['medium', 3, 6],
        ['high', 3, 6],
        ['ultra', 4, 8],
        ['insane', 4, 8],
      ],
    );
    // The lean MEDIUM session (weak integrated GPU) keeps the legacy pair.
    expect(gfxInternalsForTest.settingsFor('medium', WEAK_IGPU).leanFoliage).toBe(true);
    expect(cardsFor('medium', WEAK_IGPU)).toBe(GRASS_CARDS_LEAN);
    expect(grassTuftTriangles(cardsFor('medium', WEAK_IGPU))).toBe(4);
  });

  it('never lets a lower tier draw more tuft geometry than the one above it', () => {
    const counts = TIERS.map((tier) => gfxInternalsForTest.settingsFor(tier).grassCardsPerTuft);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i], `${TIERS[i]} vs ${TIERS[i - 1]}`).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });

  it('keeps the Advanced Foliage Density dial off a lean session, at every level', () => {
    // The dial remaps the same derived knobs the tier ladder sets, so without
    // a clamp it would hand a low tier three or four cards it has never had,
    // on the weakest hardware in the fleet.
    for (const foliageDensity of [0, 0.5, 1, 2]) {
      for (const [tier, hints] of [
        ['low', {}],
        ['medium', WEAK_IGPU],
      ] as const) {
        const settings = gfxInternalsForTest.settingsFor(tier, {
          graphicsPreset: 5,
          foliageDensity,
          ...hints,
        });
        expect(settings.leanFoliage, `${tier} ${foliageDensity}`).toBe(true);
        expect(settings.grassCardsPerTuft, `${tier} ${foliageDensity}`).toBe(GRASS_CARDS_LEAN);
      }
    }
    // The same dial still reaches the full ladder on a non-lean session.
    const lush = (foliageDensity: number) =>
      gfxInternalsForTest.settingsFor('high', { graphicsPreset: 5, foliageDensity })
        .grassCardsPerTuft;
    expect([lush(0), lush(0.5), lush(1), lush(2)]).toEqual([2, 3, 4, 4]);
  });

  it('agrees with what the build actually merges, so the knob never lies', () => {
    // gfx.ts clamps the knob and the core clamps the plan; if the two ever
    // disagreed, GFX.grassCardsPerTuft would report a count the meadow does
    // not have.
    for (const tier of TIERS) {
      for (const hints of [undefined, WEAK_IGPU, { graphicsPreset: 5, foliageDensity: 2 }]) {
        const s = gfxInternalsForTest.settingsFor(tier, hints);
        const built = grassTuftCards(s.grassCardsPerTuft, !s.leanFoliage).length;
        expect(built, `${tier} ${JSON.stringify(hints ?? null)}`).toBe(s.grassCardsPerTuft);
      }
    }
  });
});
