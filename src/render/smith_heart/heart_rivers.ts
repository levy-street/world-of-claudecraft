// The Smith's Heart's floor light-rivers (heart_rivers_core.ts): per vein a
// dim ribbon always drawn along LIGHT_RIVERS, and a bright one in the vein's
// colour whose draw range runs from the guardian's arena to the seal as the
// vein lights (one index-count write per frame while it runs, nothing after),
// flowing toward the seal, a white-hot surge riding its front (phase 2F).
// Floor marks on the floor ladder's ground rung, so every telegraph paints
// over them. Drawn on every tier: the light leading to each guardian is
// route information.

import * as THREE from 'three';
import {
  LIGHT_RIVERS,
  SMITH_HEART_FIELD,
  SMITH_HEART_VEIN_COLORS,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { markSharedMaterial } from '../shared_resource';
import { heartRiverSurgeMaterial } from './heart_fx_materials';
import { scaleColor } from './heart_plan_core';
import {
  heartRiverArcs,
  heartRiverLitSegments,
  heartRiverSurgeHead,
  planHeartRiver,
} from './heart_rivers_core';
import type { HeartSealView } from './heart_seal_core';

const dimMaterials = new Map<SmithHeartVein, THREE.MeshBasicMaterial>();

function dimMaterial(vein: SmithHeartVein): THREE.MeshBasicMaterial {
  let m = dimMaterials.get(vein);
  if (!m) {
    const c = SMITH_HEART_VEIN_COLORS[vein];
    m = new THREE.MeshBasicMaterial({
      color: scaleColor(c, 0.4),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: `smithHeartRiver:${vein}:dim`,
    });
    markSharedMaterial(m);
    dimMaterials.set(vein, m);
  }
  return m;
}

function floorAt(x: number, z: number): number | null {
  return authoredFieldSurfaceAt(SMITH_HEART_FIELD, x, z)
    ? authoredFieldHeight(SMITH_HEART_FIELD, x, z)
    : null;
}

export interface HeartRivers {
  group: THREE.Group;
  /** Advance the bright ribbons to the seal's view (the frame driver). */
  update(view: HeartSealView): void;
}

/** Every light-river of one slot (instance-local). */
export function buildHeartRivers(): HeartRivers {
  const group = new THREE.Group();
  group.name = 'smithHeartRivers';
  const lit: {
    geometry: THREE.BufferGeometry;
    segments: number;
    drawn: number;
    material: THREE.ShaderMaterial;
    total: number;
    head: number;
  }[] = [];
  for (const vein of SMITH_HEART_VEINS) {
    const strip = planHeartRiver(LIGHT_RIVERS[vein], floorAt);
    // Two geometries over copies of one strip (each owns its buffers, so a
    // teardown disposing one never pulls the other's out from under it); the
    // bright one's draw range is the light's progress.
    const dimGeometry = new THREE.BufferGeometry();
    dimGeometry.setAttribute('position', new THREE.BufferAttribute(strip.positions, 3));
    dimGeometry.setIndex(new THREE.BufferAttribute(strip.indices, 1));
    dimGeometry.computeBoundingSphere();
    const litGeometry = new THREE.BufferGeometry();
    litGeometry.setAttribute('position', new THREE.BufferAttribute(strip.positions.slice(), 3));
    litGeometry.setIndex(new THREE.BufferAttribute(strip.indices.slice(), 1));
    // The surge's shader reads each vertex's yards from the source and its side.
    const arcs = heartRiverArcs(strip);
    const sides = new Float32Array(strip.segments * 4);
    for (let i = 0; i < sides.length; i++) sides[i] = i % 2 ? -1 : 1;
    litGeometry.setAttribute('aArc', new THREE.BufferAttribute(arcs, 1));
    litGeometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    litGeometry.computeBoundingSphere();
    litGeometry.setDrawRange(0, 0);
    const dim = new THREE.Mesh(dimGeometry, dimMaterial(vein));
    dim.name = `river:${vein}:dim`;
    dim.renderOrder = floorVfxRenderOrder('ground', 3);
    // The bright ribbon is the slot's own (its surge is this slot's state).
    const material = heartRiverSurgeMaterial(
      `smithHeartRiver:${vein}:lit`,
      SMITH_HEART_VEIN_COLORS[vein],
    );
    const bright = new THREE.Mesh(litGeometry, material);
    bright.name = `river:${vein}:lit`;
    bright.renderOrder = floorVfxRenderOrder('ground', 4);
    group.add(dim, bright);
    const total = strip.segments > 0 ? arcs[arcs.length - 1] : 0;
    lit.push({
      geometry: litGeometry,
      segments: strip.segments,
      drawn: 0,
      material,
      total,
      head: -2,
    });
  }
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    o.matrixAutoUpdate = false;
  });
  return {
    group,
    update(view) {
      for (let i = 0; i < lit.length; i++) {
        const river = lit[i];
        // The surge rides the light's front while it runs (written only then).
        const head = Math.round(heartRiverSurgeHead(view.since[i], river.total) * 4) / 4;
        if (head !== river.head) {
          river.head = head;
          river.material.uniforms.uHead.value = head;
        }
        const n = heartRiverLitSegments(view.since[i], river.segments);
        if (n === river.drawn) continue;
        river.drawn = n;
        river.geometry.setDrawRange(0, n * 6);
      }
    },
  };
}
