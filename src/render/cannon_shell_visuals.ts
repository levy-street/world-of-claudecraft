// A heavy cannon shot, drawn: the muzzle flash, smoke and barrel recoil, a
// glowing shell on its arc behind an instanced trail, and at the blast a flash,
// a shockwave, a dirt burst, a dust cloud, sparks, tumbling dirt chunks, a
// scorch on the ground, the renderer's AoE ring at the blast radius and a camera
// shake by distance. The look is the Realm Racers Ground Blast's, without its
// rival-dodge telegraph. Neutral: the caller passes the blast radius and feeds
// fire and impact events; the curves are cannon_shell_core.ts.
//
// GPU rules (src/render/CLAUDE.md "GPU work"): nothing is built until
// `prepare`, which mints every mesh, named material and texture the shot will
// ever draw and attaches the root behind the compile gate, hidden until its
// programs link; what stands in meanwhile is the renderer's boot-prewarmed
// particles and AoE ring, and the thrown monsters themselves. Every piece is an
// InstancedMesh on a shared material (fades ride instance colours on additive
// or subtractive blends, never a per-use clone), there are no lights and no
// shadows, and a frame allocates nothing.
//
// Tiers: the low static preset sheds cosmetic counts only (chunks, dirt, dust,
// sparks, smoke); the shell, the flash, the shockwave and the ring are the same
// on every tier. Reduced motion drops the camera shake and the FOV punch.
import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import {
  CANNON_BLAST,
  CANNON_CHUNKS_PER_IMPACT,
  CANNON_IMPACT_POOL,
  CANNON_MUZZLE,
  CANNON_SCORCH_POOL,
  CANNON_SHELL,
  CANNON_SHELL_POOL,
  type CannonBurstFrame,
  type CannonChunkFrame,
  type CannonFiredShot,
  type CannonImpactShot,
  type CannonMuzzleFlashFrame,
  type CannonPoint,
  type CannonShotCounts,
  CannonShotTimeline,
  cannonChunkInto,
  cannonFlashInto,
  cannonMuzzleFlashInto,
  cannonRecoilOffset,
  cannonScorchFade,
  cannonScorchTexels,
  cannonShakeFalloff,
  cannonShotCounts,
  cannonWaveInto,
} from './cannon_shell_core';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier } from './gfx';
import { tagVfxSubtree } from './renderer_diagnostics';
import type { Vfx } from './vfx';

/** The renderer services a shot draws with. */
export interface CannonShellHost {
  readonly vfx: Pick<Vfx, 'burst' | 'groundPuff'>;
  readonly camera: THREE.Camera;
  addShake(amount: number): void;
  punchFov(degrees: number): void;
  spawnAoeRing(x: number, z: number, radius: number, school: string, colorHex?: number): void;
}

export interface CannonShellOptions {
  blastRadius: number;
  groundAt: (x: number, z: number) => number;
  compileGate?: (target: THREE.Object3D) => Promise<unknown>;
  /** The static graphics preset (never the frame governor). */
  effectsTier?: GfxTier;
}

interface Parts {
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  readonly scorchTexture: THREE.DataTexture;
  readonly shells: THREE.InstancedMesh;
  readonly glows: THREE.InstancedMesh;
  readonly motes: THREE.InstancedMesh;
  readonly muzzleCore: THREE.InstancedMesh;
  readonly muzzleTongue: THREE.InstancedMesh;
  readonly flashes: THREE.InstancedMesh;
  readonly waves: THREE.InstancedMesh;
  readonly chunks: THREE.InstancedMesh;
  readonly scorches: THREE.InstancedMesh;
}

const SCORCH_TEXELS = 64;
const SCORCH_LIFT = 0.04;
const DIRT = 0x5b4632;
const DUST = 0x9c8a6c;
const SPARK = 0xffc56b;
const SMOKE = 0x8f8a80;
const SOIL_DARK = new THREE.Color(0x3a2a1c);
const SOIL_LIGHT = new THREE.Color(0x6e5a42);
const SOIL_GRASS = new THREE.Color(0x4d5a2c);
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const IDENTITY = new THREE.Quaternion();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const materialName = (role: string): string => `cannonShell:${role}`;

export class CannonShellVisuals {
  readonly root = new THREE.Group();
  private readonly timeline = new CannonShotTimeline();
  private readonly counts: Readonly<CannonShotCounts>;
  private readonly blastRadius: number;
  private readonly groundAt: (x: number, z: number) => number;
  private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>;
  private host: CannonShellHost | null = null;
  private parts: Parts | null = null;
  private disposed = false;
  private barrel: THREE.Object3D | null = null;
  private barrelKicked = false;
  private readonly barrelRest = new THREE.Vector3();
  private readonly barrelAxis = new THREE.Vector3(0, 0, 1);
  private readonly barrelTip = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly muzzleDir = new THREE.Vector3(0, 0, 1);
  private readonly muzzleTurn = new THREE.Quaternion();
  private readonly point: CannonPoint = { x: 0, y: 0, z: 0 };
  private readonly burstFrame: CannonBurstFrame = { scale: 0, fade: 0 };
  private readonly flashFrame: CannonMuzzleFlashFrame = { core: 0, length: 0, width: 0 };
  private readonly chunkFrame: CannonChunkFrame = { x: 0, y: 0, z: 0, angle: 0, scale: 0 };
  private readonly trail = new Float32Array(CANNON_SHELL.trailMotes * 4);
  private readonly liveScorches: boolean[] = new Array(CANNON_SCORCH_POOL).fill(false);
  private readonly liveChunks: boolean[] = new Array(CANNON_IMPACT_POOL).fill(false);
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly quat2 = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly at = new THREE.Vector3();

  constructor(options: CannonShellOptions) {
    this.blastRadius = options.blastRadius;
    this.groundAt = options.groundAt;
    this.compileGate = options.compileGate;
    const profile = resolveUiEffectsProfile({
      presetLabel: options.effectsTier ?? GFX.tier,
      effectsQuality: 1,
      reduceMotion: false,
    });
    this.counts = cannonShotCounts(profile.tier === 'low');
    this.root.name = 'fire-and-fly-weapon';
  }

  get prepared(): boolean {
    return this.parts !== null;
  }

  get hasBarrel(): boolean {
    return this.barrel !== null;
  }

  setHost(host: CannonShellHost | null): void {
    this.host = host;
  }

  /**
   * The barrel the muzzle and the recoil follow: `tip` is its muzzle point in
   * the node's own space, and it kicks back along its local +z. Null falls back
   * to the muzzle point each shot supplies. The previous barrel is set back to rest.
   */
  setBarrel(node: THREE.Object3D | null, tip: CannonPoint): void {
    if (node === this.barrel) return;
    this.restBarrel();
    this.barrel = node;
    if (!node) return;
    this.barrelRest.copy(node.position);
    this.barrelAxis.copy(FORWARD).applyQuaternion(node.quaternion);
    this.barrelTip.set(tip.x, tip.y, tip.z);
  }

  /** Mints every piece and attaches the root under `parent` behind the compile gate. */
  prepare(parent: THREE.Object3D): void {
    if (this.parts || this.disposed) return;
    this.parts = this.build();
    tagVfxSubtree(this.root);
    void attachSceneGroupGated(parent, this.root, this.compileGate, () => this.disposed).catch(
      () => {},
    );
  }

  /** A shell leaves the barrel (or `fallback` when there is none) toward the blast point. */
  fire(shot: CannonFiredShot, fallback: CannonPoint, time: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    this.muzzleInto(fallback, shot.x, shot.z);
    this.point.x = this.muzzle.x;
    this.point.y = this.muzzle.y;
    this.point.z = this.muzzle.z;
    this.timeline.fired(shot, this.point, time);
    this.muzzleTurn.setFromUnitVectors(FORWARD, this.muzzleDir);
    const host = this.host;
    if (!host) return;
    host.vfx.burst(this.muzzle, 'arcane', this.counts.sparks, 0.65);
    this.at.copy(this.muzzle).addScaledVector(this.muzzleDir, 0.6);
    for (let i = 0; i < this.counts.smoke; i++) {
      host.vfx.groundPuff(this.at, 0.55, SMOKE);
      this.at.addScaledVector(this.muzzleDir, 0.7);
    }
    if (reducedMotion) return;
    host.punchFov(CANNON_MUZZLE.fovPunch);
    host.addShake(CANNON_MUZZLE.shake);
  }

  /** The shell lands: blast, chunks, scorch, particles, ring and shake. */
  impact(shot: CannonImpactShot, time: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    const index = this.timeline.impact(shot, time, this.counts.chunks, this.groundAt);
    this.paintImpactColours(index);
    this.placeScorch();
    const host = this.host;
    if (!host) return;
    const { x, y, z } = shot;
    const vfx = host.vfx;
    vfx.burst(this.at.set(x, y + 0.35, z), 'blood', this.counts.dirt, 1.35, DIRT, 0.95);
    vfx.burst(this.at.set(x, y + 0.6, z), 'fire', 16, 1.1);
    vfx.burst(this.at.set(x, y + 0.5, z), 'arcane', this.counts.sparks, 1.7, SPARK, 0.55);
    for (let i = 0; i < this.counts.dust; i++) {
      const angle = (i / this.counts.dust) * Math.PI * 2 + shot.shotId;
      const reach = i === 0 ? 0 : this.blastRadius * 0.3;
      this.at.set(x + Math.sin(angle) * reach, y, z + Math.cos(angle) * reach);
      vfx.groundPuff(this.at, 1, DUST);
    }
    host.spawnAoeRing(x, z, this.blastRadius, 'physical');
    if (reducedMotion) return;
    const eye = host.camera.position;
    const falloff = cannonShakeFalloff(Math.hypot(x - eye.x, y - eye.y, z - eye.z));
    if (falloff > 0) host.addShake(CANNON_BLAST.shake * falloff);
  }

  /** Stops every shot, blast and scorch, and sets the barrel back to rest. */
  clear(): void {
    this.timeline.clear();
    this.restBarrel();
    const parts = this.parts;
    if (!parts) return;
    for (const mesh of this.meshes(parts)) {
      mesh.count = 0;
      mesh.visible = false;
    }
    this.liveChunks.fill(false);
    this.liveScorches.fill(false);
  }

  /** `tick` is the display tick the monsters are sampled on; `time` the frame seconds. */
  update(tick: number, time: number): void {
    this.recoil(time);
    const parts = this.parts;
    if (!parts || this.disposed) return;
    this.drawShells(parts, tick);
    this.drawMuzzle(parts, time);
    this.drawBlasts(parts, time);
    this.drawChunks(parts, time);
    this.drawScorches(parts, time);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.restBarrel();
    this.barrel = null;
    this.root.removeFromParent();
    const parts = this.parts;
    this.parts = null;
    if (!parts) return;
    const errors: unknown[] = [];
    const resources = [
      ...this.meshes(parts),
      ...parts.geometries,
      ...parts.materials,
      parts.scorchTexture,
    ];
    for (const resource of resources) {
      try {
        resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Cannon shot failed to dispose');
  }

  private restBarrel(): void {
    if (this.barrel && this.barrelKicked) this.barrel.position.copy(this.barrelRest);
    this.barrelKicked = false;
  }

  private recoil(time: number): void {
    const barrel = this.barrel;
    if (!barrel) return;
    const kick = cannonRecoilOffset(time - this.timeline.muzzleAt);
    if (kick !== 0) {
      barrel.position.copy(this.barrelRest).addScaledVector(this.barrelAxis, -kick);
      this.barrelKicked = true;
    } else if (this.barrelKicked) {
      barrel.position.copy(this.barrelRest);
      this.barrelKicked = false;
    }
  }

  private muzzleInto(fallback: CannonPoint, towardX: number, towardZ: number): void {
    const barrel = this.barrel;
    if (barrel) {
      this.restBarrel();
      barrel.updateWorldMatrix(true, false);
      this.muzzle.copy(this.barrelTip).applyMatrix4(barrel.matrixWorld);
      this.muzzleDir.setFromMatrixColumn(barrel.matrixWorld, 2);
      if (this.muzzleDir.lengthSq() > 1e-8 && Number.isFinite(this.muzzle.x)) {
        this.muzzleDir.normalize();
        return;
      }
    }
    this.muzzle.set(fallback.x, fallback.y, fallback.z);
    this.muzzleDir.set(towardX - fallback.x, 0, towardZ - fallback.z);
    if (this.muzzleDir.lengthSq() < 1e-8) this.muzzleDir.copy(FORWARD);
    this.muzzleDir.normalize();
  }

  private meshes(parts: Parts): THREE.InstancedMesh[] {
    return [
      parts.shells,
      parts.glows,
      parts.motes,
      parts.muzzleCore,
      parts.muzzleTongue,
      parts.flashes,
      parts.waves,
      parts.chunks,
      parts.scorches,
    ];
  }

  private build(): Parts {
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const geometry = <T extends THREE.BufferGeometry>(g: T): T => {
      geometries.push(g);
      return g;
    };
    const basic = (role: string, params: THREE.MeshBasicMaterialParameters) => {
      const material = new THREE.MeshBasicMaterial({ name: materialName(role), ...params });
      materials.push(material);
      return material;
    };
    const additive = (role: string, color: number, opacity: number) =>
      basic(role, {
        color,
        opacity,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    const tongue = geometry(new THREE.ConeGeometry(1, 1, 12));
    // Tip at the muzzle, opening along +z.
    tongue.translate(0, -0.5, 0);
    tongue.rotateX(-Math.PI / 2);
    const wave = geometry(new THREE.RingGeometry(0.82, 1, 48, 1));
    wave.rotateX(-Math.PI / 2);
    const scorch = geometry(new THREE.PlaneGeometry(2, 2));
    scorch.rotateX(-Math.PI / 2);
    const scorchTexture = new THREE.DataTexture(
      cannonScorchTexels(SCORCH_TEXELS),
      SCORCH_TEXELS,
      SCORCH_TEXELS,
      THREE.RGBAFormat,
    );
    scorchTexture.name = materialName('scorch');
    scorchTexture.magFilter = THREE.LinearFilter;
    scorchTexture.minFilter = THREE.LinearMipmapLinearFilter;
    scorchTexture.generateMipmaps = true;
    scorchTexture.needsUpdate = true;
    const lambert = new THREE.MeshLambertMaterial({ name: materialName('chunk'), color: 0xffffff });
    materials.push(lambert);
    const parts: Parts = {
      geometries,
      materials,
      scorchTexture,
      shells: this.instanced(
        'shell',
        geometry(new THREE.IcosahedronGeometry(0.3, 1)),
        basic('shell', { color: 0xdcf7ff }),
        CANNON_SHELL_POOL,
        false,
      ),
      glows: this.instanced(
        'glow',
        geometry(new THREE.IcosahedronGeometry(0.72, 1)),
        additive('glow', 0x63d5ff, 0.4),
        CANNON_SHELL_POOL,
        false,
      ),
      motes: this.instanced(
        'trail',
        geometry(new THREE.IcosahedronGeometry(0.2, 0)),
        additive('trail', 0x9ce6ff, 0.7),
        CANNON_SHELL_POOL * CANNON_SHELL.trailMotes,
        false,
      ),
      muzzleCore: this.instanced(
        'muzzleCore',
        geometry(new THREE.IcosahedronGeometry(1, 1)),
        additive('muzzleCore', 0xf2fbff, 1),
        1,
        false,
      ),
      muzzleTongue: this.instanced(
        'muzzleTongue',
        tongue,
        additive('muzzleTongue', 0x8fe3ff, 0.85),
        1,
        false,
      ),
      flashes: this.instanced(
        'flash',
        geometry(new THREE.IcosahedronGeometry(1, 2)),
        additive('flash', 0xfff0cf, 1),
        CANNON_IMPACT_POOL,
        true,
      ),
      waves: this.instanced('wave', wave, additive('wave', 0xffd9a0, 1), CANNON_IMPACT_POOL, true),
      chunks: this.instanced(
        'chunk',
        geometry(new THREE.DodecahedronGeometry(1, 0)),
        lambert,
        CANNON_IMPACT_POOL * CANNON_CHUNKS_PER_IMPACT,
        true,
      ),
      // Subtractive: the ground under it darkens by the texel, times the fade
      // in its instance colour, so a spent scorch darkens nothing.
      scorches: this.instanced(
        'scorch',
        scorch,
        basic('scorch', {
          map: scorchTexture,
          transparent: true,
          depthWrite: false,
          blending: THREE.SubtractiveBlending,
          premultipliedAlpha: true,
          fog: false,
          toneMapped: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -4,
        }),
        CANNON_SCORCH_POOL,
        true,
      ),
    };
    parts.waves.renderOrder = floorVfxRenderOrder('player', 1);
    parts.scorches.renderOrder = floorVfxRenderOrder('ground', 1);
    for (const mesh of [parts.chunks, parts.scorches]) {
      for (let i = 0; i < mesh.instanceMatrix.count; i++) mesh.setMatrixAt(i, ZERO);
    }
    return parts;
  }

  private instanced(
    role: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    coloured: boolean,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `cannonShell:${role}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The colour attribute is a program key bit: it exists from the build, so
    // the gate links the very program the first blast draws.
    if (coloured) for (let i = 0; i < count; i++) mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
    mesh.count = 0;
    mesh.visible = false;
    this.root.add(mesh);
    return mesh;
  }

  private paintImpactColours(index: number): void {
    const parts = this.parts;
    if (!parts) return;
    const slot = this.timeline.impacts[index];
    const base = index * CANNON_CHUNKS_PER_IMPACT;
    for (let i = 0; i < slot.chunkCount; i++) {
      const shade = slot.chunks[i].shade;
      if (shade > 0.84) this.color.copy(SOIL_GRASS);
      else this.color.copy(SOIL_DARK).lerp(SOIL_LIGHT, shade / 0.84);
      parts.chunks.setColorAt(base + i, this.color);
    }
    for (let i = slot.chunkCount; i < CANNON_CHUNKS_PER_IMPACT; i++) {
      parts.chunks.setMatrixAt(base + i, ZERO);
    }
    const colors = parts.chunks.instanceColor;
    if (colors) colors.needsUpdate = true;
    parts.chunks.instanceMatrix.needsUpdate = true;
    this.liveChunks[index] = slot.chunkCount > 0;
  }

  /** The newest scorch's matrix is static: flat on the ground's normal, turned by its yaw. */
  private placeScorch(): void {
    const parts = this.parts;
    const newest = this.timeline.lastScorch;
    if (!parts || newest < 0) return;
    const s = this.timeline.scorches[newest];
    this.axis.set(s.nx, s.ny, s.nz);
    this.quat.setFromUnitVectors(UP, this.axis);
    this.quat2.setFromAxisAngle(UP, s.yaw);
    this.quat.multiply(this.quat2);
    const size = this.blastRadius * CANNON_BLAST.scorchScale;
    this.pos.set(s.x, s.y + SCORCH_LIFT, s.z);
    this.scale.set(size, 1, size);
    this.matrix.compose(this.pos, this.quat, this.scale);
    parts.scorches.setMatrixAt(newest, this.matrix);
    parts.scorches.instanceMatrix.needsUpdate = true;
    this.liveScorches[newest] = true;
  }

  private commit(mesh: THREE.InstancedMesh, count: number, coloured = false): void {
    mesh.count = count;
    mesh.visible = count > 0;
    if (count === 0) return;
    mesh.instanceMatrix.needsUpdate = true;
    if (coloured && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private drawShells(parts: Parts, tick: number): void {
    const timeline = this.timeline;
    let shells = 0;
    let motes = 0;
    for (let i = 0; i < CANNON_SHELL_POOL; i++) {
      if (timeline.shellAt(i, tick, this.point)) {
        const age = timeline.shellAge(i, tick);
        this.pos.set(this.point.x, this.point.y, this.point.z);
        this.euler.set(CANNON_SHELL.spinX * age, CANNON_SHELL.spinY * age, 0);
        this.quat.setFromEuler(this.euler);
        this.matrix.compose(this.pos, this.quat, this.scale.setScalar(1));
        parts.shells.setMatrixAt(shells, this.matrix);
        const pulse = 1 + CANNON_SHELL.glowPulse * Math.sin(CANNON_SHELL.glowRate * age);
        this.matrix.compose(this.pos, IDENTITY, this.scale.setScalar(pulse));
        parts.glows.setMatrixAt(shells, this.matrix);
        shells++;
      }
      const n = timeline.trailInto(i, tick, this.trail);
      for (let k = 0; k < n; k++) {
        const at = k * 4;
        const size = this.trail[at + 3];
        this.matrix.makeScale(size, size, size);
        this.matrix.setPosition(this.trail[at], this.trail[at + 1], this.trail[at + 2]);
        parts.motes.setMatrixAt(motes++, this.matrix);
      }
    }
    this.commit(parts.shells, shells);
    this.commit(parts.glows, shells);
    this.commit(parts.motes, motes);
  }

  private drawMuzzle(parts: Parts, time: number): void {
    const shown = cannonMuzzleFlashInto(time - this.timeline.muzzleAt, this.flashFrame);
    if (shown) {
      const f = this.flashFrame;
      this.matrix.compose(this.muzzle, IDENTITY, this.scale.setScalar(f.core));
      parts.muzzleCore.setMatrixAt(0, this.matrix);
      this.matrix.compose(this.muzzle, this.muzzleTurn, this.scale.set(f.width, f.width, f.length));
      parts.muzzleTongue.setMatrixAt(0, this.matrix);
    }
    this.commit(parts.muzzleCore, shown ? 1 : 0);
    this.commit(parts.muzzleTongue, shown ? 1 : 0);
  }

  private drawBlasts(parts: Parts, time: number): void {
    let flashes = 0;
    let waves = 0;
    for (const slot of this.timeline.impacts) {
      if (!slot.active) continue;
      const age = time - slot.at;
      if (age >= CANNON_BLAST.chunkLife) slot.active = false;
      if (cannonFlashInto(age, this.blastRadius, this.burstFrame)) {
        this.pos.set(slot.x, slot.y + CANNON_BLAST.flashLift, slot.z);
        this.matrix.compose(this.pos, IDENTITY, this.scale.setScalar(this.burstFrame.scale));
        parts.flashes.setMatrixAt(flashes, this.matrix);
        const fade = this.burstFrame.fade;
        parts.flashes.setColorAt(flashes++, this.color.setRGB(fade, fade, fade));
      }
      if (cannonWaveInto(age, this.blastRadius, this.burstFrame)) {
        this.pos.set(slot.x, slot.y + CANNON_BLAST.waveLift, slot.z);
        this.matrix.compose(this.pos, IDENTITY, this.scale.setScalar(this.burstFrame.scale));
        parts.waves.setMatrixAt(waves, this.matrix);
        const fade = this.burstFrame.fade;
        parts.waves.setColorAt(waves++, this.color.setRGB(fade, fade, fade));
      }
    }
    this.commit(parts.flashes, flashes, true);
    this.commit(parts.waves, waves, true);
  }

  private drawChunks(parts: Parts, time: number): void {
    const impacts = this.timeline.impacts;
    let any = false;
    let wrote = false;
    for (let s = 0; s < impacts.length; s++) {
      if (!this.liveChunks[s]) continue;
      const slot = impacts[s];
      const age = time - slot.at;
      const base = s * CANNON_CHUNKS_PER_IMPACT;
      let live = false;
      for (let i = 0; i < slot.chunkCount; i++) {
        const chunk = slot.chunks[i];
        if (!slot.active || !cannonChunkInto(chunk, age, this.chunkFrame)) {
          parts.chunks.setMatrixAt(base + i, ZERO);
          continue;
        }
        live = true;
        const f = this.chunkFrame;
        this.axis.set(chunk.axisX, chunk.axisY, chunk.axisZ);
        this.quat.setFromAxisAngle(this.axis, f.angle);
        this.pos.set(f.x, f.y, f.z);
        this.scale.set(f.scale * (0.8 + 0.4 * chunk.shade), f.scale * 0.7, f.scale);
        this.matrix.compose(this.pos, this.quat, this.scale);
        parts.chunks.setMatrixAt(base + i, this.matrix);
      }
      wrote = true;
      this.liveChunks[s] = live;
      any ||= live;
    }
    if (wrote) parts.chunks.instanceMatrix.needsUpdate = true;
    parts.chunks.count = any ? parts.chunks.instanceMatrix.count : 0;
    parts.chunks.visible = any;
  }

  private drawScorches(parts: Parts, time: number): void {
    let any = false;
    let wrote = false;
    const scorches = this.timeline.scorches;
    for (let i = 0; i < scorches.length; i++) {
      if (!this.liveScorches[i]) continue;
      const s = scorches[i];
      const age = time - s.at;
      wrote = true;
      if (!s.active || age >= CANNON_BLAST.scorchLife) {
        s.active = false;
        this.liveScorches[i] = false;
        parts.scorches.setMatrixAt(i, ZERO);
        parts.scorches.instanceMatrix.needsUpdate = true;
        continue;
      }
      any = true;
      const fade = cannonScorchFade(age);
      parts.scorches.setColorAt(i, this.color.setRGB(fade, fade, fade));
    }
    if (wrote && parts.scorches.instanceColor) parts.scorches.instanceColor.needsUpdate = true;
    parts.scorches.count = any ? parts.scorches.instanceMatrix.count : 0;
    parts.scorches.visible = any;
  }
}
