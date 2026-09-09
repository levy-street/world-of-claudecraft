// The 2v2 Fiesta bout's three world-space juice pieces: the shrinking
// hazard-ring wall, the floating power-up gems, and the per-entity glow
// swirl a grabbed power-up leaves on its carrier. Split out of renderer.ts
// (src/render/CLAUDE.md, module-first): the state stays a single object the
// coordinator owns (the HUD event handler writes `glows` directly on a
// `fiestaPowerup` event, same object these tick functions mutate), while the
// paint/tick logic lives here as a thin per-frame consumer of it.

import * as THREE from 'three';
import { groundHeight } from '../sim/world';
import type { ArenaInfo } from '../world_api/duel_arena';
import { setRenderCategory } from './renderer_diagnostics';

export interface FiestaEffectsState {
  ring: THREE.Mesh | null;
  powerupMeshes: Map<number, THREE.Mesh>;
  // Per-entity power-up glow: emits a coloured swirl around the carrier until it expires.
  glows: Map<number, { color: number; until: number; nextSwirl: number }>;
}

export function createFiestaEffectsState(): FiestaEffectsState {
  return { ring: null, powerupMeshes: new Map(), glows: new Map() };
}

export interface FiestaEffectsHost {
  readonly scene: THREE.Scene;
  readonly seed: number;
  readonly time: number;
  hasView(id: number): boolean;
  buffSwirl(entityId: number, color: number): void;
}

type FiestaMatch = NonNullable<ArenaInfo['match']>;

// The shrinking hazard-ring wall. Built once on first use, then positioned and
// scaled to the live ring each frame; hidden whenever no Fiesta bout is active.
export function updateFiestaRing(
  state: FiestaEffectsState,
  host: FiestaEffectsHost,
  match: FiestaMatch | null | undefined,
  dt: number,
): void {
  const ring = match?.fiesta?.ring;
  if (!ring || match?.state !== 'active') {
    if (state.ring) state.ring.visible = false;
    return;
  }
  if (!state.ring) {
    const geo = new THREE.CylinderGeometry(1, 1, 8, 48, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff3df0,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    state.ring = new THREE.Mesh(geo, mat);
    setRenderCategory(state.ring, 'vfx');
    host.scene.add(state.ring);
  }
  const m = state.ring;
  m.visible = true;
  const gy = groundHeight(ring.cx, ring.cz, host.seed);
  m.position.set(ring.cx, gy + 3, ring.cz);
  m.scale.set(ring.radius, 1, ring.radius);
  (m.material as THREE.MeshBasicMaterial).opacity = 0.24 + Math.sin(host.time * 4) * 0.08;
  m.rotation.y += dt * 0.35;
}

// Floating power-up gems: a 5s growing/pulsing telegraph while 'spawning',
// then a bright bobbing orb once 'ready'. Pooled by power-up id.
export function updateFiestaPowerups(
  state: FiestaEffectsState,
  host: FiestaEffectsHost,
  match: FiestaMatch | null | undefined,
  dt: number,
): void {
  const list = match?.fiesta && match.state === 'active' ? match.fiesta.powerups : [];
  const seen = new Set<number>();
  for (const p of list) {
    seen.add(p.id);
    let m = state.powerupMeshes.get(p.id);
    if (!m) {
      const geo = new THREE.OctahedronGeometry(0.8, 0);
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      m = new THREE.Mesh(geo, mat);
      setRenderCategory(m, 'vfx');
      state.powerupMeshes.set(p.id, m);
      host.scene.add(m);
    }
    const gy = groundHeight(p.x, p.z, host.seed);
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.color.setHex(p.color);
    if (p.state === 'spawning') {
      m.scale.setScalar(0.25 + p.frac * 0.85);
      m.position.set(p.x, gy + 0.7, p.z);
      mat.opacity = 0.3 + Math.abs(Math.sin(host.time * 9)) * 0.4; // urgent pulse
    } else {
      m.scale.setScalar(1);
      m.position.set(p.x, gy + 1.1 + Math.sin(host.time * 2 + p.id) * 0.25, p.z);
      mat.opacity = 0.9;
    }
    m.rotation.y += dt * 1.6;
  }
  for (const [id, m] of state.powerupMeshes) {
    if (seen.has(id)) continue;
    host.scene.remove(m);
    (m.material as THREE.Material).dispose();
    m.geometry.dispose();
    state.powerupMeshes.delete(id);
  }
}

export function tickFiestaGlows(
  state: FiestaEffectsState,
  host: FiestaEffectsHost,
  dt: number,
): void {
  if (state.glows.size === 0) return;
  for (const [id, g] of state.glows) {
    if (host.time >= g.until || !host.hasView(id)) {
      state.glows.delete(id);
      continue;
    }
    g.nextSwirl -= dt;
    if (g.nextSwirl <= 0) {
      g.nextSwirl = 0.22;
      host.buffSwirl(id, g.color);
    }
  }
}
