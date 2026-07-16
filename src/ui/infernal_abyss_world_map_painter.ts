// Full-window parchment chart for the Infernal Abyss. Static dungeon art is
// cached per canvas size and localized title; only live combat, party, corpse,
// and player markers repaint on top. Geometry comes from infernal_abyss_map,
// the same projection used by the circular minimap.

import type { IWorld } from '../world_api';
import {
  type InfernalAbyssMapModel,
  type InfernalMapHazard,
  type InfernalMapRect,
  type InfernalMapRoom,
  infernalAbyssMapModel,
} from './infernal_abyss_map';

const MAP_PAD = 54;
const BORDER_INSET = 12;
const INNER_BORDER_GAP = 9;
const BORDER_SEGMENTS = 28;
const BARRIER_MIN_SIZE = 3;
const DOOR_MIN_SIZE = 5;
const TITLE_Y = 38;
const TITLE_FONT = 'bold 23px Cinzel, Georgia, serif';
const TITLE_MAX_MARGIN = 78;
const FIBER_COUNT = 82;
const STIPPLE_COUNT = 170;
const ROUTE_UNDERLAY_WIDTH = 10;
const ROUTE_WIDTH = 2;
const ROUTE_DASH = [6, 5];
const ROOM_STROKE_WIDTH = 2;
const ROOM_INNER_INSET = 3;
const ROOM_CHAMFER_MAX = 7;
const ROOM_CRACK_COUNT = 4;
const BOSS_STROKE_WIDTH = 4;
const MOB_RADIUS = 4;
const PARTY_RADIUS = 6;
const CORPSE_RADIUS = 7;
const PLAYER_TIP = 11;
const PLAYER_BACK = 7;
const COMPASS_RADIUS = 18;
const FULL_CIRCLE = Math.PI * 2;

const MAIN_ROUTE = [
  'ashen_descent_entrance',
  'chainscar_descent',
  'lower_forge_junction',
  'lava_maze_approach',
  'lava_maze',
  'infernal_forge',
  'maw_approach',
  'maw_bridge',
  'heart_cairn_vestibule',
  'heart_cairn_gate',
  'heart_cairn_lower',
  'heart_cairn_boss_arena',
  'heart_cairn_crown',
] as const;

const BRANCH_ROUTES = [
  ['lava_maze', 'lost_armory', 'pyre_golem_crucible'],
  ['infernal_forge', 'gladiator_pit'],
] as const;

const COLOR_TOKENS = {
  parchment: '--color-infernal-map-parchment',
  parchmentLight: '--color-infernal-map-parchment-light',
  parchmentEdge: '--color-infernal-map-parchment-edge',
  parchmentFiber: '--color-infernal-map-parchment-fiber',
  scorch: '--color-infernal-map-scorch',
  scorchFade: '--color-infernal-map-scorch-fade',
  ink: '--color-infernal-map-ink',
  inkSoft: '--color-infernal-map-ink-soft',
  room: '--color-infernal-map-room',
  roomDeep: '--color-infernal-map-room-deep',
  roomHighlight: '--color-infernal-map-room-highlight',
  mazeRoom: '--color-infernal-map-maze-room',
  armoryRoom: '--color-infernal-map-armory-room',
  forgeRoom: '--color-infernal-map-forge-room',
  pitRoom: '--color-infernal-map-pit-room',
  heartRoom: '--color-infernal-map-heart-room',
  bossRoom: '--color-infernal-map-boss-room',
  bossGlow: '--color-infernal-map-boss-glow',
  lava: '--color-infernal-map-lava',
  lavaCore: '--color-infernal-map-lava-core',
  void: '--color-infernal-map-void',
  voidCore: '--color-infernal-map-void-core',
  route: '--color-infernal-map-route',
  routeHighlight: '--color-infernal-map-route-highlight',
  glyph: '--color-infernal-map-glyph',
  lore: '--color-infernal-map-lore',
  mob: '--color-minimap-mob',
  mobAggro: '--color-minimap-mob-aggro',
  player: '--color-minimap-player',
  partyDead: '--color-minimap-party-dead',
} as const;

type InfernalWorldMapColors = Record<keyof typeof COLOR_TOKENS, string>;
type RoomKind = 'entry' | 'maze' | 'armory' | 'forge' | 'pit' | 'maw' | 'heart' | 'boss';

interface Point {
  x: number;
  y: number;
}

function centeredRect(rect: InfernalMapRect, minSize: number): InfernalMapRect {
  const w = Math.max(minSize, rect.w);
  const h = Math.max(minSize, rect.h);
  return { x: rect.x - (w - rect.w) / 2, y: rect.y - (h - rect.h) / 2, w, h };
}

function roomCenter(room: InfernalMapRoom): Point {
  return { x: room.x + room.w / 2, y: room.y + room.h / 2 };
}

function roomKind(room: InfernalMapRoom): RoomKind {
  if (room.boss) return 'boss';
  if (room.id.includes('lava_maze')) return 'maze';
  if (room.id.includes('armory')) return 'armory';
  if (room.id.includes('forge') || room.id.includes('crucible')) return 'forge';
  if (room.id.includes('gladiator')) return 'pit';
  if (room.id.includes('maw')) return 'maw';
  if (room.id.includes('heart_cairn')) return 'heart';
  return 'entry';
}

function roomSeed(room: InfernalMapRoom): number {
  let seed = 0;
  for (let i = 0; i < room.id.length; i++) seed = (seed * 31 + room.id.charCodeAt(i)) | 0;
  return Math.abs(seed);
}

function traceChamferedRect(ctx: CanvasRenderingContext2D, rect: InfernalMapRect, inset = 0): void {
  const x = rect.x + inset;
  const y = rect.y + inset;
  const w = Math.max(0, rect.w - inset * 2);
  const h = Math.max(0, rect.h - inset * 2);
  const cut = Math.min(ROOM_CHAMFER_MAX, w * 0.16, h * 0.16);
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

function traceBurntBorder(
  ctx: CanvasRenderingContext2D,
  size: number,
  inset: number,
  phase: number,
): void {
  const span = size - inset * 2;
  const wobble = (index: number): number =>
    Math.sin(index * 1.71 + phase) * 1.7 + Math.cos(index * 0.83 + phase) * 0.85;
  ctx.beginPath();
  for (let i = 0; i <= BORDER_SEGMENTS; i++) {
    const t = i / BORDER_SEGMENTS;
    const x = inset + span * t;
    const y = inset + wobble(i);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = 1; i <= BORDER_SEGMENTS; i++) {
    const t = i / BORDER_SEGMENTS;
    ctx.lineTo(size - inset + wobble(i + 31), inset + span * t);
  }
  for (let i = 1; i <= BORDER_SEGMENTS; i++) {
    const t = i / BORDER_SEGMENTS;
    ctx.lineTo(size - inset - span * t, size - inset + wobble(i + 63));
  }
  for (let i = 1; i <= BORDER_SEGMENTS; i++) {
    const t = i / BORDER_SEGMENTS;
    ctx.lineTo(inset + wobble(i + 97), size - inset - span * t);
  }
  ctx.closePath();
}

function traceJaggedChasm(ctx: CanvasRenderingContext2D, hazard: InfernalMapHazard): void {
  const steps = 12;
  const hw = hazard.halfWidth;
  const hl = hazard.halfLength;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -hl + hl * 2 * t;
    const edge = Math.sin(i * 2.23 + hazard.cx * 0.03) * Math.min(3, hw * 0.18);
    const x = -hw + edge;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const y = -hl + hl * 2 * t;
    const edge = Math.cos(i * 1.91 + hazard.cy * 0.02) * Math.min(3, hw * 0.18);
    ctx.lineTo(hw + edge, y);
  }
  ctx.closePath();
}

function pointInsideRect(point: Point, rect: InfernalMapRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

export class InfernalAbyssWorldMapPainter {
  private colors: InfernalWorldMapColors | null = null;
  private background: HTMLCanvasElement | null = null;
  private backgroundSize = 0;
  private backgroundTitle = '';

  private resolveColors(): InfernalWorldMapColors {
    if (this.colors) return this.colors;
    const styles = getComputedStyle(document.documentElement);
    const colors = {} as InfernalWorldMapColors;
    for (const key of Object.keys(COLOR_TOKENS) as Array<keyof typeof COLOR_TOKENS>) {
      colors[key] = styles.getPropertyValue(COLOR_TOKENS[key]).trim();
    }
    if (colors.parchment) this.colors = colors;
    return colors;
  }

  paint(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    canvasSize: number,
    title: string,
    classColor: (cls: string) => string,
  ): void {
    const colors = this.resolveColors();
    const model = infernalAbyssMapModel(world, canvasSize, MAP_PAD);
    const background = this.ensureBackground(model, colors, canvasSize, title);
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.drawImage(background, 0, 0);
    this.paintLiveMarkers(ctx, model, colors, classColor);
  }

  private ensureBackground(
    model: InfernalAbyssMapModel,
    colors: InfernalWorldMapColors,
    size: number,
    title: string,
  ): HTMLCanvasElement {
    if (this.background && this.backgroundSize === size && this.backgroundTitle === title) {
      return this.background;
    }
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    this.paintParchment(ctx, colors, size);
    this.paintBurntFrame(ctx, colors, size);
    this.paintTitle(ctx, colors, size, title);
    this.paintMarginOrnaments(ctx, colors, size);
    this.paintChasms(ctx, model, colors);
    this.paintRoutes(ctx, model, colors, true);
    this.paintRooms(ctx, model, colors);
    this.paintRoutes(ctx, model, colors, false);
    this.paintDoors(ctx, model, colors);
    this.paintBarriers(ctx, model, colors);
    this.paintLava(ctx, model, colors);
    this.paintRoomSigils(ctx, model, colors);
    this.paintLoreRunes(ctx, model, colors);
    this.paintCompassRose(ctx, colors, size);

    this.background = canvas;
    this.backgroundSize = size;
    this.backgroundTitle = title;
    return canvas;
  }

  private paintParchment(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    size: number,
  ): void {
    const parchment = ctx.createRadialGradient(
      size * 0.47,
      size * 0.43,
      size * 0.05,
      size / 2,
      size / 2,
      size * 0.72,
    );
    parchment.addColorStop(0, colors.parchmentLight);
    parchment.addColorStop(0.58, colors.parchment);
    parchment.addColorStop(1, colors.parchmentEdge);
    ctx.fillStyle = parchment;
    ctx.fillRect(0, 0, size, size);

    const scorchMarks = [
      [0.08, 0.13, 0.16],
      [0.91, 0.18, 0.12],
      [0.13, 0.84, 0.13],
      [0.88, 0.79, 0.2],
      [0.57, 0.55, 0.08],
    ] as const;
    for (const [nx, ny, nr] of scorchMarks) {
      const scorch = ctx.createRadialGradient(
        size * nx,
        size * ny,
        0,
        size * nx,
        size * ny,
        size * nr,
      );
      scorch.addColorStop(0, colors.scorch);
      scorch.addColorStop(1, colors.scorchFade);
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = scorch;
      ctx.fillRect(0, 0, size, size);
    }

    const usable = size - BORDER_INSET * 2;
    ctx.strokeStyle = colors.parchmentFiber;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.17;
    for (let i = 0; i < FIBER_COUNT; i++) {
      const y = ((i * 83) % usable) + BORDER_INSET;
      const bend = Math.sin(i * 2.17) * 9;
      ctx.beginPath();
      ctx.moveTo(BORDER_INSET, y);
      ctx.quadraticCurveTo(size * 0.5, y + bend, size - BORDER_INSET, y - bend * 0.35);
      ctx.stroke();
    }

    ctx.fillStyle = colors.inkSoft;
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < STIPPLE_COUNT; i++) {
      const x = BORDER_INSET + ((i * 97 + 23) % usable);
      const y = BORDER_INSET + ((i * 53 + 41) % usable);
      const r = 0.45 + ((i * 17) % 4) * 0.22;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, FULL_CIRCLE);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private paintBurntFrame(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    size: number,
  ): void {
    ctx.lineJoin = 'round';
    traceBurntBorder(ctx, size, BORDER_INSET, 0.2);
    ctx.strokeStyle = colors.scorch;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 13;
    ctx.stroke();

    traceBurntBorder(ctx, size, BORDER_INSET, 0.2);
    ctx.strokeStyle = colors.parchmentEdge;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 5;
    ctx.stroke();

    traceBurntBorder(ctx, size, BORDER_INSET, 0.2);
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    traceBurntBorder(ctx, size, BORDER_INSET + INNER_BORDER_GAP, 1.4);
    ctx.strokeStyle = colors.inkSoft;
    ctx.globalAlpha = 0.78;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    for (const [x, y, sx, sy] of [
      [BORDER_INSET + 10, BORDER_INSET + 10, 1, 1],
      [size - BORDER_INSET - 10, BORDER_INSET + 10, -1, 1],
      [BORDER_INSET + 10, size - BORDER_INSET - 10, 1, -1],
      [size - BORDER_INSET - 10, size - BORDER_INSET - 10, -1, -1],
    ] as const) {
      this.paintCornerHorn(ctx, colors, x, y, sx, sy);
    }
  }

  private paintCornerHorn(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    x: number,
    y: number,
    sx: number,
    sy: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.bezierCurveTo(2, 7, 8, 2, 18, 0);
    ctx.bezierCurveTo(12, 7, 8, 11, 7, 20);
    ctx.stroke();
    ctx.strokeStyle = colors.routeHighlight;
    ctx.globalAlpha = 0.56;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4, 15);
    ctx.quadraticCurveTo(8, 6, 15, 3);
    ctx.stroke();
    ctx.restore();
  }

  private paintTitle(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    size: number,
    title: string,
  ): void {
    const center = size / 2;
    ctx.strokeStyle = colors.inkSoft;
    ctx.fillStyle = colors.ink;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.moveTo(TITLE_MAX_MARGIN, TITLE_Y + 8);
    ctx.quadraticCurveTo(center, TITLE_Y + 14, size - TITLE_MAX_MARGIN, TITLE_Y + 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = TITLE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = colors.parchmentLight;
    ctx.shadowBlur = 3;
    ctx.fillText(title, center, TITLE_Y, size - TITLE_MAX_MARGIN * 2);
    ctx.shadowBlur = 0;

    ctx.fillStyle = colors.bossGlow;
    for (const direction of [-1, 1]) {
      ctx.save();
      ctx.translate(center + direction * (size * 0.33), TITLE_Y + 6);
      ctx.scale(direction, 1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(8, -3);
      ctx.lineTo(16, 0);
      ctx.lineTo(8, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private paintMarginOrnaments(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    size: number,
  ): void {
    ctx.strokeStyle = colors.inkSoft;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.48;
    const chainX = BORDER_INSET + 17;
    for (let i = 0; i < 8; i++) {
      const y = size * 0.23 + i * 28;
      ctx.save();
      ctx.translate(chainX, y);
      ctx.rotate(i % 2 === 0 ? 0.36 : -0.36);
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 9, 0, 0, FULL_CIRCLE);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(size - BORDER_INSET - 27, size - BORDER_INSET - 41);
    ctx.strokeStyle = colors.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, FULL_CIRCLE);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(17, 0);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private paintChasms(
    ctx: CanvasRenderingContext2D,
    model: InfernalAbyssMapModel,
    colors: InfernalWorldMapColors,
  ): void {
    for (const hazard of model.lava) {
      if (hazard.kind !== 'chasm') continue;
      ctx.save();
      ctx.translate(hazard.cx, hazard.cy);
      ctx.rotate(hazard.angle);

      traceJaggedChasm(ctx, hazard);
      ctx.fillStyle = colors.voidCore;
      ctx.shadowColor = colors.scorch;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      traceJaggedChasm(ctx, hazard);
      const depth = ctx.createLinearGradient(-hazard.halfWidth, 0, hazard.halfWidth, 0);
      depth.addColorStop(0, colors.inkSoft);
      depth.addColorStop(0.34, colors.void);
      depth.addColorStop(0.68, colors.voidCore);
      depth.addColorStop(1, colors.inkSoft);
      ctx.fillStyle = depth;
      ctx.fill();
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      const riverWidth = Math.max(2, hazard.halfWidth * 0.2);
      ctx.fillStyle = colors.lava;
      ctx.globalAlpha = 0.78;
      ctx.beginPath();
      ctx.moveTo(-riverWidth, -hazard.halfLength);
      for (let i = 1; i <= 9; i++) {
        const y = -hazard.halfLength + (hazard.halfLength * 2 * i) / 9;
        ctx.lineTo(-riverWidth + Math.sin(i * 1.8) * riverWidth * 0.45, y);
      }
      for (let i = 9; i >= 0; i--) {
        const y = -hazard.halfLength + (hazard.halfLength * 2 * i) / 9;
        ctx.lineTo(riverWidth + Math.cos(i * 1.6) * riverWidth * 0.45, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = colors.lavaCore;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.strokeStyle = colors.roomHighlight;
      ctx.globalAlpha = 0.38;
      ctx.lineWidth = 1;
      for (let i = 1; i < 9; i++) {
        const y = -hazard.halfLength + (hazard.halfLength * 2 * i) / 9;
        ctx.beginPath();
        ctx.moveTo(-hazard.halfWidth, y);
        ctx.lineTo(-hazard.halfWidth + 5, y + 3);
        ctx.moveTo(hazard.halfWidth, y);
        ctx.lineTo(hazard.halfWidth - 5, y - 3);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  private paintRoutes(
    ctx: CanvasRenderingContext2D,
    model: InfernalAbyssMapModel,
    colors: InfernalWorldMapColors,
    underlay: boolean,
  ): void {
    const rooms = new Map(model.rooms.map((room) => [room.id, room]));
    const drawRoute = (ids: readonly string[]): void => {
      const points = ids
        .map((id) => rooms.get(id))
        .filter((room): room is InfernalMapRoom => room !== undefined)
        .map(roomCenter);
      if (points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const point = points[i];
        const bend = i % 2 === 0 ? 5 : -5;
        ctx.quadraticCurveTo(
          (prev.x + point.x) / 2 + bend,
          (prev.y + point.y) / 2,
          point.x,
          point.y,
        );
      }
      ctx.stroke();
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (underlay) {
      ctx.strokeStyle = colors.inkSoft;
      ctx.globalAlpha = 0.42;
      ctx.lineWidth = ROUTE_UNDERLAY_WIDTH;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = colors.route;
      ctx.globalAlpha = 0.88;
      ctx.lineWidth = ROUTE_WIDTH;
      ctx.setLineDash(ROUTE_DASH);
    }
    drawRoute(MAIN_ROUTE);
    for (const branch of BRANCH_ROUTES) drawRoute(branch);
    ctx.setLineDash([]);

    if (!underlay) {
      ctx.fillStyle = colors.routeHighlight;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1;
      for (const id of [
        'lower_forge_junction',
        'lava_maze',
        'infernal_forge',
        'heart_cairn_gate',
      ]) {
        const room = rooms.get(id);
        if (!room) continue;
        const center = roomCenter(room);
        ctx.beginPath();
        ctx.arc(center.x, center.y, 3, 0, FULL_CIRCLE);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private paintRooms(
    ctx: CanvasRenderingContext2D,
    model: InfernalAbyssMapModel,
    colors: InfernalWorldMapColors,
  ): void {
    const fillFor = (kind: RoomKind): string => {
      if (kind === 'maze') return colors.mazeRoom;
      if (kind === 'armory') return colors.armoryRoom;
      if (kind === 'forge') return colors.forgeRoom;
      if (kind === 'pit') return colors.pitRoom;
      if (kind === 'maw') return colors.void;
      if (kind === 'heart') return colors.heartRoom;
      if (kind === 'boss') return colors.bossRoom;
      return colors.room;
    };

    for (const room of model.rooms) {
      const kind = roomKind(room);
      ctx.save();
      traceChamferedRect(ctx, { ...room, x: room.x + 2, y: room.y + 3 });
      ctx.fillStyle = colors.inkSoft;
      ctx.globalAlpha = 0.43;
      ctx.fill();

      traceChamferedRect(ctx, room);
      ctx.fillStyle = fillFor(kind);
      if (kind === 'boss') {
        ctx.shadowColor = colors.bossGlow;
        ctx.shadowBlur = 12;
      }
      ctx.globalAlpha = 0.96;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = room.boss ? BOSS_STROKE_WIDTH : ROOM_STROKE_WIDTH;
      ctx.stroke();

      if (room.w > ROOM_INNER_INSET * 3 && room.h > ROOM_INNER_INSET * 3) {
        traceChamferedRect(ctx, room, ROOM_INNER_INSET);
        ctx.strokeStyle = room.boss ? colors.bossGlow : colors.roomHighlight;
        ctx.globalAlpha = room.boss ? 0.72 : 0.54;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      this.paintRoomTexture(ctx, room, colors, kind);
      ctx.restore();
    }
  }

  private paintRoomTexture(
    ctx: CanvasRenderingContext2D,
    room: InfernalMapRoom,
    colors: InfernalWorldMapColors,
    kind: RoomKind,
  ): void {
    if (room.w < 10 || room.h < 8) return;
    const seed = roomSeed(room);
    ctx.save();
    traceChamferedRect(ctx, room, 1);
    ctx.clip();
    ctx.strokeStyle = kind === 'forge' || kind === 'boss' ? colors.lavaCore : colors.inkSoft;
    ctx.globalAlpha = kind === 'boss' ? 0.28 : 0.2;
    ctx.lineWidth = 1;
    for (let i = 0; i < ROOM_CRACK_COUNT; i++) {
      const x = room.x + (((seed + i * 37) % 83) / 83) * room.w;
      const y = room.y + (((seed + i * 59) % 71) / 71) * room.h;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 2);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 3, y + 4);
      ctx.lineTo(x + 6, y + 2);
      ctx.stroke();
    }

    if (kind === 'forge' || kind === 'pit') {
      ctx.strokeStyle = colors.roomHighlight;
      ctx.globalAlpha = 0.23;
      const rows = Math.max(2, Math.floor(room.h / 9));
      for (let i = 1; i < rows; i++) {
        const y = room.y + (room.h * i) / rows;
        ctx.beginPath();
        ctx.moveTo(room.x + 3, y);
        ctx.lineTo(room.x + room.w - 3, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private paintDoors(
    ctx: CanvasRenderingContext2D,
    model: InfernalAbyssMapModel,
    colors: InfernalWorldMapColors,
  ): void {
    for (const door of model.doors) {
      const rect = centeredRect(door, DOOR_MIN_SIZE);
      const horizontal = rect.w >= rect.h;
      ctx.fillStyle = colors.roomDeep;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.5;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      const postSize = Math.min(4, horizontal ? rect.h + 2 : rect.w + 2);
      const posts = horizontal
        ? [
            { x: rect.x, y: rect.y + rect.h / 2 },
            { x: rect.x + rect.w, y: rect.y + rect.h / 2 },
          ]
        : [
            { x: rect.x + rect.w / 2, y: rect.y },
            { x: rect.x + rect.w / 2, y: rect.y + rect.h },
          ];
      ctx.fillStyle = rect.w > 35 || rect.h > 35 ? colors.bossGlow : colors.glyph;
      for (const post of posts) {
        ctx.fillRect(post.x - postSize / 2, post.y - postSize / 2, postSize, postSize);
        ctx.strokeRect(post.x - postSize / 2, post.y - postSize / 2, postSize, postSize);
      }
    }
  }

  private paintBarriers(
    ctx: CanvasRenderingContext2D,
    model: InfernalAbyssMapModel,
    colors: InfernalWorldMapColors,
  ): void {
    const pit = model.rooms.find((room) => room.id === 'gladiator_pit');
    for (const barrier of model.barriers) {
      const rect = centeredRect(barrier, BARRIER_MIN_SIZE);
      const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      const isPit = pit ? pointInsideRect(center, pit) : false;
      ctx.fillStyle = isPit ? colors.pitRoom : colors.ink;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.5;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      const horizontal = rect.w >= rect.h;
      const length = horizontal ? rect.w : rect.h;
      const steps = Math.max(2, Math.floor(length / 7));
      ctx.fillStyle = isPit ? colors.glyph : colors.lava;
      ctx.globalAlpha = isPit ? 0.72 : 0.58;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = horizontal ? rect.x + rect.w * t : rect.x + rect.w / 2;
        const y = horizontal ? rect.y + rect.h / 2 : rect.y + rect.h * t;
        ctx.beginPath();
        ctx.arc(x, y, isPit ? 1.6 : 1.2, 0, FULL_CIRCLE);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  private paintLava(
    ctx: CanvasRenderingContext2D,
    model: InfernalAbyssMapModel,
    colors: InfernalWorldMapColors,
  ): void {
    for (const hazard of model.lava) {
      if (hazard.kind === 'chasm') continue;
      ctx.save();
      ctx.translate(hazard.cx, hazard.cy);
      ctx.rotate(hazard.angle);
      ctx.fillStyle = colors.lava;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = colors.bossGlow;
      ctx.shadowBlur = hazard.kind === 'moat' ? 8 : 4;

      if (hazard.kind === 'moat') {
        const innerWidth = hazard.innerHalfWidth ?? hazard.halfWidth * 0.68;
        const innerLength = hazard.innerHalfLength ?? hazard.halfLength * 0.68;
        ctx.beginPath();
        ctx.ellipse(0, 0, hazard.halfWidth, hazard.halfLength, 0, 0, FULL_CIRCLE);
        ctx.ellipse(0, 0, innerWidth, innerLength, 0, 0, FULL_CIRCLE);
        ctx.fill('evenodd');
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.strokeStyle = colors.lavaCore;
        ctx.globalAlpha = 0.78;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          (hazard.halfWidth + innerWidth) / 2,
          (hazard.halfLength + innerLength) / 2,
          0,
          0,
          FULL_CIRCLE,
        );
        ctx.stroke();
      } else if (hazard.kind === 'pool') {
        ctx.beginPath();
        ctx.ellipse(0, 0, hazard.halfWidth, hazard.halfLength, 0, 0, FULL_CIRCLE);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.fillStyle = colors.lavaCore;
        ctx.globalAlpha = 0.64;
        ctx.beginPath();
        ctx.ellipse(0, 0, hazard.halfWidth * 0.55, hazard.halfLength * 0.55, 0, 0, FULL_CIRCLE);
        ctx.fill();
        ctx.strokeStyle = colors.parchmentLight;
        ctx.globalAlpha = 0.48;
        ctx.beginPath();
        ctx.ellipse(0, 0, hazard.halfWidth * 0.28, hazard.halfLength * 0.28, 0, 0, FULL_CIRCLE);
        ctx.stroke();
      } else {
        const segments = 7;
        ctx.beginPath();
        for (let i = 0; i <= segments; i++) {
          const t = i / segments;
          const y = -hazard.halfLength + hazard.halfLength * 2 * t;
          const x = -hazard.halfWidth + Math.sin(i * 1.9) * hazard.halfWidth * 0.45;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let i = segments; i >= 0; i--) {
          const t = i / segments;
          const y = -hazard.halfLength + hazard.halfLength * 2 * t;
          const x = hazard.halfWidth + Math.cos(i * 1.7) * hazard.halfWidth * 0.45;
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.strokeStyle = colors.lavaCore;
        ctx.globalAlpha = 0.74;
        ctx.beginPath();
        ctx.moveTo(0, -hazard.halfLength);
        ctx.lineTo(0, hazard.halfLength);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  private paintRoomSigils(
    ctx: CanvasRenderingContext2D,
    model: InfernalAbyssMapModel,
    colors: InfernalWorldMapColors,
  ): void {
    for (const room of model.rooms) {
      const center = roomCenter(room);
      if (room.id === 'ashen_descent_entrance') {
        this.paintGateSigil(ctx, colors, center, 0.72);
      } else if (room.id === 'lost_armory') {
        this.paintCrossedSwords(ctx, colors, center, 0.72);
      } else if (room.id === 'pyre_golem_crucible') {
        this.paintHornedSkull(ctx, colors, center, 0.72);
      } else if (room.id === 'infernal_forge') {
        this.paintAnvil(ctx, colors, center, 0.9);
      } else if (room.id === 'gladiator_pit') {
        this.paintArenaHelm(ctx, colors, center, 0.86);
      } else if (room.id === 'maw_bridge') {
        this.paintBrokenBridge(ctx, colors, center, 0.72);
      } else if (room.id === 'heart_cairn_gate') {
        this.paintGateSigil(ctx, colors, center, 0.7);
      } else if (room.id === 'heart_cairn_boss_arena') {
        this.paintHornedSkull(ctx, colors, center, 1.22);
      } else if (room.id === 'heart_cairn_crown') {
        this.paintCrown(ctx, colors, center, 0.88);
      }
    }
  }

  private beginSigil(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    center: Point,
    scale: number,
  ): void {
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.scale(scale, scale);
    ctx.fillStyle = colors.glyph;
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.94;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, FULL_CIRCLE);
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private paintGateSigil(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    center: Point,
    scale: number,
  ): void {
    this.beginSigil(ctx, colors, center, scale);
    ctx.beginPath();
    ctx.moveTo(-7, 8);
    ctx.lineTo(-7, -1);
    ctx.quadraticCurveTo(0, -10, 7, -1);
    ctx.lineTo(7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = colors.route;
    for (const x of [-3, 0, 3]) {
      ctx.beginPath();
      ctx.moveTo(x, -3);
      ctx.lineTo(x, 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintCrossedSwords(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    center: Point,
    scale: number,
  ): void {
    this.beginSigil(ctx, colors, center, scale);
    ctx.lineWidth = 2.2;
    for (const direction of [-1, 1]) {
      ctx.save();
      ctx.rotate(direction * 0.72);
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(0, -7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-2.5, 5);
      ctx.lineTo(2.5, 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-2, -6);
      ctx.lineTo(2, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private paintHornedSkull(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    center: Point,
    scale: number,
  ): void {
    this.beginSigil(ctx, colors, center, scale);
    ctx.beginPath();
    ctx.moveTo(-6, -2);
    ctx.bezierCurveTo(-6, -8, 6, -8, 6, -2);
    ctx.lineTo(4, 6);
    ctx.lineTo(1, 8);
    ctx.lineTo(-1, 8);
    ctx.lineTo(-4, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-5, -4);
    ctx.quadraticCurveTo(-10, -9, -9, -13);
    ctx.quadraticCurveTo(-4, -10, -2, -7);
    ctx.moveTo(5, -4);
    ctx.quadraticCurveTo(10, -9, 9, -13);
    ctx.quadraticCurveTo(4, -10, 2, -7);
    ctx.stroke();
    ctx.fillStyle = colors.ink;
    for (const x of [-2.5, 2.5]) {
      ctx.beginPath();
      ctx.arc(x, 0, 1.5, 0, FULL_CIRCLE);
      ctx.fill();
    }
    ctx.restore();
  }

  private paintAnvil(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    center: Point,
    scale: number,
  ): void {
    this.beginSigil(ctx, colors, center, scale);
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(8, -4);
    ctx.lineTo(11, -1);
    ctx.lineTo(4, 1);
    ctx.lineTo(3, 5);
    ctx.lineTo(7, 8);
    ctx.lineTo(-7, 8);
    ctx.lineTo(-3, 5);
    ctx.lineTo(-3, 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = colors.lava;
    ctx.beginPath();
    ctx.moveTo(-6, -2);
    ctx.lineTo(5, -2);
    ctx.stroke();
    ctx.restore();
  }

  private paintArenaHelm(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    center: Point,
    scale: number,
  ): void {
    this.beginSigil(ctx, colors, center, scale);
    ctx.beginPath();
    ctx.arc(0, 1, 7, Math.PI, FULL_CIRCLE);
    ctx.lineTo(7, 7);
    ctx.lineTo(2, 4);
    ctx.lineTo(2, 9);
    ctx.lineTo(-2, 9);
    ctx.lineTo(-2, 4);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.quadraticCurveTo(7, -11, 9, -6);
    ctx.quadraticCurveTo(4, -7, 0, -3);
    ctx.stroke();
    ctx.restore();
  }

  private paintBrokenBridge(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    center: Point,
    scale: number,
  ): void {
    this.beginSigil(ctx, colors, center, scale);
    ctx.lineWidth = 2;
    for (const x of [-5, 5]) {
      ctx.beginPath();
      ctx.moveTo(x, -10);
      ctx.lineTo(x, -2);
      ctx.moveTo(x, 2);
      ctx.lineTo(x, 10);
      ctx.stroke();
    }
    for (const y of [-7, -3, 4, 8]) {
      ctx.beginPath();
      ctx.moveTo(-5, y);
      ctx.lineTo(5, y + (y < 0 ? 1 : -1));
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintCrown(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    center: Point,
    scale: number,
  ): void {
    this.beginSigil(ctx, colors, center, scale);
    ctx.beginPath();
    ctx.moveTo(-9, -5);
    ctx.lineTo(-5, 2);
    ctx.lineTo(0, -7);
    ctx.lineTo(5, 2);
    ctx.lineTo(9, -5);
    ctx.lineTo(7, 7);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = colors.bossGlow;
    ctx.beginPath();
    ctx.moveTo(-6, 4);
    ctx.lineTo(6, 4);
    ctx.stroke();
    ctx.restore();
  }

  private paintLoreRunes(
    ctx: CanvasRenderingContext2D,
    model: InfernalAbyssMapModel,
    colors: InfernalWorldMapColors,
  ): void {
    for (const lore of model.lore) {
      ctx.save();
      ctx.translate(lore.cx, lore.cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = colors.lore;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = colors.lore;
      ctx.shadowBlur = 5;
      ctx.fillRect(-5, -5, 10, 10);
      ctx.shadowBlur = 0;
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.rotate(-Math.PI / 4);
      ctx.strokeStyle = colors.parchmentLight;
      ctx.beginPath();
      ctx.moveTo(-2, -4);
      ctx.lineTo(2, 0);
      ctx.lineTo(-2, 4);
      ctx.stroke();
      ctx.restore();
    }
  }

  private paintCompassRose(
    ctx: CanvasRenderingContext2D,
    colors: InfernalWorldMapColors,
    size: number,
  ): void {
    const x = size - BORDER_INSET - COMPASS_RADIUS - 10;
    const y = BORDER_INSET + COMPASS_RADIUS + 14;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = colors.ink;
    ctx.fillStyle = colors.glyph;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.88;
    ctx.beginPath();
    ctx.arc(0, 0, COMPASS_RADIUS, 0, FULL_CIRCLE);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 4);
      const longRay = i % 2 === 0;
      ctx.beginPath();
      ctx.moveTo(0, longRay ? -COMPASS_RADIUS - 4 : -COMPASS_RADIUS + 4);
      ctx.lineTo(longRay ? 3 : 2, 0);
      ctx.lineTo(0, longRay ? 7 : 4);
      ctx.lineTo(longRay ? -3 : -2, 0);
      ctx.closePath();
      if (i === 0) ctx.fill();
      else ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = colors.bossGlow;
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, FULL_CIRCLE);
    ctx.fill();
    ctx.restore();
  }

  private paintLiveMarkers(
    ctx: CanvasRenderingContext2D,
    model: InfernalAbyssMapModel,
    colors: InfernalWorldMapColors,
    classColor: (cls: string) => string,
  ): void {
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 2;
    for (const mob of model.mobs) {
      ctx.fillStyle = mob.aggro ? colors.mobAggro : colors.mob;
      ctx.beginPath();
      ctx.arc(mob.cx, mob.cy, MOB_RADIUS, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.stroke();
      if (mob.aggro) {
        ctx.strokeStyle = colors.lavaCore;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(mob.cx, mob.cy, MOB_RADIUS + 3, 0, FULL_CIRCLE);
        ctx.stroke();
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = 2;
      }
    }
    for (const member of model.party) {
      ctx.fillStyle = member.dead ? colors.partyDead : classColor(member.cls);
      ctx.beginPath();
      ctx.arc(member.cx, member.cy, PARTY_RADIUS, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.parchmentLight;
      ctx.beginPath();
      ctx.arc(member.cx, member.cy, 1.5, 0, FULL_CIRCLE);
      ctx.fill();
    }
    if (model.corpse) this.paintCorpseMarker(ctx, model.corpse, colors);

    ctx.save();
    ctx.translate(model.player.cx, model.player.cy);
    ctx.rotate(model.player.angle);
    ctx.fillStyle = colors.player;
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_BACK + 4, 0, FULL_CIRCLE);
    ctx.globalAlpha = 0.22;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(0, PLAYER_TIP);
    ctx.lineTo(PLAYER_BACK, -PLAYER_BACK);
    ctx.lineTo(0, -PLAYER_BACK + 3);
    ctx.lineTo(-PLAYER_BACK, -PLAYER_BACK);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private paintCorpseMarker(
    ctx: CanvasRenderingContext2D,
    corpse: { cx: number; cy: number },
    colors: InfernalWorldMapColors,
  ): void {
    ctx.save();
    ctx.translate(corpse.cx, corpse.cy);
    ctx.fillStyle = colors.partyDead;
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, -1, CORPSE_RADIUS, 0, FULL_CIRCLE);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colors.voidCore;
    for (const x of [-2.5, 2.5]) {
      ctx.beginPath();
      ctx.arc(x, -2, 1.3, 0, FULL_CIRCLE);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-3, 4);
    ctx.lineTo(-3, 7);
    ctx.moveTo(0, 4);
    ctx.lineTo(0, 7);
    ctx.moveTo(3, 4);
    ctx.lineTo(3, 7);
    ctx.stroke();
    ctx.restore();
  }
}
