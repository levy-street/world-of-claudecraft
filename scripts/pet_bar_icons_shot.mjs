// Screenshot harness for the pet-bar icon fix.
// Renders the pet command bar icons before/after: the borrowed class-ability art
// next to the new dedicated icons, so the de-duplication and the Feed Pet rename
// are obvious. Pure-icon render, no game boot needed.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1200,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

await page.evaluate(async () => {
  const { iconDataUrl } = await import('/src/ui/icons.ts');
  document.body.innerHTML = '';
  document.title = 'Pet bar icons';
  document.body.style.margin = '0';
  const root = document.createElement('div');
  root.style.cssText =
    'background:#15110c;color:#e9dcc0;font:14px system-ui;padding:30px;min-height:100vh;' +
    'background-image:radial-gradient(circle at 30% 0%,#241a10,#0d0a06);';
  document.body.appendChild(root);

  const h1 = document.createElement('h1');
  h1.textContent = 'World of ClaudeCraft: pet bar icons no longer duplicate class skills';
  h1.style.cssText = 'font:700 24px Georgia,serif;color:#d4af37;margin:0 0 18px';
  root.appendChild(h1);

  const cell = (id, label, note) => {
    const c = document.createElement('div');
    c.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:128px;gap:5px';
    const img = document.createElement('img');
    img.src = iconDataUrl('ability', id, 192);
    img.width = 72; img.height = 72;
    img.style.cssText = 'border-radius:8px;border:1px solid #3a2c18;box-shadow:0 2px 6px #0008';
    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:12px;color:#cdbb8e;text-align:center;line-height:1.2;font-weight:600';
    const nt = document.createElement('div');
    nt.textContent = note;
    nt.style.cssText = 'font-size:10px;color:#9a8b62;text-align:center;line-height:1.15';
    c.appendChild(img); c.appendChild(lbl); c.appendChild(nt);
    return c;
  };

  const rows = [
    ['Hunter: Heal Pet (before) to Feed Pet (after)', [
      ['rejuvenation', 'Heal Pet (old)', 'Druid rejuvenation leaf'],
      ['feed_pet', 'Feed Pet (new)', 'dedicated roasted haunch'],
    ]],
    ['Hunter: aggressive pet stance', [
      ['rapid_fire', 'Aggressive (old)', 'reused Hunter rapid_fire'],
      ['pet_aggressive', 'Aggressive (new)', 'dedicated fang'],
    ]],
    ['Warlock: heal demon', [
      ['drain_life', 'Heal Demon (old)', 'reused Warlock drain_life'],
      ['mend_demon', 'Heal Demon (new)', 'dedicated fel mend'],
    ]],
    ['Unchanged pet actions', [
      ['attack', 'Attack', ''],
      ['growl', 'Taunt', ''],
      ['prowl', 'Passive', ''],
      ['defensive_stance', 'Defensive', ''],
    ]],
  ];

  for (const [title, cells] of rows) {
    const h2 = document.createElement('h2');
    h2.textContent = title;
    h2.style.cssText = 'font:600 16px Georgia,serif;color:#e8c969;margin:18px 0 8px';
    root.appendChild(h2);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;padding:12px 14px;' +
      'background:#1d1610;border:1px solid #2c2114;border-radius:10px';
    for (const [id, label, note] of cells) row.appendChild(cell(id, label, note));
    root.appendChild(row);
  }
  await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));
});

await sleep(700);
await page.screenshot({ path: 'tmp/pet-bar-icons.png', fullPage: true });
await browser.close();
console.log('done -> tmp/pet-bar-icons.png');
