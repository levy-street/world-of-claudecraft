// multibox_monitor.mjs — a CI-style progress gate for the running multibox.
// Reads the journals in ./logs, checks the bots are alive and ADVANCING, emits a
// PASS / SLOW / STALLED verdict with diagnosis, writes logs/STATUS.md (current
// snapshot) and appends logs/ci_history.jsonl (trend, diffed against last check).
//
// Run:  node scripts/multibox_monitor.mjs
// Exit code: 0 = HEALTHY, 1 = SLOW, 2 = STALLED/DOWN  (usable as a CI gate).

import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fleetParties } from './multibox_config.mjs';

const LOG_DIR = 'logs';
// non-journal files: STATUS/history plus ANY party log (party.md or per-party party.<config>.md)
const isReserved = (f) => f === 'STATUS.md' || f === 'ci_history.md' || f.startsWith('party');
const now = new Date();
const tsRe = /`(\d{2}):(\d{2}):(\d{2})`/;

function isRunning() {
  try { return execSync('pgrep -f "scripts/multibox.mjs" || true').toString().trim().length > 0; }
  catch { return false; }
}
function minsAgo(line) {
  const m = line.match(tsRe); if (!m) return Infinity;
  // journal stamps are UTC (toISOString); compare in UTC regardless of machine TZ
  const d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), +m[1], +m[2], +m[3]);
  let diff = (now.getTime() - d) / 60000; if (diff < -1) diff += 1440; // crossed midnight
  return diff;
}
const count = (s, re) => (s.match(re) || []).length;

// Per-party reporting tracks exactly the fleet (scripts/multibox.fleet.json, extends-resolved)
// — same source the launcher uses — so the monitor auto-picks-up whatever parties you run.
const PARTIES = fleetParties();
const partyOf = (name) => (PARTIES.find((p) => p.members.has(name.toLowerCase()))?.label) ?? 'other';

const journals = existsSync(LOG_DIR) ? readdirSync(LOG_DIR).filter((f) => f.endsWith('.md') && !isReserved(f)) : [];
const bots = [];
let totalKills = 0, killsLast10 = 0, copper = 0, items = 0, deaths = 0;

for (const f of journals) {
  const text = readFileSync(`${LOG_DIR}/${f}`, 'utf8');
  const lines = text.split('\n');
  const lvlMatches = [...text.matchAll(/Reached level (\d+)/g)];
  const entered = text.match(/Entered the world at level (\d+)/);
  const level = lvlMatches.length ? +lvlMatches[lvlMatches.length - 1][1] : entered ? +entered[1] : 1;
  const kills = count(text, /⚔️ Killed/g);
  const recent = lines.filter((l) => l.includes('⚔️ Killed') && minsAgo(l) <= 10).length;
  const cop = [...text.matchAll(/You loot (\d+)c/g)].reduce((s, m) => s + +m[1], 0);
  const it = count(text, /You receive:/g);
  const dead = count(text, /☠️ I fell/g);
  const tsLines = lines.filter((l) => tsRe.test(l));
  const lastSeen = tsLines.length ? minsAgo(tsLines[tsLines.length - 1]) : Infinity;
  bots.push({ name: f.replace('.md', ''), level, kills, recent, lastSeen, party: partyOf(f.replace('.md', '')) });
  totalKills += kills; killsLast10 += recent; copper += cop; items += it; deaths += dead;
}

const levels = bots.map((b) => b.level);
const minLvl = levels.length ? Math.min(...levels) : 0;
const maxLvl = levels.length ? Math.max(...levels) : 0;
const running = isRunning();

// latest party status line (for HP / phase diagnosis) — scan every party*.md and take the
// most-recent status line across all of them (parties now each write their own party.<config>.md).
let lastStatus = '', phase = '?';
const partyFiles = existsSync(LOG_DIR) ? readdirSync(LOG_DIR).filter((f) => f.startsWith('party') && f.endsWith('.md')) : [];
let newestAge = Infinity;
for (const f of partyFiles) {
  const pl = readFileSync(`${LOG_DIR}/${f}`, 'utf8').split('\n').filter((l) => l.includes('[grind]') || l.includes('[travel]') || l.includes('[dungeon]'));
  if (!pl.length) continue;
  const last = pl[pl.length - 1], age = minsAgo(last);
  if (age < newestAge) { newestAge = age; lastStatus = last; phase = (last.match(/\[(\w+)\]/) || [])[1] ?? '?'; }
}

// ---- DUNGEON-FARM awareness: parse the party logs for boss kills, wipes, resets, loot, overpulls,
// and the current farm phase, so the verdict + STATUS read clearly for a farm run (where "progress" is
// bosses-down + runs-completed, not kills/min). farmMode is on when any party log shows farm markers.
const farm = { mode: false, bossDowns: 0, recentBossDowns: 0, wipes: 0, recentWipes: 0, overpulls: 0, recentOverpulls: 0, runs: 0, phase: '-', loot: [], bosses: [] };
for (const f of partyFiles) {
  const lines = readFileSync(`${LOG_DIR}/${f}`, 'utf8').split('\n');
  for (const l of lines) {
    const recent = minsAgo(l) <= 15;
    if (/Korzul is DOWN/.test(l)) { farm.mode = true; farm.bossDowns++; if (recent) farm.recentBossDowns++; }
    if (/💀 .*WIPE/.test(l)) { farm.mode = true; farm.wipes++; if (recent) farm.recentWipes++; }
    if (/⚠️ \*\*OVERPULL/.test(l)) { farm.mode = true; farm.overpulls++; if (recent) farm.recentOverpulls++; }
    if (/Party reformed/.test(l)) { farm.mode = true; farm.runs++; }
    const fp = l.match(/(clearing single-pull|Looting the Wyrm|heading to the exit|disbanding \+ reforming|re-entering Gravewyrm)/);
    if (fp) farm.phase = { 'clearing single-pull': 'clear', 'Looting the Wyrm': 'loot', 'heading to the exit': 'leave', 'disbanding + reforming': 'reform', 're-entering Gravewyrm': 'enter' }[fp[1]] ?? farm.phase;
    if (recent && /🏆 \*\*(\w+)\*\* defeated/.test(l)) farm.bosses.push(l.replace(/^- /, ''));
    if (recent && /(💎 .*looted|🎲 .*rolls)/.test(l)) farm.loot.push(l.replace(/^- /, ''));
  }
}
farm.loot = farm.loot.slice(-8); farm.bosses = [...new Set(farm.bosses)].slice(-6);

// diff vs previous check
let prev = null;
const histPath = `${LOG_DIR}/ci_history.jsonl`;
if (existsSync(histPath)) { const ls = readFileSync(histPath, 'utf8').trim().split('\n').filter(Boolean); if (ls.length) try { prev = JSON.parse(ls[ls.length - 1]); } catch {} }
const dKills = prev ? totalKills - prev.totalKills : totalKills;
const dMinLvl = prev ? minLvl - prev.minLvl : 0;

// verdict + diagnosis
let verdict, code, diag = [];
if (!running) { verdict = 'DOWN'; code = 2; diag.push('process not running — relaunch the multibox.'); }
else if (killsLast10 === 0) {
  verdict = 'STALLED'; code = 2;
  if (deaths > (prev?.deaths ?? 0)) diag.push('recent death(s) — may be stuck in release/respawn.');
  if (/DEAD/.test(lastStatus)) diag.push('a member is DEAD in the latest status.');
  if (/(\d+)\/\1\b/.test(lastStatus)) diag.push('everyone at full HP + no kills → no mobs in range (roaming/stuck), not finding a pack.');
  if (!diag.length) diag.push('no kills in 10 min — likely roaming without finding mobs, or disconnected.');
} else if (killsLast10 < 15 || (prev && dKills >= 0 && dKills < 10)) {
  // NOTE: a NEGATIVE dKills means the journals were reset (a party relaunched) since the last
  // check — that's not a slowdown, so we ignore the diff in that case and judge by killsLast10.
  verdict = 'SLOW'; code = 1;
  diag.push(`only ${killsLast10} kills in last 10m (${dKills} since last check) — low throughput; mobs may be sparse or party scattered.`);
} else { verdict = 'HEALTHY'; code = 0; diag.push(`advancing: ${killsLast10} kills/10m, +${dKills} since last check.`); }

// per-bot dropout detection (the aggregate can look fine while individuals are offline)
const freshest = bots.length ? Math.min(...bots.map((b) => b.lastSeen)) : Infinity;
const downBots = bots.filter((b) => b.lastSeen > 6 && freshest < 3).map((b) => b.name);
if (running && downBots.length) {
  diag.push(`⚠️ DOWN bots (silent >6m): ${downBots.join(', ')} — disconnected; auto-reconnect should recover them.`);
  if (verdict === 'HEALTHY') { verdict = 'SLOW'; code = 1; }
  if (downBots.length >= Math.max(1, bots.length - 1)) { verdict = 'STALLED'; code = 2; }
}

// FARM verdict override: a farm's health is bosses-down + reset cadence, not kills/min — clearing toward
// a boss is slow by design. Killing Korzul + resetting = HEALTHY; stuck wiping a boss with no kill = STALLED.
if (running && farm.mode) {
  if (farm.recentBossDowns > 0) { verdict = 'HEALTHY'; code = 0; diag = [`farming Gravewyrm: ${farm.recentBossDowns} Korzul kill(s)/15m, ${farm.runs} resets total.`]; }
  else if (farm.recentWipes >= 3) { verdict = 'STALLED'; code = 2; diag = [`${farm.recentWipes} wipes/15m with no boss kill — stuck (phase ${farm.phase}); check for an overpull or an unhealable boss.`]; }
  else { diag.push(`farm phase ${farm.phase}, no Korzul kill in 15m yet (still clearing).`); }
  if (farm.recentOverpulls > 0) diag.push(`⚠️ ${farm.recentOverpulls} overpull(s)/15m — pull discipline slipping.`);
  if (farm.recentWipes > 0 && verdict === 'HEALTHY') diag.push(`(${farm.recentWipes} wipe(s)/15m, recovered)`);
}

// per-party breakdown — kills are separated between parties (e.g. "ryze" vs "brogan")
const byParty = new Map();
for (const b of bots) {
  const g = byParty.get(b.party) ?? { kills: 0, recent: 0, lvls: [], names: [] };
  g.kills += b.kills; g.recent += b.recent; g.lvls.push(b.level);
  g.names.push(`${b.name}=L${b.level}(${b.kills}k)${b.lastSeen > 6 ? '⚠️OFF' : ''}`);
  byParty.set(b.party, g);
}
const partyLines = [...byParty.entries()]
  .sort((a, b) => b[1].kills - a[1].kills)
  .map(([label, g]) => `- 🛡️ party **${label}**: L${Math.min(...g.lvls)}–${Math.max(...g.lvls)} · ${g.kills} kills (${g.recent} in 10m) · ${g.names.join(', ')}`);

// outputs
const report = [
  `# Multibox CI status — ${now.toISOString()}`,
  ``,
  `**Verdict: ${verdict}**  ${diag.map((d) => '— ' + d).join('  ')}`,
  ``,
  `- process running: ${running}`,
  `- phase: ${phase}`,
  `- levels: min ${minLvl}, max ${maxLvl}  (since last check: ${dMinLvl >= 0 ? '+' : ''}${dMinLvl})`,
  `- kills: ${totalKills} total, ${killsLast10} in last 10m, +${dKills} since last check`,
  `- loot: ${copper}c + ${items} items   deaths: ${deaths}`,
  ...(farm.mode ? [
    `- 🏰 FARM: phase **${farm.phase}** · ${farm.runs} resets · ${farm.bossDowns} Korzul kills · ${farm.wipes} wipes (${farm.recentWipes}/15m) · ${farm.overpulls} overpulls (${farm.recentOverpulls}/15m)`,
    ...(farm.bosses.length ? [`- 🏆 bosses (15m): ${farm.bosses.map((b) => (b.match(/\*\*(\w+)\*\* defeated/) || [])[1] ?? b).join(' · ')}`] : []),
    ...(farm.loot.length ? ['- 💎 recent loot/rolls:', ...farm.loot.map((l) => `    ${l}`)] : []),
  ] : []),
  ...partyLines,
  `- online bots: ${bots.length - downBots.length}/${bots.length}${downBots.length ? ` (down: ${downBots.join(', ')})` : ''}`,
  `- latest: ${lastStatus.replace(/^- /, '') || 'n/a'}`,
  ``,
].join('\n');

writeFileSync(`${LOG_DIR}/STATUS.md`, report);
appendFileSync(histPath, JSON.stringify({ t: now.toISOString(), running, verdict, phase, minLvl, maxLvl, totalKills, killsLast10, copper, items, deaths, down: downBots.length, parties: Object.fromEntries([...byParty].map(([k, g]) => [k, g.kills])) }) + '\n');
console.log(report);
process.exit(code);
