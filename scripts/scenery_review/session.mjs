import fs from 'node:fs';
import { enterOfflineGame } from '../enter_offline_game.mjs';
import { configure } from './helpers.mjs';

const manifest = JSON.parse(fs.readFileSync('tmp/scenery-review/build/.vite/manifest.json'));

export async function enter(page, origin, tier, updated) {
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('woc.cameraModePrompt.shown', '1');
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ graphicsPreset: 1, renderScale: 1, frameRateCap: 1 }),
    );
  });
  const query = new URLSearchParams({
    gfx: tier,
    governor: 'off',
    shaderwarm: 'off',
    cel: 'on',
    shaderdebug: '1',
    celbands: '3',
    celink: '0.5',
    celinkwidth: '0.65',
    celmid: '0.65',
    celsat: '1.05',
    gfxo: `${tier === 'low' ? 'fxaa:0,coconutCellSize:128,' : ''}sceneryDetail:${updated ? 1 : 0}`,
  });
  await page.goto(`${origin}/?${query}`, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({
    type: 'module',
    url: `${origin}/${manifest['scripts/scenery_review/hooks.ts'].file}`,
  });
  await page.waitForFunction(() => window.__sceneryDetailSnapshot);
  if (
    !(await enterOfflineGame(page, {
      charName: 'SceneryReview',
      charClass: 'warrior',
      selectorTimeoutMs: 120000,
      gameBootTimeoutMs: 180000,
    }))
  )
    throw Error('Game entry failed');
  await configure(page);
}

export async function audit(page) {
  return page.evaluate(() => {
    let identityFailures = 0;
    window.__game.renderer.scene.traverse((node) => {
      if (node.name?.startsWith('scenery-detail:') && node.material !== node.parent.material)
        identityFailures++;
    });
    return {
      snapshot: window.__celDecision.snapshot(),
      detail: window.__sceneryDetailSnapshot(),
      identityFailures,
    };
  });
}
