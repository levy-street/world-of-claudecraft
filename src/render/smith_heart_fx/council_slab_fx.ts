// The Walking Slab's own look (mythic: the Slabwright's soul dragging its
// pillar; plan: council_fx_core.ts slabPull, SLAB_CLAWS; docs/design/raid/
// smith_heart.md 5.18), a part of CouncilPillarsFx. The Slabwright's soul
// pillar is no longer the same column sliding: the Heart kit's Walking Slab
// pieces dress it while the soul holds it:
//   - a collar of root rock heaped round its foot and five stone claws round
//     it (Kit_SlabClaw): the front pair reach out, slam down and bite, then
//     haul the stone forward while the rear three push;
//   - a face of cracks on its front (Kit_SlabFace), the jade burning in its
//     eyes and mouth, turned the way it drags;
//   - the column lurching and rocking forward on every pull, gouges raked into
//     the floor where the talons bite (fading), grinding dust.
// It stays a soul pillar first: the jade cracks, the sheath and the three jade
// pips are the pillar's own (council_pillars_fx.ts), drawn on every tier. The
// claws, the collar and the face draw on every tier too (they are which pillar
// it is); only the gouges and the dust thin. The kit's shared slot materials
// (warmed with the interior); the gouges one instanced draw. No light, fixed
// pools, no per-frame allocation.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  heartKitLoaded,
  heartKitMeshes,
  SMITH_HEART_HEART_KIT_URL,
} from '../smith_heart/heart_kit';
import {
  SLAB_BITE_PHASE,
  SLAB_CLAW_GRIP,
  SLAB_CLAWS,
  SLAB_GOUGE_SECONDS,
  SLAB_PULL_SECONDS,
  slabPull,
  slabTalon,
} from './council_fx_core';
import type { CouncilFxHost } from './council_pillars_fx';

/** The pillar slot groups a rig hangs on (council_pillars_fx.ts PillarSlot). */
export interface SlabHost {
  holder: THREE.Group;
  leanYaw: THREE.Group;
  lean: THREE.Group;
  bodyYaw: THREE.Group;
}

interface Rig {
  pillarId: number;
  /** On the holder, turned to the heading: the collar and the claws. */
  base: THREE.Group;
  claws: THREE.Group[];
  /** On the lean, so it rocks with the stone: the face. */
  face: THREE.Group | null;
  host: SlabHost | null;
  heading: number;
  phase: number;
  drag: number;
  bit: boolean;
  scale: number;
  x: number;
  z: number;
}

/** Gouges the talons rake (two a pull while it drags; seven seconds each). */
const GOUGES = 24;

const GOUGE_VERT = /* glsl */ `
attribute float aFade;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  vFade = aFade;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
/** A groove raked into the stone: a dark scored line with pale chipped lips,
 *  ragged at its ends, fading out. */
const GOUGE_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vFade;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float ends = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
  float groove = 1.0 - smoothstep(0.25, 0.5, x);
  float lip = smoothstep(0.45, 0.62, x) * (1.0 - smoothstep(0.72, 1.0, x));
  vec3 col = mix(vec3(0.78, 0.72, 0.62), vec3(0.08, 0.07, 0.07), groove);
  float a = vFade * ends * max(groove * 0.85, lip * 0.45);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

const _pull = { front: 0, rear: 0, rock: 0, lurch: 0 };
const _talon = { x: 0, z: 0 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

export class CouncilSlabRigs {
  private readonly rigs: Rig[] = [];
  private readonly gouges: THREE.InstancedMesh;
  private readonly fade: THREE.InstancedBufferAttribute;
  private readonly gougeAge = new Float32Array(GOUGES).fill(SLAB_GOUGE_SECONDS);
  private nextGouge = 0;
  private built = false;

  constructor(
    private readonly h: CouncilFxHost,
    slots: number,
  ) {
    for (let i = 0; i < slots; i++) {
      const base = new THREE.Group();
      base.name = 'smithHeartWalkingSlab';
      base.visible = false;
      this.rigs.push({
        pillarId: -1,
        base,
        claws: [],
        face: null,
        host: null,
        heading: 0,
        phase: 0,
        drag: 0,
        bit: false,
        scale: 1,
        x: 0,
        z: 0,
      });
    }
    const geo = new THREE.PlaneGeometry(0.5, 1.6).rotateX(-Math.PI / 2);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(GOUGES), 1);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', this.fade);
    const mat = new THREE.ShaderMaterial({
      name: 'smithHeartSlabGouge',
      vertexShader: GOUGE_VERT,
      fragmentShader: GOUGE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.gouges = new THREE.InstancedMesh(geo, mat, GOUGES);
    this.gouges.name = 'smithHeartSlabGouges';
    this.gouges.renderOrder = floorVfxRenderOrder('encounter', 19);
    this.gouges.frustumCulled = false;
    this.gouges.count = GOUGES;
    this.gouges.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < GOUGES; i++) this.gouges.setMatrixAt(i, _m);
    this.h.root.add(this.gouges);
    this.h.geometries.push(geo);
    this.h.materials.push(mat);
  }

  /** The kit's pieces, once it has landed (shared geometry and slot materials). */
  private build(): boolean {
    if (this.built) return true;
    if (!heartKitLoaded(SMITH_HEART_HEART_KIT_URL)) return false;
    for (const r of this.rigs) {
      const collar = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, 'Kit_SlabCollar');
      if (collar) r.base.add(collar);
      for (const c of SLAB_CLAWS) {
        const pivot = new THREE.Group();
        const a = (c.bear * Math.PI) / 180;
        pivot.position.set(Math.sin(a) * SLAB_CLAW_GRIP, 0, Math.cos(a) * SLAB_CLAW_GRIP);
        pivot.rotation.y = a;
        const claw = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, 'Kit_SlabClaw');
        if (claw) pivot.add(claw);
        r.base.add(pivot);
        r.claws.push(pivot);
      }
      r.face = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, 'Kit_SlabFace');
      if (r.face) {
        r.face.name = 'smithHeartWalkingSlabFace';
        r.face.visible = false;
      }
    }
    this.built = true;
    return true;
  }

  /** The Slabwright's soul holds this pillar: dress it (once the kit is in). */
  attach(pillarId: number, host: SlabHost, risen: boolean, x: number, z: number): void {
    if (!this.build()) return;
    let r = this.rigs.find((q) => q.pillarId === pillarId);
    if (r) return;
    r = this.rigs.find((q) => q.pillarId < 0);
    if (!r) return;
    r.pillarId = pillarId;
    r.host = host;
    r.phase = 0;
    r.drag = 0;
    r.bit = false;
    r.x = x;
    r.z = z;
    // The kit's pieces fit the carved column; a risen pillar's rock is a
    // little wider at its foot and its face.
    r.scale = risen ? 1.12 : 1;
    r.heading = host.bodyYaw.rotation.y + host.leanYaw.rotation.y;
    host.holder.add(r.base);
    r.base.scale.setScalar(r.scale);
    r.base.visible = true;
    if (r.face) {
      host.lean.add(r.face);
      r.face.scale.set(risen ? 1.4 : 1, risen ? 0.9 : 1, risen ? 1.4 : 1);
      r.face.visible = true;
    }
  }

  /** The soul has left it (or it is gone): undress. */
  detach(pillarId: number): void {
    const r = this.rigs.find((q) => q.pillarId === pillarId);
    if (!r) return;
    r.base.removeFromParent();
    r.base.visible = false;
    if (r.face) {
      r.face.removeFromParent();
      r.face.visible = false;
    }
    r.pillarId = -1;
    r.host = null;
  }

  has(pillarId: number): boolean {
    return this.rigs.some((q) => q.pillarId === pillarId);
  }

  /**
   * One frame of a dressed slab at (x, z) (its eased spot this frame, after a
   * step of `step` yards): the heading turned toward its drag, the pull's
   * cycle (a pace's worth of drag), the claws' swing, the column's rock and
   * lurch on its lean, the face turned to the heading, a gouge where each
   * front talon bites. Returns the lurch (yards ahead) and the rock (radians).
   */
  follow(
    pillarId: number,
    x: number,
    z: number,
    dx: number,
    dz: number,
    dt: number,
    out: { lurch: number; rock: number; heading: number },
  ): boolean {
    const r = this.rigs.find((q) => q.pillarId === pillarId);
    if (!r?.host) return false;
    const step = Math.hypot(dx, dz);
    const pace = dt > 0 ? step / dt : 0;
    // How hard it drags: eased, so a pick between two goals settles the claws.
    const want = Math.min(1, pace / 1.4);
    r.drag += (want - r.drag) * Math.min(1, dt * 4);
    if (step > 1e-4) {
      const target = Math.atan2(dx, dz);
      let d = target - r.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      r.heading += d * Math.min(1, dt * 3);
    }
    const before = r.phase;
    r.phase += (dt / SLAB_PULL_SECONDS) * (0.25 + 0.75 * r.drag) * (r.drag > 0.05 ? 1 : 0);
    slabPull(r.phase, r.drag, _pull);
    r.base.rotation.y = r.heading;
    for (let i = 0; i < r.claws.length; i++) {
      const swing = SLAB_CLAWS[i].ahead ? _pull.front : _pull.rear;
      r.claws[i].rotation.x = -swing;
    }
    // The bite: once a pull, a gouge under each front talon.
    const crossed = Math.floor(before - SLAB_BITE_PHASE) !== Math.floor(r.phase - SLAB_BITE_PHASE);
    if (crossed && r.drag > 0.3 && this.h.density > 0.5) {
      for (const c of SLAB_CLAWS) {
        if (!c.ahead) continue;
        slabTalon(x, z, r.heading, c.bear, r.scale, _talon);
        this.gouge(_talon.x, _talon.z, r.heading);
      }
      this.h.shakeNear(x, z, 0.12 * r.drag, 22);
    }
    out.lurch = _pull.lurch;
    out.rock = _pull.rock;
    out.heading = r.heading;
    r.x = x;
    r.z = z;
    return true;
  }

  private gouge(x: number, z: number, heading: number): void {
    const i = this.nextGouge;
    this.nextGouge = (i + 1) % GOUGES;
    this.gougeAge[i] = 0;
    _p.set(x, this.h.groundY(x, z) + 0.06, z);
    _q.setFromAxisAngle(_up, heading + (this.h.rand() - 0.5) * 0.25);
    _s.set(1, 1, 0.8 + this.h.rand() * 0.5);
    _m.compose(_p, _q, _s);
    this.gouges.setMatrixAt(i, _m);
    this.gouges.instanceMatrix.needsUpdate = true;
  }

  /** The gouges fading (every frame). */
  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < GOUGES; i++) {
      if (this.gougeAge[i] >= SLAB_GOUGE_SECONDS) {
        if (this.fade.getX(i) !== 0) {
          this.fade.setX(i, 0);
          dirty = true;
        }
        continue;
      }
      this.gougeAge[i] += dt;
      const t = this.gougeAge[i] / SLAB_GOUGE_SECONDS;
      this.fade.setX(i, Math.max(0, 1 - t * t));
      dirty = true;
    }
    if (dirty) this.fade.needsUpdate = true;
  }
}
