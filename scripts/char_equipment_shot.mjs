// Before/after visual reference for the Character Equipment Screen redesign
// (docs/char-equipment/). Modeled on scripts/mobile_char_window_shot.mjs's boot
// idiom: BROWSER_PATH resolves the local Chrome/Edge binary (override with
// BROWSER_PATH=... to force Chrome over Edge), enterOfflineGame drives the
// offline entry flow. Captures the character window across representative
// desktop and mobile viewports into tmp/. Needs `npm run dev`
// on :5173. Offline flow, no server.
//
// Phase 2 (docs/char-equipment/phase-02-window-shell.md) runs this TWICE: once
// against the UNCHANGED window (the committed "before" shots,
// docs/screenshots/char-equipment-before-desktop.png and -before-mobile.png
// are the 1600x740 desktop and 390x844 mobile-portrait frames, copied by hand
// after this script writes tmp/) and again after the tabbed/paperdoll rework
// lands, purely as a visual sanity check (that run writes only to tmp/, never
// overwriting the committed before shots).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
const CLASS = process.env.GAME_CLASS ?? 'warrior';
const OUT_PREFIX = process.env.SHOT_PREFIX ?? 'char_equipment';
const ONLY = process.env.SHOT_ONLY?.split(',')
  .map((name) => name.trim())
  .filter(Boolean);
fs.mkdirSync('tmp', { recursive: true });

// A representative item in every paperdoll slot (char_view.ts
// PAPERDOLL_LEFT_SLOTS/PAPERDOLL_RIGHT_SLOTS plus the two rings), so every
// slot cell shows a real icon + rarity border instead of the empty state.
// Item ids mirror the stat_tooltip_shot.mjs / heroic_vendor_shot.mjs precedent.
const EQUIP_SET = {
  helmet: 'cryptbone_helm',
  neck: 'yumis_keepsake_locket',
  shoulder: 'gravewyrm_mantle',
  chest: 'recruit_tunic',
  gloves: 'mistveil_grips',
  mainhand: 'worn_sword',
  waist: 'mistveil_cord',
  legs: 'quilted_trousers',
  feet: 'oiled_boots',
  ring1: 'seal_of_the_nine_oaths',
  ring2: 'nielas_coldlight_band',
};
const BAG_SET = ['linen_pouch', 'travelers_knapsack'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shootAt(browser, { width, height, isMobile, outPath }) {
  const page = await browser.newPage();
  const errors = [];
  const entryWidth = isMobile ? Math.max(width, 667) : width;
  const entryHeight = isMobile ? Math.max(height, 375) : height;
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
  });
  await page.setViewport({
    width: entryWidth,
    height: entryHeight,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
  });
  if (isMobile) {
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'pointer', value: 'coarse' }],
    });
  }

  console.log(`opening ${width}x${height}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log(`entering offline game at ${width}x${height}`);
  await enterOfflineGame(page, { charClass: CLASS, charName: 'Yumi' });

  if (entryWidth !== width || entryHeight !== height) {
    await page.setViewport({
      width,
      height,
      isMobile,
      hasTouch: isMobile,
      deviceScaleFactor: isMobile ? 2 : 1,
    });
    await wait(100);
  }

  if (isMobile) {
    // On a phone-touch device the world-entry flow first shows an "add to home
    // screen" preflight that blocks until dismissed (no-op on desktop, where
    // the preflight never appears).
    await page
      .waitForSelector('#mobile-preflight-continue', { visible: true, timeout: 8000 })
      .catch(() => {});
    await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
  }
  console.log(`waiting for player at ${width}x${height}`);
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 30000 });
  await wait(1000);

  // Skip the first-spawn intro cinematic: it holds #ui (and mobile-controls)
  // display:none and swallows other input until Escape (or a touch tap burst,
  // which Escape also satisfies headlessly) ends it, so every char-window shot
  // script needs this or the whole HUD stays hidden (heroic_vendor_shot.mjs /
  // pr1736_fix_round_verify.mjs precedent). Gated on the intro actually being
  // active: it plays once per character (persisted in localStorage), and
  // separate pages from the SAME launched browser share that profile, so an
  // unconditional Escape on a later page would instead open the options menu.
  const introActive = await page.evaluate(
    () => document.getElementById('ui')?.style.display === 'none',
  );
  if (introActive) {
    await page.keyboard.press('Escape');
    await wait(300);
  }

  // Dismiss the new-adventurer tutorial overlay so it doesn't obscure the window.
  await page.evaluate(() => document.querySelector('.tut-skip')?.click());
  await wait(300);

  // God-mode plus a clear open-field spot away from the spawn hub, so the
  // world behind the window is clean (memory gotcha: teleport off the
  // cluttered spawn plaza before framing a shot), then equip a representative
  // item in every paperdoll slot so the window renders filled, not empty.
  await page.evaluate(
    (equip, bags) => {
      const { sim } = window.__game;
      const p = sim.player;
      p.gm = true;
      p.hp = p.maxHp;
      // A few of the jewelry pieces below carry a level requirement (equipItem
      // silently rejects it otherwise), so level up first, matching the
      // heroic_vendor_shot.mjs precedent.
      sim.setPlayerLevel(20, p.id);
      Object.assign(p.pos, sim.groundPos(20, -60));
      p.prevPos = { ...p.pos };
      sim.rebucket(p);
      for (const id of Object.values(equip)) {
        try {
          sim.addItem(id, 1, p.id);
          sim.equipItem(id, p.id);
        } catch {
          // best effort: a missing/renamed item id should not abort the whole shot
        }
      }
      // Populate the owned-bag shelf with two honest equipped containers. This
      // keeps the visual fixture representative and makes the narrow-width
      // horizontal-reachability assertion exercise more than the backpack.
      for (const id of bags) {
        try {
          sim.addItem(id, 1, p.id);
          sim.equipBag(id, undefined, p.id);
        } catch {
          // Best effort for the same reason as the equipment set above.
        }
      }
      sim.tick();
    },
    EQUIP_SET,
    BAG_SET,
  );
  await wait(300);

  // Open the character sheet (the same hud.toggleChar() call the KeyC keybind
  // wires to; every other char-window shot script drives it this way, e.g.
  // heroic_vendor_shot.mjs / stat_tooltip_shot.mjs, since a synthetic
  // KeyboardEvent would have to fight the real input/keybind plumbing for no
  // added coverage here).
  await page.evaluate(() => {
    const { hud } = window.__game;
    if (document.querySelector('#char-window')?.style.display !== 'block') hud.toggleChar();
  });
  await wait(800);

  // The bag shelf always starts expanded. Exercise the Empty spaces control
  // without scrolling it into view, verify that only occupied item buttons
  // remain beside one exact grey summary, then restore the expanded state so
  // the reference capture represents the default presentation.
  const bagCompactBefore = await page.evaluate(() => {
    const toggle = document.querySelector('.char-bags-empty-input');
    const grid = document.querySelector('.char-bags-grid');
    return {
      toggle: toggle instanceof HTMLInputElement,
      checked: toggle instanceof HTMLInputElement && toggle.checked,
      emptyCount: grid?.querySelectorAll('.item-cell.is-empty').length ?? -1,
      itemCount: grid?.querySelectorAll('.item-cell:not(.is-empty)').length ?? -1,
    };
  });
  if (!bagCompactBefore.toggle || !bagCompactBefore.checked || bagCompactBefore.emptyCount < 1) {
    throw new Error(
      `Expanded Empty spaces control unavailable at ${width}x${height}: ${JSON.stringify(bagCompactBefore)}`,
    );
  }
  await page.evaluate(() =>
    document.querySelector('.char-bags-empty-input') instanceof HTMLInputElement
      ? document.querySelector('.char-bags-empty-input').click()
      : undefined,
  );
  await wait(60);
  const bagCompactAfter = await page.evaluate(() => {
    const toggle = document.querySelector('.char-bags-empty-input');
    const grid = document.querySelector('.char-bags-grid');
    const summary = grid?.querySelector('.char-bags-empty-summary');
    return {
      checked: toggle instanceof HTMLInputElement && toggle.checked,
      emptyCount: grid?.querySelectorAll('.item-cell.is-empty').length ?? -1,
      itemCount: grid?.querySelectorAll('.item-cell:not(.is-empty)').length ?? -1,
      summary: summary?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      role: summary?.getAttribute('role') ?? '',
    };
  });
  if (
    bagCompactAfter.checked ||
    bagCompactAfter.emptyCount !== 0 ||
    bagCompactAfter.itemCount !== bagCompactBefore.itemCount ||
    bagCompactAfter.summary !== `+${bagCompactBefore.emptyCount} empty` ||
    bagCompactAfter.role !== 'status'
  ) {
    throw new Error(
      `Collapsed Empty spaces view invalid at ${width}x${height}: ${JSON.stringify({ bagCompactBefore, bagCompactAfter })}`,
    );
  }
  await page.evaluate(() =>
    document.querySelector('.char-bags-empty-input') instanceof HTMLInputElement
      ? document.querySelector('.char-bags-empty-input').click()
      : undefined,
  );
  await wait(60);

  // Desktop equipment must retain the real item-stats hover affordance after
  // the visual orbit changes. Exercise the same mouseenter path a player uses,
  // confirm the shared tooltip is visible and contains stat-like item detail,
  // then clear it before the clean reference capture.
  if (!isMobile) {
    for (const selector of [
      '#equip-slot-helmet .equip-item-cell',
      '#equip-slot-ring2 .equip-item-cell',
    ]) {
      const equippedCell = await page.$(selector);
      if (!equippedCell) {
        throw new Error(`Filled equipment cell ${selector} unavailable at ${width}x${height}`);
      }
      await equippedCell.hover();
      await wait(350);
      const itemTooltip = await page.evaluate(() => {
        const tooltip = document.querySelector('#tooltip');
        const rect = tooltip?.getBoundingClientRect();
        return {
          shown: tooltip instanceof HTMLElement && tooltip.style.display === 'block',
          text: tooltip?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          insideViewport:
            rect &&
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= window.innerWidth &&
            rect.bottom <= window.innerHeight,
        };
      });
      if (
        !itemTooltip.shown ||
        !itemTooltip.insideViewport ||
        itemTooltip.text.length < 20 ||
        !/Armor|Stamina|Strength|Agility|Intellect|Spirit|Durability|Requires/.test(
          itemTooltip.text,
        )
      ) {
        throw new Error(
          `Equipment item-stats hover unavailable for ${selector} at ${width}x${height}: ${JSON.stringify(itemTooltip)}`,
        );
      }
    }
    await page.mouse.move(2, 2);
    await wait(120);
  }

  const geometry = await page.evaluate(() => {
    const root = document.querySelector('#char-window');
    const body = root?.querySelector('.window-body');
    const stage = root?.querySelector('.paperdoll');
    const bags = root?.querySelector('#char-bags');
    const panels = root?.querySelector('#char-panels');
    if (!(root instanceof HTMLElement) || !(body instanceof HTMLElement)) return null;
    const rect = root.getBoundingClientRect();
    const box = (el) => {
      if (!(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const leftEquip = root.querySelector('#equip-col-left');
    const rightEquip = root.querySelector('#equip-col-right');
    const topEquip = root.querySelector('.equip-top-center');
    const model = root.querySelector('.char-model-panel');
    const appearanceRow = root.querySelector('.char-skin-row');
    const specializationPanel = root.querySelector('.char-panel:nth-child(5)');
    const specializationAction = specializationPanel?.querySelector('[data-act="open-talents"]');
    const gatheringPanel = root.querySelector('.char-panel:nth-child(6)');
    const gatheringLast = gatheringPanel?.querySelector('.char-gathering-row:last-child');
    const nestedDesktopScroll = [
      ...root.querySelectorAll('.char-panels, .char-panel-body, .char-bags'),
    ]
      .filter((target) => target instanceof HTMLElement)
      .some((target) => {
        const overflowY = getComputedStyle(target).overflowY;
        return /auto|scroll/.test(overflowY) && target.scrollHeight > target.clientHeight + 1;
      });
    const rendered = (target) => {
      if (!(target instanceof HTMLElement) || target.getClientRects().length === 0) return false;
      const style = getComputedStyle(target);
      return (
        style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0
      );
    };
    const visibleTargetBoxes = (selector) =>
      [...root.querySelectorAll(selector)].filter(rendered).map(box);
    const leftEquipTargets = visibleTargetBoxes('#equip-col-left .equip-item-cell');
    const rightEquipTargets = visibleTargetBoxes('#equip-col-right .equip-item-cell');
    const topEquipTargets = visibleTargetBoxes('.equip-top-center .equip-item-cell');
    const appearanceTargets = visibleTargetBoxes('.char-skin-row .skin-swatch');
    const slotIds = (selector) =>
      [...root.querySelectorAll(selector)]
        .filter(rendered)
        .map((row) => row.id.replace('equip-slot-', ''));
    const allCells = [...root.querySelectorAll('.equip-item-cell')].filter(rendered);
    const unequipButtons = [...root.querySelectorAll('.equip-unequip-btn')]
      .filter(rendered)
      .map((button) => {
        const buttonBox = button.getBoundingClientRect();
        const owner = button.closest('.equip-item-cell');
        const ownerBox = owner?.getBoundingClientRect();
        const centerX = buttonBox.left + buttonBox.width / 2;
        const centerY = buttonBox.top + buttonBox.height / 2;
        const style = getComputedStyle(button);
        const overlapsOtherSlot = allCells.some((cell) => {
          if (cell === owner) return false;
          const cellBox = cell.getBoundingClientRect();
          return (
            buttonBox.right > cellBox.left + 1 &&
            buttonBox.left < cellBox.right - 1 &&
            buttonBox.bottom > cellBox.top + 1 &&
            buttonBox.top < cellBox.bottom - 1
          );
        });
        return {
          box: box(button),
          opacity: Number(style.opacity),
          display: style.display,
          visibility: style.visibility,
          hitTarget:
            centerX >= 0 &&
            centerX <= window.innerWidth &&
            centerY >= 0 &&
            centerY <= window.innerHeight
              ? document.elementFromPoint(centerX, centerY) === button
              : null,
          nearOwnerCorner:
            ownerBox &&
            ((Math.abs(centerX - ownerBox.right) <= 5 && Math.abs(centerY - ownerBox.top) <= 5) ||
              (buttonBox.left >= ownerBox.left - 1 &&
                buttonBox.right <= ownerBox.right + 1 &&
                buttonBox.top >= ownerBox.top - 1 &&
                buttonBox.bottom <= ownerBox.bottom + 1)),
          overlapsOtherSlot,
        };
      });
    const mobileControls = [
      ...root.querySelectorAll(
        '.window-close, .tab-rail .tab, .char-equip-rail .equip-item-cell, .char-skin-row .skin-swatch, .equip-unequip-btn, .char-bags-tab, .char-bags-tab-remove, .char-bags-empty-toggle',
      ),
    ]
      .filter(rendered)
      .map(box);
    return {
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      mobileTouch: document.body.classList.contains('mobile-touch'),
      compactLandscape: root?.classList.contains('is-compact-landscape') ?? false,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      body: box(body),
      stage: box(stage),
      bags: box(bags),
      panels: box(panels),
      leftEquip: box(leftEquip),
      rightEquip: box(rightEquip),
      topEquip: box(topEquip),
      model: box(model),
      appearanceRow: box(appearanceRow),
      specializationPanel: box(specializationPanel),
      specializationAction: box(specializationAction),
      gatheringPanel: box(gatheringPanel),
      gatheringLast: box(gatheringLast),
      leftEquipTargets,
      rightEquipTargets,
      topEquipTargets,
      appearanceTargets,
      leftSlotIds: slotIds('#equip-col-left .equip-slot'),
      rightSlotIds: slotIds('#equip-col-right .equip-slot'),
      desktopSlotBoxes: Object.fromEntries(
        [
          'mainhand',
          'neck',
          'chest',
          'gloves',
          'ring1',
          'shoulder',
          'waist',
          'legs',
          'feet',
          'ring2',
        ].map((slot) => [slot, box(root.querySelector(`#equip-slot-${slot} .equip-item-cell`))]),
      ),
      nestedDesktopScroll,
      unequipButtons,
      mobileControls,
    };
  });
  if (!geometry) throw new Error(`Character window geometry unavailable at ${width}x${height}`);
  const {
    rect,
    viewport,
    mobileTouch,
    compactLandscape,
    horizontalOverflow,
    body,
    stage,
    bags,
    panels,
    leftEquip,
    rightEquip,
    topEquip,
    model,
    appearanceRow,
    specializationPanel,
    specializationAction,
    gatheringPanel,
    gatheringLast,
    leftEquipTargets,
    rightEquipTargets,
    topEquipTargets,
    appearanceTargets,
    leftSlotIds,
    rightSlotIds,
    desktopSlotBoxes,
    nestedDesktopScroll,
    unequipButtons,
    mobileControls,
  } = geometry;
  const outsideViewport =
    rect.left < -1 ||
    rect.top < -1 ||
    rect.right > viewport.width + 1 ||
    rect.bottom > viewport.height + 1;
  const emptyZone = [body, stage, bags, panels].some(
    (box) => !box || box.width <= 0 || box.height <= 0,
  );
  const containedByBody = [stage, bags, panels].every((box) => {
    if (!box || !body) return false;
    const horizontallyContained = box.left >= body.left - 1 && box.right <= body.right + 1;
    if (mobileTouch && width <= height) return horizontallyContained;
    return horizontallyContained && box.top >= body.top - 1 && box.bottom <= body.bottom + 1;
  });
  const landscapeColumnsOrdered =
    !mobileTouch ||
    width <= height ||
    (stage && bags && panels && stage.right <= bags.left + 1 && bags.right <= panels.left + 1);
  const desktopColumnsOrdered =
    mobileTouch ||
    (stage && bags && panels && stage.right <= panels.left + 1 && bags.right <= panels.left + 1);
  const frameWidth = rect.right - rect.left;
  const frameHeight = rect.bottom - rect.top;
  const fillsExpectedFrame = mobileTouch
    ? frameWidth >= viewport.width * 0.8 && frameHeight >= viewport.height * 0.85
    : Math.abs(frameWidth - Math.min(viewport.width * 0.9, 2400)) <= 3 &&
      Math.abs(frameHeight - Math.min(viewport.height * 0.9, 1350)) <= 3 &&
      Math.abs((rect.left + rect.right) / 2 - viewport.width / 2) <= 3 &&
      Math.abs((rect.top + rect.bottom) / 2 - viewport.height / 2) <= 3;
  const mobileTargetsValid =
    !mobileTouch ||
    mobileControls.every((control) => control && control.width >= 39.5 && control.height >= 39.5);
  const visibleEquipmentLayout = !mobileTouch || width > height;
  const contained = (container, target) =>
    container &&
    target &&
    target.left >= container.left - 1 &&
    target.right <= container.right + 1 &&
    target.top >= container.top - 1 &&
    target.bottom <= container.bottom + 1;
  const criticalPanelContentFits =
    mobileTouch ||
    (contained(specializationPanel, specializationAction) &&
      contained(gatheringPanel, gatheringLast));
  const centerX = (target) => (target.left + target.right) / 2;
  const centerY = (target) => (target.top + target.bottom) / 2;
  const desktopArcPairs = [
    ['neck', 'shoulder'],
    ['mainhand', 'waist'],
    ['chest', 'legs'],
    ['gloves', 'feet'],
    ['ring1', 'ring2'],
  ];
  const leftDesktopArc = ['neck', 'mainhand', 'chest', 'gloves', 'ring1'];
  const rightDesktopArc = ['shoulder', 'waist', 'legs', 'feet', 'ring2'];
  const desktopSlotsPresent = [...leftDesktopArc, ...rightDesktopArc].every(
    (slot) => desktopSlotBoxes[slot],
  );
  const verticallyOrdered = (slots) =>
    slots.every(
      (slot, index) =>
        index === 0 ||
        centerY(desktopSlotBoxes[slots[index - 1]]) < centerY(desktopSlotBoxes[slot]),
    );
  const verticallySpaced = (slots) =>
    slots.every(
      (slot, index) =>
        index === 0 || desktopSlotBoxes[slot].top - desktopSlotBoxes[slots[index - 1]].bottom >= 8,
    );
  const desktopUpperArcValid =
    mobileTouch ||
    compactLandscape ||
    (stage &&
      model &&
      desktopSlotsPresent &&
      centerX(desktopSlotBoxes.neck) < centerX(model) &&
      centerX(desktopSlotBoxes.shoulder) > centerX(model) &&
      desktopArcPairs.every(
        ([left, right]) =>
          Math.abs(
            centerX(desktopSlotBoxes[left]) + centerX(desktopSlotBoxes[right]) - 2 * centerX(stage),
          ) <= 3 &&
          Math.abs(centerY(desktopSlotBoxes[left]) - centerY(desktopSlotBoxes[right])) <= 3,
      ) &&
      verticallyOrdered(leftDesktopArc) &&
      verticallyOrdered(rightDesktopArc) &&
      verticallySpaced(leftDesktopArc) &&
      verticallySpaced(rightDesktopArc) &&
      centerX(desktopSlotBoxes.neck) > centerX(desktopSlotBoxes.mainhand) &&
      centerX(desktopSlotBoxes.mainhand) > centerX(desktopSlotBoxes.chest) &&
      Math.abs(centerX(desktopSlotBoxes.chest) - centerX(desktopSlotBoxes.gloves)) <= 3 &&
      Math.abs(centerX(desktopSlotBoxes.gloves) - centerX(desktopSlotBoxes.ring1)) <= 3 &&
      centerX(desktopSlotBoxes.shoulder) < centerX(desktopSlotBoxes.waist) &&
      centerX(desktopSlotBoxes.waist) < centerX(desktopSlotBoxes.legs) &&
      Math.abs(centerX(desktopSlotBoxes.legs) - centerX(desktopSlotBoxes.feet)) <= 3 &&
      Math.abs(centerX(desktopSlotBoxes.feet) - centerX(desktopSlotBoxes.ring2)) <= 3);
  const unequipControlsValid =
    !visibleEquipmentLayout ||
    (unequipButtons.length === 11 &&
      unequipButtons.every(
        (button) =>
          button.box &&
          button.box.width >= (mobileTouch ? 39.5 : 23.5) &&
          button.box.height >= (mobileTouch ? 39.5 : 23.5) &&
          button.opacity >= (mobileTouch ? 0.99 : 0.7) &&
          button.display !== 'none' &&
          button.visibility === 'visible' &&
          button.hitTarget === true &&
          button.nearOwnerCorner === true &&
          button.overlapsOtherSlot === false,
      ));
  const targetsInside = (container, targets) =>
    container &&
    targets.every(
      (target) =>
        target &&
        target.top >= container.top - 1 &&
        target.bottom <= container.bottom + 1 &&
        target.left >= container.left - 1 &&
        target.right <= container.right + 1,
    );
  const mobileEquipmentSplitValid =
    !mobileTouch ||
    width <= height ||
    (leftEquipTargets.length === 5 &&
      rightEquipTargets.length === 5 &&
      topEquipTargets.length === 1 &&
      appearanceTargets.length === 4 &&
      JSON.stringify(leftSlotIds) ===
        JSON.stringify(['neck', 'shoulder', 'chest', 'gloves', 'ring1']) &&
      JSON.stringify(rightSlotIds) ===
        JSON.stringify(['mainhand', 'waist', 'legs', 'feet', 'ring2']) &&
      targetsInside(leftEquip, leftEquipTargets) &&
      targetsInside(rightEquip, rightEquipTargets) &&
      targetsInside(topEquip, topEquipTargets) &&
      targetsInside(stage, appearanceTargets) &&
      targetsInside(appearanceRow, appearanceTargets) &&
      model &&
      leftEquip.right <= model.left + 1 &&
      rightEquip.left >= model.right - 1 &&
      Math.abs(
        (topEquipTargets[0].left + topEquipTargets[0].right) / 2 - (model.left + model.right) / 2,
      ) <= 3 &&
      topEquipTargets[0].bottom <= model.top + 4);
  if (
    outsideViewport ||
    horizontalOverflow ||
    emptyZone ||
    !containedByBody ||
    !landscapeColumnsOrdered ||
    !desktopColumnsOrdered ||
    !fillsExpectedFrame ||
    !mobileTargetsValid ||
    nestedDesktopScroll ||
    !desktopUpperArcValid ||
    !unequipControlsValid ||
    !mobileEquipmentSplitValid ||
    !criticalPanelContentFits
  ) {
    throw new Error(`Invalid character layout at ${width}x${height}: ${JSON.stringify(geometry)}`);
  }

  if (mobileTouch) {
    const scrollChecks = await page.evaluate(async () => {
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const check = async (scrollerSelector, targetSelector, axis = 'y') => {
        const scroller = document.querySelector(scrollerSelector);
        if (!(scroller instanceof HTMLElement)) return false;
        const targets = [...scroller.querySelectorAll(targetSelector)].filter(
          (target) => target instanceof HTMLElement,
        );
        if (!targets.length) return false;
        const edge = (target) => {
          const rect = target.getBoundingClientRect();
          return axis === 'x' ? rect.right : rect.bottom;
        };
        const last = targets.reduce((furthest, target) =>
          edge(target) > edge(furthest) ? target : furthest,
        );
        const contained = () => {
          const scrollerRect = scroller.getBoundingClientRect();
          const lastRect = last.getBoundingClientRect();
          return axis === 'x'
            ? lastRect.right <= scrollerRect.right + 1 && lastRect.left >= scrollerRect.left - 1
            : lastRect.bottom <= scrollerRect.bottom + 1 && lastRect.top >= scrollerRect.top - 1;
        };
        const scrollSize = axis === 'x' ? scroller.scrollWidth : scroller.scrollHeight;
        const clientSize = axis === 'x' ? scroller.clientWidth : scroller.clientHeight;
        if (scrollSize <= clientSize + 1) return contained();
        const previous = axis === 'x' ? scroller.scrollLeft : scroller.scrollTop;
        if (axis === 'x') scroller.scrollLeft = scroller.scrollWidth;
        else scroller.scrollTop = scroller.scrollHeight;
        await nextFrame();
        const reachable = contained();
        if (axis === 'x') scroller.scrollLeft = previous;
        else scroller.scrollTop = previous;
        return reachable;
      };
      return window.innerWidth > window.innerHeight
        ? {
            ownedBags: await check('.char-bags-selector', '.char-bags-tab-wrap', 'x'),
            bags: await check('.char-bags', '.char-bags-grid .item-cell'),
            panels: await check('.char-panels', '.char-panel'),
          }
        : {
            body: await check('.window-body', '#char-panels .char-panel'),
          };
    });
    if (!Object.values(scrollChecks).every(Boolean)) {
      throw new Error(
        `Character pane overflow is not reachable at ${width}x${height}: ${JSON.stringify(scrollChecks)}`,
      );
    }
  }

  await page.screenshot({ path: outPath });
  const fatalErrors = errors.filter((error) => error.startsWith('PAGEERROR:'));
  if (fatalErrors.length)
    throw new Error(`Browser errors at ${width}x${height}: ${fatalErrors.join(' | ')}`);
  if (errors.length)
    console.warn(`non-fatal browser diagnostics at ${width}x${height}: ${errors.length}`);
  console.log(`wrote ${outPath}`);
  await page.close();
}

const viewports = [
  { width: 1920, height: 1080, isMobile: false, name: 'desktop_1920x1080' },
  { width: 1454, height: 1088, isMobile: false, name: 'desktop_reference_1454x1088' },
  { width: 1440, height: 900, isMobile: false, name: 'desktop_1440x900' },
  { width: 1280, height: 720, isMobile: false, name: 'desktop_1280x720' },
  { width: 1024, height: 768, isMobile: false, name: 'desktop_1024x768' },
  { width: 390, height: 844, isMobile: true, name: 'mobile_portrait_390x844' },
  { width: 568, height: 375, isMobile: true, name: 'mobile_compact_landscape_568x375' },
  { width: 667, height: 375, isMobile: true, name: 'mobile_landscape_667x375' },
  { width: 844, height: 390, isMobile: true, name: 'mobile_landscape_844x390' },
  { width: 903, height: 431, isMobile: true, name: 'mobile_reference_903x431' },
  { width: 932, height: 430, isMobile: true, name: 'mobile_landscape_932x430' },
];

if (ONLY) {
  const knownNames = new Set(viewports.map(({ name }) => name));
  const unknownNames = ONLY.filter((name) => !knownNames.has(name));
  if (unknownNames.length) {
    throw new Error(`Unknown SHOT_ONLY viewport(s): ${unknownNames.join(', ')}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});

for (const viewport of viewports) {
  if (ONLY && !ONLY.includes(viewport.name)) continue;
  await shootAt(browser, {
    ...viewport,
    outPath: `tmp/${OUT_PREFIX}_${viewport.name}.png`,
  });
}

await browser.close();
