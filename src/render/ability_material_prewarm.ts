// Boot prewarm for the ability visuals whose materials are minted LAZILY, on
// the first cast of the session.
//
// The sources below share one idiom: a module-level `let x: XMaterials | null`
// filled by a private builder the first time the visual is constructed, which
// happens when the aura or cast goes live on an entity in view (or, for the
// Proving Shore coach's guidance, when its route or target first changes).
// Nothing warmed them, so the first Frost Nova root, Ice Block, Temporal
// Hourglass, fireball travel form and coach ribbon each linked their programs
// inside a live frame. The pooled ability-VFX primitives next to them do NOT
// have this problem: their engines build every material eagerly in the
// constructor (ability_vfx/), which is why the boot entry only has to SPAWN
// them.
//
// The stand-in is the REAL visual where one exists, one hidden instance each
// (two for the hourglass, one per energy mode), or the mesh kinds the live
// draw uses (the coach's synthetic strip, ring, sprite and beam): the program
// a material links depends on the mesh wearing it (three keys `instancing`
// and the geometry's attributes into the cache key), and these visuals draw
// plain Meshes, InstancedMeshes and Sprites. Building the live class is the
// only stand-in that provably carries all of them, and it costs one shared
// geometry set and the module-cached materials, which the first cast would
// build anyway.
//
// The group is staged into the scene HIDDEN and never disposed: disposing a
// material releases the program this entry exists to keep, and every material
// here is the one the live cast will draw with.

import * as THREE from 'three';
import { buildCoachTrailStandIn, coachTrailMaterials } from './coach_trail_materials';
import { FireballTravelVisual, fireballMaterials } from './fireball_travel_visual';
import { FrostNovaRootVisual, frostRootMaterials } from './frost_nova_root_visual';
import { IceBlockVisual, iceMaterials } from './ice_block_visual';
import { TemporalHourglassVisual, temporalHourglassMaterials } from './temporal_hourglass_visual';

/** The reference rig height these visuals scale against; the scale reaches the
 *  geometry only, never the materials, so any live body links the same
 *  programs this stand-in does. */
const REFERENCE_CHARACTER_HEIGHT = 1.8;

/** One lazily-built ability visual: what its module cache can produce, and a
 *  hidden stand-in drawing it the way a live cast does. */
export interface AbilityMaterialSource {
  id: string;
  /** The basename of the module whose lazy cache this source drains. Declared
   *  here rather than left to the sweep's own list, so a new source module can
   *  never be registered in the sweep without a factory behind it
   *  (tests/ability_material_prewarm_sweep.test.ts pins the two sets equal). */
  module: string;
  /** Every material the module's lazy cache can hand a live cast. */
  materials(): readonly THREE.Material[];
  /** A hidden instance of the live visual, meshes and all. */
  build(): THREE.Object3D;
}

/** Every lazy ability-material factory under src/render. A new one is caught
 *  by tests/ability_material_prewarm_sweep.test.ts, which walks the tree for
 *  the same idiom and fails until it is registered here. */
export const ABILITY_MATERIAL_SOURCES: readonly AbilityMaterialSource[] = [
  {
    id: 'frost-nova-root',
    module: 'frost_nova_root_visual.ts',
    materials: () => Object.values(frostRootMaterials()),
    build: () => new FrostNovaRootVisual(REFERENCE_CHARACTER_HEIGHT).group,
  },
  {
    id: 'ice-block',
    module: 'ice_block_visual.ts',
    materials: () => Object.values(iceMaterials()),
    build: () => new IceBlockVisual(REFERENCE_CHARACTER_HEIGHT).group,
  },
  {
    id: 'temporal-hourglass',
    module: 'temporal_hourglass_visual.ts',
    materials: () => Object.values(temporalHourglassMaterials()),
    // One stand-in per MODE: the hourglass mounts the protective energy
    // material at build and swaps the hostile one in on update(), so a single
    // instance leaves the hostile program to link on the first hostile cast.
    build: () => {
      const group = new THREE.Group();
      for (const mode of ['protective', 'hostile'] as const) {
        const visual = new TemporalHourglassVisual();
        visual.update(mode, 0);
        visual.group.visible = false;
        group.add(visual.group);
      }
      return group;
    },
  },
  {
    id: 'fireball-travel',
    module: 'fireball_travel_visual.ts',
    materials: () => Object.values(fireballMaterials()),
    build: () => new FireballTravelVisual().group,
  },
  {
    // Not a spell: the Proving Shore coach's guidance (ribbon, ring, aura,
    // beam, area ring), the same lazy-cache idiom on the same manifest lane.
    // Its first quest accepted on the island used to link three programs
    // inside a live frame.
    id: 'coach-trail',
    module: 'coach_trail_materials.ts',
    materials: () => Object.values(coachTrailMaterials()),
    build: () => buildCoachTrailStandIn(),
  },
];

/** The hidden group the boot manifest stages and the compile lane links. */
export function buildAbilityMaterialPrewarmGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ability-material-prewarm';
  group.visible = false;
  for (const source of ABILITY_MATERIAL_SOURCES) {
    const root = source.build();
    root.name = `${source.id}:ability-material-prewarm`;
    // Hidden per root as well as on the group: a stand-in that had to be put
    // into a live state to mount all its materials comes back visible, and the
    // compile lane walks hidden subtrees anyway.
    root.visible = false;
    group.add(root);
  }
  return group;
}

/** Every material the staged group can draw, for the coverage pin. */
export function abilityMaterialPrewarmMaterials(root: THREE.Object3D): THREE.Material[] {
  const found = new Set<THREE.Material>();
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) found.add(entry);
  });
  return [...found];
}
