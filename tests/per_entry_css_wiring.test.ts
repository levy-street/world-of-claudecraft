// Guards the one non-mechanical part of the CSS extraction: the per-entry CSS wiring
// and the #rotate-device orientation gate (in-game landscape-only). After the
// extraction both inline <style> blocks are empty and the game CSS lives in the shared
// src/styles/* @layer modules (loaded by both entries via the src/main.ts barrel),
// EXCEPT the #rotate-device gate which differs per entry: index suppresses the
// rotate overlay in browser web gameplay but lets the native app show it in portrait,
// while play shows it in portrait. Each entry loads ONLY its own per-entry .extra via
// a <link>.
//
// css_corpus is blind to this (it tests inline UNION modules, so empty-inline +
// modules passes regardless) and client_shell asserts hud.mobile.css CONTENT but
// not the wiring. A dropped <link>, the index suppress leaking into the shared
// barrel, or play.html re-loading index.extra would all stay green without this.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) =>
  readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const indexHtml = read('../index.html');
const playHtml = read('../play.html');
const indexExtra = read('../src/styles/index.extra.css');
const playExtra = read('../src/styles/play.extra.css');
const hudMobile = read('../src/styles/hud.mobile.css');
const barrel = read('../src/styles/index.css');

// The concatenated inline <style> CSS of an entry, with comments stripped.
function inlineStyleBody(html: string): string {
  let css = '';
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) css += `\n${m[1]}`;
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('per-entry CSS wiring + #rotate-device gate', () => {
  it('both inline <style> blocks are empty (comment-only, zero CSS rules)', () => {
    // No selector block (`{`) survives once the explanatory comment is stripped.
    expect(inlineStyleBody(indexHtml)).not.toContain('{');
    expect(inlineStyleBody(playHtml)).not.toContain('{');
  });

  it('index.html links its own index.extra.css and NOT play.extra.css', () => {
    expect(indexHtml).toMatch(/<link[^>]+href="\/src\/styles\/index\.extra\.css"/);
    expect(indexHtml).not.toContain('play.extra.css');
  });

  it('play.html links its own play.extra.css and NOT index.extra.css', () => {
    expect(playHtml).toMatch(/<link[^>]+href="\/src\/styles\/play\.extra\.css"/);
    expect(playHtml).not.toContain('index.extra.css');
  });

  it('index.extra.css shows #rotate-device in portrait gameplay', () => {
    expect(indexExtra).toMatch(/@layer index-extra\b/);
    expect(indexExtra).toMatch(/orientation:\s*portrait/);
    expect(indexExtra).toMatch(
      /body\.mobile-touch\.game-active #rotate-device\s*\{[^}]*display:\s*flex/,
    );
    expect(indexExtra).not.toMatch(/#rotate-device[^}]*display:\s*none\s*!important/);
  });

  it('play.extra.css shows #rotate-device in portrait (play side of the gate)', () => {
    expect(playExtra).toMatch(/@layer play-extra\b/);
    expect(playExtra).toMatch(/orientation:\s*portrait/);
    expect(playExtra).toMatch(/#rotate-device\s*\{\s*display:\s*flex/);
  });

  it('the shared mobile layer carries no #rotate-device suppress', () => {
    expect(hudMobile).not.toMatch(/#rotate-device[^}]*display:\s*none\s*!important/);
  });

  it('the barrel AND both .extra files re-declare the identical FLAT @layer order (hud-mobile after shell)', () => {
    // The .extra files re-declare the @layer order up front (idempotent with the barrel)
    // so the per-entry slot resolves regardless of sheet parse order. All three MUST carry
    // the SAME flat declaration: a divergent order in a .extra file would place its layer in
    // a different cascade slot. A dotted name (e.g. "hud.mobile") would be a SUBLAYER of the
    // early "hud" layer and lose to shell, the exact trap fixed here.
    const ORDER =
      '@layer tokens, base, layout, components, hud, shell, hud-mobile, index-extra, play-extra;';
    for (const [name, css] of [
      ['barrel', barrel],
      ['index.extra.css', indexExtra],
      ['play.extra.css', playExtra],
    ] as const) {
      expect(css, `${name} must declare the canonical flat @layer order`).toContain(ORDER);
      expect(css, `${name} must not regress to a dotted hud.mobile sublayer`).not.toContain(
        'hud.mobile,',
      );
      expect(css, `${name} must not regress to a dotted index.extra sublayer`).not.toContain(
        'index.extra,',
      );
      expect(css, `${name} must not regress to a dotted play.extra sublayer`).not.toContain(
        'play.extra,',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The in-game HUD subtree (#ui) must carry the SAME element ids in both game
// entries, because both are bootstrapped by the one src/main.ts and dressed by the
// one shared style barrel. The pre-game shell around it is legitimately different
// (index.html owns the marketing landing, the account panels and offline character
// creation; play.html owns none of it), so the parity claim is scoped to #ui.
//
// This exists because it was missed for real: the #aura-stack wrapper that now owns
// the buff/debuff strips' positioning was added to index.html only. On /play both
// strips fell back to static flow, since the positioning had moved off #buff-bar and
// #debuff-bar onto the wrapper. Nothing caught it: css_corpus tests inline UNION
// modules, mobile_window_coverage scrapes .window ids (a bare layout div is not one),
// and styles_extraction only pins the barrel's @import set. A structural id diff is
// what closes that gap, and it holds for any future HUD element, not just this one.
// ---------------------------------------------------------------------------
describe('game entry HUD parity', () => {
  // Ids that legitimately live in only ONE entry's #ui. Keep this list tiny and
  // justified: every entry here is a HUD element one game entry deliberately lacks.
  const UI_ID_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
    [
      'mobile-chat-reply',
      'play.html only: the mobile chat launcher button, whose body.mobile-chat-reply ' +
        'state main.ts drives for the touch shell that /play serves.',
    ],
  ]);

  /** The ids inside the `<div id="ui">` subtree, found by walking div depth from it. */
  function hudIds(html: string, entry: string): Set<string> {
    const start = html.indexOf('<div id="ui"');
    expect(start, `${entry} must contain the #ui HUD root`).toBeGreaterThanOrEqual(0);
    const tag = /<(\/?)div\b[^>]*?(\/?)>/g;
    tag.lastIndex = start;
    let depth = 0;
    let end = -1;
    let m: RegExpExecArray | null = tag.exec(html);
    while (m) {
      // A self-closing <div/> opens and closes in one tag, so it never moves depth.
      if (m[2] !== '/') {
        depth += m[1] === '/' ? -1 : 1;
        if (depth === 0) {
          end = m.index + m[0].length;
          break;
        }
      }
      m = tag.exec(html);
    }
    expect(end, `${entry}'s #ui subtree must be balanced`).toBeGreaterThan(start);
    return new Set([...html.slice(start, end).matchAll(/id="([^"]+)"/g)].map((x) => x[1]));
  }

  it('index.html and play.html declare the same #ui element ids', () => {
    const inIndex = hudIds(indexHtml, 'index.html');
    const inPlay = hudIds(playHtml, 'play.html');
    // Sanity floor: a broken slice that found almost nothing must not pass vacuously.
    expect(inIndex.size).toBeGreaterThan(100);
    expect(inPlay.size).toBeGreaterThan(100);

    const onlyIndex = [...inIndex].filter((id) => !inPlay.has(id) && !UI_ID_EXCEPTIONS.has(id));
    const onlyPlay = [...inPlay].filter((id) => !inIndex.has(id) && !UI_ID_EXCEPTIONS.has(id));
    expect(onlyIndex, 'HUD ids present in index.html but missing from play.html').toEqual([]);
    expect(onlyPlay, 'HUD ids present in play.html but missing from index.html').toEqual([]);
  });

  it('every exception is really one-sided, so the list cannot rot into a blanket waiver', () => {
    const inIndex = hudIds(indexHtml, 'index.html');
    const inPlay = hudIds(playHtml, 'play.html');
    for (const [id, why] of UI_ID_EXCEPTIONS) {
      expect(why.length, `${id} needs a real justification`).toBeGreaterThan(20);
      // An id that has since landed in BOTH entries no longer needs a waiver; leaving it
      // here would silently excuse it from the parity check if one side later dropped it.
      expect(
        inIndex.has(id) !== inPlay.has(id),
        `${id} is in both entries now; drop it from UI_ID_EXCEPTIONS`,
      ).toBe(true);
    }
  });

  it('the aura strips are wrapped in #aura-stack in BOTH entries', () => {
    // The specific regression above, pinned directly: the wrapper owns the strips'
    // positioning, so a bare pair of bars in either entry is the broken layout.
    for (const [entry, html] of [
      ['index.html', indexHtml],
      ['play.html', playHtml],
    ] as const) {
      expect(html, `${entry} must wrap the aura strips`).toMatch(
        /<div id="aura-stack">\s*<div id="buff-bar"><\/div>\s*<div id="debuff-bar"><\/div>\s*<\/div>/,
      );
    }
  });
});
