// The additive materials the Buried Hoard boss effects share: a vertex-alpha
// ribbon, a camera-facing glow card, a point spark, and the strip geometry a
// ribbon is written into. Each caller owns (and disposes) what it makes here.

import * as THREE from 'three';

/** A vertex-alpha additive ribbon: the blade's trail, the pivot's wake and the
 *  souls' tails are all strips of this one material shape. */
export function ribbonMaterial(color: number, additive = true): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Additive light vanishes on snow: a tinted, alpha-blended ribbon reads on
    // any floor, which is what a telegraph on a white arena needs.
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { tint: { value: new THREE.Color(color) }, gain: { value: 1 } },
    vertexShader:
      'attribute float alpha; varying float vAlpha; void main(){ vAlpha=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: additive
      ? 'varying float vAlpha; uniform vec3 tint; uniform float gain; void main(){ float a=vAlpha*gain; gl_FragColor=vec4(tint*a,a); }'
      : 'varying float vAlpha; uniform vec3 tint; uniform float gain; void main(){ gl_FragColor=vec4(tint,clamp(vAlpha*gain,0.,1.)); }',
  });
}

/** A soft additive glow that always faces the camera: the billboard is built in
 *  view space, so it needs no camera reference and no per-frame orientation. The
 *  instanced form sizes each card from its instance matrix and dims it by its
 *  instance colour. */
export function glowMaterial(color: number, instanced: boolean): THREE.ShaderMaterial {
  const center = instanced
    ? 'vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.,0.,0.,1.); float size = length(instanceMatrix[0].xyz);'
    : 'vec4 mv = modelViewMatrix * vec4(0.,0.,0.,1.); float size = length(modelMatrix[0].xyz);';
  const gain = instanced ? 'vGain = instanceColor.r;' : 'vGain = 1.;';
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { tint: { value: new THREE.Color(color) }, alpha: { value: 1 } },
    vertexShader: `varying vec2 vUv; varying float vGain;
      void main(){ vUv = uv; ${gain} ${center} mv.xy += position.xy * size; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec2 vUv; varying float vGain; uniform vec3 tint; uniform float alpha;
      void main(){ float d = length((vUv-.5)*2.); float a = pow(max(0.,1.-d),2.4) * alpha * vGain;
      gl_FragColor = vec4(mix(tint, vec3(1.), a*.35) * a, a); }`,
  });
}

export function sparkMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { pixelScale: { value: 620 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 tint;
      varying float vAlpha; varying vec3 vTint; uniform float pixelScale;
      void main(){ vAlpha=alpha; vTint=tint; vec4 mv=modelViewMatrix*vec4(position,1.);
      gl_PointSize=size*pixelScale/max(.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying float vAlpha; varying vec3 vTint;
      void main(){ float d=length(gl_PointCoord-.5)*2.; float a=pow(max(0.,1.-d),1.7)*vAlpha;
      gl_FragColor=vec4(mix(vTint,vec3(1.),a*.5)*a,a); }`,
  });
}

export function strip(segments: number): {
  geometry: THREE.BufferGeometry;
  position: THREE.BufferAttribute;
  alpha: THREE.BufferAttribute;
} {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array((segments + 1) * 2 * 3), 3);
  const alpha = new THREE.BufferAttribute(new Float32Array((segments + 1) * 2), 1);
  position.setUsage(THREE.DynamicDrawUsage);
  alpha.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('alpha', alpha);
  const index: number[] = [];
  for (let s = 0; s < segments; s++) {
    const a = s * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  return { geometry, position, alpha };
}
