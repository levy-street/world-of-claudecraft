import * as THREE from 'three';
import {
  CRAG_AMP,
  type CrustPlate,
  PLATE_SEEDS,
  splitIntoPlates,
} from './ability_vfx/magma_boulder_core';
import { surfaceMat } from './gfx';

// The Magma Burst boulder (the Shaman's lava_burst): a craggy dark basalt crust
// split into plates around a white-hot molten core. The plates drift apart
// along their own directions as the rock grows (pose's `gap`), so the glowing
// cracks between them really open and widen. Procedural geometry built once
// and shared by every boulder; the two materials are a page-wide set staged by
// the boot manifest through ABILITY_MATERIAL_SOURCES
// (ability_material_prewarm.ts), whose stand-in is buildMagmaBoulderStandIn,
// so a live cast never links them first. The pool that flies them is
// ability_vfx/magma_boulders.ts.

/** Shared geometry: the plate split is deterministic, so every boulder (and
 * the prewarm stand-in) draws the very same buffers. */
let plateGeometries: { geometry: THREE.BufferGeometry; seed: number }[] | null = null;
const CORE_GEOMETRY = new THREE.IcosahedronGeometry(1 - CRAG_AMP * 0.9, 2);

function plates(): { geometry: THREE.BufferGeometry; seed: number }[] {
  if (plateGeometries) return plateGeometries;
  const sphere = new THREE.IcosahedronGeometry(1, 2).toNonIndexed();
  const split: CrustPlate[] = splitIntoPlates(sphere.attributes.position.array as Float32Array);
  sphere.dispose();
  plateGeometries = split.map((p) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    geometry.computeVertexNormals();
    return { geometry, seed: p.seed };
  });
  return plateGeometries;
}

export interface MagmaBoulderMaterials {
  crust: THREE.Material;
  core: THREE.Material;
}

let materials: MagmaBoulderMaterials | null = null;

/** Graphics-profile reset hook (assets/graphics_profile.ts): the crust comes
 * from surfaceMat, which keys on the active tier. */
export function resetMagmaBoulderProfileCaches(): void {
  materials = null;
}

export function magmaBoulderMaterials(): MagmaBoulderMaterials {
  if (materials) return materials;
  const crust = surfaceMat({
    color: 0x2b1d17,
    roughness: 0.95,
    flatShading: true,
    // a faint ember warmth in the stone, so it never reads as a cold rock
    emissive: 0x3a0f04,
    emissiveIntensity: 0.7,
  });
  // the molten core: an over-bright HDR color, so it blooms through the cracks
  const core = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffa23a).multiplyScalar(2.3),
  });
  core.name = 'magmaBoulder:core';
  materials = { crust, core };
  return materials;
}

/** One boulder: a core and its crust plates under one group. */
export class MagmaBoulderVisual {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly plateMeshes: { mesh: THREE.Mesh; dir: readonly [number, number, number] }[] = [];

  constructor() {
    const m = magmaBoulderMaterials();
    this.group.name = 'magma-boulder';
    this.group.add(this.body);
    const core = new THREE.Mesh(CORE_GEOMETRY, m.core);
    core.name = 'magma-boulder-core';
    this.body.add(core);
    for (const p of plates()) {
      const mesh = new THREE.Mesh(p.geometry, m.crust);
      mesh.name = 'magma-boulder-plate';
      this.body.add(mesh);
      this.plateMeshes.push({ mesh, dir: PLATE_SEEDS[p.seed] });
    }
    for (const mesh of [core, ...this.plateMeshes.map((p) => p.mesh)]) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
  }

  /**
   * Place the boulder: at (x, y, z), `radius` yards across, its plates pushed
   * `gap` (a fraction of the radius) out from the core so the cracks show,
   * tumbled by (rx, ry).
   */
  pose(x: number, y: number, z: number, radius: number, gap: number, rx: number, ry: number): void {
    this.group.position.set(x, y, z);
    this.body.scale.setScalar(radius);
    this.body.rotation.set(rx, ry, 0);
    for (const p of this.plateMeshes)
      p.mesh.position.set(p.dir[0] * gap, p.dir[1] * gap, p.dir[2] * gap);
  }

  /** Plate count (a test and probe readout). */
  get plateCount(): number {
    return this.plateMeshes.length;
  }
}

/** The boot manifest's stand-in (ABILITY_MATERIAL_SOURCES): one boulder, so
 * both materials link on the exact geometry layout a live cast draws. */
export function buildMagmaBoulderStandIn(): THREE.Group {
  const visual = new MagmaBoulderVisual();
  visual.pose(0, 0, 0, 1, 0.1, 0, 0);
  return visual.group;
}
