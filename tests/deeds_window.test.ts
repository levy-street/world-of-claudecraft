// @vitest-environment jsdom
//
// Source-guard suite for the Book of Deeds window + tracker wiring (the
// bank_window.test.ts pattern): no-magic-values in the painters, the hud.ts
// orchestration pins (construction, Esc arm, slow band, language switch, the
// unlock batching), both entry HTMLs, the keybind dispatch chain, the
// renderer celebration arm, the nameplate title subtitle, and the CSS
// tap-target floors. Behavior of the pure core is covered in
// tests/deeds_view.test.ts; these pins keep the thin consumers honest.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// This file runs under jsdom (for the keyboard-guard behavioral test below),
// where import.meta.url is an http URL that readFileSync rejects; resolve the
// source-guard reads from __dirname instead.
const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

const painter = read('../src/ui/deeds_window.ts');
const tracker = read('../src/ui/deed_tracker_painter.ts');
const hud = read('../src/ui/hud.ts');
const mainSrc = read('../src/main.ts');
const inputSrc = read('../src/game/input.ts');
const settingsSrc = read('../src/game/settings.ts');
const rendererSrc = read('../src/render/renderer.ts');
const nameplateSrc = read('../src/render/nameplate_painter.ts');
const chrome = read('../src/ui/i18n.catalog/hud_chrome.ts');
const components = read('../src/styles/components.css');
const hudCss = read('../src/styles/hud.css');
const hudMobile = read('../src/styles/hud.mobile.css');
const mobileControlsSrc = read('../src/game/mobile_controls.ts');
const indexHtml = read('../index.html');
const playHtml = read('../play.html');

describe('painter hygiene', () => {
  it('keeps hex/px literals out of the painter TS (tokens and classes only)', () => {
    for (const [name, src] of [
      ['deeds_window.ts', painter],
      ['deed_tracker_painter.ts', tracker],
    ] as const) {
      // The lookahead keeps the '#deed-tracker' selector/comment mentions
      // (all-hex letters) from tripping the color scan.
      expect(src, `${name} must not hardcode a hex color`).not.toMatch(
        /#[0-9a-fA-F]{3,8}(?![\w-])/,
      );
      expect(src, `${name} must not hardcode a px literal`).not.toMatch(/'\d+px'/);
    }
  });

  it('contains no em/en dashes', () => {
    for (const src of [painter, tracker]) {
      // Unicode escapes: a literal dash here would itself trip the copy scan.
      expect(src).not.toMatch(/\u2014|\u2013/);
    }
  });

  it('reads neither the FPS governor nor the graphics tier (fairness oracle)', () => {
    // The deed UI is cosmetic, player-chosen information: it must never vary
    // with the graphics tier, so no painter may grow a governor or static-
    // preset read (the tier tests scan hud.ts, not these modules).
    for (const src of [painter, tracker]) {
      expect(src).not.toMatch(/governor/);
      expect(src).not.toMatch(/ui_effects_profile|fxTier|data-fx-level/);
    }
  });

  it('never renders bare English (textContent/aria always via t())', () => {
    for (const src of [painter, tracker]) {
      expect(src).not.toMatch(/textContent = '/);
      expect(src).not.toMatch(/aria-label="(?!\$\{)/);
    }
  });

  it('persists the watchlist under the per-character woc_deed_watch key', () => {
    expect(painter).toContain("const DEED_WATCH_KEY_PREFIX = 'woc_deed_watch';");
    expect(painter).toMatch(
      /\$\{DEED_WATCH_KEY_PREFIX\}_\$\{world\.cfg\.playerClass\}_\$\{world\.player\.name\}/,
    );
  });

  it('routes every tracker refresh write through the writer facet', () => {
    // The one sanctioned raw write is the constructor's static-skeleton
    // innerHTML (see the HOT_PAINTERS allowance); refreshes use writers only.
    expect(tracker.match(/\.innerHTML/g)?.length).toBe(1);
    expect(tracker).toContain('w.setWidth(els.fill');
    expect(tracker).toContain("w.setDisplay(this.root, view.visible ? '' : 'none')");
  });

  it('sends title changes through the facet with no optimistic local copy', () => {
    expect(painter).toMatch(/world\(\)\.setActiveTitle\(id === '' \? null : id\)/);
    expect(painter).not.toMatch(/activeTitle\s*=/);
  });

  it('prunes earned and stale watches in the render path and persists the drop', () => {
    // The wiring for the pure pruneWatched core (tests/deeds_view.test.ts):
    // render() must prune BEFORE the cap renders, and a drop must persist,
    // bump the repaint signature, and nudge the HUD tracker, or the freed
    // slot stays disabled until another dimension moves.
    expect(painter).toMatch(/if \(!this\.opened\) return;\s*this\.pruneWatchedIfStale\(\);/);
    const start = painter.indexOf('private pruneWatchedIfStale(');
    expect(start).toBeGreaterThan(-1);
    const body = painter.slice(start, painter.indexOf('private ensureWatchLoaded(', start));
    expect(body).toContain('pruneWatched(this.watchedSet, this.deps.world().deedsEarned, DEEDS)');
    expect(body).toContain('this.watchRev++;');
    expect(body).toContain('this.persistWatched();');
    expect(body).toContain('this.deps.onWatchChanged();');
  });

  it('elides slow-band repaints through the pure refresh-signature builders', () => {
    // Both builders live in deeds_view.ts where every repaint dimension is
    // unit-pinned; the painter must not grow a private signature again.
    expect(painter).toContain('const sig = deedsRefreshSig({');
    expect(painter).toContain('statsDigest: deedStatsDigest(world.deedStats),');
    expect(painter).not.toMatch(/private statsDigest\(/);
  });
});

describe('hud wiring', () => {
  it('constructs the window on the trapping windowFocus family', () => {
    expect(hud).toContain('new DeedsWindow({');
    expect(hud).toContain("...this.windowFocus('#deeds-window'),");
    expect(hud).toContain('onWatchChanged: () => this.updateDeedTracker(),');
  });

  it('routes Esc through the painter close (WCAG focus return)', () => {
    expect(hud).toMatch(/case 'deeds-window':[\s\S]{0,200}?this\.deedsWindow\.close\(\);/);
  });

  it('refreshes on the slow band and repaints on language switch', () => {
    expect(hud).toContain(
      'if (slowHud && this.deedsWindow.isOpen) this.deedsWindow.refreshIfChanged();',
    );
    expect(hud).toContain('if (slowHud) this.updateDeedTracker();');
    expect(hud).toContain('if (this.deedsWindow.isOpen) this.deedsWindow.render();');
  });

  it('accumulates deedUnlocked across the drain and batches AFTER the loop', () => {
    expect(hud).toMatch(/case 'deedUnlocked': \{\s*deedUnlocks\.push\(ev\);\s*break;/);
    expect(hud).toContain('if (deedUnlocks.length > 0) this.handleDeedUnlocks(deedUnlocks);');
    // The dead legacy arm is gone (the sim no longer emits it).
    expect(hud).not.toContain("case 'milestoneUnlocked'");
  });

  it('keeps the retro arm silent: one summary line, no banner, no audio', () => {
    const start = hud.indexOf('private handleDeedUnlocks(');
    const end = hud.indexOf('log(text: string', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = hud.slice(start, end);
    // Banner and audio are gated on the PLAN's fresh-unlock fields; the retro
    // count only ever feeds the one localized summary log line.
    expect(body).toContain('if (plan.bannerId !== null)');
    expect(body).toContain('if (plan.playSound) audio.levelUp();');
    expect(body).toMatch(
      /if \(plan\.retroCount > 0\) \{\s*const retroText = t\('hudChrome\.deeds\.retroSummary'/,
    );
    expect(body.match(/showBanner/g)?.length).toBe(1);
    expect(body.match(/audio\.levelUp/g)?.length).toBe(1);
  });

  it('announces the unlock and the retro summary through the polite #combat-live region', () => {
    // The banner div carries no live semantics and the chat log is aria-live
    // off, so BOTH earned-moment texts route through the throttled combat
    // announcer (once for the coalesced banner line, once for retro).
    const start = hud.indexOf('private handleDeedUnlocks(');
    const body = hud.slice(start, hud.indexOf('log(text: string', start));
    expect(body).toContain('this.combatAnnouncer.push(bannerText, performance.now());');
    expect(body).toContain('this.combatAnnouncer.push(retroText, performance.now());');
    expect(body.match(/combatAnnouncer\.push/g)?.length).toBe(2);
  });

  it('marks the watch toggle state and names the recent-strip crests', () => {
    expect(painter).toContain('aria-pressed="${entry.watched}"');
    expect(painter).toMatch(/deed-crest-mini[^>]*alt="\$\{esc\(deedName\(r\.id\)\)\}"/);
  });

  it('diverts chronicler interacts through the sim then opens the Chronicles section', () => {
    expect(hud).toMatch(
      /CHRONICLER_TEMPLATE_IDS[\s\S]{0,200}?this\.sim\.targetEntity\(npc\.id\);\s*this\.sim\.interact\(\);\s*this\.openDeeds\('chronicle'\);/,
    );
  });

  it('shows the active title and earned border badges on the character sheet', () => {
    expect(hud).toContain("t('hudChrome.deeds.charTitleLabel')");
    expect(hud).toContain('data-act="open-deeds"');
    expect(hud).toContain('class="ms-badge ms-deed-border"');
    expect(hud).toMatch(/reward\?\.kind === 'border' && sim\.deedsEarned\.has\(id\)/);
  });

  it('renders the inspected player title from the entity wire field', () => {
    expect(hud).toMatch(/e\.title && deedTitleText\(e\.title\) !== ''/);
    expect(hud).toContain('class="inspect-title"');
  });

  it('persists the tracker collapse as its own settings row', () => {
    expect(settingsSrc).toContain('deedTrackerCollapsed: { def: false },');
    expect(hud).toContain(
      "settings.set('deedTrackerCollapsed', !settings.get('deedTrackerCollapsed'));",
    );
  });
});

describe('entry HTMLs', () => {
  it('wires the window root and the tracker container in BOTH game entries', () => {
    for (const html of [indexHtml, playHtml]) {
      expect(html).toContain('id="deeds-window"');
      // No aria-hidden on the container: the collapse header is a real,
      // keyboard-reachable toggle (the quest-tracker contract).
      expect(html).toContain('<div id="deed-tracker"></div>');
      expect(html).not.toContain('id="deed-tracker" aria-hidden');
    }
  });

  it('ships the More-tray Deeds button in BOTH game entries (the /play shared-entry trap)', () => {
    for (const html of [indexHtml, playHtml]) {
      expect(html).toContain('id="mobile-deeds"');
      expect(html).toContain('data-i18n="hudChrome.mobile.deeds"');
      expect(html).toMatch(/id="mobile-deeds"[^>]*data-icon="book"/);
    }
    expect(chrome).toMatch(/deeds: 'Deeds',/);
  });

  it('ships the side-menu Deeds button in BOTH game entries, under the quest log', () => {
    for (const html of [indexHtml, playHtml]) {
      expect(html).toMatch(/id="mm-deeds"[^>]*data-icon="book"/);
      expect(html).toMatch(/id="mm-deeds"[^>]*data-i18n-title="hudChrome\.deeds\.title"/);
      // Dock order: quest log, then deeds, then map.
      const quest = html.indexOf('id="mm-quest"');
      const deeds = html.indexOf('id="mm-deeds"');
      const map = html.indexOf('id="mm-map"');
      expect(quest).toBeGreaterThan(-1);
      expect(deeds).toBeGreaterThan(quest);
      expect(map).toBeGreaterThan(deeds);
    }
    // hud.ts binds the click and repaints the keycap from the live binding.
    expect(hud).toContain("$('#mm-deeds').addEventListener('click', () => this.toggleDeeds());");
    expect(hud).toContain("['#mm-deeds', 'deeds', 'hudChrome.deeds.title'],");
  });
});

describe('tracker accessibility (quest-tracker contract)', () => {
  it('keeps the header a native tab stop, disclosure a11y gated on chip mode', () => {
    expect(tracker).not.toContain('tabindex="-1"');
    // Disclosure tier: the quest-tracker aria-expanded contract, live-synced.
    expect(tracker).toContain(
      "w.setAttr(this.header, 'aria-expanded', view.collapsed ? 'false' : 'true');",
    );
    // aria-controls ties the toggle to the watch list it shows/hides.
    expect(tracker).toContain('aria-controls="deed-watch-list"');
    expect(tracker).toContain('id="deed-watch-list"');
    // Chip tier (compact touch): a dialog opener, not a disclosure. The presence
    // swap is a direct DOM write on the mode transition, since the elided setAttr
    // facet has no removal path.
    expect(tracker).toContain("this.header.setAttribute('aria-haspopup', 'dialog')");
    expect(tracker).toContain("this.header.removeAttribute('aria-expanded')");
    expect(tracker).toContain("this.header.removeAttribute('aria-controls')");
    expect(tracker).toContain("t('hudChrome.deeds.openBookHint')");
  });

  it('hides the decorative glyphs from assistive tech (dt-count text carries the numbers)', () => {
    expect(tracker).toMatch(/dt-chevron" aria-hidden="true"/);
    expect(tracker).toMatch(/dt-bar" aria-hidden="true"/);
  });

  it('arms Enter/Space on #deed-tracker, stopped before the game binds hijack them', () => {
    const arm = hud.match(
      /\$\('#deed-tracker'\)\.addEventListener\('keydown',[\s\S]*?\n {4}\}\);/,
    )?.[0] as string;
    expect(arm).toBeTruthy();
    expect(arm).toContain("if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return;");
    expect(arm).toContain('e.preventDefault();');
    expect(arm).toContain('e.stopPropagation();');
    // The same compact-touch branch as the click delegation: the count chip
    // opens the Book, the desktop header toggles the collapse.
    expect(arm).toContain('this.openDeeds();');
    expect(arm).toContain('this.toggleDeedTrackerCollapsed();');
  });

  it('paints the gold focus ring on the focused header', () => {
    expect(hudCss).toMatch(
      /#deed-tracker \.dt-header:focus-visible \{\s*outline: 2px solid var\(--gold\);\s*outline-offset: 2px;\s*border-radius: 2px;\s*\}/,
    );
  });
});

describe('touch open chain (More tray -> Hud)', () => {
  it('binds the tray button to the onDeeds callback and main.ts routes it to the toggle', () => {
    expect(mobileControlsSrc).toContain(
      "this.bindButton('mobile-deeds', () => this.callbacks.onDeeds());",
    );
    expect(mobileControlsSrc).toContain('onDeeds(): void;');
    expect(mainSrc).toContain('onDeeds: () => hud.toggleDeeds(),');
  });
});

describe('touch long-press peek', () => {
  it('attaches the card tooltip and suppresses BOTH card actions on a peek release', () => {
    expect(painter).toContain(
      "this.deps.attachTooltip(card, () => this.cardTooltipHtml(card.dataset.deed ?? ''));",
    );
    // Each action arm consumes the shared guard FIRST: a peek release
    // dismisses the tooltip and fires nothing (watch toggle and title equip).
    expect(
      painter.match(
        /if \(this\.deps\.consumePeek\(\)\) \{\s*this\.deps\.hideTooltip\(\);\s*return;\s*\}/g,
      )?.length,
    ).toBe(2);
    // Association, not just count: the guard is the FIRST statement of the
    // [data-watch] handler AND of the [data-title] handler specifically.
    for (const selector of ['data-watch', 'data-title']) {
      expect(painter).toMatch(
        new RegExp(
          `\\('\\[${selector}\\]'\\)\\)\\s*\\{\\s*btn\\.addEventListener\\('click', \\(\\) => \\{\\s*` +
            `if \\(this\\.deps\\.consumePeek\\(\\)\\)`,
        ),
      );
    }
    expect(hud).toMatch(
      /new DeedsWindow\(\{[\s\S]{0,600}?consumePeek: \(\) => this\.peekGuard\.consume\(\),/,
    );
  });
});

describe('mobile layout (hud.mobile.css)', () => {
  it('pins the standalone full-screen window inside the safe-area insets', () => {
    const block = hudMobile.match(/body\.mobile-touch #deeds-window \{([^}]*)\}/)?.[1] as string;
    expect(block).toBeTruthy();
    expect(block).toContain('position: fixed;');
    expect(block).toContain('left: max(10px, env(safe-area-inset-left));');
    expect(block).toContain('right: max(10px, env(safe-area-inset-right));');
    expect(block).toContain('top: max(10px, env(safe-area-inset-top));');
    expect(block).toContain('bottom: max(10px, env(safe-area-inset-bottom));');
    expect(block).toContain('transform: none;');
    expect(block).toContain('max-width: none;');
    expect(block).toContain('overflow: hidden;');
    // The generic mobile .window rule reserves bottom safe-area padding for
    // centered windows that can reach under the home indicator; this window
    // is already inset-pinned on all four edges, so that rule would double
    // count the bottom inset and eat the short-landscape height budget.
    expect(block).toContain('padding-bottom: var(--window-pad);');
  });

  it('collapses the category rail to one horizontally scrollable chip row', () => {
    const rail = hudMobile.match(
      /body\.mobile-touch #deeds-window \.deeds-rail \{([^}]*)\}/,
    )?.[1] as string;
    expect(rail).toBeTruthy();
    expect(rail).toContain('flex-direction: row;');
    expect(rail).toContain('flex-wrap: nowrap;');
    expect(rail).toContain('overflow-x: auto;');
    expect(rail).toContain('overscroll-behavior-x: contain;');
    expect(rail).toContain('-webkit-overflow-scrolling: touch;');
    expect(hudMobile).toMatch(/body\.mobile-touch #deeds-window \.deeds-cat \{\s*flex: 0 0 auto;/);
  });

  it('lets the entry list yield on short landscape so the filter bar never clips', () => {
    // The components.css 100px floor must give inside the max-height media
    // block, or the flex column pushes the filter bar past the window edge
    // (the bank buy-row regression shape).
    const media = hudMobile.slice(hudMobile.indexOf('mobile deeds (standalone window + tracker)'));
    const shortBlock = media.match(
      /@media \(max-height: 480px\) \{([\s\S]*?)\n {2}\}/,
    )?.[1] as string;
    expect(shortBlock).toBeTruthy();
    expect(shortBlock).toMatch(/#deeds-window \.deeds-scroll \{\s*min-height: 44px;/);
    expect(shortBlock).toMatch(/#deeds-window \.deeds-body \{\s*min-height: 44px;/);
  });

  it('folds the tracker to a count chip on the compact tier and routes its tap to the Book', () => {
    expect(hudMobile).toMatch(
      /body\.mobile-touch\.hud-mobile-compact #deed-tracker \.dt-list \{\s*display: none;/,
    );
    expect(hudMobile).toMatch(
      /body\.mobile-touch\.hud-mobile-compact #deed-tracker \.dt-chevron \{\s*display: none;/,
    );
    expect(hudMobile).toMatch(
      /body\.mobile-touch #deed-tracker \.dt-list \{\s*max-height: 88px;\s*overflow: hidden;/,
    );
    // The hud delegation: compact touch tap opens the window, desktop keeps
    // the collapse toggle.
    expect(hud).toMatch(
      /body\.contains\('mobile-touch'\) && body\.contains\('hud-mobile-compact'\)[\s\S]{0,80}?this\.openDeeds\(\);/,
    );
  });
});

describe('keybind dispatch chain', () => {
  it('dispatches the deeds edge action end to end (keyboard and gamepad)', () => {
    expect(inputSrc).toMatch(/case 'deeds':\s*this\.cb\.onUiKey\('deeds'\);/);
    expect(mainSrc.match(/case 'deeds':\s*hud\.toggleDeeds\(\);/g)?.length).toBe(2);
  });
});

describe('renderer celebration + nameplate title', () => {
  it('fires one festival-gold burst for a fresh unlock and nothing for retro', () => {
    // The retro/reduced-motion decision lives in the pure shouldPlayDeedFirework
    // gate (tests/deed_fx_gate.test.ts covers its arms); pin that the arm routes
    // through it and bails on a false, so nobody can bypass the gate.
    expect(rendererSrc).toMatch(
      /case 'deedUnlocked': \{[\s\S]{0,500}?if \(!shouldPlayDeedFirework\(ev, this\.reducedMotion\(\)\)\) break;/,
    );
    expect(rendererSrc).toMatch(
      /this\.vfx\.fireworkBurst\(this\.tmpV, FESTIVAL_GOLD_COLORS, 46, 1\.1\);/,
    );
    // One shared palette, two sites (the Vale Cup draw show reuses it).
    expect(rendererSrc).toContain(
      'const FESTIVAL_GOLD_COLORS: readonly number[] = [0xffd14d, 0xfff2c0];',
    );
    expect(rendererSrc.match(/FESTIVAL_GOLD_COLORS/g)?.length).toBe(3);
  });

  it('renders the title subtitle cheap-diffed per (language, title id)', () => {
    expect(nameplateSrc).toContain('private setNameplateTitle(');
    expect(nameplateSrc).toMatch(/`\$\{getLanguage\(\)\}\|\$\{titleId\}`/);
    expect(nameplateSrc).toContain(
      'this.setNameplateTitle(v, suppressSelf ? undefined : e.title);',
    );
    expect(rendererSrc).toContain("titleEl.className = 'np-title';");
    expect(rendererSrc).toContain("titleSig: '',");
    expect(hudCss).toMatch(/\.np-title \{/);
  });
});

describe('chrome keys and CSS floors', () => {
  it('has every t() key the painters reference', () => {
    const keys = new Set<string>();
    for (const src of [painter, tracker, hud]) {
      for (const m of src.matchAll(/hudChrome\.deeds\.([A-Za-z]+)/g)) keys.add(m[1]);
    }
    expect(keys.size).toBeGreaterThan(20);
    for (const key of keys) {
      expect(chrome, `missing hud_chrome key deeds.${key}`).toMatch(
        new RegExp(`\\b${key}:\\s*(?:'|\\n)`),
      );
    }
  });

  it('keeps the 40px touch floor on every deeds tap target', () => {
    // Both dimensions: a short label (the All filter chip) renders under 40px
    // wide without the explicit width floor.
    expect(components).toMatch(
      /body\.mobile-touch \.deed-watch \{\s*min-width: 40px;\s*min-height: 40px;/,
    );
    expect(components).toMatch(
      /body\.mobile-touch \.deed-filter-chip \{\s*min-width: 40px;\s*min-height: 40px;/,
    );
    expect(components).toMatch(
      /body\.mobile-touch \.deed-title-option \{\s*min-width: 40px;\s*min-height: 40px;/,
    );
    expect(components).toMatch(
      /body\.mobile-touch \.deeds-cat \{\s*min-width: 40px;\s*min-height: 40px;/,
    );
    expect(hudCss).toMatch(
      /@media \(pointer: coarse\) \{\s*#deed-tracker \.dt-header \{\s*min-height: 40px;/,
    );
  });

  it('keeps the search input at the 16px iOS anti-zoom floor', () => {
    expect(components).toMatch(/\.deed-search \{[^}]*font-size: 16px/);
  });
});

describe('non-modal Enter/Space activation guard (WCAG 2.1.1)', () => {
  it('adds the Book of Deeds window to the guard array, keeping the shared guard body', () => {
    // The Book is a non-modal overlay, so canUseGameKeys() stays true while a
    // Book button has focus: without the guard, Space jumps the character and
    // Enter opens chat instead of activating the control. Mirror the bank pin
    // (tests/bank_window.test.ts): slice the guard array so removing the entry reds.
    const start = hud.indexOf("'#delve-board',");
    expect(start).toBeGreaterThan(0);
    const guardArray = hud.slice(start, hud.indexOf(']', start));
    expect(guardArray).toContain("'#deeds-window'");
    // The shared guard body the behavioral test below faithfully copies: it
    // stopPropagation's Enter/Space only when a BUTTON has focus and NEVER
    // preventDefault's (native activation survives). Scope the preventDefault
    // absence to the guard region so an unrelated hud handler cannot mask a drift.
    const guardRegion = hud.slice(start, hud.indexOf("$('#mm-map')", start));
    expect(guardRegion).toContain("(e.target as HTMLElement).tagName !== 'BUTTON'");
    expect(guardRegion).toContain('e.stopPropagation()');
    expect(guardRegion).not.toContain('preventDefault');
  });

  it('stops Enter/Space from the game binds on a focused Book button, preserving native activation', () => {
    // Drives the exact hud.ts guard body over a Book button. The source pin above
    // keeps hud.ts wiring #deeds-window into the array and keeps this copy honest;
    // deeds_window_focus.test.ts covers that the real Book renders buttons here.
    document.body.innerHTML = '<div id="deeds-window"><button data-close></button></div>';
    const root = document.getElementById('deeds-window') as HTMLElement;
    const btn = root.querySelector('button') as HTMLButtonElement;
    // The listener hud.ts installs on each guarded panel root (survives the
    // painter's innerHTML rebuilds because it lives on the root).
    root.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName !== 'BUTTON') return;
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') e.stopPropagation();
    });
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    btn.focus();
    for (const init of [
      { key: 'Enter', code: 'Enter' },
      { key: ' ', code: 'Space' },
    ]) {
      const ev = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
      btn.dispatchEvent(ev);
      // No preventDefault: the button's native activation still fires.
      expect(ev.defaultPrevented).toBe(false);
    }
    // stopPropagation kept both keys from reaching the window-level game binds.
    expect(windowSpy).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowSpy);
  });
});
