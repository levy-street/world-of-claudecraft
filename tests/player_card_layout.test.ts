// Pure layout math for the player card compositor (#3125). The canvas
// compositor itself is browser-only (renderPlayerCardCanvas needs
// document/fonts/Image), so this suite pins the DOM-free geometry in
// card_layout.ts directly: a fully populated card's regions must reflow so
// nothing overlaps or overflows its panel, and a minimal card keeps its
// original tight geometry.
import { describe, expect, it } from 'vitest';
import {
  cardTitleLayout,
  DEV_BADGE_CY,
  DEV_BADGE_R,
  GEAR_Y,
  gearLastRowNameBaseline,
  gearPanelHeight,
  HOLDER_BADGE_CY,
  HOLDER_BADGE_R,
  holderBadgeTextLayout,
  REALM_BASELINE,
  STATS_H,
  STATS_Y,
  statRowHeight,
  statsLastRowBaseline,
  TITLE_BASELINE,
} from '../src/ui/hud/player_card/card_layout';

describe('card_layout (the pure reflow gate for a fully populated card)', () => {
  it('the title row never collides with the realm baseline above it', () => {
    // A visual line's readable extent is roughly its font size; both lines
    // use ~19px type, so a gap at least that wide is a real, non-overlapping
    // row rather than two lines sharing the same baseline (the #3125 bug).
    expect(TITLE_BASELINE - REALM_BASELINE).toBeGreaterThanOrEqual(19);
  });

  it('the dev badge sits below the title row and clears the stats panel above it', () => {
    const devBadgeTop = DEV_BADGE_CY - DEV_BADGE_R;
    expect(devBadgeTop).toBeGreaterThan(TITLE_BASELINE);
    const devBadgeBottom = DEV_BADGE_CY + DEV_BADGE_R;
    expect(devBadgeBottom).toBeLessThan(STATS_Y);
  });

  it('a maximal 6-row stat column (base 4 + arena + prestige) stays inside the fixed panel', () => {
    const maxRows = 6;
    const lastBaseline = statsLastRowBaseline(maxRows);
    // 14px bottom pad below the last row's baseline, matching drawStatColumn's
    // ~20px glyph descent plus breathing room.
    expect(lastBaseline + 14).toBeLessThanOrEqual(STATS_Y + STATS_H);
  });

  it('row height shrinks only as far as needed, and never below the readable floor', () => {
    expect(statRowHeight(4)).toBeGreaterThanOrEqual(statRowHeight(6));
    expect(statRowHeight(6)).toBeGreaterThanOrEqual(18);
    // A light column (2-3 rows) keeps the original generous 27px spacing.
    expect(statRowHeight(2)).toBe(27);
  });

  it('a full 5-slot gear panel (mainhand/offhand/chest/legs/feet, 3 rows) fits its own panel', () => {
    const gearCount = 5;
    const h = gearPanelHeight(gearCount);
    const lastNameBaseline = gearLastRowNameBaseline(gearCount);
    expect(lastNameBaseline + 14).toBeLessThanOrEqual(GEAR_Y + h);
  });

  it('the gear panel never runs into the holder badge band below it', () => {
    const gearBottom = GEAR_Y + gearPanelHeight(5);
    const holderBadgeTop = HOLDER_BADGE_CY - HOLDER_BADGE_R;
    expect(gearBottom).toBeLessThan(holderBadgeTop);
  });

  it('a fewer-slot gear panel (minimal card, no offhand) shrinks with the content', () => {
    expect(gearPanelHeight(4)).toBeLessThan(gearPanelHeight(5));
    // 5 and 6 slots both round up to 3 rows (2 per row); 7 needs a 4th row.
    expect(gearPanelHeight(6)).toBe(gearPanelHeight(5));
    expect(gearPanelHeight(7)).toBeGreaterThan(gearPanelHeight(5));
  });

  it('the holder badge text clamp is measured from the panel, well past the old ~210/220 fixed widths', () => {
    const { maxW } = holderBadgeTextLayout();
    expect(maxW).toBeGreaterThan(220);
  });

  it('a long title still fits its own full-width row (no clip to the old ~40px floor)', () => {
    const line = cardTitleLayout('the Truly Exceptionally Resplendent and Undying Ashbringer')!;
    expect(line.maxW).toBeGreaterThan(400);
  });

  it('an untitled minimal card draws nothing extra (byte-identical layout guarantee)', () => {
    expect(cardTitleLayout(undefined)).toBeNull();
    expect(cardTitleLayout('')).toBeNull();
  });
});
