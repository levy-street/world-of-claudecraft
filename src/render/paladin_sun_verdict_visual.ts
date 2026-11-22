import * as THREE from 'three';
import type { PaladinSunVerdictVisualPlan } from './paladin_sun_verdict_core';

// Solar Lance brand, drawn as glowing light: a slim diamond-tipped spear for the
// mark, a small pair of curved flame wings for the first charge and a larger
// outer pair for the second. Shapes are in sprite space, x right and y up.
const SIZE = 256;
const GOLD: [number, number, number] = [0.91, 0.62, 0.27];
const IVORY: [number, number, number] = [1, 0.95, 0.82];
const SPEAR = [
  0, 0.95, 0.085, 0.5, 0.028, 0.36, 0.028, -0.42, 0.065, -0.6, 0, -0.82, -0.065, -0.6, -0.028,
  -0.42, -0.028, 0.36, -0.085, 0.5,
];
/** Right-hand wings; the left is the mirror image. */
const INNER_WING = [
  0.04, -0.3, 0.14, -0.2, 0.24, -0.02, 0.3, 0.22, 0.29, 0.5, 0.2, 0.26, 0.12, 0.08, 0.05, -0.08,
];
const OUTER_WING = [
  0.06, -0.45, 0.22, -0.34, 0.38, -0.12, 0.47, 0.16, 0.46, 0.62, 0.33, 0.3, 0.2, 0.06, 0.07, -0.2,
];
function segment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax,
    ey = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)));
  return Math.hypot(px - ax - ex * t, py - ay - ey * t);
}
/** Signed distance to a polygon: negative inside. */
function polygonDistance(x: number, y: number, polygon: number[]): number {
  let hit = false;
  let d = Infinity;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const ax = polygon[i],
      ay = polygon[i + 1],
      bx = polygon[j],
      by = polygon[j + 1];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
    d = Math.min(d, segment(x, y, ax, ay, bx, by));
  }
  return hit ? -d : d;
}
/** Artwork scale inside the sprite, leaving room for the glow at the spear
 * tip and wing tips so the sprite edge never clips it. */
export const SUN_VERDICT_ART_SCALE = 0.84;
function shapeDistance(part: number, x: number, y: number): number {
  const k = SUN_VERDICT_ART_SCALE;
  if (part === 0) return polygonDistance(x / k, y / k, SPEAR) * k;
  const wing = part === 1 ? INNER_WING : OUTER_WING;
  return Math.min(polygonDistance(x / k, y / k, wing), polygonDistance(-x / k, y / k, wing)) * k;
}
function texture(part: number): THREE.DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const pixel = 2 / SIZE;
  for (let row = 0; row < SIZE; row++)
    for (let col = 0; col < SIZE; col++) {
      const x = ((col + 0.5) / SIZE) * 2 - 1;
      // Rows are uploaded flipped, so row 0 is the top of the sprite.
      const y = 1 - ((row + 0.5) / SIZE) * 2;
      let intensity: number;
      let heat: number;
      if (part === 3) {
        // Sentence flash: a white star at the spear's heart.
        const r = Math.hypot(x, y - 0.2 * SUN_VERDICT_ART_SCALE);
        const spokes =
          Math.exp(-Math.abs(x) * 40) * Math.exp(-Math.abs(y - 0.17) * 3) +
          Math.exp(-Math.abs(y - 0.17) * 40) * Math.exp(-Math.abs(x) * 3);
        intensity = Math.min(1, Math.exp(-r * r * 30) * 1.4 + spokes * 0.8);
        heat = Math.exp(-r * r * 60);
      } else {
        const d = shapeDistance(part, x, y);
        const body = 1 - Math.min(1, Math.max(0, (d + pixel) / (2 * pixel)));
        const glow = Math.exp(-Math.max(0, d) * 30) * 0.45;
        intensity = Math.min(1, Math.max(body, glow));
        // Hot along the centre of each blade, gold toward its edges and glow.
        heat = body * Math.min(1, Math.max(0, -d / 0.025));
      }
      if (intensity < 0.004) continue;
      const offset = (row * SIZE + col) * 4;
      data[offset] = Math.round((GOLD[0] + (IVORY[0] - GOLD[0]) * heat) * 255);
      data[offset + 1] = Math.round((GOLD[1] + (IVORY[1] - GOLD[1]) * heat) * 255);
      data[offset + 2] = Math.round((GOLD[2] + (IVORY[2] - GOLD[2]) * heat) * 255);
      data[offset + 3] = Math.round(intensity * 255);
    }
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  t.flipY = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
const TEXTURES = [texture(0), texture(1), texture(2), texture(3)];
export function sunVerdictMarkTextures(): readonly THREE.DataTexture[] {
  return TEXTURES;
}
function sprite(map: THREE.Texture): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map,
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
    }),
  );
  // Same on-screen brand as before; the sprite grows to hold the glow margin.
  s.scale.set(1.9 / SUN_VERDICT_ART_SCALE, 1.9 / SUN_VERDICT_ART_SCALE, 1);
  s.renderOrder = 20;
  s.userData.renderCategory = 'vfx';
  return s;
}
export class PaladinSunVerdictVisual {
  readonly group = new THREE.Group();
  private readonly base = sprite(TEXTURES[0]);
  private readonly segments = TEXTURES.slice(1).map(sprite);
  private elapsed = 0;
  constructor(characterHeight: number) {
    this.group.name = 'paladin-sun-verdict-visual';
    this.group.position.y = characterHeight + 1.1;
    this.group.visible = false;
    this.base.name = 'paladin-sun-verdict-base';
    this.group.add(this.base);
    for (let i = 0; i < this.segments.length; i++) {
      this.segments[i].name = `paladin-sun-verdict-segment-${i + 1}`;
      this.group.add(this.segments[i]);
    }
  }
  update(plan: PaladinSunVerdictVisualPlan, dt: number, reducedMotion: boolean): void {
    this.group.visible = plan.active;
    this.group.userData.charges = plan.charges;
    if (!plan.active) return;
    if (!reducedMotion) this.elapsed += Math.max(0, dt);
    const pulse = reducedMotion ? 1 : 1 + Math.sin(this.elapsed * 3) * 0.025;
    this.group.scale.setScalar(pulse);
    // The brand burns brighter as the sentence nears.
    const shimmer = reducedMotion ? 1 : 0.9 + 0.1 * Math.sin(this.elapsed * 5.3);
    this.base.material.opacity = (plan.imminent ? 1 : 0.85) * shimmer;
    for (let i = 0; i < this.segments.length; i++) {
      this.segments[i].visible = i < plan.charges;
      this.segments[i].material.opacity = 0.95 * shimmer;
    }
  }
  dispose(): void {
    this.base.material.dispose();
    for (const s of this.segments) s.material.dispose();
    // Shared textures belong to the boot prewarm, not an individual wearer.
  }
}
export function syncPaladinSunVerdictVisual(
  visual: PaladinSunVerdictVisual | null,
  parent: THREE.Group,
  characterHeight: number,
  plan: PaladinSunVerdictVisualPlan,
  dt: number,
  reducedMotion: boolean,
): PaladinSunVerdictVisual | null {
  let current = visual;
  if (plan.active && !current) {
    current = new PaladinSunVerdictVisual(characterHeight);
    parent.add(current.group);
  }
  current?.update(plan, dt, reducedMotion);
  return current;
}
