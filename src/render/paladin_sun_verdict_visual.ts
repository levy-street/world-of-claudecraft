import * as THREE from 'three';
import type { PaladinSunVerdictVisualPlan } from './paladin_sun_verdict_core';

const TEXTURE_SIZE = 96;
const SEGMENT_COUNT = 3;
const TAU = Math.PI * 2;
const SUN_GOLD = 0xffd45c;
const SUN_WHITE = 0xffffdf;
const SUN_DARK = 0x8b5318;

function setPixel(data: Uint8Array, x: number, y: number, color: number, alpha: number): void {
  const offset = (y * TEXTURE_SIZE + x) * 4;
  data[offset] = (color >> 16) & 0xff;
  data[offset + 1] = (color >> 8) & 0xff;
  data[offset + 2] = color & 0xff;
  data[offset + 3] = alpha;
}

function sunTexture(segment: number | null): THREE.DataTexture {
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const center = TEXTURE_SIZE / 2;
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const dx = x + 0.5 - center;
      const dy = center - (y + 0.5);
      const radius = Math.hypot(dx, dy);
      let angle = Math.atan2(dy, dx) + Math.PI / 2;
      if (angle < 0) angle += TAU;
      const wedge = Math.floor((angle / TAU) * SEGMENT_COUNT) % SEGMENT_COUNT;

      if (segment !== null) {
        if (radius >= 8 && radius <= 27 && wedge === segment) {
          setPixel(data, x, y, SUN_GOLD, radius < 23 ? 235 : 185);
        }
        continue;
      }

      const outerRing = Math.abs(radius - 28) < 1.8;
      const innerRing = Math.abs(radius - 8) < 1.4;
      const rayBand = radius >= 31 && radius <= 43;
      const rayAngle = ((angle + Math.PI / 12) / TAU) * 12;
      const ray = rayBand && Math.abs(rayAngle - Math.round(rayAngle)) < (43 - radius) * 0.018;
      const engraving = radius > 28 && radius < 32 && Math.cos(angle * 36) > 0.35;
      const separatorAngle = (angle / TAU) * SEGMENT_COUNT;
      const separator =
        radius >= 8 &&
        radius <= 27 &&
        Math.abs(separatorAngle - Math.round(separatorAngle)) < 0.025;
      const dimSegment = radius >= 8 && radius <= 27;
      const core = radius < 6;
      if (outerRing || innerRing || ray || separator || core || engraving) {
        setPixel(data, x, y, core ? SUN_WHITE : SUN_GOLD, core ? 245 : 220);
      } else if (dimSegment) {
        setPixel(data, x, y, SUN_DARK, 95);
      }
    }
  }
  const texture = new THREE.DataTexture(data, TEXTURE_SIZE, TEXTURE_SIZE, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

const SUN_BASE_TEXTURE = sunTexture(null);
const SUN_SEGMENT_TEXTURES = Array.from({ length: SEGMENT_COUNT }, (_, index) => sunTexture(index));

function sprite(
  texture: THREE.Texture,
  opacity: number,
  renderOrder: number,
  blending: THREE.Blending = THREE.NormalBlending,
): THREE.Sprite {
  const result = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
      blending,
    }),
  );
  result.renderOrder = renderOrder;
  result.scale.setScalar(1.85);
  return result;
}

export class PaladinSunVerdictVisual {
  readonly group = new THREE.Group();
  private readonly base = sprite(SUN_BASE_TEXTURE, 0.8, 20);
  private readonly segments = SUN_SEGMENT_TEXTURES.map((texture, index) =>
    sprite(texture, 1, 21 + index, THREE.AdditiveBlending),
  );
  private elapsed = 0;
  private readonly judgments = new THREE.Group();
  private readonly bladeGeometry = new THREE.OctahedronGeometry(0.3, 0);
  private readonly bladeMaterial = new THREE.MeshBasicMaterial({
    color: SUN_WHITE,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  constructor(characterHeight: number) {
    this.group.name = 'paladin-sun-verdict-visual';
    this.group.position.y = characterHeight + 1.8;
    this.group.visible = false;
    this.base.name = 'paladin-sun-verdict-base';
    this.group.add(this.base);
    this.judgments.name = 'paladin-verdict-three-sentences';
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(this.bladeGeometry, this.bladeMaterial);
      const angle = (i / 3) * TAU;
      blade.position.set(Math.cos(angle) * 0.9, -0.25, Math.sin(angle) * 0.9);
      blade.scale.set(0.45, 2.4, 0.45);
      blade.name = `paladin-verdict-sentence-${i + 1}`;
      this.judgments.add(blade);
    }
    this.group.add(this.judgments);
    for (let index = 0; index < this.segments.length; index++) {
      this.segments[index].name = `paladin-sun-verdict-segment-${index + 1}`;
      this.group.add(this.segments[index]);
    }
  }

  update(plan: PaladinSunVerdictVisualPlan, dt: number, reducedMotion: boolean): void {
    this.group.visible = plan.active;
    this.group.userData.charges = plan.charges;
    if (!plan.active) return;

    if (!reducedMotion) this.elapsed += Math.max(0, dt);
    const rotation = reducedMotion ? 0 : this.elapsed * (plan.imminent ? 1.15 : 0.38);
    const pulse = reducedMotion ? 1 : 1 + Math.sin(this.elapsed * (plan.imminent ? 7.5 : 3)) * 0.07;
    this.group.scale.setScalar(pulse);
    this.judgments.rotation.y = reducedMotion ? 0 : rotation * 0.45;
    for (let index = 0; index < 3; index++) {
      const blade = this.judgments.children[index];
      blade.scale.y = index < plan.charges ? 3.6 : 2.4;
      blade.position.y = index < plan.charges ? -0.05 : -0.3;
    }
    this.base.material.rotation = rotation;
    this.base.material.opacity = plan.imminent ? 0.98 : 0.8;
    for (let index = 0; index < this.segments.length; index++) {
      const segment = this.segments[index];
      segment.visible = index < plan.charges;
      segment.material.rotation = rotation;
      segment.material.opacity = plan.imminent ? 1 : 0.92;
    }
  }

  dispose(): void {
    this.bladeGeometry.dispose();
    this.bladeMaterial.dispose();
    this.base.material.dispose();
    for (const segment of this.segments) segment.material.dispose();
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
