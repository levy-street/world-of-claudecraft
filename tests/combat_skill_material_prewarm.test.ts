import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildCombatSkillMaterialPrewarmGroup } from '../src/render/combat_skill_material_prewarm';

describe('buildCombatSkillMaterialPrewarmGroup', () => {
  it('stages the exact two Stonebound program variants that used to link on first cast', () => {
    const group = buildCombatSkillMaterialPrewarmGroup();
    expect(group.visible).toBe(false);
    expect(group.children.map((child) => child.name)).toEqual([
      'stonebound-weapon-shell-prewarm',
      'stonebound-armor-shard-prewarm',
    ]);

    const [shell, shard] = group.children as THREE.Mesh[];
    const shellMaterial = shell.material as THREE.MeshBasicMaterial;
    const shardMaterial = shard.material as THREE.MeshBasicMaterial;
    expect(shellMaterial.wireframe).toBe(true);
    expect(shellMaterial.side).toBe(THREE.DoubleSide);
    expect(shellMaterial.transparent).toBe(true);
    expect(shellMaterial.depthWrite).toBe(false);
    expect(shardMaterial.wireframe).toBe(true);
    expect(shardMaterial.side).toBe(THREE.FrontSide);
    expect(shardMaterial.transparent).toBe(true);
    expect(shardMaterial.depthWrite).toBe(false);
  });

  it('shares the live material factories so prewarm cannot drift from the cast effect', () => {
    const visual = readFileSync(
      new URL('../src/render/characters/visual.ts', import.meta.url),
      'utf8',
    );
    expect(visual).toContain('createStoneboundWeaponShellMaterial()');
    expect(visual).toContain('createStoneboundArmorShardMaterial()');
    expect(visual).not.toContain('color: 0x9a9384,\n              transparent: true');
    expect(visual).not.toContain('color: 0x777065,\n          transparent: true');
  });
});
