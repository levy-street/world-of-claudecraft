// Floating C/B/A/S rank badge above a world-spawned rift portal: a rounded
// colour square (rank colour, shared with the sim via RIFT_TIER_COLORS) with a
// big white rank letter, rendered as a camera-facing sprite. Built once per
// portal view (a static canvas texture); the renderer adds it to the portal's
// body group so it inherits placement and culling.
//
// The rank letter is a game GLYPH, not prose (the same C/B/A/S reads in every
// locale, like item quality colours), so no t() key is needed here.

import * as THREE from 'three';
import { RIFT_TIER_COLORS, type RiftTier } from '../sim/types';

const BADGE_CANVAS = 128; // px; crisp enough at the sprite's world size
const BADGE_WORLD_SIZE = 2.4; // yards square
export const BADGE_HEIGHT = 7.2; // yards above the portal base

const badgeTextures = new Map<RiftTier, THREE.CanvasTexture>();

function badgeTexture(tier: RiftTier): THREE.CanvasTexture {
  let tex = badgeTextures.get(tier);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = BADGE_CANVAS;
  canvas.height = BADGE_CANVAS;
  const g = canvas.getContext('2d')!;
  const color = RIFT_TIER_COLORS[tier];
  const css = `#${color.toString(16).padStart(6, '0')}`;
  // Rounded colour square with a darker rim so it reads against any sky.
  const pad = 8;
  const r = 22;
  g.beginPath();
  g.roundRect(pad, pad, BADGE_CANVAS - pad * 2, BADGE_CANVAS - pad * 2, r);
  g.fillStyle = css;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.stroke();
  // Big rank letter.
  g.font = `bold ${Math.round(BADGE_CANVAS * 0.62)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.strokeText(tier, BADGE_CANVAS / 2, BADGE_CANVAS / 2 + 4);
  g.fillStyle = '#ffffff';
  g.fillText(tier, BADGE_CANVAS / 2, BADGE_CANVAS / 2 + 4);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  badgeTextures.set(tier, tex);
  return tex;
}

/** Camera-facing rank badge sprite; caller adds it to the portal body group. */
export function buildRiftRankBadge(tier: RiftTier): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: badgeTexture(tier),
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(BADGE_WORLD_SIZE, BADGE_WORLD_SIZE, 1);
  sprite.position.y = BADGE_HEIGHT;
  return sprite;
}
