// Capture the post-login Welcome Screen (PR #1926): news panel, Join our Discord
// strip, and the Season 1 Armory promo, on desktop and mobile-landscape viewports.
//
// The Welcome Screen sits after Enter World and before the world boots, so this
// drives Play Offline -> name -> class -> Enter World and STOPS there, WITHOUT
// clicking #ws-continue. Because the world never boots, the intro cinematic, the
// new-adventurer tutorial, and the camera-mode prompt (all post-boot) never appear;
// we also set woc.cameraModePrompt.shown defensively as the task requires.
//
// Two offline-only touch-ups so the shots are illustrative, each rendered by the
// feature's OWN production code (not faked markup):
//   - News: offline cannot reach GitHub, so the live news column shows its empty
//     state. We render representative release entries through the real
//     news_feed.renderWelcomeNews() so the populated layout is visible.
//   - Armory: armoryCardVisible() gates the promo off offline, so we mount the real
//     store_promo_card into #ws-armory-card with the exact t() label keys the
//     production painter uses. The promo is desktop-web only (CSS-hidden on touch),
//     so the Armory shots are desktop only. Needs `npm run dev`.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/welcome-screen';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function shotElement(page, sel, path) {
  const el = await page.$(sel);
  if (!el) throw new Error(`element not found for shot: ${sel}`);
  await el.screenshot({ path });
  console.log('captured', path);
}

// Representative patch-note entries, rendered by the feature's own news renderer.
const SAMPLE_RELEASES = [
  {
    id: 27,
    tag: 'v0.27.0',
    name: 'Season 1: The Armory',
    body: 'The Armory opens with Season 1 weapon and armor skins, a daily reward chest, and the new post-login Welcome Screen. Link your Discord for two bonus bank slots.',
    url: 'https://github.com/levy-street/world-of-claudecraft/releases',
    prerelease: false,
    publishedAt: '2026-07-14T12:00:00Z',
  },
  {
    id: 26,
    tag: 'v0.26.0',
    name: 'Desktop platforms',
    body: 'Windows, macOS, and Linux desktop shells, plus packaging fixes across every platform.',
    url: 'https://github.com/levy-street/world-of-claudecraft/releases',
    prerelease: false,
    publishedAt: '2026-06-30T12:00:00Z',
  },
  {
    id: 25,
    tag: 'v0.25.0',
    name: 'Guild high scores',
    body: 'A new Guilds tab on the High Scores board ranks guilds by combined member experience.',
    url: 'https://github.com/levy-street/world-of-claudecraft/releases',
    prerelease: false,
    publishedAt: '2026-06-15T12:00:00Z',
  },
];

async function populateNews(page) {
  await page.evaluate(async (releases) => {
    const { renderWelcomeNews } = await import('/src/ui/news_feed.ts');
    const el = document.querySelector('#ws-news');
    if (!el) return;
    const marked = releases.map((r, i) => ({ ...r, isNew: i === 0 }));
    el.innerHTML = renderWelcomeNews(
      marked,
      'https://github.com/levy-street/world-of-claudecraft/releases',
    );
  }, SAMPLE_RELEASES);
  await wait(300);
}

// Mount the real Season 1 Armory promo card into #ws-armory-card, exactly as the
// production painter does (same module, same t() label keys), then reveal it.
async function mountArmory(page) {
  await page.evaluate(async () => {
    const [{ mountStorePromoCard }, { t }] = await Promise.all([
      import('/src/ui/store_promo_card.ts'),
      import('/src/ui/i18n.ts'),
    ]);
    const host = document.querySelector('#ws-armory-card');
    if (!host) return;
    host.hidden = false;
    mountStorePromoCard(host, {
      labels: {
        open: t('hudChrome.wocStore.title'),
        close: t('hudChrome.wocStore.close'),
        season: t('hudChrome.wocStore.seasonOne'),
        title: t('hudChrome.wocStore.armoryTitle'),
        cta: t('welcome.armory.cta'),
      },
      returnFocusTo: () => document.querySelector('#ws-continue'),
      onOpenStore: () => {},
    });
  });
  await page
    .waitForFunction(
      () => {
        const img = document.querySelector('#ws-armory-card img');
        return img?.complete && img.naturalWidth > 0;
      },
      { timeout: 8000 },
    )
    .catch(() => {});
  await wait(500);
}

// Drive the pre-game flow up to (but not through) the Welcome Screen.
async function openWelcome(page, { charClass, charName }) {
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('woc.cameraModePrompt.shown', '1');
      localStorage.setItem('woc.tutorial.v1', JSON.stringify({ dismissed: true }));
    } catch {}
  });
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
  await page.waitForSelector('#btn-offline', { timeout: 30000 });
  await page.evaluate(() => document.querySelector('#btn-offline')?.click());
  const card = `#offline-select .mini-class[data-class="${charClass}"]`;
  await page.waitForSelector(card, { visible: true, timeout: 15000 });
  await page.evaluate((name) => {
    const n = document.querySelector('#char-name');
    if (n) {
      n.value = name;
      n.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, charName);
  await page.evaluate((sel) => document.querySelector(sel)?.click(), card);
  await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
  await page
    .waitForSelector('#mobile-preflight-continue', { visible: true, timeout: 4000 })
    .catch(() => {});
  await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
  // The Welcome Screen appears now. Do NOT click #ws-continue.
  await page.waitForSelector('#welcome-screen:not([hidden])', { visible: true, timeout: 15000 });
  await page
    .waitForFunction(
      () => {
        const n = document.querySelector('#ws-news');
        return n && !n.querySelector('.news-loading');
      },
      { timeout: 8000 },
    )
    .catch(() => {});
  await populateNews(page);
  await wait(400);
}

async function captureDesktop() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await openWelcome(page, { charClass: 'warrior', charName: 'Aldric' });

  await page.screenshot({ path: `${OUT}/welcome-desktop-full.png` });
  console.log('captured', `${OUT}/welcome-desktop-full.png`);
  await shotElement(page, '#ws-header', `${OUT}/welcome-desktop-header.png`);
  await shotElement(page, '.ws-news-panel', `${OUT}/welcome-desktop-news.png`);
  await shotElement(page, '#ws-discord', `${OUT}/welcome-desktop-discord.png`);

  await mountArmory(page);
  await page.screenshot({ path: `${OUT}/welcome-desktop-full-armory.png` });
  console.log('captured', `${OUT}/welcome-desktop-full-armory.png`);
  await shotElement(page, '#ws-armory-card', `${OUT}/welcome-desktop-armory.png`);

  await page.close();
}

async function captureMobile() {
  const page = await browser.newPage();
  // Mobile landscape.
  await page.setViewport({
    width: 900,
    height: 420,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await openWelcome(page, { charClass: 'mage', charName: 'Elowen' });

  await page.screenshot({ path: `${OUT}/welcome-mobile-full.png` });
  console.log('captured', `${OUT}/welcome-mobile-full.png`);
  await shotElement(page, '#ws-header', `${OUT}/welcome-mobile-header.png`);
  await shotElement(page, '.ws-news-panel', `${OUT}/welcome-mobile-news.png`);
  await shotElement(page, '#ws-discord', `${OUT}/welcome-mobile-discord.png`);

  await page.close();
}

await captureDesktop();
await captureMobile();

await browser.close();
console.log('done');
