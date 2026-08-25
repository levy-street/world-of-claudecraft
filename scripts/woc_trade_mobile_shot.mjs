// The trade window's $WOC arm, in a REAL viewport: renders every face the
// money surface shows (the buyer's compose form with the consent row, the pay
// face, the quote review, both review faces, the seller's waiting faces) by
// driving the REAL woc_trade controller + panel + CSS in the offline game
// (the controller state is stubbed the way trade_money_shot.mjs stubs
// sim.tradeInfo: the arm is online-only, so no offline flow reaches it), then
// MEASURES the mobile touch floors the stylesheet claims (40px consent label,
// terms link and buttons, 24px checkbox), asserts each control is on screen and
// the top-most element at its centre (tappable, not covered), and captures a
// screenshot per face at the lowest graphics preset.
//
// Dev-only, not wired into any npm script or CI gate (the DOM units in
// tests/trade_woc_arm_painter.test.ts pin the markup; this is the pixel-geometry arm
// they cannot see). Landscape phone by default (in-game mobile is landscape
// only); DESKTOP=1 renders the desktop window instead. Needs `npm run dev`.
//
//   node scripts/woc_trade_mobile_shot.mjs
//   GAME_URL=http://localhost:5188 OUT=tmp/woc-trade node scripts/woc_trade_mobile_shot.mjs
//   STRESS=1       stubs the extremes instead of the pristine deal: a 16-letter
//                  partner, the longest sellable item name, the maximum price and
//                  a seven-figure token quote (files carry a -stress suffix).
//   SHOT_LANG=ru_RU boots the client in that locale (the wordiest fills) and
//                  suffixes every capture with the locale.
//   SHOT_PREFIX=before names the files before-* instead of after-*.
//   BAGS_OVER=1    leaves the bags window where the trade opens it (the sheet
//                  split) instead of hiding it before measuring.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';
import { dismissPerfNudge } from './lib/perf_nudge_dismiss.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'docs/screenshots/woc-market';
const MOBILE = process.env.DESKTOP !== '1';
const STRESS = process.env.STRESS === '1';
const SHOT_LANG = process.env.SHOT_LANG ?? '';
const SHOT_PREFIX = process.env.SHOT_PREFIX ?? 'after';
const BAGS_OVER = process.env.BAGS_OVER === '1';
const URL = SHOT_LANG ? `${GAME_URL}/?lang=${encodeURIComponent(SHOT_LANG)}` : GAME_URL;
const SUFFIX = `${STRESS ? '-stress' : ''}${SHOT_LANG ? `-${SHOT_LANG}` : ''}`;
// The stubbed deal: pristine by default, the extremes under STRESS (the name
// cap, the longest sellable name, the maximum price, a seven-figure quote).
const PARTNER = STRESS ? 'Bartholomewsmith' : 'Aldric';
const ITEM = STRESS ? 'voidsong_dirk' : 'deathlord_warplate';
const USD_CENTS = STRESS ? 100000 : 1500;
const TOKENS = STRESS ? 7812500.25 : 1234.5;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    MOBILE ? '--window-size=900,440' : '--window-size=1400,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});
const page = await browser.newPage();
await suppressGpuNotice(page);
// The capture rule: lowest graphics preset, seeded before the document loads.
await page.evaluateOnNewDocument(
  `try { const k = 'woc_settings'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.graphicsPreset = 1; s.graphicsDefaultApplied = true; localStorage.setItem(k, JSON.stringify(s)); } catch {}`,
);
if (MOBILE) {
  await page.emulate({
    name: 'phone-landscape',
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
    viewport: {
      width: 900,
      height: 420,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      isLandscape: true,
    },
  });
} else {
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
}
page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 200));
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Bramble', settleMs: 2500 });
await page.evaluate(() => document.getElementById('mobile-preflight-continue')?.click());
await sleep(500);
const touchOn = await page.evaluate(() => document.body.classList.contains('mobile-touch'));
console.log('mobile-touch active:', touchOn);
if (MOBILE) check(touchOn, 'body.mobile-touch is active in the landscape phone viewport');

// Stub the online-only pieces the arm needs, then drive the REAL controller.
const staged = await page.evaluate(
  (PARTNER, ITEM, USD_CENTS, TOKENS, BAGS_OVER) => {
    const hud = window.__game.hud;
    const sim = window.__game.sim;
    const TI = {
      otherPid: 999,
      otherName: PARTNER,
      myOffer: { items: [], copper: 0 },
      theirOffer: { items: [{ itemId: ITEM, count: 1 }], copper: 0 },
      myAccepted: false,
      theirAccepted: false,
    };
    Object.defineProperty(sim, 'tradeInfo', { configurable: true, get: () => TI });
    const hooks = {
      client: {
        status: async () => ({ ok: false }),
        me: async () => ({ ok: false }),
        offers: async () => ({ ok: false }),
        tradePartner: async () => ({ name: PARTNER, walletVerified: true }),
      },
      characterId: () => 1,
      walletLinked: () => true,
      signAndSendTransactionBase64: async () => 'sig',
      signMessageBase58: async () => 'sig',
    };
    const ctl = hud.wocTrade;
    Object.defineProperty(ctl, 'wocMarketHooks', { configurable: true, get: () => hooks });
    ctl.updateTradeWindow(); // first open: resets the arm state
    ctl.wocTradePartnerFor = PARTNER;
    ctl.wocTradePartner = { name: PARTNER, walletVerified: true };
    ctl.wocTradePartnerResolved = true;
    ctl.wocTradeTermsAccepted = false;
    ctl.wocTradeMinPriceCents = 100;
    ctl.wocTradeDirectedHoldSeconds = 600;
    ctl.wocTradeMode = 'woc';
    ctl.wocTradeUsdCents = USD_CENTS;
    ctl.wocTradeTokens = TOKENS;
    ctl.wocTradeSplit = {
      sellerCents: Math.floor(USD_CENTS * 0.9),
      burnCents: Math.ceil(USD_CENTS * 0.03),
      treasuryCents: Math.ceil(USD_CENTS * 0.07),
    };
    ctl.lastTradeSig = '';
    ctl.updateTradeWindow();
    // The trade open also shows the bags window. On the touch sheet the two now
    // split the screen (trade left, bags right); BAGS_OVER keeps that real first
    // state for the capture and the tappability probe, otherwise the bags are
    // hidden so the probe measures the trade sheet at full width.
    const bags = document.querySelector('#bags');
    if (bags instanceof HTMLElement && !BAGS_OVER) bags.style.display = 'none';
    return {
      open: document.querySelector('#trade-window')?.style.display === 'block',
      arm: !!document.querySelector('#trade-window .trade-woc-arm'),
      terms: !!document.querySelector('#trade-window .trade-woc-terms'),
      link: document.querySelector('#trade-window .trade-woc-terms-link')?.getAttribute('href'),
      bagsOpen: bags instanceof HTMLElement && bags.style.display !== 'none',
    };
  },
  PARTNER,
  ITEM,
  USD_CENTS,
  TOKENS,
  BAGS_OVER,
);
console.log('compose face:', JSON.stringify(staged));
check(staged.open && staged.arm, 'trade window open with the $WOC arm');
check(staged.terms, 'consent row renders on the buyer compose face');

async function measure(label) {
  const m = await page.evaluate(() => {
    const win = document.querySelector('#trade-window');
    const wr = win.getBoundingClientRect();
    // The sticky window header paints OVER the sheet scrolling beneath it, so
    // it is measured after each scroll, not once: a control the browser parks
    // at the top of the scrollport must come to rest below it. The centre-point
    // hit test alone cannot see this, because a control covered down to its
    // middle still answers at its own centre.
    const headerBottom = () => {
      const h = win.querySelector(':scope > .panel-title');
      return h ? Math.round(h.getBoundingClientRect().bottom) : null;
    };
    const rect = (el) => {
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const hb = headerBottom();
      return {
        headerBottom: hb,
        underHeader: hb !== null && r.top < hb && r.bottom > 0 && r.width > 0,
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        onScreen:
          r.top >= 0 &&
          r.bottom <= window.innerHeight &&
          r.left >= 0 &&
          r.right <= window.innerWidth,
        tappable: hit === el || el.contains(hit) || (hit !== null && hit.contains(el)),
        // Name what is actually on top: "not tappable" without the blocker's
        // identity cost a rerun every time this fired.
        hitBy:
          hit === null
            ? 'nothing'
            : `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}${
                typeof hit.className === 'string' && hit.className
                  ? `.${hit.className.split(' ').join('.')}`
                  : ''
              }`,
        display: cs.display,
        fontSize: cs.fontSize,
      };
    };
    const arm = document.querySelector('#trade-window .trade-woc-arm');
    const controls = [...(arm?.querySelectorAll('button, a, input, label') ?? [])].map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: el.className,
      key: el.getAttribute('data-focus-key'),
      text: (el.textContent || el.value || '').trim().slice(0, 40),
      disabled: el.disabled === true,
      rect: rect(el),
    }));
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      uiScale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
      win: {
        top: Math.round(wr.top),
        h: Math.round(wr.height),
        w: Math.round(wr.width),
        scrollH: win.scrollHeight,
        clientH: win.clientHeight,
      },
      armText: (arm?.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
      controls,
    };
  });
  console.log(
    `\n== ${label} == viewport ${m.viewport} ui-scale ${m.uiScale} win top ${m.win.top} h ${m.win.h} w ${m.win.w} scroll ${m.win.scrollH}/${m.win.clientH}`,
  );
  console.log('   text:', m.armText);
  for (const c of m.controls) {
    const r = c.rect;
    console.log(
      `   ${c.tag}${c.cls ? '.' + String(c.cls).split(' ').join('.') : ''} [${c.key ?? ''}] "${c.text}" ${r ? `${r.w}x${r.h} top ${r.top} display ${r.display} font ${r.fontSize} onScreen ${r.onScreen}` : 'NO RECT'}${c.disabled ? ' DISABLED' : ''}`,
    );
    if (!MOBILE) continue;
    if (c.tag === 'button')
      check(r.h >= 40, `${label}: button "${c.text}" tap height ${r.h} >= 40`);
    if (c.tag === 'label' && String(c.cls).includes('trade-woc-terms'))
      check(r.h >= 40, `${label}: consent label height ${r.h} >= 40`);
    if (c.tag === 'a' && String(c.cls).includes('trade-woc-terms-link'))
      check(r.h >= 40, `${label}: terms link tap height ${r.h} >= 40 (display ${r.display})`);
    if (c.tag === 'input' && String(c.cls) === '' && c.key === 'trade-woc-terms')
      check(r.w >= 24 && r.h >= 24, `${label}: consent checkbox ${r.w}x${r.h} >= 24`);
    if (c.tag === 'input' && String(c.cls).includes('trade-woc-price'))
      check(r.h >= 40, `${label}: price field height ${r.h} >= 40`);
    if (r) check(r.onScreen, `${label}: "${c.text || c.tag}" fully on screen after scrollIntoView`);
    if (r)
      check(
        !r.underHeader,
        `${label}: "${c.text || c.tag}" clears the sticky header (top ${r.top} >= ${r.headerBottom})`,
      );
    if (r)
      check(
        r.tappable,
        `${label}: "${c.text || c.tag}" is the top-most element at its center (tappable, hit ${r.hitBy})`,
      );
  }
  return m;
}

async function shoot(name) {
  // Same capture hygiene as the market rig: the perf-doctor nudge is pressed
  // away right before the shot, or it lands in the frame's corner.
  await dismissPerfNudge(page);
  // Frame the face from its TOP. The measurement pass just before this scrolls
  // each control into view one by one, so whatever it touched last decided the
  // scroll offset, and the shots came out mid-face with the mode tabs sliced by
  // the header. Evidence should open where a player opens it.
  await page.evaluate(() => {
    const win = document.querySelector('#trade-window');
    if (win) win.scrollTop = 0;
  });
  await sleep(300);
  const file = `${OUT}/${SHOT_PREFIX}-${MOBILE ? 'mobile' : 'desktop'}-trade-${name}${SUFFIX}.png`;
  await page.screenshot({ path: file });
  console.log(`wrote ${file}`);
}

// The window's Accept / Cancel row and the two coin inputs are outside the arm:
// swept here so the whole sheet's floors are measured, not the arm's alone.
async function measureWindowChrome(label) {
  if (!MOBILE) return;
  const m = await page.evaluate(() => {
    const win = document.querySelector('#trade-window');
    const rows = [];
    for (const el of win?.querySelectorAll('.trade-actions button, .trade-money input, .x-btn') ??
      []) {
      // A hidden control has no tap target to floor: the coin row is hidden
      // while a $WOC deal stands, and Accept is hidden once the goods are
      // escrowed. Measuring those as zero-height would report the face's own
      // correct state as a floor failure.
      if (el.hidden || el.closest('[hidden]') || el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      rows.push({
        what: el.className || el.tagName.toLowerCase(),
        text: (el.textContent || el.value || '').trim().slice(0, 20),
        h: Math.round(r.height),
        w: Math.round(r.width),
      });
    }
    // The sticky commit row's BAND, measured from the scrollport's bottom edge
    // (where scroll-padding resolves) rather than derived on paper: the row's
    // own height is not the whole story, because the window's bottom padding
    // sits below it INSIDE the scrollport. A reserve smaller than this band
    // parks a scrolled control under the row, which is untappable, and that is
    // exactly how a paper derivation of the reserve went 12px short.
    const actions = win?.querySelector('.trade-actions');
    const winRect = win?.getBoundingClientRect() ?? null;
    const rowRect = actions?.getBoundingClientRect() ?? null;
    const reserve = win
      ? Number.parseFloat(getComputedStyle(win).scrollPaddingBottom.replace('px', ''))
      : Number.NaN;
    return {
      rows,
      band: winRect && rowRect ? Math.round(winRect.bottom - rowRect.top) : null,
      reserve: Number.isFinite(reserve) ? Math.round(reserve) : null,
    };
  });
  // A forced-inset numeric arm used to live here and was DELETED: it added the
  // inset delta to the computed reserve, which is the same as assuming the CSS
  // is already inset-aware, so it passed just as happily on the flat-token
  // regression it was meant to catch. What a headless browser can honestly
  // measure is the zero-inset band below; the inset-aware term is guarded where
  // it can actually be read, in tests/mobile_window_layout.test.ts, which pins
  // the reserve against the generic rule's own padding expression.
  // The reserve must cover the band, or the CSS is quietly lying about it.
  if (m.band !== null && m.reserve !== null) {
    check(
      m.reserve >= m.band,
      `${label}: sticky-row scroll reserve ${m.reserve} >= its measured band ${m.band}`,
    );
  }
  for (const c of m.rows) {
    check(c.h >= 40, `${label}: window chrome "${c.text || c.what}" height ${c.h} >= 40`);
  }
}

await measure('compose (consent row + Send)');
await measureWindowChrome('compose');
if (BAGS_OVER) {
  // The real first state a player meets: both sheets open, split, and every
  // arm control still the top-most element at its centre (never under bags).
  const split = await page.evaluate(() => {
    const t = document.querySelector('#trade-window')?.getBoundingClientRect();
    const b = document.querySelector('#bags')?.getBoundingClientRect();
    if (!t || !b) return null;
    const overlap = Math.max(0, Math.min(t.right, b.right) - Math.max(t.left, b.left));
    return {
      tradeW: Math.round(t.width),
      bagsW: Math.round(b.width),
      overlap: Math.round(overlap),
    };
  });
  console.log('   split:', JSON.stringify(split));
  check(split !== null && split.overlap <= 1, 'the trade sheet and the bags sheet do not overlap');
  await shoot('compose-with-bags');
} else {
  await shoot('compose-consent');
}

// Buyer pay face: offer accepted by both, goods in escrow, no quote yet.
async function setOffer(offer, quote, extra = {}) {
  await page.evaluate(
    (offer, quote, extra) => {
      const ctl = window.__game.hud.wocTrade;
      ctl.wocTradeOffer = offer;
      ctl.wocTradeQuote = quote;
      Object.assign(ctl, extra);
      ctl.lastTradeSig = '';
      ctl.updateTradeWindow();
    },
    offer,
    quote,
    extra,
  );
  await sleep(200);
}
const now = Date.now();
const base = {
  id: 1,
  usdCents: USD_CENTS,
  tokens: TOKENS,
  listingId: 7,
  buyerAccepted: true,
  sellerAccepted: true,
  expiresAtMs: now + 600000,
  settlementState: null,
};
await setOffer({ ...base, role: 'buyer', phase: 'awaiting_payment' }, null);
await measure('buyer pay face (consent row + Pay)');
await measureWindowChrome('buyer pay face');
await shoot('buyer-pay-consent');

await setOffer(
  { ...base, role: 'buyer', phase: 'awaiting_payment' },
  {
    offerId: 1,
    totalTokens: TOKENS,
    sellerTokens: TOKENS * 0.9,
    burnTokens: TOKENS * 0.07,
    treasuryTokens: TOKENS * 0.03,
    usdCents: USD_CENTS,
    expiresAtMs: now + 120000,
    reference: 'ref',
    transactionBase64: 'dHg=',
  },
);
await measure('buyer quote review (Sign / Not now)');
await shoot('buyer-quote-review');

await setOffer(
  { ...base, role: 'buyer', phase: 'review', buyerAccepted: false, sellerAccepted: false },
  null,
);
await measure('buyer review face (Withdraw + expiry)');
await shoot('buyer-review-withdraw');

await setOffer(
  { ...base, role: 'seller', phase: 'review', buyerAccepted: false, sellerAccepted: false },
  null,
);
await measure('seller review face (Decline)');
await shoot('seller-review-decline');

await setOffer({ ...base, role: 'seller', phase: 'awaiting_payment' }, null);
await measure('seller awaiting payment (Cancel sale)');
await shoot('seller-awaiting-cancel-sale');

await setOffer({ ...base, role: 'seller', phase: 'paying', settlementState: 'confirming' }, null);
await measure('seller paying (no cancel)');
await shoot('seller-paying');

await browser.close();
console.log(
  fails.length === 0
    ? '\nALL CHECKS PASSED'
    : `\n${fails.length} CHECK(S) FAILED:\n - ` + fails.join('\n - '),
);
process.exit(fails.length === 0 ? 0 : 1);
