// The wind's floor arrows over the Storm Cornice (a part of BreathFightFx;
// look: breath_fight_fx_core.ts WIND_ARROWS, windArrowLook). The owner's
// playtest of 2026-11-25: players moved the wrong way, unsure where the wind
// blew, and the low and medium presets drew the dust and streaks faint. A
// grid of bright chevrons lies on the floor, each marching along its cell
// the way the wind blows (fading in at its cell's back, out at its front),
// half bright while the gather telegraphs the coming bearing, whole while it
// blows, pointing in to the guardian while it draws breath. The same count
// and look on EVERY tier: the wind's way is information a player acts on
// (docs/design/graphics-settings-fairness.md); reduced motion holds them
// still (they still point).
//
// One instanced draw, positions computed in the vertex shader from the grid
// seed and the shared flow (no per-frame allocation, no CPU walk); built in
// the constructor under the fight's local group, so the compile gate links
// it with the rest before the first blow. No light, no texture.

import * as THREE from 'three';
import { BREATH } from '../../sim/content/smith_heart_layout';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { WIND_ARROWS } from './breath_fight_fx_core';

const ARROW_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
uniform float uFlow;
uniform float uSpacing;
uniform vec2 uDir;
uniform vec2 uFocus;
uniform vec2 uCentre;
uniform vec2 uRadii;
uniform float uInward;
attribute vec2 aCell;
varying vec2 vUv;
varying float vFade;
void main() {
  vec2 cell = uCentre + aCell * uSpacing;
  vec2 dir = uDir;
  if (uInward > 0.5) {
    vec2 to = uFocus - cell;
    float l = length(to);
    dir = l > 0.001 ? to / l : uDir;
  }
  // March along the cell: born at its back, spent at its front.
  float k = fract(uFlow / uSpacing);
  float along = (k - 0.5) * uSpacing;
  vec2 c = cell + dir * along;
  vFade = smoothstep(0.0, 0.2, k) * (1.0 - smoothstep(0.75, 1.0, k));
  // Only over the Cornice's floor (a hair inside its rim), and never on the
  // guardian's own mouth while it draws breath.
  vFade *= 1.0 - smoothstep(0.88, 0.97, length((c - uCentre) / uRadii));
  if (uInward > 0.5) vFade *= smoothstep(4.0, 9.0, length(uFocus - c));
  vec2 side = vec2(dir.y, -dir.x);
  vec2 p = c + side * position.x + dir * position.z;
  vUv = uv;
  vec4 wp = modelMatrix * vec4(p.x, 0.0, p.y, 1.0);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;

/** A chevron in its quad's uv: u across (0..1), v along (0 back, 1 point). */
const ARROW_FRAG = /* glsl */ `
uniform float uStrength;
uniform vec3 uColor;
uniform vec3 uEdge;
varying vec2 vUv;
varying float vFade;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  // The chevron's two arms: a band whose back edge follows the V.
  float front = 1.0 - x * 0.55;
  float back = front - 0.5;
  float aa = fwidth(vUv.y) * 1.5 + 0.01;
  float inside = smoothstep(back - aa, back + aa, vUv.y) * (1.0 - smoothstep(front - aa, front + aa, vUv.y));
  // A dark rim round the bright core, so it reads on pale granite and dark.
  float core = smoothstep(back + 0.05 - aa, back + 0.05 + aa, vUv.y)
    * (1.0 - smoothstep(front - 0.05 - aa, front - 0.05 + aa, vUv.y));
  float a = inside * uStrength * vFade;
  if (a < 0.01) discard;
  vec3 col = mix(uEdge, uColor, core);
  gl_FragColor = vec4(col * mix(1.0, 2.0, core), min(1.0, a * mix(0.9, 1.0, core)));
  #include <colorspace_fragment>
}
`;

/** The arrows' colours: the wind's bright cyan (the Updrafts' own), a
 *  storm-slate rim, so they read on the pale granite and in its shade. */
const ARROW_RGB = { core: 0x9ff2ff, edge: 0x0d2a3a } as const;

export class BreathWindArrows {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private flow = 0;

  /** Under `parent` (instance-local coordinates), on the Cornice's floor at
   *  `floorY`. */
  constructor(parent: THREE.Object3D, floorY: number) {
    const C = BREATH.cornice;
    const A = WIND_ARROWS;
    // Every cell of the grid inside the Cornice's ellipse (and a little
    // past, the shader fading the rim's), centred on its middle.
    const cells: number[] = [];
    const nx = Math.ceil(C.rx / A.spacing) + 1;
    const nz = Math.ceil(C.rz / A.spacing) + 1;
    for (let i = -nx; i <= nx; i++)
      for (let j = -nz; j <= nz; j++) {
        const x = i + (j % 2 === 0 ? 0 : 0.5);
        if (Math.hypot((x * A.spacing) / C.rx, (j * A.spacing) / C.rz) > 1.02) continue;
        cells.push(x, j);
      }
    const quad = new THREE.PlaneGeometry(A.width, A.depth);
    // Lay it flat: x across, z along (the point at +z, uv v = 1).
    quad.rotateX(Math.PI / 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    // PlaneGeometry's v runs +y, which the turn above lays along +z: v = 1
    // is the chevron's point, the way the wind blows.
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cells), 2));
    this.geo.instanceCount = cells.length / 2;
    quad.dispose();
    this.mat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathWindArrows',
      uniforms: {
        uFlow: { value: 0 },
        uSpacing: { value: A.spacing },
        uDir: { value: new THREE.Vector2(0, 1) },
        uFocus: { value: new THREE.Vector2(C.x, C.z) },
        uCentre: { value: new THREE.Vector2(C.x, C.z) },
        uRadii: { value: new THREE.Vector2(C.rx, C.rz) },
        uInward: { value: 0 },
        uStrength: { value: 0 },
        uColor: { value: new THREE.Color(ARROW_RGB.core) },
        uEdge: { value: new THREE.Color(ARROW_RGB.edge) },
      },
      vertexShader: ARROW_VERT,
      fragmentShader: ARROW_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'smithHeartBreathWindArrows';
    // Over the painted granite (its kit stands a hand over the field floor).
    this.mesh.position.y = floorY + 0.3;
    this.mesh.renderOrder = floorVfxRenderOrder('encounter', 12);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /** One frame: the arrows' strength (0 hides them), the wind's way (unit
   *  x, z), pointing in to `focus` or not; `still` (reduced motion) holds
   *  them in place. */
  paint(
    strength: number,
    dir: { x: number; z: number },
    inward: boolean,
    focus: THREE.Vector2,
    dt: number,
    still: boolean,
  ): void {
    const u = this.mat.uniforms;
    this.mesh.visible = strength > 0.01;
    if (!this.mesh.visible) return;
    if (!still) this.flow = (this.flow + WIND_ARROWS.rate * (0.4 + 0.6 * strength) * dt) % 9000;
    u.uFlow.value = still ? WIND_ARROWS.spacing * 0.45 : this.flow;
    u.uStrength.value += (strength - u.uStrength.value) * Math.min(1, dt * 6);
    (u.uDir.value as THREE.Vector2).set(dir.x, dir.z);
    (u.uFocus.value as THREE.Vector2).copy(focus);
    u.uInward.value = inward ? 1 : 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
