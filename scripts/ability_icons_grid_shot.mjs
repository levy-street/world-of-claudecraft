// Screenshot harness for the unique-ability-icons change.
// Renders every class ability's procedural icon in a labeled grid (grouped by
// class), plus a focused panel of the formerly-colliding groups so the
// before/after distinctness is obvious. Pure-icon render, no game boot needed.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
// ?gfx=ultra requested for parity with "max graphics" capture sessions.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1700,2200', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1700, height: 2200, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

// Formerly-colliding fallback groups (see tests/ability_icons.test.ts), the
// whole point of the change is that each member now renders differently.
const COLLISION_GROUPS = [
  ['summon_imp', 'summon_voidwalker', 'summon_succubus', 'summon_felhunter', 'summon_felguard', 'summon_doomguard'],
  ['defensive_stance', 'stealth', 'cat_form', 'prowl', 'berserker_rage'],
  ['execute', 'slam', 'mortal_strike', 'whirlwind'],
  ['taunt', 'maul', 'growl', 'bloodthirst'],
  ['consecration', 'righteous_fury', 'retribution_aura'],
  ['dismiss_pet', 'revive_pet', 'ghost_wolf'],
  ['sunder_armor', 'shield_slam'],
  ['conjure_food', 'arcane_explosion'],
  ['kidney_shot', 'aimed_shot'],
  ['heal', 'flash_heal'],
  ['rake', 'claw'],
];

await page.evaluate(async (collisionGroups) => {
  const [{ iconDataUrl }, { CLASSES, ABILITIES }] = await Promise.all([
    import('/src/ui/icons.ts'),
    import('/src/sim/content/classes.ts'),
  ]);
  document.body.innerHTML = '';
  document.title = 'Ability icons';
  const root = document.createElement('div');
  root.style.cssText =
    'background:#15110c;color:#e9dcc0;font:14px system-ui;padding:28px;min-height:100vh;' +
    'background-image:radial-gradient(circle at 30% 0%,#241a10,#0d0a06);';
  document.body.style.margin = '0';
  document.body.appendChild(root);

  const title = document.createElement('h1');
  title.textContent = 'World of ClaudeCraft: unique icon for every class ability';
  title.style.cssText = 'font:700 26px Georgia,serif;color:#d4af37;margin:0 0 4px';
  root.appendChild(title);
  const sub = document.createElement('div');
  const total = Object.values(CLASSES).reduce((n, c) => n + c.abilities.length, 0);
  sub.textContent = `${total} abilities across ${Object.keys(CLASSES).length} classes, all distinct, hand-authored recipes`;
  sub.style.cssText = 'color:#b9a87e;margin:0 0 22px';
  root.appendChild(sub);

  const cell = (id) => {
    const c = document.createElement('div');
    c.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:96px;gap:4px';
    const img = document.createElement('img');
    img.src = iconDataUrl('ability', id, 192);
    img.width = 64; img.height = 64;
    img.style.cssText = 'border-radius:8px;border:1px solid #3a2c18;box-shadow:0 2px 6px #0008';
    const lbl = document.createElement('div');
    lbl.textContent = (ABILITIES[id]?.name) ?? id;
    lbl.style.cssText = 'font-size:11px;color:#cdbb8e;text-align:center;line-height:1.15';
    c.appendChild(img); c.appendChild(lbl);
    return c;
  };

  // Section 1: formerly-colliding groups, one row each
  const h2a = document.createElement('h2');
  h2a.textContent = 'Formerly identical, now distinct';
  h2a.style.cssText = 'font:600 18px Georgia,serif;color:#e8c969;margin:6px 0 10px';
  root.appendChild(h2a);
  for (const grp of collisionGroups) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;padding:8px 10px;margin-bottom:6px;' +
      'background:#1d1610;border:1px solid #2c2114;border-radius:10px';
    for (const id of grp) row.appendChild(cell(id));
    root.appendChild(row);
  }

  // Section 2: every class, every ability
  const h2b = document.createElement('h2');
  h2b.textContent = 'All abilities by class';
  h2b.style.cssText = 'font:600 18px Georgia,serif;color:#e8c969;margin:26px 0 10px';
  root.appendChild(h2b);
  for (const [cls, def] of Object.entries(CLASSES)) {
    const h3 = document.createElement('h3');
    h3.textContent = `${def.name ?? cls}  (${def.abilities.length})`;
    h3.style.cssText = 'font:600 15px Georgia,serif;color:#d4af37;margin:14px 0 6px;border-bottom:1px solid #2c2114;padding-bottom:4px';
    root.appendChild(h3);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    for (const id of def.abilities) grid.appendChild(cell(id));
    root.appendChild(grid);
  }
  // wait for all icon imgs to decode
  await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));
}, COLLISION_GROUPS);

await sleep(800);
await page.screenshot({ path: 'tmp/ability-icons-grid.png', fullPage: true });

// focused crop of just the collision-groups section
const box = await page.evaluate(() => {
  const r = document.body.getBoundingClientRect();
  return { x: 0, y: 0, width: Math.min(1700, r.width), height: 900 };
});
await page.screenshot({ path: 'tmp/ability-icons-collisions.png', clip: box });

await browser.close();
console.log('done -> tmp/ability-icons-grid.png, tmp/ability-icons-collisions.png');
