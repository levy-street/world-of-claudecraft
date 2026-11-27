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
    // Every journal selector below shares ONE grouped rule; the ring is read
    // off that rule's body (its last selector anchors the match).
    const ring = desktopCss.slice(
      desktopCss.indexOf('#adventure-journal-window .aj-boss:focus-visible'),
    );
    expect(ring.slice(0, ring.indexOf('}'))).toMatch(
      /outline:\s*2px solid var\(--color-border-focus\)/,
    );
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
    expect(
      rule(desktopCss, '#adventure-journal-window .rbg-model-stage > canvas:focus-visible'),
    ).toMatch(/outline:\s*2px solid var\(--color-border-focus\)/);
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

  // The forge-and-parchment skin: its own ten-dash section after the layout
  // rules, so it only repaints them. Read off that section, not the first match.
  describe('forge and parchment skin', () => {
    const banner = '/* ---------- adventure journal forge and parchment skin ---------- */';
    const start = desktopCss.indexOf(banner);
    const skin = desktopCss.slice(
      start,
      desktopCss.indexOf('/* ----------', start + banner.length),
    );
    const token = (name: string): string => {
      const match = tokensCss.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\b`, 'i'));
      expect(match, name).not.toBeNull();
      return match?.[1] ?? '';
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

    it('lands after the journal layout rules it repaints', () => {
      expect(start).toBeGreaterThan(
        desktopCss.indexOf('#adventure-journal-window .aj-soon-tier {'),
      );
      expect(skin.length).toBeGreaterThan(4000);
    });

    it('frames the window in iron with corner plates and rivets from tokens', () => {
      expect(rule(skin, '#adventure-journal-window')).toContain('var(--tex-aj-iron)');
      expect(rule(skin, '#adventure-journal-window::before')).toContain('var(--mask-aj-corner-br)');
      expect(rule(skin, '#adventure-journal-window::after')).toMatch(/pointer-events:\s*none/);
      for (const name of [
        '--tex-aj-iron',
        '--tex-aj-parchment',
        '--mask-aj-corner-tl',
        '--mask-aj-flourish',
      ]) {
        expect(tokensCss).toContain(`${name}: url("data:image/svg+xml,`);
      }
    });

    it('writes every word on the parchment in ink that reads on the darkest paper', () => {
      const shell = rule(skin, '#adventure-journal-window .rbg-shell');
      expect(shell).toContain('var(--tex-aj-parchment)');
      expect(shell).toMatch(/color:\s*var\(--color-aj-ink\)/);
      const paper = token('--color-aj-parch-lo');
      for (const ink of [
        '--color-aj-ink',
        '--color-aj-ink-soft',
        '--color-aj-ink-faint',
        '--color-aj-rubric',
        '--color-aj-umber',
        '--color-aj-ink-green',
        '--color-aj-ink-blue',
      ]) {
        expect(contrast(token(ink), paper), ink).toBeGreaterThanOrEqual(4.5);
      }
      // The shared focus rule's ring turns to rubric on the paper.
      expect(rule(skin, '#adventure-journal-window .aj-shell')).toMatch(
        /--color-border-focus:\s*var\(--color-aj-rubric\)/,
      );
    });

    it('keeps loot on dark iron so the quality colours keep their ground', () => {
      expect(rule(skin, '#adventure-journal-window .aj-loot-row')).toContain(
        'var(--color-aj-iron)',
      );
      expect(
        contrast(token('--color-aj-rivet-hi'), token('--color-aj-iron')),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it('hangs the tabs as ribbons and forges the difficulty plates', () => {
      expect(rule(skin, '#adventure-journal-window .aj-tab')).toMatch(/clip-path:\s*polygon\(/);
      expect(rule(skin, '#adventure-journal-window .aj-tab.active')).toContain(
        'var(--color-aj-ribbon)',
      );
      expect(rule(skin, '#adventure-journal-window .rbg-segmented button.active')).toContain(
        'var(--color-aj-brass)',
      );
    });

    it('gives the phone drawer its own opaque leaf of parchment', () => {
      const drawer = [
        ...mobileCss.matchAll(
          /body\.mobile-touch #adventure-journal-window \.aj-nav\s*\{([^}]*)\}/g,
        ),
      ]
        .map((m) => m[1])
        .join('\n');
      expect(drawer).toContain('var(--tex-aj-parchment)');
      expect(drawer).not.toContain('--color-rbg-frame-end');
    });
  });
});
