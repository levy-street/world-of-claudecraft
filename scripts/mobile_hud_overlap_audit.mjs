// Full populated-HUD geometry audit for the mobile layout.
//
// Pass A builds a real party, target, quest, buff/debuff state, then measures
// persistent chrome against the action pad, menu, Consumables, joysticks, and
// the explicit camera start zone across all canonical profiles and both hands.
// Pass B opens each supported HUD window and verifies viewport bounds, close
// target size, backdrop ownership, and closeAll cleanup.
//
// Needs `npm run dev` running. URL overrides http://localhost:5173/.
// `--gate` makes window findings strict. MATRIX_ALL=1 runs every window on all
// profiles. Screenshots land in tmp/mobile-hud-audit/ (git-ignored).

import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { edgeGap, PROFILES, SAFE_AREA_VECTORS } from './lib/overlap_geometry.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const GATE = process.argv.includes('--gate');
const MATRIX_ALL = process.env.MATRIX_ALL === '1';
const QUICK = process.env.QUICK === '1';
const SHOT_DIR = 'tmp/mobile-hud-audit';
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
const CHROME_IDS = [
  'minimap-wrap',
  'target-frame',
  'party-frames',
  'buff-bar',
  'debuff-bar',
  'right-tracker-stack',
  'player-frame',
  'castbar',
  'swingbar',
  'petbar',
];
const CAMERA_BLOCKER_IDS = new Set([
  'minimap-wrap',
  'target-frame',
  'party-frames',
  'buff-bar',
  'debuff-bar',
  'right-tracker-stack',
  'petbar',
]);
const INTERACTIVE_CHROME = new Set(['minimap-wrap', 'party-frames']);

const WINDOW_MATRIX = [
  { toggle: 'toggleQuestLog', id: 'quest-log-window' },
  { toggle: 'toggleBags', id: 'bags' },
  { toggle: 'toggleCrafting', id: 'crafting-window' },
  { toggle: 'toggleCalendar', id: 'calendar-window' },
  { toggle: 'toggleArena', id: 'arena-window' },
  { toggle: 'toggleValeCup', id: 'valecup-window' },
  { toggle: 'toggleLeaderboard', id: 'leaderboard-window' },
  { toggle: 'toggleSocial', id: 'social-window' },
  { toggle: 'toggleMap', id: 'map-window' },
  { toggle: 'toggleTalents', id: 'talents-window' },
  { toggle: 'toggleChar', id: 'char-window' },
  { toggle: 'toggleSpellbook', id: 'spellbook' },
];

const failures = [];
const notes = [];
function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}
function note(message) {
  notes.push(message);
  console.log(`NOTE ${message}`);
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

async function buildPopulatedState(page) {
  const party = await page.evaluate(() => {
    const sim = window.__game.sim;
    const player = sim.player;
    const roster = [
      ['Brightoak', 'druid'],
      ['Stormcaller', 'shaman'],
      ['Nightblade', 'rogue'],
      ['Emberlyn', 'mage'],
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

    const addAura = (id, name, kind, value) => {
      if (player.auras.some((aura) => aura.id === id)) return;
      player.auras.push({
        id,
        name,
        kind,
        remaining: 9999,
        duration: 9999,
        value,
        sourceId: sim.primaryId,
        school: 'physical',
      });
    };
    addAura('layout-audit-buff', 'Audit Vigor', 'buff_ap', 15);
    addAura('layout-audit-debuff', 'Audit Sunder', 'sunder', 10);

    const questLog = window.__game.world?.questLog;
    questLog?.set?.('q_wolves', { questId: 'q_wolves', counts: [0], state: 'active' });

    if (!sim.inventory.some((slot) => slot.itemId === 'minor_healing_potion')) {
      sim.inventory.push({ itemId: 'minor_healing_potion', count: 3 });
    }
    player.hp = Math.max(1, player.maxHp - 50);
    window.__game.hud?.update?.(0.05);
    return sim.partyInfo?.members?.length ?? 0;
  });
  if (party < 5) fail(`populated state: party has ${party} member(s), expected 5`);
}

async function ensureAuditPet(page) {
  const pet = await page.evaluate(() => {
    const sim = window.__game.sim;
    const player = sim.player;
    let owned = [...sim.entities.values()].find(
      (entity) => entity.kind === 'mob' && entity.ownerId === sim.playerId && !entity.dead,
    );
    if (!owned) {
      player.resource = player.maxResource;
      sim.castAbility('summon_imp');
      for (let tick = 0; tick < 20 * 8 && player.castingAbility; tick++) sim.tick();
      owned = [...sim.entities.values()].find(
        (entity) => entity.kind === 'mob' && entity.ownerId === sim.playerId && !entity.dead,
      );
    }
    window.__game.hud?.update?.(0.05);
    return owned?.id ?? null;
  });
  if (pet === null) fail('populated state: failed to summon the audit pet');
  await sleep(150);
}

async function forceTarget(page, showCast = false) {
  const target = await page.evaluate(() => {
    const sim = window.__game.sim;
    const player = sim.player;
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [id, entity] of sim.entities.entries()) {
      if (entity.kind !== 'mob' || !entity.hostile || entity.dead) continue;
      const distance = Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z);
      if (distance < bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }
    if (best !== null) {
      const target = sim.entities.get(best);
      target.pos.x = player.pos.x + 2;
      target.pos.z = player.pos.z;
      target.prevPos = { ...target.pos };
      target.maxHp = Math.max(target.maxHp, 100000);
      target.hp = target.maxHp;
      player.facing = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
      sim.targetEntity(best);
      sim.startAutoAttack();
    }
    window.__game.hud?.update?.(0.05);
    return best;
  });
  if (target === null) fail('populated state: no hostile target found');
  if (showCast) {
    const casting = await page.evaluate(() => {
      const sim = window.__game.sim;
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('summon_imp');
      window.__game.hud?.update?.(0.05);
      return sim.player.castingAbility === 'summon_imp';
    });
    if (!casting) fail('populated state: failed to start the audit cast');
  }
  await sleep(150);
}

async function applyHudState(page, state) {
  await page.evaluate((next) => {
    const body = document.body;
    window.__game.hud.closeAll?.();
    body.classList.toggle('mobile-left-handed', next.leftHanded);
    body.classList.toggle('mobile-camera-joystick-on', next.cameraJoystick);
    body.classList.remove('mobile-chat-open', 'mobile-chat-reply', 'mobile-more-open');
    const controls = document.getElementById('mobile-controls');
    controls?.style.setProperty('--btn-scale', String(next.buttonScale));
    controls?.style.setProperty('--joy-scale', String(next.joystickScale));
    window.dispatchEvent(new Event('resize'));
  }, state);
  await sleep(300);

  await page.evaluate((next) => {
    const consumablesOpen = document.body.classList.contains('mobile-consumables-open');
    if (consumablesOpen !== next.consumablesOpen) {
      document.getElementById('mobile-consumables-toggle')?.click();
    }
    const party = document.getElementById('party-frames');
    if (!!party?.classList.contains('party-expanded') !== next.partyExpanded) {
      document.getElementById('party-chip')?.click();
    }
    window.__game.hud?.update?.(0.05);
  }, state);
  await sleep(300);
}

async function collectGeometry(page) {
  return page.evaluate(
    (actionIds, compactMenuIds, fullMenuIds, chromeIds) => {
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
        };
      };
      const controls = {};
      for (const id of [...actionIds, ...new Set([...compactMenuIds, ...fullMenuIds])]) {
        controls[id] = grab(document.getElementById(id));
      }
      document.querySelectorAll('.mobile-action-slot').forEach((element) => {
        controls[`slot-${element.dataset.mobileIndex}`] = grab(element);
      });
      controls['mobile-consumables-toggle'] = grab(
        document.getElementById('mobile-consumables-toggle'),
      );
      document.querySelectorAll('.mobile-consumable-slot').forEach((element) => {
        controls[`consumable-${element.dataset.consumableIndex}`] = grab(element);
      });
      controls['mobile-move-joystick'] = grab(document.getElementById('mobile-move-joystick'));
      controls['mobile-camera-joystick'] = grab(document.getElementById('mobile-camera-joystick'));

      const chrome = Object.fromEntries(
        chromeIds.map((id) => {
          if (id === 'right-tracker-stack') {
            const quest = document.getElementById('quest-tracker');
            if (!quest || getComputedStyle(quest).display === 'none') return [id, null];
          }
          return [id, grab(document.getElementById(id))];
        }),
      );

      const mobileControls = document.getElementById('mobile-controls');
      const containerRect = mobileControls?.getBoundingClientRect() ?? null;
      const cameraStyle = mobileControls ? getComputedStyle(mobileControls, '::before') : null;
      const local = cameraStyle
        ? {
            left: Number.parseFloat(cameraStyle.left),
            top: Number.parseFloat(cameraStyle.top),
            w: Number.parseFloat(cameraStyle.width),
            h: Number.parseFloat(cameraStyle.height),
          }
        : null;
      const camera =
        local && containerRect && Object.values(local).every((value) => Number.isFinite(value))
          ? {
              left: containerRect.left + local.left,
              top: containerRect.top + local.top,
              right: containerRect.left + local.left + local.w,
              bottom: containerRect.top + local.top + local.h,
              w: local.w,
              h: local.h,
            }
          : null;

      return {
        controls,
        chrome,
        camera,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        tier: ['hud-mobile-compact', 'hud-mobile-standard', 'hud-mobile-tablet'].find((name) =>
          document.body.classList.contains(name),
        ),
        partyExpanded: !!document
          .getElementById('party-frames')
          ?.classList.contains('party-expanded'),
        consumablesOpen: document.body.classList.contains('mobile-consumables-open'),
        petActive: document.body.classList.contains('mobile-pet-active'),
        standaloneAutorun: !!document.getElementById('mobile-autorun'),
      };
    },
    ACTION_IDS,
    COMPACT_MENU_IDS,
    FULL_MENU_IDS,
    CHROME_IDS,
  );
}

function insideViewport(rect, viewport) {
  return (
    rect.left >= -EPSILON &&
    rect.top >= -EPSILON &&
    rect.right <= viewport.w + EPSILON &&
    rect.bottom <= viewport.h + EPSILON
  );
}

function insideSafeArea(rect, viewport, safeArea) {
  return (
    rect.left >= safeArea.left - EPSILON &&
    rect.top >= safeArea.top - EPSILON &&
    rect.right <= viewport.w - safeArea.right + EPSILON &&
    rect.bottom <= viewport.h - safeArea.bottom + EPSILON
  );
}

function checkPersistentGeometry(tag, geometry, profile, state) {
  const safeArea = state.safeArea ?? SAFE_AREA_VECTORS.none;
  if (geometry.tier !== profile.tier) {
    fail(`${tag}: tier ${geometry.tier ?? 'missing'} instead of ${profile.tier}`);
  }
  if (geometry.standaloneAutorun) fail(`${tag}: standalone Autorun is present`);
  if (geometry.partyExpanded !== state.partyExpanded) {
    fail(`${tag}: party expanded=${geometry.partyExpanded}, expected ${state.partyExpanded}`);
  }
  if (geometry.consumablesOpen !== state.consumablesOpen) {
    fail(`${tag}: Consumables open=${geometry.consumablesOpen}, expected ${state.consumablesOpen}`);
  }
  if (geometry.petActive !== state.petActive) {
    fail(`${tag}: pet active=${geometry.petActive}, expected ${state.petActive}`);
  }

  const menuIds = expectedCompactMenu(profile) ? COMPACT_MENU_IDS : FULL_MENU_IDS;
  const requiredControls = [
    ...ACTION_IDS,
    ...Array.from({ length: 5 }, (_, index) => `slot-${index}`),
    ...menuIds,
    'mobile-consumables-toggle',
    'mobile-move-joystick',
  ];
  if (state.cameraJoystick) requiredControls.push('mobile-camera-joystick');
  if (state.consumablesOpen) {
    requiredControls.push(...Array.from({ length: 6 }, (_, index) => `consumable-${index}`));
  }

  const controlEntries = [];
  for (const id of requiredControls) {
    const rect = geometry.controls[id];
    if (!rect) {
      fail(`${tag}: required #${id} is not measurable`);
      continue;
    }
    controlEntries.push([id, rect]);
    if (!insideViewport(rect, geometry.viewport)) fail(`${tag}: #${id} leaves the viewport`);
    if (!insideSafeArea(rect, geometry.viewport, safeArea)) {
      fail(`${tag}: #${id} enters the emulated safe-area inset`);
    }
  }
  for (let left = 0; left < controlEntries.length; left++) {
    for (let right = left + 1; right < controlEntries.length; right++) {
      const gap = edgeGap(controlEntries[left][1], controlEntries[right][1]);
      if (gap < MIN_GAP - EPSILON) {
        fail(
          `${tag}: #${controlEntries[left][0]} vs #${controlEntries[right][0]} gap ${gap.toFixed(1)}px`,
        );
      }
    }
  }

  const expectedChrome = [
    'minimap-wrap',
    'target-frame',
    'party-frames',
    'buff-bar',
    'debuff-bar',
    'player-frame',
  ];
  if (state.petActive) expectedChrome.push('petbar', 'castbar', 'swingbar');
  if (profile.h > profile.w) expectedChrome.push('right-tracker-stack');
  for (const id of expectedChrome) {
    const rect = geometry.chrome[id];
    if (!rect) {
      fail(`${tag}: populated #${id} is not measurable`);
    } else if (!insideViewport(rect, geometry.viewport)) {
      fail(`${tag}: populated #${id} leaves the viewport`);
    } else if (!insideSafeArea(rect, geometry.viewport, safeArea)) {
      fail(`${tag}: populated #${id} enters the emulated safe-area inset`);
    }
  }

  const chromeEntries = Object.entries(geometry.chrome).filter(([, rect]) => rect);
  for (let left = 0; left < chromeEntries.length; left++) {
    for (let right = left + 1; right < chromeEntries.length; right++) {
      const [leftId, leftRect] = chromeEntries[left];
      const [rightId, rightRect] = chromeEntries[right];
      const requiredGap =
        INTERACTIVE_CHROME.has(leftId) || INTERACTIVE_CHROME.has(rightId) ? MIN_GAP : 0;
      const gap = edgeGap(leftRect, rightRect);
      if (gap < requiredGap - EPSILON) {
        fail(`${tag}: #${leftId} vs #${rightId} gap ${gap.toFixed(1)}px`);
      }
    }
  }

  for (const [controlId, controlRect] of controlEntries) {
    for (const [chromeId, chromeRect] of chromeEntries) {
      const gap = edgeGap(controlRect, chromeRect);
      if (gap < MIN_GAP - EPSILON) {
        fail(`${tag}: #${controlId} vs #${chromeId} gap ${gap.toFixed(1)}px`);
      }
    }
  }

  if (!geometry.camera) {
    fail(`${tag}: camera zone is not measurable`);
  } else {
    if (!insideSafeArea(geometry.camera, geometry.viewport, safeArea)) {
      fail(`${tag}: camera zone enters the emulated safe-area inset`);
    }
    for (const [controlId, controlRect] of controlEntries) {
      if (edgeGap(controlRect, geometry.camera) < -EPSILON) {
        fail(`${tag}: #${controlId} overlaps the camera zone`);
      }
    }
    for (const [chromeId, chromeRect] of chromeEntries) {
      if (CAMERA_BLOCKER_IDS.has(chromeId) && edgeGap(chromeRect, geometry.camera) < -EPSILON) {
        fail(`${tag}: #${chromeId} overlaps the camera zone`);
      }
    }
  }

  if (state.petActive) {
    const frame = geometry.chrome['player-frame'];
    for (const id of ['castbar', 'swingbar']) {
      const bar = geometry.chrome[id];
      if (!frame || !bar) continue;
      const frameCenter = (frame.left + frame.right) / 2;
      const barCenter = (bar.left + bar.right) / 2;
      if (Math.abs(frameCenter - barCenter) > 2) {
        fail(`${tag}: #${id} is not centered over the player frame`);
      }
      if (bar.bottom > frame.top + EPSILON) {
        fail(`${tag}: #${id} is not seated above the player frame`);
      }
    }
  }
}

async function checkWindow(page, profile, entry) {
  const available = await page.evaluate(
    (toggle) => typeof window.__game?.hud?.[toggle] === 'function',
    entry.toggle,
  );
  if (!available) {
    const message = `${profile.name}/${entry.toggle}: toggle is unavailable`;
    if (GATE) fail(message);
    else note(message);
    return;
  }

  await page.evaluate((toggle) => {
    window.__game.hud.closeAll?.();
    window.__game.hud[toggle]();
  }, entry.toggle);
  await sleep(300);

  const result = await page.evaluate((id) => {
    const grab = (element) => {
      if (!element || getComputedStyle(element).display === 'none') return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        w: rect.width,
        h: rect.height,
      };
    };
    const panel = document.getElementById(id);
    const close = panel?.querySelector('[data-close], .x-btn');
    const backdrop = document.getElementById('mobile-window-backdrop');
    return {
      panel: grab(panel),
      close: grab(close),
      bodyClass: document.body.classList.contains('mobile-window-open'),
      backdrop: backdrop
        ? {
            display: getComputedStyle(backdrop).display,
            pointerEvents: getComputedStyle(backdrop).pointerEvents,
          }
        : null,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  }, entry.id);

  const report = (message) => {
    if (GATE) fail(message);
    else note(message);
  };
  if (!result.panel) {
    report(`${profile.name}/${entry.toggle}: #${entry.id} did not open`);
  } else if (!insideViewport(result.panel, result.viewport)) {
    report(`${profile.name}/${entry.toggle}: #${entry.id} leaves the viewport`);
  }
  if (!result.close) {
    report(`${profile.name}/${entry.toggle}: close control is not measurable`);
  } else if (result.close.w < 39.5 || result.close.h < 39.5) {
    report(
      `${profile.name}/${entry.toggle}: close control is ${result.close.w.toFixed(1)}x${result.close.h.toFixed(1)}`,
    );
  }
  if (!result.bodyClass) report(`${profile.name}/${entry.toggle}: mobile-window-open is missing`);
  if (result.backdrop?.display !== 'block' || result.backdrop.pointerEvents !== 'auto') {
    report(`${profile.name}/${entry.toggle}: blocking backdrop is not active`);
  }

  await page.evaluate(() => window.__game.hud.closeAll?.());
  await sleep(80);
  const cleared = await page.evaluate(
    () => !document.body.classList.contains('mobile-window-open'),
  );
  if (!cleared) report(`${profile.name}/${entry.toggle}: closeAll left mobile-window-open set`);
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
  await enterOfflineGame(page, { charClass: 'warlock', charName: 'HudAudit', settleMs: 1500 });
  await page.waitForFunction(() => window.__game?.sim && window.__game?.hud, {
    timeout: 15000,
  });
  await page.evaluate(() => document.querySelector('.tut-skip')?.click());
  await sleep(200);
  await buildPopulatedState(page);

  cdp = await page.createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const baseline = {
    leftHanded: false,
    buttonScale: 1,
    joystickScale: 1,
    cameraJoystick: false,
    consumablesOpen: false,
    partyExpanded: false,
    petActive: false,
    safeArea: SAFE_AREA_VECTORS.none,
  };

  console.log('\n=== PASS A: populated persistent HUD ===');
  const profiles = QUICK ? PROFILES.slice(0, 1) : PROFILES;
  for (const profile of profiles) {
    await flipViewport(page, cdp, profile);
    await applySafeArea(page, cdp, SAFE_AREA_VECTORS.none, `${profile.name}/reset`);
    for (const leftHanded of [false, true]) {
      await forceTarget(page);
      const state = { ...baseline, leftHanded };
      await applyHudState(page, state);
      const tag = `${profile.name}/${leftHanded ? 'left' : 'right'}`;
      checkPersistentGeometry(tag, await collectGeometry(page), profile, state);
      console.log(`checked ${tag}`);
    }
    await page.screenshot({ path: `${SHOT_DIR}/${profile.name}.png` });
  }

  if (!QUICK) {
    const compact = PROFILES.find((profile) => profile.w === 740 && profile.h === 360);
    if (!compact) throw new Error('740x360 stress profile is missing');
    await flipViewport(page, cdp, compact);
    await ensureAuditPet(page);
    for (const leftHanded of [false, true]) {
      const state = {
        ...baseline,
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
        `galaxy-s8-stress/${leftHanded ? 'left' : 'right'}`,
      );
      await forceTarget(page, true);
      await applyHudState(page, state);
      const tag = `galaxy-s8-stress/${leftHanded ? 'left' : 'right'}`;
      checkPersistentGeometry(tag, await collectGeometry(page), compact, state);
      await page.screenshot({ path: `${SHOT_DIR}/${tag.replace('/', '-')}.png` });
      console.log(`checked ${tag}`);
    }

    console.log('\n=== PASS B: mobile window matrix ===');
    const windowProfiles = MATRIX_ALL
      ? PROFILES
      : PROFILES.filter((profile) =>
          [
            'galaxy-s8-landscape',
            'iphone-13-landscape',
            'tablet-4-3',
            'iphone-13-portrait',
          ].includes(profile.name),
        );
    for (const profile of windowProfiles) {
      await flipViewport(page, cdp, profile);
      await applySafeArea(page, cdp, SAFE_AREA_VECTORS.none, `${profile.name}/windows-reset`);
      await applyHudState(page, baseline);
      for (const entry of WINDOW_MATRIX) await checkWindow(page, profile, entry);
      console.log(`checked windows at ${profile.name}`);
    }
  }

  console.log('\n=== AUDIT SUMMARY ===');
  console.log(`${notes.length} note(s), ${failures.length} violation(s).`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  if (cdp) {
    await cdp
      .send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE_AREA_VECTORS.none })
      .catch(() => {});
  }
  await browser.close();
}
