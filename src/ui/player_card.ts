// Player card compositor.
//
// Paints a shareable 1200×630 (Open-Graph aspect) card from the player's live
// stats, equipped gear, a captured close-up of their character, and - when a
// wallet is linked and verified - their $WOC holder-tier badge. Pure Canvas-2D + the
// holder-tier data; no network, no game state beyond what the caller passes in.
//
// The caller (the HUD) assembles PlayerCardData from IWorld; this module only
// knows how to draw it.
import { type DevTier, devTierBadgeDataUrl, devTierByIndex, devTierDisplayName } from './dev_tier';
import {
  type HolderTier,
  holderTierBadgeDataUrl,
  holderTierDisplayName,
  holderTierFlavorText,
  holderTierForBalance,
} from './holder_tier';
import { formatNumber, getLanguage, languageTag, type TranslationKey, t } from './i18n';
import {
  type PercentileTier,
  percentileTierBadgeDataUrl,
  percentileTierForPercent,
} from './percentile_tier';

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
  /** The selected Book of Deeds title as LOCALIZED DISPLAY TEXT (resolved at
   *  the build site via deedTitleText, never a deed id). Absent or '' for an
   *  untitled player: the card then draws byte-identical to the pre-title
   *  layout (cardTitleLayout returns null and nothing extra is drawn). */
  titleText?: string;
  /** Realm percentile by lifetime XP (e.g. 3 = top 3%), or null to hide it. */
  topPercent: number | null;
  /** Verified linked wallet's $WOC balance (null when unlinked). Drives the badge. */
  balance: number | null;
  /** Developer-badge tier index (0/null = none, 1-5). Drives the dev badge. */
  devTier: number | null;
  /** Merged-PR count behind the dev tier (null when unknown). */
  devMergedPrs: number | null;
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
  labelKey: TranslationKey;
  clips: readonly string[];
  fraction: number;
}

export const CARD_POSES: readonly CardPose[] = [
  // Heroic raised weapon: epic across warrior/mage/hunter/etc. The default.
  {
    id: 'hero',
    labelKey: 'playerCard.poseHero',
    clips: ['Spellcast_Raise', 'Spellcasting', 'Idle'],
    fraction: 0.5,
  },
  // Class-appropriate combat action (melee swing / drawn bow / cast).
  {
    id: 'battle',
    labelKey: 'playerCard.poseBattle',
    clips: [
      '2H_Melee_Attack_Chop',
      '1H_Melee_Attack_Chop',
      '1H_Melee_Attack_Slice_Diagonal',
      'Dualwield_Melee_Attack_Chop',
      '2H_Ranged_Shoot',
      'Spellcast_Shoot',
      'Idle',
    ],
    fraction: 0.4,
  },
  // Arm-up celebration.
  {
    id: 'victory',
    labelKey: 'playerCard.poseVictory',
    clips: ['Cheer', 'Jump_Idle', 'Idle'],
    fraction: 0.5,
  },
];

/** Human-readable $WOC amount in the player's current locale. */
function formatWoc(n: number): string {
  return formatNumber(n, { maximumFractionDigits: n >= 1 ? 0 : 2 });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('player-card: image failed to load'));
    img.src = src;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
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
function fillTextClamped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
): void {
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

// The header text column: every header line (name, subtitle, realm, title)
// starts here, clamped left of the right-edge column that keeps text clear of
// the top-right brand mark. Shared by drawHeader and cardTitleLayout so the
// title line can never drift from the header origin.
const HEADER_X = 478;
const HEADER_RIGHT_EDGE = 1018;

// The full brand lockup (C-shield emblem + "WORLD OF CLAUDECRAFT" wordmark),
// served from /public. Same-origin, so drawing it does not taint the canvas.
// Loaded best-effort: if it's missing the footer falls back to a text wordmark
// rather than failing the whole card.
const LOGO_URL = '/woc-logo-hero.webp';

/** Where the title line sits on the header, or null when nothing may draw.
 *  Pure (no canvas): the caller passes the measured realm-line width so the
 *  title starts past it on the same y=158 baseline, clamped left of the
 *  RIGHT_EDGE (1018) column every header line respects. Null for an absent /
 *  empty / whitespace titleText, and for a residual box too narrow to read,
 *  which is what keeps an untitled card byte-identical (the one draw call is
 *  guarded on this returning non-null). */
export function cardTitleLayout(
  titleText: string | undefined,
  realmLineWidth: number,
): { text: string; x: number; y: number; maxW: number } | null {
  const text = (titleText ?? '').trim();
  if (!text) return null;
  const x = HEADER_X + Math.ceil(realmLineWidth) + 16;
  const maxW = HEADER_RIGHT_EDGE - x;
  if (maxW < 40) return null; // an extreme realm line: skip rather than clip to noise
  return { text, x, y: 158, maxW };
}

/** Format a realm percentile as a card chip label. */
function formatTopPercent(pct: number): string {
  const percent =
    pct < 1
      ? formatNumber(pct, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : formatNumber(Math.ceil(pct), { maximumFractionDigits: 0 });
  return t('playerCard.topPercent', { percent });
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
  const pctTier = percentileTierForPercent(data.topPercent);
  const devTier = devTierByIndex(data.devTier ?? 0);
  const [charImg, badgeImg, logoImg, pctBadgeImg, devBadgeImg] = await Promise.all([
    loadImage(data.characterImage),
    tier ? loadImage(holderTierBadgeDataUrl(tier, 256)) : Promise.resolve(null),
    loadImage(LOGO_URL).catch(() => null), // best-effort brand mark
    pctTier
      ? loadImage(percentileTierBadgeDataUrl(pctTier, 128)).catch(() => null)
      : Promise.resolve(null), // best-effort; drawHeader falls back to the plain chip
    devTier
      ? loadImage(devTierBadgeDataUrl(devTier, 128)).catch(() => null)
      : Promise.resolve(null),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * SCALE;
  canvas.height = CARD_H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  drawBackdrop(ctx, data.classColor);
  drawCharacter(ctx, charImg);
  drawHeader(ctx, data, pctBadgeImg, pctTier);
  if (devTier && devBadgeImg) drawDevBadge(ctx, devTier, devBadgeImg, data.devMergedPrs);
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

function drawHeader(
  ctx: CanvasRenderingContext2D,
  data: PlayerCardData,
  pctBadge: HTMLImageElement | null,
  pctTier: PercentileTier | null,
): void {
  const x = HEADER_X;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = COL.gold;
  ctx.font = `700 58px ${TITLE_FONT}`;
  fillTextClamped(ctx, data.name, x, 96, 540);
  ctx.restore();

  const sub = t('playerCard.levelClass', {
    level: formatNumber(data.level, { maximumFractionDigits: 0 }),
    className: data.className,
  });

  // A "TOP N%" flex sits beside the subtitle (only shown when it's a flex). Top
  // 1-10% earns a rarity-graded tier medal + a tier-coloured tile; a worse-than-10%
  // percentile keeps a plain gold chip. Measure it first so we can reserve room and
  // clamp the subtitle — otherwise a wordy localized "Level N Class" could push the
  // medal + chip off the right edge.
  const RIGHT_EDGE = HEADER_RIGHT_EDGE; // keep the flex left of the brand mark (matches the name's clamp)
  const padX = 12;
  const chipY = 109;
  const chipH = 26;
  const hasFlex = data.topPercent !== null;
  const label = hasFlex ? formatTopPercent(data.topPercent as number) : '';
  ctx.font = `700 16px ${BODY_FONT}`;
  const tw = hasFlex ? ctx.measureText(label).width : 0;
  const medalW = hasFlex && pctTier && pctBadge ? chipH + 14 : 0;
  const reserved = hasFlex ? 16 + medalW + tw + padX * 2 : 0;

  ctx.fillStyle = COL.cream;
  ctx.font = `600 24px ${BODY_FONT}`;
  const maxSubW = RIGHT_EDGE - x - reserved;
  fillTextClamped(ctx, sub, x, 130, maxSubW);
  const subW = Math.min(ctx.measureText(sub).width, maxSubW);

  if (hasFlex) {
    let cursorX = x + subW + 16;
    // The tier medal sits just left of the tile, against the dark card so its
    // ring→glow + laurel read clearly.
    if (medalW) {
      ctx.drawImage(
        pctBadge as HTMLImageElement,
        cursorX,
        chipY + chipH / 2 - medalW / 2,
        medalW,
        medalW,
      );
      cursorX += medalW; // the medal box's transparent margin spaces it from the tile
    }
    ctx.fillStyle = pctTier ? pctTier.ring : COL.gold;
    roundRect(ctx, cursorX, chipY, tw + padX * 2, chipH, 13);
    ctx.fill();
    ctx.fillStyle = '#1c1407';
    ctx.font = `700 16px ${BODY_FONT}`;
    ctx.fillText(label, cursorX + padX, chipY + 18);
  }

  ctx.fillStyle = COL.muted;
  ctx.font = `400 19px ${BODY_FONT}`;
  const realmLine = data.realm
    ? t('playerCard.realmSubtitle', { realm: data.realm })
    : t('playerCard.defaultRealm');
  ctx.fillText(realmLine, x, 158);

  // The selected Book of Deeds title, a small gold read beside the realm line.
  // The header stack under the name is fully allocated (subtitle + flex chip
  // y109-135, realm y158, dev badge band y168-190, stats panel y196), so the
  // title shares the realm baseline instead of claiming a new line: an
  // untitled card draws NOTHING here and stays byte-identical.
  const titleLine = cardTitleLayout(data.titleText, ctx.measureText(realmLine).width);
  if (titleLine) {
    ctx.fillStyle = COL.goldDim;
    ctx.font = `600 19px ${BODY_FONT}`;
    fillTextClamped(ctx, titleLine.text, titleLine.x, titleLine.y, titleLine.maxW);
  }
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  tier: HolderTier,
  badge: HTMLImageElement,
  balance: number | null,
): void {
  // Bottom-left of the right column (the footer band), swapped with the brand
  // mark, which now sits top-right. Badge on the left, tier + balance to its right.
  // Compact badge with a tight glow so it sits inside the footer band without
  // bleeding up into the gear panel above (which ends at y≈530).
  const r = 30;
  const cx = 478 + r;
  const cy = 575;
  ctx.save();
  ctx.shadowColor = hexWithAlpha(tier.glow, 0.9);
  ctx.shadowBlur = 8;
  ctx.drawImage(badge, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  const left = cx + r + 16;
  ctx.textAlign = 'left';
  // Tier name.
  ctx.fillStyle = tier.ring;
  ctx.font = `700 18px ${TITLE_FONT}`;
  ctx.fillText(
    holderTierDisplayName(tier).toLocaleUpperCase(languageTag(getLanguage())),
    left,
    cy - 13,
  );
  // The actual on-chain bag: the flex.
  if (balance !== null) {
    ctx.fillStyle = COL.gold;
    ctx.font = `700 20px ${BODY_FONT}`;
    fillTextClamped(
      ctx,
      t('wallet.balanceAmount', { amount: formatWoc(balance) }),
      left,
      cy + 10,
      210,
    );
  }
  // Flavour line.
  ctx.fillStyle = COL.muted;
  ctx.font = `400 12px ${BODY_FONT}`;
  fillTextClamped(ctx, holderTierFlavorText(tier), left, cy + 28, 220);
}

// The developer badge sits in the free band between the realm subtitle (whose
// glyphs end around y=162) and the stats panel (y=196), in the right column: a
// compact badge with the rung name and the merged-PR count, reading as an
// earned honor like the percentile medal above it. Sized + centred (r=11,
// cy=179) to keep clearance on both sides even for a tall non-Latin glyph (the
// rung name is short by design: see hudChrome.devBadge.tiers.*).
function drawDevBadge(
  ctx: CanvasRenderingContext2D,
  tier: DevTier,
  badge: HTMLImageElement,
  mergedPrs: number | null,
): void {
  const r = 11;
  const cx = 478 + r;
  const cy = 179;
  ctx.save();
  ctx.shadowColor = hexWithAlpha(tier.glow, 0.9);
  ctx.shadowBlur = 6;
  ctx.drawImage(badge, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  const left = cx + r + 9;
  ctx.textAlign = 'left';
  ctx.fillStyle = tier.ring;
  ctx.font = `700 14px ${TITLE_FONT}`;
  const name = devTierDisplayName(tier).toLocaleUpperCase(languageTag(getLanguage()));
  ctx.fillText(name, left, cy + 4);
  if (mergedPrs !== null) {
    const nameW = ctx.measureText(name).width;
    ctx.fillStyle = COL.muted;
    ctx.font = `400 12px ${BODY_FONT}`;
    fillTextClamped(
      ctx,
      t('hudChrome.devBadge.prsLanded', {
        count: formatNumber(mergedPrs, { maximumFractionDigits: 0 }),
      }),
      left + nameW + 10,
      cy + 4,
      250,
    );
  }
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

function drawStatColumn(
  ctx: CanvasRenderingContext2D,
  stats: PlayerCardStat[],
  x: number,
  y: number,
  w: number,
): void {
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

function drawFooter(
  ctx: CanvasRenderingContext2D,
  data: PlayerCardData,
  logo: HTMLImageElement | null,
): void {
  const y = CARD_H - 26;
  // Brand mark: the full logo lockup, else a plain text wordmark, top-right now
  // (swapped with the holder badge, which moved to the bottom-left). Right-aligned
  // against the card's right margin, above the stats panel.
  if (logo && logo.width > 0) {
    const h = 104;
    const w = (logo.width / logo.height) * h;
    ctx.drawImage(logo, 1156 - w, 38, w, h);
  } else {
    ctx.textAlign = 'right';
    ctx.fillStyle = COL.gold;
    ctx.font = `700 34px ${TITLE_FONT}`;
    ctx.fillText(t('playerCard.brandWordmark'), 1156, 100);
    ctx.textAlign = 'left';
  }

  // Referral line stays bottom-right; URL clamp trimmed so it clears the badge
  // block now occupying the bottom-left.
  ctx.textAlign = 'right';
  ctx.fillStyle = COL.cream;
  ctx.font = `600 19px ${BODY_FONT}`;
  const referralLine = data.referralCount
    ? t('playerCard.footerHandleWithRecruits', {
        handle: data.referralHandle,
        recruited: t('playerCard.recruited', {
          count: formatNumber(data.referralCount, { maximumFractionDigits: 0 }),
        }),
      })
    : t('playerCard.footerHandle', { handle: data.referralHandle });
  ctx.fillText(referralLine, 1168, y - 22);
  ctx.fillStyle = COL.goldDim;
  ctx.font = `400 16px ${BODY_FONT}`;
  fillTextClamped(ctx, t('playerCard.footerCta', { siteUrl: data.siteUrl }), 1168, y, 360);
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

function canvasToPngBlob(canvas: HTMLCanvasElement, context: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`player-card: ${context} canvas.toBlob returned null`));
    }, 'image/png');
  });
}

/** Export a composited card canvas to a PNG blob. */
export function cardCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return canvasToPngBlob(canvas, 'export');
}

/** Export the public hosted card at Open Graph size instead of the 2x preview size. */
export function cardCanvasToUploadBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (canvas.width === CARD_W && canvas.height === CARD_H) {
    return cardCanvasToBlob(canvas);
  }

  const uploadCanvas = document.createElement('canvas');
  uploadCanvas.width = CARD_W;
  uploadCanvas.height = CARD_H;
  const ctx = uploadCanvas.getContext('2d');
  if (!ctx) throw new Error('player-card: could not create upload canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, CARD_W, CARD_H);
  return canvasToPngBlob(uploadCanvas, 'upload');
}
