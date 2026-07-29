// Underwater ambience: the blue wash you swim inside, and the bubbles rising
// through it.
//
// Two objects, two draw calls, no per-frame CPU work beyond four uniform writes:
//
//  * TINT — a camera-facing quad pinned just past the near plane, drawn last with
//    depth testing off. The scene fog already darkens distance toward the same
//    blue (renderer.ts applies an underwater fog override), but fog cannot reach
//    the sky dome, which renders unfogged; the quad is what stops a clear sky
//    showing through the surface from below and sells "you are inside water".
//
//  * BUBBLES — ONE THREE.Points whose whole animation lives in the vertex
//    shader. Each point owns a fixed offset inside a box, a phase and a rise
//    rate; the shader wraps it up the box with `mod`, so nothing is simulated,
//    respawned or uploaded. The box rides the camera, so bubbles are always
//    around the viewer and never need culling. Cost is one small draw of
//    ~40-140 points, and the whole view is skipped outright when dry.
//
// Both are additive to whatever the renderer already draws: nothing here touches
// the scene's materials, so surfacing simply fades the group back out.

import * as THREE from 'three';

/** The colour the world drowns toward. */
export const UNDERWATER_TINT = 0x1d5f87;
/** Fog the renderer eases toward while the camera is under the line. */
export const UNDERWATER_FOG_COLOR = 0x11466a;
export const UNDERWATER_FOG_NEAR = 1.5;
export const UNDERWATER_FOG_FAR = 46;
/** Peak opacity of the tint quad, at full submersion. */
const TINT_OPACITY = 0.46;
/** Vertical extent of the bubble column (yards). Points wrap within it. */
const BUBBLE_BOX_HEIGHT = 9;
/** Bubbles seat in an ANNULUS around the camera: anything spawned at the lens
 *  projects to a screen-filling blob however small its world size. */
const BUBBLE_RADIUS_MIN = 1.6;
const BUBBLE_RADIUS_MAX = 7;

const BUBBLE_VERT = /* glsl */ `
  attribute vec3 aOffset;   // x/z seat in the box, y = starting height
  attribute vec2 aMotion;   // x = rise rate, y = wobble phase
  uniform float uTime;
  uniform float uHeight;
  uniform float uSize;
  varying float vFade;
  void main() {
    float rise = aOffset.y + uTime * aMotion.x;
    // mod() is the whole "respawn": a bubble leaving the top re-enters at the
    // bottom, so the stream is endless without any CPU-side particle bookkeeping.
    float y = mod(rise, uHeight) - uHeight * 0.5;
    float wob = uTime * 1.7 + aMotion.y;
    vec3 p = vec3(aOffset.x + sin(wob) * 0.14, y, aOffset.z + cos(wob * 0.83) * 0.14);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // fade in off the bottom and out at the top so wrapping never pops
    float h = (y + uHeight * 0.5) / uHeight;
    vFade = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.82, 1.0, h));
    // Perspective size with a hard ceiling: a bubble that drifts close must not
    // grow into a full-screen sprite (point sprites have no far/near clipping
    // of their own, so this clamp IS the near plane for them).
    gl_PointSize = clamp(uSize * 40.0 / max(0.6, -mv.z), 1.5, 18.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const BUBBLE_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    // a bright rim over a faint fill: reads as a gas bubble rather than a dot
    float rim = smoothstep(0.5, 0.95, r);
    float a = uOpacity * vFade * (0.14 + rim * 0.8) * (1.0 - smoothstep(0.9, 1.0, r));
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class UnderwaterView {
  readonly group = new THREE.Group();
  private readonly tint: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly bubbles: THREE.Points;
  private readonly bubbleMat: THREE.ShaderMaterial;
  private time = 0;

  constructor(lowGfx: boolean) {
    this.group.name = 'underwater';
    this.group.visible = false;
    // Never culled: the group is re-seated on the camera every frame, so a
    // stale bounding sphere would flicker it out at the exact moment it matters.
    this.group.frustumCulled = false;
    this.group.renderOrder = 9990;

    const tintMat = new THREE.MeshBasicMaterial({
      color: UNDERWATER_TINT,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.tint = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tintMat);
    this.tint.frustumCulled = false;
    this.tint.renderOrder = 9990;
    this.group.add(this.tint);

    const count = lowGfx ? 40 : 140;
    const offsets = new Float32Array(count * 3);
    const motion = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      // seeded by nothing in particular: the pattern is ambient, not authored
      const a = Math.random() * Math.PI * 2;
      const r =
        BUBBLE_RADIUS_MIN + Math.sqrt(Math.random()) * (BUBBLE_RADIUS_MAX - BUBBLE_RADIUS_MIN);
      offsets[i * 3] = Math.cos(a) * r;
      offsets[i * 3 + 1] = Math.random() * BUBBLE_BOX_HEIGHT;
      offsets[i * 3 + 2] = Math.sin(a) * r;
      motion[i * 2] = 0.55 + Math.random() * 1.15; // yd/s of rise
      motion[i * 2 + 1] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));
    geo.setAttribute('aMotion', new THREE.BufferAttribute(motion, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BUBBLE_BOX_HEIGHT);

    this.bubbleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: BUBBLE_BOX_HEIGHT },
        uSize: { value: lowGfx ? 1.0 : 1.3 },
        uColor: { value: new THREE.Color(0xdff2ff) },
        uOpacity: { value: 0 },
      },
      vertexShader: BUBBLE_VERT,
      fragmentShader: BUBBLE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.bubbles = new THREE.Points(geo, this.bubbleMat);
    this.bubbles.frustumCulled = false;
    // above the tint: the bubbles read as being between you and the blue
    this.bubbles.renderOrder = 9991;
    this.group.add(this.bubbles);
  }

  /**
   * @param blend 0 = fully dry (the group hides and costs nothing), 1 = the
   *              camera is well under the waterline.
   */
  update(camera: THREE.PerspectiveCamera, blend: number, dt: number): void {
    const amount = Math.min(1, Math.max(0, blend));
    this.group.visible = amount > 0.002;
    if (!this.group.visible) return;

    this.time += dt;
    this.bubbleMat.uniforms.uTime.value = this.time;
    this.bubbleMat.uniforms.uOpacity.value = amount;
    this.tint.material.opacity = TINT_OPACITY * amount;

    // The box rides the camera, so there is always a stream around the viewer.
    this.group.position.copy(camera.position);
    // ...but it does NOT inherit camera rotation: bubbles rise in WORLD up.
    this.group.quaternion.identity();

    // Seat the quad just past the near plane and size it to fill the frustum
    // there, with margin so a wide FOV or an odd aspect cannot leave an edge.
    const dist = camera.near * 3 + 0.05;
    const h = 2 * dist * Math.tan((camera.fov * Math.PI) / 360);
    this.tint.scale.set(h * camera.aspect * 1.25, h * 1.25, 1);
    this.tint.quaternion.copy(camera.quaternion);
    this.tint.position.set(0, 0, -dist).applyQuaternion(camera.quaternion);
  }

  dispose(): void {
    this.tint.geometry.dispose();
    this.tint.material.dispose();
    this.bubbles.geometry.dispose();
    this.bubbleMat.dispose();
  }
}
