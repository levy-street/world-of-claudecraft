// The Prism Glare's dazzle, as the LOCAL player sees it (temple_trash_fx.ts
// owns it; the plan is temple_trash_fx_core.ts dazzleVeil): a prismatic tint
// round the edges of the screen while they wear the dazzle, a short flash of
// rainbow light on the moment it lands, fading with the aura's own clock.
//
// It is a screen overlay, never a floor mark: one clip-space quad drawn last
// with depth testing off (the underwater tint's precedent, underwater.ts),
// inside the temple's gated root so its program links with the rest. The
// middle of the screen is never touched (the mask is zero over its middle
// 60 percent, and the flash never reaches its middle 40), nor is the HUD (DOM
// above the canvas), so nothing a player acts on is hidden; the dazzle's
// actionable read is its aura icon. Reduced motion: no flash and no shimmer.
// Idle, its vertex shader throws the quad off screen (no fragments), and once
// the gate has linked it the mesh is hidden outright.

import * as THREE from 'three';

const VERT = /* glsl */ `
uniform float uEdge;
uniform float uFlash;
varying vec2 vUv;
void main() {
  vUv = uv;
  if (uEdge + uFlash <= 0.0005) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uEdge;
uniform float uFlash;
uniform float uShimmer;
varying vec2 vUv;
vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 p = vUv - 0.5;
  vec2 q = abs(p) * 2.0;
  float e = max(q.x, q.y);
  // Zero over the middle 60 percent of the screen, full at the frame.
  float edge = smoothstep(0.6, 1.0, e);
  float ang = atan(p.y, p.x);
  vec3 col = hue(fract(ang / 6.28318 + e * 0.35 + uTime * 0.07 * uShimmer));
  col = mix(col, vec3(1.0), 0.3);
  // Glints of refracted light caught in the tint.
  vec2 cell = floor(vUv * vec2(64.0, 36.0));
  float glint = step(0.985, h21(cell + floor(uTime * 6.0 * uShimmer)));
  col += vec3(glint) * 0.8 * uShimmer;
  float wave = 0.8 + 0.2 * sin(ang * 6.0 + uTime * 2.5 * uShimmer);
  float a = edge * uEdge * wave;
  // The landing flash: whiter, a little further in, never the middle 40.
  a = max(a, smoothstep(0.4, 1.0, e) * uFlash);
  col = mix(col, vec3(1.0), clamp(uFlash * 2.0, 0.0, 0.6));
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.6));
  #include <colorspace_fragment>
}
`;

/** Drawn after every leaf of the world's default group order (a screen
 *  overlay, off the floor ladder), under the underwater tint's 9990. The
 *  order rides the mesh, never a Group (tests/floor_vfx_layer.test.ts pins
 *  the Group carriers), so a pinned Group carrier such as a mount beacon may
 *  draw over the tinted edge: harmless, the veil is cosmetic. */
const VEIL_ORDER = 9989;

export class TempleDazzleVeil {
  private readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms = {
    uEdge: { value: 0 },
    uFlash: { value: 0 },
    uShimmer: { value: 1 },
  };
  private gated = false;

  constructor(parent: THREE.Object3D, uTime: { value: number }) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime, ...this.uniforms },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'drowned-temple-dazzle-veil';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = VEIL_ORDER;
    parent.add(this.mesh);
  }

  markGated(): void {
    this.gated = true;
    this.mesh.visible = false;
  }

  /** This frame's veil (0 and 0: none). `calm` holds the shimmer still. */
  paint(edge: number, flash: number, calm: boolean): void {
    this.uniforms.uEdge.value = edge;
    this.uniforms.uFlash.value = flash;
    this.uniforms.uShimmer.value = calm ? 0 : 1;
    this.mesh.visible = !this.gated || edge + flash > 0.0005;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
