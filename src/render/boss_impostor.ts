// The world boss you can see from the far side of the zone: the Three side.
//
// Policy, geometry math and the handoff distances live in `boss_impostor_core.ts`; this file
// bakes the atlas and draws the quad. Read that header first, it explains WHY a moving
// subject cannot just be a thirteenth foliage category.
//
// Cost model: one 12-cell atlas baked once, on the first frame a landmark boss is actually
// far enough away to need it (never at boot, because he is only alive for part of an hour
// and most sessions never see him), and ONE two-triangle draw per landmark thereafter. That
// is cheaper than the articulated rig by three orders of magnitude, which is the only reason
// drawing him at unbounded range is affordable at all.
import * as THREE from 'three';
import { MOBS } from '../sim/data';
import type { Entity } from '../sim/types';
import {
  BOSS_IMPOSTOR_VIEWS,
  bossImpostorAlpha,
  bossImpostorBearing,
  bossImpostorFogMix,
  bossImpostorFrame,
  bossImpostorQuadSize,
} from './boss_impostor_core';
import { prepareVisual, tintedFarMaterials } from './characters/assets';
import { VISUALS, visualKeyFor } from './characters/manifest';
import { SUN_DIR } from './gfx';

/**
 * Pixels per baked view.
 *
 * He is never drawn larger than a few dozen pixels tall at the ranges this covers (a 13-yard
 * body at 90 yards is about 8% of a 1080p frame's height), so 256 is already generous; the
 * headroom is for a player who walks right up to the handoff band on a 4K display.
 */
const CELL_PX = 256;
const ATLAS_COLS = 4;
const ATLAS_ROWS = Math.ceil(BOSS_IMPOSTOR_VIEWS / ATLAS_COLS);

/** Neutral bake lighting: the sprite is lit at draw time, not baked lit into the texture. */
const BAKE_SKY = 1.5;
const BAKE_KEY = 2.4;

interface Landmark {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Two cells, one mix, one alpha test. The fog is applied by hand rather than through three's
// fog chunk because the ceiling in the core is the whole point: the shipped chunk would take
// the silhouette to fog colour long before the distance this exists to cover.
const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uCellA;
uniform vec2 uCellB;
uniform vec2 uCellSize;
uniform float uBlend;
uniform float uAlpha;
uniform vec3 uFogColor;
uniform float uFogMix;
varying vec2 vUv;

void main() {
  vec4 a = texture2D(uAtlas, uCellA + vUv * uCellSize);
  vec4 b = texture2D(uAtlas, uCellB + vUv * uCellSize);
  vec4 c = mix(a, b, uBlend);
  // Cut BEFORE the fade multiplies alpha down, or the whole quad passes the test as soon as
  // the sprite starts fading in and he arrives on the horizon as a grey rectangle.
  if (c.a < 0.35) discard;
  vec3 rgb = mix(c.rgb, uFogColor, uFogMix);
  gl_FragColor = vec4(rgb, uAlpha);
}
`;

/**
 * Far sprites for every mob whose template calls itself a landmark.
 *
 * Owns one atlas shared by all of them (there is realistically one at a time) and one mesh
 * each. The renderer drives it from `sync()`; nothing here reads or writes world state.
 */
export class BossImpostorField {
  private group = new THREE.Group();
  private atlas: THREE.WebGLRenderTarget | null = null;
  private atlasKey: string | null = null;
  /** Aspect of the baked frame, so the drawn quad cannot stretch or crop the silhouette. */
  private frameAspect = 1;
  private bakeFailed = false;
  private live = new Map<number, Landmark>();
  private quad: THREE.BufferGeometry | null = null;

  constructor(private scene: THREE.Scene) {
    this.group.name = 'bossImpostors';
    // He is a solid body on the horizon, not a glow: he must occlude and be occluded by the
    // terrain in front of him like anything else, so this stays in the default render order
    // with depth writes on.
    this.group.renderOrder = 0;
    scene.add(this.group);
  }

  /**
   * Place, size and orient every landmark sprite for this frame.
   *
   * `viewer` is the position the handoff distance is measured from (the player, not the
   * camera: the camera can be a long way behind them, and a boss should appear at the same
   * range whether you are zoomed in or out).
   */
  sync(
    webgl: THREE.WebGLRenderer,
    entities: Iterable<Entity>,
    camera: THREE.Camera,
    viewer: { x: number; z: number },
    fog: THREE.Fog | null,
    groundAt: (x: number, z: number) => number,
  ): void {
    const seen = new Set<number>();
    for (const e of entities) {
      if (e.kind !== 'mob' || e.dead) continue;
      const range = MOBS[e.templateId]?.landmarkRange;
      if (!range) continue;
      const dx = e.pos.x - viewer.x;
      const dz = e.pos.z - viewer.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range) continue;
      const alpha = bossImpostorAlpha(dist);
      if (alpha <= 0) continue;
      const key = visualKeyFor(e);
      if (!key || !this.ensureAtlas(webgl, key, e)) continue;
      seen.add(e.id);
      this.place(e, key, camera, alpha, fog, groundAt);
    }
    for (const [id, lm] of this.live) {
      if (seen.has(id)) continue;
      lm.mesh.removeFromParent();
      lm.mat.dispose();
      this.live.delete(id);
    }
  }

  private place(
    e: Entity,
    key: string,
    camera: THREE.Camera,
    alpha: number,
    fog: THREE.Fog | null,
    groundAt: (x: number, z: number) => number,
  ): void {
    const def = VISUALS[key];
    if (!def) return;
    const height = def.height * (e.scale ?? 1);
    let lm = this.live.get(e.id);
    if (!lm) {
      lm = this.build();
      this.live.set(e.id, lm);
    }
    // Height from the manifest, width from the BAKE's own frame: a quad whose aspect differs
    // from the frame the cells were shot in either squashes him or crops his arms, and both
    // read as a different creature at the only distance this is ever seen from.
    const size = bossImpostorQuadSize(height);
    lm.mesh.scale.set(size.h * this.frameAspect, size.h, 1);
    // Feet on the ground, sprite centred on the body. The sim's y is authoritative for a
    // grounded mob, but a boss mid-launch or on a slope reads better anchored to the surface
    // he is standing over than to a lagging wire position.
    const y = Math.max(e.pos.y, groundAt(e.pos.x, e.pos.z));
    lm.mesh.position.set(e.pos.x, y + size.h / 2, e.pos.z);
    // Billboard around Y only: he stands on the ground, so tilting him to face a camera
    // looking down would lay a thirteen-yard body over on the grass.
    const camPos = camera.getWorldPosition(TMP_CAM);
    lm.mesh.rotation.set(0, Math.atan2(camPos.x - e.pos.x, camPos.z - e.pos.z), 0);

    const frame = bossImpostorFrame(
      bossImpostorBearing(camPos.x, camPos.z, e.pos.x, e.pos.z, e.facing),
    );
    const u = lm.mat.uniforms;
    setCell(u.uCellA.value as THREE.Vector2, frame.a);
    setCell(u.uCellB.value as THREE.Vector2, frame.b);
    u.uBlend.value = frame.blend;
    u.uAlpha.value = alpha;
    if (fog) {
      const d = camPos.distanceTo(lm.mesh.position);
      const raw = (d - fog.near) / Math.max(1, fog.far - fog.near);
      u.uFogMix.value = bossImpostorFogMix(raw);
      (u.uFogColor.value as THREE.Color).copy(fog.color);
    } else {
      u.uFogMix.value = 0;
    }
  }

  private build(): Landmark {
    if (!this.quad) this.quad = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: true,
      uniforms: {
        uAtlas: { value: this.atlas?.texture ?? null },
        uCellA: { value: new THREE.Vector2() },
        uCellB: { value: new THREE.Vector2() },
        uCellSize: { value: new THREE.Vector2(1 / ATLAS_COLS, 1 / ATLAS_ROWS) },
        uBlend: { value: 0 },
        uAlpha: { value: 0 },
        uFogColor: { value: new THREE.Color(0x9fb0bd) },
        uFogMix: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(this.quad, mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, mat };
  }

  /** Bake the atlas on first need. Returns false if it cannot be built (assets not in yet). */
  private ensureAtlas(webgl: THREE.WebGLRenderer, key: string, e: Entity): boolean {
    if (this.atlasKey === key) return true;
    // One landmark at a time is the shipped reality; a second one with a different model
    // would want a second atlas, so refuse rather than silently draw the wrong silhouette.
    if (this.atlasKey || this.bakeFailed) return false;
    try {
      const baked = bakeBossAtlas(webgl, key, e);
      this.atlas = baked.target;
      this.frameAspect = baked.frameW / Math.max(1e-6, baked.frameH);
      this.atlasKey = key;
      for (const lm of this.live.values()) lm.mat.uniforms.uAtlas.value = this.atlas.texture;
      return true;
    } catch {
      // Fail soft and never retry: a missing model must cost one frame's try, not one per
      // frame forever, and losing the far sprite is cosmetic.
      this.bakeFailed = true;
      return false;
    }
  }

  dispose(): void {
    for (const lm of this.live.values()) lm.mat.dispose();
    this.live.clear();
    this.quad?.dispose();
    this.quad = null;
    this.atlas?.dispose();
    this.atlas = null;
    this.atlasKey = null;
    this.group.removeFromParent();
    this.scene.remove(this.group);
  }
}

const TMP_CAM = new THREE.Vector3();

function setCell(out: THREE.Vector2, index: number): void {
  out.set((index % ATLAS_COLS) / ATLAS_COLS, Math.floor(index / ATLAS_COLS) / ATLAS_ROWS);
}

/**
 * Render the model from a ring of yaw angles into one atlas.
 *
 * The subject is the SAME baked idle-pose geometry the far LOD already uses, so the sprite
 * and the frozen mesh it takes over from are the same silhouette and the handoff has nothing
 * to reveal. Materials go through `tintedFarMaterials` for the same reason: the entity's own
 * colour grade is part of what makes him recognizable at range.
 */
/** What one bake produced: the atlas plus the world-space frame each cell was shot in. */
interface BakedAtlas {
  target: THREE.WebGLRenderTarget;
  /** Frame width and height in NORMALIZED model units, so the draw quad can match it. */
  frameW: number;
  frameH: number;
}

/**
 * Render the model from a ring of yaw angles into one atlas.
 *
 * The subject is the SAME baked idle-pose geometry the far LOD already uses, so the sprite
 * and the frozen mesh it takes over from are the same silhouette and the handoff has nothing
 * to reveal. Materials go through `tintedFarMaterials` for the same reason: the entity's own
 * colour grade is part of what makes him recognizable at range.
 */
function bakeBossAtlas(webgl: THREE.WebGLRenderer, key: string, e: Entity): BakedAtlas {
  const prep = prepareVisual(key);
  if (!prep.idleGeo) throw new Error(`no baked idle geometry for ${key}`);
  const mats = tintedFarMaterials(
    prep.def,
    e.color ?? 0xffffff,
    prep.idleSrcMats,
    prep.idleSrcIsBody,
  );

  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x6b6256, BAKE_SKY);
  scene.add(hemi);
  // A key light as well as the dome. A hemisphere alone bakes a flat, evenly grey slab: at
  // this distance the ONLY thing carrying his shape is the light-to-shadow gradient across
  // it, and without a key there is no gradient to carry.
  const key1 = new THREE.DirectionalLight(0xfff2dd, BAKE_KEY);
  key1.position.copy(SUN_DIR).multiplyScalar(10);
  scene.add(key1);
  const holder = new THREE.Group();
  scene.add(holder);
  const body = new THREE.Mesh(prep.idleGeo, mats);
  holder.add(body);

  // Frame the model from its own bounds rather than from the manifest height: the manifest
  // number is what the rig is SCALED to, and a creature whose arms reach past his head is
  // taller in the bake than the number says. Framing on the number crops his hands off.
  //
  // Width comes from the LARGER horizontal extent because he spins inside this frame: his
  // depth becomes his width a quarter turn later, and framing on x alone crops his profile.
  prep.idleGeo.computeBoundingBox();
  const bb = prep.idleGeo.boundingBox;
  if (!bb) throw new Error(`no bounds for ${key}`);
  body.position.set(
    -(bb.min.x + bb.max.x) / 2,
    -(bb.min.y + bb.max.y) / 2,
    -(bb.min.z + bb.max.z) / 2,
  );
  const spanX = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  const spanY = bb.max.y - bb.min.y;
  const frameW = spanX * 1.04;
  const frameH = spanY * 1.04;
  const reach = Math.max(frameW, frameH);

  const camera = new THREE.OrthographicCamera(
    -frameW / 2,
    frameW / 2,
    frameH / 2,
    -frameH / 2,
    0.01,
    reach * 8,
  );
  camera.position.set(0, 0, reach * 4);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const target = new THREE.WebGLRenderTarget(CELL_PX * ATLAS_COLS, CELL_PX * ATLAS_ROWS, {
    depthBuffer: true,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  const prevTarget = webgl.getRenderTarget();
  const prevClear = new THREE.Color();
  webgl.getClearColor(prevClear);
  const prevAlpha = webgl.getClearAlpha();
  const prevAutoClear = webgl.autoClear;
  let done = false;
  try {
    // Clear alpha 0 (the fragment shader's alpha test carves the silhouette out of it) with
    // a stone-grey clear RGB, not black: bilinear filtering averages edge texels toward the
    // clear colour, and a black one rings the whole silhouette with a dark halo.
    webgl.setClearColor(0x6f6a63, 0);
    webgl.autoClear = false;
    target.scissorTest = true;
    target.viewport.set(0, 0, target.width, target.height);
    target.scissor.set(0, 0, target.width, target.height);
    webgl.setRenderTarget(target);
    webgl.clear(true, true, false);
    for (let i = 0; i < BOSS_IMPOSTOR_VIEWS; i++) {
      const col = i % ATLAS_COLS;
      const row = Math.floor(i / ATLAS_COLS);
      // View i is the model spun by +i/views of a turn, so cell i is the picture of him seen
      // from bearing i. `bossImpostorFrame` picks cells with the same sign convention.
      holder.rotation.y = (i / BOSS_IMPOSTOR_VIEWS) * Math.PI * 2;
      holder.updateMatrixWorld(true);
      target.viewport.set(col * CELL_PX, row * CELL_PX, CELL_PX, CELL_PX);
      target.scissor.set(col * CELL_PX, row * CELL_PX, CELL_PX, CELL_PX);
      // setRenderTarget AFTER the viewport write, and once PER CELL. Three latches the
      // target's viewport and scissor into renderer state at bind time, so mutating them on
      // a target that is already bound changes nothing: every view lands in the same cell,
      // and the finished atlas is one full-frame portrait that draws as a grey rectangle.
      // (The shipped foliage bake does the same thing for the same reason.)
      webgl.setRenderTarget(target);
      webgl.clear(true, true, false);
      webgl.render(scene, camera);
    }
    target.scissorTest = false;
    done = true;
  } finally {
    webgl.setRenderTarget(prevTarget);
    webgl.setClearColor(prevClear, prevAlpha);
    webgl.autoClear = prevAutoClear;
    if (!done) target.dispose();
  }
  return { target, frameW, frameH };
}
