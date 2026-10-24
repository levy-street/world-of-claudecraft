// The Mirefen world boss's render layer, gathered behind one object the renderer owns so
// the coordinator keeps a handful of call sites instead of three fields and their wiring
// (the monolith ratchet, tests/monolith_budget.test.ts):
//   - fx: the boss's ground layer (balgath_fx.ts: slams, debris, the ranged kit, the
//     Wake of the Fallen Star), whose camera trauma falls off with the CAMERA's distance
//     from each impact, since his slams land all over the zone and a wreck two hundred
//     yards away must not punch the viewer;
//   - far sprites (boss_impostor.ts): a landmark boss stays visible from across the zone
//     as a baked sprite long after his rig has left the entity band;
//   - the eye-ward badges (eye_ward_badge_field.ts): one ward-state badge per warded boss
//     in view, driven by eye_ward_marker_drive.ts.
// It adds no GPU producer of its own: each piece keeps its existing prewarm registration.

import * as THREE from 'three';
import type { Entity } from '../sim/types';
import type { Surface } from './audio_sink';
import { BalgathFx } from './balgath_fx';
import { slamShakeFalloff } from './balgath_fx_core';
import { BossImpostorField } from './boss_impostor';
import { type BossImpostorRigView, rigShownFromView } from './boss_impostor_core';
import type { DayNightGrade } from './day_night_core';
import { EyeWardBadgeField, visualHeightFor } from './eye_ward_badge_field';
import { type EyeWardWorld, eyeWardPlanFor } from './eye_ward_marker_drive';

/** The one piece of a character visual the ward cues draw on. */
interface WardMarkerVisual {
  setEyeWardMarker(plan: ReturnType<typeof eyeWardPlanFor>): void;
}

export class WorldBossLayer {
  readonly fx: BalgathFx;
  private readonly impostors: BossImpostorField;
  private readonly badges: EyeWardBadgeField;

  constructor(
    private readonly scene: THREE.Scene,
    groundHeightAt: (x: number, z: number) => number,
    private readonly camera: THREE.Camera,
    addShake: (trauma: number) => void,
    surfaceAt: (x: number, z: number, y: number) => Surface,
  ) {
    this.fx = new BalgathFx(
      scene,
      groundHeightAt,
      (t, x, z) => addShake(t * slamShakeFalloff(camera.position, x, z)),
      surfaceAt,
    );
    this.impostors = new BossImpostorField(scene);
    this.badges = new EyeWardBadgeField(scene);
  }

  /** Start the entity loop's badge pass (every badge not marked this frame is dropped). */
  beginViews(): void {
    this.badges.begin();
  }

  /**
   * The ward's on-model cues for one drawn entity. The RETICLE only aims for a pike
   * carrier; the STATE badge shows for everyone, because "his ward is down, your damage
   * lands" is what the whole raid is waiting to be told.
   */
  markView(
    world: EyeWardWorld,
    viewer: { x: number; z: number },
    e: Entity,
    visual: WardMarkerVisual | null | undefined,
    dt: number,
    reducedMotion: boolean,
  ): void {
    const plan = eyeWardPlanFor(world, viewer, e);
    visual?.setEyeWardMarker(plan);
    if (plan) {
      this.badges.mark(e.id, plan, e.pos, visualHeightFor(e), this.camera, dt, reducedMotion);
    }
  }

  /** Dispose any badge whose boss left view this frame. */
  endViews(): void {
    this.badges.end();
  }

  /**
   * The far sprites, from the PLAYER rather than the camera; a sprite draws only while its
   * rig is range-hidden (never for a compile-gated or culled rig, which would draw the flat
   * sprite at thirty yards), and it takes the rig's own day/night grade.
   */
  syncImpostors(
    webgl: THREE.WebGLRenderer,
    entities: Iterable<Entity>,
    viewer: { x: number; z: number },
    views: ReadonlyMap<number, BossImpostorRigView>,
    grade: DayNightGrade,
    nowMs: number,
    alpha: number,
  ): void {
    const fog = this.scene.fog instanceof THREE.Fog ? this.scene.fog : null;
    this.impostors.sync(
      webgl,
      entities,
      this.camera,
      viewer,
      fog,
      (id) => rigShownFromView(views.get(id)),
      grade,
      nowMs,
      alpha,
    );
  }

  /** The impostor atlas is a baked render target: a graphics rebuild mints a whole new
   *  Renderer, so leaving it would strand an atlas per rebuild for the session. */
  dispose(): void {
    this.impostors.dispose();
    this.badges.dispose();
  }
}
