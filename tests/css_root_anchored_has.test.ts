// Guard: no `:has()` anchored on body, :root, html or #ui, and no root-level
// attribute selector on inline `style`.
//
// Why. Blink implements `:has()` invalidation by marking the ANCHOR's subtree: for
// a rule `A:has(ARG) B`, any DOM change inside A that could flip ARG schedules a
// :has pseudo-state invalidation on A, and the invalidation set attached to that
// state is the union, over every :has() rule in the document, of what follows
// the anchor. With ARG naming an inline `style` attribute or :hover/:focus and A
// being body or #ui, the `style` attribute of EVERY HUD element became a :has()
// feature of body, whose set is the whole subtree. The per-frame HUD contract is
// inline-style writes (setStyleProp, setDisplay, setWidth), so the first leaf
// write of a frame (a compass mark, the tutorial arrow, the minimap coordinates)
// made the browser re-resolve style for the entire visible HUD: about 580
// elements, 6.5 ms per frame on a 4-core Intel HD 530 (31 percent of the frame)
// and about 2.9 ms on a modern desktop iGPU. Deleting the five root-anchored
// rules took the local recalc from 2.85 to 0.21 ms per frame (2026-09-14).
//
// The rule, stated once (src/styles/CLAUDE.md carries it for authors): state that
// belongs to code becomes a state class toggled by the code that owns it, on the
// anchor the rule needs (src/ui/root_state_classes.ts). A :has() anchored on a
// WINDOW (`#bank-window:has(.bank-footer)`, `#quest-tracker:has(...)`) only
// invalidates inside that window and stays allowed; those rules (47 selectors
// when this guard was written) cost about 0.07 ms per frame together.
//
// The scan is a pure source read (no browser), over every sheet under src/styles
// at any depth: a miss here is a silent PASS, so depth is the safe direction, and
// the recursion is pinned by a fixture that drives this file's own reader.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHAT_COMPOSER_FOCUS_CLASS,
  CHAT_COMPOSER_HOVER_CLASS,
  DESKTOP_LOGIN_EXIT_SHOWN_CLASS,
  DEVOTION_LAST_CHARGE_CLASS,
  OPTIONS_OPEN_CLASS,
  START_SCREEN_OPEN_CLASS,
  TRADE_AND_BAGS_OPEN_CLASS,
} from '../src/ui/root_state_classes';
import { cssTreeUnder } from './helpers/css_tree_under';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

const STYLES_DIR = fileURLToPath(new URL('../src/styles/', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const REPO = fileURLToPath(new URL('../', import.meta.url));

const ROOT_ANCHORS = /^(body|:root|html|#ui)(?![\w-])/;

/** Every rule prelude (the text before a `{`) that is a selector list, at any nesting. */
function selectorPreludes(css: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of stripComments(css)) {
    if (ch === '{') {
      const prelude = buf.trim().replace(/\s+/g, ' ');
      if (prelude && !prelude.startsWith('@')) out.push(prelude);
      buf = '';
    } else if (ch === '}' || ch === ';') {
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

/** Split a selector list on the commas that sit outside parentheses. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The compound a `:has(` or `[style` is attached to: the LAST compound of the
 *  text before the needle (so `body > #ui:has(` and `html body:has(` are root
 *  anchored while `body.mobile-touch #bank-window:has(` is not), with its own
 *  parenthesised arguments removed so `body:not(.a .b)` still reads as one. */
function compoundBefore(selector: string, needle: string): string | null {
  const at = selector.indexOf(needle);
  if (at < 0) return null;
  let head = selector.slice(0, at);
  for (let prev = ''; prev !== head; ) {
    prev = head;
    head = head.replace(/\([^()]*\)/g, '');
  }
  const compounds = head.trim().split(/[\s>+~]+/);
  return compounds[compounds.length - 1] ?? '';
}

const rootAnchored = (compound: string | null): boolean =>
  compound !== null && ROOT_ANCHORS.test(compound);

interface RootAnchoredScan {
  /** Every selector containing `:has(`, whatever its anchor (the vacuity floor). */
  hasSelectors: number;
  /** `:has()` whose anchor compound is body, :root, html or #ui. */
  rootHas: string[];
  /** `[style...]` attribute selectors on a body, :root, html or #ui compound. */
  rootStyleAttr: string[];
}

function scanRootAnchored(css: string): RootAnchoredScan {
  const scan: RootAnchoredScan = { hasSelectors: 0, rootHas: [], rootStyleAttr: [] };
  for (const prelude of selectorPreludes(css)) {
    for (const selector of splitSelectors(prelude)) {
      if (selector.includes(':has(')) {
        scan.hasSelectors += 1;
        if (rootAnchored(compoundBefore(selector, ':has('))) scan.rootHas.push(selector);
      }
      // A `[style` inside a :has() argument belongs to the :has() finding above;
      // this one is the attribute sitting directly on the root compound.
      const styleAt = selector.indexOf('[style');
      const hasAt = selector.indexOf(':has(');
      if (styleAt >= 0 && (hasAt < 0 || hasAt > styleAt)) {
        if (rootAnchored(compoundBefore(selector, '[style'))) scan.rootStyleAttr.push(selector);
      }
    }
  }
  return scan;
}

function scanTree(root: string): { file: string; scan: RootAnchoredScan }[] {
  return cssTreeUnder(root).files.map(({ file, full }) => ({
    file,
    scan: scanRootAnchored(readFileSync(full, 'utf8')),
  }));
}

describe('root-anchored :has() guard (src/styles)', () => {
  const sheets = scanTree(STYLES_DIR);

  it('anchors no :has() on body, :root, html or #ui', () => {
    const offenders = sheets.flatMap(({ file, scan }) =>
      scan.rootHas.map((selector) => `${file}: ${selector}`),
    );
    expect(
      offenders,
      'a :has() anchored on a root makes every HUD write re-resolve the whole HUD: ' +
        'toggle a state class from the code that owns the state instead ' +
        '(src/ui/root_state_classes.ts)',
    ).toEqual([]);
  });

  it('keys no root compound on an inline style attribute', () => {
    const offenders = sheets.flatMap(({ file, scan }) =>
      scan.rootStyleAttr.map((selector) => `${file}: ${selector}`),
    );
    expect(offenders).toEqual([]);
  });

  it('still sees the window-anchored :has() rules it deliberately allows', () => {
    // Vacuity floor near the real count (47 selectors across five sheets when
    // written): a sheet leaving the scan (renamed, moved, a walker regression)
    // must fail here, so the floor sits within a single sheet's share of the count.
    const total = sheets.reduce((n, { scan }) => n + scan.hasSelectors, 0);
    expect(total).toBeGreaterThanOrEqual(45);
  });

  it('reads every sheet through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['css_tree_under', 'ts_files_under']);
  });

  it('classifies the anchor, not the mere presence of a root in the selector', () => {
    const css = `
      @layer components {
        body:has(#start-screen:not([style*="display: none"])) #ui { display: none; }
        #ui:has(> #options-menu[style*="display: flex"])::before,
        #ui:has(> #options-menu[style*="display: block"])::before { display: block; }
        body.mobile-touch:has(#a[data-open="1"]):has(#b[data-open="1"]) #a { left: 0; }
        :root:has(.x) .y { color: red; }
        html:has(.x) { color: red; }
        body:not(.mobile-touch):has(.x) .y { color: red; }
        @media (min-width: 1px) {
          body.desktop-app:has(.exit:not([hidden])) .header { row-gap: 1px; }
        }
        body[style*="cursor"] .z { color: red; }
        #ui[style] .z { color: red; }
        body > #ui:has(> #options-menu[style*="display: block"])::before { display: block; }
        html body:has(.x) .y { color: red; }
        body.desktop-app #ui:has(.x) { color: red; }
        body.desktop-app #ui[style*="x"] .z { color: red; }
      }
      body.mobile-touch #bank-window:has(.bank-footer) .bank-scroll { top: 0; }
      body:not(.mobile-touch) #map-window:has(> .sidebar:empty) { width: 0; }
      #options-menu:has(> .audio-options) { width: 0; }
      .set-row:has(.set-slider) { gap: 0; }
      body.start-screen-open #ui { display: none; }
      #bodyguard:has(.x) { color: red; }
      .bodyless:has(.x) { color: red; }
      #ui-frame:has(.x) { color: red; }
      #trade-window[style*="left"] { color: red; }
    `;
    const scan = scanRootAnchored(css);
    expect(scan.rootHas).toEqual([
      'body:has(#start-screen:not([style*="display: none"])) #ui',
      '#ui:has(> #options-menu[style*="display: flex"])::before',
      '#ui:has(> #options-menu[style*="display: block"])::before',
      'body.mobile-touch:has(#a[data-open="1"]):has(#b[data-open="1"]) #a',
      ':root:has(.x) .y',
      'html:has(.x)',
      'body:not(.mobile-touch):has(.x) .y',
      'body.desktop-app:has(.exit:not([hidden])) .header',
      'body > #ui:has(> #options-menu[style*="display: block"])::before',
      'html body:has(.x) .y',
      'body.desktop-app #ui:has(.x)',
    ]);
    expect(scan.rootStyleAttr).toEqual([
      'body[style*="cursor"] .z',
      '#ui[style] .z',
      'body.desktop-app #ui[style*="x"] .z',
    ]);
    expect(scan.hasSelectors).toBe(18);
  });

  it("scans a stylesheet in a SUBDIRECTORY, through this guard's own reader", () => {
    const root = mkdtempSync(path.join(tmpdir(), 'woc-root-has-guard-'));
    try {
      mkdirSync(path.join(root, 'nested', 'deeper'), { recursive: true });
      writeFileSync(path.join(root, 'clean.css'), '#bank-window:has(.f) { top: 0; }\n');
      writeFileSync(
        path.join(root, 'nested', 'deeper', 'dirty.css'),
        'body:has(.x) #ui { display: none; }\n',
      );
      const found = scanTree(root);
      expect(found.map((f) => f.file)).toEqual(['clean.css', 'nested/deeper/dirty.css']);
      expect(found.flatMap((f) => f.scan.rootHas)).toEqual(['body:has(.x) #ui']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the state classes that replaced the root-anchored rules', () => {
  const sheet = (name: string): string =>
    stripComments(readFileSync(path.join(STYLES_DIR, name), 'utf8')).replace(/\s+/g, ' ');
  const source = (rel: string): string => stripComments(readFileSync(path.join(REPO, rel), 'utf8'));

  it('each class name is read by the rule that replaced the :has()', () => {
    // Selector and constant pinned together: renaming either side alone would
    // silently drop the behaviour (the start screen no longer hiding #ui, the
    // options scrim never showing, the split dock never splitting).
    const base = sheet('base.css');
    expect(base).toContain(`body.${START_SCREEN_OPEN_CLASS} #ui { display: none !important; }`);
    expect(base).toContain(`body.${START_SCREEN_OPEN_CLASS} .hud-skip { display: none; }`);
    expect(sheet('components.css')).toContain(
      `#ui.${OPTIONS_OPEN_CLASS}::before { display: block; }`,
    );
    const hud = sheet('hud.css');
    expect(hud).toMatch(
      new RegExp(`body\\.${DEVOTION_LAST_CHARGE_CLASS} \\.action-btn\\.empowered \\{[^}]*filter`),
    );
    expect(hud).toContain(`#chatlog-wrap.${CHAT_COMPOSER_HOVER_CLASS} #chatlog-frame,`);
    expect(hud).toMatch(
      new RegExp(
        `#chatlog-wrap\\.${CHAT_COMPOSER_FOCUS_CLASS} #chatlog-frame \\{ --chat-soft: 1; \\}`,
      ),
    );
    const mobile = sheet('hud.mobile.css');
    expect(mobile).toContain(
      `body.mobile-touch.${DEVOTION_LAST_CHARGE_CLASS} #mobile-action-ring button.empowered {`,
    );
    expect(mobile).toContain(`body.mobile-touch.${TRADE_AND_BAGS_OPEN_CLASS} #ui #trade-window,`);
    expect(mobile).toContain(`body.mobile-touch.${TRADE_AND_BAGS_OPEN_CLASS} #ui #bags {`);
    const shell = sheet('shell.css');
    expect(shell).toContain(
      `body.desktop-app.${DESKTOP_LOGIN_EXIT_SHOWN_CLASS} .homepage-header {`,
    );
    expect(shell).toContain(`body.desktop-app.${DESKTOP_LOGIN_EXIT_SHOWN_CLASS} .header-actions {`);
  });

  it('the start screen class ships in both entries and drops with the start screen', () => {
    // The HTML carries it so #ui is hidden before any script runs, exactly as the
    // old rule matched a #start-screen with no inline display; the one place that
    // hides the start screen drops the class in the same statement group.
    for (const entry of ['index.html', 'play.html']) {
      const html = readFileSync(path.join(REPO, entry), 'utf8');
      expect(html).toMatch(new RegExp(`<body class="[^"]*\\b${START_SCREEN_OPEN_CLASS}\\b`));
      expect(html.match(/<main id="start-screen"/g)).toHaveLength(1);
      expect(html).not.toMatch(/<main id="start-screen"[^>]*style=/);
    }
    const main = source('src/main.ts');
    expect(main).toContain(
      "document.body.classList.remove(START_SCREEN_OPEN_CLASS);\n  $('#start-screen').style.display = 'none';",
    );
    // No other writer of #start-screen's display or presence exists anywhere
    // under src (any spelling of the lookup), so the class has exactly one drop
    // site and cannot be left behind by a second hide path.
    const hides = tsFilesUnder(SRC_DIR).flatMap(({ file, full }) => {
      const code = stripComments(readFileSync(full, 'utf8'));
      const hits = code.match(
        /start-screen['"][^\n]*\.(style\.display\s*=|remove\(\)|hidden\s*=)/g,
      );
      return hits ? hits.map((hit) => `${file}: ${hit}`) : [];
    });
    expect(hides).toEqual(["main.ts: start-screen').style.display ="]);
  });

  it('each other class is toggled by the code that owns the state', () => {
    expect(source('src/ui/window_open_state.ts')).toContain(
      'classList.toggle(OPTIONS_OPEN_CLASS, !!optionsMenu && isWindowVisible(optionsMenu))',
    );
    expect(source('src/ui/window_open_state.ts')).toContain(
      "TRADE_AND_BAGS_OPEN_CLASS,\n    windowOpenMarked('trade-window') && windowOpenMarked('bags')",
    );
    expect(source('src/ui/paladin_devotion_painter.ts')).toContain(
      'this.writers.toggleClass(this.body, DEVOTION_LAST_CHARGE_CLASS, state.lastCharge)',
    );
    const chat = source('src/ui/chat_composer_focus_controller.ts');
    expect(chat).toMatch(
      /input\.addEventListener\('mouseenter', \(\) =>\s*wrap\?\.classList\.toggle\(CHAT_COMPOSER_HOVER_CLASS, true\)/,
    );
    expect(chat).toMatch(
      /input\.addEventListener\('mouseleave', \(\) =>\s*wrap\?\.classList\.toggle\(CHAT_COMPOSER_HOVER_CLASS, false\)/,
    );
    expect(chat).toContain('wrap?.classList.toggle(CHAT_COMPOSER_FOCUS_CLASS, true)');
    expect(chat).toContain('wrap?.classList.toggle(CHAT_COMPOSER_FOCUS_CLASS, false)');
    expect(chat).not.toMatch(/classList\.(add|remove)\(/);
    expect(source('src/main.ts')).toContain('bindChatComposerFocusState(chatInput, {');
    expect(source('src/game/desktop_login_exit.ts')).toContain(
      'root.body?.classList.toggle(DESKTOP_LOGIN_EXIT_SHOWN_CLASS, shown)',
    );
  });

  it('the per-frame same-value class writes use toggle with a force flag', () => {
    // DOMTokenList.add/remove rewrite the class attribute even when the token is
    // already in the requested state (a MutationRecord per frame for the HUD's
    // window observer); toggle(token, force) returns without a write.
    const stance = source('src/ui/hud/stance/stance_bar_controller.ts');
    expect(stance).toContain('document.body.classList.toggle(SHOWN_BODY_CLASS, false)');
    expect(stance).toContain('document.body.classList.toggle(SHOWN_BODY_CLASS, true)');
    expect(stance).not.toMatch(/classList\.(add|remove)\(SHOWN_BODY_CLASS/);
    const marker = source('src/game/click_move_marker.ts');
    expect(marker).not.toMatch(/cls\.(add|remove)\('(active|entity|blocked)'/);
    // The pulse restart is the one sanctioned add/remove pair.
    expect(marker.match(/cls\.(add|remove)\('pulse'\)/g)).toHaveLength(2);
    const main = source('src/main.ts');
    expect(main.match(/paintClickMoveMarker\(clickMoveMarker, /g)).toHaveLength(3);
    expect(main).not.toMatch(/clickMoveMarker\.classList\./);
  });

  it('the tutorial arrow sheet pins left and top at 0, which its single transform relies on', () => {
    // src/ui/tutorial.ts positions the arrow with translate(x, y) alone; the old
    // left/top writes are reproduced only because the sheet zeroes both.
    const block = sheet('hud.css').match(/\.tut-arrow \{([^}]*)\}/)?.[1] ?? '';
    expect(block).toContain('position: absolute;');
    expect(block).toContain('left: 0;');
    expect(block).toContain('top: 0;');
  });
});
