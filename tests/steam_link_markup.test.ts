// The character-select Steam link card is hand-duplicated across the two game
// entries (the play.html shared-entry trap: an element present in one entry
// and missing or drifted in the other fails silently at runtime). Pin the two
// #cs-steam-group blocks byte-identical so an edit to one entry cannot
// quietly strand the other.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');

function steamGroupBlock(file: string): string {
  const html = readFileSync(join(repoRoot, file), 'utf8');
  const start = html.indexOf('<div class="cs-wallet cs-steam-group"');
  expect(start, `${file} is missing the #cs-steam-group card`).toBeGreaterThan(-1);
  // The card is a fixed-depth block: capture through its closing help div and
  // the two wrapper closes that follow it.
  const helpEnd = html.indexOf('</div>', html.indexOf('id="steam-help"', start));
  expect(helpEnd, `${file} steam card is missing its help line`).toBeGreaterThan(-1);
  const end = html.indexOf('</div>', html.indexOf('</div>', helpEnd + 1) + 1);
  return html
    .slice(start, end)
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
}

describe('character-select Steam card entry parity', () => {
  it('the #cs-steam-group block is identical in index.html and play.html', () => {
    expect(steamGroupBlock('play.html')).toBe(steamGroupBlock('index.html'));
  });

  it('both entries carry the ids the wiring binds', () => {
    for (const file of ['index.html', 'play.html']) {
      const block = steamGroupBlock(file);
      for (const id of ['btn-steam-link', 'steam-status', 'btn-steam-unlink', 'steam-help']) {
        expect(block, `${file} is missing #${id}`).toContain(`id="${id}"`);
      }
    }
  });
});
