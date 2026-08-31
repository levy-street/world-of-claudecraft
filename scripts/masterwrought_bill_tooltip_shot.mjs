// Capture rig for the two Masterwrought visual obligations the packet still owed:
//   BILLS    the crafting window rendering the longest reagent bills in the game
//            (recipe_laden_hearth and the six-row flasks), which is a LAYOUT
//            question: nothing before this packet asked that panel to draw seven
//            rows, so the frames are the evidence that it holds.
//   TOOLTIPS the two item tooltips whose TEXT changed (the apex cloth chest's
//            rating line, and the flask potency line).
//
// BEFORE/AFTER is taken by pointing this at two different trees, never by
// editing content between shots: run it against a dev server on the branch for
// the after frames and against one on the baseline commit for the before frames
// (--label picks the filename prefix). That keeps the comparison honest, because
// both frames come from a real build of a real commit.
//
// Offline client only; no game server or Postgres. Needs `npm run dev` (or any
// vite) on GAME_URL.
//
// LOCALE and MOBILE_W/MOBILE_H exist for the long-localized-reagent question:
// .crafting-reagent is inline-block + nowrap, so one entry can never break
// internally, and the worst case is the longest LOCALIZED reagent name on the
// narrowest phone. Both default to today's behaviour (English, 900x420), so an
// unset run captures exactly what it always captured.
//
// Usage:
//   GAME_URL=http://localhost:5198 LABEL=after node scripts/masterwrought_bill_tooltip_shot.mjs
//   GAME_URL=http://localhost:5197 LABEL=before node scripts/masterwrought_bill_tooltip_shot.mjs
//   GAME_URL=http://localhost:5202 LABEL=verify LOCALE=ru_RU MOBILE_W=740 MOBILE_H=360 \
//     node scripts/masterwrought_bill_tooltip_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const LABEL = process.env.LABEL ?? 'after';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/masterwrought-phase-18';
// A supported locale id (src/ui/i18n.resolved.generated/loaders.ts
// SUPPORTED_LANGUAGES). Applied through the client's own ?lang= boot path, so
// the frame is a real localized render rather than a spliced string.
const LOCALE = process.env.LOCALE ?? '';
// 740x360 is galaxy-s8-landscape, the narrowest profile in
// scripts/lib/overlap_geometry.mjs. In-game mobile is landscape-only.
const MOBILE_W = Number(process.env.MOBILE_W ?? 900);
const MOBILE_H = Number(process.env.MOBILE_H ?? 420);
// Locale rides the FILENAME, so a localized capture is its own frame instead of
// silently overwriting the English one it is meant to be compared against.
const LOCALE_SUFFIX = LOCALE ? `-${LOCALE}` : '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Clear the two overlays a crafting open can raise over the panel, and PROVE
 *  they are gone rather than clicking once and hoping.
 *
 *  Both are addressed by their own id, never by their English text: the
 *  tutorial's dismiss label is "Понятно" under LOCALE=ru_RU, and the first
 *  localized frames came out with the tutorial sitting squarely over the bill
 *  because the old sweep matched "got it".
 *
 *  It POLLS because the raise is a race, not an event this rig can await: on a
 *  non-English boot the lazy locale chunk loads first, so the tutorial can
 *  appear AFTER a single fixed wait and a one-shot dismissal misses it. Returns
 *  true once the panel is clear. */
async function clearCraftingOverlays(page, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const clear = await page.evaluate(() => {
      const gpuNotice = document.getElementById('gpu-notice');
      if (gpuNotice) gpuNotice.style.display = 'none';
      const tutorial = document.getElementById('profession-tutorial');
      if (!tutorial) return true;
      const close = tutorial.querySelector('[data-close]');
      if (close) close.click();
      return false;
    });
    if (clear) return true;
    if (Date.now() > deadline) return false;
    await wait(250);
  }
}

// The bills worth a frame: the longest in the game, plus one six-row flask.
// A recipe absent from the tree being shot is REPORTED and skipped, never
// substituted, because "this bill did not exist yet" is exactly what a before
// frame is supposed to show.
// The reagent lists are spelled here rather than read back off the sim: there is
// no IWorld recipe lookup a script can call, and the point of the grant is only
// to fill the have/need counts, so a list that drifts costs an unsatisfied row
// in a frame, never a wrong measurement.
const BILLS = [
  {
    id: 'recipe_laden_hearth',
    craft: 'cooking',
    resultName: 'The Laden Hearth',
    note: 'the longest bill in the game',
    reagents: [
      'seasoned_stock',
      'wyrmfall_core',
      'prime_cut',
      'game_meat',
      'evergarden_greens',
      'fine_evergarden_greens',
      'sunpetal_herb',
      'raw_deepbarb_catfish',
    ],
  },
  {
    id: 'recipe_warspice_skewers',
    craft: 'cooking',
    resultName: 'Warspice Skewers',
    note: 'seven rows',
    reagents: [
      'seasoned_stock',
      'prime_cut',
      'game_meat',
      'highland_barley',
      'sunpetal_herb',
      'cooking_salt',
      'raw_deepbarb_catfish',
    ],
  },
  {
    id: 'recipe_runewater_flask',
    craft: 'alchemy',
    resultName: 'Runewater Flask',
    note: 'six rows',
    reagents: [
      'quickening_catalyst',
      'pristine_venom_gland',
      'venom_gland',
      'sunpetal_herb',
      'highland_barley',
      'glass_vial',
    ],
  },
];
// The two tooltips whose text moved. Named by their ITEM, and hovered through
// the real listeners so the shot shows what a player reads.
const TOOLTIPS = [
  { id: 'sunspun_vestments', name: 'Sunspun Vestments' },
  { id: 'runewater_flask', name: 'Runewater Flask' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1600, height: 900, isMobile: false, hasTouch: false },
  // In-game mobile is LANDSCAPE-only on the web client, so the phone frame is a
  // landscape phone, not portrait.
  {
    name: 'mobile',
    width: MOBILE_W,
    height: MOBILE_H,
    isMobile: true,
    hasTouch: true,
    isLandscape: true,
  },
];

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  // Software rasterization on a busy machine can outlast the 30s default on a
  // single evaluate, which surfaces as an opaque ProtocolError rather than
  // anything about the capture.
  protocolTimeout: 180000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const missing = [];
const written = [];

for (const viewport of VIEWPORTS) {
  const page = await browser.newPage();
  // Every capture rig seeds the LOWEST graphics preset before the app boots, so
  // the frames are comparable and cheap rather than machine-dependent.
  //
  // graphicsDefaultApplied is the load-bearing half of that seed, and it is easy
  // to leave out. main.ts runs firstRunGraphicsPreset(settings.get(
  // 'graphicsDefaultApplied')) BEFORE the renderer reads the preset, so a seed
  // carrying the preset ALONE leaves the first-run device probe free to persist
  // its own tier straight over it. Measured on this harness the probe answers 1
  // anyway (headless is software GL, which resolveDefaultGraphicsPreset lows,
  // and every touch device lows), so the frames were at the low tier either way
  // and nothing captured so far is wrong. But that is the HARNESS agreeing by
  // accident, not the seed holding: on a headed run, or any machine whose GPU
  // the probe recognizes as strong, the same rig would capture above low. The
  // marker makes the seed the thing that decides.
  await page.evaluateOnNewDocument(
    "try{localStorage.setItem('woc_settings', JSON.stringify({graphicsPreset:1,graphicsDefaultApplied:true}));" +
      "localStorage.setItem('woc.tutorial.v1','done');}catch(e){}",
  );
  if (viewport.isMobile) {
    await page.emulate({
      name: 'phone-landscape',
      userAgent:
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
      viewport: {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        isLandscape: true,
      },
    });
  } else {
    await page.setViewport({ width: viewport.width, height: viewport.height });
  }
  // ?lang= is the client's own boot-time locale path (src/ui/i18n.ts), so the
  // frame renders through the real lazy-locale load rather than a patched table.
  const target = LOCALE ? `${GAME_URL}/?lang=${LOCALE}` : GAME_URL;
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const booted = await enterOfflineGame(page, {
    charClass: 'mage',
    charName: 'Billwright',
    settleMs: 2500,
  });
  if (!booted) throw new Error(`world never booted at ${GAME_URL}`);
  await page.evaluate(() => document.getElementById('mobile-preflight-continue')?.click());
  await wait(500);

  // Stage the crafter: skill high enough for every bill, the recipes known, and
  // a stack of each reagent so the rows render their have/need counts populated
  // rather than as a wall of zeros. Direct sim staging is the offline capture
  // path the other shot rigs use.
  const staged = await page.evaluate(
    (input) => {
      const sim = window.__game.sim;
      const meta = sim?.players?.get(sim.primaryId);
      if (!meta) return { ok: false, reason: 'no player meta' };
      meta.craftSkills = { ...meta.craftSkills, cooking: 200, alchemy: 200 };
      const present = [];
      for (const bill of input.bills) {
        meta.knownRecipes.add(bill.id);
        present.push(bill.id);
        for (const reagentId of bill.reagents) {
          try {
            sim.addItem(reagentId, 20);
          } catch {}
        }
      }
      for (const tooltip of input.tooltips) {
        try {
          sim.addItem(tooltip.id, 1);
        } catch {}
      }
      const banner = document.querySelector('#banner');
      if (banner) banner.style.opacity = '0';
      return { ok: true, present };
    },
    { bills: BILLS, tooltips: TOOLTIPS },
  );
  if (!staged.ok) throw new Error(`staging failed: ${staged.reason}`);
  await wait(600);

  // ---- BILLS ----
  for (const bill of BILLS) {
    // openCrafting takes a CRAFT id (the profession tab), not a recipe id: the
    // bill is a row INSIDE that tab, and its reagents render inline on the row's
    // "Requires" line. So open the craft, then find the row by its result name.
    await page.evaluate((craft) => {
      window.__game.hud.closeAll?.();
      window.__game.hud.openCrafting?.(craft);
    }, bill.craft);
    // The first-tier crafting tutorial is raised BY the open, so it can only be
    // dismissed after it. Scoped to dialog roots: a sweep over every
    // `.panel button` also presses real crafting controls.
    await wait(600);
    const cleared = await clearCraftingOverlays(page);
    if (!cleared) {
      missing.push(
        `${bill.id} (${viewport.name}): the crafting tutorial would not dismiss, so the ` +
          'frame would have photographed the dialog rather than the bill',
      );
      continue;
    }
    await wait(400);
    const opened = await page.evaluate((input) => {
      const el = document.getElementById('crafting-window');
      if (!el || getComputedStyle(el).display === 'none') return { shown: false, rows: 0 };
      // Find the row by its RECIPE ID, not by its English result name. The row
      // button carries dataset.focusKey = `craft:<recipeId>` (crafting_window.ts),
      // which is the same handle in every locale; matching the rendered name
      // finds nothing the moment LOCALE is set, which is exactly the case this
      // rig exists to photograph. The name match stays as the fallback so a
      // future markup change degrades to the old behaviour rather than to zero
      // frames.
      const byId = el.querySelector(`[data-focus-key="craft:${input.id}"] .vi-name`);
      const row =
        byId ??
        Array.from(el.querySelectorAll('.vi-name')).find((n) =>
          (n.querySelector('.crafting-recipe-name')?.textContent ?? '').includes(input.resultName),
        );
      if (!row) return { shown: true, found: false, rows: 0 };
      row.scrollIntoView({ block: 'center' });
      return {
        shown: true,
        found: true,
        rows: row.querySelectorAll('.crafting-reagent').length,
      };
    }, bill);
    await wait(700);
    if (!opened.shown || !opened.found || opened.rows === 0) {
      // A recipe this tree does not carry is REPORTED, never substituted: "this
      // bill did not exist yet" is exactly what a before frame should say.
      missing.push(
        `${bill.id} (${viewport.name}): no bill row rendered ` +
          `(shown=${opened.shown}, found=${opened.found ?? false}, rows=${opened.rows})`,
      );
      continue;
    }
    const file =
      `${OUT}/${LABEL}-bill-${bill.id.replace(/^recipe_/, '')}` +
      `-${viewport.name}${LOCALE_SUFFIX}.png`;
    await page.screenshot({ path: file });
    written.push(`${file} (${opened.rows} reagent rows, ${bill.note})`);
  }

  // ---- TOOLTIPS ----
  for (const tooltip of TOOLTIPS) {
    await page.evaluate(() => window.__game.hud.closeAll?.());
    await wait(200);
    const hovered = await page.evaluate((input) => {
      window.__game.hud.toggleBags?.();
      // Same rule as the bill row: the ITEM ID is the locale-independent handle.
      // Bag cells carry dataset.focusKey = `bag:<itemId>:<stackOrdinal>` and the
      // unsorted variant `bagu:<itemId>:...` (bags_window.ts), so match the
      // prefix rather than the localized aria-label. The label match stays as
      // the fallback.
      const cells = Array.from(document.querySelectorAll('#bags button'));
      const cell =
        cells.find((b) => {
          const key = b.dataset.focusKey ?? '';
          return key.startsWith(`bag:${input.id}:`) || key.startsWith(`bagu:${input.id}:`);
        }) ?? cells.find((b) => b.getAttribute('aria-label')?.includes(input.name));
      if (!cell) return false;
      cell.scrollIntoView({ block: 'center' });
      cell.focus();
      return true;
    }, tooltip);
    await wait(700);
    const tipText = await page.evaluate(() => {
      const tip = document.querySelector('#tooltip');
      if (!tip) return null;
      const r = tip.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return (tip.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200);
    });
    if (!hovered || !tipText) {
      missing.push(`${tooltip.id} (${viewport.name}): no tooltip raised`);
      continue;
    }
    const file = `${OUT}/${LABEL}-tooltip-${tooltip.id}-${viewport.name}${LOCALE_SUFFIX}.png`;
    await page.screenshot({ path: file });
    written.push(`${file} :: ${tipText}`);
  }
  await page.close();
}

await browser.close();
console.log(`\nwrote ${written.length} frame(s):`);
for (const line of written) console.log(`  ${line}`);
if (missing.length) {
  console.log(`\nnot captured (${missing.length}), reported rather than substituted:`);
  for (const line of missing) console.log(`  ${line}`);
}
process.exit(0);
