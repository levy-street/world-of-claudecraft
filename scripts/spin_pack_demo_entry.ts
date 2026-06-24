// Renderable HUD for the daily-engagement feature, built on the SHIPPED pure
// cores (src/ui/spin_wheel_core, src/ui/pack_reveal_core) with prize/pack data
// mirroring server/spin_prizes + server/packs. esbuild-bundled into a page so the
// spinner wheel + pack-rip reveal can be rendered and screenshotted in a browser.
// This is the feature's UI rendering real logic + data; wiring it into the live
// multiplayer HUD (IWorld + hud.ts) is the remaining browser-verified glue.
import { wheelSegments, landingRotation, pointerFractionAfter, segmentAtFraction, WheelSegment } from '../src/ui/spin_wheel_core';
import { revealOrder, topRarity, Rarity } from '../src/ui/pack_reveal_core';

// ---- data mirrored from server/spin_prizes.ts (DEFAULT_PRIZE_TABLE) ----
interface Prize { key: string; label: string; sol: number; weight: number; color: string; }
const PRIZES: Prize[] = [
  { key: 'none', label: 'No win', sol: 0, weight: 600, color: '#4a4640' },
  { key: 'dust_s', label: '0.0005 SOL', sol: 0.0005, weight: 250, color: '#9a6b3f' },
  { key: 'dust_m', label: '0.001 SOL', sol: 0.001, weight: 100, color: '#9fb2c9' },
  { key: 'dust_l', label: '0.005 SOL', sol: 0.005, weight: 40, color: '#1f9e86' },
  { key: 'shard', label: '0.02 SOL', sol: 0.02, weight: 9, color: '#2f7fe0' },
  { key: 'jackpot', label: '0.1 SOL', sol: 0.1, weight: 1, color: '#ffc23c' },
];

const RARITY_COLOR: Record<Rarity, string> = {
  poor: '#9d9d9d', common: '#e9e4d6', uncommon: '#1eff00', rare: '#3a8bff', epic: '#c44dff', legendary: '#ff8000',
};

// ---- data mirrored from server/packs.ts (PACK_CATALOG) ----
interface PackCard { id: string; name: string; priceWoc: number; rolls: number; tint: string; }
const PACKS: PackCard[] = [
  { id: 'common_cache', name: 'Common Cache', priceWoc: 250, rolls: 2, tint: '#6b7a8f' },
  { id: 'rare_cache', name: 'Rare Cache', priceWoc: 1000, rolls: 3, tint: '#3a8bff' },
  { id: 'prismatic_cache', name: 'Prismatic Cache', priceWoc: 5000, rolls: 3, tint: '#c44dff' },
];

// A representative rare_cache rip (cosmetic-policy eligible rewards).
interface Reward { name: string; rarity: Rarity; kind: string; }
const RARE_CACHE_RIP: Reward[] = [
  { name: "Warlord's Might (Arena buff)", rarity: 'rare', kind: 'buff' },
  { name: 'Healing Potion x3', rarity: 'common', kind: 'consumable' },
  { name: 'Keen Dirk', rarity: 'uncommon', kind: 'gear' },
];

const $ = (id: string) => document.getElementById(id)!;
const rng = mulberry32(0xC0FFEE);
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- spinner wheel (canvas, drawn from the shipped wheelSegments) ----
const segments: WheelSegment[] = wheelSegments(PRIZES.map((p) => ({ key: p.key, weight: p.weight })));
const TAU = Math.PI * 2;
let rotation = 0; // in turns

function drawWheel() {
  const c = $('wheel') as HTMLCanvasElement;
  const ctx = c.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const size = 340;
  c.width = size * dpr; c.height = size * dpr;
  c.style.width = `${size}px`; c.style.height = `${size}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 8;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(cx, cy);
  // rotation: turns -> radians, negative so the top pointer reads pointerFraction.
  ctx.rotate(-rotation * TAU);
  segments.forEach((seg, i) => {
    const prize = PRIZES[i];
    const a0 = seg.startFraction * TAU - Math.PI / 2;
    const a1 = seg.endFraction * TAU - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = prize.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,14,8,0.7)'; ctx.lineWidth = 2; ctx.stroke();
    // label
    const mid = (a0 + a1) / 2;
    ctx.save();
    ctx.rotate(mid);
    ctx.translate(r * 0.62, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = prize.sol > 0 ? '#15110b' : '#cfc8b8';
    ctx.font = '600 12px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(prize.sol > 0 ? prize.label : '—', 0, 0);
    ctx.restore();
  });
  ctx.restore();
  // hub
  ctx.beginPath(); ctx.arc(cx, cy, 26, 0, TAU);
  ctx.fillStyle = '#1c1610'; ctx.fill();
  ctx.strokeStyle = '#caa24a'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#caa24a'; ctx.font = '700 13px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('WOC', cx, cy + 4);
}

let spinning = false;
function spin() {
  if (spinning) return;
  spinning = true;
  $('spinResult').textContent = '';
  $('spinBtn').setAttribute('disabled', 'true');
  // pick a prize by weight using a fresh draw, then land on it via the shipped math.
  const total = PRIZES.reduce((s, p) => s + p.weight, 0);
  let t = rng() * total, idx = 0;
  for (let i = 0; i < PRIZES.length; i++) { t -= PRIZES[i].weight; if (t < 0) { idx = i; break; } }
  const prize = PRIZES[idx];
  const target = landingRotation(segments, prize.key, 6, rng() * 2 - 1);
  const start = rotation;
  const dur = 4200;
  const t0 = performance.now();
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);
  function frame(now: number) {
    const k = Math.min(1, (now - t0) / dur);
    rotation = start + (target - start) * ease(k);
    drawWheel();
    if (k < 1) { requestAnimationFrame(frame); return; }
    // verify against the shipped segment lookup
    const landed = segmentAtFraction(segments, pointerFractionAfter(rotation));
    const won = PRIZES.find((p) => p.key === landed.key)!;
    const el = $('spinResult');
    if (won.sol > 0) { el.innerHTML = `<span class="win">You won ${won.label}!</span> Settling on-chain from the vault…`; }
    else { el.innerHTML = `<span class="muted">No win today. Streak kept. Come back tomorrow.</span>`; }
    spinning = false;
    $('spinBtn').removeAttribute('disabled');
  }
  requestAnimationFrame(frame);
}

// ---- pack rip (uses the shipped revealOrder + topRarity) ----
function renderPacks() {
  $('packCards').innerHTML = PACKS.map((p) => `
    <div class="pack" style="--tint:${p.tint}">
      <div class="pack-name">${p.name}</div>
      <div class="pack-rolls">${p.rolls} rewards</div>
      <button class="burn" data-pack="${p.id}">Burn ${p.priceWoc.toLocaleString()} $WOC</button>
    </div>`).join('');
  document.querySelectorAll('.burn').forEach((b) => b.addEventListener('click', () => ripRare()));
}

function ripRare() {
  const ordered = revealOrder(RARE_CACHE_RIP); // lowest rarity first, big pull last
  const top = topRarity(RARE_CACHE_RIP)!;
  const slots = $('ripReveal');
  slots.innerHTML = '';
  slots.classList.remove('hidden');
  $('ripHeadline').textContent = `Rare Cache ripped — best pull: ${top.toUpperCase()}`;
  $('ripHeadline').style.color = RARITY_COLOR[top];
  ordered.forEach((rw, i) => {
    const card = document.createElement('div');
    card.className = 'reward';
    card.style.setProperty('--rc', RARITY_COLOR[rw.rarity]);
    card.style.animationDelay = `${i * 260}ms`;
    card.innerHTML = `<div class="reward-kind">${rw.kind}</div><div class="reward-name">${rw.name}</div><div class="reward-rarity">${rw.rarity}</div>`;
    slots.appendChild(card);
  });
}

// ---- daily tasks / streak ----
function renderTasks() {
  const tasks = [
    { t: 'Log in today', done: true },
    { t: 'Clear a dungeon', done: true },
    { t: 'Win an Arena match', done: false },
  ];
  $('taskList').innerHTML = tasks.map((x) => `
    <li class="${x.done ? 'done' : ''}"><span class="check"></span>${x.t}</li>`).join('');
}

function init() {
  drawWheel();
  renderPacks();
  renderTasks();
  $('spinBtn').addEventListener('click', spin);
}
if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
