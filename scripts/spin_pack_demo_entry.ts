// Renderable HUD for the daily-engagement feature, built on the SHIPPED pure
// cores (src/ui/spin_wheel_core, src/ui/pack_reveal_core) with prize/pack data
// mirroring server/spin_prizes + server/packs. esbuild-bundled into a page so the
// spinner wheel + pack-rip reveal can be rendered and screenshotted in a browser.
// Wiring this into the live multiplayer HUD (IWorld + hud.ts) is the remaining
// browser-verified glue.
import {
  wheelSegments,
  landingRotation,
  pointerFractionAfter,
  segmentAtFraction,
  segmentProbability,
  fitsLabel,
} from '../src/ui/spin_wheel_core';
import { revealOrder, topRarity, Rarity } from '../src/ui/pack_reveal_core';
import { SponsoredAd, activeSponsor, safeClickUrl, ctaLabel, attribution } from '../src/ui/sponsored_slot';

// ---- data mirrored from server/spin_prizes.ts (DEFAULT_PRIZE_TABLE) ----
interface Prize { key: string; sol: number; weight: number; color: string; }
const PRIZES: Prize[] = [
  { key: 'none', sol: 0, weight: 600, color: '#4a4640' },
  { key: 'dust_s', sol: 0.0005, weight: 250, color: '#9a6b3f' },
  { key: 'dust_m', sol: 0.001, weight: 100, color: '#9fb2c9' },
  { key: 'dust_l', sol: 0.005, weight: 40, color: '#1f9e86' },
  { key: 'shard', sol: 0.02, weight: 9, color: '#2f7fe0' },
  { key: 'jackpot', sol: 0.1, weight: 1, color: '#ffc23c' },
];
const prizeOf = new Map(PRIZES.map((p) => [p.key, p]));
const prizeLabel = (p: Prize) => (p.sol > 0 ? `${p.sol} SOL` : 'No win');

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

interface Reward { name: string; rarity: Rarity; kind: string; }
const RARE_CACHE_RIP: Reward[] = [
  { name: "Warlord's Might (Arena buff)", rarity: 'rare', kind: 'buff' },
  { name: 'Healing Potion x3', rarity: 'common', kind: 'consumable' },
  { name: 'Keen Dirk', rarity: 'uncommon', kind: 'gear' },
];

// Sample bookings for the 'daily_spin' placement. In production these come from
// the ad-marketplace: adService.getForPlacement('daily_spin') -> ActiveAd[], which
// has the identical shape (advertiser, text->headline, cta, clickUrl, endSec).
const SPONSORS: SponsoredAd[] = [
  { placementId: 'daily_spin', advertiser: 'Aurora Wallet', headline: 'The fastest self-custody Solana wallet', cta: 'Get the app', clickUrl: 'https://example.com/aurora', kind: 'text', endSec: Number.MAX_SAFE_INTEGER },
  { placementId: 'daily_spin', advertiser: 'Drift Protocol', headline: 'Trade Solana perps, zero gas', cta: 'Start trading', clickUrl: 'https://example.com/drift', kind: 'text', endSec: Number.MAX_SAFE_INTEGER },
];

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const TAU = Math.PI * 2;
const segments = wheelSegments(PRIZES.map((p) => ({ key: p.key, weight: p.weight })));

// Deterministic PRNG so the demo is reproducible (the real outcome is server-side).
let seed = 0xc0ffee >>> 0;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---- spinner wheel (canvas, drawn from the shipped wheel core) ----
let rotation = 0; // in turns

function drawWheel(): void {
  const c = $('wheel') as HTMLCanvasElement;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const wrap = c.parentElement as HTMLElement;
  const size = Math.max(220, Math.min(360, Math.floor(wrap.clientWidth)));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = size * dpr; c.height = size * dpr;
  c.style.width = `${size}px`; c.style.height = `${size}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const mid = size / 2, r = mid - 6;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(mid, mid);
  ctx.rotate(-rotation * TAU);
  for (const seg of segments) {
    const p = prizeOf.get(seg.key)!;
    const a0 = seg.startFraction * TAU - Math.PI / 2;
    const a1 = seg.endFraction * TAU - Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, a0, a1); ctx.closePath();
    ctx.fillStyle = p.color; ctx.fill();
    ctx.strokeStyle = 'rgba(18,12,6,.65)'; ctx.lineWidth = 1.5; ctx.stroke();
    // Only label slices wide enough to read; the legend covers the thin ones.
    if (fitsLabel(seg)) {
      const angle = (a0 + a1) / 2;
      ctx.save();
      ctx.rotate(angle); ctx.translate(r * 0.6, 0); ctx.rotate(Math.PI / 2);
      ctx.fillStyle = p.sol > 0 ? '#16110a' : '#d8d0bd';
      ctx.font = `700 ${Math.round(size * 0.04)}px "Trebuchet MS", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.sol > 0 ? String(p.sol) : 'No win', 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
  // hub
  ctx.beginPath(); ctx.arc(mid, mid, Math.round(size * 0.075), 0, TAU);
  ctx.fillStyle = '#1c1610'; ctx.fill();
  ctx.strokeStyle = '#caa24a'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#caa24a'; ctx.font = `700 ${Math.round(size * 0.04)}px "Trebuchet MS", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('WOC', mid, mid);
}

function renderLegend(): void {
  $('legend').innerHTML = segments
    .map((seg) => {
      const p = prizeOf.get(seg.key)!;
      const pct = segmentProbability(seg) * 100;
      return `<div class="leg"><span class="sw" style="background:${p.color}"></span>` +
        `<span class="leg-label">${prizeLabel(p)}</span>` +
        `<span class="leg-odds">${pct < 1 ? pct.toFixed(2) : pct.toFixed(0)}%</span></div>`;
    })
    .join('');
}

let spinning = false;
function spin(): void {
  if (spinning) return;
  spinning = true;
  $('spinResult').textContent = '';
  $('spinBtn').setAttribute('disabled', 'true');
  const total = PRIZES.reduce((s, p) => s + p.weight, 0);
  let pick = rand() * total;
  let chosen = PRIZES[0];
  for (const p of PRIZES) { pick -= p.weight; if (pick < 0) { chosen = p; break; } }
  const target = landingRotation(segments, chosen.key, 6, rand() * 2 - 1);
  const start = rotation;
  const t0 = performance.now();
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);
  function frame(now: number): void {
    const k = Math.min(1, (now - t0) / 4200);
    rotation = start + (target - start) * ease(k);
    drawWheel();
    if (k < 1) { requestAnimationFrame(frame); return; }
    const landed = prizeOf.get(segmentAtFraction(segments, pointerFractionAfter(rotation)).key)!;
    $('spinResult').innerHTML = landed.sol > 0
      ? `<span class="win">You won ${prizeLabel(landed)}!</span> Settling on-chain from the vault.`
      : `<span class="muted">No win today. Streak kept, come back tomorrow.</span>`;
    spinning = false;
    $('spinBtn').removeAttribute('disabled');
  }
  requestAnimationFrame(frame);
}

// ---- pack ripping (uses the shipped revealOrder + topRarity) ----
function renderPacks(): void {
  $('packCards').innerHTML = PACKS.map((p) =>
    `<div class="pack" style="--tint:${p.tint}">` +
    `<div class="pack-name">${p.name}</div>` +
    `<div class="pack-rolls">${p.rolls} rewards</div>` +
    `<button class="burn" data-pack="${p.id}">Burn ${p.priceWoc.toLocaleString()} $WOC</button></div>`,
  ).join('');
  document.querySelectorAll<HTMLButtonElement>('.burn').forEach((b) => b.addEventListener('click', ripRare));
}

function ripRare(): void {
  const ordered = revealOrder(RARE_CACHE_RIP); // lowest rarity first, biggest pull last
  const best = topRarity(RARE_CACHE_RIP)!;
  const reveal = $('ripReveal');
  reveal.innerHTML = '';
  reveal.classList.remove('hidden');
  $('ripHeadline').textContent = `Rare Cache ripped, best pull: ${best.toUpperCase()}`;
  $('ripHeadline').style.color = RARITY_COLOR[best];
  ordered.forEach((rw, i) => {
    const card = document.createElement('div');
    card.className = 'reward';
    card.style.setProperty('--rc', RARITY_COLOR[rw.rarity]);
    card.style.animationDelay = `${i * 240}ms`;
    card.innerHTML = `<div class="reward-kind">${rw.kind}</div>` +
      `<div class="reward-name">${rw.name}</div>` +
      `<div class="reward-rarity">${rw.rarity}</div>`;
    reveal.appendChild(card);
  });
}

// ---- daily tasks ----
function renderTasks(): void {
  const tasks = [
    { t: 'Log in today', done: true },
    { t: 'Clear a dungeon', done: true },
    { t: 'Win an Arena match', done: false },
  ];
  $('taskList').innerHTML = tasks
    .map((x) => `<li class="${x.done ? 'done' : ''}"><span class="check"></span>${x.t}</li>`)
    .join('');
}

// ---- sponsored slot (ad-marketplace 'daily_spin' placement) ----
let bonusSpins = 0;
function renderSponsor(): void {
  const ad = activeSponsor(SPONSORS, 'daily_spin', Math.floor(Date.now() / 1000));
  const banner = $('sponsorBanner');
  const line = $('sponsorLine');
  if (!ad) { banner.classList.add('hidden'); line.classList.add('hidden'); return; }
  const href = safeClickUrl(ad.clickUrl);
  const ctaHtml = href
    ? `<a class="ad-cta" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(ctaLabel(ad.cta))}</a>`
    : '';
  banner.classList.remove('hidden');
  banner.innerHTML =
    `<span class="ad-tag">Sponsored</span>` +
    `<div class="ad-body"><b>${esc(ad.advertiser)}</b><span>${esc(ad.headline)}</span></div>` +
    ctaHtml;
  line.classList.remove('hidden');
  line.innerHTML = `${esc(attribution(ad))} &middot; <button class="bonus-chip" id="bonusChip">+1 bonus spin</button>`;
  const chip = $('bonusChip') as HTMLButtonElement;
  chip.addEventListener('click', () => {
    bonusSpins += 1;
    chip.disabled = true;
    chip.textContent = 'Bonus spin unlocked';
    $('spinResult').innerHTML = `<span class="win">+1 sponsored spin</span> from ${esc(ad.advertiser)} (${bonusSpins} banked). Spin again.`;
  });
}

function init(): void {
  drawWheel();
  renderLegend();
  renderPacks();
  renderTasks();
  renderSponsor();
  $('spinBtn').addEventListener('click', spin);
  // Keep the wheel crisp + correctly sized across viewport changes.
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawWheel);
  });
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
