// Book of Deeds evidence screenshots: the full surface matrix across the five
// supported viewport tiers, captured from the OFFLINE world through real play
// (no server, no dev commands): the Bursar visit and the nine-talk Saul streak
// earn real deeds, the title is equipped through the actual Titles pane, and
// every window opens through its shipped key or button.
//
// Viewports: desktop 1600x900 dsf1 and phone landscape 844x390 dsf3, the two
// committed PR evidence tiers (intermediate tiers were dropped once tier-flip
// QA closed; the ignore rule keeps any extra local captures out of git).
// EVERY viewport, desktop included, is applied via raw CDP
// Emulation.setDeviceMetricsOverride (puppeteer's setViewport omits
// screenWidth/screenHeight and headless then fit-scales narrower viewports,
// leaving a stale window.innerWidth), and the browser launches with
// defaultViewport: null (a puppeteer-managed viewport is re-asserted by
// every page.screenshot, silently reverting the override mid-run).
// Viewports only ever narrow, so a stale page scale can never carry a wider
// layout forward.
//
// Needs `npm run dev` (GAME_URL to point elsewhere, default :5173). Writes
// numbered PNGs plus an index README to docs/achievements/screenshots/.
//   node scripts/deeds_screenshots.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
const OUT = process.env.OUT_DIR ?? 'docs/achievements/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => {
  console.log(`${c ? 'OK  ' : 'FAIL'}  ${m}`);
  if (!c) fails.push(m);
};
const captured = [];
// Narrowed tiers render in the top-left of the launch-size surface (the raw
// CDP override never grows the window), so each shot clips to the live CSS
// viewport. currentClip is set by flipViewport below.
let currentClip = null;
async function shot(page, file, surface, viewport, settleMs = 250) {
  // Park the cursor first: a hover tooltip left over from the last click
  // would otherwise photobomb the frame.
  await page.mouse.move(0, 0);
  await sleep(settleMs);
  await page.screenshot({ path: `${OUT}/${file}`, ...(currentClip ? { clip: currentClip } : {}) });
  captured.push({ file, surface, viewport });
  console.log(`shot  ${file}`);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 180000,
  args: [
    '--no-sandbox',
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  // No puppeteer-managed viewport: page.screenshot RESTORES the managed
  // viewport after every capture, which silently clobbered the raw CDP
  // metrics override mid-run (every frame after the first screenshot of a
  // tier came out as a top-left crop of the re-asserted 1600x900 layout).
  // With null, every tier including desktop is set via flipViewport below
  // and survives captures.
  defaultViewport: null,
});
const page = await browser.newPage();
page.on('pageerror', (e) => fails.push(`pageerror: ${e.message}`));

// Raced, retried evaluate: puppeteer's waitForFunction can stall against this
// software-GL page under machine load, so every wait is a hand-rolled poll.
async function evr(fn, ...args) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await Promise.race([
        page.evaluate(fn, ...args).then((v) => ({ v })),
        sleep(45000).then(() => 'stall'),
      ]);
      if (res !== 'stall') return res.v;
      console.log('WARN: evaluate stalled 45s, retrying');
    } catch (e) {
      console.log(`WARN: evaluate threw (${e.message.slice(0, 80)}), retrying`);
      await sleep(1000);
    }
  }
  throw new Error('evaluate failed six times');
}

// Press a real key, verify with `expect`, and fall back to a window keydown
// dispatch (some headless environments drop CDP key delivery entirely).
// A 'Shift+KeyX' chord holds Shift around the press on both paths.
async function pressKey(combo, expect) {
  const shifted = combo.startsWith('Shift+');
  const code = shifted ? combo.slice('Shift+'.length) : combo;
  if (shifted) await page.keyboard.down('Shift');
  await page.keyboard.press(code);
  if (shifted) await page.keyboard.up('Shift');
  await sleep(700);
  if (await evr(expect)) return true;
  await evr(
    (c, s) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: c, shiftKey: s, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: c, shiftKey: s, bubbles: true }));
    },
    code,
    shifted,
  );
  await sleep(700);
  return evr(expect);
}

const deedsOpen = () => document.querySelector('#deeds-window')?.style.display === 'flex';

// Teleport the offline player beside an entity and aim the chase camera at it.
async function goTo(templateId, offX, offZ) {
  return evr(
    (id, ox, oz) => {
      const g = window.__game;
      const sim = g.world;
      const npc = [...sim.entities.values()].find((e) => e.templateId === id && e.kind === 'npc');
      if (!npc) return null;
      const p = sim.entities.get(sim.playerId);
      p.pos.x = npc.pos.x + ox;
      p.pos.z = npc.pos.z + oz;
      const yaw = Math.atan2(npc.pos.x - p.pos.x, npc.pos.z - p.pos.z);
      g.input.camYaw = yaw;
      g.input.camPitch = 0.3;
      p.facing = yaw;
      g.input.clickMoveTarget = null;
      g.input.clickMoveGoal = null;
      g.input.clickMovePath = [];
      g.input.clickMoveEntityId = null;
      return { id: npc.id };
    },
    templateId,
    offX,
    offZ,
  );
}

// Project an entity to screen pixels via the live camera matrices.
async function screenPointOf(entityId, yLift) {
  return evr(
    (id, lift) => {
      const g = window.__game;
      const e = g.world.entities.get(id);
      if (!e) return null;
      const cam = g.renderer.camera;
      cam.updateMatrixWorld(true);
      const v = [e.pos.x, e.pos.y + lift, e.pos.z, 1];
      const mul = (m, p) => {
        const el = m.elements;
        return [
          el[0] * p[0] + el[4] * p[1] + el[8] * p[2] + el[12] * p[3],
          el[1] * p[0] + el[5] * p[1] + el[9] * p[2] + el[13] * p[3],
          el[2] * p[0] + el[6] * p[1] + el[10] * p[2] + el[14] * p[3],
          el[3] * p[0] + el[7] * p[1] + el[11] * p[2] + el[15] * p[3],
        ];
      };
      const view = mul(cam.matrixWorldInverse, v);
      const clip = mul(cam.projectionMatrix, view);
      if (clip[3] <= 0) return null;
      const ndcX = clip[0] / clip[3];
      const ndcY = clip[1] / clip[3];
      return {
        x: ((ndcX + 1) / 2) * window.innerWidth,
        y: ((1 - ndcY) / 2) * window.innerHeight,
      };
    },
    entityId,
    yLift,
  );
}

// Escape until no window is left on screen (fixed-position windows have a
// null offsetParent, so visibility is probed via rects).
async function escapeUntilClear() {
  for (let i = 0; i < 8; i++) {
    const open = await evr(() => {
      if (document.querySelector('#deeds-window')?.style.display === 'flex') return true;
      for (const sel of ['#bank-window', '#char-window', '#leaderboard-window', '.pc-preview']) {
        const el = document.querySelector(sel);
        if (el && el.getBoundingClientRect().width > 0) return true;
      }
      return false;
    });
    if (!open) return;
    await page.keyboard.press('Escape');
    await sleep(350);
  }
}

// Left-click an NPC (talk works within interact range; chroniclers route the
// gossip open to the Book at the Chronicles section).
async function clickNpc(npcId) {
  const pt = await screenPointOf(npcId, 1.0);
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  return true;
}

async function clickChronicler(npcId, stepMs = 1000) {
  await clickNpc(npcId);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(stepMs);
    if (await evr(deedsOpen)) return true;
  }
  return false;
}

// Every tier including desktop is applied via raw CDP ONLY: page.setViewport
// with isMobile/hasTouch RELOADS the page and drops the live offline world,
// and it also omits screenWidth/screenHeight so headless fit-scales narrower
// viewports (stale window.innerWidth mis-tiers the layout under test). The
// override keeps the world alive; the runtime sees the emulated size and
// device pixel ratio, and shots clip to the live CSS viewport (captured at
// the surface's own scale). Phones additionally emulate a coarse-pointer
// touch device so the runtime's own tier applier activates the mobile HUD.
const media = await page.createCDPSession();
async function flipViewport(w, h, dsf, phone) {
  if (phone) {
    await media.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
    await media.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    await media.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: dsf,
      mobile: phone,
      screenWidth: w,
      screenHeight: h,
      positionX: 0,
      positionY: 0,
    });
    await media.send('Emulation.resetPageScaleFactor').catch(() => {});
    await sleep(400);
    const inner = await evr(() => [window.innerWidth, window.innerHeight]);
    if (Math.abs(inner[0] - w) <= 2 && Math.abs(inner[1] - h) <= 2) break;
    if (attempt === 3)
      check(false, `flipViewport(${w}x${h}): page reports ${inner[0]}x${inner[1]}`);
  }
  await evr((isPhone) => {
    if (isPhone) document.body.classList.add('mobile-touch');
    window.dispatchEvent(new Event('resize'));
  }, phone);
  currentClip = { x: 0, y: 0, width: w, height: h };
  await sleep(1500);
}

// ---------------------------------------------------------------------------
// Enter the offline world at the desktop viewport.
// ---------------------------------------------------------------------------
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await flipViewport(1600, 900, 1, false);
// The own nameplate is a real Options toggle (off by default). Seed it the
// way a returning player's client stores it, before the game boots and
// reads settings, so the 07 frames can carry the titled own plate. This is
// the only pre-seeded setting; everything else ships defaults.
await evr(() => {
  const raw = JSON.parse(localStorage.getItem('woc_settings') ?? 'null') ?? {};
  raw.showOwnNameplate = true;
  localStorage.setItem('woc_settings', JSON.stringify(raw));
});
await enterOfflineGame(page, { charClass: 'paladin', charName: 'Evidence', settleMs: 2000 });
let entered = false;
for (let i = 0; i < 30 && !entered; i++) {
  await sleep(2000);
  entered = (await evr(() => window.__game?.world?.entities?.size ?? 0)) > 5;
}
if (!entered) throw new Error('never entered the offline world');
if (await evr(() => document.getElementById('ui')?.style.display === 'none')) {
  await page.keyboard.press('Escape');
  await sleep(700);
}
await evr(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await sleep(500);
console.log('offline world entered');
// Re-assert the desktop tier: the entry flow drops the metrics override
// back to the bare window content size once per run (observed reliably),
// and every capture until the first tier flip would inherit it.
await flipViewport(1600, 900, 1, false);

// ---------------------------------------------------------------------------
// Real earns: the Bursar visit deed, then the nine-talk Saul streak (the
// hidden footnote deed, whose reward is the title equipped further down).
// ---------------------------------------------------------------------------
const bursar = await goTo('bursar_fernando', -3, 3.5);
check(!!bursar, 'bursar found in the live world');
await sleep(1500);
// The projected click can land a hair off while the camera settles, and a
// miss that hits the ground is a MOVE order that walks the player away, so
// every retry re-teleports and re-aims before clicking again.
for (let attempt = 0; attempt < 6; attempt++) {
  if (attempt > 0) {
    await goTo('bursar_fernando', -3, 3.5);
    await sleep(1200);
  }
  await clickNpc(bursar.id);
  await sleep(1500);
  await escapeUntilClear();
  const earned = await evr(() => {
    const sim = window.__game.world;
    return sim.players.get(sim.playerId)?.deedsEarned.has('soc_meet_bursar') ?? false;
  });
  if (earned) break;
}
check(
  await evr(() => {
    const sim = window.__game.world;
    return sim.players.get(sim.playerId)?.deedsEarned.has('soc_meet_bursar') ?? false;
  }),
  'soc_meet_bursar earned by visiting the Bursar',
);

const saul = await goTo('chronicler_saul', -2.5, 2.7);
check(!!saul, 'Saul found in the live world');
await sleep(2000);
for (let n = 1; n <= 9; n++) {
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    if (attempt > 0) {
      // A missed click is a move order that can carry the player out of
      // interact range, so re-seat before trying the talk again.
      await goTo('chronicler_saul', -2.5, 2.7);
      await sleep(1200);
    }
    // The ninth talk polls fine-grained: the unlock banner slot is only 2.6s
    // and a coarse poll spends most of it before detection.
    opened = await clickChronicler(saul.id, n === 9 ? 150 : 1000);
  }
  if (!opened) {
    check(false, `saul streak: talk ${n} did not open the Book`);
    break;
  }
  if (n < 9) await escapeUntilClear();
}
// The ninth talk fires the unlock at the tick tail; close the Book
// immediately and catch the banner inside its slot plus the durable gold
// chat line. Every fixed delay here is pared down and the earn assert runs
// after the capture, because the whole path from detection to capture races
// the 2.6s banner slot.
await page.keyboard.press('Escape');
await sleep(150);
await shot(
  page,
  '01-unlock-moment-1600x900.png',
  'Deed unlock moment (banner + gold chat line)',
  '1600x900',
  100,
);
// Verify the CAPTURED pixels, not post-hoc DOM state: under software GL the
// probe-to-capture lag exceeds the 1.2s fade, so live opacity says nothing
// decisive about the frame. The banner renders #ffd100 capitals across the
// top-center band; a faded banner blends toward the bright sky and stops
// matching, so a healthy gold count means a near-full-brightness capture.
{
  const sharp = (await import('sharp')).default;
  const band = await sharp(`${OUT}/01-unlock-moment-1600x900.png`)
    .extract({ left: 300, top: 215, width: 1000, height: 100 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let gold = 0;
  for (let i = 0; i < band.data.length; i += band.info.channels) {
    const r = band.data[i];
    const g = band.data[i + 1];
    const b = band.data[i + 2];
    if (r > 200 && g > 140 && g < 225 && b < 90) gold++;
  }
  check(gold > 800, `unlock banner visible in the captured frame (${gold} gold pixels)`);
}
check(
  await evr(() => {
    const sim = window.__game.world;
    return sim.players.get(sim.playerId)?.deedsEarned.has('hid_saul_footnote') ?? false;
  }),
  'hid_saul_footnote earned after nine consecutive Saul talks',
);
await escapeUntilClear();

// ---------------------------------------------------------------------------
// Desktop-only surfaces: player card, own nameplate title, chat title line,
// and the three chronicler portraits. Title equip comes first so every later
// surface carries it.
// ---------------------------------------------------------------------------
check(await pressKey('Shift+KeyZ', deedsOpen), 'Shift+KeyZ opens the Book of Deeds');
await evr(() => {
  for (const b of document.querySelectorAll('#deeds-window [data-cat]')) {
    if (b.dataset.cat === 'titles') b.click();
  }
});
await sleep(600);
await evr(() => {
  for (const b of document.querySelectorAll('#deeds-window .deed-title-option')) {
    if (b.dataset.title === 'hid_saul_footnote') b.click();
  }
});
await sleep(800);
check(
  (await evr(() => window.__game.world.activeTitle)) === 'hid_saul_footnote',
  'the footnote title equips through the Titles pane',
);
await escapeUntilClear();

// Chat: the own say line carries the bracketed title. Under machine load a
// keypress can be dropped, and characters typed WITHOUT the composer focused
// would fire keybinds instead, so confirm focus before typing and retry the
// whole line until the full say text lands in the log.
let sayLanded = false;
for (let attempt = 0; attempt < 3 && !sayLanded; attempt++) {
  let composerOpen = false;
  for (let i = 0; i < 4 && !composerOpen; i++) {
    await page.keyboard.press('Enter');
    await sleep(400);
    composerOpen = await evr(() => document.activeElement?.id === 'chat-input');
  }
  if (!composerOpen) continue;
  await page.keyboard.type('/s For the Vale!');
  await sleep(200);
  await page.keyboard.press('Enter');
  await sleep(1200);
  sayLanded = await evr(() =>
    (document.querySelector('#chatlog')?.textContent ?? '').includes('For the Vale!'),
  );
}
check(sayLanded, 'own say line reached the chat log');
await shot(page, '06-chat-title-1600x900.png', 'Chat say line with the equipped title', '1600x900');

// Own nameplate: KeyV toggles nameplates; the own plate renders the title.
// Step clear of Saul first so his plate cannot overlap the own plate.
await evr(() => {
  const g = window.__game;
  const p = g.world.entities.get(g.world.playerId);
  p.pos.x += 9;
  g.input.clickMoveTarget = null;
  g.input.clickMoveGoal = null;
  g.input.clickMovePath = [];
  g.input.clickMoveEntityId = null;
});
await sleep(1500);
await page.keyboard.press('KeyV');
await sleep(900);
await shot(
  page,
  '07-own-nameplate-title-1600x900.png',
  'Own nameplate with the equipped title',
  '1600x900',
);
await page.keyboard.press('KeyV');
await sleep(400);

// Player card: character window, then the share button renders the card.
await pressKey(
  'KeyC',
  () => (document.querySelector('#char-window')?.getBoundingClientRect().width ?? 0) > 0,
);
await evr(() => document.querySelector('[data-act="share-card"]')?.click());
let cardShown = false;
for (let i = 0; i < 25 && !cardShown; i++) {
  await sleep(500);
  cardShown = await evr(() => !!document.querySelector('.pc-preview canvas, .pc-preview img'));
}
check(cardShown, 'player card preview rendered');
await shot(page, '08-player-card-1600x900.png', 'Player card with the equipped title', '1600x900');
await escapeUntilClear();

// The three chroniclers at gameplay distance.
const CHRONICLERS = [
  {
    id: 'chronicler_saul',
    file: '09-chronicler-saul-1600x900.png',
    label: 'Chronicler Saul (Eastbrook Vale)',
  },
  {
    id: 'chronicler_osric_fenn',
    file: '10-chronicler-osric-1600x900.png',
    label: 'Chronicler Osric Fenn (Mirefen Marsh)',
  },
  {
    id: 'chronicler_edda_hartwell',
    file: '11-chronicler-zenzie-1600x900.png',
    label: 'Chronicler Zenzie (Thornpeak Heights)',
  },
];
const CHRONICLER_OFFSETS = {
  chronicler_saul: [-5.5, 6],
  chronicler_osric_fenn: [7, 1],
  chronicler_edda_hartwell: [-2, -8],
};
for (const c of CHRONICLERS) {
  const [ox, oz] = CHRONICLER_OFFSETS[c.id];
  const found = await goTo(c.id, ox, oz);
  check(!!found, `${c.id} found in the live world`);
  // A teleport into a new zone fires the crossing banner (2.6s slot plus a
  // 1.2s fade) over the top-center where it photobombs the chronicler's
  // plate, and a fixed settle races it. Give the crossing time to commit,
  // then outwait the banner by its computed opacity.
  await sleep(1500);
  for (let i = 0; i < 20; i++) {
    const faded = await evr(() => {
      const el = document.getElementById('banner');
      return !el || Number.parseFloat(getComputedStyle(el).opacity) < 0.05;
    });
    if (faded) break;
    await sleep(400);
  }
  await sleep(500);
  await shot(page, c.file, c.label, '1600x900');
}

// ---------------------------------------------------------------------------
// The per-viewport surface set: Book category view, Titles pane, watch
// tracker, Renown leaderboard tab. Runs at the current viewport, then the
// narrower tiers below re-run it after a raw CDP metrics flip (the live world
// keeps its earns, title, and watchlist across flips).
// ---------------------------------------------------------------------------
async function openBook(phone) {
  if (!phone) return pressKey('Shift+KeyZ', deedsOpen);
  // Real mobile flow: the More tray's Deeds button (fixed elements have a
  // null offsetParent, so probe visibility via rects).
  await evr(() => document.querySelector('#mobile-more')?.click());
  await sleep(600);
  await evr(() => document.querySelector('#mobile-deeds')?.click());
  await sleep(900);
  if (await evr(deedsOpen)) return true;
  return pressKey('Shift+KeyZ', deedsOpen);
}

async function surfacePass(vp, phone) {
  check(await openBook(phone), `${vp}: the Book of Deeds opens`);
  // Category view: social carries the earned Bursar deed beside desaturated
  // unearned art.
  await evr(() => {
    for (const b of document.querySelectorAll('#deeds-window [data-cat]')) {
      if (b.dataset.cat === 'social') b.click();
    }
  });
  await sleep(800);
  await shot(
    page,
    `02-book-window-${vp}.png`,
    'Book of Deeds window (social category: earned + unearned + desaturated art)',
    vp,
  );

  // Titles pane (the equipped footnote title shows active).
  await evr(() => {
    for (const b of document.querySelectorAll('#deeds-window [data-cat]')) {
      if (b.dataset.cat === 'titles') b.click();
    }
  });
  await sleep(700);
  await shot(page, `03-titles-pane-${vp}.png`, 'Titles pane with the equipped title', vp);

  // Watchlist: watch the first three watchable deeds of the progression
  // category (idempotent: re-clicking a watching button would unwatch, so
  // only press buttons not already watching).
  await evr(() => {
    for (const b of document.querySelectorAll('#deeds-window [data-cat]')) {
      if (b.dataset.cat === 'progression') b.click();
    }
  });
  await sleep(700);
  await evr(() => {
    const btns = [...document.querySelectorAll('#deeds-window .deed-watch')].filter(
      (b) => !b.disabled && !b.classList.contains('watching'),
    );
    const room = 3 - document.querySelectorAll('#deeds-window .deed-watch.watching').length;
    for (const b of btns.slice(0, Math.max(0, room))) b.click();
  });
  await sleep(600);
  await escapeUntilClear();
  await sleep(600);
  check(
    await evr(() => (document.querySelector('#deed-tracker')?.textContent ?? '').length > 0),
    `${vp}: the HUD watch tracker has entries`,
  );
  await shot(page, `04-watch-tracker-${vp}.png`, 'HUD watch tracker with entries', vp);

  // Renown leaderboard tab (offline shows the tab frame).
  let lbOpen;
  if (phone) {
    await evr(() => window.__game.hud.toggleLeaderboard());
    await sleep(900);
    lbOpen = await evr(
      () => (document.querySelector('#leaderboard-window')?.getBoundingClientRect().width ?? 0) > 0,
    );
  } else {
    lbOpen = await pressKey(
      'KeyK',
      () => (document.querySelector('#leaderboard-window')?.getBoundingClientRect().width ?? 0) > 0,
    );
  }
  check(lbOpen, `${vp}: the leaderboard window opens`);
  await evr(() => document.querySelector('[data-leaderboard-tab="deeds"]')?.click());
  await sleep(900);
  await shot(page, `05-leaderboard-renown-${vp}.png`, 'Renown leaderboard tab', vp);
  await page.keyboard.press('Escape');
  await sleep(400);
}

await surfacePass('1600x900', false);

const TIERS = [{ vp: '844x390', w: 844, h: 390, dsf: 3, phone: true }];
for (const tier of TIERS) {
  await flipViewport(tier.w, tier.h, tier.dsf, tier.phone);
  await surfacePass(tier.vp, tier.phone);
  if (tier.vp === '844x390') {
    // The phone chat panel and own nameplate, carrying the same live title.
    // Chat is collapsed behind the Chat button on phones, and the button is
    // pointer-bound (a synthetic element.click() never fires it), so tap it
    // through the real input pipeline; a second tap closes it again.
    const tapById = async (sel) => {
      const pt = await evr((s) => {
        const r = document.querySelector(s)?.getBoundingClientRect();
        return r && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      }, sel);
      // Touchscreen, not mouse: under touch emulation the mouse path never
      // reaches the button's pointer handlers.
      if (pt) await page.touchscreen.tap(pt.x, pt.y);
      await sleep(900);
    };
    const tapChatButton = () => tapById('#mobile-chat');
    // A deliberate long hold on the Chat button (past the 420ms classifier)
    // toggles the read-only log peek; it is the only gesture that dismisses a
    // peek without opening the composer.
    const longPressChat = async () => {
      const pt = await evr(() => {
        const r = document.querySelector('#mobile-chat')?.getBoundingClientRect();
        return r && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      if (!pt) return;
      await page.touchscreen.touchStart(pt.x, pt.y);
      await sleep(700);
      await page.touchscreen.touchEnd();
      await sleep(600);
    };
    // The menu cluster ships collapsed behind its chevron toggle, so the Chat
    // button has no live rect until a real tap expands it, exactly the flow a
    // player follows. Collapsed is the shipping default, so the toggle is
    // tapped again after the chat shots to restore it for the later frames.
    const menuOpen = () => document.body.classList.contains('mobile-menu-open');
    if (!(await evr(menuOpen))) await tapById('#mobile-menu-collapse-toggle');
    check(await evr(menuOpen), '844x390: the menu cluster expands via its collapse toggle');
    // The long-press classifier can misfire a real tap into the log peek when
    // the software-GL main thread delays the synthesized pointerup past
    // 420ms, so retry: a short tap opens the panel from ANY state (it clears
    // a peek), and the loop stops the moment the panel is up.
    const chatOpen = () => document.body.classList.contains('mobile-chat-open');
    for (let i = 0; i < 4 && !(await evr(chatOpen)); i++) await tapChatButton();
    if (!(await evr(chatOpen))) {
      // At dsf3 the software-GL main thread can hold EVERY frame past the
      // classifier threshold, so no real tap can register short. Dispatch the
      // button's own pointer pair in one task (the classifier timer cannot
      // fire between two synchronous dispatches); this still runs the shipped
      // pointer handlers, only the transport is synthetic.
      await evr(() => {
        const btn = document.querySelector('#mobile-chat');
        const opts = { bubbles: true, pointerId: 7, pointerType: 'touch' };
        btn?.dispatchEvent(new PointerEvent('pointerdown', opts));
        btn?.dispatchEvent(new PointerEvent('pointerup', opts));
      });
      await sleep(900);
    }
    check(await evr(chatOpen), '844x390: the chat panel opens via the Chat button');
    await shot(page, '06-chat-title-844x390.png', 'Chat panel with the titled say line', '844x390');
    // Close is the same misfire in reverse: a long-classified tap closes the
    // panel but leaves the peek behind, and only a long press clears a peek.
    for (let i = 0; i < 4 && (await evr(chatOpen)); i++) await tapChatButton();
    check(!(await evr(chatOpen)), '844x390: the chat panel closes via the Chat button');
    if (await evr(() => document.body.classList.contains('mobile-chatlog-peek'))) {
      await longPressChat();
    }
    if (await evr(menuOpen)) await tapById('#mobile-menu-collapse-toggle');
    await page.keyboard.press('KeyV');
    await sleep(900);
    await shot(
      page,
      '07-own-nameplate-title-844x390.png',
      'Own nameplate with the equipped title',
      '844x390',
    );
    await page.keyboard.press('KeyV');
    await sleep(400);
  }
}

// ---------------------------------------------------------------------------
// The index README: file, surface, viewport, capture date, tree sha.
// ---------------------------------------------------------------------------
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const date = new Date().toISOString().slice(0, 10);
const rows = captured
  .sort((a, b) => a.file.localeCompare(b.file))
  .map((c) => `| ${c.file} | ${c.surface} | ${c.viewport} | ${date} | ${sha} |`)
  .join('\n');
fs.writeFileSync(
  `${OUT}/README.md`,
  `# Book of Deeds screenshot evidence

Captured by \`node scripts/deeds_screenshots.mjs\` against the offline world
(\`npm run dev\`), real play only: the earns, the equipped title, and the
watchlist all come from actual game actions. Regenerate by re-running the
script; names are stable so diffs stay legible.

Two tiers are committed as the PR evidence set, desktop 1600x900 and phone
landscape 844x390; the capture harness writes exactly these, so a fresh run
reproduces the tracked set.

| File | Surface | Viewport | Date | Tree |
|---|---|---|---|---|
${rows}
`,
);
console.log(`indexed ${captured.length} screenshots into ${OUT}/README.md`);

await page.close();
await browser.close();
console.log(fails.length === 0 ? '\nALL CAPTURES GREEN' : `\n${fails.length} FAILURES`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
