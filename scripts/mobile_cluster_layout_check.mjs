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

async function collectLayout(page) {
  return page.evaluate(
    async (actionIds, allMenuIds) => {
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
    checkIncreasing(tag, geometry, [
      'mobile-target-cycle',
      'mobile-action-attack',
      'slot-1',
      'slot-0',
    ]);
    checkIncreasing(tag, geometry, [
      'mobile-jump',
      'slot-4',
      'slot-3',
      'slot-2',
      'mobile-action-page-toggle',
    ]);
  } else {
    checkIncreasing(tag, geometry, [
      'slot-0',
      'slot-1',
      'mobile-action-attack',
      'mobile-target-cycle',
    ]);
    checkIncreasing(tag, geometry, [
      'mobile-action-page-toggle',
      'slot-2',
      'slot-3',
      'slot-4',
      'mobile-jump',
    ]);
  }

  const targetCenter = center(geometry.controls['mobile-target-cycle']);
  const jumpCenter = center(geometry.controls['mobile-jump']);
  if (Math.abs(targetCenter.x - jumpCenter.x) > EPSILON || targetCenter.y >= jumpCenter.y) {
    fail(`${tag}: Target is not directly above Jump/Use`);
  }

  const { action, target, jump, attack, page } = geometry.faces;
  if (![action, target, jump, attack, page].every(Boolean)) {
    fail(`${tag}: rendered action-face styles are unavailable`);
  } else {
    if (
      !(
        jump.w > action.w &&
        Math.abs(action.w - target.w) <= EPSILON &&
        target.w > attack.w &&
        attack.w > page.w
      )
    ) {
      fail(
        `${tag}: rendered face hierarchy is not Jump > abilities/Target > Attack > Page (${JSON.stringify(geometry.faces)})`,
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
    if (Math.abs(renderedTierRatio - 0.8) > 0.015) {
      fail(`${tag}: rendered Target tier ratio ${renderedTierRatio.toFixed(3)}, expected 0.800`);
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
      'hud-mobile-compact': 0.62,
      'hud-mobile-standard': 0.9,
      'hud-mobile-tablet': 1,
    }[profile.tier];
    if (Math.abs(geometry.scales.playerFrame - expectedScale) > 0.01) {
      fail(`${tag}: player-frame scale ${geometry.scales.playerFrame}, expected ${expectedScale}`);
    }
    const minimumWidth = {
      'hud-mobile-compact': 150,
      'hud-mobile-standard': 220,
      'hud-mobile-tablet': 245,
    }[profile.tier];
    if (geometry.playerFrame.w < minimumWidth - EPSILON) {
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
        if (coordinateBucketCount(xs) !== 2 || coordinateBucketCount(ys) !== 3) {
          fail(`${tag}: compact Consumables do not render as a 2 x 3 grid`);
        }
        const expectedToggleBottom = geometry.viewport.h - safeArea.bottom - 16;
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
        const wrapRows = [slots[0], slots[2], slots[4]].map((rect) => center(rect).y);
        if (wrapRows[1] >= wrapRows[0] - EPSILON || wrapRows[2] >= wrapRows[1] - EPSILON) {
          fail(`${tag}: later compact Consumables rows do not wrap upward in item order`);
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
  };

  const profiles = QUICK ? PROFILES.slice(0, 1) : PROFILES;
  for (const profile of profiles) {
    await flipViewport(page, cdp, profile);
    await applySafeArea(page, cdp, SAFE_AREA_VECTORS.none, `${profile.name}/reset`);
    for (const leftHanded of [false, true]) {
      const state = { ...defaultState, leftHanded };
      await applyHudState(page, state);
      const geometry = await collectLayout(page);
      const tag = `${profile.name}/${leftHanded ? 'left' : 'right'}`;
      checkLayout(tag, geometry, profile, state);
      if (!leftHanded && PROFILE_SHOTS) {
        await page.screenshot({ path: `${SHOT_DIR}/${profile.name}.png` });
      }
      console.log(`checked ${tag}`);
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
        await collectLayout(page),
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
      checkLayout(tag, await collectLayout(page), compact, state);
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
        await collectLayout(page),
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
      checkLayout(tag, await collectLayout(page), compact, state);
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
        checkLayout(tag, await collectLayout(page), profile, state);
      }
    }

    await flipViewport(page, cdp, compact);
    for (const leftHanded of [false, true]) {
      const state = { ...defaultState, leftHanded };
      const tag = `compact-actions/${leftHanded ? 'left' : 'right'}`;
      const pointerBase = leftHanded ? 1200 : 900;
      await applySafeArea(page, cdp, state.safeArea, `${tag}/reset`);
      await applyHudState(page, state);
      await verifyJoystickAutorunFlow(page, tag, pointerBase);
      await verifyCompactMoreFlow(page, tag);
      await applyHudState(page, state);
      await verifyTwoFingerConsumableFlow(page, tag, pointerBase + 10);
    }

    const resetState = { ...defaultState };
    await applySafeArea(page, cdp, SAFE_AREA_VECTORS.none, 'safe-area-reset/before');
    await applyHudState(page, resetState);
    const beforeReset = await collectLayout(page);
    await applySafeArea(page, cdp, SAFE_AREA_VECTORS.landscapeNotchRight, 'safe-area-reset/notch');
    await applyHudState(page, {
      ...resetState,
      safeArea: SAFE_AREA_VECTORS.landscapeNotchRight,
    });
    await applySafeArea(page, cdp, SAFE_AREA_VECTORS.none, 'safe-area-reset/after');
    await applyHudState(page, resetState);
    const afterReset = await collectLayout(page);
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
