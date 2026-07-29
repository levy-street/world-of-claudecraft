import type * as THREE from 'three';

export interface WeaponVfxFrameUniforms {
  time: THREE.IUniform<number>;
  scale: THREE.IUniform<number> | null;
}

/**
 * Every animated material in one weapon rig advances on the same local clock
 * and pixel scale. Sharing the uniform cells preserves the exact values while
 * reducing per-frame writes from one per material to one per handle.
 */
export function shareWeaponVfxFrameUniforms(
  materials: readonly THREE.Material[],
): WeaponVfxFrameUniforms {
  const time: THREE.IUniform<number> = { value: 0 };
  let scale: THREE.IUniform<number> | null = null;
  for (const material of materials) {
    const shader = material as THREE.ShaderMaterial;
    if (!shader.uniforms) continue;
    if (shader.uniforms.uTime) shader.uniforms.uTime = time;
    if (shader.uniforms.uScale) {
      scale ??= { value: shader.uniforms.uScale.value as number };
      shader.uniforms.uScale = scale;
    }
  }
  return { time, scale };
}
