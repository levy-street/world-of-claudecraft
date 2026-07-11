import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Phase 5 mobile-HUD-parity coverage guard.
//
// Every desktop HUD window (an element with class `window` and an id) must have a
// deliberate mobile-touch decision: either it is brought into the shared "mobile
// sheet base" pattern (at least one `body.mobile-touch ... #id ...` rule that also
// carries a real pin/size/floor property, not merely a cosmetic z-index/border), or
// it is listed in MOBILE_WINDOW_EXCEPTIONS with a reason.
//
// This is the future-proofing half of the phase: a NEW window added to the markup
// without a mobile rule and without an exception entry FAILS this test, so it can
// never silently ship as an unstyled desktop-only box on touch.
//
// The window ids come from BOTH build entries (index.html at `/`, play.html at
// `/play`; vite.config.ts) since the HUD chrome ships in both, PLUS any window
// created dynamically in src/ui (scraped below). The mobile-touch rules are read
// from every src/styles/*.css module (the flattened cascade an entry loads via the
// src/styles/index.css barrel).
const HTML_ENTRIES = ['../index.html', '../play.html'];
const STYLES_DIR = '../src/styles';
const UI_DIR = '../src/ui';

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

// The static `.window` ids from a markup entry. Attribute-ORDER-TOLERANT: it scans
// whole opening tags and tests `id=` and a `window` className INDEPENDENTLY per tag,
// so a future class-first element (class="..." before id="...") is still picked up
// (the old id-then-class regex would have silently missed it).
function windowIdsFromHtml(html: string): string[] {
  const ids: string[] = [];
  // Every opening tag's inner attribute text (between `<tag` and the closing `>`). The
  // `<[a-z]` start skips a close tag's `</` and a comment's OWN `<!--` delimiter, but it
  // does NOT strip HTML comments: a `.window` tag written literally inside `<!-- ... -->`
  // would still be scraped here. That is acceptable because the failure direction is loud
  // (a scraped window with no mobile rule and no exception FAILS the coverage assertion),
  // so a commented-out window can never SILENTLY pass; it just needs an exception entry.
  // A tag's attributes never contain a raw '>', so [^>]* is safe here.
  for (const tag of html.matchAll(/<[a-z][a-z0-9]*\s+([^>]*?)\/?>/gi)) {
    const attrs = tag[1];
    const idMatch = attrs.match(/\bid="([a-z0-9-]+)"/);
    const classMatch = attrs.match(/\bclass="([^"]*)"/);
    // Exact class-TOKEN match, not \bwindow\b: the regex word boundary treats the
    // hyphen in the frame-grammar chrome classes (window-title, window-close,
    // window-frame) as a boundary, so a titlebar span or close button inside a
    // statically-authored frame (the More drawer) would be mis-scraped as a
    // window of its own and demanded a sheet rule it must never have.
    if (idMatch && classMatch && classMatch[1].split(/\s+/).includes('window')) {
      ids.push(idMatch[1]);
    }
  }
  return ids;
}

// Windows created at runtime carry a `window` className in a src/ui module rather
// than living in the static markup (today only #confirm-dialog, reused by the input
// dialog). To pick a future dynamic window up automatically, pair a `<var>.id = 'X'`
// assignment with a `<var>.className = 'window ...'` on the SAME variable within a
// short line-distance. Matching the id AND the window className on the same element
// is what keeps sibling containers (#emote-wheel, #loot-rolls, #skin-event: divs in
// the same module that are NOT .window boxes) from being mis-scraped as windows.
function dynamicWindowIds(): { ids: string[]; scannedFiles: number; hadWindowClass: number } {
  const dir = fileURLToPath(new URL(UI_DIR, import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  const ids = new Set<string>();
  let hadWindowClass = 0;
  const idRe = /(\w+)\.id\s*=\s*['"]([a-z0-9-]+)['"]/g;
  for (const f of files) {
    const src = readFileSync(`${dir}/${f}`, 'utf8');
    if (!/\.className\s*=\s*['"]window(?:\s+[^'"]*)?['"]/.test(src)) continue;
    hadWindowClass++;
    for (const m of src.matchAll(idRe)) {
      const [, varName, id] = m;
      // Require the same variable to receive a `window` className nearby (within the
      // element's construction block, allow generous slack for id/aria/style lines).
      const near = src.slice(m.index, m.index + 600);
      const classRe = new RegExp(`${varName}\\.className\\s*=\\s*['"]window(?:\\s+[^'"]*)?['"]`);
      if (classRe.test(near)) ids.add(id);
    }
  }
  return { ids: [...ids], scannedFiles: files.length, hadWindowClass };
}

// Windows deliberately NOT brought into the mobile sheet pattern, each with a
// reason. These pass coverage without a mobile-touch positioning rule.
const MOBILE_WINDOW_EXCEPTIONS: Record<string, string> = {
  'loot-window':
    'cursor-popped by design: the loot roll popup spawns at the drop, not as a docked sheet',
  'confirm-dialog':
    'small centered modal (dynamic, reused by the input dialog); the base .window centering is correct on touch',
  'delve-rite-panel': 'in-run gameplay overlay, not a menu window that docks to a sheet',
  'lockpick-panel': 'in-run gameplay overlay, not a menu window that docks to a sheet',
  'daily-rewards-window':
    'sized entirely by the shared body.mobile-touch .window sheet base (max-width/max-height) plus its own .dr-body 2-column body rule; its only id-specific mobile rule is a z-index bump, so it carries no id-scoped pin of its own',
};

// A src/styles/*.css module contains a positioning/floor rule for #id on touch when
// some `body.mobile-touch ... #id ...` selector names the id. Comments are stripped
// so a commented id cannot spoof coverage.
function stylesText(): string {
  const dir = fileURLToPath(new URL(STYLES_DIR, import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.css'));
  return files
    .map((f) => readFileSync(`${dir}/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
    .join('\n');
}

// A window counts as sheeted on mobile only when a `body.mobile-touch ... #id ...`
// rule ALSO carries at least one real pin/size/floor declaration in its block, so a
// purely cosmetic id rule (a lone z-index, border, or color) cannot spoof coverage.
// The block scanned is the leaf declaration block after the selector: CSS
// declarations hold no nested braces, so the first `{`..`}` after a selector match
// is exactly that rule's body even inside the file's @layer/@media wrappers (which
// is why this scans per-rule rather than brace-parsing the whole nested file).
const PIN_PROP_RE = /(?:^|[;{\s])(?:left|right|top|max-height|min-height|transform)\s*:/;

function hasMobileRule(css: string, id: string): boolean {
  // A selector that starts with `body.mobile-touch` (optionally with extra state
  // classes) and names `#id` as the target or an ancestor of the target.
  const selRe = new RegExp(`body\\.mobile-touch[^,{}]*#${id}(?![-a-z0-9])`, 'g');
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop.
  while ((m = selRe.exec(css)) !== null) {
    const open = css.indexOf('{', m.index + m[0].length);
    if (open === -1) continue;
    const close = css.indexOf('}', open + 1);
    if (close === -1) continue;
    if (PIN_PROP_RE.test(css.slice(open + 1, close))) return true;
  }
  return false;
}

describe('mobile window coverage (Phase 5 parity)', () => {
  const htmlIds = HTML_ENTRIES.flatMap((e) => windowIdsFromHtml(read(e)));
  const dyn = dynamicWindowIds();
  const allIds = [...new Set([...htmlIds, ...dyn.ids])].sort();
  const css = stylesText();

  it('scrapes a plausible set of window ids from both entries plus src/ui', () => {
    // Sanity floor: the static markup carries the full HUD window family; if this
    // collapses, the scrape regex broke and the coverage assertions are hollow.
    expect(allIds.length).toBeGreaterThanOrEqual(20);
    // The dynamic scrape must have inspected src/ui and found the window-creating
    // module(s); #confirm-dialog is the one dynamic window today.
    expect(dyn.hadWindowClass).toBeGreaterThanOrEqual(1);
    expect(allIds).toContain('confirm-dialog');
  });

  it('every window is either sheeted on mobile or an explicit exception', () => {
    const unclassified: string[] = [];
    for (const id of allIds) {
      if (id in MOBILE_WINDOW_EXCEPTIONS) continue;
      if (hasMobileRule(css, id)) continue;
      unclassified.push(id);
    }
    expect(
      unclassified,
      'these windows have no body.mobile-touch rule naming their id and are not in ' +
        `MOBILE_WINDOW_EXCEPTIONS (add a mobile sheet rule or an exception with a reason):\n${unclassified.join('\n')}`,
    ).toEqual([]);
  });

  it('each Phase 5 sheeted window carries a mobile-touch rule', () => {
    const phase5 = [
      'calendar-window',
      'crafting-window',
      'mailbox-window',
      'emote-editor',
      'arena-window',
      'valecup-window',
      'delve-board',
      'leaderboard-window',
      'loot-settings-window',
    ];
    const missing = phase5.filter((id) => !hasMobileRule(css, id));
    expect(missing, `Phase 5 windows missing a mobile-touch rule:\n${missing.join('\n')}`).toEqual(
      [],
    );
  });

  it('every exception id names a real window and carries a reason string', () => {
    for (const [id, reason] of Object.entries(MOBILE_WINDOW_EXCEPTIONS)) {
      expect(allIds, `exception #${id} is not a scraped window id`).toContain(id);
      expect(reason.length, `exception #${id} needs a non-empty reason`).toBeGreaterThan(10);
    }
  });
});
