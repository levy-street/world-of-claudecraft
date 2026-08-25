// The world boss you can see from the far side of the zone: the Three side.
//
// Policy, geometry math and the handoff decision live in `boss_impostor_core.ts`; this file
// bakes the atlas and draws the quad. Read that header first, it explains WHY a moving
// subject cannot just be a thirteenth foliage category.
//
// The handoff is a HARD CUT, and deliberately so. The rig's own visibility decides which of
// the two representations draws (never both, see `bossImpostorShows`), the quad is placed on
// the exact world rectangle the atlas cells were shot in, and the frozen far mesh the rig
// shows at the band edge IS the geometry the atlas was baked from. So the frame before the
// cut and the frame after draw the same silhouette in the same place, and a cross-fade would
// only add a window in which he is translucent against the terrain, which is what a switch
// you can see looks like.
//
// Cost model: one 12-cell atlas baked once, on the first frame a landmark boss is actually
// out of the rig band (never at boot, because he is only alive for part of an hour and most
// sessions never see him), and ONE two-triangle draw per landmark thereafter. That is cheaper
// than the articulated rig by three orders of magnitude, which is the only reason drawing him
// at unbounded range is affordable at all.
import * as THREE from 'three';
import { MOBS } from '../sim/data';
import type { Entity } from '../sim/types';
import {
  BOSS_IMPOSTOR_BAKE_KEY,
  BOSS_IMPOSTOR_BAKE_SKY,
  BOSS_IMPOSTOR_VIEWS,
  type BossImpostorFrameMetrics,
  bossImpostorBearing,
  bossImpostorFogMix,
  bossImpostorFrame,
  bossImpostorFrameMetrics,
  bossImpostorLightGrade,
  bossImpostorQuadPlacement,
  bossImpostorShows,
} from './boss_impostor_core';
import { prepareVisual, tintedFarMaterials } from './characters/assets';
import { visualKeyFor } from './characters/manifest';
import type { DayNightGrade } from './day_night_core';
import { wrapAngle } from './facing_smooth';
import { SUN_DIR } from './gfx';
import { facingAlpha, remoteEntityAlpha } from './net_interp_core';

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

// Two cells, one mix, one alpha test, then the live light grade and the fog. The fog is
// applied by hand rather than through three's fog chunk because the ceiling in the core is
// the whole point: the shipped chunk would take the silhouette to fog colour long before the
// distance this exists to cover. The grade multiplies BEFORE the fog mix: the fog colour the
// renderer hands over is already graded for the hour, so only the baked daylight needs it.
const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uCellA;
uniform vec2 uCellB;
uniform vec2 uCellSize;
uniform float uBlend;
uniform vec3 uLight;
uniform vec3 uFogColor;
uniform float uFogMix;
varying vec2 vUv;

void main() {
  vec4 a = texture2D(uAtlas, uCellA + vUv * uCellSize);
  vec4 b = texture2D(uAtlas, uCellB + vUv * uCellSize);
  vec4 c = mix(a, b, uBlend);
  if (c.a < 0.35) discard;
  vec3 rgb = mix(c.rgb * uLight, uFogColor, uFogMix);
  gl_FragColor = vec4(rgb, 1.0);
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
  /**
   * The world rectangle every cell was shot in, so the quad draws exactly that rectangle.
   * Identity until the first bake; nothing is placed before one succeeds.
   */
  private frame: BossImpostorFrameMetrics = { w: 1, h: 1, cx: 0, cy: 0.5, cz: 0 };
  private bakeFailed = false;
  private live = new Map<number, Landmark>();
  private quad: THREE.BufferGeometry | null = null;
  private light = new THREE.Vector3(1, 1, 1);

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
   * `viewer` is the position the landmark range is measured from (the player, not the
   * camera: the camera can be a long way behind them, and a boss should drop off at the
   * same range whether you are zoomed in or out). `rigShown` is the renderer's answer to
   * "am I drawing this entity's rig this frame"; the sprite draws only when it is false.
   * `grade` is the frame's live day/night grade as the RIG receives it (the neutral day
   * grade on a tier whose lights never take the grade, or the sprite goes darker than the
   * rig it replaces). `nowMs` and `alpha` are the same clock and sub-tick fraction the
   * entity loop interpolates rig positions with, so the sprite lands where the rig was
   * drawn, not up to one snapshot ahead of it.
   */
  sync(
    webgl: THREE.WebGLRenderer,
    entities: Iterable<Entity>,
    camera: THREE.Camera,
    viewer: { x: number; z: number },
    fog: THREE.Fog | null,
    rigShown: (entityId: number) => boolean,
    grade: DayNightGrade,
    nowMs: number,
    alpha: number,
  ): void {
    const lit = bossImpostorLightGrade(grade);
    this.light.set(lit[0], lit[1], lit[2]);
    const seen = new Set<number>();
    for (const e of entities) {
      if (e.kind !== 'mob') continue;
      const range = MOBS[e.templateId]?.landmarkRange;
      if (!range) continue;
      const dx = e.pos.x - viewer.x;
      const dz = e.pos.z - viewer.z;
      const shows = bossImpostorShows({
        rigShown: rigShown(e.id),
        dist: Math.hypot(dx, dz),
        landmarkRange: range,
        dead: e.dead,
        asleep: e.asleep === true,
      });
      if (!shows) continue;
      const key = visualKeyFor(e);
      if (!key || !this.ensureAtlas(webgl, key, e)) continue;
      seen.add(e.id);
      this.place(e, camera, fog, nowMs, alpha);
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
    camera: THREE.Camera,
    fog: THREE.Fog | null,
    nowMs: number,
    alpha: number,
  ): void {
    let lm = this.live.get(e.id);
    if (!lm) {
      lm = this.build();
      this.live.set(e.id, lm);
    }
    // The same interpolation the entity loop draws the rig with (prev to current by the
    // per-entity net cadence). Placing on the raw wire position instead put the sprite up
    // to one snapshot ahead of where the rig was drawn the frame before, and at the far
    // band's cadence that is yards: the cut read as a hop along his path.
    const ea = remoteEntityAlpha(nowMs, e.netUpdatedAt, e.netInterval, alpha);
    TMP_POS.set(
      e.prevPos.x + (e.pos.x - e.prevPos.x) * ea,
      e.prevPos.y + (e.pos.y - e.prevPos.y) * ea,
      e.prevPos.z + (e.pos.z - e.prevPos.z) * ea,
    );
    const facing = e.prevFacing + wrapAngle(e.facing - e.prevFacing) * facingAlpha(ea);
    // Size and anchor from the bake's own frame: the quad covers the rectangle the cells
    // were shot in, centred where the bake camera looked, so the silhouette is the far
    // mesh's size and sits on the far mesh's spot.
    const q = bossImpostorQuadPlacement(this.frame, e.scale ?? 1, facing, TMP_POS);
    lm.mesh.scale.set(q.w, q.h, 1);
    lm.mesh.position.set(q.x, q.y, q.z);
    // Billboard around Y only: he stands on the ground, so tilting him to face a camera
    // looking down would lay a thirteen-yard body over on the grass.
    const camPos = camera.getWorldPosition(TMP_CAM);
    lm.mesh.rotation.set(0, Math.atan2(camPos.x - q.x, camPos.z - q.z), 0);

    const frame = bossImpostorFrame(bossImpostorBearing(camPos.x, camPos.z, q.x, q.z, facing));
    const u = lm.mat.uniforms;
    setCell(u.uCellA.value as THREE.Vector2, frame.a);
    setCell(u.uCellB.value as THREE.Vector2, frame.b);
    u.uBlend.value = frame.blend;
    (u.uLight.value as THREE.Vector3).copy(this.light);
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
    // Opaque, alpha-tested: the shader carves the silhouette with a discard and writes
    // depth, so terrain in front of him hides him and he hides terrain behind him. Nothing
    // here is ever partially transparent (the handoff is a cut, not a fade), so the
    // transparent pass and its back-to-front sort would buy nothing.
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: false,
      depthWrite: true,
      uniforms: {
        uAtlas: { value: this.atlas?.texture ?? null },
        uCellA: { value: new THREE.Vector2() },
        uCellB: { value: new THREE.Vector2() },
        uCellSize: { value: new THREE.Vector2(1 / ATLAS_COLS, 1 / ATLAS_ROWS) },
        uBlend: { value: 0 },
        uLight: { value: new THREE.Vector3(1, 1, 1) },
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
      this.frame = baked.frame;
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
const TMP_POS = new THREE.Vector3();

function setCell(out: THREE.Vector2, index: number): void {
  out.set((index % ATLAS_COLS) / ATLAS_COLS, Math.floor(index / ATLAS_COLS) / ATLAS_ROWS);
}

/** What one bake produced: the atlas plus the world-space frame each cell was shot in. */
interface BakedAtlas {
  target: THREE.WebGLRenderTarget;
  /** The rectangle every cell covers, in the rig's normalized frame (see the core). */
  frame: BossImpostorFrameMetrics;
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
  const hemi = new THREE.HemisphereLight(0xffffff, 0x6b6256, BOSS_IMPOSTOR_BAKE_SKY);
  scene.add(hemi);
  // A key light as well as the dome. A hemisphere alone bakes a flat, evenly grey slab: at
  // this distance the ONLY thing carrying his shape is the light-to-shadow gradient across
  // it, and without a key there is no gradient to carry.
  const key1 = new THREE.DirectionalLight(0xfff2dd, BOSS_IMPOSTOR_BAKE_KEY);
  key1.position.copy(SUN_DIR).multiplyScalar(10);
  scene.add(key1);
  const holder = new THREE.Group();
  scene.add(holder);
  const body = new THREE.Mesh(prep.idleGeo, mats);
  holder.add(body);

  // The frame comes from the core so the draw quad can take the identical numbers: the
  // model's own bounds with the shared margin, centred on the bounding-box middle (which is
  // where the body is moved to, below, so the camera looks straight at it).
  prep.idleGeo.computeBoundingBox();
  const bb = prep.idleGeo.boundingBox;
  if (!bb) throw new Error(`no bounds for ${key}`);
  const frame = bossImpostorFrameMetrics(bb);
  body.position.set(-frame.cx, -frame.cy, -frame.cz);
  const reach = Math.max(frame.w, frame.h);

  const camera = new THREE.OrthographicCamera(
    -frame.w / 2,
    frame.w / 2,
    frame.h / 2,
    -frame.h / 2,
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
  return { target, frame };
}
