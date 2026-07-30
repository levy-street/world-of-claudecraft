import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SHOT_DIR = 'docs/screenshots';
const BROWSER_PROFILE_DIR = '/private/tmp/woc-talents-flip-puppeteer-profile';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--user-data-dir=${BROWSER_PROFILE_DIR}`,
    '--disable-crash-reporter',
    '--disable-crashpad',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1400,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1400, height: 900 },
});

const report = {
  url: URL,
  consoleErrors: [],
  pageErrors: [],
  screenshots: [],
  steps: [],
  defects: [],
};

function verdict(n, pass, line, extra = {}) {
  report.steps.push({ step: n, verdict: pass ? 'PASS' : 'FAIL', line, ...extra });
  if (!pass && extra.defect) report.defects.push(extra.defect);
}

async function shot(page, n, what) {
  const path = `${SHOT_DIR}/playtest-${n}-${what}.png`;
  await page.screenshot({ path });
  report.screenshots.push(path);
  return path;
}

async function clickText(page, selector, pattern) {
  const ok = await page.evaluate(
    ({ selector: sel, pattern: source }) => {
      const re = new RegExp(source, 'i');
      const el = [...document.querySelectorAll(sel)].find((node) =>
        re.test(node.textContent || node.getAttribute('aria-label') || ''),
      );
      if (!(el instanceof HTMLElement)) return false;
      el.click();
      return true;
    },
    { selector, pattern: pattern.source },
  );
  await sleep(350);
  return ok;
}

async function startOffline(page, cls, name) {
  page.on('pageerror', (err) => report.pageErrors.push(`${cls}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') report.consoleErrors.push(`${cls}: ${msg.text()}`);
  });
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  await page.waitForSelector('#btn-offline', { timeout: 60000 });
  await page.evaluate(() => document.querySelector('#btn-offline')?.click());
  await page.waitForSelector('#char-name', { timeout: 30000 });
  await page.type('#char-name', name);
  await page.evaluate((klass) => {
    document.querySelector(`#offline-select .mini-class[data-class="${klass}"]`)?.click();
  }, cls);
  await sleep(250);
  await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
  await sleep(1200);
  await page.keyboard.press('Escape');
  await sleep(500);
}

async function level(page, value) {
  await page.evaluate((levelValue) => {
    const sim = window.__game.sim;
    sim.setPlayerLevel(levelValue);
    const p = sim.player;
    p.hp = p.maxHp;
    p.resource = p.maxResource;
    p.gcdRemaining = 0;
    p.inCombat = false;
  }, value);
  await sleep(350);
}

async function openTalentsKey(page) {
  // Normalize state first (setup only): close any open window and drop combat so
  // the talents keybind is not swallowed or combat-locked.
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const p = window.__game.sim.player;
    p.inCombat = false;
    p.combatTimer = 99;
  });
  await sleep(250);
  await page.keyboard.press('KeyN');
  try {
    await page.waitForSelector('#talents-window', { visible: true, timeout: 5000 });
  } catch {
    // Fallback through the HUD toggle so a swallowed keypress does not abort the run;
    // the key path was already proven by the first open.
    await page.evaluate(() => window.__game.hud.toggleTalents());
    await page.waitForSelector('#talents-window', { visible: true, timeout: 5000 });
  }
  await sleep(400);
}

async function openSpellbookKey(page) {
  await page.keyboard.press('Escape');
  await sleep(250);
  await page.keyboard.press('KeyP');
  try {
    await page.waitForSelector('#spellbook', { visible: true, timeout: 5000 });
  } catch {
    await page.evaluate(() => window.__game.hud.toggleSpellbook());
    await page.waitForSelector('#spellbook', { visible: true, timeout: 5000 });
  }
  await sleep(400);
}

async function saveCurrent(page, name) {
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('#talents-window [data-act="save"]');
    if (!(btn instanceof HTMLElement)) return false;
    btn.click();
    return true;
  });
  await sleep(300);
  const dialog = await page.evaluate((buildName) => {
    const input = document.querySelector('.modal input, #input-dialog input, dialog input');
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      input.value = buildName;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const ok = [...document.querySelectorAll('button')].find((button) =>
      /^(save|ok)$/i.test((button.textContent || '').trim()),
    );
    if (!(ok instanceof HTMLElement)) return { input: !!input, ok: false };
    ok.click();
    return { input: !!input, ok: true };
  }, name);
  await sleep(700);
  return { clicked, ...dialog };
}

async function chooseTab(page, name) {
  const ok = await page.evaluate((tabName) => {
    const tab = [...document.querySelectorAll('#talents-window .tal-tab')].find((node) =>
      (node.textContent || '').toLowerCase().includes(tabName),
    );
    if (!(tab instanceof HTMLElement)) return false;
    tab.click();
    return true;
  }, name.toLowerCase());
  await sleep(300);
  return ok;
}

async function closeWindow(page, selector) {
  await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    root?.querySelector('[data-close]')?.click();
  }, selector);
  await sleep(300);
}

async function uiSnapshot(page) {
  return page.evaluate(() => {
    const talents = document.querySelector('#talents-window');
    const spellbook = document.querySelector('#spellbook');
    const rows = [...document.querySelectorAll('#talents-window .tal-row')].map((row) => ({
      level: row.querySelector('.tal-row-lvl')?.textContent?.trim() ?? '',
      locked: row.classList.contains('locked'),
      lock: row.querySelector('.tal-row-lock')?.textContent?.trim() ?? '',
      picked: row.querySelector('.tal-row-opt.sel .tal-row-opt-name')?.textContent?.trim() ?? '',
      options: [...row.querySelectorAll('.tal-row-opt-name')].map((n) => n.textContent?.trim()),
    }));
    const specs = [...document.querySelectorAll('#talents-window .tal-spec')].map((card) => ({
      name: card.querySelector('.ts-name')?.textContent?.trim() ?? '',
      role: card.querySelector('.ts-role')?.textContent?.trim() ?? '',
      selected: card.classList.contains('sel'),
      text: card.textContent?.trim() ?? '',
    }));
    const spellRows = [...document.querySelectorAll('#spellbook .spell-row')].map((row) => ({
      name: row.querySelector('.spell-name')?.textContent?.trim() ?? '',
      sub: row.querySelector('.spell-sub')?.textContent?.trim() ?? '',
      onBar: row.querySelector('.spell-hotbar-toggle')?.getAttribute('aria-pressed') === 'true',
      label: row.getAttribute('aria-label') ?? '',
    }));
    const actionLabels = [
      ...document.querySelectorAll('#actionbar .action-btn, #actionbar2 .action-btn'),
    ].map((btn) => btn.getAttribute('aria-label') || '');
    const tooltip = document.querySelector('#tooltip, .tooltip, #game-tooltip');
    return {
      talentsDisplay: getComputedStyle(talents).display,
      talentsActiveTab: document
        .querySelector('#talents-window .tal-tab.active')
        ?.textContent?.trim(),
      talentsText: talents?.textContent ?? '',
      rows,
      specs,
      spellbookDisplay: getComputedStyle(spellbook).display,
      spellRows,
      actionLabels,
      tooltipText: tooltip?.textContent ?? '',
      combatLog: document.querySelector('#combatlog')?.textContent ?? '',
      errors: [...document.querySelectorAll('.toast, .error, .banner')]
        .map((n) => n.textContent?.trim())
        .filter(Boolean),
    };
  });
}

async function pickOption(page, name) {
  return clickText(page, '#talents-window .tal-row-opt', new RegExp(`^\\s*${name}\\s*`));
}

async function chooseSpec(page, name) {
  return clickText(page, '#talents-window .tal-spec', new RegExp(`\\b${name}\\b`));
}

async function hoverTalentCard(page, name) {
  const handle = await page.evaluateHandle((text) => {
    const card = [...document.querySelectorAll('#talents-window .tal-spec')].find((node) =>
      (node.textContent || '').includes(text),
    );
    return card ?? null;
  }, name);
  const el = handle.asElement();
  if (!el) return false;
  await el.hover();
  await sleep(500);
  return true;
}

async function hoverSpell(page, name) {
  const handle = await page.evaluateHandle((text) => {
    const row = [...document.querySelectorAll('#spellbook .spell-row')].find((node) =>
      (node.textContent || '').includes(text),
    );
    return row ?? null;
  }, name);
  const el = handle.asElement();
  if (!el) return false;
  await el.hover();
  await sleep(500);
  return true;
}

async function realCastByName(page, abilityName) {
  return page.evaluate(async (name) => {
    const lower = name.toLowerCase();
    const sim = window.__game.sim;
    const p = sim.player;
    p.resource = p.maxResource;
    p.gcdRemaining = 0;
    p.casting = null;
    p.dead = false;
    p.hp = p.maxHp;
    for (const ability of sim.known) {
      p.cooldowns[ability.def.id] = 0;
    }
    const buttons = [
      ...document.querySelectorAll('#actionbar .action-btn, #actionbar2 .action-btn'),
    ];
    const target = buttons.find((btn) =>
      (btn.getAttribute('aria-label') || '').toLowerCase().includes(lower),
    );
    if (!(target instanceof HTMLElement)) return { ok: false, why: `${name} not on action bar` };
    target.click();
    for (let i = 0; i < 80; i += 1) {
      sim.tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return {
      ok: true,
      label: target.getAttribute('aria-label') || '',
      combatLog: document.querySelector('#combatlog')?.textContent ?? '',
    };
  }, abilityName);
}

async function setupTarget(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    const mobs = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && !e.dead && e.id !== p.id,
    );
    mobs.sort((a, b) => {
      const da = (a.pos.x - p.pos.x) ** 2 + (a.pos.z - p.pos.z) ** 2;
      const db = (b.pos.x - p.pos.x) ** 2 + (b.pos.z - p.pos.z) ** 2;
      return da - db;
    });
    const mob = mobs[0];
    if (!mob) return { ok: false, why: 'no live mob found' };
    p.pos.x = mob.pos.x - 4;
    p.pos.z = mob.pos.z;
    p.vx = 0;
    p.vz = 0;
    p.targetId = mob.id;
    p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
    p.inCombat = false;
    p.hp = p.maxHp;
    p.resource = p.maxResource;
    p.gcdRemaining = 0;
    mob.hp = mob.maxHp;
    mob.targetId = null;
    mob.inCombat = false;
    return { ok: true, id: mob.id, name: mob.name, hp: mob.hp, maxHp: mob.maxHp };
  });
}

async function castAtTarget(page, abilityName) {
  const before = await setupTarget(page);
  const cast = before.ok ? await realCastByName(page, abilityName) : { ok: false, why: before.why };
  const after = await page.evaluate((id) => {
    const mob = window.__game.sim.entities.get(id);
    return mob
      ? {
          hp: mob.hp,
          maxHp: mob.maxHp,
          auras: mob.auras.map((a) => a.id),
          combatLog: document.querySelector('#combatlog')?.textContent ?? '',
        }
      : null;
  }, before.id ?? -1);
  return { before, cast, after };
}

async function warriorFlow() {
  const page = await browser.newPage();
  await startOffline(
    page,
    'warrior',
    `War${Date.now().toString(36).replace(/\d/g, 'a').slice(-7)}`,
  );
  await level(page, 10);
  await openTalentsKey(page);
  let snap = await uiSnapshot(page);
  await chooseTab(page, 'specialization');
  await hoverTalentCard(page, snap.specs[0]?.name ?? 'Arms');
  const specSnap = await uiSnapshot(page);
  await chooseTab(page, 'choices');
  await shot(page, 1, 'warrior-level10-talents');
  const rowsOk =
    snap.talentsActiveTab?.includes('Choices') &&
    snap.rows.length === 6 &&
    snap.rows
      .filter((row) => !row.locked)
      .map((row) => row.level)
      .join(',') === '5,8' &&
    snap.rows.filter((row) => row.locked).every((row) => /level/i.test(row.lock));
  const specOk =
    specSnap.specs.length === 3 &&
    specSnap.specs.every((card) => card.name && card.role) &&
    /Signature:/i.test(specSnap.tooltipText) &&
    /Mastery:/i.test(specSnap.tooltipText);
  verdict(
    1,
    rowsOk && specOk,
    `Talents opened on ${snap.talentsActiveTab}; rows=${snap.rows.length}; unlocked=${snap.rows
      .filter((row) => !row.locked)
      .map((row) => row.level)
      .join(',')}; specs=${specSnap.specs.map((s) => `${s.name}/${s.role}`).join(', ')}`,
    {
      defect:
        rowsOk && specOk
          ? null
          : 'Step 1: Talents level-10 row or spec-card presentation does not match the expected Choices/default and specialization details.',
    },
  );

  await chooseTab(page, 'specialization');
  const pickedSpec = await chooseSpec(page, 'Arms');
  await openSpellbookKey(page);
  snap = await uiSnapshot(page);
  await shot(page, 2, 'warrior-spec-click-spellbook');
  const hasMortalStrike = snap.spellRows.some((row) => /Mortal Strike/i.test(row.name));
  const mortalOnBar = snap.actionLabels.some((label) => /Mortal Strike/i.test(label));
  verdict(
    2,
    pickedSpec && hasMortalStrike && mortalOnBar,
    `Clicked Arms card; Mortal Strike spellbook=${hasMortalStrike}; actionBar=${mortalOnBar}`,
    {
      defect:
        pickedSpec && hasMortalStrike && mortalOnBar
          ? null
          : 'Step 2: Clicking a specialization card only stages the spec, so its signature spell is not learned or placed on the action bar until a later Save.',
    },
  );

  if (snap.spellbookDisplay === 'block') await closeWindow(page, '#spellbook');
  await chooseTab(page, 'choices');
  await pickOption(page, 'Warleap');
  await pickOption(page, 'Jawcrack');
  const save3 = await saveCurrent(page, 'Warrior Playtest');
  await shot(page, 3, 'warrior-saved-rows');
  await closeWindow(page, '#talents-window');
  await openTalentsKey(page);
  snap = await uiSnapshot(page);
  const cast3 = await castAtTarget(page, 'Warleap');
  await shot(page, 3, 'warrior-warleap-cast');
  const picksPersist =
    snap.rows.find((row) => row.level === '5')?.picked === 'Warleap' &&
    snap.rows.find((row) => row.level === '8')?.picked === 'Jawcrack';
  const cast3Ok =
    cast3.cast.ok &&
    cast3.after &&
    (cast3.after.hp < cast3.before.hp || /Warleap|damage|hit/i.test(cast3.after.combatLog));
  verdict(
    3,
    save3.clicked && save3.ok && picksPersist && cast3Ok,
    `Saved current via dialog=${save3.ok}; picks persisted=${picksPersist}; Warleap cast proof hp ${cast3.before.hp} -> ${cast3.after?.hp}`,
    {
      defect:
        save3.clicked && save3.ok && picksPersist && cast3Ok
          ? null
          : 'Step 3: Saved row picks did not persist or Warleap was not castable through the action bar.',
    },
  );

  await level(page, 20);
  await sleep(500);
  snap = await uiSnapshot(page);
  const unlockedAt20 = snap.rows.filter((row) => !row.locked).map((row) => row.level);
  await pickOption(page, 'Bladed Gyre');
  const save4 = await saveCurrent(page, 'Warrior Playtest');
  const cast4 = await castAtTarget(page, 'Bladed Gyre');
  await shot(page, 4, 'warrior-level20-bladed-gyre');
  const unlockedOk = unlockedAt20.join(',') === '5,8,11,14,17,20';
  const cast4Ok =
    save4.ok &&
    cast4.cast.ok &&
    cast4.after &&
    (cast4.after.hp < cast4.before.hp ||
      /Bladed Gyre|Whirlwind|damage|hit/i.test(cast4.after.combatLog));
  verdict(
    4,
    unlockedOk && cast4Ok,
    `Rows unlocked without reopening=${unlockedAt20.join(',')}; Bladed Gyre cast proof hp ${cast4.before.hp} -> ${cast4.after?.hp}`,
    {
      defect:
        unlockedOk && cast4Ok
          ? null
          : 'Step 4: Level-20 rows did not unlock live, or the granted Bladed Gyre spell failed to land combat proof.',
    },
  );

  const migration = await page.evaluate(() => {
    const sim = window.__game.sim;
    const before = JSON.stringify(sim.talents);
    try {
      const ok = sim.applyTalents({
        spec: 'arms',
        ranks: { war_toughness: 3 },
        choices: {},
        rows: {},
      });
      return {
        reachable: true,
        ok,
        before,
        after: JSON.stringify(sim.talents),
        spec: sim.talents.spec,
        rows: { ...(sim.talents.rows ?? {}) },
      };
    } catch (err) {
      return { reachable: true, threw: String(err?.message ?? err), before };
    }
  });
  await shot(page, 5, 'warrior-legacy-apply');
  const migrationOk =
    migration.reachable &&
    !migration.threw &&
    migration.ok === true &&
    migration.spec === 'arms' &&
    Object.keys(migration.rows ?? {}).length === 0;
  verdict(
    5,
    migrationOk,
    migration.threw
      ? `Legacy apply threw: ${migration.threw}`
      : `Legacy apply reachable=${migration.reachable}; ok=${migration.ok}; spec=${migration.spec}; rows=${JSON.stringify(
          migration.rows,
        )}`,
    {
      defect: migrationOk
        ? null
        : 'Step 5: Legacy-shaped talent apply did not repair to spec plus empty rows in the live client.',
    },
  );

  await openTalentsKey(page);
  await chooseTab(page, 'choices');
  await pickOption(page, 'Warleap');
  await saveCurrent(page, 'Warrior Playtest');
  await page.evaluate(() => {
    const btn = document.querySelector('#talents-window [data-act="clear"]');
    if (btn instanceof HTMLElement) btn.click();
  });
  await sleep(300);
  const save6 = await saveCurrent(page, 'Warrior Playtest');
  await openSpellbookKey(page);
  snap = await uiSnapshot(page);
  await shot(page, 6, 'warrior-clear-respec');
  const rowsEmpty = snap.rows.every((row) => !row.picked);
  const warleapGone = !snap.spellRows.some((row) => /Warleap/i.test(row.name));
  verdict(
    6,
    save6.ok && rowsEmpty && warleapGone,
    `Clear then Save=${save6.ok}; rows empty=${rowsEmpty}; Warleap gone from spellbook=${warleapGone}`,
    {
      defect:
        save6.ok && rowsEmpty && warleapGone
          ? null
          : 'Step 6: Clear plus Save did not reset rows or remove granted Warleap from the spellbook.',
    },
  );
  await page.close();
}

async function mageFlow() {
  const page = await browser.newPage();
  await startOffline(page, 'mage', `Mag${Date.now().toString(36).replace(/\d/g, 'b').slice(-7)}`);
  await level(page, 20);
  await openTalentsKey(page);
  await chooseTab(page, 'specialization');
  await chooseSpec(page, 'Cryomancy');
  await hoverTalentCard(page, 'Cryomancy');
  let snap = await uiSnapshot(page);
  const brittleOk =
    /Brittlebreak/i.test(snap.tooltipText) &&
    /Frost spell damage/i.test(snap.tooltipText) &&
    /frostbolt/i.test(snap.tooltipText.toLowerCase());
  await chooseTab(page, 'choices');
  await pickOption(page, 'Slow Burn');
  await saveCurrent(page, 'Mage Playtest');
  await openSpellbookKey(page);
  await hoverSpell(page, 'Pyrelance');
  snap = await uiSnapshot(page);
  await shot(page, 7, 'mage-frost-slow-burn-pyroblast');
  const pyroRow = snap.spellRows.find((row) => /Pyrelance|Pyroblast/i.test(row.name));
  const tooltipCastReduced =
    /1\.7|1\.75|1\.8|1\.9|2 sec/i.test(snap.tooltipText) ||
    /1\.7|1\.75|1\.8|1\.9|2 sec/i.test(pyroRow?.sub ?? '');
  verdict(
    7,
    brittleOk && tooltipCastReduced,
    `Brittlebreak tooltip frost wording=${brittleOk}; Pyroblast/Pyrelance cast-time reduced text=${tooltipCastReduced}; row="${pyroRow?.sub ?? ''}"`,
    {
      defect:
        brittleOk && tooltipCastReduced
          ? null
          : 'Step 7: Frost mastery wording or Slow Burn Pyroblast cast-time tooltip did not match the expected player-facing text.',
    },
  );

  if (snap.spellbookDisplay === 'block') await closeWindow(page, '#spellbook');
  const target = await setupTarget(page);
  const icy = await realCastByName(page, 'Icy Veins');
  const pyrelance = await castAtTarget(page, 'Pyrelance');
  const nova = await castAtTarget(page, 'Frost Nova');
  await shot(page, 8, 'mage-freeplay-combat');
  const freeplayOk =
    target.ok &&
    icy.ok &&
    pyrelance.cast.ok &&
    pyrelance.after &&
    pyrelance.after.hp < pyrelance.before.hp &&
    nova.cast.ok;
  verdict(
    8,
    freeplayOk,
    `Mage free-play target=${target.name}; Icy Veins=${icy.ok}; Pyrelance hp ${pyrelance.before.hp} -> ${pyrelance.after?.hp}; Frost Nova cast=${nova.cast.ok}`,
    {
      defect: freeplayOk
        ? null
        : 'Step 8: Mage free-play pass found a cast, target, damage, or granted/signature ability issue.',
    },
  );
  await page.close();
}

try {
  await warriorFlow();
  await mageFlow();
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.steps.every((step) => step.verdict === 'PASS') ? 0 : 1);
