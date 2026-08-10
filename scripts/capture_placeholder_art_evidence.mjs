// Capture representative placeholder-art surfaces from a running Vite client.
// Supports the release baseline and the current worktree through GAME_URL, and
// desktop/mobile-landscape through CAPTURE_MOBILE. Needs `npm run dev`.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.CAPTURE_OUT ?? 'tmp/placeholder_art_evidence';
const LABEL = process.env.CAPTURE_LABEL ?? 'after';
const MOBILE = process.env.CAPTURE_MOBILE === '1';
const WIDTH = Number(process.env.CAPTURE_WIDTH ?? (MOBILE ? 844 : 1600));
const HEIGHT = Number(process.env.CAPTURE_HEIGHT ?? (MOBILE ? 390 : 900));
const FORM = MOBILE ? 'mobile-landscape' : 'desktop';
const COMBAT_STATUS_URL = '/ui/crests/status/combat.webp';
const EXPECTED_AURA_ART = [
  { id: 'trueshot_aura_ap', url: '/ui/skills/hunter/trueshot_aura.webp' },
  { id: 'pal_divine_wisdom', url: '/ui/skills/paladin/flash_of_light.webp' },
  { id: 'fury_enrage', url: '/ui/skills/warrior/enrage_passive.webp' },
];
const DEED_CAPTURE_CASES = [
  {
    query: 'honor',
    slug: 'deeds-honor-ranks',
    ids: ['pvp_honor_sergeant', 'pvp_honor_knight_lieutenant', 'pvp_honor_field_marshal'],
  },
  {
    query: 'Thornhollow',
    slug: 'deeds-battleground',
    ids: ['pvp_bg_first_capture', 'pvp_bg_first_win', 'pvp_bg_wins_25', 'pvp_bg_captures_100'],
  },
];
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${WIDTH},${HEIGHT}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: WIDTH, height: HEIGHT, isMobile: MOBILE, hasTouch: MOBILE },
});
const pageErrors = [];

async function newPage() {
  const page = await browser.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  if (MOBILE) {
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    );
  }
  return page;
}

async function settleFullPageAssets(page) {
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll('.guide-talents-classes img')];
    const pause = () => new Promise((resolve) => setTimeout(resolve, 60));
    for (const img of images) {
      img.scrollIntoView({ block: 'center' });
      await pause();
      if (!img.complete) {
        await Promise.race([
          new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          }),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
    }
    scrollTo(0, 0);
  });
  const failed = await page.$$eval('.guide-talents-classes img', (images) =>
    images
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.getAttribute('src') ?? '(missing src)'),
  );
  if (failed.length > 0)
    throw new Error(`guide images failed to decode:\n- ${failed.join('\n- ')}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function assertImageUrlsDecode(page, urls, surface) {
  const failures = await page.evaluate(async (sources) => {
    const results = await Promise.all(
      sources.map(async (src) => {
        const image = new Image();
        image.src = src;
        try {
          await image.decode();
        } catch {
          return `${src} (decode rejected)`;
        }
        return image.naturalWidth > 0 && image.naturalHeight > 0
          ? null
          : `${src} (${image.naturalWidth}x${image.naturalHeight})`;
      }),
    );
    return results.filter((result) => result !== null);
  }, urls);
  if (failures.length > 0) {
    throw new Error(`${surface} images failed to decode:\n- ${failures.join('\n- ')}`);
  }
}

async function assertAuraBackgroundLayers(page, expectedAuraArt, combatStatusUrl) {
  const failures = await page.evaluate(
    async (expected, staticFallbackUrl) => {
      const backgrounds = [...document.querySelectorAll('#buff-bar .buff')].map(
        (buff) => getComputedStyle(buff).backgroundImage,
      );
      const parseUrls = (background) =>
        [...background.matchAll(/url\((?:"([^"]+)"|'([^']+)'|([^)]*))\)/g)].map(
          (match) => match[1] ?? match[2] ?? match[3],
        );
      const results = [];
      for (const { id, url } of expected) {
        const background = backgrounds.find((candidate) => candidate.includes(url));
        if (!background) {
          results.push(`${id}: painted layer ${url} is absent`);
          continue;
        }
        const sources = parseUrls(background);
        const fallback = sources.find(
          (source) => source.includes(staticFallbackUrl) || source.startsWith('data:image/'),
        );
        if (sources.length < 2 || !fallback) {
          results.push(`${id}: no static or cached procedural safety layer`);
          continue;
        }
        const image = new Image();
        image.src = fallback;
        try {
          await image.decode();
        } catch {
          results.push(`${id}: safety layer failed to decode`);
          continue;
        }
        if (image.naturalWidth === 0 || image.naturalHeight === 0) {
          results.push(`${id}: safety layer decoded at 0x0`);
        }
      }
      return results;
    },
    expectedAuraArt,
    combatStatusUrl,
  );
  if (failures.length > 0) {
    throw new Error(`aura background layers are invalid:\n- ${failures.join('\n- ')}`);
  }
}

const guide = await newPage();
await guide.goto(`${URL}/wiki/reference/talents`, { waitUntil: 'networkidle0', timeout: 30000 });
await guide.waitForSelector('.guide-talents-classes', { visible: true, timeout: 15000 });
await settleFullPageAssets(guide);
await guide.addStyleTag({
  content: `
    .guide-skip { display: none !important; }
    .guide-header,
    .guide-sidebar,
    .guide-gallery-viewer,
    .guide-toc-rail { position: static !important; }
  `,
});
await guide.screenshot({
  path: `${OUT}/${LABEL}-${FORM}-guide-specializations.png`,
  fullPage: true,
});

await guide.goto(`${URL}/wiki/bestiary`, { waitUntil: 'networkidle0', timeout: 30000 });
await guide.waitForSelector('.guide-family-crest', { visible: true, timeout: 15000 });
await guide.waitForFunction(() => {
  const crest = document.querySelector('.guide-family-crest');
  return crest instanceof HTMLImageElement && crest.complete && crest.naturalWidth > 0;
});
const familySection = await guide.$('.guide-family');
if (!familySection) throw new Error('guide family section did not render');
await familySection.screenshot({ path: `${OUT}/${LABEL}-${FORM}-guide-family-crests.png` });
await guide.close();

const game = await newPage();
await suppressGpuNotice(game);
await game.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(game, {
  charClass: 'warrior',
  charName: 'Iconsmith',
  settleMs: 500,
  gameBootTimeoutMs: 90000,
});
if (!booted) throw new Error('offline world did not boot');
await game.waitForSelector('#ui', { visible: true, timeout: 15000 });
await game.evaluate(() => {
  window.__game.hud.closeOptions();
  const player = window.__game.sim.player;
  player.auras.push(
    {
      id: 'trueshot_aura_ap',
      name: 'Sureflight Aura',
      kind: 'buff_ap_pct',
      remaining: 120,
      duration: 120,
      value: 0.1,
      sourceId: player.id,
      school: 'physical',
    },
    {
      id: 'pal_divine_wisdom',
      name: 'Divine Wisdom',
      kind: 'next_cast_instant',
      remaining: 12,
      duration: 12,
      value: 1,
      sourceId: player.id,
      school: 'holy',
    },
    {
      id: 'fury_enrage',
      name: 'Enraged',
      kind: 'enrage',
      remaining: 10,
      duration: 10,
      value: 0.1,
      sourceId: player.id,
      school: 'physical',
    },
  );
  document.querySelector('#player-frame')?.classList.add('combat');
  window.__game.hud.update();
});
await game.waitForFunction(
  (expectedAuraArt, combatStatusUrl) => {
    const frame = document.querySelector('#player-frame');
    const combatImage = document.querySelector('#pf-combat img');
    if (
      !(frame instanceof HTMLElement) ||
      !frame.classList.contains('combat') ||
      !(combatImage instanceof HTMLImageElement) ||
      !combatImage.currentSrc.includes(combatStatusUrl) ||
      !combatImage.complete ||
      combatImage.naturalWidth === 0
    ) {
      return false;
    }
    const backgrounds = [...document.querySelectorAll('#buff-bar .buff')].map(
      (buff) => getComputedStyle(buff).backgroundImage,
    );
    return expectedAuraArt.every(({ url }) =>
      backgrounds.some(
        (background) =>
          background.includes(url) &&
          (background.includes(combatStatusUrl) || background.includes('data:image/')) &&
          (background.match(/url\(/g)?.length ?? 0) >= 2,
      ),
    );
  },
  { timeout: 15000 },
  EXPECTED_AURA_ART,
  COMBAT_STATUS_URL,
);
const combatAuraState = await game.evaluate(
  (expectedAuraArt, combatStatusUrl) => {
    const frame = document.querySelector('#player-frame');
    const combat = document.querySelector('#pf-combat');
    const combatImage = combat?.querySelector('img');
    const backgrounds = [...document.querySelectorAll('#buff-bar .buff')].map((buff) => ({
      background: getComputedStyle(buff).backgroundImage,
    }));
    return {
      combatVisible:
        frame?.classList.contains('combat') === true &&
        combat instanceof HTMLElement &&
        getComputedStyle(combat).display !== 'none',
      combatImage: {
        src: combatImage instanceof HTMLImageElement ? combatImage.currentSrc : null,
        complete: combatImage instanceof HTMLImageElement && combatImage.complete,
        naturalWidth: combatImage instanceof HTMLImageElement ? combatImage.naturalWidth : 0,
      },
      missingAuras: expectedAuraArt
        .filter(
          ({ url }) =>
            !backgrounds.some(
              ({ background }) =>
                background.includes(url) &&
                (background.includes(combatStatusUrl) || background.includes('data:image/')),
            ),
        )
        .map(({ id, url }) => `${id} (${url})`),
    };
  },
  EXPECTED_AURA_ART,
  COMBAT_STATUS_URL,
);
if (
  !combatAuraState.combatVisible ||
  !combatAuraState.combatImage.complete ||
  combatAuraState.combatImage.naturalWidth === 0 ||
  !combatAuraState.combatImage.src?.includes(COMBAT_STATUS_URL)
) {
  throw new Error(`combat status crest did not render: ${JSON.stringify(combatAuraState)}`);
}
if (combatAuraState.missingAuras.length > 0) {
  throw new Error(
    `painted aura backgrounds or safety layers did not render:\n- ${combatAuraState.missingAuras.join('\n- ')}`,
  );
}
await assertAuraBackgroundLayers(game, EXPECTED_AURA_ART, COMBAT_STATUS_URL);
await assertImageUrlsDecode(
  game,
  [...EXPECTED_AURA_ART.map(({ url }) => url), COMBAT_STATUS_URL],
  'combat/aura',
);
await game.screenshot({ path: `${OUT}/${LABEL}-${FORM}-combat-aura-crests.png` });

for (const { query, slug, ids } of DEED_CAPTURE_CASES) {
  await game.evaluate((search) => {
    window.__game.hud.openDeeds('pvp');
    const input = document.querySelector('.deed-search');
    if (!(input instanceof HTMLInputElement)) throw new Error('deed search did not render');
    input.value = search;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, query);
  await game.waitForFunction(
    () => {
      const deeds = document.querySelector('#deeds-window');
      return (
        deeds &&
        document.querySelectorAll('#deeds-window .deed-card').length > 0 &&
        getComputedStyle(deeds).display !== 'none'
      );
    },
    { timeout: 15000 },
  );
  await game.waitForFunction(
    (expectedIds) => {
      const cards = [...document.querySelectorAll('#deeds-window .deed-card')];
      if (cards.length !== expectedIds.length) return false;
      return expectedIds.every((id) => {
        const card = cards.find((candidate) => candidate.getAttribute('data-deed') === id);
        const image = card?.querySelector('.deed-crest');
        return (
          image instanceof HTMLImageElement &&
          image.currentSrc.includes(`/ui/deeds/${id}.webp`) &&
          image.complete &&
          image.naturalWidth > 0
        );
      });
    },
    { timeout: 15000 },
    ids,
  );
  const deedState = await game.$$eval('#deeds-window .deed-card', (cards) =>
    cards.map((card) => {
      const image = card.querySelector('.deed-crest');
      return {
        id: card.getAttribute('data-deed'),
        src: image instanceof HTMLImageElement ? image.currentSrc : null,
        complete: image instanceof HTMLImageElement && image.complete,
        naturalWidth: image instanceof HTMLImageElement ? image.naturalWidth : 0,
      };
    }),
  );
  const actualIds = deedState.map(({ id }) => id);
  const badDeeds = deedState.filter(
    ({ id, src, complete, naturalWidth }) =>
      id === null ||
      !ids.includes(id) ||
      !src?.includes(`/ui/deeds/${id}.webp`) ||
      !complete ||
      naturalWidth === 0,
  );
  if (
    deedState.length !== ids.length ||
    ids.some((id) => !actualIds.includes(id)) ||
    badDeeds.length > 0
  ) {
    throw new Error(
      `deed filter ${JSON.stringify(query)} did not render the expected decoded cards: ${JSON.stringify(deedState)}`,
    );
  }
  const deedsWindow = await game.$('#deeds-window');
  if (!deedsWindow) throw new Error('deeds window did not render');
  await deedsWindow.screenshot({ path: `${OUT}/${LABEL}-${FORM}-${slug}.png` });
}
await game.close();

await browser.close();
if (pageErrors.length > 0) {
  throw new Error(`capture page errors:\n- ${pageErrors.join('\n- ')}`);
}
console.log(`placeholder-art evidence written to ${OUT} (${LABEL}, ${FORM})`);
process.exit(0);
