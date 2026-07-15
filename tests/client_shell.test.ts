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
// The mobile collapse chip is painter-created (built by party_chip.ts, driven by the
// party painter), so it is entry-agnostic: there is no static chip markup to keep in
// sync across index.html / play.html. These guards read the painter + chip builder +
// the mobile CSS instead of a static id.
const partyChipTs = readFileSync(
  new URL('../src/ui/party_chip.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const partyFramesPainterTs = readFileSync(
  new URL('../src/ui/party_frames_painter.ts', import.meta.url),
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

  it('keeps the mobile party-collapse chip painter-created (entry-agnostic, no static markup)', () => {
    // The chip is built by party_chip.ts and placed by the party painter, so it is NOT
    // static markup that must ship in both index.html / play.html. Pin that: the chip id
    // appears in the builder, and NEITHER entry carries a static #party-chip.
    expect(partyChipTs).toContain("export const PARTY_CHIP_ID = 'party-chip';");
    expect(partyChipTs).toContain('doc.createElement');
    for (const [name, entry] of [
      ['index.html', html],
      ['play.html', playHtml],
    ] as const) {
      expect(entry, name).not.toContain('id="party-chip"');
    }
    // The Hud drives the chip only in a party AND on the touch HUD: setCollapse takes the
    // isMobileLayout() flag, so it never renders on desktop (party frames unchanged there),
    // plus the isMobileChatOpen() flag so the party UI yields while mobile chat is up.
    expect(hudTs).toContain('this.partyFramesPainter.setCollapse(');
    expect(hudTs).toContain('this.isMobileLayout(),');
    expect(hudTs).toContain('this.partyCollapsed,');
    expect(hudTs).toContain('this.isMobileChatOpen(),');
    // The chat-yield read is a transient body-class check, never persisted.
    expect(hudTs).toContain("return document.body.classList.contains('mobile-chat-open');");
    // The collapse is a pure USER toggle: the chip caption reuses a t() key (never a raw
    // string), and the tap persists the flag through the party_collapse core.
    expect(hudTs).toContain("chipLabel: () => t('hudChrome.unitFrame.partyChip'),");
    expect(hudTs).toContain('savePartyCollapsed(this.partyCollapsed);');
    // The painter routes every chip DOM effect through the elided writers (no raw write
    // on the party painter's per-frame path): the class + attr + text writers, never a
    // raw classList / setAttribute / textContent.
    expect(partyFramesPainterTs).toContain(
      'this.writers.toggleClass(this.container, CHIP_PRESENT_CLASS',
    );
    expect(partyFramesPainterTs).toContain('this.writers.setAttr(chip.el, ARIA_EXPANDED');
    expect(partyFramesPainterTs).not.toMatch(/chip\.el\.setAttribute/);
  });

  it('ships the mobile chat keyboard-dismiss chevron in BOTH entries, hidden until chat opens', () => {
    // The dismiss chevron blurs the composer so the on-screen keyboard drops WITHOUT
    // closing chat. It is STATIC markup (a fixed button seated at the composer's corner),
    // so it must ship in both index.html / play.html or one entry loses the affordance.
    for (const [name, entry] of [
      ['index.html', html],
      ['play.html', playHtml],
    ] as const) {
      expect(entry, name).toContain('id="chat-dismiss"');
      // Carries the chevron icon hook (hydrateIcons swaps [data-icon] for inline SVG).
      expect(entry, name).toMatch(/id="chat-dismiss"[^>]*data-icon="next"/);
      // Accessible name via the hud_chrome mobile namespace (English-only domain + M16
      // non-Latin fills), never a raw aria string.
      expect(entry, name).toMatch(
        /id="chat-dismiss"[^>]*data-i18n-aria="hudChrome\.mobile\.hideKeyboard"/,
      );
    }
    // Hidden by default (desktop) AND hidden on mobile in the current model: the OS
    // keyboard's own hide key returns to the read view and the Chat icon closes the panel,
    // so there is no in-app chevron shown (no mobile show rule reveals it).
    expect(hudCss).toContain('#chat-dismiss {\n    display: none;\n  }');
    expect(hudMobileCss).toContain('body.mobile-touch #chat-dismiss {\n    display: none;');
    expect(hudMobileCss).not.toMatch(/#chat-dismiss \{[^}]*display:\s*inline-flex/);
    // Dismissing the keyboard KEEPS chat open in the read view: the composer's blur handler
    // recovers the viewport ONLY on the close path (composer already hidden), never on a
    // still-shown-composer blur. Only the Chat button closes chat.
    expect(mainTs).toContain(
      'if (shouldRecoverOnComposerBlur(chatInput.style.display)) recoverFromMobileKeyboard();',
    );
    // The chevron (kept wired for parity) blurs the composer to drop the keyboard, not close.
    expect(mainTs).toContain("document.getElementById('chat-dismiss')");
    expect(mainTs).toContain("chatDismiss?.addEventListener('click', () => chatInput.blur());");
    // Chat surfaces stay full-contrast while open (the idle fade never dims the log/composer).
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-chat-open #chatlog-wrap,\n  body.mobile-touch.mobile-chat-open #chatlog-tabs,\n  body.mobile-touch.mobile-chat-open #chat-input,\n  body.mobile-touch.mobile-chat-open #mobile-chat {\n    opacity: 1;',
    );
    // The Chat button is itself #mobile-combat-controls .mobile-btn, so its full-contrast
    // pin must OUT-SPECIFY the idle fade. The fade carries ONE id (#mobile-combat-controls);
    // the pin carries TWO (#mobile-combat-controls #mobile-chat), so opacity 1 wins while
    // chat is open even though .mobile-chrome-idle stays armed during a keyboard reply.
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-chrome-idle #mobile-combat-controls .mobile-btn,',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-chat-open #mobile-combat-controls #mobile-chat {\n    opacity: 1;',
    );
  });

  it('fills the keyboard-open chat as a flex column above the keyboard (composer is a flow item)', () => {
    // While the keyboard is up the whole panel (composer bar + tabs + log) re-lays as a flex
    // column filling the space ABOVE the keyboard: the log frame flexes to fill, and the
    // composer is a FLOW item at the top of the panel (from the open rule), not a separately
    // docked bar, so no composer reservation is needed.
    const wrapRule =
      hudMobileCss.match(
        /body\.mobile-touch\.mobile-keyboard-open\.mobile-chat-open #chatlog-wrap \{([^}]*)\}/,
      )?.[1] ?? '';
    // Definite height: the visible-above-keyboard band minus the top inset minus an 8px gap.
    expect(wrapRule).toMatch(/top:\s*max\(6px, env\(safe-area-inset-top\)\)/);
    expect(wrapRule).toMatch(/var\(--mobile-keyboard-visible-vh, 100vh\)/);
    expect(wrapRule).toMatch(/-\s+8px/);
    // No composer reservation any more (the composer is a flow item, not a docked bar).
    expect(wrapRule).not.toMatch(/--mobile-composer-h/);
    // The composer is a flow item in the panel (from the open rule), not absolutely docked.
    const openInputRule =
      hudMobileCss.match(/body\.mobile-touch\.mobile-chat-open #chat-input \{([^}]*)\}/)?.[1] ?? '';
    expect(openInputRule).toMatch(/position:\s*static/);
    expect(openInputRule).toMatch(/order:\s*-1/);
    // The log frame fills the rest of the panel (from the open rule); not height:100%.
    const frameRule =
      hudMobileCss.match(/body\.mobile-touch\.mobile-chat-open #chatlog-frame \{([^}]*)\}/)?.[1] ??
      '';
    expect(frameRule).toMatch(/flex:\s*1 1 auto/);
    expect(frameRule).not.toMatch(/height:\s*100%/);
    // The low-priority Chat/Social/More trio yields while the keyboard is up (fairness-neutral
    // menu chrome, restored on keyboard dismiss).
    expect(hudMobileCss).toMatch(
      /body\.mobile-touch\.mobile-keyboard-open\.mobile-chat-open #mobile-combat-controls \{\s*display:\s*none;/,
    );
  });

  it('ships the mobile party-chip CSS with a 40px touch floor, scoped to body.mobile-touch', () => {
    // The chip meets the mobile touch floor and reveals the frames only under the
    // painter-driven .party-expanded class (collapsed by default hides the rows + Leave).
    const chipRule = hudMobileCss.match(/body\.mobile-touch #party-chip \{([^}]*)\}/)?.[1] ?? '';
    expect(chipRule).toMatch(/min-width:\s*40px/);
    expect(chipRule).toMatch(/min-height:\s*40px/);
    // The chevron rotates on expand (the repo's SVG chevron pattern, not a unicode arrow).
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames.party-expanded #party-chip .ui-icon {\n    transform: rotate(90deg);',
    );
    // Collapsed OR chat-yielded (no .party-expanded on mobile) hides the member rows +
    // Leave button, so both states leave only the chip (if present) as the party UI.
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames:not(.party-expanded) .party-frame,',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames:not(.party-expanded) #party-leave {\n    display: none;',
    );
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
    // and the combo pip `on` toggle (now on the PLAYER frame: combo points are
    // character-bound) through toggleClass. No raw classList/style write on either
    // frame survives (those silently collapse the hot-DOM skip rate).
    expect(hudTs).toContain("this.toggleClass(this.targetFrameEl, 'elite'");
    expect(hudTs).toMatch(/this\.setStyleProp\(\s*this\.targetNameEl,\s*'color',/);
    expect(hudTs).toContain("this.toggleClass(pips[i] as HTMLElement, 'on', i < p.comboPoints);");
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
    const discordZ = Number(componentsCss.match(/#discord-window \{[\s\S]*?z-index: (\d+);/)?.[1]);
    expect(discordZ).toBeGreaterThan(startZ);
    expect(discordZ).toBeLessThan(modalZ);
  });

  it('keeps the Discord unlink modal at top level so it shows in-game, in BOTH entries', () => {
    // #start-screen is display:none once the game starts (main.ts hides it) and is a
    // lower z-index:100 stacking context, so a keep-modal nested inside it would be
    // invisible in-game and trapped below the top-level #discord-window. It must be a
    // top-level sibling declared above #start-screen, exactly like #discord-window.
    for (const [name, entry] of [
      ['index.html', html],
      ['play.html', playHtml],
    ] as const) {
      const modalAt = entry.indexOf('id="discord-keep-modal"');
      const windowAt = entry.indexOf('id="discord-window"');
      const startAt = entry.indexOf('id="start-screen"');
      expect(modalAt, name).toBeGreaterThan(-1);
      expect(windowAt, name).toBeGreaterThan(-1);
      // Declared before #start-screen opens, hence a top-level sibling, never a descendant.
      expect(modalAt, name).toBeLessThan(startAt);
      expect(windowAt, name).toBeLessThan(startAt);
    }
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
    expect(dataDeletionHtml).toContain('href="https://discord.com/invite/worldofclaudecraft"');
    expect(dataDeletionHtml).toContain('href="/support">Support</a>');
    expect(supportHtml).toContain(
      '<link rel="canonical" href="https://worldofclaudecraft.com/support" />',
    );
    expect(supportHtml).toContain('<h1>Support</h1>');
    expect(supportHtml).toContain('href="mailto:woc@levystreet.com"');
    expect(supportHtml).toContain('href="https://discord.com/invite/worldofclaudecraft"');
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
    expect(hudTs).toContain("if (options) fbq('trackCustom', eventName, data ?? {}, options);");
    expect(hudTs).toContain("else fbq('trackCustom', eventName, data ?? {});");
    expect(hudTs).toContain('if (ev.level === 5) {');
    expect(hudTs).toContain('characterId ? { eventID: `lvl5_$' + '{characterId}` } : undefined');
    expect(mainTs).toContain("if (options) fbq('trackCustom', eventName, data ?? {}, options);");
    expect(mainTs).toContain("else fbq('trackCustom', eventName, data ?? {});");
    expect(mainTs).toContain(
      'registered.accountId ? { eventID: `acct_$' + '{registered.accountId}` } : undefined',
    );
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

  it('skips the web mobile preflight in native builds and hard-gates portrait gameplay', () => {
    expect(mainTs).toContain('if (NATIVE_APP) return Promise.resolve();');
    expect(hudMobileCss).toContain(
      'body.mobile-touch.game-active #mobile-preflight {\n    display: none !important;',
    );
    expect(indexExtraCss).toContain(
      '@media (orientation: portrait) {\n    body.mobile-touch.game-active #rotate-device {\n      display: flex;',
    );
    expect(indexExtraCss).not.toContain('body.mobile-touch.game-active:not(.native-app)');
    expect(html).toContain(
      'Portrait mode is not supported. Rotate your device to landscape to continue.',
    );
    expect(playHtml).toContain(
      'Portrait mode is not supported. Rotate your device to landscape to continue.',
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

  it('keeps the desktop character roster readable inside a centered cinematic stage', () => {
    expect(shellCss).toContain('--cs-stage-gutter: max(26px, calc((100vw - 1780px) / 2));');
    expect(shellCss).toContain('--cs-roster-width: clamp(340px, 28vw, 440px);');
    expect(shellCss).toContain('--cs-details-width: var(--cs-roster-width);');
    expect(shellCss).toContain(
      '@media (min-width: 861px) {\n    #offline-select.cs-wow,\n    body:not(.mobile-touch) :is(#charselect-panel, #charcreate-panel).cs-wow {',
    );
    expect(shellCss).toContain(
      'body:not(.mobile-touch) #charselect-panel.cs-wow #char-list .char-row {\n      display: grid;\n      grid-template-columns: auto minmax(0, 1fr) auto;',
    );
    expect(shellCss).toContain(
      'body:not(.mobile-touch) #charselect-panel.cs-wow #char-list .char-actions {\n      display: grid;\n      grid-template-columns: minmax(112px, 1fr);',
    );
    expect(shellCss).toContain(
      'body:not(.mobile-touch) #charselect-panel.cs-wow #char-list .char-name {\n      overflow-wrap: anywhere;',
    );
    expect(shellCss).toContain(
      'body:not(.mobile-touch) #charselect-panel.cs-wow .class-details-grid {\n      grid-template-columns: minmax(0, 1fr);',
    );
    expect(shellCss).toContain(
      'overflow-y: auto;\n      scrollbar-width: thin;\n      scrollbar-color: color-mix(in srgb, var(--scrollbar-thumb) 42%, transparent) transparent;',
    );
    expect(shellCss).toContain(
      'body:not(.mobile-touch) #charselect-panel.cs-wow .class-details-panel::-webkit-scrollbar {\n      width: 6px;',
    );
    expect(shellCss).toContain(
      'body:not(.mobile-touch) #charselect-panel.cs-wow .details-gear-row .badge {\n      padding: 0;\n      border: 0;\n      border-radius: 0;\n      background: none;\n      text-transform: none;',
    );
    expect(shellCss).toContain('font-size: clamp(13px, 0.72vw, 15px);');
    expect(characterPreviewTs).toContain('const LIVE_PREVIEW_X = 0;');
    expect(characterPreviewTs).toContain('this.camera.position.set(LIVE_PREVIEW_X, 1.45, 5.1);');
    expect(characterPreviewTs).toContain(
      'this.camera.lookAt(new THREE.Vector3(LIVE_PREVIEW_X, 1.3, 0));',
    );
  });

  it('offers the quest log in the mobile controls drawer', () => {
    expect(html).toContain('id="mobile-extra-controls"');
    expect(html).toContain('id="mobile-quest"');
    expect(html).toContain('aria-label="Quest Log"');
  });

  it('offers Discord and Donate entries in the mobile drawer of BOTH entries', () => {
    // Mobile has no keyboard, so the U-key Discord panel toggle is unreachable;
    // this drawer button is the touch path to Discord (the account panel when
    // available, else the community invite). Donate mirrors the desktop shell's
    // Ko-fi community link.
    for (const [name, entry] of [
      ['index.html', html],
      ['play.html', playHtml],
    ] as const) {
      expect(entry, name).toContain('id="mobile-discord"');
      // Carries the icon hook (hydrateIcons swaps [data-icon] for the inline SVG).
      expect(entry, name).toMatch(/id="mobile-discord"[^>]*data-icon="discord"/);
      // Starts hidden; main.ts reveals it at boot on any build with Discord UI
      // enabled (it stays hidden in the native-app build).
      expect(entry, name).toMatch(/id="mobile-discord"\s+hidden/);
      expect(entry, name).toContain('id="mobile-donate"');
      expect(entry, name).toMatch(/id="mobile-donate"[^>]*data-icon="donate"/);
      // Donate is never gated on the web: no hidden attribute on it.
      expect(entry, name).not.toMatch(/id="mobile-donate"\s+hidden/);
    }
    // The native-app build strips every donation link (store payment-steering
    // policy); the tray entry joins the same suppression block as the desktop
    // .donate links in hud.css.
    expect(hudCss).toContain('body.native-app #mobile-donate,');
    // The tap targets: the account panel with the invite as the logged-out /
    // offline fallback, and the Ko-fi page, pinned to the shells' URLs.
    expect(mainTs).toContain(
      "const DISCORD_INVITE_URL = 'https://discord.com/invite/worldofclaudecraft';",
    );
    expect(mainTs).toContain("const DONATE_URL = 'https://ko-fi.com/worldofclaudecraft';");
    expect(mainTs).toContain(
      "window.open(discordInviteUrl() || DISCORD_INVITE_URL, '_blank', 'noopener,noreferrer');",
    );
    expect(mainTs).toContain(
      "onDonate: () => window.open(DONATE_URL, '_blank', 'noopener,noreferrer'),",
    );
    for (const [name, entry] of [
      ['index.html', html],
      ['play.html', playHtml],
    ] as const) {
      expect(entry.match(/href="https:\/\/ko-fi\.com\/worldofclaudecraft"/g), name).toHaveLength(3);
      expect(entry, name).not.toContain('https://github.com/sponsors/levy-street');
    }
  });

  it('offers a desktop micro-menu Discord entry in BOTH entries (not keybind-only)', () => {
    // Before this, linking Discord was reachable only via the undocumented 'U'
    // keybind: no menu item, button, or keybind-list mention told a desktop
    // player the feature existed. #mm-discord in the micro-menu (alongside
    // #mm-social, #mm-valecup, ...) gives it a visible, clickable affordance
    // that mirrors the mobile tray's #mobile-discord button.
    for (const [name, entry] of [
      ['index.html', html],
      ['play.html', playHtml],
    ] as const) {
      expect(entry, name).toContain('id="mm-discord"');
      expect(entry, name).toMatch(/id="mm-discord"[^>]*data-icon="discord"/);
      // Starts hidden; main.ts reveals it at boot on any build with Discord UI
      // enabled, mirroring #mobile-discord's own gating.
      expect(entry, name).toMatch(/id="mm-discord"\s+hidden/);
      // Shows the 'U' default keybind as a discoverability hint, same as every
      // other micro-menu button (#mm-social shows 'o', #mm-valecup shows 'y').
      expect(entry, name).toMatch(/id="mm-discord"[^>]*>\s*<span class="keybind">u<\/span>/);
    }
    // main.ts wires the click through the Hud's discord hook (attachDiscordHook)
    // to openDiscordEntry, the SAME entry point the mobile tray uses: it opens
    // the panel when logged in and falls through to the community invite
    // otherwise, so the desktop button is a live affordance offline too. The
    // hook is attached unconditionally (not inside `if (online)`), else the
    // button would render visible but no-op offline.
    expect(mainTs).toMatch(
      /hud\.attachDiscordHook\(\(\) => openDiscordEntry\(\)\);\s*\n\s*if \(online\) \{/,
    );
    expect(mainTs).toContain('function syncDiscordEntries(): void {');
    expect(mainTs).toContain("const desktopBtn = document.getElementById('mm-discord');");
  });

  it('ships the consumables quick bar in BOTH entries, collapsed by default', () => {
    for (const [name, entry] of [
      ['index.html', html],
      ['play.html', playHtml],
    ] as const) {
      expect(entry, name).toContain('id="mobile-consumables"');
      // aria-label on a role-less div is prohibited ARIA (ignored by screen
      // readers); the container carries role="group" so the name is exposed.
      expect(entry, name).toMatch(/id="mobile-consumables" role="group"/);
      // The chevron chip starts collapsed (aria-expanded false; hud.ts flips it)
      // and reuses the existing bags-filter key, so the bar adds no i18n keys.
      expect(entry, name).toMatch(/id="mobile-consumables-toggle"[^>]*aria-expanded="false"/);
      expect(entry, name).toMatch(/id="mobile-consumables-toggle"[^>]*data-icon="next"/);
      expect(entry, name).toMatch(
        /id="mobile-consumables-toggle"[^>]*data-i18n-aria="hudChrome\.bags\.filterConsumable"/,
      );
      const slots = [
        ...entry.matchAll(/class="mobile-consumable-slot"[^>]*data-consumable-index="(\d+)"/g),
      ];
      expect(slots, name).toHaveLength(6);
      expect(slots.map((m) => m[1]).sort(), name).toEqual(['0', '1', '2', '3', '4', '5']);
    }
    // The row shows only via the session-only body toggle, and empty slots
    // collapse away so the open row is as wide as what the player carries.
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-consumables-open #mobile-consumables-row {',
    );
    expect(hudMobileCss).toContain('body.mobile-touch .mobile-consumable-slot.empty {');
    // A touch starting on the bar must never double as a camera drag.
    expect(readFileSync(new URL('../src/game/touch_router.ts', import.meta.url), 'utf8')).toContain(
      "'#mobile-consumables',",
    );
    // The open row extends RIGHTWARD from the toggle along the top band (restored
    // by owner request; v0.23.0 had dropped it below the chip). top:0 + a left offset
    // past the 40px toggle flow it sideways; the pet classes drop it a band so it
    // clears the pet bar (mobile-pet-active). Overlap is gated by the mobile HUD audit.
    const consumRowStart = hudMobileCss.indexOf('body.mobile-touch #mobile-consumables-row {');
    const consumRow = hudMobileCss.slice(consumRowStart, hudMobileCss.indexOf('}', consumRowStart));
    expect(consumRow).toMatch(/top: 0;/);
    expect(consumRow).toMatch(/left: calc\(40px \+ 6px\);/);
    expect(consumRow).toMatch(/right: auto;/);
    // Pet classes drop the sideways row one band so it never overlaps the pet bar.
    expect(hudMobileCss).toMatch(
      /body\.mobile-touch\.mobile-pet-active #mobile-consumables-row \{\n {4}top: calc\(100% \+ 6px\);/,
    );
    // The id list is snapshotted at OPEN time and stays frozen while open, so
    // slots never shift under the thumb the frame a stack depletes: exactly one
    // consumableBarItems CALL (the toggle handler's snapshot), none per-frame.
    expect(hudTs.match(/consumableBarItems\(/g) ?? []).toHaveLength(1);
    expect(hudTs).toContain(
      'consumableBarItems(this.sim.inventory, (id) => ITEMS[id], this.consumableBarIds);',
    );
  });

  it('carries identical mobile-action-ring markup in BOTH entries', () => {
    for (const entry of [html, playHtml]) {
      expect(entry).toContain('id="mobile-action-ring"');
      expect(entry).toContain('id="mobile-action-attack"');
      expect(entry).toContain('id="mobile-action-page-toggle"');
      const slotMatches = [
        ...entry.matchAll(/class="mobile-action-slot"[^>]*data-mobile-index="(\d+)"/g),
      ];
      expect(slotMatches).toHaveLength(5);
      const indices = slotMatches.map((m) => m[1]).sort();
      expect(indices).toEqual(['0', '1', '2', '3', '4']);
    }
  });

  it('carries the same community-tray links in BOTH entries, with no duplicate Discord entry', () => {
    for (const entry of [html, playHtml]) {
      expect(entry).toContain('<a class="community-link github"');
      expect(entry).toContain('<a class="community-link donate"');
      expect(entry).not.toContain('<a class="community-link discord"');
    }
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

  it('hides the community-links rail on mobile touch (its icon read as a Friends button)', () => {
    // The rail markup stays for desktop (narrow-desktop rules and the
    // homepage still use it); only the in-game touch HUD hides it, because
    // its two-person toggle icon under the minimap masqueraded as a Friends
    // button next to the real Social button in the top-left trio.
    expect(html).toContain('<a class="donate-cta"');
    expect(html).toContain('<details id="community-menu">');
    expect(html).toContain('<summary class="community-toggle"');
    expect(html).toContain('<div class="community-tray">');
    expect(html).toContain('<a class="community-link github"');
    expect(html).toContain('<a class="community-link donate"');
    // No separate Discord invite link here: it duplicated the Discord (U)
    // icon-rail button (#mm-discord), the game HUD's single Discord entry
    // point (see the fix/inspect-camera-talent-overlap-discord-dup PR).
    expect(html).not.toContain('<a class="community-link discord"');
    expect(hudMobileCss).toContain('body.mobile-touch.game-active #ui {\n    z-index: 80;\n  }');
    expect(hudMobileCss).toContain('body.mobile-touch #community-hud {\n    display: none;\n  }');
    // No stray mobile-touch styling survives for the hidden rail (the old
    // positioning/tray rules are gone, not just overridden).
    expect(hudMobileCss).not.toContain('body.mobile-touch .community-toggle');
    expect(hudMobileCss).not.toContain('body.mobile-touch .community-tray');
    expect(hudMobileCss).not.toContain('body.mobile-touch .community-link');
    expect(hudMobileCss).not.toContain('body.mobile-touch #community-menu');
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
    // The close X is touch-tap bound (never bare 'click', which the browser
    // only synthesizes for the primary pointer), so it works mid-steer.
    expect(hudTs).toContain("const moreClose = document.getElementById('mobile-more-close');");
    expect(hudTs).toContain('bindTouchTap(moreClose, () => {');
  });

  it('binds the death-screen respawn buttons via touch-tap, not bare click', () => {
    // On a phone the browser only synthesizes 'click' for the primary pointer,
    // so a bare click binding goes dead while another finger is down (a held
    // movement joystick when the player dies mid-run), stranding them on the
    // death overlay (issue 1484). All three buttons must use bindTouchTap.
    expect(hudTs).toContain('bindTouchTap(this.releaseSpiritBtnEl, () => {');
    expect(hudTs).toContain(
      'bindTouchTap(this.resurrectCorpseBtnEl, () => this.sim.resurrectAtCorpse());',
    );
    expect(hudTs).toContain(
      'bindTouchTap(this.resurrectHealerBtnEl, () => this.sim.resurrectAtSpiritHealer());',
    );
    expect(hudTs).not.toMatch(
      /(?:releaseSpiritBtnEl|resurrectCorpseBtnEl|resurrectHealerBtnEl)\.addEventListener\('click'/,
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
    // Own HP/mana lives bottom-center (the one part of the screen every
    // other mobile element deliberately leaves empty), not top-left.
    expect(hudMobileCss).toContain(
      'body.mobile-touch #player-frame {\n    position: fixed;\n    left: 50%;\n    top: auto;\n    bottom: calc(14px + env(safe-area-inset-bottom));\n    z-index: 21;',
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
      'body.mobile-touch #target-frame {\n    left: max(20px, calc(env(safe-area-inset-left) + 10px));\n    top: calc(max(8px, env(safe-area-inset-top)) + 72px);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames {\n    position: fixed;\n    left: max(20px, calc(env(safe-area-inset-left) + 10px));\n    top: calc(max(8px, env(safe-area-inset-top)) + 74px);',
    );
    // The base below-target offset was nudged +5px (130 -> 135) so the new first-child
    // collapse chip clears the target frame's bottom edge; a comment now sits between the
    // selector and the top, so assert the selector and the pinned value independently.
    expect(hudMobileCss).toContain('body.mobile-touch #party-frames.below-target {');
    expect(hudMobileCss).toContain('top: calc(max(8px, env(safe-area-inset-top)) + 135px);');
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames .party-frame {\n    width: calc(112px * var(--mobile-chrome-scale, 1));\n    min-height: 40px;',
    );
    // Keyed on :first-of-type (not :first-child): the collapse chip is now the
    // container's first child, so the top member row is selected by :first-of-type.
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames .party-frame:not(:first-of-type) {\n    margin-top: -1px;',
    );
    // F1: the container is a simple flex column now (chip, rows wrapper, master-loot,
    // leave), so the leave button carries no grid placement and no member frame can
    // auto-flow beside the chip.
    expect(hudMobileCss).toMatch(
      /body\.mobile-touch #party-frames \{[^}]*display: flex;[^}]*flex-direction: column;/,
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames #party-leave {\n    width: auto;\n    min-width: 0;\n    min-height: 40px;',
    );
    expect(hudMobileCss).not.toMatch(/#party-leave \{\n {4}grid-column/);
    // The double-stack grid the container used to carry moved to the .party-rows WRAPPER;
    // on desktop the wrapper is transparent (display: contents), so the desktop stack is
    // unchanged. Both pins guard the two-arm structure.
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames .party-rows {\n    display: grid;\n    grid-auto-flow: column;\n    grid-template-rows: repeat(2, auto);',
    );
    expect(hudCss).toContain('#party-frames .party-rows {\n    display: contents;\n  }');
    expect(hudMobileCss).toContain(
      'body.mobile-touch #party-frames .party-frame {\n      width: calc(100px * var(--mobile-chrome-scale, 1));\n      min-height: 40px;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #target-frame {\n      left: max(6px, env(safe-area-inset-left));\n      top: calc(max(6px, env(safe-area-inset-top)) + 56px);',
    );
    // Landscape below-target offset likewise nudged +5px (100 -> 105) for the chip.
    expect(hudMobileCss).toContain('top: calc(max(6px, env(safe-area-inset-top)) + 105px);');
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
      'body.mobile-touch[data-start-panel="login-panel"] #hero-view,\n    body.mobile-touch[data-start-panel="discord-choice-panel"] #hero-view,\n    body.mobile-touch[data-start-panel="realm-panel"] #hero-view,\n    body.mobile-touch[data-start-panel="offline-select"] #hero-view {\n      justify-content: flex-start;\n      min-height: calc(var(--app-vh) - 86px);',
    );
    // charselect/charcreate float their header out of flow entirely (a floating
    // hamburger, not a shrunk-but-present header bar), so they get the FULL
    // viewport height here instead of height-minus-header.
    expect(hudMobileCss).toContain(
      'body.mobile-touch[data-start-panel="charselect-panel"] #hero-view,\n    body.mobile-touch[data-start-panel="charcreate-panel"] #hero-view {\n      justify-content: flex-start;\n      min-height: var(--app-vh);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch[data-start-panel="mode-select"] #title-logo {\n      width: min(176px, 24vw);\n      margin: 0;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch[data-start-panel="charselect-panel"] #title-logo,\n    body.mobile-touch[data-start-panel="charcreate-panel"] #title-logo,\n    body.mobile-touch[data-start-panel="login-panel"] #title-logo,\n    body.mobile-touch[data-start-panel="discord-choice-panel"] #title-logo,\n    body.mobile-touch[data-start-panel="realm-panel"] #title-logo,\n    body.mobile-touch[data-start-panel="offline-select"] #title-logo {\n      display: none;',
    );
    // No header flow-height to subtract anymore: the floating hamburger reserves
    // zero layout height, so only the panel's own top/bottom padding is left.
    expect(shellCss).toContain('height: min(560px, calc(var(--app-vh) - 20px));');
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
    // charselect's columns stay overflow:hidden (their #char-list and
    // #charselect-class-details CHILDREN scroll); charcreate's columns hold a
    // single tall flow with no inner scroll container, so THEY scroll instead
    // (overflow-y: auto), or the Create button clips off with no way to reach it.
    expect(shellCss).toContain(
      'body.mobile-touch #charselect-panel .cs-list-col,\n    body.mobile-touch #charselect-panel .cs-detail-col {\n      min-height: 0;\n      height: 100%;\n      overflow: hidden;',
    );
    expect(shellCss).toContain(
      'body.mobile-touch #charcreate-panel .cs-create-col,\n    body.mobile-touch #charcreate-panel .cs-detail-col {\n      min-height: 0;\n      height: 100%;\n      overflow-y: auto;',
    );
    // No body.mobile-touch charcreate column rule may declare overflow:hidden
    // (that was the clip bug). Guard both column selectors against a hidden
    // regression, tolerating either selector order.
    for (const col of ['.cs-create-col', '.cs-detail-col']) {
      const rule = shellCss.match(
        new RegExp(`body\\.mobile-touch #charcreate-panel \\${col}[^{]*\\{([^}]*)\\}`),
      );
      expect(rule, `charcreate ${col} mobile column rule should exist`).not.toBeNull();
      const ruleBody = rule?.[1] ?? '';
      expect(ruleBody).toMatch(/overflow-y:\s*auto/);
      expect(ruleBody).not.toMatch(/overflow:\s*hidden/);
    }
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
    expect(html).toContain(
      '<span id="mobile-more-title" data-i18n="hud.core.mobileMore">More</span>',
    );
    expect(playHtml).toContain(
      '<span id="mobile-more-title" data-i18n="hud.core.mobileMore">More</span>',
    );
    expect(html).toContain('id="mobile-more-close"');
    expect(html).toContain('<div id="mobile-extra-grid">');
    // Daily Rewards, the Book of Deeds, and Crafting ride the More grid in BOTH
    // entries (play.html historically lags index.html; these pins keep them in
    // step).
    for (const entry of [html, playHtml]) {
      expect(entry).toContain('id="mobile-daily-rewards"');
      expect(entry).toContain('id="mobile-deeds"');
      expect(entry).toContain('id="mobile-crafting"');
    }
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-more-open #mobile-controls {\n    z-index: 140;\n  }',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #mobile-extra-controls {\n    position: fixed;\n    left: 50%;\n    top: 50%;\n    bottom: auto;\n    --mobile-more-open-transform: translate(-50%, -50%);\n    --mobile-more-closed-transform: translate(-50%, -46%) scale(0.96);\n    transform: var(--mobile-more-closed-transform);',
    );
    expect(hudMobileCss).toContain(
      'display: flex;\n    flex-direction: column;\n    opacity: 0;\n    visibility: hidden;',
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
      'body.mobile-touch.mobile-more-open #mobile-extra-controls {\n    opacity: 1;\n    visibility: visible;\n    pointer-events: auto;\n    transform: var(--mobile-more-open-transform);',
    );
    expect(hudMobileCss).toContain(
      'transition:\n      opacity 150ms ease,\n      transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #mobile-more .ui-icon {\n    transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-more-open #mobile-more .ui-icon {\n    transform: rotate(38deg);',
    );
    expect(hudMobileCss).toContain(
      '@media (prefers-reduced-motion: reduce) {\n    body.mobile-touch #mobile-extra-controls,\n    body.mobile-touch #mobile-more .ui-icon {\n      transition: none;',
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
    // Smaller than the old 560px cap: the More tray only holds short pill
    // buttons now, not a wide desktop-style panel.
    expect(hudMobileCss).toContain(
      'width: min(440px, calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right)));',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #mobile-extra-grid {\n    display: grid;\n    grid-template-columns: repeat(4, minmax(0, 1fr));',
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
    expect(mobileControlsTs).toContain("modal.style.top = '50%';");
    expect(mobileControlsTs).toContain("modal.style.transform = 'translate(-50%, -50%)';");
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

  it('keeps the More tray out of the managed-window close path', () => {
    // The closed tray stays display:flex (opacity/visibility carry the
    // transition), so the managed-window visibility probe must key on the
    // body class: otherwise closeAll() treats the closed tray as the topmost
    // window and stamps an inline display:none that the class toggles can
    // never clear, leaving the tray unopenable until reload.
    const isWindowVisible = hudTs.slice(
      hudTs.indexOf('private isWindowVisible('),
      hudTs.indexOf('private syncWindowOpenState('),
    );
    expect(isWindowVisible).toContain("if (el.id === 'mobile-extra-controls')");
    expect(isWindowVisible).toContain(
      "return document.body.classList.contains('mobile-more-open');",
    );
    // Closing through the window manager must ride the same class mechanism
    // as the tray's own X button, never the default inline display:none arm.
    const closeManaged = hudTs.slice(
      hudTs.indexOf('private closeManagedWindow('),
      hudTs.indexOf('private initChatTabs('),
    );
    expect(closeManaged).toContain("case 'mobile-extra-controls':");
    expect(closeManaged).toContain("document.body.classList.remove('mobile-more-open');");
    expect(closeManaged).toContain(
      "document.getElementById('mobile-more')?.classList.remove('active');",
    );
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

  it('keeps the mobile bar at top-left and leaves low-frequency actions in the More tray', () => {
    for (const [name, entry] of [
      ['index.html', html],
      ['play.html', playHtml],
    ] as const) {
      const combatControls = entry.slice(
        entry.indexOf('<div id="mobile-combat-controls">'),
        entry.indexOf('<div id="mobile-action-ring"'),
      );
      const primaryButtons = [...combatControls.matchAll(/<button class="mobile-btn"/g)];
      const chat = combatControls.indexOf('id="mobile-chat"');
      const social = combatControls.indexOf('id="mobile-social"');
      const quest = combatControls.indexOf('id="mobile-quest"');
      const settings = combatControls.indexOf('id="mobile-menu"');
      const more = combatControls.indexOf('id="mobile-more"');
      const moreButton = combatControls.slice(more, combatControls.indexOf('</button>', more));
      // The source order stays the touch row: Chat, Social, Quests, Settings,
      // More. Portrait gameplay is blocked by the rotate gate, so this row does
      // not need a second portrait-specific copy in the tray.
      expect(primaryButtons, name).toHaveLength(5);
      expect(chat, name).toBeGreaterThanOrEqual(0);
      expect(social, name).toBeGreaterThan(chat);
      expect(quest, name).toBeGreaterThan(social);
      expect(settings, name).toBeGreaterThan(quest);
      expect(more, name).toBeGreaterThan(settings);
      expect(moreButton, name).toContain('data-icon="more"');
      const tray = entry.slice(
        entry.indexOf('<div id="mobile-extra-grid">'),
        entry.indexOf('<div id="mobile-window-backdrop"'),
      );
      expect(tray, name).not.toContain('mobile-portrait-primary');
      expect(tray, name).not.toContain('id="mobile-more-chat"');
      expect(tray, name).not.toContain('id="mobile-more-social"');
      expect(tray, name).not.toContain('id="mobile-more-quest"');
      expect(tray, name).not.toContain('id="mobile-more-menu"');
      expect(tray, name).not.toContain('id="mobile-social"');
      expect(tray, name).not.toContain('id="mobile-quest"');
      expect(tray, name).not.toContain('id="mobile-menu"');
      // No bottom-centre Target button: the one targeting helper on touch is
      // the Target swap button inside the action ring (#mobile-target-cycle),
      // never a third centre button (the old #mobile-target design).
      expect(entry, name).not.toContain('id="mobile-target"');
      expect(entry, name).not.toContain('data-i18n="hud.core.mobileTarget"');
    }
    expect(hudMobileCss).toContain('grid-template-columns: repeat(5, 58px);');
    expect(hudMobileCss).toContain('grid-template-columns: repeat(5, 54px);');
    expect(hudMobileCss).not.toContain('grid-template-columns: 52px;');
    expect(hudMobileCss).not.toContain('mobile-portrait-primary');
    // The #mobile-consumables chip docks just PAST the bar, so its left offset must
    // track the bar's 5-column scaled width in base/landscape (base 5x58+4x12=338,
    // landscape 5x54+4x10=310). Pinned so a future bar-width
    // change updates both and the chip never slides back under the buttons.
    expect(hudMobileCss).toContain('338px *'); // base consumables dock offset
    expect(hudMobileCss).toContain('310px *'); // landscape consumables dock offset
    // Top-LEFT anchor: the bar's single 54px row clears the target-frame seat
    // below it (top + 72px) and leaves the top-centre band to the pet bar.
    expect(hudMobileCss).toContain(
      'position: absolute;\n    left: max(12px, env(safe-area-inset-left));\n    top: max(8px, env(safe-area-inset-top));',
    );
    expect(hudMobileCss).toContain(
      'top: max(6px, env(safe-area-inset-top));\n      grid-template-columns: repeat(5, 54px);',
    );
    expect(hudMobileCss).toContain(
      'pointer-events: auto;\n    align-items: start;\n    z-index: 30;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #petbar {\n    position: fixed;\n    left: 50%;\n    top: max(8px, env(safe-area-inset-top));',
    );
    expect(hudMobileCss).toContain('body.mobile-touch #mobile-more {\n    position: static;');
    expect(mainTs).toContain('onMenu: () => hud.toggleOptionsMenu(),');
    expect(mobileControlsTs).not.toContain("bindButton('mobile-more-chat'");
    expect(mobileControlsTs).not.toContain("bindButton('mobile-more-social'");
    expect(mobileControlsTs).not.toContain("bindButton('mobile-more-quest'");
    expect(mobileControlsTs).not.toContain("bindButton('mobile-more-menu'");
    expect(mobileControlsTs).not.toContain('isPortraitViewport');
    // The touch targeting split: the ring's Target swap button cycles hostiles
    // via the Tab path (onCycleTarget), and the attack toggle owns the
    // acquire-nearest fallback through the hud hook. Pin every arm positively
    // (bindButton silently no-ops on a missing element, so only a positive
    // source pin catches a lost binding) plus the old bottom-centre Target
    // button's removal.
    expect(mainTs).not.toContain('onTarget:');
    expect(mobileControlsTs).not.toContain("bindButton('mobile-target'");
    expect(mainTs).toContain('onCycleTarget: () => world.tabTarget(),');
    expect(mainTs).toContain('hud.onMobileAttackNearest = () => attackNearest();');
    expect(mobileControlsTs).toContain(
      "this.bindButton('mobile-target-cycle', () => this.callbacks.onCycleTarget());",
    );
    // The attack toggle's fallback fires only with no live hostile target and
    // never while auto-attacking. Its fixed mobile control must not route through
    // the desktop slot 0, which can hold an assigned action.
    expect(hudTs).toContain('handleMobileAttackTap(');
    expect(hudTs).toContain('activateAttack: () => this.activateFixedAttackSlot(),');
  });

  it('keeps joystick autorun on the move pad and Jump on the ring bottom row', () => {
    for (const [name, entry] of [
      ['index.html', html],
      ['play.html', playHtml],
    ] as const) {
      const moveJoystick = entry.slice(
        entry.indexOf('<div id="mobile-move-joystick"'),
        entry.indexOf('<div id="mobile-camera-joystick"'),
      );
      const ring = entry.slice(
        entry.indexOf('<div id="mobile-action-ring"'),
        entry.indexOf('<div id="mobile-extra-controls"'),
      );
      expect(moveJoystick, name).toContain('id="mobile-autorun-target"');
      expect(moveJoystick.indexOf('id="mobile-autorun-target"')).toBeLessThan(
        moveJoystick.indexOf('id="mobile-move-stick"'),
      );
      expect(entry, name).not.toContain('id="mobile-utility-cluster"');
      expect(entry, name).not.toContain('id="mobile-autorun"');
      // Jump moved to the RING's bottom row (right thumb: steer with the left
      // thumb, jump with the right); Use stays in the ring hollow. Neither
      // may reappear as a left-side utility satellite.
      expect(ring, name).toContain('id="mobile-jump"');
      expect(ring, name).toContain('id="mobile-interact"');
    }
    expect(hudMobileCss).toContain('body.mobile-touch #mobile-autorun-target {');
    expect(hudMobileCss).toContain('top: -104px;');
    expect(hudMobileCss).toContain('body.mobile-touch #mobile-autorun-target.near,');
    expect(hudMobileCss).toContain('body.mobile-touch #mobile-autorun-target.locked {');
    expect(hudMobileCss).not.toContain('body.mobile-touch #mobile-utility-cluster');
    expect(hudMobileCss).not.toContain('body.mobile-touch #mobile-autorun {');
    // The cast bar sits at the classic centre seat above the bottom-centre
    // player frame, in both the base and landscape rules; on the compact tier
    // both nudge 40px left so Jump's ring-row seat keeps a clear circle on
    // 740px-wide phones.
    expect(hudMobileCss).toContain('bottom: calc(68px + env(safe-area-inset-bottom));');
    expect(hudMobileCss).toContain('bottom: calc(62px + env(safe-area-inset-bottom));');
    expect(hudMobileCss).not.toContain('body.mobile-touch.mobile-left-handed #castbar');
    // Nudged further right from the original -40px to clear more of the
    // joystick zone; castbar/swingbar still move together with it.
    expect(hudMobileCss).toContain(
      'body.mobile-touch.hud-mobile-compact #player-frame {\n    left: calc(50% - 15px);\n  }',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.hud-mobile-compact #castbar,\n  body.mobile-touch.hud-mobile-compact #swingbar {\n    left: calc(50% - 15px);\n  }',
    );
    // Left-handed mode mirrors the floating capture zone; the autorun target is
    // a child of the move joystick, so it follows that mirror without its own
    // satellite placement rules.
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-left-handed #mobile-move-zone {\n    left: auto;\n    right: 0;\n  }',
    );
  });

  it('keeps the Target swap, Use, Jump and page toggle in the action ring markup', () => {
    for (const [name, entry] of [
      ['index.html', html],
      ['play.html', playHtml],
    ] as const) {
      const ring = entry.slice(
        entry.indexOf('<div id="mobile-action-ring"'),
        entry.indexOf('<div id="mobile-extra-controls"'),
      );
      expect(ring, name).toContain('id="mobile-target-cycle"');
      expect(ring, name).toContain('id="mobile-interact"');
      expect(ring, name).toContain('id="mobile-jump"');
      expect(ring, name).toContain('id="mobile-action-page-toggle"');
      expect(ring, name).toContain('data-i18n="hudChrome.mobile.targetCycleShort"');
      expect(ring, name).toContain('data-i18n="hud.core.mobileUse"');
      expect(ring, name).toContain('data-i18n="hudChrome.mobile.jump"');
      // The page toggle is the gold swap badge: number over the swap glyph.
      expect(ring, name).toContain('data-icon="swap"');
    }
    // Jump's seat: one arc-seat past the 180deg action slot on Use's row,
    // with its circle-edge gap to that slot EQUAL to Use's gap on the other
    // side (centre at 2 * radius - hollow from the attack centre), so the
    // bottom row reads even-spaced at every tier. Plus its left-handed mirror.
    expect(hudMobileCss).toContain(
      'body.mobile-touch #mobile-action-ring #mobile-jump {\n    right: calc(\n      var(--mobile-ring-attack-size) /\n      2 +\n      var(--mobile-ring-radius) *\n      2 -\n      var(--mobile-ring-hollow) -\n      var(--mobile-ring-secondary-size) /\n      2\n    );',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-left-handed #mobile-action-ring #mobile-jump {\n    left: calc(',
    );
    // The arc is a single quarter-circle: every slot offset is derived from the
    // shared radius var and stays non-negative (nothing can leave the screen,
    // the regression the redesign fixed).
    expect(hudMobileCss).toContain(
      '--mobile-ring-radius: calc(190px * var(--mobile-chrome-scale, 1));',
    );
    // The token VALUE is the whole chrome-scale feature: every consumer falls
    // back to 1 (`var(--mobile-chrome-scale, 1)`), so deleting or resetting the
    // one declaration silently reverts the entire 0.85 shrink with every usage
    // pin above still green. Only a literal value pin catches it.
    expect(hudMobileCss).toContain('--mobile-chrome-scale: 0.85;');
    expect(hudMobileCss).not.toContain('calc(0px -');
    // The equal-chord arc factors (cos/sin of 157.5 and 112.5 deg) on the two
    // asymmetric slots, right-handed and mirrored: corrupting one angle breaks
    // the even spacing without moving anything off-screen, so only a literal
    // factor pin catches it.
    expect(hudMobileCss).toContain(
      '.mobile-action-slot[data-mobile-index="1"] {\n    right: calc(\n      var(--mobile-ring-attack-size) /\n      2 +\n      var(--mobile-ring-radius) *\n      0.9239 -',
    );
    expect(hudMobileCss).toContain(
      '.mobile-action-slot[data-mobile-index="3"] {\n    right: calc(\n      var(--mobile-ring-attack-size) /\n      2 +\n      var(--mobile-ring-radius) *\n      0.3827 -',
    );
    expect(hudMobileCss).toContain(
      '.mobile-action-slot[data-mobile-index="1"] {\n    left: calc(\n      var(--mobile-ring-attack-size) /\n      2 +\n      var(--mobile-ring-radius) *\n      0.9239 -',
    );
    expect(hudMobileCss).toContain(
      '.mobile-action-slot[data-mobile-index="4"] {\n    left: calc(var(--mobile-ring-attack-size) / 2 - var(--mobile-ring-action-size) / 2);\n    right: auto;\n  }',
    );
    // Use (180deg, due left), Target swap (135deg, the up-left diagonal) and
    // the page toggle (90deg, due up over the attack button, to Target's
    // upper right) nest in the crescent hollow in 45deg steps. All three keep
    // their seats in the left-handed mirror. Pin the literal cos/sin factors:
    // corrupting one breaks the even spacing without moving anything
    // off-screen, so only a literal pin catches it.
    expect(hudMobileCss).toContain(
      '--mobile-ring-hollow: calc(104px * var(--mobile-chrome-scale, 1));',
    );
    expect(hudMobileCss).toContain(
      '--mobile-ring-toggle-size: calc(52px * var(--mobile-chrome-scale, 1));',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #mobile-target-cycle {\n    right: calc(\n      var(--mobile-ring-attack-size) /\n      2 +\n      var(--mobile-ring-hollow) *\n      0.7071 -',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #mobile-action-ring #mobile-interact {\n    right: calc(\n      var(--mobile-ring-attack-size) /\n      2 +\n      var(--mobile-ring-hollow) -',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #mobile-action-page-toggle {\n    right: calc(var(--mobile-ring-attack-size) / 2 - var(--mobile-ring-toggle-size) / 2);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-left-handed #mobile-target-cycle {\n    left: calc(',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-left-handed #mobile-action-ring #mobile-interact {\n    left: calc(',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-left-handed #mobile-action-page-toggle {\n    left: calc(',
    );
    // The tier var packs are pinned as WHOLE blocks (selector + every value):
    // a bare-literal pin would still pass if the compact and tablet packs were
    // swapped between selectors.
    expect(hudMobileCss).toContain(
      'body.mobile-touch.hud-mobile-compact #mobile-action-ring {\n' +
        '    --mobile-ring-attack-size: calc(84px * var(--mobile-chrome-scale, 1));\n' +
        '    --mobile-ring-action-size: calc(54px * var(--mobile-chrome-scale, 1));\n' +
        '    --mobile-ring-radius: calc(160px * var(--mobile-chrome-scale, 1));\n' +
        '    --mobile-ring-toggle-size: max(40px, calc(46px * var(--mobile-chrome-scale, 1)));\n' +
        '    --mobile-ring-secondary-size: calc(50px * var(--mobile-chrome-scale, 1));\n' +
        '    --mobile-ring-hollow: calc(88px * var(--mobile-chrome-scale, 1));\n' +
        '    right: max(14px, env(safe-area-inset-right));\n' +
        '    bottom: calc(10px + env(safe-area-inset-bottom));\n' +
        '  }',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.hud-mobile-tablet #mobile-action-ring {\n' +
        '    --mobile-ring-attack-size: calc(116px * var(--mobile-chrome-scale, 1));\n' +
        '    --mobile-ring-action-size: calc(76px * var(--mobile-chrome-scale, 1));\n' +
        '    --mobile-ring-radius: calc(226px * var(--mobile-chrome-scale, 1));\n' +
        '    --mobile-ring-toggle-size: calc(56px * var(--mobile-chrome-scale, 1));\n' +
        '    --mobile-ring-secondary-size: calc(60px * var(--mobile-chrome-scale, 1));\n' +
        '    --mobile-ring-hollow: calc(123px * var(--mobile-chrome-scale, 1));\n' +
        '  }',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.hud-mobile-compact.mobile-left-handed #mobile-action-ring {',
    );
    // The compact minimap shrink keeps the arc's vertical budget on a
    // 360px-tall phone holding (the daily-chest rail was folded into the
    // mobile More tray, issue #1577, so it no longer needs a coupled offset).
    // PR #1674 relaxed the shrink from 0.44 to 0.57 for minimap legibility.
    expect(hudMobileCss).toContain('transform: scale(calc(0.57 * var(--mobile-chrome-scale, 1)));');
  });

  it('shrinks the compact-tier page-toggle digit so it is not clipped by the ring circle', () => {
    // On the compact tier the toggle is clamped to the 40px touch floor
    // (--mobile-ring-toggle-size: max(40px, ...)), whose border-box inner
    // height is only 40 - 2 * 2px border = 36px. The base 20px digit plus the
    // 2px-margin 15px icon below it (37px) overflowed that by a hair, and
    // #mobile-action-ring > button's overflow:hidden (needed to clip the
    // cooldown sweep) cropped the digit's top pixels instead of showing it in
    // full at 1044x480 (the compact tier's exact 480px height boundary).
    // Regression for that clip: the compact tier must shrink the digit enough
    // to clear the 36px inner floor with the icon still under it.
    expect(hudMobileCss).toContain(
      'body.mobile-touch.hud-mobile-compact #mobile-action-page-toggle .mobile-action-page-indicator {\n' +
        '    font-size: 15px;\n' +
        '  }',
    );
  });

  it('gates the camera joystick behind its opt-in setting (swipe-look is the primary camera)', () => {
    // The base's declutter removed the camera joystick outright; this branch
    // keeps it as an OPT-IN (settings.mobileCameraJoystick stamps
    // body.mobile-camera-joystick-on), hidden by default with no reserved
    // layout space. The double-tap recenter gesture therefore also lives on
    // the swipe-look path, which is the default camera on touch.
    expect(hudMobileCss).toContain(
      'body.mobile-touch:not(.mobile-camera-joystick-on) #mobile-camera-joystick {\n    display: none;\n  }',
    );
    expect(mobileControlsTs).toContain('private swipeLookDownAt = 0;');
    expect(mobileControlsTs).toContain('private lastSwipeTapAt = 0;');
    expect(mobileControlsTs).toContain('this.callbacks.onRecenterCamera();');
  });

  it('keeps the mobile spell bar in a scrollable row between the joysticks', () => {
    expect(hudMobileCss).toContain('width: min(30vw, 132px);');
    expect(hudMobileCss).toContain('min-width: 112px;');
    expect(hudMobileCss).toContain('height: min(36vh, 172px);');
    expect(hudMobileCss).toContain('left: calc(max(18px, env(safe-area-inset-left)) + 172px);');
    expect(hudMobileCss).toContain('right: calc(max(18px, env(safe-area-inset-right)) + 172px);');
    expect(hudMobileCss).toContain('bottom: calc(64px + env(safe-area-inset-bottom));');
    expect(hudMobileCss).toContain('left: calc(max(20px, env(safe-area-inset-left)) + 164px);');
    expect(hudMobileCss).toContain('right: calc(max(20px, env(safe-area-inset-right)) + 164px);');
    expect(hudMobileCss).toContain('bottom: calc(57px + env(safe-area-inset-bottom));');
  });

  it('hides the desktop action bars on touch: the mobile action ring supersedes them', () => {
    // The paged mobile action ring (bcc5fa53) replaced the scrollable desktop
    // #actionbar row on touch, so both desktop bars (and their .action-btn
    // sizing/drag/hover rules, only ever reachable while a bar is visible) stay
    // display:none rather than also being scaled/laid out for touch.
    expect(hudMobileCss).toContain('body.mobile-touch #actionbar2 {\n    display: none;\n  }');
    expect(hudMobileCss).toContain('body.mobile-touch #actionbar {\n    display: none;\n  }');
    expect(hudMobileCss).not.toContain('body.mobile-touch #actionbar {\n    display: flex;');
    expect(hudMobileCss).not.toContain('body.mobile-touch .action-btn {');
    expect(hudMobileCss).not.toContain('body.mobile-touch #actionbar.many-spells');
  });

  it('seeds druid form bars and initializes stealth pages blank', () => {
    expect(hudTs).toContain('if (this.isFormKitBar()) {');
    expect(hudTs).toContain('if (this.seedFormBarIfNeeded(parsed)) return;');
    expect(hudTs).toMatch(
      /buildDefaultFormBar\(\s*this\.formKitAbilityIds\(this\.activeHotbarForm\),\s*Hud\.BAR_ABILITY_SLOTS,\s*\)/,
    );
    expect(hudTs).toContain('if (this.isStealthHotbarForm()) {');
    expect(hudTs).toContain('this.loadStealthSlotMap(parsed, stored, storedRaw);');
    expect(hudTs).toMatch(/Array\.from\(\{ length: Hud\.BAR_ABILITY_SLOTS \}, \(\) => null\)/);
    expect(hudTs).not.toContain('fallbackForm');
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
    expect(hudTs).not.toContain("this.activeHotbarForm === 'cat_stealth') return 'cat_form'");
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
      'body.mobile-touch #bags {\n    position: fixed;\n    left: max(10px, env(safe-area-inset-left));\n    right: max(10px, env(safe-area-inset-right));\n    top: max(10px, env(safe-area-inset-top));\n    bottom: max(10px, env(safe-area-inset-bottom));\n    width: auto;\n    transform: none;',
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
    // The split point divides the shared --app-vw box by the live uiScale: #ui's
    // zoom multiplies author lengths, so a raw 50vw only tiles at scale 1 (the
    // halves gap above 1 and overlap below 1; the 2026-07-07 bank QA finding).
    expect(hudMobileCss).toContain(
      'body.mobile-touch.vendor-open #vendor-window {\n    left: max(10px, env(safe-area-inset-left));\n    right: calc(var(--app-vw) / var(--ui-scale, 1) / 2);',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.vendor-open #bags {\n    left: calc(var(--app-vw) / var(--ui-scale, 1) / 2);\n    right: max(10px, env(safe-area-inset-right));',
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
      'max-height: calc(\n        var(--app-vh) -\n        120px -\n        env(safe-area-inset-top) -\n        env(safe-area-inset-bottom)\n      );',
    );
  });

  it('anchors the landscape More tray above the fixed bottom control row, not screen-centered', () => {
    // The 4-row/16-pill grid centered on a short landscape viewport could grow
    // tall enough to overlap Autorun/Jump/the combat cluster, which reserve no
    // layout space of their own. !important beats the shared window-drag
    // freeze (hud.ts stamps an inline inset/transform the first time this
    // panel's .panel-title is pressed, same as any desktop window).
    expect(hudMobileCss).toContain(
      '--mobile-more-open-transform: translateX(-50%);\n      --mobile-more-closed-transform: translate(-50%, 10px) scale(0.96);',
    );
    expect(hudMobileCss).toContain(
      'top: max(8px, env(safe-area-inset-top)) !important;\n      bottom: auto !important;\n      transform: var(--mobile-more-closed-transform) !important;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch.mobile-more-open #mobile-extra-controls {\n      transform: var(--mobile-more-open-transform) !important;',
    );
  });

  it('seats the landscape map above controls with a side rail for zoom buttons', () => {
    // Same overlap class as the More tray: the base square map, vertically
    // centered, can dip into Jump/Interact on a short landscape phone. The
    // landscape rule top-anchors it, caps the drawn map against free height, and
    // adds a right-side rail so the zoom buttons do not cover the map canvas.
    expect(hudMobileCss).toContain(
      'body.mobile-touch #map-window {\n      --mobile-map-size: min(60vw, 420px, calc(var(--app-vh) - 104px));\n      --mobile-map-rail: 58px;',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #map-window #map-canvas {\n      width: var(--mobile-map-size);\n      max-width: calc(100% - var(--mobile-map-rail));',
    );
    expect(hudMobileCss).toContain(
      'body.mobile-touch #map-window #map-zoom {\n      right: 8px;\n      bottom: 8px;',
    );
  });

  it('stacks the mobile map below the quest log when both are open', () => {
    expect(hudTs).toContain("'mobile-map-quest-open'");
    expect(hudTs).toContain('this.isWindowVisible(mapWindow)');
    expect(hudTs).toContain('this.isWindowVisible(questLogWindow)');
    expect(hudMobileCss).toContain(
      '--mobile-map-quest-stack-top: max(10px, env(safe-area-inset-top));',
    );
    expect(hudMobileCss).toContain('body.mobile-touch.mobile-map-quest-open #quest-log-window');
    expect(hudMobileCss).toContain('top: var(--mobile-map-quest-stack-top);');
    expect(hudMobileCss).toContain('max-height: var(--mobile-map-quest-log-max-height);');
    expect(hudMobileCss).toContain('body.mobile-touch.mobile-map-quest-open #map-window');
    expect(hudMobileCss).toContain('var(--mobile-map-quest-stack-gap)');
    expect(hudMobileCss).toContain('22px');
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
  it('keeps desktop rolls above managed windows and the mobile bag sheet above rolls', () => {
    const railZ = Number(componentsCss.match(/#loot-rolls \{[\s\S]*?z-index:\s*(\d+);/)?.[1]);
    const managedFloors = [
      ...hudTs.matchAll(/(?:private windowZ =|this\.windowZ =)\s*(\d+);/g),
    ].map((match) => Number(match[1]));
    expect(Number.isFinite(railZ)).toBe(true);
    expect(managedFloors).toHaveLength(2); // initial value + normalization reset
    for (const floor of managedFloors) {
      // Desktop Bags shares the roll rail's bottom-right footprint, so the first
      // managed window must remain below it.
      expect(floor + 1, `first managed z-index overlaps loot rail ${railZ}`).toBeLessThan(railZ);
    }
    // On mobile Bags is a full-screen modal sheet. !important intentionally
    // beats the inline managed-window value without changing desktop stacking.
    expect(hudMobileCss).toMatch(/body\.mobile-touch #bags \{[\s\S]*?z-index:\s*95 !important;/);
  });
});
