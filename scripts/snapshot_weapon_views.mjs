// Capture the new weapon icons across the HUD: bags, vendor, character/equipment
// panel, and an item tooltip. Boots the offline game, stages weapons, equips one,
// opens each panel, and writes PNGs to tmp/weapon_snapshots/. Needs `npm run dev`.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.CAPTURE_OUT ?? 'tmp/weapon_snapshots';
const LABEL = process.env.CAPTURE_LABEL ?? 'after';
const MOBILE = process.env.CAPTURE_MOBILE === '1';
const WIDTH = Number(process.env.CAPTURE_WIDTH ?? (MOBILE ? 844 : 1600));
const HEIGHT = Number(process.env.CAPTURE_HEIGHT ?? (MOBILE ? 390 : 900));
const FORM = MOBILE ? 'mobile-landscape' : 'desktop';
const STAGED_WEAPON_IDS = [
  'wyrmfang_greatblade',
  'drogmars_skullcleaver',
  'valeborn_spellblade',
  'fang_of_korzul',
  'gravecaller_staff',
  'moggers_copper_cudgel',
  'fen_reaver_glaive',
  'redbrook_blade',
  'keen_dirk',
  'worn_sword',
];
const EQUIP_CANDIDATE_IDS = [
  'wyrmfang_greatblade',
  'drogmars_skullcleaver',
  'redbrook_blade',
  'worn_sword',
];
const EXPECTED_EQUIPPED_ID = 'redbrook_blade';
const KNOWN_VENDOR_WEAPON_IDS = [
  'eastbrook_arming_sword',
  'bronzework_mace',
  'vale_carving_knife',
  'hickory_shortstaff',
  'highwatch_warblade',
  'bogiron_mace',
  'fenreed_staff',
  'mirefen_skinner',
  'craghorn_staff',
  'icevein_dirk',
];
const outputPath = (name) => `${OUT}/${LABEL}-${FORM}-${name}.png`;
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
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await suppressGpuNotice(page);
if (MOBILE) {
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  );
}

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Iconsmith',
  settleMs: 500,
  gameBootTimeoutMs: 90000,
});
if (!booted) throw new Error('offline world did not boot');
await page.waitForSelector('#ui', { visible: true, timeout: 15000 });
await page.evaluate(() => window.__game.hud.closeOptions());

async function itemImageState(selector) {
  return page.$$eval(selector, (images) =>
    images.map((image) => {
      if (!(image instanceof HTMLImageElement)) {
        return { path: null, complete: false, width: 0, height: 0 };
      }
      return {
        path: new URL(image.currentSrc || image.src).pathname,
        complete: image.complete,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    }),
  );
}

function assertDecodedItemImages(surface, images, expectedIds) {
  const failures = [];
  for (const id of expectedIds) {
    const expectedPath = `/ui/items/${id}.webp`;
    const matches = images.filter(({ path }) => path === expectedPath);
    if (matches.length === 0) {
      failures.push(`${id}: missing ${expectedPath}`);
      continue;
    }
    for (const image of matches) {
      if (!image.complete || image.width !== 128 || image.height !== 128) {
        failures.push(`${id}: ${JSON.stringify(image)}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${surface} weapon images did not decode at 128x128:\n- ${failures.join('\n- ')}`,
    );
  }
}

const setup = await page.evaluate(
  (stagedWeaponIds, equipCandidateIds, vendorWeaponIds) => {
    const g = window.__game,
      sim = g.sim,
      pid = sim.player.id;
    for (const id of stagedWeaponIds) sim.addItem(id, 1, pid);
    // equip the best warrior-usable weapon for the character panel
    let equipped = null;
    for (const id of equipCandidateIds) {
      try {
        g.world.equipItem(id);
      } catch {
        /* class-locked */
      }
      if (g.world.equipment?.mainhand === id) {
        equipped = id;
        break;
      }
    }
    // find a weapon-selling vendor NPC
    let vendorId = null;
    let offeredWeaponIds = [];
    for (const e of sim.entities.values()) {
      if (Array.isArray(e.vendorItems)) {
        const matching = e.vendorItems.filter((itemId) => vendorWeaponIds.includes(itemId));
        if (matching.length === 0) continue;
        vendorId = e.id;
        offeredWeaponIds = matching;
        break;
      }
    }
    return {
      equipped,
      mainhand: g.world.equipment?.mainhand ?? null,
      vendorId,
      offeredWeaponIds,
    };
  },
  STAGED_WEAPON_IDS,
  EQUIP_CANDIDATE_IDS,
  KNOWN_VENDOR_WEAPON_IDS,
);
console.log('setup:', JSON.stringify(setup));
if (setup.equipped !== EXPECTED_EQUIPPED_ID || setup.mainhand !== EXPECTED_EQUIPPED_ID) {
  throw new Error(`weapon setup did not equip ${EXPECTED_EQUIPPED_ID}: ${JSON.stringify(setup)}`);
}

// 1) BAGS
await page.evaluate(() => {
  window.__game.hud.renderBags();
  document.querySelector('#bags').style.display = 'flex';
});
await new Promise((r) => setTimeout(r, 400));
assertDecodedItemImages(
  'bags',
  await itemImageState('#bags .bag-item:not(.empty) .item-icon'),
  STAGED_WEAPON_IDS.filter((id) => id !== EXPECTED_EQUIPPED_ID),
);
await (await page.$('#bags')).screenshot({ path: outputPath('bags') });

// 2) CHARACTER / EQUIPMENT panel
await page.evaluate(() => {
  window.__game.hud.toggleChar();
});
await new Promise((r) => setTimeout(r, 400));
assertDecodedItemImages(
  'character mainhand',
  await itemImageState('#equip-slot-mainhand .item-icon'),
  [EXPECTED_EQUIPPED_ID],
);
if (MOBILE) {
  await page.screenshot({ path: outputPath('character-panel') });
} else {
  await (await page.$('#char-window')).screenshot({ path: outputPath('character-panel') });
}

// 3) VENDOR window
if (setup.vendorId !== null) {
  const vstate = await page.evaluate((id) => {
    // stand next to the vendor so the world's update loop keeps the shop open
    const sim = window.__game.sim;
    const npc = sim.entities.get(id);
    sim.player.pos.x = npc.pos.x + 1.5;
    sim.player.pos.z = npc.pos.z;
    for (const sel of ['#char-window', '#bags']) {
      const e = document.querySelector(sel);
      if (e) e.style.display = 'none';
    }
    window.__game.hud.openVendor(id);
    if (!document.body.classList.contains('mobile-touch')) {
      document.querySelector('#bags').style.display = 'none'; // openVendor re-shows bags
    }
    return { name: npc?.name, kids: document.querySelector('#vendor-window').childElementCount };
  }, setup.vendorId);
  console.log('vendor state:', JSON.stringify(vstate));
  await new Promise((r) => setTimeout(r, 400));
  assertDecodedItemImages(
    'vendor',
    await itemImageState('#vendor-window .vendor-item[data-focus-key^="buy:"] .item-icon'),
    setup.offeredWeaponIds,
  );
  const tooltipWeaponId = setup.offeredWeaponIds[0];
  if (!tooltipWeaponId) throw new Error('weapon vendor exposed no expected weapon offer');
  const vclip = await page.evaluate((mobile) => {
    const el = document.querySelector('#vendor-window');
    el.style.display = 'block';
    if (!mobile) {
      el.style.left = '600px';
      el.style.top = '80px';
    }
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.x - 6);
    const y = Math.max(0, r.y - 6);
    return {
      x,
      y,
      width: Math.min(innerWidth - x, r.width + 12),
      height: Math.min(innerHeight - y, r.height + 12),
    };
  }, MOBILE);
  if (MOBILE) {
    await page.screenshot({ path: outputPath('vendor') });
  } else {
    await page.screenshot({ path: outputPath('vendor'), clip: vclip });
  }

  // 4) TOOLTIP — synthesize a hover on the first vendor weapon row (attachTooltip
  // listens for mouseenter/mousemove and positions #tooltip at the cursor).
  await page.evaluate(
    (mobile, weaponId) => {
      const row = [...document.querySelectorAll('#vendor-window .vendor-item')].find(
        (candidate) => candidate.getAttribute('data-focus-key') === `buy:${weaponId}`,
      );
      if (!row) throw new Error(`vendor weapon row did not render for ${weaponId}`);
      if (mobile) {
        row.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        return;
      }
      const r = row.getBoundingClientRect();
      const cx = r.x + r.width / 2,
        cy = r.y + r.height / 2;
      for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
        row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: cx, clientY: cy }));
      }
    },
    MOBILE,
    tooltipWeaponId,
  );
  await new Promise((r) => setTimeout(r, 300));
  const tooltipState = await page.evaluate((weaponId) => {
    const tooltip = document.querySelector('#tooltip');
    const row = [...document.querySelectorAll('#vendor-window .vendor-item')].find(
      (candidate) => candidate.getAttribute('data-focus-key') === `buy:${weaponId}`,
    );
    const image = row?.querySelector('.item-icon');
    return {
      visible:
        tooltip instanceof HTMLElement &&
        getComputedStyle(tooltip).display !== 'none' &&
        tooltip.getBoundingClientRect().width > 0,
      hasTitle: (tooltip?.querySelector('.tt-title')?.textContent?.trim().length ?? 0) > 0,
      image:
        image instanceof HTMLImageElement
          ? {
              path: new URL(image.currentSrc || image.src).pathname,
              complete: image.complete,
              width: image.naturalWidth,
              height: image.naturalHeight,
            }
          : null,
    };
  }, tooltipWeaponId);
  if (!tooltipState.visible || !tooltipState.hasTitle || !tooltipState.image) {
    throw new Error(`vendor weapon tooltip did not render: ${JSON.stringify(tooltipState)}`);
  }
  // Item tooltips are text cards; their triggering row owns the weapon image that
  // remains visible beside the card. Pin that image for the tooltip evidence surface.
  assertDecodedItemImages('tooltip trigger', [tooltipState.image], [tooltipWeaponId]);
  // crop a region covering both the shop panel and the floating tooltip
  const ttclip = await page.evaluate(() => {
    const v = document.querySelector('#vendor-window').getBoundingClientRect();
    const tt = document.querySelector('#tooltip');
    const t = tt && tt.style.display !== 'none' ? tt.getBoundingClientRect() : v;
    const x0 = Math.max(0, Math.min(v.x, t.x) - 10),
      y0 = Math.max(0, Math.min(v.y, t.y) - 10);
    const x1 = Math.min(innerWidth, Math.max(v.x + v.width, t.x + t.width) + 10),
      y1 = Math.min(innerHeight, Math.max(v.y + v.height, t.y + t.height) + 10);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  });
  if (MOBILE) {
    await page.screenshot({ path: outputPath('tooltip') });
  } else {
    await page.screenshot({ path: outputPath('tooltip'), clip: ttclip });
  }
} else {
  throw new Error('no weapon vendor found near spawn');
}

console.log('snapshots written to', OUT);
await browser.close();
if (pageErrors.length > 0) {
  throw new Error(`capture page errors:\n- ${pageErrors.join('\n- ')}`);
}
process.exit(0);
