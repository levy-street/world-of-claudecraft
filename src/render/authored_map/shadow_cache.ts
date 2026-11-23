// Editor-only shadow cache, moved out of renderer.ts: while the free-cam
// viewport is active, park the shadow pass (shadowMap.autoUpdate = false) and
// re-render it only when the sun target drifts, the key light swings (time of
// day), an edit poked invalidate(), or the slow heartbeat elapses (animated
// NPCs/mobs). Everything else renders against the cached map, in a parked
// editor scene that skips re-drawing every caster nearly every frame. Playtest
// and the shipped game (no editor camera) keep the stock every-frame behavior.

import * as THREE from 'three';
import { EDITOR_SHADOW_MAP_MAX, shadowCacheStale } from './shadow_cache_core';

export class EditorShadowCache {
  private dirty = true;
  private age = 0;
  private tierApplied = false;
  private readonly center = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly dir = new THREE.Vector3();
  private readonly dirTmp = new THREE.Vector3();

  /** Mark the cached map stale, so the next frame re-renders the shadow pass
   *  once. No-op outside the editor free-cam. */
  invalidate(): void {
    this.dirty = true;
  }

  update(
    map: THREE.WebGLShadowMap,
    sun: THREE.DirectionalLight,
    editorActive: boolean,
    dt: number,
  ): void {
    if (!editorActive || !map.enabled) {
      if (!map.autoUpdate) {
        map.autoUpdate = true;
        map.needsUpdate = true;
        this.dirty = true;
      }
      return;
    }
    if (map.autoUpdate) {
      // Entering editor mode: park the pass, and cap the map one tier down
      // once (the reallocation happens inside the next shadow render).
      map.autoUpdate = false;
      this.dirty = true;
      if (!this.tierApplied) {
        this.tierApplied = true;
        if (sun.shadow.mapSize.x > EDITOR_SHADOW_MAP_MAX) {
          sun.shadow.mapSize.set(EDITOR_SHADOW_MAP_MAX, EDITOR_SHADOW_MAP_MAX);
          sun.shadow.map?.dispose();
          sun.shadow.map = null;
        }
      }
    }
    this.age += dt;
    const dir = this.dirTmp.subVectors(sun.position, sun.target.position).normalize();
    const stale = shadowCacheStale(
      this.dirty,
      this.age,
      sun.target.position.distanceToSquared(this.center),
      dir.dot(this.dir),
    );
    if (!stale) return;
    map.needsUpdate = true;
    this.dirty = false;
    this.age = 0;
    this.center.copy(sun.target.position);
    this.dir.copy(dir);
  }
}
