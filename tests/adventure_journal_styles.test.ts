// The Adventure Journal's stylesheet contract (src/styles/hud.css and
// hud.mobile.css, the #adventure-journal-window rules, palette in tokens.css):
// the approved clean modern look. A scale-aware bounded scroll region on
// desktop and phone, the phone's full sheet with its drawer list and 40px
// targets, an explicit tokenized focus ring on every control, readable type
// (no letter-spaced capitals, no small caps, nothing under 12.5px, Cinzel only
// on the boss name), text that clears WCAG AA on the panels, a palette with no
// raw colour, and the old party-frames guide button gone for good.
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
function journalRules(css: string): { selector: string; body: string }[] {
  return [
    ...css.matchAll(/([^{}]*(?:#adventure-journal-window|#tf-journal)[^{}]*)\{([^}]*)\}/g),
  ].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

const token = (name: string): string => {
  const match = tokensCss.match(new RegExp(`${name}:\\s*(#[0-9a-f]{3,8})\\b`, 'i'));
  expect(match, name).not.toBeNull();
  const hex = match?.[1] ?? '#000';
  return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex.slice(0, 7);
};
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('Adventure Journal styles', () => {
  it('gives the journal a scale-aware bounded keyboard and pointer scroll region', () => {
    const windowRule = rule(desktopCss, '#adventure-journal-window');
    expect(windowRule).toContain('var(--app-vh, 100vh)');
    expect(windowRule).toContain('/ var(--window-scale, 1)');
    const shell = rule(desktopCss, '#adventure-journal-window .aj-shell');
    expect(shell).toContain('var(--app-vh, 100vh)');
    expect(shell).toContain('/ var(--window-scale, 1)');
    expect(shell).toMatch(/grid-template-columns:\s*268px minmax\(0, 1fr\)/);
    const page = rule(desktopCss, '#adventure-journal-window .aj-page');
    expect(page).toMatch(/min-height:\s*0/);
    expect(page).toMatch(/overflow-y:\s*auto/);
    expect(rule(desktopCss, '#adventure-journal-window .aj-nav')).toMatch(/overflow-y:\s*auto/);
    // The tabs stay in reach while a long ability list scrolls.
    expect(rule(desktopCss, '#adventure-journal-window .aj-tabbar')).toMatch(/position:\s*sticky/);
  });

  it('fills a phone with one sheet, a drawer list behind the breadcrumb and 40px targets', () => {
    const windowRule = rule(mobileCss, 'body.mobile-touch #adventure-journal-window');
    expect(windowRule).toMatch(/safe-area-inset-left/);
    expect(windowRule).toMatch(/safe-area-inset-right/);
    expect(windowRule).toMatch(/safe-area-inset-bottom/);
    expect(windowRule).toMatch(/transform:\s*none/);
    expect(rule(desktopCss, '#adventure-journal-window .aj-mobile-top')).toMatch(/display:\s*none/);
    expect(rule(mobileCss, 'body.mobile-touch #adventure-journal-window .aj-mobile-top')).toMatch(
      /display:\s*flex/,
    );
    const drawer = rule(mobileCss, 'body.mobile-touch #adventure-journal-window .aj-nav');
    expect(drawer).toMatch(/position:\s*absolute/);
    expect(drawer).toMatch(/visibility:\s*hidden/);
    expect(drawer).toContain('var(--motion-scale)');
    expect(
      rule(mobileCss, 'body.mobile-touch #adventure-journal-window .aj-shell.aj-nav-open .aj-nav'),
    ).toMatch(/visibility:\s*visible/);
    for (const [selector, prop] of [
      ['.aj-diff button', 'min-height'],
      ['.aj-crumb', 'min-height'],
      ['.aj-tab', 'min-height'],
      ['.aj-model-jump', 'height'],
    ] as const) {
      const body = rule(mobileCss, `body.mobile-touch #adventure-journal-window ${selector}`);
      const px = Number(body.match(new RegExp(`(?:^|\\s|;)${prop}:\\s*(\\d+)px`))?.[1]);
      expect(px, selector).toBeGreaterThanOrEqual(40);
    }
    const strip = rule(mobileCss, 'body.mobile-touch #adventure-journal-window .aj-strip-boss');
    expect(Number(strip.match(/width:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(44);
  });

  it('draws an explicit tokenized focus ring on every journal control', () => {
    // Every journal selector below shares ONE grouped rule; the ring is read
    // off that rule's body (its first selector anchors the match).
    const ring = desktopCss.slice(
      desktopCss.indexOf('#adventure-journal-window .aj-boss:focus-visible'),
    );
    expect(ring.slice(0, ring.indexOf('}'))).toMatch(
      /outline:\s*2px solid var\(--color-border-focus\)/,
    );
    const group = ring.slice(0, ring.indexOf('{'));
    for (const selector of [
      '#adventure-journal-window .aj-boss:focus-visible',
      '#adventure-journal-window .aj-instance-toggle:focus-visible',
      '#adventure-journal-window .aj-tab:focus-visible',
      '#adventure-journal-window .aj-step:focus-visible',
      '#adventure-journal-window .aj-crumb:focus-visible',
      '#adventure-journal-window .aj-strip-boss:focus-visible',
      '#adventure-journal-window .aj-close:focus-visible',
      '#adventure-journal-window .aj-model-jump:focus-visible',
      '#adventure-journal-window .aj-ab-row:focus-visible',
      '#adventure-journal-window .aj-phase-toggle:focus-visible',
      '#adventure-journal-window .aj-watch-link:focus-visible',
      '#adventure-journal-window .aj-soon-tier:focus-visible',
      '#adventure-journal-window .aj-loot-row:focus-visible',
      '#tf-journal:focus-visible',
      '#adventure-journal-window .aj-diff button:focus-visible',
      '#adventure-journal-window .rbg-model-load:focus-visible',
      '#adventure-journal-window .rbg-model-stage > canvas:focus-visible',
    ]) {
      expect(group).toContain(selector);
    }
  });

  it('crops boss portraits into circles and keeps the 3D poster whole', () => {
    const portrait = rule(
      desktopCss,
      '#adventure-journal-window .aj-portrait,\n  #adventure-journal-window .aj-council-member',
    );
    expect(portrait).toMatch(/border-radius:\s*50%/);
    expect(portrait).toContain('var(--color-aj-accent)');
    expect(rule(desktopCss, '#adventure-journal-window .aj-boss-portrait img')).toMatch(
      /object-fit:\s*cover/,
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

  it('reads easily: system sans, no letter-spaced capitals, no small caps, nothing tiny', () => {
    expect(rule(desktopCss, '#adventure-journal-window')).toMatch(
      /font:\s*15px\s*\/\s*1\.55 var\(--font-aj\)/,
    );
    expect(tokensCss).toMatch(/--font-aj:\s*"Segoe UI", system-ui/);
    const all = [...journalRules(desktopCss), ...journalRules(mobileCss)];
    expect(all.length).toBeGreaterThan(150);
    for (const { selector, body } of all) {
      expect(body, selector).not.toMatch(/text-transform:\s*uppercase|small-caps/);
      for (const m of body.matchAll(/letter-spacing:\s*([\d.]+)px/g)) {
        expect(Number(m[1]), selector).toBeLessThanOrEqual(0.3);
      }
      for (const m of body.matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/g)) {
        expect(Number(m[1]), selector).toBeGreaterThanOrEqual(12.5);
      }
      // Cinzel (the display face) names the boss and nothing else.
      if (body.includes('var(--font-display)') || body.includes('var(--title-font)')) {
        expect(selector).toBe('#adventure-journal-window .aj-boss-title');
      }
    }
  });

  it('keeps every word above WCAG AA on the panels it sits on', () => {
    const grounds = [
      '--color-aj-win',
      '--color-aj-nav',
      '--color-aj-panel',
      '--color-aj-panel-hover',
      '--color-aj-banner',
      '--color-aj-chip',
      '--color-aj-tag',
    ];
    for (const ink of [
      '--color-aj-text',
      '--color-aj-soft',
      '--color-aj-mute',
      '--color-aj-accent',
      '--color-aj-accent-hi',
      '--color-aj-deadly',
      '--color-aj-done',
      '--color-aj-info',
      '--color-aj-tank',
      '--color-aj-healer',
      '--color-aj-damage',
    ]) {
      for (const ground of grounds) {
        expect(contrast(token(ink), token(ground)), `${ink} on ${ground}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
    // The selected difficulty: dark ink on the amber fill.
    expect(
      contrast(token('--color-aj-accent-ink'), token('--color-aj-accent')),
    ).toBeGreaterThanOrEqual(7);
  });

  it('keeps the journal palette in shared tokens', () => {
    const desktop = journalRules(desktopCss)
      .map((r) => r.body)
      .join('\n');
    const mobile = journalRules(mobileCss)
      .map((r) => r.body)
      .join('\n');
    expect(desktop.length).toBeGreaterThan(4000);
    expect(mobile.length).toBeGreaterThan(1500);
    expect(desktop).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
    expect(mobile).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
    // The rejected skins' palettes are gone.
    expect(tokensCss).not.toContain('--color-rbg-');
    expect(tokensCss).not.toContain('--tex-aj-');
  });

  it('retires the party-frames guide button and the old window id', () => {
    for (const css of [desktopCss, mobileCss]) {
      expect(css).not.toContain('party-boss-guide-button');
      expect(css).not.toContain('#raid-boss-guide-window');
      expect(css).not.toContain('rbg-boss-tab');
    }
  });
});
