// SpriteLightingSystem: centralized lighting for all billboard sprites.
// Reads scene lights once per frame and pushes shared uniforms that every
// SpriteVisual's ShaderMaterial references.  Sprites get a multiplicative
// color modulation — no per-pixel shadows, no normal mapping — preserving
// the pixel-art aesthetic while grounding sprites in the 3D world.
import * as THREE from 'three';
import { SUN_DIR, sharedUniforms } from '../gfx';

// ---------------------------------------------------------------------------
// Biome environment tints — very subtle color shifts per biome.
// Values are multipliers (1,1,1 = neutral).  Applied on top of lighting.
// ---------------------------------------------------------------------------

const BIOME_TINTS: Record<string, THREE.Vector3> = {
  vale: new THREE.Vector3(1.0, 1.0, 1.0), // neutral
  marsh: new THREE.Vector3(0.92, 1.0, 0.88), // slight green
  peaks: new THREE.Vector3(0.95, 0.97, 1.02), // slight cold
  beach: new THREE.Vector3(1.02, 1.0, 0.96), // slight warm
  desert: new THREE.Vector3(1.04, 0.98, 0.9), // warm sandy
  volcano: new THREE.Vector3(0.95, 0.88, 0.82), // warm dark
  cave: new THREE.Vector3(0.85, 0.88, 0.92), // cool dark
  dungeon: new THREE.Vector3(0.78, 0.8, 0.88), // cold dark
  temple: new THREE.Vector3(0.82, 0.88, 0.92), // cool mystical
  underwater: new THREE.Vector3(0.7, 0.85, 0.95), // deep blue
  nythraxis: new THREE.Vector3(0.75, 0.72, 0.85), // void purple
  delve: new THREE.Vector3(0.8, 0.82, 0.88), // dark stone
};

// ---------------------------------------------------------------------------
// Point light struct (for nearby fires, torches, portals)
// ---------------------------------------------------------------------------

export interface SpritePointLight {
  position: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  radius: number;
}

const MAX_SPRITE_POINT_LIGHTS = 4;

// ---------------------------------------------------------------------------
// Shared uniforms — every SpriteVisual ShaderMaterial references these
// ---------------------------------------------------------------------------

export const spriteLightingUniforms = {
  uAmbientColor: { value: new THREE.Color(0x404040) },
  uHemiSkyColor: { value: new THREE.Color(0xdcefff) },
  uHemiGroundColor: { value: new THREE.Color(0x465f39) },
  uSunDirection: { value: SUN_DIR.clone() },
  uSunColor: { value: new THREE.Color(0xffedd0) },
  uSunIntensity: { value: 2.8 },
  uBiomeTint: { value: new THREE.Vector3(1, 1, 1) },
  uCameraPos: { value: new THREE.Vector3() },
  uRimIntensity: { value: 0.15 },
  uFogColor: { value: new THREE.Color(0xa6c6e0) },
  uFogNear: { value: 130 },
  uFogFar: { value: 470 },
  // Point lights (packed into arrays for the shader)
  uPointLightPos0: { value: new THREE.Vector3() },
  uPointLightColor0: { value: new THREE.Color() },
  uPointLightPos1: { value: new THREE.Vector3() },
  uPointLightColor1: { value: new THREE.Color() },
  uPointLightPos2: { value: new THREE.Vector3() },
  uPointLightColor2: { value: new THREE.Color() },
  uPointLightPos3: { value: new THREE.Vector3() },
  uPointLightColor3: { value: new THREE.Color() },
  uPointLightCount: { value: 0 },
};

// ---------------------------------------------------------------------------
// SpriteLightingSystem
// ---------------------------------------------------------------------------

export class SpriteLightingSystem {
  private currentBiome: string | null = null;
  private biomeTintScratch = new THREE.Vector3();

  /** Call once per frame from the renderer, after updateCamera(). */
  update(
    dt: number,
    camera: THREE.Camera,
    hemi: THREE.HemisphereLight,
    sun: THREE.DirectionalLight,
    fog: THREE.Fog,
    biome: string | null,
    fireLights: THREE.PointLight[],
    effectivePointLights: number,
  ): void {
    const u = spriteLightingUniforms;

    // Camera position (for rim light)
    u.uCameraPos.value.copy(camera.position);

    // Hemisphere light colors (already in sRGB from Three.js)
    u.uHemiSkyColor.value.copy(hemi.color);
    u.uHemiGroundColor.value.copy(hemi.groundColor);

    // Sun direction and color
    u.uSunDirection.value.copy(SUN_DIR);
    u.uSunColor.value.copy(sun.color);
    u.uSunIntensity.value = sun.intensity;

    // Ambient: derived from hemi intensity (cheaper than a separate AmbientLight)
    const hemiIntensity = hemi.intensity;
    u.uAmbientColor.value.setRGB(hemiIntensity * 0.4, hemiIntensity * 0.4, hemiIntensity * 0.4);

    // Biome tint — lerp smoothly on biome change
    const targetTint = BIOME_TINTS[biome ?? 'vale'] ?? BIOME_TINTS.vale;
    if (biome !== this.currentBiome) {
      this.currentBiome = biome;
    }
    const k = 1 - Math.exp(-dt * 2);
    this.biomeTintScratch.copy(targetTint);
    u.uBiomeTint.value.lerp(this.biomeTintScratch, k);

    // Fog
    u.uFogColor.value.copy(fog.color);
    u.uFogNear.value = fog.near;
    u.uFogFar.value = fog.far;

    // Rim intensity — cranked underground via sharedUniforms.uRimBoost
    u.uRimIntensity.value = 0.15 * sharedUniforms.uRimBoost.value;

    // Nearby point lights — pick the nearest MAX_SPRITE_POINT_LIGHTS
    this.updatePointLights(fireLights, effectivePointLights, camera.position);
  }

  private updatePointLights(
    fireLights: THREE.PointLight[],
    effectiveCount: number,
    camPos: THREE.Vector3,
  ): void {
    const u = spriteLightingUniforms;
    const budget = Math.min(effectiveCount, MAX_SPRITE_POINT_LIGHTS);
    const lights = fireLights;

    // Quick distance sort — only sort the visible subset
    const candidates: { light: THREE.PointLight; d2: number }[] = [];
    const maxDist = 30; // only lights within 30u affect sprites
    const maxDistSq = maxDist * maxDist;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      if (!l.visible) continue;
      const dx = l.position.x - camPos.x;
      const dz = l.position.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < maxDistSq) candidates.push({ light: l, d2 });
    }
    candidates.sort((a, b) => a.d2 - b.d2);

    const count = Math.min(candidates.length, budget);
    u.uPointLightCount.value = count;

    for (let i = 0; i < MAX_SPRITE_POINT_LIGHTS; i++) {
      const posKey = `uPointLightPos${i}` as keyof typeof u;
      const colKey = `uPointLightColor${i}` as keyof typeof u;
      if (i < count) {
        const l = candidates[i].light;
        u[posKey].value.copy(l.position);
        u[colKey].value.copy(l.color).multiplyScalar(l.intensity * 0.04);
      } else {
        u[posKey].value.set(0, -9999, 0);
        u[colKey].value.set(0, 0, 0);
      }
    }
  }
}

/** Singleton — one lighting system shared by all sprites. */
export const spriteLighting = new SpriteLightingSystem();
