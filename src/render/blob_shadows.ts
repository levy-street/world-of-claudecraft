// The contact-blob painter: ONE InstancedMesh of soft ground blobs, one
// instance per nearby character, for the tiers that cast no dynamic shadow at
// all (GFX.dynamicShadows false). The renderer builds it only there, fills it
// from its own character loop (`begin` / `push` / `commit`), and never touches
// it on a tier that has real shadows, so the two grounding layers can never
// both draw under one body. All of the per-body decisions (where, how big,
// whether at all) live in the pure `blob_shadow_core.ts`; this file is the
// Three half: pool, texture, material, and the buffer write.
//
// Cost shape, deliberately flat: one draw call for the whole crowd, no
// allocation per frame (one scratch Matrix4 plus the pool's own buffers), and a
// write-elided upload (a still scene re-uploads nothing).
import * as THREE from 'three';
import type { BlobShadowSlot } from './blob_shadow_core';

/**
 * Instance capacity. The night-glow disc pool (mob_night_glow.ts) does the same
 * job shape, one ground decal per nearby body, and holds 64; blobs are filtered
 * harder still (on-screen bodies only, inside the articulated-rig range), so 64
 * covers a busier crowd here than it does there. Past it a body simply goes
 * without a blob, which is the crowd-safe failure mode: the cue is cosmetic,
 * and in a throng that dense the blobs overlap into one dark patch anyway.
 */
export const BLOB_SHADOW_POOL = 64;

/**
 * Plane half-extent per yard of footprint radius. The texture's alpha reaches
 * zero at the rim, so the plane has to overhang the footprint it darkens; 1.3
 * is the ball's own 2.6-across-per-radius plane (vale_cup_ball.ts).
 */
const BLOB_PLANE_SPREAD = 1.3;

/**
 * Material opacity, over the texture below. Calibrated with the character in
 * front of it, not the raw gradient: a body OCCLUDES the middle of its own
 * blob from the chase camera, so what actually grounds it is the skirt. The
 * Vale Cup ball's contact texture (0.42 core fading from a 2 px radius) put
 * its peak exactly where the body hides it and left a sub-perception skirt on
 * dark ground, measured invisible in the frozen-frame A/B; the character
 * texture holds a wide 0.55 core to 40 percent radius and a 0.35 shoulder to
 * 75 percent, landing the VISIBLE ring near 0.30 after this multiplier.
 */
const BLOB_SHADOW_OPACITY = 0.85;

/** The character contact-blob texture: same near-black warm tint as the Vale
 *  Cup ball's blob, wider and denser (see BLOB_SHADOW_OPACITY for why the
 *  ball's own texture reads as nothing under a body that stands on it). */
function characterBlobTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(10,8,5,0.55)');
  grd.addColorStop(0.4, 'rgba(10,8,5,0.55)');
  grd.addColorStop(0.75, 'rgba(10,8,5,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;
  private readonly texture: THREE.CanvasTexture;
  private readonly matrix = new THREE.Matrix4();
  /** Last uploaded transform per slot, so an unchanged frame uploads nothing. */
  // Float64: the slot values are doubles, and a Float32Array round-trip
  // truncates them, so every === comparison below would be false for real
  // world coordinates and the elision would never fire (review round 1).
  private readonly lastX = new Float64Array(BLOB_SHADOW_POOL);
  private readonly lastY = new Float64Array(BLOB_SHADOW_POOL);
  private readonly lastZ = new Float64Array(BLOB_SHADOW_POOL);
  private readonly lastScale = new Float64Array(BLOB_SHADOW_POOL);
  private count = 0;
  private dirty = false;

  constructor() {
    // Rotated flat once at build time rather than per instance: every blob lies
    // in the same plane, so a per-instance quaternion would compose the same
    // rotation 64 times a frame for nothing.
    const geometry = new THREE.PlaneGeometry(2 * BLOB_PLANE_SPREAD, 2 * BLOB_PLANE_SPREAD);
    geometry.rotateX(-Math.PI / 2);
    this.texture = characterBlobTexture();
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: BLOB_SHADOW_OPACITY,
      depthWrite: false,
      // A horizontal plane over a slope z-fights against the terrain well
      // before a lift big enough to clear it stops reading as a sticker
      // hovering over the ground (impact_site.ts, player_aura_rings.ts).
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, BLOB_SHADOW_POOL);
    this.mesh.name = 'character-blob-shadows';
    // Player-centred pool, rewritten every frame from anywhere in the band: a
    // baked bounding sphere is stale the moment it is computed, and recomputing
    // it per frame costs more than the draw it would save.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; // over the ground, under the world's own decals
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    // Seed every slot so an unwritten one can never inherit a factory zero and
    // collapse a blob onto the world origin.
    const identity = new THREE.Matrix4();
    for (let i = 0; i < BLOB_SHADOW_POOL; i++) this.mesh.setMatrixAt(i, identity);
  }

  /** Start a frame's fill. Call once, before the character loop. */
  begin(): void {
    this.count = 0;
    this.dirty = false;
  }

  /**
   * Take one planned blob. A hidden slot (or an overflowing pool) is simply
   * dropped: nothing is written and the instance never reaches the draw.
   */
  push(slot: BlobShadowSlot): void {
    if (!slot.visible || this.count >= BLOB_SHADOW_POOL) return;
    const i = this.count++;
    if (
      this.lastX[i] === slot.x &&
      this.lastY[i] === slot.y &&
      this.lastZ[i] === slot.z &&
      this.lastScale[i] === slot.scale
    ) {
      return; // this slot already holds exactly this transform
    }
    this.lastX[i] = slot.x;
    this.lastY[i] = slot.y;
    this.lastZ[i] = slot.z;
    this.lastScale[i] = slot.scale;
    const s = slot.scale;
    // Uniform scale + translation, written straight (Matrix4.set is row major),
    // so there is no Vector3/Quaternion scratch to keep in step.
    this.matrix.set(s, 0, 0, slot.x, 0, s, 0, slot.y, 0, 0, s, slot.z, 0, 0, 0, 1);
    this.mesh.setMatrixAt(i, this.matrix);
    this.dirty = true;
  }

  /** Close the frame's fill. Call once, after the character loop. */
  commit(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    if (this.dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
    this.mesh.dispose();
  }
}
