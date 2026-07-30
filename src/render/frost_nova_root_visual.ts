import * as THREE from 'three';
import { surfaceMat } from './gfx';

const REVEAL_SECONDS = 0.12;
const REFERENCE_CHARACTER_HEIGHT = 1.8;

const BASE_GEOMETRY = new THREE.CylinderGeometry(0.7, 0.76, 0.2, 8);
const SHARD_GEOMETRY = new THREE.ConeGeometry(0.13, 0.5, 5);

interface FrostRootMaterials {
  base: THREE.Material;
  shards: THREE.Material;
}

let materials: FrostRootMaterials | null = null;

export function isFrostNovaRootAura(aura: { id: string; kind: string }): boolean {
  return (
    aura.kind === 'root' && (aura.id === 'frost_nova_root' || aura.id === 'rings_of_frost_root')
  );
}

/** Created after initGfxTier(), retaining a readable Lambert fallback on low graphics. */
function frostRootMaterials(): FrostRootMaterials {
  if (materials) return materials;

  const base = surfaceMat({
    color: 0x73c9ff,
    emissive: 0x155c9a,
    emissiveIntensity: 0.5,
    roughness: 0.2,
    flatShading: true,
  }).clone();
  base.transparent = true;
  base.opacity = 0.58;
  base.depthWrite = false;

  const shards = surfaceMat({
    color: 0xb1e5ff,
    emissive: 0x267cb5,
    emissiveIntensity: 0.48,
    roughness: 0.16,
    flatShading: true,
  }).clone();
  shards.transparent = true;
  shards.opacity = 0.72;
  shards.depthWrite = false;

  materials = { base, shards };
  return materials;
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * Presentation-only restraint shared by Atadura de Hielo and Ring of Frost.
 * Combat lifetime and break rules remain authoritative in the sim.
 */
export class FrostNovaRootVisual {
  readonly group = new THREE.Group();
  private readonly shards: THREE.InstancedMesh;
  private active = false;
  private disposed = false;
  private reveal = 0;

  constructor(characterHeight: number) {
    this.group.name = 'frost-nova-root-visual';
    this.group.visible = false;

    const size = Math.max(0.72, Math.min(1.35, characterHeight / REFERENCE_CHARACTER_HEIGHT));
    const content = new THREE.Group();
    content.name = 'frost-nova-root-content';
    content.scale.setScalar(size);

    const material = frostRootMaterials();
    const base = new THREE.Mesh(BASE_GEOMETRY, material.base);
    base.name = 'frost-nova-root-base';
    // Keep the lowest facet microscopically above y=0 to avoid z-fighting with terrain.
    base.position.y = 0.105;
    base.scale.z = 0.72;
    base.renderOrder = 8;
    content.add(base);

    const shards = new THREE.InstancedMesh(SHARD_GEOMETRY, material.shards, 7);
    this.shards = shards;
    shards.name = 'frost-nova-root-shards';
    shards.renderOrder = 9;

    const dummy = new THREE.Object3D();
    const placements = [
      [-0.58, 0.29, 0.12, 0.08, 0.22, 0.34, 0.92],
      [0.57, 0.29, 0.08, -0.04, -0.18, -0.36, 0.84],
      [-0.37, 0.27, -0.38, -0.3, 0.1, 0.2, 0.72],
      [0.4, 0.29, -0.36, -0.28, -0.14, -0.2, 0.81],
      [-0.27, 0.26, 0.39, 0.28, 0.15, 0.16, 0.66],
      [0.28, 0.28, 0.4, 0.3, -0.12, -0.12, 0.76],
      [0.02, 0.3, -0.43, -0.33, 0.2, 0.02, 0.64],
    ] as const;
    for (let i = 0; i < placements.length; i++) {
      const [x, y, z, rx, ry, rz, scale] = placements[i];
      dummy.position.set(x, y, z);
      dummy.rotation.set(rx, ry, rz);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      shards.setMatrixAt(i, dummy.matrix);
    }
    shards.instanceMatrix.needsUpdate = true;
    content.add(shards);
    this.group.add(content);
  }

  /** Release this view's instance buffer while retaining shared geometry and materials. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.shards.dispose();
  }

  update(active: boolean, dt: number): void {
    if (!active) {
      this.active = false;
      this.reveal = 0;
      this.group.visible = false;
      return;
    }

    if (!this.active) {
      this.active = true;
      this.reveal = 0;
      this.group.visible = true;
    }

    this.reveal = Math.min(1, this.reveal + Math.max(0, dt) / REVEAL_SECONDS);
    const eased = easeOutCubic(this.reveal);
    const width = 0.88 + eased * 0.12;
    this.group.scale.set(width, Math.max(0.04, eased), width);
  }
}

/** Lazy renderer seam: construct only once for an entity that is actually rooted. */
export function syncFrostNovaRootVisual(
  visual: FrostNovaRootVisual | null,
  parent: THREE.Group,
  characterHeight: number,
  active: boolean,
  dt: number,
): FrostNovaRootVisual | null {
  let current = visual;
  if (active && !current) {
    current = new FrostNovaRootVisual(characterHeight);
    parent.add(current.group);
  }
  current?.update(active, dt);
  return current;
}
