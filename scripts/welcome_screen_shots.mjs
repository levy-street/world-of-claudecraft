// Welcome Screen PR screenshots: mounts the REAL production module
// (src/ui/welcome_screen_window.ts) directly against a running Vite dev
// server with controlled deps, the same pure-core-plus-thin-painter contract
// tests/welcome_screen_view.test.ts exercises, just rendered into a real DOM
// instead of asserted on. This sidesteps needing the game server / a real
// WS connection to reach every gating branch (connecting, feed-failed,
// offline, discord-hidden, chest-ready, armory-visible): #welcome-screen is
// static markup in index.html, mounted lazily by main.ts only after "Enter
// World" is clicked, so navigating straight to index.html and never clicking
// through leaves it untouched for this script to drive standalone.
//   node scripts/welcome_screen_shots.mjs   (needs `npm run dev`, GAME_URL to override)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/welcome-screen';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const RELEASES = [
  {
    id: 25,
    tag: 'v0.25.0',
    name: 'World of ClaudeCraft v0.25.0',
    url: 'https://github.com/levy-street/world-of-claudecraft/releases/tag/v0.25.0',
    prerelease: false,
    publishedAt: '2026-07-13T00:00:00.000Z',
    body:
      'A progression, endgame, PvP, and presentation release.\n\n' +
      '### Highlights\n' +
      '- **The Book of Deeds:** 192 achievements worth 2,365 Renown across progression, combat, dungeons, delves, collection, PvP, and exploration.\n' +
      '- **Heroic Nythraxis:** the 10-player raid gains a heroic tier with the Deathless Court encounter.\n' +
      '- **Talents 2.0:** all 27 specializations now grant a real signature ability and a level-scaled identity mastery.\n' +
      '- **Honor and Warfare:** ranked Arena wins and Fiesta combat award persistent Honor.\n' +
      '- **Season 1 Armory:** 28 account-wide weapon skins across four collections and four rarity tiers.\n',
  },
  {
    id: 24,
    tag: 'v0.24.2',
    name: 'World of ClaudeCraft v0.24.2',
    url: 'https://github.com/levy-street/world-of-claudecraft/releases/tag/v0.24.2',
    prerelease: false,
    publishedAt: '2026-07-12T00:00:00.000Z',
    body: '- Dungeon Finder cross-realm matching fixes.\n',
  },
  {
    id: 23,
    tag: 'v0.24.1',
    name: 'World of ClaudeCraft v0.24.1',
    url: 'https://github.com/levy-street/world-of-claudecraft/releases/tag/v0.24.1',
    prerelease: false,
    publishedAt: '2026-07-11T00:00:00.000Z',
    body: '- Hotfix: weapon sheathe transition on mount.\n',
  },
  {
    id: 22,
    tag: 'v0.24.0',
    name: 'World of ClaudeCraft v0.24.0',
    url: 'https://github.com/levy-street/world-of-claudecraft/releases/tag/v0.24.0',
    prerelease: false,
    publishedAt: '2026-07-11T00:00:00.000Z',
    body: '- Dungeon Finder launch.\n',
  },
  {
    id: 21,
    tag: 'v0.23.0',
    name: 'World of ClaudeCraft v0.23.0',
    url: 'https://github.com/levy-street/world-of-claudecraft/releases/tag/v0.23.0',
    prerelease: false,
    publishedAt: '2026-07-09T00:00:00.000Z',
    body: '- Weapon back-grips and stow transitions.\n',
  },
];

const HEADER = {
  characterName: 'Torvald',
  level: 34,
  className: 'Paladin',
  realmName: 'Claudemoon',
  lastPlayed: new Date(Date.parse('2026-07-13T00:00:00.000Z')).toISOString(),
};

// Runs in-page: mounts a fresh controller against the real production module
// with the given state config, driving every branch buildWelcomeScreenView
// computes (see tests/welcome_screen_view.test.ts for the same matrix).
async function mountState(page, cfg) {
  await page.evaluate(
    async (releases, header, cfg) => {
      // loadWelcomeNews() advances this marker on every mount (nextLastSeenReleaseId),
      // so it is reset before each state to keep the "only the latest is NEW" look
      // consistent across the whole matrix instead of decaying to zero after shot 1.
      localStorage.setItem('woc.welcome.lastSeenReleaseId', '24');
      const mod = await import('/src/ui/welcome_screen_window.ts');
      window.__wsCtrl?.destroy?.();
      const root = document.querySelector('#welcome-screen');
      root.hidden = false;
      document.body.classList.toggle('mobile-touch', !!cfg.mobileTouch);
      const ctrl = mod.mountWelcomeScreen(root, {
        platform: {
          nativeApp: false,
          desktopApp: false,
          mobileTouch: !!cfg.mobileTouch,
          offline: !!cfg.offline,
        },
        fetchReleases: () =>
          cfg.newsState === 'failed'
            ? Promise.reject(new Error('mock feed failure'))
            : cfg.newsState === 'empty'
              ? Promise.resolve([])
              : Promise.resolve(releases),
        fetchArmoryPromoEnabled: () => Promise.resolve(!!cfg.armory),
        fetchDiscord: () =>
          Promise.resolve({
            enabled: cfg.discordEnabled !== false,
            linked: !!cfg.discordHidden,
            guildMember: !!cfg.discordHidden,
            fetchFailed: false,
          }),
        fetchChest: () => Promise.resolve({ ready: !!cfg.chest, unknown: false }),
        header: () => header,
        onContinue: () => {},
        storage: window.sessionStorage,
      });
      window.__wsCtrl = ctrl;
      await ctrl.show();
      ctrl.setConnectionReady(!!cfg.ready);
      // focusFirst() can scroll an overflow-y:auto #welcome-screen so the
      // focused control is in view; reset to the top for a consistent shot.
      root.scrollTop = 0;
    },
    RELEASES,
    HEADER,
    cfg,
  );
  await sleep(350);
  // focusFirst() defers a tick before it runs and, absent a preferred
  // selector, lands on the first focusable element in DOM order (which can
  // sit deep inside the scrollable news body); reset both scroll containers
  // now that the deferred focus has had time to land, for a consistent
  // top-of-content shot.
  await page.evaluate(() => {
    document.querySelector('#welcome-screen').scrollTop = 0;
    const news = document.querySelector('#ws-news');
    if (news) news.scrollTop = 0;
  });
}

async function shot(page, file) {
  await page.screenshot({ path: `${OUT}/${file}`, type: 'png' });
  console.log('shot', file);
}

async function desktopPage(browser) {
  const p = await browser.newPage();
  p.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  await p.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  return p;
}

async function mobilePage(browser, width = 844, height = 390) {
  const p = await browser.newPage();
  p.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  await p.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cdp = await p.target().createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  await p.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  return p;
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    '--no-sandbox',
    '--window-size=1600,900',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1600, height: 900 },
});

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------
const desktop = await desktopPage(browser);

await mountState(desktop, { ready: true, armory: true, chest: true, discordHidden: false });
await shot(desktop, 'after-desktop.png');
await shot(desktop, 'after-news-column-desktop.png');

await mountState(desktop, { ready: false, armory: true, chest: true, discordHidden: false });
await shot(desktop, 'state-connecting-desktop.png');

await mountState(desktop, {
  ready: true,
  armory: true,
  chest: true,
  discordHidden: false,
  newsState: 'failed',
});
await shot(desktop, 'state-feed-failed-desktop.png');

await mountState(desktop, {
  ready: true,
  armory: true,
  chest: true,
  discordHidden: false,
  newsState: 'empty',
});
await shot(desktop, 'state-news-empty-desktop.png');

await mountState(desktop, { offline: true, ready: true });
await shot(desktop, 'state-offline-desktop.png');

await mountState(desktop, {
  ready: true,
  armory: true,
  chest: true,
  discordHidden: true,
});
await shot(desktop, 'discord-strip-hidden-desktop.png');

await mountState(desktop, {
  ready: true,
  armory: true,
  chest: true,
  discordHidden: false,
  discordEnabled: false,
});
await shot(desktop, 'discord-strip-disabled-desktop.png');

await mountState(desktop, {
  ready: true,
  armory: false,
  chest: true,
  discordHidden: false,
});
await shot(desktop, 'armory-hidden-chest-only-desktop.png');

await mountState(desktop, {
  ready: true,
  armory: true,
  chest: false,
  discordHidden: false,
});
await shot(desktop, 'chest-not-ready-desktop.png');

await mountState(desktop, {
  ready: true,
  armory: true,
  chest: true,
  discordHidden: false,
});
await shot(desktop, 'daily-chest-tile-desktop.png');
await mountState(desktop, {
  ready: true,
  armory: false,
  chest: true,
  discordHidden: false,
});
await shot(desktop, 'daily-chest-tile-ready-desktop.png');

// Expand the first collapsed older release to show the disclosure detail.
await mountState(desktop, { ready: true, armory: true, chest: true, discordHidden: false });
await desktop.evaluate(() => {
  document.querySelector('#ws-news details.ws-news-collapsed')?.setAttribute('open', '');
});
await sleep(200);
await shot(desktop, 'news-collapsed-expanded-desktop.png');

await desktop.close();

// ---------------------------------------------------------------------------
// Mobile landscape (in-game orientation) 844x390
// ---------------------------------------------------------------------------
const mobile = await mobilePage(browser);

await mountState(mobile, {
  ready: true,
  mobileTouch: true,
  armory: true,
  chest: true,
  discordHidden: false,
});
await shot(mobile, 'after-mobile.png');
await shot(mobile, 'after-tap-to-continue-mobile.png');

await mountState(mobile, { ready: false, mobileTouch: true, armory: true, chest: true });
await shot(mobile, 'state-connecting-mobile.png');

await mountState(mobile, {
  ready: true,
  mobileTouch: true,
  armory: true,
  chest: true,
  discordHidden: false,
});
await shot(mobile, 'discord-strip-mobile.png');

await mountState(mobile, {
  ready: true,
  mobileTouch: true,
  armory: true,
  chest: true,
  discordHidden: true,
});
await shot(mobile, 'discord-strip-hidden-mobile.png');

await mountState(mobile, { offline: true, ready: true, mobileTouch: true });
await shot(mobile, 'state-offline-mobile.png');

await mountState(mobile, {
  ready: true,
  mobileTouch: true,
  armory: true,
  chest: true,
  discordHidden: false,
  newsState: 'failed',
});
await shot(mobile, 'state-feed-failed-mobile.png');

await mobile.close();

// ---------------------------------------------------------------------------
// Mobile portrait 390x844 (the rotate-device gate would show in real play;
// this is a diagnostic shot only, matching the mock's "landscape-first" note)
// ---------------------------------------------------------------------------
const portrait = await mobilePage(browser, 390, 844);
await mountState(portrait, {
  ready: true,
  mobileTouch: true,
  armory: true,
  chest: true,
  discordHidden: false,
});
await shot(portrait, 'mobile-portrait-390.png');
await portrait.close();

await browser.close();

if (errors.length) {
  console.error('Page errors encountered:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('done');
