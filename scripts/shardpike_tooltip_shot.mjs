// Visual proof of the Shardpike verbs' hover cards (src/ui/hud/shardpike/shardpike_tooltip.ts).
//
// Boots the offline game, equips the pike (the bar's whole visibility rule), and hovers each
// verb in two fight states, printing the shared #tooltip box's text and clipping a shot of
// each card. The states matter more than the prose: two of the three verbs are illegal most
// of the time by design, so the card's red reason line is what the capture is really for.
//   node scripts/shardpike_tooltip_shot.mjs    (needs `npm run dev` on :5173)
//   OUT_DIR=... to redirect the shots (default docs/screenshots/balgath-shardpike)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const OUT = process.env.OUT_DIR ?? 'docs/screenshots/balgath-shardpike';
const URL = 'http://localhost:5173';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// networkidle0, and it is load-bearing rather than habit: the entry page finishes its own
// async bootstrap (lazy locale overlay, graphics detection) after DOMContentLoaded, and
// clicking Offline before that lands on a button whose handler cannot complete. The menu
// closes, no error is raised anywhere, and the game simply never constructs, which then
// reads as a product bug 40 seconds later. Generous timeout: under swiftshader on a busy
// machine the title screen genuinely takes tens of seconds to settle.
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
await page.waitForSelector('#btn-offline', { timeout: 30000 });
// Gate every step on the element it needs, never on elapsed time. With domcontentloaded the
// offline button EXISTS before its handler is wired, so a timed click lands on nothing, the
// panel never opens, and the failure surfaces 40s later as "no player" with no error at all.
await jsClick('#btn-offline');
await page.waitForSelector('#char-name', { visible: true, timeout: 30000 });
await page.type('#char-name', 'Piker');
await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', {
  visible: true,
  timeout: 30000,
});
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await page.waitForSelector('#btn-start-offline', { visible: true, timeout: 30000 });
await jsClick('#btn-start-offline');
// Generous: this boots under swiftshader, and on a machine that has just run the suite the
// first offline world can take well over a minute to construct.
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 180000 });
await wait(2000);
// Clear the first-run overlays. There are two and they are NOT the same button: the
// new-adventurer tutorial ("skip tutorial") and the mouse-camera prompt ("confirm"), and the
// second one sits exactly where the bar's tooltip appears.
for (const pattern of [/skip tutorial/i, /^confirm$/i]) {
  await page.evaluate(
    (src) => {
      const re = new RegExp(src[0], src[1]);
      const btn = [...document.querySelectorAll('button')].find((b) =>
        re.test((b.textContent || '').trim()),
      );
      btn?.click();
    },
    [pattern.source, pattern.flags],
  );
  await wait(400);
}
await page.keyboard.press('Escape');
await wait(400);

// Equip the pike: that alone is the bar's whole visibility rule.
const equipped = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.addItem('skerrits_shardpike', 1, sim.player.id);
  sim.equipItem('skerrits_shardpike');
  return { mainhand: sim.equipment.mainhand, buttons: 0 };
});
console.log('equipped:', JSON.stringify(equipped));
// Wait for real GEOMETRY, not just for the elements to exist. The buttons enter the DOM
// several seconds before the HUD subtree is laid out, and hovering in that window measures
// a 0x0 button, positions the card at the origin, and photographs an empty box.
await page.waitForFunction(
  () => {
    const btns = document.querySelectorAll('#shardpike-bar .pike-btn');
    return btns.length === 3 && btns[0].getBoundingClientRect().width > 0;
  },
  { timeout: 60000 },
);

async function hover(index, label, shot) {
  await page.mouse.move(10, 10);
  await wait(150);
  const geom = await page.evaluate((i) => {
    const btn = document.querySelectorAll('#shardpike-bar .pike-btn')[i];
    const b = btn.getBoundingClientRect();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    }
    return { disabled: btn.getAttribute('aria-disabled'), title: btn.getAttribute('title') };
  }, index);
  await wait(250);
  const tip = await page.evaluate(() => {
    const tt = document.querySelector('#tooltip');
    const b = tt.getBoundingClientRect();
    return {
      shown: tt.style.display === 'block',
      text: tt.innerText.replace(/\n/g, ' || '),
      red: [...tt.querySelectorAll('.tt-red')].map((e) => e.textContent),
      box: { x: b.x, y: b.y, w: b.width, h: b.height },
    };
  });
  console.log(`\n[${label}] disabled=${geom.disabled} title=${JSON.stringify(geom.title)}`);
  console.log(`  shown=${tip.shown} red=${JSON.stringify(tip.red)}`);
  console.log(`  text=${tip.text}`);
  // Park the box at a known on-screen spot purely to photograph it: at the hover point it
  // straddles the viewport edge and a clip there cuts the card in half. Content and size
  // are untouched, and the position logic is separately pinned in tests/tooltip_attach.
  const box = await page.evaluate(() => {
    const tt = document.querySelector('#tooltip');
    tt.style.left = '60px';
    tt.style.top = '120px';
    const b = tt.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  console.log(`  box=${JSON.stringify(box)}`);
  const pad = 12;
  await page.screenshot({
    path: `${OUT}/${shot}`,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: Math.min(1600 - Math.max(0, box.x - pad), box.w + pad * 2),
      height: Math.min(900 - Math.max(0, box.y - pad), box.h + pad * 2),
    },
  });
  return tip;
}

console.log('\n=== idle: nothing couched ===');
await hover(0, 'brace idle', 'card-brace-ready-desktop.png');
await hover(1, 'thrust idle', 'card-thrust-not-set-desktop.png');
await hover(2, 'release idle', 'card-release-nothing-couched-desktop.png');

// Couch it. The brace ends on any velocity or airborne state, so pin the body still.
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.player.onGround = true;
  sim.player.vx = sim.player.vy = sim.player.vz = 0;
  sim.lanceBrace();
});
await wait(600);
const phase = await page.evaluate(() => window.__game.sim.lanceTrial?.phase ?? null);
console.log(`\n=== couched (phase=${phase}) ===`);
await hover(0, 'brace couched', 'card-brace-already-couched-desktop.png');
await hover(2, 'release couched', 'card-release-ready-desktop.png');

// Whole-bar context shot with a card up.
await page.mouse.move(10, 10);
await wait(150);
await page.evaluate(() => {
  const btn = document.querySelectorAll('#shardpike-bar .pike-btn')[1];
  const b = btn.getBoundingClientRect();
  for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
    btn.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        clientX: b.x + b.width / 2,
        clientY: b.y + b.height / 2,
      }),
    );
  }
});
await wait(300);
// Framed from the LIVE geometry of both boxes rather than hardcoded: the bar sits wherever
// the action-bar stack puts it, and a fixed clip photographed an empty patch of grass.
const frame = await page.evaluate(() => {
  const bar = document.querySelector('#shardpike-bar').getBoundingClientRect();
  const tt = document.querySelector('#tooltip').getBoundingClientRect();
  const pad = 24;
  const left = Math.max(0, Math.min(bar.left, tt.left) - pad);
  const top = Math.max(0, Math.min(bar.top, tt.top) - pad);
  return {
    x: left,
    y: top,
    width: Math.min(window.innerWidth - left, Math.max(bar.right, tt.right) + pad - left),
    height: Math.min(window.innerHeight - top, Math.max(bar.bottom, tt.bottom) + pad - top),
  };
});
console.log(`context frame=${JSON.stringify(frame)}`);
await page.screenshot({ path: `${OUT}/card-in-context-desktop.png`, clip: frame });
await browser.close();
console.log('\ndone');
