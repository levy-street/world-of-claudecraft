// Boot prewarm twins for the LAZY ground-decor pools: the grass cards, the
// ground flowers and the night-accent glow caps.
//
// No boot compile root reaches any of them, for two different reasons, and
// both are structural rather than accidental:
//   - the grass ring builds its chunk InstancedMeshes per frame as you walk,
//     so at prewarm time the materials exist but nothing wearing them is in
//     the scene yet;
//   - the night-accent group is created hidden (it only lights up after dusk),
//     and the prewarm's 'scene' compile unit collects with traverseVisible.
// So the first frame that draws grass, and the first dusk, link their programs
// synchronously. A 2026-08-18 production capture measured that as the last
// three cold links before the entry curtain lifted: 565.8 ms on the capped
// grass card, 66.0 ms on the uncapped one and 207.4 ms on the night-accent
// glow, and the same grass pair had escaped into LIVE frames a day earlier.
//
// The pattern is character_effect_prewarm.ts's: hidden twins wearing the LIVE
// material and the LIVE geometry, staged inside an existing prewarm group (the
// foliage material group, whose manifest entry already links its children one
// per unit), never a lane of their own. Sharing the material is what makes the
// twin exact: three keys a program on the material's parameters plus the
// object's shape bits, so a twin that is an InstancedMesh with an instance
// colour, wearing the same material and geometry, provably links the program
// the live pool draws with.
//
// `castShadow` is a real dimension (it is a second, depth program) and no
// ground-decor pool casts, so no twin does either. `receiveShadow` is NOT: three
// feeds it as a uniform (WebGLRenderer sets `receiveShadow` per draw), so it
// never splits a program and the twins do not carry it.

import * as THREE from 'three';
import {
  type FoliageDrawPath,
  foliageAttributeList,
  foliageProgramKey,
} from './foliage_prewarm_twins_core';
import { materialProgramSignature } from './prewarm_policy';

/** One lazily-built ground-decor draw, reduced to what its program needs. */
export interface GroundDecorPrewarmDraw {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** The live pool tints per instance (setColorAt -> USE_INSTANCING_COLOR). */
  instanceColor: boolean;
}

// Keyed by program identity, so the ten flower palettes (one material each,
// all one program) cost one twin, and a re-registration from a rebuilt world
// replaces the previous generation's material rather than piling up.
const registered = new Map<string, GroundDecorPrewarmDraw>();

function drawPathOf(draw: GroundDecorPrewarmDraw): FoliageDrawPath {
  return {
    // A program SIGNATURE, not the material uuid: distinct palette materials
    // share one program, and a twin each would be a link for nothing.
    materialKey: materialProgramSignature(draw.material),
    attributes: foliageAttributeList(draw.geometry.attributes),
    instanced: true,
    instanceColor: draw.instanceColor,
    castShadow: false,
    receiveShadow: false,
  };
}

/** The program identity two draws must share for one twin to cover both. */
export function groundDecorPrewarmKey(draw: GroundDecorPrewarmDraw): string {
  return foliageProgramKey(drawPathOf(draw));
}

/** Publish a live pool's draw for the boot prewarm. Called at BUILD time (the
 *  material exists long before any mesh wearing it does), from the pool itself. */
export function registerGroundDecorPrewarmDraw(draw: GroundDecorPrewarmDraw): void {
  registered.set(groundDecorPrewarmKey(draw), draw);
}

/** Drop every published draw (a profile rebuild retires their materials). */
export function clearGroundDecorPrewarmDraws(): void {
  registered.clear();
}

/** The published draws, one per distinct program, in registration order. */
export function groundDecorPrewarmDraws(): GroundDecorPrewarmDraw[] {
  return [...registered.values()];
}

/**
 * One hidden twin per published program. The twins are never drawn (nothing
 * projects an invisible subtree, and the group they join is hidden too), so
 * sharing the live geometry costs no upload; they are torn out of the scene
 * after the prewarm WITHOUT disposal, because disposing a material releases the
 * linked program the twin exists to keep.
 */
export function buildGroundDecorPrewarmTwins(): THREE.InstancedMesh[] {
  const identity = new THREE.Matrix4();
  const white = new THREE.Color(1, 1, 1);
  return groundDecorPrewarmDraws().map((draw) => {
    const twin = new THREE.InstancedMesh(draw.geometry, draw.material, 1);
    twin.name = `${draw.material.name || draw.material.type}:ground-decor-prewarm`;
    twin.setMatrixAt(0, identity);
    twin.instanceMatrix.needsUpdate = true;
    if (draw.instanceColor) {
      twin.setColorAt(0, white);
      if (twin.instanceColor) twin.instanceColor.needsUpdate = true;
    }
    twin.castShadow = false;
    twin.frustumCulled = false;
    twin.visible = false;
    return twin;
  });
}
