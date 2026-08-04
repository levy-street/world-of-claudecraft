// @vitest-environment happy-dom
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
import { audio } from '../src/game/audio';
import { deedName } from '../src/ui/deed_i18n';
import { Hud } from '../src/ui/hud';

// This file runs under jsdom (for the keyboard-guard behavioral test below),
// where import.meta.url is an http URL that readFileSync rejects; resolve the
// source-guard reads from __dirname instead.
const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

// Source-text pins must not be satisfiable by PROSE: several of the methods
// pinned below carry comments that name the very tokens the pins look for.
// Only WHOLE-line comments: a trailing-comment or URL-bearing code line must
// survive intact, or the pins below would stop seeing the code they guard.
const stripLineComments = (src: string): string => src.replace(/^\s*\/\/.*$/gm, '');

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
    // unit-pinned; the painter must not grow a private signature again. The
    // one currentSig() helper feeds BOTH the slow-band diff and the
    // post-paint latch (render() stamping lastSig is what keeps the first
    // slow-band tick after a jump from wiping the spotlight).
    expect(painter).toContain('return deedsRefreshSig({');
    expect(painter).toContain('const sig = this.currentSig();');
    expect(painter).toContain('this.lastSig = this.currentSig();');
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
    expect(body).toContain('if (plan.playSound) audio.achievement();');
    expect(body).toMatch(
      /if \(plan\.retroCount > 0\) \{\s*const retroText = t\('hudChrome\.deeds\.retroSummary'/,
    );
    expect(body.match(/showCelebrationBanner/g)?.length).toBe(1);
    expect(body.match(/audio\.achievement/g)?.length).toBe(1);
  });

  it("the level-up arm's three banners all ride the 'levelup' class (source pin)", () => {
    // Commit 81a0dc2037's claim, previously unpinned (the phase 14 QA): the
    // level banner, the talent-row toast, and the first-point banner all
    // queue under 'levelup', the class that files ahead of queued deeds.
    // Comment-stripped so the arm's own prose cannot satisfy the pin.
    const start = hud.indexOf("case 'levelup': {");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf("case 'virtualLevelUp'", start);
    expect(end).toBeGreaterThan(start);
    const body = stripLineComments(hud.slice(start, end));
    expect(body.match(/showCelebrationBanner\([^;]*'levelup'\)/g)?.length).toBe(3);
  });

  it('the duel and arena countdown arms lay a log line exactly when their banner is deferred', () => {
    // The durable-record arm (the phase 14 QA): a countdown banner parked
    // or aged out behind a celebration leaves the log line; an on-screen
    // one leaves none. Both arms carry the same shape.
    for (const anchor of ["case 'duelCountdown': {", "case 'arenaCountdown': {"]) {
      const start = hud.indexOf(anchor);
      expect(start, anchor).toBeGreaterThan(-1);
      const body = stripLineComments(hud.slice(start, hud.indexOf('break;', start)));
      expect(body, anchor).toContain(
        "if (this.showBanner(text) !== 'show') this.log(text, '#fa6');",
      );
    }
  });

  it("paints the earned moment in the deed variant, not the level-up's gold banner", () => {
    // A deed unlock used to fire the level-up's exact banner, and an early
    // character trips several deeds in its first few gathering actions, so the
    // two moments were unreadable apart. The variant is presentation only:
    // same copy, same lifetime, and the announcer push stays (information is
    // never gated on a visual).
    const start = hud.indexOf('private handleDeedUnlocks(');
    expect(start).toBeGreaterThan(-1);
    // Strip line comments first: this method's prose names the 'deed' variant,
    // so an uncommented slice would let a reworded comment satisfy the pin.
    const body = stripLineComments(hud.slice(start, hud.indexOf('log(text: string', start)));
    // The deed variant AND the R38 'deed' banner class both ride the call
    // (the celebration wrapper's second and third arguments): the class is
    // what queues it behind a live level-up instead of replacing it, the
    // variant is the visual split from the level-up gold.
    expect(body).toContain("this.showCelebrationBanner(bannerText, 'deed', 'deed');");
    expect(body).toContain('this.combatAnnouncer.push(bannerText, performance.now());');
  });

  it('gives the deed banner its own plate in CSS, on desktop and touch', () => {
    const tokensCss = read('../src/styles/tokens.css');
    // Bound the match to the rule's own block: an unbounded [\s\S]*? would
    // happily match a declaration in some LATER rule and go vacuous the day
    // another selector uses these tokens.
    const plateIdx = hudCss.indexOf('#banner.banner-deed');
    expect(plateIdx).toBeGreaterThan(-1);
    const plate = hudCss.slice(plateIdx, hudCss.indexOf('}', plateIdx));
    expect(plate).toMatch(/color:\s*var\(--color-deed-banner-text\)/);
    expect(plate).toMatch(/border:[^;]*var\(--color-deed-banner-border\)/);
    expect(plate).toMatch(/background:\s*var\(--color-deed-banner-bg\)/);
    // The decorative lift sheds with the graphics tier like its neighbours.
    expect(plate).toMatch(/box-shadow:[^;]*var\(--fx-shadow/);
    // Tokens carry real values, and the deed text colour is NOT the level-up
    // gold: aliasing it to --gold would keep every other pin green while
    // erasing the entire point of the variant.
    const tokenValue = (name: string): string => {
      const m = tokensCss.match(new RegExp(`${name}:\\s*([^;]+);`));
      expect(m, `${name} missing from tokens.css`).toBeTruthy();
      return (m?.[1] ?? '').trim();
    };
    for (const name of [
      '--color-deed-banner-text',
      '--color-deed-banner-border',
      '--color-deed-banner-bg',
    ]) {
      expect(tokenValue(name).length).toBeGreaterThan(2);
    }
    expect(tokenValue('--color-deed-banner-text')).not.toBe('var(--gold)');
    expect(tokenValue('--color-deed-banner-text').toLowerCase()).not.toBe('#ffd100');
    // ONE touch rule covers both orientations: it is a class more specific
    // than the landscape block's plain `body.mobile-touch #banner`, so a
    // second copy inside the media query would be dead CSS.
    expect(hudMobile.match(/body\.mobile-touch #banner\.banner-deed/g)?.length).toBe(1);
  });

  // The two source pins above prove hud.ts PASSES 'deed' and that showBanner
  // SETS the class, but neither executes the join. This drives the real
  // earned-moment arm end to end on the real Hud.prototype method.
  it('paints the real deed unlock as a deed-variant banner, with copy and lifetime intact', () => {
    vi.useFakeTimers();
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    try {
      const h = Object.create(Hud.prototype) as unknown as {
        bannerEl: HTMLElement;
        bannerTimer: number | undefined;
        log: ReturnType<typeof vi.fn>;
        logNodes: ReturnType<typeof vi.fn>;
        deedsWindow: { noteUnlocks: ReturnType<typeof vi.fn> };
        combatAnnouncer: { push: ReturnType<typeof vi.fn> };
        handleDeedUnlocks(events: { deedId: string; retro?: boolean }[]): void;
        showBanner(text: string): void;
      };
      h.bannerEl = document.createElement('div');
      h.bannerTimer = undefined;
      h.log = vi.fn();
      h.logNodes = vi.fn();
      h.deedsWindow = { noteUnlocks: vi.fn() };
      h.combatAnnouncer = { push: vi.fn() };

      h.handleDeedUnlocks([{ deedId: 'prog_first_steps' }]);

      // The variant actually reached the element.
      expect(h.bannerEl.classList.contains('banner-deed')).toBe(true);
      // Copy is unchanged: the localized unlock line, naming the deed, and it
      // still reaches the polite live region.
      const copy = h.bannerEl.querySelector('.banner-copy')?.textContent ?? '';
      expect(copy).toContain(deedName('prog_first_steps'));
      expect(h.combatAnnouncer.push).toHaveBeenCalledTimes(1);
      expect(h.combatAnnouncer.push.mock.calls[0][0]).toBe(copy);
      expect(achievement).toHaveBeenCalledTimes(1);

      // Lifetime is unchanged: the deed plate holds for the same 2600 ms the
      // shared slot has always used, so the variant cannot quietly linger.
      expect(h.bannerEl.style.opacity).toBe('1');
      vi.advanceTimersByTime(2599);
      expect(h.bannerEl.style.opacity).toBe('1');
      vi.advanceTimersByTime(1);
      expect(h.bannerEl.style.opacity).toBe('0');
      // The R38 advance gap: the slot stays claimed for the fade gap, then
      // frees (an arrival inside the gap would queue, not replace).
      vi.advanceTimersByTime(250);

      // THE R38 COLLISION, end to end on the real method: a deed landing
      // while the level-up banner is live queues behind it instead of
      // replacing it, and takes the slot whole after the gap.
      (
        h as unknown as {
          showBanner(
            text: string,
            motion?: boolean,
            icon?: string,
            variant?: string,
            subtext?: string,
            durationMs?: number,
            source?: null,
            bannerClass?: string,
          ): void;
        }
      ).showBanner('Level 2!', true, undefined, 'default', undefined, 2600, null, 'levelup');
      expect(h.bannerEl.textContent).toBe('Level 2!');
      h.handleDeedUnlocks([{ deedId: 'prog_first_steps' }]);
      // Still the level-up: the deed did NOT replace it.
      expect(h.bannerEl.textContent).toBe('Level 2!');
      vi.advanceTimersByTime(2600 + 250);
      // The queued deed now owns the slot, in its own variant.
      expect(h.bannerEl.textContent).toContain(deedName('prog_first_steps'));
      expect(h.bannerEl.classList.contains('banner-deed')).toBe(true);
      vi.advanceTimersByTime(2600 + 250);
      expect(h.bannerEl.style.opacity).toBe('0');

      // ...and a default banner through the same slot holds exactly as long.
      h.showBanner('Level 12!');
      expect(h.bannerEl.classList.contains('banner-deed')).toBe(false);
      expect(h.bannerEl.style.opacity).toBe('1');
      vi.advanceTimersByTime(2600);
      expect(h.bannerEl.style.opacity).toBe('0');
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  // Shared rig for the queue-lifecycle arms below: the same bare-prototype
  // shape the collision drive uses.
  function bannerRig() {
    const h = Object.create(Hud.prototype) as unknown as {
      bannerEl: HTMLElement;
      bannerTimer: number | undefined;
      bannerSource: 'unstuck' | null;
      log: ReturnType<typeof vi.fn>;
      logNodes: ReturnType<typeof vi.fn>;
      deedsWindow: { noteUnlocks: ReturnType<typeof vi.fn> };
      combatAnnouncer: { push: ReturnType<typeof vi.fn> };
      handleDeedUnlocks(events: { deedId: string; retro?: boolean }[]): void;
      showBanner(
        text: string,
        motion?: boolean,
        icon?: string,
        variant?: string,
        subtext?: string,
        durationMs?: number,
        source?: 'unstuck' | null,
        bannerClass?: string,
      ): string;
      showCelebrationBanner(text: string, bannerClass: 'levelup' | 'deed'): void;
      hideBannerImmediately(): void;
      clearUnstuckBanner(): void;
    };
    h.bannerEl = document.createElement('div');
    h.bannerTimer = undefined;
    h.bannerSource = null;
    h.log = vi.fn();
    h.logNodes = vi.fn();
    h.deedsWindow = { noteUnlocks: vi.fn() };
    h.combatAnnouncer = { push: vi.fn() };
    return h;
  }

  it('the mount-race takeover (hideBannerImmediately) keeps queued celebrations', () => {
    // The phase 14 QA finding: the takeover used clear(), silently
    // discarding queued level-up and deed banners. hideLive keeps them: the
    // race countdown claims the slot NOW, and the celebrations play after.
    vi.useFakeTimers();
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    try {
      const h = bannerRig();
      h.showCelebrationBanner('Level 2!', 'levelup');
      h.handleDeedUnlocks([{ deedId: 'prog_first_steps' }]);
      expect(h.bannerEl.textContent).toBe('Level 2!');
      h.hideBannerImmediately();
      expect(h.bannerEl.style.opacity).toBe('0');
      // The takeover's own ambient shows immediately in the freed slot...
      expect(h.showBanner('3')).toBe('show');
      expect(h.bannerEl.textContent).toBe('3');
      // ...and the queued deed still plays after it.
      vi.advanceTimersByTime(2600 + 250);
      expect(h.bannerEl.textContent).toContain(deedName('prog_first_steps'));
      expect(achievement).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('a takeover that never shows its own banner still advances the queue after the gap', () => {
    // The fix-round review: hideBannerImmediately freed the slot but armed
    // no advance, so surviving celebrations waited on an unrelated future
    // banner. The self-armed gap timer closes it; a takeover that DOES
    // paint (the mount-race arm above) clears that timer through its own
    // paint, so this arm drives the hide with no show at all.
    vi.useFakeTimers();
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    try {
      const h = bannerRig();
      h.showCelebrationBanner('Level 2!', 'levelup');
      h.handleDeedUnlocks([{ deedId: 'prog_first_steps' }]);
      h.hideBannerImmediately();
      expect(h.bannerEl.style.opacity).toBe('0');
      vi.advanceTimersByTime(250);
      expect(h.bannerEl.textContent).toContain(deedName('prog_first_steps'));
      expect(achievement).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('clearUnstuckBanner ends the unstuck line early and advances to a waiting celebration', () => {
    // docs/design/banner-queue.md's contract for the unstuck purge, driven
    // on the real methods (the pure retainQueued arm alone cannot see the
    // Hud half): the live unstuck banner clears and the queued level-up
    // takes the slot immediately.
    vi.useFakeTimers();
    try {
      const h = bannerRig();
      h.showBanner('Stuck? Hold still.', true, undefined, 'default', undefined, 2600, 'unstuck');
      h.showCelebrationBanner('Level 3!', 'levelup');
      expect(h.bannerEl.textContent).toBe('Stuck? Hold still.');
      h.clearUnstuckBanner();
      expect(h.bannerEl.textContent).toBe('Level 3!');
      expect(h.bannerEl.style.opacity).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a parked ambient older than the defer window is dropped, a fresh one replays', () => {
    // The phase 14 QA finding: an ambient is current-state, so replaying it
    // seconds late misleads. Behind ONE celebration (2850ms) it is still
    // fresh and replays; behind a celebration CHAIN (5700ms) it ages out.
    // performance must be faked alongside the timers or the stamp cannot
    // age with advanceTimersByTime.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const fresh = bannerRig();
      fresh.showCelebrationBanner('Level 2!', 'levelup');
      fresh.showBanner('Mirefen Marsh');
      vi.advanceTimersByTime(2600 + 250);
      expect(fresh.bannerEl.textContent).toBe('Mirefen Marsh');

      const stale = bannerRig();
      stale.showCelebrationBanner('Level 2!', 'levelup');
      stale.showCelebrationBanner('Level 3!', 'levelup');
      stale.showBanner('Mirefen Marsh');
      vi.advanceTimersByTime(2600 + 250);
      expect(stale.bannerEl.textContent).toBe('Level 3!');
      vi.advanceTimersByTime(2600 + 250);
      // The parked zone line aged past AMBIENT_MAX_DEFER_MS while the chain
      // played: dropped, the slot goes idle instead of replaying it.
      expect(stale.bannerEl.textContent).not.toBe('Mirefen Marsh');
      expect(stale.bannerEl.style.opacity).toBe('0');
    } finally {
      vi.useRealTimers();
    }
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

  it('marks the watch toggle state and names the recent-strip jump buttons', () => {
    expect(painter).toContain('aria-pressed="${entry.watched}"');
    // The strip crest is a jump button: the accessible name rides the button
    // (aria-label + title from the deed name), and the crest img inside stays
    // alt="" so the deed is not announced twice.
    expect(painter).toMatch(/deeds-recent-item" data-recent="\$\{esc\(r\.id\)\}"/);
    expect(painter).toMatch(
      /aria-label="\$\{esc\(t\('hudChrome\.deeds\.recentJumpAria', \{ name: deedName\(r\.id\) \}\)\)\}"/,
    );
    expect(painter).toMatch(/deed-crest-mini[^>]*alt=""/);
  });

  it('shows the active title and earned border badges on the character sheet', () => {
    expect(hud).toContain("t('hudChrome.deeds.charTitleLabel')");
    expect(hud).toContain('data-act="open-deeds"');
    expect(hud).toContain('class="ms-badge ms-deed-border"');
    expect(hud).toMatch(/reward\?\.kind === 'border' && sim\.deedsEarned\.has\(id\)/);
  });

  it('renders the inspected player title from the entity wire field', () => {
    // The showcase redesign extracted inspect out of hud.ts into the inspect_window
    // painter (deed-title resolution) over the inspect_view pure core (the empty vs
    // present gate). The rendered subtitle keeps its class.
    const inspectWindow = read('../src/ui/inspect_window.ts');
    const inspectView = read('../src/ui/inspect_view.ts');
    expect(inspectWindow).toContain("e.title ? deedTitleText(e.title) : ''");
    expect(inspectView).toContain(
      "deedTitle: input.deedTitleText !== '' ? input.deedTitleText : null",
    );
    expect(inspectWindow).toContain('class="inspect-title"');
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

  it('renders the title subtitle cheap-diffed per (i18n revision, title id)', () => {
    expect(nameplateSrc).toContain('private setNameplateTitle(');
    // Keyed on a monotonic i18n revision rather than getLanguage(): the dev
    // pseudo-locale deliberately leaves getLanguage() at 'en' while changing
    // what t() resolves to, so a language-keyed gate left pseudo text on screen
    // after switching back.
    expect(nameplateSrc).toMatch(/`\$\{i18nRevision\}\|\$\{titleId\}`/);
    expect(nameplateSrc).toContain(
      'if (id === v.nameplateTitleId && i18nRevision === v.nameplateTitleI18nRevision) return;',
    );
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
    // The recent-strip jump buttons: the floor lives in hud.mobile.css and
    // must be UNCONDITIONAL under body.mobile-touch (a landscape tablet never
    // enters the short-phone media block).
    expect(hudMobile).toMatch(
      /body\.mobile-touch #deeds-window \.deeds-recent-item \{\s*min-width: 40px;\s*min-height: 40px;/,
    );
  });

  it('the jump spotlight flashes once and degrades to a static ring under reduced motion', () => {
    expect(components).toMatch(
      /\.deed-card-flash \{\s*animation: deed-card-flash 1\.6s ease-out 1;/,
    );
    // The reduced-motion arm swaps the pulse for a persistent ring: the only
    // landing cue those users get, so it must not silently vanish.
    expect(components).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.deed-card-flash \{\s*animation: none;\s*box-shadow: inset 0 0 0 2px var\(--gold-dim\);/,
    );
  });

  it('the chat deed link carries the shared focus ring and link affordance', () => {
    expect(hudCss).toMatch(
      /\.chat-deed-link \{\s*cursor: var\(--cursor-point\);\s*text-decoration: underline;/,
    );
    expect(hudCss).toMatch(
      /\.chat-deed-link:focus-visible \{\s*outline: 2px solid var\(--color-border-focus\);/,
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
