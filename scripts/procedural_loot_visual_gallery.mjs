// Deterministic procedural-loot asset gallery capture.
//
// Run `npm run dev`, then:
//   node scripts/procedural_loot_visual_gallery.mjs
//
// The script first imports the live Vite-served content catalogues and loads every asset
// through the locked nested production URL layout. It then boots a real offline game to
// capture production bag/tooltips for seeded rolls, Alt ranges, deltas, and named powers.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';
import {
  allGalleryAssetCells,
  buildGalleryPages,
  GALLERY_VIEWPORT,
  RARITIES,
  validateGalleryContract,
} from './lib/procedural_loot_visual_gallery.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const PREFLIGHT_ONLY = process.env.PREFLIGHT_ONLY === '1';
const PRESENTATION_SCREENSHOT_FILENAMES = Object.freeze([
  '13-tooltip-seeded-roll-comparison-normal.png',
  '14-tooltip-seeded-roll-comparison-alt.png',
  '15-tooltip-named-legendary-ashbinders_seal.png',
  '16-tooltip-named-legendary-dawnward_signet.png',
  '17-tooltip-common-iron-broadsword-normal.png',
  '18-tooltip-common-gravecaller-cloth-hood-normal.png',
  '19-tooltip-rare-mirefen-leather-jerkin-normal.png',
  '20-tooltip-rare-thornpeak-war-axe-alt.png',
  '21-tooltip-epic-gravecaller-pendant-normal.png',
  '22-tooltip-epic-ashwood-staff-alt.png',
  '23-tooltip-named-legendary-ashbinders-seal-roll-b-compare-normal.png',
  '24-tooltip-named-legendary-ashbinders-seal-roll-c-compare-normal.png',
  '25-tooltip-named-legendary-ashbinders-seal-roll-c-compare-alt.png',
]);
const PRESENTATION_SCREENSHOT_COUNT = PRESENTATION_SCREENSHOT_FILENAMES.length;
// The expanded capture crosses one site-presence refresh interval, so an offline run
// receives two known presence 502s plus the one known project-stats 502.
const EXPECTED_OFFLINE_CONSOLE_ERRORS = new Map([
  ['Failed to load resource: the server responded with a status of 502 (Bad Gateway)', 3],
  ['Failed to fetch project stats: ApiError: request failed (502)', 1],
  [
    'character visual unavailable, skipping view (mob_training_dummy): Error: character asset not preloaded: models/creatures/training_dummy.glb',
    1,
  ],
]);
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

function auditOfflineConsoleErrors(messages) {
  const actualCounts = new Map();
  for (const message of messages) {
    actualCounts.set(message, (actualCounts.get(message) ?? 0) + 1);
  }
  const errors = [];
  for (const [message, expectedCount] of EXPECTED_OFFLINE_CONSOLE_ERRORS) {
    const actualCount = actualCounts.get(message) ?? 0;
    if (actualCount !== expectedCount) {
      errors.push(`expected ${expectedCount}x "${message}", received ${actualCount}`);
    }
    actualCounts.delete(message);
  }
  for (const [message, count] of actualCounts) {
    errors.push(`unexpected ${count}x "${message}"`);
  }
  return {
    errors,
    summary: [...EXPECTED_OFFLINE_CONSOLE_ERRORS.entries()]
      .map(([message, count]) => `${count}x "${message}"`)
      .join('; '),
  };
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
      contentBounds: (() => {
        const content = document.querySelector('main');
        if (!(content instanceof HTMLElement)) return null;
        const rect = content.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      })(),
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
    `${filename} visible content`,
    metrics.contentBounds !== null &&
      metrics.contentBounds.left >= 0 &&
      metrics.contentBounds.top >= 0 &&
      metrics.contentBounds.right <= GALLERY_VIEWPORT.width &&
      metrics.contentBounds.bottom <= GALLERY_VIEWPORT.height - 24,
    JSON.stringify(metrics.contentBounds),
  );
  check(
    `${filename} native icon sizes`,
    metrics.incorrectlySized.length === 0,
    JSON.stringify(metrics.incorrectlySized),
  );
}

async function validateContactSheetRarityFrames(page) {
  const expected = {
    common: { count: 34, color: 'rgb(90, 85, 77)' },
    magic: { count: 34, color: 'rgb(40, 135, 220)' },
    rare: { count: 34, color: 'rgb(224, 189, 66)' },
    epic: { count: 34, color: 'rgb(152, 89, 216)' },
    legendary: { count: 55, color: 'rgb(231, 136, 38)' },
  };
  const actual = await page.evaluate((rarities) => {
    return Object.fromEntries(
      rarities.map((rarity) => {
        const nodes = [...document.querySelectorAll(`.contact-icon.rarity-${rarity}`)];
        return [
          rarity,
          {
            count: nodes.length,
            colors: [...new Set(nodes.map((node) => getComputedStyle(node).borderTopColor))],
            shadows: [...new Set(nodes.map((node) => getComputedStyle(node).boxShadow))],
          },
        ];
      }),
    );
  }, Object.keys(expected));
  check(
    '10-28px contact-sheet rarity frames',
    Object.entries(expected).every(
      ([rarity, contract]) =>
        actual[rarity]?.count === contract.count &&
        actual[rarity]?.colors.length === 1 &&
        actual[rarity]?.colors[0] === contract.color,
    ) &&
      actual.legendary.shadows.length === 1 &&
      actual.legendary.shadows[0] !== 'none',
    JSON.stringify({ expected, actual }),
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
    const ringBaseId = 'gravecaller_ring';
    const context = (seed, slot) => ({
      source: 'dungeon',
      sourceEntityId: 9300,
      sourceSpawnSequence: seed,
      lootSlotIndex: slot,
      sourceTemplateId: 'procedural_gallery_evidence',
      sourceTags: ['visual-evidence'],
    });
    const generate = (seed, rarity, namespace, forcedBaseId = ringBaseId, forcedItemLevel = 1) =>
      procedural.generateProceduralItem({
        seed,
        uid: procedural.formatProceduralItemUid(namespace, seed),
        context: context(seed, seed % 8),
        basePoolId: 'initial_all',
        rarityTableId: 'initial_dungeon_boss',
        sourceItemLevel: forcedItemLevel,
        forcedItemLevel,
        forcedBaseId,
        forcedRarity: rarity,
      });
    const rolledLines = (item) =>
      [
        ...(item.implicits ?? []).map((affix) => ({ source: 'implicit', affix })),
        ...(item.affixes ?? []).map((affix) => ({ source: 'affix', affix })),
      ].flatMap(({ source, affix }) =>
        Object.keys(affix.values)
          .sort()
          .map((stat) => ({
            source,
            affixId: affix.affixId,
            tier: affix.tier,
            stat,
            value: affix.values[stat],
            min: affix.ranges[stat]?.min ?? affix.values[stat],
            max: affix.ranges[stat]?.max ?? affix.values[stat],
          })),
      );
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

    const representativeSpecs = [
      {
        id: 'common-iron-broadsword',
        baseId: 'iron_broadsword',
        baseName: 'Iron Broadsword',
        rarity: 'common',
        itemLevel: 1,
        seed: 1101,
      },
      {
        id: 'common-gravecaller-cloth-hood',
        baseId: 'gravecaller_cloth_hood',
        baseName: 'Gravecaller Cloth Hood',
        rarity: 'common',
        itemLevel: 1,
        seed: 1102,
      },
      {
        id: 'rare-mirefen-leather-jerkin',
        baseId: 'mirefen_leather_jerkin',
        baseName: 'Mirefen Leather Jerkin',
        rarity: 'rare',
        itemLevel: 10,
        seed: 1901,
      },
      {
        id: 'rare-thornpeak-war-axe',
        baseId: 'thornpeak_war_axe',
        baseName: 'Thornpeak War Axe',
        rarity: 'rare',
        itemLevel: 10,
        seed: 1902,
      },
      {
        id: 'epic-gravecaller-pendant',
        baseId: 'gravecaller_pendant',
        baseName: 'Gravecaller Pendant',
        rarity: 'epic',
        itemLevel: 20,
        seed: 2101,
      },
      {
        id: 'epic-ashwood-staff',
        baseId: 'ashwood_staff',
        baseName: 'Ashwood Staff',
        rarity: 'epic',
        itemLevel: 20,
        seed: 2102,
      },
    ];
    const representativeDrops = representativeSpecs.map((spec) => {
      try {
        return {
          spec,
          drop: generate(spec.seed, spec.rarity, 'gallery-rep', spec.baseId, spec.itemLevel),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${spec.id} fixture generation failed: ${message}`);
      }
    });

    const legendaryByPower = new Map();
    const ashbinderCandidates = [];
    const ashbinderRollSignatures = new Set();
    const changedVisibleLineCount = (left, right) => {
      const rightLines = new Set(right);
      return left.filter((line) => !rightLines.has(line)).length;
    };
    for (let seed = 1; seed <= 8192; seed++) {
      const drop = generate(seed, 'legendary', 'gallery-power');
      const item = drop.instance.procedural;
      const powerId = item.legendaryPowerId;
      if (powerId && !legendaryByPower.has(powerId)) legendaryByPower.set(powerId, drop);
      if (powerId !== 'ashbinders_seal') continue;
      const lines = rolledLines(item);
      const visibleLines = lines
        .map(({ source, stat, value, min, max }) => `${source}:${stat}:${value}:${min}-${max}`)
        .sort();
      const powerRollEntries = Object.entries(item.legendaryRolls ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      );
      if (powerRollEntries.length !== 1) {
        throw new Error(`Ashbinder seed ${seed} did not persist exactly one power roll`);
      }
      const [[powerRollKey, powerRollValue]] = powerRollEntries;
      const rollSignature = JSON.stringify({ visibleLines, powerRollEntries });
      if (ashbinderRollSignatures.has(rollSignature)) continue;
      ashbinderRollSignatures.add(rollSignature);
      const normalized = lines.map((line) =>
        line.max === line.min ? 0.5 : (line.value - line.min) / (line.max - line.min),
      );
      const score = normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
      ashbinderCandidates.push({
        drop,
        seed,
        score,
        values: lines.map((line) => line.value),
        visibleLines,
        powerRollKey,
        powerRollValue,
      });
    }
    if (!legendaryByPower.has('dawnward_signet')) {
      throw new Error('gravecaller_ring did not produce Dawnward Signet in seeds 1..8192');
    }

    const powerRollValues = [...new Set(ashbinderCandidates.map((entry) => entry.powerRollValue))]
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    if (powerRollValues.length < 3) {
      throw new Error(
        `Ashbinder seeds 1..8192 produced fewer than three power values: ${powerRollValues.join(', ')}`,
      );
    }
    const lowPowerRoll = powerRollValues[0];
    const highPowerRoll = powerRollValues[powerRollValues.length - 1];
    const authoredMidpoint = (lowPowerRoll + highPowerRoll) / 2;
    const middlePowerRolls = powerRollValues
      .slice(1, -1)
      .sort(
        (left, right) =>
          Math.abs(left - authoredMidpoint) - Math.abs(right - authoredMidpoint) || left - right,
      );
    const candidatesForPower = (value) =>
      ashbinderCandidates
        .filter((candidate) => candidate.powerRollValue === value)
        .sort((left, right) => left.score - right.score || left.seed - right.seed);
    let bestTriple = null;
    findTriple: for (const middlePowerRoll of middlePowerRolls) {
      for (const first of candidatesForPower(lowPowerRoll)) {
        for (const second of candidatesForPower(middlePowerRoll)) {
          if (changedVisibleLineCount(first.visibleLines, second.visibleLines) < 2) continue;
          const third = candidatesForPower(highPowerRoll).find(
            (candidate) =>
              changedVisibleLineCount(first.visibleLines, candidate.visibleLines) >= 2 &&
              changedVisibleLineCount(second.visibleLines, candidate.visibleLines) >= 2,
          );
          if (!third) continue;
          bestTriple = { low: first, mid: second, high: third };
          break findTriple;
        }
      }
    }
    if (!bestTriple) {
      throw new Error(
        'no min/mid/max Ashbinder power-roll triple with pairwise-distinct affixes found in seeds 1..8192',
      );
    }
    const sameNamedDrops = [bestTriple.low, bestTriple.mid, bestTriple.high];
    const legendaryDrops = [bestTriple.low.drop, legendaryByPower.get('dawnward_signet')];
    const sim = window.__game?.sim;
    const hud = window.__game?.hud;
    if (!sim?.player || !hud) throw new Error('offline game did not expose the live Sim and Hud');
    const pid = sim.player.id;
    sim.addItemInstance(rollPair[0].itemId, rollPair[0].instance, pid);
    sim.equipItem(rollPair[0].itemId, rollPair[0].instance.procedural.uid);
    sim.addItemInstance(rollPair[1].itemId, rollPair[1].instance, pid);
    for (const { drop } of representativeDrops) {
      sim.addItemInstance(drop.itemId, drop.instance, pid);
    }
    for (const drop of legendaryDrops) sim.addItemInstance(drop.itemId, drop.instance, pid);
    for (const candidate of sameNamedDrops.slice(1)) {
      sim.addItemInstance(candidate.drop.itemId, candidate.drop.instance, pid);
    }
    hud.closeAll?.();
    hud.toggleBags();
    hud.renderBags?.();

    const legendary = legendaryDrops.map((drop) => {
      const view = presentation.proceduralLegendaryPresentation(drop.instance);
      if (view?.rollDetails.length !== 1) {
        throw new Error('generated Legendary had no single-roll production presentation');
      }
      return {
        baseId: drop.instance.procedural.baseId,
        powerId: view.id,
        name: view.name,
        description: view.description,
        rolls: view.rolls,
        powerRoll: view.rollDetails[0],
      };
    });
    const sameNamedLegendary = sameNamedDrops.map((candidate, index) => {
      const drop = candidate.drop;
      const view = presentation.proceduralLegendaryPresentation(drop.instance);
      if (!view) throw new Error('same-name Legendary had no production presentation');
      if (
        view.rollDetails.length !== 1 ||
        view.rollDetails[0].key !== candidate.powerRollKey ||
        view.rollDetails[0].value !== candidate.powerRollValue
      ) {
        throw new Error(`same-name Legendary ${candidate.seed} power roll did not round-trip`);
      }
      const [powerRoll] = view.rollDetails;
      return {
        rank: ['a', 'b', 'c'][index],
        seed: candidate.seed,
        score: Number(candidate.score.toFixed(4)),
        values: candidate.values,
        visibleLines: candidate.visibleLines,
        changedFromA: changedVisibleLineCount(bestTriple.low.visibleLines, candidate.visibleLines),
        changedFromB: changedVisibleLineCount(bestTriple.mid.visibleLines, candidate.visibleLines),
        itemId: drop.itemId,
        uid: drop.instance.procedural.uid,
        itemLevel: drop.instance.procedural.itemLevel,
        baseId: drop.instance.procedural.baseId,
        powerId: view.id,
        name: view.name,
        description: view.description,
        rolls: view.rolls,
        powerRoll,
      };
    });
    const representatives = representativeDrops.map(({ spec, drop }) => ({
      ...spec,
      name: presentation.itemPresentationName({ name: spec.baseName }, drop.instance),
      values: rolledLines(drop.instance.procedural).map((line) => line.value),
    }));
    return {
      baseId: ringBaseId,
      rollPair: rollPair.map((drop) => ({
        generatedName: drop.instance.procedural.generatedName,
        values: drop.instance.procedural.affixes.map((affix) => affix.values),
      })),
      legendary,
      representatives,
      sameNamedLegendary,
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
async function readFocusedProceduralTooltip(page) {
  return page.evaluate(() => {
    const focused = document.activeElement;
    const tooltip = document.getElementById('tooltip');
    const image = focused?.matches('.bag-item') ? focused.querySelector('img') : null;
    const tooltipRect = tooltip?.getBoundingClientRect();
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
    const hints = [...(tooltip?.querySelectorAll('.tt-advanced-detail-hint') ?? [])];
    const powerRoll = tooltip?.querySelector(':scope > .tt-legendary-power .tt-legendary-roll');
    const powerRange = powerRoll?.querySelector('.tt-roll-range');
    const equippedPowerRoll = tooltip?.querySelector(
      '.tt-cmp-body .tt-legendary-power .tt-legendary-roll',
    );
    const equippedPowerRange = equippedPowerRoll?.querySelector('.tt-roll-range');
    const brokenImages = [...document.querySelectorAll('#bags img, #tooltip img')]
      .filter(
        (candidate) =>
          candidate instanceof HTMLImageElement &&
          (!candidate.complete || candidate.naturalWidth < 1 || candidate.naturalHeight < 1),
      )
      .map((candidate) => candidate.getAttribute('src') ?? '');
    return {
      title: tooltip?.querySelector(':scope > .tt-title')?.textContent?.trim() ?? '',
      equippedTitle: tooltip?.querySelector('.tt-cmp-body > .tt-title')?.textContent?.trim() ?? '',
      rowRarity: focused?.getAttribute('data-procedural-rarity') ?? '',
      candidateStats,
      equippedStats,
      rangeDisplays: ranges.map((range) => getComputedStyle(range).display),
      hintDisplays: hints.map((hint) => getComputedStyle(hint).display),
      hasCompare: tooltip?.querySelector('.tt-cmp') !== null,
      hasDelta: tooltip?.querySelector('.tt-cmp > .tt-green, .tt-cmp > .tt-red') !== null,
      powerText: tooltip?.querySelector(':scope > .tt-legendary-power')?.textContent?.trim() ?? '',
      powerRollText: powerRoll?.textContent?.trim() ?? '',
      powerRangeDisplay: powerRange ? getComputedStyle(powerRange).display : null,
      equippedPowerRollText: equippedPowerRoll?.textContent?.trim() ?? '',
      equippedPowerRangeDisplay: equippedPowerRange
        ? getComputedStyle(equippedPowerRange).display
        : null,
      powerLimitText:
        tooltip
          ?.querySelector(':scope > .tt-legendary-power .tt-legendary-limit')
          ?.textContent?.trim() ?? '',
      imageUrl: image?.currentSrc ?? '',
      imageReady:
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0,
      brokenImages,
      tooltipBounds:
        tooltipRect && tooltipRect.width > 0 && tooltipRect.height > 0
          ? {
              left: tooltipRect.left,
              top: tooltipRect.top,
              right: tooltipRect.right,
              bottom: tooltipRect.bottom,
            }
          : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

async function focusProceduralBagRowByName(page, rarity, name, occurrence = 0) {
  const selector = `.bag-item[data-procedural-rarity="${rarity}"]`;
  const rowIndex = await page.evaluate(
    (rowSelector, expectedName, expectedOccurrence) => {
      const matches = [...document.querySelectorAll(rowSelector)]
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.getAttribute('aria-label')?.includes(expectedName));
      return matches[expectedOccurrence]?.index ?? -1;
    },
    selector,
    name,
    occurrence,
  );
  check(`${rarity} ${name} bag row ${occurrence + 1}`, rowIndex >= 0, `${rowIndex}`);
  await focusProceduralBagRow(page, selector, rowIndex);
  return rowIndex;
}

async function captureRepresentativeTooltip(page, fixture, filename, advanced) {
  await focusProceduralBagRowByName(page, fixture.rarity, fixture.name);
  if (advanced) {
    await page.keyboard.down('Alt');
    await page.waitForFunction(() => document.body.classList.contains('item-details-advanced'));
  }
  const state = await readFocusedProceduralTooltip(page);
  const expectedPath = `/procedural/v1/${fixture.baseId}/${fixture.rarity}.webp`;
  check(
    `${fixture.id} production tooltip`,
    state.title === fixture.name &&
      state.rowRarity === fixture.rarity &&
      state.imageReady &&
      state.imageUrl.includes(expectedPath) &&
      (fixture.rarity === 'common'
        ? state.candidateStats.length === 0
        : state.candidateStats.length > 0) &&
      state.brokenImages.length === 0 &&
      state.tooltipBounds !== null &&
      state.tooltipBounds.left >= 0 &&
      state.tooltipBounds.top >= 0 &&
      state.tooltipBounds.right <= state.viewport.width &&
      state.tooltipBounds.bottom <= state.viewport.height,
    JSON.stringify({ expectedPath, state }),
  );
  check(
    `${fixture.id} ${advanced ? 'Alt ranges visible' : 'normal ranges hidden'}`,
    fixture.rarity === 'common'
      ? state.rangeDisplays.length === 0 && state.hintDisplays.length === 0
      : state.rangeDisplays.length > 0 &&
          (advanced
            ? state.rangeDisplays.every((display) => display !== 'none') &&
              state.hintDisplays.every((display) => display === 'none')
            : state.rangeDisplays.every((display) => display === 'none') &&
              state.hintDisplays.some((display) => display !== 'none')),
    JSON.stringify(state),
  );
  await capturePresentationScreenshot(page, filename);
  if (advanced) {
    await page.keyboard.up('Alt');
    await page.waitForFunction(() => !document.body.classList.contains('item-details-advanced'));
  }
  return state;
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

  check(
    'representative rarity fixtures',
    fixtures.representatives.length === 6 &&
      new Set(fixtures.representatives.map((entry) => entry.baseId)).size === 6 &&
      fixtures.representatives.filter((entry) => entry.rarity === 'common').length === 2 &&
      fixtures.representatives.filter((entry) => entry.rarity === 'rare').length === 2 &&
      fixtures.representatives.filter((entry) => entry.rarity === 'epic').length === 2,
    JSON.stringify(fixtures.representatives),
  );
  const [rollALegendary, rollBLegendary, rollCLegendary] = fixtures.sameNamedLegendary;
  check(
    'same-name Legendary roll A/B/C fixture',
    fixtures.sameNamedLegendary.length === 3 &&
      rollALegendary.rank === 'a' &&
      rollBLegendary.rank === 'b' &&
      rollCLegendary.rank === 'c' &&
      new Set(fixtures.sameNamedLegendary.map((entry) => entry.baseId)).size === 1 &&
      new Set(fixtures.sameNamedLegendary.map((entry) => entry.powerId)).size === 1 &&
      new Set(fixtures.sameNamedLegendary.map((entry) => entry.name)).size === 1 &&
      new Set(fixtures.sameNamedLegendary.map((entry) => entry.description)).size === 1 &&
      new Set(fixtures.sameNamedLegendary.map((entry) => entry.itemLevel)).size === 1 &&
      new Set(fixtures.sameNamedLegendary.map((entry) => entry.powerRoll.key)).size === 1 &&
      new Set(fixtures.sameNamedLegendary.map((entry) => entry.powerRoll.value)).size === 3 &&
      rollALegendary.powerRoll.value < rollBLegendary.powerRoll.value &&
      rollBLegendary.powerRoll.value < rollCLegendary.powerRoll.value &&
      rollALegendary.powerRoll.value === rollALegendary.powerRoll.min &&
      rollCLegendary.powerRoll.value === rollCLegendary.powerRoll.max &&
      new Set(fixtures.sameNamedLegendary.map((entry) => entry.powerRoll.min)).size === 1 &&
      new Set(fixtures.sameNamedLegendary.map((entry) => entry.powerRoll.max)).size === 1 &&
      new Set(fixtures.sameNamedLegendary.map((entry) => entry.powerRoll.step)).size === 1 &&
      new Set(fixtures.sameNamedLegendary.map((entry) => JSON.stringify(entry.visibleLines)))
        .size === 3 &&
      rollBLegendary.changedFromA >= 2 &&
      rollCLegendary.changedFromA >= 2 &&
      rollCLegendary.changedFromB >= 2,
    JSON.stringify(
      fixtures.sameNamedLegendary.map(
        ({
          rank,
          seed,
          score,
          values,
          visibleLines,
          changedFromA,
          changedFromB,
          baseId,
          powerId,
          itemLevel,
          powerRoll,
        }) => ({
          rank,
          seed,
          score,
          values,
          visibleLines,
          changedFromA,
          changedFromB,
          baseId,
          powerId,
          itemLevel,
          powerRoll,
        }),
      ),
    ),
  );
  await page.waitForFunction(
    () => {
      const banner = document.getElementById('banner');
      return (
        !document.querySelector('#gpu-notice:not([hidden])') &&
        (!banner || Number.parseFloat(getComputedStyle(banner).opacity) <= 0.01)
      );
    },
    { timeout: 10000 },
  );
  const rootShotOverlayState = await page.evaluate(() => {
    const banner = document.getElementById('banner');
    return {
      gpuNoticeVisible: document.querySelector('#gpu-notice:not([hidden])') !== null,
      bannerOpacity: banner ? Number.parseFloat(getComputedStyle(banner).opacity) : 0,
      bannerText: banner?.textContent?.trim() ?? '',
    };
  });
  check(
    'root bags screenshot overlays clear',
    !rootShotOverlayState.gpuNoticeVisible && rootShotOverlayState.bannerOpacity <= 0.01,
    JSON.stringify(rootShotOverlayState),
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
        powerRollText:
          document
            .querySelector('#tooltip > .tt-legendary-power .tt-legendary-roll')
            ?.textContent?.trim() ?? '',
        powerRangeDisplay: (() => {
          const range = document.querySelector(
            '#tooltip > .tt-legendary-power .tt-legendary-roll .tt-roll-range',
          );
          return range ? getComputedStyle(range).display : null;
        })(),
        powerLimitText:
          document
            .querySelector('#tooltip > .tt-legendary-power .tt-legendary-limit')
            ?.textContent?.trim() ?? '',
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
        namedState.imageUrl.includes(namedState.expectedPath) &&
        namedState.powerRollText.includes(`Power roll: ${expected.powerRoll.value}%`) &&
        namedState.powerRangeDisplay === 'none' &&
        namedState.powerLimitText === 'Unique-equipped: 1 Legendary power',
      JSON.stringify(namedState),
    );
    await capturePresentationScreenshot(
      page,
      `${15 + index}-tooltip-named-legendary-${expected.powerId}.png`,
    );
  }

  const representativeShots = [
    {
      id: 'common-iron-broadsword',
      filename: '17-tooltip-common-iron-broadsword-normal.png',
      advanced: false,
    },
    {
      id: 'common-gravecaller-cloth-hood',
      filename: '18-tooltip-common-gravecaller-cloth-hood-normal.png',
      advanced: false,
    },
    {
      id: 'rare-mirefen-leather-jerkin',
      filename: '19-tooltip-rare-mirefen-leather-jerkin-normal.png',
      advanced: false,
    },
    {
      id: 'rare-thornpeak-war-axe',
      filename: '20-tooltip-rare-thornpeak-war-axe-alt.png',
      advanced: true,
    },
    {
      id: 'epic-gravecaller-pendant',
      filename: '21-tooltip-epic-gravecaller-pendant-normal.png',
      advanced: false,
    },
    {
      id: 'epic-ashwood-staff',
      filename: '22-tooltip-epic-ashwood-staff-alt.png',
      advanced: true,
    },
  ];
  for (const shot of representativeShots) {
    const fixture = fixtures.representatives.find((entry) => entry.id === shot.id);
    check(`${shot.id} fixture available`, fixture !== undefined);
    await captureRepresentativeTooltip(page, fixture, shot.filename, shot.advanced);
  }

  await page.evaluate((equipped) => {
    const sim = window.__game.sim;
    sim.equipItem(equipped.itemId, equipped.uid);
    window.__game.hud.renderBags?.();
  }, rollALegendary);
  await sleep(120);

  await focusProceduralBagRowByName(page, 'legendary', rollBLegendary.name, 0);
  const rollBLegendaryState = await readFocusedProceduralTooltip(page);
  const ashbinderIconPath = '/gravecaller_ring/legendary/ashbinders_seal.r1.webp';
  check(
    'same-name Legendary roll B comparison',
    rollBLegendaryState.title === rollBLegendary.name &&
      rollBLegendaryState.equippedTitle === rollALegendary.name &&
      rollBLegendaryState.title === rollBLegendaryState.equippedTitle &&
      rollBLegendaryState.candidateStats.length > 0 &&
      rollBLegendaryState.equippedStats.length > 0 &&
      JSON.stringify(rollBLegendaryState.candidateStats) !==
        JSON.stringify(rollBLegendaryState.equippedStats) &&
      rollBLegendaryState.hasCompare &&
      rollBLegendaryState.hasDelta &&
      rollBLegendaryState.powerText.includes(rollBLegendary.description) &&
      rollBLegendaryState.powerRollText.includes(
        `Power roll: ${rollBLegendary.powerRoll.value}%`,
      ) &&
      rollBLegendaryState.equippedPowerRollText.includes(
        `Power roll: ${rollALegendary.powerRoll.value}%`,
      ) &&
      rollBLegendaryState.powerRollText !== rollBLegendaryState.equippedPowerRollText &&
      rollBLegendaryState.powerRangeDisplay === 'none' &&
      rollBLegendaryState.equippedPowerRangeDisplay === 'none' &&
      rollBLegendaryState.powerLimitText === 'Unique-equipped: 1 Legendary power' &&
      rollBLegendaryState.imageReady &&
      rollBLegendaryState.imageUrl.includes(ashbinderIconPath) &&
      rollBLegendaryState.brokenImages.length === 0 &&
      rollBLegendaryState.tooltipBounds !== null &&
      rollBLegendaryState.tooltipBounds.left >= 0 &&
      rollBLegendaryState.tooltipBounds.top >= 0 &&
      rollBLegendaryState.tooltipBounds.right <= rollBLegendaryState.viewport.width &&
      rollBLegendaryState.tooltipBounds.bottom <= rollBLegendaryState.viewport.height &&
      rollBLegendaryState.rangeDisplays.length > 0 &&
      rollBLegendaryState.rangeDisplays.every((display) => display === 'none'),
    JSON.stringify(rollBLegendaryState),
  );
  await capturePresentationScreenshot(
    page,
    '23-tooltip-named-legendary-ashbinders-seal-roll-b-compare-normal.png',
  );

  await focusProceduralBagRowByName(page, 'legendary', rollCLegendary.name, 1);
  const rollCLegendaryState = await readFocusedProceduralTooltip(page);
  check(
    'same-name Legendary roll C comparison',
    rollCLegendaryState.title === rollCLegendary.name &&
      rollCLegendaryState.equippedTitle === rollALegendary.name &&
      rollCLegendaryState.title === rollCLegendaryState.equippedTitle &&
      rollCLegendaryState.candidateStats.length > 0 &&
      rollCLegendaryState.equippedStats.length > 0 &&
      JSON.stringify(rollCLegendaryState.candidateStats) !==
        JSON.stringify(rollCLegendaryState.equippedStats) &&
      rollCLegendaryState.hasCompare &&
      rollCLegendaryState.hasDelta &&
      rollCLegendaryState.powerText.includes(rollCLegendary.description) &&
      rollCLegendaryState.powerRollText.includes(
        `Power roll: ${rollCLegendary.powerRoll.value}%`,
      ) &&
      rollCLegendaryState.equippedPowerRollText.includes(
        `Power roll: ${rollALegendary.powerRoll.value}%`,
      ) &&
      rollCLegendaryState.powerRollText !== rollCLegendaryState.equippedPowerRollText &&
      rollCLegendaryState.powerRangeDisplay === 'none' &&
      rollCLegendaryState.equippedPowerRangeDisplay === 'none' &&
      rollCLegendaryState.powerLimitText === 'Unique-equipped: 1 Legendary power' &&
      rollCLegendaryState.imageReady &&
      rollCLegendaryState.imageUrl.includes(ashbinderIconPath) &&
      rollCLegendaryState.brokenImages.length === 0 &&
      rollCLegendaryState.tooltipBounds !== null &&
      rollCLegendaryState.tooltipBounds.left >= 0 &&
      rollCLegendaryState.tooltipBounds.top >= 0 &&
      rollCLegendaryState.tooltipBounds.right <= rollCLegendaryState.viewport.width &&
      rollCLegendaryState.tooltipBounds.bottom <= rollCLegendaryState.viewport.height &&
      rollCLegendaryState.rangeDisplays.length > 0 &&
      rollCLegendaryState.rangeDisplays.every((display) => display === 'none'),
    JSON.stringify(rollCLegendaryState),
  );
  await capturePresentationScreenshot(
    page,
    '24-tooltip-named-legendary-ashbinders-seal-roll-c-compare-normal.png',
  );

  await page.keyboard.down('Alt');
  await page.waitForFunction(() => document.body.classList.contains('item-details-advanced'));
  const rollCLegendaryAltState = await readFocusedProceduralTooltip(page);
  check(
    'same-name Legendary roll C Alt comparison',
    rollCLegendaryAltState.title === rollCLegendary.name &&
      rollCLegendaryAltState.equippedTitle === rollALegendary.name &&
      rollCLegendaryAltState.hasCompare &&
      rollCLegendaryAltState.hasDelta &&
      rollCLegendaryAltState.rangeDisplays.length > 0 &&
      rollCLegendaryAltState.rangeDisplays.every((display) => display !== 'none') &&
      rollCLegendaryAltState.hintDisplays.every((display) => display === 'none') &&
      rollCLegendaryAltState.powerText.includes(rollCLegendary.description) &&
      rollCLegendaryAltState.powerRollText.includes(
        `Power roll: ${rollCLegendary.powerRoll.value}%`,
      ) &&
      rollCLegendaryAltState.equippedPowerRollText.includes(
        `Power roll: ${rollALegendary.powerRoll.value}%`,
      ) &&
      rollCLegendaryAltState.powerRangeDisplay !== null &&
      rollCLegendaryAltState.powerRangeDisplay !== 'none' &&
      rollCLegendaryAltState.equippedPowerRangeDisplay !== null &&
      rollCLegendaryAltState.equippedPowerRangeDisplay !== 'none' &&
      rollCLegendaryAltState.powerLimitText === 'Unique-equipped: 1 Legendary power' &&
      rollCLegendaryAltState.imageReady &&
      rollCLegendaryAltState.imageUrl.includes(ashbinderIconPath) &&
      rollCLegendaryAltState.brokenImages.length === 0 &&
      rollCLegendaryAltState.tooltipBounds !== null &&
      rollCLegendaryAltState.tooltipBounds.left >= 0 &&
      rollCLegendaryAltState.tooltipBounds.top >= 0 &&
      rollCLegendaryAltState.tooltipBounds.right <= rollCLegendaryAltState.viewport.width &&
      rollCLegendaryAltState.tooltipBounds.bottom <= rollCLegendaryAltState.viewport.height,
    JSON.stringify(rollCLegendaryAltState),
  );
  await capturePresentationScreenshot(
    page,
    '25-tooltip-named-legendary-ashbinders-seal-roll-c-compare-alt.png',
  );
  await page.keyboard.up('Alt');
  await page.waitForFunction(() => !document.body.classList.contains('item-details-advanced'));
  return {
    freshDesktopBagsPng,
    screenshotCount: PRESENTATION_SCREENSHOT_COUNT,
    screenshotFilenames: [...PRESENTATION_SCREENSHOT_FILENAMES],
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
  await suppressGpuNotice(page);
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
    if (capture.filename === '10-28px-complete-contact-sheet.png') {
      await validateContactSheetRarityFrames(page);
    }
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

  const expectedGalleryFilenames = [
    ...pages.map((capture) => capture.filename),
    ...presentationEvidence.screenshotFilenames,
  ];
  check(
    'expanded gallery screenshot count',
    expectedGalleryFilenames.length === 25 && expectedGalleryFilenames.length >= 22,
    `${expectedGalleryFilenames.length}`,
  );
  check(
    'expanded gallery filename uniqueness',
    new Set(expectedGalleryFilenames).size === expectedGalleryFilenames.length,
    expectedGalleryFilenames.join(', '),
  );
  if (!PREFLIGHT_ONLY) {
    const actualGalleryFilenames = fs
      .readdirSync(OUTPUT_DIR)
      .filter((filename) => filename.endsWith('.png'))
      .sort();
    const expectedSorted = [...expectedGalleryFilenames].sort();
    check(
      'expanded gallery exact output inventory',
      JSON.stringify(actualGalleryFilenames) === JSON.stringify(expectedSorted),
      JSON.stringify({ expected: expectedSorted, actual: actualGalleryFilenames }),
    );
    const hashes = expectedSorted.map((filename) => ({
      filename,
      hash: createHash('sha256')
        .update(fs.readFileSync(path.join(OUTPUT_DIR, filename)))
        .digest('hex'),
      bytes: fs.statSync(path.join(OUTPUT_DIR, filename)).size,
    }));
    const duplicateHashes = hashes.filter(
      (entry, index) => hashes.findIndex((candidate) => candidate.hash === entry.hash) !== index,
    );
    check(
      'expanded gallery screenshot hashes unique',
      hashes.every((entry) => entry.bytes > 0) && duplicateHashes.length === 0,
      JSON.stringify(duplicateHashes),
    );
  }
  check('gallery page errors', pageErrors.length === 0, pageErrors.join('\n'));
  const consoleAudit = auditOfflineConsoleErrors(consoleErrors);
  check(
    'gallery console error allowlist',
    consoleAudit.errors.length === 0,
    consoleAudit.errors.length > 0 ? consoleAudit.errors.join('\n') : consoleAudit.summary,
  );

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
