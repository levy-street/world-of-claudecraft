// The Smith's four great blades of ice on the Frozen Lake (plan:
// quench_fight_fx_core.ts bladeLook; docs/design/raid/smith_heart.md section
// 7.3), hosted by ../rift_death_zone.ts. The fight owns the blades' bodies
// (the claim's blade objects: the kit draws no sunk blade of its own), so this
// draws all four whatever the fight is doing, read from IWorld (each blade
// object's state, place and facing, the guardian's awakening bar, the echoes
// held at the blades):
//  - sunk: the Quench kit's Kit_SunkBlade point first in the lake, as the
//    vein always showed it;
//  - waking (the guardian's 4 s bar): trembling, light running up its
//    fuller, then wrenched up out of the ice, the ice bursting upward round
//    it, its point shown, standing upright;
//  - floating: upright a breath over the ice, bobbing, a blue light in it, its
//    broad face turned the way the guardian's attacks would echo (the blade
//    turns with the guardian) and a chevron of its light on the ice before it;
//    blazing while an echo is held at it;
//  - flying (heroic's crossing): leaning into its flight, a wake of frost and
//    shards behind it;
//  - left behind in the lake where it was sunk: a ring of broken ice.
// The blades are what the echoes come from: their place, light and facing
// draw on EVERY tier; the shards, mist and glints thin on the low tier.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the root before its gated attach (the kit's piece, which may land
// later, draws with the kit's shared slot materials linked by its program
// warmers, and swaps in through one compile-gated staging group); no light;
// fixed pools; no per-frame allocation.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  bladeStateOf,
  echoOf,
  QUENCH_CASTS,
  QUENCH_GUARDIAN,
  type QuenchBladeState,
} from '../../sim/encounters/smith_heart/quench_ids';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import {
  ensureHeartKit,
  heartKitLoaded,
  heartKitMeshes,
  heartKitProgramWarmers,
  heartKitSlotMaterial,
  SMITH_HEART_QUENCH_KIT_URL as QUENCH_KIT,
} from '../smith_heart/heart_kit';
import { heartVeinGlowMaterial } from '../smith_heart/heart_room_kit';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  BLADE_FLOAT_LIFT,
  BLADE_HOMES,
  BLADE_TIP,
  type BladeLook,
  bladeLook,
  QUENCH_FIGHT_COLORS as C,
  fightHash,
  quenchClaimOrigin,
} from './quench_fight_fx_core';

const SCAN_SEC = 0.1;
/** The kit piece leans this far toward its +x (quench_pieces.py BLADE_LEAN). */
const KIT_LEAN = 0.17;

const _look: BladeLook = { lift: 0, upright: 0, light: 0, shake: 0 };
const _e = new THREE.Euler();

/** The chevron of a blade's light on the ice before it. */
const CHEVRON_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const CHEVRON_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  // Two chevrons pointing +v, flowing forward.
  float d = 1.0;
  for (int i = 0; i < 2; i++) {
    float off = fract(uTime * 0.6 + float(i) * 0.5) * 0.6 - 0.3;
    float y = p.y - off;
    float c = abs(y + abs(p.x) * 0.9);
    d = min(d, c);
  }
  float line = 1.0 - smoothstep(0.02, 0.06, d);
  float mask = (1.0 - smoothstep(0.32, 0.5, abs(p.x))) * (1.0 - smoothstep(0.3, 0.5, abs(p.y)));
  gl_FragColor = vec4(uColor * (1.0 + line), line * mask * uAlpha);
  #include <colorspace_fragment>
}
`;
/** The ring of broken ice a blade leaves in the lake once torn out. */
const SOCKET_VERT = CHEVRON_VERT;
const SOCKET_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uDark;
uniform vec3 uLight;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  if (r > 1.0) discard;
  // A dark heave of broken plates, radial cracks of light, open water deep in.
  float cell = floor(a * 3.2 + 3.2) + floor(r * 4.0) * 13.0;
  float plate = h(vec2(cell, 3.1));
  float crack = 1.0 - smoothstep(0.0, 0.05, abs(fract(a * 1.9 + plate * 0.3) - 0.5) - 0.44);
  float water = 1.0 - smoothstep(0.18, 0.34, r);
  vec3 col = mix(uDark, uLight, crack * (1.0 - r) + plate * 0.25);
  col = mix(col, uDark * 0.4, water);
  float alpha = (1.0 - smoothstep(0.82, 1.0, r)) * uAlpha * (0.55 + 0.35 * plate + 0.3 * water);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

interface BladeView {
  /** The blade's home (QUENCH_BLADE_SPOTS index) when it is drawn at home. */
  home: number;
  entityId: number;
  holder: THREE.Group;
  /** The upright frame (lean and lift), under the holder's yaw. */
  frame: THREE.Group;
  /** The plain stand-in until the kit lands. */
  standIn: THREE.Mesh | null;
  tip: THREE.Mesh;
  core: THREE.Sprite;
  halo: THREE.Sprite;
  chevron: THREE.Mesh;
  chevronMat: THREE.ShaderMaterial;
  socket: THREE.Mesh;
  socketMat: THREE.ShaderMaterial;
  state: QuenchBladeState;
  since: number;
  yaw: number;
  lastX: number;
  lastZ: number;
  burstDone: boolean;
}

export class QuenchBladesFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly blades: BladeView[] = [];
  /** One fuller glow per blade (one program: the same shader), so a blade
   *  holding an echo blazes on its own. */
  private readonly glowMats: THREE.ShaderMaterial[];
  private readonly coreMat: THREE.SpriteMaterial;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>;
  private readonly glowTex: THREE.Texture | null;
  private readonly bladeIds: number[] = [];
  private readonly heldIds = new Set<number>();
  private rosterSeen = Number.NaN;
  private guardianId = -1;
  private wakeFill = 0;
  /** The claim's origin (world), while the player is in one. */
  private readonly origin = { x: 0, z: 0 };
  private kitBuilt = false;
  private near = false;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x6b2d;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
  ) {
    this.compileGate = compileGate;
    this.root.name = 'smith-heart-quench-blades';
    setRenderCategory(this.root, 'ui3d');
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = detail ? 1 : 0.4;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
    );
    this.glowTex = hasDom ? radialGlowTexture() : null;
    this.glowMats = BLADE_HOMES.map((_, i) =>
      heartVeinGlowMaterial(C.bladeLight, `smithHeartQuenchBladeGlow:${i}`),
    );
    const sprite = (color: number, opacity: number, name: string) =>
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        name,
      });
    this.coreMat = sprite(C.bladeCore, 0.9, 'smithHeartQuenchBladeCore');
    this.haloMat = sprite(C.bladeLight, 0.5, 'smithHeartQuenchBladeHalo');
    this.materials.push(...this.glowMats, this.coreMat, this.haloMat);
    // The glow's carrier: linked by the gate before any kit piece lands.
    const carrierGeo = new THREE.BufferGeometry();
    carrierGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    carrierGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
    this.geometries.push(carrierGeo);
    const carrier = new THREE.Mesh(carrierGeo, this.glowMats[0]);
    carrier.visible = false;
    carrier.frustumCulled = false;
    this.root.add(carrier);
    // The point the sunk piece hides in the ice: a keen diamond of ice.
    const tipGeo = new THREE.ConeGeometry(1, BLADE_TIP, 4, 3).rotateX(Math.PI);
    tipGeo.rotateY(Math.PI / 4);
    tipGeo.translate(0, -BLADE_TIP / 2, 0);
    {
      const pos = tipGeo.getAttribute('position') as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, pos.getX(i) * 1.1, pos.getY(i), pos.getZ(i) * 0.46);
        const k = Math.min(1, -pos.getY(i) / BLADE_TIP);
        col.set([0.3 + 0.5 * k, 0.52 + 0.38 * k, 0.7 + 0.28 * k], i * 3);
      }
      tipGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      tipGeo.computeVertexNormals();
    }
    this.geometries.push(tipGeo);
    const standInGeo = new THREE.BoxGeometry(2.2, 11, 0.9).translate(0, 5.5, 0);
    {
      const pos = standInGeo.getAttribute('position') as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3).fill(0.75);
      standInGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    this.geometries.push(standInGeo);
    const chevronGeo = new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2);
    const socketGeo = new THREE.PlaneGeometry(5.6, 5.6).rotateX(-Math.PI / 2);
    this.geometries.push(chevronGeo, socketGeo);
    const iceMat = heartKitSlotMaterial('ice');
    const kitsIn = heartKitLoaded(QUENCH_KIT);
    BLADE_HOMES.forEach((home, i) => {
      const holder = new THREE.Group();
      holder.name = `quenchBlade:${i}`;
      const frame = new THREE.Group();
      holder.add(frame);
      const kit = kitsIn ? this.fitKit(i) : null;
      let standIn: THREE.Mesh | null = null;
      if (kit) frame.add(kit);
      else {
        standIn = new THREE.Mesh(standInGeo, iceMat);
        standIn.name = 'smithHeartQuenchBladeStandIn';
        frame.add(standIn);
      }
      const tip = new THREE.Mesh(tipGeo, iceMat);
      tip.name = 'smithHeartQuenchBladeTip';
      tip.visible = false;
      frame.add(tip);
      const core = new THREE.Sprite(this.coreMat);
      core.position.set(0, 4.2, 0);
      core.scale.set(1.6, 4.2, 1);
      const halo = new THREE.Sprite(this.haloMat);
      halo.position.set(0, 5, 0);
      halo.scale.set(5, 9, 1);
      frame.add(core, halo);
      const chevronMat = new THREE.ShaderMaterial({
        name: 'smithHeartQuenchBladeChevron',
        uniforms: {
          uAlpha: { value: 0 },
          uTime: this.uTime,
          uColor: { value: new THREE.Color(C.bladeLight) },
        },
        vertexShader: CHEVRON_VERT,
        fragmentShader: CHEVRON_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const socketMat = new THREE.ShaderMaterial({
        name: 'smithHeartQuenchBladeSocket',
        uniforms: {
          uAlpha: { value: 0 },
          uDark: { value: new THREE.Color(...C.water) },
          uLight: { value: new THREE.Color(...C.crackLight) },
        },
        vertexShader: SOCKET_VERT,
        fragmentShader: SOCKET_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.materials.push(chevronMat, socketMat);
      const chevron = new THREE.Mesh(chevronGeo, chevronMat);
      chevron.name = 'smithHeartQuenchBladeChevron';
      chevron.renderOrder = floorVfxRenderOrder('encounter', 15);
      chevron.visible = false;
      chevron.frustumCulled = false;
      const socket = new THREE.Mesh(socketGeo, socketMat);
      socket.name = 'smithHeartQuenchBladeSocket';
      socket.renderOrder = floorVfxRenderOrder('encounter', 1);
      socket.visible = false;
      socket.frustumCulled = false;
      this.root.add(holder, chevron, socket);
      holder.visible = false;
      this.blades.push({
        home: i,
        entityId: -1,
        holder,
        frame,
        standIn,
        tip,
        core,
        halo,
        chevron,
        chevronMat,
        socket,
        socketMat,
        state: 'sunk',
        since: 0,
        yaw: home.rot,
        lastX: home.x,
        lastZ: home.z,
        burstDone: false,
      });
    });
    this.root.add(heartKitProgramWarmers());
    this.kitBuilt = kitsIn;
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
    if (!kitsIn && hasDom)
      void ensureHeartKit(QUENCH_KIT)
        .then(() => {
          if (!this.disposed && heartKitLoaded(QUENCH_KIT)) this.upgradeKit();
        })
        .catch(() => {});
  }

  /** The kit's sunk blade at its own size (origin at its foot on the ice),
   *  its fuller's light on the blades' own glow. */
  private fitKit(i: number): THREE.Group | null {
    const kit = heartKitMeshes(QUENCH_KIT, 'Kit_SunkBlade');
    if (!kit) return null;
    for (const m of kit.children)
      if (m instanceof THREE.Mesh && m.name.endsWith(':glow')) m.material = this.glowMats[i];
    return kit;
  }

  private upgradeKit(): void {
    if (this.kitBuilt || this.disposed) return;
    this.kitBuilt = true;
    const staging = new THREE.Group();
    staging.name = 'smithHeartQuenchBladeStaging';
    staging.visible = false;
    const fitted: (THREE.Group | null)[] = [];
    for (let i = 0; i < this.blades.length; i++) {
      const kit = this.fitKit(i);
      fitted.push(kit);
      if (kit) staging.add(kit);
    }
    this.root.add(staging);
    const linked = this.compileGate ? this.compileGate(staging).catch(() => {}) : Promise.resolve();
    void linked.then(() => {
      staging.removeFromParent();
      if (this.disposed) return;
      this.blades.forEach((b, i) => {
        const kit = fitted[i];
        if (!kit) return;
        if (b.standIn) {
          b.frame.remove(b.standIn);
          b.standIn = null;
        }
        b.frame.add(kit);
      });
    });
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      this.scan(world);
    }
    if (this.near) for (const b of this.blades) this.pose(world, b, dt);
    this.particles.update(this.clock);
  }

  // ---- the scan ----------------------------------------------------------------------------

  private scan(world: IWorld): void {
    const me = world.entities.get(world.playerId);
    const o = me ? quenchClaimOrigin(me.pos.x, me.pos.z) : null;
    const near = !!me && !!o;
    if (o) {
      this.origin.x = o.x;
      this.origin.z = o.z;
    }
    if (!near) {
      if (this.near) for (const b of this.blades) this.hide(b);
      this.near = false;
      this.rosterSeen = Number.NaN;
      return;
    }
    this.near = true;
    if (world.entityRosterVersion !== this.rosterSeen) {
      this.rosterSeen = world.entityRosterVersion;
      this.bladeIds.length = 0;
      this.guardianId = -1;
      this.heldIds.clear();
      for (const e of world.entities.values()) {
        if (e.kind === 'mob' && e.templateId === QUENCH_GUARDIAN) this.guardianId = e.id;
        else if (e.kind === 'object' && bladeStateOf(e.templateId) !== null)
          this.bladeIds.push(e.id);
        else if (e.kind === 'object' && echoOf(e.templateId)) this.heldIds.add(e.id);
      }
      this.bladeIds.sort((a, b) => a - b);
      // Each blade object to its view, by id (stable through a crossing).
      this.blades.forEach((b, i) => {
        b.entityId = this.bladeIds[i] ?? -1;
      });
    }
    const g = this.guardianId >= 0 ? world.entities.get(this.guardianId) : undefined;
    this.wakeFill =
      g && g.castingAbility === QUENCH_CASTS.wake && g.castTotal > 0
        ? 1 - g.castRemaining / g.castTotal
        : 0;
  }

  private hide(b: BladeView): void {
    b.holder.visible = false;
    b.chevron.visible = false;
    b.socket.visible = false;
  }

  /** Is an echo held at (x, z) now (a blade about to echo)? */
  private echoHeldAt(world: IWorld, x: number, z: number): boolean {
    for (const id of this.heldIds) {
      const e = world.entities.get(id);
      if (!e) continue;
      const of = echoOf(e.templateId);
      if (!of || of.hit) continue;
      if (Math.hypot(e.pos.x - x, e.pos.z - z) < 1.5) return true;
    }
    return false;
  }

  // ---- the pose ----------------------------------------------------------------------------

  private pose(world: IWorld, b: BladeView, dt: number): void {
    const e = b.entityId >= 0 ? world.entities.get(b.entityId) : undefined;
    if (!e) {
      this.hide(b);
      return;
    }
    const state = bladeStateOf(e.templateId) ?? 'sunk';
    if (state !== b.state) {
      if (state === 'wake') b.burstDone = false;
      if (state === 'float' && b.state === 'wake') this.risenBurst(e);
      b.state = state;
      b.since = 0;
    } else b.since += dt;
    const look = bladeLook(state, b.since, this.wakeFill, this.clock, b.home, _look);
    const floor = this.groundY(e.pos.x, e.pos.z);
    b.holder.visible = true;
    b.holder.position.set(e.pos.x, floor, e.pos.z);
    // The yaw: its sunk yaw while sunk, else its face to the echo's way.
    const home = BLADE_HOMES[b.home];
    const flying = state === 'fly';
    let want = state === 'sunk' ? home.rot : e.facing;
    if (flying) {
      const vx = e.pos.x - b.lastX;
      const vz = e.pos.z - b.lastZ;
      if (vx * vx + vz * vz > 1e-4) want = Math.atan2(vx, vz);
    }
    let d = want - b.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    b.yaw += d * Math.min(1, dt * (state === 'sunk' ? 30 : flying ? 8 : 3));
    b.holder.rotation.y = b.yaw;
    // The frame: the kit's sunk lean undone as it stands, its foot lifted.
    const shake = look.shake * 0.08;
    const jx = shake > 0 ? (fightHash(b.home, Math.floor(this.clock * 40)) - 0.5) * shake : 0;
    const jz = shake > 0 ? (fightHash(b.home + 9, Math.floor(this.clock * 40)) - 0.5) * shake : 0;
    b.frame.position.set(jx, look.lift, jz);
    _e.set(flying ? 0.5 : 0, 0, KIT_LEAN * look.upright, 'YXZ');
    b.frame.rotation.copy(_e);
    b.tip.visible = look.lift > 0.4;
    // Its light: dim sunk, blazing while it holds an echo.
    const held = state !== 'sunk' && this.echoHeldAt(world, e.pos.x, e.pos.z);
    const light = Math.min(1.6, look.light + (held ? 0.6 + 0.3 * Math.sin(this.clock * 14) : 0));
    b.core.visible = light > 0.2;
    b.halo.visible = light > 0.2;
    b.core.scale.set(1.2 + 0.6 * light, 3.6 + 1.6 * light, 1);
    b.halo.scale.set(3.5 + 2.5 * light, 7 + 3 * light, 1);
    (this.glowMats[b.home].uniforms.uColor.value as THREE.Color)
      .setHex(C.bladeLight)
      .multiplyScalar(0.8 + 1.4 * Math.max(look.light, held ? 1.2 : 0));
    // Its chevron before it on the ice (the way its echoes run).
    const awake = state === 'float';
    b.chevron.visible = awake;
    if (awake) {
      const ax = Math.sin(b.yaw);
      const az = Math.cos(b.yaw);
      const cx = e.pos.x + ax * 3.4;
      const cz = e.pos.z + az * 3.4;
      b.chevron.position.set(cx, this.groundY(cx, cz) + 0.09, cz);
      b.chevron.rotation.y = b.yaw;
      b.chevronMat.uniforms.uAlpha.value = held ? 1 : 0.55;
    }
    // The torn socket at its home once it has risen out of the lake.
    const torn = state !== 'sunk' && look.lift > 0.5;
    b.socket.visible = torn;
    if (torn) {
      const hx = this.origin.x + home.x;
      const hz = this.origin.z + home.z;
      b.socket.position.set(hx, this.groundY(hx, hz) + 0.05, hz);
      b.socketMat.uniforms.uAlpha.value = 1;
    }
    this.cosmetics(e, b, look, state, floor, dt);
    b.lastX = e.pos.x;
    b.lastZ = e.pos.z;
  }

  private cosmetics(
    e: Entity,
    b: BladeView,
    look: BladeLook,
    state: QuenchBladeState,
    floor: number,
    dt: number,
  ): void {
    if (state === 'wake') {
      // Ice dust and splinters off its foot as it tears free.
      if (this.rand() < dt * 30 * this.density * (0.3 + look.shake)) {
        this.particles.puff(e.pos.x, floor + 0.3, e.pos.z, 2, {
          speed: 3,
          up: 3 + 4 * look.upright,
          life: 0.9,
          size: [0.3, 0.1],
          color: C.shard,
          alpha: 1,
          pool: 'glow',
          gravity: 9,
          radius: 1.6,
        });
      }
      if (!b.burstDone && look.upright > 0.05) {
        // The lake bursts upward round it as it is wrenched out.
        b.burstDone = true;
        this.particles.puff(e.pos.x, floor + 0.4, e.pos.z, 26, {
          speed: 7,
          up: 9,
          life: 1.2,
          size: [0.45, 0.14],
          color: C.shard,
          alpha: 1,
          pool: 'glow',
          gravity: 14,
          radius: 2,
        });
        this.particles.puff(e.pos.x, floor + 0.6, e.pos.z, 10, {
          speed: 3,
          up: 2,
          life: 1.8,
          size: [1.6, 4.2],
          color: C.mist,
          alpha: 0.42,
          radius: 2,
        });
        this.particles.shockRing(e.pos.x, e.pos.z, 0xe0f4ff, 6, 0.6);
      }
    } else if (state === 'float') {
      // Rime drifting off it, the cold falling from its point.
      if (this.rand() < dt * 2.5 * this.density) {
        this.particles.puff(e.pos.x, floor + BLADE_FLOAT_LIFT - 0.6, e.pos.z, 1, {
          speed: 0.4,
          life: 1.8,
          size: [0.6, 1.8],
          color: C.mist,
          alpha: 0.24,
          gravity: 0.6,
        });
      }
    } else if (state === 'fly') {
      if (this.rand() < dt * 45 * this.density) {
        this.particles.puff(e.pos.x, floor + 2 + this.rand() * 6, e.pos.z, 2, {
          speed: 1.5,
          life: 0.8,
          size: [0.8, 2.4],
          color: C.mist,
          alpha: 0.4,
        });
        this.particles.puff(e.pos.x, floor + 1, e.pos.z, 1, {
          speed: 4,
          up: 2,
          life: 0.6,
          size: [0.25, 0.08],
          color: C.shard,
          alpha: 1,
          pool: 'glow',
          gravity: 8,
        });
      }
    }
  }

  /** Awake: the light flares out of it, a ring on the ice. */
  private risenBurst(e: Entity): void {
    const y = this.groundY(e.pos.x, e.pos.z) + 5;
    this.particles.puff(e.pos.x, y, e.pos.z, 14, {
      speed: 6,
      life: 0.8,
      size: [0.4, 0.1],
      color: C.shard,
      alpha: 1,
      pool: 'glow',
      radius: 1,
    });
    this.particles.shockRing(e.pos.x, e.pos.z, C.bladeLight, 9, 0.7);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.glowTex?.dispose();
  }
}
