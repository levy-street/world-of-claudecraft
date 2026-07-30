// Ten bots clear all three wings of The Undermount Descent over the real server.
// The AI reads only snapshots and events available to an ordinary online client.
// Requires the server running with ALLOW_DEV_COMMANDS=1.
import WebSocket from 'ws';
import { worldAuthMessage } from './lib/world_auth.mjs';

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
const uniq = Date.now().toString(36);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).slice(-5);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DECISION_MS = 250;
const FIGHT_TIMEOUT_MS = 480_000;
const ODRENN_ARC_RADIUS = 8;
const FORGEHEAT_RIM = 5;
const VENT_EVADE_STEP = 8;

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${extra ? ` ${extra}` : ''}`);
  }
}

async function api(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// These self fields are delta-compressed. Absence means unchanged, not empty.
// Auras are intentionally excluded because this client negotiates the legacy
// timer wire, where an absent aura field means the current aura set is empty.
const DELTA_SELF_KEYS = [
  'inv',
  'equip',
  'qlog',
  'qdone',
  'cds',
  'stats',
  'weapon',
  'party',
  'trade',
  'duel',
  'lockouts',
];
function mergeSelf(prev, next) {
  if (prev) {
    for (const key of DELTA_SELF_KEYS) {
      if (!(key in next) && key in prev) next[key] = prev[key];
    }
  }
  return next;
}

// Identity fields ride only when changed. Dynamic fields such as position,
// health, death, casting and legacy auras are complete in every live record.
const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn', 'mh', 'oh', 'eq'];
function mergeEnts(prevEnts, snap) {
  const next = new Map();
  for (const wire of snap.ents) {
    const prev = prevEnts.get(wire.id);
    if (prev && wire.k === undefined) {
      for (const key of ENTITY_IDENTITY_KEYS) {
        if (!(key in wire) && key in prev) wire[key] = prev[key];
      }
    }
    next.set(wire.id, wire);
  }
  for (const id of snap.keep ?? []) {
    const prev = prevEnts.get(id);
    if (prev) next.set(id, prev);
  }
  return next;
}

function isNoteworthyEvent(event) {
  if (event.type === 'damage') return event.ability === 'Undermount Eruption';
  if (event.type === 'heal2') return true;
  return ['death', 'aura', 'chat', 'log', 'loot', 'lootRoll', 'masterLoot', 'error'].includes(
    event.type,
  );
}

class Bot {
  constructor(config) {
    Object.assign(this, config);
    this.pid = -1;
    this.self = null;
    this.ents = new Map();
    this.vents = [];
    this.events = [];
    this.history = [];
    this.pending = new Map();
    this.nextRid = 1;
    this.healCasts = 0;
  }

  async join() {
    const reg = await api('/api/register', {
      username: `undermount_${this.name}_${uniq}`,
      password: 'hunter22',
      email: `undermount_${this.name}_${uniq}@example.com`,
    });
    if (reg.status !== 200 || typeof reg.body.token !== 'string') {
      throw new Error(`${this.name} register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    }
    this.token = reg.body.token;
    const char = await api(
      '/api/characters',
      { name: this.name + alpha, class: this.cls },
      this.token,
    );
    if (char.status !== 200 || typeof char.body.id !== 'number') {
      throw new Error(`${this.name} character failed: ${char.status} ${JSON.stringify(char.body)}`);
    }
    this.charId = char.body.id;

    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const timeout = setTimeout(() => reject(new Error(`${this.name} join timeout`)), 8000);
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify(worldAuthMessage(this.token, this.charId)));
      });
      this.ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.t === 'hello') {
          this.pid = msg.pid;
          clearTimeout(timeout);
          resolve();
        } else if (msg.t === 'snap') {
          this.self = mergeSelf(this.self, msg.self);
          this.ents = mergeEnts(this.ents, msg);
          this.ents.set(this.self.id, this.self);
          this.vents = Array.isArray(msg.undermountVents) ? msg.undermountVents : [];
        } else if (msg.t === 'events') {
          this.events.push(...msg.list);
          this.history.push(...msg.list.filter(isNoteworthyEvent));
        } else if (msg.t === 'commandOutcome') {
          const pending = this.pending.get(msg.rid);
          if (pending) {
            this.pending.delete(msg.rid);
            pending.resolve(msg.ok === true);
          }
        }
      });
      this.ws.on('error', reject);
      this.ws.on('close', () => {
        for (const pending of this.pending.values()) pending.resolve(false);
        this.pending.clear();
      });
    });
  }

  cmd(payload) {
    this.ws.send(JSON.stringify({ t: 'cmd', ...payload }));
  }

  request(payload, timeoutMs = 5000) {
    const rid = this.nextRid++;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(rid);
        resolve(false);
      }, timeoutMs);
      this.pending.set(rid, {
        resolve: (ok) => {
          clearTimeout(timeout);
          resolve(ok);
        },
      });
      this.ws.send(JSON.stringify({ t: 'cmd', ...payload, rid }));
    });
  }

  input(mi, facing) {
    this.ws.send(
      JSON.stringify({
        t: 'input',
        mi,
        ...(facing === undefined ? {} : { facing }),
      }),
    );
  }

  pos() {
    return this.self ? { x: this.self.x, z: this.self.z } : { x: 0, z: 0 };
  }

  dist(point) {
    const pos = this.pos();
    return Math.hypot(point.x - pos.x, point.z - pos.z);
  }

  faceTo(point) {
    const pos = this.pos();
    return Math.atan2(point.x - pos.x, point.z - pos.z);
  }

  entityByTemplate(templateId) {
    return [...this.ents.values()].find((entity) => entity.tid === templateId);
  }

  liveMobByTemplate(templateId) {
    return [...this.ents.values()].find(
      (entity) => entity.k === 'mob' && entity.tid === templateId && !entity.dead && entity.h,
    );
  }

  close() {
    this.ws?.close();
  }
}

function raidBots() {
  return [
    new Bot({ name: 'Aegis', cls: 'warrior', spec: 'prot', role: 'tank' }),
    new Bot({ name: 'Mercy', cls: 'priest', spec: 'holy', role: 'healer' }),
    new Bot({ name: 'Beacon', cls: 'paladin', spec: 'holy', role: 'healer' }),
    new Bot({ name: 'Cinder', cls: 'mage', spec: 'fire', role: 'dps', cinderDps: true }),
    new Bot({ name: 'Ember', cls: 'mage', spec: 'fire', role: 'dps', cinderDps: true }),
    new Bot({ name: 'Flare', cls: 'mage', spec: 'fire', role: 'dps' }),
    new Bot({ name: 'Pyre', cls: 'mage', spec: 'fire', role: 'dps' }),
    new Bot({ name: 'Arrow', cls: 'hunter', spec: 'marksmanship', role: 'dps' }),
    new Bot({ name: 'Quiver', cls: 'hunter', spec: 'marksmanship', role: 'dps' }),
    new Bot({ name: 'Volley', cls: 'hunter', spec: 'marksmanship', role: 'dps' }),
  ];
}

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(100);
  }
  console.log(`  timed out waiting for ${label}`);
  return false;
}

async function formRaid(bots) {
  const leader = bots[0];
  for (const bot of bots.slice(1, 5)) {
    leader.cmd({ cmd: 'pinvite', id: bot.pid });
    await sleep(250);
    bot.cmd({ cmd: 'paccept' });
    await sleep(250);
  }
  const partyReady = await waitFor(
    () => leader.self?.party?.members?.length === 5,
    5000,
    'five-player party',
  );
  check('five-player party formed', partyReady);

  leader.cmd({ cmd: 'praid' });
  const converted = await waitFor(
    () => leader.self?.party?.raid === true,
    5000,
    'party to raid conversion',
  );
  check('party converted to raid', converted);

  for (const bot of bots.slice(5)) {
    leader.cmd({ cmd: 'pinvite', id: bot.pid });
    await sleep(250);
    bot.cmd({ cmd: 'paccept' });
    await sleep(250);
  }
  const fullRaid = await waitFor(
    () =>
      bots.every((bot) => bot.self?.party?.raid === true && bot.self.party.members?.length === 10),
    7000,
    'ten-player raid',
  );
  check('ten-player raid formed', fullRaid, `leaderMembers=${leader.self?.party?.members?.length}`);
}

async function devPrep(bots) {
  for (const bot of bots) {
    bot.cmd({ cmd: 'dev_level', level: 20 });
    bot.cmd({ cmd: 'chat', text: `/dev kit ${bot.spec}` });
    await sleep(100);
  }
  const leveled = await waitFor(
    () => bots.every((bot) => bot.self?.lv === 20),
    5000,
    'level 20 snapshots',
  );
  const geared = await waitFor(
    () =>
      bots.every((bot) =>
        bot.history.some(
          (event) => event.type === 'log' && event.text?.includes('[dev] Equipped the fresh-20'),
        ),
      ),
    5000,
    'dev kit confirmation',
  );
  check('all bots reached level 20', leveled, JSON.stringify(bots.map((bot) => bot.self?.lv)));
  check('all bots received dev gear', geared);
}

async function enterWing(bots, dungeonId, bossTemplates, label) {
  const outcomes = [];
  for (const bot of bots) {
    outcomes.push(await bot.request({ cmd: 'enter_dungeon', dungeon: dungeonId }));
    await sleep(100);
  }
  const snapshots = await waitFor(
    () =>
      bots.every((bot) => bossTemplates.every((templateId) => bot.entityByTemplate(templateId))),
    8000,
    `${label} snapshots`,
  );
  const sharedBossIds = bossTemplates.every(
    (templateId) =>
      new Set(bots.map((bot) => bot.entityByTemplate(templateId)?.id).filter(Boolean)).size === 1,
  );
  const positions = bots.map((bot) => bot.pos());
  const sameInstance = positions.every(
    (pos) => Math.hypot(pos.x - positions[0].x, pos.z - positions[0].z) < 20,
  );
  check(`${label} entry commands succeeded`, outcomes.every(Boolean), JSON.stringify(outcomes));
  check(`${label} has all ten bots in one instance`, snapshots && sharedBossIds && sameInstance);
  return outcomes.every(Boolean) && snapshots && sharedBossIds && sameInstance;
}

async function moveRaidToDoor(bots, dungeonId) {
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    let arrived = 0;
    for (const bot of bots) {
      if (!bot.self || bot.self.dead) continue;
      const door = [...bot.ents.values()].find(
        (entity) => entity.tid === 'dungeon_door' && entity.dgn === dungeonId,
      );
      if (!door) {
        bot.input({ f: 1 }, 0);
        continue;
      }
      if (bot.dist(door) <= 6) {
        bot.input({});
        arrived++;
      } else {
        bot.input({ f: 1 }, bot.faceTo(door));
      }
    }
    if (arrived === bots.length) return true;
    await sleep(DECISION_MS);
  }
  return false;
}

function lowestHurtMember(bot, tankPid, threshold = 0.84) {
  const members = bot.self?.party?.members ?? [];
  const tank = members.find((member) => member.pid === tankPid && !member.dead);
  if (tank && tank.hp / Math.max(1, tank.mhp) < 0.9) return tank;
  return members
    .filter((member) => !member.dead && member.hp / Math.max(1, member.mhp) < threshold)
    .sort((a, b) => a.hp / a.mhp - b.hp / b.mhp)[0];
}

function castHeal(bot, tankPid) {
  const hurt = lowestHurtMember(bot, tankPid);
  if (!hurt || (bot.self?.gcd ?? 0) > 0 || bot.self?.cast) return false;
  bot.cmd({
    cmd: 'cast',
    ability: bot.cls === 'priest' ? 'lesser_heal' : 'holy_light',
    target: hurt.pid,
  });
  bot.healCasts++;
  return true;
}

function attackAbility(bot) {
  if (bot.cls === 'warrior' && (bot.self?.res ?? 0) >= 15) return 'heroic_strike';
  if (bot.cls === 'mage' && (bot.self?.res ?? 0) >= 30) return 'fireball';
  if (bot.cls === 'hunter' && (bot.self?.res ?? 0) >= 25) return 'arcane_shot';
  if (bot.cls === 'priest' && (bot.self?.res ?? 0) >= 25) return 'smite';
  return null;
}

function fightTarget(bot, target, opts = {}) {
  const distance = bot.dist(target);
  const range = bot.cls === 'warrior' || bot.cls === 'paladin' ? 4 : 26;
  if (opts.holdPosition && distance > range) {
    bot.input({});
    return false;
  }
  if (distance > range) {
    bot.input({ f: 1 }, bot.faceTo(target));
    return false;
  }
  bot.input({}, bot.faceTo(target));
  if (bot.self?.target !== target.id) bot.cmd({ cmd: 'target', id: target.id });
  bot.cmd({ cmd: 'attack' });
  if ((bot.self?.gcd ?? 0) <= 0 && !bot.self?.cast) {
    const ability = attackAbility(bot);
    if (ability) bot.cmd({ cmd: 'cast', ability });
  }
  return true;
}

function stopRaid(bots) {
  for (const bot of bots) bot.input({});
}

function historyHas(bots, predicate) {
  return bots.some((bot) => bot.history.some(predicate));
}

function wingLockoutLanded(bots, dungeonId) {
  const now = Date.now();
  return bots.every((bot) => Number(bot.self?.lockouts?.[dungeonId] ?? 0) > now);
}

async function waitForLockout(bots, dungeonId) {
  return waitFor(() => wingLockoutLanded(bots, dungeonId), 5000, `${dungeonId} lockout`);
}

async function lootBosses(bots, templateIds) {
  const looter = bots[0];
  const corpses = templateIds
    .map((templateId) => looter.entityByTemplate(templateId))
    .filter((entity) => entity?.dead && entity.lootList);
  const outcomes = [];
  for (const corpse of corpses) {
    outcomes.push(await looter.request({ cmd: 'loot', id: corpse.id }));
    await sleep(300);
  }
  await sleep(800);
  return outcomes;
}

async function runWingOne(bots) {
  await waitFor(
    () =>
      bots[0].liveMobByTemplate('vosh_the_glazier') && bots[0].liveMobByTemplate('saan_the_stoker'),
    5000,
    'Kiln-Keepers snapshot',
  );
  const start = Date.now();
  let lastTelemetry = 0;
  let sawBothEngaged = false;
  let sawFrenzy = false;

  while (Date.now() - start < FIGHT_TIMEOUT_MS) {
    const anchor = bots[0];
    const vosh = anchor.liveMobByTemplate('vosh_the_glazier');
    const saan = anchor.liveMobByTemplate('saan_the_stoker');
    if (!vosh && !saan) break;
    sawBothEngaged ||= Boolean(vosh?.aggro && saan?.aggro);
    sawFrenzy ||= Boolean(saan?.auras?.some((aura) => aura.name === 'Kiln Fury'));
    const focusTemplate = vosh ? 'vosh_the_glazier' : 'saan_the_stoker';

    if (Date.now() - lastTelemetry > 15_000) {
      lastTelemetry = Date.now();
      console.log(
        `  wing1 t=${Math.round((Date.now() - start) / 1000)}s ` +
          `Vosh=${vosh ? `${vosh.hp}/${vosh.mhp}` : 'dead'} ` +
          `Saan=${saan ? `${saan.hp}/${saan.mhp}` : 'dead'}`,
      );
    }

    for (const bot of bots) {
      if (!bot.self || bot.self.dead) continue;
      if (bot.role === 'healer' && castHeal(bot, bots[0].pid)) continue;
      const target = bot.liveMobByTemplate(focusTemplate);
      if (target) fightTarget(bot, target);
    }
    await sleep(DECISION_MS);
  }
  stopRaid(bots);
  await sleep(800);

  const killed =
    bots[0].entityByTemplate('vosh_the_glazier')?.dead &&
    bots[0].entityByTemplate('saan_the_stoker')?.dead;
  check('wing 1 pulled both Kiln-Keepers', sawBothEngaged);
  check('wing 1 focused Vosh, then killed frenzied Saan', Boolean(killed && sawFrenzy));
  check('wing 1 lockout landed for all ten bots', await waitForLockout(bots, 'undermount_wing1'));

  await sleep(5500);
  const maerinLines = bots[0].history.filter(
    (event) =>
      event.type === 'chat' &&
      event.channel === 'yell' &&
      event.authoredSpeaker?.templateId === 'runeseeker_maerin',
  );
  check(
    'Maerin delivered all three wing 1 lines',
    maerinLines.length >= 3,
    `lines=${maerinLines.length}`,
  );

  const lootOutcomes = await lootBosses(bots, ['vosh_the_glazier', 'saan_the_stoker']);
  check('wing 1 boss loot opened', lootOutcomes.some(Boolean), JSON.stringify(lootOutcomes));
}

function odrennFormation(centerX, centerZ, index) {
  if (index === 0) return { x: centerX + 4, z: centerZ };
  const slot = index - 1;
  const row = slot % 2;
  const column = Math.floor(slot / 2);
  return {
    x: centerX + 11 + row * 10,
    z: centerZ - 20 + column * 10,
  };
}

function moveTowardPoint(bot, point, stopAt = 2) {
  if (bot.dist(point) <= stopAt) {
    bot.input({});
    return true;
  }
  bot.input({ f: 1 }, bot.faceTo(point));
  return false;
}

function lowHealthSpreadGoal(bot, bots, centerX) {
  if ((bot.self?.hp ?? 0) / Math.max(1, bot.self?.mhp ?? 1) >= 0.45) return null;
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const other of bots) {
    if (other === bot || !other.self || other.self.dead) continue;
    const distance = bot.dist(other.pos());
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = other;
    }
  }
  if (!nearest || nearestDistance > ODRENN_ARC_RADIUS + 1) return null;
  const pos = bot.pos();
  const awayX = pos.x - nearest.self.x;
  const awayZ = pos.z - nearest.self.z;
  const length = Math.hypot(awayX, awayZ) || 1;
  return {
    x: Math.max(centerX + 4, pos.x + (awayX / length) * 10),
    z: pos.z + (awayZ / length) * 10,
  };
}

function nearestLivingBotDistance(bot, bots) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const other of bots) {
    if (other === bot || !other.self || other.self.dead) continue;
    nearest = Math.min(nearest, bot.dist(other.pos()));
  }
  return nearest;
}

async function runWingTwo(bots) {
  await waitFor(() => bots[0].liveMobByTemplate('odrenn_the_temperer'), 5000, 'Odrenn snapshot');
  const initial = bots[0].liveMobByTemplate('odrenn_the_temperer');
  const centerX = initial?.x ?? bots[0].self.x;
  const centerZ = initial?.z ?? bots[0].self.z + 36;
  const start = Date.now();
  let lastTelemetry = 0;
  let sawScorchedFormation = false;
  let sameSideMaintained = true;
  let sawWrongMark = false;
  let sawMixedBurn = false;
  let sawLowHealth = false;
  let lowBotSpread = false;

  while (Date.now() - start < FIGHT_TIMEOUT_MS) {
    const boss = bots[0].liveMobByTemplate('odrenn_the_temperer');
    if (!boss) break;
    for (const bot of bots) {
      for (const event of bot.events.splice(0)) {
        if (event.type === 'damage' && event.ability === 'Tempering Clash') sawMixedBurn = true;
      }
    }
    if (Date.now() - lastTelemetry > 15_000) {
      lastTelemetry = Date.now();
      console.log(
        `  wing2 t=${Math.round((Date.now() - start) / 1000)}s Odrenn=${boss.hp}/${boss.mhp}`,
      );
    }

    const marks = bots
      .filter((bot) => !bot.self?.dead)
      .map(
        (bot) =>
          (bot.self?.auras ?? []).find(
            (aura) => aura.id === 'odrenn_scorched' || aura.id === 'odrenn_chilled',
          )?.id,
      );
    const allMarked = marks.length === bots.length && marks.every(Boolean);
    if (allMarked) {
      const allScorched = marks.every((mark) => mark === 'odrenn_scorched');
      sawScorchedFormation ||= allScorched;
      sameSideMaintained &&= allScorched;
    } else if (sawScorchedFormation) {
      sameSideMaintained = false;
    }
    sawWrongMark ||= marks.some((mark) => mark === 'odrenn_chilled');

    for (let index = 0; index < bots.length; index++) {
      const bot = bots[index];
      if (!bot.self || bot.self.dead) continue;
      const lowHealth = bot.self.hp / Math.max(1, bot.self.mhp) < 0.45;
      sawLowHealth ||= lowHealth;
      const spreadGoal = lowHealthSpreadGoal(bot, bots, centerX);
      if (spreadGoal) {
        moveTowardPoint(bot, spreadGoal);
        continue;
      }
      if (lowHealth && nearestLivingBotDistance(bot, bots) > ODRENN_ARC_RADIUS + 1) {
        lowBotSpread = true;
      }
      const formation = odrennFormation(centerX, centerZ, index);
      if (!moveTowardPoint(bot, formation)) continue;
      if (bot.role === 'healer' && castHeal(bot, bots[0].pid)) continue;
      const localBoss = bot.liveMobByTemplate('odrenn_the_temperer');
      if (localBoss) fightTarget(bot, localBoss, { holdPosition: true });
    }
    await sleep(DECISION_MS);
  }
  stopRaid(bots);
  await sleep(800);

  check(
    'wing 2 kept every living bot on the Scorched side',
    sawScorchedFormation && sameSideMaintained && !sawWrongMark,
  );
  check('wing 2 never triggered mixed-mark burn', !sawMixedBurn);
  if (sawLowHealth) {
    check('wing 2 spread a low bot beyond Cinder Arc range', lowBotSpread);
  } else {
    check('wing 2 had no low-health spread trigger', true);
  }
  check(
    'Odrenn the Temperer defeated',
    Boolean(bots[0].entityByTemplate('odrenn_the_temperer')?.dead),
  );
  check('wing 2 lockout landed for all ten bots', await waitForLockout(bots, 'undermount_wing2'));

  const lootOutcomes = await lootBosses(bots, ['odrenn_the_temperer']);
  check('wing 2 boss loot opened', lootOutcomes.some(Boolean), JSON.stringify(lootOutcomes));
}

function unsafeVent(bot) {
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const vent of bot.vents) {
    const distance = bot.dist(vent);
    if (distance <= Number(vent.r ?? 0) + FORGEHEAT_RIM && distance < nearestDistance) {
      nearest = vent;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function evadeVent(bot, vent) {
  const pos = bot.pos();
  let dx = pos.x - vent.x;
  let dz = pos.z - vent.z;
  let length = Math.hypot(dx, dz);
  if (length < 0.01) {
    dx = bot.pid % 2 === 0 ? 1 : -1;
    dz = bot.pid % 3 === 0 ? 1 : -1;
    length = Math.hypot(dx, dz);
  }
  const goal = {
    x: pos.x + (dx / length) * VENT_EVADE_STEP,
    z: pos.z + (dz / length) * VENT_EVADE_STEP,
  };
  bot.input({ f: 1 }, bot.faceTo(goal));
}

async function runWingThree(bots) {
  await waitFor(
    () => bots[0].liveMobByTemplate('volzharr_buried_furnace'),
    5000,
    'Volzharr snapshot',
  );
  const start = Date.now();
  const wokenCinders = new Set();
  const seenWokenCinders = new Set();
  let lastTelemetry = 0;
  let sawWake = false;
  let sawVent = false;
  let sawEruption = false;
  let eruptionHistoryStart = null;
  let healerCastsAtEruption = null;
  const cinderTargetedBy = new Set();
  const activeVentExposures = new Map();
  let ventExposureCount = 0;
  let escapedVentCount = 0;
  const healers = bots.filter((bot) => bot.role === 'healer');
  const healerCastBaseline = new Map(healers.map((bot) => [bot.pid, bot.healCasts]));

  while (Date.now() - start < FIGHT_TIMEOUT_MS) {
    const boss = bots[0].liveMobByTemplate('volzharr_buried_furnace');
    if (!boss) break;

    for (const bot of bots) {
      for (const event of bot.events.splice(0)) {
        if (
          event.type === 'aura' &&
          event.gained === true &&
          event.name === 'The Embers Come Home'
        ) {
          wokenCinders.add(event.targetId);
          seenWokenCinders.add(event.targetId);
          sawWake = true;
        }
        if (event.type === 'damage' && event.ability === 'Undermount Eruption') {
          if (!sawEruption) {
            eruptionHistoryStart = new Map(
              bots.map((member) => [member.pid, member.history.length]),
            );
            healerCastsAtEruption = new Map(
              healers.map((member) => [member.pid, member.healCasts]),
            );
          }
          sawEruption = true;
        }
        if (event.type === 'death') wokenCinders.delete(event.entityId);
      }
    }

    if (Date.now() - lastTelemetry > 15_000) {
      lastTelemetry = Date.now();
      console.log(
        `  wing3 t=${Math.round((Date.now() - start) / 1000)}s ` +
          `Volzharr=${boss.hp}/${boss.mhp} vents=${bots[0].vents.length} ` +
          `shamblers=${wokenCinders.size}`,
      );
    }

    for (const bot of bots) {
      if (!bot.self || bot.self.dead) continue;
      if (bot.cinderDps && seenWokenCinders.has(bot.self.target)) {
        cinderTargetedBy.add(bot.pid);
      }
      sawVent ||= bot.vents.length > 0;
      const vent = unsafeVent(bot);
      if (vent) {
        if (!activeVentExposures.has(bot.pid)) {
          activeVentExposures.set(bot.pid, vent.id);
          ventExposureCount++;
        }
        evadeVent(bot, vent);
        continue;
      }
      if (activeVentExposures.delete(bot.pid)) escapedVentCount++;
      if (bot.role === 'healer') {
        const tank = bot.ents.get(bots[0].pid);
        if (tank && bot.dist(tank) > 24) {
          bot.input({ f: 1 }, bot.faceTo(tank));
          continue;
        }
        bot.input({});
        if (castHeal(bot, bots[0].pid)) continue;
      }

      let target = null;
      if (bot.cinderDps) {
        for (const id of wokenCinders) {
          const cinder = bot.ents.get(id);
          if (cinder && !cinder.dead && cinder.tid === 'undermount_cinderling') {
            target = cinder;
            break;
          }
        }
      }
      const mechanicsObserved = sawVent && sawWake && sawEruption && escapedVentCount > 0;
      if (!target && (mechanicsObserved || bot.role === 'tank')) {
        target = bot.liveMobByTemplate('volzharr_buried_furnace');
      }
      if (target) fightTarget(bot, target);
    }
    await sleep(DECISION_MS);
  }
  stopRaid(bots);
  await sleep(1000);

  sawEruption ||= historyHas(
    bots,
    (event) => event.type === 'damage' && event.ability === 'Undermount Eruption',
  );
  const healerIds = new Set(healers.map((bot) => bot.pid));
  const healersObservedAfterEruption = new Set();
  if (eruptionHistoryStart !== null) {
    for (const bot of bots) {
      for (const event of bot.history.slice(
        eruptionHistoryStart.get(bot.pid) ?? bot.history.length,
      )) {
        if (
          event.type === 'heal2' &&
          event.targetId === bots[0].pid &&
          healerIds.has(event.sourceId)
        ) {
          healersObservedAfterEruption.add(event.sourceId);
        }
      }
    }
  }
  const bothHealersCast = healers.every(
    (bot) =>
      bot.healCasts > (healerCastsAtEruption?.get(bot.pid) ?? healerCastBaseline.get(bot.pid) ?? 0),
  );
  check('wing 3 received the client vent wire', sawVent);
  check(
    'wing 3 moved every exposed bot out of vents and Forgeheat rims',
    sawVent && ventExposureCount > 0 && activeVentExposures.size === 0,
    `exposures=${ventExposureCount} escaped=${escapedVentCount} active=${activeVentExposures.size}`,
  );
  check(
    'both designated dps bots switched to a woken Cinderling',
    sawWake && cinderTargetedBy.size === 2,
    `targeted=${cinderTargetedBy.size}`,
  );
  check('at least one Undermount Eruption fired', sawEruption);
  check(
    'the two healers kept the tank alive through Eruptions',
    sawEruption &&
      bothHealersCast &&
      healersObservedAfterEruption.size === 2 &&
      !bots[0].self?.dead,
  );
  check(
    'Volzharr, the Buried Furnace defeated',
    Boolean(bots[0].entityByTemplate('volzharr_buried_furnace')?.dead),
  );
  check(
    'wing 3 raid lockout landed for all ten bots',
    await waitForLockout(bots, 'undermount_wing3'),
  );

  const lootHistoryStart = new Map(bots.map((bot) => [bot.pid, bot.history.length]));
  const lootOutcomes = await lootBosses(bots, ['volzharr_buried_furnace']);
  const finalLootEvents = bots.some((bot) =>
    bot.history
      .slice(lootHistoryStart.get(bot.pid) ?? bot.history.length)
      .some(
        (event) =>
          event.type === 'loot' || event.type === 'lootRoll' || event.type === 'masterLoot',
      ),
  );
  check('Volzharr boss loot opened', lootOutcomes.some(Boolean), JSON.stringify(lootOutcomes));
  check('the raid received Volzharr loot events', finalLootEvents);
}

async function main() {
  const bots = raidBots();
  try {
    console.log('joining 10 Undermount bots...');
    for (const bot of bots) await bot.join();
    check(
      'ten bots registered and joined',
      bots.every((bot) => bot.pid > 0),
    );

    await formRaid(bots);
    await devPrep(bots);

    for (const bot of bots) {
      bot.cmd({ cmd: 'dev_teleport', x: -174, z: 610 });
    }
    await sleep(800);
    await enterWing(bots, 'undermount_wing1', ['vosh_the_glazier', 'saan_the_stoker'], 'wing 1');
    await runWingOne(bots);

    const reachedWingTwoDoor = await moveRaidToDoor(bots, 'undermount_wing2');
    check('wing 1 clear exposed the wing 2 door', reachedWingTwoDoor);
    await enterWing(bots, 'undermount_wing2', ['odrenn_the_temperer'], 'wing 2');
    await runWingTwo(bots);

    const reachedWingThreeDoor = await moveRaidToDoor(bots, 'undermount_wing3');
    check('wing 2 clear exposed the wing 3 door', reachedWingThreeDoor);
    await enterWing(bots, 'undermount_wing3', ['volzharr_buried_furnace'], 'wing 3');
    await runWingThree(bots);
  } finally {
    stopRaid(bots.filter((bot) => bot.ws?.readyState === WebSocket.OPEN));
    for (const bot of bots) bot.close();
  }

  const verdict = fail === 0 ? 'PASS' : 'FAIL';
  console.log(`FINAL ${verdict}: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  fail++;
  console.error('fatal:', error);
  console.log(`FINAL FAIL: ${pass} passed, ${fail} failed`);
  process.exit(1);
});
