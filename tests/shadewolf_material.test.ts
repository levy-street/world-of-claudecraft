import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyGhostEffectStyle,
  createGhostEffectMaterial,
  resolveGhostStyle,
} from '../src/render/characters/effect_materials';

describe('Shadewolf material identity', () => {
  it('prioritizes a released spirit over living wolf and stealth materials', () => {
    for (const wolf of [false, true])
      for (const stealth of [false, true])
        expect(resolveGhostStyle(wolf, stealth, true)).toBe('spirit');
    expect(resolveGhostStyle(true, false, false)).toBe('shadewolf');
    expect(resolveGhostStyle(true, true, false)).toBe('shadewolf');
    expect(resolveGhostStyle(false, true, false)).toBe('stealth');
    expect(resolveGhostStyle(false, false, false)).toBe('spirit');
  });
  it('keeps a denser body using the existing transparent program', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x885522, emissive: 0x110000 });
    const wolf = createGhostEffectMaterial(source, 'shadewolf') as THREE.MeshStandardMaterial;
    const spirit = createGhostEffectMaterial(source) as THREE.MeshStandardMaterial;
    expect(wolf.opacity).toBeGreaterThan(spirit.opacity);
    expect(wolf.color.getHex()).not.toBe(source.color.getHex());
    expect(wolf.depthWrite).toBe(true);
    expect(wolf.customProgramCacheKey()).toBe(spirit.customProgramCacheKey());
    applyGhostEffectStyle(wolf, source, 'spirit');
    expect(wolf.color.getHex()).toBe(source.color.getHex());
    expect(wolf.emissive.getHex()).toBe(source.emissive.getHex());
    expect(wolf.emissiveIntensity).toBe(source.emissiveIntensity);
    expect(source.transparent).toBe(false);
    wolf.dispose();
    spirit.dispose();
    source.dispose();
  });
});
