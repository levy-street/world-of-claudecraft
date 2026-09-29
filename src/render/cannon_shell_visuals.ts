// A heavy cannon shot, drawn: at the muzzle a yellow-orange flash, a flame
// tongue and a grey-brown smoke puff, with the barrel's recoil; a dark iron
// shell in a hot orange glow on its arc, shedding grey smoke and warm sparks;
// at the blast a white-yellow flash, a fireball that cools into rising smoke, a
// brown-grey dust cloud that lingers, a beige ring of dust rolling out along the
// ground, dark dirt clods and tumbling chunks thrown 3 to 5 yd up, hot sparks,
// and a dark scorch draped on the ground that fades over its life; the camera
// shakes by distance. Neutral: the caller passes the blast radius and feeds fire
// and impact events; the curves are cannon_shell_core.ts and cannon_puff_core.ts.
//
// GPU rules (src/render/CLAUDE.md "GPU work"): nothing is built until
// `prepare`, which mints every mesh, named material and texture the shot will
// ever draw and attaches the root behind the compile gate, hidden until its
// programs link; while it is hidden, the renderer's boot-prewarmed particles
// stand in at the muzzle and the blast, beside the thrown monsters themselves.
// Four draws on shared materials: the shells and the chunks are instanced, the
// scorches one draped mesh (their fade rides its vertex colours on a
// subtractive blend), every puff one instanced quad (cannon_puff_mesh.ts); no
// per-use clone, no light, no shadow, and a frame allocates nothing.
//
// Tiers: the low static preset sheds cosmetic counts only (chunks, dirt, dust,
// sparks, smoke); the shell and its wake, the flash, the fireball and the shock
// ring are the same on every tier. Reduced motion drops the camera shake and the
// FOV punch.
import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import {
  CANNON_PUFF_KINDS,
  CANNON_PUFF_LAYERS,
  type CannonPuff,
  type CannonPuffFrame,
  cannonBlastPower,
  cannonPuffInto,
  cannonPuffLightInto,
  cannonShellGlowInto,
  newCannonPuff,
  newCannonPuffFrame,
} from './cannon_puff_core';
import { CannonPuffMesh } from './cannon_puff_mesh';
import {
  CANNON_BLAST,
  CANNON_BLAST_PUFFS,
  CANNON_CHUNKS_PER_IMPACT,
  CANNON_IMPACT_POOL,
  CANNON_MUZZLE,
  CANNON_MUZZLE_POOL,
  CANNON_MUZZLE_PUFFS,
  CANNON_SCORCH_GRID,
  CANNON_SCORCH_LAYERS,
  CANNON_SCORCH_POOL,
  CANNON_SCORCH_VERTS,
  CANNON_SHELL,
  CANNON_SHELL_POOL,
  CANNON_TRAIL_PUFFS,
  type CannonChunkFrame,
  type CannonFiredShot,
  type CannonImpactShot,
  type CannonPoint,
  type CannonShotCounts,
  CannonShotTimeline,
  cannonChunkInto,
  cannonRecoilOffset,
  cannonScorchDrapeInto,
  cannonScorchFade,
  cannonScorchTexels,
  cannonShakeFalloff,
  cannonShotCounts,
} from './cannon_shell_core';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier } from './gfx';
import { tagVfxSubtree } from './renderer_diagnostics';
import type { Vfx } from './vfx';

/** The renderer services a shot draws with. */
export interface CannonShellHost {
  /** The boot-prewarmed particle cloud: the stand-in while the weapon's gate is pending. */
  readonly vfx: Pick<Vfx, 'burst'>;
  readonly camera: THREE.Camera;
  addShake(amount: number): void;
  punchFov(degrees: number): void;
}

/** A blast event, with the bodies it struck when the caller has them (a core hit reads bigger). */
export interface CannonBlast extends CannonImpactShot {
  readonly hits?: readonly { readonly falloff: number }[];
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
  readonly chunks: THREE.InstancedMesh;
  readonly scorch: THREE.Mesh;
  readonly scorchPosition: THREE.BufferAttribute;
  readonly scorchColor: THREE.BufferAttribute;
  readonly puffs: CannonPuffMesh;
}

const SCORCH_TEXELS = 64;
const IRON = 0x2b2622;
const SOIL_DARK = new THREE.Color(0x3a2a1c);
const SOIL_LIGHT = new THREE.Color(0x6e5a42);
const SOIL_GRASS = new THREE.Color(0x4d5a2c);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const BLACK = { r: 0, g: 0, b: 0 };
const FORWARD = new THREE.Vector3(0, 0, 1);
const PUFF_CAPACITY =
  CANNON_SHELL_POOL * (CANNON_TRAIL_PUFFS + 1) +
  CANNON_MUZZLE_POOL * CANNON_MUZZLE_PUFFS +
  CANNON_IMPACT_POOL * CANNON_BLAST_PUFFS;
/** Floats of one draped layer (xyz or rgb per vertex) and of one scorch's slice. */
const LAYER_FLOATS = CANNON_SCORCH_VERTS * 3;
const SCORCH_FLOATS = LAYER_FLOATS * CANNON_SCORCH_LAYERS.length;

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
  private readonly point: CannonPoint = { x: 0, y: 0, z: 0 };
  private readonly dir: CannonPoint = { x: 0, y: 0, z: 1 };
  private readonly chunkFrame: CannonChunkFrame = { x: 0, y: 0, z: 0, angle: 0, scale: 0 };
  private readonly trailPuffs: CannonPuff[] = Array.from(
    { length: CANNON_TRAIL_PUFFS },
    newCannonPuff,
  );
  private readonly trailAges = new Float32Array(CANNON_TRAIL_PUFFS);
  private readonly frames: CannonPuffFrame[] = Array.from(
    { length: PUFF_CAPACITY },
    newCannonPuffFrame,
  );
  private frameCount = 0;
  private readonly byKind = new Int32Array(CANNON_PUFF_KINDS);
  private readonly liveScorches: boolean[] = new Array(CANNON_SCORCH_POOL).fill(false);
  private readonly scorchFades = new Float32Array(CANNON_SCORCH_POOL);
  private readonly liveChunks: boolean[] = new Array(CANNON_IMPACT_POOL).fill(false);
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly at = new THREE.Vector3();
  private readonly light = { r: 1, g: 1, b: 1 };
  private hemi: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private lightsSought = false;

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

  /** Puffs of `kind` (cannon_puff_core.ts PUFF) the last frame drew. */
  drawnPuffs(kind: number): number {
    return this.byKind[kind] ?? 0;
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
    this.dir.x = this.muzzleDir.x;
    this.dir.y = this.muzzleDir.y;
    this.dir.z = this.muzzleDir.z;
    this.timeline.fired(shot, this.point, this.dir, time, this.counts.smoke);
    const host = this.host;
    if (!host) return;
    if (!this.revealed()) host.vfx.burst(this.muzzle, 'fire', 10, 0.8);
    if (reducedMotion) return;
    host.punchFov(CANNON_MUZZLE.fovPunch);
    host.addShake(CANNON_MUZZLE.shake);
  }

  /** The shell lands: its blast, chunks, puffs, scorch and shake. */
  impact(shot: CannonBlast, time: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    const power = cannonBlastPower(shot.hits);
    const index = this.timeline.impact(
      shot,
      time,
      this.counts,
      this.blastRadius,
      power,
      this.groundAt,
    );
    this.paintImpactColours(index);
    this.placeScorch();
    const host = this.host;
    if (!host) return;
    const { x, y, z } = shot;
    if (!this.revealed()) {
      host.vfx.burst(this.at.set(x, y + 0.6, z), 'fire', 16, 1.2);
      host.vfx.burst(this.at.set(x, y + 0.4, z), 'blood', 20, 1.3, 0x5b4632, 0.9);
    }
    if (reducedMotion) return;
    const eye = host.camera.position;
    const falloff = cannonShakeFalloff(Math.hypot(x - eye.x, y - eye.y, z - eye.z));
    if (falloff > 0) host.addShake(CANNON_BLAST.shake * falloff * power);
  }

  /** Stops every shot, blast and scorch, and sets the barrel back to rest. */
  clear(): void {
    this.timeline.clear();
    this.restBarrel();
    const parts = this.parts;
    if (!parts) return;
    parts.shells.count = 0;
    parts.shells.visible = false;
    parts.chunks.count = 0;
    parts.chunks.visible = false;
    this.liveChunks.fill(false);
    for (let i = 0; i < CANNON_SCORCH_POOL; i++) {
      if (this.liveScorches[i]) this.retireScorch(parts, i);
    }
    parts.scorch.visible = false;
    this.byKind.fill(0);
    parts.puffs.begin();
    parts.puffs.end();
  }

  /** `tick` is the display tick the monsters are sampled on; `time` the frame seconds. */
  update(tick: number, time: number): void {
    this.recoil(time);
    const parts = this.parts;
    if (!parts || this.disposed) return;
    this.frameCount = 0;
    this.lightPuffs(parts);
    this.drawShells(parts, tick);
    this.gatherMuzzles(time);
    this.gatherBlasts(time);
    this.drawPuffs(parts);
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
    const resources: { dispose(): void }[] = [
      parts.shells,
      parts.chunks,
      ...parts.geometries,
      ...parts.materials,
      parts.scorchTexture,
      parts.puffs,
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

  /** The gate has revealed the weapon's own pieces (false while their programs link). */
  private revealed(): boolean {
    return this.parts !== null && this.root.visible && this.root.parent !== null;
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

  private build(): Parts {
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const geometry = <T extends THREE.BufferGeometry>(g: T): T => {
      geometries.push(g);
      return g;
    };
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
    const shellMaterial = new THREE.MeshBasicMaterial({ name: materialName('shell'), color: IRON });
    const chunkMaterial = new THREE.MeshLambertMaterial({
      name: materialName('chunk'),
      color: 0xffffff,
    });
    // Subtractive: the ground under it darkens by the texel times the fade in
    // its vertex colours, so a spent scorch darkens nothing.
    const scorchMaterial = new THREE.MeshBasicMaterial({
      name: materialName('scorch'),
      map: scorchTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.SubtractiveBlending,
      premultipliedAlpha: true,
      fog: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    materials.push(shellMaterial, chunkMaterial, scorchMaterial);
    const shells = this.instanced(
      'shell',
      geometry(new THREE.IcosahedronGeometry(0.2, 1)),
      shellMaterial,
      CANNON_SHELL_POOL,
      false,
    );
    const chunks = this.instanced(
      'chunk',
      geometry(new THREE.DodecahedronGeometry(1, 0)),
      chunkMaterial,
      CANNON_IMPACT_POOL * CANNON_CHUNKS_PER_IMPACT,
      true,
    );
    for (let i = 0; i < chunks.instanceMatrix.count; i++) chunks.setMatrixAt(i, ZERO);
    const scorchGeometry = geometry(this.scorchGeometry());
    const scorch = new THREE.Mesh(scorchGeometry, scorchMaterial);
    scorch.name = materialName('scorch');
    scorch.frustumCulled = false;
    scorch.castShadow = false;
    scorch.receiveShadow = false;
    scorch.visible = false;
    scorch.renderOrder = floorVfxRenderOrder('ground', 1);
    const puffs = new CannonPuffMesh(PUFF_CAPACITY, materialName('puff'));
    // Airborne, but it must paint after the scorch it rises over and under every
    // telegraph and the aim reticle: the player band's upper rungs.
    puffs.mesh.renderOrder = floorVfxRenderOrder('player', 4);
    this.root.add(scorch, puffs.mesh);
    return {
      geometries,
      materials,
      scorchTexture,
      shells,
      chunks,
      scorch,
      scorchPosition: scorchGeometry.getAttribute('position') as THREE.BufferAttribute,
      scorchColor: scorchGeometry.getAttribute('color') as THREE.BufferAttribute,
      puffs,
    };
  }

  /** Every scorch's draped layers in one mesh, collapsed to a point until it is laid. */
  private scorchGeometry(): THREE.BufferGeometry {
    const grid = CANNON_SCORCH_GRID;
    const layers = CANNON_SCORCH_LAYERS.length;
    const grids = CANNON_SCORCH_POOL * layers;
    const verts = grids * CANNON_SCORCH_VERTS;
    const positions = new Float32Array(verts * 3);
    const colors = new Float32Array(verts * 3);
    const uvs = new Float32Array(verts * 2);
    const index = new Uint16Array(grids * grid * grid * 6);
    let u = 0;
    let q = 0;
    for (let s = 0; s < grids; s++) {
      const base = s * CANNON_SCORCH_VERTS;
      for (let j = 0; j <= grid; j++) {
        for (let i = 0; i <= grid; i++) {
          uvs[u++] = i / grid;
          uvs[u++] = j / grid;
        }
      }
      for (let j = 0; j < grid; j++) {
        for (let i = 0; i < grid; i++) {
          const a = base + j * (grid + 1) + i;
          const b = a + 1;
          const c = a + grid + 1;
          const d = c + 1;
          index[q++] = a;
          index[q++] = c;
          index[q++] = b;
          index[q++] = b;
          index[q++] = c;
          index[q++] = d;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(positions, 3);
    position.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.BufferAttribute(colors, 3);
    color.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('color', color);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return geometry;
  }

  private instanced(
    role: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    coloured: boolean,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = materialName(role);
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

  /** The newest scorch is draped once, where it lands; only its fade changes after. */
  private placeScorch(): void {
    const parts = this.parts;
    const newest = this.timeline.lastScorch;
    if (!parts || newest < 0) return;
    const s = this.timeline.scorches[newest];
    for (let layer = 0; layer < CANNON_SCORCH_LAYERS.length; layer++) {
      cannonScorchDrapeInto(
        parts.scorchPosition.array as Float32Array,
        newest * SCORCH_FLOATS + layer * LAYER_FLOATS,
        s.x,
        s.z,
        s.yaw,
        this.blastRadius * CANNON_BLAST.scorchScale,
        CANNON_SCORCH_LAYERS[layer].lift,
        this.groundAt,
      );
    }
    parts.scorchPosition.addUpdateRange(newest * SCORCH_FLOATS, SCORCH_FLOATS);
    parts.scorchPosition.needsUpdate = true;
    this.setScorchFade(parts, newest, 0);
    this.liveScorches[newest] = true;
  }

  private setScorchFade(parts: Parts, slot: number, fade: number): void {
    const colors = parts.scorchColor.array as Float32Array;
    for (let layer = 0; layer < CANNON_SCORCH_LAYERS.length; layer++) {
      const from = slot * SCORCH_FLOATS + layer * LAYER_FLOATS;
      colors.fill(fade * CANNON_SCORCH_LAYERS[layer].strength, from, from + LAYER_FLOATS);
    }
    parts.scorchColor.addUpdateRange(slot * SCORCH_FLOATS, SCORCH_FLOATS);
    parts.scorchColor.needsUpdate = true;
    this.scorchFades[slot] = fade;
  }

  private retireScorch(parts: Parts, slot: number): void {
    const positions = parts.scorchPosition.array as Float32Array;
    positions.fill(0, slot * SCORCH_FLOATS, (slot + 1) * SCORCH_FLOATS);
    parts.scorchPosition.addUpdateRange(slot * SCORCH_FLOATS, SCORCH_FLOATS);
    parts.scorchPosition.needsUpdate = true;
    this.setScorchFade(parts, slot, 0);
    this.timeline.scorches[slot].active = false;
    this.liveScorches[slot] = false;
  }

  /**
   * Smoke and dust take the scene's hemisphere and sun as graded this frame
   * (day, dusk, night): read-only, found once among the scene's own children.
   */
  private lightPuffs(parts: Parts): void {
    if (!this.lightsSought && this.root.parent) {
      this.lightsSought = true;
      let top: THREE.Object3D = this.root;
      while (top.parent) top = top.parent;
      for (const child of top.children) {
        const light = child as THREE.HemisphereLight & THREE.DirectionalLight;
        if (light.isHemisphereLight && !this.hemi) this.hemi = light;
        else if (light.isDirectionalLight && !this.sun) this.sun = light;
      }
    }
    const hemi = this.hemi;
    const sun = this.sun;
    if (!hemi && !sun) return;
    cannonPuffLightInto(
      hemi ? hemi.color : BLACK,
      hemi ? hemi.groundColor : BLACK,
      hemi ? hemi.intensity : 0,
      sun ? sun.color : BLACK,
      sun ? sun.intensity : 0,
      this.light,
    );
    parts.puffs.setLight(this.light.r, this.light.g, this.light.b);
  }

  private nextFrame(): CannonPuffFrame | null {
    return this.frameCount < this.frames.length ? this.frames[this.frameCount] : null;
  }

  private gather(puff: CannonPuff, age: number): void {
    const frame = this.nextFrame();
    if (frame && cannonPuffInto(puff, age, frame)) this.frameCount++;
  }

  private drawShells(parts: Parts, tick: number): void {
    const timeline = this.timeline;
    let shells = 0;
    for (let i = 0; i < CANNON_SHELL_POOL; i++) {
      if (timeline.shellAt(i, tick, this.point)) {
        const age = timeline.shellAge(i, tick);
        this.pos.set(this.point.x, this.point.y, this.point.z);
        this.euler.set(CANNON_SHELL.spinX * age, CANNON_SHELL.spinY * age, 0);
        this.quat.setFromEuler(this.euler);
        this.matrix.compose(this.pos, this.quat, this.scale.setScalar(1));
        parts.shells.setMatrixAt(shells++, this.matrix);
        const glow = this.nextFrame();
        if (glow) {
          cannonShellGlowInto(this.point.x, this.point.y, this.point.z, age, glow);
          this.frameCount++;
        }
      }
      const n = timeline.trailPuffsInto(i, tick, this.trailPuffs, this.trailAges);
      for (let k = 0; k < n; k++) this.gather(this.trailPuffs[k], this.trailAges[k]);
    }
    parts.shells.count = shells;
    parts.shells.visible = shells > 0;
    if (shells > 0) parts.shells.instanceMatrix.needsUpdate = true;
  }

  private gatherMuzzles(time: number): void {
    for (const slot of this.timeline.muzzles) {
      if (!slot.active) continue;
      const age = time - slot.at;
      if (age >= CANNON_MUZZLE.life) {
        slot.active = false;
        continue;
      }
      for (let i = 0; i < slot.puffCount; i++) this.gather(slot.puffs[i], age);
    }
  }

  private gatherBlasts(time: number): void {
    for (const slot of this.timeline.impacts) {
      if (!slot.active) continue;
      const age = time - slot.at;
      if (age >= CANNON_BLAST.life) {
        slot.active = false;
        continue;
      }
      for (let i = 0; i < slot.puffCount; i++) this.gather(slot.puffs[i], age);
    }
  }

  /** Back to front by pass: the dust behind, then smoke, fireball and dirt, then the light. */
  private drawPuffs(parts: Parts): void {
    const mesh = parts.puffs;
    this.byKind.fill(0);
    mesh.begin();
    for (let layer = 0; layer < CANNON_PUFF_LAYERS; layer++) {
      for (let i = 0; i < this.frameCount; i++) {
        const frame = this.frames[i];
        if (frame.layer !== layer) continue;
        const before = mesh.drawn;
        mesh.push(frame);
        if (mesh.drawn > before) this.byKind[frame.kind]++;
      }
    }
    mesh.end();
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
    const scorches = this.timeline.scorches;
    for (let i = 0; i < scorches.length; i++) {
      if (!this.liveScorches[i]) continue;
      const s = scorches[i];
      const age = time - s.at;
      if (!s.active || age >= CANNON_BLAST.scorchLife) {
        this.retireScorch(parts, i);
        continue;
      }
      any = true;
      const fade = cannonScorchFade(age);
      // A held scorch keeps its colours: only a fade that moved is uploaded.
      if (Math.abs(fade - this.scorchFades[i]) > 1 / 512) this.setScorchFade(parts, i, fade);
    }
    parts.scorch.visible = any;
  }
}
