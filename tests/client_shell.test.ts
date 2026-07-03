import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// The CSS extraction moved the :root tokens and the reset/base
// block (universal reset, scrollbars, forms, the global canvas/#ui/#nameplates base
// rules) out of index.html's inline <style> into src/styles/base.css, loaded by the
// game entries via the src/styles/index.css barrel. It then moved the in-world
// HUD chrome (nameplates, frames, bars, chat, trackers, meters, minimap, community
// HUD, tooltip, FCT, the Interface/adaptive/perf rules, the Fiesta HUD, and the
// center/vignette/death overlays) into src/styles/hud.css (@layer components), and
// the UI-chrome-icon glyph sizing into base.css. It then moved the feature windows
// (delve, lockpick, the classic stat windows, vendor/bags/social/map, arena/market/
// options/theme/emote) into src/styles/components.css and the shared .window shell into
// src/styles/layout.css. Assertions on relocated rules read base.css / hud.css /
// components.css / layout.css. It then moved the desktop pre-game shell + char
// select (start screen, loading, play console, skin picker rows, login form, the
// animated + cinematic backdrops, controls drawer, char list + delete modal + class
// details, and the unified character-select layout + skin-select overlay, each with its
// interspersed body.mobile-touch shell rules) into src/styles/shell.css (@layer shell),
// so assertions on those rules read shell.css. A later step finished the extraction: the
// in-game mobile-touch controls section moved into src/styles/hud.mobile.css (@layer
// hud.mobile), the orphaned chrome + paperdoll/bags into hud.css/components.css and
// the pre-start rule into base.css, and BOTH inline <style> blocks were emptied
// (play.html reconciled to the shared modules). So mobile-touch assertions read
// hudMobileCss; the per-entry #rotate-device orientation gate lives in
// index.extra.css / play.extra.css. Note biome reformats the moved rules one-
// declaration-per-line, so the repointed expectations use that format, not the compact
// inline form.
const baseCss = readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const componentsCss = readFileSync(
  new URL('../src/styles/components.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const shellCss = readFileSync(new URL('../src/styles/shell.css', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const hudMobileCss = readFileSync(
  new URL('../src/styles/hud.mobile.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const indexExtraCss = readFileSync(
  new URL('../src/styles/index.extra.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const playHtml = readFileSync(new URL('../play.html', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const privacyHtml = readFileSync(
  new URL('../public/privacy.html', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const termsHtml = readFileSync(new URL('../public/terms.html', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const dataDeletionHtml = readFileSync(
  new URL('../public/data-deletion.html', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const supportHtml = readFileSync(
  new URL('../public/support.html', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const whitepaperUrl = new URL(
  '../public/World-of-ClaudeCraft-Whitepaper-v1.0.pdf',
  import.meta.url,
);
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const serverMain = readFileSync(new URL('../server/main.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
// The Esc options menu was extracted to options_view.ts (the declarative menu
// model) + options_window.ts (the painter); the menu guard reads the
// model rather than the old inline hud.ts main-menu builder.
const optionsViewTs = readFileSync(
  new URL('../src/ui/options_view.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
// The XP bar was extracted to xp_bar.ts (the view core) + xp_bar_painter.ts (the
// painter); the mobile-XP-ring guard reads the painter (which drives
// --xp-fill on both #xpbar and #player-frame through the elided writers) rather
// than the old inline hud.ts xp block.
const xpBarPainterTs = readFileSync(
  new URL('../src/ui/xp_bar_painter.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
// The World Market window was extracted to market_view.ts (the state model) +
// market_window.ts (the painter); the browse/filter/pagination guards read
// the painter rather than the old inline hud.ts renderMarket cluster.
const marketWindowTs = readFileSync(
  new URL('../src/ui/market_window.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
// The spellbook window was extracted to spellbook_view.ts (the class-kit model) +
// spellbook_window.ts (the painter); the spellbook guards read the painter
// rather than the old inline hud.ts renderSpellbook cluster.
const spellbookWindowTs = readFileSync(
  new URL('../src/ui/spellbook_window.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const mobileControlsTs = readFileSync(
  new URL('../src/game/mobile_controls.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const characterPreviewTs = readFileSync(
  new URL('../src/render/characters/preview.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
// Per-frame keyed-pool painters. The per-member party rows,
// the aura slots, and the FCT nodes used to be inline createElement / innerHTML in
// hud.ts; they dissolved into these pooled painters, so the shape guards below grep
// the painter that owns the pool now, not a static id in hud.ts (moved-id sweep).
const partyFrameRowTs = readFileSync(
  new URL('../src/ui/party_frame_row.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const aurasPainterTs = readFileSync(
  new URL('../src/ui/auras_painter.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const fctPainterTs = readFileSync(
  new URL('../src/ui/fct_painter.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const robotsTxt = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const sitemapXml = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);

function splitGameUiTemplate(): { templateHtml: string; liveHtml: string } {
  const marker = '<template id="game-ui-template">';
  const start = html.indexOf(marker);
  const end = html.indexOf('</template>', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const templateHtml = html.slice(start, end + '</template>'.length);
  return {
    templateHtml,
    liveHtml: html.slice(0, start) + html.slice(end + '</template>'.length),
  };
}

describe('client HTML shell', () => {
  it('keeps game HUD controls out of the live startup DOM', () => {
    const { liveHtml, templateHtml } = splitGameUiTemplate();

    expect(templateHtml).toContain('id="ui"');
    expect(templateHtml).toContain('Release Spirit');
    // chat tabs (Chat / Combat Log / channels) are rendered into #chatlog-tabs
    // by the HUD, so we assert on the container rather than a static label
    expect(templateHtml).toContain('id="chatlog-tabs"');
    expect(templateHtml).toContain('id="chat-input"');

    expect(liveHtml).not.toContain('id="ui"');
    expect(liveHtml).not.toContain('Release Spirit');
    expect(liveHtml).not.toContain('id="chatlog-tabs"');
    expect(liveHtml).not.toContain('id="chat-input"');
  });

  it('carries the map-canvas a11y label + #map-summary live region in BOTH entries', () => {
    // updateMapWindow() writes the sr-only summary on every redraw via
    // setText($('#map-summary'), ...), which is not null-guarded, so the element
    // MUST exist in every entry that ships the map window or opening the map
    // throws. index.html and play.html both boot src/main.ts and both carry the
    // map window, so the live region + canvas accessible name must be in both.
    expect(hudTs).toContain("const summaryEl = $('#map-summary');");
    for (const entry of [html, playHtml]) {
      expect(entry).toContain('id="map-canvas"');
      expect(entry).toContain('data-i18n-aria="hud.core.mapCanvasLabel"');
      expect(entry).toContain('<span id="map-summary"');
      expect(entry).toContain('role="status"');
      expect(entry).toContain('aria-live="polite"');
    }
  });

  it('places skip links as the first focusable elements in BOTH entries', () => {
    for (const entry of [html, playHtml]) {
      const skipMain = entry.indexOf('class="hud-skip" href="#ui"');
      const skipChat = entry.indexOf('class="hud-skip" href="#chatlog"');
      expect(skipMain).toBeGreaterThan(-1);
      expect(skipChat).toBeGreaterThan(-1);
      // English-only hud_chrome control labels via data-i18n (the catalog exception).
      expect(entry).toContain('data-i18n="hudChrome.skipLinks.mainHud"');
      expect(entry).toContain('data-i18n="hudChrome.skipLinks.chat"');
      // First focusable: the skip links precede the canvas + the templated game UI,
      // and the main-HUD link comes first.
      expect(skipMain).toBeLessThan(entry.indexOf('id="game-canvas"'));
      expect(skipMain).toBeLessThan(skipChat);
      // The skip targets must be focusable landing points (tabindex=-1).
      expect(entry).toContain('<div id="ui" tabindex="-1">');
    }
  });

  it('carries the combat / target / chat live regions in BOTH entries without double-announcing', () => {
    for (const entry of [html, playHtml]) {
      // The chat pane keeps role="log" + tabindex="-1" (visible scrollback + the "skip
      // to chat" landing target) but flips to aria-live="off": role="log" carries an IMPLICIT
      // polite, and #chatlog goes display:none on the combat tab, so it must NOT announce.
      // Chat is announced by the tab-independent #chat-live region instead.
      expect(entry).toContain(
        '<div id="chatlog" class="chat-pane active" role="log" aria-live="off" tabindex="-1">',
      );
      expect(entry).not.toContain(
        '<div id="chatlog" class="chat-pane active" role="log" aria-live="polite" tabindex="-1">',
      );
      // The off-screen polite combat summary the throttled announcer writes; a separate
      // node so it never re-announces what an existing aria-live / role=alert speaks.
      expect(entry).toContain(
        '<div id="combat-live" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">',
      );
      // The polite target-name region, announced once per target CHANGE,
      // mirroring the #combat-live template (a separate off-screen status node, NOT inside
      // #target-frame).
      expect(entry).toContain(
        '<div id="target-live" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">',
      );
      // The tab-independent polite chat region (always in the layout, so it
      // announces regardless of which chat tab's pane is visible), mirroring #combat-live.
      expect(entry).toContain(
        '<div id="chat-live" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">',
      );
    }
    // Wired into the single combatLog funnel, throttled (never assertive-spammed).
    expect(hudTs).toContain('this.combatAnnouncer.push(text, performance.now());');
  });

  it('drops the user-scalable viewport scale-lock in BOTH entries (16px anti-zoom floor stays)', () => {
    for (const entry of [html, playHtml]) {
      expect(entry).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
      );
      expect(entry).not.toContain('user-scalable=no');
      expect(entry).not.toContain('maximum-scale=1.0');
    }
  });

  it('ships the forced-colors + print + skip-link a11y CSS, forced-colors as the only contrast adaptation', () => {
    // forced-colors is the only AUTOMATIC contrast adaptation: no
    // @media (prefers-color-scheme) switch in the corpus. (A user-selectable light
    // parchment / highContrast theme exists via theme.ts at runtime; this guards only
    // the absence of an automatic CSS theme switch.)
    expect(baseCss).toContain('@media (forced-colors: active) {');
    expect(baseCss).toMatch(/outline:\s*2px solid Highlight/);
    expect(baseCss).toContain('border: 1px solid CanvasText');
    expect(baseCss).not.toMatch(/@media\s*\(prefers-color-scheme/);
    // Minimal print reset (hide, do not reflow).
    expect(baseCss).toContain('@media print {');
    // Skip-link reveal with a :focus-visible ring.
    expect(baseCss).toContain('.hud-skip {');
    expect(baseCss).toContain('.hud-skip:focus-visible {');
  });

  it('draws the party focus ring at full strength WITHOUT animating it', () => {
    // A dimmed dead/oor row resets opacity to 1 on keyboard focus so the global outline
    // ring is full, not dimmed. Because .party-frame transitions opacity 0.2s and opacity
    // applies to the outline, the reset MUST also kill the transition (transition: none),
    // or the ring would fade in over 200ms, which the rule forbids (a focus ring is
    // never animated). This pins both halves so a future edit cannot reintroduce the fade.
    const focusRule = hudCss.match(/\.party-frame:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(focusRule).toMatch(/opacity:\s*1/);
    expect(focusRule).toMatch(/transition:\s*none/);
  });

  it('labels the player frame as a role=group with a localized name in BOTH entries', () => {
    // #player-frame is a role="group" with a t()-localized accessible name via
    // data-i18n-aria. index.html and play.html both boot src/main.ts and ship the same
    // in-game HUD, so the group label must be present in BOTH entries or a screen
    // reader on one of them announces a bare unlabelled div. Pinning the full opening
    // tag also locks the attribute order + the exact i18n key across entries.
    for (const entry of [html, playHtml]) {
      expect(entry).toContain(
        'id="player-frame" class="unitframe" role="group" data-i18n-aria="hudChrome.unitFrame.playerLabel"',
      );
    }
  });

  it('labels both cast bars as role=progressbar with a localized name in BOTH entries', () => {
    // #castbar (player) and #tf-castbar (target) go through one cast_bar
    // painter and makes each a progressbar with aria-value bounds + a t()-localized
    // accessible name via data-i18n-aria (hydrated in main.ts). index.html and
    // play.html ship the same in-game HUD, so both bars must carry the role +
    // accessible name in BOTH entries or a screen reader on one announces a bare bar.
    for (const entry of [html, playHtml]) {
      expect(entry).toContain(
        'id="castbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" data-i18n-aria="hudChrome.castBar.playerAria"',
      );
      expect(entry).toContain(
        'id="tf-castbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" data-i18n-aria="hudChrome.castBar.targetAria"',
      );
    }
  });

  it('labels the target frame as a role=group with a localized name in BOTH entries', () => {
    // #target-frame is a second unit_frame instance and gets a
    // role="group" with a t()-localized accessible name via data-i18n-aria (hydrated
    // in main.ts, the same path as the player frame). index.html and play.html ship
    // the same in-game HUD, so the group label must be present in BOTH or a screen
    // reader on one announces a bare unlabelled div. Pinning the full opening tag also
    // locks the attribute order + the exact i18n key across entries.
    for (const entry of [html, playHtml]) {
      expect(entry).toContain(
        'id="target-frame" class="unitframe" role="group" data-i18n-aria="hudChrome.unitFrame.targetLabel"',
      );
    }
  });

  it('labels the party-frames region as a role=group with a localized name in BOTH entries', () => {
    // Each party member is a focusable role="button" named by its visible
    // member text, and labels the #party-frames container as a role="group" via
    // data-i18n-aria (hydrated in main.ts). index.html and play.html ship the same HUD,
    // so the region label must be present in BOTH or a screen reader on one entry
    // announces a bare unlabelled div. The full opening tag locks the i18n key too.
    for (const entry of [html, playHtml]) {
      expect(entry).toContain(
        'id="party-frames" role="group" data-i18n-aria="hudChrome.unitFrame.partyLabel"',
      );
    }
  });

  it('drives the party frames as a keyed node pool, not the inline innerHTML wipe', () => {
    // The #party-frames container is resolved ONCE and the keyed-pool painter owns its
    // children; the old per-rebuild innerHTML wipe + per-member createElement +
    // re-attached click/contextmenu listeners are gone.
    expect(hudTs).toContain("private partyFramesEl = $('#party-frames');");
    expect(hudTs).toContain('private readonly partyFramesPainter = new PartyFramesPainter(');
    // The cheap signature is computed BEFORE the selector so an unchanged party
    // allocates nothing (the hoist), and the selector call follows the short-circuit.
    const body = hudTs.slice(hudTs.indexOf('private updatePartyFrames(): void {'));
    const sigAt = body.indexOf('partyFrameSignature(');
    const shortCircuitAt = body.indexOf('if (sig === this.lastPartySig) return;');
    const selectorAt = body.indexOf('selectPartyFrameMembers(');
    expect(sigAt).toBeGreaterThanOrEqual(0);
    expect(shortCircuitAt).toBeGreaterThan(sigAt);
    expect(selectorAt).toBeGreaterThan(shortCircuitAt);
    // The inline party render is gone (the --cls setProperty + the per-rebuild
    // contextmenu re-attach the keyed pool replaced).
    expect(hudTs).not.toContain("frame.style.setProperty('--cls', classCss(m.cls))");
    // The pooled rows re-localize on a language switch (their DOM is never rebuilt), so
    // refreshLocalizedDynamicUi must drive the painter's relocalize.
    const refresh = hudTs.slice(hudTs.indexOf('private refreshLocalizedDynamicUi(): void {'));
    expect(
      refresh.slice(0, refresh.indexOf('\n  }')).includes('this.partyFramesPainter.relocalize();'),
    ).toBe(true);
  });

  it('drives the arena window relocalize from refreshLocalizedDynamicUi (live language switch)', () => {
    // The arena window's render-skip signature is text-independent (the offline sentinel,
    // or a JSON of ids/numbers), so a language switch never moves it on its own; the
    // localized-UI fan-out must call its relocalize() to force one rebuild with fresh t().
    const refresh = hudTs.slice(hudTs.indexOf('private refreshLocalizedDynamicUi(): void {'));
    expect(
      refresh.slice(0, refresh.indexOf('\n  }')).includes('this.arenaWindow.relocalize();'),
    ).toBe(true);
  });

  it('routes the cold-window closeManagedWindow cases through their painter close() for focus-return', () => {
    // closeManagedWindow must hand each cold window to its own painter close() so focus
    // returns to the opener (WCAG 2.4.3), not an inline el.style.display='none' that drops
    // focus to <body>. Slice the switch body so a close() call elsewhere does not satisfy
    // the case-specific assertions.
    const cmStart = hudTs.indexOf('private closeManagedWindow(');
    const cmBody = hudTs.slice(cmStart, hudTs.indexOf('\n  private ', cmStart + 1));
    expect(cmStart).toBeGreaterThan(-1);
    expect(cmBody).toContain("case 'char-window':");
    expect(cmBody).toContain('this.charWindow.close();');
    // The sibling cold windows route the same way; lock the family so a future case is not
    // left on an inline hide that drops focus.
    expect(cmBody).toContain('this.socialWindow.close();');
    expect(cmBody).toContain('this.arenaWindow.close();');
    expect(cmBody).toContain('this.talentsWindow.close();');
    expect(cmBody).toContain('this.spellbookWindow.close();');
    // Bags is the NON-MODAL companion (no trap), but still returns focus via close().
    expect(cmBody).toContain('this.bagsWindow.close();');
  });

  it('clears #bags inert on the mobile-touch closeVendor hide path (backstop)', () => {
    // closeVendor hides #bags directly on mobile-touch (it does NOT route through
    // BagsWindow.close()), so a discard/sell prompt that left #bags inert would strand a
    // dead grid on the next open. The mobile-bags hide branch must clear inert itself.
    const cvStart = hudTs.indexOf('closeVendor(): void {');
    const cvBody = hudTs.slice(cvStart, hudTs.indexOf('\n  get vendorOpen', cvStart));
    expect(cvStart).toBeGreaterThan(-1);
    expect(cvBody).toContain('.inert = false;');
  });

  it('drives the target frame as a unit_frame instance with a cached absorb node', () => {
    // The target absorb overlay is resolved ONCE (no per-frame updateAbsorb document
    // query), and the family painter drives the frame, so the old hardcoded
    // '#tf-absorb' selector + the per-frame updateAbsorb method are gone.
    expect(hudTs).toContain("private targetAbsorbEl = $('#tf-absorb');");
    expect(hudTs).toContain('private readonly targetFramePainter = new UnitFramePainter(');
    // The per-frame updateAbsorb method + call are gone (the word may still appear in
    // explanatory comments, so pin the call + def, not the bare word).
    expect(hudTs).not.toContain('private updateAbsorb');
    expect(hudTs).not.toContain('this.updateAbsorb(');
    // The '#tf-absorb' node is QUERIED exactly ONCE (the cached field), never
    // re-queried per frame the way the old updateAbsorb('#tf-absorb', ...) did. Match
    // the query call, not the bare selector (which still appears in comments).
    expect(hudTs.match(/\$\('#tf-absorb'\)/g)).toHaveLength(1);
  });

  it('routes the target elite class + name color + combo pips + hostile cue through the elided writers', () => {
    // The two raw writes the four original writers cannot express (the elite class and
    // the hostile/friendly name color) go through the toggleClass / setStyleProp,
    // and the combo pip `on` toggle through toggleClass. No raw classList/style write
    // on the target frame survives (those silently collapse the hot-DOM skip rate).
    expect(hudTs).toContain("this.toggleClass(this.targetFrameEl, 'elite'");
    expect(hudTs).toMatch(/this\.setStyleProp\(\s*this\.targetNameEl,\s*'color',/);
    expect(hudTs).toContain("this.toggleClass(pips[i] as HTMLElement, 'on', i < points);");
    // The forced-colors hostile cue is a non-color redundant marker on the target
    // name, routed through the same elided toggleClass writer (no raw class write on the
    // per-frame hot path) so it stays write-elided.
    expect(hudTs).toContain("this.toggleClass(this.targetNameEl, 'hostile', target.hostile);");
    expect(hudTs).not.toContain("this.targetNameEl.classList.toggle('hostile'");
    expect(hudTs).not.toContain("this.targetFrameEl.classList.toggle('elite'");
    expect(hudTs).not.toContain('this.targetNameEl.style.color');
    expect(hudTs).not.toContain("pip.classList.toggle('on'");
  });

  it('reconciles every #bags display show-site to flex and every read-guard to !== none', () => {
    // #bags is a flex-column layout (components.css flex-direction: column). Every show-site
    // must set display = 'flex' (a 'block' drops the column), and every render read-guard must
    // test !== 'none' (an === 'block' guard never fired when bags was opened via the common
    // flex path). No '#bags' 'block' display write or read survives, in either the $('#bags')
    // or the cached-var (drag drop-target) form.
    expect(hudTs).not.toContain("#bags').style.display = 'block'");
    expect(hudTs).not.toContain("#bags').style.display === 'block'");
    expect(hudTs).not.toContain("bags.style.display = 'block'");
    expect(hudTs).not.toContain("bags.style.display !== 'block'");
    expect(hudTs).toContain("$('#bags').style.display = 'flex';");
    expect(hudTs).toContain("$('#bags').style.display !== 'none'");
    expect(hudTs).toContain("bags.style.display !== 'flex'");
  });

  it('lazy-builds the combo pips once, then only toggles them', () => {
    // The 5-pip row is built ONCE (guarded by children.length !== COMBO_PIP_COUNT),
    // never rebuilt per frame; a per-frame innerHTML rebuild would tank the skip rate
    // while passing tsc + the painter tests.
    expect(hudTs).toContain('if (this.comboRowEl.children.length !== COMBO_PIP_COUNT) {');
    expect(hudTs).toContain('for (let i = 0; i < COMBO_PIP_COUNT; i++) {');
  });

  it('keeps the Account nav tab hidden unless a session is restored', () => {
    expect(html).toContain('<li class="nav-item" id="nav-item-account" hidden>');
    expect(html).toContain('<li class="nav-item" id="nav-item-logout" hidden>');
    expect(mainTs).toContain('if (api.restoreSession()) {');
    expect(mainTs).toContain(
      "} else {\n    enterLoggedOutChrome();\n    if (isDesktopLoginPage()) show('#login-panel');\n  }",
    );
  });

  it('keeps the Discord unlink panel clickable over the pre-game shell', () => {
    const startZ = Number(shellCss.match(/#start-screen \{[\s\S]*?z-index: (\d+);/)?.[1]);
    const modalZ = Number(shellCss.match(/\.modal-backdrop \{[\s\S]*?z-index: (\d+);/)?.[1]);
    const discordZ = Number(indexExtraCss.match(/#discord-window \{[\s\S]*?z-index: (\d+);/)?.[1]);
    expect(discordZ).toBeGreaterThan(startZ);
    expect(discordZ).toBeLessThan(modalZ);
  });

  it('keeps the Discord unlink modal at top level so it shows in-game', () => {
    // #start-screen is display:none once the game starts (main.ts hides it) and is a
    // lower z-index:100 stacking context, so a keep-modal nested inside it would be
    // invisible in-game and trapped below the top-level #discord-window. It must be a
    // top-level sibling declared above #start-screen, exactly like #discord-window.
    const modalAt = html.indexOf('id="discord-keep-modal"');
    const windowAt = html.indexOf('id="discord-window"');
    const startAt = html.indexOf('id="start-screen"');
    expect(modalAt).toBeGreaterThan(-1);
    expect(windowAt).toBeGreaterThan(-1);
    // Declared before #start-screen opens, hence a top-level sibling, never a descendant.
    expect(modalAt).toBeLessThan(startAt);
    expect(windowAt).toBeLessThan(startAt);
  });

  it('shows a logged-in Logout nav item next to Account', () => {
    expect(html).toContain('id="nav-btn-account"');
    expect(html).toContain('id="nav-btn-logout"');
    expect(html.indexOf('id="nav-btn-account"')).toBeLessThan(html.indexOf('id="nav-btn-logout"'));
    expect(html).toContain('data-i18n="nav.logout"');
    expect(mainTs).toContain("const loggedInNavItems = ['#nav-item-account', '#nav-item-logout'];");
    expect(mainTs).toContain('function logoutAccount(): void {');
    expect(mainTs).toContain('void api.logout().finally(finish);');
    expect(mainTs).toContain('api.clearSession();');
    expect(mainTs).toContain("setupNavBtn($('#nav-btn-logout'), '#hero-view', logoutAccount);");
  });

  it('requires users to confirm a new account password', () => {
    expect(html).toContain('id="account-confirm-pass"');
    expect(mainTs).toContain(
      "const confirm = ($('#account-confirm-pass') as HTMLInputElement).value;",
    );
    expect(mainTs).toContain('validatePasswordChange(current, next, confirm)');
  });

  it('routes logged-in play navigation to the realm and character flow', () => {
    expect(mainTs).toContain('const goToLoggedInPlay = () => {');
    expect(mainTs).toContain('void enterRealmFlow().catch((err) => {');
    expect(mainTs).toContain('api.clearSession();');
    expect(mainTs).toContain('const enterOnlinePlayFlow = () => {');
    expect(mainTs).toContain('if (api.token) {');
    expect(mainTs).toContain('goToLoggedInPlay();');
    expect(mainTs).toContain("setupNavBtn(navBtnPlay, '#hero-view', enterOnlinePlayFlow);");
    expect(mainTs).toContain('const handleOnlineSelect = () => {');
    expect(mainTs).toContain("show('#login-panel');");
  });

  it('ships crawlable SEO metadata and sitemap hints', () => {
    expect(html).toContain(
      '<meta name="robots" content="index, follow, max-image-preview:large" />',
    );
    expect(html).toContain('<link rel="canonical" href="https://worldofclaudecraft.com/" />');
    expect(html).toContain('<meta property="og:site_name" content="World of ClaudeCraft" />');
    expect(html).toContain('"alternateName": "World of Claudecraft"');
    expect(html).toContain('"https://github.com/levy-street/world-of-claudecraft"');
    expect(mainTs).toContain("alternateName: 'World of Claudecraft'");
    expect(mainTs).toContain("'https://github.com/levy-street/world-of-claudecraft'");
    expect(robotsTxt.trim()).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://worldofclaudecraft.com/sitemap.xml\nSitemap: https://worldofclaudecraft.com/sitemap-characters.xml',
    );
    expect(robotsTxt).toContain('Sitemap: https://worldofclaudecraft.com/sitemap.xml');
    // The dynamic per-character sitemap (served by the game server) is advertised too.
    expect(robotsTxt).toContain('Sitemap: https://worldofclaudecraft.com/sitemap-characters.xml');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/</loc>');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/links</loc>');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/play</loc>');
    expect(playHtml).toContain(
      '<link rel="canonical" href="https://worldofclaudecraft.com/play" />',
    );
    expect(playHtml).toContain(
      '<meta property="og:url" content="https://worldofclaudecraft.com/play" />',
    );
    expect(playHtml).toContain('"url": "https://worldofclaudecraft.com/play"');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/privacy</loc>');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/terms</loc>');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/data-deletion</loc>');
    expect(sitemapXml).toContain('<loc>https://worldofclaudecraft.com/support</loc>');
    expect(privacyHtml).toContain(
      '<link rel="canonical" href="https://worldofclaudecraft.com/privacy" />',
    );
    expect(privacyHtml).toContain('<h1>Privacy Policy</h1>');
    expect(privacyHtml).toContain('href="/support">Support</a>');
    expect(privacyHtml).toContain('href="/data-deletion">Data Deletion</a>');
    expect(termsHtml).toContain(
      '<link rel="canonical" href="https://worldofclaudecraft.com/terms" />',
    );
    expect(termsHtml).toContain('<h1>Terms and Conditions</h1>');
    expect(termsHtml).toContain('href="/support">Support</a>');
    expect(termsHtml).toContain('href="/data-deletion">Data Deletion</a>');
    expect(dataDeletionHtml).toContain(
      '<link rel="canonical" href="https://worldofclaudecraft.com/data-deletion" />',
    );
    expect(dataDeletionHtml).toContain('<h1>Data Deletion</h1>');
    expect(dataDeletionHtml).toContain('href="mailto:woc@levystreet.com"');
    expect(dataDeletionHtml).toContain('href="https://discord.gg/GjhnUsBtw"');
    expect(dataDeletionHtml).toContain('href="/support">Support</a>');
    expect(supportHtml).toContain(
      '<link rel="canonical" href="https://worldofclaudecraft.com/support" />',
    );
    expect(supportHtml).toContain('<h1>Support</h1>');
    expect(supportHtml).toContain('href="mailto:woc@levystreet.com"');
    expect(supportHtml).toContain('href="https://discord.gg/GjhnUsBtw"');
    expect(supportHtml).toContain('href="/data-deletion">Data Deletion page</a>');
    expect(supportHtml).toContain('"@type": "ContactPage"');
    expect(html).toContain(
      'href="/World-of-ClaudeCraft-Whitepaper-v1.0.pdf" class="footer-link" data-i18n="footer.whitepaper"',
    );
    expect(html.indexOf('data-i18n="footer.whitepaper"')).toBeLessThan(
      html.indexOf('data-i18n="footer.terms"'),
    );
    expect(existsSync(whitepaperUrl)).toBe(true);
    expect(statSync(whitepaperUrl).size).toBeGreaterThan(0);
    expect(html).toContain('href="/terms" class="footer-link" data-i18n="footer.terms"');
    expect(html).toContain('href="/privacy" class="footer-link" data-i18n="footer.privacy"');
    expect(viteConfig).toContain("['/privacy', '/privacy.html']");
    expect(viteConfig).toContain("['/terms', '/terms.html']");
    expect(viteConfig).toContain("['/data-deletion', '/data-deletion.html']");
    expect(viteConfig).toContain("['/support', '/support.html']");
    expect(serverMain).toContain("['/privacy', '/privacy.html']");
    expect(serverMain).toContain("['/terms', '/terms.html']");
    expect(serverMain).toContain("['/data-deletion', '/data-deletion.html']");
    expect(serverMain).toContain("['/support', '/support.html']");
  });

  it('loads Meta Pixel outside local development and tracks level 5', () => {
    expect(html).toContain('https://connect.facebook.net/en_US/fbevents.js');
    expect(html).toContain("fbq('init', '1692101265042180');");
    expect(html).toContain("fbq('track', 'PageView');");
    expect(html).toContain(
      'https://www.facebook.com/tr?id=1692101265042180&ev=PageView&noscript=1',
    );
    expect(html).toContain(
      "if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {",
    );
    expect(hudTs).toContain("fbq('trackCustom', eventName, data ?? {});");
    expect(hudTs).toContain(
      "if (ev.level === 5) trackMetaPixel('ReachedLevel5', { level: ev.level });",
    );
    expect(mainTs).toContain("trackMetaPixel('AccountCreated');");
    expect(mainTs).toContain("'GitHubClick'");
    expect(mainTs).toContain("'DiscordClick'");
  });

  it('excludes wallet verification surfaces from native and desktop app builds', () => {
    expect(hudCss).toContain('body.native-app #nav-btn-download,');
    expect(hudCss).toContain(
      'body.native-app .cs-wallet,\n  body.native-app .cs-wallet-hidden-note,\n  body.native-app .account-wallet-card',
    );
    expect(hudCss).toContain('body.native-app #performance-tip,');
    expect(hudCss).toContain(
      'body.desktop-app #token-ca,\n  body.desktop-app .cs-wallet,\n  body.desktop-app .cs-wallet-hidden-note,\n  body.desktop-app .account-wallet-card,\n  body.desktop-app .official-site-copy',
    );
    expect(html).toContain('<section class="account-card account-wallet-card">');
    expect(mainTs).toContain("document.body.classList.toggle('desktop-app', DESKTOP_APP);");
    expect(mainTs).toContain(
      "!NATIVE_APP && !DESKTOP_APP && String(import.meta.env.VITE_WALLET_DISABLED ?? '').trim() !== '1';",
    );
    expect(mainTs).toContain("document.querySelector('.cs-wallet')?.remove();");
    expect(mainTs).toContain("document.querySelector('.account-wallet-card')?.remove();");
  });

  it('skips the web mobile preflight in native builds and shows an in-game rotate prompt', () => {
    expect(mainTs).toContain('if (NATIVE_APP) return Promise.resolve();');
    expect(hudMobileCss).toContain(
      'body.mobile-touch.game-active #mobile-preflight {\n    display: none !important;',
    );
    expect(indexExtraCss).toContain(
      'body.mobile-touch.game-active:not(.native-app) #rotate-device',
    );
    expect(indexExtraCss).toContain(
      '@media (orientation: portrait) {\n    body.native-app.mobile-touch.game-active #rotate-device {\n      display: flex;',
    );
  });

  it('releases the start-screen character preview before entering the world', () => {
    expect(mainTs).toContain('function releaseStartScreenPreview(): void {');
    expect(mainTs).toContain('characterPreview.destroy();\n  characterPreview = null;');
    expect(mainTs).toContain(
      "$('#start-screen').style.display = 'none';\n  releaseStartScreenPreview();",
    );
    expect(characterPreviewTs).toContain('destroy(): void {\n    if (this.destroyed) return;');
    expect(characterPreviewTs).toContain(
      'this.unregisterContext?.();\n    this.unregisterContext = null;',
    );
    expect(characterPreviewTs).toContain('this.renderer.forceContextLoss();');
    expect(characterPreviewTs).toContain('this.renderer.dispose();');
  });

  it('offers the quest log in the mobile controls drawer', () => {
    expect(html).toContain('id="mobile-extra-controls"');
    expect(html).toContain('id="mobile-quest"');
    expect(html).toContain('aria-label="Quest Log"');
  });

  it('offers a Discord entry in the mobile drawer, hidden until Discord is available', () => {
    // Mobile has no keyboard, so the U-key Discord panel toggle is unreachable;
    // this drawer button is the touch path into #discord-window (link / unlink).
    expect(html).toContain('id="mobile-discord"');
    // Carries the icon hook (hydrateIcons swaps [data-icon] for the inline SVG).
    expect(html).toMatch(/id="mobile-discord"[^>]*data-icon="discord"/);
    // Starts hidden; main.ts reveals it only when Discord is enabled and logged in.
    expect(html).toMatch(/id="mobile-discord"\s+hidden/);
  });

  it('keeps the game menu free of duplicate and dev-only entries', () => {
    const interfaceEntries = optionsViewTs.match(/labelKey: 'hud\.options\.interface'/g) ?? [];
    expect(interfaceEntries).toHaveLength(1);
    expect(optionsViewTs).not.toContain('Skin Select (dev)');
    expect(hudTs).not.toContain('Skin Select (dev)');
  });

  it('wires player card pose clicks before loading card metadata', () => {
    const methodStart = hudTs.indexOf('private async openPlayerCard');
    const listener = hudTs.indexOf('poseButtons.forEach((b, i) =>', methodStart);
    const metadataAwait = hudTs.indexOf(
      '[referral, standing] = await Promise.all([fetchReferralInfo(), fetchStanding()]);',
      methodStart,
    );
    const actionWiring = hudTs.indexOf(
      'this.wireCardActions(back, state, setStatus);',
      methodStart,
    );

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(listener).toBeGreaterThan(methodStart);
    expect(metadataAwait).toBeGreaterThan(listener);
    expect(actionWiring).toBeGreaterThan(metadataAwait);

    const listenerBlock = hudTs.slice(listener, metadataAwait);
    expect(listenerBlock).toContain('if (!metadataReady) {');
    expect(listenerBlock).toContain('selectPose(i);');
    expect(listenerBlock).toContain('return;');
    expect(hudTs.slice(metadataAwait, actionWiring)).toContain(
      'await compose(requestedPoseIndex);',
    );
  });

  it('only displays mobile touch controls after the game is active', () => {
    expect(hudMobileCss).toContain('body.mobile-touch.game-active #mobile-controls');
    expect(hudMobileCss).not.toContain(
      'body.mobile-touch #mobile-controls { position: absolute; inset: 0; display: block;',
    );
  });

  it('does not expose inert scrollbars on fixed mobile game overlays', () => {
    expect(baseCss).toContain(
      '#ui {\n    position: fixed;\n    left: 0;\n    top: 0;\n    width: var(--app-vw);\n    max-width: 100vw;\n    height: var(--app-vh);\n    overflow: hidden;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.game-active #ui,\n  body.mobile-touch.game-active #nameplates,\n  body.mobile-touch.game-active #mobile-controls {\n    overflow: hidden;\n    scrollbar-width: none;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.game-active #ui::-webkit-scrollbar,\n  body.mobile-touch.game-active #nameplates::-webkit-scrollbar,\n  body.mobile-touch.game-active #mobile-controls::-webkit-scrollbar',
    );
    expect(hudMobileCss).toContain('height: 0;\n    display: none;');
    expect(hudMobileCss).toContain(
      'body.mobile-touch.game-active::-webkit-scrollbar {\n    height: 0;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.game-active *::-webkit-scrollbar {\n    height: 0;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.game-active *::-webkit-scrollbar:horizontal {\n    height: 0;\n    display: none;',
    );
  });

  it('suppresses mobile in-game text selection and touch callouts without blocking inputs', () => {
    expect(hudMobileCss).toContain(
      'body.mobile-touch.game-active #mobile-controls *,\n  body.mobile-touch.game-active #bottom-bar,',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.game-active .mobile-btn {\n    user-select: none;\n    -webkit-user-select: none;\n    -webkit-touch-callout: none;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.game-active input,\n  body.mobile-touch.game-active textarea,\n  body.mobile-touch.game-active select,',
    );
    expect(hudMobileCss).toContain(
      '-webkit-user-select: text;\n    -webkit-touch-callout: default;',
    );
  });

  it('collapses in-game mobile community links behind one Community control', () => {
    expect(html).toContain('<a class="donate-cta"');
    expect(html).toContain('<details id="community-menu">');
    expect(html).toContain('<summary class="community-toggle"');
    expect(html).toContain('<div class="community-tray">');
    expect(html).toContain('<a class="community-link discord"');
    expect(html).toContain('<a class="community-link github"');
    expect(html).toContain('<a class="community-link donate"');
    expect(hudMobileCss).toContain('body.mobile-touch.game-active #ui {\n    z-index: 80;\n  }');
    expect(hudMobileCss).toContain(
      'body.mobile-touch #community-hud {\n    right: max(8px, env(safe-area-inset-right));\n    top: calc(max(8px, env(safe-area-inset-top)) + 158px);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch .community-toggle {\n    width: 44px;\n    height: 44px;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch .community-toggle svg {\n    width: 20px;\n    height: 20px;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #community-hud {\n      top: calc(max(6px, env(safe-area-inset-top)) + 132px);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch .community-toggle {\n      width: 40px;\n      height: 40px;\n    }',
    );
    expect(hudMobileCss).toContain('body.mobile-touch .community-tray {\n    position: absolute;');
    expect(hudMobileCss).toContain('z-index: 90;');
    expect(hudMobileCss).toContain(
      'body.mobile-touch #community-menu[open] .community-tray {\n    display: flex;\n  }',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch .community-link.donate {\n    display: inline-flex;',
    );
    expect(hudMobileCss).not.toContain(
      'body.mobile-touch .community-link.donate {\n    display: none;',
    );
    expect(hudMobileCss).not.toContain('body.mobile-touch .donate-cta {\n    display: none;');
  });

  it('closes mobile community and More trays when tapping outside', () => {
    expect(hudTs).toContain(
      "const communityMenu = document.getElementById('community-menu') as HTMLDetailsElement | null;",
    );
    expect(hudTs).toMatch(
      /if \(\s*document\.body\.classList\.contains\('mobile-touch'\) &&\s*communityMenu\?\.open &&\s*!communityMenu\.contains\(target\)\s*\) \{\s*communityMenu\.open = false;\s*\}/,
    );
    expect(hudTs).not.toContain(
      'if (communityMenu?.open && !communityMenu.contains(target)) {\n        communityMenu.open = false;\n      }',
    );
    expect(hudTs).toContain("if (document.body.classList.contains('mobile-more-open')) {");
    expect(hudTs).toContain("document.body.classList.remove('mobile-more-open');");
    expect(hudTs).toContain(
      "document.getElementById('mobile-controls')?.classList.remove('expanded');",
    );
    expect(hudTs).toContain("more?.classList.remove('active');");
    expect(hudTs).toContain(
      "document.getElementById('mobile-more-close')?.addEventListener('click', () => {",
    );
  });

  it('keeps desktop community links open after HUD clicks', () => {
    expect(mainTs).toContain('communityMenu.open = !(NATIVE_APP || useTouchInterface());');
    expect(hudTs).toMatch(
      /document\.body\.classList\.contains\('mobile-touch'\) &&\s*communityMenu\?\.open/,
    );
  });

  it('renders the mobile XP bar as a ring around the top-left class circle', () => {
    expect(hudMobileCss).toContain('body.mobile-touch #xpbar {\n    display: none;\n  }');
    expect(hudMobileCss).toContain(
      'body.mobile-touch #player-frame {\n    --xp-ring-start: 210deg;\n    --xp-ring-arc: 360deg;',
    );
    expect(hudMobileCss).toContain('body.mobile-touch #player-frame::before {\n    content: "";');
    expect(hudMobileCss).toContain('width: 73px;\n    height: 73px;');
    expect(hudMobileCss).toContain('z-index: 2;');
    expect(hudMobileCss).toContain('conic-gradient(\n      from var(--xp-ring-start),');
    expect(hudMobileCss).toContain('calc(var(--xp-fill, 0) * 360deg)');
    expect(hudMobileCss).toContain('transparent var(--xp-ring-arc) 360deg');
    expect(hudMobileCss).toContain(
      'body.mobile-touch #player-frame {\n    position: fixed;\n    left: max(8px, env(safe-area-inset-left));\n    top: max(8px, env(safe-area-inset-top));\n    z-index: 21;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #player-frame .portrait-wrap {\n    z-index: 3;\n  }',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #player-frame .uf-bars {\n    position: relative;\n    z-index: 1;',
    );
    expect(hudMobileCss).toContain(
      '-webkit-mask: radial-gradient(\n      farthest-side,\n      transparent calc(100% - 7px),\n      #000 calc(100% - 6px)\n    );',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #xpbar .fill,\n  body.mobile-touch #xpbar .ticks {\n    display: none;\n  }',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #player-frame::before {\n      left: -5px;\n      top: -5px;\n      width: 73px;\n      height: 73px;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #target-frame {\n    left: max(8px, env(safe-area-inset-left));\n    top: calc(max(8px, env(safe-area-inset-top)) + 72px);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames {\n    position: fixed;\n    left: max(8px, env(safe-area-inset-left));\n    top: calc(max(8px, env(safe-area-inset-top)) + 74px);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames.below-target {\n    top: calc(max(8px, env(safe-area-inset-top)) + 130px);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames .party-frame {\n    width: 132px;\n    min-height: 40px;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames .party-frame:not(:first-child) {\n    margin-top: -1px;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames #party-leave {\n    width: 132px;\n    min-height: 40px;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames .party-frame {\n      width: 118px;\n      min-height: 40px;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #target-frame {\n      left: max(6px, env(safe-area-inset-left));\n      top: calc(max(6px, env(safe-area-inset-top)) + 56px);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames.below-target {\n      top: calc(max(6px, env(safe-area-inset-top)) + 100px);',
    );
    expect(hudMobileCss).not.toContain('body.mobile-touch.mobile-left-handed #xpbar,');
    // The XP fill fraction is mirrored into --xp-fill on BOTH the #xpbar and the
    // #player-frame (the mobile ring around the class circle reads it). The painter
    // owns those writes now: it caches the #player-frame ref and drives --xp-fill on
    // the bar and the player frame through the elided setStyleProp.
    expect(hudTs).toContain("private playerFrameEl = $('#player-frame');");
    expect(hudTs).toContain('this.playerFrameEl,');
    expect(xpBarPainterTs).toContain("const XP_FILL_PROP = '--xp-fill';");
    expect(xpBarPainterTs).toContain(
      'this.writers.setStyleProp(this.bar, XP_FILL_PROP, fillFrac4);',
    );
    expect(xpBarPainterTs).toContain(
      'this.writers.setStyleProp(this.playerFrame, XP_FILL_PROP, fillFrac4);',
    );
  });

  it('keeps the dissolved per-frame node families in their keyed-pool painters', () => {
    // Moved-id sweep: three families of nodes that used to be built inline in
    // hud.ts (per-rebuild innerHTML / per-event createElement) no longer have a static
    // id to grep, so these assert the NEW pooled shape against the painter that owns it.
    // If a future change moves the pool back inline or drops the keyed builder, this
    // fails instead of silently losing the guard.

    // Party rows: the per-member row + the #party-leave button are built once by
    // the pooled row builder, not re-created on every party rebuild in hud.ts.
    expect(partyFrameRowTs).toContain("row.className = 'party-frame panel';");
    expect(partyFrameRowTs).toContain("btn.id = 'party-leave';");

    // Aura slots: one node per aura id, held in a keyed pool and built once in
    // createNode() as .buff > .dur + .stacks. The hud.ts-wiring assertion (mirroring the
    // party-frame pattern) pins that hud.ts DELEGATES to the painter, so re-inlining the
    // pool into hud.ts fails here, not just deleting the builder from the painter file.
    expect(hudTs).toContain('new AurasPainter(');
    expect(aurasPainterTs).toContain('private readonly pool = new Map<string, PooledAura>();');
    expect(aurasPainterTs).toContain("const DUR_CLASS = 'dur';");
    expect(aurasPainterTs).toContain("const STACKS_CLASS = 'stacks';");
    expect(aurasPainterTs).toContain('this.createNode()');

    // FCT nodes: a fixed-size pre-allocated div ring capped at FCT_POOL_CAP, each
    // node aria-hidden, never createElement'd per combat event. hud.ts delegates to the
    // painter (the wiring assertion), so a re-inline fails here too.
    expect(hudTs).toContain('new FctPainter(');
    expect(fctPainterTs).toContain('export const FCT_POOL_CAP = 64;');
    expect(fctPainterTs).toContain("const FCT_BASE_CLASS = 'fct';");
    expect(fctPainterTs).toContain('node.className = FCT_BASE_CLASS;');
    expect(fctPainterTs).toContain("node.setAttribute('aria-hidden', 'true');");
  });

  it('keeps the mobile homepage scrollable with a sticky header', () => {
    expect(baseCss).toContain('touch-action: pan-y;\n    overscroll-behavior-y: auto;');
    expect(baseCss).toContain('body.game-active {\n    overflow: hidden;\n    touch-action: none;');
    expect(hudMobileCss).toContain('-webkit-overflow-scrolling: touch;');
    expect(shellCss).toContain(
      'body.mobile-touch .homepage-header {\n    display: flex;\n    position: sticky;\n    top: 0;\n    z-index: 120;',
    );
    expect(shellCss).toContain('padding-top: calc(var(--spacing-sm) + env(safe-area-inset-top));');
    expect(shellCss).toContain(
      'padding-right: max(var(--spacing-md), env(safe-area-inset-right));',
    );
    expect(shellCss).toContain(
      'body.mobile-touch #homepage-views-container {\n    padding-top: var(--spacing-lg);\n    padding-right: max(var(--spacing-md), env(safe-area-inset-right));',
    );
    expect(shellCss).toContain(
      'body.mobile-touch .header-actions {\n    width: 100%;\n    display: flex;\n    flex-direction: column;\n    align-items: center;',
    );
    expect(shellCss).toContain(
      'body.mobile-touch .footer-lang-row {\n    width: 100%;\n    flex-direction: column;\n    align-items: center;',
    );
    // This backdrop pair is authored -webkit-first (Lightning drops the std otherwise).
    expect(shellCss).toContain(
      'body.native-app.mobile-touch .auth-panel-premium {\n    -webkit-backdrop-filter: none;\n    backdrop-filter: none;',
    );
    expect(shellCss).toContain(
      'body.native-app.mobile-touch[data-start-panel="login-panel"] .portal-ring,',
    );
    expect(shellCss).toContain(
      'body.native-app.mobile-touch[data-start-panel="login-panel"] #login-panel {\n    display: grid;\n    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);',
    );
    expect(shellCss).toContain(
      '@media (orientation: landscape) {\n    body.mobile-touch[data-start-panel="charselect-panel"] #homepage-views-container,',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch[data-start-panel="charselect-panel"] #hero-view,\n    body.mobile-touch[data-start-panel="charcreate-panel"] #hero-view {\n      justify-content: flex-start;\n      min-height: calc(var(--app-vh) - 86px);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch[data-start-panel="mode-select"] #title-logo {\n      width: min(176px, 24vw);\n      margin: 0;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch[data-start-panel="charselect-panel"] #title-logo,\n    body.mobile-touch[data-start-panel="charcreate-panel"] #title-logo {\n      display: none;',
    );
    expect(shellCss).toContain('height: min(560px, calc(var(--app-vh) - 96px));');
    expect(shellCss).toContain(
      'body.mobile-touch #charselect-panel .cs-detail-col {\n      display: grid;\n      grid-template-columns: minmax(120px, 0.54fr) minmax(0, 1.46fr);',
    );
    expect(shellCss).toContain(
      'body.mobile-touch #charselect-panel #char-list {\n      overflow-y: auto;\n      scrollbar-gutter: stable;\n      scrollbar-width: auto;',
    );
    expect(shellCss).toContain(
      'body.mobile-touch #charselect-panel #char-list::-webkit-scrollbar {\n      width: 8px;',
    );
    expect(shellCss).toContain(
      'body.mobile-touch #charselect-panel #charselect-class-details {\n      box-sizing: border-box;\n      min-height: 0;\n      overflow-y: auto;',
    );
    expect(shellCss).toContain('scrollbar-gutter: stable;\n      scrollbar-width: auto;');
    expect(shellCss).toContain(
      'body.mobile-touch #charselect-panel #charselect-class-details .class-details-grid {\n      display: flex;\n      flex-direction: column;',
    );
    expect(shellCss).toContain(
      'body.mobile-touch #charselect-panel #charselect-class-details .details-spells-list {\n      display: grid;\n      grid-template-columns: minmax(0, 1fr);',
    );
    expect(shellCss).toContain(
      'body.mobile-touch #charselect-panel .cs-list-col,\n    body.mobile-touch #charselect-panel .cs-detail-col,\n    body.mobile-touch #charcreate-panel .cs-create-col,\n    body.mobile-touch #charcreate-panel .cs-detail-col {\n      min-height: 0;\n      height: 100%;\n      overflow: hidden;',
    );
    expect(shellCss).toContain(
      'body.mobile-touch #charselect-panel .cs-list-actions {\n      position: absolute;\n      top: 28px;\n      right: 0;',
    );
    expect(shellCss).toContain(
      'body.mobile-touch #charselect-panel .cs-list-actions .btn {\n      flex: 0 0 auto;\n      min-width: 122px;\n      min-height: 38px;',
    );
    expect(shellCss).toContain(
      'touch-action: manipulation;\n    -webkit-tap-highlight-color: transparent;',
    );
    expect(mainTs).toContain(
      'target?.closest(\'button, a, input, textarea, select, [role="button"], [role="option"], [tabindex]\')',
    );
    expect(mainTs).toContain(
      "document.addEventListener('pointerup', handleNativeMenuToggle, true);",
    );
    expect(mainTs).toContain(
      "document.addEventListener('touchend', handleNativeMenuToggle, { capture: true, passive: false });",
    );
    expect(mainTs).toContain("if (headerMenu) headerMenu.style.display = open ? 'flex' : '';");
    expect(shellCss).not.toContain(
      'body.mobile-touch .homepage-header {\n    display: flex;\n    position: relative;',
    );
    expect(mainTs).not.toContain("visualViewport?.addEventListener('scroll', syncAppViewport)");
  });

  it('lets HUD windows scroll by touch on iOS (Bag / Market)', () => {
    // The HUD overlay must permit one-finger panning so scroll containers
    // inside it can scroll on iOS, `touch-action: none` here would block them
    // (Safari intersects touch-action down the ancestor chain, so a child's
    // own pan-y cannot re-enable it). pan-x pan-y still blocks pinch-zoom.
    expect(hudMobileCss).toContain('body.mobile-touch #ui {\n    touch-action: pan-x pan-y;\n  }');
    expect(hudMobileCss).not.toContain('body.mobile-touch #ui { touch-action: none; }');
    // Scrollable lists get iOS momentum + scroll isolation (moved to components.css).
    expect(componentsCss).toContain(
      '#bags .bag-grid {\n    flex: 1 1 auto;\n    min-height: 0;\n    overflow-y: auto;\n    touch-action: pan-y;\n    -webkit-overflow-scrolling: touch;\n    overscroll-behavior: contain;\n  }',
    );
    expect(componentsCss).toContain(
      '#market-body {\n    overflow-y: auto;\n    flex: 1;\n    min-height: 0;\n    padding-right: 2px;\n    touch-action: pan-y;\n    -webkit-overflow-scrolling: touch;\n    overscroll-behavior: contain;\n  }',
    );
    // The world canvas still suppresses panning so camera drag is unaffected.
    expect(hudMobileCss).toContain(
      'body.mobile-touch #game-canvas {\n    touch-action: none;\n  }',
    );
  });

  it('places news release metadata below the heading on mobile', () => {
    expect(mainTs).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the source literally contains this template expression
      '<h3 class="news-item-title">${title}</h3><div class="news-item-meta">${tag}${badge}${when}</div></div>',
    );
    expect(shellCss).toContain(
      'body.mobile-touch .news-item-head {\n    flex-direction: column;\n    align-items: flex-start;',
    );
    expect(shellCss).toContain(
      'body.mobile-touch .news-item-meta {\n    width: 100%;\n    margin-left: 0;',
    );
    expect(shellCss).toContain('overflow-wrap: break-word;\n    word-break: normal;');
    expect(shellCss).toContain('body.mobile-touch .news-body {\n    text-align: left;');
    expect(shellCss).toContain(
      'body.mobile-touch .news-body ul {\n    list-style: none;\n    padding-left: 0;',
    );
  });

  it('renders the high scores leaderboard responsively on mobile', () => {
    expect(mainTs).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the source literally contains this template expression
      '<span class="hs-realm" data-label="${esc(realmLabel)}">${esc(r.realm ?? \'\')}</span>',
    );
    expect(mainTs).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the source literally contains this template expression
      '<span class="hs-xp" data-label="${esc(lifetimeXpLabel)}">${formatXp(r.lifetimeXp)}</span>',
    );
    expect(shellCss).toContain('body.mobile-touch .hs-head {\n    display: none;');
    expect(shellCss).toContain(
      'body.mobile-touch .hs-row {\n    grid-template-columns: 38px minmax(0, 1fr);',
    );
    expect(shellCss).toContain(
      'grid-template-areas:\n      "rank name"\n      "rank realm"\n      "rank lvl"\n      "rank vlvl"\n      "rank xp";',
    );
    expect(shellCss).toContain(
      'body.mobile-touch .hs-realm::before,\n  body.mobile-touch .hs-lvl::before,\n  body.mobile-touch .hs-vlvl::before,\n  body.mobile-touch .hs-xp::before {\n    content: attr(data-label);',
    );
  });

  it('stacks selected character details on mobile', () => {
    expect(html).toContain('id="charselect-class-details"');
    expect(shellCss).toContain(
      'body.mobile-touch #charselect-panel #charselect-class-details .class-details-grid,\n  body.mobile-touch #charselect-panel #online-class-details .class-details-grid {\n    display: flex;\n    flex-direction: column;',
    );
  });

  it('lays out mobile More tray buttons horizontally', () => {
    expect(html).toContain(
      '<div id="mobile-extra-controls" class="window panel" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title">',
    );
    expect(html).toContain('<div class="panel-title">');
    expect(html).toContain('id="mobile-more-close"');
    expect(html).toContain('<div id="mobile-extra-grid">');
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-more-open #mobile-controls {\n    z-index: 140;\n  }',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #mobile-extra-controls {\n    position: fixed;\n    left: 50%;\n    top: max(14px, env(safe-area-inset-top));\n    bottom: auto;\n    transform: translateX(-50%);',
    );
    expect(hudMobileCss).toContain('z-index: 100;');
    expect(hudMobileCss).toContain('border-radius: 10px;');
    expect(hudMobileCss).toContain(
      'max-width: calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right));',
    );
    expect(hudMobileCss).toContain(
      'max-height: calc(var(--app-vh) - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom));',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-more-open #mobile-extra-controls {\n    display: flex;\n    flex-direction: column;\n  }',
    );
    // Anchored to the drawer-header rule itself (not just the declarations,
    // which any rule could carry): the 48px floor must stay on THIS selector.
    const drawerTitleStart = hudMobileCss.indexOf(
      'body.mobile-touch #mobile-extra-controls .panel-title {',
    );
    expect(drawerTitleStart).toBeGreaterThan(-1);
    const drawerTitleBody = hudMobileCss.slice(
      drawerTitleStart,
      hudMobileCss.indexOf('}', drawerTitleStart),
    );
    expect(drawerTitleBody).toContain('min-height: 48px;');
    expect(drawerTitleBody).toContain('margin-bottom: 8px;');
    expect(drawerTitleBody).toContain('padding-bottom: 6px;');
    expect(drawerTitleBody).toContain('cursor: move;');
    expect(hudMobileCss).toContain(
      'width: min(560px, calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right)));',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #mobile-extra-grid {\n    display: grid;\n    grid-template-columns: repeat(3, minmax(0, 1fr));',
    );
    expect(hudMobileCss).toContain('body.mobile-touch #mobile-extra-controls .mobile-btn');
    expect(hudMobileCss).toContain(
      'body.mobile-touch #mobile-extra-controls .mobile-btn {\n    width: 100%;',
    );
    expect(hudMobileCss).toContain('flex-direction: row;');
    expect(hudMobileCss).toContain('body.mobile-touch #mobile-extra-controls .mobile-btn .ui-icon');
    expect(mobileControlsTs).toContain(
      "const open = !document.body.classList.contains('mobile-more-open');",
    );
    expect(mobileControlsTs).toContain("this.root?.classList.toggle('expanded', open);");
    expect(mobileControlsTs).toContain("document.body.classList.toggle('mobile-more-open', open);");
    expect(mobileControlsTs).toContain("modal.style.left = '50%';");
    expect(mobileControlsTs).toContain("modal.style.top = 'max(14px, env(safe-area-inset-top))';");
    expect(mobileControlsTs).toContain("modal.style.transform = 'translateX(-50%)';");
    expect(mobileControlsTs).toContain('delete modal.dataset.windowMoved;');
    expect(mobileControlsTs).toContain('private closeMoreModal(): void {');
    expect(mobileControlsTs).toContain(
      "document.getElementById('mobile-controls')?.classList.remove('expanded');",
    );
    const bindButton = mobileControlsTs.slice(
      mobileControlsTs.indexOf('private bindButton'),
      mobileControlsTs.indexOf('private closeMoreModal'),
    );
    expect(bindButton.indexOf("button.closest('#mobile-extra-controls')")).toBeGreaterThan(-1);
    expect(bindButton.indexOf('this.closeMoreModal();')).toBeLessThan(bindButton.indexOf('cb();'));
    expect(hudTs).toContain(".filter((win) => win.id !== 'mobile-extra-controls')");
  });

  it('replaces the dual mode cards with one Play CTA and a realm selector', () => {
    expect(html).toContain('id="btn-play"');
    expect(html).toContain('id="server-select"');
    expect(html).toContain('id="server-select-menu"');
    expect(html).toContain('role="listbox"');
    // Legacy online/offline triggers persist as hidden automation hooks.
    expect(html).toContain('id="btn-online"');
    expect(html).toContain('id="btn-offline"');
    expect(html).not.toContain('class="mode-card');
    expect(hudMobileCss).not.toContain('.mode-row {');
    expect(hudMobileCss).toContain(
      'body.mobile-touch #mode-select {\n    width: 100%;\n    max-width: min(\n      440px,\n      calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right))\n    );\n    margin-inline: auto;',
    );
    // Landscape compacts the single play console instead of splitting two cards.
    expect(hudMobileCss).toContain(
      '@media (orientation: landscape) {\n    body.mobile-touch[data-start-panel="mode-select"] #homepage-views-container {',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch[data-start-panel="mode-select"] #mode-select {\n      width: min(\n        620px,',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch .play-console {\n      width: 100%;\n      max-width: none;\n      display: grid;\n      grid-template-columns: minmax(0, 1fr) minmax(140px, 0.46fr);',
    );
  });

  it('ships a looping cinematic backdrop with a poster fallback, lazy-loaded for perf', () => {
    expect(html).toContain('id="bg-home"');
    expect(html).toContain('poster="/home-bg.png"');
    // The 5.7MB mp4 is NOT eagerly fetched: no <source>/autoplay/preload in the
    // static markup. main.ts attaches data-trailer-src only on capable devices;
    // phones / Save-Data / reduced-motion / high-contrast keep the poster only.
    expect(html).toContain('data-trailer-src="/home-bg.mp4"');
    expect(html).toContain('preload="none"');
    expect(html).not.toContain('<source src="/home-bg.mp4"');
    expect(mainTs).toContain('applyLandingBackdrop');
    // View transitions still honour reduced-motion.
    expect(mainTs).toContain('prefers-reduced-motion: reduce');
  });

  it('holds the cinematic trailer hidden until it plays, so the poster never flashes first', () => {
    // The backdrop is one <video class="bg-trailer bg-home" poster=...>. The poster
    // must stay hidden until JS reveals the layer, otherwise it paints at full
    // opacity from first paint and the user sees the still key-art for the whole
    // time the 5.7MB mp4 is still downloading, then it abruptly swaps to video.
    // The trailer layer is held transparent by default:
    expect(shellCss).toMatch(/\.bg-trailer\s*\{[\s\S]*?\bopacity:\s*0;/);
    // ...and there is NO bare `.bg-home { opacity: 0.85 }` base rule overriding that
    // hold (the bug: a later equal-specificity rule revealed the poster early).
    expect(shellCss).not.toContain('.bg-home {\n    opacity: 0.85;');
    // The poster is revealed ONLY by JS: trailer-ready (the video is playing, or a
    // play/decode failure fallback)...
    expect(shellCss).toContain(
      '#start-screen-backdrop.trailer-ready .bg-trailer {\n    opacity: 0.85;',
    );
    // ...or backdrop-static (the static-poster path for phone / Save-Data /
    // reduced-motion / high-contrast), which still shows the poster, dimmed.
    expect(shellCss).toContain(
      '#start-screen-backdrop.backdrop-static .bg-home {\n    opacity: 0.4;',
    );
    // main.ts reveals the static poster as a fallback when the trailer cannot play,
    // so a failed/blocked video never leaves a black backdrop.
    expect(mainTs).toContain("video.addEventListener('error'");
    // The dead black-wipe overlay (never in the markup, never toggled by JS) is gone.
    expect(shellCss).not.toContain('bg-trailer-fade');
    expect(shellCss).not.toContain('trailer-fade-in');
    expect(shellCss).not.toContain('trailer-fade-out');
  });

  it('omits Meters from the mobile More tray while keeping the desktop window', () => {
    expect(html).toContain('id="meters-window"');
    expect(html).not.toContain('id="mobile-meters"');
  });

  it('keeps the World Market to one scroll container with browse filters below the tabs', () => {
    expect(componentsCss).toContain(
      '#market-window {\n    width: 560px;\n    height: min(640px, calc(85vh - 24px));\n    display: none;\n    flex-direction: column;\n    overflow: hidden;',
    );
    expect(componentsCss).toContain(
      '#market-body {\n    overflow-y: auto;\n    flex: 1;\n    min-height: 0;',
    );
    expect(componentsCss).toContain(
      '.mkt-page {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;',
    );
    // On mobile the Market takes the full available height (not the vendor's 58vh
    // cap) so its tall stacked-filter header cannot squeeze the listing body flat,
    // and #market-body keeps a min-height floor; the window itself stays
    // overflow:hidden so #market-body remains the single scroll container.
    expect(hudMobileCss).toContain(
      'body.mobile-touch #market-window {\n    max-height: calc(var(--app-vh) / var(--ui-scale, 1) - 20px);\n    overflow: hidden;',
    );
    expect(hudMobileCss).toContain('body.mobile-touch #market-body {\n    min-height: 96px;');
    expect(marketWindowTs).toContain('buildMarketView'); // pagination + filtering delegated to the core
    expect(marketWindowTs).toContain('this.browsePage');
    expect(marketWindowTs).toContain('data-market-page="prev"');
    expect(marketWindowTs).toContain('data-market-page="next"');
    expect(marketWindowTs).toContain('itemUi.market.pageRange');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the source literally contains this template expression
    expect(marketWindowTs).toContain("class=\"mkt-filters${hasSubtype ? ' has-subtype' : ''}\"");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the source literally contains this template expression
    expect(marketWindowTs).toContain('data-market-filter-menu="${menu}"');
    expect(marketWindowTs).toMatch(/this\.renderMarketFilterMenu\(\s*'itemType'/);
    expect(marketWindowTs).toMatch(/this\.renderMarketFilterMenu\(\s*'subtype'/);
    expect(marketWindowTs).toMatch(/this\.renderMarketFilterMenu\(\s*'rarity'/);
    expect(marketWindowTs).not.toContain('<select data-market-filter=');
  });

  it('keeps the mobile More and Autorun buttons in the combat row', () => {
    const combatControls = html.slice(
      html.indexOf('<div id="mobile-combat-controls">'),
      html.indexOf('<div id="mobile-extra-controls"'),
    );
    const primaryButtons = [...combatControls.matchAll(/<button class="mobile-btn"/g)];
    const attack = combatControls.indexOf('id="mobile-attack-nearest"');
    const autorun = combatControls.indexOf('id="mobile-autorun"');
    const jump = combatControls.indexOf('id="mobile-jump"');

    expect(primaryButtons).toHaveLength(7);
    expect(attack).toBeGreaterThanOrEqual(0);
    expect(autorun).toBeGreaterThan(attack);
    expect(jump).toBeGreaterThan(autorun);
    expect(hudMobileCss).toContain('grid-template-columns: 124px repeat(6, 58px);');
    expect(hudMobileCss).toContain('grid-template-columns: 115px repeat(6, 54px);');
    expect(hudMobileCss).toContain('grid-template-columns: 96px repeat(6, 42px);');
    expect(hudMobileCss).toContain(
      'position: absolute;\n    left: 50%;\n    bottom: calc(3px + env(safe-area-inset-bottom));',
    );
    expect(hudMobileCss).toContain(
      'bottom: calc(2px + env(safe-area-inset-bottom));\n      grid-template-columns: 115px repeat(6, 54px);',
    );
    expect(hudMobileCss).toContain(
      'pointer-events: auto;\n    align-items: end;\n    z-index: 30;',
    );
    expect(hudMobileCss).toContain('body.mobile-touch #mobile-more {\n    position: static;');
    expect(mainTs).toContain('onMenu: () => hud.toggleOptionsMenu(),');
  });

  it('keeps the mobile spell bar in a scrollable row between the joysticks', () => {
    expect(hudMobileCss).toContain('width: min(30vw, 132px);');
    expect(hudMobileCss).toContain('min-width: 112px;');
    expect(hudMobileCss).toContain('height: min(36vh, 172px);');
    expect(hudMobileCss).toContain('left: calc(max(18px, env(safe-area-inset-left)) + 154px);');
    expect(hudMobileCss).toContain('right: calc(max(18px, env(safe-area-inset-right)) + 154px);');
    expect(hudMobileCss).toContain('bottom: calc(64px + env(safe-area-inset-bottom));');
    expect(hudMobileCss).toContain('left: calc(max(20px, env(safe-area-inset-left)) + 136px);');
    expect(hudMobileCss).toContain('right: calc(max(20px, env(safe-area-inset-right)) + 136px);');
    expect(hudMobileCss).toContain('bottom: calc(57px + env(safe-area-inset-bottom));');
    expect(hudMobileCss).toContain(
      'body.mobile-touch #actionbar {\n    display: flex;\n    flex-wrap: nowrap;',
    );
    expect(hudMobileCss).toContain('overflow-x: auto;\n    overflow-y: hidden;');
    expect(hudMobileCss).toContain('touch-action: pan-x;');
    expect(hudMobileCss).toContain('min-height: 50px;');
    expect(hudMobileCss).toContain(
      'body.mobile-touch .action-btn {\n    width: 42px;\n    height: 42px;\n    flex: 0 0 42px;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-hotbar-dragging #actionbar {\n    touch-action: none;\n  }',
    );
    expect(hudMobileCss).toContain('body.mobile-touch .action-btn.mobile-drag-source');
  });

  it('seeds druid form bars with the form kit, and only clones normal for rogue stealth', () => {
    expect(hudTs).toContain('if (this.isFormKitBar()) {');
    expect(hudTs).toContain('if (this.seedFormBarIfNeeded(parsed)) return;');
    expect(hudTs).toMatch(
      /buildDefaultFormBar\(\s*this\.formKitAbilityIds\(this\.activeHotbarForm\),\s*Hud\.BAR_ABILITY_SLOTS,\s*\)/,
    );
    expect(hudTs).toMatch(
      /const emptyFormMap =\s*this\.activeHotbarForm !== 'normal' && parsed\.every\(\(action\) => action === null\);/,
    );
    expect(hudTs).toContain("localStorage.getItem(this.slotMapKey('normal'))");
    expect(hudTs).not.toContain(
      "this.loadedSlotMapFromStorage = stored || this.activeHotbarForm !== 'normal';",
    );
  });

  it('migrates a pre-existing form bar at most once via a per-form seeded marker', () => {
    expect(hudTs).toContain('_seeded');
    expect(hudTs).toContain('shouldSeedFormBar(parsed, normalActions, false)');
  });

  it('only auto-places abilities that belong on the active form bar', () => {
    expect(hudTs).toContain(
      'if (this.shouldAutoPlaceOnForm(id, this.activeHotbarForm)) autoPlaceAbilityIds.add(id);',
    );
  });

  it('keeps the active druid form toggle on its form action bar', () => {
    expect(hudTs).toContain("new Set(['bear_form', 'cat_form', 'travel_form'])");
    expect(hudTs).toContain("if (this.activeHotbarForm === 'bear') return 'bear_form';");
    expect(hudTs).toContain("if (this.activeHotbarForm === 'cat') return 'cat_form';");
    expect(hudTs).toContain(
      'if (formToggle && knownAbilityIds.includes(formToggle)) autoPlaceAbilityIds.add(formToggle);',
    );
  });

  it('offers a reset-to-default action bar button in the spellbook, only for classes with form bars', () => {
    // The reset button + its label live in the spellbook painter;
    // Hud still owns resetActiveFormBarToDefault + the form-bar predicate it wires.
    expect(spellbookWindowTs).toContain('data-reset-bar');
    expect(spellbookWindowTs).toContain("t('abilityUi.spellbook.resetBar')");
    expect(spellbookWindowTs).toContain('const resetBtnHtml = view.hasFormBars');
    expect(hudTs).toContain('resetFormBar: () => this.resetActiveFormBarToDefault()');
    expect(componentsCss).toContain('.spellbook-reset {');
    expect(hudMobileCss).toContain('body.mobile-touch #spellbook .spellbook-reset {');
    expect(hudTs).toContain('return classHasFormBars(this.sim.cfg.playerClass);');
  });

  it('shows mobile spellbook add and remove controls for the spell bar', () => {
    expect(componentsCss).toContain('.spell-hotbar-toggle {\n    display: none;\n  }');
    expect(hudMobileCss).toContain(
      'body.mobile-touch #spellbook .spell-hotbar-toggle {\n    min-width: 40px;\n    min-height: 40px;',
    );
    expect(hudMobileCss).toContain('body.mobile-touch #spellbook .spell-hotbar-toggle.remove');
    // The +/- toggle button + its add/remove wiring live in the spellbook painter.
    expect(spellbookWindowTs).toMatch(/toggle\.className = [`']spell-hotbar-toggle/);
    expect(spellbookWindowTs).toContain('this.deps.removeFromBar(id)');
    expect(spellbookWindowTs).toContain('this.deps.addToBar(id)');
  });

  it('sizes the mobile Bags window as a usable modal', () => {
    expect(hudMobileCss).toContain(
      'body.mobile-touch #bags {\n    position: fixed;\n    left: max(10px, env(safe-area-inset-left));\n    right: max(10px, env(safe-area-inset-right));\n    top: max(10px, env(safe-area-inset-top));\n    bottom: calc(72px + env(safe-area-inset-bottom));\n    width: auto;\n    transform: none;',
    );
    expect(hudMobileCss).toContain('body.mobile-touch #bags .bag-grid {\n    min-height: 150px;');
    expect(hudMobileCss).not.toContain(
      'body.mobile-touch #bags {\n    position: fixed;\n    left: 10px;\n    right: 10px;\n    bottom: 10px;',
    );
    expect(hudMobileCss).not.toContain('max-height: calc(38vh - 20px);');
  });

  it('combines Trader and Bags into a mobile split-pane modal', () => {
    expect(hudMobileCss).toContain(
      'body.mobile-touch.vendor-open #vendor-window,\n  body.mobile-touch.vendor-open #bags {\n    position: fixed;\n    top: max(10px, env(safe-area-inset-top));\n    bottom: calc(72px + env(safe-area-inset-bottom));',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.vendor-open #vendor-window {\n    left: max(10px, env(safe-area-inset-left));\n    right: 50vw;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.vendor-open #bags {\n    left: 50vw;\n    right: max(10px, env(safe-area-inset-right));',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.vendor-open #vendor-window .panel-title,\n  body.mobile-touch.vendor-open #bags .panel-title {\n    height: 47px;\n    min-height: 47px;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.vendor-open #vendor-window .panel-title .x-btn {\n    display: none;',
    );
    expect(hudTs).toContain(
      "if (this.vendorOpen && document.body.classList.contains('mobile-touch')) this.closeVendor();",
    );
    expect(hudTs).toMatch(
      /const closeMobileBags =\s*document\.body\.classList\.contains\('mobile-touch'\) &&\s*\$\('#bags'\)\.style\.display !== 'none';/,
    );
  });

  it('keeps the expanded mobile More tray inside the viewport', () => {
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-left-handed #mobile-extra-controls {\n    left: 50%;\n    right: auto;',
    );
    expect(hudMobileCss).toContain(
      'max-height: calc(\n        var(--app-vh) -\n        28px -\n        env(safe-area-inset-top) -\n        env(safe-area-inset-bottom)\n      );',
    );
  });

  it('caps mobile quest and NPC panels instead of stretching them edge to edge', () => {
    expect(hudMobileCss).toContain(
      'body.mobile-touch #quest-log-window,\n  body.mobile-touch #vendor-window,\n  body.mobile-touch #quest-dialog',
    );
    expect(hudMobileCss).toContain('width: clamp(320px, 76vw, 680px);');
    expect(hudMobileCss).toContain('max-width: calc(100vw - 20px);');
    expect(hudMobileCss).toContain('transform: translateX(-50%);');
  });

  it('centers mobile Talents above touch controls', () => {
    expect(hudMobileCss).toContain('body.mobile-touch.mobile-window-open #ui {\n    z-index: 90;');
    expect(hudMobileCss).toContain('body.mobile-touch #talents-window {\n    position: fixed;');
    expect(hudMobileCss).toContain('top: 50%;');
    expect(hudMobileCss).toContain('transform: translate(-50%, -50%);');
    expect(hudMobileCss).toContain('z-index: 95 !important;');
  });
});
