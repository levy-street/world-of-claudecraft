import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression guard for the mobile character-window clipping bug.
//
// The base `.window` rule centers every window with `left: 50%` +
// `transform: translateX(-50%)`. A `body.mobile-touch` rule that re-pins a
// window to one side (sets `left` to a fixed value, leaving `right` open) MUST
// also re-declare `transform`. Otherwise the inherited `translateX(-50%)`
// shifts the left-pinned window half its own width off the left edge of the
// screen. That was the #char-window bug: `left: 10px` on a 360px window landed
// the box at roughly -170px, clipping the equipment column and title.
//
// Both-sides-pinned windows (left AND right set, e.g. #social-window,
// #report-window) are a different, stretched layout and are out of scope here.
//
// The HUD chrome ships in two build entries (`index.html` at `/` and `play.html`
// at `/play`, vite.config.ts). Both load the shared style modules through the
// src/styles/index.css barrel, so the guard runs over BOTH entries: a fix or a
// regression in one must not silently diverge from the other.
const HTML_ENTRIES = ['../index.html', '../play.html'];

// The shared style modules each entry loads via the barrel. The CSS extraction moved the
// base chrome (base.css), the .window shell (layout.css), the HUD chrome (hud.css)
// and the feature-window bodies (components.css) out of the inline <style>, so the
// `.window` base rule this guard checks now lives in layout.css for index.html (play
// still carries an inline copy for now). The effective stylesheet for an entry is
// its inline <style> UNION these modules, so the guard reads both.
const STYLE_MODULES = [
  '../src/styles/base.css',
  '../src/styles/layout.css',
  '../src/styles/hud.css',
  '../src/styles/components.css',
  '../src/styles/hud.mobile.css',
];

// Strip CSS/HTML comments so they can't bleed into a rule's selector text (the flat
// brace scan below treats everything between `}` and `{` as selector). The modules
// wrap their rules in a single `@layer name { ... }`; unwrap it (drop the opening
// `@layer name {` and the file's final `}`) so the rules sit at top level, exactly as
// the flattened cascade sees them, and the flat brace scan reads them like inline CSS.
function loadHtml(relPath: string): string {
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  const html = stripComments(
    readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8'),
  );
  const modules = STYLE_MODULES.map((p) =>
    stripComments(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'))
      .replace(/@layer[^{]*\{/, '')
      .replace(/\}\s*$/, ''),
  ).join('\n');
  return `${html}\n${modules}`;
}

// Split the stylesheet into `selector { body }` blocks. The HUD CSS has no
// nested at-rules inside these declaration blocks, so a flat brace scan is
// sufficient and avoids pulling in a CSS-parser dependency.
function cssRules(source: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m = re.exec(source);
  while (m !== null) {
    rules.push({ selector: m[1].trim(), body: m[2] });
    m = re.exec(source);
  }
  return rules;
}

function value(body: string, prop: string): string | null {
  const m = body.match(
    new RegExp(`(?:^|;|\\{)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:!important)?\\s*;`, 'm'),
  );
  return m ? m[1].trim() : null;
}

// A selector group is "base mobile-touch state" when at least one of its
// comma-separated selectors targets a window id through exactly the
// `body.mobile-touch` state, with no extra state class (e.g. `.vendor-open`,
// `.mobile-left-handed`) that only applies transiently.
function baseMobileWindowIds(selector: string, windowIds: string[]): string[] {
  const ids: string[] = [];
  for (const sel of selector.split(',').map((s) => s.trim())) {
    const bodyPart = sel.split(/\s+/)[0]; // the `body...` compound, before the descendant id
    if (bodyPart !== 'body.mobile-touch') continue;
    for (const id of windowIds) {
      // Only when the id is the targeted element itself, not a descendant
      // (e.g. `#report-window select` styles a child, not the window box).
      if (new RegExp(`#${id}(?:\\s*$|[.:])`).test(sel)) ids.push(id);
    }
  }
  return ids;
}

// Per-entry analysis: scrape the `.window` ids from the markup, then merge the
// base-mobile-state positioning declarations per id.
function analyze(html: string) {
  const windowIds = [...html.matchAll(/id="([a-z0-9-]+)"\s+class="[^"]*\bwindow\b[^"]*"/g)].map(
    (m) => m[1],
  );
  const rules = cssRules(html);
  const merged = new Map<
    string,
    { left: string | null; right: string | null; transform: string | null }
  >();
  for (const id of windowIds) merged.set(id, { left: null, right: null, transform: null });
  for (const rule of rules) {
    for (const id of baseMobileWindowIds(rule.selector, windowIds)) {
      const acc = merged.get(id)!;
      acc.left = value(rule.body, 'left') ?? acc.left;
      acc.right = value(rule.body, 'right') ?? acc.right;
      acc.transform = value(rule.body, 'transform') ?? acc.transform;
    }
  }
  return { rules, merged };
}

describe.each(HTML_ENTRIES)('mobile window positioning (%s)', (entry) => {
  const { rules, merged } = analyze(loadHtml(entry));

  it('centers .window by default with a translate transform', () => {
    const base = rules.find((r) => r.selector === '.window');
    expect(base, 'base .window rule should exist').toBeDefined();
    expect(base!.body).toMatch(/transform\s*:\s*translateX\(-50%\)/);
  });

  it('left-pinned mobile windows reset the inherited centering transform', () => {
    const offenders: string[] = [];
    for (const [id, m] of merged) {
      const leftPinned = m.left !== null && m.left !== '50%' && m.left !== 'auto';
      const rightOpen = m.right === null || m.right === 'auto';
      if (leftPinned && rightOpen && m.transform === null)
        offenders.push(`#${id} (left: ${m.left})`);
    }
    expect(
      offenders,
      'these left-pinned mobile-touch windows do not reset the centering transform, ' +
        `so translateX(-50%) shifts them off the left edge:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

// Phase 4: the modal backdrop (#mobile-window-backdrop). A static element in
// both HTML entries, hidden by default / on desktop, shown as a full-screen dim
// layer only under body.mobile-touch.mobile-window-open.
describe.each(HTML_ENTRIES)('mobile window backdrop (%s)', (entry) => {
  const html = readFileSync(fileURLToPath(new URL(entry, import.meta.url)), 'utf8');
  const source = loadHtml(entry);
  const rules = cssRules(source);

  it('ships a static #mobile-window-backdrop element with aria-hidden', () => {
    expect(html).toMatch(/<div id="mobile-window-backdrop" aria-hidden="true"><\/div>/);
  });

  it('is hidden by default (no body.mobile-touch requirement)', () => {
    const hidden = rules.find((r) => r.selector === '#mobile-window-backdrop');
    expect(
      hidden,
      'a bare #mobile-window-backdrop { display: none } rule should exist',
    ).toBeDefined();
    expect(value(hidden!.body, 'display')).toBe('none');
  });

  it('shows as a full-screen layer only under body.mobile-touch.mobile-window-open', () => {
    const shown = rules.find(
      (r) => r.selector === 'body.mobile-touch.mobile-window-open #mobile-window-backdrop',
    );
    expect(shown, 'the mobile-window-open show rule should exist').toBeDefined();
    expect(value(shown!.body, 'display')).toBe('block');
    expect(value(shown!.body, 'pointer-events')).toBe('auto');
    // Never gated on a bare body.mobile-window-open (desktop can also carry that
    // class); the selector must require body.mobile-touch too.
    const desktopOnly = rules.find(
      (r) => r.selector === 'body.mobile-window-open #mobile-window-backdrop',
    );
    expect(desktopOnly, 'the backdrop must not show without body.mobile-touch').toBeUndefined();
  });

  it('sits above the base HUD chrome but below an open .window (z-index 85 < 90)', () => {
    const shown = rules.find(
      (r) => r.selector === 'body.mobile-touch.mobile-window-open #mobile-window-backdrop',
    );
    const z = Number(value(shown!.body, 'z-index'));
    const uiOpenRule = rules.find((r) => r.selector === 'body.mobile-touch.mobile-window-open #ui');
    const uiOpenZ = Number(value(uiOpenRule!.body, 'z-index'));
    expect(z).toBeLessThan(uiOpenZ);
  });
});
