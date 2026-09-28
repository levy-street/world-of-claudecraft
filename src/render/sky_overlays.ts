// The camera-riding sky overlays, aimed and faded every frame: the sun and moon
// sprites and the god-ray shafts. Lifted out of renderer.ts (a named monolith
// under the line-count ratchet); the renderer still builds the sprites, owns the
// sky state and calls these once per frame with it.
import * as THREE from 'three';
import type { CelestialSprites } from './celestial_sprites';
import { currentLunarPhase } from './day_night_clock';
import { duskWarmAmount } from './day_night_core';

const forward = new THREE.Vector3();
const sunAzimuth = new THREE.Vector3();

export function aimCelestialSprites(
  celestial: CelestialSprites | null,
  camera: THREE.Camera,
  outdoor: boolean,
  sunDir: THREE.Vector3,
  sunUp: number,
  moonDir: THREE.Vector3,
  moonUp: number,
): void {
  if (!celestial) return;
  // keep the moon's shape on the lunar clock (no-op between phase buckets)
  // and run the sun's disc to sunset orange on the same horizon curve the
  // sky glow uses
  celestial.setMoonPhase(currentLunarPhase());
  celestial.setSunWarmth(duskWarmAmount(sunDir.y));
  // The basin keeps directional daylight and the sky dome, but the camera-
  // riding sun and moon sprites can clip against its high rim as oversized
  // wedges: `outdoor` reserves screen-space celestial overlays for the overworld.
  for (const sp of celestial.sunSprites) {
    sp.position.copy(camera.position).addScaledVector(sunDir, 760);
    sp.visible = outdoor && sunUp > 0.02;
    sp.material.opacity = (sp.userData.baseOpacity as number) * sunUp;
  }
  for (const sp of celestial.moonSprites) {
    sp.position.copy(camera.position).addScaledVector(moonDir, 760);
    sp.visible = outdoor && moonUp > 0.02;
    sp.material.opacity = (sp.userData.baseOpacity as number) * moonUp;
  }
}

// light shafts fade in as the camera turns toward the sun, outdoor only
export function aimGodRays(
  godRays: readonly THREE.Sprite[],
  camera: THREE.Camera,
  outdoor: boolean,
  zoneScale: number,
  sunDir: THREE.Vector3,
  sunUp: number,
  time: number,
): void {
  if (godRays.length === 0) return;
  // Wildheart and the Thornhollow hollow are open-air, but the long
  // screen-space shafts read as giant triangles against an enclosed rim.
  // Both keep the sun, sky, and outdoor grade while these shafts stay
  // reserved for the overworld. Twilight and gloom realms also fade them
  // completely through BIOME_GOD_RAYS, so skip their draw and math once the
  // eased scale reaches zero.
  const shafts = outdoor && zoneScale > 0.02;
  // azimuth-only alignment, the chase cam always pitches down while the
  // sun sits high, so a full 3D dot product would never light the shafts
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  sunAzimuth.set(sunDir.x, 0, sunDir.z).normalize();
  const facing = Math.max(0, forward.dot(sunAzimuth));
  const side = forward.set(sunAzimuth.z, 0, -sunAzimuth.x); // sunAzimuth x up
  for (let i = 0; i < godRays.length; i++) {
    const sp = godRays[i];
    sp.visible = shafts;
    if (!shafts) continue;
    const sway = Math.sin(time * 0.13 + i * 2.1) * 10;
    // hang the shafts sunward of the camera but near eye height so they
    // cross a third-person frame instead of floating 150u overhead
    sp.position
      .copy(camera.position)
      .addScaledVector(sunAzimuth, 48 + i * 26)
      .addScaledVector(side, (i - 1) * 30 + sway);
    sp.position.y = camera.position.y + 16 + i * 7;
    sp.material.opacity = facing * facing * facing * (0.3 - i * 0.05) * sunUp * zoneScale;
  }
}
