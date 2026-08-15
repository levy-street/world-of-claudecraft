import * as THREE from 'three';
import { surfaceMat } from './gfx';
import type { PaladinAscensionVisualPlan } from './paladin_ascension_core';

const REFERENCE_HEIGHT = 1.8;
const SEAL_GEOMETRY = new THREE.PlaneGeometry(1, 1);
const ASCENSION_GOLD = 0xffe88f;
const CROWN_BAND_GEOMETRY = new THREE.CylinderGeometry(0.34, 0.36, 0.14, 24, 1, true);
const CROWN_RIM_GEOMETRY = new THREE.TorusGeometry(0.35, 0.025, 6, 24);
const CROWN_PRONG_GEOMETRY = new THREE.ConeGeometry(0.07, 0.36, 4);
const CROWN_JEWEL_GEOMETRY = new THREE.SphereGeometry(0.045, 8, 6);
const CROWN_PRONG_COUNT = 8;
const HOVER_HEIGHT = 0.08;

function buildSunSealTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const diamond = Math.abs(dx) + Math.abs(dy);
      const ring = Math.abs(Math.hypot(dx, dy) - 19) < 2;
      const cross =
        (Math.abs(dx) < 3 && Math.abs(dy) < 15) || (Math.abs(dy) < 3 && Math.abs(dx) < 15);
      const ray = Math.abs(diamond - 26) < 2;
      if (!ring && !cross && !ray) continue;
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 242;
      data[offset + 2] = 168;
      data[offset + 3] = cross ? 255 : 220;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

const SUN_SEAL_TEXTURE = buildSunSealTexture();

function sealMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: ASCENSION_GOLD,
    map: SUN_SEAL_TEXTURE,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function crownMaterial(): THREE.Material {
  return surfaceMat({
    color: 0xffca54,
    emissive: 0x7a3600,
    emissiveIntensity: 0.72,
    metalness: 0.82,
    roughness: 0.2,
    side: THREE.DoubleSide,
  });
}

function buildSolarCrown(material: THREE.Material): THREE.Group {
  const crown = new THREE.Group();
  crown.name = 'paladin-ascension-solar-crown';

  const band = new THREE.Mesh(CROWN_BAND_GEOMETRY, material);
  band.name = 'paladin-ascension-crown-band';
  crown.add(band);

  for (const [name, y] of [
    ['lower', -0.07],
    ['upper', 0.07],
  ] as const) {
    const rim = new THREE.Mesh(CROWN_RIM_GEOMETRY, material);
    rim.name = `paladin-ascension-crown-${name}-rim`;
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    crown.add(rim);
  }

  const prongs = new THREE.InstancedMesh(CROWN_PRONG_GEOMETRY, material, CROWN_PRONG_COUNT);
  prongs.name = 'paladin-ascension-crown-prongs';
  const jewels = new THREE.InstancedMesh(CROWN_JEWEL_GEOMETRY, material, CROWN_PRONG_COUNT);
  jewels.name = 'paladin-ascension-crown-jewels';
  const transform = new THREE.Object3D();
  for (let index = 0; index < CROWN_PRONG_COUNT; index++) {
    const angle = (index / CROWN_PRONG_COUNT) * Math.PI * 2;
    const prongHeight = index % 2 === 0 ? 0.36 : 0.29;
    transform.position.set(Math.cos(angle) * 0.3, 0.08 + prongHeight / 2, Math.sin(angle) * 0.3);
    transform.scale.set(1, prongHeight / 0.36, 1);
    transform.rotation.set(0, -angle + Math.PI / 4, 0);
    transform.updateMatrix();
    prongs.setMatrixAt(index, transform.matrix);

    transform.position.set(Math.cos(angle) * 0.3, 0.09 + prongHeight, Math.sin(angle) * 0.3);
    transform.scale.setScalar(1);
    transform.rotation.set(0, 0, 0);
    transform.updateMatrix();
    jewels.setMatrixAt(index, transform.matrix);
  }
  prongs.instanceMatrix.needsUpdate = true;
  jewels.instanceMatrix.needsUpdate = true;
  crown.add(prongs, jewels);

  return crown;
}

export class PaladinAscensionVisual {
  readonly group = new THREE.Group();
  private readonly groundSeal: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly solarCrown: THREE.Group;
  private readonly solarCrownMaterial: THREE.Material;
  private readonly size: number;
  private readonly crownBaseY: number;
  private hoverTarget: THREE.Object3D | null = null;
  private hoverBaseY = 0;

  constructor(characterHeight: number) {
    this.group.name = 'paladin-ascension-visual';
    this.group.visible = false;

    this.size = Math.max(0.72, Math.min(1.4, characterHeight / REFERENCE_HEIGHT));
    this.groundSeal = new THREE.Mesh(SEAL_GEOMETRY, sealMaterial());
    this.groundSeal.name = 'paladin-ascension-ground-seal';
    this.groundSeal.rotation.x = -Math.PI / 2;
    this.groundSeal.position.y = 0.055;
    this.groundSeal.scale.setScalar(1.65 * this.size);
    this.groundSeal.renderOrder = 8;
    this.group.add(this.groundSeal);

    this.solarCrownMaterial = crownMaterial();
    this.solarCrown = buildSolarCrown(this.solarCrownMaterial);
    this.crownBaseY = characterHeight + 0.2 * this.size;
    this.solarCrown.position.y = this.crownBaseY;
    this.solarCrown.scale.setScalar(0.94 * this.size);
    this.group.add(this.solarCrown);
  }

  update(
    plan: PaladinAscensionVisualPlan,
    _dt: number,
    _reducedMotion: boolean,
    hoverTarget: THREE.Object3D | null = null,
  ): void {
    this.setHoverTarget(hoverTarget);
    this.group.visible = plan.active;
    const hoverOffset = plan.active ? HOVER_HEIGHT * this.size : 0;
    if (this.hoverTarget) this.hoverTarget.position.y = this.hoverBaseY + hoverOffset;
    this.solarCrown.position.y = this.crownBaseY + hoverOffset;
  }

  dispose(): void {
    this.restoreHoverTarget();
    this.groundSeal.material.dispose();
    this.solarCrownMaterial.dispose();
  }

  private setHoverTarget(target: THREE.Object3D | null): void {
    if (target === this.hoverTarget) return;
    this.restoreHoverTarget();
    this.hoverTarget = target;
    this.hoverBaseY = target?.position.y ?? 0;
  }

  private restoreHoverTarget(): void {
    if (this.hoverTarget) this.hoverTarget.position.y = this.hoverBaseY;
    this.hoverTarget = null;
  }
}

export function syncPaladinAscensionVisual(
  visual: PaladinAscensionVisual | null,
  parent: THREE.Group,
  characterHeight: number,
  plan: PaladinAscensionVisualPlan,
  dt: number,
  reducedMotion: boolean,
  hoverTarget: THREE.Object3D | null = null,
): PaladinAscensionVisual | null {
  let current = visual;
  if (plan.active && !current) {
    current = new PaladinAscensionVisual(characterHeight);
    parent.add(current.group);
  }
  current?.update(plan, dt, reducedMotion, hoverTarget);
  return current;
}
