import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Both build entries (index.html at / and play.html at /play) hand-carry the same HUD
// chrome. A `.window panel` div added to one entry but not the other silently breaks
// that surface: the Hud resolves windows with document.querySelector('#id') and NPEs on
// the entry that lacks the element. This guard keeps the two entries' window-id sets in
// lockstep. Regression: PR #1216 shipped #loot-settings-window to index.html only, which
// threw on /play the moment the auto-open fired (becoming party leader).
//
// The `.window panel` check alone is not enough, because plenty of HUD chrome is a plain
// `.panel` with no `window` class. The meters windows are the worked example, and they
// drifted THREE ways at once while nothing failed: #heal-window / #threat-window were
// added to index.html only (leaving /play a dead "Separate Threat" menu row), the
// stylesheet's `#meters-window` rules were renamed to `.mt-panel` and only index.html
// gained the class (so /play rendered the panel open, full width and unpadded), and the
// `.mt-hint` div MetersPanel.render() dereferences unconditionally never existed on
// /play at all (so opening the meters window there threw). The two checks below cover
// each of those shapes: the id set, the root's own classes, and the classes used
// anywhere inside the panel.
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// Panels that legitimately exist on ONE entry. index.html is the offline-capable entry
// and owns the offline character select plus the first-time Discord chooser; play.html
// is online-only and resolves both defensively (see the comments at src/main.ts around
// the `#offline-select` / `#discord-choice-panel` lookups). Everything else must match.
const ENTRY_ONLY_PANEL_IDS = new Set(['discord-choice-panel', 'offline-select']);

interface PanelBlock {
  /** class tokens on the panel's own opening tag */
  own: string[];
  /** every class token used anywhere in the panel's subtree, including its own */
  subtree: string[];
}

const classTokens = (tag: string): string[] =>
  (/class="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/).filter(Boolean);

const at = (m: RegExpMatchArray): number => m.index ?? 0;

// Ids of every element carrying BOTH the `window` and `panel` classes (attribute order
// and any extra classes tolerated).
function windowPanelIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const [tag] of html.matchAll(/<div\b[^>]*>/g)) {
    const tokens = classTokens(tag);
    if (!tokens.includes('window') || !tokens.includes('panel')) continue;
    const id = /id="([^"]+)"/.exec(tag)?.[1];
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Every id-bearing `.panel` div, with its own classes and the classes used anywhere
 * inside it. Comments are stripped first so a commented-out `</div>` cannot throw the
 * depth count off; the entries are hand-written and their divs balance.
 */
function panelBlocks(rawHtml: string): Map<string, PanelBlock> {
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
  const tags = [...html.matchAll(/<\/?div\b[^>]*>/g)];
  const blocks = new Map<string, PanelBlock>();
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i][0];
    if (tag.startsWith('</')) continue;
    const own = classTokens(tag);
    if (!own.includes('panel')) continue;
    const id = /id="([^"]+)"/.exec(tag)?.[1];
    if (!id) continue;
    // Walk forward to this div's matching close so the slice is exactly its subtree.
    let depth = 0;
    let end = -1;
    for (let k = i; k < tags.length; k++) {
      depth += tags[k][0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = at(tags[k]) + tags[k][0].length;
        break;
      }
    }
    if (end < 0) continue;
    const subtree = new Set<string>();
    for (const [, value] of html.slice(at(tags[i]), end).matchAll(/class="([^"]*)"/g)) {
      for (const token of value.split(/\s+/)) if (token) subtree.add(token);
    }
    blocks.set(id, { own: [...own].sort(), subtree: [...subtree].sort() });
  }
  return blocks;
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

  it('index.html and play.html carry the same set of .panel ids', () => {
    const index = panelBlocks(read('index.html'));
    const play = panelBlocks(read('play.html'));
    // Sanity: this scrape is wider than the one above, so it must find strictly more.
    expect(index.size).toBeGreaterThan(windowPanelIds(read('index.html')).size);
    const missing = (a: Map<string, PanelBlock>, b: Map<string, PanelBlock>) =>
      [...a.keys()].filter((id) => !b.has(id) && !ENTRY_ONLY_PANEL_IDS.has(id)).sort();
    expect({ onlyIndex: missing(index, play), onlyPlay: missing(play, index) }).toEqual({
      onlyIndex: [],
      onlyPlay: [],
    });
    // The allowlist is for panels that really are one-entry-only; a stale entry that
    // both files now carry would quietly widen the hole.
    const stale = [...ENTRY_ONLY_PANEL_IDS].filter((id) => index.has(id) && play.has(id)).sort();
    expect(stale).toEqual([]);
  });

  it('a shared .panel carries the same classes, inside and out, on both entries', () => {
    const index = panelBlocks(read('index.html'));
    const play = panelBlocks(read('play.html'));
    const drift: Record<string, { index: string[]; play: string[] }> = {};
    for (const [id, block] of index) {
      const other = play.get(id);
      if (!other) continue;
      if (
        block.own.join(' ') === other.own.join(' ') &&
        block.subtree.join(' ') === other.subtree.join(' ')
      ) {
        continue;
      }
      drift[id] = {
        index: block.subtree.filter((c) => !other.subtree.includes(c)),
        play: other.subtree.filter((c) => !block.subtree.includes(c)),
      };
    }
    expect(drift).toEqual({});
  });
});
