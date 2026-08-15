// Before/after visual proof for the canonical item-art style. Boots the real offline client,
// stages a representative spread of repaint families, and captures every player-facing item-art
// surface: Bags, Bank, merchant, Equipment, Tooltip, Mail, and an item-bound action slot.
//
// Needs `npm run dev`. Run once against the release baseline and once against this worktree:
//   SHOT_STATE=before GAME_URL=http://127.0.0.1:5173 node scripts/item_art_consistency_shots.mjs
//   SHOT_STATE=after  GAME_URL=http://127.0.0.1:5174 node scripts/item_art_consistency_shots.mjs

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Screenshot-only CLI input is not a Turbo task dependency.
const STATE = process.env.SHOT_STATE ?? 'after';
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Screenshot-only CLI input is not a Turbo task dependency.
const VARIANT = process.env.SHOT_VARIANT ?? 'both';
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Screenshot-only CLI input is not a Turbo task dependency.
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/item-art-consistency-2026-08-09';
const VALID_STATES = new Set(['before', 'after']);
const VALID_VARIANTS = new Set(['both', 'desktop', 'mobile-landscape']);
const SURFACES = ['inventory', 'bank', 'merchant', 'equipment', 'tooltip', 'mail', 'action-slot'];
const DEVICES = [
  { key: 'desktop', mobile: false },
  { key: 'mobile-landscape', mobile: true },
];
const INVENTORY_IDS = [
  'acolytes_circlet',
  'baked_bread',
  'conjured_water2',
  'healing_potion',
  'amber_hide',
  'inert_storm_shard',
  'highwatch_summons',
  'craghorn_staff',
  'drovers_staff',
  'pactbound_vestments',
  'voidscar_handwraps',
  'reins_valorsteed',
  'priests_sigil',
  'storm_core',
];
const BANK_IDS = [
  'acolytes_circlet',
  'baked_bread',
  'conjured_water2',
  'healing_potion',
  'amber_hide',
  'inert_storm_shard',
  'craghorn_staff',
  'voidscar_handwraps',
];
const VENDOR_IDS = [
  'baked_bread',
  'healing_potion',
  'craghorn_staff',
  'bogiron_hauberk',
  'highwatch_breastplate',
  'handaxe',
  'valespun_robe',
  'reins_valorsteed',
];
const VENDOR_VISIBLE_IDS = VENDOR_IDS.slice(0, 4);
const EQUIPMENT_BY_SLOT = {
  mainhand: 'drovers_staff',
  chest: 'pactbound_vestments',
  gloves: 'voidscar_handwraps',
};
const TOOLTIP_ID = 'baked_bread';
const MAIL_ID = 'amber_hide';
const ACTION_ITEM_ID = 'healing_potion';

if (!VALID_STATES.has(STATE)) {
  throw new Error(`SHOT_STATE must be before or after, received ${JSON.stringify(STATE)}`);
}
if (!VALID_VARIANTS.has(VARIANT)) {
  throw new Error(
    `SHOT_VARIANT must be both, desktop, or mobile-landscape, received ${JSON.stringify(VARIANT)}`,
  );
}

const selectedDevices = DEVICES.filter(({ key }) => VARIANT === 'both' || VARIANT === key);
const expectedFiles = selectedDevices.flatMap(({ key }) =>
  SURFACES.map((surface) => `${STATE}-${key}-${surface}.png`),
);
const capturedFiles = new Set();

fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const outputPath = (device, surface) => path.join(OUT, `${STATE}-${device}-${surface}.png`);

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60_000,
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

async function itemImageState(page, selector, rootSelector) {
  return page.$$eval(
    selector,
    (images, rootSelectorValue) => {
      const root = rootSelectorValue ? document.querySelector(rootSelectorValue) : null;
      const rootRect = root?.getBoundingClientRect() ?? null;
      const tolerance = 0.75;
      const contained = (inner, outer) =>
        inner.left >= outer.left - tolerance &&
        inner.top >= outer.top - tolerance &&
        inner.right <= outer.right + tolerance &&
        inner.bottom <= outer.bottom + tolerance;
      return images.map((image) => {
        if (!(image instanceof HTMLImageElement)) {
          return {
            path: null,
            complete: false,
            width: 0,
            height: 0,
            visible: false,
            inViewport: false,
            inRoot: false,
            frontmost: false,
          };
        }
        const rect = image.getBoundingClientRect();
        let visible = rect.width > 0 && rect.height > 0;
        for (let node = image; node instanceof HTMLElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0
          ) {
            visible = false;
            break;
          }
        }
        const viewportRect = {
          left: 0,
          top: 0,
          right: innerWidth,
          bottom: innerHeight,
        };
        const front = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        const owner =
          image.closest('.bag-item, .bank-slot, .vendor-item, .equip-slot, .mail-parcel-chip') ??
          image.parentElement ??
          image;
        return {
          path: new URL(image.currentSrc || image.src).pathname,
          complete: image.complete,
          width: image.naturalWidth,
          height: image.naturalHeight,
          visible,
          inViewport: contained(rect, viewportRect),
          inRoot: rootRect ? contained(rect, rootRect) : true,
          frontmost:
            front !== null && (front === image || front === owner || owner.contains(front)),
          rect: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
        };
      });
    },
    rootSelector,
  );
}

function assertDecoded(surface, images, expectedIds, visibleIds = expectedIds) {
  const failures = [];
  const visibleSet = new Set(visibleIds);
  for (const id of expectedIds) {
    const expectedPath = `/ui/items/${id}.webp`;
    const matches = images.filter(({ path: imagePath }) => imagePath === expectedPath);
    if (matches.length === 0) {
      failures.push(`${id}: missing ${expectedPath}`);
      continue;
    }
    for (const image of matches) {
      if (!image.complete || image.width !== 128 || image.height !== 128) {
        failures.push(`${id}: failed 128x128 decode ${JSON.stringify(image)}`);
      }
    }
    if (
      visibleSet.has(id) &&
      !matches.some((image) => image.visible && image.inViewport && image.inRoot && image.frontmost)
    ) {
      failures.push(`${id}: no fully visible, unclipped match ${JSON.stringify(matches)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${surface} item art failed decode or visibility:
- ${failures.join('\n- ')}`);
  }
}

async function itemBackgroundState(page, selector, rootSelector) {
  return page.$eval(
    selector,
    async (element, rootSelectorValue) => {
      const style = getComputedStyle(element);
      const match = style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/);
      const resolved = match?.[1] ? new URL(match[1], location.href) : null;
      const probe = new Image();
      let decoded = false;
      if (resolved) {
        probe.src = resolved.href;
        try {
          await probe.decode();
          decoded = true;
        } catch {
          decoded = false;
        }
      }
      const rect = element.getBoundingClientRect();
      const rootRect = rootSelectorValue
        ? document.querySelector(rootSelectorValue)?.getBoundingClientRect()
        : null;
      const tolerance = 0.75;
      const contained = (inner, outer) =>
        inner.left >= outer.left - tolerance &&
        inner.top >= outer.top - tolerance &&
        inner.right <= outer.right + tolerance &&
        inner.bottom <= outer.bottom + tolerance;
      let visible = rect.width > 0 && rect.height > 0;
      for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
        const nodeStyle = getComputedStyle(node);
        if (
          nodeStyle.display === 'none' ||
          nodeStyle.visibility === 'hidden' ||
          Number(nodeStyle.opacity) === 0
        ) {
          visible = false;
          break;
        }
      }
      const front = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      const owner = element.closest('button') ?? element;
      return {
        backgroundImage: style.backgroundImage,
        path: resolved?.pathname ?? null,
        decoded,
        width: probe.naturalWidth,
        height: probe.naturalHeight,
        visible,
        inViewport: contained(rect, {
          left: 0,
          top: 0,
          right: innerWidth,
          bottom: innerHeight,
        }),
        inRoot: rootRect ? contained(rect, rootRect) : true,
        frontmost: front !== null && (front === element || owner.contains(front)),
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
      };
    },
    rootSelector,
  );
}

function assertDecodedBackground(surface, state, expectedId) {
  const expectedPath = `/ui/items/${expectedId}.webp`;
  if (
    state.path !== expectedPath ||
    !state.decoded ||
    state.width !== 128 ||
    state.height !== 128 ||
    !state.visible ||
    !state.inViewport ||
    !state.inRoot ||
    !state.frontmost
  ) {
    throw new Error(
      `${surface} expected a visible, unclipped 128x128 ${expectedPath}: ${JSON.stringify(state)}`,
    );
  }
}

async function assertSurfaceRoot(page, surface, selector) {
  const state = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const tolerance = 0.75;
    return {
      display: style.display,
      visibility: style.visibility,
      opacity: Number(style.opacity),
      width: rect.width,
      height: rect.height,
      inViewport:
        rect.left >= -tolerance &&
        rect.top >= -tolerance &&
        rect.right <= innerWidth + tolerance &&
        rect.bottom <= innerHeight + tolerance,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
    };
  });
  if (
    state.display === 'none' ||
    state.visibility === 'hidden' ||
    state.opacity === 0 ||
    state.width <= 0 ||
    state.height <= 0 ||
    !state.inViewport
  ) {
    throw new Error(
      `${surface} screenshot root ${selector} is hidden or cropped: ${JSON.stringify(state)}`,
    );
  }
}

async function assertNoGpuNotice(page, surface) {
  const visible = await page.evaluate(() => {
    const notice = document.querySelector('#gpu-notice');
    if (!(notice instanceof HTMLElement)) return false;
    const style = getComputedStyle(notice);
    const rect = notice.getBoundingClientRect();
    return !notice.hidden && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  });
  if (visible) throw new Error(`${surface} capture still contains the GPU warning`);
}

async function stubOfflineApiRequests(page) {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const pathname = new globalThis.URL(request.url()).pathname;
    if (pathname === '/api/site-presence') {
      void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    if (pathname === '/api/project-stats') {
      void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts_created: 0, characters_created: 0 }),
      });
      return;
    }
    void request.continue();
  });
}

function recordScreenshot(file) {
  const name = path.basename(file);
  if (capturedFiles.has(name)) throw new Error(`duplicate screenshot write for ${name}`);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 100) throw new Error(`screenshot ${file} is empty`);
  capturedFiles.add(name);
  console.log(`captured ${name} (${stat.size} bytes)`);
}

async function screenshotSurface(page, device, surface, selector, fullFrame) {
  await assertNoGpuNotice(page, `${device} ${surface}`);
  await assertSurfaceRoot(page, `${device} ${surface}`, selector);
  const file = outputPath(device, surface);
  if (fullFrame) {
    await page.screenshot({ path: file });
  } else {
    const element = await page.$(selector);
    if (!element) throw new Error(`${surface} screenshot root ${selector} did not render`);
    await element.screenshot({ path: file });
  }
  recordScreenshot(file);
}

async function screenshotUnion(page, device, surface, selectors, fullFrame) {
  await assertNoGpuNotice(page, `${device} ${surface}`);
  for (const selector of selectors) {
    await assertSurfaceRoot(page, `${device} ${surface}`, selector);
  }
  const file = outputPath(device, surface);
  if (fullFrame) {
    await page.screenshot({ path: file });
  } else {
    const clip = await page.evaluate((rootSelectors) => {
      const rects = rootSelectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`missing screenshot union root ${selector}`);
        return element.getBoundingClientRect();
      });
      const padding = 8;
      const left = Math.max(0, Math.min(...rects.map((rect) => rect.left)) - padding);
      const top = Math.max(0, Math.min(...rects.map((rect) => rect.top)) - padding);
      const right = Math.min(innerWidth, Math.max(...rects.map((rect) => rect.right)) + padding);
      const bottom = Math.min(innerHeight, Math.max(...rects.map((rect) => rect.bottom)) + padding);
      return { x: left, y: top, width: right - left, height: bottom - top };
    }, selectors);
    await page.screenshot({ path: file, clip });
  }
  recordScreenshot(file);
}

async function capture(device, mobile) {
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    const suffix = location.url
      ? ` (${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0})`
      : '';
    consoleErrors.push(`${message.text()}${suffix}`);
  });
  await suppressGpuNotice(page);
  await stubOfflineApiRequests(page);
  if (mobile) {
    await page.emulate({
      viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
    });
  }
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  if (mobile) await page.evaluate(() => document.body.classList.add('mobile-touch'));
  await page.evaluate(async () => {
    const { charactersReady } = await import('/src/render/characters/assets.ts');
    await charactersReady();
  });
  const booted = await enterOfflineGame(page, {
    charClass: 'mage',
    charName: mobile ? `Artmob${STATE}` : `Artdesk${STATE}`,
    settleMs: 2500,
    gameBootTimeoutMs: 90000,
  });
  if (!booted) throw new Error(`${device} offline world did not boot`);
  await page.waitForSelector('#ui', { visible: true, timeout: 15000 });

  const inventory = await page.evaluate((ids) => {
    const game = window.__game;
    const playerId = game.sim.player.id;
    for (const id of ids) game.sim.addItem(id, 1, playerId);
    const bags = document.querySelector('#bags');
    if (bags instanceof HTMLElement) bags.style.display = 'none';
    game.hud.toggleBags();
    game.hud.renderBags();
    return game.sim.inventory.map((slot) => slot?.itemId).filter(Boolean);
  }, INVENTORY_IDS);
  if (!INVENTORY_IDS.every((id) => inventory.includes(id))) {
    throw new Error(`${device} representative inventory incomplete: ${JSON.stringify(inventory)}`);
  }
  await wait(600);
  assertDecoded(
    `${device} bags`,
    await itemImageState(page, '#bags .bag-item:not(.empty) img.item-icon', '#bags'),
    INVENTORY_IDS,
  );
  await screenshotSurface(page, device, 'inventory', '#bags', mobile);

  const bank = await page.evaluate((ids) => {
    const game = window.__game;
    game.sim.player.pos.x = 13;
    game.sim.player.pos.z = 6.2;
    for (const id of ids) {
      const slot = game.sim.inventory.findIndex((entry) => entry?.itemId === id);
      if (slot < 0) throw new Error(`cannot deposit missing ${id}`);
      game.world.bankDeposit(slot);
    }
    game.hud.openBank();
    return game.world.bankInfo.slots.map((slot) => slot.itemId);
  }, BANK_IDS);
  if (!BANK_IDS.every((id) => bank.includes(id))) {
    throw new Error(`${device} representative bank incomplete: ${JSON.stringify(bank)}`);
  }
  await wait(600);
  assertDecoded(
    `${device} bank`,
    await itemImageState(page, '#bank-window img.item-icon', '#bank-window'),
    BANK_IDS,
  );
  await screenshotSurface(page, device, 'bank', '#bank-window', mobile);

  const vendor = await page.evaluate((ids) => {
    const game = window.__game;
    game.hud.closeBank();
    const npc = [...game.sim.entities.values()].find((entity) => Array.isArray(entity.vendorItems));
    if (!npc) throw new Error('offline world has no merchant');
    npc.vendorItems = [...ids];
    game.sim.player.pos.x = npc.pos.x + 1.5;
    game.sim.player.pos.z = npc.pos.z;
    game.hud.openVendor(npc.id);
    return { id: npc.id, offered: [...npc.vendorItems] };
  }, VENDOR_IDS);
  if (!VENDOR_IDS.every((id) => vendor.offered.includes(id))) {
    throw new Error(`${device} representative vendor incomplete: ${JSON.stringify(vendor)}`);
  }
  await wait(600);
  assertDecoded(
    `${device} vendor`,
    await itemImageState(
      page,
      '#vendor-window .vendor-item[data-focus-key^="buy:"] img.item-icon',
      '#vendor-window',
    ),
    VENDOR_IDS,
    VENDOR_VISIBLE_IDS,
  );
  await screenshotSurface(page, device, 'merchant', '#vendor-window', mobile);

  const tooltipTrigger = await page.evaluate((itemId) => {
    const image = [...document.querySelectorAll('#vendor-window img.item-icon')].find(
      (candidate) =>
        candidate instanceof HTMLImageElement &&
        new URL(candidate.currentSrc || candidate.src).pathname === `/ui/items/${itemId}.webp`,
    );
    const row = image?.closest('.vendor-item');
    if (!(row instanceof HTMLElement)) return false;
    const rect = row.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
      row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
    }
    row.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    return true;
  }, TOOLTIP_ID);
  if (!tooltipTrigger) throw new Error(`${device} tooltip trigger ${TOOLTIP_ID} did not render`);
  await wait(350);
  const tooltip = await page.evaluate(() => {
    const element = document.querySelector('#tooltip');
    if (!(element instanceof HTMLElement)) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      display: style.display,
      width: rect.width,
      height: rect.height,
      hasTitle: (element.querySelector('.tt-title')?.textContent?.trim().length ?? 0) > 0,
    };
  });
  if (
    !tooltip ||
    tooltip.display === 'none' ||
    tooltip.width <= 0 ||
    tooltip.height <= 0 ||
    !tooltip.hasTitle
  ) {
    throw new Error(`${device} item tooltip did not render: ${JSON.stringify(tooltip)}`);
  }
  assertDecoded(
    `${device} tooltip trigger`,
    await itemImageState(
      page,
      '#vendor-window .vendor-item[data-focus-key^="buy:"] img.item-icon',
      '#vendor-window',
    ),
    [TOOLTIP_ID],
  );
  await screenshotUnion(page, device, 'tooltip', ['#vendor-window', '#tooltip'], mobile);

  const equipment = await page.evaluate((bySlot) => {
    const game = window.__game;
    game.hud.closeVendor();
    const bags = document.querySelector('#bags');
    if (bags instanceof HTMLElement) bags.style.display = 'none';
    game.sim.player.level = 20;
    for (const id of Object.values(bySlot)) {
      game.sim.addItem(id, 1, game.sim.player.id);
      game.world.equipItem(id);
    }
    const charWindow = document.querySelector('#char-window');
    if (!(charWindow instanceof HTMLElement) || charWindow.style.display !== 'block') {
      game.hud.toggleChar();
    }
    return Object.fromEntries(
      Object.keys(bySlot).map((slot) => [slot, game.world.equipment[slot]]),
    );
  }, EQUIPMENT_BY_SLOT);
  for (const [slot, id] of Object.entries(EQUIPMENT_BY_SLOT)) {
    if (equipment[slot] !== id) {
      throw new Error(
        `${device} equipment slot ${slot} expected ${id}: ${JSON.stringify(equipment)}`,
      );
    }
  }
  await wait(700);
  assertDecoded(
    `${device} equipment`,
    await itemImageState(page, '#char-window .equip-slot img.item-icon', '#char-window'),
    Object.values(EQUIPMENT_BY_SLOT),
  );
  await screenshotSurface(page, device, 'equipment', '#char-window', mobile);

  const mail = await page.evaluate((itemId) => {
    const game = window.__game;
    const charWindow = document.querySelector('#char-window');
    if (charWindow instanceof HTMLElement && charWindow.style.display === 'block') {
      game.hud.toggleChar();
    }
    game.sim.addItem(itemId, 3, game.sim.player.id);
    const mailbox = [...game.sim.entities.values()].find(
      (entity) => entity.kind === 'object' && entity.templateId === 'mailbox',
    );
    if (!mailbox) return { ok: false, reason: 'offline world has no mailbox' };
    game.sim.player.pos.x = mailbox.pos.x + 1;
    game.sim.player.pos.z = mailbox.pos.z + 1;
    game.hud.openMailbox();
    const send = document.querySelector('#mailbox-window [data-tab="send"]');
    if (!(send instanceof HTMLElement)) return { ok: false, reason: 'mail Send tab missing' };
    send.click();
    game.hud.mailboxWindow.stageParcel(itemId);
    const bags = document.querySelector('#bags');
    if (bags instanceof HTMLElement) bags.style.display = 'none';
    return {
      ok: true,
      isOpen: game.hud.mailboxWindowOpen,
      isSend: game.hud.mailboxWindow.isSendTab,
    };
  }, MAIL_ID);
  if (!mail.ok || !mail.isOpen || !mail.isSend) {
    throw new Error(`${device} mail parcel setup failed: ${JSON.stringify(mail)}`);
  }
  await wait(600);
  if (mobile) {
    await page.$eval('#mailbox-window .mail-parcel-chip', (chip) => {
      const body = document.querySelector('#mailbox-body');
      if (!(body instanceof HTMLElement)) throw new Error('mailbox scroll body missing');
      const bodyRect = body.getBoundingClientRect();
      const chipRect = chip.getBoundingClientRect();
      body.scrollTop +=
        chipRect.top - bodyRect.top - Math.max(0, (body.clientHeight - chipRect.height) / 2);
    });
    await wait(200);
  }
  assertDecoded(
    `${device} mail parcel`,
    await itemImageState(
      page,
      '#mailbox-window .mail-parcel-chip img.item-icon',
      '#mailbox-window',
    ),
    [MAIL_ID],
  );
  await screenshotSurface(page, device, 'mail', '#mailbox-window', mobile);

  const action = await page.evaluate((itemId) => {
    const game = window.__game;
    game.hud.closeMailbox();
    const bags = document.querySelector('#bags');
    if (bags instanceof HTMLElement) bags.style.display = 'none';
    game.sim.addItem(itemId, 5, game.sim.player.id);
    const controller = game.hud.actionBarController;
    const actions = controller.actions.slice();
    actions[0] = { type: 'item', id: itemId };
    controller.replaceActions(actions);
    return {
      first: controller.actions[0],
      count: game.sim.inventory
        .filter((slot) => slot.itemId === itemId)
        .reduce((sum, slot) => sum + slot.count, 0),
    };
  }, ACTION_ITEM_ID);
  if (action.first?.type !== 'item' || action.first.id !== ACTION_ITEM_ID || action.count < 1) {
    throw new Error(`${device} item action-slot setup failed: ${JSON.stringify(action)}`);
  }
  await wait(700);
  const actionRoot = mobile ? '#mobile-action-ring' : '#actionbar';
  const actionIcon = mobile
    ? '#mobile-action-ring .mobile-action-slot[data-mobile-index="0"] .icon-label'
    : '#actionbar .action-btn[data-hotbar-slot="1"] .icon-label';
  assertDecodedBackground(
    `${device} action slot`,
    await itemBackgroundState(page, actionIcon, actionRoot),
    ACTION_ITEM_ID,
  );
  await screenshotSurface(page, device, 'action-slot', actionRoot, mobile);

  if (pageErrors.length > 0 || consoleErrors.length > 0) {
    const failures = [
      ...pageErrors.map((message) => `pageerror: ${message}`),
      ...consoleErrors.map((message) => `console.error: ${message}`),
    ];
    throw new Error(`${device} browser errors:\n- ${failures.join('\n- ')}`);
  }
  await page.close();
}

function verifyOutputSet() {
  const expected = [...expectedFiles].sort();
  const captured = [...capturedFiles].sort();
  if (JSON.stringify(captured) !== JSON.stringify(expected)) {
    throw new Error(
      `capture set mismatch:\nexpected ${JSON.stringify(expected)}\nreceived ${JSON.stringify(captured)}`,
    );
  }
  const selectedPrefixes = selectedDevices.map(({ key }) => `${STATE}-${key}-`);
  const onDisk = fs
    .readdirSync(OUT)
    .filter(
      (name) => name.endsWith('.png') && selectedPrefixes.some((prefix) => name.startsWith(prefix)),
    )
    .sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(expected)) {
    throw new Error(
      `evidence folder contains a stale or missing ${STATE} output:\nexpected ${JSON.stringify(expected)}\nreceived ${JSON.stringify(onDisk)}`,
    );
  }
}

try {
  for (const { key, mobile } of selectedDevices) await capture(key, mobile);
  verifyOutputSet();
  console.log(
    `captured ${expectedFiles.length} item-art ${STATE} evidence files in ${OUT}: ${SURFACES.join(', ')}`,
  );
} finally {
  await browser.close();
}
