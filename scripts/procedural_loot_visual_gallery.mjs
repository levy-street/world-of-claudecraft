// Deterministic procedural-loot asset gallery capture.
//
// Run `npm run dev`, then:
//   node scripts/procedural_loot_visual_gallery.mjs
//
// The script first imports the live Vite-served content catalogues and loads every asset
// through the locked nested production URL layout. It then boots a real offline game to
// capture production bag/tooltips for seeded rolls, Alt ranges, deltas, and named powers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import {
  allGalleryAssetCells,
  buildGalleryPages,
  GALLERY_VIEWPORT,
  RARITIES,
  validateGalleryContract,
} from './lib/procedural_loot_visual_gallery.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const PREFLIGHT_ONLY = process.env.PREFLIGHT_ONLY === '1';
const PRESENTATION_SCREENSHOT_COUNT = 4;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SCREENSHOT_ROOT = path.join(REPO_ROOT, 'docs', 'screenshots', 'procedural-loot-v030');
const OUTPUT_DIR = path.join(
  REPO_ROOT,
  'docs',
  'screenshots',
  'procedural-loot-v030',
  'visual-gallery',
);

let checksPassed = 0;

function check(name, condition, extra = '') {
  if (!condition) {
    throw new Error(`${name} failed${extra ? `: ${extra}` : ''}`);
  }
  checksPassed += 1;
  console.log(`PASS ${name}${extra ? `: ${extra}` : ''}`);
}

async function readProductionContract(page) {
  return page.evaluate(async (rarities) => {
    const [{ PROCEDURAL_ITEM_BASES }, { PROCEDURAL_LEGENDARY_POWERS }] = await Promise.all([
      import('/src/sim/content/procedural_loot/bases.ts'),
      import('/src/sim/content/procedural_legendary_powers.ts'),
    ]);

    const bases = Object.values(PROCEDURAL_ITEM_BASES).map((base) => ({
      id: base.id,
      name: base.name,
      kind: base.kind,
      slot: base.slot,
      armorType: base.armorType ?? null,
      weaponType: base.weaponType ?? null,
      shield: base.shield === true,
      rarityCells: rarities.map((rarity) => {
        const relativePath =
          rarity === 'legendary'
            ? `${base.id}/legendary/_fallback.webp`
            : `${base.id}/${rarity}.webp`;
        return {
          baseId: base.id,
          baseName: base.name,
          rarity,
          assetId: `procedural/v1/${relativePath}`,
          url: `/ui/items/procedural/v1/${relativePath}`,
        };
      }),
    }));

    const baseNames = Object.fromEntries(bases.map((base) => [base.id, base.name]));
    const legendaryVariants = Object.values(PROCEDURAL_LEGENDARY_POWERS).flatMap((power) => {
      return (power.compatibleBaseIds ?? []).map((baseId) => ({
        baseId,
        baseName: baseNames[baseId] ?? baseId,
        powerId: power.id,
        powerName: power.name,
        assetId: `procedural/v1/${baseId}/legendary/${power.id}.r${power.revision}.webp`,
        url: `/ui/items/procedural/v1/${baseId}/legendary/${power.id}.r${power.revision}.webp`,
      }));
    });

    return { bases, legendaryVariants };
  }, RARITIES);
}

function validationHtml(cells) {
  const images = cells
    .map(
      (cell) =>
        `<img src="${String(cell.url).replaceAll('"', '&quot;')}" alt="" data-asset-id="${String(
          cell.assetId,
        ).replaceAll('"', '&quot;')}">`,
    )
    .join('');
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><style>img{width:1px;height:1px}</style></head>
<body>${images}</body>
</html>`;
}

async function decodeEveryImage(page, expectedCount, context) {
  const result = await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [...document.images];
    const failures = [];
    for (const image of images) {
      try {
        await image.decode();
        if (!image.complete || image.naturalWidth < 1 || image.naturalHeight < 1) {
          throw new Error(`invalid dimensions ${image.naturalWidth}x${image.naturalHeight}`);
        }
      } catch (error) {
        failures.push({
          assetId: image.dataset.assetId ?? '(unknown)',
          src: image.currentSrc || image.src,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { imageCount: images.length, failures };
  });

  check(`${context} image count`, result.imageCount === expectedCount, `${result.imageCount}`);
  check(
    `${context} image decode`,
    result.failures.length === 0,
    result.failures
      .map((failure) => `${failure.assetId} (${failure.src}): ${failure.message}`)
      .join('\n'),
  );
}

async function validateRenderedPage(page, expectedImageCount, filename) {
  await decodeEveryImage(page, expectedImageCount, filename);
  const metrics = await page.evaluate(() => {
    const incorrectlySized = [...document.images]
      .map((image) => {
        const expected = Number(image.dataset.renderSize);
        const rect = image.getBoundingClientRect();
        return {
          assetId: image.dataset.assetId,
          expected,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter(
        (entry) =>
          !Number.isFinite(entry.expected) ||
          entry.width !== entry.expected ||
          entry.height !== entry.expected,
      );
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        deviceScaleFactor: window.devicePixelRatio,
      },
      documentSize: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      incorrectlySized,
    };
  });

  check(
    `${filename} viewport`,
    metrics.viewport.width === GALLERY_VIEWPORT.width &&
      metrics.viewport.height === GALLERY_VIEWPORT.height &&
      metrics.viewport.deviceScaleFactor === GALLERY_VIEWPORT.deviceScaleFactor,
    JSON.stringify(metrics.viewport),
  );
  check(
    `${filename} fit`,
    metrics.documentSize.width <= GALLERY_VIEWPORT.width &&
      metrics.documentSize.height <= GALLERY_VIEWPORT.height,
    JSON.stringify(metrics.documentSize),
  );
  check(
    `${filename} native icon sizes`,
    metrics.incorrectlySized.length === 0,
    JSON.stringify(metrics.incorrectlySized),
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function preparePresentationFixtures(page) {
  return page.evaluate(async () => {
    const [procedural, presentation] = await Promise.all([
      import('/src/sim/loot/procedural/index.ts'),
      import('/src/ui/procedural_item_presentation.ts'),
    ]);
    const baseId = 'gravecaller_ring';
    const context = (seed, slot) => ({
      source: 'dungeon',
      sourceEntityId: 9300,
      sourceSpawnSequence: seed,
      lootSlotIndex: slot,
      sourceTemplateId: 'procedural_gallery_evidence',
      sourceTags: ['visual-evidence'],
    });
    const generate = (seed, rarity, namespace) =>
      procedural.generateProceduralItem({
        seed,
        uid: procedural.formatProceduralItemUid(namespace, seed),
        context: context(seed, seed % 8),
        basePoolId: 'initial_all',
        rarityTableId: 'initial_dungeon_boss',
        sourceItemLevel: 1,
        forcedItemLevel: 1,
        forcedBaseId: baseId,
        forcedRarity: rarity,
      });

    const seenMagic = new Map();
    let rollPair = null;
    for (let seed = 1; seed <= 4096; seed++) {
      const drop = generate(seed, 'magic', 'gallery-roll');
      const item = drop.instance.procedural;
      const structureKey = JSON.stringify({
        itemLevel: item.itemLevel,
        generatedName: item.generatedName,
        affixes: item.affixes.map((affix) => ({
          affixId: affix.affixId,
          tier: affix.tier,
          stats: Object.keys(affix.values).sort(),
        })),
      });
      const values = JSON.stringify(item.affixes.map((affix) => affix.values));
      const previous = seenMagic.get(structureKey);
      if (previous && previous.values !== values) {
        rollPair = [previous.drop, drop];
        break;
      }
      seenMagic.set(structureKey, { drop, values });
    }
    if (!rollPair) throw new Error('no same-name Magic roll pair found in seeds 1..4096');

    const legendaryByPower = new Map();
    for (let seed = 1; seed <= 4096 && legendaryByPower.size < 2; seed++) {
      const drop = generate(seed, 'legendary', 'gallery-power');
      const powerId = drop.instance.procedural.legendaryPowerId;
      if (powerId && !legendaryByPower.has(powerId)) legendaryByPower.set(powerId, drop);
    }
    if (legendaryByPower.size < 2) {
      throw new Error('gravecaller_ring did not produce two distinct named powers');
    }
    const legendaryDrops = [...legendaryByPower.values()].slice(0, 2);

    const sim = window.__game?.sim;
    const hud = window.__game?.hud;
    if (!sim?.player || !hud) throw new Error('offline game did not expose the live Sim and Hud');
    const pid = sim.player.id;
    sim.addItemInstance(rollPair[0].itemId, rollPair[0].instance, pid);
    sim.equipItem(rollPair[0].itemId, rollPair[0].instance.procedural.uid);
    sim.addItemInstance(rollPair[1].itemId, rollPair[1].instance, pid);
    for (const drop of legendaryDrops) sim.addItemInstance(drop.itemId, drop.instance, pid);
    hud.closeAll?.();
    hud.toggleBags();
    hud.renderBags?.();

    const legendary = legendaryDrops.map((drop) => {
      const view = presentation.proceduralLegendaryPresentation(drop.instance);
      if (!view) throw new Error('generated Legendary had no production presentation');
      return {
        baseId: drop.instance.procedural.baseId,
        powerId: view.id,
        name: view.name,
        description: view.description,
      };
    });
    return {
      baseId,
      rollPair: rollPair.map((drop) => ({
        generatedName: drop.instance.procedural.generatedName,
        values: drop.instance.procedural.affixes.map((affix) => affix.values),
      })),
      legendary,
    };
  });
}

async function focusProceduralBagRow(page, selector, index = 0) {
  let lastState = 'row not found';
  for (let attempt = 1; attempt <= 4; attempt++) {
    const state = await page.evaluate(
      (rowSelector, rowIndex) => {
        const rows = [...document.querySelectorAll(rowSelector)];
        const row = rows[rowIndex];
        if (!(row instanceof HTMLElement)) return { count: rows.length, focused: false };
        row.focus();
        return { count: rows.length, focused: document.activeElement === row };
      },
      selector,
      index,
    );
    if (!state.focused) {
      lastState = `${state.count} rows on attempt ${attempt}`;
      await sleep(120);
      continue;
    }
    const visible = await page
      .waitForFunction(
        () => {
          const tooltip = document.getElementById('tooltip');
          return tooltip && getComputedStyle(tooltip).display !== 'none' && tooltip.offsetWidth > 0;
        },
        { timeout: 2500 },
      )
      .then(() => true)
      .catch(() => false);
    if (visible) {
      check(`${selector} row ${index + 1} focus`, true, `${state.count} rows`);
      await sleep(120);
      return;
    }
    lastState = `tooltip did not appear on attempt ${attempt}`;
  }
  check(`${selector} row ${index + 1} focus`, false, lastState);
}
async function focusProceduralComparisonRow(page, selector) {
  const rowCount = await page.$$eval(selector, (rows) => rows.length);
  for (let index = 0; index < rowCount; index++) {
    await focusProceduralBagRow(page, selector, index);
    const hasComparison = await page.$eval(
      '#tooltip',
      (tooltip) => tooltip.querySelector('.tt-cmp-body > .tt-title') !== null,
    );
    if (hasComparison) {
      check('unequipped comparison candidate selected', true, `row ${index + 1} of ${rowCount}`);
      return;
    }
  }
  check('unequipped comparison candidate selected', false, `${String(rowCount)} candidate rows`);
}

async function presentationClip(page) {
  const clip = await page.evaluate(() => {
    const visibleRect = (selector) => {
      const element = document.querySelector(selector);
      if (!element || getComputedStyle(element).display === 'none') return null;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
        : null;
    };
    const rects = [visibleRect('#bags'), visibleRect('#tooltip')].filter(Boolean);
    if (rects.length !== 2) return null;
    const margin = 18;
    const left = Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.left)) - margin));
    const top = Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.top)) - margin));
    const right = Math.min(
      window.innerWidth,
      Math.ceil(Math.max(...rects.map((rect) => rect.right)) + margin),
    );
    const bottom = Math.min(
      window.innerHeight,
      Math.ceil(Math.max(...rects.map((rect) => rect.bottom)) + margin),
    );
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
  check(
    'presentation screenshot clip',
    clip !== null && clip.width > 0 && clip.height > 0,
    JSON.stringify(clip),
  );
  return clip;
}

async function capturePresentationScreenshot(page, filename) {
  const outputPath = path.join(OUTPUT_DIR, filename);
  const clip = await presentationClip(page);
  if (PREFLIGHT_ONLY) {
    console.log(`PREFLIGHT ${path.relative(REPO_ROOT, outputPath)}`);
    return;
  }
  await page.screenshot({
    path: outputPath,
    type: 'png',
    clip,
    captureBeyondViewport: false,
    omitBackground: false,
  });
  console.log(`WROTE ${path.relative(REPO_ROOT, outputPath)}`);
}
async function capturePresentationEvidence(page) {
  const gameUrl = new URL('/', GAME_URL).href;
  const response = await page.goto(gameUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  check('presentation game bootstrap', response?.ok() === true, gameUrl);
  const gameBooted = await enterOfflineGame(page, {
    charClass: 'mage',
    charName: 'Rollkeeper',
    settleMs: 1600,
    gameBootTimeoutMs: 45000,
  });
  check('presentation offline game boot', gameBooted);

  const fixtures = await preparePresentationFixtures(page);
  check(
    'same-base seeded roll fixture',
    fixtures.rollPair.length === 2 &&
      fixtures.rollPair[0].generatedName.baseId === fixtures.baseId &&
      fixtures.rollPair[1].generatedName.baseId === fixtures.baseId &&
      JSON.stringify(fixtures.rollPair[0].generatedName) ===
        JSON.stringify(fixtures.rollPair[1].generatedName) &&
      JSON.stringify(fixtures.rollPair[0].values) !== JSON.stringify(fixtures.rollPair[1].values),
    JSON.stringify(fixtures.rollPair),
  );
  check(
    'same-base two-power Legendary fixture',
    fixtures.legendary.length === 2 &&
      fixtures.legendary.every((entry) => entry.baseId === fixtures.baseId) &&
      fixtures.legendary[0].powerId !== fixtures.legendary[1].powerId,
    JSON.stringify(fixtures.legendary),
  );

  await page.waitForSelector('#bags', { visible: true, timeout: 10000 });
  const freshDesktopBagsPng = await page.screenshot({
    type: 'png',
    fullPage: false,
    captureBeyondViewport: false,
    omitBackground: false,
  });
  await focusProceduralComparisonRow(page, '.bag-item[data-procedural-rarity="magic"]');
  const normalTooltip = await page.evaluate(() => {
    const tooltip = document.getElementById('tooltip');
    const candidateTitle = tooltip?.querySelector(':scope > .tt-title')?.textContent?.trim() ?? '';
    const equippedTitle =
      tooltip?.querySelector('.tt-cmp-body > .tt-title')?.textContent?.trim() ?? '';
    const candidateStats = [
      ...(tooltip?.querySelectorAll(
        ':scope > .tt-procedural-implicit, :scope > .tt-procedural-affix',
      ) ?? []),
    ].map((line) => line.textContent?.trim() ?? '');
    const equippedStats = [
      ...(tooltip?.querySelectorAll(
        '.tt-cmp-body > .tt-procedural-implicit, .tt-cmp-body > .tt-procedural-affix',
      ) ?? []),
    ].map((line) => line.textContent?.trim() ?? '');
    const ranges = [...(tooltip?.querySelectorAll('.tt-roll-range') ?? [])];
    const hint = tooltip?.querySelector(':scope > .tt-advanced-detail-hint');
    return {
      candidateTitle,
      equippedTitle,
      candidateStats,
      equippedStats,
      rangeDisplays: ranges.map((range) => getComputedStyle(range).display),
      hintDisplay: hint ? getComputedStyle(hint).display : null,
      hasCompare: tooltip?.querySelector('.tt-cmp') !== null,
      hasDelta: tooltip?.querySelector('.tt-cmp > .tt-green, .tt-cmp > .tt-red') !== null,
    };
  });
  check(
    'normal tooltip repeats the same generated name',
    normalTooltip.candidateTitle.length > 0 &&
      normalTooltip.candidateTitle === normalTooltip.equippedTitle,
    `${normalTooltip.candidateTitle} / ${normalTooltip.equippedTitle}`,
  );
  check(
    'normal tooltip shows different seeded values',
    normalTooltip.candidateStats.length > 0 &&
      normalTooltip.equippedStats.length > 0 &&
      JSON.stringify(normalTooltip.candidateStats) !== JSON.stringify(normalTooltip.equippedStats),
    JSON.stringify({
      candidate: normalTooltip.candidateStats,
      equipped: normalTooltip.equippedStats,
    }),
  );
  check(
    'normal tooltip comparison deltas',
    normalTooltip.hasCompare && normalTooltip.hasDelta,
    JSON.stringify(normalTooltip),
  );
  check(
    'normal tooltip hides roll ranges',
    normalTooltip.rangeDisplays.length > 0 &&
      normalTooltip.rangeDisplays.every((display) => display === 'none') &&
      normalTooltip.hintDisplay !== 'none',
    JSON.stringify(normalTooltip),
  );
  await capturePresentationScreenshot(page, '13-tooltip-seeded-roll-comparison-normal.png');

  await page.keyboard.down('Alt');
  await page.waitForFunction(() => document.body.classList.contains('item-details-advanced'));
  const altTooltip = await page.evaluate(() => {
    const tooltip = document.getElementById('tooltip');
    const ranges = [...(tooltip?.querySelectorAll('.tt-roll-range') ?? [])];
    const hints = [...(tooltip?.querySelectorAll('.tt-advanced-detail-hint') ?? [])];
    return {
      rangeDisplays: ranges.map((range) => getComputedStyle(range).display),
      hintDisplays: hints.map((hint) => getComputedStyle(hint).display),
      hasDelta: tooltip?.querySelector('.tt-cmp > .tt-green, .tt-cmp > .tt-red') !== null,
    };
  });
  check(
    'Alt tooltip reveals ranges and keeps deltas',
    altTooltip.rangeDisplays.length > 0 &&
      altTooltip.rangeDisplays.every((display) => display !== 'none') &&
      altTooltip.hintDisplays.every((display) => display === 'none') &&
      altTooltip.hasDelta,
    JSON.stringify(altTooltip),
  );
  await capturePresentationScreenshot(page, '14-tooltip-seeded-roll-comparison-alt.png');
  await page.keyboard.up('Alt');
  await page.waitForFunction(() => !document.body.classList.contains('item-details-advanced'));

  await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.unequipItem('ring1');
    sim.unequipItem('ring2');
    window.__game.hud.renderBags?.();
  });
  await sleep(120);

  for (let index = 0; index < fixtures.legendary.length; index++) {
    const expected = fixtures.legendary[index];
    const rowIndex = await page.evaluate((name) => {
      const rows = [...document.querySelectorAll('.bag-item[data-procedural-rarity="legendary"]')];
      return rows.findIndex((row) => row.getAttribute('aria-label')?.includes(name));
    }, expected.name);
    check(`${expected.powerId} bag row`, rowIndex >= 0, expected.name);
    await focusProceduralBagRow(page, '.bag-item[data-procedural-rarity="legendary"]', rowIndex);
    await page.waitForFunction(
      (name, description) => {
        const tooltip = document.getElementById('tooltip');
        if (!tooltip || getComputedStyle(tooltip).display === 'none') return false;
        return (
          tooltip.querySelector(':scope > .tt-title')?.textContent?.trim() === name &&
          tooltip.querySelector(':scope > .tt-legendary-power')?.textContent?.includes(description)
        );
      },
      { timeout: 10000 },
      expected.name,
      expected.description,
    );
    const namedState = await page.evaluate((powerId) => {
      const focused = document.activeElement;
      const image = focused?.matches('.bag-item[data-procedural-rarity="legendary"]')
        ? focused.querySelector('img')
        : null;
      return {
        powerVisible: document.querySelector('#tooltip > .tt-legendary-power') !== null,
        imageUrl: image?.currentSrc ?? '',
        imageReady:
          image instanceof HTMLImageElement &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.naturalHeight > 0,
        expectedPath: `/legendary/${powerId}.r1.webp`,
      };
    }, expected.powerId);
    check(
      `${expected.powerId} production presentation`,
      namedState.powerVisible &&
        namedState.imageReady &&
        namedState.imageUrl.includes(namedState.expectedPath),
      JSON.stringify(namedState),
    );
    await capturePresentationScreenshot(
      page,
      `${15 + index}-tooltip-named-legendary-${expected.powerId}.png`,
    );
  }

  return {
    freshDesktopBagsPng,
    screenshotCount: PRESENTATION_SCREENSHOT_COUNT,
  };
}
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${GALLERY_VIEWPORT.width},${GALLERY_VIEWPORT.height}`,
    '--force-device-scale-factor=1',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: GALLERY_VIEWPORT,
});

try {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

  const bootstrapUrl = new URL('/src/sim/content/procedural_loot/bases.ts', GAME_URL).href;
  const response = await page.goto(bootstrapUrl, {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });
  check('Vite production-catalogue bootstrap', response?.ok() === true, bootstrapUrl);

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const contract = await readProductionContract(page);
  const contractErrors = validateGalleryContract(contract);
  check('gallery production contract', contractErrors.length === 0, contractErrors.join('\n'));

  const allCells = allGalleryAssetCells(contract);
  check(
    'gallery asset cell count',
    allCells.length === 34 * RARITIES.length + 21,
    `${allCells.length}`,
  );
  const uniqueAssetUrls = new Set(allCells.map((cell) => cell.url));
  check(
    'gallery authored URL uniqueness',
    uniqueAssetUrls.size === allCells.length,
    `${uniqueAssetUrls.size} unique URLs`,
  );
  const pages = buildGalleryPages(contract);
  check('gallery page count', pages.length === 12, `${pages.length}`);

  await page.setContent(validationHtml(allCells), { waitUntil: 'domcontentloaded' });
  await decodeEveryImage(page, allCells.length, 'complete production asset contract');

  if (!PREFLIGHT_ONLY) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const capture of pages) {
    await page.setContent(capture.html, { waitUntil: 'domcontentloaded' });
    await validateRenderedPage(page, capture.expectedImageCount, capture.filename);
    const outputPath = path.join(OUTPUT_DIR, capture.filename);
    if (PREFLIGHT_ONLY) {
      console.log(`PREFLIGHT ${path.relative(REPO_ROOT, outputPath)}`);
    } else {
      await page.screenshot({
        path: outputPath,
        type: 'png',
        fullPage: false,
        captureBeyondViewport: false,
        omitBackground: false,
      });
      console.log(`WROTE ${path.relative(REPO_ROOT, outputPath)}`);
    }
  }
  const presentationEvidence = await capturePresentationEvidence(page);
  check(
    'presentation screenshot count',
    presentationEvidence.screenshotCount === PRESENTATION_SCREENSHOT_COUNT,
    `${presentationEvidence.screenshotCount}`,
  );

  check('gallery page errors', pageErrors.length === 0, pageErrors.join('\n'));
  check('gallery console errors', consoleErrors.length === 0, consoleErrors.join('\n'));

  const rootEvidence = [
    {
      filename: '01-desktop-bags-rarity-icons.png',
      source: presentationEvidence.freshDesktopBagsPng,
    },
    {
      filename: '02-desktop-tooltip-alt-ranges.png',
      source: path.join(OUTPUT_DIR, '14-tooltip-seeded-roll-comparison-alt.png'),
    },
    {
      filename: '03-desktop-character-exact-comparison.png',
      source: path.join(OUTPUT_DIR, '13-tooltip-seeded-roll-comparison-normal.png'),
    },
  ];
  if (!PREFLIGHT_ONLY) {
    for (const evidence of rootEvidence) {
      const outputPath = path.join(SCREENSHOT_ROOT, evidence.filename);
      if (typeof evidence.source === 'string') {
        fs.copyFileSync(evidence.source, outputPath);
      } else {
        fs.writeFileSync(outputPath, evidence.source);
      }
      check(`${evidence.filename} refreshed`, fs.statSync(outputPath).size > 0);
      console.log(`WROTE ${path.relative(REPO_ROOT, outputPath)}`);
    }
  }
  console.log(
    `DONE ${checksPassed} checks, ${pages.length + presentationEvidence.screenshotCount} gallery ${PREFLIGHT_ONLY ? 'screens validated without writes' : 'screenshots'}`,
  );
} finally {
  await browser.close();
}
