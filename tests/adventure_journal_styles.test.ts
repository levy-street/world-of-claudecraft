// The Adventure Journal's stylesheet contract (src/styles/hud.css and
// hud.mobile.css, the #adventure-journal-window sections): a scale-aware
// bounded scroll region on desktop and phone, the phone's drawer list with
// 40px targets, an explicit tokenized focus ring on every control, posters
// that are never cropped, role colours from tokens, a palette with no raw
// colour, and the old party-frames guide button gone for good.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const desktopCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? '';
}

/** Every rule whose selector names the journal (or its target-frame book). */
function journalRules(css: string): string {
  return [...css.matchAll(/([^{}]*(?:#adventure-journal-window|#tf-journal)[^{}]*)\{([^}]*)\}/g)]
    .map((m) => m[2])
    .join('\n');
}

describe('Adventure Journal styles', () => {
  it('gives the journal a scale-aware bounded keyboard and pointer scroll region', () => {
    const windowRule = rule(desktopCss, '#adventure-journal-window');
    expect(windowRule).toContain('var(--app-vh, 100vh)');
    expect(windowRule).toContain('/ var(--window-scale, 1)');
    const shell = rule(desktopCss, '#adventure-journal-window .rbg-shell');
    expect(shell).toContain('var(--app-vh, 100vh)');
    expect(shell).toContain('/ var(--window-scale, 1)');
    expect(shell).toMatch(/grid-template-columns:\s*256px minmax\(0, 1fr\)/);
    const journal = rule(desktopCss, '#adventure-journal-window .rbg-journal');
    expect(journal).toMatch(/min-height:\s*0/);
    expect(journal).toMatch(/overflow-y:\s*auto/);
    expect(rule(desktopCss, '#adventure-journal-window .aj-nav')).toMatch(/overflow-y:\s*auto/);
  });

  it('turns the list into a drawer on a phone, with Browse and 40px targets', () => {
    const windowRule = rule(mobileCss, 'body.mobile-touch #adventure-journal-window');
    expect(windowRule).toMatch(/safe-area-inset-left/);
    expect(windowRule).toMatch(/safe-area-inset-right/);
    expect(windowRule).toMatch(/safe-area-inset-bottom/);
    expect(windowRule).toMatch(/transform:\s*none/);
    expect(rule(desktopCss, '#adventure-journal-window .aj-browse')).toMatch(/display:\s*none/);
    expect(rule(mobileCss, 'body.mobile-touch #adventure-journal-window .aj-browse')).toMatch(
      /display:\s*inline-flex/,
    );
    const drawer = rule(mobileCss, 'body.mobile-touch #adventure-journal-window .aj-nav');
    expect(drawer).toMatch(/position:\s*absolute/);
    expect(drawer).toMatch(/visibility:\s*hidden/);
    expect(drawer).toContain('var(--motion-scale)');
    expect(
      rule(mobileCss, 'body.mobile-touch #adventure-journal-window .aj-shell.aj-nav-open .aj-nav'),
    ).toMatch(/visibility:\s*visible/);
    expect(
      rule(mobileCss, 'body.mobile-touch #adventure-journal-window .rbg-segmented button'),
    ).toMatch(/min-height:\s*40px/);
    expect(rule(mobileCss, 'body.mobile-touch #adventure-journal-window .aj-tab')).toMatch(
      /min-height:\s*40px/,
    );
    expect(rule(mobileCss, 'body.mobile-touch #adventure-journal-window .aj-step')).toMatch(
      /height:\s*40px/,
    );
  });

  it('draws an explicit tokenized focus ring on every journal control', () => {
    for (const selector of [
      '#adventure-journal-window .aj-boss:focus-visible',
      '#adventure-journal-window .aj-instance-toggle:focus-visible',
      '#adventure-journal-window .aj-tab:focus-visible',
      '#adventure-journal-window .aj-step:focus-visible',
      '#adventure-journal-window .aj-browse:focus-visible',
      '#adventure-journal-window .aj-phase-toggle:focus-visible',
      '#adventure-journal-window .aj-watch-link:focus-visible',
      '#adventure-journal-window .aj-soon-tier:focus-visible',
      '#adventure-journal-window .aj-loot-row:focus-visible',
      '#tf-journal:focus-visible',
      '#adventure-journal-window .rbg-segmented button:focus-visible',
      '#adventure-journal-window .rbg-model-load:focus-visible',
    ]) {
      expect(desktopCss).toContain(selector);
    }
    expect(desktopCss).toMatch(/outline:\s*2px solid var\(--color-border-focus\)/);
  });

  it('contains boss posters instead of cropping their silhouettes', () => {
    expect(rule(desktopCss, '#adventure-journal-window .aj-boss-portrait img')).toMatch(
      /object-fit:\s*contain/,
    );
    expect(rule(desktopCss, '#adventure-journal-window .rbg-model-poster')).toMatch(
      /object-fit:\s*contain/,
    );
  });

  it('shows the target-frame book only while the target has a page, with a 40px hit area', () => {
    expect(rule(desktopCss, '#tf-journal')).toMatch(/display:\s*none/);
    expect(rule(desktopCss, '#target-frame.has-journal #tf-journal')).toMatch(
      /display:\s*inline-flex/,
    );
    expect(rule(desktopCss, '#tf-journal::after')).toMatch(/inset:\s*-8px/);
  });

  it('color codes role icon backgrounds from tokens', () => {
    expect(rule(desktopCss, '#adventure-journal-window .rbg-badge-tank')).toMatch(
      /background:\s*var\(--color-rbg-role-tank-bg\)/,
    );
    expect(rule(desktopCss, '#adventure-journal-window .rbg-badge-healer')).toMatch(
      /background:\s*var\(--color-rbg-role-healer-bg\)/,
    );
    expect(rule(desktopCss, '#adventure-journal-window .rbg-badge-damage')).toMatch(
      /background:\s*var\(--color-rbg-role-damage-bg\)/,
    );
    expect(tokensCss).toContain('--color-rbg-role-tank-bg: #2878c8;');
  });

  it('keeps the journal palette in shared tokens', () => {
    const desktop = journalRules(desktopCss);
    const mobile = journalRules(mobileCss);
    expect(desktop.length).toBeGreaterThan(2000);
    expect(mobile.length).toBeGreaterThan(500);
    expect(desktop).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
    expect(mobile).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
  });

  it('retires the party-frames guide button and the old window id', () => {
    for (const css of [desktopCss, mobileCss]) {
      expect(css).not.toContain('party-boss-guide-button');
      expect(css).not.toContain('#raid-boss-guide-window');
      expect(css).not.toContain('rbg-boss-tab');
    }
  });
});
