import * as THREE from 'three';
import { surfaceMat } from './gfx';

const REVEAL_SECONDS = 0.16;
const REFERENCE_CHARACTER_HEIGHT = 1.8;

function pushTriangle(
  positions: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): void {
  positions.push(...a, ...b, ...c);
}

/** A deliberately uneven, low-poly ice prism rather than a perfect glass cylinder. */
function buildShellGeometry(): THREE.BufferGeometry {
  const segments = 8;
  const radii = [
    { y: 0.08, x: 0.7, z: 0.54 },
    { y: 1.68, x: 0.76, z: 0.59 },
    { y: 2.18, x: 0.6, z: 0.48 },
  ] as const;
  const uneven = [1, 0.94, 1.05, 0.97, 1.03, 0.93, 1.06, 0.96] as const;
  const ring: Array<Array<readonly [number, number, number]>> = [];

  for (let layer = 0; layer < radii.length; layer++) {
    const r = radii[layer];
    const points: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2 + Math.PI / 8;
      const wobble = uneven[(i + layer * 2) % uneven.length];
      const yWobble = layer === 2 ? (i % 3) * 0.025 - 0.02 : 0;
      points.push([Math.cos(angle) * r.x * wobble, r.y + yWobble, Math.sin(angle) * r.z * wobble]);
    }
    ring.push(points);
  }

  const positions: number[] = [];
  for (let layer = 0; layer < ring.length - 1; layer++) {
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const a = ring[layer][i];
      const b = ring[layer][next];
      const c = ring[layer + 1][next];
      const d = ring[layer + 1][i];
      // Alternate diagonals so the facets do not read as a regular manufactured prism.
      if ((i + layer) % 2 === 0) {
        pushTriangle(positions, a, b, d);
        pushTriangle(positions, b, c, d);
      } else {
        pushTriangle(positions, a, b, c);
        pushTriangle(positions, a, c, d);
      }
    }
  }

  const topCenter = [0.02, 2.32, -0.015] as const;
  const bottomCenter = [0, 0.04, 0] as const;
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    pushTriangle(positions, ring[2][i], ring[2][next], topCenter);
    pushTriangle(positions, ring[0][next], ring[0][i], bottomCenter);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const SHELL_GEOMETRY = buildShellGeometry();
const BASE_GEOMETRY = new THREE.CylinderGeometry(0.73, 0.66, 0.16, 8);
const SHARD_GEOMETRY = new THREE.ConeGeometry(0.14, 0.66, 4);

interface IceMaterials {
  shell: THREE.Material;
  solid: THREE.Material;
}

let materials: IceMaterials | null = null;

/** Built after initGfxTier(), so low graphics receives the renderer's Lambert fallback. */
function iceMaterials(): IceMaterials {
  if (materials) return materials;
  const shell = surfaceMat({
    color: 0x79c9ff,
    emissive: 0x155692,
    emissiveIntensity: 0.55,
    roughness: 0.16,
    flatShading: true,
    side: THREE.DoubleSide,
  }).clone();
  shell.transparent = true;
  shell.opacity = 0.38;
  shell.depthWrite = false;

  const solid = surfaceMat({
    color: 0xa8ddff,
    emissive: 0x246fa8,
    emissiveIntensity: 0.42,
    roughness: 0.22,
    flatShading: true,
  }).clone();
  solid.transparent = true;
  solid.opacity = 0.68;
  solid.depthWrite = false;
  materials = { shell, solid };
  return materials;
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * Persistent per-character Ice Block presentation. The renderer feeds it only the
 * existing stasis-aura flag; combat state remains entirely in the simulation.
 */
export class IceBlockVisual {
  readonly group = new THREE.Group();
  activatedThisFrame = false;
  private readonly shards: THREE.InstancedMesh;
  private active = false;
  private reveal = 0;

  constructor(characterHeight: number) {
    this.group.name = 'ice-block-visual';
    this.group.visible = false;

    const size = Math.max(0.85, characterHeight / REFERENCE_CHARACTER_HEIGHT);
    const content = new THREE.Group();
    content.name = 'ice-block-content';
    content.scale.setScalar(size);

    const material = iceMaterials();
    const shell = new THREE.Mesh(SHELL_GEOMETRY, material.shell);
    shell.name = 'ice-block-shell';
    shell.renderOrder = 7;
    content.add(shell);

    const base = new THREE.Mesh(BASE_GEOMETRY, material.solid);
    base.name = 'ice-block-base';
    base.position.y = 0.08;
    base.renderOrder = 9;
    content.add(base);

    const shards = new THREE.InstancedMesh(SHARD_GEOMETRY, material.solid, 8);
    this.shards = shards;
    shards.name = 'ice-block-shards';
    shards.renderOrder = 9;
    const dummy = new THREE.Object3D();
    const placements = [
      [-0.66, 0.42, 0.2, 0.08, 0, 0.58, 1.15],
      [0.66, 0.4, 0.15, -0.05, 0, -0.56, 1],
      [-0.39, 0.4, -0.52, -0.5, 0, 0.28, 0.86],
      [0.43, 0.43, -0.5, -0.46, 0, -0.34, 1.12],
      [-0.2, 0.36, 0.57, 0.5, 0, 0.08, 0.78],
      [0.32, 0.38, 0.54, 0.48, 0, -0.15, 0.92],
      [-0.69, 0.78, -0.02, 0, 0, 1.06, 0.72],
      [0.7, 0.88, -0.08, 0, 0, -1.03, 0.66],
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

  /** Release the InstancedMesh's per-view GPU instance buffer, not shared art resources. */
  dispose(): void {
    this.shards.dispose();
  }

  update(active: boolean, dt: number): void {
    this.activatedThisFrame = false;
    if (!active) {
      this.active = false;
      this.reveal = 0;
      this.group.visible = false;
      return;
    }
    if (!this.active) {
      this.active = true;
      this.activatedThisFrame = true;
      this.reveal = 0;
      this.group.visible = true;
    }
    this.reveal = Math.min(1, this.reveal + Math.max(0, dt) / REVEAL_SECONDS);
    const eased = easeOutCubic(this.reveal);
    const width = 0.82 + eased * 0.18;
    this.group.scale.set(width, Math.max(0.04, eased), width);
  }
}

/** Thin renderer seam: lazy-create once, attach to the owning entity, then reuse it. */
export function syncIceBlockVisual(
  visual: IceBlockVisual | null,
  parent: THREE.Group,
  characterHeight: number,
  active: boolean,
  dt: number,
): IceBlockVisual | null {
  let current = visual;
  if (active && !current) {
    current = new IceBlockVisual(characterHeight);
    parent.add(current.group);
  }
  current?.update(active, dt);
  return current;
}
