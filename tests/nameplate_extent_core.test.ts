import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NAMEPLATE_BASE_HEIGHT_PX,
  NAMEPLATE_CAST_BAR_ROW_PX,
  NAMEPLATE_COMBO_ROW_PX,
  NAMEPLATE_EMOTE_ROW_PX,
  NAMEPLATE_GUILD_ROW_PX,
  NAMEPLATE_HP_BAR_ROW_PX,
  NAMEPLATE_MARKER_ROW_PX,
  NAMEPLATE_MAX_HEIGHT_PX,
  NAMEPLATE_NAME_ROW_PX,
  NAMEPLATE_RAID_MARK_ROW_PX,
  NAMEPLATE_TITLE_ROW_PX,
  NP_ROW_CAST_BAR,
  NP_ROW_COMBO,
  NP_ROW_EMOTE,
  NP_ROW_GUILD,
  NP_ROW_HP_BAR,
  NP_ROW_MARKER,
  NP_ROW_RAID_MARK,
  NP_ROW_TITLE,
  nameplateHeightPx,
  nameplatePlateKind,
  nameplateRowMask,
} from '../src/render/nameplate_extent_core';
import type { Entity } from '../src/sim/types';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// Two sheets, on purpose: the nameplate rows live in hud.css EXCEPT the
// linked-Discord PFP, which sits in index.extra.css and is part of the name row.
const HUD_CSS = `${readFileSync(join(repoRoot, 'src/styles/hud.css'), 'utf8')}\n${readFileSync(
  join(repoRoot, 'src/styles/index.extra.css'),
  'utf8',
)}`;

/** The declared px value of one property inside one `.np-*` rule in hud.css. */
function cssPx(selector: string, prop: string): number {
  const block = new RegExp(`\\n\\s*\\${selector}\\s*\\{([^}]*)\\}`).exec(HUD_CSS);
  expect(block, `${selector} rule missing from hud.css`).not.toBeNull();
  const decl = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(block?.[1] ?? '');
  expect(decl, `${selector} { ${prop} } missing from hud.css`).not.toBeNull();
  const px = /(-?\d+(?:\.\d+)?)px/.exec(decl?.[1] ?? '');
  expect(px, `${selector} { ${prop} } is not a px value`).not.toBeNull();
  return Number(px?.[1]);
}

function entity(over: Partial<Entity>): Entity {
  return {
    id: 1,
    kind: 'mob',
    name: 'Wolf',
    templateId: 'forest_wolf',
    dead: false,
    hostile: true,
    questIds: [],
    guild: '',
    title: null,
    ...over,
  } as unknown as Entity;
}

describe('nameplate extent core: row model', () => {
  it('counts the name line for a plate with no optional rows', () => {
    expect(nameplateHeightPx(0)).toBe(NAMEPLATE_BASE_HEIGHT_PX);
    expect(NAMEPLATE_BASE_HEIGHT_PX).toBe(NAMEPLATE_NAME_ROW_PX);
  });

  it.each([
    ['hp bar', NP_ROW_HP_BAR, NAMEPLATE_HP_BAR_ROW_PX],
    ['guild tag', NP_ROW_GUILD, NAMEPLATE_GUILD_ROW_PX],
    ['deed title', NP_ROW_TITLE, NAMEPLATE_TITLE_ROW_PX],
    ['cast bar', NP_ROW_CAST_BAR, NAMEPLATE_CAST_BAR_ROW_PX],
    ['combo pips', NP_ROW_COMBO, NAMEPLATE_COMBO_ROW_PX],
    ['emote bubble', NP_ROW_EMOTE, NAMEPLATE_EMOTE_ROW_PX],
    ['raid marker', NP_ROW_RAID_MARK, NAMEPLATE_RAID_MARK_ROW_PX],
    ['marker slot', NP_ROW_MARKER, NAMEPLATE_MARKER_ROW_PX],
  ])('adds the %s row on its own bit, and nothing else', (_label, bit, rowPx) => {
    expect(nameplateHeightPx(bit)).toBe(NAMEPLATE_BASE_HEIGHT_PX + rowPx);
    // each row owns a distinct bit: no two share one
    expect(nameplateHeightPx(bit)).toBeGreaterThan(nameplateHeightPx(0));
  });

  it('sums every row for a fully dressed player plate', () => {
    const all =
      NP_ROW_MARKER |
      NP_ROW_HP_BAR |
      NP_ROW_GUILD |
      NP_ROW_TITLE |
      NP_ROW_CAST_BAR |
      NP_ROW_COMBO |
      NP_ROW_EMOTE |
      NP_ROW_RAID_MARK;
    expect(nameplateHeightPx(all)).toBe(NAMEPLATE_MAX_HEIGHT_PX);
    expect(NAMEPLATE_MAX_HEIGHT_PX).toBe(
      NAMEPLATE_BASE_HEIGHT_PX +
        NAMEPLATE_HP_BAR_ROW_PX +
        NAMEPLATE_GUILD_ROW_PX +
        NAMEPLATE_TITLE_ROW_PX +
        NAMEPLATE_CAST_BAR_ROW_PX +
        NAMEPLATE_COMBO_ROW_PX +
        NAMEPLATE_EMOTE_ROW_PX +
        NAMEPLATE_RAID_MARK_ROW_PX +
        NAMEPLATE_MARKER_ROW_PX,
    );
  });

  it('makes a guilded, titled player plate meaningfully taller than a bare mob plate', () => {
    const mob = nameplateHeightPx(NP_ROW_HP_BAR);
    const player = nameplateHeightPx(NP_ROW_HP_BAR | NP_ROW_GUILD | NP_ROW_TITLE);
    // the gap the old fixed 20px stack offset could not cover
    expect(player - mob).toBeGreaterThanOrEqual(20);
  });
});

// The row constants mirror src/styles/hud.css by hand, and under-estimating one
// silently re-introduces the overlap the stacking pass exists to remove. These
// re-derive each row's box from the live CSS, so a rule edit fails here.
describe('nameplate extent core: hud.css drift guard', () => {
  it('covers the always-laid-out marker slot', () => {
    expect(NAMEPLATE_MARKER_ROW_PX).toBeGreaterThanOrEqual(cssPx('.np-marker', 'height'));
  });

  it('covers the hp bar including its content-box borders and margin', () => {
    // content-box + the thick boss border (2px per side) + the 1px top margin
    const bar =
      cssPx('.np-hpbar', 'height') + 2 * cssPx('.nameplate .np-hpbar.boss', 'border-width');
    expect(NAMEPLATE_HP_BAR_ROW_PX).toBeGreaterThanOrEqual(bar + 1);
  });

  it('covers the cast bar including its borders and margin', () => {
    expect(NAMEPLATE_CAST_BAR_ROW_PX).toBeGreaterThanOrEqual(cssPx('.np-castbar', 'height') + 3);
  });

  it('covers the combo pip row and its margin', () => {
    expect(NAMEPLATE_COMBO_ROW_PX).toBeGreaterThanOrEqual(cssPx('.np-combo', 'height') + 2);
  });

  it('covers the emote bubble including its border and margin', () => {
    expect(NAMEPLATE_EMOTE_ROW_PX).toBeGreaterThanOrEqual(cssPx('.np-emote', 'height') + 9);
  });

  it('covers the raid marker icon and its margin', () => {
    expect(NAMEPLATE_RAID_MARK_ROW_PX).toBeGreaterThanOrEqual(cssPx('.np-raidmark', 'height') + 1);
  });

  it.each([
    ['.np-guild', () => NAMEPLATE_GUILD_ROW_PX],
    ['.np-title', () => NAMEPLATE_TITLE_ROW_PX],
    ['.np-name', () => NAMEPLATE_NAME_ROW_PX],
  ])('covers the %s text line', (selector, constant) => {
    // text lines have no declared height: the font size is the floor
    expect(constant()).toBeGreaterThanOrEqual(cssPx(selector, 'font-size'));
  });

  it('covers the inline badges that share the name row', () => {
    // the linked-Discord PFP is the tallest of them, and it is the one row box
    // declared OUTSIDE hud.css: under-modelling it re-introduces the overlap
    const discord = cssPx('.np-discord', 'height') + 2 * cssPx('.np-discord', 'border');
    expect(NAMEPLATE_NAME_ROW_PX).toBeGreaterThanOrEqual(discord);
    expect(NAMEPLATE_NAME_ROW_PX).toBeGreaterThanOrEqual(cssPx('.np-tier', 'height'));
    expect(NAMEPLATE_NAME_ROW_PX).toBeGreaterThanOrEqual(cssPx('.np-level', 'font-size'));
  });
});

describe('nameplate extent core: plate kind and rows', () => {
  it.each([
    ['object', entity({ kind: 'object' }), 'object'],
    ['player', entity({ kind: 'player' }), 'player'],
    ['npc', entity({ kind: 'npc' }), 'npc'],
    ['quest-giving friendly mob', entity({ hostile: false, questIds: ['q1'] }), 'npc'],
    ['hostile quest mob', entity({ hostile: true, questIds: ['q1'] }), 'mob'],
    ['plain mob', entity({}), 'mob'],
  ])('classifies a %s plate', (_label, e, kind) => {
    expect(nameplatePlateKind(e)).toBe(kind);
  });

  it('gives a live mob an hp bar and nothing else', () => {
    const e = entity({});
    expect(nameplateRowMask(e, 'mob', false, false, 0, false, false, false)).toBe(NP_ROW_HP_BAR);
  });

  it.each([
    ['dead mob', entity({ dead: true }), 'mob' as const],
    ['npc', entity({ kind: 'npc' }), 'npc' as const],
    ['object', entity({ kind: 'object' }), 'object' as const],
  ])('gives a %s no hp bar', (_label, e, kind) => {
    expect(nameplateRowMask(e, kind, false, false, 0, false, false, false) & NP_ROW_HP_BAR).toBe(0);
  });

  it('gives a guilded, titled player its subtitle rows', () => {
    const e = entity({ kind: 'player', guild: 'Ravens', title: 'deed_first_blood' });
    expect(nameplateRowMask(e, 'player', false, false, 0, false, false, false)).toBe(
      NP_ROW_HP_BAR | NP_ROW_GUILD | NP_ROW_TITLE,
    );
  });

  it('collapses every own-plate row when the self plate is suppressed', () => {
    const e = entity({ kind: 'player', guild: 'Ravens', title: 'deed_first_blood' });
    expect(nameplateRowMask(e, 'player', true, false, 0, false, false, false)).toBe(0);
  });

  it.each([
    ['cast bar', [true, 0, false, false] as const, NP_ROW_CAST_BAR],
    // the three rows ABOVE the marker slot drag it in: their ink spans it
    ['combo pips', [false, 3, false, false] as const, NP_ROW_COMBO | NP_ROW_MARKER],
    ['overhead emote', [false, 0, true, false] as const, NP_ROW_EMOTE | NP_ROW_MARKER],
    ['raid marker', [false, 0, false, true] as const, NP_ROW_RAID_MARK | NP_ROW_MARKER],
  ])('adds the %s row from the painter-supplied facts', (_label, args, bit) => {
    const e = entity({ dead: true }); // no hp bar, so the bit under test stands alone
    expect(nameplateRowMask(e, 'mob', false, args[0], args[1], args[2], args[3], false)).toBe(bit);
  });

  it.each([
    ['lootable corpse', entity({ dead: true, lootable: true }), 'mob' as const, false],
    ['live elite', entity({}), 'mob' as const, true],
    ['quest npc', entity({ kind: 'npc' }), 'npc' as const, false],
  ])('counts the marker slot for a %s, which draws a glyph in it', (_l, e, kind, elite) => {
    expect(nameplateRowMask(e, kind, false, false, 0, false, false, elite) & NP_ROW_MARKER).toBe(
      NP_ROW_MARKER,
    );
  });

  it.each([
    ['plain live mob', entity({}), 'mob' as const, false],
    ['dead non-lootable mob', entity({ dead: true }), 'mob' as const, false],
    ['dead elite', entity({ dead: true }), 'mob' as const, true],
    ['player', entity({ kind: 'player' }), 'player' as const, false],
    ['object', entity({ kind: 'object' }), 'object' as const, false],
  ])('leaves the empty marker slot out of a %s plate', (_l, e, kind, elite) => {
    expect(nameplateRowMask(e, kind, false, false, 0, false, false, elite) & NP_ROW_MARKER).toBe(0);
  });

  it('does not add a combo row for zero pips', () => {
    const e = entity({ dead: true });
    expect(nameplateRowMask(e, 'mob', false, false, 0, false, false, false)).toBe(0);
  });
});
