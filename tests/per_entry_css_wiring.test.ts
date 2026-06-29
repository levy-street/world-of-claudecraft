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

  it('index.extra.css suppresses #rotate-device for web gameplay but allows native portrait', () => {
    expect(indexExtra).toMatch(/@layer index-extra\b/);
    expect(indexExtra).toMatch(
      /body\.mobile-touch\.game-active:not\(\.native-app\) #rotate-device\s*\{[^}]*display:\s*none\s*!important/,
    );
    expect(indexExtra).toMatch(
      /body\.native-app\.mobile-touch\.game-active #rotate-device\s*\{[^}]*display:\s*flex/,
    );
  });

  it('play.extra.css shows #rotate-device in portrait (play side of the gate)', () => {
    expect(playExtra).toMatch(/@layer play-extra\b/);
    expect(playExtra).toMatch(/orientation:\s*portrait/);
    expect(playExtra).toMatch(/#rotate-device\s*\{\s*display:\s*flex/);
  });

  it('the shared mobile layer carries no index-only #rotate-device suppress (no cross-entry leak)', () => {
    // The !important suppress lives ONLY in index.extra.css. If it were in the shared
    // hud.mobile.css it would leak onto play, where play.extra (a later layer) cannot
    // override an earlier-layer !important, breaking play's portrait rotate overlay.
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
