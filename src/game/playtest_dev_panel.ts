// The playtest DEV panel: a pinned "Dev" button (next to Back to Editor)
// opening the map-maker's cheat drawer. Everything reads window.__game lazily
// (set once the world is entered), inline-styled on <body> like the return
// button so it needs no HUD CSS and survives the game's screens.
//
// Cheats:
// - Collision wireframe: the SIM'S resolved colliders drawn live around the
//   player (render/collision_debug.ts), the ground truth the editor's
//   hitbox overlay must agree with.
// - God mode: hp pinned to max (offline sim only, which playtest always is).
// - Speed x3: wraps sim.moveSpeedMult (the deps bind it late, so the wrap
//   takes effect immediately and unwraps cleanly).
// - Dev badges: the renderer's built-in perf/debug badges.
import type * as THREE from 'three';
import {
  auditCollisionAround,
  buildCollisionWireframe,
  describeNearbyColliders,
  disposeCollisionWireframe,
  resetCollisionDebugCache,
} from '../render/collision_debug';
import { moverHeight, resolvePosition } from '../sim/colliders';
import { PLAYER_MAX_CLIMB_SLOPE } from '../sim/pathfind';
import { rideSteepnessAt } from '../sim/ride_height';

interface DevGame {
  sim: {
    cfg: { seed: number };
    player: {
      hp: number;
      maxHp: number;
      onGround: boolean;
      pos: { x: number; y: number; z: number };
    };
    moveSpeedMult(e: unknown): number;
  };
  renderer: { scene: THREE.Group; showDevBadges: boolean };
}

function game(): DevGame | null {
  return (window as unknown as { __game?: DevGame }).__game ?? null;
}

const WIREFRAME_RADIUS = 50;
const WIREFRAME_REFRESH_MS = 1200;
const WIREFRAME_MOVE = 15;
const BLOCKER_REFRESH_MS = 600;

export function mountPlaytestDevPanel(): void {
  if (document.getElementById('playtest-dev')) return;
  const btn = document.createElement('button');
  btn.id = 'playtest-dev';
  btn.type = 'button';
  btn.textContent = 'Dev';
  btn.title = 'Map-maker dev cheats';
  btn.style.cssText =
    'position:fixed;top:10px;right:140px;z-index:1000;padding:6px 12px;' +
    'background:rgba(18,14,10,0.85);color:var(--gold, #ffd100);' +
    'border:1px solid var(--border, #6b5a36);border-radius:6px;' +
    'font-family:inherit;font-size:13px;cursor:pointer;';

  const panel = document.createElement('div');
  panel.id = 'playtest-dev-panel';
  panel.style.cssText =
    'position:fixed;top:44px;right:140px;z-index:1000;padding:10px 12px;display:none;' +
    'background:rgba(18,14,10,0.92);color:#e8dcc0;min-width:200px;' +
    'border:1px solid var(--border, #6b5a36);border-radius:6px;' +
    'font-family:inherit;font-size:13px;line-height:1.9;';
  btn.onclick = () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  };

  // ---- collision wireframe -------------------------------------------------
  let wireGroup: THREE.Group | null = null;
  let wireTimer = 0;
  let wireLastX = Infinity;
  let wireLastZ = Infinity;
  let wireLastY = Infinity;
  const dropWire = (): void => {
    const g = game();
    if (wireGroup && g) g.renderer.scene.remove(wireGroup);
    if (wireGroup) disposeCollisionWireframe(wireGroup);
    wireGroup = null;
  };
  const refreshWire = (force = false): void => {
    const g = game();
    if (!g) return;
    const { x, y, z } = g.sim.player.pos;
    // Height matters as much as ground distance here: the active/passive
    // split is computed for the body's own height, so climbing a stair or
    // dropping off a ledge has to redraw even when standing still.
    if (
      !force &&
      Math.hypot(x - wireLastX, z - wireLastZ) < WIREFRAME_MOVE &&
      Math.abs(y - wireLastY) < 1
    ) {
      return;
    }
    wireLastX = x;
    wireLastZ = z;
    wireLastY = y;
    dropWire();
    wireGroup = buildCollisionWireframe(
      g.sim.cfg.seed,
      x,
      z,
      WIREFRAME_RADIUS,
      (px, pz) => rideSteepnessAt(px, pz, g.sim.cfg.seed) > PLAYER_MAX_CLIMB_SLOPE,
    );
    g.renderer.scene.add(wireGroup);
  };

  // ---- god mode ------------------------------------------------------------
  let godTimer = 0;

  // ---- speed ---------------------------------------------------------------
  let baseSpeedMult: ((e: unknown) => number) | null = null;

  const row = (label: string, onToggle: (on: boolean) => void): HTMLElement => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;gap:8px;align-items:center;cursor:pointer;';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.onchange = () => onToggle(box.checked);
    const text = document.createElement('span');
    text.textContent = label;
    wrap.append(box, text);
    return wrap;
  };

  panel.append(
    row('Collision wireframe', (on) => {
      if (on) {
        resetCollisionDebugCache();
        refreshWire(true);
        wireTimer = window.setInterval(() => refreshWire(), WIREFRAME_REFRESH_MS);
      } else {
        window.clearInterval(wireTimer);
        dropWire();
      }
    }),
    row('God mode', (on) => {
      if (on) {
        godTimer = window.setInterval(() => {
          const g = game();
          if (g) g.sim.player.hp = g.sim.player.maxHp;
        }, 400);
      } else {
        window.clearInterval(godTimer);
      }
    }),
    row('Speed x3', (on) => {
      const g = game();
      if (!g) return;
      if (on && !baseSpeedMult) {
        baseSpeedMult = g.sim.moveSpeedMult.bind(g.sim);
        g.sim.moveSpeedMult = (e: unknown) => (baseSpeedMult as (e: unknown) => number)(e) * 3;
      } else if (!on && baseSpeedMult) {
        g.sim.moveSpeedMult = baseSpeedMult;
        baseSpeedMult = null;
      }
    }),
    row('Dev badges', (on) => {
      const g = game();
      if (g) g.renderer.showDevBadges = on;
    }),
  );

  // ---- nearby blockers readout --------------------------------------------
  // Names the collider you are pressed against: src stamp = model path + lane
  // ("#prism" Collision Master volumes, "#baked" boxes, "#hitboxes" hand
  // edits, "#circle"/"#square" legacy footprints); "builtin ..." = a record
  // collider from the shipped world, i.e. NOT driven by your placement.
  let blockTimer = 0;
  const blockOut = document.createElement('div');
  blockOut.style.cssText =
    'margin-top:6px;padding-top:6px;border-top:1px solid rgba(107,90,54,0.6);' +
    'font-size:11px;line-height:1.5;max-width:280px;word-break:break-all;display:none;';
  panel.append(
    row('Nearby blockers', (on) => {
      if (on) {
        blockOut.style.display = 'block';
        blockOut.textContent = '…';
        blockTimer = window.setInterval(() => {
          const g = game();
          if (!g) return;
          const { x, y, z } = g.sim.player.pos;
          const lines = describeNearbyColliders(g.sim.cfg.seed, x, z, y);
          blockOut.textContent = lines.length ? lines.slice(0, 6).join('\n') : '(nothing in reach)';
          blockOut.style.whiteSpace = 'pre-line';
        }, BLOCKER_REFRESH_MS);
      } else {
        window.clearInterval(blockTimer);
        blockOut.style.display = 'none';
      }
    }),
    blockOut,
  );

  // ---- collision self-test -------------------------------------------------
  // Answers "does it block where the wireframe says" with data, right where
  // the maker is standing: it compares the SIM'S resolver against the DRAWN
  // outlines cell by cell and names any collider that disagrees.
  const auditOut = document.createElement('div');
  auditOut.style.cssText =
    'margin-top:6px;padding-top:6px;border-top:1px solid rgba(107,90,54,0.6);' +
    'font-size:11px;line-height:1.5;max-width:280px;word-break:break-all;display:none;white-space:pre-line;';
  const auditBtn = document.createElement('button');
  auditBtn.type = 'button';
  auditBtn.textContent = 'Test collision here';
  auditBtn.style.cssText =
    'margin-top:8px;width:100%;padding:5px 8px;background:rgba(60,48,28,0.9);' +
    'color:var(--gold, #ffd100);border:1px solid var(--border, #6b5a36);' +
    'border-radius:4px;font-family:inherit;font-size:12px;cursor:pointer;';
  auditBtn.onclick = () => {
    const g = game();
    if (!g) return;
    auditOut.style.display = 'block';
    auditOut.textContent = 'checking…';
    // Next frame, so the "checking…" paint lands before the sweep blocks.
    window.setTimeout(() => {
      const { x, y, z } = g.sim.player.pos;
      const mover = moverHeight(g.sim.player);
      const lines = auditCollisionAround(g.sim.cfg.seed, x, z, y, (px, pz, r) =>
        resolvePosition(g.sim.cfg.seed, px, pz, r, false, undefined, mover),
      );
      // The position leads: it is what makes a report reproducible off-line.
      const here = `at ${x.toFixed(1)}, ${z.toFixed(1)} (y ${y.toFixed(1)})`;
      const blockers = describeNearbyColliders(g.sim.cfg.seed, x, z, y, 3.5);
      auditOut.textContent = [
        here,
        ...lines,
        blockers.length ? 'touching: ' + blockers.slice(0, 3).join(' | ') : 'touching: nothing',
      ].join('\n');
    }, 30);
  };
  panel.append(auditBtn, auditOut);

  document.body.append(btn, panel);
}
