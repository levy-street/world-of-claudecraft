// Target-frame portrait screenshots: target a Wild Boar (family beast to paw
// crest) so we can eyeball the portrait fill/crispness + the portrait/bar
// overlap. LABEL=<name> names the output; TEMPLATE=<mobId> targets a different
// mob (e.g. an elite like elder_bristleback). Runs offline (needs `npm run dev`).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const LABEL = process.env.LABEL ?? 'before';
const MOBILE = process.env.MOBILE === '1';
const SECOND_BAR = process.env.SECOND_BAR === '1';
const XP_CURRENT = Number(process.env.XP_CURRENT ?? 250);
const RESTED_XP = Number(process.env.RESTED_XP ?? 50);
const PARTY_SHOT = process.env.PARTY_SHOT;
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    `--window-size=${MOBILE ? '932,430' : '1600,900'}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  // deviceScaleFactor: 2 reproduces the retina blur the report is about.
  defaultViewport: MOBILE
    ? {
        width: 932,
        height: 430,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      }
    : { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 30000 });
// JS-driven clicks: the auth panels fade in via transitions, so puppeteer's
// clickable-point check races them. Dispatching click directly is reliable.
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 500));
await page.type('#char-name', 'Thorgar');
await page.evaluate(() =>
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click(),
);
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => document.querySelector('#btn-start-offline').click());
try {
  if (MOBILE) {
    await page.waitForSelector('#mobile-preflight-continue', { visible: true, timeout: 30000 });
    await page.evaluate(() => document.querySelector('#mobile-preflight-continue').click());
  }
  await page.waitForFunction(
    () => {
      const button = document.querySelector('#ws-continue');
      return !button?.disabled;
    },
    { timeout: 30000, polling: 100 },
  );
  await page.evaluate(() => document.querySelector('#ws-continue')?.click());
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000, polling: 250 });
  await page.waitForFunction(
    () => (document.querySelector('#ui')?.getBoundingClientRect().width ?? 0) > 0,
    { timeout: 60000, polling: 250 },
  );
} catch (error) {
  const state = await page.evaluate(() => ({
    href: location.href,
    error: document.querySelector('#error-msg')?.textContent ?? '',
    offlineDisplay: getComputedStyle(document.querySelector('#offline-select')).display,
    gameReady: !!window.__game,
  }));
  await page.screenshot({ path: `tmp/tf_${LABEL}_boot_error.png` });
  console.error('boot state:', JSON.stringify(state));
  console.error(errors.slice(0, 15).join('\n'));
  throw error;
}
await page.evaluate(() => {
  document.querySelector('.camera-prompt-confirm')?.click();
  document.querySelector('.tut-skip')?.click();
  document.querySelector('.gpu-notice-dismiss')?.click();
});
if (SECOND_BAR) await page.evaluate(() => document.body.classList.add('show-actionbar2'));
await new Promise((r) => setTimeout(r, 300));

// The PR party matrix uses the development-only ?hudqa scenario already applied
// during boot. Capture its stable populated party region before the target-frame
// harness below changes the scenario.
if (PARTY_SHOT) {
  await page.waitForFunction(
    () => document.querySelectorAll('#party-frames .party-frame').length > 0,
    { timeout: 30000, polling: 100 },
  );
  await page.evaluate(() => {
    const firstFrame = document.querySelector('#party-frames .party-frame');
    if (firstFrame && getComputedStyle(firstFrame).display === 'none') {
      document.querySelector('#party-chip')?.click();
    }
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: PARTY_SHOT,
    clip: await paddedBounds('#party-frames', 8),
  });
  console.log(errors.length ? `ERRORS:\n${errors.slice(0, 15).join('\n')}` : 'no page errors');
  await browser.close();
  process.exit(0);
}

// No-target contract: the docked player frame owns the true screen centre instead
// of remaining stranded in the left half of the paired layout.
await page.evaluate(
  ({ xpCurrent, restedXp }) => {
    const { sim, hud } = window.__game;
    sim.xp = Math.max(0, xpCurrent);
    sim.restedXp = Math.max(0, restedXp);
    sim.targetEntity(null);
    hud.update();
  },
  { xpCurrent: XP_CURRENT, restedXp: RESTED_XP },
);
await new Promise((r) => setTimeout(r, 220));
const soloLayout = await page.evaluate(() => {
  const r = document.querySelector('#player-frame').getBoundingClientRect();
  return {
    targetId: window.__game.sim.player.targetId,
    targetAbsent: document.querySelector('#target-frame').classList.contains('unitframe-absent'),
    player: { x: r.x, y: r.y, width: r.width, height: r.height },
    centerDelta: r.x + r.width / 2 - window.innerWidth / 2,
  };
});
console.log('solo:', JSON.stringify(soloLayout));
if (!MOBILE && Math.abs(soloLayout.centerDelta) > 1) {
  throw new Error(`solo player frame is ${soloLayout.centerDelta.toFixed(2)}px off centre`);
}
await page.screenshot({ path: `tmp/tf_${LABEL}_solo.png` });
await page.screenshot({
  path: `tmp/tf_${LABEL}_solo_player_portrait_xp.png`,
  clip: await paddedBounds('#player-frame .portrait-wrap', 18),
});

const TEMPLATE = process.env.TEMPLATE ?? 'wild_boar';
const found = await page.evaluate((template) => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const boar = [...sim.entities.values()].find((e) => e.templateId === template);
  if (!boar) return { ok: false };
  p.maxHp = 999999;
  p.hp = 999999;
  p.pos.x = boar.pos.x + 3;
  p.pos.z = boar.pos.z + 3;
  p.pos.y = boar.pos.y;
  p.facing = Math.atan2(boar.pos.x - p.pos.x, boar.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  sim.targetEntity(boar.id);
  g.hud.update();
  return { ok: true, name: boar.name, level: boar.level, targetId: p.targetId };
}, TEMPLATE);
console.log('boar:', JSON.stringify(found));
await new Promise((r) => setTimeout(r, 1200));
// The first-run camera chooser can mount a beat after the world becomes ready.
// Dismiss it again here so late animation timing cannot obscure HUD captures.
await page.evaluate(() => document.querySelector('.camera-prompt-confirm')?.click());
await new Promise((r) => setTimeout(r, 120));
// Headless Chromium can leave CSS transitions at currentTime=0 while the page is
// backgrounded. Finish only the two frame-entry transitions so geometry/screenshots
// inspect the intended resting state, not the headless scheduler artifact.
await page.evaluate(() => {
  for (const selector of ['#player-frame', '#target-frame']) {
    for (const animation of document.querySelector(selector).getAnimations()) animation.finish();
  }
});

// Seed a representative premium-pass aura mix after the world has settled. This
// exercises quiet buffs, priority debuffs, the split target rows, radial sweeps,
// readable timers, stacks, own-aura emphasis, and the <=5s expiry state in one image.
const auraDemo = await page.evaluate(() => {
  const { sim, hud } = window.__game;
  const player = sim.player;
  const target = player.targetId === null ? null : sim.entities.get(player.targetId);
  if (!target) return { ok: false };
  const aura = (
    id,
    name,
    kind,
    remaining,
    duration,
    value,
    sourceId,
    school = 'physical',
    extra = {},
  ) => ({
    id,
    name,
    kind,
    remaining,
    duration,
    value,
    sourceId,
    school,
    ...extra,
  });
  player.auras.push(
    aura('battle_shout', 'Iron Bellow', 'buff_ap_pct', 87, 120, 10, player.id),
    aura('commanding_shout', 'Bolstering Cry', 'buff_sta', 47, 120, 11, player.id),
    aura('ironhold', 'Ironhold', 'shield_wall', 4.4, 8, 0.4, player.id),
    aura('demoralizing_shout', 'Direhowl', 'debuff_ap', 18, 30, 30, target.id),
    aura('rend', 'Deep Gash', 'dot', 4.2, 12, 12, target.id, 'physical', {
      tickInterval: 3,
      tickTimer: 3,
    }),
  );
  target.auras.push(
    aura('battle_shout', 'Savage Cry', 'buff_ap_pct', 72, 120, 10, target.id),
    aura('ironhold', 'Thick Hide', 'buff_armor', 4.8, 20, 50, target.id),
    aura('rend', 'Deep Gash', 'dot', 4.2, 12, 12, player.id, 'physical', {
      tickInterval: 3,
      tickTimer: 3,
    }),
    aura('sunder_armor', 'Armor Shear', 'sunder', 24, 30, 25, player.id, 'physical', {
      stacks: 3,
    }),
    aura('hamstring', 'Hamstring', 'slow', 7.5, 15, 0.5, player.id),
  );
  hud.update();
  return {
    ok: true,
    playerAuras: player.auras.length,
    targetAuras: target.auras.length,
  };
});
await new Promise((r) => setTimeout(r, 120));
const auraRows = await page.evaluate(() => {
  window.__game.hud.update();
  return {
    playerBuffs: document.querySelector('#buff-bar').childElementCount,
    playerDebuffs: document.querySelector('#debuff-bar').childElementCount,
    targetBuffs: document.querySelector('#tf-buffs').childElementCount,
    targetDebuffs: document.querySelector('#tf-debuffs').childElementCount,
  };
});
console.log('auras:', JSON.stringify({ ...auraDemo, ...auraRows }));
const layout = await page.evaluate(() => {
  const rect = (selector) => {
    const el = document.querySelector(selector);
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      borderRadius: getComputedStyle(el).borderRadius,
    };
  };
  const target = rect('#target-frame');
  const player = rect('#player-frame');
  const pairLeft = Math.min(player.x, target.x);
  const pairRight = Math.max(player.x + player.width, target.x + target.width);
  return {
    targetId: window.__game.sim.player.targetId,
    targetClass: document.querySelector('#target-frame').className,
    targetAbsentMatch: document
      .querySelector('#ui')
      .matches(':has(#target-frame.unitframe-absent)'),
    targetDisplay: getComputedStyle(document.querySelector('#target-frame')).display,
    playerClass: document.querySelector('#player-frame').className,
    playerInlineStyle: document.querySelector('#player-frame').getAttribute('style'),
    playerComputedLeft: getComputedStyle(document.querySelector('#player-frame')).left,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    target,
    player,
    xp: rect('#xpbar'),
    portrait: rect('#player-frame .portrait'),
    xpParent: document.querySelector('#xpbar')?.parentElement?.className ?? null,
    legacyXpStripCount: document.querySelectorAll('#actionbar-stack > #xpbar').length,
    actionbar: rect('#actionbar'),
    metrics: {
      gap: target.x - (player.x + player.width),
      topDelta: target.y - player.y,
      bottomDelta: target.y + target.height - (player.y + player.height),
      pairCenterDelta: (pairLeft + pairRight) / 2 - window.innerWidth / 2,
    },
  };
});
console.log('layout:', JSON.stringify(layout));
if (!MOBILE) {
  const failures = [];
  if (Math.abs(layout.metrics.topDelta) > 1.5)
    failures.push(`top delta ${layout.metrics.topDelta.toFixed(2)}px`);
  if (Math.abs(layout.metrics.pairCenterDelta) > 2)
    failures.push(`pair center delta ${layout.metrics.pairCenterDelta.toFixed(2)}px`);
  if (layout.metrics.gap < 8 || layout.metrics.gap > 16)
    failures.push(`pair gap ${layout.metrics.gap.toFixed(2)}px`);
  if (layout.xpParent !== 'portrait-wrap') failures.push(`XP parent ${layout.xpParent}`);
  if (layout.legacyXpStripCount !== 0)
    failures.push(`legacy XP strips ${layout.legacyXpStripCount}`);
  if (layout.portrait.borderRadius === '50%') failures.push('portrait is still circular');
  if (failures.length) throw new Error(`unit-frame pair geometry failed: ${failures.join(', ')}`);
}

async function paddedBounds(selector, pad) {
  return page.$eval(
    selector,
    (el, padding) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(r.x - padding)),
        y: Math.max(0, Math.floor(r.y - padding)),
        width: Math.ceil(r.width + padding * 2),
        height: Math.ceil(r.height + padding * 2),
      };
    },
    pad,
  );
}

async function unionBounds(selectors, pad) {
  return page.evaluate(
    (items, padding) => {
      const rects = items
        .map((selector) => document.querySelector(selector)?.getBoundingClientRect())
        .filter((rect) => rect && rect.width > 0 && rect.height > 0);
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      return {
        x: Math.max(0, Math.floor(left - padding)),
        y: Math.max(0, Math.floor(top - padding)),
        width: Math.ceil(right - left + padding * 2),
        height: Math.ceil(bottom - top + padding * 2),
      };
    },
    selectors,
    pad,
  );
}

// Element-relative clips keep this harness valid when the default HUD layout moves.
await page.screenshot({
  path: `tmp/tf_${LABEL}_frame.png`,
  clip: await paddedBounds('#target-frame', 12),
});
await page.screenshot({
  path: `tmp/tf_${LABEL}_portrait.png`,
  clip: await paddedBounds('#target-frame .portrait-wrap', 12),
});
await page.screenshot({
  path: `tmp/tf_${LABEL}_player_portrait_xp.png`,
  clip: await paddedBounds('#player-frame .portrait-wrap', 18),
});
// Full HUD: compare the centered desktop pair and the intentionally separated
// mobile anchors against the action controls they must clear.
await page.screenshot({ path: `tmp/tf_${LABEL}_full.png` });
await page.screenshot({
  path: `tmp/tf_${LABEL}_auras.png`,
  clip: await unionBounds(
    [
      '#player-frame',
      '#target-frame',
      '#tf-target-target',
      '#buff-bar',
      '#debuff-bar',
      '#tf-buffs',
      '#tf-debuffs',
    ],
    14,
  ),
});
// Player frame (bottom-centre): portrait on the LEFT, the mirror of the target
// frame and the layout the user accepts.
await page.screenshot({
  path: `tmp/tf_${LABEL}_playerframe.png`,
  clip: await paddedBounds('#player-frame', 12),
});

// Trigger one real health transition so the critical frame, damage trail, and
// accessibility value are verified from the same live HUD path as combat.
await page.evaluate(() => {
  const { sim, hud } = window.__game;
  sim.player.maxHp = 1000;
  sim.player.hp = 200;
  hud.update();
});
await new Promise((r) => setTimeout(r, 90));
await page.screenshot({
  path: `tmp/tf_${LABEL}_playercritical.png`,
  clip: await paddedBounds('#player-frame', 16),
});

console.log(errors.length ? `ERRORS:\n${errors.slice(0, 15).join('\n')}` : 'no page errors');
await browser.close();
