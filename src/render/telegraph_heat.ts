import type * as THREE from 'three';

/** A prepared material hook adds molten grain inside the existing geometry.
 * The authoritative border and countdown are separate, unmodified meshes. */
export function attachTelegraphHeat(material: THREE.MeshBasicMaterial): void {
  const time = { value: 0 };
  material.userData.telegraphHeatTime = time;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTelegraphHeatTime = time;
    shader.vertexShader = `varying vec3 vHeatPoint;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvHeatPoint = position;',
    );
    shader.fragmentShader = `
      uniform float uTelegraphHeatTime;
      varying vec3 vHeatPoint;
      float heatHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float heatNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(heatHash(i),heatHash(i+vec2(1,0)),f.x),
          mix(heatHash(i+vec2(0,1)),heatHash(i+vec2(1,1)),f.x),f.y);
      }
      ${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `
        #include <color_fragment>
        vec2 surface = vHeatPoint.xz * 0.9;
        float flow = heatNoise(surface + vec2(0.0,-uTelegraphHeatTime*0.24));
        float fine = heatNoise(surface*3.8 + flow*2.0);
        float seam = pow(max(0.0,1.0-abs(fine*2.0-1.0)),14.0);
        diffuseColor.rgb *= 0.38 + flow*0.5;
        diffuseColor.rgb += vec3(1.0,0.34,0.055)*seam*0.72;
      `,
    );
  };
  material.customProgramCacheKey = () => 'woc-telegraph-heat-v1';
}

export function setTelegraphHeatTime(material: THREE.Material, time: number): void {
  const uniform = material.userData.telegraphHeatTime as { value: number } | undefined;
  if (uniform) uniform.value = time;
}
