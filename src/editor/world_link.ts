// World-rect pickers: drag the map's outline over the built-in world map.
// Two dialogs share the canvas/drag core:
//   - Link to World (map_doc.ts `worldAnchor`): where the map EMBEDS during
//     playtest (custom_map.ts linkedWorldContent).
//   - Generate Terrain (map_doc.ts `terrainBase`): which region of the old
//     world layout the map's base heightfield samples (world.ts terrainHeight
//     authored branch).
//
// The world image prefers the baked strip plate (public/map_bg/world_strip.webp,
// the same plate the HUD minimap uses) and falls back to the procedural
// map_terrain painter. The fallback must paint the BUILT-IN world while the
// editor's active content is the custom map, so it swaps the active world for
// the synchronous paint and restores it before returning (single-threaded and
// exception-safe; nothing samples terrain mid-call).

import {
  getActiveWorldContent,
  setActiveWorldContent,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
} from '../sim/data';
import { t } from '../ui/i18n';
import { loadBakedMapBg } from '../ui/map_bg';
import { mapCanvasHeight, paintTerrainRows } from '../ui/map_terrain';
import { type CustomMap, mapBounds } from './custom_map';
import { button, el } from './dom';
import { buildModal } from './toasts';

/** The shipped world's terrain seed (main.ts WORLD_SEED; custom docs carry the
 *  same value as their meta seed), only used by the procedural fallback. */
const BUILTIN_WORLD_SEED = 20061;

/** Internal canvas width in px; height follows the world strip's aspect. */
const CANVAS_W = 220;

/** The gold outline + spawn dot styling. */
const RECT_STROKE = '#f5c944';
const RECT_FILL = 'rgba(245, 201, 68, 0.18)';
const SPAWN_DOT = '#7fd4ff';
const RECT_LINE_WIDTH = 2;
const SPAWN_DOT_RADIUS = 3;

export type WorldRectOutcome =
  | { action: 'save'; anchor: { x: number; z: number } }
  | { action: 'clear' }
  | { action: 'cancel' };

interface WorldRectPickerOpts {
  title: string;
  hint: string;
  dragHint: string;
  /** Status line under the canvas, fed the live anchor. */
  status(x: number, z: number): string;
  saveLabel: string;
  /** Secondary destructive action (Unlink / Flatten); omitted = not shown. */
  clearLabel?: string;
  initial: { x: number; z: number };
  /** Extra placeable ocean band (yards) around the shipped world on every
   *  side: lets a linked map sit beyond the old world's edges and GROW the
   *  world (its own terrain rises from the sea there). 0 = shipped bounds. */
  expandMargin?: number;
}

/** Shared canvas + drag core for both pickers. */
function worldRectPicker(
  parent: HTMLElement,
  map: CustomMap,
  opts: WorldRectPickerOpts,
): Promise<WorldRectOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: WorldRectOutcome): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const modal = buildModal(parent, opts.title, () => settle({ action: 'cancel' }));
    const panel = modal.panel;
    panel.appendChild(el('p', 'ed-modal-body', opts.hint));

    // The placeable region: the shipped world, plus an optional ocean band on
    // every side so a linked map can sit beyond the old edges (new land).
    // A map WIDER/TALLER than that region would collapse the anchor clamp to
    // a single point (the rect could never move off the origin, "locked at
    // the standard spawn"), so the region also grows to fit the map's own
    // rect plus the full band of freedom on every side.
    const margin = opts.expandMargin ?? 0;
    const { halfW: rectHalfW, zMin: rectZMin, zMax: rectZMax } = mapBounds(map);
    const worldRegion = {
      minX: Math.min(WORLD_MIN_X - margin, -rectHalfW - margin),
      maxX: Math.max(WORLD_MAX_X + margin, rectHalfW + margin),
      minZ: Math.min(WORLD_MIN_Z - margin, rectZMin - margin),
      maxZ: Math.max(WORLD_MAX_Z + margin, rectZMax + margin),
    };
    const spanX = worldRegion.maxX - worldRegion.minX;
    const spanZ = worldRegion.maxZ - worldRegion.minZ;
    const W = CANVAS_W;
    const H = mapCanvasHeight(W, worldRegion);
    // The shipped strip's sub-rect inside the (possibly margin-extended)
    // canvas, the plate/procedural paint covers only this; the band around
    // it stays open sea.
    const stripX = ((worldRegion.maxX - WORLD_MAX_X) / spanX) * W;
    const stripY = ((worldRegion.maxZ - WORLD_MAX_Z) / spanZ) * H;
    const stripW = ((WORLD_MAX_X - WORLD_MIN_X) / spanX) * W;
    const stripH = ((WORLD_MAX_Z - WORLD_MIN_Z) / spanZ) * H;

    // The world image, painted once into an offscreen canvas. The plate load
    // itself is kicked off at the BOTTOM of this constructor: a cached plate
    // fires onReady SYNCHRONOUSLY, and calling draw() before the closure below
    // finishes building crashed the whole dialog on every open after the first
    // (title + hint, then nothing).
    const bg = document.createElement('canvas');
    bg.width = W;
    bg.height = H;
    const bgCtx = bg.getContext('2d');
    if (bgCtx) {
      bgCtx.fillStyle = '#163058'; // the painter's deep-sea tone
      bgCtx.fillRect(0, 0, W, H);
    }

    // The map rect (map-local) and the live anchor being dragged.
    const { halfW, zMin, zMax } = mapBounds(map);
    const anchor = { ...opts.initial };
    const start = map.playerStart ?? { x: 0, z: 0 };

    // World <-> canvas mapping (the map painters' convention: +X is map-LEFT,
    // +Z is map-UP on screen, so maxX/maxZ sit at the canvas origin).
    const toPx = (x: number, z: number): { mx: number; my: number } => ({
      mx: ((worldRegion.maxX - x) / spanX) * W,
      my: ((worldRegion.maxZ - z) / spanZ) * H,
    });
    const toWorld = (mx: number, my: number): { x: number; z: number } => ({
      x: worldRegion.maxX - (mx / W) * spanX,
      z: worldRegion.maxZ - (my / H) * spanZ,
    });
    const clampAnchor = (): void => {
      anchor.x = Math.max(worldRegion.minX + halfW, Math.min(worldRegion.maxX - halfW, anchor.x));
      anchor.z = Math.max(worldRegion.minZ - zMin, Math.min(worldRegion.maxZ - zMax, anchor.z));
    };
    clampAnchor();

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.className = 'ed-worldlink-canvas';
    canvas.style.maxHeight = '58vh';
    canvas.style.width = 'auto';
    canvas.style.cursor = 'grab';
    canvas.style.display = 'block';
    canvas.style.margin = '8px auto';
    canvas.style.border = '1px solid rgba(255,255,255,0.15)';
    canvas.style.borderRadius = '4px';
    // Without this, a real pointer drag can be hijacked by the browser's
    // default gestures (image drag / scroll) and the rect never moves.
    canvas.style.touchAction = 'none';
    canvas.draggable = false;
    const ctx = canvas.getContext('2d');

    const status = el('p', 'ed-hint', '');
    const syncStatus = (): void => {
      status.textContent = opts.status(Math.round(anchor.x), Math.round(anchor.z));
    };

    const draw = (): void => {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(bg, 0, 0);
      // The map's rect at the anchor. X flips (map-left = +X), so the RIGHT
      // world edge (anchor.x + halfW) is the LEFT canvas edge of the rect.
      const a = toPx(anchor.x + halfW, anchor.z + zMax);
      const b = toPx(anchor.x - halfW, anchor.z + zMin);
      const rx = Math.min(a.mx, b.mx);
      const ry = Math.min(a.my, b.my);
      const rw = Math.abs(b.mx - a.mx);
      const rh = Math.abs(b.my - a.my);
      ctx.fillStyle = RECT_FILL;
      ctx.strokeStyle = RECT_STROKE;
      ctx.lineWidth = RECT_LINE_WIDTH;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      // The playtest spawn point inside the rect.
      const sp = toPx(start.x + anchor.x, start.z + anchor.z);
      ctx.fillStyle = SPAWN_DOT;
      ctx.beginPath();
      ctx.arc(sp.mx, sp.my, SPAWN_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      syncStatus();
    };

    // Drag the rect (grab anywhere inside it; the grab point keeps its offset).
    let grab: { dx: number; dz: number } | null = null;
    const pointerWorld = (ev: PointerEvent): { x: number; z: number } => {
      const r = canvas.getBoundingClientRect();
      const mx = ((ev.clientX - r.left) / r.width) * W;
      const my = ((ev.clientY - r.top) / r.height) * H;
      return toWorld(mx, my);
    };
    canvas.addEventListener('pointerdown', (ev) => {
      const p = pointerWorld(ev);
      const insideX = p.x >= anchor.x - halfW && p.x <= anchor.x + halfW;
      const insideZ = p.z >= anchor.z + zMin && p.z <= anchor.z + zMax;
      // Grab the rect where it stands, or jump it to a click elsewhere: both
      // read naturally when placing a small rect on a large world.
      grab = insideX && insideZ ? { dx: p.x - anchor.x, dz: p.z - anchor.z } : { dx: 0, dz: 0 };
      if (!(insideX && insideZ)) {
        anchor.x = p.x;
        anchor.z = p.z;
        clampAnchor();
        draw();
      }
      canvas.setPointerCapture(ev.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!grab) return;
      const p = pointerWorld(ev);
      anchor.x = p.x - grab.dx;
      anchor.z = p.z - grab.dz;
      clampAnchor();
      draw();
    });
    const release = (): void => {
      grab = null;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    panel.appendChild(canvas);
    panel.appendChild(el('p', 'ed-hint', opts.dragHint));
    panel.appendChild(status);

    const actions = el('div', 'ed-modal-actions');
    actions.appendChild(
      button(
        opts.saveLabel,
        () => {
          settle({ action: 'save', anchor: { x: Math.round(anchor.x), z: Math.round(anchor.z) } });
          modal.close();
        },
        'primary',
      ),
    );
    if (opts.clearLabel) {
      actions.appendChild(
        button(opts.clearLabel, () => {
          settle({ action: 'clear' });
          modal.close();
        }),
      );
    }
    actions.appendChild(
      button(t('editor.worldLink.cancel'), () => {
        settle({ action: 'cancel' });
        modal.close();
      }),
    );
    panel.appendChild(actions);

    draw();
    // Kick the plate load LAST: with a warm cache onReady fires synchronously,
    // and everything it touches (bgCtx, draw) is fully built by now.
    loadBakedMapBg(
      'world_strip',
      (img) => {
        bgCtx?.drawImage(img, stripX, stripY, stripW, stripH);
        draw();
      },
      () => {
        // Procedural fallback: paint the BUILT-IN world (swap-restore the
        // active content around the synchronous paint).
        if (!bgCtx) return;
        const current = getActiveWorldContent();
        const pw = Math.max(1, Math.round(stripW));
        const ph = Math.max(1, Math.round(stripH));
        try {
          setActiveWorldContent(null);
          const img = bgCtx.createImageData(pw, ph);
          paintTerrainRows(
            img.data as unknown as Uint8ClampedArray,
            pw,
            ph,
            { minX: WORLD_MIN_X, maxX: WORLD_MAX_X, minZ: WORLD_MIN_Z, maxZ: WORLD_MAX_Z },
            BUILTIN_WORLD_SEED,
            0,
            ph,
          );
          bgCtx.putImageData(img, Math.round(stripX), Math.round(stripY));
        } finally {
          setActiveWorldContent(current);
        }
        draw();
      },
    );
  });
}

export type WorldLinkOutcome =
  | { action: 'save'; anchor: { x: number; z: number } }
  | { action: 'unlink' }
  | { action: 'cancel' };

/** Link to World: pick where the map EMBEDS in the world during playtest. */
/** How much open sea around the shipped world stays placeable (yards per
 *  side): linking out there GROWS the world, the map's terrain rises from
 *  the sea as new land (terrainHeight linkedMap override + the open-sea
 *  fatigue exemption). */
const WORLD_LINK_EXPAND_MARGIN = 700;

export async function worldLinkDialog(
  parent: HTMLElement,
  map: CustomMap,
): Promise<WorldLinkOutcome> {
  const outcome = await worldRectPicker(parent, map, {
    title: t('editor.worldLink.title'),
    hint: t('editor.worldLink.hint'),
    dragHint: t('editor.worldLink.dragHint'),
    status: (x, z) => t('editor.worldLink.statusLinked', { x, z }),
    saveLabel: t('editor.worldLink.save'),
    clearLabel: map.worldAnchor ? t('editor.worldLink.unlink') : undefined,
    initial: map.worldAnchor ?? { x: 0, z: 0 },
    expandMargin: WORLD_LINK_EXPAND_MARGIN,
  });
  if (outcome.action === 'clear') return { action: 'unlink' };
  return outcome;
}

/** Generate Terrain: pick which region of the old world layout the map's base
 *  heightfield samples. The caller applies terrainBase + clears sculpt edits. */
export function generateTerrainDialog(
  parent: HTMLElement,
  map: CustomMap,
): Promise<WorldRectOutcome> {
  return worldRectPicker(parent, map, {
    title: t('editor.genTerrain.title'),
    hint: t('editor.genTerrain.hint'),
    dragHint: t('editor.genTerrain.dragHint'),
    status: (x, z) => t('editor.genTerrain.status', { x, z }),
    saveLabel: t('editor.genTerrain.save'),
    clearLabel: map.terrainBase ? t('editor.genTerrain.clear') : undefined,
    initial: map.terrainBase ?? { x: 0, z: 0 },
  });
}
