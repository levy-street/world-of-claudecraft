// Player card compositor.
//
// Paints a shareable 1200×630 (Open-Graph aspect) card from the player's live
// stats, equipped gear, a captured close-up of their character, and — when a
// wallet is connected — their $WOC holder-tier badge. Pure Canvas-2D + the
// holder-tier data; no network, no game state beyond what the caller passes in.
//
// The caller (the HUD) assembles PlayerCardData from IWorld; this module only
// knows how to draw it.
import { holderTierForBalance, holderTierBadgeDataUrl, type HolderTier } from './holder_tier';

export interface PlayerCardStat {
  label: string;
  value: string;
}

export interface PlayerCardGear {
  slot: string;
  name: string;
  /** Quality colour (hex) for the item name; empty slots use a muted tone. */
  color: string;
}

export interface PlayerCardData {
  name: string;
  className: string;
  /** Class accent colour (hex), used for the name + frame highlights. */
  classColor: string;
  level: number;
  /** Realm name, or '' in offline play (then a generic subtitle is used). */
  realm: string;
  /** PNG data URL of the character close-up (transparent background). */
  characterImage: string;
  /** STR / AGI / STA / INT / SPI / Armor. */
  primaryStats: PlayerCardStat[];
  /** Attack power, DPS, crit, dodge, etc. */
  combatStats: PlayerCardStat[];
  gear: PlayerCardGear[];
  arenaRating: number | null;
  prestigeRank: number;
  /** Realm percentile by lifetime XP (e.g. 3 = top 3%), or null to hide it. */
  topPercent: number | null;
  /** Connected wallet's $WOC balance (null when no wallet). Drives the badge. */
  balance: number | null;
  /** Handle shown in the footer referral line (the card slug, or the name). */
  referralHandle: string;
  /** Recruited-friends count, when known. */
  referralCount: number | null;
  /** Play URL printed on the card footer. */
  siteUrl: string;
}

export const CARD_W = 1200;
export const CARD_H = 630;
const SCALE = 2; // render at 2× for crisp text, then the canvas is 2400×1260

const COL = {
  bgTop: '#1d1409',
  bgBottom: '#0a0805',
  frame: '#b8902f',
  frameInner: '#3a2d12',
  gold: '#ffd100',
  goldDim: '#caa64a',
  cream: '#ece2c4',
  muted: '#9b8b62',
  panel: 'rgba(0,0,0,0.34)',
  panelEdge: 'rgba(255,209,0,0.14)',
};

/** A selectable pose for the card avatar. `clips` is tried in order against the
 *  model (first present wins; Idle is the universal fallback); `fraction` is the
 *  point in the clip (0..1) to freeze. Verified to read well across all classes. */
export interface CardPose {
  id: string;
  label: string;
  clips: readonly string[];
  fraction: number;
}

export const CARD_POSES: readonly CardPose[] = [
  // Heroic raised weapon — epic across warrior/mage/hunter/etc. The default.
  { id: 'hero', label: 'Hero', clips: ['Spellcast_Raise', 'Spellcasting', 'Idle'], fraction: 0.5 },
  // Class-appropriate combat action (melee swing / drawn bow / cast).
  { id: 'battle', label: 'Battle', clips: ['2H_Melee_Attack_Chop', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', 'Dualwield_Melee_Attack_Chop', '2H_Ranged_Shoot', 'Spellcast_Shoot', 'Idle'], fraction: 0.4 },
  // Arm-up celebration.
  { id: 'victory', label: 'Victory', clips: ['Cheer', 'Jump_Idle', 'Idle'], fraction: 0.5 },
];

/** Human-readable $WOC amount: whole tokens with thousands separators. */
function formatWoc(n: number): string {
  return (n >= 1 ? Math.round(n) : n).toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 0 : 2 });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('player-card: image failed to load'));
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Draw `text` truncated with an ellipsis if it would exceed `maxW`. */
function fillTextClamped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number): void {
  if (ctx.measureText(text).width <= maxW) {
    ctx.fillText(text, x, y);
    return;
  }
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  ctx.fillText(s + '…', x, y);
}

const TITLE_FONT = 'Cinzel, Georgia, serif';
const BODY_FONT = '"Alegreya Sans", "Segoe UI", system-ui, sans-serif';

// The full brand lockup (C-shield emblem + "WORLD OF CLAUDECRAFT" wordmark),
// served from /public. Same-origin, so drawing it does not taint the canvas.
// Loaded best-effort: if it's missing the footer falls back to a text wordmark
// rather than failing the whole card.
const LOGO_URL = '/woc-logo-hero.webp';

/** Format a realm percentile as a card chip label, e.g. 3 → "TOP 3%". */
function formatTopPercent(pct: number): string {
  return pct < 1 ? `TOP ${pct.toFixed(1)}%` : `TOP ${Math.ceil(pct)}%`;
}

/**
 * Composite the player card and return the canvas (2400×1260). The caller can
 * scale it for preview or export it to a PNG blob. Fonts are awaited so the
 * brand typefaces are used rather than a fallback.
 */
export async function renderPlayerCardCanvas(data: PlayerCardData): Promise<HTMLCanvasElement> {
  // Make sure the brand fonts are rasterisable before we measure/draw text.
  if (document.fonts?.ready) {
    await document.fonts.ready;
    await Promise.all([
      document.fonts.load('700 64px Cinzel').catch(() => undefined),
      document.fonts.load('700 26px "Alegreya Sans"').catch(() => undefined),
      document.fonts.load('400 22px "Alegreya Sans"').catch(() => undefined),
    ]);
  }

  const tier = holderTierForBalance(data.balance);
  const [charImg, badgeImg, logoImg] = await Promise.all([
    loadImage(data.characterImage),
    tier ? loadImage(holderTierBadgeDataUrl(tier, 256)) : Promise.resolve(null),
    loadImage(LOGO_URL).catch(() => null), // best-effort brand mark
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * SCALE;
  canvas.height = CARD_H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  drawBackdrop(ctx, data.classColor);
  drawCharacter(ctx, charImg);
  drawHeader(ctx, data);
  if (tier && badgeImg) drawBadge(ctx, tier, badgeImg, data.balance);
  drawStats(ctx, data);
  drawGear(ctx, data);
  drawFooter(ctx, data, logoImg);
  drawFrame(ctx, data.classColor);

  return canvas;
}

function drawBackdrop(ctx: CanvasRenderingContext2D, accent: string): void {
  const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  g.addColorStop(0, COL.bgTop);
  g.addColorStop(1, COL.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Soft accent wash behind the character (class-coloured).
  const halo = ctx.createRadialGradient(230, 330, 40, 230, 330, 360);
  halo.addColorStop(0, hexWithAlpha(accent, 0.34));
  halo.addColorStop(1, hexWithAlpha(accent, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Vignette.
  const vig = ctx.createRadialGradient(CARD_W / 2, CARD_H / 2, 200, CARD_W / 2, CARD_H / 2, 720);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function drawCharacter(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
  // Fit the portrait into the left third, anchored to the bottom so feet sit on
  // the frame. The capture is transparent, so it composites over the backdrop.
  const boxX = 24;
  const boxY = 40;
  const boxW = 430;
  const boxH = CARD_H - boxY - 40;
  const scale = Math.min(boxW / img.width, boxH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = boxX + (boxW - w) / 2;
  const y = boxY + (boxH - h);
  ctx.drawImage(img, x, y, w, h);
}

function drawHeader(ctx: CanvasRenderingContext2D, data: PlayerCardData): void {
  const x = 478;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = COL.gold;
  ctx.font = `700 58px ${TITLE_FONT}`;
  fillTextClamped(ctx, data.name, x, 96, 540);
  ctx.restore();

  ctx.fillStyle = COL.cream;
  ctx.font = `600 24px ${BODY_FONT}`;
  const sub = `Level ${data.level} · ${data.className}`;
  ctx.fillText(sub, x, 130);
  const subW = ctx.measureText(sub).width;

  // A "TOP N%" flex chip beside the subtitle (only shown when it's a flex).
  if (data.topPercent !== null) {
    const label = formatTopPercent(data.topPercent);
    ctx.font = `700 16px ${BODY_FONT}`;
    const tw = ctx.measureText(label).width;
    const padX = 12;
    const chipX = x + subW + 16;
    const chipY = 109;
    const chipH = 26;
    ctx.fillStyle = COL.gold;
    roundRect(ctx, chipX, chipY, tw + padX * 2, chipH, 13);
    ctx.fill();
    ctx.fillStyle = '#1c1407';
    ctx.fillText(label, chipX + padX, chipY + 18);
  }

  ctx.fillStyle = COL.muted;
  ctx.font = `400 19px ${BODY_FONT}`;
  ctx.fillText(data.realm ? `${data.realm} Realm` : 'World of Claudecraft', x, 158);
}

function drawBadge(ctx: CanvasRenderingContext2D, tier: HolderTier, badge: HTMLImageElement, balance: number | null): void {
  const cx = 1108;
  const cy = 96;
  const r = 52;
  ctx.save();
  ctx.shadowColor = hexWithAlpha(tier.glow, 0.9);
  ctx.shadowBlur = 22;
  ctx.drawImage(badge, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  const right = cx - r - 14;
  ctx.textAlign = 'right';
  // Tier name.
  ctx.fillStyle = tier.ring;
  ctx.font = `700 22px ${TITLE_FONT}`;
  ctx.fillText(tier.name.toUpperCase(), right, cy - 22);
  // The actual on-chain bag — the flex.
  if (balance !== null) {
    ctx.fillStyle = COL.gold;
    ctx.font = `700 24px ${BODY_FONT}`;
    fillTextClamped(ctx, `${formatWoc(balance)} $WOC`, right, cy + 4, 380);
  }
  // Flavour line.
  ctx.fillStyle = COL.muted;
  ctx.font = `400 14px ${BODY_FONT}`;
  fillTextClamped(ctx, tier.flavor, right, cy + 26, 400);
  ctx.textAlign = 'left';
}

function drawStats(ctx: CanvasRenderingContext2D, data: PlayerCardData): void {
  const x = 478;
  const y = 196;
  const w = 690;
  const h = 196;
  ctx.fillStyle = COL.panel;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = COL.panelEdge;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();

  // Two stat blocks side by side: attributes (left) and combat (right).
  const padX = 26;
  const colW = (w - padX * 2) / 2;
  drawStatColumn(ctx, data.primaryStats, x + padX, y + 22, colW - 20);
  drawStatColumn(ctx, data.combatStats, x + padX + colW + 8, y + 22, colW - 20);
}

function drawStatColumn(ctx: CanvasRenderingContext2D, stats: PlayerCardStat[], x: number, y: number, w: number): void {
  const rowH = 27;
  ctx.font = `600 20px ${BODY_FONT}`;
  for (let i = 0; i < stats.length; i++) {
    const ry = y + i * rowH + 18;
    ctx.fillStyle = COL.muted;
    ctx.textAlign = 'left';
    ctx.fillText(stats[i].label, x, ry);
    ctx.fillStyle = COL.cream;
    ctx.textAlign = 'right';
    ctx.fillText(stats[i].value, x + w, ry);
  }
  ctx.textAlign = 'left';
}

function drawGear(ctx: CanvasRenderingContext2D, data: PlayerCardData): void {
  const x = 478;
  const y = 412;
  const w = 690;
  const h = 118;
  ctx.fillStyle = COL.panel;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = COL.panelEdge;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();

  const padX = 26;
  const colW = (w - padX * 2) / 2;
  for (let i = 0; i < data.gear.length; i++) {
    const col = i % 2;
    const rowIdx = Math.floor(i / 2);
    const gx = x + padX + col * colW;
    const gy = y + 20 + rowIdx * 44;
    ctx.fillStyle = COL.muted;
    ctx.font = `600 15px ${BODY_FONT}`;
    ctx.fillText(data.gear[i].slot.toUpperCase(), gx, gy);
    ctx.fillStyle = data.gear[i].color;
    ctx.font = `600 20px ${BODY_FONT}`;
    fillTextClamped(ctx, data.gear[i].name, gx, gy + 22, colW - 24);
  }
}

function drawFooter(ctx: CanvasRenderingContext2D, data: PlayerCardData, logo: HTMLImageElement | null): void {
  const y = CARD_H - 26;
  const bx = 478;
  // Brand mark: the full logo lockup, else a plain text wordmark. Its backing is
  // near-black and the footer sits on the card's dark gradient, so it composites
  // with no visible seam.
  if (logo && logo.width > 0) {
    const h = 70;
    const w = (logo.width / logo.height) * h;
    ctx.drawImage(logo, bx, CARD_H - 26 - h, w, h);
  } else {
    ctx.fillStyle = COL.gold;
    ctx.font = `700 24px ${TITLE_FONT}`;
    ctx.fillText('WORLD OF CLAUDECRAFT', bx, y);
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = COL.cream;
  ctx.font = `600 19px ${BODY_FONT}`;
  const recruited = data.referralCount ? `  ·  ${data.referralCount} recruited` : '';
  ctx.fillText(`@${data.referralHandle}${recruited}`, 1168, y - 22);
  ctx.fillStyle = COL.goldDim;
  ctx.font = `400 16px ${BODY_FONT}`;
  fillTextClamped(ctx, `Forge your legend → ${data.siteUrl}`, 1168, y, 480);
  ctx.textAlign = 'left';
}

function drawFrame(ctx: CanvasRenderingContext2D, accent: string): void {
  // Outer gold frame with a class-accent inner hairline.
  ctx.strokeStyle = COL.frameInner;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, CARD_W - 10, CARD_H - 10);
  const grad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  grad.addColorStop(0, COL.frame);
  grad.addColorStop(0.5, COL.gold);
  grad.addColorStop(1, COL.frame);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, CARD_W - 20, CARD_H - 20);
  ctx.strokeStyle = hexWithAlpha(accent, 0.5);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(15, 15, CARD_W - 30, CARD_H - 30);
}

/** Convert a #rrggbb hex to an rgba() string at the given alpha. */
function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return `rgba(255,209,0,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Export a composited card canvas to a PNG blob. */
export function cardCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('player-card: canvas.toBlob returned null'));
    }, 'image/png');
  });
}
