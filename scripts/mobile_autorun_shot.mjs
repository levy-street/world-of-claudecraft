// Verify and screenshot joystick-owned mobile Autorun in offline mode.
// Needs `npm run dev` on :5173. No server/Postgres required (offline flow).
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || '/tmp/woc-autorun';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
const cdp = await page.target().createCDPSession();
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });

await page.goto(URL, { waitUntil: 'networkidle2' });
await sleep(800);

// Offline flow: #btn-offline -> pick a class -> name -> start
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Trailblazer', settleMs: 3500 });
await page.waitForFunction(
  () =>
    !!window.__game?.input &&
    !!document.getElementById('mobile-move-zone') &&
    !!document.getElementById('mobile-move-joystick') &&
    !!document.getElementById('mobile-autorun-target'),
  { timeout: 30000 },
);
await page.evaluate(() => {
  // Chromium's coarse-pointer emulation is not reflected consistently in the
  // body class after a cold dependency optimization. Match the canonical HUD
  // geometry gates and make the touch shell explicit before measuring it.
  document.body.classList.add('mobile-touch', 'game-active');
  window.dispatchEvent(new Event('resize'));
});
await page.waitForFunction(
  () => (document.getElementById('mobile-move-joystick')?.getBoundingClientRect().width ?? 0) > 0,
  { timeout: 12000 },
);
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(250);

async function shot(name) {
  await page.screenshot({ path: `${OUT}-${name}.png` });
  console.log('wrote', `${OUT}-${name}.png`);
}

// Autorun OFF (default).
await shot('off');

// Push the movement joystick through the round target, then release. Autorun
// must stay latched and the target must remain locked without a standalone
// button or a collision with the compact HUD clusters.
const result = await page.evaluate(() => {
  const moveZone = document.getElementById('mobile-move-zone');
  const joystick = document.getElementById('mobile-move-joystick');
  const target = document.getElementById('mobile-autorun-target');
  if (!moveZone || !joystick || !target || !window.__game?.input) {
    return {
      error: 'missing move zone, joystick, Autorun target, or game input',
      missing: {
        moveZone: !moveZone,
        joystick: !joystick,
        target: !target,
        game: !window.__game,
        input: !window.__game?.input,
      },
    };
  }

  const joystickRect = joystick.getBoundingClientRect();
  const startX = joystickRect.left + joystickRect.width / 2;
  const startY = joystickRect.top + joystickRect.height / 2;
  const lockY = startY - joystickRect.height * 1.2;
  const pointerId = 4242;
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

  fire(moveZone, 'pointerdown', startY, 1);
  fire(moveZone, 'pointermove', lockY, 1);
  fire(window, 'pointerup', lockY, 0);

  const grab = (element) => {
    if (!element || getComputedStyle(element).display === 'none') return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  };

  return {
    autorun: window.__game.input.autorun,
    near: target.classList.contains('near'),
    locked: target.classList.contains('locked'),
    parent: target.parentElement?.id ?? null,
    standalone: !!document.getElementById('mobile-autorun'),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    target: grab(target),
    map: grab(document.getElementById('minimap-wrap')),
    consumables: grab(document.getElementById('mobile-consumables')),
    actionPad: grab(document.getElementById('mobile-action-ring')),
  };
});

if (result.error) throw new Error(`${result.error}: ${JSON.stringify(result.missing)}`);
const overlaps = (a, b) =>
  !!a &&
  !!b &&
  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
if (!result.autorun || !result.near || !result.locked) {
  throw new Error(`joystick Autorun did not lock: ${JSON.stringify(result)}`);
}
if (result.parent !== 'mobile-move-joystick' || result.standalone) {
  throw new Error(`Autorun ownership is incorrect: ${JSON.stringify(result)}`);
}
if (
  !result.target ||
  result.target.left < 0 ||
  result.target.top < 0 ||
  result.target.right > result.viewport.width ||
  result.target.bottom > result.viewport.height
) {
  throw new Error(`Autorun target leaves the viewport: ${JSON.stringify(result)}`);
}
for (const [name, rect] of [
  ['map', result.map],
  ['Consumables', result.consumables],
  ['action pad', result.actionPad],
]) {
  if (overlaps(result.target, rect)) {
    throw new Error(`Autorun target overlaps ${name}: ${JSON.stringify(result)}`);
  }
}

await sleep(500);
await shot('locked');
console.log('PASS joystick Autorun locked without compact-HUD collisions');

await browser.close();
