import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Both build entries (index.html at / and play.html at /play) hand-carry the HUD
// chrome. The Hud class resolves many elements as CONSTRUCTOR-TIME field initializers
// via `$('#id')` (= document.querySelector, cast to a non-null type). If an entry is
// missing one of those ids, the field is silently null and the first thing that touches
// it — `new QuestProgressBanner($('#quest-banner'))`, `el.addEventListener(...)` — throws
// during `new Hud()`, taking the whole renderer down on that entry.
//
// entry_window_parity.test.ts guards `.window panel` ids, but the crash class is broader:
// banners, bars, and indicators the ctor resolves are not window panels. This guard scrapes
// the ctor field-initializer `$('#id')` literals from hud.ts and asserts every one exists in
// BOTH entries, so a HUD element added to one entry but not the other fails CI instead of
// the browser.
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// The Hud class field-initializer region: from the first `$('#...')` field initializer up to
// the constructor. Only ids resolved HERE run at `new Hud()` and can crash construction.
// Ids resolved inside method bodies are excluded — those elements are often injected on
// demand (modals, dynamic previews) and are not part of the static entry chrome.
function ctorFieldIds(hudSrc: string): Set<string> {
  const start = hudSrc.search(/^\s*(?:private|readonly|public)\b[^\n]*\$\('#/m);
  const ctor = hudSrc.search(/^\s{2}(?:private\s+)?constructor\s*\(/m);
  const region = start >= 0 && ctor > start ? hudSrc.slice(start, ctor) : '';
  const ids = new Set<string>();
  for (const m of region.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)) ids.add(m[1]);
  return ids;
}

function htmlIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const m of html.matchAll(/id="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

describe('entry HUD-constructor parity', () => {
  it('every Hud ctor-resolved #id exists in both index.html and play.html', () => {
    const ctorIds = ctorFieldIds(read('src/ui/hud.ts'));
    // Sanity: the scrape found the field region, not an empty set from a refactor.
    expect(ctorIds.size).toBeGreaterThan(20);

    const index = htmlIds(read('index.html'));
    const play = htmlIds(read('play.html'));

    const missingInIndex = [...ctorIds].filter((id) => !index.has(id)).sort();
    const missingInPlay = [...ctorIds].filter((id) => !play.has(id)).sort();
    expect({ missingInIndex, missingInPlay }).toEqual({ missingInIndex: [], missingInPlay: [] });
  });
});
