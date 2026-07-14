import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guard for the compact-mobile floating-combat-text change.
//
// On touch, hud.mobile.css shrinks the FCT numbers and shortens their rise (a
// COSMETIC richness tweak, never the number itself, so it stays within the
// graphics-settings fairness rule). Desktop hud.css MUST stay byte-identical:
// the mobile layer duplicates the keyframes with -mobile names and overrides
// only font-size + animation-name. This guard pins:
//   (a) the desktop hud.css values are unchanged,
//   (b) hud.mobile.css declares both -mobile keyframes with a strictly shorter
//       rise than desktop,
//   (c) the mobile .fct rules keep the --fct-scale hook,
//   (d) the low-fx mobile crit shed re-points at the non-crit mobile rise.
//
// File-based (read CSS, regex/flat-parse), following the
// tests/mobile_window_transform.test.ts idiom: no jsdom.
const HUD_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/hud.css', import.meta.url)),
  'utf8',
);
const HUD_MOBILE_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/hud.mobile.css', import.meta.url)),
  'utf8',
);

// Pull the `translate: ... calc(-50% - Npx)` travel magnitude out of a named
// @keyframes block's final (100% / to) step. Returns the px number.
function keyframeTravelPx(css: string, name: string): number {
  // Isolate the keyframes body up to the FIRST following @keyframes / @media or
  // end of file, then read the largest `- Npx` travel in it (the `to` step).
  const start = css.indexOf(`@keyframes ${name}`);
  expect(start, `@keyframes ${name} should exist`).toBeGreaterThanOrEqual(0);
  const rest = css.slice(start + `@keyframes ${name}`.length);
  const nextAt = rest.search(/@keyframes|@media/);
  const block = nextAt >= 0 ? rest.slice(0, nextAt) : rest;
  const travels = [...block.matchAll(/calc\(\s*-50%\s*-\s*(\d+)px\s*\)/g)].map((m) => Number(m[1]));
  expect(travels.length, `@keyframes ${name} should declare a translate travel`).toBeGreaterThan(0);
  return Math.max(...travels);
}

describe('desktop FCT css is unchanged (hud.css)', () => {
  it('keeps the fct-rise translate travel at -76px', () => {
    expect(keyframeTravelPx(HUD_CSS, 'fct-rise')).toBe(76);
  });

  it('keeps the fct-crit translate travel at -86px', () => {
    expect(keyframeTravelPx(HUD_CSS, 'fct-crit')).toBe(86);
  });

  it('keeps the .fct scaled base font-size at calc(17px * var(--fct-scale, 1))', () => {
    expect(HUD_CSS).toMatch(/\.fct\s*\{[^}]*font-size:\s*calc\(17px\s*\*\s*var\(--fct-scale/);
  });

  it('keeps the .fct.crit font-size at 26px', () => {
    // Both the bare 26px and the scaled calc(26px ...) declarations survive.
    expect(HUD_CSS).toMatch(/\.fct\.crit\s*\{[^}]*font-size:\s*26px/);
    expect(HUD_CSS).toMatch(/\.fct\.crit\s*\{[^}]*font-size:\s*calc\(26px\s*\*\s*var\(--fct-scale/);
  });

  it('keeps the .fct-xp / .fct-rested-xp desktop font-size at 20px, pointed at fct-xp-pop', () => {
    expect(HUD_CSS).toMatch(
      /\.fct-xp\s*\{[^}]*font-size:\s*calc\(20px\s*\*\s*var\(--fct-scale[^}]*animation-name:\s*fct-xp-pop\b/,
    );
    expect(HUD_CSS).toMatch(
      /\.fct-rested-xp\s*\{[^}]*font-size:\s*calc\(20px\s*\*\s*var\(--fct-scale[^}]*animation-name:\s*fct-xp-pop\b/,
    );
  });

  it('re-points the low-fx desktop xp/rested-xp at the non-crit rise (preserves the low-tier shed)', () => {
    const m = HUD_CSS.match(
      /:root\[data-fx-level="low"\]\s+\.fct-xp,\s*\n\s*:root\[data-fx-level="low"\]\s+\.fct-rested-xp\s*\{([^}]*)\}/,
    );
    expect(m, 'the low-fx desktop xp/rested-xp shed rule should exist').not.toBeNull();
    expect(m![1]).toMatch(/animation-name:\s*fct-rise\b/);
  });
});

describe('mobile FCT css (hud.mobile.css)', () => {
  it('declares both -mobile keyframes with a strictly shorter rise than desktop', () => {
    const riseMobile = keyframeTravelPx(HUD_MOBILE_CSS, 'fct-rise-mobile');
    const critMobile = keyframeTravelPx(HUD_MOBILE_CSS, 'fct-crit-mobile');
    // Strictly smaller in magnitude than the desktop pair (76 / 86).
    expect(riseMobile).toBeLessThan(keyframeTravelPx(HUD_CSS, 'fct-rise'));
    expect(critMobile).toBeLessThan(keyframeTravelPx(HUD_CSS, 'fct-crit'));
    // And the shipped values specifically.
    expect(riseMobile).toBe(56);
    expect(critMobile).toBe(62);
  });

  it('scales the mobile .fct and .fct.crit font-size by --fct-scale and swaps animation-name', () => {
    expect(HUD_MOBILE_CSS).toMatch(
      /body\.mobile-touch\s+\.fct\s*\{[^}]*font-size:\s*calc\(14px\s*\*\s*var\(--fct-scale[^}]*animation-name:\s*fct-rise-mobile/,
    );
    expect(HUD_MOBILE_CSS).toMatch(
      /body\.mobile-touch\s+\.fct\.crit\s*\{[^}]*font-size:\s*calc\(20px\s*\*\s*var\(--fct-scale[^}]*animation-name:\s*fct-crit-mobile/,
    );
  });

  it('re-points the low-fx mobile crit at the non-crit mobile rise (preserves the low-tier shed)', () => {
    const m = HUD_MOBILE_CSS.match(
      /:root\[data-fx-level="low"\]\s+body\.mobile-touch\s+\.fct\.crit\s*\{([^}]*)\}/,
    );
    expect(m, 'the low-fx mobile crit rule should exist').not.toBeNull();
    expect(m![1]).toMatch(/animation-name:\s*fct-rise-mobile/);
    // fct-rise-mobile is a non-crit keyframe (no scale pop), matching the desktop
    // low-tier shed that points at fct-rise.
    expect(m![1]).not.toMatch(/fct-crit-mobile/);
  });

  it('declares fct-xp-pop-mobile with a strictly shorter rise than desktop fct-xp-pop', () => {
    const xpMobile = keyframeTravelPx(HUD_MOBILE_CSS, 'fct-xp-pop-mobile');
    const xpDesktop = keyframeTravelPx(HUD_CSS, 'fct-xp-pop');
    expect(xpMobile).toBeLessThan(xpDesktop);
    expect(xpMobile).toBe(56);
  });

  it('scales the mobile .fct-xp / .fct-rested-xp font-size by --fct-scale and swaps animation-name', () => {
    expect(HUD_MOBILE_CSS).toMatch(
      /body\.mobile-touch\s+\.fct-xp,\s*\n\s*body\.mobile-touch\s+\.fct-rested-xp\s*\{[^}]*font-size:\s*calc\(17px\s*\*\s*var\(--fct-scale[^}]*animation-name:\s*fct-xp-pop-mobile/,
    );
  });

  it('re-points the low-fx mobile xp/rested-xp at the non-crit mobile rise (preserves the low-tier shed)', () => {
    const m = HUD_MOBILE_CSS.match(
      /:root\[data-fx-level="low"\]\s+body\.mobile-touch\s+\.fct-xp,\s*\n\s*:root\[data-fx-level="low"\]\s+body\.mobile-touch\s+\.fct-rested-xp\s*\{([^}]*)\}/,
    );
    expect(m, 'the low-fx mobile xp/rested-xp shed rule should exist').not.toBeNull();
    expect(m![1]).toMatch(/animation-name:\s*fct-rise-mobile/);
    expect(m![1]).not.toMatch(/fct-xp-pop-mobile/);
  });
});
