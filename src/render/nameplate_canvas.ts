import { TextSpriteCache, type TextSpriteStyle } from '../ui/text_sprite_cache';

export type NameplateFrame = '' | 'elite' | 'boss';
export type NameplateMarkerTone = 'none' | 'quest' | 'active' | 'loot' | 'repeat' | 'cooldown';

export interface NameplateBadge {
  url: string;
  size: number;
  circular?: boolean;
  border?: string;
  glow?: string;
}

export interface NameplateCanvasState {
  initialized: boolean;
  name: string;
  nameColor: string;
  level: string;
  levelColor: string;
  guild: string;
  title: string;
  marker: string;
  markerTone: NameplateMarkerTone;
  hpVisible: boolean;
  hpFill: number;
  castVisible: boolean;
  castFill: number;
  castChannel: boolean;
  castSource: string;
  castLabel: string;
  currentTarget: boolean;
  hostile: boolean;
  deadEnemy: boolean;
  myPet: boolean;
  friendlyPet: boolean;
  threat: boolean;
  opacity: number;
  frame: NameplateFrame;
  comboPips: number;
  aiLabel: string;
  devOutline: string | null;
  badges: NameplateBadge[];
  raidMarkerUrl: string;
  emoteIconUrl: string;
  emoteLabel: string;
}

export function createNameplateCanvasState(): NameplateCanvasState {
  return {
    initialized: false,
    name: '',
    nameColor: '#fff',
    level: '',
    levelColor: '#fff',
    guild: '',
    title: '',
    marker: '',
    markerTone: 'none',
    hpVisible: false,
    hpFill: 1,
    castVisible: false,
    castFill: 0,
    castChannel: false,
    castSource: '',
    castLabel: '',
    currentTarget: false,
    hostile: false,
    deadEnemy: false,
    myPet: false,
    friendlyPet: false,
    threat: false,
    opacity: 1,
    frame: '',
    comboPips: 0,
    aiLabel: '',
    devOutline: null,
    badges: [],
    raidMarkerUrl: '',
    emoteIconUrl: '',
    emoteLabel: '',
  };
}

export const NAMEPLATE_BASE_WIDTH = 80;
export const NAMEPLATE_BOSS_WIDTH = 100;
export const NAMEPLATE_MARKER_ROW_HEIGHT = 26;
export const NAMEPLATE_MAX_PIXEL_RATIO = 2;
// Nameplate labels scale their backing stores with DPR. The count remains a
// secondary guard, while the 16 MiB RGBA budget is the hard memory ceiling.
// At DPR 2 a representative 126x43 logical label retains about 85 KiB, so the
// byte budget holds roughly 190 such labels rather than the old 129 MiB worst
// case from a 1536-entry count alone.
export const NAMEPLATE_TEXT_SPRITE_LIMIT = 512;
export const NAMEPLATE_TEXT_SPRITE_BUDGET_BYTES = 16 * 1024 * 1024;
export const NAMEPLATE_IMAGE_CACHE_LIMIT = 160;
export const NAMEPLATE_IMAGE_RETRY_BASE_FRAMES = 30;
const NAMEPLATE_IMAGE_RETRY_MAX_FRAMES = 600;

const TITLE_FONT = 'Cinzel, Georgia, serif';
const NAME_STYLE: TextSpriteStyle = {
  font: `700 12px ${TITLE_FONT}`,
  fill: '#fff',
  stroke: '#000',
  lineWidth: 3,
};
const TARGET_NAME_STYLE: TextSpriteStyle = {
  font: `700 14px ${TITLE_FONT}`,
  fill: '#fff',
  stroke: '#000',
  lineWidth: 3,
};
const LEVEL_STYLE: TextSpriteStyle = {
  font: `700 19px ${TITLE_FONT}`,
  fill: '#fff',
  stroke: '#000',
  lineWidth: 3,
};
const AI_STYLE: TextSpriteStyle = {
  font: `700 11px ${TITLE_FONT}`,
  fill: '#7de9c3',
  stroke: '#000',
  lineWidth: 2,
};
const TITLE_STYLE: TextSpriteStyle = {
  font: `italic 10px ${TITLE_FONT}`,
  fill: '#ffe9a0',
  stroke: '#000',
  lineWidth: 2,
};
const GUILD_STYLE: TextSpriteStyle = {
  font: `700 11px ${TITLE_FONT}`,
  fill: '#c9dcfb',
  stroke: '#000',
  lineWidth: 2,
};
const TARGET_GUILD_STYLE: TextSpriteStyle = {
  font: `700 13px ${TITLE_FONT}`,
  fill: '#c9dcfb',
  stroke: '#000',
  lineWidth: 2,
};
const MARKER_STYLE: TextSpriteStyle = {
  font: `700 24px ${TITLE_FONT}`,
  fill: '#f2c84b',
  stroke: '#000',
  lineWidth: 2,
};
const LOOT_STYLE: TextSpriteStyle = {
  font: `700 14px ${TITLE_FONT}`,
  fill: '#f2c84b',
  stroke: '#000',
  lineWidth: 2,
};
const CAST_STYLE: TextSpriteStyle = {
  font: '700 9px Arial, sans-serif',
  fill: '#fff',
  stroke: '#000',
  lineWidth: 1,
};
const EMOTE_STYLE: TextSpriteStyle = {
  font: `800 11px ${TITLE_FONT}`,
  fill: '#ffe9a3',
  stroke: '#000',
  lineWidth: 1,
};

interface CachedImage {
  image: HTMLImageElement;
  status: 'loading' | 'ready' | 'failed';
  failures: number;
  retryFrame: number;
}

class NameplateImageCache {
  private readonly entries = new Map<string, CachedImage>();
  private frame = 0;

  beginFrame(): void {
    this.frame++;
  }

  get(url: string): HTMLImageElement | null {
    if (!url) return null;
    let entry = this.entries.get(url);
    if (!entry) {
      entry = this.load(url, 0);
      this.entries.set(url, entry);
      this.trim();
    } else if (entry.status === 'failed' && this.frame >= entry.retryFrame) {
      entry = this.load(url, entry.failures);
      this.entries.set(url, entry);
    }
    // Map insertion order is the LRU order. Every hit moves to the back, so a
    // live working set above the cap evicts the least recently used URL even
    // when every entry was touched in this frame.
    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry.status === 'ready' ? entry.image : null;
  }

  private load(url: string, failures: number): CachedImage {
    const image = document.createElement('img');
    const entry: CachedImage = {
      image,
      status: 'loading',
      failures,
      retryFrame: this.frame,
    };
    image.addEventListener('load', () => {
      if (this.entries.get(url) !== entry) return;
      entry.status = 'ready';
      entry.failures = 0;
    });
    image.addEventListener('error', () => {
      if (this.entries.get(url) !== entry) return;
      entry.status = 'failed';
      entry.failures++;
      const delay = Math.min(
        NAMEPLATE_IMAGE_RETRY_MAX_FRAMES,
        NAMEPLATE_IMAGE_RETRY_BASE_FRAMES * 2 ** Math.min(5, entry.failures - 1),
      );
      entry.retryFrame = this.frame + delay;
    });
    image.referrerPolicy = 'no-referrer';
    image.src = url;
    if (image.complete && image.naturalWidth > 0) entry.status = 'ready';
    return entry;
  }

  private trim(): void {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= NAMEPLATE_IMAGE_CACHE_LIMIT) return;
      this.entries.delete(key);
    }
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export class NameplateCanvasSurface {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly text = new TextSpriteCache(
    NAMEPLATE_TEXT_SPRITE_LIMIT,
    NAMEPLATE_TEXT_SPRITE_BUDGET_BYTES,
  );
  private readonly images = new NameplateImageCache();
  private readonly forcedColorsMql: MediaQueryList | null;
  private readonly nameStyle: TextSpriteStyle = { ...NAME_STYLE };
  private readonly targetNameStyle: TextSpriteStyle = { ...TARGET_NAME_STYLE };
  private readonly devNameStyle: TextSpriteStyle = { ...NAME_STYLE };
  private readonly targetDevNameStyle: TextSpriteStyle = { ...TARGET_NAME_STYLE };
  private readonly levelStyle: TextSpriteStyle = { ...LEVEL_STYLE };
  private readonly aiStyle: TextSpriteStyle = { ...AI_STYLE };
  private readonly titleStyle: TextSpriteStyle = { ...TITLE_STYLE };
  private readonly guildStyle: TextSpriteStyle = { ...GUILD_STYLE };
  private readonly targetGuildStyle: TextSpriteStyle = { ...TARGET_GUILD_STYLE };
  private readonly markerStyle: TextSpriteStyle = { ...MARKER_STYLE };
  private readonly lootStyle: TextSpriteStyle = { ...LOOT_STYLE };
  private readonly castStyle: TextSpriteStyle = { ...CAST_STYLE };
  private readonly emoteStyle: TextSpriteStyle = { ...EMOTE_STYLE };
  private width = 0;
  private height = 0;

  constructor(parent: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.className = 'nameplate-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '1';
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Nameplate canvas requires a 2D context');
    this.canvas = canvas;
    this.ctx = ctx;
    this.forcedColorsMql =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(forced-colors: active)')
        : null;
    parent.appendChild(canvas);
    if (document.fonts) {
      void document.fonts.ready.then(() => this.text.clear());
      document.fonts.addEventListener('loadingdone', this.handleFontsLoaded);
    }
  }

  beginFrame(width: number, height: number, devicePixelRatio: number): void {
    const pixelRatio = Math.max(1, Math.min(NAMEPLATE_MAX_PIXEL_RATIO, devicePixelRatio || 1));
    const backingWidth = Math.max(1, Math.ceil(width * pixelRatio));
    const backingHeight = Math.max(1, Math.ceil(height * pixelRatio));
    if (
      this.canvas.width !== backingWidth ||
      this.canvas.height !== backingHeight ||
      this.width !== width ||
      this.height !== height
    ) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.width = width;
      this.height = height;
    }
    this.text.setPixelRatio(pixelRatio);
    this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.imageSmoothingEnabled = true;
    this.text.beginRedraw();
    this.images.beginFrame();
  }

  clearTextCache(): void {
    this.text.clear();
  }

  drawBase(state: NameplateCanvasState, screenX: number, screenY: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = state.opacity;
    let y = screenY;

    if (state.castVisible) {
      y -= 10;
      this.drawCast(state, screenX, y);
    }
    if (state.hpVisible) {
      y -= 7;
      this.drawHealth(state, screenX, y);
    }
    if (state.guild) {
      y -= state.currentTarget ? 14 : 12;
      const guildStyle = state.currentTarget ? this.targetGuildStyle : this.guildStyle;
      this.text.draw(
        ctx,
        `<${state.guild}>`,
        screenX,
        y + (state.currentTarget ? 11 : 10),
        this.configureTextStyle(guildStyle, GUILD_STYLE.fill),
      );
    }
    if (state.title) {
      y -= 11;
      this.text.draw(
        ctx,
        state.title,
        screenX,
        y + 9,
        this.configureTextStyle(this.titleStyle, TITLE_STYLE.fill),
      );
    }

    const rowHeight = this.drawNameRow(state, screenX, y);
    y -= rowHeight;
    y -= NAMEPLATE_MARKER_ROW_HEIGHT;
    if (state.marker) {
      const style = state.markerTone === 'loot' ? this.lootStyle : this.markerStyle;
      // The glyph channel's cross-surface color contract (pinned by
      // quest_marker_styles): gold for the first-offer '!' and ready '?',
      // gray for the in-progress '?', and the rare-item blue for the
      // repeatable arms, with the cooldown mark dimmed at the shared 0.55.
      this.configureTextStyle(
        style,
        state.markerTone === 'active'
          ? '#b9b9b9'
          : state.markerTone === 'repeat' || state.markerTone === 'cooldown'
            ? '#0070dd'
            : '#f2c84b',
      );
      const dimmed = state.markerTone === 'cooldown';
      if (dimmed) ctx.globalAlpha = state.opacity * 0.55;
      this.text.draw(ctx, state.marker, screenX, y + 21, style);
      // Forced colors collapses gold and blue to one CanvasText, so the two
      // offers would read identically (the failure class the DOM plates'
      // forced-colors rule closed). Underline the repeat mark as the
      // redundant non-color cue, dotted for the cooldown mark so the dimmed
      // not-yet state stays distinguishable too.
      if (
        this.forcedColorsActive() &&
        (state.markerTone === 'repeat' || state.markerTone === 'cooldown')
      ) {
        const half = this.text.measureAdvance(state.marker, style) / 2;
        ctx.beginPath();
        if (dimmed) ctx.setLineDash([2, 2]);
        ctx.moveTo(screenX - half, y + 24);
        ctx.lineTo(screenX + half, y + 24);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'CanvasText';
        ctx.stroke();
        if (dimmed) ctx.setLineDash([]);
      }
      if (dimmed) ctx.globalAlpha = state.opacity;
    }
    if (state.comboPips > 0) {
      y -= 9;
      this.drawCombo(state.comboPips, screenX, y);
    }
    if (state.raidMarkerUrl) {
      y -= 31;
      this.drawImage(state.raidMarkerUrl, screenX - 15, y, 30, false);
    }
    ctx.restore();
  }

  drawEmote(state: NameplateCanvasState, screenX: number, screenY: number): void {
    if (!state.emoteIconUrl || !state.emoteLabel) return;
    let y = screenY;
    if (state.castVisible) y -= 10;
    if (state.hpVisible) y -= 7;
    if (state.guild) y -= state.currentTarget ? 14 : 12;
    if (state.title) y -= 11;
    y -= this.nameRowHeight(state);
    y -= NAMEPLATE_MARKER_ROW_HEIGHT;
    if (state.comboPips > 0) y -= 9;
    if (state.raidMarkerUrl) y -= 31;
    y -= 47;

    const emoteStyle = this.configureTextStyle(this.emoteStyle, EMOTE_STYLE.fill);
    const labelWidth = Math.min(56, this.text.measureAdvance(state.emoteLabel, emoteStyle));
    const width = Math.max(62, 49 + labelWidth);
    const x = screenX - width / 2;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = state.opacity;
    ctx.shadowColor = this.forcedColorsActive() ? 'transparent' : '#ffd65a66';
    ctx.shadowBlur = this.forcedColorsActive() ? 0 : 12;
    roundedRect(ctx, x, y, width, 42, 21);
    ctx.fillStyle = this.forcedColorsActive() ? 'Canvas' : '#20160d';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.forcedColorsActive() ? 'CanvasText' : '#f2d27a';
    ctx.stroke();
    this.drawImage(state.emoteIconUrl, x + 4, y + 4, 34, false);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 43, y, Math.max(1, width - 47), 42);
    ctx.clip();
    this.text.draw(ctx, state.emoteLabel, x + 43 + labelWidth / 2, y + 26, emoteStyle);
    ctx.restore();
    ctx.restore();
  }

  dispose(): void {
    document.fonts?.removeEventListener('loadingdone', this.handleFontsLoaded);
    this.canvas.remove();
  }

  private readonly handleFontsLoaded = (): void => {
    this.text.clear();
  };

  private nameRowHeight(state: NameplateCanvasState): number {
    let height = state.currentTarget ? 18 : 16;
    for (const badge of state.badges) height = Math.max(height, badge.size);
    return height;
  }

  private drawNameRow(state: NameplateCanvasState, screenX: number, bottomY: number): number {
    const rowHeight = this.nameRowHeight(state);
    const nameStyle = state.currentTarget ? this.targetNameStyle : this.nameStyle;
    const nameColor = state.deadEnemy ? '#bbb' : state.hostile ? '#ff5555' : state.nameColor;
    this.configureTextStyle(nameStyle, nameColor);
    this.configureTextStyle(this.levelStyle, state.levelColor);
    this.configureTextStyle(this.aiStyle, AI_STYLE.fill);
    const nameWidth = this.text.measureAdvance(state.name, nameStyle);
    const levelWidth = state.level ? this.text.measureAdvance(state.level, this.levelStyle) + 6 : 0;
    const aiWidth = state.aiLabel ? this.text.measureAdvance(state.aiLabel, this.aiStyle) + 3 : 0;
    let badgeWidth = 0;
    for (const badge of state.badges) badgeWidth += badge.size + 3;
    const rowWidth = badgeWidth + aiWidth + levelWidth + nameWidth;
    let x = screenX - rowWidth / 2;
    const topY = bottomY - rowHeight;
    for (const badge of state.badges) {
      this.drawBadge(badge, x, topY + (rowHeight - badge.size) / 2);
      x += badge.size + 3;
    }
    if (state.aiLabel) {
      const width = aiWidth - 3;
      this.text.draw(this.ctx, state.aiLabel, x + width / 2, bottomY - 3, this.aiStyle);
      x += aiWidth;
    }
    if (state.level) {
      const width = levelWidth - 6;
      this.text.draw(this.ctx, state.level, x + width / 2, bottomY - 2, this.levelStyle);
      x += levelWidth;
    }
    const nameX = x + nameWidth / 2;
    if (state.devOutline) {
      const devStyle = state.currentTarget ? this.targetDevNameStyle : this.devNameStyle;
      devStyle.fill = nameStyle.fill;
      devStyle.stroke = this.forcedColorsActive() ? 'Highlight' : state.devOutline;
      devStyle.lineWidth = 4;
      this.text.draw(this.ctx, state.name, nameX, bottomY - 3, devStyle);
    }
    this.text.draw(this.ctx, state.name, nameX, bottomY - 3, nameStyle);
    return rowHeight;
  }

  private drawHealth(state: NameplateCanvasState, centerX: number, y: number): void {
    const ctx = this.ctx;
    const forcedColors = this.forcedColorsActive();
    const width = state.frame === 'boss' ? NAMEPLATE_BOSS_WIDTH : NAMEPLATE_BASE_WIDTH;
    const x = centerX - width / 2;
    if (state.threat) {
      ctx.save();
      ctx.shadowColor = forcedColors ? 'CanvasText' : '#c0392b';
      ctx.shadowBlur = 8;
      ctx.fillStyle = forcedColors ? 'Canvas' : '#2a0000';
      roundedRect(ctx, x, y, width, 4, 2);
      ctx.fill();
      ctx.restore();
    }
    roundedRect(ctx, x, y, width, 4, 2);
    ctx.fillStyle = forcedColors ? 'Canvas' : '#2a0000';
    ctx.fill();
    const fill = Math.max(0, Math.min(1, state.hpFill));
    if (fill > 0) {
      roundedRect(ctx, x, y, width * fill, 4, 2);
      ctx.fillStyle = forcedColors
        ? 'Highlight'
        : state.threat
          ? '#d93632'
          : state.myPet
            ? '#4080ff'
            : state.friendlyPet
              ? '#76b653'
              : state.hostile
                ? '#e12c2c'
                : '#2dab46';
      ctx.fill();
    }
    ctx.lineWidth = state.frame === 'boss' ? 2 : 1;
    ctx.strokeStyle = forcedColors
      ? 'CanvasText'
      : state.frame === 'boss'
        ? '#ff5555'
        : state.frame === 'elite'
          ? '#f2c84b'
          : state.currentTarget
            ? '#ffffffaa'
            : state.hostile
              ? '#2e0000'
              : '#00000088';
    roundedRect(ctx, x, y, width, 4, 2);
    ctx.stroke();
  }

  private drawCast(state: NameplateCanvasState, centerX: number, y: number): void {
    const ctx = this.ctx;
    const forcedColors = this.forcedColorsActive();
    const width = NAMEPLATE_BASE_WIDTH;
    const x = centerX - width / 2;
    roundedRect(ctx, x, y, width, 8, 2);
    ctx.fillStyle = forcedColors ? 'Canvas' : '#1a1205';
    ctx.fill();
    const fill = Math.max(0, Math.min(1, state.castFill));
    if (fill > 0) {
      roundedRect(ctx, x + 1, y + 1, Math.max(1, (width - 2) * fill), 6, 1);
      ctx.fillStyle = forcedColors ? 'Highlight' : state.castChannel ? '#48a4e8' : '#e4ac2c';
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = forcedColors ? 'CanvasText' : '#000';
    roundedRect(ctx, x, y, width, 8, 2);
    ctx.stroke();
    this.text.draw(
      this.ctx,
      state.castLabel,
      centerX,
      y + 7,
      this.configureTextStyle(this.castStyle, CAST_STYLE.fill),
    );
  }

  private drawCombo(count: number, centerX: number, y: number): void {
    const forcedColors = this.forcedColorsActive();
    const total = 5 * 7 + 4 * 3;
    let x = centerX - total / 2;
    for (let i = 0; i < 5; i++) {
      this.ctx.beginPath();
      this.ctx.arc(x + 3.5, y + 3.5, 3.5, 0, Math.PI * 2);
      this.ctx.fillStyle = forcedColors
        ? i < count
          ? 'Highlight'
          : 'Canvas'
        : i < count
          ? '#e8453a'
          : '#3a1010';
      this.ctx.fill();
      this.ctx.lineWidth = 1;
      this.ctx.strokeStyle = forcedColors ? 'CanvasText' : i < count ? '#5a0c08' : '#000';
      this.ctx.stroke();
      x += 10;
    }
  }

  private drawBadge(badge: NameplateBadge, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.save();
    if (badge.glow) {
      ctx.shadowColor = badge.glow;
      ctx.shadowBlur = 5;
    }
    if (badge.circular) {
      ctx.beginPath();
      ctx.arc(x + badge.size / 2, y + badge.size / 2, badge.size / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    this.drawImage(badge.url, x, y, badge.size, false);
    ctx.restore();
    if (badge.circular && badge.border) {
      ctx.beginPath();
      ctx.arc(x + badge.size / 2, y + badge.size / 2, badge.size / 2 - 0.75, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = this.forcedColorsActive() ? 'CanvasText' : badge.border;
      ctx.stroke();
    }
  }

  private drawImage(url: string, x: number, y: number, size: number, circular: boolean): void {
    const image = this.images.get(url);
    if (!image) return;
    if (!circular) {
      this.ctx.drawImage(image, x, y, size, size);
      return;
    }
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    this.ctx.clip();
    this.ctx.drawImage(image, x, y, size, size);
    this.ctx.restore();
  }

  private configureTextStyle(style: TextSpriteStyle, fill: string): TextSpriteStyle {
    style.fill = this.forcedColorsActive() ? 'CanvasText' : fill;
    style.stroke = this.forcedColorsActive() ? 'Canvas' : '#000';
    return style;
  }

  private forcedColorsActive(): boolean {
    return this.forcedColorsMql?.matches === true;
  }
}
