// The raid atlas's controller: the illustrated M-map of a raid (the Smith's
// Heart in this pilot), shown in the world map window in place of the plain
// floor plan. It owns its own canvas (DPR-sharp, laid over the shared map
// canvas, which hides while the atlas shows), its chrome (page tabs, zoom
// buttons, the pin tool, the pin editor, the legend), its input (wheel zoom
// about the cursor, drag pan, pinch, double-click, keys, right-click pins) and
// the player's pins (persisted per character and raid, storage wrapped).
//
// Hud never learns any of this: InteriorMapController routes the plan paint
// here (`show`), forwards the frame tick (`tick`) and the minimap paint. The
// atlas is ACTIVE only between a `show` and the moment the map window closes
// or switches to another level (`host.planShown()` false), which `tick` notices
// and stands the atlas down on.
//
// The pure decisions live in the cores (plan, camera, pins, view); the art in
// the painters. This module is the DOM adapter.

import type { IWorld } from '../../../world_api';
import { canvasDpr } from '../../canvas_dpr';
import { dungeonTitleWithDifficulty } from '../../dungeon_map_painter';
import { mobDisplayName } from '../../entity_display_core';
import { formatNumber, t } from '../../i18n';
import {
  fromPage,
  pageSpan,
  pageToScreen,
  RAID_ATLAS_BUTTON_STEP,
  RaidAtlasCamera,
  screenToPage,
  toPage,
  wheelZoomFactor,
} from './raid_atlas_camera_core';
import {
  drawBossMedallion,
  drawMember,
  drawPin,
  drawPlayerArrow,
  drawPoi,
  pinIconPath,
} from './raid_atlas_glyph_painter';
import { RaidAtlasPainter } from './raid_atlas_painter';
import type { RaidAtlasColors } from './raid_atlas_palette_core';
import {
  addPin,
  DEFAULT_PIN_STYLE,
  parsePins,
  pinAtScreen,
  RAID_ATLAS_PIN_COLORS,
  RAID_ATLAS_PIN_ICONS,
  type RaidAtlasPin,
  type RaidAtlasPinColor,
  type RaidAtlasPinIcon,
  type RaidAtlasPinStyle,
  raidAtlasPinKey,
  removePin,
  restylePin,
  serializePins,
} from './raid_atlas_pins_core';
import {
  type RaidAtlasFloorId,
  type RaidAtlasPlan,
  raidAtlasFloor,
  raidAtlasPlanFor,
} from './raid_atlas_plan_core';
import { buildRaidAtlasFrame, defaultRaidAtlasFloor } from './raid_atlas_view';

/** What the atlas asks of its host (Hud, through InteriorMapController). */
export interface RaidAtlasHost {
  /** The world map window is open on the instance plan level. */
  planShown(): boolean;
  classColor(cls: string): string;
}

/** Where the plan was painted from: the instance origin and the dungeon. */
export interface RaidAtlasAnchor {
  dungeonId: string;
  originX: number;
  originZ: number;
  contains(x: number, z: number): boolean;
}

const TAP_TOLERANCE_PX = 8;
const PIN_HIT_PX = 15;
const PIN_LIFT_PX = 27;
const STORE_STYLE_KEY = 'woc.raidAtlas.pinStyle';
const MAX_DPR = 2.5;
const KEY_PAN_PX = 60;
/** The live layer's own repaint pace while nothing moves (ms). */
const LIVE_REPAINT_MS = 120;

interface PointerTrack {
  x: number;
  y: number;
  startX: number;
  startY: number;
  type: string;
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked or full: the pins live for this session only */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  parent?.appendChild(node);
  return node;
}

function button(cls: string, labelKey: string, parent: HTMLElement): HTMLButtonElement {
  const b = el('button', `ui-btn raid-atlas-btn ${cls}`, parent);
  b.type = 'button';
  const label = t(labelKey as never);
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}

export class RaidAtlasController {
  private readonly painter = new RaidAtlasPainter();
  private readonly camera = new RaidAtlasCamera();
  private plan: RaidAtlasPlan | null = null;
  private anchor: RaidAtlasAnchor | null = null;
  private world: IWorld | null = null;
  private floorId: RaidAtlasFloorId = 'veins';
  private lastPlayerFloor: RaidAtlasFloorId | null = null;
  private active = false;
  private pins: RaidAtlasPin[] = [];
  private pinsKey = '';
  private style: RaidAtlasPinStyle = { ...DEFAULT_PIN_STYLE };
  private pinMode = false;
  private selectedPin: number | null = null;
  private side = 560;
  private dpr = 1;
  private lastTick = 0;
  private lastPaint = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastFacing = Number.NaN;
  private prewarmed = 0;
  private lastPointerType = 'mouse';
  private readonly pointers = new Map<number, PointerTrack>();
  private pinchDist = 0;
  private pinchMid = { x: 0, y: 0 };
  private dragged = false;
  private rectScale = 1;
  private rectLeft = 0;
  private rectTop = 0;

  // DOM (built once, on the first show).
  private win: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private floorTabs = new Map<RaidAtlasFloorId, HTMLButtonElement>();
  private zoomInBtn: HTMLButtonElement | null = null;
  private zoomOutBtn: HTMLButtonElement | null = null;
  private pinToolBtn: HTMLButtonElement | null = null;
  private styleBtn: HTMLButtonElement | null = null;
  private styleSwatch: HTMLCanvasElement | null = null;
  private editor: HTMLElement | null = null;
  private editorTitle: HTMLElement | null = null;
  private editorRemove: HTMLButtonElement | null = null;
  private editorIcons = new Map<RaidAtlasPinIcon, HTMLButtonElement>();
  private editorColors = new Map<RaidAtlasPinColor, HTMLButtonElement>();
  private legend: HTMLElement | null = null;
  private legendBtn: HTMLButtonElement | null = null;
  private toast: HTMLElement | null = null;

  constructor(private readonly host: RaidAtlasHost) {
    const saved = parseStyle(storageGet(STORE_STYLE_KEY));
    if (saved) this.style = saved;
  }

  /** True while the atlas owns the map window's plan. */
  isActive(): boolean {
    return this.active;
  }

  /**
   * The map window painted the instance plan of a raid with an atlas: show the
   * atlas (building its DOM the first time) and paint it. Returns the title
   * the window's summary reads, or null when the raid has no atlas.
   */
  show(shared: HTMLCanvasElement, world: IWorld, anchor: RaidAtlasAnchor): string | null {
    const plan = raidAtlasPlanFor(anchor.dungeonId);
    if (!plan) return null;
    this.world = world;
    if (!this.canvas) this.build(shared);
    const fresh =
      !this.active ||
      this.plan !== plan ||
      this.anchor?.originX !== anchor.originX ||
      this.anchor?.originZ !== anchor.originZ;
    this.plan = plan;
    this.anchor = anchor;
    if (fresh) this.enter(world);
    this.paint();
    return dungeonTitleWithDifficulty(plan.dungeonId, world);
  }

  /** Stand down (the map left the plan, or the instance has no atlas). */
  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.pointers.clear();
    this.pinMode = false;
    this.closeEditor();
    this.canvas?.classList.remove('is-grabbing');
    this.syncChrome();
    this.win?.classList.remove('raid-atlas-on');
  }

  /** The HUD's frame tick: glide the camera and repaint the live layer. */
  tick(world: IWorld): void {
    if (!this.active) return;
    if (!this.host.planShown() || this.win?.style.display !== 'block') {
      this.hide();
      return;
    }
    this.world = world;
    // Repaint only when something moved: a glide, a finger down, the player
    // stepping or turning; otherwise at the live layer's own pace (members,
    // boss states, the engaged pulse).
    const now = performance.now();
    const p = world.player;
    const moved =
      Math.abs(p.pos.x - this.lastX) > 0.05 ||
      Math.abs(p.pos.z - this.lastZ) > 0.05 ||
      Math.abs(p.facing - this.lastFacing) > 0.002;
    if (
      !moved &&
      !this.camera.gliding() &&
      this.pointers.size === 0 &&
      now - this.lastPaint < LIVE_REPAINT_MS
    )
      return;
    this.paint();
  }

  /** The minimap's pins (drawn over the dungeon minimap, inside its rim). */
  paintMinimapPins(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    anchor: RaidAtlasAnchor,
    size: number,
    pxPerYard: number,
  ): void {
    const plan = raidAtlasPlanFor(anchor.dungeonId);
    if (!plan) return;
    // Warm one page's plate per minimap paint after entering the raid, so the
    // first M never pays for it.
    if (this.prewarmed < plan.floors.length) {
      this.painter.prewarm(plan, plan.floors[this.prewarmed]);
      if (this.painter.resolvedColors()) this.prewarmed++;
    }
    const pins = this.pinsFor(world, anchor.dungeonId);
    if (pins.length === 0) return;
    const lx = world.player.pos.x - anchor.originX;
    const lz = world.player.pos.z - anchor.originZ;
    this.painter.paintMinimapPins(ctx, pins, lx, lz, size, pxPerYard);
  }

  // ---- lifecycle -----------------------------------------------------------------------

  private enter(world: IWorld): void {
    const plan = this.plan;
    const anchor = this.anchor;
    if (!plan || !anchor) return;
    this.active = true;
    this.win?.classList.add('raid-atlas-on');
    this.pins = this.pinsFor(world, plan.dungeonId);
    const frame = buildRaidAtlasFrame(world, plan, anchor);
    this.setFloor(defaultRaidAtlasFloor(frame), false);
    this.lastPlayerFloor = frame.playerFloor;
    this.lastTick = performance.now();
    this.syncChrome();
  }

  private pinsFor(world: IWorld, dungeonId: string): RaidAtlasPin[] {
    const key = raidAtlasPinKey(dungeonId, world.player.name || String(world.player.id));
    if (key !== this.pinsKey) {
      this.pinsKey = key;
      this.pins = parsePins(storageGet(key));
    }
    return this.pins;
  }

  private savePins(): void {
    if (this.pinsKey) storageSet(this.pinsKey, serializePins(this.pins));
  }

  private setFloor(id: RaidAtlasFloorId, glide: boolean): void {
    const plan = this.plan;
    if (!plan) return;
    const changed = id !== this.floorId;
    this.floorId = id;
    if (changed || !glide) this.camera.setPage(pageSpan(raidAtlasFloor(plan, id).bounds));
    this.selectedPin = null;
    this.closeEditor();
    this.syncChrome();
  }

  // ---- paint ---------------------------------------------------------------------------

  private paint(): void {
    const plan = this.plan;
    const anchor = this.anchor;
    const world = this.world;
    const ctx = this.ctx;
    if (!plan || !anchor || !world || !ctx || !this.active) return;
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    this.lastPaint = now;
    this.lastX = world.player.pos.x;
    this.lastZ = world.player.pos.z;
    this.lastFacing = world.player.facing;
    const gliding = this.camera.step(dt);
    const frame = buildRaidAtlasFrame(world, plan, anchor);
    // Follow the player across pages (a portal hop) unless they chose a page.
    if (frame.playerFloor && frame.playerFloor !== this.lastPlayerFloor) {
      this.lastPlayerFloor = frame.playerFloor;
      if (frame.playerFloor !== this.floorId) this.setFloor(frame.playerFloor, false);
    }
    const floor = raidAtlasFloor(plan, this.floorId);
    const floorName = t(floor.labelKey as never);
    this.painter.paint(ctx, {
      plan,
      floor,
      view: this.camera.current,
      side: this.side,
      dpr: this.dpr,
      frame,
      pins: this.pins,
      selectedPin: this.selectedPin,
      settled: !gliding && this.pointers.size === 0,
      title: dungeonTitleWithDifficulty(plan.dungeonId, world),
      subtitle: t('hudChrome.raidAtlas.subtitle', {
        floor: floorName,
        defeated: formatNumber(frame.defeated),
        total: formatNumber(plan.bosses.length),
      }),
      bossName: mobDisplayName,
      classColor: this.host.classColor,
      clock: now / 1000,
    });
    this.syncZoomButtons();
    this.syncYouAreHere(frame.playerFloor);
  }

  // ---- DOM -----------------------------------------------------------------------------

  private build(shared: HTMLCanvasElement): void {
    this.win = shared.closest<HTMLElement>('#map-window');
    const stage = shared.parentElement;
    if (!stage) return;
    const canvas = el('canvas', 'raid-atlas-canvas', stage);
    canvas.id = 'raid-atlas-canvas';
    canvas.width = 560;
    canvas.height = 560;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t('hudChrome.raidAtlas.canvasAria'));
    canvas.setAttribute('aria-describedby', 'map-summary map-marker-summary');
    stage.insertBefore(canvas, shared.nextSibling);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const chrome = el('div', 'raid-atlas-chrome', stage);

    // Page tabs.
    const floors = el('div', 'raid-atlas-floors', chrome);
    floors.setAttribute('role', 'group');
    floors.setAttribute('aria-label', t('hudChrome.raidAtlas.floorsAria'));
    for (const id of ['veins', 'heart'] as const) {
      const b = button('raid-atlas-floor', `hudChrome.raidAtlas.floor.${id}`, floors);
      const label = el('span', 'raid-atlas-floor-label', b);
      label.textContent = t(`hudChrome.raidAtlas.floor.${id}`);
      const here = el('span', 'raid-atlas-here', b);
      here.title = t('hudChrome.raidAtlas.youAreHere');
      b.addEventListener('click', () => {
        this.setFloor(id, true);
        this.paint();
      });
      this.floorTabs.set(id, b);
    }

    // Zoom cluster.
    const zoom = el('div', 'raid-atlas-zoom', chrome);
    this.zoomInBtn = button('raid-atlas-zoom-in', 'hudChrome.raidAtlas.zoomIn', zoom);
    this.zoomInBtn.textContent = '+';
    this.zoomOutBtn = button('raid-atlas-zoom-out', 'hudChrome.raidAtlas.zoomOut', zoom);
    this.zoomOutBtn.textContent = '−';
    const reset = button('raid-atlas-reset', 'hudChrome.raidAtlas.reset', zoom);
    reset.dataset.icon = 'reset';
    el('span', 'raid-atlas-reset-glyph', reset);
    this.zoomInBtn.addEventListener('click', () => this.zoomButton(RAID_ATLAS_BUTTON_STEP));
    this.zoomOutBtn.addEventListener('click', () => this.zoomButton(1 / RAID_ATLAS_BUTTON_STEP));
    reset.addEventListener('click', () => {
      this.camera.reset();
      this.paint();
    });

    // Pin tools.
    const tools = el('div', 'raid-atlas-tools', chrome);
    this.pinToolBtn = button('raid-atlas-pin-tool', 'hudChrome.raidAtlas.pinTool', tools);
    this.pinToolBtn.setAttribute('aria-pressed', 'false');
    const toolGlyph = el('canvas', 'raid-atlas-tool-glyph', this.pinToolBtn);
    this.pinToolBtn.addEventListener('click', () => {
      this.pinMode = !this.pinMode;
      this.syncChrome();
      if (this.pinMode) this.flash(t('hudChrome.raidAtlas.pinToolHint'));
    });
    this.styleBtn = button('raid-atlas-style', 'hudChrome.raidAtlas.pinStyle', tools);
    this.styleBtn.setAttribute('aria-expanded', 'false');
    this.styleSwatch = el('canvas', 'raid-atlas-tool-glyph', this.styleBtn);
    this.styleBtn.addEventListener('click', () => {
      if (this.editor?.classList.contains('is-open') && this.selectedPin === null)
        this.closeEditor();
      else this.openEditor(null);
    });
    this.legendBtn = button('raid-atlas-legend-btn', 'hudChrome.raidAtlas.legendToggle', tools);
    this.legendBtn.textContent = t('hudChrome.raidAtlas.legendToggle');
    this.legendBtn.setAttribute('aria-expanded', 'false');
    this.legendBtn.addEventListener('click', () => {
      const open = !this.legend?.classList.contains('is-open');
      this.legend?.classList.toggle('is-open', open);
      this.legendBtn?.setAttribute('aria-expanded', String(open));
    });

    this.buildEditor(chrome);
    this.buildLegend(chrome);
    this.toast = el('div', 'raid-atlas-toast ui-panel', chrome);
    this.toast.setAttribute('role', 'status');
    this.toolGlyph = toolGlyph;
    this.bindInput(canvas);
    this.bindSize(canvas);
  }

  private buildEditor(chrome: HTMLElement): void {
    const ed = el('div', 'raid-atlas-editor ui-panel-strong', chrome);
    ed.setAttribute('role', 'dialog');
    this.editorTitle = el('div', 'raid-atlas-editor-title', ed);
    ed.setAttribute('aria-label', t('hudChrome.raidAtlas.pinStyle'));
    const icons = el('div', 'raid-atlas-editor-row', ed);
    icons.setAttribute('role', 'group');
    icons.setAttribute('aria-label', t('hudChrome.raidAtlas.pinIconsAria'));
    for (const icon of RAID_ATLAS_PIN_ICONS) {
      const b = button('raid-atlas-chip', `hudChrome.raidAtlas.pinIcon.${icon}`, icons);
      el('canvas', 'raid-atlas-chip-glyph', b);
      b.addEventListener('click', () => this.pickStyle({ icon }));
      this.editorIcons.set(icon, b);
    }
    const colors = el('div', 'raid-atlas-editor-row', ed);
    colors.setAttribute('role', 'group');
    colors.setAttribute('aria-label', t('hudChrome.raidAtlas.pinColorsAria'));
    for (const color of RAID_ATLAS_PIN_COLORS) {
      const b = button(
        `raid-atlas-chip raid-atlas-color is-${color}`,
        `hudChrome.raidAtlas.pinColor.${color}`,
        colors,
      );
      b.addEventListener('click', () => this.pickStyle({ color }));
      this.editorColors.set(color, b);
    }
    const actions = el('div', 'raid-atlas-editor-actions', ed);
    this.editorRemove = button('raid-atlas-remove', 'hudChrome.raidAtlas.removePin', actions);
    this.editorRemove.textContent = t('hudChrome.raidAtlas.removePin');
    this.editorRemove.addEventListener('click', () => {
      if (this.selectedPin !== null) {
        this.pins = removePin(this.pins, this.selectedPin);
        this.savePins();
      } else {
        this.pins = [];
        this.savePins();
      }
      this.closeEditor();
      this.paint();
    });
    const done = button('raid-atlas-done', 'hudChrome.raidAtlas.done', actions);
    done.textContent = t('hudChrome.raidAtlas.done');
    done.addEventListener('click', () => {
      this.closeEditor();
      this.paint();
    });
    // Escape closes the editor and hands focus back to the map.
    ed.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      this.closeEditor();
      this.canvas?.focus();
      this.paint();
    });
    this.editor = ed;
  }

  private buildLegend(chrome: HTMLElement): void {
    const lg = el('div', 'raid-atlas-legend ui-panel-strong', chrome);
    const list = el('ul', 'raid-atlas-legend-list', lg);
    const rows: [string, (g: CanvasRenderingContext2D, c: RaidAtlasColors) => void][] = [
      ['you', (g, c) => drawPlayerArrow(g, c, 11, 12, 0, 17)],
      ['member', (g, c) => drawMember(g, c, 11, 11, 5, c.veinBreath, false)],
      ['boss', (g, c) => drawBossMedallion(g, c, 11, 11, 9, 'alive')],
      ['engaged', (g, c) => drawBossMedallion(g, c, 11, 11, 9, 'engaged')],
      ['defeated', (g, c) => drawBossMedallion(g, c, 11, 11, 9, 'dead')],
      ['portal', (g, c) => drawPoi(g, c, 'portal', 11, 11, 8)],
      ['entrance', (g, c) => drawPoi(g, c, 'entrance', 11, 11, 8)],
      ['pin', (g, c) => drawPin(g, c, 11, 20, 16, 'star', 'gold', false)],
      [
        'river',
        (g, c) => {
          g.strokeStyle = c.veinBreath;
          g.lineWidth = 2.5;
          g.setLineDash([3, 2.5]);
          g.beginPath();
          g.moveTo(2, 15);
          g.quadraticCurveTo(11, 3, 20, 9);
          g.stroke();
        },
      ],
    ];
    this.legendRows = rows.map(([key, draw]) => {
      const li = el('li', 'raid-atlas-legend-row', list);
      const swatch = el('canvas', 'raid-atlas-legend-glyph', li);
      const label = el('span', 'raid-atlas-legend-label', li);
      label.textContent = t(`hudChrome.raidAtlas.legend.${key}` as never);
      return { swatch, draw };
    });
    const hint = el('p', 'raid-atlas-hint', lg);
    hint.textContent = t(
      document.body.classList.contains('mobile-touch')
        ? 'hudChrome.raidAtlas.hintTouch'
        : 'hudChrome.raidAtlas.hintDesktop',
    );
    this.legend = lg;
  }

  private legendRows: {
    swatch: HTMLCanvasElement;
    draw: (g: CanvasRenderingContext2D, c: RaidAtlasColors) => void;
  }[] = [];

  private glyphsDrawn = false;
  private toolGlyph: HTMLCanvasElement | null = null;

  /** Draw the chrome's small canvas glyphs (the legend's, the tools', the
   *  editor's icons) once the palette resolves, and the style swatch on every
   *  style change. */
  private paintGlyphs(): void {
    const colors = this.painter.resolvedColors();
    if (!colors) return;
    const dpr = this.dpr;
    const sizeGlyph = (cv: HTMLCanvasElement, w: number, h: number) => {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      const g = cv.getContext('2d');
      g?.setTransform(dpr, 0, 0, dpr, 0, 0);
      return g;
    };
    if (!this.glyphsDrawn) {
      this.glyphsDrawn = true;
      for (const row of this.legendRows) {
        const g = sizeGlyph(row.swatch, 22, 22);
        if (g) row.draw(g, colors);
      }
      if (this.toolGlyph) {
        const g = sizeGlyph(this.toolGlyph, 22, 22);
        if (g) {
          // A pin with a plus: "place a pin".
          drawPin(g, colors, 9, 21, 16, 'diamond', 'gold', false);
          g.strokeStyle = colors.frameDark;
          g.lineWidth = 4;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(17, 2.5);
          g.lineTo(17, 10.5);
          g.moveTo(13, 6.5);
          g.lineTo(21, 6.5);
          g.stroke();
          g.strokeStyle = colors.goldWhite;
          g.lineWidth = 2;
          g.stroke();
        }
      }
      for (const [icon, b] of this.editorIcons) {
        const cv = b.querySelector('canvas');
        if (!cv) continue;
        const g = sizeGlyph(cv, 22, 22);
        if (!g) continue;
        g.translate(11, 11);
        g.beginPath();
        pinIconPath(g, icon, 8);
        g.fillStyle = colors.goldLight;
        g.fill();
        g.strokeStyle = colors.frameDark;
        g.lineWidth = 1;
        g.stroke();
      }
    }
    if (this.styleSwatch) {
      const g = sizeGlyph(this.styleSwatch, 22, 22);
      if (g) drawPin(g, colors, 11, 20, 17, this.style.icon, this.style.color, false);
    }
  }

  private syncChrome(): void {
    for (const [id, b] of this.floorTabs) {
      const on = id === this.floorId;
      b.classList.toggle('is-current', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.pinToolBtn?.classList.toggle('is-on', this.pinMode);
    this.pinToolBtn?.setAttribute('aria-pressed', String(this.pinMode));
    this.canvas?.classList.toggle('is-pinning', this.pinMode);
    this.paintGlyphs();
  }

  private youAreHere: RaidAtlasFloorId | null | undefined;
  private syncYouAreHere(floor: RaidAtlasFloorId | null): void {
    if (this.youAreHere === floor) return;
    this.youAreHere = floor;
    for (const [id, b] of this.floorTabs) b.classList.toggle('has-player', id === floor);
  }

  private zoomAtHome: boolean | null = null;
  private zoomAtMax: boolean | null = null;
  private syncZoomButtons(): void {
    const home = this.camera.atHome();
    const max = this.camera.atMax();
    if (home !== this.zoomAtHome && this.zoomOutBtn) this.zoomOutBtn.disabled = home;
    if (max !== this.zoomAtMax && this.zoomInBtn) this.zoomInBtn.disabled = max;
    this.zoomAtHome = home;
    this.zoomAtMax = max;
  }

  private toastTimer = 0;
  private flash(text: string): void {
    if (!this.toast) return;
    this.toast.textContent = text;
    this.toast.classList.add('is-on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast?.classList.remove('is-on'), 2600);
  }

  private openEditor(pinId: number | null): void {
    const ed = this.editor;
    if (!ed) return;
    this.selectedPin = pinId;
    const pin = pinId === null ? null : (this.pins.find((p) => p.id === pinId) ?? null);
    const style = pin ? { icon: pin.icon, color: pin.color } : this.style;
    if (this.editorTitle)
      this.editorTitle.textContent = t(
        pin ? 'hudChrome.raidAtlas.pinEdit' : 'hudChrome.raidAtlas.pinStyle',
      );
    if (this.editorRemove) {
      const label = t(pin ? 'hudChrome.raidAtlas.removePin' : 'hudChrome.raidAtlas.clearPins');
      this.editorRemove.textContent = label;
      this.editorRemove.setAttribute('aria-label', label);
      this.editorRemove.title = label;
      this.editorRemove.disabled = !pin && this.pins.length === 0;
    }
    for (const [icon, b] of this.editorIcons)
      b.setAttribute('aria-pressed', String(icon === style.icon));
    for (const [color, b] of this.editorColors)
      b.setAttribute('aria-pressed', String(color === style.color));
    ed.setAttribute(
      'aria-label',
      t(pin ? 'hudChrome.raidAtlas.pinEdit' : 'hudChrome.raidAtlas.pinStyle'),
    );
    const wasOpen = ed.classList.contains('is-open');
    ed.classList.add('is-open');
    if (!wasOpen) this.editorIcons.get(style.icon)?.focus();
    this.styleBtn?.setAttribute('aria-expanded', String(pin === null));
    this.paint();
  }

  private closeEditor(): void {
    if (!this.editor?.classList.contains('is-open') && this.selectedPin === null) return;
    this.editor?.classList.remove('is-open');
    this.styleBtn?.setAttribute('aria-expanded', 'false');
    this.selectedPin = null;
  }

  private pickStyle(style: Partial<RaidAtlasPinStyle>): void {
    if (this.selectedPin !== null) {
      this.pins = restylePin(this.pins, this.selectedPin, style);
      this.savePins();
    }
    // A pick always becomes the style the next pin takes.
    this.style = { ...this.style, ...style };
    storageSet(STORE_STYLE_KEY, JSON.stringify(this.style));
    this.openEditor(this.selectedPin);
    this.paintGlyphs();
  }

  // ---- size ----------------------------------------------------------------------------

  private bindSize(canvas: HTMLCanvasElement): void {
    if (typeof ResizeObserver === 'undefined') return;
    new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentBoxSize?.[0];
      if (!box) return;
      const side = Math.max(
        120,
        Math.round(Math.min(box.inlineSize, box.blockSize || box.inlineSize)),
      );
      const dpr = Math.min(MAX_DPR, canvasDpr());
      if (side === this.side && dpr === this.dpr && canvas.width === Math.round(side * dpr)) return;
      this.side = side;
      this.dpr = dpr;
      canvas.width = Math.round(side * dpr);
      canvas.height = Math.round(side * dpr);
      this.glyphsDrawn = false;
      this.paintGlyphs();
      this.paint();
    }).observe(canvas);
  }

  // ---- input ---------------------------------------------------------------------------

  /** Measure the canvas once per gesture: CSS px of the event over the square. */
  private measure(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.rectLeft = rect.left + canvas.clientLeft;
    this.rectTop = rect.top + canvas.clientTop;
    const inner = rect.width - canvas.clientLeft * 2;
    this.rectScale = inner > 0 ? this.side / inner : 1;
  }

  private local(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    return {
      x: (ev.clientX - this.rectLeft) * this.rectScale,
      y: (ev.clientY - this.rectTop) * this.rectScale,
    };
  }

  private zoomButton(factor: number): void {
    this.camera.zoomAt(factor, this.side, this.side / 2, this.side / 2);
    this.paint();
  }

  private projector(): ((x: number, z: number) => { sx: number; sy: number }) | null {
    const plan = this.plan;
    if (!plan) return null;
    const floor = raidAtlasFloor(plan, this.floorId);
    const span = pageSpan(floor.bounds);
    const view = this.camera.current;
    return (x, z) => {
      const p = toPage(floor.bounds, x, z);
      return pageToScreen(view, span, this.side, p.u, p.v);
    };
  }

  private pinUnder(x: number, y: number): RaidAtlasPin | null {
    const project = this.projector();
    if (!project) return null;
    const scale = this.side < 420 ? 0.82 : 1;
    return pinAtScreen(this.pins, this.floorId, project, x, y, PIN_HIT_PX, PIN_LIFT_PX * scale);
  }

  private placePin(x: number, y: number): void {
    const plan = this.plan;
    if (!plan) return;
    const floor = raidAtlasFloor(plan, this.floorId);
    const span = pageSpan(floor.bounds);
    const page = screenToPage(this.camera.current, span, this.side, x, y);
    const at = fromPage(floor.bounds, page.u, page.v);
    this.pins = addPin(this.pins, this.floorId, at.x, at.z, this.style);
    this.savePins();
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        this.measure();
        const p = this.local(ev);
        const px =
          ev.deltaMode === 1 ? ev.deltaY * 40 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
        this.camera.zoomAt(wheelZoomFactor(px), this.side, p.x, p.y);
        this.paint();
      },
      { passive: false },
    );
    canvas.addEventListener('pointerdown', (ev) => {
      this.lastPointerType = ev.pointerType;
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      // A click must not park keyboard focus on the map (its zoom keys would
      // shadow the action bar's); keyboard users still Tab onto it.
      if (ev.pointerType === 'mouse') ev.preventDefault();
      this.measure();
      const p = this.local(ev);
      this.pointers.set(ev.pointerId, {
        x: p.x,
        y: p.y,
        startX: p.x,
        startY: p.y,
        type: ev.pointerType,
      });
      canvas.setPointerCapture(ev.pointerId);
      if (this.pointers.size === 1) this.dragged = false;
      if (this.pointers.size === 2) {
        this.dragged = true;
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
        this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      canvas.classList.add('is-grabbing');
    });
    canvas.addEventListener('pointermove', (ev) => {
      const track = this.pointers.get(ev.pointerId);
      if (!track) return;
      const p = this.local(ev);
      const dx = p.x - track.x;
      const dy = p.y - track.y;
      track.x = p.x;
      track.y = p.y;
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.pinchDist > 0 && dist > 0)
          this.camera.zoomNow(dist / this.pinchDist, this.side, mid.x, mid.y);
        this.camera.panNow(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y, this.side);
        this.pinchDist = dist;
        this.pinchMid = mid;
        this.paint();
        return;
      }
      if (!this.dragged && Math.hypot(p.x - track.startX, p.y - track.startY) > TAP_TOLERANCE_PX)
        this.dragged = true;
      if (this.dragged) {
        this.camera.panNow(dx, dy, this.side);
        this.paint();
      }
    });
    const end = (ev: PointerEvent, cancelled: boolean) => {
      const track = this.pointers.get(ev.pointerId);
      if (!track) return;
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size === 0) canvas.classList.remove('is-grabbing');
      if (this.pointers.size === 1) {
        const [rest] = [...this.pointers.values()];
        this.pinchDist = 0;
        this.pinchMid = { x: rest.x, y: rest.y };
      } else if (this.pointers.size === 2) {
        // A third finger lifted: re-base the pinch on the two that remain.
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
        this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      if (cancelled || this.dragged || this.pointers.size > 0) {
        this.paint();
        return;
      }
      this.tap(track.x, track.y);
    };
    canvas.addEventListener('pointerup', (ev) => end(ev, false));
    canvas.addEventListener('pointercancel', (ev) => end(ev, true));
    canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      // A touch long-press raises contextmenu too: touch places pins with the
      // pin tool only.
      if (this.lastPointerType !== 'mouse') return;
      this.measure();
      const p = this.local(ev);
      const hit = this.pinUnder(p.x, p.y);
      if (hit) {
        this.pins = removePin(this.pins, hit.id);
        if (this.selectedPin === hit.id) this.closeEditor();
      } else this.placePin(p.x, p.y);
      this.savePins();
      this.paint();
    });
    canvas.addEventListener('dblclick', (ev) => {
      if (this.pinMode) return;
      this.measure();
      const p = this.local(ev);
      if (this.pinUnder(p.x, p.y)) return;
      this.camera.zoomAt(RAID_ATLAS_BUTTON_STEP, this.side, p.x, p.y);
      this.paint();
    });
    canvas.addEventListener('keydown', (ev) => {
      const k = ev.key;
      let handled = true;
      if (k === '+' || k === '=') this.zoomButton(RAID_ATLAS_BUTTON_STEP);
      else if (k === '-' || k === '_') this.zoomButton(1 / RAID_ATLAS_BUTTON_STEP);
      else if (k === '0' || k === 'Home') this.camera.reset();
      else if (k === 'ArrowLeft') this.camera.panNow(KEY_PAN_PX, 0, this.side);
      else if (k === 'ArrowRight') this.camera.panNow(-KEY_PAN_PX, 0, this.side);
      else if (k === 'ArrowUp') this.camera.panNow(0, KEY_PAN_PX, this.side);
      else if (k === 'ArrowDown') this.camera.panNow(0, -KEY_PAN_PX, this.side);
      else handled = false;
      if (!handled) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.paint();
    });
  }

  private tap(x: number, y: number): void {
    const hit = this.pinUnder(x, y);
    if (hit) {
      this.openEditor(hit.id);
      return;
    }
    if (this.editor?.classList.contains('is-open')) {
      this.closeEditor();
      this.paint();
      return;
    }
    if (this.pinMode) {
      this.placePin(x, y);
      this.paint();
    }
  }
}

function parseStyle(raw: string | null): RaidAtlasPinStyle | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RaidAtlasPinStyle>;
    if (
      v &&
      (RAID_ATLAS_PIN_ICONS as readonly string[]).includes(String(v.icon)) &&
      (RAID_ATLAS_PIN_COLORS as readonly string[]).includes(String(v.color))
    )
      return { icon: v.icon as RaidAtlasPinIcon, color: v.color as RaidAtlasPinColor };
  } catch {
    /* a foreign value: fall back to the default style */
  }
  return null;
}
