// Deterministic screenshot harness for the mobile custom HUD layout editor.
// Needs `npm run dev`. The initial harness captures the current offline HUD;
// later plan tasks extend the same public options to drive editor scenes.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = `Usage: node scripts/mobile_hud_editor_shots.mjs [options]

Options:
  --viewport <width>x<height>  Landscape CSS viewport (default: 740x360)
  --handedness <right|left>    HUD handedness (default: right)
  --scene <scene-id>           Canonical editor scene (default: world)
  --safe-area <fixture>        Safe-area fixture (default: none)
  --output <path.png>          Required screenshot output path
  --url <url>                  Offline game URL (default: http://localhost:5173/)
  --help                       Show this help

Safe-area fixtures:
  none, left-50, right-50, bilateral-50, bottom-24,
  left-50-bottom-24, right-50-bottom-24, bilateral-50-bottom-24

Scenes:
  world, arena.standard, arena.fiesta, arena.yumi, vale_cup.briefing,
  vale_cup.match, vale_cup.spectator, instance.delve
`;

export const MOBILE_HUD_EDITOR_SHOT_SAFE_AREAS = Object.freeze({
  none: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
  'left-50': Object.freeze({ top: 0, right: 0, bottom: 0, left: 50 }),
  'right-50': Object.freeze({ top: 0, right: 50, bottom: 0, left: 0 }),
  'bilateral-50': Object.freeze({ top: 0, right: 50, bottom: 0, left: 50 }),
  'bottom-24': Object.freeze({ top: 0, right: 0, bottom: 24, left: 0 }),
  'left-50-bottom-24': Object.freeze({ top: 0, right: 0, bottom: 24, left: 50 }),
  'right-50-bottom-24': Object.freeze({ top: 0, right: 50, bottom: 24, left: 0 }),
  'bilateral-50-bottom-24': Object.freeze({ top: 0, right: 50, bottom: 24, left: 50 }),
});

const SCENES = new Set([
  'world',
  'arena.standard',
  'arena.fiesta',
  'arena.yumi',
  'vale_cup.briefing',
  'vale_cup.match',
  'vale_cup.spectator',
  'instance.delve',
]);

const IGNORED_CONSOLE = /502|Bad Gateway|fetch project stats/i;
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) throw new Error(`invalid viewport: ${value}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width <= height || height < 1)
    throw new Error(`viewport must be positive landscape: ${value}`);
  return { width, height };
}

function defaultDsf(width, height) {
  if (width >= 1000 || height >= 700) return 2;
  return 3;
}

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

export function parseMobileHudEditorShotArgs(args) {
  if (args.includes('--help')) return { help: true };
  const viewport = parseViewport(optionValue(args, '--viewport', '740x360'));
  const handedness = optionValue(args, '--handedness', 'right');
  const scene = optionValue(args, '--scene', 'world');
  const safeAreaFixture = optionValue(args, '--safe-area', 'none');
  const output = optionValue(args, '--output', '');
  const url = optionValue(args, '--url', process.env.URL || 'http://localhost:5173/');
  if (handedness !== 'right' && handedness !== 'left') {
    throw new Error(`invalid handedness: ${handedness}`);
  }
  if (!SCENES.has(scene)) throw new Error(`invalid scene: ${scene}`);
  if (!(safeAreaFixture in MOBILE_HUD_EDITOR_SHOT_SAFE_AREAS)) {
    throw new Error(`invalid safe-area fixture: ${safeAreaFixture}`);
  }
  if (!output.endsWith('.png')) throw new Error('--output must name a PNG file');
  return {
    ...viewport,
    deviceScaleFactor: defaultDsf(viewport.width, viewport.height),
    handedness,
    scene,
    safeAreaFixture,
    output,
    url,
  };
}

async function applySafeArea(page, client, fixtureName) {
  const insets = MOBILE_HUD_EDITOR_SHOT_SAFE_AREAS[fixtureName];
  await client.send('Emulation.setSafeAreaInsetsOverride', { insets });
  const resolvedInsets = await page.evaluate(async () => {
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
    document.body.appendChild(probe);
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
    );
    const style = getComputedStyle(probe);
    const resolved = {
      top: Number.parseFloat(style.paddingTop),
      right: Number.parseFloat(style.paddingRight),
      bottom: Number.parseFloat(style.paddingBottom),
      left: Number.parseFloat(style.paddingLeft),
    };
    probe.remove();
    return resolved;
  });
  for (const side of ['top', 'right', 'bottom', 'left']) {
    if (Math.abs(resolvedInsets[side] - insets[side]) > 0.5) {
      throw new Error(
        `${fixtureName} resolved ${side}=${resolvedInsets[side]}, expected ${insets[side]}`,
      );
    }
  }
  return resolvedInsets;
}

export async function captureMobileHudEditorShot(options) {
  const [{ default: puppeteer }, { BROWSER_PATH }, { enterOfflineGame }] = await Promise.all([
    import('puppeteer-core'),
    import('./browser_path.mjs'),
    import('./enter_offline_game.mjs'),
  ]);
  const failures = [];
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => failures.push(`pageerror: ${String(error).slice(0, 240)}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) {
        failures.push(`console error: ${message.text().slice(0, 240)}`);
      }
    });
    await page.setViewport({
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });
    const client = await page.createCDPSession();
    await client.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.evaluateOnNewDocument((handedness) => {
      const settings = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
      localStorage.setItem(
        'woc_settings',
        JSON.stringify({
          ...settings,
          interfaceMode: 2,
          leftHandedTouch: handedness === 'left',
        }),
      );
      localStorage.setItem('woc.tutorial.v1', 'done');
    }, options.handedness);
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'HudEditorShot',
      settleMs: 1500,
    });
    await page.evaluate(() => document.querySelector('.tut-skip')?.click());
    const resolvedSafeArea = await applySafeArea(page, client, options.safeAreaFixture);
    await page.evaluate(
      ({ scene }) => {
        window.__game?.hud?.closeAll?.();
        document.body.classList.add('mobile-touch', 'game-active');
        document.body.dataset.mobileHudEditorShotScene = scene;
        window.dispatchEvent(new Event('resize'));
        window.__game?.hud?.update?.(0.05);
      },
      { handedness: options.handedness, scene: options.scene },
    );
    await page.waitForFunction(
      () => {
        const attack = document.getElementById('mobile-action-attack');
        return !!attack && attack.getBoundingClientRect().width > 0;
      },
      { timeout: 12000 },
    );
    await page.evaluate(
      ({ scene, failing }) => {
        const contextByScene = {
          world: 'world.base',
          'arena.standard': 'arena.standard',
          'arena.fiesta': 'arena.fiesta.base',
          'arena.yumi': 'arena.yumi.base',
          'vale_cup.briefing': 'vale_cup.briefing',
          'vale_cup.match': 'vale_cup.match',
          'vale_cup.spectator': 'vale_cup.spectator.betting',
          'instance.delve': 'instance.delve',
        };
        const editor = window.__game?.mobileHudEditor;
        editor?.open();
        editor?.setContext(contextByScene[scene]);
        editor?.setLocked(false);
        editor?.selectSurface('action.attack');
        if (failing) {
          const draft = editor?.draft;
          const placements = draft?.document.profiles[draft.activeProfileId];
          const attack = placements?.['action.attack'];
          const actionA2 = placements?.['action.a2'];
          if (placements && attack && actionA2) {
            placements['action.attack'] = { ...attack, ...actionA2 };
            editor.refreshGeometry();
          }
        }
      },
      { scene: options.scene, failing: options.output.includes('failing-layout') },
    );
    await page.waitForSelector('.mobile-hud-editor', { visible: true });
    await sleep(500);
    mkdirSync(dirname(options.output), { recursive: true });
    await page.screenshot({ path: options.output, captureBeyondViewport: false });
    if (failures.length > 0) throw new Error(failures.join('\n'));
    return {
      output: options.output,
      viewport: { width: options.width, height: options.height },
      handedness: options.handedness,
      scene: options.scene,
      safeAreaFixture: options.safeAreaFixture,
      safeArea: resolvedSafeArea,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseMobileHudEditorShotArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const result = await captureMobileHudEditorShot(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) await main();
