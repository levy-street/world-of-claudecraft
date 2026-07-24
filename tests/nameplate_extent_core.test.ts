import { describe, expect, it } from 'vitest';
import {
  NAMEPLATE_CAST_BAR_ROW_PX,
  NAMEPLATE_COMBO_ROW_PX,
  NAMEPLATE_EMOTE_ROW_PX,
  NAMEPLATE_GUILD_ROW_PX,
  NAMEPLATE_HP_BAR_ROW_PX,
  NAMEPLATE_MIN_HEIGHT_PX,
  NAMEPLATE_NAME_ROW_PX,
  NAMEPLATE_TITLE_ROW_PX,
  nameplateHeightPx,
} from '../src/render/nameplate_extent_core';

const bare = () => nameplateHeightPx(false, false, false, false, false, false);

describe('nameplate extent core', () => {
  it('counts the name line for a plate with no optional rows', () => {
    expect(bare()).toBe(NAMEPLATE_NAME_ROW_PX);
    expect(bare()).toBe(NAMEPLATE_MIN_HEIGHT_PX);
  });

  it.each([
    ['hp bar', 0, NAMEPLATE_HP_BAR_ROW_PX],
    ['guild tag', 1, NAMEPLATE_GUILD_ROW_PX],
    ['deed title', 2, NAMEPLATE_TITLE_ROW_PX],
    ['cast bar', 3, NAMEPLATE_CAST_BAR_ROW_PX],
    ['combo pips', 4, NAMEPLATE_COMBO_ROW_PX],
    ['emote bubble', 5, NAMEPLATE_EMOTE_ROW_PX],
  ])('adds the %s row on its own, and nothing else', (_label, slot, rowPx) => {
    const rows = [false, false, false, false, false, false];
    rows[slot] = true;
    const height = nameplateHeightPx(rows[0], rows[1], rows[2], rows[3], rows[4], rows[5]);
    expect(height).toBe(NAMEPLATE_NAME_ROW_PX + rowPx);
    // each row is a distinct positional flag: no two share a slot
    expect(height).toBeGreaterThan(bare());
  });

  it('sums every row for a fully dressed player plate', () => {
    expect(nameplateHeightPx(true, true, true, true, true, true)).toBe(
      NAMEPLATE_NAME_ROW_PX +
        NAMEPLATE_HP_BAR_ROW_PX +
        NAMEPLATE_GUILD_ROW_PX +
        NAMEPLATE_TITLE_ROW_PX +
        NAMEPLATE_CAST_BAR_ROW_PX +
        NAMEPLATE_COMBO_ROW_PX +
        NAMEPLATE_EMOTE_ROW_PX,
    );
  });

  it('makes a guilded, titled player plate meaningfully taller than a bare mob plate', () => {
    const mob = nameplateHeightPx(true, false, false, false, false, false);
    const player = nameplateHeightPx(true, true, true, false, false, false);
    // the gap the old fixed 20px stack offset could not cover
    expect(player - mob).toBeGreaterThanOrEqual(20);
  });

  it('is pure: same flags give the same height', () => {
    expect(nameplateHeightPx(true, false, true, false, true, false)).toBe(
      nameplateHeightPx(true, false, true, false, true, false),
    );
  });
});
