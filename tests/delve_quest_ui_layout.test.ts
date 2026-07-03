import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression coverage for the Delves quest tracker overlapping the quest log
// tracker (and other HUD chrome). The fix stacks #quest-tracker and
// #delve-tracker inside one flex column wrapper (#right-tracker-stack) instead
// of two independently absolutely-positioned overlays with a hardcoded pixel
// gap, so the delve tracker always lands below the quest tracker's actual
// rendered height rather than a fixed offset that a long quest list could
// grow past.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const hudCss = readFileSync(join(repoRoot, 'src', 'styles', 'hud.css'), 'utf8');
const indexHtml = readFileSync(join(repoRoot, 'index.html'), 'utf8');
const playHtml = readFileSync(join(repoRoot, 'play.html'), 'utf8');

function wrapperMarkup(html: string): string {
  const start = html.indexOf('<div id="right-tracker-stack">');
  if (start < 0) return '';
  // Walk to the wrapper's own matching close so the slice cannot run past it
  // into sibling markup (a fixed window would keep containing a tracker that
  // was moved OUT of the wrapper to just below it, and pass falsely).
  let depth = 0;
  const token = /<div\b|<\/div>/g;
  token.lastIndex = start;
  for (let m = token.exec(html); m; m = token.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return '';
}

describe('delves quest tracker layout', () => {
  it('both game entries wrap quest-tracker and delve-tracker in one right-tracker-stack container', () => {
    for (const html of [indexHtml, playHtml]) {
      const markup = wrapperMarkup(html);
      expect(markup).not.toBe('');
      expect(markup).toContain('id="quest-tracker"');
      expect(markup).toContain('id="delve-tracker"');
    }
  });

  it('exactly one #delve-tracker element exists per entry (never shown twice at once)', () => {
    for (const html of [indexHtml, playHtml]) {
      const matches = html.match(/id="delve-tracker"/g) ?? [];
      expect(matches.length).toBe(1);
    }
  });

  it('the wrapper owns the absolute position; the two trackers stack in normal flow inside it', () => {
    const wrapperRule = /#right-tracker-stack\s*\{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    expect(wrapperRule).toContain('position: absolute');
    expect(wrapperRule).toContain('display: flex');
    expect(wrapperRule).toContain('flex-direction: column');

    const questRule = /#quest-tracker\s*\{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    const delveRule = /#delve-tracker\s*\{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    // Neither tracker independently positions itself anymore: a stray
    // `top`/`position: absolute` on either would reintroduce the hardcoded
    // offset that caused the overlap.
    expect(questRule).not.toContain('position: absolute');
    expect(questRule).not.toMatch(/\btop:/);
    expect(delveRule).not.toContain('position: absolute');
    expect(delveRule).not.toMatch(/\btop:/);
  });
});
