// The generic transparent additive MeshBasicMaterial two producers mint on
// the fly (the bubble beam in vfx.ts, the corpse beacon in corpse_beacon.ts),
// as shared option tables, plus the hidden stand-ins that carry the same
// program keys through the cast-VFX warm-up. Neither producer reaches the
// boot manifest on its own (a beam exists only while a pet channels, the
// beacon only during a ghost run), and the combat audit found their program
// already linked only because something else had drawn a same-key basic
// material first: the stand-ins make that certain.

import * as THREE from 'three';

export function bubbleBeamMaterialOptions(
  color: number,
  opacity: number,
): THREE.MeshBasicMaterialParameters {
  return { color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending };
}

export function corpseBeaconMaterialOptions(): THREE.MeshBasicMaterialParameters {
  return {
    color: 0xbfe6ff,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  };
}

/** One hidden mesh per generic basic program, tagged like the pooled
 *  ability-VFX primitives so collectAbilityVfxCompileTargets picks them up
 *  with the pools: added to the scene at renderer construction, never drawn.
 *  The two beam materials share one program (opacity is a uniform), the
 *  beacon's double-sided variant is a second. */
export function buildCastVfxBasicStandIns(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cast-vfx-basics';
  group.visible = false;
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const standIns: [string, THREE.MeshBasicMaterialParameters][] = [
    ['bubble-beam', bubbleBeamMaterialOptions(0x42bfe8, 0.48)],
    ['corpse-beacon', corpseBeaconMaterialOptions()],
  ];
  for (const [name, options] of standIns) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial(options));
    mesh.name = `cast-vfx-basic:${name}`;
    mesh.visible = false;
    mesh.userData.renderCategory = 'vfx';
    group.add(mesh);
  }
  return group;
}
