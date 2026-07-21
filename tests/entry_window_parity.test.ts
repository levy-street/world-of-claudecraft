import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Both build entries (index.html at / and play.html at /play) hand-carry the same HUD
// chrome. A `.window panel` div added to one entry but not the other silently breaks
// that surface: the Hud resolves windows with document.querySelector('#id') and NPEs on
// the entry that lacks the element. This guard keeps the two entries' window-id sets in
// lockstep. Regression: PR #1216 shipped #loot-settings-window to index.html only, which
// threw on /play the moment the auto-open fired (becoming party leader).
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// Ids of every element carrying BOTH the `window` and `panel` classes (attribute order
// and any extra classes tolerated).
function windowPanelIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const [tag] of html.matchAll(/<div\b[^>]*>/g)) {
    const tokens = (/class="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/);
    if (!tokens.includes('window') || !tokens.includes('panel')) continue;
    const id = /id="([^"]+)"/.exec(tag)?.[1];
    if (id) ids.add(id);
  }
  return ids;
}

describe('entry window-panel parity', () => {
  it('index.html and play.html carry the same set of .window panel ids', () => {
    const index = windowPanelIds(read('index.html'));
    const play = windowPanelIds(read('play.html'));
    // Sanity: the scrape found the chrome, not an empty set from a markup change.
    expect(index.size).toBeGreaterThan(10);
    const onlyIndex = [...index].filter((id) => !play.has(id)).sort();
    const onlyPlay = [...play].filter((id) => !index.has(id)).sort();
    expect({ onlyIndex, onlyPlay }).toEqual({ onlyIndex: [], onlyPlay: [] });
  });
});
