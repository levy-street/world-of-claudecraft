import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guard for the Apply Enchant picker sizing.
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
const HUD_CSS = read('../src/styles/hud.css');
const HUD_MOBILE_CSS = read('../src/styles/hud.mobile.css');
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
