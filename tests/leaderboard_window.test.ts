// WCAG-chrome + no-magic source guard for the leaderboard window DOM painter.
//
// The painter's DOM/async methods need a document + a resolved Promise, so they are
// not exercised in this Node suite; the pure decisions it renders are covered by
// tests/leaderboard_view.test.ts. This guard pins the a11y-bearing markup (real
// close button + the loading live region + focus-return) and the
// contract for a DOM painter (no literal colors in TS; the page size is a named
// constant).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/ui/leaderboard_window.ts', import.meta.url), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('leaderboard_window: WCAG chrome (live region + focusable controls + focus-return)', () => {
  it('drives the panel from the pure view core', () => {
    expect(code).toContain('buildLeaderboardView(');
  });

  it('gives the close control a real button with an aria-label', () => {
    expect(code).toContain('class="x-btn" data-close aria-label=');
    expect(code).toContain("t('hudChrome.leaderboard.close')");
  });

  it('marks the in-flight loading state as a live region (aria-busy + role=status)', () => {
    expect(code).toContain('role="status" aria-busy="true"');
    expect(code).toContain("t('game.leaderboard.loading')");
  });

  it('renders the rejection/offline error as an alert with the localized retry copy', () => {
    expect(code).toContain('role="alert"');
    expect(code).toContain("t('game.leaderboard.retry')");
  });

  it('renders the dialog role + labelledby for the window', () => {
    // the dialog identity is set via the shared markDialogRoot helper (role=dialog +
    // aria-labelledby + aria-modal + tabindex); the helper's own writes are unit-tested in
    // dialog_root.test.ts.
    expect(code).toContain("markDialogRoot(el, { labelledBy: 'leaderboard-title' })");
    expect(code).toContain('id="leaderboard-title"');
  });

  it('renders the pager controls as real buttons', () => {
    expect(code).toContain('class="lb-page-btn" data-leaderboard-page="prev"');
    expect(code).toContain('class="lb-page-btn" data-leaderboard-page="next"');
  });

  it('captures + restores the opener focus on open/close (WCAG 2.2 AA focus-return)', () => {
    expect(code).toContain('this.openerFocus = this.deps.captureFocus()');
    expect(code).toContain('this.deps.restoreFocus(this.openerFocus)');
  });

  it('captures the opener BEFORE closing other windows (order is load-bearing)', () => {
    // A sibling window's own focus-return on close must not clobber the opener we
    // restore to, so the capture has to happen before closeOthers(). Pin the order,
    // not just the presence (both calls appear exactly once, in toggle()).
    expect(code.indexOf('this.openerFocus = this.deps.captureFocus()')).toBeLessThan(
      code.indexOf('this.deps.closeOthers()'),
    );
  });

  it('escapes the server-supplied player names before interpolating them into HTML', () => {
    // Names are server-validated, but the src/ui invariant routes all player text
    // through esc(); match the sibling questlog painter (no raw-name innerHTML).
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the painter source literally contains this template expression
    expect(code).toContain('${esc(r.name)}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the painter source literally contains this template expression
    expect(code).toContain('${esc(standing.name)}');
    expect(code).not.toMatch(/\$\{r\.name\}/);
    expect(code).not.toMatch(/\$\{standing\.name\}/);
  });
});

describe('leaderboard_window: async + page wiring contracts (the painter half)', () => {
  it('maps a rejected / offline fetch to the error input (catch sets the result null)', () => {
    // The view test proves buildLeaderboardView({kind:'error'}) -> error; this pins
    // the painter wiring (the sanctioned new error state) that turns a rejected
    // Promise into that input, so removing the catch cannot silently regress it.
    expect(code).toMatch(/catch\s*\{[\s\S]{0,60}result = null/);
    expect(code).toContain('result === null');
  });

  it('guards against painting into a window closed during the in-flight fetch', () => {
    // close() hides the window without clearing innerHTML, so a late-resolving fetch
    // must bail rather than repaint a hidden panel.
    expect(code).toContain("if (el.style.display !== 'block') return;");
  });

  it('mirrors the server-clamped page back into the pager state', () => {
    // The core passes page.page through (view test); the painter must write it back
    // so the page index never drifts past the real last page.
    expect(code).toContain('this.page = view.page');
  });
});

describe('leaderboard_window: no magic values (DOM painter)', () => {
  it('carries no literal hex or rgb color in TS (colors live in the stylesheet)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('carries no literal em dash in source (the sticky-rank placeholder is an entity)', () => {
    expect(src.includes('—'), 'em dash found').toBe(false);
  });

  it('names the page size instead of an inline literal', () => {
    expect(code).toContain('LEADERBOARD_PAGE_SIZE');
    expect(code).not.toContain(', 50)');
  });
});

describe('leaderboard_window: guild board tab (Players / Guilds)', () => {
  it('renders a role=tablist with all three board tabs', () => {
    expect(code).toContain('role="tablist"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the painter source literally contains this template expression
    expect(code).toContain('data-leaderboard-tab="${board}"');
    expect(code).toContain("tab('players', t('hudChrome.leaderboard.tabPlayers'))");
    expect(code).toContain("tab('guilds', t('hudChrome.leaderboard.tabGuilds'))");
    expect(code).toContain("tab('devs', t('hudChrome.leaderboard.tabDevs'))");
  });

  it('marks the active tab with aria-selected for screen readers', () => {
    expect(code).toContain('aria-selected');
  });

  it('wires the WAI-ARIA tablist: roving tabindex, aria-controls, a labelled tabpanel', () => {
    // Roving tabindex (0 on the active tab, -1 on the rest) so Tab lands on one tab.
    expect(code).toContain("tabindex=\"${active ? '0' : '-1'}\"");
    // Each tab controls the shared tabpanel, which carries the matching id + role.
    expect(code).toContain('aria-controls="lb-body-panel"');
    expect(code).toContain('id="lb-body-panel" role="tabpanel"');
    expect(code).toContain('aria-label="${esc(t(\'hudChrome.leaderboard.tabsLabel\'))}"');
  });

  it('drives keyboard tab nav through the shared roving core and refocuses the active tab', () => {
    // Arrow/Home/End routed through the tested rovingTarget core (not bespoke math).
    expect(code).toContain("rovingTarget(ke.key, i, tabs.length, 'horizontal')");
    // Enter/Space activate, with preventDefault suppressing the synthesized click.
    expect(code).toMatch(/ke\.key === 'Enter' \|\| ke\.key === ' '/);
    // A tab switch re-renders with focus:'tab', and render() refocuses the active
    // tab so the innerHTML rebuild never drops focus to <body>.
    expect(code).toContain("void this.render('tab')");
    expect(code).toContain(".lb-tab-active') as HTMLElement | null)?.focus()");
  });

  it('awaits the guild board through the IWorld seam, not a concrete world', () => {
    expect(code).toContain('world.guildLeaderboard(this.page, LEADERBOARD_PAGE_SIZE)');
  });

  it('escapes the server-supplied guild names before interpolating them', () => {
    // The guild rows route the guild name through esc() like the player rows.
    expect(code).not.toMatch(/\$\{r\.name\}(?!\))/);
  });

  it('maps a rejected / offline guild fetch to the error input', () => {
    // Guilds are server-only; offline guildLeaderboard() resolves an empty page,
    // and a rejection maps to the shared error state (result === null).
    expect(code).toContain("result === null ? { kind: 'error' }");
  });
});

describe('leaderboard_window: developers board tab', () => {
  it('drives the dev board from the pure view core', () => {
    expect(code).toContain('buildDevLeaderboardView(');
  });

  it('awaits the dev board through the IWorld seam, not a concrete world', () => {
    expect(code).toContain('world.devLeaderboard(this.page, LEADERBOARD_PAGE_SIZE)');
  });

  it('passes the viewer linked GitHub login so their own row can be flagged', () => {
    expect(code).toContain('viewerLogin: world.player.githubLogin ?? null');
  });

  it('renders the dev-tier badge image and escapes the contributor login', () => {
    expect(code).toContain('devTierBadgeDataUrl(def, 32)');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the painter source literally contains this template expression
    expect(code).toContain('${badge}@${esc(r.login)}');
  });

  it('renders the localized dev-tab empty state', () => {
    expect(code).toContain("t('hudChrome.leaderboard.devEmpty')");
  });

  it('guards against painting the dev board into a window closed mid-fetch', () => {
    expect(code).toMatch(
      /renderDevBoard[\s\S]{0,400}if \(el\.style\.display !== 'block'\) return;/,
    );
  });

  it('hides the tab itself (not just the rows) behind the showDevBadges display preference', () => {
    expect(code).toContain("this.deps.showDevBadges() ? tab('devs'");
  });

  it('falls back off the devs board if the preference turns off while it is selected', () => {
    expect(code).toContain(
      "if (this.board === 'devs' && !this.deps.showDevBadges()) this.board = 'players';",
    );
  });
});
