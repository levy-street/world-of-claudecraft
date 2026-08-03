// Screenshots for the professions packet's final third: the Delve Marks route
// to the crafted top tools, the slotted tool-effect row in the Professions
// window, and the rod tooltip's rarity-widened reel number.
//
// Offline client only. The middle frame's state is live-reachable now: the
// acquisition craft ships crafted charms and the slot command consumes one
// (resolveSlotToolEffect), so this script grants the charm before slotting,
// exactly the price a live player pays.
//
// Every capture verifies its own frame before writing: a shot that photographs
// an empty window, a refusal or a banner is worse than none, so each step
// throws rather than leaving a plausible-looking PNG behind.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

// localhost, never 127.0.0.1: Vite binds ::1 only here, so the v4 literal
// silently connects to nothing.
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/prof-tool-effects';
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1600, height: 900 };
// LANDSCAPE. The game is landscape-only in play (the rotate-device gate paints
// over everything in portrait), so a portrait viewport captures the gate rather
// than the HUD.
const MOBILE = { width: 932, height: 430, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Everything that can paint OVER a subject: the shared item tooltip (a hover
// left over from scrolling a list), the first-tier tutorial modal, and any
// celebration banner still burning. Run before every capture. A DOM-only
// assertion does not see these, which is how a first pass produced a frame
// whose checks passed and whose image was a tutorial dialog.
async function clearOverlays(page) {
  await page.mouse.move(2, 2);
  await page.evaluate(() => {
    document.querySelector('#profession-tutorial [data-close]')?.click();
    document.getElementById('profession-tutorial')?.remove();
    const tip = document.getElementById('tooltip');
    if (tip) tip.style.display = 'none';
    const banner = document.getElementById('banner');
    if (banner) banner.style.display = 'none';
  });
  await wait(150);
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: DESKTOP,
});

// Capture by RECT rather than by element handle. The professions window
// rebuilds its whole innerHTML on the 500 ms refresh band, so a handle taken
// before the screenshot is routinely detached by the time puppeteer scrolls it
// into view ("Node is detached from document"). Reading the rect and clipping
// the page is immune to that.
async function shoot(page, selector, name) {
  const rect = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, selector);
  if (!rect) throw new Error(`${name}: ${selector} is not in the DOM`);
  if (rect.width < 40 || rect.height < 40) {
    throw new Error(`${name}: ${selector} has no usable box (${JSON.stringify(rect)})`);
  }
  const vp = page.viewport();
  const clip = {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.min(Math.ceil(rect.width), vp.width - Math.max(0, Math.floor(rect.x))),
    height: Math.min(Math.ceil(rect.height), vp.height - Math.max(0, Math.floor(rect.y))),
  };
  await page.screenshot({ path: `${OUT}/${name}.png`, clip });
  console.log(`  wrote ${name}.png  (${clip.width}x${clip.height})`);
}

/** Open the Drowned Litany board on its shop tab and prove the tool rows are there. */
async function delveShop(page, label) {
  const setup = await page.evaluate(() => {
    const game = window.__game;
    const sim = game?.sim;
    if (!sim?.player) return { ok: false, reason: 'no offline world' };
    // The Heroic rung is what gates the tier-5 tools, so a shot taken without
    // it would show four locked rows and claim to show the route.
    const meta = sim.meta(sim.playerId);
    meta.delveClears = { 'drowned_litany:normal': 3, 'drowned_litany:heroic': 1 };
    meta.delveMarks = 500;
    const npc = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'brother_halven_marsh',
    );
    if (!npc) return { ok: false, reason: 'Brother Halven (marsh) not spawned' };
    game.hud.openDelveBoard(npc.id);
    const tab = document.querySelector('#delve-board [data-board-tab="shop"]');
    if (!tab) return { ok: false, reason: 'no shop tab' };
    tab.click();
    return { ok: true };
  });
  if (!setup.ok) throw new Error(`delve shop setup failed: ${setup.reason}`);
  await wait(300);
  // The claim this frame makes: all eight crafted tools are stocked, and both
  // price rungs are visible.
  const seen = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#delve-board .delve-shop-row')];
    const ids = rows.map((r) => r.getAttribute('data-shop-item'));
    return {
      count: rows.length,
      ids,
      text: document.querySelector('#delve-board')?.textContent ?? '',
    };
  });
  const TOOLS = [
    'thorium_mining_pick',
    'ashwood_axe',
    'goldleaf_sickle',
    'stormreel_fishing_rod',
    'arcanite_mining_pick',
    'elderwood_axe',
    'sunpetal_sickle',
    'tidewrought_fishing_rod',
  ];
  const missing = TOOLS.filter((id) => !seen.ids.includes(id));
  if (missing.length) throw new Error(`delve shop frame missing tools: ${missing.join(', ')}`);
  // The tools are the LAST eight of seventeen rows, so the default scroll
  // position shows only the pre-existing armor and the frame would claim a
  // route it does not depict. Scroll them into view, then assert a real one is
  // on-frame and unobstructed: a DOM-only check passed here once already and
  // produced exactly that misleading shot.
  await page.evaluate(() => {
    document
      .querySelector('#delve-board [data-shop-item="thorium_mining_pick"]')
      ?.scrollIntoView({ block: 'start' });
  });
  await clearOverlays(page);
  const shown = await page.evaluate((tools) => {
    const onFrame = [];
    for (const id of tools) {
      const el = document.querySelector(`#delve-board [data-shop-item="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 8 || r.top < 0 || r.bottom > window.innerHeight) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && el.contains(hit)) onFrame.push(id);
    }
    return onFrame;
  }, TOOLS);
  if (shown.length < 4) {
    throw new Error(`only ${shown.length} tool rows are visible on-frame: ${shown.join(', ')}`);
  }
  console.log(
    `  verified ${seen.count} rows, all 8 tools stocked, ${shown.length} visible on-frame`,
  );
  await shoot(page, '#delve-board', label);
}

/** Slot an effect through the offline Sim and prove the HUD row paints it. */
async function toolEffectRow(page, label) {
  const setup = await page.evaluate(() => {
    const game = window.__game;
    const sim = game?.sim;
    if (!sim?.player) return { ok: false, reason: 'no offline world' };
    // The window renders its gathering section only in FULL mode, and a fresh
    // character is in SIMPLIFIED (no craft has reached tier 1), so there would
    // be no row to paint at all. Give it a real crafting identity and some
    // mining proficiency first, which is also the state a player who has
    // earned a tool effect would actually be in.
    const m0 = sim.meta(sim.playerId);
    m0.craftSkills.armorcrafting = 49;
    m0.craftSkills.weaponcrafting = 25;
    m0.gatheringProficiency.mining = 62;
    // A real tool is required by the resolver, and its RARITY decides the
    // charge count, so an epic pick is what makes the number worth showing.
    sim.addItem('arcanite_mining_pick', 1);
    // The charm the slot consumes: the acquisition craft's price, paid here
    // exactly as a live player pays it. A second charm stays in the bags so
    // the frame also shows the slot affordance beside the recharge one.
    sim.addItem('gatherers_cache', 1);
    sim.addItem('artisans_eye', 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    const meta = sim.meta(sim.playerId);
    const slot = meta.toolEffectSlots?.mining;
    if (!slot) return { ok: false, reason: 'slot was refused' };
    // Spend a few charges so the row shows a partial count rather than a full
    // one, which is the state a player actually spends most of their time in.
    slot.durability -= 7;
    game.hud.toggleProfessions();
    return { ok: true, charges: slot.durability, max: slot.maxDurability };
  });
  if (!setup.ok) throw new Error(`tool effect setup failed: ${setup.reason}`);
  await wait(300);
  // Clear the two overlays that otherwise photograph over the subject: the
  // first-tier tutorial modal (raising a craft to tier 1 above is what fires
  // it) and any celebration banner still burning from entry. A DOM check alone
  // does NOT catch this, which is how the first pass produced a frame whose
  // assertions passed and whose image was a tutorial dialog.
  await clearOverlays(page);
  // Bring the gathering section into view: the row lives below the ten craft
  // rows, so the default scroll position leaves it off-frame.
  await page.evaluate(() => {
    document
      .querySelector('#professions-window .prof-gathering')
      ?.scrollIntoView({ block: 'center' });
  });
  await wait(200);
  const row = await page.evaluate(() => {
    const el = document.querySelector('#professions-window .prof-effect');
    return el
      ? {
          present: true,
          name: el.querySelector('.prof-effect-name')?.textContent ?? '',
          charges: el.querySelector('.prof-effect-charges')?.textContent ?? '',
        }
      : { present: false };
  });
  if (!row.present) throw new Error('tool effect row did not paint');
  if (!row.charges.includes(String(setup.charges))) {
    throw new Error(`row shows "${row.charges}", expected the live count ${setup.charges}`);
  }
  // The acquisition-craft affordances must be IN the frame: the partial
  // charge count makes the recharge button render, and the spare charm in
  // bags makes the slot button render. A frame without them photographs the
  // pre-craft window and lies about what shipped.
  const affordances = await page.evaluate(() => ({
    recharge: !!document.querySelector('#professions-window [data-recharge-profession]'),
    slot: !!document.querySelector('#professions-window [data-slot-effect]'),
  }));
  if (!affordances.recharge) throw new Error('recharge button did not paint');
  if (!affordances.slot) throw new Error('slot button did not paint');
  // The subject must actually be VISIBLE, not merely in the DOM: assert the
  // row has a real box and that nothing is painted on top of its centre.
  const visible = await page.evaluate(() => {
    const el = document.querySelector('#professions-window .prof-effect');
    if (!el) return { ok: false, reason: 'gone' };
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 8) return { ok: false, reason: `box ${r.width}x${r.height}` };
    if (r.top < 0 || r.bottom > window.innerHeight) return { ok: false, reason: 'off-frame' };
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !el.contains(hit)) {
      return { ok: false, reason: `covered by ${hit?.className || hit?.id || 'unknown'}` };
    }
    return { ok: true };
  });
  if (!visible.ok) throw new Error(`tool effect row not visible: ${visible.reason}`);
  // Once more IMMEDIATELY before the shutter. The window rebuilds its whole
  // innerHTML on the 500 ms band and the first-tier tutorial is a one-shot the
  // sim fires as the craft skill crosses tier 1, so a single early clear leaves
  // a re-fired modal ghosting through the section's translucent background.
  await clearOverlays(page);
  console.log(`  verified row: "${row.name}" / "${row.charges}" (visible, unobstructed)`);
  await shoot(page, '#professions-window .prof-gathering', label);
}

/** Hover the epic rod in the shop and capture its tooltip, which is where the
 *  rarity-widened reel number is stated to the player. */
async function rodTooltip(page, label) {
  const box = await page.evaluate(() => {
    const row = document.querySelector('#delve-board [data-shop-item="tidewrought_fishing_rod"]');
    if (!row) return null;
    row.scrollIntoView({ block: 'center' });
    const r = row.getBoundingClientRect();
    return { x: r.left + 40, y: r.top + r.height / 2 };
  });
  if (!box) throw new Error('tidewrought row not in the shop');
  await wait(200);
  const at = await page.evaluate(() => {
    const row = document.querySelector('#delve-board [data-shop-item="tidewrought_fishing_rod"]');
    const r = row.getBoundingClientRect();
    return { x: r.left + 40, y: r.top + r.height / 2 };
  });
  await page.mouse.move(at.x, at.y);
  await wait(400);
  // The claim: the reel line states the RARITY-inclusive total (3.75s for the
  // epic tier-5 rod), not the tier-only 3s. Assert the text before shooting.
  const tip = await page.evaluate(() => {
    const el = document.getElementById('tooltip');
    if (!el || el.style.display === 'none') return { ok: false, reason: 'no tooltip' };
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return { ok: false, reason: 'tooltip has no box' };
    return { ok: true, text: el.textContent ?? '' };
  });
  if (!tip.ok) throw new Error(`rod tooltip failed: ${tip.reason}`);
  if (!tip.text.includes('3.75')) {
    throw new Error(`rod tooltip does not state the rarity-widened window: "${tip.text}"`);
  }
  console.log('  verified rod tooltip states the 3.75s rarity-inclusive reel window');
  await shoot(page, '#tooltip', label);
}

// Optional section filter (SHOT_ONLY=tool-effect-row|delve-shop|rod-tooltip):
// re-shooting one subject must not require the others to be drivable, or a
// drift in an unrelated frame blocks every refresh (each section still throws
// on ITS OWN staged-frame failures when it runs).
const ONLY = process.env.SHOT_ONLY ?? '';
const wants = (section) => ONLY === '' || ONLY === section;

async function run(viewport, suffix) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));
  await page.setViewport(viewport);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
  await enterOfflineGame(page, { charName: 'Toolwright' });
  await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
  if (wants('delve-shop')) {
    console.log(`[${suffix}] delve shop`);
    await delveShop(page, `delve-shop-tools-${suffix}`);
  }
  // DESKTOP ONLY. The item tooltip is a hover affordance; touch uses the
  // tap-to-peek gate instead, so a mobile pointer move never raises it and a
  // "mobile tooltip" frame would be a staged fiction rather than a real one.
  if (suffix === 'desktop' && wants('rod-tooltip')) {
    console.log(`[${suffix}] rod tooltip`);
    await rodTooltip(page, `rod-reel-tooltip-${suffix}`);
  }
  await page.evaluate(() => window.__game?.hud?.closeDelveBoard?.());
  await page.evaluate(() => {
    document.querySelector('#delve-board')?.style?.setProperty('display', 'none');
  });
  if (wants('tool-effect-row')) {
    console.log(`[${suffix}] tool effect row`);
    await toolEffectRow(page, `tool-effect-row-${suffix}`);
  }
  await page.close();
}

await run(DESKTOP, 'desktop');
await run(MOBILE, 'mobile');
await browser.close();
console.log('done');
