// Ghost-crew effects ride BastionFx's preparation gate. Authoritative object
// footprints stay visible on every tier; only the idle soul ribbons shed.
import * as THREE from 'three';
import type { IWorld } from '../../world_api';
import {
  TELEGRAPH_THREAT_COLORS,
  TelegraphKit,
  type TelegraphLane,
  type TelegraphPaint,
} from '../floor_telegraph';
import { GFX, gfxTierAtLeast, sharedUniforms } from '../gfx';
import { BastionGhostDischarge } from './bastion_ghost_discharge';
import {
  GHOST_FX_SLOTS,
  ghostCrewBody,
  ghostCueProgress,
  ghostLaneLook,
  ghostSoulPoseInto,
  ghostStrikeDistance,
} from './bastion_ghost_fx_core';
import { inBastionClaim } from './bastion_trash_fx_core';

interface LaneSlot {
  id: number;
  tell: TelegraphLane;
  strike: THREE.Group;
  anchor: THREE.Group;
  ball: THREE.Mesh;
  blade: THREE.Mesh;
  wake: THREE.Mesh;
  chain: THREE.InstancedMesh;
}
interface SoulSlot {
  id: number;
  death: number;
  x: number;
  z: number;
}
const SEA = 0x73ffe0;
const LANE_STYLE = { color: TELEGRAPH_THREAT_COLORS.danger, accent: SEA } as const;
const SCAN_SECONDS = 0.1;
// Match the authored crew Death: recoil first, then the 1.1..2.8s unravel.
const DEATH_SECONDS = 2.8;
const DEATH_UNRAVEL_START = 1.1;
const SOUL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const SOUL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uMotion;
varying vec2 vUv;
void main() {
  float t = uTime * uMotion;
  float bend = sin(vUv.y * 10.0 - t * 2.0) * 0.10 * vUv.y;
  float edge = abs(vUv.x - 0.5 + bend) * 2.0;
  float core = pow(max(0.0, 1.0 - edge), 3.0);
  float ends = sin(vUv.y * 3.14159265);
  float threads = 0.7 + 0.3 * sin(vUv.y * 24.0 - t * 3.0);
  gl_FragColor = vec4(vec3(0.25, 1.0, 0.78) * (0.8 + core), core * ends * threads * 0.26);
  #include <colorspace_fragment>
}
`;

export class BastionGhostFx {
  private readonly root = new THREE.Group();
  private readonly kit: TelegraphKit;
  private readonly lanes: LaneSlot[] = [];
  private readonly souls: SoulSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly ribbons: THREE.InstancedMesh | null;
  private readonly ribbonMat: THREE.ShaderMaterial | null;
  private readonly discharge: BastionGhostDischarge | null;
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly linkRoll = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 2,
  );
  private readonly direction = new THREE.Vector3();
  private readonly soulPose = { x: 0, y: 0, z: 0, height: 0, width: 0 };
  private readonly lanePaint: TelegraphPaint = { fill: 0, clock: 0, range: 0, fade: 1 };
  private clock = 0;
  private scan = 0;
  private disposed = false;

  constructor(
    parent: THREE.Group,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    cosmetic = true,
    private readonly reducedMotion: () => boolean = () => false,
  ) {
    this.root.name = 'bastion-ghost-crew-fx';
    parent.add(this.root);
    this.discharge =
      cosmetic && gfxTierAtLeast(GFX.effectsTier, 'high')
        ? new BastionGhostDischarge(this.root)
        : null;
    this.kit = new TelegraphKit(this.root, cosmetic);
    const iron = new THREE.MeshBasicMaterial({ color: 0x315c57, toneMapped: false });
    const light = new THREE.MeshBasicMaterial({ color: SEA, toneMapped: false });
    const veil = new THREE.MeshBasicMaterial({
      color: SEA,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.materials.push(iron, light, veil);
    const shank = new THREE.CylinderGeometry(0.12, 0.16, 2, 8);
    const crown = new THREE.TorusGeometry(0.78, 0.14, 6, 16, Math.PI);
    crown.rotateZ(Math.PI);
    crown.translate(0, -0.4, 0);
    const eye = new THREE.TorusGeometry(0.25, 0.09, 6, 12);
    eye.translate(0, 1.2, 0);
    const stock = new THREE.BoxGeometry(1.5, 0.2, 0.22);
    stock.translate(0, 0.6, 0);
    const link = new THREE.TorusGeometry(0.12, 0.042, 5, 8);
    link.scale(1, 1.6, 1);
    const ball = new THREE.SphereGeometry(0.52, 12, 8);
    const blade = new THREE.TorusGeometry(1.2, 0.14, 5, 20, Math.PI * 1.3);
    blade.rotateY(Math.PI / 2);
    const wake = new THREE.CylinderGeometry(0.16, 0.16, 1, 8);
    wake.rotateX(Math.PI / 2);
    this.geometries.push(shank, crown, eye, stock, link, ball, blade, wake);
    for (let i = 0; i < GHOST_FX_SLOTS.lanes; i++) {
      const strike = new THREE.Group();
      strike.name = 'ghost-strike';
      strike.visible = false;
      const anchor = new THREE.Group();
      anchor.name = 'cursed-anchor';
      for (const g of [shank, crown, eye, stock]) anchor.add(new THREE.Mesh(g, iron));
      const core = new THREE.Mesh(eye, light);
      anchor.add(core);
      const cannonball = new THREE.Mesh(ball, light);
      cannonball.name = 'spectral-cannonball';
      const halo = new THREE.Mesh(ball, veil);
      halo.scale.setScalar(1.7);
      cannonball.add(halo);
      const sabre = new THREE.Mesh(blade, light);
      sabre.name = 'boarding-sabre';
      const blast = new THREE.Mesh(wake, light);
      blast.name = 'spectral-lane-impact';
      strike.add(anchor, cannonball, sabre, blast);
      const chain = new THREE.InstancedMesh(link, iron, GHOST_FX_SLOTS.chainLinks);
      chain.name = 'cursed-anchor-chain';
      chain.count = 0;
      chain.frustumCulled = false;
      chain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(strike, chain);
      this.lanes.push({
        id: -1,
        tell: this.kit.lane(18),
        strike,
        anchor,
        ball: cannonball,
        blade: sabre,
        wake: blast,
        chain,
      });
    }
    this.ribbonMat = cosmetic
      ? new THREE.ShaderMaterial({
          name: 'bastionSoulRibbons',
          vertexShader: SOUL_VERT,
          fragmentShader: SOUL_FRAG,
          uniforms: { uTime: sharedUniforms.uTime, uMotion: { value: 1 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        })
      : null;
    if (this.ribbonMat) {
      const geo = new THREE.PlaneGeometry(1, 1);
      this.geometries.push(geo);
      this.materials.push(this.ribbonMat);
      this.ribbons = new THREE.InstancedMesh(
        geo,
        this.ribbonMat,
        GHOST_FX_SLOTS.bodies * GHOST_FX_SLOTS.soulsPerBody,
      );
      this.ribbons.name = 'ghost-soul-trails';
      this.ribbons.count = 0;
      this.ribbons.frustumCulled = false;
      this.ribbons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(this.ribbons);
      for (let i = 0; i < GHOST_FX_SLOTS.bodies; i++)
        this.souls.push({ id: -1, death: -1, x: 0, z: 0 });
    } else this.ribbons = null;
  }

  update(dt: number): void {
    const world = this.world;
    if (this.disposed || !world) return;
    this.clock += Math.max(0, dt);
    this.root.visible = inBastionClaim(world.player.pos.x);
    if (!this.root.visible) {
      for (const s of this.lanes) {
        s.id = -1;
        s.tell.group.visible = false;
        s.strike.visible = false;
        s.chain.count = 0;
      }
      for (const s of this.souls) {
        s.id = -1;
        s.death = -1;
      }
      if (this.ribbons) this.ribbons.count = 0;
      this.discharge?.clear();
      this.scan = 0;
      return;
    }
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SECONDS;
      this.scanWorld(world);
    }
    for (const slot of this.lanes) this.paintLane(slot, world);
    this.paintSouls(world, dt);
    this.discharge?.update(dt, world.player.pos, this.reducedMotion());
  }

  private scanWorld(world: IWorld): void {
    // One local claim only; remote dungeon entities cannot occupy the pool.
    for (const e of world.entities.values()) {
      if (
        e.dead ||
        Math.abs(e.pos.x - world.player.pos.x) > 180 ||
        Math.abs(e.pos.z - world.player.pos.z) > 240
      )
        continue;
      const template = e.templateId ?? '';
      if (ghostLaneLook(template)) {
        if (this.lanes.some((s) => s.id === e.id)) continue;
        const slot = this.lanes.find((s) => s.id < 0);
        if (slot) slot.id = e.id;
      } else if (this.ribbons && ghostCrewBody(template)) {
        if (this.souls.some((s) => s.id === e.id)) continue;
        const slot = this.souls.find((s) => s.id < 0);
        if (slot) {
          slot.id = e.id;
          slot.death = -1;
          slot.x = e.pos.x;
          slot.z = e.pos.z;
        }
      }
    }
  }

  private paintLane(slot: LaneSlot, world: IWorld): void {
    const e = slot.id >= 0 ? world.entities.get(slot.id) : undefined;
    const look = e ? ghostLaneLook(e.templateId ?? '') : undefined;
    if (!e || e.dead || !look) {
      slot.id = -1;
      slot.tell.group.visible = false;
      slot.strike.visible = false;
      slot.chain.count = 0;
      return;
    }
    const progress = ghostCueProgress(e.castRemaining, e.castTotal);
    const length = e.scale;
    const floor = this.groundY(e.pos.x, e.pos.z);
    slot.tell.group.visible = true;
    this.kit.drapeLane(
      slot.tell,
      this.groundY,
      e.pos.x,
      floor,
      e.pos.z,
      e.facing,
      length,
      look.width / 2,
      LANE_STYLE,
    );
    this.lanePaint.fill = look.warning ? progress : 1;
    this.lanePaint.clock = this.reducedMotion() ? 0 : this.clock;
    this.lanePaint.range = length;
    this.lanePaint.fade = look.warning ? 1 : 0.6;
    this.kit.paintLane(slot.tell, this.lanePaint);
    slot.strike.visible = !look.warning;
    slot.anchor.visible = look.kind === 'anchor';
    slot.ball.visible = look.kind === 'broadside';
    slot.blade.visible = look.kind === 'boarding';
    slot.wake.visible = look.kind !== 'anchor';
    slot.chain.count = 0;
    if (look.warning) return;
    this.discharge?.observe(
      e.id,
      look.kind,
      e.pos.x,
      floor + (look.kind === 'broadside' ? 2.1 : 1.1),
      e.pos.z,
      e.facing,
      length,
      Math.max(0, e.castTotal - e.castRemaining),
    );
    // Broadside and boarding hit the WHOLE lane when the warning ends.
    // Their bright stroke is simultaneous, never a delayed travelling bolt.
    const distance = look.kind === 'anchor' ? ghostStrikeDistance(look.kind, progress, length) : 0;
    const ax = Math.sin(e.facing);
    const az = Math.cos(e.facing);
    const x = e.pos.x + ax * distance;
    const z = e.pos.z + az * distance;
    slot.strike.position.set(x, this.groundY(x, z) + (look.kind === 'broadside' ? 2.1 : 1.1), z);
    slot.strike.rotation.set(0, e.facing, 0);
    slot.wake.position.z = length / 2;
    slot.wake.scale.set(1 - progress * 0.8, 1 - progress * 0.8, length);
    slot.ball.scale.setScalar(1.6 * (1 - progress) + 0.1);
    slot.blade.position.z = length / 2;
    slot.blade.scale.set(1 - progress * 0.8, 1 - progress * 0.8, length / 2.4);
    if (look.kind === 'anchor') {
      // Instance positions remain near zero, relative to the locked start.
      slot.chain.position.set(e.pos.x, floor + 0.8, e.pos.z);
      const count = Math.min(GHOST_FX_SLOTS.chainLinks, Math.ceil(distance / 0.36));
      for (let i = 0; i < count; i++) {
        const along = (distance * (i + 0.5)) / count;
        const wx = e.pos.x + ax * along;
        const wz = e.pos.z + az * along;
        this.position.set(
          ax * along,
          this.groundY(wx, wz) - floor + (0.3 * along) / Math.max(1, distance),
          az * along,
        );
        this.direction.set(ax, 0, az);
        this.rotation.setFromUnitVectors(this.up, this.direction);
        if (i % 2) this.rotation.multiply(this.linkRoll);
        this.scale.set(1, 1, 1);
        this.matrix.compose(this.position, this.rotation, this.scale);
        slot.chain.setMatrixAt(i, this.matrix);
      }
      slot.chain.count = count;
      slot.chain.instanceMatrix.needsUpdate = true;
    }
  }

  private paintSouls(world: IWorld, dt: number): void {
    if (!this.ribbons || !this.ribbonMat) return;
    const calm = this.reducedMotion();
    this.ribbonMat.uniforms.uMotion.value = calm ? 0 : 1;
    const origin = world.player.pos;
    this.ribbons.position.set(origin.x, origin.y, origin.z);
    let count = 0;
    for (const slot of this.souls) {
      if (slot.id < 0) continue;
      const e = world.entities.get(slot.id);
      if (!e) {
        slot.id = -1;
        continue;
      }
      if (e.dead && slot.death < 0) slot.death = 0;
      if (!e.dead) slot.death = -1;
      if (slot.death >= 0) slot.death += dt;
      if (slot.death >= DEATH_SECONDS) {
        slot.id = -1;
        continue;
      }
      const death = Math.max(
        0,
        (slot.death - DEATH_UNRAVEL_START) / (DEATH_SECONDS - DEATH_UNRAVEL_START),
      );
      const follow = calm ? 1 : 1 - Math.exp(-Math.max(0, dt) * 5);
      slot.x += (e.pos.x - slot.x) * follow;
      slot.z += (e.pos.z - slot.z) * follow;
      const tailX = Math.max(-2, Math.min(2, slot.x - e.pos.x));
      const tailZ = Math.max(-2, Math.min(2, slot.z - e.pos.z));
      for (let i = 0; i < GHOST_FX_SLOTS.soulsPerBody; i++) {
        const p = ghostSoulPoseInto(this.soulPose, this.clock + e.id * 0.37, i, death, calm);
        this.position.set(
          e.pos.x - origin.x + p.x + (tailX * (i + 1)) / 3,
          e.pos.y - origin.y + p.y,
          e.pos.z - origin.z + p.z + (tailZ * (i + 1)) / 3,
        );
        this.scale.set(p.width, p.height, 1);
        this.rotation.setFromAxisAngle(this.up, (i * Math.PI) / 3 + (calm ? 0 : this.clock * 0.2));
        this.matrix.compose(this.position, this.rotation, this.scale);
        this.ribbons.setMatrixAt(count++, this.matrix);
      }
    }
    this.ribbons.count = count;
    this.ribbons.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.kit.dispose();
    this.discharge?.dispose();
    this.ribbons?.dispose();
    for (const s of this.lanes) s.chain.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
