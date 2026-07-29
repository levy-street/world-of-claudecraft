import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QUALITY_COLOR } from '../src/ui/icons';

// Guard for the Apply Enchant picker's CSS contract: its sizing, and (#2421)
// the destructive-row treatment that separates a replace flag from the
// informational tags beside it.
//
// The picker states of the shared #ctx-menu popup (the enchant list and the
// target list) take a wider, height-capped, scrolling box through the
// painter-managed ctx-menu-picker modifier class, on BOTH the desktop and the
// mobile arm. The shared base block, and with it every player/chat menu, must
// keep its exact pre-amendment sizing, and every non-picker paint site clears
// the modifier so a plain menu can never inherit picker sizing.
//
// File-based (read CSS/TS sources, regex/flat-parse), the
// tests/ctx_menu_mobile_stacking.test.ts idiom: no jsdom.
function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}
/** CSS source with block comments stripped. A RAW read makes every rule pin
 *  below gameable in one move: wrapping a rule in a comment leaves its text
 *  byte-identical, so a pin that matches the raw file goes on passing over dead
 *  CSS. (Verified: commenting out the destructive-row rule left all of this
 *  file green.) The painter pin further down strips TS comments for exactly the
 *  same reason; this is that treatment extended to the stylesheets. */
function readCss(rel: string): string {
  return read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
}
const HUD_CSS = readCss('../src/styles/hud.css');
const HUD_MOBILE_CSS = readCss('../src/styles/hud.mobile.css');
const PAINTER_TS = read('../src/ui/bag_item_action_menu.ts');
const HUD_TS = read('../src/ui/hud.ts');
const CHAT_TS = read('../src/ui/hud/chat/chat_window_controller.ts');

function block(css: string, selectorPattern: RegExp): string {
  const match = css.match(selectorPattern);
  if (!match) throw new Error(`no block matching ${selectorPattern}`);
  return match[0];
}

describe('#ctx-menu picker sizing (Apply Enchant picker)', () => {
  it('the desktop picker modifier block is wider, height-capped, and scrolls', () => {
    const picker = block(HUD_CSS, /#ctx-menu\.ctx-menu-picker\s*\{[^}]*\}/);
    const minWidth = picker.match(/min-width:\s*(\d+)px/);
    expect(minWidth).not.toBeNull();
    // Wider than the shared base block's 150px, by a real margin.
    expect(Number(minWidth?.[1])).toBeGreaterThanOrEqual(240);
    expect(picker).toMatch(/max-width:/);
    // A fixed cap well short of the viewport, and the capped box scrolls.
    expect(picker).toMatch(/max-height:\s*min\(\s*\d+vh/);
    expect(picker).toMatch(/overflow-y:\s*auto/);
  });

  it('the mobile picker modifier block takes a tighter-than-base cap and scrolls', () => {
    const picker = block(
      HUD_MOBILE_CSS,
      /body\.mobile-touch #ctx-menu\.ctx-menu-picker\s*\{[^}]*\}/,
    );
    // A fraction of the app viewport (the base rule is the full viewport minus
    // a margin; the picker cap must be a genuine fraction, not that formula).
    expect(picker).toMatch(/max-height:\s*calc\(.*var\(--app-vh.*\*\s*0?\.\d+\s*\)/);
    expect(picker).not.toMatch(/-\s*20px/);
    expect(picker).toMatch(/max-width:/);
    expect(picker).toMatch(/overflow-y:\s*auto/);
  });

  it('the shared base blocks keep their exact pre-amendment sizing', () => {
    const base = block(HUD_CSS, /#ctx-menu\s*\{[^}]*\}/);
    expect(base).toMatch(/min-width:\s*150px/);
    expect(base).not.toMatch(/max-height/);
    // The mobile base cap stays the full-viewport-minus-margin formula.
    const mobileBase = block(
      HUD_MOBILE_CSS,
      /body\.mobile-touch #ctx-menu\s*\{[^}]*max-height[^}]*\}/,
    );
    expect(mobileBase).toMatch(
      /max-height:\s*calc\(var\(--app-vh,\s*100vh\)\s*\/\s*var\(--ui-scale,\s*1\)\s*-\s*20px\)/,
    );
  });

  it('the painter reserve mirror stays in sync with the CSS cap', () => {
    // bag_item_action_menu.ts mirrors the desktop max-height so placement can
    // reserve the real rendered box; a CSS cap change must move both or the
    // reserve silently drifts.
    const cap = block(HUD_CSS, /#ctx-menu\.ctx-menu-picker\s*\{[^}]*\}/).match(
      /max-height:\s*min\(\s*(\d+)vh\s*,\s*(\d+)px\s*\)/,
    );
    expect(cap).not.toBeNull();
    const fraction = PAINTER_TS.match(/PICKER_MAX_HEIGHT_VIEWPORT_FRACTION = (0?\.\d+)/);
    const px = PAINTER_TS.match(/PICKER_MAX_HEIGHT_DESKTOP_PX = (\d+)/);
    expect(Number(cap?.[1]) / 100).toBe(Number(fraction?.[1]));
    expect(Number(cap?.[2])).toBe(Number(px?.[1]));
  });

  it('the tier headers and effect lines are styled once, from tokens, never inline', () => {
    const section = block(HUD_CSS, /#ctx-menu \.ctx-section\s*\{[^}]*\}/);
    // A caption, not a row: no pointer affordance and no hover treatment.
    expect(section).not.toMatch(/cursor:/);
    expect(HUD_CSS).not.toContain('#ctx-menu .ctx-section:hover');
    const effect = block(HUD_CSS, /#ctx-menu \.ctx-item-effect\s*\{[^}]*\}/);
    // Block-level so the effect never collides with the enchant name inline,
    // and colored from a token (the same bonus-stat green the item tooltip's
    // own gain lines use), never a literal in CSS or the painter.
    expect(effect).toMatch(/display:\s*block/);
    expect(effect).toMatch(/var\(--color-stat-bonus\)/);
    // The token's whole point is agreeing with the item tooltip's own bonus
    // lines, so pin the VALUE against that source of truth, not just presence.
    const token = read('../src/styles/tokens.css').match(/--color-stat-bonus:\s*([^;]+);/);
    expect(token).not.toBeNull();
    expect(token?.[1].trim()).toBe(QUALITY_COLOR.uncommon);
    expect(read('../src/styles/hud.css')).toContain(
      `#tooltip .tt-green {\n    color: ${QUALITY_COLOR.uncommon};`,
    );
    expect(PAINTER_TS).not.toMatch(/ctx-item-effect[^`]*style=/);
    // Always-on: neither is gated behind a graphics tier.
    expect(section).not.toContain('--fx-');
    expect(effect).not.toContain('--fx-');
  });

  it('the confirm dialog honors the multi-line yield body', () => {
    // The confirm body is escaped PLAIN text, so the disenchant yield preview's
    // newlines only render as lines because the scoped body rule says so.
    const body = block(
      read('../src/styles/components.css'),
      /#confirm-dialog \.cd-body\s*\{[^}]*\}/,
    );
    expect(body).toMatch(/white-space:\s*pre-line/);
  });

  it('the painter toggles the modifier and every plain paint site clears it', () => {
    // The picker paints set it; a plain bag action menu paint clears it (the
    // toggle runs on every paint with the picker flag).
    expect(PAINTER_TS).toMatch(/CTX_MENU_PICKER_CLASS = 'ctx-menu-picker'/);
    expect(PAINTER_TS).toMatch(/classList\.toggle\(CTX_MENU_PICKER_CLASS,\s*picker\)/);
    // The unified close path and every foreign paint site (self / player /
    // marker / pet / chat-name menus, plus the chat channel picker) clear it,
    // so those menus render byte-identically to the pre-amendment popup even
    // when opened without an intervening close (keyboard-activated openers
    // fire click with no pointerdown, skipping the outside-click dismiss).
    const hudClears = HUD_TS.match(/classList\.remove\(CTX_MENU_PICKER_CLASS\)/g) ?? [];
    expect(hudClears.length).toBeGreaterThanOrEqual(6);
    expect(CHAT_TS).toMatch(/classList\.remove\(CTX_MENU_PICKER_CLASS\)/);
  });
});

// #2421: a picker row that will DESTROY an enchant must not render in the same
// muted style as the purely informational Worn / Not enchanted tags. The rule
// reuses the picker's own warning token (never a literal hex) and survives the
// forced palette, which strips author colors and would otherwise take the
// distinction with it.
describe('#ctx-menu destructive meta sub-line (Apply Enchant replace row)', () => {
  const DANGER = /#ctx-menu \.ctx-item-meta\.ctx-item-danger\s*\{[^}]*\}/;

  it('takes the picker warning token, with no literal color of its own', () => {
    const danger = block(HUD_CSS, DANGER);
    expect(danger).toMatch(/color:\s*var\(--color-text-error\)/);
    // The same token the reagent-shortfall tint next door uses: one warning
    // idiom in this menu, not two.
    const unsat = block(HUD_CSS, /#ctx-menu \.ctx-item-meta \.ctx-reagent\.unsat\s*\{[^}]*\}/);
    expect(unsat).toMatch(/var\(--color-text-error\)/);
    // No literal hex, rgb(), hsl() or named color anywhere in the rule.
    expect(danger).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(danger).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    // And the token actually exists rather than silently falling back.
    expect(readCss('../src/styles/tokens.css')).toMatch(/--color-text-error:\s*#[0-9a-fA-F]{3,8};/);
    // Always-on: a destructive warning is actionable information, so it can
    // never be shed by a graphics tier.
    expect(danger).not.toContain('--fx-');
  });

  it('carries a non-color cue so the row still reads as the heavier one', () => {
    // The informational sub-line has no rule of its own; the destructive one
    // does, which is what survives when forced-colors replaces every author
    // color with the system palette.
    const danger = block(HUD_CSS, DANGER);
    expect(danger).toMatch(/border-inline-start:\s*\d+px solid var\(--color-text-error\)/);
    expect(danger).toMatch(/padding-inline-start:/);
    const base = block(HUD_CSS, /#ctx-menu \.ctx-item-meta\s*\{[^}]*\}/);
    expect(base).not.toMatch(/border-inline-start/);
  });

  it('stays legible and distinguishable under forced-colors', () => {
    const forced = HUD_CSS.match(
      /@media \(forced-colors: active\) \{\s*#ctx-menu \.ctx-item-meta\.ctx-item-danger\s*\{[^}]*\}/,
    );
    expect(forced, 'the destructive sub-line needs a forced-colors arm').not.toBeNull();
    const arm = forced?.[0] ?? '';
    // System color keywords only in there (an author token would be ignored),
    // plus a cue that does not depend on color at all.
    expect(arm).toMatch(/border-inline-start-color:\s*CanvasText/);
    expect(arm).toMatch(/text-decoration:\s*underline/);
    expect(arm).not.toMatch(/var\(--/);
  });

  it('scales up on touch, alone among the meta sub-lines', () => {
    // The tier captions and effect lines already take a touch bump ("the base
    // sizes are tuned for the desktop popup and read as fine print at arm's
    // length"); a destroy warning has the strongest claim on that, and the
    // informational tags beside it stay at the base size so the hierarchy is
    // visible rather than uniform.
    const danger = block(
      HUD_MOBILE_CSS,
      /body\.mobile-touch #ctx-menu \.ctx-item-meta\.ctx-item-danger\s*\{[^}]*\}/,
    );
    const size = danger.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
    expect(size, 'the destructive sub-line needs a touch size').not.toBeNull();
    const base = block(HUD_CSS, /#ctx-menu \.ctx-item-meta\s*\{[^}]*\}/).match(
      /font-size:\s*(\d+(?:\.\d+)?)px/,
    );
    expect(Number(size?.[1])).toBeGreaterThan(Number(base?.[1]));
    // The plain meta line is deliberately NOT bumped, so the two read apart.
    expect(HUD_MOBILE_CSS).not.toMatch(
      /body\.mobile-touch #ctx-menu \.ctx-item-meta\s*\{[^}]*font-size/,
    );
  });

  it('is emitted by the painter on the replace flag alone, from a shared constant', () => {
    expect(PAINTER_TS).toMatch(/CTX_ITEM_DANGER_CLASS = 'ctx-item-danger'/);
    // Strip comments first: the class name appears in the prose above the
    // painter's branch, and a source pin that matched a comment would survive
    // the markup being reverted.
    const code = PAINTER_TS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The destructive class rides the replaceTag arm...
    expect(code).toMatch(/\$\{CTX_ITEM_DANGER_CLASS\}[\s\S]{0,160}enchanting\.replaceTag/);
    // ...and NOT the already-applied or plain arms, whose rows destroy nothing.
    expect(code).not.toMatch(/CTX_ITEM_DANGER_CLASS[\s\S]{0,120}sameEnchantTag/);
    expect(code).not.toMatch(/CTX_ITEM_DANGER_CLASS[\s\S]{0,120}enchanting\.plainTag/);
  });
});

// #2466 AC 2: "the discriminator is a t() key, not a concatenation". The rendered
// text is pinned in tests/bag_item_action_menu_paint.test.ts, but English bytes
// alone cannot see the MECHANISM: folding the ordinal into the plain worn tag's
// {slot} value, or hardcoding '[HEROIC]', renders identically in English while
// shipping untranslated text (the mark) or taking the slot/ordinal order away from
// every translator (the ordinal, which zh_CN and ja_JP set with no space at all).
describe('Apply Enchant target rows: the name discriminators are keyed, not glued', () => {
  // Comments stripped first: both key names appear in the prose above the painter's
  // branches, and a source pin that matched a comment would survive the markup
  // being reverted.
  const code = PAINTER_TS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('resolves the heroic mark from the shared key, never an inline literal', () => {
    // The key comes from the pure core, so the picker and the item tooltip cannot
    // drift onto two spellings of one mark.
    expect(code).toMatch(/esc\(t\(HEROIC_TAG_KEY\)\)/);
    expect(code).not.toContain('[HEROIC]');
  });

  it('selects between two worn-tag KEYS on slotIndex, and glues nothing into {slot}', () => {
    // The indexed arm names its own key...
    expect(code).toMatch(
      /slotIndex === undefined[\s\S]{0,200}enchanting\.wornTag'[\s\S]{0,200}enchanting\.wornTagIndexed'/,
    );
    // ...and the ordinal rides its own {index} placeholder, formatted like every
    // other number this menu prints, rather than being concatenated onto the slot
    // label (which would leave the plain wornTag as the only key in play).
    expect(code).toMatch(/index: itemNumber\(target\.slotIndex\)/);
    expect(code).not.toMatch(/slot: `/);
    expect(code).not.toMatch(/slotName\(target\.slot\)\s*\+/);
    expect(code).not.toMatch(/slotName\(target\.slot\)\}\s*\$\{/);
  });

  it('keeps both new keys in the English catalog, with their placeholders', () => {
    // A source pin on the painter cannot tell a live key from a typo, so the
    // catalog rows are pinned beside it, placeholders and all.
    const catalog = read('../src/ui/i18n.catalog/hud_chrome.ts');
    expect(catalog).toMatch(/wornTagIndexed: 'Worn \(\{slot\} \{index\}\)'/);
    expect(catalog).toMatch(/itemHeroicTag: '\[HEROIC\]'/);
  });
});
