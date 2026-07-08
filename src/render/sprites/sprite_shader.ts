// Sprite shader: multiplicative lighting for billboard sprites.
// Preserves pixel art (nearest filter, no per-pixel gradients) while
// integrating sprites into the 3D world via color modulation.
import * as THREE from 'three';
import { spriteLightingUniforms } from './sprite_lighting';

// ---------------------------------------------------------------------------
// Vertex shader
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// ---------------------------------------------------------------------------
// Fragment shader
// ---------------------------------------------------------------------------

const fragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D map;
uniform vec3 color;
uniform float opacity;

// Lighting (shared across all sprites)
uniform vec3 uAmbientColor;
uniform vec3 uHemiSkyColor;
uniform vec3 uHemiGroundColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uBiomeTint;
uniform vec3 uCameraPos;
uniform float uRimIntensity;

// Nearby point lights
uniform vec3 uPointLightPos0;
uniform vec3 uPointLightColor0;
uniform vec3 uPointLightPos1;
uniform vec3 uPointLightColor1;
uniform vec3 uPointLightPos2;
uniform vec3 uPointLightColor2;
uniform vec3 uPointLightPos3;
uniform vec3 uPointLightColor3;
uniform int uPointLightCount;

// Fog (Three.js standard)
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  // 1. Sample sprite texture (nearest-filtered, pixel art intact)
  vec4 texColor = texture2D(map, vUv);
  if (texColor.a < 0.1) discard;

  // 2. Apply material color tint (entity-specific tint, ghost, soulRend)
  texColor.rgb *= color;

  // 2. Ambient lighting (hemisphere blend)
  //    Upper hemisphere = sky color, lower = ground color
  float hemiBlend = 0.5; // fixed blend for sprites (no normal)
  vec3 hemiColor = mix(uHemiGroundColor, uHemiSkyColor, hemiBlend);
  vec3 ambient = uAmbientColor + hemiColor * 0.6;

  // 3. Sun contribution (simple diffuse on a flat normal facing up)
  float NdotL = max(dot(vec3(0.0, 1.0, 0.0), uSunDirection), 0.0);
  vec3 sunContrib = uSunColor * uSunIntensity * NdotL * 0.35;

  // 4. Combine base lighting
  vec3 lighting = ambient + sunContrib;

  // 5. Nearby point lights (fires, torches, portals)
  vec3 pointLight = vec3(0.0);
  if (uPointLightCount > 0) {
    vec3 toLight0 = uPointLightPos0 - vWorldPos;
    float d0 = length(toLight0);
    float atten0 = max(0.0, 1.0 - d0 / 18.0);
    pointLight += uPointLightColor0 * atten0 * atten0;
  }
  if (uPointLightCount > 1) {
    vec3 toLight1 = uPointLightPos1 - vWorldPos;
    float d1 = length(toLight1);
    float atten1 = max(0.0, 1.0 - d1 / 18.0);
    pointLight += uPointLightColor1 * atten1 * atten1;
  }
  if (uPointLightCount > 2) {
    vec3 toLight2 = uPointLightPos2 - vWorldPos;
    float d2 = length(toLight2);
    float atten2 = max(0.0, 1.0 - d2 / 18.0);
    pointLight += uPointLightColor2 * atten2 * atten2;
  }
  if (uPointLightCount > 3) {
    vec3 toLight3 = uPointLightPos3 - vWorldPos;
    float d3 = length(toLight3);
    float atten3 = max(0.0, 1.0 - d3 / 18.0);
    pointLight += uPointLightColor3 * atten3 * atten3;
  }
  lighting += pointLight;

  // 6. Rim light (sun-colored, view-dependent, very subtle)
  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  // Tangential component: perpendicular to sun direction in the view plane
  float sunDotView = dot(uSunDirection, viewDir);
  vec3 rimDir = normalize(uSunDirection - viewDir * sunDotView);
  float rim = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
  vec3 rimColor = uSunColor * rim * uRimIntensity;
  lighting += rimColor;

  // 7. Apply biome tint (very subtle color shift)
  lighting *= uBiomeTint;

  // 8. Final color: texture × lighting (multiplicative modulation)
  vec3 finalColor = texColor.rgb * lighting;

  // 9. Fog (Three.js-compatible linear fog)
  float fogDepth = length(gl_FragCoord.xyz / gl_FragCoord.w);
  // Approximate fog depth from camera distance
  float fogFactor = smoothstep(fogNear, fogFar, length(vWorldPos - uCameraPos));
  finalColor = mix(finalColor, fogColor, fogFactor);

  gl_FragColor = vec4(finalColor, texColor.a * opacity);
}
`;

// ---------------------------------------------------------------------------
// Material factory
// ---------------------------------------------------------------------------

let sharedShaderMat: THREE.ShaderMaterial | null = null;

/**
 * Get or create the shared sprite ShaderMaterial.
 * All sprites share this material instance — per-entity tint/color is handled
 * via the material.color property (Three.js multiplies it with the shader output).
 */
export function getSpriteShaderMaterial(): THREE.ShaderMaterial {
  if (!sharedShaderMat) {
    sharedShaderMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        map: { value: null },
        ...spriteLightingUniforms,
      },
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
  }
  return sharedShaderMat;
}

/**
 * Create a per-entity sprite material.
 * Each sprite needs its own material to hold its own texture + color tint,
 * but they all share the lighting uniforms from spriteLightingUniforms.
 */
export function createSpriteMaterial(
  map: THREE.Texture,
  tintColor?: THREE.Color,
  tintStrength?: number,
): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      map: { value: map },
      color: { value: new THREE.Color(0xffffff) },
      opacity: { value: 1.0 },
      ...spriteLightingUniforms,
    },
    transparent: true,
    alphaTest: 0.1,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  if (tintColor && tintStrength) {
    (mat.uniforms.color.value as THREE.Color).copy(new THREE.Color(0xffffff).lerp(tintColor, tintStrength));
  }
  return mat;
}
