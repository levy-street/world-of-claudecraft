import * as THREE from 'three';
import {
  createStoneboundArmorShardMaterial,
  createStoneboundWeaponShellMaterial,
} from './characters/weapon_aura_materials';

// Program identity depends on the material flags and geometry attribute set,
// not the authored vertex positions. These standard geometries carry the same
// position/normal/uv layouts as the live weapon shell and armor shard while
// keeping the boot stand-in tiny.
const WEAPON_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const SHARD_GEOMETRY = new THREE.OctahedronGeometry(1, 0);

/** Hidden exact-material stand-ins for combat effects created only on cast. */
export function buildCombatSkillMaterialPrewarmGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'combat-skill-material-prewarm';
  group.visible = false;

  const shell = new THREE.Mesh(WEAPON_GEOMETRY, createStoneboundWeaponShellMaterial());
  shell.name = 'stonebound-weapon-shell-prewarm';
  shell.frustumCulled = false;

  const shard = new THREE.Mesh(SHARD_GEOMETRY, createStoneboundArmorShardMaterial());
  shard.name = 'stonebound-armor-shard-prewarm';
  shard.frustumCulled = false;

  group.add(shell, shard);
  return group;
}
