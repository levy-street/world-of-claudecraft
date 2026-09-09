// Additive glow billboards carried on a mount's own skeleton: the cold blue
// halo burning behind the Chimeglass Tortoise's storm-glass spectacles.
//
// This is the companion to mount_lamps.ts, and the split is deliberate. A lamp
// is a POINT LIGHT: it lights the world, it costs a slot in the renderer's
// ranked light budget, and the budget is why the tortoise carries exactly one
// of them for a pair of lenses. A glow is a SPRITE: it costs one transparent
// draw, lights nothing, and is what actually reads as "the glass is lit" on
// screen, including on tiers whose materials never see a point light. A mount
// may carry either, both, or neither.
//
// Parented to the BONE, like the lamps and for the same reason: the skeleton
// already solves the head's motion, so the halo stays inside its glass through
// every stride for free, where a world-space sprite re-aimed each frame would
// trail it by an update. Offsets are MODEL units in that bone's local frame, so
// the visual's normalization scale carries them to whatever `height` the
// manifest gives the mount.
//
// The GLASS ITSELF is still the GLB's job (the `lens_Glow` material, pinned to
// EMISSIVE_GLOW by buildTintedClone against the bloom threshold). This adds the
// bloom halo around it rather than re-boosting that one calibration.

import * as THREE from 'three';
import type { MountGlowSpec, MountVisualSpec } from './mount_visuals';
import { mountGlowBreath } from './mount_visuals';

export interface MountGlows {
  sprites: THREE.Sprite[];
  /** Peak opacity per sprite, parallel to `sprites`. */
  peaks: number[];
  /** Breath depth per sprite (0 = steady). */
  pulses: number[];
  /** Breaths per second per sprite. */
  rates: number[];
  /** Rest scale per sprite, in the bone's local units. */
  sizes: number[];
}

/** One soft radial falloff, shared by every glow in the process. Built lazily
 *  so a headless import (the Node tests reach this module through the spec
 *  types) never touches `document`. */
let sharedTexture: THREE.Texture | null = null;

function glowTexture(): THREE.Texture {
  if (sharedTexture) return sharedTexture;
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  // A hot, nearly flat core out to 0.25 is what makes this read as a lit lens
  // rather than a fog puff: the falloff has to look like light escaping glass,
  // which is bright and abrupt at the rim and then long and faint past it.
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.82)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedTexture = tex;
  return tex;
}

function buildSprite(glow: MountGlowSpec): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: glow.color,
    transparent: true,
    opacity: glow.opacity,
    blending: THREE.AdditiveBlending,
    // Additive and unlit: it must never occlude the muzzle behind it, but it
    // still tests against depth so the shell/rider/world can occlude IT.
    depthWrite: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(glow.offset[0], glow.offset[1], glow.offset[2]);
  sprite.scale.setScalar(glow.radius * 2);
  sprite.renderOrder = 3;
  return sprite;
}

/**
 * Hang one glow billboard per spec entry on a freshly built mount visual.
 *
 * Returns null when the mount carries no glows, or when the GLB is missing the
 * bones the spec names (a model swap that renamed a joint degrades to unlit
 * glass rather than throwing inside the per-frame render path, the same
 * contract attachMountLamps keeps).
 */
export function attachMountGlows(root: THREE.Object3D, spec: MountVisualSpec): MountGlows | null {
  if (spec.glows.length === 0) return null;
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((object) => {
    if (!bones.has(object.name)) bones.set(object.name, object);
  });
  const sprites: THREE.Sprite[] = [];
  const peaks: number[] = [];
  const pulses: number[] = [];
  const rates: number[] = [];
  const sizes: number[] = [];
  for (const glow of spec.glows) {
    const bone = bones.get(glow.bone);
    if (!bone) continue;
    const sprite = buildSprite(glow);
    bone.add(sprite);
    sprites.push(sprite);
    peaks.push(glow.opacity);
    pulses.push(glow.pulse ?? 0);
    rates.push(glow.pulseHz ?? 0);
    sizes.push(glow.radius * 2);
  }
  return sprites.length > 0 ? { sprites, peaks, pulses, rates, sizes } : null;
}

/** Breathe each halo for this frame. The size swells with the level as well as
 *  the opacity, brightness alone reads as a fade, where a halo that also grows
 *  reads as light spilling further out of the glass. */
export function updateMountGlows(glows: MountGlows, timeSec: number): void {
  for (let i = 0; i < glows.sprites.length; i++) {
    const level = mountGlowBreath(timeSec, i, glows.pulses[i], glows.rates[i]);
    const sprite = glows.sprites[i];
    sprite.material.opacity = glows.peaks[i] * level;
    sprite.scale.setScalar(glows.sizes[i] * (0.9 + 0.1 * level));
  }
}

/** Detach and dispose every glow sprite (mount dismissed, swapped, or culled).
 *  The gradient texture is process-shared and deliberately kept. */
export function disposeMountGlows(glows: MountGlows): void {
  for (const sprite of glows.sprites) {
    sprite.removeFromParent();
    sprite.material.dispose();
  }
  glows.sprites.length = 0;
  glows.peaks.length = 0;
  glows.pulses.length = 0;
  glows.rates.length = 0;
  glows.sizes.length = 0;
}
