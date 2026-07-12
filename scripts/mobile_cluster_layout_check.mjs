// Deterministic geometry gate for the mobile HUD control clusters.
//
// The gate measures real browser boxes across the canonical viewport matrix,
// both handedness modes, scale extremes, safe areas, Consumables, and the
// optional camera joystick. It also samples the explicit camera start zone at
// a 3 x 3 grid and proves every sample is canvas-backed and router-eligible.
//
// Needs `npm run dev` running. URL overrides http://localhost:5173/.
// Screenshots land in tmp/mobile-cluster-layout/ (git-ignored).

import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { edgeGap, PROFILES, SAFE_AREA_VECTORS } from './lib/overlap_geometry.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const QUICK = process.env.QUICK === '1';
const PROFILE_SHOTS = process.env.PROFILE_SHOTS !== '0';
const SHOT_DIR = 'tmp/mobile-cluster-layout';
const TOUCH_FLOOR = 48;
const MIN_GAP = 4;
const EPSILON = 0.6;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const IGNORED_CONSOLE = /502|Bad Gateway|fetch project stats/i;

const ACTION_IDS = [
  'mobile-action-attack',
  'mobile-target-cycle',
  'mobile-action-page-toggle',
  'mobile-jump',
];
const COMPACT_MENU_IDS = ['mobile-chat', 'mobile-quest', 'mobile-more'];
const FULL_MENU_IDS = [
  'mobile-chat',
  'mobile-social',
  'mobile-quest',
  'mobile-menu',
  'mobile-more',
];
const ALL_MENU_IDS = [...new Set([...COMPACT_MENU_IDS, ...FULL_MENU_IDS])];
const SLOT_IDS = ['slot-0', 'slot-1', 'slot-2', 'slot-3', 'slot-4'];

const failures = [];
function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function center(rect) {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

function expectedCompactMenu(profile) {
  return profile.tier === 'hud-mobile-compact' || profile.h > profile.w;
}

async function flipViewport(page, cdp, profile) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: profile.w,
      height: profile.h,
      deviceScaleFactor: profile.dsf,
      mobile: true,
      screenWidth: profile.w,
      screenHeight: profile.h,
      positionX: 0,
      positionY: 0,
    });
    await cdp.send('Emulation.resetPageScaleFactor').catch(() => {});
    await sleep(150);
    const viewport = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
    if (Math.abs(viewport[0] - profile.w) <= 2 && Math.abs(viewport[1] - profile.h) <= 2) {
      break;
    }
    if (attempt === 3) {
      fail(
        `${profile.name}: viewport reports ${viewport[0]}x${viewport[1]} instead of ${profile.w}x${profile.h}`,
      );
    }
  }

  await page.evaluate(() => {
    document.body.classList.add('mobile-touch', 'game-active');
    window.dispatchEvent(new Event('resize'));
  });
  await sleep(400);
  await page.evaluate(() => document.body.classList.add('mobile-touch', 'game-active'));

  const settled = await page
    .waitForFunction(
      (tier) => {
        const attack = document.getElementById('mobile-action-attack');
        return (
          document.body.classList.contains(tier) &&
          !!attack &&
          attack.getBoundingClientRect().width > 0
        );
      },
      { timeout: 12000 },
      profile.tier,
    )
    .then(
      () => true,
      () => false,
    );
  if (!settled) fail(`${profile.name}: responsive tier or controls never settled`);
  await sleep(200);
}

async function applySafeArea(page, cdp, vector, tag) {
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: vector });
  } catch (error) {
    fail(`${tag}: safe-area emulation failed: ${String(error)}`);
    return;
  }
  const resolved = await page.evaluate(async () => {
    const probe = document.createElement('div');
    probe.style.cssText = [
      'position:fixed',
      'visibility:hidden',
      'pointer-events:none',
      'padding-top:env(safe-area-inset-top)',
      'padding-right:env(safe-area-inset-right)',
      'padding-bottom:env(safe-area-inset-bottom)',
      'padding-left:env(safe-area-inset-left)',
    ].join(';');
    document.body.append(probe);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const style = getComputedStyle(probe);
    const result = {
      top: Number.parseFloat(style.paddingTop),
      right: Number.parseFloat(style.paddingRight),
      bottom: Number.parseFloat(style.paddingBottom),
      left: Number.parseFloat(style.paddingLeft),
    };
    probe.remove();
    return result;
  });
  for (const side of ['top', 'right', 'bottom', 'left']) {
    if (!Number.isFinite(resolved[side]) || Math.abs(resolved[side] - vector[side]) > EPSILON) {
      fail(`${tag}: resolved safe-area ${side}=${resolved[side]}, expected ${vector[side]}`);
    }
  }
}

async function buildTopologyState(page) {
  const state = await page.evaluate(() => {
    const sim = window.__game.sim;
    const player = sim.player;
    const roster = [
      ['LayoutOak', 'druid'],
      ['LayoutStorm', 'shaman'],
      ['LayoutShade', 'rogue'],
      ['LayoutEmber', 'mage'],
    ];
    for (const [name, cls] of roster) {
      if ([...sim.entities.values()].some((entity) => entity.name === name)) continue;
      const pid = sim.addPlayer(cls, name);
      const entity = sim.entities.get(pid);
      if (entity) {
        entity.pos = { x: player.pos.x + 2, y: player.pos.y, z: player.pos.z + 2 };
        entity.prevPos = { ...entity.pos };
      }
      sim.partyInvite(pid);
      sim.partyAccept(pid);
    }
    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [id, entity] of sim.entities.entries()) {
      if (entity.kind !== 'mob' || !entity.hostile || entity.dead) continue;
      const distance = Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z);
      if (distance < nearestDistance) {
        nearest = id;
        nearestDistance = distance;
      }
    }
    if (nearest !== null) sim.targetEntity(nearest);
    window.__game.hud?.closeLootSettings?.();
    window.__game.hud?.update?.(0.05);
    return { party: sim.partyInfo?.members?.length ?? 0, target: nearest };
  });
  if (state.party < 5) fail(`topology state: party has ${state.party} member(s), expected 5`);
  if (state.target === null) fail('topology state: no hostile target found');
  await sleep(200);
}

async function applyHudState(page, descriptor) {
  await page.evaluate((state) => {
    const body = document.body;
    window.__game?.hud?.closeAll?.();
    window.__game?.hud?.closeLootSettings?.();
    body.classList.toggle('mobile-left-handed', state.leftHanded);
    body.classList.toggle('mobile-camera-joystick-on', state.cameraJoystick);
    body.classList.toggle('mobile-pet-active', state.petActive);
    body.classList.remove(
      'mobile-window-open',
      'mobile-more-open',
      'mobile-chat-open',
      'mobile-chat-reply',
    );
    document.documentElement.style.setProperty('--ui-scale', String(state.uiScale ?? 1));
    document.documentElement.style.setProperty('--tooltip-scale', String(state.tooltipScale ?? 1));

    const controls = document.getElementById('mobile-controls');
    controls?.style.setProperty('--btn-scale', String(state.buttonScale));
    controls?.style.setProperty('--joy-scale', String(state.joystickScale));

    const party = document.getElementById('party-frames');
    party?.classList.toggle('party-expanded', state.partyExpanded);

    const toggle = document.getElementById('mobile-consumables-toggle');
    const consumablesAreOpen = toggle?.getAttribute('aria-expanded') === 'true';
    if (toggle && consumablesAreOpen !== state.consumablesOpen) toggle.click();
    if (state.consumablesOpen) {
      for (const slot of document.querySelectorAll('.mobile-consumable-slot')) {
        slot.classList.remove('empty');
        slot.style.display = '';
      }
    }
    window.dispatchEvent(new Event('resize'));
  }, descriptor);
  await sleep(350);
  // The live painter may restore empty inventory classes. Geometry stress runs
  // intentionally populate all six fixed slots after that paint has settled.
  if (descriptor.consumablesOpen) {
    await page.evaluate(() => {
      for (const slot of document.querySelectorAll('.mobile-consumable-slot')) {
        slot.classList.remove('empty');
        slot.style.display = 'block';
      }
    });
    await sleep(50);
  }
}

async function collectLayout(page, inspection = {}) {
  return page.evaluate(
    async (actionIds, allMenuIds, tooltipInspection) => {
      const grab = (element) => {
        if (!element) return null;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return null;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          w: rect.width,
          h: rect.height,
          layoutW: element.offsetWidth,
          layoutH: element.offsetHeight,
        };
      };
      const grabForced = (element) => {
        if (!element) return null;
        const inlineDisplay = element.style.display;
        element.style.display = 'block';
        const rect = grab(element);
        element.style.display = inlineDisplay;
        return rect;
      };

      const controls = {};
      for (const id of actionIds) controls[id] = grab(document.getElementById(id));
      document.querySelectorAll('.mobile-action-slot').forEach((element) => {
        controls[`slot-${element.dataset.mobileIndex}`] = grab(element);
      });
      for (const id of allMenuIds) controls[id] = grab(document.getElementById(id));
      const consumablesToggle = document.getElementById('mobile-consumables-toggle');
      const consumableElements = Array.from(document.querySelectorAll('.mobile-consumable-slot'));
      controls['mobile-consumables-toggle'] = grab(consumablesToggle);
      consumableElements.forEach((element) => {
        controls[`consumable-${element.dataset.consumableIndex}`] = grab(element);
      });

      const consumablesToggleStyle = consumablesToggle
        ? getComputedStyle(consumablesToggle, '::before')
        : null;
      const consumablesToggleFace = consumablesToggleStyle
        ? {
            w: Number.parseFloat(consumablesToggleStyle.width),
            h: Number.parseFloat(consumablesToggleStyle.height),
          }
        : null;
      const consumableFaces = consumableElements.map((element) =>
        grab(element.querySelector('.icon-label')),
      );
      const cooldownOverlay = consumableElements[0]?.querySelector('.cd-overlay') ?? null;
      let consumableCooldownFace = null;
      if (cooldownOverlay) {
        const inlineHeight = cooldownOverlay.style.height;
        cooldownOverlay.style.height = '100%';
        consumableCooldownFace = grab(cooldownOverlay);
        cooldownOverlay.style.height = inlineHeight;
      }

      const mobileControls = document.getElementById('mobile-controls');
      const mobileControlsRect = mobileControls?.getBoundingClientRect() ?? null;
      const cameraStyle = mobileControls ? getComputedStyle(mobileControls, '::before') : null;
      const cameraLocal = cameraStyle
        ? {
            left: Number.parseFloat(cameraStyle.left),
            top: Number.parseFloat(cameraStyle.top),
            w: Number.parseFloat(cameraStyle.width),
            h: Number.parseFloat(cameraStyle.height),
          }
        : null;
      const camera =
        cameraLocal &&
        mobileControlsRect &&
        Object.values(cameraLocal).every((value) => Number.isFinite(value))
          ? {
              left: mobileControlsRect.left + cameraLocal.left,
              top: mobileControlsRect.top + cameraLocal.top,
              right: mobileControlsRect.left + cameraLocal.left + cameraLocal.w,
              bottom: mobileControlsRect.top + cameraLocal.top + cameraLocal.h,
              w: cameraLocal.w,
              h: cameraLocal.h,
            }
          : null;

      const cameraSamples = [];
      let menuBlocksCamera = false;
      if (camera) {
        const router = await import('/src/game/touch_router.ts');
        const xs = [camera.left + 0.5, (camera.left + camera.right) / 2, camera.right - 0.5];
        const ys = [camera.top + 0.5, (camera.top + camera.bottom) / 2, camera.bottom - 0.5];
        for (const y of ys) {
          for (const x of xs) {
            const target = document.elementFromPoint(x, y);
            cameraSamples.push({
              x,
              y,
              id: target instanceof Element ? target.id : '',
              tag: target instanceof Element ? target.tagName : '',
              className: target instanceof Element ? String(target.className) : '',
              canvas: target === document.getElementById('game-canvas'),
              allowed: router.isCameraDragAllowedAt(target, false),
            });
          }
        }
        menuBlocksCamera = !router.isCameraDragAllowedAt(
          document.getElementById('game-canvas'),
          true,
        );
      }

      const ring = document.getElementById('mobile-action-ring');
      const ringStyle = ring ? getComputedStyle(ring) : null;
      const face = (button) => {
        if (!button) return null;
        const buttonStyle = getComputedStyle(button);
        const pseudo = getComputedStyle(button, '::before');
        return {
          w: Number.parseFloat(pseudo.width),
          h: Number.parseFloat(pseudo.height),
          opacity: Number.parseFloat(buttonStyle.opacity),
          border: Number.parseFloat(pseudo.borderTopWidth),
        };
      };
      const attackButton = document.getElementById('mobile-action-attack');
      const attackWasQueued = attackButton?.classList.contains('queued') ?? false;
      attackButton?.classList.add('queued');
      const attackQueuedBefore = attackButton ? getComputedStyle(attackButton, '::before') : null;
      const attackQueuedAfter = attackButton ? getComputedStyle(attackButton, '::after') : null;
      const attackQueuedVisual =
        attackQueuedBefore && attackQueuedAfter
          ? {
              shadow: attackQueuedBefore.boxShadow,
              borderColor: attackQueuedBefore.borderTopColor,
              afterContent: attackQueuedAfter.content,
            }
          : null;
      if (!attackWasQueued) attackButton?.classList.remove('queued');
      const ids = [
        ...actionIds,
        ...allMenuIds,
        'mobile-consumables-toggle',
        'mobile-social',
        'mobile-menu',
      ];
      const duplicateCounts = Object.fromEntries(
        ids.map((id) => [id, document.querySelectorAll(`#${id}`).length]),
      );

      if (tooltipInspection.mobTooltip) {
        const game = window.__game;
        const mob = [...(game?.sim?.entities?.values?.() ?? [])].find(
          (entity) => entity.kind === 'mob' && entity.hostile && !entity.dead,
        );
        if (game?.hud && mob) {
          game.hud.showMobHoverTooltip(mob, new Set());
          if (tooltipInspection.longTooltip) {
            const tooltip = document.getElementById('tooltip');
            tooltip?.insertAdjacentHTML(
              'beforeend',
              Array.from(
                { length: 16 },
                (_, index) =>
                  `<div class="tt-quest-obj">Quest objective ${index + 1}: 123 / 999</div>`,
              ).join(''),
            );
          }
          game.hud.positionVisibleMobileMobTooltip();
        }
      }
      const tooltipElement = document.getElementById('tooltip');
      const tooltipStyle = tooltipElement ? getComputedStyle(tooltipElement) : null;

      return {
        controls,
        consumablesToggleFace,
        consumableFaces,
        consumableCooldownFace,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        tier: ['hud-mobile-compact', 'hud-mobile-standard', 'hud-mobile-tablet'].find((name) =>
          document.body.classList.contains(name),
        ),
        camera,
        cameraSamples,
        menuBlocksCamera,
        wrappers: {
          controlsPointerEvents: mobileControls
            ? getComputedStyle(mobileControls).pointerEvents
            : '',
          ringPointerEvents: ringStyle?.pointerEvents ?? '',
        },
        faces: {
          action: face(document.querySelector('.mobile-action-slot[data-mobile-index="0"]')),
          target: face(document.getElementById('mobile-target-cycle')),
          jump: face(document.getElementById('mobile-jump')),
          attack: face(document.getElementById('mobile-action-attack')),
          page: face(document.getElementById('mobile-action-page-toggle')),
        },
        attackQueuedVisual,
        tooltip: grab(tooltipElement),
        tooltipState: tooltipElement
          ? {
              mob: tooltipElement.classList.contains('mob-tooltip'),
              clipped: tooltipElement.classList.contains('mob-tooltip-clipped'),
              maxHeight: Number.parseFloat(tooltipStyle?.maxHeight ?? ''),
            }
          : null,
        map: grab(document.getElementById('minimap-wrap')),
        menu: grab(document.getElementById('mobile-combat-controls')),
        target: grab(document.getElementById('target-frame')),
        party: grab(document.getElementById('party-frames')),
        partyChip: grab(document.getElementById('party-chip')),
        partyChipFace: grab(document.querySelector('#party-chip .ui-icon')),
        moveZone: grab(document.getElementById('mobile-move-zone')),
        moveJoystick: grab(document.getElementById('mobile-move-joystick')),
        cameraJoystick: grab(document.getElementById('mobile-camera-joystick')),
        playerFrame: grab(document.getElementById('player-frame')),
        castbar: grabForced(document.getElementById('castbar')),
        swingbar: grabForced(document.getElementById('swingbar')),
        scales: {
          playerFrame: Number.parseFloat(
            getComputedStyle(document.body).getPropertyValue('--mobile-player-frame-scale'),
          ),
        },
        partyRows: Array.from(document.querySelectorAll('#party-frames .party-frame'))
          .map(grab)
          .filter(Boolean),
        parents: {
          social: document.getElementById('mobile-social')?.parentElement?.id ?? null,
          menu: document.getElementById('mobile-menu')?.parentElement?.id ?? null,
        },
        duplicateCounts,
        standaloneAutorun: !!document.getElementById('mobile-autorun'),
      };
    },
    ACTION_IDS,
    ALL_MENU_IDS,
    inspection,
  );
}

function checkIncreasing(tag, geometry, ids) {
  const centers = ids.map((id) => ({ id, point: center(geometry.controls[id]) }));
  for (let index = 1; index < centers.length; index++) {
    if (centers[index - 1].point.x >= centers[index].point.x - EPSILON) {
      fail(`${tag}: ${ids.join(' -> ')} is not ordered left-to-right`);
      return;
    }
  }
}

function checkSameRow(tag, geometry, ids) {
  const centers = ids.map((id) => ({ id, point: center(geometry.controls[id]) }));
  const expectedY = centers[0].point.y;
  for (const { point } of centers.slice(1)) {
    if (Math.abs(point.y - expectedY) > EPSILON) {
      fail(`${tag}: ${ids.join(' + ')} do not share one row`);
      return;
    }
  }
}

function checkVerticalPair(tag, geometry, upperId, lowerId, label) {
  const upper = center(geometry.controls[upperId]);
  const lower = center(geometry.controls[lowerId]);
  if (Math.abs(upper.x - lower.x) > EPSILON || upper.y >= lower.y) {
    fail(`${tag}: ${label} is not a top-to-bottom column`);
  }
}

function insideSafeArea(rect, viewport, safeArea) {
  return (
    rect.left >= safeArea.left - EPSILON &&
    rect.top >= safeArea.top - EPSILON &&
    rect.right <= viewport.w - safeArea.right + EPSILON &&
    rect.bottom <= viewport.h - safeArea.bottom + EPSILON
  );
}

function coordinateBucketCount(values) {
  const buckets = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    if (buckets.length === 0 || Math.abs(value - buckets[buckets.length - 1]) > EPSILON) {
      buckets.push(value);
    }
  }
  return buckets.length;
}

function checkLayout(tag, geometry, profile, state) {
  const compactMenu = expectedCompactMenu(profile);
  const menuIds = compactMenu ? COMPACT_MENU_IDS : FULL_MENU_IDS;
  const requiredIds = [...ACTION_IDS, ...SLOT_IDS, ...menuIds, 'mobile-consumables-toggle'];
  const safeArea = state.safeArea ?? SAFE_AREA_VECTORS.none;
  if (state.consumablesOpen) {
    requiredIds.push(...Array.from({ length: 6 }, (_, index) => `consumable-${index}`));
  }

  if (geometry.tier !== profile.tier) {
    fail(`${tag}: tier ${geometry.tier ?? 'missing'} instead of ${profile.tier}`);
  }
  if (geometry.standaloneAutorun) fail(`${tag}: standalone #mobile-autorun still exists`);
  for (const [id, count] of Object.entries(geometry.duplicateCounts)) {
    if (count !== 1) fail(`${tag}: #${id} count is ${count}, expected 1`);
  }

  const entries = [];
  for (const id of requiredIds) {
    const rect = geometry.controls[id];
    if (!rect) {
      fail(`${tag}: required #${id} is not measurable`);
      continue;
    }
    entries.push([id, rect]);
    if (
      rect.left < -EPSILON ||
      rect.top < -EPSILON ||
      rect.right > geometry.viewport.w + EPSILON ||
      rect.bottom > geometry.viewport.h + EPSILON
    ) {
      fail(`${tag}: #${id} leaves the ${geometry.viewport.w}x${geometry.viewport.h} viewport`);
    }
    if (!insideSafeArea(rect, geometry.viewport, safeArea)) {
      fail(`${tag}: #${id} enters the emulated safe-area inset`);
    }
    if (rect.w < TOUCH_FLOOR - EPSILON || rect.h < TOUCH_FLOOR - EPSILON) {
      fail(`${tag}: #${id} is ${rect.w.toFixed(1)}x${rect.h.toFixed(1)}, below ${TOUCH_FLOOR}px`);
    }
  }
  const consumablesToggle = geometry.controls['mobile-consumables-toggle'];
  if (
    !consumablesToggle ||
    Math.abs(consumablesToggle.layoutW - 48) > EPSILON ||
    Math.abs(consumablesToggle.layoutH - 48) > EPSILON ||
    !geometry.consumablesToggleFace ||
    Math.abs(geometry.consumablesToggleFace.w - 40) > EPSILON ||
    Math.abs(geometry.consumablesToggleFace.h - 40) > EPSILON
  ) {
    fail(`${tag}: Consumables toggle is not a 40px face inside an exact 48px hitbox`);
  }
  if (state.consumablesOpen) {
    const expectedFace = 40 * Math.min(1, Math.max(0.9, state.buttonScale));
    const slotRects = Array.from(
      { length: 6 },
      (_, index) => geometry.controls[`consumable-${index}`],
    );
    if (
      slotRects.some(
        (rect) =>
          !rect || Math.abs(rect.layoutW - 48) > EPSILON || Math.abs(rect.layoutH - 48) > EPSILON,
      )
    ) {
      fail(`${tag}: an open Consumables slot lost its exact 48px hitbox`);
    }
    if (
      geometry.consumableFaces.some(
        (rect) =>
          !rect || Math.abs(rect.w - expectedFace) > 1 || Math.abs(rect.h - expectedFace) > 1,
      )
    ) {
      fail(
        `${tag}: a Consumables face is not ${expectedFace.toFixed(0)}px at Button Size ${state.buttonScale}`,
      );
    }
    if (
      !geometry.consumableCooldownFace ||
      Math.abs(geometry.consumableCooldownFace.w - expectedFace) > 1 ||
      Math.abs(geometry.consumableCooldownFace.h - expectedFace) > 1
    ) {
      fail(
        `${tag}: Consumables cooldown overlay does not match the ${expectedFace.toFixed(0)}px face`,
      );
    }
  }

  if (
    !geometry.moveJoystick ||
    Math.abs(geometry.moveJoystick.layoutW - 116) > EPSILON ||
    Math.abs(geometry.moveJoystick.layoutH - 116) > EPSILON
  ) {
    fail(`${tag}: landscape movement wheel does not retain its 116px base box`);
  }
  const expectedMoveZoneWidth = Math.max(112, Math.min(geometry.viewport.w * 0.3, 132));
  const expectedMoveZoneHeight = Math.min(geometry.viewport.h * 0.36, 172);
  if (
    !geometry.moveZone ||
    Math.abs(geometry.moveZone.w - expectedMoveZoneWidth) > 1 ||
    Math.abs(geometry.moveZone.h - expectedMoveZoneHeight) > 1 ||
    (state.leftHanded
      ? Math.abs(geometry.viewport.w - geometry.moveZone.right) > EPSILON
      : Math.abs(geometry.moveZone.left) > EPSILON)
  ) {
    fail(
      `${tag}: movement capture zone changed from ${expectedMoveZoneWidth.toFixed(1)}x${expectedMoveZoneHeight.toFixed(1)}px or left its thumb side`,
    );
  }

  for (let left = 0; left < entries.length; left++) {
    for (let right = left + 1; right < entries.length; right++) {
      const gap = edgeGap(entries[left][1], entries[right][1]);
      if (gap < MIN_GAP - EPSILON) {
        fail(`${tag}: #${entries[left][0]} vs #${entries[right][0]} gap ${gap.toFixed(1)}px`);
      }
    }
  }

  if (compactMenu) {
    if (geometry.parents.social !== 'mobile-extra-grid') {
      fail(`${tag}: Social parent is ${geometry.parents.social}, expected mobile-extra-grid`);
    }
    if (geometry.parents.menu !== 'mobile-extra-grid') {
      fail(`${tag}: Settings parent is ${geometry.parents.menu}, expected mobile-extra-grid`);
    }
  } else {
    if (geometry.parents.social !== 'mobile-combat-controls') {
      fail(`${tag}: Social was not restored to the full menu`);
    }
    if (geometry.parents.menu !== 'mobile-combat-controls') {
      fail(`${tag}: Settings was not restored to the full menu`);
    }
  }

  if (state.leftHanded) {
    checkIncreasing(tag, geometry, ['mobile-target-cycle', 'slot-4', 'slot-1', 'slot-0']);
    checkIncreasing(tag, geometry, [
      'mobile-jump',
      'mobile-action-attack',
      'slot-3',
      'slot-2',
      'mobile-action-page-toggle',
    ]);
  } else {
    checkIncreasing(tag, geometry, ['slot-0', 'slot-1', 'slot-4', 'mobile-target-cycle']);
    checkIncreasing(tag, geometry, [
      'mobile-action-page-toggle',
      'slot-2',
      'slot-3',
      'mobile-action-attack',
      'mobile-jump',
    ]);
  }
  checkSameRow(tag, geometry, ['slot-0', 'slot-1', 'slot-4', 'mobile-target-cycle']);
  checkSameRow(tag, geometry, [
    'mobile-action-page-toggle',
    'slot-2',
    'slot-3',
    'mobile-action-attack',
    'mobile-jump',
  ]);
  checkVerticalPair(tag, geometry, 'slot-4', 'mobile-action-attack', 'A5/Attack');
  checkVerticalPair(tag, geometry, 'mobile-target-cycle', 'mobile-jump', 'Target/Jump/Use');

  const { action, target, jump, attack, page } = geometry.faces;
  if (![action, target, jump, attack, page].every(Boolean)) {
    fail(`${tag}: rendered action-face styles are unavailable`);
  } else {
    if (!(jump.w > target.w && target.w > action.w && action.w > attack.w && attack.w > page.w)) {
      fail(
        `${tag}: rendered face hierarchy is not Jump > Target > abilities > Attack > Page (${JSON.stringify(geometry.faces)})`,
      );
    }
    if (attack.opacity >= target.opacity - 0.01) {
      fail(
        `${tag}: Attack opacity ${attack.opacity} is not below Target opacity ${target.opacity}`,
      );
    }
    if ([action, target, jump, attack, page].some((face) => face.border < 1)) {
      fail(`${tag}: a rendered action face lost its visible border`);
    }
  }
  if (!geometry.attackQueuedVisual) {
    fail(`${tag}: queued Attack visual is unavailable`);
  } else {
    if (!geometry.attackQueuedVisual.shadow.includes('12px')) {
      fail(`${tag}: queued Attack lost its persistent face glow`);
    }
    if (geometry.attackQueuedVisual.afterContent !== 'none') {
      fail(`${tag}: queued Attack renders a detached ::after status marker`);
    }
  }

  if (!geometry.map || !geometry.menu) {
    fail(`${tag}: map or menu is not measurable`);
  } else if (state.leftHanded) {
    if (center(geometry.map).x < geometry.viewport.w / 2) fail(`${tag}: map did not mirror right`);
    if (center(geometry.menu).x > geometry.viewport.w / 2) fail(`${tag}: menu did not mirror left`);
  } else {
    if (center(geometry.map).x > geometry.viewport.w / 2) fail(`${tag}: map is not top-left`);
    if (center(geometry.menu).x < geometry.viewport.w / 2) fail(`${tag}: menu is not top-right`);
  }
  if (profile.tier === 'hud-mobile-compact' && profile.w > profile.h && geometry.map) {
    if (geometry.map.w < 80 - EPSILON || geometry.map.w > 85 + EPSILON) {
      fail(`${tag}: compact map width ${geometry.map.w.toFixed(1)}px is outside 80-85px`);
    }
  }
  if (state.mobTooltip) {
    if (!geometry.tooltip || !geometry.tooltipState?.mob || !geometry.map) {
      fail(`${tag}: transient mob tooltip is not measurable`);
    } else {
      const minimapGap = geometry.tooltip.top - geometry.map.bottom;
      if (Math.abs(minimapGap - 8) > 1) {
        fail(
          `${tag}: mob tooltip begins ${minimapGap.toFixed(1)}px below the minimap, expected 8px`,
        );
      }
      const desiredTooltipLeft = state.leftHanded
        ? geometry.map.right - geometry.tooltip.w
        : geometry.map.left;
      const expectedTooltipLeft = Math.max(
        8,
        Math.min(geometry.viewport.w - geometry.tooltip.w - 8, desiredTooltipLeft),
      );
      const handedAlignment = geometry.tooltip.left - expectedTooltipLeft;
      if (Math.abs(handedAlignment) > 1) {
        fail(
          `${tag}: mob tooltip handed-edge offset ${handedAlignment.toFixed(1)}px ` +
            `(map=${JSON.stringify(geometry.map)}, tooltip=${JSON.stringify(geometry.tooltip)})`,
        );
      }
      if (
        geometry.tooltip.left < 8 - EPSILON ||
        geometry.tooltip.right > geometry.viewport.w - 8 + EPSILON ||
        geometry.tooltip.bottom > geometry.viewport.h - 8 + EPSILON
      ) {
        fail(`${tag}: mob tooltip leaves its 8px viewport bounds`);
      }
      const tooltipObstacles = [
        ['party-frames', geometry.party],
        ['target-frame', geometry.target],
        ['move-joystick', geometry.moveJoystick],
        ['player-frame', geometry.playerFrame],
        ['camera-start', geometry.camera],
        ['consumables-toggle', geometry.controls['mobile-consumables-toggle']],
        ...Array.from({ length: 6 }, (_, index) => [
          `consumable-${index}`,
          geometry.controls[`consumable-${index}`],
        ]),
      ];
      for (const [id, obstacle] of tooltipObstacles) {
        if (!obstacle) continue;
        const gap = edgeGap(geometry.tooltip, obstacle);
        if (gap < MIN_GAP - EPSILON) {
          fail(
            `${tag}: mob tooltip vs #${id} gap ${gap.toFixed(1)}px ` +
              `(tooltip=${JSON.stringify(geometry.tooltip)}, obstacle=${JSON.stringify(obstacle)})`,
          );
        }
      }
      if (state.longTooltip && !geometry.tooltipState.clipped) {
        fail(`${tag}: deterministic long mob tooltip was not clipped`);
      }
    }
  }

  const topologyRects = [
    ['minimap-wrap', geometry.map],
    ['mobile-combat-controls', geometry.menu],
    ['target-frame', geometry.target],
    ['party-frames', geometry.party],
    ['mobile-move-joystick', geometry.moveJoystick],
    ['player-frame', geometry.playerFrame],
  ];
  for (const [id, rect] of topologyRects) {
    if (!rect) fail(`${tag}: topology #${id} is not measurable`);
    else if (!insideSafeArea(rect, geometry.viewport, safeArea)) {
      fail(`${tag}: topology #${id} enters the emulated safe-area inset`);
    }
  }

  if (geometry.map && geometry.moveJoystick && geometry.map.bottom > geometry.moveJoystick.top) {
    fail(`${tag}: minimap is not above the movement joystick`);
  }
  if (geometry.map && geometry.party) {
    const mapPartyGap = state.leftHanded
      ? geometry.map.left - geometry.party.right
      : geometry.party.left - geometry.map.right;
    if (mapPartyGap < 4 - EPSILON || mapPartyGap > 24 + EPSILON) {
      fail(`${tag}: Party gap beside the minimap is ${mapPartyGap.toFixed(1)}px`);
    }
    const expectedTop = Math.max(6, safeArea.top);
    if (Math.abs(geometry.party.top - expectedTop) > 1.5) {
      fail(
        `${tag}: party dock top ${geometry.party.top.toFixed(1)}px, expected ${expectedTop.toFixed(1)}px`,
      );
    }
  }
  if (!geometry.partyChip || !geometry.partyChipFace) {
    fail(`${tag}: Party disclosure hitbox or icon face is not measurable`);
  } else {
    if (Math.abs(geometry.partyChip.w - 40) > 1 || Math.abs(geometry.partyChip.h - 40) > 1) {
      fail(
        `${tag}: Party disclosure hitbox is ${geometry.partyChip.w.toFixed(1)}x${geometry.partyChip.h.toFixed(1)}px instead of 40x40px`,
      );
    }
    if (
      Math.abs(geometry.partyChipFace.w - 28) > 1 ||
      Math.abs(geometry.partyChipFace.h - 28) > 1
    ) {
      fail(
        `${tag}: Party disclosure face is ${geometry.partyChipFace.w.toFixed(1)}x${geometry.partyChipFace.h.toFixed(1)}px instead of 28x28px`,
      );
    }
  }
  if (geometry.target) {
    const expectedCenter = geometry.viewport.w / 2 + (safeArea.left - safeArea.right) / 2;
    const targetOffset = Math.abs(center(geometry.target).x - expectedCenter);
    if (targetOffset > 1.5) {
      fail(`${tag}: target frame is ${targetOffset.toFixed(1)}px off safe center`);
    }
    const expectedTop = Math.max(6, safeArea.top) + 48;
    if (Math.abs(geometry.target.top - expectedTop) > 1.5) {
      fail(
        `${tag}: target frame top ${geometry.target.top.toFixed(1)}px, expected ${expectedTop.toFixed(1)}px`,
      );
    }
    if (geometry.party && geometry.target.top < geometry.party.bottom + 4 - EPSILON) {
      fail(`${tag}: target frame does not clear the Party row`);
    }
  }
  if (geometry.target && geometry.playerFrame) {
    if (geometry.target.w >= geometry.playerFrame.w) {
      fail(
        `${tag}: target frame width ${geometry.target.w.toFixed(1)}px is not smaller than player frame ${geometry.playerFrame.w.toFixed(1)}px`,
      );
    }
    const targetScale = geometry.target.w / geometry.target.layoutW;
    const playerScale = geometry.playerFrame.w / geometry.playerFrame.layoutW;
    const renderedTierRatio = targetScale / playerScale;
    if (renderedTierRatio < 0.86 - EPSILON / 100 || renderedTierRatio > 0.9 + EPSILON / 100) {
      fail(
        `${tag}: rendered Target tier ratio ${renderedTierRatio.toFixed(3)} is outside 0.86-0.90`,
      );
    }
  }
  if (state.cameraJoystick) {
    if (!geometry.cameraJoystick) {
      fail(`${tag}: enabled view joystick is not measurable`);
    } else if (state.leftHanded) {
      const expectedInset = Math.max(30, safeArea.left + 12);
      if (center(geometry.cameraJoystick).x >= geometry.viewport.w / 2) {
        fail(`${tag}: view joystick did not mirror to the left view side`);
      } else if (Math.abs(geometry.cameraJoystick.left - expectedInset) > 1) {
        fail(`${tag}: left view joystick inset is not ${expectedInset}px`);
      }
    } else {
      const expectedInset = Math.max(30, safeArea.right + 12);
      if (center(geometry.cameraJoystick).x <= geometry.viewport.w / 2) {
        fail(`${tag}: view joystick is not on the right view side`);
      } else if (
        Math.abs(geometry.viewport.w - geometry.cameraJoystick.right - expectedInset) > 1
      ) {
        fail(`${tag}: right view joystick inset is not ${expectedInset}px`);
      }
    }
  }
  if (geometry.playerFrame) {
    const expectedCenter = geometry.viewport.w / 2 + (safeArea.left - safeArea.right) / 2;
    const offset = Math.abs(center(geometry.playerFrame).x - expectedCenter);
    if (offset > 1.5) fail(`${tag}: player frame is ${offset.toFixed(1)}px off safe center`);
    const expectedScale = {
      'hud-mobile-compact': 0.72,
      'hud-mobile-standard': 1,
      'hud-mobile-tablet': 1.1,
    }[profile.tier];
    if (Math.abs(geometry.scales.playerFrame - expectedScale) > 0.01) {
      fail(`${tag}: player-frame scale ${geometry.scales.playerFrame}, expected ${expectedScale}`);
    }
    const minimumWidth = {
      'hud-mobile-compact': 180,
      'hud-mobile-standard': 250,
      'hud-mobile-tablet': 275,
    }[profile.tier];
    if (
      Math.abs((state.uiScale ?? 1) - 1) < 0.01 &&
      geometry.playerFrame.w < minimumWidth - EPSILON
    ) {
      fail(
        `${tag}: player frame width ${geometry.playerFrame.w.toFixed(1)}px is below the ${minimumWidth}px ${profile.tier} floor`,
      );
    }
    for (const [id, bar] of [
      ['castbar', geometry.castbar],
      ['swingbar', geometry.swingbar],
    ]) {
      if (!bar) {
        fail(`${tag}: forced #${id} geometry is unavailable`);
        continue;
      }
      const barOffset = Math.abs(center(bar).x - expectedCenter);
      if (barOffset > 1.5) fail(`${tag}: #${id} is ${barOffset.toFixed(1)}px off safe center`);
      if (Math.abs(bar.w - geometry.playerFrame.w) > 1.5) {
        fail(
          `${tag}: #${id} width ${bar.w.toFixed(1)}px does not match player frame ${geometry.playerFrame.w.toFixed(1)}px`,
        );
      }
    }
    if (geometry.castbar) {
      const castGap = geometry.playerFrame.top - geometry.castbar.bottom;
      if (Math.abs(castGap - 4) > 1.5) {
        fail(`${tag}: castbar/player gap is ${castGap.toFixed(1)}px instead of 4px`);
      }
    }
    if (geometry.castbar && geometry.swingbar) {
      const swingGap = geometry.castbar.top - geometry.swingbar.bottom;
      if (Math.abs(swingGap - 3) > 1.5) {
        fail(`${tag}: swingbar/castbar gap is ${swingGap.toFixed(1)}px instead of 3px`);
      }
    }
  }
  if (state.partyExpanded) {
    if (geometry.partyRows.length !== 4) {
      fail(`${tag}: expanded party exposes ${geometry.partyRows.length} member row(s), expected 4`);
    } else if (coordinateBucketCount(geometry.partyRows.map((row) => center(row).y)) !== 1) {
      fail(`${tag}: expanded party members are not in one horizontal row`);
    }
  }
  if (state.consumablesOpen) {
    const slots = Array.from({ length: 6 }, (_, index) => geometry.controls[`consumable-${index}`]);
    if (slots.every(Boolean)) {
      const xs = slots.map((rect) => center(rect).x);
      const ys = slots.map((rect) => center(rect).y);
      const toggle = geometry.controls['mobile-consumables-toggle'];
      if (profile.tier === 'hud-mobile-compact') {
        if (coordinateBucketCount(xs) !== 3 || coordinateBucketCount(ys) !== 2) {
          fail(`${tag}: compact Consumables do not render as a 3 x 2 grid`);
        }
        const expectedToggleBottom = geometry.viewport.h - safeArea.bottom - 68;
        if (Math.abs(toggle.bottom - expectedToggleBottom) > EPSILON) {
          fail(`${tag}: compact Consumables toggle left its low thumb-side seat`);
        }
        if (Math.max(...slots.map((rect) => rect.bottom)) > toggle.bottom + EPSILON) {
          fail(`${tag}: compact Consumables extend below their low disclosure`);
        }
        const movementGap = state.leftHanded
          ? geometry.moveZone.left - toggle.right
          : toggle.left - geometry.moveZone.right;
        const expectedMovementGap = MIN_GAP + (state.leftHanded ? safeArea.right : safeArea.left);
        if (Math.abs(movementGap - expectedMovementGap) > EPSILON) {
          fail(
            `${tag}: compact Consumables toggle gap is ${movementGap.toFixed(1)}px, expected ${expectedMovementGap.toFixed(1)}px`,
          );
        }
        if (state.leftHanded) {
          if (toggle.left - Math.max(...slots.map((rect) => rect.right)) < MIN_GAP - EPSILON) {
            fail(`${tag}: mirrored compact Consumables do not expand left toward the hero frame`);
          }
          if (
            Math.abs(center(slots[0]).y - center(slots[1]).y) > EPSILON ||
            center(slots[0]).x <= center(slots[1]).x
          ) {
            fail(`${tag}: mirrored compact Consumables do not fill leftward before wrapping up`);
          }
        } else {
          if (Math.min(...slots.map((rect) => rect.left)) - toggle.right < MIN_GAP - EPSILON) {
            fail(`${tag}: compact Consumables do not expand right toward the hero frame`);
          }
          if (
            Math.abs(center(slots[0]).y - center(slots[1]).y) > EPSILON ||
            center(slots[0]).x >= center(slots[1]).x
          ) {
            fail(`${tag}: compact Consumables do not fill rightward before wrapping up`);
          }
        }
        const lowerRow = slots.slice(0, 3).map((rect) => center(rect).y);
        const upperRow = slots.slice(3).map((rect) => center(rect).y);
        if (
          coordinateBucketCount(lowerRow) !== 1 ||
          coordinateBucketCount(upperRow) !== 1 ||
          upperRow[0] >= lowerRow[0] - EPSILON
        ) {
          fail(`${tag}: items 1-3 are not below items 4-6 in compact Consumables`);
        }
        for (const [chromeId, chrome] of [
          ['player-frame', geometry.playerFrame],
          ['castbar', geometry.castbar],
          ['swingbar', geometry.swingbar],
        ]) {
          if (!chrome) continue;
          for (const [index, slot] of slots.entries()) {
            const gap = edgeGap(slot, chrome);
            if (gap < -EPSILON) {
              fail(
                `${tag}: compact Consumables slot ${index} overlaps #${chromeId} by ${Math.abs(gap).toFixed(1)}px`,
              );
            }
          }
        }
      } else {
        if (coordinateBucketCount(xs) !== 3 || coordinateBucketCount(ys) !== 2) {
          fail(`${tag}: Consumables do not render as a 3 x 2 grid`);
        }
        if (
          Math.max(...slots.map((rect) => rect.bottom)) > toggle.bottom + EPSILON ||
          Math.min(...ys) >= center(toggle).y - EPSILON
        ) {
          fail(`${tag}: Consumables do not keep one row above the toggle baseline`);
        }
        if (state.leftHanded) {
          if (Math.max(...xs) >= center(toggle).x - EPSILON) {
            fail(`${tag}: mirrored Consumables do not expand inward-left`);
          }
        } else if (Math.min(...xs) <= center(toggle).x + EPSILON) {
          fail(`${tag}: Consumables do not expand inward-right`);
        }
      }
    }
  }

  if (geometry.wrappers.controlsPointerEvents !== 'none') {
    fail(`${tag}: #mobile-controls intercepts camera input`);
  }
  if (geometry.wrappers.ringPointerEvents !== 'none') {
    fail(`${tag}: #mobile-action-ring intercepts camera input`);
  }

  if (!geometry.camera) {
    fail(`${tag}: camera probe is unavailable`);
  } else {
    const padTop = Math.min(
      ...[...ACTION_IDS, ...SLOT_IDS].map((id) => geometry.controls[id]?.top ?? Infinity),
    );
    if (geometry.camera.bottom > padTop + EPSILON) {
      fail(`${tag}: camera zone is not above the action pad`);
    }
    if (state.leftHanded) {
      if (center(geometry.camera).x >= geometry.viewport.w / 2) {
        fail(`${tag}: camera zone did not mirror to the action-side left`);
      }
    } else if (center(geometry.camera).x <= geometry.viewport.w / 2) {
      fail(`${tag}: camera zone is not on the action-side right`);
    }
    if (!insideSafeArea(geometry.camera, geometry.viewport, safeArea)) {
      fail(`${tag}: camera zone enters the emulated safe-area inset`);
    }
    const portrait = profile.h > profile.w;
    const expectedWidth = portrait
      ? Math.min(profile.w * 0.42, 160)
      : Math.min(profile.w * 0.3, 220);
    const expectedHeight = portrait
      ? Math.min(profile.h * 0.24, 200)
      : Math.min(profile.h * 0.24, 100);
    if (geometry.camera.w < expectedWidth - EPSILON) {
      fail(
        `${tag}: camera width ${geometry.camera.w.toFixed(1)}px < ${expectedWidth.toFixed(1)}px`,
      );
    }
    if (geometry.camera.h < expectedHeight - EPSILON) {
      fail(
        `${tag}: camera height ${geometry.camera.h.toFixed(1)}px < ${expectedHeight.toFixed(1)}px`,
      );
    }
    for (const sample of geometry.cameraSamples) {
      if (!sample.canvas || !sample.allowed) {
        fail(
          `${tag}: camera sample ${sample.x.toFixed(1)},${sample.y.toFixed(1)} hit ${sample.tag || 'unknown'}#${sample.id || ''}.${sample.className || ''} (allowed=${sample.allowed})`,
        );
      }
    }
    if (!geometry.menuBlocksCamera)
      fail(`${tag}: router permits camera start while a menu is open`);
  }
}

async function verifyMobTooltipInvalidation(page, tag) {
  const result = await page.evaluate(async () => {
    const game = window.__game;
    const hud = game?.hud;
    const mob = [...(game?.sim?.entities?.values?.() ?? [])].find(
      (entity) => entity.kind === 'mob' && entity.hostile && !entity.dead,
    );
    const tooltip = document.getElementById('tooltip');
    const map = document.getElementById('minimap-wrap');
    if (!hud || !mob || !tooltip || !map) return null;
    const originalClear = hud.clearMobHoverTooltip;
    const settle = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const read = () => {
      const tooltipRect = tooltip.getBoundingClientRect();
      const mapRect = map.getBoundingClientRect();
      return {
        tooltip: {
          left: tooltipRect.left,
          right: tooltipRect.right,
          top: tooltipRect.top,
          bottom: tooltipRect.bottom,
          w: tooltipRect.width,
          layoutW: tooltip.offsetWidth,
          inlineLeft: tooltip.style.left,
        },
        map: {
          left: mapRect.left,
          right: mapRect.right,
          bottom: mapRect.bottom,
        },
        clipped: tooltip.classList.contains('mob-tooltip-clipped'),
        fontSize: Number.parseFloat(getComputedStyle(tooltip).fontSize),
        innerWidth: window.innerWidth,
        uiZoom: getComputedStyle(document.getElementById('ui')).zoom,
      };
    };
    hud.clearMobHoverTooltip = () => {};
    try {
      document.body.classList.remove('mobile-left-handed', 'mobile-consumables-open');
      document.documentElement.style.setProperty('--ui-scale', '1');
      document.documentElement.style.setProperty('--tooltip-scale', '1');
      hud.lastMobTooltipId = null;
      hud.showMobHoverTooltip(mob, new Set());
      tooltip.insertAdjacentHTML(
        'beforeend',
        Array.from(
          { length: 16 },
          (_, index) => `<div class="tt-quest-obj">Stable objective ${index + 1}: 1 / 999</div>`,
        ).join(''),
      );
      hud.positionVisibleMobileMobTooltip();
      const right = read();

      document.body.classList.add('mobile-left-handed');
      await settle();
      const left = read();

      document.documentElement.style.setProperty('--tooltip-scale', '1.5');
      await settle();
      const scaled = read();
      return { right, left, scaled };
    } finally {
      hud.clearMobHoverTooltip = originalClear;
      document.body.classList.remove('mobile-left-handed', 'mobile-consumables-open');
      document.documentElement.style.setProperty('--ui-scale', '1');
      document.documentElement.style.setProperty('--tooltip-scale', '1');
      originalClear.call(hud);
    }
  });
  if (!result) {
    fail(`${tag}: same-content mob tooltip invalidation fixture is unavailable`);
    return;
  }
  const expectedRightLeft = Math.max(8, result.right.map.left);
  const expectedLeftLeft = Math.max(
    8,
    Math.min(740 - result.left.tooltip.w - 8, result.left.map.right - result.left.tooltip.w),
  );
  const expectedScaledLeft = Math.max(
    8,
    Math.min(740 - result.scaled.tooltip.w - 8, result.scaled.map.right - result.scaled.tooltip.w),
  );
  if (Math.abs(result.right.tooltip.left - expectedRightLeft) > 1) {
    fail(`${tag}: initial right-handed mob tooltip placement is wrong`);
  }
  if (Math.abs(result.left.tooltip.left - expectedLeftLeft) > 1) {
    fail(`${tag}: unchanged mob tooltip did not mirror after handedness changed`);
  }
  if (
    Math.abs(result.scaled.tooltip.left - expectedScaledLeft) > 1 ||
    result.scaled.fontSize <= result.left.fontSize
  ) {
    fail(
      `${tag}: unchanged mob tooltip did not reposition after tooltip scale changed ` +
        JSON.stringify({ left: result.left, scaled: result.scaled }),
    );
  }
  if (!result.right.clipped || !result.left.clipped || !result.scaled.clipped) {
    fail(`${tag}: long same-content mob tooltip lost its clipped state during invalidation`);
  }
}

async function verifyCompactMoreFlow(page, tag) {
  await page.click('#mobile-more');
  const opened = await page
    .waitForFunction(() => document.body.classList.contains('mobile-more-open'), {
      timeout: 3000,
    })
    .then(
      () => true,
      () => false,
    );
  if (!opened) {
    fail(`${tag}: compact More tray did not open`);
    return;
  }

  let trayActionsHit = true;
  for (const id of ['mobile-social', 'mobile-menu']) {
    const hit = await page.$eval(`#${id}`, (button) => {
      const rect = button.getBoundingClientRect();
      const target = document.elementFromPoint(
        (rect.left + rect.right) / 2,
        (rect.top + rect.bottom) / 2,
      );
      return {
        ok: target === button || target?.closest('button') === button,
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        parent: button.parentElement?.id ?? 'none',
        display: getComputedStyle(button).display,
        visibility: getComputedStyle(button).visibility,
        target: target
          ? `${target.tagName.toLowerCase()}#${target.id}.${target.className}`
          : 'none',
      };
    });
    if (!hit.ok) {
      trayActionsHit = false;
      fail(
        `${tag}: compact More #${id} center is not hit-testable ` +
          `(rect=${JSON.stringify(hit.rect)}, parent=${hit.parent}, display=${hit.display}, ` +
          `visibility=${hit.visibility}, target=${hit.target})`,
      );
    }
  }
  if (!trayActionsHit) return;

  await page.click('#mobile-social');
  const socialOpened = await page
    .waitForFunction(
      () => {
        const element = document.getElementById('social-window');
        return !!element && getComputedStyle(element).display !== 'none';
      },
      { timeout: 3000 },
    )
    .then(
      () => true,
      () => false,
    );
  if (!socialOpened) fail(`${tag}: compact More Social action did not open Social`);
  await page.evaluate(() => window.__game.hud.closeAll?.());

  await page.click('#mobile-more');
  await page.waitForFunction(() => document.body.classList.contains('mobile-more-open'));
  await page.click('#mobile-menu');
  const settingsOpened = await page
    .waitForFunction(
      () => {
        const element = document.getElementById('options-menu');
        return !!element && getComputedStyle(element).display !== 'none';
      },
      { timeout: 3000 },
    )
    .then(
      () => true,
      () => false,
    );
  if (!settingsOpened) fail(`${tag}: compact More Settings action did not open Options`);
  await page.evaluate(() => window.__game.hud.closeAll?.());
}

async function verifyMobileActionPageFlow(page, tag) {
  await page.evaluate(() => {
    const hud = window.__game?.hud;
    if (hud?.hotbarActions) {
      hud.hotbarActions[15] = { type: 'ability', id: 'heroic_strike' };
      hud.mobileActionPage = 0;
      hud.update(0.05);
    }
  });
  await sleep(100);
  const pages = [];
  for (let step = 0; step < 5; step++) {
    pages.push(
      await page.$eval('.mobile-action-page-indicator', (indicator) => {
        const match = indicator.textContent?.match(/\d+/);
        return match ? Number(match[0]) : Number.NaN;
      }),
    );
    if (step < 4) {
      const previous = pages[pages.length - 1];
      await page.$eval('#mobile-action-page-toggle', (button) => button.click());
      await page.waitForFunction(
        (last) => {
          const text = document.querySelector('.mobile-action-page-indicator')?.textContent ?? '';
          const match = text.match(/\d+/);
          return !!match && Number(match[0]) !== last;
        },
        { timeout: 2000 },
        previous,
      );
    }
  }
  const firstCycle = [...pages.slice(0, 4)].sort((left, right) => left - right);
  if (firstCycle.join(',') !== '1,2,3,4' || pages[4] !== pages[0]) {
    fail(`${tag}: mobile action pages cycled as ${pages.join(' -> ')} instead of 1 -> 2 -> 3 -> 4`);
  }
}

async function verifySpellbookPickerFlow(page, tag) {
  const abilityId = await page.evaluate(() => {
    const game = window.__game;
    const ability = game.sim.known[0]?.def.id;
    if (!ability) return null;
    game.hud.hotbarActions = Array.from({ length: 22 }, () => null);
    game.hud.hotbarActions[0] = { type: 'ability', id: ability };
    game.hud.mobileActionPage = 0;
    game.hud.toggleSpellbook();
    return ability;
  });
  if (!abilityId) {
    fail(`${tag}: no learned ability available for Spellbook picker flow`);
    return;
  }
  await page.waitForSelector(`#spellbook .spell-assignment-chip[data-ability-id="${abilityId}"]`);
  await page.$eval(`#spellbook .spell-row[data-ability-id="${abilityId}"]`, (row) => row.focus());
  const closedPickerDescription = await page
    .waitForFunction(
      () => {
        const tooltip = document.getElementById('tooltip');
        return (
          !!tooltip &&
          getComputedStyle(tooltip).display !== 'none' &&
          tooltip.getBoundingClientRect().height > 0
        );
      },
      { timeout: 2000 },
    )
    .then(
      () => true,
      () => false,
    );
  if (!closedPickerDescription)
    fail(`${tag}: Spellbook description is unavailable with picker closed`);
  await page.evaluate(() => window.__game.hud.hideTooltip());
  for (let pageIndex = 0; pageIndex < 4; pageIndex++) {
    if (pageIndex === 3) {
      await page.evaluate((targetIndex) => {
        window.__game.hud.hotbarActions[targetIndex] = {
          type: 'item',
          id: 'minor_healing_potion',
        };
      }, pageIndex * 5);
    }
    await page.$eval(
      `#spellbook .spell-assignment-chip[data-ability-id="${abilityId}"]`,
      (button) => button.click(),
    );
    await page.waitForSelector('#spellbook .spell-slot-picker');
    await page.$$eval(
      '#spellbook .spell-slot-picker [role="tab"]',
      (tabs, index) => {
        tabs[index]?.click();
      },
      pageIndex,
    );
    await page.waitForFunction(
      (index) =>
        document
          .querySelectorAll('#spellbook .spell-slot-picker [role="tab"]')
          [index]?.getAttribute('aria-selected') === 'true',
      { timeout: 2000 },
      pageIndex,
    );
    await page.$eval('#spellbook .spell-slot-destination', (button) => button.click());
    await page.waitForSelector('#spellbook .spell-slot-picker', { hidden: true });
    const result = await page.evaluate(
      ({ id, targetIndex }) => ({
        target: window.__game.hud.hotbarActions[targetIndex],
        copies: window.__game.hud.hotbarActions.filter(
          (action) => action?.type === 'ability' && action.id === id,
        ).length,
        page: window.__game.hud.mobileActionPage,
      }),
      { id: abilityId, targetIndex: pageIndex * 5 },
    );
    if (result.target?.id !== abilityId || result.copies !== 1 || result.page !== pageIndex) {
      fail(`${tag}: picker assignment failed on page ${pageIndex + 1}: ${JSON.stringify(result)}`);
    }
  }

  const actionChrome = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        chrome: {
          borderWidth: style.borderWidth,
          borderRadius: style.borderRadius,
          backgroundImage: style.backgroundImage,
        },
        text: element.textContent?.trim() ?? '',
        hasIcon: Boolean(element.querySelector('.ui-icon')),
        hasEquippedCheck: Boolean(element.querySelector('.spell-equipped-check')),
        width: rect.width,
        height: rect.height,
      };
    };
    const spellbook = document.getElementById('spellbook');
    const spellbookStyle = spellbook ? getComputedStyle(spellbook) : null;
    return {
      add: read('#spellbook .spell-hotbar-add'),
      remove: read('#spellbook .spell-hotbar-remove'),
      chip: read('#spellbook .spell-assignment-chip'),
      paddingTop: spellbookStyle?.paddingTop ?? '',
      paddingBottom: spellbookStyle?.paddingBottom ?? '',
    };
  });
  if (
    !actionChrome.add ||
    !actionChrome.remove ||
    !actionChrome.chip ||
    JSON.stringify(actionChrome.add.chrome) !== JSON.stringify(actionChrome.remove.chrome) ||
    JSON.stringify(actionChrome.add.chrome) !== JSON.stringify(actionChrome.chip.chrome)
  ) {
    fail(`${tag}: Spellbook Add/Remove/chip chrome differs: ${JSON.stringify(actionChrome)}`);
  }
  if (
    actionChrome.add?.text !== '+' ||
    !actionChrome.remove?.hasIcon ||
    actionChrome.chip?.hasEquippedCheck ||
    actionChrome.remove?.width !== 40 ||
    actionChrome.remove?.height !== 40
  ) {
    fail(`${tag}: Spellbook compact touch symbols differ: ${JSON.stringify(actionChrome)}`);
  }
  if (actionChrome.paddingTop !== '8px' || actionChrome.paddingBottom !== '8px') {
    fail(`${tag}: Spellbook edge padding differs: ${JSON.stringify(actionChrome)}`);
  }

  const fullBarAbility = await page.evaluate(() => {
    const game = window.__game;
    const id = game.sim.known.find((known) => known.def.id !== game.hud.hotbarActions[15]?.id)?.def
      .id;
    if (!id) return null;
    game.hud.hotbarActions = Array.from({ length: 22 }, () => ({
      type: 'item',
      id: 'minor_healing_potion',
    }));
    game.hud.update(0.05);
    return id;
  });
  if (!fullBarAbility) fail(`${tag}: no second learned ability available for full-bar Add`);
  else {
    await page.waitForSelector(`#spellbook .spell-hotbar-add[data-ability-id="${fullBarAbility}"]`);
    await page.$eval('#spellbook', (spellbook) => {
      spellbook.scrollTop = spellbook.scrollHeight;
    });
    await page.tap(`#spellbook .spell-hotbar-add[data-ability-id="${fullBarAbility}"]`);
    await page.waitForSelector('#spellbook .spell-slot-picker');
    const tooltipVisible = await page.$eval(
      '#tooltip',
      (tooltip) =>
        getComputedStyle(tooltip).display !== 'none' && tooltip.getBoundingClientRect().height > 0,
    );
    if (tooltipVisible) fail(`${tag}: ability description tooltip opened after touch Add`);
    const visibleDescriptions = await page.$$eval(
      '#spellbook .spell-row .spell-sub',
      (rows) =>
        rows.filter((row) => {
          const style = getComputedStyle(row);
          const rect = row.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0;
        }).length,
    );
    if (visibleDescriptions !== 0) {
      fail(
        `${tag}: ${visibleDescriptions} Spellbook description(s) remain visible while picker is open`,
      );
    }
    const stickyStack = await page.evaluate(() => {
      const spellbook = document.getElementById('spellbook');
      const title = spellbook?.querySelector('.panel-title');
      const picker = spellbook?.querySelector('.spell-slot-picker');
      if (!spellbook || !title || !picker) return null;
      const windowRect = spellbook.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const pickerRect = picker.getBoundingClientRect();
      return {
        windowTop: windowRect.top,
        titleBottom: titleRect.bottom,
        pickerTop: pickerRect.top,
        firstControlTop:
          picker.querySelector('button')?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
        pickerBottom: pickerRect.bottom,
        windowBottom: windowRect.bottom,
        rootScrollTop: spellbook.scrollTop,
        viewportBottom: window.innerHeight,
        closeTop:
          spellbook.querySelector('[data-close]')?.getBoundingClientRect().top ??
          Number.NEGATIVE_INFINITY,
      };
    });
    if (!stickyStack) fail(`${tag}: Spellbook sticky stack geometry is missing`);
    else {
      if (stickyStack.pickerTop + EPSILON < stickyStack.titleBottom) {
        fail(
          `${tag}: Spellbook picker starts at ${stickyStack.pickerTop}, under title bottom ${stickyStack.titleBottom}`,
        );
      }
      if (stickyStack.pickerTop - stickyStack.titleBottom > 1 + EPSILON) {
        fail(
          `${tag}: Spellbook title/picker gap is ${stickyStack.pickerTop - stickyStack.titleBottom}px`,
        );
      }
      if (stickyStack.firstControlTop - stickyStack.pickerTop > 2 + EPSILON) {
        fail(
          `${tag}: Spellbook picker retains ${stickyStack.firstControlTop - stickyStack.pickerTop}px top padding`,
        );
      }
      if (stickyStack.closeTop - stickyStack.windowTop < 4 - EPSILON) {
        fail(
          `${tag}: Spellbook close control is only ${stickyStack.closeTop - stickyStack.windowTop}px below the window top`,
        );
      }
      if (stickyStack.pickerBottom > stickyStack.windowBottom + EPSILON) {
        fail(
          `${tag}: Spellbook picker bottom ${stickyStack.pickerBottom} exceeds window bottom ${stickyStack.windowBottom}`,
        );
      }
      if (stickyStack.viewportBottom - stickyStack.windowBottom > 6 + EPSILON) {
        fail(
          `${tag}: Spellbook still reserves ${stickyStack.viewportBottom - stickyStack.windowBottom}px below the window`,
        );
      }
      const afterListScroll = await page.evaluate(() => {
        const spellbook = document.getElementById('spellbook');
        const list = spellbook?.querySelector('.spell-list');
        const picker = spellbook?.querySelector('.spell-slot-picker');
        if (!spellbook || !list || !picker) return null;
        list.scrollTop = list.scrollHeight;
        return new Promise((resolve) =>
          requestAnimationFrame(() =>
            resolve({
              pickerTop: picker.getBoundingClientRect().top,
              rootScrollTop: spellbook.scrollTop,
              listScrollTop: list.scrollTop,
            }),
          ),
        );
      });
      if (
        !afterListScroll ||
        Math.abs(afterListScroll.pickerTop - stickyStack.pickerTop) > EPSILON ||
        afterListScroll.rootScrollTop !== 0 ||
        afterListScroll.listScrollTop <= 0
      ) {
        fail(
          `${tag}: Spellbook picker moved while its list scrolled: ${JSON.stringify({ before: stickyStack, after: afterListScroll })}`,
        );
      }
      const verticalResize = await page.evaluate(() => {
        const spellbook = document.getElementById('spellbook');
        if (!spellbook) return null;
        const before = spellbook.getBoundingClientRect().height;
        spellbook.style.height = `${Math.max(180, spellbook.offsetHeight - 24)}px`;
        const after = spellbook.getBoundingClientRect().height;
        spellbook.style.height = '';
        return { before, after };
      });
      if (!verticalResize || verticalResize.before - verticalResize.after < 10) {
        fail(
          `${tag}: Spellbook inline vertical resize is blocked: ${JSON.stringify(verticalResize)}`,
        );
      }
      const narrowPicker = await page.evaluate(() => {
        const spellbook = document.getElementById('spellbook');
        const picker = spellbook?.querySelector('.spell-slot-picker');
        if (!spellbook || !picker) return null;
        spellbook.style.width = '360px';
        const groups = [
          picker.querySelector('.spell-slot-picker-tabs'),
          picker.querySelector('.spell-slot-picker-destinations'),
          picker.querySelector('.spell-slot-picker-close'),
        ];
        const controls = [...picker.querySelectorAll('button')];
        const result = {
          groupTops: groups.map((group) => group?.getBoundingClientRect().top ?? null),
          controlWidths: controls.map((control) => control.getBoundingClientRect().width),
          clientWidth: picker.clientWidth,
          scrollWidth: picker.scrollWidth,
          scrollLeft: 0,
          visibleOccupiedLabels: [
            ...picker.querySelectorAll('.spell-slot-destination.has-occupant .spell-slot-label'),
          ].filter((label) => getComputedStyle(label).display !== 'none').length,
          overflowingOccupiedControls: [
            ...picker.querySelectorAll('.spell-slot-destination.has-occupant'),
          ].filter(
            (control) =>
              control.scrollHeight > control.clientHeight + 1 ||
              control.scrollWidth > control.clientWidth + 1,
          ).length,
        };
        picker.scrollLeft = picker.scrollWidth;
        result.scrollLeft = picker.scrollLeft;
        spellbook.style.width = '';
        return result;
      });
      if (
        !narrowPicker ||
        narrowPicker.groupTops.some(
          (top) => top === null || Math.abs(top - narrowPicker.groupTops[0]) > EPSILON,
        ) ||
        narrowPicker.controlWidths.some((width) => width < 40 - EPSILON || width > 48 + EPSILON) ||
        narrowPicker.scrollWidth <= narrowPicker.clientWidth ||
        narrowPicker.scrollLeft <= 0 ||
        narrowPicker.visibleOccupiedLabels !== 0 ||
        narrowPicker.overflowingOccupiedControls !== 0
      ) {
        fail(
          `${tag}: narrow Spellbook picker is not a responsive one-row scroller: ${JSON.stringify(narrowPicker)}`,
        );
      }
    }
    await page.evaluate(() => window.__game.hud.closeAll());
  }
  await page.evaluate(() => window.__game.hud.closeAll());
}

async function verifyJoystickAutorunFlow(page, tag, pointerBase) {
  const result = await page.evaluate((pointerId) => {
    const moveZone = document.getElementById('mobile-move-zone');
    const joystick = document.getElementById('mobile-move-joystick');
    const target = document.getElementById('mobile-autorun-target');
    if (!moveZone || !joystick || !target) return { error: 'missing Autorun geometry' };

    const joystickRect = joystick.getBoundingClientRect();
    const startX = joystickRect.left + joystickRect.width / 2;
    const startY = joystickRect.top + joystickRect.height / 2;
    const lockY = startY - joystickRect.height * 1.2;
    const fire = (element, type, clientY, buttons) =>
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: 'touch',
          clientX: startX,
          clientY,
          isPrimary: true,
          buttons,
        }),
      );

    window.__game.input.setAutorun(false);
    fire(moveZone, 'pointerdown', startY, 1);
    fire(moveZone, 'pointermove', lockY, 1);
    fire(moveZone, 'pointerup', lockY, 0);

    const grab = (element) => {
      if (!element || getComputedStyle(element).display === 'none') return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    const overlaps = (a, b) =>
      !!a &&
      !!b &&
      Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
      Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    const targetRect = grab(target);
    const collision = ['minimap-wrap', 'mobile-consumables', 'mobile-action-ring'].find((id) =>
      overlaps(targetRect, grab(document.getElementById(id))),
    );

    return {
      autorun: window.__game.input.autorun,
      near: target.classList.contains('near'),
      locked: target.classList.contains('locked'),
      parent: target.parentElement?.id ?? null,
      standalone: !!document.getElementById('mobile-autorun'),
      joystickActive: joystick.classList.contains('active'),
      targetRect,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      collision: collision ?? null,
      start: { x: startX, y: startY },
    };
  }, pointerBase);

  if (result.error) {
    fail(`${tag}: ${result.error}`);
    return;
  }
  if (!result.autorun || !result.near || !result.locked) {
    fail(`${tag}: joystick push did not leave Autorun locked`);
  }
  if (result.parent !== 'mobile-move-joystick' || result.standalone) {
    fail(`${tag}: Autorun is not owned exclusively by the move joystick`);
  }
  if (result.joystickActive) fail(`${tag}: joystick stayed visually active after release`);
  if (
    !result.targetRect ||
    result.targetRect.left < -EPSILON ||
    result.targetRect.top < -EPSILON ||
    result.targetRect.right > result.viewport.width + EPSILON ||
    result.targetRect.bottom > result.viewport.height + EPSILON
  ) {
    fail(`${tag}: locked Autorun target leaves the viewport`);
  }
  if (result.collision) fail(`${tag}: locked Autorun target overlaps #${result.collision}`);

  const reset = await page.evaluate(
    ({ pointerId, start }) => {
      const moveZone = document.getElementById('mobile-move-zone');
      if (!moveZone) return false;
      const fire = (type, buttons) =>
        moveZone.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: 'touch',
            clientX: start.x,
            clientY: start.y,
            isPrimary: true,
            buttons,
          }),
        );
      fire('pointerdown', 1);
      fire('pointerup', 0);
      return (
        !window.__game.input.autorun &&
        !document.getElementById('mobile-autorun-target')?.classList.contains('locked')
      );
    },
    { pointerId: pointerBase + 1, start: result.start },
  );
  if (!reset) fail(`${tag}: fresh joystick press did not cancel locked Autorun`);
}

async function verifyTwoFingerConsumableFlow(page, tag, pointerBase) {
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const existing = sim.inventory.find((slot) => slot.itemId === 'minor_healing_potion');
    if (existing) existing.count = Math.max(existing.count, 3);
    else sim.inventory.push({ itemId: 'minor_healing_potion', count: 3 });
    sim.player.hp = Math.max(1, sim.player.maxHp - 60);
    sim.player.potionCooldownUntil = sim.time - 1;
    sim.player.potionCdRemaining = 0;
    if (document.body.classList.contains('mobile-consumables-open')) {
      document.getElementById('mobile-consumables-toggle')?.click();
    }
    window.__game.hud?.update?.(0.05);
  });
  await sleep(150);

  const movementStarted = await page.evaluate((pointerId) => {
    const moveZone = document.getElementById('mobile-move-zone');
    const joystick = document.getElementById('mobile-move-joystick');
    if (!moveZone || !joystick) return false;
    const rect = moveZone.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const fire = (type, clientX, clientY) =>
      moveZone.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: 'touch',
          clientX,
          clientY,
          isPrimary: true,
        }),
      );
    fire('pointerdown', x, y);
    fire('pointermove', x + 30, y);
    const move = window.__game.input.readMoveInput();
    return {
      active: joystick.classList.contains('active'),
      intent: move.forward || move.back || move.strafeLeft || move.strafeRight,
    };
  }, pointerBase);
  if (!movementStarted.active || !movementStarted.intent) {
    fail(`${tag}: movement pointer did not produce both joystick state and movement intent`);
    return;
  }

  await page.evaluate((pointerId) => {
    const toggle = document.getElementById('mobile-consumables-toggle');
    if (!toggle) return;
    const rect = toggle.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      isPrimary: false,
    };
    toggle.dispatchEvent(new PointerEvent('pointerdown', options));
    toggle.dispatchEvent(new PointerEvent('pointerup', options));
  }, pointerBase + 1);
  await sleep(250);
  const opened = await page.evaluate(() =>
    document.body.classList.contains('mobile-consumables-open'),
  );
  if (!opened) fail(`${tag}: second pointer did not open the Consumables drawer`);

  const before = await page.evaluate(
    () =>
      window.__game.sim.inventory.find((slot) => slot.itemId === 'minor_healing_potion')?.count ??
      0,
  );
  await page.evaluate((pointerId) => {
    const slot = document.querySelector('.mobile-consumable-slot:not(.empty)');
    if (!(slot instanceof HTMLElement)) return;
    const rect = slot.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      isPrimary: false,
    };
    slot.dispatchEvent(new PointerEvent('pointerdown', options));
    slot.dispatchEvent(new PointerEvent('pointerup', options));
  }, pointerBase + 2);
  await sleep(250);
  const result = await page.evaluate(() => ({
    count:
      window.__game.sim.inventory.find((slot) => slot.itemId === 'minor_healing_potion')?.count ??
      0,
    movementActive:
      document.getElementById('mobile-move-joystick')?.classList.contains('active') ?? false,
    movementIntent: (() => {
      const move = window.__game.input.readMoveInput();
      return move.forward || move.back || move.strafeLeft || move.strafeRight;
    })(),
  }));
  if (result.count !== before - 1) {
    fail(`${tag}: potion count ${before} -> ${result.count}, expected one second-finger use`);
  }
  if (!result.movementActive) {
    fail(`${tag}: using a Consumable released the movement joystick state`);
  }
  if (!result.movementIntent) {
    fail(`${tag}: using a Consumable cleared the held movement intent`);
  }

  await page.evaluate((pointerId) => {
    const moveZone = document.getElementById('mobile-move-zone');
    moveZone?.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        buttons: 0,
      }),
    );
  }, pointerBase);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

let cdp = null;
try {
  mkdirSync(SHOT_DIR, { recursive: true });
  const page = await browser.newPage();
  page.on('pageerror', (error) => fail(`pageerror: ${String(error).slice(0, 240)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) {
      fail(`console error: ${message.text().slice(0, 240)}`);
    }
  });

  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1000);
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'LayoutAudit', settleMs: 1500 });
  await page.waitForFunction(() => window.__game?.sim && window.__game?.hud, {
    timeout: 30000,
  });
  await page.evaluate(() => document.querySelector('.tut-skip')?.click());
  await sleep(200);
  await buildTopologyState(page);

  cdp = await page.createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const defaultState = {
    leftHanded: false,
    buttonScale: 1,
    joystickScale: 1,
    cameraJoystick: false,
    consumablesOpen: false,
    partyExpanded: false,
    petActive: false,
    safeArea: SAFE_AREA_VECTORS.none,
    mobTooltip: true,
    longTooltip: false,
    uiScale: 1,
    tooltipScale: 1,
  };

  const profiles = QUICK ? PROFILES.slice(0, 1) : PROFILES;
  for (const profile of profiles) {
    await flipViewport(page, cdp, profile);
    await applySafeArea(page, cdp, SAFE_AREA_VECTORS.none, `${profile.name}/reset`);
    for (const leftHanded of [false, true]) {
      const state = { ...defaultState, leftHanded };
      await applyHudState(page, state);
      const geometry = await collectLayout(page, state);
      const tag = `${profile.name}/${leftHanded ? 'left' : 'right'}`;
      checkLayout(tag, geometry, profile, state);
      if (!leftHanded && PROFILE_SHOTS) {
        await page.screenshot({ path: `${SHOT_DIR}/${profile.name}.png` });
      }
      console.log(`checked ${tag}`);
    }
    if (profile.w === 740 && profile.h === 360) {
      await verifyMobTooltipInvalidation(page, `${profile.name}/tooltip-invalidation`);
      console.log(`checked ${profile.name}/tooltip-invalidation`);
    }
  }

  if (!QUICK) {
    const compact = PROFILES.find((profile) => profile.w === 740 && profile.h === 360);
    if (!compact) throw new Error('canonical compact stress profile is missing');

    await flipViewport(page, cdp, compact);
    for (const leftHanded of [false, true]) {
      const state = {
        ...defaultState,
        leftHanded,
        buttonScale: 0.8,
        joystickScale: 0.7,
      };
      await applySafeArea(
        page,
        cdp,
        state.safeArea,
        `galaxy-s8/min/${leftHanded ? 'left' : 'right'}`,
      );
      await applyHudState(page, state);
      checkLayout(
        `galaxy-s8/min/${leftHanded ? 'left' : 'right'}`,
        await collectLayout(page, state),
        compact,
        state,
      );
    }

    await applySafeArea(page, cdp, SAFE_AREA_VECTORS.none, 'galaxy-s8/consumables-scale/reset');
    for (const buttonScale of [0.8, 1, 1.3]) {
      const state = {
        ...defaultState,
        buttonScale,
        consumablesOpen: true,
      };
      await applyHudState(page, state);
      const tag = `galaxy-s8/consumables-scale-${buttonScale}`;
      checkLayout(tag, await collectLayout(page, state), compact, state);
      console.log(`checked ${tag}`);
    }

    for (const leftHanded of [false, true]) {
      const state = {
        ...defaultState,
        leftHanded,
        buttonScale: 1.3,
        joystickScale: 1.3,
        cameraJoystick: true,
        consumablesOpen: true,
        partyExpanded: true,
        petActive: true,
        safeArea: leftHanded
          ? SAFE_AREA_VECTORS.landscapeNotchLeft
          : SAFE_AREA_VECTORS.landscapeNotchRight,
      };
      await applySafeArea(
        page,
        cdp,
        state.safeArea,
        `galaxy-s8/max/${leftHanded ? 'left' : 'right'}`,
      );
      await applyHudState(page, state);
      checkLayout(
        `galaxy-s8/max/${leftHanded ? 'left' : 'right'}`,
        await collectLayout(page, state),
        compact,
        state,
      );
    }

    for (const leftHanded of [false, true]) {
      const state = {
        ...defaultState,
        leftHanded,
        buttonScale: 1.3,
        consumablesOpen: true,
        safeArea: leftHanded
          ? SAFE_AREA_VECTORS.landscapeNotchRight
          : SAFE_AREA_VECTORS.landscapeNotchLeft,
      };
      const tag = `galaxy-s8/movement-inset/${leftHanded ? 'left' : 'right'}`;
      await applySafeArea(page, cdp, state.safeArea, tag);
      await applyHudState(page, state);
      checkLayout(tag, await collectLayout(page, state), compact, state);
    }

    const expandedProfiles = [
      PROFILES.find((profile) => profile.tier === 'hud-mobile-standard'),
      PROFILES.find((profile) => profile.tier === 'hud-mobile-tablet'),
    ];
    if (expandedProfiles.some((profile) => !profile)) {
      throw new Error('expanded Party standard/tablet profiles are missing');
    }
    for (const profile of expandedProfiles) {
      await flipViewport(page, cdp, profile);
      await applySafeArea(page, cdp, SAFE_AREA_VECTORS.none, `${profile.name}/party/reset`);
      for (const leftHanded of [false, true]) {
        const state = {
          ...defaultState,
          leftHanded,
          consumablesOpen: true,
          partyExpanded: true,
        };
        await applyHudState(page, state);
        const tag = `${profile.name}/party-consumables-open/${leftHanded ? 'left' : 'right'}`;
        checkLayout(tag, await collectLayout(page, state), profile, state);
      }
    }

    await flipViewport(page, cdp, compact);
    for (const leftHanded of [false, true]) {
      const state = { ...defaultState, leftHanded };
      const tag = `compact-actions/${leftHanded ? 'left' : 'right'}`;
      const pointerBase = leftHanded ? 1200 : 900;
      await applySafeArea(page, cdp, state.safeArea, `${tag}/reset`);
      await applyHudState(page, state);
      await verifyMobileActionPageFlow(page, tag);
      if (!leftHanded) await verifySpellbookPickerFlow(page, tag);
      await verifyJoystickAutorunFlow(page, tag, pointerBase);
      await verifyCompactMoreFlow(page, tag);
      await applyHudState(page, state);
      await verifyTwoFingerConsumableFlow(page, tag, pointerBase + 10);
    }

    const resetState = { ...defaultState };
    await applySafeArea(page, cdp, SAFE_AREA_VECTORS.none, 'safe-area-reset/before');
    await applyHudState(page, resetState);
    const beforeReset = await collectLayout(page, resetState);
    await applySafeArea(page, cdp, SAFE_AREA_VECTORS.landscapeNotchRight, 'safe-area-reset/notch');
    await applyHudState(page, {
      ...resetState,
      safeArea: SAFE_AREA_VECTORS.landscapeNotchRight,
    });
    await applySafeArea(page, cdp, SAFE_AREA_VECTORS.none, 'safe-area-reset/after');
    await applyHudState(page, resetState);
    const afterReset = await collectLayout(page, resetState);
    for (const key of ['map', 'menu', 'moveJoystick', 'playerFrame']) {
      const before = beforeReset[key];
      const after = afterReset[key];
      if (
        !before ||
        !after ||
        ['left', 'top', 'right', 'bottom'].some(
          (edge) => Math.abs(before[edge] - after[edge]) > EPSILON,
        )
      ) {
        fail(`safe-area-reset: ${key} geometry did not return to the zero-inset baseline`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} mobile cluster violation(s).`);
    process.exitCode = 1;
  } else {
    console.log(
      QUICK
        ? '\nQuick mobile cluster layout check passed.'
        : '\nAll mobile cluster layout checks passed.',
    );
  }
} finally {
  if (cdp) {
    await cdp
      .send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE_AREA_VECTORS.none })
      .catch(() => {});
  }
  await browser.close();
}
