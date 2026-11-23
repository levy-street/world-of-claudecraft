// The authored (Studio) lighting override over the boot light rig, moved out
// of renderer.ts. The map editor's Lighting tab, saved into the document and
// projected onto WorldContent, applies here from boot, so playtest and the
// editor render the same authored rig; null restores the shipped values. The
// built-in world authors no lighting and never reaches apply().

import * as THREE from 'three';
import type { EditorLightingProfile } from '../editor_lighting';
import { SUN_ANCHOR, SUN_DIR } from '../gfx';
import { authoredSunAnchor, caveLightChanged } from './lighting_rig_core';

/** The lights the rig writes. */
export interface LightingRigTargets {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sunDir: THREE.Vector3;
}

interface BootRig {
  sunIntensity: number;
  sunColor: number;
  hemiIntensity: number;
  skyColor: number;
  envIntensity: number;
}

export class AuthoredLightingRig {
  /** The boot light rig, captured once so apply(null) can restore it. */
  private base: BootRig | null = null;
  /** Active authored lighting (editor tab / map doc); null = shipped rig. */
  override: EditorLightingProfile | null = null;
  /** Authored sun anchor: pins the key light where the maker aimed it, against
   *  the world clock that would otherwise swing it away every frame. */
  sunAnchor: THREE.Vector3 | null = null;
  private readonly scratch = new THREE.Color();

  /** Capture the boot rig (the constructor, once the lights exist). */
  capture(t: LightingRigTargets, envIntensity: number): void {
    this.base = {
      sunIntensity: t.sun.intensity,
      sunColor: t.sun.color.getHex(),
      hemiIntensity: t.hemi.intensity,
      skyColor: t.hemi.color.getHex(),
      envIntensity,
    };
  }

  /**
   * Apply an authored profile over the boot rig, or restore the shipped values
   * with null. Returns the outdoor IBL intensity to use, or null before the
   * boot rig was captured (nothing applied). `onCaveLight` runs when the
   * profile moves the baked cave brightness.
   */
  apply(
    profile: EditorLightingProfile | null,
    t: LightingRigTargets,
    onCaveLight: () => void,
  ): number | null {
    const b = this.base;
    if (!b) return null;
    // Remembered for the ambience easing: the per-frame day/night grade
    // otherwise pulls the rig back to the biome targets within seconds.
    const prev = this.override;
    this.override = profile;
    if (caveLightChanged(prev, profile)) onCaveLight();
    t.sun.intensity = profile ? profile.sunIntensity : b.sunIntensity;
    t.sun.color.setHex(profile ? profile.sunColor : b.sunColor);
    t.hemi.intensity = profile ? profile.hemiIntensity : b.hemiIntensity;
    t.hemi.color.setHex(profile ? profile.skyColor : b.skyColor);
    if (profile) {
      this.sunAnchor = authoredSunAnchor(
        profile.sunAzimuthDeg,
        profile.sunElevationDeg,
        SUN_ANCHOR.length(),
        new THREE.Vector3(),
      );
      t.sunDir.copy(this.sunAnchor).normalize();
    } else {
      this.sunAnchor = null;
      t.sunDir.copy(SUN_DIR);
    }
    return b.envIntensity * (profile ? profile.envScale : 1);
  }

  /** Ease toward the authored values instead of the biome + day/night
   *  targets, which would otherwise pull any override back to the shipped rig
   *  within seconds. False (nothing written) with no override. */
  ease(t: LightingRigTargets, k: number): boolean {
    const authored = this.override;
    if (!authored) return false;
    t.sun.color.lerp(this.scratch.setHex(authored.sunColor), k);
    t.hemi.color.lerp(this.scratch.setHex(authored.skyColor), k);
    t.sun.intensity += (authored.sunIntensity - t.sun.intensity) * k;
    t.hemi.intensity += (authored.hemiIntensity - t.hemi.intensity) * k;
    return true;
  }
}
