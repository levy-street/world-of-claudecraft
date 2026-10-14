// Underwater ambience: the blue wash you swim inside, and the bubbles rising
// through it.
//
// Two objects, two draw calls, no per-frame CPU work beyond four uniform writes:
//
//  * TINT: a camera-facing quad pinned just past the near plane, drawn last with
//    depth testing off. The scene fog already darkens distance toward the same
//    blue (frame() applies an underwater fog override), but fog cannot reach
//    the sky dome, which renders unfogged; the quad is what stops a clear sky
//    showing through the surface from below and sells "you are inside water".
//
//  * BUBBLES: ONE THREE.Points whose whole animation lives in the vertex
//    shader. Each point owns a fixed offset inside a box, a phase and a rise
//    rate; the shader wraps it up the box with `mod`, so nothing is simulated,
//    respawned or uploaded. The box rides the camera, so bubbles are always
//    around the viewer and never need culling. Cost is one small draw of
//    ~40-140 points, and the whole view is skipped outright when dry.
//
// Both are additive to whatever the renderer already draws: nothing here touches
// the scene's materials, so surfacing simply fades the group back out.

import * as THREE from 'three';
import { isBuiltinWorldActive } from '../sim/data';
import { waterLevelAt } from '../sim/world';
import { createWaterApproachProbe } from './water_approach_core';
import { drawnWaterLevelAt } from './water_core';

/** The colour the world drowns toward. */
export const UNDERWATER_TINT = 0x1d5f87;
/** Fog the renderer eases toward while the camera is under the line. */
export const UNDERWATER_FOG_COLOR = 0x11466a;
export const UNDERWATER_FOG_NEAR = 1.5;
export const UNDERWATER_FOG_FAR = 46;
/** Depth below the waterline over which the wash fades fully in. */
const UNDERWATER_FADE_DEPTH = 0.45;
/** Peak opacity of the tint quad, at full submersion. */
const TINT_OPACITY = 0.46;

/**
 * A palette override for water you are meant to SEE THROUGH.
 *
 * The shipped wash is tuned for a murky lake: nearly half-opaque blue with fog
 * closing at 46 yd. The Deepglass is a 76-yard arena where reading the far ring
 * is the whole game, so it runs the same effect far lighter and clearer, the
 * cue comes from bubbles and motion, never from extinction
 * (docs/prd/deepglass.md section 6).
 */
export interface UnderwaterPalette {
  tint: number;
  tintOpacity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  bubbleColor: number;
}

export const DEEPGLASS_PALETTE: UnderwaterPalette = {
  tint: 0x3fa8cf,
  tintOpacity: 0.13,
  fogColor: 0x2d7ea8,
  fogNear: 14,
  fogFar: 210,
  bubbleColor: 0xeaf9ff,
};

export const DEFAULT_PALETTE: UnderwaterPalette = {
  tint: UNDERWATER_TINT,
  tintOpacity: TINT_OPACITY,
  fogColor: UNDERWATER_FOG_COLOR,
  fogNear: UNDERWATER_FOG_NEAR,
  fogFar: UNDERWATER_FOG_FAR,
  bubbleColor: 0xdff2ff,
};
/** Vertical extent of the bubble column (yards). Points wrap within it. */
const BUBBLE_BOX_HEIGHT = 9;
/** Bubbles seat in an ANNULUS around the camera: anything spawned at the lens
 *  projects to a screen-filling blob however small its world size. */
const BUBBLE_RADIUS_MIN = 1.6;
const BUBBLE_RADIUS_MAX = 7;

/** One frame of the eased 0..1 blend toward the camera's depth under `level`,
 *  the waterline at the camera (-Infinity off water). Fading across the first
 *  half-yard under the line makes breaking the surface a wash lifting rather
 *  than a switch flipping. */
export function underwaterBlendStep(
  blend: number,
  level: number,
  cameraY: number,
  dt: number,
): number {
  const depth = Number.isFinite(level) ? level - cameraY : -1;
  const target = Math.min(1, Math.max(0, depth / UNDERWATER_FADE_DEPTH));
  return blend + (target - blend) * (1 - Math.exp(-dt * 7));
}

/** Pull the fog toward the water by `blend`. It rides ON TOP of whatever the
 *  biome fog easing just wrote: the easing pulls back toward the zone preset
 *  every frame and this pulls toward the water, so surfacing restores the
 *  biome's own fog with no state to unwind. */
export function applyUnderwaterFog(
  fog: THREE.Fog,
  blend: number,
  scratch: THREE.Color,
  palette: UnderwaterPalette = DEFAULT_PALETTE,
): void {
  if (blend <= 0.002) return;
  fog.color.lerp(scratch.setHex(palette.fogColor), blend);
  fog.near += (palette.fogNear - fog.near) * blend;
  fog.far += (palette.fogFar - fog.far) * blend;
}

/** The renderer's live compile gate (`renderer.compileGate`), the shape
 *  fish.ts takes: link a root's programs off-thread, resolve once linked. */
export type UnderwaterCompileGate = (root: THREE.Object3D) => Promise<unknown>;

/** The water's half of the gate: the one live underside mesh it links (null
 *  where the water has no underside) and the hold that keeps every underside
 *  hidden until that link settles. */
export interface UnderwaterWaterSide {
  undersideRoot(): THREE.Object3D | null;
  setUndersideHeld(held: boolean): void;
}

const BUBBLE_VERT = /* glsl */ `
  attribute vec3 aOffset;   // x/z seat in the box, y = starting height
  attribute vec2 aMotion;   // x = rise rate, y = wobble phase
  attribute float aSize;    // relative radius, 0.35..1.6
  uniform float uTime;
  uniform float uHeight;
  uniform float uSize;
  varying float vFade;
  varying float vSize;
  void main() {
    vSize = aSize;
    // Bigger bubbles climb faster (buoyancy beats drag as radius grows), which
    // is most of what makes a real bubble stream read as physical rather than
    // as drifting dots.
    float rise = aOffset.y + uTime * aMotion.x * (0.55 + aSize * 0.7);
    // mod() is the whole "respawn": a bubble leaving the top re-enters at the
    // bottom, so the stream is endless without any CPU-side particle bookkeeping.
    float y = mod(rise, uHeight) - uHeight * 0.5;
    // Small bubbles jitter tightly and quickly, big ones sway wide and slow.
    float wobRate = 2.6 / (0.5 + aSize);
    float wobAmp = 0.06 + aSize * 0.16;
    float wob = uTime * wobRate + aMotion.y;
    vec3 p = vec3(
      aOffset.x + sin(wob) * wobAmp,
      y,
      aOffset.z + cos(wob * 0.83 + aMotion.y) * wobAmp
    );
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // fade in off the bottom and out at the top so wrapping never pops
    float h = (y + uHeight * 0.5) / uHeight;
    vFade = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.82, 1.0, h));
    // Perspective size with a hard ceiling: a bubble that drifts close must not
    // grow into a full-screen sprite (point sprites have no far/near clipping
    // of their own, so this clamp IS the near plane for them).
    gl_PointSize = clamp(uSize * aSize * 40.0 / max(0.6, -mv.z), 1.5, 26.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const BUBBLE_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  varying float vSize;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    // a bright rim over a faint fill: reads as a gas bubble rather than a dot
    float rim = smoothstep(0.5, 0.95, r);
    // Specular pip up and to the left, the giveaway that a bubble is a lit
    // sphere of gas. Only worth drawing on bubbles big enough to show it.
    float pip = smoothstep(0.30, 0.0, length(d - vec2(-0.16, 0.16)))
              * smoothstep(0.55, 1.1, vSize);
    float a = uOpacity * vFade * (0.10 + rim * 0.8 + pip * 0.9)
            * (1.0 - smoothstep(0.9, 1.0, r));
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uColor + pip * 0.35, a);
  }
`;

// The bubble pair the built-in world shipped with (one size, a fixed wobble, no
// specular pip). The sized bubbles above are the Studio's, for authored maps.
const BUBBLE_VERT_CLASSIC = /* glsl */ `
  attribute vec3 aOffset;   // x/z seat in the box, y = starting height
  attribute vec2 aMotion;   // x = rise rate, y = wobble phase
  uniform float uTime;
  uniform float uHeight;
  uniform float uSize;
  varying float vFade;
  void main() {
    float rise = aOffset.y + uTime * aMotion.x;
    float y = mod(rise, uHeight) - uHeight * 0.5;
    float wob = uTime * 1.7 + aMotion.y;
    vec3 p = vec3(aOffset.x + sin(wob) * 0.14, y, aOffset.z + cos(wob * 0.83) * 0.14);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float h = (y + uHeight * 0.5) / uHeight;
    vFade = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.82, 1.0, h));
    gl_PointSize = clamp(uSize * 40.0 / max(0.6, -mv.z), 1.5, 18.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const BUBBLE_FRAG_CLASSIC = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
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
  private readonly fogScratch = new THREE.Color();
  private time = 0;
  private blend = 0;
  // 'ready' with no gate installed (no async compile: nothing to wait for).
  // With one: 'idle' until water is near, 'linking' while the gate holds the
  // live group and underside, then 'ready'. A rejected link is ready too:
  // the wash is cosmetic, so it never stays hidden on a failed compile.
  private gateState: 'idle' | 'linking' | 'ready' = 'ready';
  private compileGate: UnderwaterCompileGate | null = null;
  private water: (() => UnderwaterWaterSide) | null = null;
  private gatedWater: UnderwaterWaterSide | null = null;
  private gateEpoch = 0;
  private readonly approach = createWaterApproachProbe(waterLevelAt);

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
    const classicBubbles = isBuiltinWorldActive();
    const offsets = new Float32Array(count * 3);
    const motion = new Float32Array(count * 2);
    const sizes = new Float32Array(count);
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
      // Skewed small: a real stream is mostly fine bubbles with a few fat ones.
      if (!classicBubbles) sizes[i] = 0.35 + Math.random() ** 2.2 * 1.25;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));
    geo.setAttribute('aMotion', new THREE.BufferAttribute(motion, 2));
    if (!classicBubbles) geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BUBBLE_BOX_HEIGHT);

    this.bubbleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: BUBBLE_BOX_HEIGHT },
        uSize: { value: lowGfx ? 1.0 : 1.3 },
        uColor: { value: new THREE.Color(0xdff2ff) },
        uOpacity: { value: 0 },
      },
      vertexShader: classicBubbles ? BUBBLE_VERT_CLASSIC : BUBBLE_VERT,
      fragmentShader: classicBubbles ? BUBBLE_FRAG_CLASSIC : BUBBLE_FRAG,
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

  /** One frame of the camera under a waterline: a blue wash, shortened fog,
   *  and a rising bubble stream. Keyed off the CAMERA, not the player, so a
   *  third-person boom that dips below the surface reads right, and a swimmer
   *  at the surface with the camera under it still sees water rather than air.
   *  `inBell`: the camera is inside the Deepglass bell, which holds its OWN
   *  sealed water (the arena world parks the global waterline far below the
   *  slate), so submersion there is "inside the glass", not "under the line",
   *  and it takes the far lighter DEEPGLASS_PALETTE. */
  frame(
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    player: { readonly x: number; readonly z: number },
    seed: number,
    dt: number,
    inBell = false,
  ): void {
    const cam = camera.position;
    const level = drawnWaterLevelAt(cam.x, cam.y, cam.z, seed);
    const water = this.water?.() ?? null;
    // The editor rebuilds the water view, disposing the underside material
    // the gate linked: the new one is gated afresh.
    if (water !== this.gatedWater) {
      this.gatedWater = water;
      this.gateEpoch++;
      if (this.compileGate) this.gateState = 'idle';
    }
    if (
      this.gateState === 'idle' &&
      (inBell || Number.isFinite(level) || this.approach.near(player.x, player.z, seed))
    ) {
      this.armCompileGate();
    }
    water?.setUndersideHeld(this.gateState !== 'ready');
    // Inside the bell the wash is always full: the same eased step toward 1.
    this.blend = inBell
      ? this.blend + (1 - this.blend) * (1 - Math.exp(-dt * 7))
      : underwaterBlendStep(this.blend, level, cam.y, dt);
    const palette = inBell ? DEEPGLASS_PALETTE : DEFAULT_PALETTE;
    this.update(camera, this.blend, dt, palette);
    // The fog stays outside the hold: view range under water is gameplay.
    applyUnderwaterFog(scene.fog as THREE.Fog, this.blend, this.fogScratch, palette);
  }

  /** Install (or clear) the renderer's live compile gate and the water whose
   *  underside it links alongside this view. With a gate, the wash and the
   *  undersides stay hidden until water comes near the player and the gate
   *  settles on the LIVE objects, so the program linked is the one drawn.
   *  Without one (no async compile) they show at once. */
  setCompileGate(gate: UnderwaterCompileGate | null, water: () => UnderwaterWaterSide): void {
    this.compileGate = gate;
    this.water = water;
    this.gatedWater = water();
    this.gateEpoch++;
    this.gateState = gate ? 'idle' : 'ready';
    this.gatedWater.setUndersideHeld(this.gateState !== 'ready');
  }

  private armCompileGate(): void {
    const gate = this.compileGate;
    if (!gate) return;
    this.gateState = 'linking';
    const epoch = this.gateEpoch;
    // Flag only on settle: frame() applies it on the next frame boundary.
    const settle = (): void => {
      if (epoch === this.gateEpoch) this.gateState = 'ready';
    };
    const underside = this.gatedWater?.undersideRoot() ?? null;
    try {
      const links = [gate(this.group)];
      if (underside) links.push(gate(underside));
      void Promise.allSettled(links).then(settle);
    } catch {
      settle();
    }
  }

  /**
   * @param blend 0 = fully dry (the group hides and costs nothing), 1 = the
   *              camera is well under the waterline.
   */
  update(
    camera: THREE.PerspectiveCamera,
    blend: number,
    dt: number,
    palette: UnderwaterPalette = DEFAULT_PALETTE,
  ): void {
    const amount = Math.min(1, Math.max(0, blend));
    this.group.visible = amount > 0.002 && this.gateState === 'ready';
    if (!this.group.visible) return;

    this.time += dt;
    this.bubbleMat.uniforms.uTime.value = this.time;
    this.bubbleMat.uniforms.uOpacity.value = amount;
    this.bubbleMat.uniforms.uColor.value.setHex(palette.bubbleColor);
    this.tint.material.color.setHex(palette.tint);
    this.tint.material.opacity = palette.tintOpacity * amount;

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
