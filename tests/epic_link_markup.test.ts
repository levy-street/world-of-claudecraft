// The character-select Epic link card is hand-duplicated across the two game
// entries (the play.html shared-entry trap: an element present in one entry
// and missing or drifted in the other fails silently at runtime). Pin the two
// #cs-epic-group blocks byte-identical so an edit to one entry cannot
// quietly strand the other. Twin of tests/steam_link_markup.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');

function epicGroupBlock(file: string): string {
  const html = readFileSync(join(repoRoot, file), 'utf8');
  const start = html.indexOf('<div class="cs-wallet cs-epic-group"');
  expect(start, `${file} is missing the #cs-epic-group card`).toBeGreaterThan(-1);
  // The card is a fixed-depth block: capture through its closing help div and
  // the two wrapper closes that follow it.
  const helpEnd = html.indexOf('</div>', html.indexOf('id="epic-help"', start));
  expect(helpEnd, `${file} epic card is missing its help line`).toBeGreaterThan(-1);
  const end = html.indexOf('</div>', html.indexOf('</div>', helpEnd + 1) + 1);
  return html
    .slice(start, end)
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
}

describe('character-select Epic card entry parity', () => {
  it('the #cs-epic-group block is identical in index.html and play.html', () => {
    expect(epicGroupBlock('play.html')).toBe(epicGroupBlock('index.html'));
  });

  it('both entries carry the ids the wiring binds', () => {
    // Exactly the ids src/ui/epic_link.ts looks up; a rename here strands the
    // wiring silently at runtime.
    for (const file of ['index.html', 'play.html']) {
      const block = epicGroupBlock(file);
      for (const id of ['cs-epic-group', 'btn-epic-link', 'epic-status', 'btn-epic-unlink']) {
        expect(block, `${file} is missing #${id}`).toContain(`id="${id}"`);
      }
    }
  });

  it('both entries carry the markup-only ids kept for Steam-card symmetry', () => {
    // Nothing binds these two (the block-extraction helper anchors on
    // epic-help); they exist so the epic card's markup shape stays the byte
    // twin of the Steam card's.
    for (const file of ['index.html', 'play.html']) {
      const block = epicGroupBlock(file);
      for (const id of ['epic-help', 'epic-label']) {
        expect(block, `${file} is missing #${id}`).toContain(`id="${id}"`);
      }
    }
  });

  it('both entries bind player strings through data-i18n keys (no raw English only)', () => {
    for (const file of ['index.html', 'play.html']) {
      const block = epicGroupBlock(file);
      for (const key of [
        'hudChrome.epic.title',
        'hudChrome.epic.link',
        'hudChrome.epic.unlink',
        'hudChrome.epic.benefits',
      ]) {
        expect(block, `${file} is missing data-i18n for ${key}`).toContain(key);
      }
    }
  });
});
