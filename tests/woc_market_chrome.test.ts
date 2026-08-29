// The Exchange's status chrome (src/ui/woc_market_chrome.ts) was extracted to
// bring the window's ceiling down, and a faithful move is exactly when the
// cheap direct pin is worth adding: nothing else would notice a face quietly
// changing shape (the same reasoning that earned woc_balance_chip.ts a test).
// Before this file, the deadline tooltip's only automated coverage was a
// toContain('UTC') in the window rig, which passes with the local reading
// dropped, the two readings collapsed, or the timestamp wrong.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTime, setLanguage, t } from '../src/ui/i18n';
import { buildWalletConnectionView } from '../src/ui/wallet_connection_view';
import {
  wocBrowseStripHtml,
  wocEndsAtText,
  wocErrorStatusHtml,
  wocLoadingStatusHtml,
  wocMarketBannersHtml,
  wocSalesHistoryHtml,
  wocSellEmptyHtml,
  wocSpinnerHtml,
} from '../src/ui/woc_market_chrome';

afterEach(() => {
  setLanguage('en');
});

describe('woc_market_chrome: the status builders', () => {
  it('the spinner is the one shared ring, decoration only', () => {
    expect(wocSpinnerHtml()).toBe('<span class="woc-spinner" aria-hidden="true"></span>');
  });

  it('the loading line announces, carries the ring, and reads from the catalog', () => {
    setLanguage('en');
    const html = wocLoadingStatusHtml();
    expect(html).toContain('role="status"');
    expect(html).toContain('class="wm-status wm-status-loading"');
    expect(html).toContain(wocSpinnerHtml());
    expect(html).toContain(t('hudChrome.wocMarket.loading'));
  });

  it('the error line announces in the error voice and ESCAPES its text', () => {
    const html = wocErrorStatusHtml('failed <b>"badly"</b> & loudly');
    expect(html).toContain('role="status"');
    expect(html).toContain('class="wm-status wm-status-error"');
    // The hostile text lands entity-encoded, never as live markup.
    expect(html).toContain('failed &lt;b&gt;&quot;badly&quot;&lt;/b&gt; &amp; loudly');
    expect(html).not.toContain('<b>"badly"</b>');
  });
});

describe('woc_market_chrome: the browse control row', () => {
  const strip = (over: Partial<Parameters<typeof wocBrowseStripHtml>[0]> = {}): string =>
    wocBrowseStripHtml({
      page: 1,
      hasMore: true,
      sort: 'newest',
      quality: null,
      qualityOptions: ['epic', 'legendary'],
      format: null,
      category: null,
      subcategory: null,
      itemQuery: '',
      ...over,
    });

  it('the sort control LEADS the row, and every hook the window owns survives', () => {
    const html = strip();
    // Sort at the very far left (the 15 QA sign-off note): its label opens
    // the row, before the filters and either pager button.
    expect(html.indexOf('wm-sort')).toBeLessThan(html.indexOf('page-prev'));
    expect(html.indexOf('data-field="sort"')).toBeLessThan(html.indexOf('filter-quality'));
    // The focus keys and data hooks the restore ladder and the handlers
    // resolve, byte for byte.
    for (const hook of [
      'data-field="sort"',
      'data-focus-key="wm-sort"',
      'data-field="filter-quality"',
      'data-focus-key="wm-filter-quality"',
      'data-field="filter-format"',
      'data-focus-key="wm-filter-format"',
      'data-field="filter-item"',
      'data-focus-key="wm-filter-item"',
      'data-action="page-prev"',
      'data-focus-key="wm-page-prev"',
      'data-action="page-next"',
      'data-focus-key="wm-page-next"',
    ]) {
      expect(html).toContain(hook);
    }
    expect(html).toContain('value="newest" selected');
  });

  it('disables exactly the pager arm the page position rules out', () => {
    const first = strip({ page: 0, hasMore: true, sort: 'ending' });
    expect(/page-prev[^>]*disabled/.test(first)).toBe(true);
    expect(/page-next[^>]*disabled/.test(first)).toBe(false);
    const last = strip({ page: 3, hasMore: false, sort: 'ending' });
    expect(/page-prev[^>]*disabled/.test(last)).toBe(false);
    expect(/page-next[^>]*disabled/.test(last)).toBe(true);
  });

  it('the filters reflect their state: Any when unset, the value when set', () => {
    const unset = strip();
    // The Any option is selected on both filter selects while no filter is
    // applied (the '' value carries the null).
    expect(/filter-quality[\s\S]*?value="" selected/.test(unset)).toBe(true);
    const set = strip({ quality: 'legendary', format: 'buy_now', itemQuery: 'sword' });
    expect(set).toContain('value="legendary" selected');
    expect(set).toContain('value="buy_now" selected');
    expect(set).toContain('value="sword"');
    // The quality vocabulary is the caller's floor-and-up list, in order.
    expect(set.indexOf('value="epic"')).toBeLessThan(set.indexOf('value="legendary"'));
  });
});

describe('woc_market_chrome: the exact end time', () => {
  // A fixed instant: 2026-01-15 23:30 UTC. The UTC reading is pinned to the
  // literal en spelling, so a wrong timestamp or a dropped UTC override reds
  // here regardless of the machine's own zone.
  const ENDS_MS = Date.UTC(2026, 0, 15, 23, 30);

  it('spells the UTC reading literally and fills both template slots', () => {
    setLanguage('en');
    const text = wocEndsAtText(ENDS_MS);
    // \s before PM, not a literal space: CLDR 44+ spells it with U+202F and
    // older lines with U+0020, and this pin is about the instant, not the
    // separator byte.
    expect(text).toContain('Jan 15, 2026');
    expect(text).toMatch(/11:30\sPM/);
    expect(text).toContain('UTC');
    // The whole line equals the template with BOTH slots filled: an empty or
    // unfilled {local} slot cannot reproduce this string.
    expect(text).toBe(
      t('hudChrome.wocMarket.detailEndsAt', {
        utc: formatDateTime(ENDS_MS, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }),
        local: formatDateTime(ENDS_MS, { dateStyle: 'medium', timeStyle: 'short' }),
      }),
    );
  });

  it('keeps the two readings genuinely distinct: one UTC override, one host clock', () => {
    // A CI box in UTC renders both readings identically, so the collapsed-to-
    // one regression is invisible to the rendered string there. Pin the
    // structure instead: exactly one of the two formatDateTime calls carries
    // the UTC override, on the utc slot.
    const src = readFileSync(
      new URL('../src/ui/woc_market_chrome.ts', import.meta.url),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    const calls = src.match(/formatDateTime\([^)]*\)/g) ?? [];
    // Seven: the two endsAt readings, the sales-history row date (the detail
    // pane's recent-sales builder moved here with the hot-path work), the
    // foot's two rate prints (live time-only; paused dated: the last KNOWN
    // rate names its day), the quote face's settlement deadline, and the
    // seller pane's row date. The seller pane's character-created line was
    // dropped as an unspecced account-age disclosure.
    expect(calls.length, 'every reading comes from the shared formatter').toBe(7);
    expect(calls.filter((c) => c.includes("timeZone: 'UTC'")).length).toBe(1);
    expect(src).toMatch(/utc:\s*formatDateTime\([^)]*timeZone: 'UTC'/);
  });
});

describe('woc_market_chrome: the sales history list', () => {
  it('renders the three-way branch: loading for null, empty line, then rows through the formatters', () => {
    const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    expect(wocSalesHistoryHtml(null, usd)).toContain(t('hudChrome.wocMarket.detailSalesLoading'));
    expect(wocSalesHistoryHtml([], usd)).toContain(t('hudChrome.wocMarket.detailNoSales'));
    const rows = wocSalesHistoryHtml(
      [{ atMs: 1_820_000_000_000, priceCents: 4000, sellerName: 'Selara', buyerName: 'Aldan' }],
      usd,
    );
    expect(rows).toContain('<ul class="wm-sales">');
    expect(rows).toContain('$40.00');
    expect(rows).toContain('Selara');
    expect(rows).toContain('Aldan');
  });
});

describe('woc_market_chrome: the resolved sell caption', () => {
  it('localizes a known floor and passes an unrecognized future policy word through verbatim', () => {
    const known = wocSellEmptyHtml(
      { qualityFloor: 'epic', allowMounts: false, allowMechChromas: false },
      '',
    );
    expect(known).toContain('Epic');
    // A policy word this client predates renders as itself rather than
    // mislabeling: the server validated it, the client just cannot name it.
    const future = wocSellEmptyHtml(
      { qualityFloor: 'mythic', allowMounts: false, allowMechChromas: false },
      '',
    );
    expect(future).toContain('mythic');
  });
});

describe('woc_market_chrome: the standing banners', () => {
  const view = (linked: string | null, connected: string | null, balance: number | null = null) =>
    buildWalletConnectionView({
      enabled: true,
      linkedAddress: linked,
      connectedAddress: connected,
      linkedBalance: balance,
      connectedBalance: null,
    });

  it('renders nothing at all when there is no banner to stand', () => {
    expect(wocMarketBannersHtml({ paused: false, wallet: null })).toBe('');
    const off = buildWalletConnectionView({
      enabled: false,
      linkedAddress: null,
      connectedAddress: null,
      linkedBalance: null,
      connectedBalance: null,
    });
    expect(wocMarketBannersHtml({ paused: false, wallet: off })).toBe('');
  });

  it('the wallet card is the Claudium card: title, state sentence, one action button', () => {
    const html = wocMarketBannersHtml({ paused: false, wallet: view(null, null) });
    expect(html).toContain('<div class="wm-strip">');
    expect(html).toContain('class="wm-banner wm-banner-wallet" data-wallet-kind="unlinked"');
    expect(html).toContain(`<strong>${t('hudChrome.wocStore.wallet.title')}</strong>`);
    expect(html).toContain(`<p>${t('hudChrome.wocStore.wallet.unlinked')}</p>`);
    // The button keeps the window's connect-wallet click action and its focus
    // key, so the existing handler arm and the focus-restore ladder both reach it.
    expect(html).toContain(
      `<button type="button" data-action="connect-wallet" data-focus-key="wm-connect-wallet">${t(
        'hudChrome.wocStore.wallet.connect',
      )}</button>`,
    );
  });

  it('spells the linked states as Reconnect wallet and Manage wallet, never hiding the card', () => {
    const disconnected = wocMarketBannersHtml({ paused: false, wallet: view('L', null) });
    expect(disconnected).toContain('data-wallet-kind="linked_disconnected"');
    expect(disconnected).toContain(`>${t('hudChrome.wocStore.wallet.reconnect')}</button>`);
    expect(disconnected).toContain('pay with $WOC');
    expect(disconnected).not.toContain('SOL or WOC');
    const connected = wocMarketBannersHtml({ paused: false, wallet: view('L', 'L') });
    expect(connected).toContain('data-wallet-kind="linked_connected"');
    expect(connected).toContain(`>${t('hudChrome.wocStore.wallet.manage')}</button>`);
    expect(connected).toContain('$WOC purchases');
    expect(connected).not.toContain('SOL or WOC');
    expect(t('hudChrome.wocStore.wallet.linkedConnected')).toContain('SOL or WOC');
    expect(t('hudChrome.wocStore.wallet.linkedDisconnected')).toContain('pay with SOL or WOC');
    const mismatched = wocMarketBannersHtml({ paused: false, wallet: view('L', 'M') });
    expect(mismatched).toContain(`>${t('hudChrome.wocStore.wallet.verify')}</button>`);
  });

  it('places the verified $WOC balance and USD equivalent before the wallet button', () => {
    const html = wocMarketBannersHtml({
      paused: false,
      wallet: view('L', 'L', 15_625),
      tokensPerUsd: 7_812.5,
    });
    expect(html).toContain('<span class="wm-wallet-balance">');
    expect(html).toContain('15,625 $WOC');
    expect(html).toContain('$2.00 USD');
    expect(html.indexOf('wm-wallet-balance')).toBeLessThan(
      html.indexOf('button type="button" data-action="connect-wallet"'),
    );
  });

  it('never exposes a connected but unverified wallet balance', () => {
    const unverified = buildWalletConnectionView({
      enabled: true,
      linkedAddress: null,
      connectedAddress: 'connected',
      linkedBalance: null,
      connectedBalance: 15_625,
    });
    const html = wocMarketBannersHtml({
      paused: false,
      wallet: unverified,
      tokensPerUsd: 7_812.5,
    });
    expect(unverified.balance).toBe(15_625);
    expect(unverified.balanceVerified).toBe(false);
    expect(html).not.toContain('wm-wallet-balance');
    expect(html).not.toContain('15,625 $WOC');
  });

  it('renders a verified zero balance and its zero-dollar equivalent', () => {
    const html = wocMarketBannersHtml({
      paused: false,
      wallet: view('L', 'L', 0),
      tokensPerUsd: 7_812.5,
    });
    expect(html).toContain('<span class="wm-wallet-balance">');
    expect(html).toContain('0 $WOC');
    expect(html).toContain('$0.00 USD');
  });

  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'keeps the verified token balance but labels an unusable %s rate as unknown',
    (tokensPerUsd) => {
      const html = wocMarketBannersHtml({
        paused: false,
        wallet: view('L', 'L', 15_625),
        tokensPerUsd,
      });
      expect(html).toContain('15,625 $WOC');
      expect(html).toContain(t('hudChrome.wocMarket.walletUsdUnknown'));
      expect(html).not.toContain('$2.00');
      expect(html).not.toContain(' USD');
    },
  );

  it('owns the unusable-rate fallback instead of borrowing Daily Rewards copy', () => {
    const src = readFileSync(new URL('../src/ui/woc_market_chrome.ts', import.meta.url), 'utf8');
    expect(src).toContain("t('hudChrome.wocMarket.walletUsdUnknown')");
    expect(src).not.toContain("t('hudChrome.dailyRewards.unknown')");
  });

  it('pins the desktop left-of-button columns and the one-column touch stack', () => {
    const componentsCss = readFileSync(
      new URL('../src/styles/components.css', import.meta.url),
      'utf8',
    );
    const mobileCss = readFileSync(
      new URL('../src/styles/hud.mobile.css', import.meta.url),
      'utf8',
    );
    expect(componentsCss).toMatch(
      /#woc-market-window \.wm-banner-wallet \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(160px, 220px\);/,
    );
    expect(componentsCss).toMatch(
      /#woc-market-window \.wm-wallet-balance \{[^}]*grid-column: 2;[^}]*grid-row: 1 \/ 3;/,
    );
    expect(componentsCss).toMatch(
      /#woc-market-window \.wm-banner-wallet button \{[^}]*grid-column: 3;[^}]*grid-row: 1 \/ 3;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #woc-market-window \.wm-banner-wallet \{[^}]*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #woc-market-window \.wm-wallet-balance \{[^}]*grid-column: 1;[^}]*grid-row: auto;[^}]*align-items: flex-start;[^}]*text-align: left;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #woc-market-window \.wm-banner-wallet button \{[^}]*grid-column: 1;[^}]*grid-row: auto;[^}]*min-height: 44px;/,
    );
  });

  it('the paused banner leads the strip, the wallet card follows it', () => {
    const html = wocMarketBannersHtml({ paused: true, wallet: view(null, null) });
    expect(html.indexOf('wm-banner-paused')).toBeGreaterThan(-1);
    expect(html.indexOf('wm-banner-paused')).toBeLessThan(html.indexOf('wm-banner-wallet'));
    expect(html).toContain(t('hudChrome.wocMarket.pausedBanner'));
  });
});
