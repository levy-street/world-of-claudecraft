// The launcher's single-page UI as one embedded template string: no framework,
// no external resources (the launcher binds 127.0.0.1 and must work offline).
// Plain DOM + fetch against the launcher's own /api/* routes. Form state
// persists to localStorage, EXCEPT the password, which is never stored
// anywhere (memory of the page only, sent to the launcher over loopback).
// Character rotation is page-side on purpose: the credentials it needs live
// only in this page's memory.

export const LAUNCHER_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>WoC Farmbot Launcher</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; background: #0f1216; color: #d7dde4;
    font: 14px/1.45 system-ui, sans-serif; display: flex; justify-content: center;
  }
  main { width: 760px; max-width: 100%; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: #8fa3b8; margin: 0 0 12px; }
  section { background: #171c23; border: 1px solid #262e38; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  label { display: block; margin: 8px 0 2px; color: #9fb0c0; font-size: 12px; }
  input[type=text], input[type=password], input[type=number], select {
    width: 100%; padding: 7px 9px; background: #0f1319; color: #d7dde4;
    border: 1px solid #2c3641; border-radius: 5px; font: inherit;
  }
  input:focus, select:focus { outline: 1px solid #3d6ea5; border-color: #3d6ea5; }
  .row { display: flex; gap: 12px; } .row > div { flex: 1; }
  .checks { display: flex; gap: 16px; margin-top: 6px; flex-wrap: wrap; }
  .checks label { display: flex; gap: 6px; align-items: center; color: #d7dde4; font-size: 13px; margin: 0; }
  button {
    padding: 8px 16px; border: 1px solid #35567c; border-radius: 6px; cursor: pointer;
    background: #1d3a5f; color: #dbe7f3; font: inherit; font-weight: 600;
  }
  button:hover:not(:disabled) { background: #26507f; }
  button:disabled { opacity: .45; cursor: default; }
  button.danger { background: #5f2626; border-color: #7c3535; }
  button.danger:hover:not(:disabled) { background: #7f3232; }
  .msg { margin-top: 8px; font-size: 13px; min-height: 18px; }
  .msg.err { color: #e08b8b; } .msg.ok { color: #8bd49a; }
  .note { color: #8fa3b8; font-size: 12px; margin-top: 6px; }
  details { margin-top: 8px; } summary { cursor: pointer; color: #8fa3b8; font-size: 13px; }
  #log {
    background: #0a0d11; border: 1px solid #262e38; border-radius: 6px; padding: 10px;
    height: 240px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;
    font: 12px/1.5 ui-monospace, Consolas, monospace; color: #b8c6d2;
  }
  #statusLine { font: 13px ui-monospace, Consolas, monospace; color: #9fb0c0; margin-bottom: 8px; }
  .bar { background: #0f1319; border: 1px solid #2c3641; border-radius: 4px; height: 14px; overflow: hidden; }
  .bar > div { height: 100%; transition: width .3s; }
  .bar.hp > div { background: #4a7c43; } .bar.mana > div { background: #3d6ea5; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; }
  .stat { background: #0f1319; border: 1px solid #262e38; border-radius: 6px; padding: 6px 10px; }
  .stat .v { font: 600 16px ui-monospace, Consolas, monospace; }
  .stat .k { color: #8fa3b8; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  #map { width: 100%; background: #0a0d11; border: 1px solid #262e38; border-radius: 6px; }
  #invGrid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  #invGrid .slot {
    background: #0f1319; border: 1px solid #2c3641; border-radius: 5px;
    padding: 4px 8px; font: 12px ui-monospace, Consolas, monospace;
  }
  .profrow { display: flex; gap: 8px; align-items: end; }
  .profrow > div { flex: 1; } .profrow > button { flex: 0 0 auto; }
</style>
</head>
<body>
<main>
  <h1>WoC Farmbot Launcher</h1>

  <section>
    <h2>Account</h2>
    <label for="serverUrl">Server URL</label>
    <input type="text" id="serverUrl" spellcheck="false">
    <div class="row">
      <div><label for="username">Username</label><input type="text" id="username" autocomplete="off" spellcheck="false"></div>
      <div><label for="password">Password</label><input type="password" id="password" autocomplete="new-password"></div>
    </div>
    <div style="margin-top:10px"><button id="loadChars">Load characters</button></div>
    <label for="character">Character</label>
    <select id="character"><option value="">(load characters first)</option></select>
    <div class="msg" id="accountMsg"></div>
  </section>

  <section>
    <h2>Profiles</h2>
    <div class="profrow">
      <div><label for="profileSelect">Saved profiles</label><select id="profileSelect"></select></div>
      <div><label for="profileName">Name</label><input type="text" id="profileName" spellcheck="false"></div>
      <button id="saveProfile">Save</button>
      <button id="loadProfile">Load</button>
      <button id="deleteProfile" class="danger">Delete</button>
    </div>
    <div class="note">Profiles never include the password.</div>
    <label style="margin-top:10px">Character rotation (checked profiles, in order)</label>
    <div class="checks" id="rotationList"></div>
    <div class="row" style="margin-top:6px">
      <div><label for="rotateMinutes">Rotate every N minutes (0 = off)</label><input type="number" id="rotateMinutes" min="0" value="0"></div>
    </div>
    <div class="note">Rotation uses the username/password typed above; they live only in this page's memory and are gone on reload.</div>
    <div class="msg" id="profileMsg"></div>
  </section>

  <section>
    <h2>Farming</h2>
    <label for="mode">Mode</label>
    <select id="mode">
      <option value="">Gather + fish (default)</option>
      <option value="gather">Gather only</option>
      <option value="fish">Fish only</option>
      <option value="gold">Gold (dungeons)</option>
    </select>
    <div id="goldRow" style="display:none">
      <label for="goldDungeons">Dungeons (comma separated)</label>
      <input type="text" id="goldDungeons" spellcheck="false" placeholder="hollow_crypt, sunken_bastion">
      <div class="row">
        <div><label for="goldRestBelowPct">Recharge below HP/mana %</label><input type="number" id="goldRestBelowPct" min="1" max="100" placeholder="50"></div>
      </div>
    </div>
    <label for="zone">Zone</label>
    <select id="zone"></select>
    <label>Node types</label>
    <div class="checks" id="nodeTypes"></div>
    <div class="row">
      <div><label for="maxNodeTier">Max node tier</label><input type="number" id="maxNodeTier" min="1" value="99"></div>
      <div><label for="abilitySlots">Ability slots (comma separated)</label><input type="text" id="abilitySlots" value="0,1" spellcheck="false"></div>
      <div><label for="maxRuntimeMinutes">Max runtime (min, 0 = unlimited)</label><input type="number" id="maxRuntimeMinutes" min="0" value="0"></div>
    </div>
    <div class="checks">
      <label><input type="checkbox" id="fishingEnabled"> Fishing enabled</label>
    </div>
    <div class="row" id="fishingRow" style="display:none">
      <div><label for="spotX">Spot X (optional)</label><input type="number" id="spotX"></div>
      <div><label for="spotZ">Spot Z (optional)</label><input type="number" id="spotZ"></div>
      <div><label for="castsPerSpot">Casts per spot (optional)</label><input type="number" id="castsPerSpot" min="1"></div>
    </div>
    <label for="fullPolicy">When bags are full</label>
    <select id="fullPolicy">
      <option value="sell-junk">Sell junk at a vendor</option>
      <option value="stop">Stop and log out</option>
    </select>
    <details>
      <summary>Advanced: eat / drink recovery</summary>
      <div class="row">
        <div><label for="eatItemId">Eat item id</label><input type="text" id="eatItemId" spellcheck="false" placeholder="baked_bread"></div>
        <div><label for="eatBelowHpPct">Eat below HP %</label><input type="number" id="eatBelowHpPct" min="1" max="100"></div>
      </div>
      <div class="row">
        <div><label for="drinkItemId">Drink item id</label><input type="text" id="drinkItemId" spellcheck="false" placeholder="spring_water"></div>
        <div><label for="drinkBelowManaPct">Drink below mana %</label><input type="number" id="drinkBelowManaPct" min="1" max="100"></div>
      </div>
    </details>
    <div class="msg" id="farmMsg"></div>
  </section>

  <section>
    <h2>Live</h2>
    <div class="stats">
      <div class="stat"><div class="v" id="lvMode">-</div><div class="k">state</div></div>
      <div class="stat"><div class="v" id="lvUptime">-</div><div class="k">uptime</div></div>
      <div class="stat"><div class="v" id="lvBags">-</div><div class="k">bags</div></div>
      <div class="stat"><div class="v" id="lvRate">-</div><div class="k">items/hour</div></div>
      <div class="stat"><div class="v" id="lvEarned" style="color:#e8c547">0c</div><div class="k">earned</div></div>
      <div class="stat"><div class="v" id="lvGoldRate">-</div><div class="k">gold/hour</div></div>
      <div class="stat"><div class="v" id="lvHarvests">0</div><div class="k">harvests</div></div>
      <div class="stat"><div class="v" id="lvCatches">0</div><div class="k">catches</div></div>
      <div class="stat"><div class="v" id="lvKills">0</div><div class="k">kills</div></div>
      <div class="stat"><div class="v" id="lvDeaths">0</div><div class="k">deaths</div></div>
    </div>
    <label>HP</label><div class="bar hp"><div id="hpFill" style="width:0"></div></div>
    <label>Mana / resource</label><div class="bar mana"><div id="manaFill" style="width:0"></div></div>
    <label style="margin-top:10px">Map</label>
    <svg id="map" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"></svg>
    <label style="margin-top:10px">Inventory</label>
    <div id="invGrid"></div>
  </section>

  <section>
    <h2>Run</h2>
    <div id="statusLine">stopped</div>
    <button id="startBtn">Start</button>
    <button id="stopBtn" class="danger" disabled>Stop</button>
    <div class="msg" id="runMsg"></div>
    <div id="log" style="margin-top:10px"></div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const STORE_KEY = 'farmbot-launcher-form';
const PROFILES_KEY = 'farmbot-launcher-profiles';
const ROTATION_KEY = 'farmbot-launcher-rotation';
const PERSIST_IDS = ['serverUrl','username','character','mode','goldDungeons','goldRestBelowPct','zone','maxNodeTier','abilitySlots','maxRuntimeMinutes',
  'fishingEnabled','spotX','spotZ','castsPerSpot','fullPolicy','eatItemId','eatBelowHpPct',
  'drinkItemId','drinkBelowManaPct'];
let nodeTypeValues = [];
let zoneInfoById = {};
let running = false;
let runningSince = 0;
let logNext = 0;
let rotationIdx = -1;
let lastRotateAt = 0;
let rotating = false;

function setMsg(id, text, ok) {
  const el = $(id);
  el.textContent = text;
  el.className = 'msg ' + (text ? (ok ? 'ok' : 'err') : '');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(path, body) {
  const res = await fetch(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('request failed (' + res.status + ')'));
  return data;
}

function collectForm() {
  const data = {};
  for (const id of PERSIST_IDS) {
    const el = $(id);
    data[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  data.nodeTypes = nodeTypeValues.filter((t) => $('nt_' + t).checked);
  return data;
}

function applyForm(data) {
  for (const id of PERSIST_IDS) {
    if (!(id in data)) continue;
    const el = $(id);
    if (el.type === 'checkbox') el.checked = !!data[id]; else el.value = data[id];
  }
  if (Array.isArray(data.nodeTypes)) {
    for (const t of nodeTypeValues) $('nt_' + t).checked = data.nodeTypes.includes(t);
  }
  if (data.character && !$('character').querySelector('option[value="' + CSS.escape(data.character) + '"]')) {
    const opt = document.createElement('option');
    opt.value = data.character;
    opt.textContent = data.character;
    $('character').appendChild(opt);
  }
  if (data.character) $('character').value = data.character;
  $('fishingRow').style.display = $('fishingEnabled').checked ? '' : 'none';
  $('goldRow').style.display = $('mode').value === 'gold' ? '' : 'none';
}

function saveForm() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(collectForm())); } catch {}
}

function loadForm() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch {}
  applyForm(data);
}

// --- profiles -------------------------------------------------------------
function readProfiles() {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '{}'); } catch { return {}; }
}
function writeProfiles(p) {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(p)); } catch {}
}
function refreshProfileUi() {
  const profiles = readProfiles();
  const sel = $('profileSelect');
  sel.innerHTML = '';
  for (const name of Object.keys(profiles)) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    sel.appendChild(opt);
  }
  const rot = readRotation();
  const list = $('rotationList');
  list.innerHTML = '';
  for (const name of Object.keys(profiles)) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = rot.names.includes(name);
    cb.onchange = () => { saveRotation(); };
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + name));
    list.appendChild(label);
  }
}
function readRotation() {
  try {
    const r = JSON.parse(localStorage.getItem(ROTATION_KEY) || '{}');
    return { names: Array.isArray(r.names) ? r.names : [], minutes: Number(r.minutes) || 0 };
  } catch { return { names: [], minutes: 0 }; }
}
function saveRotation() {
  const names = [];
  for (const label of $('rotationList').children) {
    if (label.firstChild.checked) names.push(label.textContent.trim());
  }
  const minutes = Number($('rotateMinutes').value) || 0;
  try { localStorage.setItem(ROTATION_KEY, JSON.stringify({ names, minutes })); } catch {}
}
$('saveProfile').onclick = () => {
  const name = $('profileName').value.trim();
  if (!name) { setMsg('profileMsg', 'name the profile first', false); return; }
  const profiles = readProfiles();
  profiles[name] = collectForm();
  writeProfiles(profiles);
  refreshProfileUi();
  setMsg('profileMsg', 'saved ' + name, true);
};
$('loadProfile').onclick = () => {
  const name = $('profileSelect').value;
  const profiles = readProfiles();
  if (!name || !profiles[name]) { setMsg('profileMsg', 'no profile selected', false); return; }
  applyForm(profiles[name]);
  saveForm();
  setMsg('profileMsg', 'loaded ' + name, true);
};
$('deleteProfile').onclick = () => {
  const name = $('profileSelect').value;
  const profiles = readProfiles();
  if (!name || !profiles[name]) return;
  delete profiles[name];
  writeProfiles(profiles);
  refreshProfileUi();
  setMsg('profileMsg', 'deleted ' + name, true);
};

// --- rotation (page-side: credentials live only here) ---------------------
async function maybeRotate() {
  const mins = Number($('rotateMinutes').value);
  if (!running || rotating || !(mins > 0)) { lastRotateAt = Date.now(); return; }
  const names = readRotation().names.filter((n) => readProfiles()[n]);
  if (names.length < 2) return;
  if (!lastRotateAt) { lastRotateAt = Date.now(); return; }
  if (Date.now() - lastRotateAt < mins * 60000) return;
  rotating = true;
  lastRotateAt = Date.now();
  try {
    rotationIdx = (rotationIdx + 1) % names.length;
    const next = names[rotationIdx];
    setMsg('runMsg', 'rotating to profile ' + next + '...', true);
    await api('/api/stop', {});
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const s = await api('/api/status');
      if (!s.running) break;
    }
    applyForm(readProfiles()[next]);
    saveForm();
    const config = gatherConfig();
    await api('/api/start', {
      serverUrl: config.serverUrl,
      username: $('username').value.trim(),
      password: $('password').value,
      config,
    });
    setMsg('runMsg', 'rotated to ' + next, true);
  } catch (err) {
    setMsg('runMsg', 'rotation failed: ' + err.message, false);
  } finally {
    rotating = false;
    refreshStatus();
  }
}

function numOrNull(id) {
  const v = $(id).value.trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function gatherConfig() {
  const slots = $('abilitySlots').value.split(',')
    .map((s) => s.trim()).filter((s) => s !== '').map(Number);
  return {
    serverUrl: $('serverUrl').value.trim(),
    characterName: $('character').value,
    zoneId: $('zone').value,
    nodeTypes: nodeTypeValues.filter((t) => $('nt_' + t).checked),
    maxNodeTier: numOrNull('maxNodeTier'),
    fishingEnabled: $('fishingEnabled').checked,
    fishingSpotX: numOrNull('spotX'),
    fishingSpotZ: numOrNull('spotZ'),
    castsPerSpot: numOrNull('castsPerSpot'),
    abilitySlots: slots,
    eatItemId: $('eatItemId').value.trim(),
    drinkItemId: $('drinkItemId').value.trim(),
    eatBelowHpPct: numOrNull('eatBelowHpPct'),
    drinkBelowManaPct: numOrNull('drinkBelowManaPct'),
    fullPolicy: $('fullPolicy').value,
    maxRuntimeMinutes: numOrNull('maxRuntimeMinutes') ?? 0,
    mode: $('mode').value,
    goldDungeons: $('goldDungeons').value,
    goldRestBelowPct: numOrNull('goldRestBelowPct'),
  };
}

function setRunning(next, startedAt) {
  running = next;
  if (next && startedAt) runningSince = startedAt;
  $('startBtn').disabled = next;
  $('stopBtn').disabled = !next;
}

async function refreshStatus() {
  try {
    const s = await api('/api/status');
    setRunning(!!s.running, s.startedAt);
    $('statusLine').textContent = s.running
      ? ('running (pid ' + s.pid + ', since ' + new Date(s.startedAt).toLocaleTimeString() + ')')
      : 'stopped';
  } catch (err) { $('statusLine').textContent = 'status error: ' + err.message; }
}

async function pollLogs() {
  try {
    const r = await api('/api/logs?since=' + logNext);
    if (r.lines.length) {
      const log = $('log');
      const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
      for (const line of r.lines) log.appendChild(document.createTextNode(line + '\\n'));
      logNext = r.next;
      if (atBottom) log.scrollTop = log.scrollHeight;
    }
  } catch {}
}

// --- live panel -----------------------------------------------------------
function fmtUptime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h ? h + 'h ' : '') + m + 'm ' + (s % 60) + 's';
}

// Classic purse display from a copper integer (matches launcher_core.formatCopper).
function fmtCopper(copper) {
  const c = Math.max(0, Math.floor(Number(copper) || 0));
  const g = Math.floor(c / 10000);
  const s = Math.floor((c % 10000) / 100);
  const cop = c % 100;
  if (g > 0) return g + 'g ' + s + 's ' + cop + 'c';
  if (s > 0) return s + 's ' + cop + 'c';
  return cop + 'c';
}

const NODE_COLORS = { herb: '#4caf50', ore: '#9e9e9e', wood: '#8d6e63' };

function renderMap(stat) {
  const svg = $('map');
  const info = stat && zoneInfoById[stat.zoneId];
  if (!info) { svg.innerHTML = ''; return; }
  const r = info.rect;
  const pad = 12;
  svg.setAttribute('viewBox', [r.xMin - pad, r.zMin - pad, r.xMax - r.xMin + 2 * pad, r.zMax - r.zMin + 2 * pad].join(' '));
  let out = '<rect x="' + r.xMin + '" y="' + r.zMin + '" width="' + (r.xMax - r.xMin) + '" height="' + (r.zMax - r.zMin) + '" fill="#10161d" stroke="#2c3641"/>';
  for (const lake of info.lakes) {
    out += '<circle cx="' + lake.x + '" cy="' + lake.z + '" r="' + lake.radius + '" fill="#16324a" stroke="#3d6ea5" stroke-width="1"/>';
  }
  for (const n of info.nodes) {
    out += '<circle cx="' + n.x + '" cy="' + n.z + '" r="3" fill="' + (NODE_COLORS[n.type] || '#888') + '"><title>' + n.id + '</title></circle>';
  }
  out += '<circle cx="' + stat.pos.x + '" cy="' + stat.pos.z + '" r="5" fill="none" stroke="#37e0e0" stroke-width="2"/>';
  out += '<circle cx="' + stat.pos.x + '" cy="' + stat.pos.z + '" r="2" fill="#37e0e0"/>';
  svg.innerHTML = out;
}

async function pollLive() {
  try {
    const live = await api('/api/live');
    const stat = live.stat;
    if (!stat) {
      $('lvMode').textContent = live.running ? 'starting' : '-';
      return;
    }
    $('lvMode').textContent = stat.mode;
    $('lvUptime').textContent = live.running && live.startedAt ? fmtUptime(Date.now() - live.startedAt) : '-';
    $('lvBags').textContent = stat.bagsUsed + ' / ' + stat.bagCapacity;
    const hours = live.running && live.startedAt ? (Date.now() - live.startedAt) / 3600000 : 0;
    $('lvRate').textContent = hours > 0.001 ? Math.round((stat.stats.harvests + stat.stats.catches) / hours) : '-';
    const earned = Number(stat.stats && stat.stats.copperGained) || 0;
    $('lvEarned').textContent = fmtCopper(earned);
    // gold/hour as fractional gold (10000 copper = 1g) for a readable rate
    $('lvGoldRate').textContent = hours > 0.001
      ? (earned / 10000 / hours).toFixed(2) + 'g/h'
      : '-';
    $('lvHarvests').textContent = stat.stats.harvests;
    $('lvCatches').textContent = stat.stats.catches;
    $('lvKills').textContent = stat.stats.kills;
    $('lvDeaths').textContent = stat.stats.deaths;
    $('hpFill').style.width = (stat.maxHp ? Math.round((100 * stat.hp) / stat.maxHp) : 0) + '%';
    $('manaFill').style.width = (stat.maxResource ? Math.round((100 * stat.resource) / stat.maxResource) : 0) + '%';
    renderMap(stat);
    const inv = $('invGrid');
    inv.innerHTML = '';
    for (const slot of stat.inventory) {
      const div = document.createElement('div');
      div.className = 'slot';
      div.textContent = slot.itemId + ' x' + slot.count;
      inv.appendChild(div);
    }
  } catch {}
}

$('loadChars').onclick = async () => {
  setMsg('accountMsg', 'loading...', true);
  try {
    const chars = await api('/api/characters', {
      serverUrl: $('serverUrl').value.trim(),
      username: $('username').value.trim(),
      password: $('password').value,
    });
    const sel = $('character');
    const current = sel.value;
    sel.innerHTML = '';
    for (const c of chars) {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name + ' (level ' + c.level + ' ' + c.class + ')' + (c.online ? ' [online]' : '');
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
    setMsg('accountMsg', chars.length ? ('loaded ' + chars.length + ' characters') : 'account has no characters', true);
  } catch (err) { setMsg('accountMsg', err.message, false); }
};

$('startBtn').onclick = async () => {
  setMsg('runMsg', '', true);
  if (!$('character').value) { setMsg('runMsg', 'load characters and pick one first', false); return; }
  try {
    const config = gatherConfig();
    await api('/api/start', {
      serverUrl: config.serverUrl,
      username: $('username').value.trim(),
      password: $('password').value,
      config,
    });
    setMsg('runMsg', 'started', true);
    saveForm();
    lastRotateAt = Date.now();
    rotationIdx = -1;
  } catch (err) { setMsg('runMsg', err.message, false); }
  refreshStatus();
};

$('stopBtn').onclick = async () => {
  try { await api('/api/stop', {}); setMsg('runMsg', 'stop sent', true); }
  catch (err) { setMsg('runMsg', err.message, false); }
  refreshStatus();
};

$('fishingEnabled').onchange = () => {
  $('fishingRow').style.display = $('fishingEnabled').checked ? '' : 'none';
};
$('mode').onchange = () => {
  $('goldRow').style.display = $('mode').value === 'gold' ? '' : 'none';
  saveForm();
};
for (const id of PERSIST_IDS) $(id).addEventListener('change', saveForm);
$('rotateMinutes').addEventListener('change', saveRotation);
$('rotateMinutes').value = readRotation().minutes;

(async function init() {
  const meta = await api('/api/meta');
  if (!$('serverUrl').value) $('serverUrl').value = meta.defaultServerUrl;
  nodeTypeValues = meta.nodeTypes;
  const nt = $('nodeTypes');
  for (const t of meta.nodeTypes) {
    const label = document.createElement('label');
    label.innerHTML = '<input type="checkbox" id="nt_' + t + '" checked> ' + t;
    nt.appendChild(label);
    label.firstChild.addEventListener('change', saveForm);
  }
  const zone = $('zone');
  for (const z of meta.zones) {
    const opt = document.createElement('option');
    opt.value = z; opt.textContent = z;
    zone.appendChild(opt);
  }
  for (const info of meta.zoneInfo || []) zoneInfoById[info.id] = info;
  loadForm();
  refreshProfileUi();
  refreshStatus();
  setInterval(refreshStatus, 2000);
  setInterval(pollLogs, 1000);
  setInterval(pollLive, 1000);
  setInterval(maybeRotate, 5000);
})();
</script>
</body>
</html>
`;
