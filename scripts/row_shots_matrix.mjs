// PR #1614 deliverable: the 9-class choice-row screenshot matrix.
//
// For each class this drives the offline dev client via puppeteer-core and writes
// two committed-quality PNGs into docs/screenshots/:
//   rows-<class>-picker.png : the Talents window Choices tab at level 20 with all six
//     rows visible and one option picked per row (behavior-changing grants/procs preferred).
//   rows-<class>-moment.png : the character in combat right after casting a row-granted or
//     row-empowered ability, with a proc/self buff visible on the buff bar where the class
//     has one.
//
// Imitates scripts/talents_flip_playtest.mjs + scripts/row_picker_click_test.mjs (all the
// window-open / level / row-pick / cast gotchas live there). Run with `npm run dev` up.
//
// Usage: node scripts/row_shots_matrix.mjs [class1 class2 ...]
//   With no args it shoots all nine. Pass a subset to shoot a wave (e.g. warrior priest).
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SHOT_DIR = 'docs/screenshots';
// Unique per run: a crashed Chrome must never lock the next run out of its profile.
const BROWSER_PROFILE_DIR = `/private/tmp/woc-row-shots-matrix-profile-${process.pid}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });

// Per-class recipe. `rows` maps the six choice-row levels to the option id to pick.
// `moment` is the buff/proc ability to cast so the moment shot shows a buff on #buff-bar.
// `momentIsSelfBuff` true means we cast it on self (no target needed); otherwise we set up
// a mob target and cast at it. `momentFallbacks` are alternate abilities to try if the
// primary is not on the action bar (kept minimal, row-granted where possible).
const CLASS_PLAN = {
  warrior: {
    spec: 'arms',
    name: 'Rowwar',
    rows: {
      5: 'war_r5_heroic_leap', // Warleap (grant heroic_leap)
      8: 'war_r8_pummel', // Jawcrack (grant pummel)
      11: 'war_r11_berserker_rage', // Seething Fury (grant berserker_rage)
      14: 'war_r14_whirlwind', // Bladed Gyre (grant whirlwind)
      17: 'war_r17_shield_wall', // Bulwark (grant shield_wall)
      20: 'war_r20_avatar', // Colossus (grant avatar)
    },
    moment: 'avatar',
    momentIsSelfBuff: true,
    momentFallbacks: ['berserker_rage', 'shield_wall'],
  },
  priest: {
    spec: 'discipline',
    name: 'Rowpriest',
    rows: {
      5: 'pri_r5_searing_light', // Searing Light (proc: free heal every 3rd smite)
      8: 'pri_r8_silence', // Silent Treatment (grant silence)
      11: 'pri_r11_inner_focus', // Stilled Mind (grant inner_focus)
      14: 'pri_r14_mind_melt', // Mind Melt (mind_blast cd)
      17: 'pri_r17_desperate_prayer', // Last Prayer (grant desperate_prayer)
      20: 'pri_r20_prayer_of_healing', // Choirmend (grant prayer_of_healing)
    },
    moment: 'inner_focus',
    momentIsSelfBuff: true,
    momentFallbacks: ['desperate_prayer', 'power_word_shield'],
  },
  shaman: {
    spec: 'elemental',
    name: 'Rowsham',
    rows: {
      5: 'sha_r5_concussion', // Fault Line (proc: free shock every 3rd Arc Bolt)
      8: 'sha_r8_improved_earth_shock', // Improved Earthen Jolt (interrupt)
      11: 'sha_r11_healing_stream', // Springwell (grant healing_stream)
      14: 'sha_r14_chain_lightning', // Forked Lightning (grant chain_lightning)
      17: 'sha_r17_earthbind', // Gripping Earth (grant earthbind)
      20: 'sha_r20_bloodlust', // War Drums (grant bloodlust)
    },
    moment: 'bloodlust',
    momentIsSelfBuff: true,
    momentFallbacks: ['lightning_shield', 'chain_lightning'],
  },
  paladin: {
    spec: 'retribution',
    name: 'Rowpal',
    rows: {
      5: 'pal_r5_vengeful_exorcism', // Vengeful Exorcism (proc: judgement resets exorcism)
      8: 'pal_r8_rebuke', // Reproach (grant rebuke)
      11: 'pal_r11_divine_wisdom', // Divine Wisdom (proc: instant Holy Light)
      14: 'pal_r14_holy_wrath', // Saint's Ire (grant holy_wrath)
      17: 'pal_r17_divine_shield', // Lightward (grant divine_shield)
      20: 'pal_r20_avenging_wrath', // Wrathwing (grant avenging_wrath)
    },
    moment: 'avenging_wrath',
    momentIsSelfBuff: true,
    momentFallbacks: ['divine_shield', 'divine_protection'],
  },
  mage: {
    spec: 'frost',
    name: 'Rowmage',
    rows: {
      5: 'mag_r5_impulse', // Impulse (fire_blast cd)
      8: 'mag_r8_counterspell', // Spellbreak (grant counterspell)
      11: 'mag_r11_cone_of_cold', // Frostsweep (grant cone_of_cold)
      14: 'mag_r14_presence_of_mind', // Racing Mind (grant presence_of_mind)
      17: 'mag_r17_ice_block', // Cold Coffin (grant ice_block)
      20: 'mag_r20_deep_freeze', // Deadfrost (grant deep_freeze)
    },
    moment: 'presence_of_mind', // row-granted at 14 (Racing Mind), empower-next self buff
    momentIsSelfBuff: true,
    momentFallbacks: ['ice_block', 'icy_veins', 'arcane_power'],
  },
  rogue: {
    spec: 'combat',
    name: 'Rowrog',
    rows: {
      5: 'rog_r5_improved_backstab', // Improved Backstab
      8: 'rog_r8_kick', // Boot (grant kick)
      11: 'rog_r11_preparation', // Contingency (grant preparation)
      14: 'rog_r14_ghostly_strike', // Wraith Strike (grant ghostly_strike)
      17: 'rog_r17_cloak_of_shadows', // Shadecloak (grant cloak_of_shadows)
      20: 'rog_r20_shadowstep', // Shadeslip (grant shadowstep)
    },
    moment: 'cloak_of_shadows', // row-granted at 17 (Shadecloak), visible self buff
    momentIsSelfBuff: true,
    momentFallbacks: ['adrenaline_rush', 'evasion', 'sprint'],
  },
  hunter: {
    spec: 'marksmanship',
    name: 'Rowhunt',
    rows: {
      5: 'hun_r5_quick_shots', // Quick Shots (arcane_shot cd)
      8: 'hun_r8_counter_shot', // Hushing Shot (grant counter_shot)
      11: 'hun_r11_mend_pet', // Patch Up (grant mend_pet)
      14: 'hun_r14_multi_shot', // Splitshot (grant multi_shot)
      17: 'hun_r17_deterrence', // Bristleguard (grant deterrence)
      20: 'hun_r20_aspect_of_the_wild', // Wildfang Guise (grant aspect_of_the_wild)
    },
    moment: 'aspect_of_the_wild', // row-granted at 20 (Wildfang Guise), visible aspect buff
    momentIsSelfBuff: true,
    momentFallbacks: ['deterrence', 'rapid_fire', 'trueshot_aura'],
  },
  druid: {
    spec: 'balance',
    name: 'Rowdruid',
    rows: {
      5: 'dru_r5_improved_wrath', // Improved Wildbolt (wrath cast)
      8: 'dru_r8_skull_bash', // Headbutt (grant skull_bash)
      11: 'dru_r11_innervate', // Lifesap (grant innervate)
      14: 'dru_r14_moonfury', // Moonspite (starfire/moonfire dmg)
      17: 'dru_r17_frenzied_regeneration', // Savage Mending (grant frenzied_regeneration)
      20: 'dru_r20_berserk', // Red Haze (grant berserk)
    },
    moment: 'innervate',
    momentIsSelfBuff: true,
    momentFallbacks: ['berserk', 'barkskin', 'mark_of_the_wild'],
  },
  warlock: {
    spec: 'destruction',
    name: 'Rowlock',
    rows: {
      5: 'wlk_r5_improved_corruption', // Improved Blackrot (instant corruption)
      8: 'wlk_r8_spell_lock', // Gag Order (grant spell_lock)
      11: 'wlk_r11_demon_armor', // Demon Armor (demon_skin buff)
      14: 'wlk_r14_shadow_mastery', // Umbral Mastery (spell dmg)
      17: 'wlk_r17_death_coil', // Grave Coil (grant death_coil)
      20: 'wlk_r20_chaos_bolt', // Ruinbolt (grant chaos_bolt)
    },
    moment: 'demon_skin',
    momentIsSelfBuff: true,
    momentFallbacks: ['immolate', 'corruption', 'shadow_bolt'],
  },
};

const report = { url: URL, classes: {}, pageErrors: [] };

async function shot(page, cls, kind, suffix = '') {
  const path = `${SHOT_DIR}/rows-${cls}-${kind}${suffix}.png`;
  await page.screenshot({ path });
  return path;
}

async function startOffline(page, cls, name) {
  page.on('pageerror', (err) => report.pageErrors.push(`${cls}: ${err.message}`));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('#btn-offline', { timeout: 120000 });
  // #btn-offline is a static hidden compat trigger in index.html, so it exists BEFORE
  // main.ts wires its click handler. Click-and-poll until the offline panel actually
  // opens instead of clicking once into a not-yet-hydrated page.
  let offlineOpen = false;
  for (let i = 0; i < 60 && !offlineOpen; i += 1) {
    await page.evaluate(() => document.querySelector('#btn-offline')?.click());
    try {
      await page.waitForSelector('#char-name', { visible: true, timeout: 2000 });
      offlineOpen = true;
    } catch {
      /* client still booting; click again */
    }
  }
  if (!offlineOpen) throw new Error('offline panel (#char-name) never opened');
  await page.type('#char-name', name);
  await page.evaluate((klass) => {
    document.querySelector(`#offline-select .mini-class[data-class="${klass}"]`)?.click();
  }, cls);
  await sleep(250);
  await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
  // The offline boot builds the Three renderer synchronously; under swiftshader with
  // host GPU contention the first frame can take well over a minute, so wait patiently.
  await page.waitForFunction(() => window.__game?.sim?.player, {
    timeout: 240000,
    polling: 500,
  });
  await sleep(1200);
  await page.keyboard.press('Escape'); // skip intro cinematic (else #ui is display:none)
  await sleep(500);
}

// Apply the full six-row allocation + spec through the sim API, then rebuild HUD state.
async function applyRows(page, spec, rows) {
  return page.evaluate(
    ({ specId, rowAlloc }) => {
      const sim = window.__game.sim;
      sim.setPlayerLevel(20);
      const p = sim.player;
      p.hp = p.maxHp;
      p.resource = p.maxResource;
      p.gcdRemaining = 0;
      p.inCombat = false;
      // rows keyed by level -> option id.
      const ok = sim.applyTalents({ spec: specId, rows: rowAlloc, choices: {}, ranks: {} });
      return {
        ok,
        spec: sim.talents.spec,
        rows: { ...(sim.talents.rows ?? {}) },
      };
    },
    { specId: spec, rowAlloc: rows },
  );
}

async function openTalentsChoices(page) {
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
    await page.evaluate(() => window.__game.hud.toggleTalents());
    await page.waitForSelector('#talents-window', { visible: true, timeout: 5000 });
  }
  await sleep(300);
  // Switch to the Choices tab (mouse-equivalent click on the tab element).
  await page.evaluate(() => {
    const tab =
      document.querySelector('#talents-window .tal-tab[data-tab="choices"]') ??
      [...document.querySelectorAll('#talents-window .tal-tab')].find((t) =>
        (t.textContent || '').toLowerCase().includes('choices'),
      );
    tab?.click();
  });
  await sleep(500);
}

// Read the rendered rows so we can verify all six show with one picked each.
async function readRows(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#talents-window .tal-row')].map((row) => ({
      level: row.querySelector('.tal-row-lvl')?.textContent?.trim() ?? '',
      locked: row.classList.contains('locked'),
      picked: row.querySelector('.tal-row-opt.sel .tal-row-opt-name')?.textContent?.trim() ?? '',
    }));
    return {
      activeTab: document.querySelector('#talents-window .tal-tab.active')?.textContent?.trim(),
      rows,
    };
  });
}

// Place the player next to a live mob and target it (copied from the playtest helper).
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
    return { ok: true, id: mob.id, name: mob.name };
  });
}

// Cast an ability by id: ensure it is castable, resolve its action-bar button (or, failing
// that, cast it directly through the sim), tick, then report whether a buff aura landed.
async function castAbilityById(page, abilityId) {
  return page.evaluate(async (id) => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.resource = p.maxResource;
    p.gcdRemaining = 0;
    p.casting = null;
    p.dead = false;
    p.hp = p.maxHp;
    for (const ability of sim.known) p.cooldowns[ability.def.id] = 0;

    const resolved = sim.resolvedAbility ? sim.resolvedAbility(id) : null;
    const abilityName = resolved?.def?.name ?? id;

    // Prefer a real action-bar click so the shot mirrors a player.
    const buttons = [
      ...document.querySelectorAll('#actionbar .action-btn, #actionbar2 .action-btn'),
    ];
    const btn = buttons.find((b) => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      return abilityName && label.includes(abilityName.toLowerCase());
    });
    let path = 'none';
    if (btn instanceof HTMLElement) {
      btn.click();
      path = 'actionbar';
    } else if (typeof sim.castAbility === 'function' && resolved) {
      // Fallback: cast straight through the sim by ability id.
      try {
        sim.castAbility(id);
        path = 'castAbility';
      } catch {
        path = 'castThrew';
      }
    }
    // Tick so the cast completes and the aura applies.
    for (let i = 0; i < 80; i += 1) {
      sim.tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const auras = (p.auras ?? []).map((a) => ({ id: a.id, name: a.name }));
    const buffBar = [...document.querySelectorAll('#buff-bar [aria-label], #buff-bar .aura')].map(
      (n) => n.getAttribute('aria-label') || n.textContent || '',
    );
    return {
      path,
      abilityId: id,
      abilityName,
      known: !!resolved,
      auras,
      buffBarCount: buffBar.length,
      buffBarLabels: buffBar.slice(0, 8),
    };
  }, abilityId);
}

async function classFlow(browser, cls) {
  const plan = CLASS_PLAN[cls];
  const entry = { picker: null, moment: null, notes: [], pickFailures: [], castFailures: [] };
  const page = await browser.newPage();
  try {
    await startOffline(
      page,
      cls,
      `${plan.name}${Date.now().toString(36).replace(/\d/g, 'x').slice(-4)}`,
    );
    const applied = await applyRows(page, plan.spec, plan.rows);
    if (!applied.ok) entry.notes.push(`applyTalents returned falsy for spec ${plan.spec}`);
    // Verify every requested row landed.
    for (const [lvl, optId] of Object.entries(plan.rows)) {
      if (applied.rows?.[lvl] !== optId) {
        entry.pickFailures.push(
          `row ${lvl}: wanted ${optId}, got ${applied.rows?.[lvl] ?? '(none)'}`,
        );
      }
    }

    // ---- picker shot ----
    let pickerOk = false;
    for (let attempt = 1; attempt <= 3 && !pickerOk; attempt += 1) {
      await openTalentsChoices(page);
      const rr = await readRows(page);
      const sixRows = rr.rows.length === 6;
      const allPicked = rr.rows.every((r) => r.picked);
      const onChoices = (rr.activeTab || '').toLowerCase().includes('choices');
      if (sixRows && allPicked && onChoices) {
        pickerOk = true;
        entry.notes.push(
          `picker: 6 rows, picks=[${rr.rows.map((r) => `${r.level}:${r.picked}`).join(', ')}]`,
        );
      } else {
        entry.notes.push(
          `picker attempt ${attempt}: rows=${rr.rows.length} tab=${rr.activeTab} picked=[${rr.rows
            .map((r) => r.picked || '-')
            .join(',')}]`,
        );
        // Re-apply and reopen for the next attempt.
        await page.keyboard.press('Escape');
        await sleep(300);
        if (attempt < 3) await applyRows(page, plan.spec, plan.rows);
      }
    }
    entry.picker = await shot(page, cls, 'picker', pickerOk ? '' : '-FAILED');
    if (!pickerOk) entry.notes.push('picker: FAILED after 3 attempts (captured diagnostic shot)');

    // ---- moment shot ----
    // Close the talents window so the combat scene is visible, dismiss the tutorial
    // hint, and close the Game Menu (#options-menu): the Escape presses used to
    // normalize window state OPEN it when no window was up, and it covers the scene.
    await page.evaluate(() => {
      document.querySelector('#talents-window [data-close]')?.click();
      document.querySelector('#tutorial-hint .btn, #tutorial-hint button')?.click();
      const menu = document.querySelector('#options-menu');
      if (menu && getComputedStyle(menu).display !== 'none') {
        window.__game.hud.toggleOptionsMenu();
      }
    });
    await sleep(300);
    const target = await setupTarget(page);
    if (!target.ok) entry.notes.push(`moment: ${target.why}`);
    // Cast the primary buff ability; fall back through alternates until a buff lands.
    const tryList = [plan.moment, ...(plan.momentFallbacks ?? [])];
    let buffLanded = false;
    for (const abilityId of tryList) {
      const castResult = await castAbilityById(page, abilityId);
      if (castResult.auras.length > 0 || castResult.buffBarCount > 0) {
        buffLanded = true;
        entry.notes.push(
          `moment: cast ${abilityId} (${castResult.abilityName}) via ${castResult.path}; buffs=[${castResult.auras
            .map((a) => a.name || a.id)
            .join(', ')}]`,
        );
        break;
      }
      entry.castFailures.push(
        `${abilityId} (${castResult.abilityName}): path=${castResult.path} known=${castResult.known} noBuff`,
      );
    }
    // Give the buff bar a beat to paint, keep the target engaged for the combat framing.
    await page.evaluate(() => {
      const sim = window.__game.sim;
      for (let i = 0; i < 6; i += 1) sim.tick();
    });
    await sleep(500);
    entry.moment = await shot(page, cls, 'moment');
    if (!buffLanded) {
      entry.notes.push(
        `moment: no buff landed after trying [${tryList.join(', ')}] (shot still captured)`,
      );
    }
  } catch (err) {
    entry.notes.push(`EXCEPTION: ${err?.message ?? err}`);
    try {
      entry.picker = entry.picker ?? (await shot(page, cls, 'picker', '-FAILED'));
    } catch {}
  } finally {
    // The browser can crash mid-flow; never let close() mask the report.
    try {
      await page.close();
    } catch (closeErr) {
      entry.notes.push(`page.close failed: ${closeErr?.message ?? closeErr}`);
    }
  }
  report.classes[cls] = entry;
}

const requested = process.argv.slice(2).filter((a) => CLASS_PLAN[a]);
const classes = requested.length ? requested : Object.keys(CLASS_PLAN);

// A fresh browser per class, with one retry: headless Chrome under swiftshader crashes
// occasionally on this host, and a shared instance lets one crash kill the whole matrix.
async function launchBrowser(seq) {
  return puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    // Raise the CDP call timeout: a slow swiftshader first-frame can otherwise trip the
    // default 180s protocol timeout on screenshot/evaluate calls on this host.
    protocolTimeout: 300000,
    args: [
      `--user-data-dir=${BROWSER_PROFILE_DIR}-${seq}`,
      '--disable-crash-reporter',
      '--disable-crashpad',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1600,900',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: { width: 1600, height: 900 },
  });
}

let launchSeq = 0;
for (const cls of classes) {
  let done = false;
  for (let attempt = 1; attempt <= 2 && !done; attempt += 1) {
    launchSeq += 1;
    let browser = null;
    try {
      browser = await launchBrowser(launchSeq);
      await classFlow(browser, cls);
      const entry = report.classes[cls];
      // Retry the whole class once if the flow died before both shots existed.
      done = !!(entry && entry.picker && !entry.picker.includes('FAILED') && entry.moment);
      if (!done && attempt < 2) {
        entry?.notes.push(`class attempt ${attempt} incomplete; relaunching browser`);
      }
    } catch (err) {
      report.classes[cls] = report.classes[cls] ?? {
        picker: null,
        moment: null,
        notes: [],
        pickFailures: [],
        castFailures: [],
      };
      report.classes[cls].notes.push(`attempt ${attempt} crashed: ${err?.message ?? err}`);
    } finally {
      try {
        if (browser) await browser.close();
      } catch {
        try {
          browser?.process()?.kill('SIGKILL');
        } catch {}
      }
    }
  }
}

console.log(JSON.stringify(report, null, 2));
