import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip_comments';

// The $WOC Exchange window painter is a cold DOM module. Its BEHAVIOR is
// driven live in tests/woc_market_window_rig.test.ts (the happy-dom rig over
// the real window: the fetch set, the row select, the busyGen close guard,
// the poll gate, the form draft and focus carry, the combobox). This file is
// the no-DOM source-scan twin (the tests/market_window.test.ts pattern): the
// contracts a regex CAN hold (no magic values, no layout reads, no driver,
// i18n and escaping discipline, CSS specificity order, class coverage). Each
// pin below names WHY it exists, because a source regex proves discipline,
// not behavior; a behavior claim belongs on the rig.
const painter = readFileSync(new URL('../src/ui/woc_market_window.ts', import.meta.url), 'utf8');

// Slice a method body between two source anchors so an assertion about
// open()/render()/relocalize() cannot be satisfied by a token elsewhere.
const between = (start: string, end: string): string => {
  const from = painter.indexOf(start);
  expect(from, `anchor missing: ${start}`).toBeGreaterThanOrEqual(0);
  const to = painter.indexOf(end, from);
  expect(to, `anchor missing after ${start}: ${end}`).toBeGreaterThan(from);
  return painter.slice(from, to);
};

// Presence pins scan the comment-stripped text, so a commented-out
// `case 'review':` cannot satisfy them.
const code = stripComments(painter);

// Slice a method body from the COMMENT-STRIPPED source, so an ordering or
// presence pin cannot be satisfied by a token that survives only in a comment
// (a step-up block commented out would still leave its strings in `painter`).
const betweenCode = (start: string, end: string): string => {
  const from = code.indexOf(start);
  expect(from, `anchor missing: ${start}`).toBeGreaterThanOrEqual(0);
  const to = code.indexOf(end, from);
  expect(to, `anchor missing after ${start}: ${end}`).toBeGreaterThan(from);
  return code.slice(from, to);
};

// The My Activities rows live in src/ui/woc_market_activity_html.ts (the
// monolith ratchet's extraction, moved verbatim): the row slices anchor
// there, comment-stripped for the same reason `code` is.
const activitySrc = stripComments(
  readFileSync(new URL('../src/ui/woc_market_activity_html.ts', import.meta.url), 'utf8'),
);
const activityBetween = (start: string, end: string): string => {
  const from = activitySrc.indexOf(start);
  expect(from, `anchor missing: ${start}`).toBeGreaterThanOrEqual(0);
  const to = activitySrc.indexOf(end, from);
  expect(to, `anchor missing after ${start}: ${end}`).toBeGreaterThan(from);
  return activitySrc.slice(from, to);
};

describe('woc_market_window: no magic color values', () => {
  it('carries no raw hex color literal (QUALITY_COLOR + var(--...) are the only channels)', () => {
    // The (?<!&) guard skips the pager's numeric HTML entities (&#8249; and
    // &#8250;), whose digits are all hex characters but are not colors.
    const hex = painter.match(/(?<!&)#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens/CSS: ${hex.join(', ')}`).toEqual([]);
  });

  it('carries no rgb()/hsl() color literal', () => {
    expect(painter).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });

  it('routes item-name color through the shared itemNameColor family', () => {
    // The one color the painter writes comes from the vendor/bags convention,
    // never a per-window palette. The family module owns the fallback token
    // and the Object.hasOwn guard, so a raw QUALITY_COLOR index (whose ??
    // never fires on a prototype-key quality) must not come back.
    expect(painter).toContain("import { itemNameColor } from './item_name_color';");
    expect(painter).toContain('itemNameColor({ quality })');
    expect(painter).toContain('itemNameColor({');
    expect(painter).not.toContain('QUALITY_COLOR[');
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    // Unicode escapes so this guard file itself stays free of the characters
    // it hunts (the repo-wide copy scan reads test sources too).
    expect(painter.includes('\u2014'), 'em dash found').toBe(false);
    expect(painter.includes('\u2013'), 'en dash found').toBe(false);
  });
});

describe('woc_market_window: cold-window contract', () => {
  it('arms no repeating driver of its own (Hud.update() polls refreshIfChanged instead)', () => {
    // A cold window may not self-schedule at ANY cadence; countdowns tick via
    // the second-resolution digest in wocMarketViewSig, not a timer.
    expect(painter).not.toMatch(
      /\b(?:setInterval|setTimeout|requestAnimationFrame|requestIdleCallback)\s*\(/,
    );
  });

  it('performs no forced-reflow layout read beyond the granted scroll pair', () => {
    // The layout-thrash killers the perf gate scans painters for; a cold
    // window holds this contract whatever its poll cadence. `.scrollTop` is
    // absent from this list because it is GRANTED to this file, at a count, in
    // hud_perf_budget's COLD_PAINTER_ALLOWANCES; the case below is what holds it
    // to the granted shape, so removing that case is what would weaken this.
    for (const token of [
      'getBoundingClientRect',
      'getClientRects',
      'offsetWidth',
      'offsetHeight',
      'offsetTop',
      'offsetLeft',
      'offsetParent',
      'clientWidth',
      'clientHeight',
      'scrollLeft',
      'scrollWidth',
      'scrollHeight',
    ]) {
      expect(painter.includes(token), `forced-reflow read: ${token}`).toBe(false);
    }
    // getComputedStyle is called BARE in this tree, never as a member, so the
    // scan matches the bare call form only.
    expect(painter).not.toMatch(/(?<![.\w])getComputedStyle\s*\(/);
  });

  it('preserves scroll with ONE read site and ONE write site, both inside the rebuild', () => {
    // The granted allowance is 2 occurrences for TWO containers, which only holds
    // because both go through the SCROLL_KEEPERS table. Counting here rather than
    // trusting the grant: a second hand-rolled read would still satisfy the perf
    // gate's count only by someone raising it, and would silently satisfy nothing
    // at all if this case merely asserted the tokens were present.
    const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code.match(/\.scrollTop\b/g) ?? []).toHaveLength(2);
    // Order is the whole contract: read before innerHTML throws the container
    // away, write back after wire() has rebuilt it. Reversed, the read returns 0
    // and the restore is a no-op that looks like it works.
    const inner = between('private renderInner(', 'private usd(');
    const read = inner.indexOf('?.scrollTop ?? 0');
    const wipe = inner.indexOf('root.innerHTML =');
    const write = inner.indexOf('el.scrollTop = top');
    expect(read).toBeGreaterThanOrEqual(0);
    expect(wipe).toBeGreaterThan(read);
    expect(write).toBeGreaterThan(inner.indexOf('this.wire(root, model)'));
    // Keyed, so a tab switch or a different listing still starts at the top
    // rather than inheriting an offset into content that no longer exists.
    expect(inner).toContain('if (keys[name] !== this.renderedScrollKey[name]) continue;');
    expect(painter).toContain("return { body: this.tab, detail: `${this.tab}:${listing ?? ''}` };");
    // Both containers, named. A table of one would pass every count above.
    expect(painter).toContain("['body', '.wm-body'],");
    expect(painter).toContain("['detail', '.wm-detail'],");
  });

  it('keeps the wocMarketViewSig repaint guard the hud_update_drive registry names', () => {
    // refreshIfChanged() must bail on an unmoved digest, or the slow-band poll
    // rebuilds the whole subtree every 500 ms.
    expect(painter).toContain('if (sig === this.lastSig) return;');
    // BOTH halves. Pinning only the comparison let the assignment be deleted,
    // which leaves lastSig at '' forever so every slow-band poll rebuilds the
    // whole subtree while this guard still reported the signature present.
    expect(painter).toContain('this.lastSig = ');
  });
});

describe('woc_market_window: rebuild carries focus and typed input across', () => {
  it('imports the shared focus_restore and form_draft seams (never a hand-rolled read)', () => {
    expect(painter).toContain(
      "import { captureFocusKey, restoreFirstEnabled } from './focus_restore';",
    );
    expect(painter).toContain("import { captureFormDraft, restoreFormDraft } from './form_draft';");
  });

  it('calls all four helpers inside render(), around the innerHTML wipe', () => {
    // render() replaces the whole subtree; without capture-before / restore-
    // after, every poll rebuild would eat the focused control and typed input.
    const render = between('render(): void {', 'private usd(');
    expect(render).toContain('captureFocusKey(root)');
    expect(render).toContain('captureFormDraft(root)');
    expect(render).toContain('restoreFormDraft(root, draft)');
    expect(render).toContain('restoreFirstEnabled(');
  });
});

describe('woc_market_window: focus management and dialog chrome', () => {
  it('open() captures the opener BEFORE closeOthers() can move focus', () => {
    // closeOthers() may restore focus for the window it closes; capturing
    // after it would record the wrong opener and strand focus on close.
    const open = between('open(): void {', 'toggle(): void {');
    const capture = open.indexOf('this.deps.captureFocus()');
    const closeOthers = open.indexOf('this.deps.closeOthers()');
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(closeOthers).toBeGreaterThan(capture);
  });

  it('close() returns focus to the captured opener', () => {
    // Bounded to close()'s own body (the next member), so a restore call
    // anywhere later in the file cannot satisfy this pin. The live rig
    // (tests/woc_market_window_rig.test.ts) proves the ORIGINAL opener is the
    // one handed back.
    const close = between('close(): void {', 'private async reload(): Promise<void> {');
    expect(close).toContain('this.deps.restoreFocus(this.opener)');
  });

  it('close() clears the busy guard AND bumps the generation so a stranded signer cannot brick or double-submit', () => {
    // submitListing is a wallet round trip (B6/R1); a browser-extension signer
    // with no timeout can leave withBusy's finally unreached. close() clears the
    // guard so the window is usable again AND bumps busyGen: without the bump,
    // resetting busy would break the invariant that `busy` means "a mutation is
    // in flight" (pollFromServer gates on it) and an abandoned run's finally
    // would clear a newer run's guard. The live rig proves the behavior (the
    // abandoned run sends nothing, and a run resolving late under a newer one
    // leaves that run's guard alone); this pin holds only the structure.
    const close = betweenCode('close(): void {', 'reload(): Promise<void> {');
    expect(close).toContain('this.busy = false');
    expect(close).toContain('this.busyLabel = null');
    expect(close).toContain('this.busyGen++');
  });

  it('withBusy settles only when its generation still owns the guard', () => {
    // The finally must be generation-guarded, or an abandoned wallet round trip
    // resolving after a close (or a newer run) clears the current owner's busy
    // and repaints over its state.
    const withBusy = betweenCode('private async withBusy(', 'private stillOwns(');
    expect(withBusy).toContain('const gen = ++this.busyGen');
    expect(withBusy).toContain('if (this.busyGen === gen)');
  });

  it('submitListing captures the index up front and bails after each await if the window was closed', () => {
    // The body reads the captured itemIndex (never this.sellIndex live after the
    // await, which a close-and-reopen could have moved) and abandons on a stale
    // generation both after the challenge mint and after the wallet sign, so a
    // late signature cannot escrow a copy the player navigated away from.
    const submit = betweenCode('private async submitListing(', 'private async payBond(');
    expect(submit).toContain('const itemIndex = this.sellIndex');
    expect(submit).toContain('itemIndex,');
    expect(submit).not.toContain('itemIndex: this.sellIndex ?? 0');
    // A stillOwns bail after the mint, after the sign, and after the create.
    expect(
      submit.match(/if \(!this\.stillOwns\(gen\)\) return;/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
  });

  it('marks the dialog root with the title as its one accessible name', () => {
    expect(painter).toContain("markDialogRoot(root, { labelledBy: 'woc-market-title' })");
  });
});

describe('woc_market_window: i18n and escaping discipline', () => {
  it('renders through the hudChrome.wocMarket catalog namespace', () => {
    expect(painter).toContain("t('hudChrome.wocMarket.");
  });

  it('gives the review settlement state its OWN label, never the offered default', () => {
    // The default arm renders 'Payment due': serving that for a parked
    // 'review' row would invite a second payment for money that may already
    // have landed on chain. ASSOCIATIVE: the label must sit inside the
    // review arm itself, so a mis-wired case keeping both tokens elsewhere
    // still reds.
    const arm = activitySrc.indexOf("case 'review':");
    expect(arm, "anchor missing: case 'review':").toBeGreaterThanOrEqual(0);
    expect(activitySrc.slice(arm, arm + 200)).toContain("'hudChrome.wocMarket.settlementReview'");
  });

  it('labels a CONFIRMED or DELIVERING settlement as decided money still delivering, never as confirming', () => {
    // The chain answered: 'Confirming' for a confirmed payment is the claim
    // the trade arm stopped making for the same server state. ASSOCIATIVE:
    // the label sits inside the confirmed/delivering arm, and confirming
    // keeps its own.
    const arm = activitySrc.indexOf("case 'confirmed':\n      case 'delivering':");
    expect(arm, 'anchor missing: the confirmed/delivering arm').toBeGreaterThanOrEqual(0);
    const window = activitySrc.slice(arm, arm + 160);
    expect(window).toContain("'hudChrome.wocMarket.settlementConfirmedDelivering'");
    expect(window).not.toContain("'hudChrome.wocMarket.settlementConfirming'");
    const confirming = activitySrc.indexOf("case 'confirming':\n        return");
    expect(confirming).toBeGreaterThanOrEqual(0);
    expect(activitySrc.slice(confirming, confirming + 120)).toContain(
      "'hudChrome.wocMarket.settlementConfirming'",
    );
  });

  it('never toasts purchase-complete for a review-parked confirm outcome', () => {
    // The outcome arm can answer state 'review' on a recorded-signature
    // retry, and "purchase complete" for money awaiting an operator verdict
    // is the custody lie the row label rule bans. ASSOCIATIVE: the branch
    // must pick settlementReview, with purchaseComplete as its else.
    const arm = code.indexOf("out.state === 'review'");
    expect(arm, "anchor missing: out.state === 'review'").toBeGreaterThanOrEqual(0);
    const window = code.slice(arm, arm + 700);
    expect(window).toContain("'hudChrome.wocMarket.settlementReview'");
    // Decided money still delivering is its own toast (the trade arm's
    // paymentConfirmed ladder mirrored); purchaseComplete is the else, for
    // 'delivered' alone.
    expect(window).toContain("out.state === 'confirmed' || out.state === 'delivering'");
    expect(window).toContain("'hudChrome.wocMarket.paymentConfirmedDelivering'");
    expect(window).toContain("'hudChrome.wocMarket.purchaseComplete'");
    expect(window.indexOf('paymentConfirmedDelivering')).toBeLessThan(
      window.indexOf('purchaseComplete'),
    );
  });

  it('toasts the cancel-pending outcome distinctly from a completed cancel', () => {
    // The seller's cancel on a locked window is ACCEPTED as intent; telling
    // them "Listing cancelled" while it stays live until the buyer's window
    // resolves would be a lie about custody. ASSOCIATIVE: the toast key must
    // sit inside the cancelPending branch.
    const arm = code.indexOf('out.cancelPending === true');
    expect(arm, 'anchor missing: out.cancelPending === true').toBeGreaterThanOrEqual(0);
    expect(code.slice(arm, arm + 300)).toContain("'hudChrome.wocMarket.listingCancelPending'");
  });

  it('never writes a plain string literal via textContent or setAttribute(aria-label)', () => {
    // Rendered text must come from t(); these are the two raw-write sinks a
    // template-string painter could otherwise smuggle English through.
    expect(painter).not.toMatch(/\.textContent\s*=/);
    expect(painter).not.toContain("setAttribute('aria-label'");
  });

  it('escapes every aria-label interpolation (each aria-label=" is followed by ${esc()', () => {
    // Accessible names are t() output interpolated into HTML, so each one
    // must pass through esc(); a bare English aria-label would also dodge the
    // i18n catalog entirely.
    // BOTH sources: the My Activities rows carry their aria-labels in the
    // extracted builder now, and the discipline follows the markup.
    const segments = [
      ...painter.split('aria-label="').slice(1),
      ...activitySrc.split('aria-label="').slice(1),
    ];
    // AT the real count (10), not "> 0", which one surviving attribute
    // satisfied. A floor rather than an exact count so adding a labelled
    // control does not red the suite, while deleting nine still does. It dropped
    // from 11 when the sell tab's per-item buttons became a labelled dropdown,
    // whose search box and select are named by their own <label> instead.
    expect(segments.length).toBeGreaterThanOrEqual(10);
    for (const segment of segments) {
      expect(segment.startsWith('${esc(')).toBe(true);
      // And the WHOLE value, not just its prefix: `${esc(a)} ${raw}` passed a
      // starts-with check while interpolating an unescaped tail.
      const value = segment.slice(0, segment.indexOf('"'));
      for (const hole of value.matchAll(/\$\{/g)) {
        expect(
          value.slice(hole.index).startsWith('${esc(') ||
            value.slice(hole.index).startsWith('${this.') ||
            value.slice(hole.index).startsWith('${host.'),
          `unescaped interpolation in aria-label: ${value}`,
        ).toBe(true);
      }
    }
  });

  it('escapes player names and money before interpolating them into HTML', () => {
    // sellerName/buyerName are server-relayed player text: raw interpolation
    // is an XSS sink. The positive pins prove esc() is in use; the negative
    // regex proves no raw ${...sellerName} or ${...buyerName} slipped in.
    expect(painter).toContain('esc(r.sellerName)');
    expect(painter).toContain('esc(this.usd');
    expect(painter).not.toMatch(/\$\{(?:r|d\.row|s)\.(?:sellerName|buyerName)\}/);
  });
});

describe('woc_market_window: language fan-out', () => {
  it('relocalize() self-gates on its own open check', () => {
    // The woc:languagechange fan-out calls relocalize() unconditionally on
    // every registered window; an ungated arm would rebuild a closed window.
    const relocalize = between('relocalize(): void {', 'buildModel');
    expect(relocalize).toContain('if (!this.isOpen) return;');
    expect(relocalize).toContain('this.render();');
  });
});

describe('woc_market_window: every class it emits is actually styled', () => {
  // The bug this pins shipped and was caught only by looking at a screenshot:
  // 19 of the 42 classes the painter emitted matched no rule in any sheet, so
  // the tab strip, the primary buttons and the window header rendered as raw
  // white browser chrome on the dark panel. Nothing failed, because a missing
  // CSS rule is silent; only a human eye or this guard sees it. It also catches
  // the reverse drift (a class renamed in TS, its rule left behind).
  // Comments are STRIPPED before harvesting selectors: these sheets name plenty
  // of classes in prose, and crediting a class as styled because a comment
  // mentions it would let a rename be "verified" by documentation.
  const sheets = ['components.css', 'hud.css', 'base.css', 'layout.css', 'hud.mobile.css']
    .map((f) => readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  /**
   * Classes the painter emits: literal `class="..."` attributes, the three it
   * hands the shared tab-strip family, and the quoted class fragments inside an
   * INTERPOLATED attribute. That last source is the one this guard originally
   * missed. The first version excluded any attribute containing `${`, which
   * quietly dropped 10 of 52 classes, and two of those (the reserve badge's
   * met/not_met states) were genuinely unstyled: the guard's blind spot was
   * exactly the shape of the defect it was written to catch.
   */
  const emitted = (): string[] => {
    const found = new Set<string>();
    const add = (value: string): void => {
      for (const cls of value.split(/\s+/)) {
        // A name left dangling on a hyphen is the static PREFIX of an
        // interpolated class (`wm-reserve-${...}`), not a class anyone styles.
        // The full spellings are added by the suffix-family branch below.
        if (cls !== '' && !cls.endsWith('-')) found.add(cls);
      }
    };
    for (const m of painter.matchAll(/class="([^"]*)"/g)) {
      const raw = m[1];
      // The static half of the attribute, with every ${...} hole removed.
      add(raw.replace(/\$\{[\s\S]*?\}/g, ' '));
      // The dynamic half: a class only ever reachable inside an interpolation,
      // e.g. `wm-reserve-${r.reserveBadge}` or a ternary picking two literals.
      for (const hole of raw.matchAll(/\$\{([\s\S]*?)\}/g)) {
        for (const lit of hole[1].matchAll(/'([A-Za-z][\w-]*)'/g)) add(lit[1]);
      }
    }
    for (const key of ['stripClass', 'tabClass', 'selectedClass']) {
      for (const m of painter.matchAll(new RegExp(`${key}: '([^']+)'`, 'g'))) found.add(m[1]);
    }
    // The badge states are built by concatenating a view-model enum onto a
    // prefix, so no literal for either spelling exists in this file at all.
    // Named here because a suffix family is unreachable by any regex over the
    // painter alone, and both spellings shipped unstyled.
    if (painter.includes('wm-reserve-')) {
      add('wm-reserve-met wm-reserve-not_met');
    }
    return [...found].sort();
  };

  it('emits a substantial class set (the floor keeps this from going vacuous)', () => {
    // Near the real count (52 at the time of writing), not far under it: a floor
    // sitting well below is what let the truncated 42-class harvest look fine.
    expect(emitted().length).toBeGreaterThanOrEqual(50);
  });

  it('keeps the stateful tab and primary rules above the window-wide button rule', () => {
    // A specificity trap that already bit once. The window-wide chrome rule is
    // `#woc-market-window button:not(.x-btn)`, and :not() carries its argument's
    // specificity, making it (1,1,1). A plain `#woc-market-window .wm-tab-selected`
    // is (1,1,0), so it LOSES however late it sits, and the selected tab silently
    // stopped reading as selected: state a player navigates by, erased by a rule
    // added to fix something else. Writing them as `button.<class>` ties the
    // specificity so source order decides, and they come later.
    const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
    for (const cls of ['wm-tab', 'wm-tab-selected', 'wm-primary']) {
      expect(css, `${cls} must be scoped as button.${cls}`).toContain(
        `#woc-market-window button.${cls}`,
      );
      // And never as the bare class, which is the losing form.
      expect(css.includes(`#woc-market-window .${cls} {`), `bare .${cls} rule loses`).toBe(false);
    }
    // Order still has to hold: the generic rule must come FIRST. Both anchors
    // are asserted present first (a lost anchor is -1, and -1 < N would pass).
    const generic = css.indexOf('#woc-market-window button:not(.x-btn) {');
    const selectedTab = css.indexOf('#woc-market-window button.wm-tab-selected');
    expect(generic).toBeGreaterThanOrEqual(0);
    expect(selectedTab).toBeGreaterThanOrEqual(0);
    expect(generic).toBeLessThan(selectedTab);
  });

  it('harvests the classes that exist ONLY inside an interpolated attribute', () => {
    // Pins the hole itself closed. Each of these is reachable only through a
    // `${...}` hole, so all four were invisible to the original regex.
    expect(emitted()).toEqual(
      expect.arrayContaining(['wm-reserve-met', 'wm-reserve-not_met', 'wm-row-selected']),
    );
  });

  it('has a rule in a shipped sheet for every emitted class', () => {
    // Selector position only: the name must be followed by something that can
    // continue a selector, so a bare word in a url() or a filename cannot count.
    const styled = new Set(
      Array.from(sheets.matchAll(/\.([A-Za-z][\w-]*)(?=[\s,:.#{>+~[)]|$)/g), (m) => m[1]),
    );
    const missing = emitted().filter((cls) => !styled.has(cls));
    expect(missing, `emitted but never styled: ${missing.join(', ')}`).toEqual([]);
  });

  it('builds the header from the shared window-chrome family, not a bespoke one', () => {
    // .panel-title + .x-btn + the close glyph are what every other window uses
    // and the only close markup base.css styles; the invented .window-header /
    // .window-close pair is what produced the unstyled header.
    expect(painter).toContain('<div class="panel-title">');
    expect(painter).toContain('class="x-btn" data-close');
    expect(painter).toContain("svgIcon('close')");
    // Matched as MARKUP, not as bare text: the painter's own comment names both
    // retired classes to explain why they went away.
    expect(painter).not.toContain('class="window-close"');
    expect(painter).not.toContain('class="window-header"');
  });

  it('closes on the family data-close marker, not only its own data-action', () => {
    // Switching the markup to the family without widening the delegated click
    // selector would leave a close button that renders correctly and does
    // nothing when clicked.
    expect(painter).toContain('[data-action], [data-close], .wm-row-open, .wm-row');
    expect(painter).toContain("target.hasAttribute('data-close')");
  });
});

describe('woc_market_window: both game entries carry its root element', () => {
  it('declares #woc-market-window in index.html AND play.html', () => {
    // index.html and play.html both boot src/main.ts (src/CLAUDE.md), and the
    // HUD resolves this window by id. play.html shipped without the element,
    // so the whole exchange was unreachable on /play while looking fine on /.
    for (const entry of ['index.html', 'play.html']) {
      const html = readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8');
      expect(html, `${entry} is missing the window root`).toContain('id="woc-market-window"');
    }
  });
});

describe('woc_market_window: the item inspector on hover', () => {
  it('reuses the SHARED item tooltip rather than building a second one', () => {
    // The whole point of the feature is that a listing reads identically to worn
    // gear. A bespoke tooltip here would drift from the character window's the
    // first time the stat copy changed.
    expect(painter).toContain('attachTooltip(element: HTMLElement, html: () => string): void');
    expect(painter).toContain('itemTooltip(item: ItemDef, instance?: ItemInstancePayload): string');
    expect(painter).toContain(
      'this.deps.attachTooltip(el, () => this.deps.itemTooltip(def, target.instance))',
    );
    // And it does NOT reimplement stat formatting: no stat-line construction here.
    expect(painter).not.toMatch(/itemStatName|instanceBonusStatLines|instanceBadgeLines/);
  });

  it('passes the INSTANCE payload through, so rolled stats are what you see', () => {
    // A listing's value lives in its instance (rolled stats, masterwork, enchant).
    // Showing the base def would misprice every crafted or enchanted item.
    const cell = between('private itemCellHtml(', 'private attachItemTooltips(');
    expect(cell).toContain('instance?: ItemInstancePayload');
    expect(cell).toContain('this.tooltipTargets.set(key, { itemId, instance });');
  });

  it('tags every item surface with a namespaced, stable key', () => {
    // Namespaced so the same item on two tabs cannot collide, and carrying the
    // row's own id so the hover target survives a poll rebuild.
    for (const key of [
      '`browse:${r.id}`',
      '`detail:${d.row.id}`',
      // The sell tab keys off the CHOSEN row now, not a row in a rendered list.
      '`sell:${selected.index}`',
      // ...and off each OPTION in the open picker, which is a surface
      // registered directly rather than through itemCellHtml, because an option
      // is an icon plus a name in its own layout, not a shared cell.
      '`opt:${r.index}`',
    ]) {
      expect(painter, `missing tooltip key ${key}`).toContain(key);
    }
    // The My Activities rows key their cells in the extracted builder.
    for (const key of [
      '`activity:${l.id}`',
      '`activity:bid:${b.id}`',
      '`activity:settle:${s.id}`',
    ]) {
      expect(activitySrc, `missing tooltip key ${key}`).toContain(key);
    }
    // Every itemCellHtml call passes a key: a 3-arg call would register nothing
    // and silently render an un-hoverable cell. The builder renders through
    // host.itemCell with its own literal keys (pinned above); the window's
    // delegate is a bind, not a call, so it cannot dodge this scan.
    const calls = [
      ...(painter.match(/this\.itemCellHtml\([^)]*\)/g) ?? []),
      ...(activitySrc.match(/host\.itemCell\([^)]*\)/g) ?? []),
    ];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      expect(call, `itemCellHtml without a key: ${call}`).toMatch(
        /,\s*`(browse|detail|sell|activity):/,
      );
    }
  });

  it('clears the target registry every render, so a key cannot outlive its row', () => {
    // The registry describes the CURRENT DOM. A stale entry would attach a
    // tooltip for a listing that had already been replaced.
    const html = between('private html(model: WocMarketViewModel): string {', 'if (model.kind ===');
    expect(html).toContain('this.tooltipTargets.clear()');
  });

  it('hides the shared tooltip BEFORE wiping the subtree it is anchored to', () => {
    // A removed node fires no mouseleave, so a rebuild during hover would leave
    // the tooltip box pointing at nothing.
    const render = between('render(): void {', 'private usd(');
    const hide = render.indexOf('this.deps.hideTooltip()');
    const wipe = render.indexOf('root.innerHTML = this.html(model)');
    expect(hide).toBeGreaterThanOrEqual(0);
    expect(wipe).toBeGreaterThan(hide);
  });

  it('re-attaches after every rebuild, since the nodes are new each time', () => {
    const render = between('render(): void {', 'private usd(');
    const wipe = render.indexOf('root.innerHTML = this.html(model)');
    const attach = render.indexOf('this.attachItemTooltips(root)');
    expect(attach).toBeGreaterThan(wipe);
  });

  it('skips an item id this client has no def for instead of an empty box', () => {
    const attach = between('private attachItemTooltips(', 'private html(');
    expect(attach).toContain('const def = ITEMS[target.itemId]');
    expect(attach).toContain('if (!def) continue');
  });

  it('still performs no forced-reflow read: the shared binder owns positioning', () => {
    // The reason this can be a cold window AND have hover tooltips: every layout
    // measurement lives in Hud.attachTooltip, not here.
    for (const token of ['getBoundingClientRect', 'offsetWidth', 'offsetHeight', 'clientWidth']) {
      expect(painter.includes(token), `forced-reflow read: ${token}`).toBe(false);
    }
  });
});

describe('woc_market_window: the sell tab is an ARIA combobox', () => {
  it('is a role=combobox input owning a role=listbox, not a native select', () => {
    // A native <option> cannot carry an icon, which is why this stopped being a
    // <select>. The ARIA contract is what makes the replacement usable.
    const sell = between('private sellHtml(', 'private activityHtml(');
    expect(sell).toContain('role="combobox"');
    expect(sell).toContain('aria-autocomplete="list"');
    expect(sell).toContain('aria-controls="${listId}"');
    expect(sell).toContain('aria-expanded="${open}"');
    expect(sell).toContain('role="listbox"');
    // No select and no per-item button survives.
    expect(sell).not.toContain('<select data-field="sell-item"');
    expect(sell).not.toContain('data-action="sell-select"');
  });

  it('points aria-activedescendant at the highlighted option, and only when there is one', () => {
    // The whole reason DOM focus can stay on the input: the active option is
    // announced by id rather than by moving focus.
    const sell = between('private sellHtml(', 'private activityHtml(');
    expect(sell).toContain('aria-activedescendant="${listId}-o${active}"');
    expect(sell).toContain('active >= 0 ?');
    // Two writers now point at these ids (the markup and paintSellActive), so the
    // id itself is ONE definition. Two literals would drift apart silently and the
    // only symptom would be a screen reader announcing nothing.
    expect(painter).toContain("const SELL_LISTBOX_ID = 'wm-sell-listbox';");
    expect(sell).toContain('const listId = SELL_LISTBOX_ID;');
    expect(painter).toContain('`${SELL_LISTBOX_ID}-o${this.sellActive}`');
    // The label's `for` resolves to a real id while the input exists, and drops to
    // a plain caption once the chosen cell replaces it.
    expect(sell).toContain('id="${listId}-input"');
    expect(sell).toContain('for="${listId}-input"');
  });

  it('renders options as NON-focusable divs, never buttons', () => {
    // A focusable option would be pulled into the window's focus-trap cycle and
    // fight the aria-activedescendant model (the social_window note).
    const sell = between('private sellHtml(', 'private activityHtml(');
    const options = sell.slice(sell.indexOf('wm-combo-item'));
    expect(options).toContain('role="option"');
    expect(options.slice(0, 400)).not.toContain('<button');
    expect(options).not.toContain('tabindex');
  });

  it('shows an ICON next to every option name', () => {
    const sell = between('private sellHtml(', 'private activityHtml(');
    expect(sell).toContain('wm-combo-icon');
    // The default master size (the shared icon path): curated art returns the
    // 128px WebP whatever the size, and the procedural fallback composes at the
    // shared master so it stays crisp on a 2x display and rides the warm cache.
    expect(sell).toContain("iconDataUrl('item', r.itemId)");
    expect(sell).not.toContain("iconDataUrl('item', r.itemId, 28)");
  });

  it('renders the selected item INSIDE the control, hoverable, with a clear button', () => {
    const sell = between('private sellHtml(', 'private activityHtml(');
    expect(sell).toContain('wm-combo-chosen');
    // A real cell, so the shared stats tooltip still attaches to it.
    expect(sell).toContain('`sell:${selected.index}`');
    // The clear button reuses the shared .x-btn chrome family and its close glyph.
    expect(sell).toContain('class="x-btn wm-combo-clear"');
    expect(sell).toContain('data-action="sell-clear"');
    expect(sell).toContain("svgIcon('close')");
  });

  it('the clear button is named for the item it clears, not just "clear"', () => {
    // Several controls on this tab would otherwise share the accessible name "X".
    const sell = between('private sellHtml(', 'private activityHtml(');
    expect(sell).toContain("t('hudChrome.wocMarket.sellClear', { item:");
  });

  it('clearing returns to an EMPTY search, ready to pick again', () => {
    const onClick = between("case 'sell-clear':", "case 'place-bid':");
    expect(onClick).toContain('this.sellIndex = null');
    expect(onClick).toContain("this.sellSearch = ''");
    expect(onClick).toContain('this.sellOpen = false');
  });

  it('filters on the item NAME, case-insensitively, in one place', () => {
    // One definition shared by the markup and the key handler, so a highlight
    // index cannot mean a different row in each.
    const matches = between(
      'private sellMatches(): WocSellRowModel[] {',
      'private commitSellPick(',
    );
    expect(matches).toContain('this.sellSearch.trim().toLowerCase()');
    expect(matches).toContain('this.itemName(r.itemId).toLowerCase().includes(query)');
  });

  it('keeps the query, the open flag and the highlight in PAINTER state', () => {
    // The window rebuilds from state on the slow poll band; DOM-only state would
    // collapse the listbox mid-interaction.
    expect(painter).toContain('private sellSearch = ');
    expect(painter).toContain('private sellOpen = false');
    expect(painter).toContain('private sellActive = -1');
  });

  it('resolves the highlight against the RENDERED model, not a fresh one', () => {
    // The index must mean the row the seller can see. Rebuilding the model in the
    // key handler would resolve it against an inventory that may have moved on.
    expect(painter).toContain('private lastModel: WocMarketViewModel | null = null');
    const matches = between(
      'private sellMatches(): WocSellRowModel[] {',
      'private commitSellPick(',
    );
    expect(matches).toContain('this.lastModel');
  });

  it('reuses the shared dropdownKeyNav core rather than a second key model', () => {
    expect(painter).toContain("import { dropdownKeyNav } from './dropdown_nav'");
    expect(painter).toContain(
      'dropdownKeyNav(e.key, this.sellOpen, this.sellActive, matches.length)',
    );
    for (const kind of ['open', 'move', 'select', 'close', 'tab']) {
      expect(painter, `unhandled nav action: ${kind}`).toContain(`case '${kind}':`);
    }
  });

  it('does NOT route Space to that core: in a text field Space is content', () => {
    // dropdownKeyNav maps Space to activate, which is right for a button trigger
    // and wrong here: the space bar would select an item instead of typing.
    const keydown = between(
      'private onKeyDown(e: KeyboardEvent): void {',
      'private onComboMouseDown(',
    );
    expect(keydown).toContain("if (e.key === ' ') return;");
    const spaceGuard = keydown.indexOf("e.key === ' '");
    const navCall = keydown.indexOf('dropdownKeyNav(');
    expect(spaceGuard).toBeGreaterThanOrEqual(0);
    expect(navCall).toBeGreaterThan(spaceGuard);
  });

  it('Enter with nothing highlighted picks nothing', () => {
    // Committing the first match on a bare Enter would list an item the seller
    // never chose.
    const keydown = between(
      'private onKeyDown(e: KeyboardEvent): void {',
      'private onComboMouseDown(',
    );
    expect(keydown).toContain('if (pick) this.commitSellPick(pick.index)');
  });

  it('Tab closes the list WITHOUT preventDefault, so focus advances natively', () => {
    const keydown = between(
      'private onKeyDown(e: KeyboardEvent): void {',
      'private onComboMouseDown(',
    );
    const tabArm = keydown.slice(keydown.indexOf("case 'tab':"));
    expect(tabArm).toContain('this.sellOpen = false');
    // The CALL, not the word: the arm's comment explains why it is absent.
    expect(tabArm.slice(0, tabArm.indexOf('return'))).not.toContain('e.preventDefault()');
  });

  it('selects on mousedown, not click, so the blur cannot beat the selection', () => {
    // The options are non-focusable, so a click would blur the input first and
    // focusout would close the listbox before the pick landed.
    expect(painter).toContain("root.addEventListener('mousedown'");
    const down = between(
      'private onComboMouseDown(e: MouseEvent): void {',
      'private onComboMouseMove(',
    );
    expect(down).toContain('e.preventDefault()');
    expect(down).toContain('commitSellPick');
  });

  it('moves the hover highlight IN PLACE, and never by rebuilding', () => {
    // Not a saving: a correctness requirement. A rebuild replaces the very option
    // the pointer is resting on, and a removed node fires no mouseleave and gets
    // no fresh mouseenter while the pointer sits still, so the item stats card was
    // hidden and never came back. Repainting the highlight leaves the hovered
    // option, and its tooltip binding, alive.
    // Anchored on the next method SIGNATURE, not on a doc comment: the comment
    // above onFocusOut was rewritten and silently broke this slice.
    const move = between(
      'private onComboMouseMove(e: MouseEvent): void {',
      'private onFocusIn(e: FocusEvent): void {',
    );
    expect(move).toContain('this.paintSellActive(this.deps.root())');
    expect(move).not.toContain('this.render()');
    // And still only on a real change: mousemove fires continuously.
    expect(move).toContain('next === this.sellActive');
  });

  it('moves the keyboard highlight the same way, so there is one mechanism', () => {
    // Two mechanisms would drift: the arrow keys would rebuild (losing the card
    // the pointer had opened) while the pointer did not.
    const keys = between(
      'private onKeyDown(e: KeyboardEvent): void {',
      'private onComboMouseDown(',
    );
    const move = keys.slice(keys.indexOf("case 'move':"), keys.indexOf("case 'select':"));
    expect(move).toContain('this.paintSellActive(this.deps.root())');
    expect(move).not.toContain('this.render()');
    // 'open' is the exception and must stay a rebuild: a hidden listbox has no
    // options to repaint, so painting in place there would highlight nothing.
    const open = keys.slice(keys.indexOf("case 'open':"), keys.indexOf("case 'move':"));
    expect(open).toContain('this.render()');
  });

  it('paints the class, aria-selected and aria-activedescendant together', () => {
    // The three are one state. Moving the class without the ARIA pair leaves a
    // screen reader announcing an option the sighted highlight has left.
    const paint = between(
      'private paintSellActive(root: HTMLElement): void {',
      'private onFocusOut(',
    );
    expect(paint).toContain("option.classList.toggle('wm-combo-active', on)");
    expect(paint).toContain("option.setAttribute('aria-selected', on ? 'true' : 'false')");
    expect(paint).toContain("input?.setAttribute('aria-activedescendant',");
    // Cleared, not left stale, when nothing is highlighted.
    expect(paint).toContain("input?.removeAttribute('aria-activedescendant')");
    // The active option is scrolled into view: the list opens at FULL length, so
    // arrowing down leaves the visible 240px within a few keystrokes. This is a
    // scroll command, not one of the forced-reflow READS the cold contract counts,
    // and it is what the sibling social_window combobox uses for the same case.
    expect(paint).toContain("option.scrollIntoView({ block: 'nearest' })");
  });

  it('closes on focusout only when focus leaves the whole combobox', () => {
    const out = between('private onFocusOut(e: FocusEvent): void {', 'private scrollKeys(');
    expect(out).toContain('combo.contains(next)');
  });

  it('ignores the focusout its OWN rebuild causes', () => {
    // The bug this pins cost real debugging time and looked nothing like its
    // cause. Every render() replaces the subtree, and the browser moves focus off
    // the input while removing it, firing focusout with a null relatedTarget. The
    // rebuild therefore closed its own listbox, so the NEXT keystroke saw the list
    // as closed and Enter/Escape fell through to dropdownKeyNav's collapsed
    // branch: the widget looked like it had broken state, not a focus problem.
    expect(painter).toContain('private rendering = false');
    const out = between('private onFocusOut(e: FocusEvent): void {', 'private scrollKeys(');
    expect(out).toContain('if (this.rendering');
    // The flag must cover the focus RESTORE too, which is itself a focus move.
    const render = between('render(): void {', 'private renderInner(');
    expect(render).toContain('this.rendering = true');
    expect(render).toContain('finally');
    expect(render).toContain('this.rendering = false');
  });

  it('does NOT rely on isConnected to tell a rebuild from a real blur', () => {
    // The first attempt did, and it silently failed: the node is still attached at
    // the moment focusout fires, so the guard passed every time.
    const out = between('private onFocusOut(e: FocusEvent): void {', 'private scrollKeys(');
    expect(out).not.toContain('isConnected');
  });

  it('opens the whole list on FOCUS, before a single keystroke', () => {
    // A player who does not know what is listable should not have to guess a
    // search term to find out. An empty query matches every row, so opening on
    // focus shows the full scrollable inventory and typing only narrows it.
    const focusIn = between('private onFocusIn(e: FocusEvent): void {', 'private paintSellActive(');
    expect(focusIn).toContain("data-field') !== 'sell-search'");
    expect(focusIn).toContain('this.sellOpen = true');
    expect(focusIn).toContain('this.render()');
    // focusin, not focus: only the former bubbles to the one delegated listener.
    const render = between('render(): void {', 'const model = this.buildModel()');
    expect(render).toContain("root.addEventListener('focusin',");
    expect(render).not.toContain("root.addEventListener('focus',");
    // And the query itself is NOT reset here: reopening on a re-focus must not
    // silently discard what the seller already typed.
    expect(focusIn).not.toContain('this.sellSearch');
  });

  it('ignores the focusin its OWN rebuild causes, or Escape could never close', () => {
    // The exact mirror of the onFocusOut trap, and it bites in the opposite
    // direction: renderInner's focus restore puts focus back on this input, so
    // without the guard Escape would close the list and the rebuild it triggers
    // would reopen it on the way out. Unclosable, and it would read as a stuck
    // dropdown rather than a focus problem.
    const focusIn = between('private onFocusIn(e: FocusEvent): void {', 'private paintSellActive(');
    expect(focusIn).toContain('if (this.rendering || this.sellOpen) return;');
  });

  it('shows the item stats card from an option ICON, not only once chosen', () => {
    // Comparing candidates is the point: a seller picks between two epics by
    // reading their stats, which previously meant selecting one, reading it,
    // clearing, and selecting the other.
    const sell = between('private sellHtml(', 'private activityHtml(');
    expect(sell).toContain('this.tooltipTargets.set(`opt:${r.index}`');
    expect(sell).toContain('instance: r.instance');
    expect(sell).toContain(`data-tt-key="opt:\${r.index}"`);
    // The key rides on the icon and NOT on the name: a card chasing the pointer
    // across every row of a 70-item list is noise, so the icon is the deliberate
    // target. Pinned by position, since both live in the same option div.
    const icon = sell.indexOf('wm-combo-icon');
    const name = sell.indexOf('wm-combo-name');
    expect(sell.slice(icon, name)).toContain('data-tt-key');
    expect(sell.slice(name)).not.toContain('data-tt-key');
  });

  it('does not rebuild under an open picker, which would eat the hovered card', () => {
    // The remaining way the card could vanish mid-hover: the slow-band poll firing
    // on a countdown bucket change while the pointer rests on an option.
    const refresh = between('refreshIfChanged(): void {', 'relocalize(): void {');
    const skip = "if (this.tab === 'sell' && this.sellOpen) return;";
    // Scoped to the TAB as well as the flag, and that is not belt-and-braces: the
    // flag is cleared by a focusout, and any path that skipped one would otherwise
    // freeze the browse countdowns for the rest of the session. Bounding the skip
    // to the tab the picker lives on makes the worst case a stale sell tab.
    expect(refresh).toContain(skip);
    // Before the signature is read, so lastSig is left unmoved and the very next
    // poll after the picker closes still sees the change. Skipping AFTER the read
    // would latch the new digest and drop the update entirely.
    expect(refresh.indexOf(skip)).toBeLessThan(refresh.indexOf('const sig ='));
  });

  it('tells the seller when a search matches nothing', () => {
    expect(painter).toContain('hudChrome.wocMarket.sellNoMatches');
    const sell = between('private sellHtml(', 'private activityHtml(');
    // The empty row is marked disabled so a screen reader does not offer it.
    expect(sell).toContain('aria-disabled="true"');
  });
});

describe('woc_market_window: a combined listing is opted into by price, not by picker', () => {
  it('keeps the format selector at two entries', () => {
    // The combined format is creatable again, but it is deliberately NOT a third
    // entry here: a seller who wants one fills the buy-now field on an auction.
    // Three entries would ask them to classify the listing before naming the two
    // prices that are the actual decision, and would let the picker and the
    // fields contradict each other.
    const sell = between('private sellHtml(', 'private activityHtml(');
    expect(sell).toContain('value="auction"');
    expect(sell).toContain('value="buy_now"');
    expect(sell).not.toContain('value="auction_buy_now"');
  });

  it('keeps the painter’s picker state to the two selectable values', () => {
    expect(painter).toContain("private sellFormat: 'auction' | 'buy_now' = 'auction'");
    // The change handler accepts only what the picker can emit; the third format
    // is derived at submit, never selected. Matched as a COMPARISON, not as bare
    // text, since nearby comments name the combined format.
    const onChange = between(
      'private onChange(e: Event): void {',
      'private async reloadBrowseOnly(',
    );
    expect(onChange).not.toContain("=== 'auction_buy_now'");
    expect(onChange).toContain("value === 'auction' || value === 'buy_now'");
  });

  it('submits auction_buy_now exactly when an auction named a price', () => {
    // The whole mapping, and the reason the picker can stay at two entries. A
    // submit that forwarded `format` verbatim would send 'auction' with a
    // buy-now price, which validListingParams refuses as bad_buy_now.
    const submit = betweenCode('private async submitListing(', 'private async payBond(');
    expect(submit).toContain(
      "format === 'auction' && buyNowCents !== null ? 'auction_buy_now' : format",
    );
    // And the derived value, not the picked one, is what reaches the wire and
    // decides which of the two price fields is dropped. The pair is hoisted
    // once so the step-up challenge and the createListing body cannot
    // disagree about what the wallet authorized.
    expect(submit).toContain('format: submitFormat');
    expect(submit).toContain(
      "const listingReserve = submitFormat === 'buy_now' ? null : reserveCents",
    );
    expect(submit).toContain(
      "const listingBuyNow = submitFormat === 'auction' ? null : buyNowCents",
    );
    expect(submit).toContain('reserveCents: listingReserve');
    expect(submit).toContain('buyNowCents: listingBuyNow');
    // Both sends, byte for byte: the challenge request and the listing body.
    expect(submit.match(/reserveCents: listingReserve/g)?.length).toBe(2);
    expect(submit.match(/buyNowCents: listingBuyNow/g)?.length).toBe(2);
  });

  it('renders all three formats: read and write agree again', () => {
    const view = readFileSync(new URL('../src/ui/woc_market_view.ts', import.meta.url), 'utf8');
    expect(view).toContain("'auction' | 'buy_now' | 'auction_buy_now'");
  });
});

describe('woc_market_window: listing requires the wallet step-up (B6/R1)', () => {
  // Source-scan pins over the COMMENT-STRIPPED body (betweenCode): the live-DOM
  // behavioral arm (a decline that leaves busy stuck, a bound-figure disagree)
  // is the opt-in browser suite's, per this file's header; the identical
  // mint/sign/send/decline ladder is behaviorally proven in
  // tests/woc_trade_controller.test.ts.
  it('mints the challenge, signs the SERVER-built message, then sends the proof, in that order', () => {
    const submit = betweenCode(
      'private async submitListing(): Promise<void> {',
      'private async payBond(',
    );
    const iChallenge = submit.indexOf('client.stepUpChallenge({');
    const iSign = submit.indexOf('hooks.signMessageBase58(');
    const iCreate = submit.indexOf('client.createListing({');
    // The signer receives the SERVER message and the challenge nonce (the
    // desktop arm resolves the server-stored message by that nonce).
    expect(submit).toContain('issued.challenge.message,');
    expect(submit).toContain('issued.challenge.nonce,');
    expect(iChallenge, 'the challenge mint').toBeGreaterThanOrEqual(0);
    expect(iSign, 'the wallet signs the server message, never client text').toBeGreaterThan(
      iChallenge,
    );
    expect(iCreate, 'the listing send comes last').toBeGreaterThan(iSign);
    // The proof rides the listing body verbatim, and the challenge carries the
    // exact copy so the signed message and the create body cannot disagree.
    expect(submit).toContain(
      'stepUp: { nonce: issued.challenge.nonce, signature: stepUpSignature }',
    );
    expect(submit).toContain('expectInstance: slot.instance ?? null');
  });

  it('skips the wallet ONLY on an explicit signatureRequired false, the devsig rule', () => {
    const submit = betweenCode(
      'private async submitListing(): Promise<void> {',
      'private async payBond(',
    );
    // Explicit permission only: absent must still go through the wallet.
    expect(submit).toContain('issued.challenge.signatureRequired === false');
    expect(submit).toContain('devsig:${issued.challenge.nonce}');
  });

  it('renders honest pending and failure states around the wallet wait', () => {
    const submit = betweenCode(
      'private async submitListing(): Promise<void> {',
      'private async payBond(',
    );
    // The busy ladder, in order: the challenge mint is a plain REST round trip
    // ("Confirming"), the wallet sentence appears only at the handoff that
    // actually opens a wallet (so the dev economy's devsig arm never claims
    // one), and the create is its own honest label (a REST create, NOT an
    // on-chain confirm).
    const iConfirming = submit.indexOf("withBusy('hudChrome.wocMarket.confirming'");
    const iSigning = submit.indexOf("busyLabel = 'hudChrome.wocMarket.signing'");
    const iListing = submit.indexOf("busyLabel = 'hudChrome.wocMarket.listing'");
    expect(iConfirming).toBeGreaterThanOrEqual(0);
    expect(iSigning).toBeGreaterThan(iConfirming);
    expect(iListing).toBeGreaterThan(iSigning);
    // The wallet label is set INSIDE the real-signature arm, never in the
    // devsig arm above it.
    const iDevsig = submit.indexOf('devsig:${issued.challenge.nonce}');
    expect(iDevsig).toBeGreaterThanOrEqual(0);
    expect(iSigning).toBeGreaterThan(iDevsig);
    // A wallet failure renders the CLASSIFIED sign-flavored line, never
    // err.message raw (the wallet-bridge i18n medium); the raw error logs on
    // the dev channel, and a challenge refusal rides fail().
    expect(submit).toContain("kind: 'bridge'");
    expect(submit).toContain('walletBridgeReason(err)');
    expect(submit).toContain("flavor: 'sign'");
    expect(submit).not.toContain("flavor: 'payment'");
    expect(submit).not.toContain('err.message');
    expect(submit).toContain('console.warn');
    expect(submit).toContain('this.fail(issued.code, issued.params)');
  });
});

describe('woc_market_window: buy-now must beat the starting bid', () => {
  it('refuses on the client before a round trip, and says which rule failed', () => {
    const submit = between(
      'private async submitListing(): Promise<void> {',
      'private async payBond(',
    );
    expect(submit).toContain('const floor = Math.max(startCents, effectiveReserve ?? 0)');
    // Mirrors validListingParams: a pure buy-now takes no bids so start === price
    // is valid (< floor refused), while the combined auction keeps the strict
    // rule (<= floor refused).
    expect(submit).toContain(
      "submitFormat === 'buy_now' ? buyNowCents < floor : buyNowCents <= floor",
    );
    expect(submit).toContain('hudChrome.wocMarket.sellBuyNowAboveStart');
  });

  it('compares against the RESERVE too, not just the start', () => {
    // A buy-now under a hidden reserve could never sell: the reserve would block
    // every bid at or below it while the buy-now invited exactly that price. The
    // reserve is nulled for a pure buy-now (effectiveReserve), as the body nulls it.
    const submit = between(
      'private async submitListing(): Promise<void> {',
      'private async payBond(',
    );
    expect(submit).toContain(
      "const effectiveReserve = submitFormat === 'buy_now' ? null : reserveCents",
    );
  });
});

describe('woc_market_window: the picker prompt counts correctly', () => {
  it('renders the count through tPlural, so one item is never "1 items"', () => {
    // A flat '{count} items' template is wrong at 1 in English and wrong in more
    // places in locales with several plural categories.
    expect(painter).toContain("tPlural('hudChrome.plurals.wocMarketSellChoose'");
    expect(painter).not.toContain('sellChoosePrompt');
  });

  it('declares every CLDR category the base needs in English', () => {
    // tPlural falls back to `.other`, so a missing `one` would silently render the
    // plural form for a single item rather than failing.
    const catalog = readFileSync(
      new URL('../src/ui/i18n.catalog/hud_chrome.ts', import.meta.url),
      'utf8',
    );
    const block = catalog.slice(catalog.indexOf('wocMarketSellChoose: {'));
    const decl = block.slice(0, block.indexOf('},'));
    for (const cat of ['one', 'few', 'many', 'other']) {
      expect(decl, `plural category ${cat}`).toContain(`${cat}:`);
    }
    // And the singular really is singular.
    expect(decl).toContain("one: 'Choose from {count} item'");
  });
});

describe('woc_market_window: a fixed-price listing can satisfy the guards buyNow runs', () => {
  it('renders the terms field when there is no bid form to carry it', () => {
    // The defect this pins was UNREACHABLE in local testing and total in effect.
    // buyNow() sends acceptTerms, and the server's buyNow gate chain runs
    // guardTerms exactly as placeBid does. But the terms input used to live ONLY
    // inside bidFormHtml, which returns '' for a buy_now listing. So a buyer who
    // had never accepted the terms got terms_required with no checkbox: unbuyable,
    // permanently, with no way out from the UI. Every listing in the local database
    // was the legacy combined format, whose bid form DOES render, which is exactly
    // why nothing caught it. (The two-factor field this once also carried is gone:
    // 2FA came off the paying side, and the custody side now uses the wallet
    // step-up, never a typed code.)
    const detail = between('private detailPaneHtml(', 'private bidFormHtml(');
    expect(detail).toContain('this.confirmFieldsHtml(model)');
    // Only when the bid form is absent: a combined listing would otherwise render
    // the same data-field twice and a reader keyed on it would pick whichever
    // came first.
    expect(detail).toContain("bidForm === ''");
    // The COMPOSITION, not the declarations. Asserting the order with indexOf over
    // the whole method was vacuous both ways: `buyNowFields` appears first in its
    // own `const`, so deleting it from the returned concatenation entirely, and
    // moving it after the button, both still passed. The pane is assembled here, so
    // this is the sequence that decides what a player sees.
    const parts = detail
      .slice(detail.indexOf('      estimate +'), detail.indexOf('      cancel +'))
      .split('+')
      .map((piece) => piece.trim())
      .filter(Boolean);
    expect(parts).toEqual(['estimate', 'bidForm', 'buyNowFields', 'buyNow']);
  });

  it('defines the terms field exactly once, so both paths send the same name', () => {
    // One definition is the whole point: two copies drift, and the server reads one
    // name. This was two fields until 2FA came off the Exchange's paying side; the
    // helper stays because both the bid form and the buy-now path still need the
    // terms checkbox, which is the whole reason it was extracted.
    const fields = between('private confirmFieldsHtml(', 'private sellHtml(');
    expect(fields).toContain('data-field="accept-terms"');
    expect(fields).toContain("t('hudChrome.wocMarket.termsLabel')");
    // The bid form consumes the same helper rather than keeping its own copy.
    const bid = between('private bidFormHtml(', 'private confirmFieldsHtml(');
    expect(bid).toContain('this.confirmFieldsHtml(model)');
    expect(bid).not.toContain('data-field="accept-terms"');
    // Exactly one RENDER site, so no path can emit a duplicate.
    expect(painter.match(/(?<!\[)data-field="accept-terms"(?!\])/g) ?? []).toHaveLength(1);
  });

  it('sends the terms flag from both paying paths', () => {
    const buy = between('private async buyNow(', 'private async cancelListing(');
    expect(buy).toContain('acceptTerms: this.acceptTermsChecked()');
    const bid = between('private async placeBid(', 'private async buyNow(');
    expect(bid).toContain('acceptTerms: this.acceptTermsChecked()');
  });

  it('carries no two-factor field: 2FA is off the Exchange paying side', () => {
    // Removed deliberately, not lost. Both paying actions already require the
    // buyer's own wallet signature, which a stolen session token does not carry, so
    // the gate sat in front of an action that already had a stronger second factor.
    // The account's LOGIN 2FA is untouched and lives in server/account.ts.
    expect(painter.toLowerCase()).not.toContain('totp');
  });
});

describe('the consent checkboxes reach the target floor on DESKTOP too', () => {
  // The mobile sheet floors both at 24px (pinned in
  // tests/mobile_window_layout.test.ts). Desktop shipped the Exchange's box at
  // the 13px UA default and the trade arm's at 18px, under the 24px absolute
  // minimum in src/ui/CLAUDE.md, on the one control the server will not take
  // money without. The DECLARATION is read, not the whole block: prose about a
  // value satisfies a substring check on its own.
  const decl = (css: string, selector: string, prop: string): string => {
    const at = css.indexOf(selector);
    expect(at, `${selector} exists`).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('\n  }', at));
    // Anchored: "width" is a substring of min-width and max-width, so an
    // unanchored match would happily read a neighbouring declaration.
    return new RegExp(`(?:^|[\\s;{])${prop}:([^;]+);`).exec(block)?.[1]?.trim() ?? '';
  };

  it('floors the Exchange consent and offer-next boxes at 24px', () => {
    const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
    const sel = '#woc-market-window label.wm-terms input[type="checkbox"]';
    expect(decl(css, sel, 'width')).toBe('24px');
    expect(decl(css, sel, 'height')).toBe('24px');
  });

  it('floors the trade arm consent box at 24px', () => {
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    expect(decl(css, '.trade-woc-terms input {', 'width')).toBe('24px');
    expect(decl(css, '.trade-woc-terms input {', 'height')).toBe('24px');
  });
});

describe('woc_market_window: the two ways to take a listing are separate actions', () => {
  const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');

  it('gives Buy now its own full-width row, clear of Place Bid', () => {
    // They are independent decisions, not a submit pair: flush against each other
    // they read as one control group and invite a misclick that spends money.
    const rule = css.slice(
      css.indexOf('#woc-market-window .wm-detail button[data-action="buy-now"]'),
      css.indexOf('button[data-action="cancel-listing"]'),
    );
    expect(rule, 'no buy-now rule in components.css').not.toEqual('');
    expect(rule).toContain('width: 100%');
    expect(rule).toContain('display: block');
    // Air above it, on a spacing token or a literal (a token move must not
    // read as the air disappearing).
    expect(rule).toMatch(/margin-top:\s*(?:\d+px|var\(--spacing-[a-z]+\))/);
  });

  it('keeps buy-now AFTER the window-wide button rule, so the width is not erased', () => {
    // The same specificity trap the tab rules hit: an attribute selector is
    // (1,1,1) and so is `button:not(.x-btn)`, so source order is what decides.
    const generic = css.indexOf('#woc-market-window button:not(.x-btn) {');
    const buyNow = css.indexOf('#woc-market-window .wm-detail button[data-action="buy-now"]');
    expect(generic).toBeGreaterThanOrEqual(0);
    expect(buyNow).toBeGreaterThanOrEqual(0);
    expect(generic).toBeLessThan(buyNow);
  });
});

describe('woc_market_window: the listbox must stay in flow', () => {
  it('is NOT absolutely positioned, because an overflow ancestor clips it', () => {
    // .wm-body is overflow-y: auto. An absolute menu still had layout, so it
    // looked open and its options reported real rects, but it was clipped to a
    // two-pixel sliver and the pointer hit the window behind it: every option was
    // unclickable while appearing perfectly normal in a screenshot.
    const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
    const start = css.indexOf('#woc-market-window .wm-combo-list {');
    expect(start).toBeGreaterThan(0);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).not.toContain('position: absolute');
    expect(rule).not.toContain('z-index');
    // It scrolls itself rather than growing without bound.
    expect(rule).toContain('max-height');
    expect(rule).toContain('overflow-y: auto');
  });
});

describe('woc_market_window: "Not now" releases the listing lock', () => {
  // The dead end this closes: placing a bid creates a pending_bond row that
  // blocks every further bid on that listing, and "Not now" only dropped the
  // CLIENT's copy of the quote. The player was then refused with "Confirm or
  // abandon your pending bid on this listing first" and had no way to abandon
  // it, for the whole five-minute TTL.
  it('tells the server, rather than only forgetting the quote locally', () => {
    const cancel = between(
      'private async cancelPendingQuote()',
      'private async refreshPendingQuote',
    );
    expect(cancel, 'a bond quote must be abandoned server-side').toContain(
      'client.abandonBid(pending.bidId)',
    );
    // And the activity/detail views must re-read, or the window keeps showing
    // the bid it just withdrew.
    expect(cancel).toContain('this.reload()');
  });

  it('leaves a SETTLEMENT quote alone: that is a purchase, not a lock', () => {
    // The item is already the buyer's to pay for, Activity offers Pay now, and
    // the constraint is a deadline rather than a listing-wide lock. Abandoning
    // it here would throw away a purchase they still want.
    const cancel = between(
      'private async cancelPendingQuote()',
      'private async refreshPendingQuote',
    );
    expect(cancel).toContain("pending?.kind !== 'bond'");
  });

  it('routes the Not now button through that path, not a bare state clear', () => {
    const handler = between("case 'quote-cancel':", 'default:');
    expect(handler).toContain('this.cancelPendingQuote()');
    expect(handler, 'a bare local clear is what shipped the bug').not.toContain(
      'this.pendingQuote = null',
    );
  });
});

describe('woc_market_window: the bid $WOC preview', () => {
  it('quotes the SERVER for the typed price, never multiplying locally', () => {
    const pump = between('private pumpBidEstimate()', 'private onKeyDown');
    expect(pump).toContain('client.estimate(cents)');
    expect(pump).toContain('est?.amount?.tokens');
  });

  it('coalesces without a timer, which this cold window may not own', () => {
    // One request in flight at a time, chasing the latest value on completion.
    // A setTimeout debounce (what the p2p trade arm uses) is unavailable here:
    // the cold-window contract above scans this file for the token.
    const pump = between('private pumpBidEstimate()', 'private onKeyDown');
    expect(pump).toContain('this.bidEstimateInFlight');
    expect(pump, 'a stale reply must chase the newer value').toContain(
      'this.bidEstimateWanted !== cents',
    );
  });

  it('reuses the trade arm’s wording so the two surfaces read identically', () => {
    expect(painter).toContain("t('hudChrome.trade.woc.equivalent'");
  });

  it('shows nothing at all until the server has quoted a figure', () => {
    // An empty or cleared field must not keep displaying the rate for the number
    // that used to be there.
    expect(painter).toContain('this.bidEquivalentTokens === null');
  });
});

describe('woc_market_window: a price the wallet cannot cover', () => {
  // Mirrors the trade window's rule on the Exchange's two paying paths. Source
  // scans rather than a rendered check: the figures arrive from async estimates
  // held as window state, and what matters is that each gate reaches the shared
  // predicate and takes the button with it.
  it('gates the BID on the shared predicate, not a hand-rolled comparison', () => {
    const form = between('private bidFormHtml(', 'private confirmFieldsHtml');
    expect(form).toContain('overWalletBalance(this.bidEquivalentTokens, this.walletTokens())');
    expect(form, 'and the button actually goes dead').toContain('|| overBid ?');
    expect(form, 'with the figure carrying it too').toContain("' over-balance'");
    expect(form, 'and never colour alone').toContain(
      "t('hudChrome.trade.woc.hintInsufficientBalance')",
    );
  });

  it('gates BUY NOW on its own quote, since the detail estimate prices the bid', () => {
    // listingDetail estimates currentBidCents ?? startCents, which is not the
    // buy-now price: reusing it would compare the wrong number. The chrome
    // builder renders the face, so the gate rides its disabled and
    // overBalance args from here.
    expect(painter).toContain('overWalletBalance(this.buyNowTokens, this.walletTokens())');
    expect(painter).toContain('|| overBuyNow,');
    expect(painter).toContain('overBalance: overBuyNow,');
  });

  it('reads the VERIFIED balance, not a merely-connected wallet', () => {
    const reader = between('private walletTokens()', 'private busy =');
    expect(reader).toContain('verifiedWocBalance()');
  });

  it('clears the buy-now quote when the selected listing changes', () => {
    // A stale figure from the previous listing would gate this one.
    // Bounded to selectListing's own body: a reset that moved into render()
    // would still contain the token but is not what this pin claims.
    const select = between('private async selectListing(', 'refreshIfChanged(): void {');
    expect(select).toContain('this.buyNowTokens = null');
  });
});

describe('woc_market_window: the quote countdown actually moves', () => {
  // What shipped: "Quote expires in x seconds" rendered once and then sat
  // frozen while the quote ran out underneath the player. The window is cold
  // and repaints only when its digest changes; the pending quote is WINDOW
  // state, so the pure model's digest could never move for it.
  it('folds the quote countdown into the repaint signature', () => {
    const refresh = between('refreshIfChanged(): void {', 'private quoteCountdownSig');
    expect(refresh, 'the model digest alone cannot see a pending quote').toContain(
      'this.quoteCountdownSig()',
    );
  });

  it('latches the SAME composite it compares', () => {
    // Latching only the model half leaves the two permanently unequal, so every
    // poll rebuilds the window and takes the caret and hover card with it.
    const render = between('this.lastModel = model;', 'this.rendering = true');
    expect(render).toContain('this.quoteCountdownSig()');
  });

  it('keys through the view core on the WINDOW clock, from the pending quote alone', () => {
    // The arithmetic (seconds, empty with no deadline) lives in the pure core and
    // is pinned behaviorally in tests/woc_market_view.test.ts; the window's part
    // is to feed it its own pending quote and the wall clock it owns.
    const sig = between('private quoteCountdownSig()', '/** Language fan-out arm');
    expect(sig).toContain('wocQuoteCountdownSig(this.pendingQuote?.quote.expiresAtMs, Date.now())');
  });
});

describe('woc_market_window: bidding pays its own bond', () => {
  // The bond is not a second decision: it is what placing a bid COSTS. Stopping
  // to ask again left the player holding a listing lock they had not realised
  // they had taken, and the listing refusing their next bid because of it.
  it('goes straight into the wallet once the bid is quoted', () => {
    const bid = between('private async placeBid(', 'private async buyNow(');
    expect(bid).toContain('this.signPendingQuote()');
  });

  it('signs OUTSIDE the busy wrapper, which refuses to re-enter', () => {
    // withBusy returns early while busy, so a nested call would be swallowed and
    // the player would be left on the quote panel after all: the exact bug this
    // change exists to remove.
    const bid = between('private async placeBid(', 'private async buyNow(');
    // The withBusy CALLBACK's close, at method-body indentation. Matching a bare
    // '});' finds the placeBid request object's close first, which sits INSIDE
    // the callback: an earlier version of this test did exactly that and passed
    // with the sign call nested, proving nothing.
    const closeBusy = bid.indexOf('\n    });');
    expect(closeBusy, 'the withBusy block must close').toBeGreaterThan(0);
    expect(
      bid.indexOf('this.signPendingQuote()'),
      'the sign call must come after it',
    ).toBeGreaterThan(closeBusy);
  });

  it('does not sign when the bid was REFUSED', () => {
    // A refusal has no quote to pay, and reaching for the wallet then would ask
    // a player to fund a bid that does not exist.
    const bid = between('private async placeBid(', 'private async buyNow(');
    expect(bid).toContain('if (quoted) await this.signPendingQuote()');
  });

  it('leaves BUY NOW asking, because a settlement is not a lock', () => {
    // It carries a deadline and a documented pay-later route from Activity,
    // rather than blocking anyone else's action while it stands.
    const buy = between('private async buyNow(', 'private async cancelListing(');
    expect(buy).not.toContain('this.signPendingQuote()');
  });
});

describe('woc_market_window: the Sell form offers only what the format permits', () => {
  // What shipped: every field rendered regardless of the chosen format, so an
  // auction showed a Buy Now price box and a buy-now showed a Reserve box. The
  // server refuses ONE of those combinations (bad_reserve), so a seller could
  // fill it in and only learn it was impossible after pressing Submit.
  //
  // The auction case is no longer a contradiction: a buy-now on an auction is
  // the combined format, and submitListing maps it. So the asymmetry below is
  // the point. An auction offers BOTH fields; a pure buy-now still offers only
  // its price, because a reserve describes nothing on a listing with no bidding.
  it('gates the reserve field on the selected format, and offers the auction both', () => {
    const form = between('const form = selected', 'private activityHtml(');
    expect(form, 'the reserve must be on the auction arm alone').toContain(
      "this.sellFormat === 'auction'",
    );
    const auctionArm = form.slice(
      form.indexOf("this.sellFormat === 'auction'"),
      form.indexOf('sellDuration'),
    );
    const [ifTrue, ifFalse] = auctionArm.split(': `<label>');
    expect(ifTrue, 'an auction gets the reserve').toContain('sell-reserve');
    expect(ifTrue, 'and the optional buy-now that makes it a combined listing').toContain(
      'sell-buy-now',
    );
    expect(ifFalse, 'a pure buy-now gets its price').toContain('sell-buy-now');
    expect(ifFalse, 'and never a reserve').not.toContain('sell-reserve');
  });

  // The same gate, second round: the starting bid and the next-highest-bidder
  // fallback both describe BIDDING, so a pure buy-now (which takes no bids)
  // must offer neither. What shipped after the first gating pass still
  // rendered both unconditionally: a buy-now seller was asked for a starting
  // bid that exists only for sorting and offered a fallback about bidders that
  // cannot exist.
  it('gates the starting bid on the auction arm; a pure buy-now never asks for one', () => {
    const form = between('const form = selected', 'private activityHtml(');
    // Anchor on the parenthesized ternary, NOT the bare comparison: the format
    // <select> above it carries the same comparison inside its option markup,
    // and anchoring there once made this whole test pass vacuously.
    const gateAt = form.indexOf("(this.sellFormat === 'auction'");
    expect(gateAt, 'the price-field format gate exists').toBeGreaterThanOrEqual(0);
    const auctionArm = form.slice(gateAt, form.indexOf('sellDuration'));
    const [ifTrue, ifFalse] = auctionArm.split(': `<label>');
    expect(ifTrue, 'an auction asks for its starting bid').toContain('sell-start');
    expect(ifFalse, 'a pure buy-now never asks for a starting bid').not.toContain('sell-start');
    const beforeArm = form.slice(0, gateAt);
    expect(beforeArm, 'no unconditional starting-bid field above the gate').not.toContain(
      'sell-start',
    );
  });

  it('gates the next-highest-bidder fallback on the auction format', () => {
    const form = between('const form = selected', 'private activityHtml(');
    const tail = form.slice(form.indexOf('sellDuration'));
    const gate = tail.indexOf("this.sellFormat === 'auction'");
    expect(gate, 'the fallback checkbox sits behind its own format gate').toBeGreaterThanOrEqual(0);
    expect(
      tail.indexOf('sell-offer-next'),
      'the checkbox renders inside the gate, not before it',
    ).toBeGreaterThan(gate);
  });

  it('synthesizes the pure buy-now start as the price itself (sort key only, no bidding)', () => {
    // The server REQUIRES startCents on every format, and a pure buy-now takes
    // no bids, so start === price is valid (woc_market_rules validListingParams)
    // and the detail view documents the start as existing "only for sorting" on
    // a buy-now. So the hidden field is synthesized as the price: price - 1 put a
    // 25c listing's start at 24, under the floor, and refused with an
    // unactionable bad_start after the wallet step-up.
    const submit = betweenCode('private async submitListing(', 'private async payBond(');
    expect(submit).toContain("format === 'buy_now'");
    expect(submit, 'the synthetic start equals the buy-now price, not one under it').not.toContain(
      'buyNowCents - 1',
    );
  });

  it('re-renders when the format changes, or the gate never moves', () => {
    const handler = between("if (field === 'sell-format')", "if (field === 'sell-duration')");
    expect(handler).toContain('this.sellFormat = value');
    expect(handler).toContain('this.render()');
  });

  it('reads an absent field as null, which is what the other format requires', () => {
    // The whole gate rests on this: a hidden buy-now box must submit null, not
    // zero or NaN, or an auction would carry the very field it forbids.
    const read = between('private numberFieldCents(', '/** Typing in the combobox');
    expect(read).toContain('if (!el || el.value.trim()');
    expect(read).toContain('return null');
  });
});

describe('woc_market_window: a sold listing names the price it sold at', () => {
  // What shipped: the My Listings row rendered currentCents ?? startCents for
  // every listing, so an auction bought out at its buy-now price showed the
  // losing high bid ("$1.00 Sold" on a $3.00 sale). The sale price rides the
  // wire as soldCents (joined from the sales provenance table); the row
  // prefers it whenever the listing resolved sold.
  it('prefers soldCents on the activity row, keeping the live price otherwise', () => {
    const listings = activityBetween('const listings = a.listings', 'const bids = a.bids');
    const soldGate = listings.indexOf("l.resolution === 'sold'");
    expect(soldGate, 'the price cell gates on the sold resolution').toBeGreaterThanOrEqual(0);
    expect(listings, 'the sold arm reads the sale price').toContain('l.soldCents');
    // Token-level pins, not the exact ternary text: the formatter is free to
    // wrap the expression. The sold gate must come BEFORE the live fallback
    // (prefers), and both live tokens must survive.
    expect(soldGate).toBeLessThan(listings.indexOf('l.startCents'));
    expect(listings, 'live rows keep the current price').toContain('l.currentCents');
    expect(listings, 'and the start price fallback').toContain('l.startCents');
  });
});

describe('woc_market_window: a bond awaiting the chain cannot be paid twice', () => {
  // What shipped: the Pay Bond button was rendered for every pending_bond bid and
  // disabled only on `this.busy`. busy covers a call in flight and clears the
  // moment the server accepts the signature, but the bid legitimately stays
  // pending_bond until the chain confirms. In that gap the button came back,
  // enabled, on a bond that was already paid, and pressing it sent a second
  // payment for the same bond.
  const bids = activityBetween('const bids = a.bids', 'const settlements = a.settlements');

  it('renders progress INSTEAD of the pay control while confirming', () => {
    // The two arms must be mutually exclusive. A test that only checked the
    // spinner appears would pass on markup that showed both.
    const confirmingArm = bids.slice(
      bids.indexOf('b.bondConfirming'),
      bids.indexOf('data-action="pay-bond"'),
    );
    expect(confirmingArm).toContain('wm-inline-busy');
    expect(confirmingArm, 'no pay control on the confirming arm').not.toContain('pay-bond');
    // And the button is what the NOT-confirming arm renders.
    expect(bids).toContain('data-action="pay-bond"');
    expect(bids.indexOf('b.bondConfirming')).toBeLessThan(bids.indexOf('data-action="pay-bond"'));
  });

  it('still gates the pay control on busy, which confirming does not replace', () => {
    // The two guards answer different questions (a call in flight vs a chain
    // awaiting), so keeping both is the point; dropping busy would re-open the
    // double-submit window this fix is about, one layer down.
    expect(bids).toContain("host.busy ? 'disabled' : ''");
  });

  it('shows nothing at all for a bid that is not pending a bond', () => {
    expect(bids).toContain("b.status !== 'pending_bond'");
  });

  it('announces the wait to a screen reader, not by colour or motion alone', () => {
    expect(bids).toContain('role="status"');
  });
});

describe('woc_market_window: the open window re-asks the server on its own cadence', () => {
  it('polls from the slow-band entry point, not from a driver of its own', () => {
    // The no-self-driver contract is pinned separately (and above); this pins
    // that the poll rides the existing HUD band instead of working around it.
    const refresh = between('refreshIfChanged(): void {', 'private pollFromServer');
    expect(refresh).toContain('this.pollFromServer()');
  });

  it('decides cadence through the pure core rather than a local timer', () => {
    const poll = between('private pollFromServer(): void {', 'The pending quote');
    expect(poll).toContain('shouldPollWocMarket');
    expect(poll).toContain('anyBondAwaitingChain');
  });

  it('never polls underneath a user action in flight', () => {
    // A refetch mid-withBusy would swap the state that action's own completion
    // is about to write.
    const poll = between('private pollFromServer(): void {', 'The pending quote');
    expect(poll).toContain('if (this.busy) return;');
  });

  it('clears the in-flight latch even when the request fails', () => {
    // Left set, the latch would wedge polling off for the rest of the session,
    // which is the exact failure the poll exists to prevent.
    const poll = between('private pollFromServer(): void {', 'The pending quote');
    expect(poll).toContain('.finally(');
    expect(poll).toContain('this.pollInFlight = false');
  });

  it('fetches SILENTLY, so a background blip neither flashes nor erases the list', () => {
    // browseLoading is in the view digest and browseFailed REPLACES the whole
    // list with an error, so reusing the foreground path would have made the
    // window flicker every poll and blank itself on one dropped request.
    const poll = between('private pollFromServer(): void {', 'The pending quote');
    expect(poll).toContain('this.loadBrowse(seq, true)');
    const load = between('private async loadBrowse(', 'private async loadActivity(');
    expect(load).toContain('if (!silent) this.browseLoading = true');
    expect(load).toContain('if (!silent) this.browseFailed = true');
  });

  it('does not repaint by itself: the digest compare stays the one render path', () => {
    const poll = between('private pollFromServer(): void {', 'The pending quote');
    expect(poll, 'the poll mutates state only').not.toContain('this.render()');
  });
});

describe('woc_market_window: payment verdicts reach the player', () => {
  // Comment-stripped slices, per the file's own discipline (line 22): a
  // commented-out call site or a condition quoted in prose must not satisfy
  // these pins. The GATE itself (failed rows only, expired excluded) is
  // decided and behaviorally tested in the view core (failDetailReason,
  // tests/woc_market_view.test.ts); the painter pin only proves the render
  // consumes the core's verdict.
  it('renders the WHY line from the view core verdict, through the mapper', () => {
    // The rows live in the extracted builder (activitySrc, the whole module).
    const activity = activitySrc;
    expect(activity).toContain('s.failDetailReason != null');
    expect(activity).toContain('wocSettlementFailText(s.failDetailReason)');
    // The class pairs with the components.css rule that gives the sentence
    // its own wrapped row (the wm-inline-busy precedent): a rename on either
    // side silently squeezes the Pay control at ru/ja fill widths.
    expect(activity).toContain('wm-fail-why');
  });

  it('renders the listing state booleans the wire carries for this surface', () => {
    // cancelPending and directed exist for exactly this render: a reloading
    // seller must see an accepted cancel intent, and a directed sale must not
    // read as a public auction. Gated on the view-core booleans, keyed copy.
    const activity = activitySrc;
    expect(activity).toContain('l.cancelPending');
    expect(activity).toContain('hudChrome.wocMarket.activityCancelPending');
    expect(activity).toContain('l.directed');
    expect(activity).toContain('hudChrome.wocMarket.activityDirected');
  });

  it('answers a pending confirm with the reason-specific line on both legs', () => {
    const sign = code.slice(code.indexOf('private async signPendingQuote('));
    // The slice runs to end-of-file, which is safe only while this is the
    // LAST method: the count below goes red the moment a method is appended
    // after it (the slice would silently widen and the toHaveLength ordering
    // pins would stop meaning what they say), forcing a bounded re-anchor.
    expect(
      sign.match(
        /\n {2}(?:private |public |protected )?(?:async )?\w+\(|\n(?:export |function )/g,
      ) ?? [],
      'a declaration now follows signPendingQuote; re-anchor this slice with a real end bound',
    ).toHaveLength(0);
    // Bond leg: the pending arm stores the BOND-flavored notice kind (the
    // "payment seen" wording read as the purchase money to a bidder).
    // Settlement leg: a still-confirming answer must never toast purchase
    // complete (that is a delivery claim about money the chain has not
    // decided); it stores the payment-pending kind. Both resolve at RENDER
    // (resolveNotice), so a language switch never strands the toast.
    expect(sign).toContain("kind: 'bondPending', reason: out.reason ?? null");
    expect(sign).toContain("kind: 'pending', reason: out.reason ?? null");
    // The wallet failure on THIS leg renders the CLASSIFIED payment-flavored
    // line, never err.message raw (the wallet-bridge i18n medium; the sign
    // flavor belongs to the step-up arm in submitListing, pinned above).
    expect(sign).toContain("kind: 'bridge'");
    expect(sign).toContain('walletBridgeReason(err)');
    expect(sign).toContain("flavor: 'payment'");
    expect(sign).not.toContain("flavor: 'sign'");
    expect(sign).not.toContain('err.message');
    expect(sign).toContain('console.warn');
    // And the RESOLVE side keeps the two mappers apart: the bond kind renders
    // through the bond voice, never the purchase-money copy (a swapped mapper
    // survived the store-side pin alone).
    const resolve = code.slice(code.indexOf('private resolveNotice('));
    const bondArm = resolve.slice(resolve.indexOf("case 'bondPending':"));
    expect(bondArm.slice(0, 120)).toContain('wocBondPendingText(n.reason)');
    const pendingArm = resolve.slice(resolve.indexOf("case 'pending':"));
    expect(pendingArm.slice(0, 120)).toContain('wocPaymentPendingText(n.reason)');
    expect(sign).toContain("out.state === 'confirming'");
    // purchaseComplete stays reachable only on the ELSE arm after review and
    // confirming are both handled.
    const settlementArm = sign.slice(sign.indexOf("out.state === 'review'"));
    expect(settlementArm.indexOf("out.state === 'confirming'")).toBeLessThan(
      settlementArm.indexOf('purchaseComplete'),
    );
  });

  it('skips the wallet only on the explicit dev-chain permission, on both payment surfaces', () => {
    // The trade arm's fail-safe rule, mirrored here: only an EXPLICIT false
    // skips signing (an absent flag still goes through the wallet), and the
    // skip mints the devsig reference the dev verifier matches on. A
    // truthiness rewrite (!...signatureRequired) would turn an old server's
    // missing field into a skip-the-wallet permission slip.
    const sign = code.slice(code.indexOf('private async signPendingQuote('));
    expect(sign).toContain('pending.quote.signatureRequired === false');
    expect(sign).toContain('devsig:');
    expect(sign).not.toContain('!pending.quote.signatureRequired');
    // The wallet call survives on the other arm (the skip is not a bypass).
    expect(sign).toContain('signAndSendTransactionBase64');
    // BRANCH ORDER: the devsig mint sits in the === false arm and the wallet
    // call after it. An inverted ladder (wallet on false, devsig otherwise)
    // hands a fabricated devsig to a real wallet-signed charge while every
    // presence pin above still passes.
    expect(sign.indexOf('signatureRequired === false')).toBeLessThan(sign.indexOf('devsig:'));
    expect(sign.indexOf('devsig:')).toBeLessThan(sign.indexOf('signAndSendTransactionBase64'));
  });

  it('a bond re-quote re-labels the prompt from the quote it adopted', () => {
    // The payBond rule holds on refresh: the drift-adopt path re-prices the
    // bond server-side, and a prompt labeled with the stale figure while the
    // wallet is handed the new one contradicts itself about the money.
    // Sliced from the comment-STRIPPED text, per the file's own discipline:
    // between() reads the raw painter, which a comment could satisfy.
    const from = code.indexOf('private async refreshPendingQuote(');
    const to = code.indexOf('private async signPendingQuote(', from);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    const refresh = code.slice(from, to);
    expect(refresh).toContain('usdCents: out.bond.bondCents ?? pending.usdCents');
  });
});

describe('woc_market_window: the Activity tab is an honest, actionable ledger (H13)', () => {
  // The tab's markup moved verbatim to its own pure builder on the monolith
  // ratchet; the discipline pins follow it there, and the window keeps one
  // pin: it renders the tab through that builder.
  const activity = stripComments(
    readFileSync(new URL('../src/ui/woc_market_activity_html.ts', import.meta.url), 'utf8'),
  );

  it('the window renders the tab through the extracted builder', () => {
    expect(betweenCode('private activityHtml(', 'private quoteHtml(')).toContain(
      'wocActivityHtml(model.activity',
    );
  });

  it('pay rows name the item: bid and settlement rows render the item cell off the wire id', () => {
    // The wire ships the joined listing item id; a row without one (older
    // server, pruned listing) renders as before instead of an unknown-item
    // box, so BOTH the render call and its non-empty gate are pinned.
    expect(activity).toContain("b.itemId != null && b.itemId !== ''");
    expect(activity).toContain('`activity:bid:${b.id}`');
    expect(activity).toContain("s.itemId != null && s.itemId !== ''");
    expect(activity).toContain('`activity:settle:${s.id}`');
  });

  it('the seller cancel renders on active unbid listing rows, strictly gated', () => {
    // A directed listing never passes through the browse detail pane, so this
    // row is its seller's ONLY cancel surface. The gate is STRICTLY STRONGER
    // than the pane's (mine && unbid): every My-listings row is mine, and
    // this one also requires active status and no cancel-intent stamp; the
    // server's guards stay the authority for everything else.
    // ONE predicate for both cancel surfaces (woc_market_view.ts
    // canCancelListing: active, no cancel intent, unbid); the browse detail
    // pane rides the same one behind its mine check.
    expect(activity).toContain('canCancelListing(l)');
    expect(code).toContain('d.row.mine && canCancelListing(d.row)');
    expect(activity).toContain('data-action="cancel-listing"');
    // Focus survives the poll rebuild (the window-family focus-key contract).
    expect(activity).toContain(`wm-activity-cancel-\${l.id}`);
  });
});

describe('woc_market_window: informed commitment before the first charge (H13/R9)', () => {
  const bidForm = betweenCode('private bidFormHtml(', 'private confirmFieldsHtml(');
  const confirmFields = betweenCode('private confirmFieldsHtml(', 'private sellHtml(');
  // The disclosure markup lives in the chrome builders (the monolith
  // ratchet's extraction); the discipline pins follow it there, and the
  // window keeps the ordering pin: the composed well still precedes the
  // commit control. Comment-stripped for the same reason `code` is.
  const chromeCode = stripComments(
    readFileSync(new URL('../src/ui/woc_market_chrome.ts', import.meta.url), 'utf8'),
  );
  const chromeBetween = (start: string, end: string): string => {
    const from = chromeCode.indexOf(start);
    expect(from, `anchor missing: ${start}`).toBeGreaterThanOrEqual(0);
    const to = chromeCode.indexOf(end, from);
    expect(to, `anchor missing after ${start}: ${end}`).toBeGreaterThan(from);
    return chromeCode.slice(from, to);
  };
  const bidWell = chromeBetween(
    'export function wocBidDisclosuresHtml(',
    'export function wocBuyNowHtml(',
  );
  const buyNowFace = chromeBetween(
    'export function wocBuyNowHtml(',
    'export function wocSalesHistoryHtml(',
  );

  it('the pre-bid disclosures precede the Place bid control', () => {
    // Binding-bid (no withdraw after the bond signs), the close-movement
    // honesty pair (anti-snipe extension; a late payment refunds), and the
    // seller's second-chance disclosure when opted in, all composed in the
    // well the chrome builder owns, ahead of its own toggle-driven hidden
    // attribute ever removing them from the DOM (it never does).
    expect(bidWell).toContain('hudChrome.wocMarket.bidBindingNote');
    expect(bidWell).toContain('hudChrome.wocMarket.bidCloseNote');
    // The second-chance disclosure renders only when the seller opted in.
    expect(bidWell).toContain('args.offerNext');
    expect(bidWell).toContain('hudChrome.wocMarket.offerNextNote');
    // The window feeds the builder the resolved settlement window (the
    // payment deadline the cascade gives the promoted bidder) and composes
    // the well BEFORE the button, where the player still decides.
    expect(bidForm).toContain('wocBidDisclosuresHtml({');
    expect(bidForm).toContain(
      'settlementWindowText: this.countdown(model.settlementWindowSeconds)',
    );
    expect(bidForm.indexOf('wocBidDisclosuresHtml(')).toBeLessThan(bidForm.indexOf('place-bid'));
  });

  it('buy now discloses its walk-away cost BEFORE its button', () => {
    // Buy now claims the listing; leaving without paying pauses the buyer's
    // Buy Now (the re-claim cooldown and the hourly cap). Said where the bid
    // form says its own: ahead of the control that commits.
    expect(buyNowFace).toContain('hudChrome.wocMarket.buyNowNote');
    expect(buyNowFace.indexOf('buyNowNote')).toBeLessThan(
      buyNowFace.indexOf('data-action="buy-now"'),
    );
    // And the window renders that builder for every buy-now face.
    const detail = betweenCode('private detailPaneHtml(', 'private bidFormHtml(');
    expect(detail).toContain('wocBuyNowHtml({');
  });

  it('the consent checkbox LINKS the Marketplace terms at the moment of acceptance (10.3)', () => {
    expect(confirmFields).toContain('hudChrome.wocMarket.termsLabel');
    // The href comes from the shared shell-aware resolver (src/ui/terms_link.ts):
    // same-origin on the site, the canonical page from the desktop and native
    // shells, where a bare '/terms' was a dead link or an app reboot.
    expect(confirmFields).toContain('termsUrlFor(globalThis.location?.origin');
    expect(confirmFields).not.toContain('href="/terms"');
    expect(confirmFields).toContain('hudChrome.wocMarket.termsLink');
    // Still hidden once acceptance is durably recorded.
    expect(confirmFields).toContain('model.activity?.termsAccepted');
  });
});
