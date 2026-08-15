// WCAG-chrome + no-magic source guard for the arena window DOM painter.
//
// The painter's DOM/network methods need a document + fetch, so they are not
// exercised in this Node suite; the pure decisions it renders are covered by
// tests/arena_window_view.test.ts. This guard pins the a11y-bearing markup
// (focusable controls + aria labels + focus-return) and the no-magic-values contract
// for a DOM painter (no literal colors in TS; cadences are named constants).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/ui/arena_window.ts', import.meta.url), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('arena_window: WCAG chrome (focusable controls + focus-return)', () => {
  it('drives the panels from all three pure cores', () => {
    expect(code).toContain('buildArenaView(');
    expect(code).toContain('buildBgWindowView(');
    expect(code).toContain('buildPvpTabs(');
  });

  it('exposes the tab deep entry and tab-prefixes every live render-skip sig', () => {
    // openTab is the Thornhollow Fields deep entry (hud.toggleBattleground rides it).
    expect(code).toContain('openTab(tab: PvpTabId)');
    // The two live signatures carry the tab and the strip's lock state, so a
    // tab switch or a lock change can never be skipped by a colliding sig. They
    // are also named apart, because both arms guard the same `lastSig` field
    // with the same shape and the drive registry pins one of them by name.
    expect(code).toContain('const ravenriftSig = `ravenrift|');
    expect(code).toContain('const sig = `${tab}|');
  });

  it('gives the close control a real button with an aria-label', () => {
    expect(code).toContain('class="x-btn" data-close aria-label=');
    expect(code).toContain("t('hud.arena.close')");
  });

  it('renders bracket tabs as real buttons with aria-pressed state', () => {
    expect(code).toContain('class="arena-bracket');
    expect(code).toContain('data-bracket=');
    expect(code).toContain('aria-pressed=');
  });

  it('routes every close path through close() so focus returns to the opener', () => {
    // The X button (both offline + live) closes via the painter, not a raw hide.
    expect(code).toContain("data-close]')?.addEventListener('click', () => this.close())");
    // close() captures + restores the opener focus (WCAG 2.2 AA focus-return).
    expect(code).toContain('this.deps.restoreFocus(this.openerFocus)');
    expect(code).toContain('this.openerFocus = this.deps.captureFocus()');
  });

  // Both ranked tabs now carry the same two ladder sections in the same order:
  // who is online right now, then the all-time board. The Thornhollow arm
  // reuses the arena's ladder-row markup family rather than a bespoke one.
  it('renders the live online ladder above the all-time board on the Thornhollow tab', () => {
    expect(code).toContain("t('hudChrome.bg.ladderOnline')");
    expect(code).toContain("t('hudChrome.bg.noChallengers')");
    expect(code).toContain('this.bgOnlineLadderHtml(view.ladder)');
    // Order inside the Thornhollow body: the first-win chip, the queue
    // affordance it invites a click on, then the online section, then all-time.
    expect(code).toContain('this.bgFirstWinChipHtml(view.firstWinBonus)');
    expect(code).toContain('this.bgActionHtml(view.action)');
    // The COMPOSED expression, not the declarations above it: the sections are
    // built in a different order than they are concatenated.
    const bgBody = code.slice(
      code.indexOf('private bgBodyHtml'),
      code.indexOf('private bgActionHtml'),
    );
    const composed = bgBody.slice(bgBody.indexOf('return ('));
    expect(composed.indexOf('bgFirstWinChipHtml')).toBeLessThan(composed.indexOf('bgActionHtml'));
    expect(composed.indexOf('bgActionHtml')).toBeLessThan(composed.indexOf('onlineSection'));
    expect(composed.indexOf('onlineSection')).toBeLessThan(composed.indexOf('allTimeSection'));
    // The shared row family (the arena's ladderHtml markup), not a bespoke one:
    // read the new builder's own body rather than counting occurrences.
    const body = code.slice(
      code.indexOf('private bgOnlineLadderHtml('),
      code.indexOf('private bgLadderHtml('),
    );
    expect(body.length).toBeGreaterThan(0); // both builders present, in that order
    expect(body).toContain('class="ladder-row');
    expect(body).toContain('class="ladder-empty"');
    expect(body).toContain('class="rank"');
    expect(body).toContain("t('hudChrome.bg.playerClassTitle'");
    // The live rows carry no level: that title key belongs to the all-time board.
    expect(body).not.toContain('playerLevelClassTitle');
  });

  it('keeps the offline / not-yet-synced unavailable note on both tabs', () => {
    expect(code).toContain("t('hud.arena.offlineNote')");
    expect(code).toContain("t('hudChrome.bg.offlineNote')");
  });

  it('every panel state emits the dialog label id, the Thornhollow Fields title included', () => {
    // markDialogRoot(labelledBy: 'arena-title') is set once on open; both
    // title builders must therefore carry the id in every rebuilt panel.
    expect(code).toContain('<span id="arena-title">${esc(t(\'hud.arena.title\'))}');
    expect(code).toContain('<span id="arena-title">${esc(t(\'hudChrome.bg.title\'))}');
  });
});

describe('arena_window: no magic values (DOM painter)', () => {
  it('carries no literal hex or rgb color in TS (colors live in the stylesheet)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('names the leaderboard refetch cadence instead of an inline literal', () => {
    expect(code).toContain('const LEADERBOARD_REFETCH_MS =');
    expect(code).toContain('< LEADERBOARD_REFETCH_MS');
    // The raw throttle interval is not inlined at the call site.
    expect(code).not.toContain('< 15000');
  });
});

describe('arena_window: mediumHud redraw call site', () => {
  it("still redraws the open arena window from hud.update()'s mediumHud band", () => {
    // Symmetric to the map painter's cadence guard: pin the hud.ts call site so a
    // refactor cannot silently stop the open arena window from refreshing (queue
    // size, ladder, match state) while it is displayed.
    expect(hud).toContain(
      "if ($('#arena-window').style.display === 'block') this.arenaWindow.render();",
    );
  });

  it('routes the match-start auto-close through close() (focus-return), never a raw hide', () => {
    // When a bout starts hud.update() must close the queue panel via the painter so focus
    // returns to the opener (WCAG 2.4.3), not a raw style.display = 'none' that would
    // drop focus to <body>. Pin the routing so a refactor cannot regress it silently.
    expect(hud).toContain(
      "if (inArenaMatch && !this.arenaMatchSeen && $('#arena-window').style.display === 'block') {",
    );
    // The Thornhollow Fields match-start auto-close routes through the same painter.
    expect(hud).toContain(
      "if (inBgMatch && !this.bgMatchSeen && $('#arena-window').style.display === 'block') {",
    );
    expect(hud).not.toContain("'#arena-window').style.display = 'none'");
    // hud.toggleBattleground deep-opens the merged window on the Thornhollow Fields tab.
    expect(hud).toContain("this.arenaWindow.openTab('ravenrift')");
  });
});

describe('arena_window: offline skip-rebuild sentinel (collision-proof)', () => {
  it('uses a named offline sentinel sig the live JSON sig can never collide with', () => {
    const m = code.match(/ARENA_OFFLINE_SIG\s*=\s*'([^']*)'/);
    expect(m, 'ARENA_OFFLINE_SIG literal').not.toBeNull();
    const sentinel = m ? m[1] : '';
    // The live sig is tab-prefixed (`ravenrift|...` / `1v1|...`), never this bare
    // token, so an offline->live transition can never wrongly skip a rebuild; the
    // sentinel also must not start with '[' (the shape of a raw JSON sig).
    expect(sentinel.length).toBeGreaterThan(0);
    expect(sentinel.startsWith('[')).toBe(false);
    // The offline branch early-returns on the sentinel (builds once per open, not every tick).
    expect(code).toContain('this.lastSig === ARENA_OFFLINE_SIG');
    expect(code).toContain('this.lastSig = ARENA_OFFLINE_SIG');
  });
});

describe('arena_window: map row (slot-parity arena maps)', () => {
  it('renders the map row through the exhaustive key record, gated on matchMap', () => {
    // the record keeps a future third map from silently rendering the wrong
    // name (tsc reds on a missing member), and the row hides when the fact
    // is null (no match, yumi bracket, or a mapless older-server mirror)
    expect(src).toContain('ARENA_MAP_KEY[matchMap]');
    expect(src).toContain("coliseum: 'hud.arena.map.coliseum'");
    expect(src).toContain("drowned_court: 'hud.arena.map.drownedCourt'");
    expect(src).toMatch(/const mapRow = matchMap\s*\?/);
    expect(src).toContain("t('hud.arena.mapName', { name: t(ARENA_MAP_KEY[matchMap]) })");
  });
});
