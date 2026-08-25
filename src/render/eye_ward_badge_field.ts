// One state badge per warded boss in view, with its lifecycle.
//
// A thin manager so `renderer.ts` gains a call rather than a Map and a cleanup pass. Keyed by
// entity id: a respawn is a new id and gets a new badge, and a despawn disposes one, which is
// what keeps a long session from accumulating billboards for bosses that are gone.

import type * as THREE from 'three';
import { VISUALS, visualKeyFor } from './characters/manifest';
import { EyeWardBadge } from './eye_ward_badge';
import { type EyeWardMarkerPlan, eyeWardBadgeId } from './eye_ward_marker_core';

/**
 * How tall this body is drawn, in world units.
 *
 * The badge floats a multiple of the body's height above its feet, so it needs the DRAWN
 * height (the manifest height times the entity's own scale), not the collider or the model's
 * raw bounds. Falls back to a humanoid-ish 2 units for anything whose visual cannot be
 * resolved, which only puts the badge slightly low rather than dropping it.
 */
export function visualHeightFor(
  e: Parameters<typeof visualKeyFor>[0] & { scale?: number },
): number {
  const key = visualKeyFor(e);
  return (VISUALS[key ?? '']?.height ?? 2) * (e.scale ?? 1);
}

export class EyeWardBadgeField {
  private live = new Map<number, EyeWardBadge>();
  private seen = new Set<number>();

  constructor(private scene: THREE.Object3D) {}

  /** Start a frame. Anything not `mark`ed before `end` is disposed. */
  begin(): void {
    this.seen.clear();
  }

  /**
   * Place this boss's badge for the frame.
   *
   * A null plan, or a plan whose state earns no badge, still MARKS the entity: the badge is
   * kept and hidden rather than disposed, because the states alternate every few seconds
   * during a fight and rebuilding a billboard on each flip would churn a texture binding
   * inside the encounter.
   */
  mark(
    id: number,
    plan: EyeWardMarkerPlan | null,
    pos: { x: number; y: number; z: number },
    height: number,
    camera: THREE.Camera,
    dt: number,
    reducedMotion: boolean,
  ): void {
    this.seen.add(id);
    let badge = this.live.get(id);
    if (!badge) {
      badge = new EyeWardBadge(this.scene);
      this.live.set(id, badge);
    }
    badge.update(
      plan ? eyeWardBadgeId(plan) : null,
      pos,
      height,
      plan?.pulseHz ?? 1,
      camera,
      dt,
      reducedMotion,
    );
  }

  /** Dispose every badge whose entity was not marked this frame. */
  end(): void {
    for (const [id, badge] of this.live) {
      if (this.seen.has(id)) continue;
      badge.dispose();
      this.live.delete(id);
    }
  }

  dispose(): void {
    for (const badge of this.live.values()) badge.dispose();
    this.live.clear();
  }
}
