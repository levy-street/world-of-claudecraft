import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level guards for the dedicated mobile settings shell (spec section 9 v1.1):
// the thin painter chrome + the OptionsWindow integration. The navigation LOGIC
// (push/pop, env gating, level-0 close, landing order) is unit-tested against the
// pure core in options_mobile_shell_view.test.ts; here we pin that the shell is
// body.mobile-touch-gated, that it reuses the shared desktop body renderers (so the
// dispatch stays byte-identical), and that back/close route through the back-stack.
const painter = readFileSync(new URL('../src/ui/options_mobile_shell.ts', import.meta.url), 'utf8');
const win = readFileSync(new URL('../src/ui/options_window.ts', import.meta.url), 'utf8');

describe('options_mobile_shell: painter chrome', () => {
  it('paints a per-level sticky header (Settings/close on the landing, back on a page)', () => {
    expect(painter).toContain("el('div', 'opt-mshell-header')");
    expect(painter).toContain("t('hud.options.gameMenu')"); // landing title
    expect(painter).toContain("svgIcon('prev')"); // back chevron
    expect(painter).toContain("svgIcon('close')"); // close
  });

  it('builds the stacked category list from the pure env-gated model', () => {
    expect(painter).toContain('mobileCategoryRows(deps.env()');
    expect(painter).toContain("el('button', 'opt-mshell-cat')");
    // the whole row is the tap target that pushes the page
    expect(painter).toContain('deps.onSelectCategory(row.id)');
    // count + conflict dot ride in the row
    expect(painter).toContain("el('span', 'opt-tab-count')");
    expect(painter).toContain("el('span', 'opt-tab-dot')");
  });

  it('renders the bottom bar ONLY as the gamepad legend host (no Done button)', () => {
    // The Done button is gone (the header X is the one close control); the bar
    // exists solely while a pad is connected, to host the legend strip.
    expect(painter).toContain("el('div', 'opt-mshell-bar')");
    expect(painter).toContain('const legend = deps.buildLegend();');
    expect(painter).not.toContain("t('hudChrome.options.done')");
    expect(painter).not.toContain('opt-mshell-done');
  });

  it('appends the Reset to Defaults + Logout action tiles to the grid', () => {
    expect(painter).toContain("el('button', 'opt-mshell-cat is-danger')");
    expect(painter).toContain("actionTile('hud.options.resetToDefaults', 'swap', deps.onResetAll)");
    expect(painter).toContain("actionTile('hud.options.logout', 'prev', deps.onLogout)");
  });

  it('delegates each level body through the pure landing order + the injected renderers', () => {
    expect(painter).toContain("from './options_mobile_shell_view'");
    expect(painter).toContain('MOBILE_LANDING_ORDER');
    // a pushed page body is delegated (renderCategoryDetail / renderSystem / renderBugReport)
    expect(painter).toContain('deps.appendContentBody(content)');
    // the landing composes the shared Overview pieces
    expect(painter).toContain('deps.appendPins(lower)');
    expect(painter).toContain('deps.appendSearchResults(lower)');
  });

  it('marks its close / back controls data-close for the focus trap (F3)', () => {
    // focus-first on open skips [data-close] dismiss affordances (and preferred-
    // close flows target them), so the shell chrome must carry the marker like
    // the shared frame X does: the close X and the back chevron.
    const marks = painter.match(/setAttribute\('data-close', ''\)/g) ?? [];
    expect(marks).toHaveLength(2);
  });

  it('carries no literal hex color in TS (tokens/stylesheet only)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens/CSS: ${hex.join(', ')}`).toEqual([]);
    expect(painter.includes(String.fromCharCode(0x2014)), 'em dash').toBe(false);
    expect(painter.includes(String.fromCharCode(0x2013)), 'en dash').toBe(false);
  });
});

describe('options_window: mobile shell integration', () => {
  it('gates the shell on the body.mobile-touch class (not the coarse-pointer probe)', () => {
    expect(win).toContain('private mobileActive(): boolean');
    expect(win).toContain("document.body.classList.contains('mobile-touch')");
    // render() selects the layout by mode: the NARROW back-stack shell forks to
    // renderMobile; the desktop + WIDE-mobile rail share the two-pane path.
    const render = win.slice(win.indexOf('private render(): void {'));
    const body = render.slice(0, render.indexOf('private renderTwoPane'));
    expect(body).toContain("if (mode === 'backstack') {");
    expect(body).toContain('this.renderMobile(body, footer);');
    expect(body).toContain('this.renderTwoPane(body, footer);');
  });

  it('forces a touch render env so gating is correct under emulated capture', () => {
    expect(win).toContain('private renderEnv():');
    expect(win).toContain('this.mobileActive() ? { touch: true, nativeShell: isNativeAppShell() }');
    // the shared body renderers gate on renderEnv, not the raw env
    expect(win).toContain('renderCategory(this.activeCategory, this.renderEnv())');
  });

  it('always opens the shell on the level-0 landing (never a pushed page)', () => {
    const toggle = win.slice(win.indexOf('toggle(): void {'));
    const body = toggle.slice(0, toggle.indexOf('\n  }\n'));
    expect(body).toContain('this.mobileNav = initialNav();');
  });

  it('reuses the shared desktop body renderers (byte-identical dispatch)', () => {
    const content = win.slice(win.indexOf('private appendMobileContentBody'));
    const fn = content.slice(0, content.indexOf('\n  /**'));
    expect(fn).toContain('this.renderBugReport(parent)');
    expect(fn).toContain('this.renderSystem(parent)');
    expect(fn).toContain('this.renderCategoryDetail(parent)');
  });

  it('routes back / close through the back-stack (level-0 pop closes)', () => {
    const back = win.slice(win.indexOf('private backOrClose(): void {'));
    const fn = back.slice(0, back.indexOf('\n  /** Y:'));
    // Gated on backStackActive (the NARROW shell only): the wide rail uses the
    // desktop subview/close path, exactly like desktop.
    expect(fn).toContain('if (this.backStackActive()) {');
    expect(fn).toContain('if (popClosesMenu(this.mobileNav)) {');
    expect(fn).toContain('this.mobileNav = popLevel(this.mobileNav);');
    // selecting a category pushes a single level-1 page
    const set = win.slice(win.indexOf('private setActiveCategory'));
    expect(set.slice(0, set.indexOf('\n  /**'))).toContain(
      'this.mobileNav = openCategory(this.mobileNav, id);',
    );
  });

  it('hides the frame chrome on the NARROW shell (it paints its own header)', () => {
    const css = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');
    // Scoped :not(.opt-mrail): the wide rail two-pane KEEPS the frame chrome.
    expect(css).toContain(
      'body.mobile-touch #options-menu:not(.opt-mrail) > .window-frame > .window-titlebar',
    );
    // the reused .opt-* controls get touch floors + a 16px search input floor
    expect(css).toContain('body.mobile-touch #options-menu .opt-row');
    expect(css).toMatch(/body\.mobile-touch #options-menu \.search-input \{\s*font-size: 16px/);
  });
});
