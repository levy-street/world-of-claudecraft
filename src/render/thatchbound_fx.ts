// Thatchbound's visual layer (Old Thatchgrin's mind control, sim:
// src/sim/seasonal/scarecrow_puppet.ts), composed by ScarecrowFx (scarecrow_fx.ts):
//
//  - THE CAST: a violet sigil grows under each chosen victim over the cast bar (over the
//    shared encounter rune circle that marks them), full size the moment the curse lands;
//  - THE CURSE LANDING: a burst of crow feathers and straw off the victim and a dark-ember
//    shockwave (the curse's violet, never his fire's orange) rolling out round them;
//  - THE PUPPET, for as long as it is held: two burning eyes, a spinning violet sigil under
//    its feet, and a dense dark swirl of straw and crow feathers winding round its body
//    (two bands turning opposite ways, up to the shoulders). Nothing hangs above its head:
//    the marionette strings and control bar are gone (owner note 2026-10-18);
//  - FREED: the curse breaks off the body in a spray of straw and feathers.
// The eyes and the sigil are the read of WHO is controlled (allies act on it), so they
// draw at every graphics tier; only the swirl's particle rate thins (reduced motion).
//
// GPU work: one root group built on the first sight of a puppet or a mark, attached through
// the world compile gate (attachSceneGroupGated). The sigils (the puppets' and the cast's)
// and the shockwaves are two pooled InstancedMeshes, and the eyes are a small fixed pool of
// sprites sharing one material. Instance colours carry the fade (additive: darker is
// fainter), set before the first link so the program variant is the one used.
// An idle pool is hidden once its twin window is over, costing no draw. Particles ride the
// pooled point cloud (vfx.ts) through the boss layer's particle seam.
import * as THREE from 'three';
import { THATCHGRIN_KIT } from '../sim/content/gourdlight_eve_scarecrow';
import { attachSceneGroupGated } from './gated_scene_attach';
import {
  CAST_MARK_CAP,
  castGrow,
  eyeSize,
  PUPPET_ABILITY,
  PUPPET_AURA_IDS,
  PUPPET_CAP,
  puppetBody,
  puppetEyes,
  SHOCK_SEC,
  shockwave,
  sigilState,
  swirlPoint,
  swirlRate,
} from './thatchbound_fx_core';

/** The pooled particle calls this layer uses (vfx.ts, through ScarecrowFx's seam). */
export interface ThatchboundParticles {
  burst(at: THREE.Vector3, school: string, count?: number, power?: number, color?: number): void;
  groundPuff(at: THREE.Vector3, power: number, color: number): void;
}

interface PuppetEntity {
  pos: { x: number; y: number; z: number };
  facing: number;
  dead: boolean;
  auras?: readonly { id: string }[];
  castingAbility?: string | null;
}

interface MarkLike {
  sourceId?: number;
  targetId?: number;
  duration?: number;
}

interface PuppetSlot {
  born: number;
  phase: number;
  auraId: string;
  swirlClock: number;
  /** Swirl motes thrown so far: alternates the two bands and varies each mote. */
  swirlCount: number;
  seen: boolean;
  last: THREE.Vector3;
}

interface CastMark {
  bossId: number;
  victimId: number;
  start: number;
  duration: number;
}

interface Shock {
  x: number;
  y: number;
  z: number;
  born: number;
}

// the curse's colour: a sickly violet, never the orange of his burning ground (a sigil under
// a friend must not read as fire to step out of)
const SIGIL_EMBER = new THREE.Color(0xa050ff);
const SHOCK_EMBER = new THREE.Color(0x8a40e0);
const EYE_EMBER = 0xff5a10;
const STRAW = 0xd8b25a;
const FEATHERS = [0x15141a, 0x24222b, 0x0a0a0d] as const;
/** One sigil per puppet plus one growing under each chosen victim of a cast. */
export const THATCHBOUND_SIGIL_CAP = PUPPET_CAP + CAST_MARK_CAP;
const SIGIL_CAP = THATCHBOUND_SIGIL_CAP;
const SHOCK_CAP = PUPPET_CAP;
const SIGIL_RADIUS = 1.9;

/** A body's sigil phase: the cast's growing sigil and the held puppet's share it, so the
 *  one hands off to the other without a jump in spin or glow. */
function sigilPhase(id: number): number {
  return (id % 97) * 0.37;
}
const TWIN_SEC = 3;

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const BLACK = new THREE.Color(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const scratchMat = new THREE.Matrix4();
const scratchQuat = new THREE.Quaternion();
const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchColor = new THREE.Color();

/** The sigil's alpha art: a ring, an inner ring, and straw spokes (grey on black). */
function sigilTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const mid = size / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    const g = ctx.createRadialGradient(mid, mid, mid * 0.2, mid, mid, mid);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(mid, mid, mid * 0.88, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(mid, mid, mid * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    // straw spokes, crossed like a scarecrow's lashing, between the rings
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const b = a + 0.32;
      ctx.lineWidth = i % 3 === 0 ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(mid + Math.cos(a) * mid * 0.62, mid + Math.sin(a) * mid * 0.62);
      ctx.lineTo(mid + Math.cos(b) * mid * 0.88, mid + Math.sin(b) * mid * 0.88);
      ctx.stroke();
    }
    // the stitched grin at the centre
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(mid, mid * 0.98, mid * 0.28, 0.2, Math.PI - 0.2);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = 0.35 + (i / 5) * (Math.PI - 0.7);
      const x = mid + Math.cos(a) * mid * 0.28;
      const y = mid * 0.98 + Math.sin(a) * mid * 0.28;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x, y + 8);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A hot round glow (colour on transparent): the burning eyes. */
function eyeTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const mid = size / 2;
    const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    g.addColorStop(0, 'rgba(255,250,220,1)');
    g.addColorStop(0.2, 'rgba(255,170,60,0.95)');
    g.addColorStop(0.5, 'rgba(255,80,10,0.35)');
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

export class ThatchboundFx {
  private root: THREE.Group | null = null;
  private sigilGeo: THREE.CircleGeometry | null = null;
  private sigilTex: THREE.Texture | null = null;
  private sigilMat: THREE.MeshBasicMaterial | null = null;
  private sigils: THREE.InstancedMesh | null = null;
  private shockGeo: THREE.RingGeometry | null = null;
  private shockMat: THREE.MeshBasicMaterial | null = null;
  private shocks: THREE.InstancedMesh | null = null;
  private eyeTex: THREE.Texture | null = null;
  private eyeMat: THREE.SpriteMaterial | null = null;
  private eyes: THREE.Sprite[] = [];
  private readonly puppets = new Map<number, PuppetSlot>();
  private readonly casts: CastMark[] = [];
  private readonly shockList: Shock[] = [];
  private time = 0;
  private rootBorn = 0;
  private disposed = false;
  private idle = false;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly particles: ThatchboundParticles,
    private readonly entities: () => ReadonlyMap<number, PuppetEntity>,
    private readonly entity: (id: number) => PuppetEntity | undefined,
    private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {}

  private ensureRoot(): void {
    if (this.root) return;
    const root = new THREE.Group();
    root.name = 'thatchbound-fx';
    // the sigils under the puppets and under the cast's chosen
    this.sigilTex = sigilTexture();
    this.sigilGeo = new THREE.CircleGeometry(1, 48);
    this.sigilGeo.rotateX(-Math.PI / 2);
    this.sigilMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaMap: this.sigilTex ?? undefined,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.sigils = new THREE.InstancedMesh(this.sigilGeo, this.sigilMat, SIGIL_CAP);
    for (let i = 0; i < SIGIL_CAP; i++) {
      this.sigils.setMatrixAt(i, HIDDEN);
      this.sigils.setColorAt(i, BLACK);
    }
    this.sigils.frustumCulled = false;
    this.sigils.name = 'thatchbound-sigils';
    root.add(this.sigils);
    // the curse's shockwave rings
    this.shockGeo = new THREE.RingGeometry(0.86, 1, 64);
    this.shockGeo.rotateX(-Math.PI / 2);
    this.shockMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.shocks = new THREE.InstancedMesh(this.shockGeo, this.shockMat, SHOCK_CAP);
    for (let i = 0; i < SHOCK_CAP; i++) {
      this.shocks.setMatrixAt(i, HIDDEN);
      this.shocks.setColorAt(i, BLACK);
    }
    this.shocks.frustumCulled = false;
    this.shocks.name = 'thatchbound-shocks';
    root.add(this.shocks);
    // the burning eyes: a fixed pool sharing one material (the first is the program twin)
    this.eyeTex = eyeTexture();
    this.eyeMat = new THREE.SpriteMaterial({
      map: this.eyeTex ?? undefined,
      color: EYE_EMBER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < PUPPET_CAP * 2; i++) {
      const s = new THREE.Sprite(this.eyeMat);
      s.scale.setScalar(0.001);
      s.visible = i === 0;
      root.add(s);
      this.eyes.push(s);
    }
    this.root = root;
    this.rootBorn = this.time;
    void attachSceneGroupGated(this.scene, root, this.compileGate, () => this.disposed).catch(
      () => {},
    );
  }

  /** A Thatchbound mark (the cast's spellfxAt on a victim): a sigil grows under it. */
  handleMark(ev: MarkLike): void {
    if (this.disposed || ev.sourceId === undefined || ev.targetId === undefined) return;
    this.ensureRoot();
    if (this.casts.length >= CAST_MARK_CAP) this.casts.shift();
    this.casts.push({
      bossId: ev.sourceId,
      victimId: ev.targetId,
      start: this.time,
      duration: ev.duration ?? 2.5,
    });
  }

  /** Whether an event belongs to this layer (its marks are routed here by ScarecrowFx). */
  static claims(ability: string | undefined): boolean {
    return ability === PUPPET_ABILITY;
  }

  /** Per frame. `bossNear`: his body is in the world this frame (ScarecrowFx's scan saw
   *  it): the root is built then, before his first cast, so its gate has settled by the
   *  time the cast's sigils must show; and with no boss and no puppet, no entity scan runs. */
  update(dt: number, reducedMotion: boolean, bossNear: boolean): void {
    if (this.disposed) return;
    this.time += dt;
    if (bossNear) this.ensureRoot();
    if (bossNear || this.puppets.size > 0) {
      // who is a puppet this frame
      for (const slot of this.puppets.values()) slot.seen = false;
      this.entities().forEach(this.watchPuppet);
      for (const [id, slot] of this.puppets) {
        if (slot.seen) continue;
        this.freed(slot.last);
        this.puppets.delete(id);
      }
    }
    if (!this.root) return;
    this.draw(dt, reducedMotion);
  }

  /** One entity of the frame's scan (a stable bound callback: no closure per frame). */
  private readonly watchPuppet = (e: PuppetEntity, id: number): void => {
    if (e.dead || !e.auras || e.auras.length === 0) return;
    let auraId: string | null = null;
    for (const a of e.auras) {
      if (PUPPET_AURA_IDS.has(a.id)) {
        auraId = a.id;
        break;
      }
    }
    if (auraId === null) return;
    let slot = this.puppets.get(id);
    if (!slot) {
      if (this.puppets.size >= PUPPET_CAP) return;
      this.ensureRoot();
      slot = {
        born: this.time,
        phase: sigilPhase(id),
        auraId,
        swirlClock: 0,
        swirlCount: 0,
        seen: true,
        last: new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z),
      };
      this.puppets.set(id, slot);
      this.landed(e);
    }
    slot.seen = true;
    slot.auraId = auraId;
    slot.last.set(e.pos.x, e.pos.y, e.pos.z);
  };

  /** The curse lands on a body: feathers and straw burst off it, a shockwave rolls out. */
  private landed(e: PuppetEntity): void {
    const at = scratchPos.set(e.pos.x, e.pos.y + 1.4, e.pos.z);
    for (let i = 0; i < FEATHERS.length; i++)
      this.particles.burst(at, 'shadow', 22, 1.5, FEATHERS[i]);
    this.particles.burst(at, 'nature', 30, 1.3, STRAW);
    this.particles.burst(at, 'fire', 18, 1.1, 0xff7a2a);
    this.particles.groundPuff(scratchPos.set(e.pos.x, e.pos.y, e.pos.z), 1.2, 0x5a4528);
    if (this.shockList.length >= SHOCK_CAP) this.shockList.shift();
    this.shockList.push({ x: e.pos.x, y: e.pos.y, z: e.pos.z, born: this.time });
  }

  /** The curse breaks: straw and feathers spray off the body where the puppet stood. */
  private freed(at: THREE.Vector3): void {
    this.particles.burst(scratchPos.set(at.x, at.y + 1.6, at.z), 'nature', 26, 1.2, STRAW);
    this.particles.burst(scratchPos.set(at.x, at.y + 1.0, at.z), 'shadow', 14, 1.0, FEATHERS[0]);
  }

  private draw(dt: number, reducedMotion: boolean): void {
    const sigils = this.sigils;
    const shocks = this.shocks;
    if (!sigils || !shocks) return;
    const twins = this.time - this.rootBorn < TWIN_SEC;
    // drop the finished cast marks and shockwaves
    for (let i = this.casts.length - 1; i >= 0; i--) {
      const c = this.casts[i];
      // a kicked cast (his bar cleared before it lands) takes its sigils with it
      const boss = this.entity(c.bossId);
      const fizzled =
        this.time - c.start > 0.15 &&
        this.time - c.start < c.duration - 0.1 &&
        boss?.castingAbility !== undefined &&
        boss.castingAbility !== THATCHGRIN_KIT.puppet.name;
      if (fizzled || this.time - c.start > c.duration + 0.15) this.casts.splice(i, 1);
    }
    for (let i = this.shockList.length - 1; i >= 0; i--) {
      if (this.time - this.shockList[i].born > SHOCK_SEC) this.shockList.splice(i, 1);
    }
    const active = this.puppets.size > 0 || this.casts.length > 0 || this.shockList.length > 0;
    // idle past the twin window, and its pools already hidden: nothing to draw
    if (!active && !twins && this.idle) return;
    let sigil = 0;
    let eye = 0;
    for (const [id, slot] of this.puppets) {
      const e = this.entity(id);
      if (!e) continue;
      const body = puppetBody(slot.auraId);
      // the sigil under its feet
      const s = sigilState(this.time, slot.phase);
      scratchQuat.setFromAxisAngle(UP, s.spin);
      scratchMat.compose(
        scratchPos.set(e.pos.x, e.pos.y + 0.06, e.pos.z),
        scratchQuat,
        scratchScale.setScalar(SIGIL_RADIUS),
      );
      sigils.setMatrixAt(sigil, scratchMat);
      sigils.setColorAt(sigil, scratchColor.copy(SIGIL_EMBER).multiplyScalar(s.glow));
      sigil++;
      // the burning eyes
      const size = eyeSize(this.time, slot.phase);
      for (const p of puppetEyes(e.pos, e.facing, body)) {
        const sprite = this.eyes[eye++];
        if (!sprite) break;
        sprite.visible = true;
        sprite.position.set(p.x, p.y, p.z);
        sprite.scale.setScalar(size);
      }
      // the dark swirl of straw and crow feathers winding round it: two bands turning
      // opposite ways, mostly feathers, up to the shoulders
      slot.swirlClock += dt * swirlRate(reducedMotion);
      while (slot.swirlClock >= 1) {
        slot.swirlClock -= 1;
        slot.swirlCount++;
        const k = Math.floor(this.time * 61 + slot.phase * 13) + slot.swirlCount;
        const p = swirlPoint(e.pos, this.time, k, slot.swirlCount % 2 === 0 ? 1 : -1);
        const feather = k % 4 !== 0;
        this.particles.burst(
          scratchPos.set(p.x, p.y, p.z),
          feather ? 'shadow' : 'nature',
          2,
          0.35,
          feather ? FEATHERS[k % FEATHERS.length] : STRAW,
        );
      }
    }
    // the cast's sigil growing under each chosen victim (a victim already held keeps
    // its own sigil; this one only draws until the curse lands)
    for (const c of this.casts) {
      if (sigil >= SIGIL_CAP) break;
      if (this.puppets.has(c.victimId)) continue;
      const victim = this.entity(c.victimId);
      if (!victim || victim.dead) continue;
      const grow = castGrow(this.time - c.start, c.duration);
      if (grow <= 0.01) continue;
      const s = sigilState(this.time, sigilPhase(c.victimId));
      scratchQuat.setFromAxisAngle(UP, s.spin);
      scratchMat.compose(
        scratchPos.set(victim.pos.x, victim.pos.y + 0.06, victim.pos.z),
        scratchQuat,
        scratchScale.setScalar(SIGIL_RADIUS * grow),
      );
      sigils.setMatrixAt(sigil, scratchMat);
      sigils.setColorAt(sigil, scratchColor.copy(SIGIL_EMBER).multiplyScalar(s.glow * grow));
      sigil++;
    }
    for (let i = sigil; i < SIGIL_CAP; i++) sigils.setMatrixAt(i, HIDDEN);
    for (let i = eye; i < this.eyes.length; i++) {
      const sprite = this.eyes[i];
      sprite.scale.setScalar(0.001);
      sprite.visible = twins && i === 0;
    }
    // the shockwaves
    let shock = 0;
    for (const sh of this.shockList) {
      const w = shockwave(this.time - sh.born);
      scratchMat.compose(
        scratchPos.set(sh.x, sh.y + 0.1, sh.z),
        scratchQuat.identity(),
        scratchScale.setScalar(w.radius),
      );
      shocks.setMatrixAt(shock, scratchMat);
      shocks.setColorAt(shock, scratchColor.copy(SHOCK_EMBER).multiplyScalar(w.glow));
      shock++;
    }
    for (let i = shock; i < SHOCK_CAP; i++) shocks.setMatrixAt(i, HIDDEN);
    for (const mesh of [sigils, shocks]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // an idle pool past its twin window costs no draw
    sigils.visible = twins || sigil > 0;
    shocks.visible = twins || shock > 0;
    // only a frame that HID everything (no activity, past the twins) may skip the next
    this.idle = !active && !twins;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root?.removeFromParent();
    this.sigils?.dispose();
    this.sigilGeo?.dispose();
    this.sigilTex?.dispose();
    this.sigilMat?.dispose();
    this.shocks?.dispose();
    this.shockGeo?.dispose();
    this.shockMat?.dispose();
    this.eyeTex?.dispose();
    this.eyeMat?.dispose();
    this.eyes = [];
    this.puppets.clear();
    this.casts.length = 0;
    this.shockList.length = 0;
    this.root = null;
    this.sigils = null;
    this.shocks = null;
  }
}
