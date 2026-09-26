// The generic transparent MeshBasicMaterials minted on the fly by producers
// the boot manifest never reaches on its own (the bubble beam in vfx.ts, the
// corpse beacon in corpse_beacon.ts, the weapon auras of
// characters/visual.ts rebuildWeaponAura), as shared option tables, plus the
// hidden stand-ins that carry the same program keys through the cast-VFX
// warm-up. A beam exists only while a pet channels, the beacon only during a
// ghost run, and a weapon aura is minted per rebuild and disposed first on
// the next one, so between two rebuilds nothing else holds its program. The
// combat audit found these programs linked only when something else had drawn
// a same-key basic material first, and the Adder's Bite tip (an RGBA
// vertex-alpha ramp) shared its key with nothing: it linked live on the first
// coat. The stand-ins make each one certain, and being never disposed they
// also keep the program alive across every aura teardown (three releases a
// program with the last material holding it).

import * as THREE from 'three';
import {
  STONEBOUND_SHARD_TINT,
  STONEBOUND_SHELL_TINT,
  stoneboundShellStyle,
} from './characters/stonebound_shell_core';
import { GFX } from './gfx';

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

/** CharacterVisual.rebuildWeaponAura's imbue overlay: an additive translucent
 *  clone of the weapon mesh in the spec's soak colour (the hue is data, the
 *  brightness class is fixed here). Named, so a live-program event on the
 *  stand-in's program reads. `tipRamp` scopes it to the blade tip
 *  through an RGBA vertex-alpha ramp baked into the aura's own geometry clone
 *  (Adder's Bite): vertex colours with an alpha channel are a program of
 *  their own. */
export function weaponImbueAuraMaterialOptions(
  color: number,
  tipRamp: boolean,
): THREE.MeshBasicMaterialParameters {
  return {
    name: tipRamp ? 'weaponAura:imbue-tip' : 'weaponAura:imbue',
    color,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexColors: tipRamp,
  };
}

/** Stonebound's wireframe stone shell over every held weapon. */
export function stoneboundShellMaterialOptions(
  options: { opacity?: number; wireframe?: boolean } = {},
): THREE.MeshBasicMaterialParameters {
  return {
    name: 'weaponAura:stonebound-shell',
    color: STONEBOUND_SHELL_TINT,
    transparent: true,
    opacity: options.opacity ?? 0.72,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    wireframe: options.wireframe ?? true,
  };
}

/** Stonebound's wireframe armor shards on the body. */
export function stoneboundShardMaterialOptions(
  options: { opacity?: number; wireframe?: boolean } = {},
): THREE.MeshBasicMaterialParameters {
  return {
    name: 'weaponAura:stonebound-shard',
    color: STONEBOUND_SHARD_TINT,
    transparent: true,
    opacity: options.opacity ?? 0.82,
    wireframe: options.wireframe ?? true,
    depthWrite: false,
  };
}

/** The tip ramp's attribute set: the stand-in geometry plus an RGBA colour. */
function withRgbaVertexColors(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.clone();
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 4).fill(1), 4));
  return geometry;
}

/** One hidden mesh per generic basic program, tagged like the pooled
 *  ability-VFX primitives so collectAbilityVfxCompileTargets picks them up
 *  with the pools: added to the scene at renderer construction, never drawn.
 *  The two beam materials share one program (opacity is a uniform), the
 *  beacon's double-sided variant is a second. The weapon auras get one stand-in
 *  per program they can draw (tests/weapon_aura_prewarm_parity.test.ts walks
 *  every aura channel on every mainhand geometry): the full-blade imbue (it
 *  shares the beacon's program; its own stand-in keeps it covered if either
 *  table changes), the tip ramp, and Stonebound's shell and shards. */
export function buildCastVfxBasicStandIns(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cast-vfx-basics';
  group.visible = false;
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const tipGeometry = withRgbaVertexColors(geometry);
  const stoneboundStyle = stoneboundShellStyle(GFX);
  const standIns: [string, THREE.MeshBasicMaterialParameters, THREE.BufferGeometry][] = [
    ['bubble-beam', bubbleBeamMaterialOptions(0x42bfe8, 0.48), geometry],
    ['corpse-beacon', corpseBeaconMaterialOptions(), geometry],
    ['weapon-imbue', weaponImbueAuraMaterialOptions(0x58d63c, false), geometry],
    ['weapon-imbue-tip', weaponImbueAuraMaterialOptions(0x8fd455, true), tipGeometry],
    [
      'weapon-stonebound-shell',
      stoneboundShellMaterialOptions({
        opacity: stoneboundStyle.shellOpacity,
        wireframe: stoneboundStyle.wireframe,
      }),
      geometry,
    ],
    [
      'weapon-stonebound-shard',
      stoneboundShardMaterialOptions({
        opacity: stoneboundStyle.shardOpacity,
        wireframe: stoneboundStyle.wireframe,
      }),
      geometry,
    ],
  ];
  for (const [name, options, standInGeometry] of standIns) {
    const mesh = new THREE.Mesh(standInGeometry, new THREE.MeshBasicMaterial(options));
    mesh.name = `cast-vfx-basic:${name}`;
    mesh.visible = false;
    mesh.userData.renderCategory = 'vfx';
    group.add(mesh);
  }
  return group;
}
