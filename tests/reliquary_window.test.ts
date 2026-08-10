// Source-guard suite for The Reliquary cold window wiring (the
// deeds_window.test.ts pattern): no magic hex/px in the painter, hud
// orchestration pins, entry HTML, keybind dispatch, CSS section banner and
// mobile full-bleed, fairness (no tier/governor). Behavior of the pure core
// is covered in tests/reliquary_view.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RELIQUARY_MARK_IDS } from '../src/sim/content/reliquary';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

// Blank out whole-line and trailing line comments, so prose that quotes a
// banned pattern cannot false-red (or false-green) a source pin.
const stripComments = (src: string): string =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .map((line) => line.replace(/\s\/\/.*$/, ''))
    .join('\n');

const painter = read('../src/ui/reliquary_window.ts');
const view = read('../src/ui/reliquary_view.ts');
const labels = read('../src/ui/reliquary_labels.ts');
// The Phase 15 tracker pair rides the same hygiene scans (the deeds family
// precedent: tests/deeds_window.test.ts scans deed_tracker_painter.ts by name).
const trackerView = read('../src/ui/reliquary_tracker_view.ts');
const trackerPainter = read('../src/ui/reliquary_tracker_painter.ts');
const hud = read('../src/ui/hud.ts');
const mainSrc = read('../src/main.ts');
const inputSrc = read('../src/game/input.ts');
const keybindsSrc = read('../src/game/keybinds.ts');
const mobileControlsSrc = read('../src/game/mobile_controls.ts');
const chrome = read('../src/ui/i18n.catalog/hud_chrome.ts');
const optionsWindow = read('../src/ui/options_window.ts');
const components = read('../src/styles/components.css');
const hudMobile = read('../src/styles/hud.mobile.css');
const architecture = read('./architecture.test.ts');
const indexHtml = read('../index.html');
const playHtml = read('../play.html');

// One ten-dash section of components.css, so a CSS pin cannot be satisfied by
// an identical declaration in some other window's section.
function sectionCss(name: string): string {
  const banner = `/* ---------- ${name} ---------- */`;
  const start = components.indexOf(banner);
  expect(start, `${banner} banner`).toBeGreaterThanOrEqual(0);
  const next = components.indexOf('/* ----------', start + banner.length);
  expect(next, `section after ${name}`).toBeGreaterThan(start);
  return components.slice(start, next);
}

describe('painter hygiene', () => {
  it('keeps hex/px literals out of the painter TS (tokens and classes only)', () => {
    // Allow the #reliquary-window comment/id reference; ban free-standing hex colors.
    for (const src of [painter, trackerPainter, trackerView]) {
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}(?![\w-])/);
      expect(src).not.toMatch(/'\d+px'/);
    }
  });

  it('contains no em/en dashes', () => {
    for (const src of [painter, view, labels, trackerPainter, trackerView]) {
      expect(src).not.toMatch(/\u2014|\u2013/);
    }
  });

  it('reads neither the FPS governor nor the graphics tier (fairness)', () => {
    // Source lines, page blurbs, clear counts, and owned/missing state are all
    // information a player acts on, so no preset may thin any of them. The
    // always-on tracker strip is held to the same oracle: everything it shows
    // is player-chosen collection progress.
    for (const src of [painter, view, labels, trackerPainter, trackerView]) {
      expect(src).not.toMatch(/governor/);
      expect(src).not.toMatch(/ui_effects_profile|fxTier|data-fx-level/);
    }
    // Positive anchors so the negative scans above are self-auditing: a moved
    // file throws at read() already, but a file gutted in place (or reduced
    // to a re-export) would keep passing every not-toMatch above.
    expect(trackerPainter).toContain('export class ReliquaryTrackerPainter');
    expect(trackerView).toContain('RELIQUARY_TRACK_CAP');
  });

  it('dims the at-cap pin in BOTH refusal spellings and excludes it from hover', () => {
    // The control no longer carries native disabled, so the whole "refused
    // looks refused" affordance rests on the attribute selector.
    const reliquaryCss = sectionCss('reliquary');
    expect(reliquaryCss).toMatch(
      /\.reliquary-pin:disabled,\s*\.reliquary-pin\[aria-disabled="true"\] \{\s*opacity: 0\.5;/,
    );
    expect(reliquaryCss).toContain(
      '.reliquary-pin:hover:not(:disabled):not([aria-disabled="true"])',
    );
  });

  it('elides slow-band repaints through the pure refresh signature', () => {
    // Strip whole-line comments so a comment-only mention cannot false-green.
    const code = painter
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    expect(code).toContain('const input = this.buildInput()');
    expect(code).toContain('const sig = this.sigFromInput(input)');
    expect(code).toContain('if (sig === this.lastSig) return');
    // clearsDigest + ownershipDigest must be arguments to reliquaryRefreshSig.
    expect(code).toMatch(/reliquaryRefreshSig\(\{[\s\S]*?clearsDigest[\s\S]*?\}\)/);
    expect(code).toMatch(/reliquaryRefreshSig\(\{[\s\S]*?ownershipDigest[\s\S]*?\}\)/);
    // Digest return value must feed the sig (not a discarded call).
    expect(code).toMatch(
      /const ownershipDigest = reliquaryOwnershipDigest\(\{[\s\S]*?discoveredSize[\s\S]*?firstFindCount[\s\S]*?pageOwned[\s\S]*?\}\)/,
    );
  });

  it('paints a real page grid (owned vs missing cells) instead of a Phase 4 stub note', () => {
    const code = painter
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    expect(painter).toContain('pageDetailHtml');
    expect(painter).toContain('reliquary-grid');
    // Class names are composed as reliquary-cell-- + owned|missing.
    expect(painter).toContain('reliquary-cell--');
    expect(painter).toMatch(/stateClass = cell\.owned \? 'owned' : 'missing'/);
    expect(painter).toContain('attachTooltip');
    // Live firstFind meta must feed the pure model (owned-cell clear# tooltips).
    expect(code).toContain('firstFind: world.reliquaryFirstFind');
    // Phase 7: profession mark ownership must feed the pure model (owned vs
    // missing cells). Dropping this leaves every mark painted missing.
    expect(code).toContain('marks: world.reliquaryMarks');
    expect(code).toContain('marksSize: world.reliquaryMarks.size');
    // Phase 8: Horizons ownership from live seams only.
    expect(code).toContain('ownedMounts: new Set(world.ownedMounts())');
    expect(code).toContain('weaponSkins: new Set(world.accountCosmetics.weaponSkinIds)');
    expect(code).toContain('deedsEarned: world.deedsEarned');
  });

  it('paints profession mark cells with quality silhouettes', () => {
    // Masterwork marks read epic; rare field notes read rare. The mark LABEL
    // ladder moved to reliquary_labels.ts (pinned in its own describe below);
    // the quality silhouette is still the painter's call.
    expect(painter).toContain("cell.id.startsWith('masterwork:')");
    expect(painter).toContain("return 'epic'");
    expect(painter).toContain("cell.id.startsWith('gather_event:')");
    expect(painter).toContain("return 'rare'");
  });

  it('labels an outside-completion page by REASON on both the page header and the shelf row', () => {
    // The Vault of Ages / Riftbound chip (Phase 21): resolved off the authored
    // def's excludeFromCompletion flag (catalog data, not player state) and
    // painted at BOTH render sites, so such a page can never present as an
    // ordinary chase on one surface while the completion math already ignores
    // it. The flag's REASON picks the hook and the key, so the two kinds never
    // wear each other's word.
    const code = stripComments(painter);
    expect(code).toContain('RELIQUARY_PAGES_BY_ID[pageId].excludeFromCompletion');
    // The dispatch is an exhaustive record indexed by the reason, so a third
    // flag value fails tsc at the index instead of defaulting to either chip.
    expect(code).toMatch(/satisfies Record<'retired' \| 'personal'/);
    expect(code).toContain('chips[reason]');
    expect(code).toContain('hudChrome.reliquary.retiredLabel');
    expect(code).toContain('hudChrome.reliquary.personalLabel');
    expect(code).toContain('data-retired');
    expect(code).toContain('data-personal');
    // Both call sites (header and shelf row) go through the one helper.
    expect(code.match(/this\.outsideCompletionChipHtml\(/g)?.length).toBe(2);
  });

  it('labels account-scoped weapon skins', () => {
    // Account-scope chrome (never reimplements equip/summon).
    const code = painter
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    expect(code).toMatch(/page\.accountScoped[\s\S]*?accountScopeNote/);
    expect(code).toMatch(/cell\.kind === 'weapon_skin'[\s\S]*?accountScopeBadge/);
    expect(code).toContain('data-account-scope');
    expect(components).toContain('.reliquary-account-scope');
  });

  it('paints the rail count through the progressText key (never a hand-built ratio)', () => {
    // Every owned/total readout in this window shares one key. A hand-built
    // "{owned}/{total}" in the rail would ship an unlocalized separator and no
    // other pin in this file would see it.
    expect(painter).toContain("t('hudChrome.reliquary.progressText'");
    const rail = painter
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n')
      .match(/private railHtml\([\s\S]*?\n {2}private contentHtml/)?.[0];
    expect(rail, 'railHtml body').toBeTruthy();
    expect(rail).toContain("t('hudChrome.reliquary.progressText'");
    expect(rail).toContain('reliquary-nav-count');
  });

  it('reads no name property at all: every display name resolves from its id', () => {
    // The pure view model keeps `name` as raw catalog English (the id-stable
    // sort/debug field), so ANY `.name` property read in the painter is a
    // candidate untranslated render. Phase 13 moved the last sanctioned one
    // (the weapon-skin label) into reliquary_labels.ts with the rest of the
    // display-name ladder, so the painter's count is now ZERO, not one: page
    // names go through reliquaryPageName(pageId) and relic names through
    // reliquaryRelicDisplayName(kind, id). Comments (line and jsdoc) are
    // stripped so prose cannot pad the count; trailing line comments are cut
    // too so an unrelated `// ... .name` note on a code line cannot red it.
    //
    // ONE read is sanctioned, and it is named here in full rather than counted:
    // the pin store's per-character storage key (woc_reliquary_pins_<class>_<name>)
    // reads the CHARACTER name, an identity string that is never rendered. Any
    // other `.name` in this painter is the untranslated-render candidate this
    // guard exists to catch, and fails the exact-match below.
    const code = stripComments(painter);
    const nameReads = [...code.matchAll(/[\w.]*\.name\b/g)].map((m) => m[0]);
    expect(nameReads).toEqual(['world.player.name']);
    expect(code).toContain('reliquaryPageName(');
    expect(code).toContain('reliquaryRelicDisplayName(');
  });

  it('wires host completion helpers with Horizons ownership surfaces (Sim + ClientWorld)', () => {
    const simSrc = read('../src/sim/sim.ts');
    const onlineSrc = read('../src/net/online.ts');
    for (const [name, src] of [
      ['sim', simSrc],
      ['online', onlineSrc],
    ] as const) {
      expect(src, name).toContain('reliquaryOwnershipOpts');
      expect(src, name).toContain('ownedMounts: this.ownedMounts()');
      expect(src, name).toContain('weaponSkinIds: this.accountCosmetics.weaponSkinIds');
      expect(src, name).toMatch(/deedsEarned: this\.(primary\.)?deedsEarned/);
      // Rank excludes skins via catalogRankOwned (aligned with grant path).
      expect(src, name).toContain('catalogRankOwned');
    }
  });

  it('shows the source lines on missing cells only, in tooltip AND label', () => {
    const code = stripComments(painter);
    // Tooltip: EVERY resolved line under the status line, gated on the cell
    // being MISSING (an owned item relic returns the full item tooltip and needs
    // no hunting directions). The loop is the point: a relic with three doors
    // paints three lines, not the first one.
    expect(code).toMatch(
      /if \(!cell\.owned\) \{[\s\S]*?for \(const source of reliquarySourceLines\(cell\.sourcePlans\)\)/,
    );
    // Label: the same text, so keyboard and screen-reader users get what hover
    // gets. Without this the source lines would be a mouse-only affordance.
    expect(code).toContain("t('hudChrome.reliquary.cellMissingSourceAria', { name, source })");
    expect(code).toContain("t('hudChrome.reliquary.cellOwnedClearsAria'");
    // Resolved ONCE per cell (cellHtml), then handed to the label builder: the
    // fold goes through the locale list formatter, never punctuation this
    // painter spells itself.
    expect(code).toContain('reliquarySourceLines(cell.sourcePlans)');
    expect(code).toContain('reliquarySourceAriaText(sourceLines)');
    expect(code).not.toMatch(/\.join\(', '\)/);
    // An un-authored source renders nothing rather than an empty sentence.
    expect(code).toMatch(/source === ''\s*\?\s*t\('hudChrome\.reliquary\.cellMissingAria'/);
  });

  it('renders the authored page blurb on the header and the shelf row', () => {
    const code = stripComments(painter);
    expect(code).toContain('reliquaryPageDesc(page.pageId)');
    expect(code).toContain('reliquary-page-desc');
    expect(code).toContain('reliquary-page-sub');
    // The shelf sub-line truncates in CSS, never through a title attribute.
    expect(components).toContain('.reliquary-page-sub');
    expect(components).toMatch(/\.reliquary-page-sub \{[^}]*text-overflow: ellipsis;[^}]*\}/);
  });

  it('never uses a native title attribute for a tooltip', () => {
    // The recent chip carried the only title="" in this painter; the shared HUD
    // tooltip replaced it (a native tooltip is untranslatable chrome the HUD
    // cannot style, position, or dismiss on touch).
    expect(stripComments(painter)).not.toMatch(/\btitle="/);
    expect(painter).toContain('data-recent-name');
    expect(painter).toMatch(/data-recent-name[\s\S]*?attachTooltip/);
    // The chip must NOT truncate: it is a non-interactive span, so a hover
    // tooltip is the only way past an ellipsis or a clip, and a sighted
    // keyboard player has no pointer to fire it with. The name wraps inside
    // the width cap instead (nothing hidden; overflow-wrap covers the
    // unbreakable-compound case), and the tooltip stays a pointer nicety.
    // EVERY .reliquary-recent-name rule in both stylesheets is swept, so a
    // truncation cannot come back through a later rule, a media query, or
    // the mobile sheet (cascade blindness).
    const recentNameRules = [components, hudMobile].flatMap((sheet) => [
      ...sheet.matchAll(/\.reliquary-recent-name[^{}]*\{[^}]*\}/g),
    ]);
    expect(recentNameRules.length).toBeGreaterThanOrEqual(1);
    for (const [rule] of recentNameRules) {
      expect(rule).not.toContain('text-overflow');
      expect(rule).not.toContain('white-space: nowrap');
      expect(rule).not.toContain('overflow: hidden');
    }
    expect(recentNameRules.some(([rule]) => rule.includes('max-width: 160px'))).toBe(true);
    expect(recentNameRules.some(([rule]) => rule.includes('overflow-wrap: anywhere'))).toBe(true);
  });

  it('gives the page list real list semantics (ul/li, not bare buttons)', () => {
    // role="list" on a container whose children are bare <button>s announces an
    // empty list. The row stays a button INSIDE its own <li>.
    expect(painter).toMatch(/<ul class="reliquary-page-list" role="list"/);
    expect(painter).toContain('<li class="reliquary-page-item">');
    expect(painter).toMatch(/<li class="reliquary-page-item">[\s\S]*?class="reliquary-page-row"/);
    // list-style: none drops list semantics in Safari VoiceOver; the explicit
    // role above is the counterweight and must not be dropped with the ul.
    expect(components).toMatch(/\.reliquary-page-list \{[^}]*list-style: none;[^}]*\}/);
  });

  it('roves the grid with one tab stop through the shared roving core', () => {
    const code = stripComments(painter);
    expect(code).toContain("from './roving_index'");
    // 'both' is the 2D-grid orientation (Arrow Up/Down as well as Left/Right).
    expect(code).toContain("rovingTarget(ke.key, i, cells.length, 'both')");
    // Exactly one cell is tabbable; the roving move updates tabindex and focus.
    expect(code).toMatch(/tabindex="\$\{index === activeIndex \? '0' : '-1'\}"/);
    expect(code).toContain('this.stampGridTabIndex(cells)');
    expect(code).toContain('cells[next]?.focus()');
    // A rebuild that restores focus to a cell must move the tab stop with it,
    // or the restored cell would be focused while a different cell is the only
    // tab stop.
    // Every arm that repaints a DIFFERENT set of cells resets the cursor, not
    // just the chip: a stale index would leave the tab stop pointing at a slot
    // that no longer holds the relic the player was standing on. wire() has
    // four such arms (nav, filter, page, back) plus the search input.
    //
    // 6 to 8 in Phase 15: the two DEEP-LINK entries repaint a different set of
    // cells from outside wire() and so owe the same reset. A nav-bearing open()
    // drops the persisted page (a whole surface change), and openWithPage lands
    // on another page's grid entirely.
    expect(code.match(/this\.gridIndex = 0;/g)?.length).toBe(8);
    for (const arm of [
      /dataset\.nav[\s\S]*?this\.gridIndex = 0;/,
      /dataset\.filter[\s\S]*?this\.gridIndex = 0;/,
      /dataset\.page[\s\S]*?this\.gridIndex = 0;/,
      /\[data-back\][\s\S]*?this\.gridIndex = 0;/,
      /if \(nav !== undefined\) \{[\s\S]*?this\.gridIndex = 0;/,
      // Anchored INSIDE the gotoPage-success braces: the deep link resets the
      // cursor only on the arm that moved, so a reset hoisted above the guard
      // (running for an id that failed to resolve) must fail this pin.
      /openWithPage\(pageId: string\): void \{\s*if \(this\.gotoPage\(pageId\)\) \{\s*this\.gridIndex = 0;/,
    ]) {
      expect(code, String(arm)).toMatch(arm);
    }
    expect(code).toContain('this.syncGridRoving(el, focusKey)');
    // It matches the CAPTURED key, not the live activeElement: this painter
    // reaches for no browser global (the src/ui classification sweep), and a
    // Close-button fallback restore must not drag the grid cursor with it.
    expect(code).toContain("focusKey.startsWith('cell:')");
    expect(code).not.toMatch(/\bdocument\s*[.[]/);
  });

  it('threads search and the ownership filter through the pure core and the signature', () => {
    const code = stripComments(painter);
    expect(code).toContain('search: this.search.trim().toLocaleLowerCase(tag)');
    expect(code).toContain('ownedFilter: this.ownedFilter');
    // Filtering happens in the pure core against LOCALIZED text the painter
    // injects: a player searches the names their client shows them.
    expect(code).toContain(
      'relicSearchText: (kind, id) => reliquaryRelicSearchText(kind, id, tag)',
    );
    // Page text is name PLUS blurb, because the shelf row renders the blurb.
    expect(code).toMatch(
      /pageSearchText: \(pageId\) =>\s*`\$\{reliquaryPageName\(pageId\)\} \$\{reliquaryPageDesc\(pageId\)\}`\.toLocaleLowerCase\(tag\)/,
    );
    // One tag, derived from the live language, folding BOTH sides. Invariant
    // toLowerCase anywhere in this painter breaks Turkish dotted/dotless I.
    expect(code).toContain('const tag = languageTag(getLanguage())');
    expect(code).not.toMatch(/\.toLowerCase\(\)/);
    // Both are signature dimensions, or a keystroke would not repaint. Scoped
    // to the sigFromInput BODY: an unbounded [\s\S]*? span would happily match
    // a `search:` from buildInput above and a closing brace far below, so the
    // pin would pass with the dimension deleted from the sig call.
    const sigBody = code.match(/private sigFromInput\([\s\S]*?\n {2}\}/)?.[0];
    expect(sigBody, 'sigFromInput body').toBeTruthy();
    expect(sigBody).toContain('search: input.search');
    expect(sigBody).toContain('ownedFilter: input.ownedFilter');
    // The clears digest is fed BOTH meters. A secondary-only bump (an S-rank
    // clear with no ownership change) must move the signature, or an open page
    // header keeps painting the old number until something else repaints it.
    // Scoped to the same body, and matched on the CALL text so dropping the
    // argument reds here rather than only in the pure fold's own unit test.
    expect(sigBody).toMatch(
      /reliquaryClearsDigest\(\s*input\.pages,\s*input\.clearCount,\s*input\.secondaryClearCount,?\s*\)/,
    );
    // The chip value is re-validated before the cast (the DOM is untrusted).
    expect(code).toContain('isReliquaryOwnedFilter(filter) ? filter : ');
    expect(code).toContain('aria-pressed');
    expect(code).toContain('role="group"');
    // The caret survives the innerHTML rebuild, or typing jumps to the end.
    expect(code).toContain('fresh.setSelectionRange(caret.start, caret.end)');
  });

  it('builds every t() key from a literal, never a template plus a cast', () => {
    // A `t(\`hudChrome.reliquary.${x}\` as TranslationKey)` compiles whatever
    // the catalog says, so renaming a leaf stays green in tsc and throws at
    // runtime the first time that branch paints. The generated key union only
    // works if every key is a compile-time literal.
    // \b before the t, or the pattern also matches `byKey.set(`...${...}`)`:
    // "set(" ends in "t(" and there is no word boundary inside it.
    const code = stripComments(painter);
    expect(code).not.toMatch(/\bt\(`[^`]*\$\{/);
    expect(code).not.toMatch(/as TranslationKey\)/);
    expect(code).toContain("t('hudChrome.reliquary.searchEmpty')");
    expect(code).toContain("t('hudChrome.reliquary.shelfEmpty')");
    // Phase 14 Overview keys. The two strip hints and the reconciliation note
    // are the only copy on the Overview that is not a count, so each one is
    // pinned by its literal key rather than by the section that holds it.
    expect(code).toContain("'hudChrome.reliquary.recentEmpty'");
    expect(code).toContain("'hudChrome.reliquary.nearlyEmpty'");
    expect(code).toContain("t('hudChrome.reliquary.sharedUniquesNote')");
    // Phase 19: the standing border note. Gated on the DERIVED bridge, never a
    // literal rank 5, and it renders from the rank the player HOLDS (>=), so a
    // future rank 6 does not silently drop the line.
    expect(code).toContain("t('hudChrome.reliquary.borderWearableNote', {");
    expect(code).toContain('model.progress.curatorRank >= CURATOR_BORDER_REWARD.rank');
    expect(code).toContain('CURATOR_BORDER_REWARD !== null &&');
    // The interpolated Phase 14 keys ride the same literal rule.
    expect(code).toContain("t('hudChrome.reliquary.recentJumpAria', { name })");
    expect(code).toContain("t('hudChrome.reliquary.shelfNoFinds')");
    expect(code).toContain("t('hudChrome.reliquary.shelfRecent', {");
    expect(code).toContain("t('hudChrome.reliquary.shelfOpenAria', { name, owned, total })");
    // overviewEmpty was deleted with the strip hints that replaced it: the
    // painter must not resurrect a key the catalog no longer authors (the
    // catalog half of this pin lives in the i18n chrome suite below).
    expect(code).not.toContain('overviewEmpty');
  });

  it('decides "search is active" one way, on the TRIMMED needle', () => {
    // buildInput trims before filtering, so a whitespace-only needle filters
    // nothing. A site testing the untrimmed field would call that active and
    // swap in "no relics match" for a shelf that is empty for another reason.
    const code = stripComments(painter);
    expect(code).toContain("return this.search.trim() !== ''");
    // Three callers: the Overview empty line, the shelf empty line, and the
    // grid empty-state chooser. All must ask the same question, or two
    // surfaces disagree about whether a search is running. (The live-region
    // gate deliberately does NOT ask it: it gates on the model's own
    // narrowing answer, because a needle that matches everything narrows
    // nothing; see the announce pin below.)
    expect(code.match(/this\.searchActive\(\)/g)?.length).toBe(3);
    // No site may re-derive it inline and drift from the shared definition.
    expect(code).not.toMatch(/this\.search === ''/);
    expect(code).not.toMatch(/this\.search\.trim\(\) === ''/);
  });

  it('resets the search per visit but keeps the chip and place for the session', () => {
    const code = stripComments(painter);
    const closeBody = code.match(/\n {2}close\(\): void \{[\s\S]*?\n {2}\}/)?.[0];
    expect(closeBody, 'close() body').toBeTruthy();
    // A needle left from last visit would silently hide most of the catalog on
    // the next open, with the reason off-screen until the player looks up.
    expect(closeBody).toContain("this.search = ''");
    expect(closeBody).toContain('this.gridIndex = 0');
    // The other half: shelf, open page, and the ownership chip read as "where I
    // was", so they stay put (the deeds policy). Resetting them here would be
    // just as wrong in the other direction.
    expect(closeBody).not.toContain('this.ownedFilter =');
    expect(closeBody).not.toContain('this.nav =');
    expect(closeBody).not.toContain('this.pageId =');
  });

  it('describes the roving grid on the CELLS, where a description is announced', () => {
    const code = stripComments(painter);
    // role="list" is not a composite role, so nothing announces the arrow-key
    // model on its own. The role stays honest (no rows, no selection) and the
    // affordance is described instead. The description rides the CELL, not the
    // grid: aria-describedby on the focused element is reliably announced, on a
    // container that never takes focus it is not.
    const cellHtml = code.match(/private cellHtml\([\s\S]*?\n {2}(?:private|\/\*\*)/)?.[0];
    expect(cellHtml, 'cellHtml body').toBeTruthy();
    expect(cellHtml).toContain('aria-describedby="${GRID_HINT_ID}"');
    expect(cellHtml).toContain('aria-keyshortcuts="${GRID_KEY_SHORTCUTS}"');
    // The hint span still ships with the grid (it is what describedby targets).
    expect(code).toContain("t('hudChrome.reliquary.gridKeyboardHint')");
    expect(code).toContain(`id="\${GRID_HINT_ID}"`);
    // aria-keyshortcuts takes key VALUES, never localized prose, and must name
    // exactly the keys roving_index owns for orientation 'both'.
    expect(code).toContain("'ArrowLeft ArrowRight ArrowUp ArrowDown Home End'");
  });

  it('keeps the live region OUT of the rebuilt markup and re-appends the same node', () => {
    const code = stripComments(painter);
    // The load-bearing contract: a live region must be registered with the AT
    // BEFORE its text changes. Minting it inside the innerHTML string means a
    // brand-new node is created and mutated in one task, which does not reliably
    // announce (the #crafting-live precedent says the same). So the node is
    // class-held, created from the ROOT's document (never the `document`
    // global, which this painter must not touch), and re-appended each paint.
    expect(code).not.toMatch(/data-reliquary-live[^\n]*aria-live/);
    expect(code).toContain("el.ownerDocument.createElement('span')");
    expect(code).toContain('const live = this.ensureLiveRegion(el)');
    // The at-cap pin note rides the same re-append (class-held, root-document
    // minted): every refused pin control's aria-describedby must resolve on
    // every paint, so minting it inside the innerHTML string would orphan the
    // reference the AT already followed. (The behavioral half, node identity
    // across rebuilds, lives in reliquary_window_behavior.test.ts.)
    expect(code).toContain('el.append(live, this.ensureCapNote(el))');
    expect(code).not.toMatch(/\bdocument\s*[.[]/);
    // Two keystrokes narrowing to the SAME count must still re-read, which an
    // unchanged textContent will not do.
    expect(code).toContain("from './live_region_reannounce'");
    expect(code).toContain('this.liveReannounce.mark(text)');
    expect(code).toContain('this.liveReannounce.reset()');
  });

  it('announces on what the PAINTED surface narrowed, not the sticky chip', () => {
    const code = stripComments(painter);
    // ownedFilter survives a Back click, so gating on it would make every
    // slow-band repaint of the shelf announce a count nothing narrowed. EVERY
    // surface asks the model's own answer for THIS paint: the grid through
    // pageDetail.filtered, shelf and Overview through model.filtered (a
    // needle that matches everything narrows nothing and stays silent).
    // Whitespace-tolerant: the ternary wraps under the formatter. The nav
    // guard keeps a lingering unpainted pageId from answering for Overview.
    expect(code).toMatch(
      /const narrowed =\s*model\.nav !== 'overview' && model\.pageDetail \? model\.pageDetail\.filtered : model\.filtered/,
    );
    expect(code).not.toMatch(/this\.ownedFilter === 'all'\) return/);
    // The render that OPENS the window never announces: a persisted chip or
    // page is state the player left behind, not a narrowing they performed.
    // The assignment is asserted INSIDE open()'s own body (sliced to its
    // closing brace), not merely somewhere after its signature.
    expect(code).toContain('if (this.suppressAnnounceOnce)');
    const openBody = code.match(
      /\n {2}open\(nav\?: ReliquaryNavId\): void \{[\s\S]*?\n {2}\}/,
    )?.[0];
    expect(openBody, 'open() body').toBeTruthy();
    expect(openBody).toContain('this.suppressAnnounceOnce = true');
    // Not narrowed means the region is emptied AND the marker forgotten, or
    // re-narrowing to the same count later would stay silent.
    expect(code).toMatch(/if \(!narrowed\) \{[\s\S]*?live\.textContent = ''/);
    // Raw count to tPlural (Intl.PluralRules selects on it), formatted number
    // for display: passing the formatted string as the selector collapses every
    // locale onto the .other leaf.
    expect(code).toMatch(
      /tPlural\('hudChrome\.plurals\.reliquarySearchResults', count, \{\s*count: this\.fmt\(count\),/,
    );
  });

  it('picks the empty-state copy by cause: search, then filter, then genuinely empty', () => {
    const code = stripComments(painter);
    // Clicking Catalogued with nothing typed must not blame a search the
    // player never made: that sends them hunting for a search box to clear.
    const body = code.match(/private emptyGridText\([\s\S]*?\n {2}\}/)?.[0];
    expect(body, 'emptyGridText body').toBeTruthy();
    expect(body).toMatch(
      /if \(this\.searchActive\(\)\) return t\('hudChrome\.reliquary\.searchEmpty'\)/,
    );
    expect(body).toMatch(/filtered \|\| this\.ownedFilter !== 'all'[\s\S]*?filterEmpty/);
    expect(body).toContain("return t('hudChrome.reliquary.shelfEmpty')");
    expect(chrome).toContain("filterEmpty: 'No relics match this filter.'");
  });

  it('preserves scroll and restores focus across rebuilds', () => {
    expect(painter).toContain("el.querySelector('.reliquary-scroll')?.scrollTop");
    expect(painter).toContain('captureFocusKey');
    expect(painter).toContain('restoreFirstEnabled');
  });

  it('never imports Hud and never hardcodes the window id in the painter class surface', () => {
    expect(painter).not.toMatch(/from ['"]\.\/hud['"]/);
    expect(painter).toContain('root(): HTMLElement');
  });
});

describe('shared relic display-name ladder (reliquary_labels.ts)', () => {
  it('holds every relic-kind arm and reuses the existing name helpers', () => {
    // Family reuse: no bespoke key tables here, the shared mount / armory /
    // deed-title / item helpers each window already uses.
    expect(labels).toContain("from './mount_labels'");
    // NOT toContain('mountDisplayName'): that string now appears only in this
    // module's PROSE (the comment explaining why the shared helper is not used),
    // so the old pin was comment-satisfied and stayed green with the mount arm
    // deleted. Pin the guard that actually resolves a mount, on stripped code.
    expect(stripComments(labels)).toContain('Object.hasOwn(MOUNT_NAME_KEYS, id)');
    expect(stripComments(labels)).toContain('t(MOUNT_NAME_KEYS[id])');
    expect(labels).toContain('localizeWeaponSkin');
    expect(labels).toContain('deedTitleText');
    expect(labels).toContain('itemDisplayName');
    expect(labels).toMatch(/kind === 'mark'[\s\S]*?reliquaryMarkFindKey/);
    // The recent ring's wire-shaped 'unknown' kind still resolves as an item.
    expect(labels).toMatch(/kind === 'item' \|\| kind === 'unknown'/);
  });

  it('never humanizes an id and falls back to authored copy instead', () => {
    // The defect this module was extracted to kill: four separate ladders each
    // ending in `bare.replace(/_/g, ' ')`, which shipped a raw id as player
    // text (and a DIFFERENT raw id per site for a namespaced id). The only
    // sanctioned terminal is the authored unknownRelic key.
    const code = stripComments(labels);
    expect(code).not.toMatch(/replace\(\/_\/g/);
    expect(code).not.toMatch(/lastIndexOf\(':'\)/);
    expect(code).toContain("t('hudChrome.reliquary.unknownRelic')");
    expect(chrome).toContain("unknownRelic: 'Unrecorded relic'");
  });

  it('folds the HAYSTACK with the locale too, not just the needle', () => {
    // The painter pin covers the needle only. Reverting THIS module's fold to
    // plain toLowerCase left every other test in the repo green while breaking
    // Turkish search, because the behavioral cases all run under en. Both sides
    // of the comparison have to fold the same way for the match to hold.
    const code = stripComments(labels);
    expect(code).not.toMatch(/\.toLowerCase\(\)/);
    expect(code).toContain('toLocaleLowerCase(tag)');
  });

  it('confines its one name-property read to the self-localizing armory helper', () => {
    // The painter's `.name` budget is zero; this module inherits the single
    // sanctioned read, and it must stay that one. localizeWeaponSkin returns
    // an already-localized record, unlike a raw catalog def whose .name is
    // English.
    const code = stripComments(labels);
    expect(code.match(/\.name\b/g) ?? []).toEqual(['.name']);
    expect(code).toContain('localizeWeaponSkin(def).name');
  });

  it('reads every Record through ownEntry (prototype-key ids off the wire)', () => {
    const code = stripComments(labels);
    expect(code).toContain('ownEntry(ITEMS, id)');
    expect(code).toContain('ownEntry(WEAPON_SKINS, id)');
    // A bare index would resolve 'constructor' to a Function and render it.
    expect(code).not.toMatch(/\b(?:ITEMS|WEAPON_SKINS)\[/);
  });

  it('membership-guards EVERY source-line arm before it localizes', () => {
    // tEntity / dungeonDisplayName / zoneDisplayName / deedName all answer the
    // RAW ID for an id they cannot place (the R34 wire contract). Right for a
    // quest log, wrong here: the id gets spliced into prose and reads as
    // content. Every arm must check membership first and drop the line on a
    // miss, so a renamed or removed content id can never surface as text.
    const code = stripComments(labels);
    expect(code).toContain('ownEntry(MOBS, mobId)');
    expect(code).toContain('ownEntry(NPCS, npcId)');
    expect(code).toContain('ownEntry(DUNGEONS, dungeonId)');
    expect(code).toContain('ownEntry(DEEDS, deedId)');
    expect(code).toContain('ZONE_IDS.has(zoneId)');
    // The two-name arm degrades to the surviving AUTHORED half rather than
    // splicing a raw id: a stale page dungeon falls back to the plain boss
    // sentence, and a stale boss drops the line outright (the dungeon is page
    // context, not an authored door of the relic).
    expect(code).toMatch(/if \(boss === null\) return ''/);
    expect(code).toMatch(/if \(dungeon === null\) return t\('hudChrome\.reliquary\.sourceBoss'/);
  });

  it('composes each source-line arm through a t() key with named entity lookups', () => {
    // Key pins run on the COMMENT-STRIPPED source, like every scrape below: a
    // comment mentioning a key must never satisfy a pin about rendering it.
    const code = stripComments(labels);
    expect(code).toContain("t('hudChrome.reliquary.sourceBossDungeon'");
    expect(code).toContain("t('hudChrome.reliquary.sourceBoss'");
    expect(code).toContain("t('hudChrome.reliquary.sourceZone'");
    expect(code).toContain("t('hudChrome.reliquary.sourceProfession'");
    expect(code).toContain("t('hudChrome.reliquary.sourceDeed'");
    expect(code).toContain("t('hudChrome.reliquary.sourceVendor'");
    // The multi-source arms land on the same contract.
    expect(code).toContain("t('hudChrome.reliquary.sourceBossZone'");
    expect(code).toContain("t('hudChrome.reliquary.sourceDelve'");
    expect(code).toContain("t('hudChrome.reliquary.sourceRift'");
    expect(code).toContain("t('hudChrome.reliquary.sourceQuest'");
    expect(code).toContain("t('hudChrome.reliquary.sourceStore'");
    expect(code).toContain("'hudChrome.reliquary.sourceActivityCorpseHarvest'");
    expect(code).toContain("'hudChrome.reliquary.sourceActivityMasterworkCraft'");
    // Entity names come from the shared channels, never a raw content field.
    expect(code).toContain("tEntity({ kind: 'mob', id: mobId, field: 'name' })");
    expect(code).toContain('dungeonDisplayName(dungeonId)');
    expect(code).toContain('zoneDisplayName(zoneId)');
    expect(code).toContain('deedName(deedId)');
    expect(code).toContain("tEntity({ kind: 'npc', id: npcId, field: 'name' })");
    // Delve and quest names reuse the delve board's and the quest log's own
    // entity channels rather than minting a third naming ladder.
    expect(code).toContain("tEntity({ kind: 'delve', id: delveId, field: 'name' })");
    expect(code).toContain("tEntity({ kind: 'quest', id: questId, field: 'title' })");
    // Every new arm is membership-guarded before it localizes, exactly like the
    // original five (a stale id renders no line, never a raw id in prose).
    expect(code).toContain('ownEntry(DELVES, delveId)');
    expect(code).toContain('ownEntry(QUESTS, questId)');
    expect(code).toContain('RELIQUARY_RIFT_RANK_SOURCE_IDS');
    expect(code).toContain('RELIQUARY_ACTIVITY_SOURCE_IDS');
    expect(code).toContain('RELIQUARY_STORE_SOURCE_ID');
    // The bossZone pair composes when both halves resolve, degrades to the
    // surviving half's own sentence when one is stale (each half is an
    // authored hint the composition consumed), and drops only on both-stale.
    // All three behaviors pinned: the compose via the sourceBossZone key
    // above, both degrades, and the terminal both-stale ''.
    expect(code).toMatch(/if \(boss !== null\) return t\('hudChrome\.reliquary\.sourceBoss'/);
    expect(code).toMatch(
      /if \(zone !== null\) return t\('hudChrome\.reliquary\.sourceZone', \{ zone \}\);\s*\n\s*return '';/,
    );
    // The aria fold goes through the locale list formatter (Intl.ListFormat
    // via formatList), never a hardcoded separator or a bespoke join key.
    expect(code).toContain('formatList(lines)');
    expect(code).not.toMatch(/join\(', '\)/);
  });

  it('stays i18n-free in the pure core: the ARM choice is the core, the TEXT is here', () => {
    // reliquary_view.ts is a registered UI pure core whose header promises
    // DOM/Three/i18n-free. The source-line SPLIT is what keeps that true, so a
    // future edit must not move t() or an entity channel back into it.
    expect(view).toContain('export function reliquarySourceLinePlan');
    expect(view).not.toMatch(/from '\.\/(?:entity_i18n|deed_i18n|reliquary_i18n|mount_labels)'/);
    expect(view).not.toMatch(/^import \{[^}]*\bt\b[^}]*\} from '\.\/i18n'/m);
    expect(labels).toContain("from './reliquary_view'");
  });

  it('authors the Phase 13 English keys and fills all five non-Latin locales', () => {
    const NEW_KEYS = [
      'unknownRelic',
      'sourceBossDungeon',
      'sourceBoss',
      'sourceZone',
      'sourceProfession',
      'sourceDeed',
      'sourceVendor',
      'sourceBossZone',
      'sourceDelve',
      'sourceRift',
      'sourceQuest',
      'sourceStore',
      'sourceActivityCorpseHarvest',
      'sourceActivityMasterworkCraft',
      'cellMissingSourceAria',
      'cellOwnedClearsAria',
      'searchPlaceholder',
      'searchAria',
      'searchEmpty',
      'filterGroupAria',
      'filterAll',
      'filterOwned',
      'filterMissing',
      'filterEmpty',
      'gridKeyboardHint',
    ];
    // Comment-stripped like every scrape in this file: a commented-out key or
    // example fill line must never satisfy a presence or value pin.
    const chromeCode = stripComments(chrome);
    for (const key of NEW_KEYS) {
      expect(chromeCode, key).toContain(`${key}:`);
    }
    // M16: a wordy new English value needs its non-Latin fills in the SAME
    // change. i18n_completeness only sees a leak once en and the locale are
    // byte-identical; this pin fails on an omitted row directly.
    // The result-count announcement is CLDR-plural, so it is four leaves, and
    // ru genuinely needs one/few/many apart (1 реликвия / 2 реликвии / 5
    // реликвий). A single .other fill would read wrong for most counts.
    const PLURAL_LEAVES = ['one', 'few', 'many', 'other'];
    // Count-neutral noun: this one line serves the grid (relics), the shelf
    // (pages), and Overview (mixed entries), so naming any noun is wrong twice.
    for (const leaf of PLURAL_LEAVES) {
      expect(chromeCode, leaf).toMatch(new RegExp(`${leaf}: '\\{count\\} results?\\.'`));
    }
    // Reads a fill's VALUE, tolerating the line break biome inserts when a long
    // value wraps onto its own line. Key presence alone would pass on an empty
    // string, which is exactly what a half-finished fill leaves behind.
    const fillValue = (table: string, key: string): string | undefined =>
      table.match(new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*\\n?\\s*'([^']*)'`))?.[1];
    for (const locale of ['ja_JP', 'ko_KR', 'ru_RU', 'zh_CN', 'zh_TW']) {
      const table = stripComments(read(`../src/ui/i18n.locales/${locale}.ts`));
      for (const key of NEW_KEYS) {
        const value = fillValue(table, `hudChrome.reliquary.${key}`);
        expect(typeof value, `${locale} ${key} missing`).toBe('string');
        expect(value?.trim(), `${locale} ${key} empty`).not.toBe('');
      }
      for (const leaf of PLURAL_LEAVES) {
        const value = fillValue(table, `hudChrome.plurals.reliquarySearchResults.${leaf}`);
        expect(typeof value, `${locale} plural ${leaf} missing`).toBe('string');
        expect(value?.trim(), `${locale} plural ${leaf} empty`).not.toBe('');
      }
    }
    // Russian must not collapse its three count forms onto one string. Assert
    // each capture is a real string FIRST: a rewrap that broke the regex would
    // otherwise yield three undefineds, whose Set size is 1... and if the
    // distinctness check were the only assertion, three undefineds would look
    // like a failure for the wrong reason (or, with two forms, silently pass).
    const ru = read('../src/ui/i18n.locales/ru_RU.ts');
    const ruForms = PLURAL_LEAVES.slice(0, 3).map((leaf) =>
      fillValue(ru, `hudChrome.plurals.reliquarySearchResults.${leaf}`),
    );
    for (const [i, form] of ruForms.entries()) {
      expect(typeof form, `ru ${PLURAL_LEAVES[i]} did not parse`).toBe('string');
      expect(form?.trim(), `ru ${PLURAL_LEAVES[i]} empty`).not.toBe('');
    }
    expect(new Set(ruForms).size, `ru one/few/many were ${JSON.stringify(ruForms)}`).toBe(3);
  });

  it('authors the Phase 21 English keys and fills all five non-Latin locales', () => {
    // Same shape as the Phase 13 and 17 arms above, for the keys this phase
    // added: the two outside-completion chip words, the second clear meter, the
    // first-clear source sentence, and the 19 rare-slain markFind leaves. All
    // are short chip / label copy rather than plural bases, so each is one leaf.
    const FLAT_KEYS = [
      'retiredLabel',
      'personalLabel',
      'srankClearsLabel',
      'sourceActivityRiftFirstClear',
    ];
    const chromeCode = stripComments(chrome);
    for (const key of FLAT_KEYS) {
      expect(chromeCode, key).toContain(`${key}:`);
    }
    // The slain leaves are DERIVED from the live catalog rather than listed, so
    // a twentieth rare cannot ship a mark with no name in any language.
    const slainLeaves = [...RELIQUARY_MARK_IDS]
      .filter((id) => id.startsWith('slain:'))
      .map((id) => id.replace(/:/g, '_'))
      .sort();
    expect(slainLeaves.length, 'the live catalog carries the rare-slain proofs').toBe(19);
    for (const leaf of slainLeaves) {
      expect(chromeCode, leaf).toContain(`${leaf}:`);
    }
    // Reads a fill's VALUE, tolerating biome's wrap: key presence alone would
    // pass on the empty string a half-finished fill leaves behind.
    const fillValue = (table: string, key: string): string | undefined =>
      table.match(new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*\\n?\\s*'([^']*)'`))?.[1];
    for (const locale of ['ja_JP', 'ko_KR', 'ru_RU', 'zh_CN', 'zh_TW']) {
      const table = stripComments(read(`../src/ui/i18n.locales/${locale}.ts`));
      for (const key of FLAT_KEYS) {
        const value = fillValue(table, `hudChrome.reliquary.${key}`);
        expect(typeof value, `${locale} ${key} missing`).toBe('string');
        expect(value?.trim(), `${locale} ${key} empty`).not.toBe('');
      }
      for (const leaf of slainLeaves) {
        const value = fillValue(table, `hudChrome.reliquary.markFind.${leaf}`);
        expect(typeof value, `${locale} markFind.${leaf} missing`).toBe('string');
        expect(value?.trim(), `${locale} markFind.${leaf} empty`).not.toBe('');
      }
      // The two chip words must not collapse onto one string: Retired and
      // Personal name different reasons, and a copy-paste fill would make the
      // riftbound page read as retired content in that language.
      expect(
        fillValue(table, 'hudChrome.reliquary.retiredLabel'),
        `${locale} chip words collapsed`,
      ).not.toBe(fillValue(table, 'hudChrome.reliquary.personalLabel'));
    }
  });

  it('authors the Phase 17 obtain-count plurals and fills all five non-Latin locales', () => {
    // Three CLDR-plural bases, four leaves each: the tooltip line plus the two
    // owned aria arms it has to agree with. English genuinely inflects here
    // ("1 time" / "2 times"), unlike the count-neutral reliquaryToGo pair.
    const BASES = [
      'reliquaryObtainedTimes',
      'reliquaryCellOwnedObtainedAria',
      'reliquaryCellOwnedClearsObtainedAria',
    ];
    const PLURAL_LEAVES = ['one', 'few', 'many', 'other'];
    const chromeCode = stripComments(chrome);
    // English: the singular leaf really is singular, and the other three are
    // not. Pinning only key PRESENCE would pass on four identical leaves,
    // which is the exact regression a hand-copied plural block ships.
    expect(chromeCode).toMatch(/one: 'Obtained \{count\} time',/);
    for (const leaf of PLURAL_LEAVES.slice(1)) {
      expect(chromeCode, leaf).toMatch(new RegExp(`${leaf}: 'Obtained \\{count\\} times',`));
    }
    // The clear number rides its OWN slot in the combined aria arm: tPlural
    // owns {count} and selects on it, so reusing {count} for the clear would
    // silently inflect the sentence off the wrong number.
    expect(chromeCode).toContain('first found on clear {clears}, obtained {count} time');
    const fillValue = (table: string, key: string): string | undefined =>
      table.match(new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*\\n?\\s*'([^']*)'`))?.[1];
    for (const locale of ['ja_JP', 'ko_KR', 'ru_RU', 'zh_CN', 'zh_TW']) {
      const table = stripComments(read(`../src/ui/i18n.locales/${locale}.ts`));
      for (const base of BASES) {
        for (const leaf of PLURAL_LEAVES) {
          const key = `hudChrome.plurals.${base}.${leaf}`;
          const value = fillValue(table, key);
          expect(typeof value, `${locale} ${key} missing`).toBe('string');
          expect(value?.trim(), `${locale} ${key} empty`).not.toBe('');
          // Every leaf keeps the placeholders its English carries, or the
          // number the sentence is about vanishes from that locale.
          expect(value, `${locale} ${key} lost {count}`).toContain('{count}');
          if (base !== 'reliquaryObtainedTimes') {
            expect(value, `${locale} ${key} lost {name}`).toContain('{name}');
          }
          if (base === 'reliquaryCellOwnedClearsObtainedAria') {
            expect(value, `${locale} ${key} lost {clears}`).toContain('{clears}');
          }
        }
      }
    }
    // Russian inflects "раз" by count (1 раз / 2 раза / 5 раз), so its three
    // forms must stay apart on every base. Each capture is asserted to be a
    // real string first: three undefineds also have a Set size of 1, and would
    // otherwise fail (or pass) for the wrong reason.
    const ru = read('../src/ui/i18n.locales/ru_RU.ts');
    for (const base of BASES) {
      const forms = PLURAL_LEAVES.slice(0, 3).map((leaf) =>
        fillValue(ru, `hudChrome.plurals.${base}.${leaf}`),
      );
      for (const [i, form] of forms.entries()) {
        expect(typeof form, `ru ${base}.${PLURAL_LEAVES[i]} did not parse`).toBe('string');
        expect(form?.trim(), `ru ${base}.${PLURAL_LEAVES[i]} empty`).not.toBe('');
      }
      // one and few must differ (раз vs раза); many rejoins one, which is
      // correct Russian, so the pin is "at least two distinct forms".
      expect(new Set(forms).size, `ru ${base} was ${JSON.stringify(forms)}`).toBeGreaterThanOrEqual(
        2,
      );
      expect(forms[0], `ru ${base}: one and few must not collapse`).not.toBe(forms[1]);
    }
  });

  it('renders the obtain tally through ONE helper both owned tooltip branches call', () => {
    // The agreement contract, pinned at the source: the plain body and the
    // full-item-tooltip early return both append the line, and the label
    // carries it too. A branch that quietly dropped it would ship a tooltip
    // that loses a fact depending on whether the ItemDef resolved.
    const code = stripComments(painter);
    expect(code).toContain('private obtainedLineHtml(cell: ReliquaryGridCellModel): string');
    expect(code.match(/this\.obtainedLineHtml\(cell\)/g)?.length, 'both owned branches').toBe(2);
    expect(code).toMatch(/body \+= this\.obtainedLineHtml\(cell\);/);
    expect(code).toMatch(/html \+= this\.obtainedLineHtml\(cell\);/);
    // CLDR selection on the RAW count, with the DISPLAY value interpolated:
    // selecting on a formatted string collapses every locale onto .other.
    expect(code).toContain(
      "tPlural('hudChrome.plurals.reliquaryObtainedTimes', count, { count: this.fmt(count) })",
    );
    expect(code).toContain("tPlural('hudChrome.plurals.reliquaryCellOwnedObtainedAria', count, {");
    expect(code).toContain(
      "tPlural('hudChrome.plurals.reliquaryCellOwnedClearsObtainedAria', count, {",
    );
    // Absent means "cannot say" (traded, mailed, bought): no line, no zero.
    expect(code).toMatch(/if \(count === undefined\) return '';/);
  });
});

describe('hud orchestration', () => {
  it('constructs ReliquaryWindow with windowFocus and thin toggle', () => {
    expect(hud).toContain('new ReliquaryWindow({');
    expect(hud).toContain("root: () => $('#reliquary-window')");
    expect(hud).toContain("...this.windowFocus('#reliquary-window')");
    expect(hud).toContain('toggleReliquary(): void');
    expect(hud).toContain('this.reliquaryWindow.toggle()');
  });

  it('polls refreshIfChanged on the slow band when open', () => {
    expect(hud).toContain(
      'if (slowHud && this.reliquaryWindow.isOpen) this.reliquaryWindow.refreshIfChanged()',
    );
  });

  it('closes via Esc managed-window case and re-renders on language switch', () => {
    expect(hud).toContain("case 'reliquary-window':");
    expect(hud).toContain('this.reliquaryWindow.close()');
    expect(hud).toContain('if (this.reliquaryWindow.isOpen) this.reliquaryWindow.render()');
  });

  it('wires minimap click and keybind label', () => {
    expect(hud).toContain(
      "$('#mm-reliquary')?.addEventListener('click', () => this.toggleReliquary())",
    );
    expect(hud).toContain("['#mm-reliquary', 'reliquary', 'hudChrome.reliquary.title']");
  });
});

describe('keybind and input dispatch', () => {
  it('defaults to Shift+KeyX adjacent to deeds', () => {
    expect(keybindsSrc).toContain("id: 'reliquary'");
    expect(keybindsSrc).toContain("defaults: ['Shift+KeyX']");
  });

  it('routes through input and main onUiKey', () => {
    expect(inputSrc).toContain("| 'reliquary'");
    expect(inputSrc).toContain("case 'reliquary':");
    expect(mainSrc).toContain("case 'reliquary':");
    expect(mainSrc).toContain('hud.toggleReliquary()');
  });

  it('binds the mobile More tray entry', () => {
    expect(mobileControlsSrc).toContain('onReliquary(): void');
    expect(mobileControlsSrc).toContain(
      "this.bindButton('mobile-reliquary', () => this.callbacks.onReliquary())",
    );
    expect(mainSrc).toContain('onReliquary: () => hud.toggleReliquary()');
  });
});

describe('entry HTML and i18n chrome', () => {
  it('ships the window shell and launchers in both entry HTMLs', () => {
    for (const [name, html] of [
      ['index.html', indexHtml],
      ['play.html', playHtml],
    ] as const) {
      expect(html, name).toContain('id="reliquary-window"');
      expect(html, name).toMatch(
        /id="mm-reliquary"[^>]*data-i18n-title="hudChrome\.reliquary\.title"/,
      );
      expect(html, name).toContain('id="mobile-reliquary"');
      expect(html, name).toContain('data-i18n="hudChrome.mobile.reliquary"');
    }
  });

  it('authors English hudChrome.reliquary keys', () => {
    expect(chrome).toContain('reliquary: {');
    expect(chrome).toContain("title: 'The Reliquary'");
    expect(chrome).toContain("navOverview: 'Overview'");
    expect(chrome).toContain("navConquerors: 'Conquerors'");
    expect(chrome).toContain("curatorUnranked: 'Unranked Curator'");
    expect(chrome).toContain("nearlyLabel: 'Nearly complete:'");
    expect(chrome).toContain("clearsLabel: '{count} clears'");
    expect(chrome).toContain("reliquary: 'Reliquary'");
    // Phase 5 live UX chrome.
    expect(chrome).toContain("unlockToast: 'Relic catalogued: {name}'");
    expect(chrome).toContain("illuminateBanner: 'Page illuminated: {name}'");
    expect(chrome).toContain("illuminateToast: 'Every relic on {name} is filled.'");
    expect(chrome).toContain("ownedTooltipStatus: 'Catalogued in The Reliquary'");
    expect(chrome).toContain("missingTooltipStatus: 'Not yet found'");
    expect(chrome).toContain("firstFindClears: 'First found on clear {count}'");
    expect(chrome).toContain("gridAria: 'Relics on {name}'");
    // Phase 6 Curator rank chrome.
    expect(chrome).toContain("curatorRankName1: 'Apprentice Curator'");
    expect(chrome).toContain("curatorRankName2: 'Spoilskeeper'");
    expect(chrome).toContain("curatorRankName3: 'Master Curator'");
    expect(chrome).toContain("curatorRankName4: 'Grand Curator'");
    expect(chrome).toContain("curatorRankName5: 'Eternal Curator'");
    expect(chrome).toContain("rankUpBanner: 'Curator rank {rank}: {name}'");
    expect(chrome).toContain("rankUpToast: 'Curator rank {rank} reached: {name}'");
    // Phase 19: ONE key for both surfaces that say the border is wearable (the
    // rank-up chat line and the standing Overview note), so they cannot drift.
    expect(chrome).toContain(
      "borderWearableNote: 'The {name} border can be worn from the Book of Deeds.'",
    );
    // Phase 7 profession mark find labels.
    expect(chrome).toContain('markFind: {');
    expect(chrome).toContain("masterwork_first: 'First Masterwork'");
    expect(chrome).toContain("gather_event_pristine_vein: 'Pristine Vein'");
    // Phase 8 Horizons account-scope chrome.
    expect(chrome).toContain("navHorizons: 'Horizons'");
    expect(chrome).toContain("accountScopeBadge: 'Account'");
    expect(chrome).toContain(
      "accountScopeNote: 'Account collection: unlocked across every character on this account.'",
    );
    // Phase 14 Overview chrome: the jump aria, the strip hints, the two shelf
    // card lines, the card's own aria, and the shared-uniques reconciliation.
    // Full key-and-value literals, never bare key names: recentJumpAria
    // already exists under hudChrome.deeds too, so a bare-name pin can be
    // satisfied by the wrong section.
    expect(chrome).toContain("recentJumpAria: 'Open the page for {name}'");
    expect(chrome).toContain(
      "recentEmpty: 'No finds yet. Relics you catalogue from now on land here.'",
    );
    expect(chrome).toContain("nearlyEmpty: 'Pages within reach of completion gather here.'");
    expect(chrome).toContain("stripNoMatch: 'Nothing here matches your search.'");
    expect(chrome).toContain("shelfRecent: 'Latest find: {name}'");
    expect(chrome).toContain("shelfNoFinds: 'Nothing catalogued on this shelf yet.'");
    expect(chrome).toContain("shelfOpenAria: 'Open the {name} shelf, {owned} of {total} filled'");
    expect(chrome).toContain("'Your overall total counts each relic once; shelf and page counts");
    // And the plural base the nearly row's "to go" readout selects on: a flat
    // key here would read wrong at count 1 in every inflecting locale.
    expect(chrome).toContain('reliquaryToGo: {');
  });

  it('keeps the retired overviewEmpty key deleted, the pageStubNote precedent', () => {
    // Phase 14 replaced the one Overview blurb with the two per-strip hints
    // that sit next to the label each explains. A key with no render site is
    // dead weight every locale still has to carry, so it was removed end to
    // end (catalog, five overlays, regenerated bundles) exactly the way
    // pageStubNote was in Phase 11.
    //
    // Premise first: the keys that REPLACED it are really authored (full
    // literals, so the wrong section cannot satisfy them), so this pin cannot
    // pass on a catalog that simply lost the whole section.
    expect(chrome).toContain(
      "recentEmpty: 'No finds yet. Relics you catalogue from now on land here.'",
    );
    expect(chrome).toContain("nearlyEmpty: 'Pages within reach of completion gather here.'");
    expect(chrome).not.toContain('overviewEmpty');
  });

  it('authors a markFind leaf for every catalogued Reliquary mark id', () => {
    // Dynamic t() keys use as TranslationKey; this pin fails if catalog grows
    // without a matching hudChrome.reliquary.markFind leaf.
    for (const markId of RELIQUARY_MARK_IDS) {
      const leaf = markId.replace(/:/g, '_');
      expect(chrome, markId).toContain(`${leaf}:`);
    }
  });

  it('wires reliquaryUnlock presentation through the pure plan (no membership invent)', () => {
    expect(hud).toContain("case 'reliquaryUnlock':");
    expect(hud).toContain('handleReliquaryUnlocks');
    // Comment-stripped body of handleReliquaryUnlocks: reduced-motion and plan
    // application must not be hard-coded away.
    const handler = hud
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n')
      .match(/private handleReliquaryUnlocks\([\s\S]*?\n {2}private handleDeedUnlocks/)?.[0];
    expect(handler, 'handleReliquaryUnlocks body').toBeTruthy();
    expect(handler).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(handler).toContain('buildReliquaryUnlockPlan(events, reducedMotion)');
    // Plan fields must actually drive presentation (not only plan.motion token).
    expect(handler).toContain('for (const log of plan.logs)');
    expect(handler).toContain('plan.banner');
    expect(handler).toContain("t('hudChrome.reliquary.unlockToast'");
    expect(handler).toContain("t('hudChrome.reliquary.illuminateBanner'");
    expect(handler).toContain("t('hudChrome.reliquary.illuminateToast'");
    expect(handler).toContain("t('hudChrome.reliquary.rankUpBanner'");
    // Phase 13: BOTH unlock ladders (the per-log chat line and the celebration
    // banner) resolve through the one shared resolver. Two calls exactly, so a
    // future edit cannot quietly reintroduce a second inline ladder beside it.
    expect(handler?.match(/reliquaryRelicDisplayName\(/g)?.length).toBe(2);
    // The humanized fallback each ladder used to carry is what made
    // `mount:swift_gryphon` print differently in the log than on the banner.
    // Neither the namespace strip nor the underscore-to-space surgery may
    // return: with them gone, the two sites cannot drift apart again.
    expect(handler).not.toMatch(/replace\(\/_\/g/);
    expect(handler).not.toMatch(/lastIndexOf\(':'\)/);
    expect(handler).toContain("t('hudChrome.reliquary.rankUpToast'");
    expect(handler).toContain("banner.kind === 'rankUp'");
    // Phase 19: the rank whose bridge rewards a border logs a second line
    // naming it. Gated on the derived bridge and on EQUALITY with that rank
    // (the moment fires once, unlike the standing Overview note), and the deed
    // name is resolved through deed_i18n rather than printing a reward slug.
    expect(handler).toContain("t('hudChrome.reliquary.borderWearableNote', {");
    expect(handler).toContain('banner.rank === CURATOR_BORDER_REWARD.rank');
    expect(handler).toContain('name: deedName(CURATOR_BORDER_REWARD.deedId),');
    // On-join catch-up: one localized summary line off plan.retroCount, the
    // deeds idiom (tests/deeds_window.test.ts pins its sibling the same way).
    // One regex, so the guard and its body cannot drift apart: two independent
    // toContain calls would still pass with the summary line moved outside the
    // count check, which puts a toast per seeded relic back in a veteran's
    // chat pane. The RAW plan.retroCount is the second argument on purpose: it
    // is what tPlural feeds Intl.PluralRules, so pinning it stops a refactor
    // from passing the pre-formatted string and collapsing every locale onto
    // the .other leaf ("1 relics catalogued" again).
    expect(handler).toMatch(
      /if \(plan\.retroCount > 0\) \{\s*const retroText = tPlural\(\s*'hudChrome\.plurals\.reliquaryRetroSummary',\s*plan\.retroCount,/,
    );
    // The display override: the visible number stays locale-formatted through
    // formatNumber even though the selection arg above is the raw count.
    expect(handler).toContain('count: formatNumber(plan.retroCount, { maximumFractionDigits: 0 })');
    // The regex above proves the line is BUILT; these prove it is DELIVERED.
    // handler is already the reliquary body sliced before handleDeedUnlocks,
    // so the deeds sibling's identical pushes cannot satisfy them. Without
    // this, deleting the two display calls keeps every suite and tsc green
    // (noUnusedLocals is off) while a veteran's one catch-up line vanishes:
    // the deeds sibling pins its emission (tests/deeds_window.test.ts) and
    // the reliquary side must too.
    expect(handler).toContain("this.log(retroText, '#ffd100');");
    expect(handler).toContain('this.combatAnnouncer.push(retroText, performance.now());');
    // Exactly the live-find banner push plus the retro push: a stray or
    // duplicated announcement cannot hide (the deeds sibling pins the same).
    expect(handler?.match(/combatAnnouncer\.push/g)?.length).toBe(2);
    // Phase 15: a relic gain in chat is ONE CLICK from its Reliquary page.
    // Four node-built lines, no more and no fewer: the per-relic unlock, the
    // durable Illumination line (rank-up owns the banner), the Illumination
    // line from the banner branch itself, and the curator rank-up. The count
    // is what stops the known single-site conversion trap, where only one of
    // the two illuminateToast emitters gets its link and the other silently
    // stays plain prose. The two ladder counts above are unchanged by this
    // conversion (the name resolvers and the announcer pushes did not move).
    expect(handler?.match(/this\.logNodes\(/g)?.length).toBe(4);
    expect(handler?.match(/deedLineNodes\(/g)?.length).toBe(4);
    expect(handler?.match(/deedChatLinkEl\(/g)?.length).toBe(4);
    // Every converted template renders its name slot to the sentinel, or
    // deedLineNodes has nothing to split on and the link lands appended at the
    // end of the sentence in every locale.
    expect(handler).toContain("t('hudChrome.reliquary.unlockToast', { name: DEED_NAME_TOKEN })");
    expect(handler).toContain(
      "t('hudChrome.reliquary.illuminateToast', { name: DEED_NAME_TOKEN })",
    );
    expect(handler).toMatch(
      /rankUpToast',\s*\{\s*rank: formatNumber\(banner\.rank\),\s*name: DEED_NAME_TOKEN,\s*\}/,
    );
    // Where each family lands. The relic line jumps to the page holding the
    // relic, resolved through the SHARED recent-strip resolver rather than a
    // second ladder that could drift; both Illumination lines jump to the page
    // that filled; the rank line opens Overview, the one surface that shows the
    // seal (open('overview') now clears a persisted off-shelf page).
    expect(handler).toContain('const pageIndex = reliquaryRelicPageIndex(RELIQUARY_PAGES);');
    // Phase 17: the resolver reads the catalog index alone (the stored
    // first-find pageId hint is gone), so the handler no longer threads
    // this.sim.reliquaryFirstFind through it.
    expect(handler).not.toContain('this.sim.reliquaryFirstFind');
    expect(handler).toContain('const pageId = reliquaryRelicPageId(pageIndex, log.id);');
    expect(handler).toContain(
      'deedChatLinkEl(document, name, () => this.reliquaryWindow.openWithPage(pageId))',
    );
    expect(handler?.match(/openWithPage\(jumpId\)/g)?.length).toBe(2);
    expect(handler).toContain(
      "deedChatLinkEl(document, rankName, () => this.reliquaryWindow.open('overview'))",
    );
    // A relic the catalog no longer places keeps a PLAIN line: a link that
    // opens nothing is worse than no link (the recent strip's inert chip).
    expect(handler).toMatch(
      /if \(pageId === null\) \{\s*this\.log\(t\('hudChrome\.reliquary\.unlockToast', \{ name \}\), '#ffd100'\);\s*continue;\s*\}/,
    );
    // The retro catch-up summary stays plain by design (it names no single
    // relic to jump to), so nothing after the retroCount gate may go node-built.
    expect(handler).not.toMatch(/plan\.retroCount > 0[\s\S]*logNodes/);
    // Shared key table (window export) so toast/banner cannot desync from Overview.
    expect(hud).toContain('curatorRankNameKey');
    // Pure-core definition (view) + re-export from the painter for existing imports.
    expect(view).toContain('export function curatorRankNameKey');
    expect(painter).toMatch(/export\s*\{[^}]*curatorRankNameKey/);
    // Illumination log still fires when rank-up owns the banner slot.
    expect(handler).toContain('plan.illuminatedPageId');
    // Both page-name surfaces resolve the LOCALIZED name from the id: the
    // durable illumination log (which fires when rank-up owns the banner) and
    // the illuminate banner itself. Reading a name off the event or the view
    // model instead would print catalog English inside a localized client, and
    // nothing else in this suite would notice.
    expect(handler).toContain('reliquaryPageName(plan.illuminatedPageId)');
    expect(handler).toContain('reliquaryPageName(banner.pageId)');
    expect(handler).toContain("showCelebrationBanner(bannerText, 'deed', 'deed', plan.motion)");
    expect(handler).toContain('if (plan.playSound) audio.achievement()');
    // Force an immediate open-window refresh on unlock; membership still comes
    // from mirrors. refreshIfChanged and NEVER bare render(): the prebuilt
    // input path is what classifies the repaint as world-driven, so an unlock
    // that leaves the announced count unchanged keeps the live region silent.
    // A bare render() here reads as player-driven and re-announces "N
    // results." for an event the player never asked about (the Phase 13 QA
    // regression that motivated this pin).
    expect(handler).toContain('plan.refreshWindow && this.reliquaryWindow.isOpen');
    expect(handler).toContain('this.reliquaryWindow.refreshIfChanged()');
    expect(handler).not.toContain('this.reliquaryWindow.render()');
    // Phase 14: the two celebration one-shots are ARMED on this drain, keyed
    // and gated exactly. The flash key is kind:id (the grid-cell key; a bare
    // id would collide across un-namespaced kinds) and the illumination stays
    // null-guarded. One regex each proves the arming happens BEFORE the
    // refresh inside the same isOpen block: consumed-by-render one-shots
    // armed after it would ride the NEXT repaint, not the one that shows the
    // fill, and deleting either call keeps every other pin green.
    expect(handler).toContain(
      'this.reliquaryWindow.flashRelics(plan.logs.map((log) => reliquaryFlashKey(log.kind, log.id)));',
    );
    expect(handler).toMatch(
      /if \(plan\.illuminatedPageId !== null\) \{\s*this\.reliquaryWindow\.celebrateIllumination\(plan\.illuminatedPageId\);\s*\}/,
    );
    expect(handler).toMatch(
      /flashRelics[\s\S]*celebrateIllumination[\s\S]*this\.reliquaryWindow\.refreshIfChanged\(\)/,
    );
    // Presentation-only: never write discovery / firstFind from the event.
    expect(handler).not.toMatch(/itemsDiscovered\.(add|has)/);
    expect(handler).not.toMatch(/reliquaryFirstFind\s*=/);
  });

  it('paints named rank + seal chrome from live progress (not a dead placeholder)', () => {
    // Comment-stripped summaryHtml must use named rank keys and seal attrs.
    const summary = painter
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n')
      .match(/private summaryHtml\([\s\S]*?\n {2}private railHtml/)?.[0];
    expect(summary, 'summaryHtml body').toBeTruthy();
    expect(summary).toContain('curatorRankNameKey(p.curatorRank)');
    expect(summary).toContain('p.curatorSealId');
    expect(summary).toContain('data-seal=');
    expect(summary).toContain('reliquary-rank-seal');
    expect(summary).toContain("t('hudChrome.reliquary.curatorUnranked')");
  });

  it('maps the reliquary keybind action through t() in Options', () => {
    // Without this entry, Options/gamepad fall back to raw English BIND_ACTIONS labels.
    expect(optionsWindow).toContain("reliquary: 'hudChrome.reliquary.title'");
  });
});

describe('styles and architecture registration', () => {
  it('has a desktop ten-dash section banner and mobile full-bleed rules', () => {
    expect(components).toContain('/* ---------- reliquary ---------- */');
    expect(components).toContain('#reliquary-window');
    // Scope CSS pins to the Reliquary ten-dash section (not whole components.css).
    const reliquaryStart = components.indexOf('/* ---------- reliquary ---------- */');
    const nextSection = components.indexOf('/* ----------', reliquaryStart + 20);
    expect(reliquaryStart).toBeGreaterThanOrEqual(0);
    expect(nextSection).toBeGreaterThan(reliquaryStart);
    const reliquaryCss = components.slice(reliquaryStart, nextSection);
    expect(reliquaryCss).toContain('#reliquary-window');
    expect(reliquaryCss).toContain('.reliquary-grid');
    expect(reliquaryCss).toContain('.reliquary-cell--missing');
    expect(reliquaryCss).toContain('.reliquary-cell--owned');
    // Phase 16 (+QA round): missing cells with OPAQUE art (Armory cards,
    // category-fallback crests) silhouette with grayscale plus a gentler
    // darken (the item treatment reads as a black tile on self-backgrounded
    // art). Keyed on the resolver-stamped data-cell-art attribute, never a
    // kind literal. Declaration-level pin so an emptied block reds; the
    // markup join lives in reliquary_cell_art.test.ts and reads THIS selector
    // out of the live stylesheet.
    expect(reliquaryCss).toContain('.reliquary-cell--missing[data-cell-art="opaque"] .item-icon');
    expect(reliquaryCss).toMatch(
      /\.reliquary-cell--missing\[data-cell-art="opaque"\] \.item-icon \{\s*filter: grayscale\(1\)/,
    );
    // Forced-colors arm: the silhouette filters drop and the missing state
    // gains a dashed border (box-shadow is stripped in forced colors, so the
    // owned ring cannot carry the distinction there). Content-bound through
    // the OPAQUE selector, the filter reset, and the dashed cue: a bare
    // media-query existence check would stay green with an emptied block,
    // and the second selector is load-bearing (the opaque rule is one
    // specificity rung above the plain missing rule, so without an
    // equal-specificity reset inside the media block the opaque cells would
    // keep grayscale in forced-colors mode).
    // One regex binds BOTH selectors to the declaration (dropping either
    // selector, or the declaration, reds; the plain-missing arm is the
    // larger population: every non-opaque cell). The block is then sliced
    // to its own closing brace so hoisting the rules OUT of the media query
    // (leaving it empty) cannot keep these green.
    expect(reliquaryCss).toMatch(
      /@media \(forced-colors: active\) \{\s*\.reliquary-cell--missing \.item-icon,\s*\.reliquary-cell--missing\[data-cell-art="opaque"\] \.item-icon \{\s*filter: none;/,
    );
    const fcStart = reliquaryCss.indexOf('@media (forced-colors: active) {');
    expect(fcStart).toBeGreaterThanOrEqual(0);
    const fcEnd = reliquaryCss.indexOf('\n  }', fcStart);
    expect(fcEnd).toBeGreaterThan(fcStart);
    const fcBlock = reliquaryCss.slice(fcStart, fcEnd + 4);
    expect(fcBlock).toContain('filter: none;');
    expect(fcBlock).toMatch(/\.reliquary-cell--missing \{\s*border-style: dashed;/);
    // Phase 6 seal chrome (cosmetic ranks).
    expect(reliquaryCss).toContain('.reliquary-rank-seal');
    expect(reliquaryCss).toContain('data-seal="apprentice"');
    expect(reliquaryCss).toContain('data-seal="keeper"');
    expect(reliquaryCss).toContain('data-seal="master"');
    expect(reliquaryCss).toContain('data-seal="grand"');
    expect(reliquaryCss).toContain('data-seal="eternal"');
    expect(reliquaryCss).toContain('prefers-reduced-motion: reduce');
    // Declaration-level reduced-motion pins: a bare existence check on the
    // media query would stay green with an emptied block, silently dropping
    // the static-frame arm the acceptance criterion names. Both one-shots
    // must swap their animation off AND the celebrate frame must keep a
    // static gold ring inside the reduce block.
    // Content-bound, not position-bound: [^@] cannot cross into a later media
    // block, so each pattern binds to whichever reduce block actually contains
    // the celebration rules, and authoring an unrelated reduce query earlier
    // in the section cannot re-anchor these pins onto the standing rules.
    expect(reliquaryCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^@]*?\.reliquary-page-detail\.reliquary-page-celebrate \{[^}]*animation: none;[^}]*box-shadow:/,
    );
    expect(reliquaryCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^@]*?\.reliquary-cell-flash \{[^}]*animation: none;/,
    );
    expect(hudMobile).toContain('body.mobile-touch #reliquary-window');
    expect(hudMobile).toContain('env(safe-area-inset-left)');
    expect(hudMobile).toContain('body.mobile-touch #reliquary-window .reliquary-grid');
  });

  it('names no undefined pseudo-token in the reliquary section', () => {
    // These four names were defined in NO stylesheet and in NO themeCssVars
    // emit, so every var(--x, literal) painted its fallback and the section
    // shipped one name (--color-surface-inset) carrying two different values.
    // var(--x, literal) is migration debt per DESIGN.md; an undefined name is
    // worse, because it reads like a themeable token and can never be themed.
    const reliquaryCss = sectionCss('reliquary');
    for (const dead of [
      '--color-surface-inset',
      '--color-surface-hover',
      '--color-border-active',
      '--color-surface-active-top',
    ]) {
      expect(reliquaryCss, dead).not.toContain(`var(${dead}`);
    }
    // Whole-repo check, so the fix cannot be "move them somewhere else": a
    // name may come back only once something actually DEFINES it.
    const definesToken = (name: string) =>
      new RegExp(`^\\s*${name}\\s*:`, 'm').test(read('../src/styles/tokens.css')) ||
      read('../src/ui/theme.ts').includes(`'${name}'`);
    for (const dead of [
      '--color-surface-inset',
      '--color-surface-hover',
      '--color-border-active',
      '--color-surface-active-top',
    ]) {
      if (components.includes(`var(${dead}`)) {
        expect(definesToken(dead), `${dead} is consumed but defined nowhere`).toBe(true);
      }
    }
    // Semantic colours still come from real tokens (the focus ring above all).
    expect(reliquaryCss).toContain('var(--color-border-focus)');
    expect(reliquaryCss).toContain('var(--color-border-showcase)');
  });

  it('tells no cursor lie: only elements with a handler get the pointer', () => {
    const reliquaryCss = sectionCss('reliquary');
    // A grid cell is focusable and hoverable but has NO click handler; the
    // pointer cursor promised an action that does not exist.
    const cellRule = reliquaryCss.match(/\n {2}\.reliquary-cell \{[^}]*\}/)?.[0];
    expect(cellRule, '.reliquary-cell rule').toBeTruthy();
    expect(cellRule).not.toContain('cursor:');
    expect(stripComments(painter)).not.toMatch(
      /reliquary-cell[\s\S]{0,400}?addEventListener\('click'/,
    );
    // Hover still reads (it opens the tooltip), so it gets a keyline, and no
    // transform: a scale on hover/focus is banned in this family.
    expect(reliquaryCss).toContain('.reliquary-cell:hover');
    expect(reliquaryCss).not.toMatch(/:(?:hover|focus-visible) \{[^}]*transform:/);
    // Everything that IS clickable keeps its pointer and a hover state.
    for (const clickable of ['.reliquary-nav', '.reliquary-page-row', '.reliquary-filter-chip']) {
      expect(reliquaryCss, clickable).toContain(`${clickable}:hover`);
    }
  });

  it('styles the header count as a demoted readout and the search at the iOS floor', () => {
    const reliquaryCss = sectionCss('reliquary');
    // .reliquary-count is emitted by the painter and previously had NO rule at
    // all, so the owned/total pair inherited the summary's title styling and
    // competed with the window title.
    expect(painter).toContain('class="reliquary-count"');
    const countRule = reliquaryCss.match(/\.reliquary-count \{[^}]*\}/)?.[0];
    expect(countRule, '.reliquary-count rule').toBeTruthy();
    expect(countRule).toContain('font-size: 11px');
    expect(countRule).toContain('var(--color-text-muted)');
    // A sub-16px search input makes iOS Safari zoom the window on focus.
    const searchRule = reliquaryCss.match(/\.reliquary-search \{[^}]*\}/)?.[0];
    expect(searchRule, '.reliquary-search rule').toBeTruthy();
    expect(searchRule).toContain('font-size: 16px');
    // Touch floors survive for every new interactive control.
    expect(reliquaryCss).toMatch(
      /body\.mobile-touch \.reliquary-filter-chip \{[^}]*min-height: 40px;[^}]*\}/,
    );
    // The chip row sits in a flex COLUMN (.reliquary-page-detail); without
    // flex: none it shrinks under pressure, the way its deeds twin does not.
    const bar = reliquaryCss.match(/\.reliquary-filterbar \{[^}]*\}/)?.[0];
    expect(bar, '.reliquary-filterbar rule').toBeTruthy();
    expect(bar).toContain('flex: none');
    expect(bar).toContain('padding-top: 6px');
  });

  it('registers the pure core in UI_PURE_CORES', () => {
    expect(architecture).toContain("'src/ui/reliquary_view.ts'");
  });

  it('binds the outside-completion chip rules to the markup they must reach', () => {
    // The selector-reach direction of the css-class-presence trap: both chip
    // rules are COMPOUND (.reliquary-complete-badge[data-retired]), so the
    // painter must emit the class and the reason hook on one element and the
    // declarations must live in this section. Dropping either half leaves the
    // chip wearing the celebratory gold these rules exist to prevent, with
    // every attribute-only query still green.
    const reliquaryCss = sectionCss('reliquary');
    const mutedRule = reliquaryCss.match(
      /\.reliquary-complete-badge\[data-retired\],\s*\.reliquary-complete-badge\[data-personal\] \{[^}]*\}/,
    )?.[0];
    expect(mutedRule, 'the muted chip rule (both reasons, one selector list)').toBeTruthy();
    expect(mutedRule).toContain('var(--color-text-muted)');
    const optOut = reliquaryCss.match(
      /\.reliquary-page-detail\.is-illuminated \.reliquary-complete-badge\[data-retired\],\s*\.reliquary-page-detail\.is-illuminated \.reliquary-complete-badge\[data-personal\] \{[^}]*\}/,
    )?.[0];
    expect(optOut, 'the illuminated-page gold-frame opt-out rule').toBeTruthy();
    expect(optOut).toContain('border-color: var(--color-border-default)');
    expect(optOut).toContain('background: none');
    // The painter's side of the join: class + hook on the SAME span, one arm
    // per reason through the exhaustive record.
    expect(painter).toContain('class="reliquary-complete-badge" ${chip.attr}="1"');
    expect(painter).toContain("attr: 'data-retired'");
    expect(painter).toContain("attr: 'data-personal'");
  });
});
