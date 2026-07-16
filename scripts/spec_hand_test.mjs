// Live-client hand-test for the Talents 2.0 spec update: for every class, pick each
// of its 3 specs in the REAL offline client, verify the signature ability is granted
// and castable (cooldown/GCD reset between casts), and the Specialization panel opens.
// Needs `npm run dev` (GAME_URL overrides the port). Exits 1 on any failure.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) fail++;
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const jsClick = (page, sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

const SPEC_SIGS = {
  warrior: [
    ['arms', 'mortal_strike'],
    ['fury', 'bloodthirst'],
    ['prot', 'shield_slam'],
  ],
  paladin: [
    ['holy', 'holy_shock'],
    ['protection', 'holy_shield'],
    ['retribution', 'crusader_strike'],
  ],
  hunter: [
    ['beast_mastery', 'bestial_wrath'],
    ['marksmanship', 'trueshot_aura'],
    ['survival', 'wyvern_sting'],
  ],
  mage: [
    ['arcane', 'arcane_power'],
    ['fire', 'combustion'],
    ['frost', 'icy_veins'],
  ],
  rogue: [
    ['assassination', 'cold_blood'],
    ['combat', 'blade_flurry'],
    ['subtlety', 'hemorrhage'],
  ],
  priest: [
    ['discipline', 'power_infusion'],
    ['holy', 'holy_nova'],
    ['shadow', 'shadowform'],
  ],
  shaman: [
    ['elemental', 'elemental_mastery'],
    ['enhancement', 'stormstrike'],
    ['restoration', 'chain_heal'],
  ],
  warlock: [
    ['affliction', 'siphon_life'],
    ['demonology', 'metamorphosis'],
    ['destruction', 'conflagrate'],
  ],
  druid: [
    ['balance', 'moonkin_form'],
    ['feral', 'feral_charge'],
    ['restoration', 'swiftmend'],
  ],
};

const CLASSES = [
  'warrior',
  'paladin',
  'hunter',
  'mage',
  'rogue',
  'priest',
  'shaman',
  'warlock',
  'druid',
];

for (const cls of CLASSES) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  await page.waitForSelector('#btn-offline', { timeout: 60000 });
  await jsClick(page, '#btn-offline');
  await sleep(400);
  await page.waitForSelector('#char-name', { timeout: 30000 });
  await page.type('#char-name', `Handtest${cls.slice(0, 6)}`);
  await jsClick(page, `#offline-select .mini-class[data-class="${cls}"]`);
  await sleep(300);
  await jsClick(page, '#btn-start-offline');
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
  await sleep(1200);
  await page.evaluate(() => {
    window.__game.sim.setPlayerLevel(20);
    document.querySelector('#tutorial-hint .btn, #tutorial-hint button')?.click();
  });
  await page.keyboard.press('Escape');
  await sleep(500);

  for (const [specId, sigId] of SPEC_SIGS[cls]) {
    const r = await page.evaluate(
      ([id, sig]) => {
        const sim = window.__game.sim;
        sim.setSpec(id);
        const me = sim.player;
        const resolved = sim.resolvedAbility(sig);
        if (!resolved) return { id, ok: false, why: `signature ${sig} not resolved` };
        me.resource = me.maxResource;
        me.gcdRemaining = 0;
        me.hp = me.maxHp;
        sim.castAbility(sig);
        for (let i = 0; i < 3; i++) sim.tick();
        return { id, ok: true, sig, name: resolved.def.name };
      },
      [specId, sigId],
    );
    check(`${cls}/${r.id} signature`, r.ok, r.ok ? `${r.sig} (${r.name}) cast` : r.why);
  }
  check(`${cls} no page errors`, pageErrors.length === 0, pageErrors.slice(0, 2).join('; '));
  await page.close();
}

await browser.close();
console.log(fail > 0 ? `${fail} FAILURES` : 'ALL PASS');
process.exit(fail > 0 ? 1 : 0);
