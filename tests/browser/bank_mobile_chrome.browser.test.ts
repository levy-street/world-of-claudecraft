// The personal bank pane's short-phone chrome, measured in a REAL browser
// inside the gate (Bank Storage phase 18).
//
// WHY THIS FILE EXISTS. The phase's central claim is geometric: on a stocked
// bank the footer, which carries the capacity meter, the gilded near-full
// warning, the expansion price, the buy button and the Claudium purchase-result
// band, must be INSIDE the window rather than clipped outside it. Before the
// fix it sat 89.2px past the border at 844x390 and 119.2px at 740x360.
//
// Nothing in the Node suite can see that. jsdom and happy-dom implement no
// layout, so every arm there is about text, ordering or a pure decision. The
// live rig scripts/bank_mobile_buyrow_check.mjs measures the real thing but
// needs `npm run dev` and is not in `npm run gate`, so a regression could reach
// a merge with every gated suite green. This file is the gated instrument: real
// Chromium, real stylesheets, real layout, at the two profiles the phase names.
//
// The mobile-viewport recipe is the house one (tests/browser/armory_mobile_layout):
// page.viewport, body.mobile-touch, and the three --app-* / --ui-scale vars the
// window's own clamps divide by.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { BankWindow, type BankWindowDeps } from '../../src/ui/bank_window';
import type { EnTranslations } from '../../src/ui/i18n.catalog';
import { en } from '../../src/ui/i18n.resolved.generated/en';
import { en_XA } from '../../src/ui/i18n.resolved.generated/en_XA';
import { LOCALE_LOADERS } from '../../src/ui/i18n.resolved.generated/loaders';
import type { BankInfo } from '../../src/world_api';
import { cleanup, host, stubDeps } from './_harness';

// The footer may eat into the window's bottom padding, never past its border.
const CLEARANCE = 2;
// The touch floor every control in this pane keeps (src/styles/CLAUDE.md).
const TOUCH_FLOOR = 40;

/** Every shipped `hudChrome.bank.rungOutage` value, keyed by locale tag: the
 *  21 loader locales plus en and the en_XA pseudo-locale. Loaded from the
 *  generated bundles so a catalog reword or a NEW locale joins the reserve
 *  arm on the next regen instead of leaving it measuring a pre-picked copy.
 *  Only a browser can rank these (CJK copy is far shorter in characters and
 *  taller in nothing), which is why the arm measures every one rather than
 *  trusting any single wordiest pick. */
async function allLocaleBundles(): Promise<Array<[string, EnTranslations]>> {
  const bundles: Array<[string, EnTranslations]> = [
    ['en', en],
    ['en_XA', en_XA],
  ];
  for (const [tag, load] of Object.entries(LOCALE_LOADERS)) {
    const mod = (await load()) as unknown as Record<string, EnTranslations>;
    const bundle = mod[tag];
    // A regen that renamed a bundle export would otherwise surface as an
    // opaque undefined-read deep in an arm; name it here instead.
    if (!bundle) throw new Error(`locale bundle ${tag} did not export itself under its own tag`);
    bundles.push([tag, bundle]);
  }
  return bundles;
}

/** The DISTINCT shipped values of one bank string, tagged by the first locale
 *  carrying each. Deduped by value: most Latin locales are byte-identical
 *  English until the maintainer's release fill lands, so staging duplicates
 *  buys nothing; deduping keeps each arm one measurement per real string
 *  while a future fill or reword joins automatically on the next regen. */
async function distinctBankCopies(
  pick: (bundle: EnTranslations) => string,
): Promise<Array<[string, string]>> {
  const byValue = new Map<string, string>();
  for (const [tag, bundle] of await allLocaleBundles()) {
    const copy = pick(bundle);
    if (!byValue.has(copy)) byValue.set(copy, tag);
  }
  return [...byValue.entries()].map(([copy, tag]) => [tag, copy]);
}

const allOutageCopies = (): Promise<Array<[string, string]>> =>
  distinctBankCopies((bundle) => bundle.hudChrome.bank.rungOutage);

const allDepositAllCopies = (): Promise<Array<[string, string]>> =>
  distinctBankCopies((bundle) => bundle.hudChrome.bank.depositAll);

const PROFILES = [
  { name: '844x390', width: 844, height: 390 },
  { name: '740x360', width: 740, height: 360 },
];

/** A STOCKED, near-full bank: 23 of 32 slots with a socketed materials satchel,
 *  which is the state the whole phase is about. The general pool is past
 *  BANK_NEAR_FULL_FRACTION, so the footer carries the gilded treatment, and the
 *  bank is non-empty, so the full search/chips toolbar mounts. An EMPTY bank
 *  drops that toolbar and is exactly the state the phase 07 checks passed over. */
function stockedBank(over: Partial<BankInfo> = {}): BankInfo {
  return {
    slots: Array.from({ length: 23 }, () => ({ itemId: 'iron_ore', count: 1 })),
    capacity: 32,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    nextRungClaudiumPrice: 1200,
    bonusSources: [],
    socketsUnlocked: 1,
    socketBags: ['burlap_reagent_pouch', null, null, null],
    nextSocketCost: 2_000_000,
    generalCapacity: 24,
    materialsCapacity: 8,
    generalUsed: 21,
    materialsUsed: 2,
    ...over,
  };
}

function openBankWindow(
  info: BankInfo,
  band?: { granted: boolean; reason: string | null },
): { root: HTMLElement; win: BankWindow } {
  const root = host('bank-window');
  const stack = document.createElement('div');
  stack.id = 'prompt-stack';
  document.body.appendChild(stack);
  const world = {
    bankInfo: info,
    guildBankInfo: null,
    // NON-NULL on purpose. The tab strip mounts only when a vault or a guild
    // pane exists, and vaultInfo rides the SAME nearBanker gate as bankInfo, so
    // a bank open at a bursar always has one. A null here silently drops a
    // 40px rigid band and would leave every measurement below taking a pane
    // production never paints.
    vaultInfo: { stock: {}, upgrades: 1, perMaterialCap: 40, nextUpgradeCost: 2_000 },
    inventory: [],
    bags: [null, null, null, null],
    copper: 100_000_000,
  };
  const win = new BankWindow(
    stubDeps({
      root: () => root,
      world: () => world as never,
      itemIcon: () => '<span class="item-icon"></span>',
      moneyHtml: (c: number) => `<span class="money-inline">${c}</span>`,
      itemTooltip: () => '',
      captureFocus: () => null,
      consumePeek: () => false,
      storeEnabled: () => true,
    }) as BankWindowDeps,
  );
  // Staged by NAME before the first paint, exactly as tests/browser/a11y stages
  // it and for the same reason: the band is read at markup-build time and
  // neither the window nor the controller exposes a public setter. If those
  // names move, they move here in the same change.
  if (band) {
    (win as unknown as { rungPurchase: { band: unknown } }).rungPurchase.band = band;
  }
  win.open();
  return { root, win };
}

/** The root alone, for the arms that only measure. */
function openBank(info: BankInfo, band?: { granted: boolean; reason: string | null }): HTMLElement {
  return openBankWindow(info, band).root;
}

describe('the desktop bank toolbar (no mobile-touch)', () => {
  it('WRAPS at the resize floor in a wordy locale instead of clipping off the edge', async () => {
    // The other half of the one-row contract's scoping: on desktop the
    // nowrap regime must NOT apply (the generic .bag-tools wrap survives),
    // so a bank window resized toward its 220px floor
    // (window_resize_core.ts WINDOW_MIN_WIDTH) in a wordy locale drops the
    // deposit button to a second row, information-preserving, rather than
    // pushing it past the window's clipped edge.
    document.body.className = 'game-active';
    const root = openBank(stockedBank());
    root.style.width = '220px';
    const tools = root.querySelector('.bag-tools') as HTMLElement;
    expect(getComputedStyle(tools).flexWrap).toBe('wrap');
    const deposit = root.querySelector('.bank-deposit-all') as HTMLElement;
    let wordiest = '';
    for (const [, copy] of await allDepositAllCopies()) {
      if (copy.length > wordiest.length) wordiest = copy;
    }
    deposit.textContent = wordiest;
    const search = root.querySelector('.bag-search') as HTMLElement;
    // Wrapped: the deposit control sits on a LOWER row than the search box.
    expect(deposit.getBoundingClientRect().top).toBeGreaterThan(
      search.getBoundingClientRect().top + 10,
    );
    // And the wrapped control STARTS at the toolbar's left edge on its own
    // row, the information-preserving property the wrap buys: under nowrap
    // it would start hundreds of pixels right and clip almost entirely.
    // Deliberately NOT a scrollWidth === clientWidth assertion: on a wide
    // platform font stack the 30-char label's own min-content can exceed a
    // 220px-floor window's content box by a few pixels even on its own row
    // (CI measured 204 against 192), and that residue scrolls rather than
    // hiding the control.
    expect(
      deposit.getBoundingClientRect().left - tools.getBoundingClientRect().left,
    ).toBeLessThanOrEqual(4);
  });
});

/** How far past the window's own bottom border an element's bottom edge sits.
 *  Positive is the defect; the phase's contract is that it stays at or below
 *  -CLEARANCE. */
function past(root: HTMLElement, selector: string): number {
  const el = root.querySelector(selector);
  if (!el) return Number.POSITIVE_INFINITY;
  return el.getBoundingClientRect().bottom - root.getBoundingClientRect().bottom;
}

beforeEach(() => {
  document.body.className = 'mobile-touch game-active bank-open';
});

afterEach(() => {
  cleanup();
  document.getElementById('prompt-stack')?.remove();
  document.body.className = '';
  for (const v of ['--app-vw', '--app-vh', '--ui-scale']) {
    document.documentElement.style.removeProperty(v);
  }
});

for (const profile of PROFILES) {
  describe(`the stocked personal bank pane at ${profile.name}`, () => {
    beforeEach(async () => {
      await page.viewport(profile.width, profile.height);
      document.documentElement.style.setProperty('--app-vw', `${profile.width}px`);
      document.documentElement.style.setProperty('--app-vh', `${profile.height}px`);
      document.documentElement.style.setProperty('--ui-scale', '1');
    });

    it('keeps the whole footer inside the window border', () => {
      const root = openBank(stockedBank());
      // Guard the staging first: axe over a scope that lost these nodes passes
      // as cleanly as one that audits them, and so does a geometry assertion.
      expect(
        root.querySelector('.bank-footer.near-full'),
        'the gilded footer must mount',
      ).not.toBeNull();
      expect(root.querySelector('.bag-search'), 'a stocked bank mounts the toolbar').not.toBeNull();
      expect(past(root, '.bank-footer')).toBeLessThanOrEqual(-CLEARANCE);
      // The three the phase exists for, each measured on its own so a partial
      // regression names itself.
      expect(past(root, '.bank-meter')).toBeLessThanOrEqual(-CLEARANCE);
      expect(past(root, '.bank-meter-text')).toBeLessThanOrEqual(-CLEARANCE);
      expect(past(root, '.bank-buy-row')).toBeLessThanOrEqual(-CLEARANCE);
      // SELF-GUARD: if the window's max-height clamp ever stopped reaching this
      // fixture the root would grow to fit its content and every `past()` above
      // would go negative on a layout nobody would ship.
      expect(root.scrollHeight, 'the window must really be clamped').toBeGreaterThan(
        root.clientHeight,
      );
    });

    it.each([0.85, 1.4])('keeps the footer inside the window at uiScale %s', (scale) => {
      // NOBODY MEASURED THIS, and the suite around it force-pins --ui-scale to
      // 1, which is the shape of coverage that reads as complete and is not.
      // #bank-window is a direct child of #ui, which carries
      // `zoom: var(--ui-scale)`, and the player-configurable range is 0.85 to
      // 1.4 (hudChrome.options.uiScale). The window's own max-height divides by
      // --window-scale while the pinned footer's geometry does not, so the two
      // could disagree at either end for reasons that have nothing to do with
      // the safe area.
      //
      // WHAT THIS CANNOT SEE, stated so the arm is not read as more than it is:
      // headless reports ZERO safe-area insets, so the env() half of
      // --bank-footer-inset resolves to its 18px floor at every scale here. That
      // the family does not zoom-compensate env() is true of every mobile window
      // (no rule in src/styles divides a padding-bottom by --ui-scale) and is
      // deliberately inherited rather than fixed here: this footer's negative
      // margin exists to cancel the window's OWN padding, so dividing one
      // without the other would mis-place it at every scale, 1 included.
      document.documentElement.style.setProperty('--ui-scale', String(scale));
      const root = openBank(stockedBank());
      expect(getComputedStyle(root).overflowY, 'the compact regime must still be live').toBe(
        'auto',
      );
      expect(past(root, '.bank-footer')).toBeLessThanOrEqual(-CLEARANCE);
      expect(past(root, '.bank-meter')).toBeLessThanOrEqual(-CLEARANCE);
      expect(past(root, '.bank-buy-row')).toBeLessThanOrEqual(-CLEARANCE);
      expect(root.scrollHeight, 'the window must still be clamped').toBeGreaterThan(
        root.clientHeight,
      );
    });

    it('keeps the footer inside at MAXIMUM scroll, which is where sticky stops being sticky', () => {
      const root = openBank(stockedBank());
      root.scrollTop = 99_999;
      expect(root.scrollTop, 'the pane must actually scroll').toBeGreaterThan(0);
      expect(past(root, '.bank-footer')).toBeLessThanOrEqual(-CLEARANCE);
      // ...and nothing is PERMANENTLY parked underneath it: the footer is in the
      // flow, so the last grid cells clear it at the end of the scroll.
      const footerTop = root.querySelector('.bank-footer')!.getBoundingClientRect().top;
      const cells = root.querySelectorAll('.bank-item');
      expect(cells.length).toBeGreaterThan(0);
      const last = cells[cells.length - 1].getBoundingClientRect();
      expect(last.bottom).toBeLessThanOrEqual(footerTop);
    });

    it('leaves the pane exactly ONE vertical scroller and forbids no horizontal pan', () => {
      const root = openBank(stockedBank());
      expect(getComputedStyle(root).overflowY).toBe('auto');
      // touch-action binds descendants and .bag-chips is a horizontal scroller
      // inside this window, so a pan-y here would put the chips out of reach.
      expect(getComputedStyle(root).touchAction).toBe('auto');
      const nested = [...root.querySelectorAll('*')].filter((el) => {
        const oy = getComputedStyle(el).overflowY;
        return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight;
      });
      expect(nested.map((el) => el.className)).toEqual([]);
      expect(root.scrollHeight, 'the item grid stays reachable by scrolling').toBeGreaterThan(
        root.clientHeight,
      );
    });

    it('hides no control it merely allowed to scroll', () => {
      const root = openBank(stockedBank());
      for (const selector of [
        '.bank-tab',
        '.bag-socket',
        '.bag-chip',
        '.bag-search',
        '.bag-sort',
        '.bank-deposit-all',
        '.bank-buy-btn',
      ]) {
        // EVERY match, not the first: hiding all but one chip or one tab is a
        // real way to shed controls and querySelector cannot see it.
        const all = [...root.querySelectorAll<HTMLElement>(selector)];
        expect(all.length, `${selector} must still exist`).toBeGreaterThan(0);
        for (const el of all) {
          const box = el.getBoundingClientRect();
          expect(box.width, `${selector} width`).toBeGreaterThan(0);
          expect(box.height, `${selector} touch floor`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
          // A box keeps its SIZE under both of these, so geometry alone is
          // blind to them and they are the cheap ways to hide a control.
          const cs = getComputedStyle(el);
          expect(cs.visibility, `${selector} visibility`).toBe('visible');
          expect(Number.parseFloat(cs.opacity), `${selector} opacity`).toBeGreaterThan(0.1);
        }
      }
      // .bank-status is in the module's scrolling-band list and has no leg here:
      // it mounts only after a real deposit-all, which this fixture cannot drive
      // (the window's world double has no bags to deposit from). The live rig
      // scripts/bank_mobile_buyrow_check.mjs drives it and measures the footer
      // in that state at all three profiles.
    });

    it('reserves enough scroll padding for the footer at its TALLEST', () => {
      // The reserve in the sheet is a written SUM of the footer's terms, and a
      // locale whose result copy wraps further grows the real band past it. That
      // is what this arm exists to see, so it compares the reserve against the
      // MEASURED footer rather than against the sum's own arithmetic.
      //
      // WHICH MEANS THE STAGING IS THE ARM. Measured against a footer with no
      // result band, the comparison passes with roughly a band's worth of
      // unclaimed slack and could never fail; the outage band is the tallest
      // state the footer has, so that is what it is measured against.
      const root = openBank(stockedBank(), { granted: false, reason: 'some_unknown_token' });
      const band = root.querySelector('.bank-rung-notice');
      expect(band, 'the tallest state must actually be staged').not.toBeNull();
      const reserve = Number.parseFloat(getComputedStyle(root).scrollPaddingBottom);
      expect(Number.isFinite(reserve), 'scroll-padding-bottom must be a real length').toBe(true);
      const footer = root.querySelector('.bank-footer')!.getBoundingClientRect();
      expect(footer.height, 'the band must really have grown the footer').toBeGreaterThan(80);
      expect(reserve).toBeGreaterThanOrEqual(footer.height);
    });

    it('reserves enough for EVERY shipped locale, measured here, not pre-picked', async () => {
      // The arm above measures the real footer, which is right, but it only ever
      // runs in English, and the band term is the one the sheet's own comment
      // says no arithmetic can own because it GROWS with a locale whose refusal
      // copy wraps further. This arm stages the outage copy of EVERY shipped
      // locale (plus en_XA) into the band and asserts the reserve against each
      // MEASURED footer, so the reserve can never quietly go stale behind a
      // single hand-picked wordiest locale: the next reword that walks past the
      // reserve reds here, whichever locale does the walking.
      //
      // Honest scope: only the band copy varies; the meter text and buy label
      // stay English (a full per-locale re-render needs i18n plumbing this
      // harness lacks), which matches the risk, since the band is the one
      // footer term the sheet's sum cannot own.
      //
      // It does NOT assert that a wordier copy is TALLER than English's. In
      // this harness the English band already wraps to the same bucket, so a
      // strict growth guard is unsatisfiable; the tallest-staged guard below
      // proves the wrap really happened for at least one locale.
      const root = openBank(stockedBank(), { granted: false, reason: 'some_unknown_token' });
      const band = root.querySelector('.bank-rung-notice') as HTMLElement | null;
      expect(band, 'the tallest state must actually be staged').not.toBeNull();
      const reserve = Number.parseFloat(getComputedStyle(root).scrollPaddingBottom);
      let tallestBand = 0;
      for (const [tag, copy] of await allOutageCopies()) {
        band!.textContent = copy;
        tallestBand = Math.max(tallestBand, band!.getBoundingClientRect().height);
        const footer = root.querySelector('.bank-footer')!.getBoundingClientRect();
        expect(
          reserve,
          `the scroll reserve must cover the footer under the ${tag} outage copy`,
        ).toBeGreaterThanOrEqual(footer.height);
        expect(
          past(root, '.bank-footer'),
          `the footer must stay inside the window border under the ${tag} copy`,
        ).toBeLessThanOrEqual(-CLEARANCE);
      }
      // Guard the staging, because the interesting failure is a SILENT one: if
      // every band collapsed to a single line this arm would be measuring a
      // state the reserve was never at risk from.
      expect(
        tallestBand,
        'the wordiest band must really have wrapped to more than one line',
      ).toBeGreaterThan(TOUCH_FLOOR);
    });

    it('a repaint that re-focuses the search box does not spend the restored offset', () => {
      // THE REGRESSION THIS HOLDS, and it is one this phase created. Making the
      // window a scroller invalidated a premise written down in
      // focus_restore.ts: that the control being re-focused is the one the
      // player was already on and is therefore in view. On a short phone they
      // can scroll away from the search box while it still holds focus, and a
      // repaint's bare focus() then scrolls it back and undoes the offset
      // restoreScroll wrote one line earlier. Measured at 127px before the fix.
      //
      // Only a real browser can see it: focus() performs no scroll at all when
      // the target is already inside the scrollport, which is why a probe taken
      // at the top of the pane says everything is fine.
      const { root, win } = openBankWindow(stockedBank());
      const search = root.querySelector<HTMLInputElement>('.bag-search');
      expect(search, 'a stocked bank mounts the search box').not.toBeNull();
      // The player focuses the search, then scrolls away from it. Focusing FIRST
      // is what makes render() take the searchFocus path at all.
      search!.focus();
      root.scrollTop = 99_999;
      const parked = root.scrollTop;
      expect(parked, 'the pane must really scroll').toBeGreaterThan(0);
      expect(
        search!.getBoundingClientRect().top,
        'the search box must really be above the fold, or focus scrolls nothing',
      ).toBeLessThan(root.getBoundingClientRect().top);
      expect(document.activeElement, 'render must see the search as focused').toBe(search);
      // A repaint the player did not ask for. It must put the view back and
      // leave it there.
      win.render();
      expect(root.scrollTop, 'the repaint spent the restored scroll offset').toBe(parked);
      expect(
        (root.querySelector('.bag-search') as HTMLElement | null) === document.activeElement,
        'the repaint must keep focus on the search box',
      ).toBe(true);
    });

    it('a control the browser SCROLLS into view clears both pinned bands', () => {
      // WHAT THIS DOES NOT CLAIM, measured rather than assumed: scroll padding
      // only bites when a scroll actually happens. A control already inside the
      // scrollport is not scrolled at all, even when a sticky band overlaps it,
      // so a control near the fold sits partly under the footer until the player
      // scrolls, which is what scrolling content under a pinned band means and
      // is true of every sticky footer. Reachability is the contract, and the
      // arms above hold it.
      //
      // What IS at stake is the landing: a control the browser scrolls TO comes
      // to rest at the scrollport edge, which is exactly where a pinned band is.
      // Without the sheet's scroll-padding pair, a grid cell below the fold lands
      // under the footer and a cell above it lands under the title.
      const root = openBank(stockedBank());
      const footerTop = () => root.querySelector('.bank-footer')!.getBoundingClientRect().top;
      const titleBottom = () => root.querySelector('.panel-title')!.getBoundingClientRect().bottom;
      const cells = root.querySelectorAll<HTMLElement>('.bank-item');
      expect(cells.length).toBeGreaterThan(1);

      // DOWN: the last cell starts below the fold, so this really scrolls.
      root.scrollTop = 0;
      const last = cells[cells.length - 1];
      expect(
        last.getBoundingClientRect().bottom,
        'the last cell must start below the fold',
      ).toBeGreaterThan(footerTop());
      last.scrollIntoView({ block: 'nearest' });
      expect(root.scrollTop, 'scrolling down must have moved the pane').toBeGreaterThan(0);
      expect(
        last.getBoundingClientRect().bottom,
        'a cell scrolled into view landed under the pinned footer',
      ).toBeLessThanOrEqual(footerTop());

      // UP: from the bottom, the first cell is above the fold.
      root.scrollTop = 99_999;
      const first = cells[0];
      expect(
        first.getBoundingClientRect().top,
        'the first cell must start above the fold',
      ).toBeLessThan(titleBottom());
      first.scrollIntoView({ block: 'nearest' });
      expect(
        first.getBoundingClientRect().top,
        'a cell scrolled into view landed under the pinned title',
      ).toBeGreaterThanOrEqual(titleBottom());
    });

    it('the pinned footer paints OVER the grid that scrolls beneath it', () => {
      // The footer's stacking order had exactly one arm and it was a PRESENCE
      // check, so flattening z-index to a negative value left every suite green
      // while item cells painted over the capacity meter, the gilded near-full
      // warning and the buy button. Measured at 844x390: with the footer behind,
      // document.elementFromPoint inside the overlap returns a `.bank-item`.
      //
      // This asserts the CONSEQUENCE (who owns the pixel), not the declaration,
      // and it guards its own staging first: an overlap that never happens makes
      // the occlusion question unaskable and the arm vacuous.
      const root = openBank(stockedBank());
      const footer = root.querySelector('.bank-footer') as HTMLElement;
      expect(footer, 'the footer must mount').not.toBeNull();
      const cells = root.querySelectorAll<HTMLElement>('.bank-item');
      expect(cells.length, 'the grid must have cells to scroll under the footer').toBeGreaterThan(
        1,
      );

      const range = root.scrollHeight - root.clientHeight;
      expect(range, 'the pane must actually scroll, or nothing can pass under').toBeGreaterThan(10);

      let sawOverlap = false;
      let stolenBy: string | null = null;
      for (let top = 0; top <= range; top += Math.max(1, Math.round(range / 12))) {
        root.scrollTop = top;
        const fb = footer.getBoundingClientRect();
        for (const cell of cells) {
          const cb = cell.getBoundingClientRect();
          const overlap = Math.min(cb.bottom, fb.bottom) - Math.max(cb.top, fb.top);
          if (overlap <= 4) continue;
          sawOverlap = true;
          const x = Math.round(Math.max(cb.left, fb.left) + 4);
          const y = Math.round(Math.max(cb.top, fb.top) + 2);
          const hit = document.elementFromPoint(x, y);
          if (hit && !footer.contains(hit)) {
            stolenBy = (hit.className || hit.tagName).toString();
          }
        }
      }
      expect(sawOverlap, 'no cell ever reached the footer: the arm would be vacuous').toBe(true);
      expect(stolenBy, 'a grid cell painted OVER the pinned footer').toBeNull();
    });

    it('keeps search, sort and Deposit all on ONE toolbar row', () => {
      // The phase measured the toolbar down from 132px to 86px by yielding the
      // search box's intrinsic flex basis, and nothing pinned the result: growing
      // the basis restores the three-row wrap (measured 86 -> 132 at 844x390,
      // search 177 -> 299) with every suite green, costing 46px of grid on the
      // device the phase exists to fix.
      //
      // The claim is ONE ROW, so it is asserted as row-sharing rather than as a
      // height literal: the three controls must share a top edge.
      const root = openBank(stockedBank());
      const search = root.querySelector('.bag-search') as HTMLElement | null;
      const sort = root.querySelector('.bag-sort') as HTMLElement | null;
      const deposit = root.querySelector('.bank-deposit-all') as HTMLElement | null;
      expect(search, 'a stocked bank mounts the search box').not.toBeNull();
      expect(sort, 'a stocked bank mounts the sort control').not.toBeNull();
      expect(deposit, 'a stocked bank mounts Deposit all').not.toBeNull();

      const tops = [search!, sort!, deposit!].map((el) => el.getBoundingClientRect().top);
      expect(
        Math.max(...tops) - Math.min(...tops),
        'search, sort and Deposit all must share one row',
      ).toBeLessThan(TOUCH_FLOOR / 2);

      // And the search box still clears its own floor on the narrower profile.
      expect(
        search!.getBoundingClientRect().width,
        'the search box must stay above its 96px floor',
      ).toBeGreaterThanOrEqual(96);
    });

    it('the one-row toolbar holds the WORDIEST deposit label without clipping', async () => {
      // The nowrap regime forbids the wrap that would otherwise absorb a wordy
      // locale, and the window carries overflow:hidden, so a label the row
      // cannot fit is CLIPPED, not wrapped: the silent failure mode. Stage the
      // longest shipped depositAll value into the button (es and es_ES, 30
      // characters, measured across the generated bundles) and require the
      // toolbar to still fit its own box at both profiles.
      const root = openBank(stockedBank());
      const tools = root.querySelector('.bag-tools') as HTMLElement | null;
      const deposit = root.querySelector('.bank-deposit-all') as HTMLElement | null;
      expect(tools).not.toBeNull();
      expect(deposit).not.toBeNull();
      let wordiest = '';
      for (const [, copy] of await allDepositAllCopies()) {
        if (copy.length > wordiest.length) wordiest = copy;
      }
      deposit!.textContent = wordiest;
      expect(
        tools!.scrollWidth,
        `the toolbar must fit the wordiest deposit label ("${wordiest}") without clipping`,
      ).toBeLessThanOrEqual(tools!.clientWidth);
      const search = root.querySelector('.bag-search') as HTMLElement | null;
      const tops = [search!, deposit!].map((el) => el.getBoundingClientRect().top);
      expect(
        Math.max(...tops) - Math.min(...tops),
        'the wordiest label must not force a second row either',
      ).toBeLessThan(TOUCH_FLOOR / 2);
    });
  });
}
