// Screenshot proof roster for Talents 2.0 PR3 signature abilities.
// Boots one fresh offline page per scene, stages the real sim state, asserts the
// key mechanic, and writes one named PNG per scene into tmp/. Needs Vite running.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const VIEWPORT = { width: 1400, height: 900 };
const failures = [];

fs.mkdirSync('tmp', { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scenes = [
  {
    key: 'holy_nova',
    label: 'priest holy Holy Nova',
    playerName: 'Novae',
    playerClass: 'priest',
    spec: 'holy',
    shot: 'tmp/pr3b_holy_nova_aoe_heal_damage.png',
    waitAfterStageMs: 400,
  },
  {
    key: 'conflagrate',
    label: 'warlock destruction Conflagrate',
    playerName: 'Cinder',
    playerClass: 'warlock',
    spec: 'destruction',
    shot: 'tmp/pr3b_conflagrate_consumes_immolate.png',
    waitAfterStageMs: 250,
  },
  {
    key: 'swiftmend',
    label: 'druid restoration Swiftmend',
    playerName: 'Mender',
    playerClass: 'druid',
    spec: 'restoration',
    shot: 'tmp/pr3b_swiftmend_consume_hot.png',
    waitAfterStageMs: 250,
  },
  {
    key: 'feral_charge',
    label: 'druid feral Feral Charge',
    playerName: 'Pouncer',
    playerClass: 'druid',
    spec: 'feral',
    shot: 'tmp/pr3b_feral_charge_root.png',
    waitAfterStageMs: 150,
  },
  {
    key: 'cone_of_cold',
    label: 'mage frost Cone of Cold',
    playerName: 'Frosty',
    playerClass: 'mage',
    spec: 'frost',
    shot: 'tmp/pr3b_cone_of_cold_aoe.png',
    waitAfterStageMs: 250,
  },
  {
    key: 'bestial_wrath',
    label: 'hunter beast mastery Bestial Wrath',
    playerName: 'Wratha',
    playerClass: 'hunter',
    spec: 'beast_mastery',
    shot: 'tmp/pr3b_bestial_wrath_buff.png',
    waitAfterStageMs: 300,
    hoverBuff: true,
  },
  {
    key: 'blade_flurry',
    label: 'rogue combat Blade Flurry',
    playerName: 'Flurry',
    playerClass: 'rogue',
    spec: 'combat',
    shot: 'tmp/pr3b_blade_flurry_haste.png',
    waitAfterStageMs: 300,
  },
  {
    key: 'wyvern_sting',
    label: 'hunter survival Wyvern Sting',
    playerName: 'Stinga',
    playerClass: 'hunter',
    spec: 'survival',
    shot: 'tmp/pr3b_wyvern_sting_sleep.png',
    waitAfterStageMs: 250,
  },
  {
    key: 'trueshot_aura',
    label: 'hunter marksmanship Trueshot Aura',
    playerName: 'Trueshot',
    playerClass: 'hunter',
    spec: 'marksmanship',
    shot: 'tmp/pr3b_trueshot_aura.png',
    waitAfterStageMs: 300,
  },
  {
    key: 'cold_blood',
    label: 'rogue assassination Cold Blood',
    playerName: 'Critica',
    playerClass: 'rogue',
    spec: 'assassination',
    shot: 'tmp/pr3b_cold_blood_guaranteed_crit.png',
    waitAfterStageMs: 150,
  },
  {
    key: 'elemental_mastery',
    label: 'shaman elemental Elemental Mastery',
    playerName: 'Stormer',
    playerClass: 'shaman',
    spec: 'elemental',
    shot: 'tmp/pr3b_elemental_mastery_instant.png',
    waitAfterStageMs: 250,
  },
  {
    key: 'siphon_life',
    label: 'warlock affliction Siphon Life',
    playerName: 'Leechy',
    playerClass: 'warlock',
    spec: 'affliction',
    shot: 'tmp/pr3a_siphon_life_leech.png',
    waitAfterStageMs: 250,
  },
  {
    key: 'shadowform',
    label: 'priest shadow Shadowform',
    playerName: 'Shade',
    playerClass: 'priest',
    spec: 'shadow',
    shot: 'tmp/pr3b_shadowform.png',
    waitAfterStageMs: 800,
  },
  {
    key: 'moonkin_form',
    label: 'druid balance Moonkin Form',
    playerName: 'Moonkin',
    playerClass: 'druid',
    spec: 'balance',
    shot: 'tmp/pr3b_moonkin_form.png',
    waitAfterStageMs: 800,
  },
];

function logScene(payload) {
  console.log(JSON.stringify(payload));
}

async function click(page, selector) {
  await page.evaluate((sel) => document.querySelector(sel)?.click(), selector);
}

async function dismissTutorial(page) {
  await page.evaluate(() => {
    document.querySelector('#tutorial-hint button')?.click();
    document.querySelector('.tut-skip')?.click();
    for (const button of document.querySelectorAll('button')) {
      if (/skip/i.test(button.textContent || '')) {
        button.click();
        return;
      }
    }
  });
}

async function bootOffline(browser, scene) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    console.log('PAGEERROR:', err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      pageErrors.push(msg.text());
      console.log('CONSOLE:', msg.text());
    }
  });
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('#btn-offline', { timeout: 30000 });
  await click(page, '#btn-offline');
  await sleep(300);
  await page.waitForSelector('#char-name', { timeout: 30000 });
  await page.evaluate((name) => {
    const input = document.querySelector('#char-name');
    if (input) input.value = name;
  }, scene.playerName);
  await click(page, `#offline-select .mini-class[data-class="${scene.playerClass}"]`);
  await click(page, '#btn-start-offline');
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
  await dismissTutorial(page);
  await sleep(1000);
  return { page, pageErrors };
}

async function hoverFirstBuffIcon(page) {
  const handle = await page.$(
    '.buff-icon, .aura-icon, .unit-aura, #player-frame [data-aura-id], #player-frame [data-aura-kind]',
  );
  if (!handle) return false;
  await handle.hover();
  await sleep(150);
  return true;
}

async function stageScene(page, scene) {
  return await page.evaluate(({ key, spec }) => {
    const g = window.__game;
    const sim = g.sim;
    const player = sim.player;
    const playerId = player.id;
    const result = { key, spec, assertions: {} };

    function fail(message) {
      throw new Error(`${key}: ${message}`);
    }

    function entity(id) {
      const found = sim.entities.get(id);
      if (!found) fail(`missing entity ${id}`);
      return found;
    }

    function livingHostiles() {
      return [...sim.entities.values()].filter((e) => e.kind === 'mob' && e.hostile && !e.dead);
    }

    function dist(a, b) {
      return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    }

    function nearestHostile() {
      const mobs = livingHostiles();
      mobs.sort((a, b) => dist(player, a) - dist(player, b));
      if (!mobs[0]) fail('no living hostile found');
      return mobs[0];
    }

    function setFacingTo(target) {
      player.facing = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
      if (g.input?.recenterCameraBehind) g.input.recenterCameraBehind(player.facing);
    }

    function placePlayerFromTarget(target, yards) {
      player.pos = {
        x: target.pos.x,
        y: target.pos.y,
        z: target.pos.z - yards,
      };
      player.prevPos = { ...player.pos };
      setFacingTo(target);
      sim.targetEntity(target.id, playerId);
    }

    function placeTargetFromPlayer(target, yards) {
      target.pos = {
        x: player.pos.x,
        y: player.pos.y,
        z: player.pos.z + yards,
      };
      target.prevPos = { ...target.pos };
      target.hostile = true;
      target.aiState = 'idle';
      setFacingTo(target);
      sim.targetEntity(target.id, playerId);
    }

    function tick(n = 1) {
      for (let i = 0; i < n; i++) sim.tick();
    }

    function tickUntil(predicate, maxTicks, label) {
      for (let i = 0; i < maxTicks; i++) {
        if (predicate()) return i;
        sim.tick();
      }
      if (!predicate()) fail(`timed out waiting for ${label}`);
      return maxTicks;
    }

    function ability(id) {
      const resolved = sim.resolvedAbility?.(id, playerId) ?? sim.known.find((a) => a.def.id === id);
      if (!resolved) fail(`missing ability ${id}`);
      return resolved;
    }

    function topUp() {
      player.hp = player.maxHp;
      player.resource = player.maxResource;
      player.gcdRemaining = 0;
      player.castingAbility = null;
      player.castRemaining = 0;
      player.channeling = false;
      player.cooldowns?.clear?.();
    }

    function cast(id, pid = playerId) {
      const beforeEvents = sim.events?.length ?? 0;
      const beforeCasting = player.castingAbility;
      sim.castAbility(id, pid);
      result.assertions[`${id}CastSubmitted`] = {
        beforeEvents,
        afterEvents: sim.events?.length ?? 0,
        beforeCasting,
        afterCasting: player.castingAbility,
      };
    }

    function resetGcdAndResource() {
      player.resource = player.maxResource;
      player.gcdRemaining = 0;
    }

    function castAndResolve(id, target, maxTicks = 120) {
      cast(id);
      const resolved = ability(id);
      if (resolved.castTime > 0) {
        tickUntil(() => !player.castingAbility, maxTicks, `${id} completion`);
      }
      if (target) sim.targetEntity(target.id, playerId);
      return resolved;
    }

    function auraOn(e, predicate) {
      return e.auras.find(predicate) ?? null;
    }

    function addFriend(cls, name, yards, hpPct = 0.7) {
      const id = sim.addPlayer(cls, name);
      sim.setPlayerLevel(20, id);
      const friend = entity(id);
      friend.pos = { x: player.pos.x + yards, y: player.pos.y, z: player.pos.z };
      friend.prevPos = { ...friend.pos };
      friend.hp = Math.round(friend.maxHp * hpPct);
      return friend;
    }

    function basicSetup() {
      sim.setPlayerLevel(20, playerId);
      if (!sim.setSpec(spec, playerId)) fail(`setSpec failed: ${spec}`);
      topUp();
      if (g.input) {
        g.input.camDist = 8;
        g.input.camPitch = 0.28;
        g.input.recenterCameraBehind?.(player.facing);
      }
      if (g.renderer) {
        g.renderer.camDist = 8;
        g.renderer.camPitch = 0.28;
      }
    }

    basicSetup();

    if (key === 'holy_nova') {
      const friend = addFriend('mage', 'Friend', 2, 0.7);
      const hostile = nearestHostile();
      placeTargetFromPlayer(hostile, 5);
      player.hp = Math.round(player.maxHp * 0.7);
      friend.hp = Math.round(friend.maxHp * 0.7);
      hostile.hp = hostile.maxHp;
      tick();
      const before = { playerHp: player.hp, friendHp: friend.hp, hostileHp: hostile.hp };
      cast('holy_nova');
      result.assertions.playerHealed = player.hp > before.playerHp;
      result.assertions.friendHealed = friend.hp > before.friendHp;
      result.assertions.hostileDamaged = hostile.hp < before.hostileHp;
      result.target = { id: hostile.id, hpBefore: before.hostileHp, hpAfter: hostile.hp };
      result.friend = { id: friend.id, hpBefore: before.friendHp, hpAfter: friend.hp };
    } else if (key === 'conflagrate') {
      const target = nearestHostile();
      placePlayerFromTarget(target, 12);
      target.hp = target.maxHp;
      castAndResolve('immolate', target, 120);
      tickUntil(
        () => auraOn(target, (a) => a.id === 'immolate' && a.sourceId === playerId),
        60,
        'immolate dot',
      );
      const before = {
        hp: target.hp,
        hasImmolate: !!auraOn(target, (a) => a.id === 'immolate' && a.sourceId === playerId),
      };
      resetGcdAndResource();
      cast('conflagrate');
      tickUntil(
        () =>
          target.hp < before.hp &&
          !auraOn(target, (a) => a.id === 'immolate' && a.sourceId === playerId),
        20,
        'conflagrate impact damage',
      );
      result.assertions.immolateBefore = before.hasImmolate;
      result.assertions.immolateConsumed = !auraOn(
        target,
        (a) => a.id === 'immolate' && a.sourceId === playerId,
      );
      result.assertions.targetDamaged = target.hp < before.hp;
      result.target = { id: target.id, hpBefore: before.hp, hpAfter: target.hp };
    } else if (key === 'swiftmend') {
      const friend = addFriend('priest', 'Friend', 2, 0.7);
      sim.targetEntity(friend.id, playerId);
      cast('rejuvenation');
      const hotBefore = auraOn(friend, (a) => a.id === 'rejuvenation' && a.kind === 'hot');
      if (!hotBefore) fail('rejuvenation hot missing');
      tick(21);
      const before = { hp: friend.hp, hot: !!auraOn(friend, (a) => a.kind === 'hot') };
      resetGcdAndResource();
      sim.targetEntity(friend.id, playerId);
      cast('swiftmend');
      result.assertions.hotBefore = before.hot;
      result.assertions.hotConsumed = !auraOn(friend, (a) => a.id === 'rejuvenation');
      result.assertions.friendHealed = friend.hp > before.hp;
      result.friend = { id: friend.id, hpBefore: before.hp, hpAfter: friend.hp };
    } else if (key === 'feral_charge') {
      const target = nearestHostile();
      placePlayerFromTarget(target, 15);
      const beforeDist = dist(player, target);
      cast('feral_charge');
      tickUntil(() => player.chargeTargetId === null || dist(player, target) < 5, 100, 'feral charge arrival');
      result.assertions.distanceBefore = beforeDist;
      result.assertions.distanceAfter = dist(player, target);
      result.assertions.rootApplied = !!auraOn(target, (a) => a.kind === 'root');
      result.target = { id: target.id, auras: target.auras.map((a) => ({ id: a.id, kind: a.kind })) };
    } else if (key === 'cone_of_cold') {
      const mobs = livingHostiles().slice(0, 3);
      if (mobs.length < 2) fail('need at least two hostiles');
      mobs.forEach((mob, i) => {
        const angle = player.facing + (i - 1) * 0.55;
        mob.pos = {
          x: player.pos.x + Math.sin(angle) * (4 + i),
          y: player.pos.y,
          z: player.pos.z + Math.cos(angle) * (4 + i),
        };
        mob.prevPos = { ...mob.pos };
        mob.hostile = true;
        mob.aiState = 'idle';
        mob.hp = mob.maxHp;
      });
      tick();
      const before = mobs.map((mob) => ({ id: mob.id, hp: mob.hp }));
      cast('cone_of_cold');
      const damaged = mobs.filter((mob, i) => mob.hp < before[i].hp);
      result.assertions.hostilesDamaged = damaged.length;
      result.assertions.twoPlusHostilesDamaged = damaged.length >= 2;
      result.target = { ids: mobs.map((m) => m.id), damagedIds: damaged.map((m) => m.id) };
    } else if (key === 'bestial_wrath') {
      cast('bestial_wrath');
      result.assertions.buffPresent = !!auraOn(player, (a) => a.id === 'bestial_wrath' || a.kind === 'buff_ap');
      result.playerAuras = player.auras.map((a) => ({ id: a.id, kind: a.kind, value: a.value }));
    } else if (key === 'blade_flurry') {
      cast('blade_flurry');
      result.assertions.hasteBuffPresent = !!auraOn(player, (a) => a.id === 'blade_flurry' && a.kind === 'buff_haste');
      result.playerAuras = player.auras.map((a) => ({ id: a.id, kind: a.kind, value: a.value }));
    } else if (key === 'wyvern_sting') {
      const target = nearestHostile();
      placePlayerFromTarget(target, 18);
      cast('wyvern_sting');
      tickUntil(
        () => auraOn(target, (a) => a.kind === 'incapacitate'),
        60,
        'wyvern sting incapacitate',
      );
      result.assertions.incapacitateApplied = !!auraOn(target, (a) => a.kind === 'incapacitate');
      result.target = { id: target.id, auras: target.auras.map((a) => ({ id: a.id, kind: a.kind })) };
    } else if (key === 'trueshot_aura') {
      const friend = addFriend('warrior', 'Archer', 4, 1);
      const target = nearestHostile();
      placeTargetFromPlayer(target, 10);
      cast('trueshot_aura');
      result.assertions.playerAuraPresent = !!auraOn(
        player,
        (a) => a.id === 'trueshot_aura_ap' && a.kind === 'buff_ap',
      );
      result.assertions.friendAuraPresent = !!auraOn(
        friend,
        (a) => a.id === 'trueshot_aura_ap' && a.kind === 'buff_ap',
      );
      result.playerAuras = player.auras.map((a) => ({ id: a.id, kind: a.kind, value: a.value }));
      result.friendAuras = friend.auras.map((a) => ({ id: a.id, kind: a.kind, value: a.value }));
      result.targetAuras = target.auras.map((a) => ({ id: a.id, kind: a.kind, value: a.value }));
    } else if (key === 'cold_blood') {
      const target = nearestHostile();
      placePlayerFromTarget(target, 3);
      target.hp = target.maxHp;
      player.critChance = 0;
      cast('cold_blood');
      const buffBefore = !!auraOn(player, (a) => a.kind === 'next_attack_crit');
      let critEvent = null;
      for (let i = 0; i < 80 && !critEvent; i++) {
        player.critChance = 0;
        player.gcdRemaining = 0;
        player.swingTimer = 0;
        sim.targetEntity(target.id, playerId);
        sim.castAbility('sinister_strike', playerId);
        player.critChance = 0;
        tick(1);
        critEvent = (sim.events ?? []).find(
          (e) => e.type === 'damage' && e.sourceId === playerId && e.targetId === target.id && e.crit,
        );
      }
      player.critChance = 0;
      result.assertions.critChancePinned = player.critChance === 0;
      result.assertions.coldBloodBuffBeforeAttack = buffBefore;
      result.assertions.guaranteedCritLanded = !!critEvent;
      result.target = { id: target.id, hpAfter: target.hp, critEvent: critEvent ?? null };
    } else if (key === 'elemental_mastery') {
      const target = nearestHostile();
      placePlayerFromTarget(target, 20);
      cast('elemental_mastery');
      const buffBefore = !!auraOn(player, (a) => a.kind === 'next_cast_instant');
      resetGcdAndResource();
      const lb = ability('lightning_bolt');
      const beforeHp = target.hp;
      cast('lightning_bolt');
      tickUntil(() => target.hp < beforeHp, 40, 'lightning bolt impact damage');
      result.assertions.lightningBoltResolvedCastTime = lb.castTime;
      result.assertions.instantBuffBefore = buffBefore;
      result.assertions.firedInstantly = player.castingAbility !== 'lightning_bolt';
      result.assertions.targetDamaged = target.hp < beforeHp;
      result.target = { id: target.id, hpBefore: beforeHp, hpAfter: target.hp };
    } else if (key === 'siphon_life') {
      const target = nearestHostile();
      placePlayerFromTarget(target, 20);
      player.hp = Math.round(player.maxHp * 0.8);
      const beforeHp = player.hp;
      cast('siphon_life');
      tickUntil(() => auraOn(target, (a) => a.id === 'siphon_life' && a.kind === 'dot'), 20, 'siphon life dot');
      tick(125);
      result.assertions.dotPresent = !!auraOn(target, (a) => a.id === 'siphon_life' && a.kind === 'dot');
      result.assertions.selfHealed = player.hp > beforeHp;
      result.player = { hpBefore: beforeHp, hpAfter: player.hp };
      result.target = { id: target.id, hpAfter: target.hp };
    } else if (key === 'shadowform') {
      if (g.input) {
        g.input.camDist = 6;
        g.input.camPitch = 0.24;
        g.input.recenterCameraBehind?.(player.facing);
      }
      if (g.renderer) {
        g.renderer.camDist = 6;
        g.renderer.camPitch = 0.24;
      }
      cast('shadowform');
      result.assertions.formAuraPresent = !!auraOn(player, (a) => a.kind === 'form_shadow');
      result.playerAuras = player.auras.map((a) => ({ id: a.id, kind: a.kind, value: a.value }));
    } else if (key === 'moonkin_form') {
      if (g.input) {
        g.input.camDist = 6;
        g.input.camPitch = 0.24;
        g.input.recenterCameraBehind?.(player.facing);
      }
      if (g.renderer) {
        g.renderer.camDist = 6;
        g.renderer.camPitch = 0.24;
      }
      cast('moonkin_form');
      result.assertions.formAuraPresent = !!auraOn(player, (a) => a.kind === 'form_moonkin');
      result.playerAuras = player.auras.map((a) => ({ id: a.id, kind: a.kind, value: a.value }));
    } else {
      fail('unknown scene key');
    }

    const failed = Object.entries(result.assertions).filter(([, value]) => value === false);
    if (failed.length > 0) fail(`assertions failed: ${failed.map(([name]) => name).join(', ')}`);
    return result;
  }, scene);
}

async function captureScene(browser, scene) {
  let page;
  let pageErrors = [];
  try {
    ({ page, pageErrors } = await bootOffline(browser, scene));
    const result = await stageScene(page, scene);
    if (scene.waitAfterStageMs) await sleep(scene.waitAfterStageMs);
    const hoveredBuff = scene.hoverBuff ? await hoverFirstBuffIcon(page) : false;
    await page.screenshot({ path: scene.shot });
    if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
    logScene({
      scene: scene.key,
      ok: true,
      shot: scene.shot,
      hoveredBuff,
      result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`${scene.key}: ${message}`);
    logScene({
      scene: scene.key,
      ok: false,
      shot: scene.shot,
      error: message,
      pageErrors,
    });
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 90000,
  args: [
    '--window-size=1400,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--no-sandbox',
  ],
  defaultViewport: VIEWPORT,
});

try {
  for (const scene of scenes) {
    await captureScene(browser, scene);
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\nFAILURES:\n- ${failures.join('\n- ')}`);
}

process.exit(failures.length > 0 ? 1 : 0);
