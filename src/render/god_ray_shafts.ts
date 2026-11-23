// Per-frame placement of the god-ray shaft sprites, moved out of renderer.ts.
// The shafts hang sunward of the camera near eye height and brighten as the
// view swings toward the sun's azimuth.

import * as THREE from 'three';

const look = new THREE.Vector3();
const azimuth = new THREE.Vector3();

/** `sunUp` is the sun's height grade (0 below the horizon); `zoneScale` the
 *  eased per-biome shaft scale (BIOME_GOD_RAYS); only the overworld's open sky
 *  (`outdoor`) draws shafts. Positional, so the frame allocates nothing. */
export function updateGodRayShafts(
  shaftSprites: readonly THREE.Sprite[],
  camera: THREE.Camera,
  sunDir: THREE.Vector3,
  time: number,
  sunUp: number,
  zoneScale: number,
  outdoor: boolean,
): void {
  if (shaftSprites.length === 0) return;
  // Wildheart and the Thornhollow hollow are open-air, but the long
  // screen-space shafts read as giant triangles against an enclosed rim.
  // Both keep the sun, sky, and outdoor grade while these shafts stay
  // reserved for the overworld. Twilight and gloom realms also fade them
  // completely through BIOME_GOD_RAYS, so skip their draw and math once the
  // eased scale reaches zero.
  const shafts = outdoor && zoneScale > 0.02;
  // azimuth-only alignment, the chase cam always pitches down while the
  // sun sits high, so a full 3D dot product would never light the shafts
  camera.getWorldDirection(look);
  look.y = 0;
  look.normalize();
  const sunAzimuth = azimuth.set(sunDir.x, 0, sunDir.z).normalize();
  const facing = Math.max(0, look.dot(sunAzimuth));
  const side = look.set(sunAzimuth.z, 0, -sunAzimuth.x); // sunAzimuth x up
  for (let i = 0; i < shaftSprites.length; i++) {
    const sp = shaftSprites[i];
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
