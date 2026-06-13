import { WORLD_MAX_X, WORLD_MIN_X, ZONES, zoneAt } from '../sim/data';
import { roadDistance, terrainHeight, WATER_LEVEL } from '../sim/world';

type PlayerStatus = 'online' | 'combat' | 'dungeon' | 'dead';

interface LiveMapPlayer {
  name: string;
  class: string;
  level: number;
  x: number;
  z: number;
  facing: number;
  realm: string;
  zone: string;
  status: PlayerStatus;
  inDungeon: boolean;
  dungeonId: string | null;
  dungeonName: string | null;
  mapX: number;
  mapZ: number;
  sessionSeconds: number;
}

interface LiveMapZone {
  id: string;
  name: string;
  zMin: number;
  zMax: number;
  levelRange: [number, number];
  biome: string;
  hub: { x: number; z: number; radius: number; name: string };
  graveyard: { x: number; z: number };
  lakes: { x: number; z: number; radius: number }[];
  pois: { x: number; z: number; label: string }[];
}

interface LiveMapData {
  realm: string;
  generatedAt: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  zones: LiveMapZone[];
  dungeons: { id: string; name: string; doorPos: { x: number; z: number }; suggestedPlayers: number }[];
  players: LiveMapPlayer[];
}

interface LiveMapView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const CLASS_COLOR: Record<string, string> = {
  warrior: '#c79c6e',
  paladin: '#f58cba',
  hunter: '#abd473',
  rogue: '#fff569',
  priest: '#ffffff',
  shaman: '#5f9bef',
  mage: '#69ccf0',
  warlock: '#9482c9',
  druid: '#ff7d0a',
};

const WORLD_SEED = 20061;
const MIN_MAP_SCALE = 1;
const MAX_MAP_SCALE = 4;
let staticLayerCache: { key: string; canvas: HTMLCanvasElement } | null = null;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

function statusLabel(p: LiveMapPlayer): string {
  if (p.status === 'dead') return 'Dead';
  if (p.status === 'combat') return 'Combat';
  if (p.inDungeon) return p.dungeonName ?? 'Dungeon';
  return 'Online';
}

function playerColor(p: LiveMapPlayer): string {
  if (p.status === 'dead') return '#929292';
  if (p.status === 'combat') return '#ff5d4d';
  if (p.inDungeon) return '#c084ff';
  return CLASS_COLOR[p.class] ?? '#ffd100';
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function mapFrame(width: number, height: number): { x: number; y: number; w: number; h: number; cx: number; cy: number } {
  const x = 40;
  const y = 18;
  const w = width - 80;
  const h = height - 36;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

function clampView(view: LiveMapView, width: number, height: number): void {
  view.scale = clamp(view.scale, MIN_MAP_SCALE, MAX_MAP_SCALE);
  const frame = mapFrame(width, height);
  const maxX = (frame.w * (view.scale - 1)) / 2;
  const maxY = (frame.h * (view.scale - 1)) / 2;
  view.offsetX = clamp(view.offsetX, -maxX, maxX);
  view.offsetY = clamp(view.offsetY, -maxY, maxY);
}

function toCanvas(data: LiveMapData, width: number, height: number, x: number, z: number): { x: number; y: number } {
  const spanX = data.bounds.maxX - data.bounds.minX;
  const spanZ = data.bounds.maxZ - data.bounds.minZ;
  const padX = 58;
  const padY = 30;
  const mapW = width - padX * 2;
  const mapH = height - padY * 2;
  return {
    x: padX + ((data.bounds.maxX - x) / spanX) * mapW,
    y: padY + ((data.bounds.maxZ - z) / spanZ) * mapH,
  };
}

// Matches Hud.renderTerrainCanvas so the public Live Map uses the same map art
// as the in-game map window, just stitched into one full-realm sheet.
function renderTerrainCanvas(W: number, region: { minX: number; maxX: number; minZ: number; maxZ: number }): HTMLCanvasElement {
  const spanX = region.maxX - region.minX;
  const spanZ = region.maxZ - region.minZ;
  const H = Math.round(W * spanZ / spanX);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let iy = 0; iy < H; iy++) {
    for (let ix = 0; ix < W; ix++) {
      const x = region.maxX - (ix / W) * spanX;
      const z = region.maxZ - (iy / H) * spanZ;
      const h = terrainHeight(x, z, WORLD_SEED);
      const biome = zoneAt(z).biome;
      let r = 58, g = 105, b = 48;
      if (biome === 'marsh') { r = 64; g = 86; b = 48; }
      else if (biome === 'peaks') { r = 92; g = 100; b = 82; }
      if (h < WATER_LEVEL) { r = 38; g = 84; b = 138; }
      else if (h > 26) { r = 168; g = 172; b = 178; }
      else if (h > 11) { r = 112; g = 110; b = 102; }
      else if (h > 6) { r = 88; g = 102; b = 62; }
      let nearHub = false;
      for (const zn of ZONES) {
        if (Math.hypot(x - zn.hub.x, z - zn.hub.z) < 14) { nearHub = true; break; }
      }
      if (nearHub) { r = 125; g = 100; b = 66; }
      else if (h >= WATER_LEVEL && roadDistance(x, z) < 2.4) { r = 138; g = 111; b = 71; }
      const k = (iy * W + ix) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = 'center'): void {
  ctx.textAlign = align;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#020204';
  ctx.fillStyle = '#f3dfad';
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function drawZone(ctx: CanvasRenderingContext2D, data: LiveMapData, zone: LiveMapZone, width: number, height: number): void {
  const top = toCanvas(data, width, height, 0, zone.zMax).y;
  const bottom = toCanvas(data, width, height, 0, zone.zMin).y;
  const left = toCanvas(data, width, height, data.bounds.maxX, zone.zMin).x;
  const right = toCanvas(data, width, height, data.bounds.minX, zone.zMin).x;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.strokeStyle = '#6f5a2a';
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, right - left, bottom - top);

  const hub = toCanvas(data, width, height, zone.hub.x, zone.hub.z);
  ctx.fillStyle = '#d0ad52';
  ctx.strokeStyle = '#241800';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hub.x, hub.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const grave = toCanvas(data, width, height, zone.graveyard.x, zone.graveyard.z);
  ctx.fillStyle = '#b6bcc5';
  ctx.fillRect(grave.x - 3, grave.y - 5, 6, 10);

  ctx.font = 'bold 15px Georgia';
  drawLabel(ctx, `${zone.name} (${zone.levelRange[0]}-${zone.levelRange[1]})`, (left + right) / 2, top + 21);

  ctx.font = '11px Arial';
  for (const poi of zone.pois) {
    const p = toCanvas(data, width, height, poi.x, poi.z);
    ctx.fillStyle = '#d8c89a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    drawLabel(ctx, poi.label, p.x, p.y - 6);
  }
}

function drawRealmTerrain(ctx: CanvasRenderingContext2D, data: LiveMapData, width: number, height: number): void {
  const left = toCanvas(data, width, height, data.bounds.maxX, data.bounds.minZ).x;
  const right = toCanvas(data, width, height, data.bounds.minX, data.bounds.minZ).x;
  const top = toCanvas(data, width, height, 0, data.bounds.maxZ).y;
  const bottom = toCanvas(data, width, height, 0, data.bounds.minZ).y;
  const terrain = renderTerrainCanvas(540, {
    minX: data.bounds.minX,
    maxX: data.bounds.maxX,
    minZ: data.bounds.minZ,
    maxZ: data.bounds.maxZ,
  });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(terrain, left, top, right - left, bottom - top);
}

function drawPlayers(ctx: CanvasRenderingContext2D, data: LiveMapData, width: number, height: number): void {
  const buckets = new Map<string, LiveMapPlayer[]>();
  for (const p of data.players) {
    const key = `${Math.round(p.mapX * 2) / 2},${Math.round(p.mapZ * 2) / 2}`;
    const group = buckets.get(key) ?? [];
    group.push(p);
    buckets.set(key, group);
  }

  for (const group of buckets.values()) {
    group.forEach((p, index) => {
      const base = toCanvas(data, width, height, p.mapX, p.mapZ);
      const angle = (Math.PI * 2 * index) / Math.max(1, group.length);
      const spread = group.length > 1 ? 10 : 0;
      const x = base.x + Math.cos(angle) * spread;
      const y = base.y + Math.sin(angle) * spread;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-p.facing);
      ctx.fillStyle = playerColor(p);
      ctx.strokeStyle = '#050507';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 7);
      ctx.lineTo(0, 3);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.font = 'bold 11px Arial';
      drawLabel(ctx, p.name, x, y - 12);
    });
  }
}

function staticLayerKey(data: LiveMapData, width: number, height: number): string {
  return JSON.stringify({
    width,
    height,
    bounds: data.bounds,
    zones: data.zones.map((z) => [z.id, z.zMin, z.zMax]),
    dungeons: data.dungeons.map((d) => [d.id, d.doorPos.x, d.doorPos.z]),
  });
}

function renderStaticLayer(data: LiveMapData, width: number, height: number): HTMLCanvasElement {
  const key = staticLayerKey(data, width, height);
  if (staticLayerCache?.key === key) return staticLayerCache.canvas;
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const ctx = layer.getContext('2d')!;

  drawRealmTerrain(ctx, data, width, height);
  for (const zone of data.zones) drawZone(ctx, data, zone, width, height);

  for (const dungeon of data.dungeons) {
    const p = toCanvas(data, width, height, dungeon.doorPos.x, dungeon.doorPos.z);
    ctx.fillStyle = '#c084ff';
    ctx.strokeStyle = '#1a0628';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 11px Arial';
    drawLabel(ctx, dungeon.name, p.x, p.y - 10);
  }

  staticLayerCache = { key, canvas: layer };
  return layer;
}

function paintMapFrame(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const frame = mapFrame(width, height);
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#090a13');
  bg.addColorStop(1, '#020204');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#08080dcc';
  ctx.strokeStyle = '#6f5a2a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, 10);
  ctx.fill();
  ctx.stroke();
}

function drawWorldMap(canvas: HTMLCanvasElement, data: LiveMapData, view: LiveMapView): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  clampView(view, width, height);
  const frame = mapFrame(width, height);
  paintMapFrame(ctx, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frame.x, frame.y, frame.w, frame.h, 10);
  ctx.clip();
  ctx.translate(frame.cx + view.offsetX, frame.cy + view.offsetY);
  ctx.scale(view.scale, view.scale);
  ctx.translate(-frame.cx, -frame.cy);

  ctx.drawImage(renderStaticLayer(data, width, height), 0, 0);
  drawPlayers(ctx, data, width, height);
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd100';
  ctx.font = 'bold 16px Georgia';
  ctx.fillText(`${data.realm} live world`, 52, height - 14);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#a89a73';
  ctx.font = '11px Arial';
  ctx.fillText(`${data.players.length} online`, width - 52, height - 14);
}

function renderSummary(data: LiveMapData): string {
  const inDungeon = data.players.filter((p) => p.inDungeon).length;
  const inCombat = data.players.filter((p) => p.status === 'combat').length;
  const dead = data.players.filter((p) => p.status === 'dead').length;
  const zoneCounts = data.zones.map((z) => {
    const count = data.players.filter((p) => !p.inDungeon && p.mapZ >= z.zMin && p.mapZ < z.zMax).length;
    return `<span>${escapeHtml(z.name)} <b>${count}</b></span>`;
  }).join('');
  return `<div class="live-map-kpis">
    <div><b>${data.players.length}</b><span>online</span></div>
    <div><b>${inCombat}</b><span>combat</span></div>
    <div><b>${inDungeon}</b><span>dungeons</span></div>
    <div><b>${dead}</b><span>dead</span></div>
  </div><div class="live-map-zones">${zoneCounts}</div>`;
}

function renderRoster(players: LiveMapPlayer[]): string {
  if (players.length === 0) return '<div class="live-map-empty">No players online.</div>';
  return players
    .slice()
    .sort((a, b) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name))
    .map((p) => `
      <div class="live-map-player">
        <span class="live-map-dot" style="--dot:${playerColor(p)}"></span>
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <small>${escapeHtml(p.class)} ${p.level} &middot; ${escapeHtml(statusLabel(p))}</small>
        </div>
        <div>
          <span>${escapeHtml(p.zone)}</span>
          <small>${Math.round(p.x)}, ${Math.round(p.z)} &middot; ${fmtDuration(p.sessionSeconds)}</small>
        </div>
      </div>`).join('');
}

export function initLiveMap(): void {
  const launchers = Array.from(document.querySelectorAll<HTMLElement>('[data-live-map-open]'));
  const overlay = $('live-map-overlay');
  const close = $('live-map-close');
  const canvas = $('live-map-canvas') as HTMLCanvasElement;
  const summary = $('live-map-summary');
  const roster = $('live-map-roster');
  const stamp = $('live-map-stamp');
  const error = $('live-map-error');
  const view: LiveMapView = { scale: 1, offsetX: 0, offsetY: 0 };
  let latestData: LiveMapData | null = null;
  let timer: number | null = null;
  let inflight: AbortController | null = null;
  let drag: { pointerId: number; x: number; y: number } | null = null;
  let drawFrame = 0;

  function drawLatest(): void {
    if (!latestData) return;
    drawWorldMap(canvas, latestData, view);
  }

  function scheduleDraw(): void {
    if (drawFrame !== 0) return;
    drawFrame = window.requestAnimationFrame(() => {
      drawFrame = 0;
      drawLatest();
    });
  }

  function canvasPoint(ev: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * canvas.width,
      y: ((ev.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function resetView(): void {
    view.scale = 1;
    view.offsetX = 0;
    view.offsetY = 0;
    scheduleDraw();
  }

  async function refresh(): Promise<void> {
    inflight?.abort();
    inflight = new AbortController();
    try {
      error.textContent = '';
      const res = await fetch('/api/world-map', { cache: 'no-store', signal: inflight.signal });
      if (!res.ok) throw new Error(`map unavailable (${res.status})`);
      const data = await res.json() as LiveMapData;
      latestData = data;
      scheduleDraw();
      summary.innerHTML = renderSummary(data);
      roster.innerHTML = renderRoster(data.players);
      stamp.textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
      error.textContent = err instanceof Error ? err.message : 'Map unavailable.';
    }
  }

  function open(): void {
    overlay.classList.add('open');
    overlay.removeAttribute('aria-hidden');
    void refresh();
    if (timer === null) timer = window.setInterval(() => void refresh(), 2000);
    close.focus();
  }

  function closeMap(): void {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    inflight?.abort();
    if (drawFrame !== 0) window.cancelAnimationFrame(drawFrame);
    drawFrame = 0;
  }

  launchers.forEach((el) => el.addEventListener('click', (e) => {
    e.preventDefault();
    open();
  }));
  close.addEventListener('click', closeMap);
  canvas.addEventListener('wheel', (e) => {
    if (!latestData) return;
    e.preventDefault();
    const frame = mapFrame(canvas.width, canvas.height);
    const p = canvasPoint(e);
    const prevScale = view.scale;
    const nextScale = clamp(prevScale * Math.exp(-e.deltaY * 0.0014), MIN_MAP_SCALE, MAX_MAP_SCALE);
    const logicalX = frame.cx + (p.x - frame.cx - view.offsetX) / prevScale;
    const logicalY = frame.cy + (p.y - frame.cy - view.offsetY) / prevScale;
    view.scale = nextScale;
    view.offsetX = p.x - frame.cx - nextScale * (logicalX - frame.cx);
    view.offsetY = p.y - frame.cy - nextScale * (logicalY - frame.cy);
    scheduleDraw();
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    view.offsetX += ((e.clientX - drag.x) / rect.width) * canvas.width;
    view.offsetY += ((e.clientY - drag.y) / rect.height) * canvas.height;
    drag.x = e.clientX;
    drag.y = e.clientY;
    scheduleDraw();
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    drag = null;
    canvas.classList.remove('dragging');
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* pointer already released */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', resetView);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeMap();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeMap();
  });
}
