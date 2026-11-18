// The fog scene's crossfade, painted (fog_scene_fade_core.ts decides which
// settles fade, how long they take, and the blend). The renderer hands every
// settle of a new fog scene state through `settle`, steps the fade once a
// frame, and turns the key light through `keyDirection`. Between two of the
// Smith's Heart's rooms the new state's preset is written exactly as before,
// read back as the fade's target, and the scene is put back to the look it
// showed, so the settle's own frame draws no change and the next second
// carries it over.
//
// It reads and writes only what a settle writes: the scene's fog and
// environment intensity, the one sun and hemisphere's colours and strengths,
// and the shared rim uniforms. No light is added, removed or hidden and no
// material changes, so nothing relinks (src/render/CLAUDE.md, "GPU work").

import * as THREE from 'three';
import {
  beginSceneFade,
  blendKeyDirectionInto,
  blendSceneLookInto,
  cancelSceneFade,
  type FadeRgb,
  type FadeVec3,
  newSceneFade,
  newSceneLook,
  type SceneLook,
  sceneFadeProgress,
  stepSceneFade,
} from './fog_scene_fade_core';
import { sharedUniforms } from './gfx';

function copyRgb(out: FadeRgb, from: FadeRgb): void {
  out.r = from.r;
  out.g = from.g;
  out.b = from.b;
}

export class FogSceneFade {
  private readonly fade = newSceneFade();
  private readonly blended = newSceneLook();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sun: THREE.DirectionalLight,
    private readonly hemi: THREE.HemisphereLight,
  ) {}

  /**
   * Settle a fog scene state resolved in `interior`: `apply` writes the new
   * state's preset into the scene, as every settle always has. Between two of
   * the raid's rooms the scene is then put back to the look it showed (and the
   * key light to `keyDir`, its direction as last drawn), and `step` carries it
   * over to the new state's.
   */
  settle(interior: string | null | undefined, keyDir: FadeVec3, apply: () => void): void {
    const fade = this.fade;
    const fades = beginSceneFade(fade, interior) > 0;
    if (fades) {
      this.read(fade.from);
      fade.fromKey.x = keyDir.x;
      fade.fromKey.y = keyDir.y;
      fade.fromKey.z = keyDir.z;
    }
    apply();
    if (!fades) return;
    this.read(fade.to);
    this.write(fade.from);
  }

  /** Advance the running fade by `dt` seconds (nothing while none runs). */
  step(dt: number): void {
    if (this.fade.seconds <= 0) return;
    const k = stepSceneFade(this.fade, dt);
    this.write(blendSceneLookInto(this.blended, this.fade.from, this.fade.to, k));
  }

  /** `dir` holds the settled state's key light direction: while a fade runs,
   *  turn it from the direction the scene showed toward that one. */
  keyDirection(dir: FadeVec3): void {
    if (this.fade.seconds <= 0) return;
    blendKeyDirectionInto(dir, this.fade.fromKey, dir, sceneFadeProgress(this.fade));
  }

  /** A settle the fade never sees (the rift's rig, written every frame): drop
   *  any fade and forget the interior, so the next settle lands at once. */
  cancel(): void {
    cancelSceneFade(this.fade);
  }

  private read(out: SceneLook): void {
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      copyRgb(out.fog, fog.color);
      out.fogNear = fog.near;
      out.fogFar = fog.far;
    }
    copyRgb(out.sun, this.sun.color);
    out.sunIntensity = this.sun.intensity;
    copyRgb(out.hemiSky, this.hemi.color);
    copyRgb(out.hemiGround, this.hemi.groundColor);
    out.hemiIntensity = this.hemi.intensity;
    out.envIntensity = this.scene.environmentIntensity;
    out.rim = sharedUniforms.uRimBoost.value;
    copyRgb(out.rimColor, sharedUniforms.uRimColor.value);
  }

  private write(look: SceneLook): void {
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      copyRgb(fog.color, look.fog);
      fog.near = look.fogNear;
      fog.far = look.fogFar;
    }
    copyRgb(this.sun.color, look.sun);
    this.sun.intensity = look.sunIntensity;
    copyRgb(this.hemi.color, look.hemiSky);
    copyRgb(this.hemi.groundColor, look.hemiGround);
    this.hemi.intensity = look.hemiIntensity;
    this.scene.environmentIntensity = look.envIntensity;
    sharedUniforms.uRimBoost.value = look.rim;
    copyRgb(sharedUniforms.uRimColor.value, look.rimColor);
  }
}
