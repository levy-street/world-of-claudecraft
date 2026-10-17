// Old Thatchgrin's visual layer (Gourdlight Eve's field boss, sim: src/sim/seasonal/
// scarecrow_kit.ts and scarecrow_swell.ts). What the shared vocabulary cannot say alone:
//
//  - GOURDFALL: on his Throw clip's release frame a lit gourd flies from his hand up into
//    the sky, and then a burning pumpkin drops out of the sky onto every ring the sim laid
//    down (the ring itself is the shared encounter rune circle at its true radius, drawn at
//    every graphics tier, never re-drawn here), each on a steep slant behind a comet of
//    fire, landing on its ring's last frame;
//  - the BURST where each lands: a fireball of flame, pumpkin shards and seeds, a smoke
//    column and a dust ring, on top of the shared impact flash and blast ring;
//  - the SMOLDERING CHAFF it leaves: a hot ember disc on the ground at the patch's TRUE
//    radius for exactly its burn time (the read: where not to stand), with flames and smoke
//    rising off it. The disc is actionable information, so it draws at every graphics tier;
//    only the particle density scales;
//  - the SWELLING GOURD: it heaves up out of the stubble, swells as its fuse (its cast bar)
//    runs, glows hotter and throbs faster at the end, leaks embers and smoke; broken, it
//    splits in a spray of pulp and seeds and he reels (dizzy sparks round his head, an
//    ember glow through the split in his chest for as long as he is split open); unbroken,
//    it bursts in a fireball with a shockwave rolling out over the whole field;
// plus the crows bursting off him at his call's peak and straw puffs as he collapses.
//
// GPU work: every falling pumpkin (and the gourd thrown at the sky) is one instance of a
// pooled InstancedMesh per part of the decor kit's small carved pumpkin, the instanced
// program variant the decor view already links behind its gate (seasonal_decor.ts), and
// their fire comets are one more pooled InstancedMesh. The comet, the patch disc, the halo
// sprites and the shockwave ring are built with this layer's root (on the first sight of
// him) and attached through the world compile gate (attachSceneGroupGated), each with a
// hidden twin so its program links before its first use. Every particle rides the pooled
// point cloud (vfx.ts). A rain reuses the pools (only a chaff patch builds its tiny disc).
import * as THREE from 'three';
import { attachSceneGroupGated } from './gated_scene_attach';
import {
  bodyLocalToWorld,
  CHAFF_ABILITY,
  chaffFlameCalls,
  chaffStrength,
  DEATH_FOLD_SEC,
  DEATH_HEAP_SEC,
  FALL_SEC,
  fallOrigin,
  fallPoint,
  fallWindow,
  GOURD_ABILITY,
  GOURD_HAND_LOCAL,
  GOURD_RELEASE_SEC,
  SUMMON_ABILITY,
  SUMMON_PEAK_SEC,
  SWELL_ABILITY,
  SWELLING_GOURD_TEMPLATE,
  swellGlow,
  swellScale,
  swellThrob,
  THATCHGRIN_TEMPLATE,
} from './scarecrow_fx_core';
import { gourdlightAssets } from './seasonal_decor_assets';

/** The pooled particle calls this layer uses (vfx.ts). */
export interface ScarecrowParticles {
  burst(at: THREE.Vector3, school: string, count?: number, power?: number, color?: number): void;
  burstLater(
    seconds: number,
    x: number,
    y: number,
    z: number,
    school: string,
    count?: number,
    power?: number,
    color?: number,
  ): void;
  groundPuff(at: THREE.Vector3, power: number, color: number): void;
  fireworkBurst(at: THREE.Vector3, colors: readonly number[], count?: number, power?: number): void;
  campfireEmber(at: THREE.Vector3, dt: number): void;
  fluidSmoke(x: number, y: number, z: number, color: number, dt: number, rate: number): void;
}

interface EntityLike {
  templateId: string;
  pos: { x: number; y: number; z: number };
  facing: number;
  dead: boolean;
  castRemaining?: number;
  castTotal?: number;
  auras?: readonly { id: string }[];
}

interface SpellfxAtLike {
  fx: string;
  x: number;
  z: number;
  ability?: string;
  sourceId?: number;
  targetId?: number;
  radius?: number;
  duration?: number;
}

/** One slot of the falling-pumpkin pool: a drop from the sky (or the gourd thrown up). */
interface FallSlot {
  active: boolean;
  /** true: the lit gourd he throws UP at the sky (it shrinks away into it). */
  up: boolean;
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  end: number;
  spin: number;
}

interface Patch {
  disc: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  radius: number;
  born: number;
  total: number;
  flameClock: number;
}

const SHARD_COLORS = [0xff8a1a, 0xffb347, 0xd9561a, 0xfff0a8] as const;
const PULP_COLORS = [0xfff0b0, 0xffd27a, 0xff9a2e, 0xe0761c] as const;
const DIRT_COLORS = [0x5a4528, 0x7a6038, 0x3e2e1a] as const;
const FEATHER_COLORS = [0x15141a, 0x24222b, 0x0a0a0d] as const;
const STRAW_COLOR = 0xd8b25a;
const CHAFF_DENSITY = 0.6;
const SMOKE = 0x2a2420;
/** Falling pumpkins at once (a full rain is nine, plus the gourd thrown up). */
const FALL_CAP = 12;
/** The pumpkin's drawn size in the rain (the decor kit's small carved pumpkin). */
const FALL_SCALE = 1.9;
/** Halo sprites at once: two gourds' glows and his split chest. */
const HALO_CAP = 3;
/** Where his chest glows through the split (world yards above his feet). */
const CHEST_UP = 4.1;
/** Where the dizzy sparks circle (above his hat). */
const DIZZY_UP = 7.9;

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const scratchMat = new THREE.Matrix4();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchEuler = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
/** Seconds after the root attaches that its idle twins stay drawn (so the gate links
 *  their programs); afterwards an idle pool is hidden, costing no draw. */
const TWIN_SEC = 3;

/** The burning patch's alpha: a dim smoulder across the stubble, scattered live embers
 *  and a hot ragged rim at the edge (the boundary is the read). Built once per layer. */
function emberTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const mid = size / 2;
    // an alpha map reads the GREEN channel, so paint grey on opaque black
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.96, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // live embers and glowing stalks across the patch
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * mid * 0.86;
      const x = mid + Math.cos(a) * r;
      const y = mid + Math.sin(a) * r;
      const e = ctx.createRadialGradient(x, y, 0, x, y, 3 + Math.random() * 9);
      e.addColorStop(0, `rgba(255,255,255,${0.5 + Math.random() * 0.5})`);
      e.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = e;
      ctx.fillRect(x - 12, y - 12, 24, 24);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * mid * 0.8;
      ctx.beginPath();
      ctx.moveTo(mid + Math.cos(a) * r, mid + Math.sin(a) * r);
      ctx.lineTo(mid + Math.cos(a + 0.2) * (r + 18), mid + Math.sin(a + 0.2) * (r + 18));
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A soft round halo (colour on transparent): the gourd's inner light, his chest's split. */
function haloTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const mid = size / 2;
    const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.25, 'rgba(255,170,70,0.75)');
    g.addColorStop(0.6, 'rgba(255,90,20,0.22)');
    g.addColorStop(1, 'rgba(255,60,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** The fire comet behind a falling pumpkin: a flame shell round it and a tapering tail
 *  trailing up its path, vertex-coloured hot at the pumpkin to nothing at the tail's end
 *  (additive, so black is clear). Its +Y runs UP THE TRAIL (against the fall). */
function cometGeometry(): THREE.BufferGeometry {
  const shell = new THREE.IcosahedronGeometry(1.25, 1);
  const tail = new THREE.ConeGeometry(1.1, 7.5, 12, 4, true);
  tail.translate(0, 3.75 + 0.2, 0);
  const paint = (geo: THREE.BufferGeometry, fn: (y: number) => [number, number, number]) => {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const [r, g, b] = fn(pos.getY(i));
      col[i * 3] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  };
  // kept well under white: additive over a bright sky, a full-strength comet blows out to
  // a white stalk and the pumpkin inside it stops reading
  paint(shell, () => [0.62, 0.22, 0.04]);
  paint(tail, (y) => {
    const t = Math.max(0, Math.min(1, (y - 0.2) / 7.5));
    const k = (1 - t) ** 1.8;
    return [0.7 * k, (0.3 - 0.18 * t) * k, 0.06 * k];
  });
  const merged = mergeTwo(shell, tail);
  shell.dispose();
  tail.dispose();
  return merged;
}

/** Two non-indexed-compatible geometries in one (position + color), the comet's parts. */
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const ga = a.index ? a.toNonIndexed() : a;
  const gb = b.index ? b.toNonIndexed() : b;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'color'] as const) {
    const pa = ga.getAttribute(name) as THREE.BufferAttribute;
    const pb = gb.getAttribute(name) as THREE.BufferAttribute;
    const arr = new Float32Array(pa.array.length + pb.array.length);
    arr.set(pa.array as Float32Array, 0);
    arr.set(pb.array as Float32Array, pa.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  if (ga !== a) ga.dispose();
  if (gb !== b) gb.dispose();
  out.computeBoundingSphere();
  return out;
}

/** An entity's drawn scale: its own, times any body swell a fight layer puts on it (the
 *  rift death zone's bloat, the Swelling Gourd's ripening). The renderer's one call. */
export function entityDisplayScale(
  e: EntityLike & { id: number; scale: number },
  rift: { bodySwell(id: number): number } | null | undefined,
  scarecrow: ScarecrowFx,
): number {
  return e.scale * (rift?.bodySwell(e.id) ?? 1) * scarecrow.bodySwell(e, e.id);
}

export class ScarecrowFx {
  private root: THREE.Group | null = null;
  private discMaterial: THREE.MeshBasicMaterial | null = null;
  private discGeometry: THREE.CircleGeometry | null = null;
  private discTexture: THREE.Texture | null = null;
  private cometMaterial: THREE.MeshBasicMaterial | null = null;
  private cometGeo: THREE.BufferGeometry | null = null;
  private comets: THREE.InstancedMesh | null = null;
  private pumpkins: THREE.InstancedMesh[] | null = null;
  /** The pumpkin pool's own gated group, and the kit parts it was built over. */
  private pumpkinGroup: THREE.Group | null = null;
  private pumpkinParts: unknown = null;
  private pumpkinsReady = false;
  private fallsIdle = false;
  private haloTexture: THREE.Texture | null = null;
  private halos: THREE.Sprite[] = [];
  private ringMaterial: THREE.MeshBasicMaterial | null = null;
  private fireballMaterial: THREE.MeshBasicMaterial | null = null;
  private fireball: THREE.Mesh | null = null;
  private ring: THREE.Mesh | null = null;
  private ringBorn = -1;
  private ringAt = new THREE.Vector3();
  private readonly falls: FallSlot[] = [];
  private readonly patches: Patch[] = [];
  private readonly deadSeen = new Set<number>();
  /** The sim time-ish clock each live gourd rose at (by entity id), for its heave. */
  private readonly gourdBorn = new Map<number, number>();
  private time = 0;
  private frameDt = 1 / 60;
  private rootBorn = 0;
  private dizzyClock = 0;
  private disposed = false;
  private readonly scratch = new THREE.Vector3();
  private readonly scratch2 = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly particles: ScarecrowParticles,
    private readonly groundY: (x: number, z: number) => number,
    private readonly entities: () => ReadonlyMap<number, EntityLike>,
    private readonly entity: (id: number) => EntityLike | undefined,
    private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    for (let i = 0; i < FALL_CAP; i++) {
      this.falls.push({
        active: false,
        up: false,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        start: 0,
        end: 0,
        spin: 0,
      });
    }
  }

  /** Built on the first sight of him (or his gourd): a world that never sees the boss
   *  links nothing. Every program this layer will need is in the gated attach. */
  private ensureRoot(): THREE.Group {
    if (this.root) return this.root;
    const root = new THREE.Group();
    root.name = 'scarecrow-fx';
    this.discTexture = emberTexture();
    this.discMaterial = new THREE.MeshBasicMaterial({
      color: 0xd8480e,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaMap: this.discTexture ?? undefined,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.discGeometry = new THREE.CircleGeometry(1, 40);
    this.discGeometry.rotateX(-Math.PI / 2);
    // one hidden twin so the gate links the disc's program before the first patch
    const twin = new THREE.Mesh(this.discGeometry, this.discMaterial);
    twin.scale.setScalar(0.001);
    root.add(twin);
    // the fire comets: one pooled instanced draw for every falling pumpkin
    this.cometGeo = cometGeometry();
    this.cometMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const comets = new THREE.InstancedMesh(this.cometGeo, this.cometMaterial, FALL_CAP);
    for (let i = 0; i < FALL_CAP; i++) comets.setMatrixAt(i, HIDDEN);
    comets.frustumCulled = false;
    comets.name = 'scarecrow-fx-comets';
    root.add(comets);
    this.comets = comets;
    // the halo sprites (the gourd's inner light, his split chest): a small fixed pool
    this.haloTexture = haloTexture();
    for (let i = 0; i < HALO_CAP; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.haloTexture ?? undefined,
          color: 0xffffff,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0,
        }),
      );
      sprite.visible = i === 0; // the first stands as the program twin (opacity 0)
      sprite.scale.setScalar(0.001);
      root.add(sprite);
      this.halos.push(sprite);
    }
    // the burst's shockwave: one flat ring, rolled out over the field and faded
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8a2a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ringGeo = new THREE.RingGeometry(0.82, 1, 72);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, this.ringMaterial);
    this.ring.scale.setScalar(0.001);
    root.add(this.ring);
    // the burst's fireball: one additive ball, blown out and faded (it shares the ring's clock)
    this.fireballMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6a18,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.fireball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), this.fireballMaterial);
    this.fireball.scale.setScalar(0.001);
    root.add(this.fireball);
    this.root = root;
    this.rootBorn = this.time;
    void attachSceneGroupGated(this.scene, root, this.compileGate, () => this.disposed).catch(
      () => {},
    );
    return root;
  }

  /** The pooled pumpkins: one InstancedMesh per part of the decor kit's small carved
   *  pumpkin, FALL_CAP instances each, over the kit's own geometry and materials (the
   *  instanced variant the decor view already links). Null until the kit has loaded. */
  private ensurePumpkins(): THREE.InstancedMesh[] | null {
    const parts = gourdlightAssets()?.decor.pumpkin_small;
    if (this.pumpkins && parts === this.pumpkinParts)
      return this.pumpkinsReady ? this.pumpkins : null;
    // a material-tier rebuild of the kit retires the pool built over its old materials
    this.releasePumpkins();
    if (!parts || !this.root) return null;
    const group = new THREE.Group();
    group.name = 'scarecrow-fx-pumpkins';
    this.pumpkins = parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, FALL_CAP);
      for (let i = 0; i < FALL_CAP; i++) mesh.setMatrixAt(i, HIDDEN);
      mesh.frustumCulled = false;
      mesh.visible = false;
      group.add(mesh);
      return mesh;
    });
    this.pumpkinParts = parts;
    this.pumpkinGroup = group;
    // its own gate: the kit may finish loading mid-fight, before the decor's gate settles
    const mine = group;
    const retired = () => this.disposed || this.pumpkinGroup !== mine;
    void attachSceneGroupGated(this.root, group, this.compileGate, retired)
      .then(() => {
        if (!retired()) this.pumpkinsReady = true;
      })
      .catch(() => {});
    return null;
  }

  private releasePumpkins(): void {
    // the geometry and materials are the decor kit's: only the instance buffers go
    if (this.pumpkins) for (const m of this.pumpkins) m.dispose();
    this.pumpkinGroup?.removeFromParent();
    this.pumpkins = null;
    this.pumpkinGroup = null;
    this.pumpkinParts = null;
    this.pumpkinsReady = false;
  }

  private takeSlot(): FallSlot | null {
    for (const s of this.falls) if (!s.active) return s;
    return null;
  }

  /** The sim's spellfxAt for his abilities. True when this layer CLAIMS the event (the
   *  renderer's generic arms skip it); false lets the shared rune / impact draw too. */
  handleSpellfxAt(ev: SpellfxAtLike): boolean {
    if (this.disposed) return false;
    if (ev.ability === GOURD_ABILITY && ev.fx === 'runeCircle') {
      this.scheduleFall(ev);
      return false; // the shared encounter rune circle is the ring, at its true radius
    }
    if (ev.ability === GOURD_ABILITY && ev.fx === 'nova') {
      this.pumpkinBurst(ev.x, ev.z, ev.radius ?? 4);
      return false; // the shared impact flash and blast ring ride on top
    }
    if (ev.ability === CHAFF_ABILITY) {
      this.addPatch(ev.x, ev.z, ev.radius ?? 2.5, ev.duration ?? 6);
      return true;
    }
    if (ev.ability === SUMMON_ABILITY && ev.fx === 'burst') {
      const y = this.groundY(ev.x, ev.z);
      this.particles.groundPuff(this.scratch.set(ev.x, y, ev.z), 1, 0x8a7350);
      return false;
    }
    if (ev.ability === SWELL_ABILITY) {
      if (ev.fx === 'burst') this.gourdRises(ev);
      else if (ev.fx === 'tick') this.gourdBreaks(ev.x, ev.z);
      else if (ev.fx === 'nova') {
        this.gourdBursts(ev.x, ev.z, ev.radius ?? 40);
        return false; // the shared impact flash and blast ring ride on top
      }
      return true;
    }
    return false;
  }

  /** The windup cue of his call or his throw: the crows burst off him at the call's peak;
   *  the throw flings a lit gourd from his hand up into the sky on its release frame. */
  handleWindup(sourceId: number, ability: string | undefined): void {
    if (this.disposed) return;
    const boss = this.entity(sourceId);
    if (!boss) return;
    if (ability === GOURD_ABILITY) {
      this.throwSkyward(boss);
      return;
    }
    if (ability !== SUMMON_ABILITY) return;
    const y = boss.pos.y + 5.2;
    for (let i = 0; i < 3; i++) {
      this.particles.burstLater(
        SUMMON_PEAK_SEC + i * 0.08,
        boss.pos.x,
        y,
        boss.pos.z,
        'shadow',
        26,
        1.4,
        FEATHER_COLORS[i],
      );
    }
    this.particles.burstLater(
      SUMMON_PEAK_SEC,
      boss.pos.x,
      boss.pos.y + 3.4,
      boss.pos.z,
      'nature',
      22,
      1.2,
      STRAW_COLOR,
    );
  }

  /** The lit gourd he hurls at the sky: from his hand at the clip's release, up and away. */
  private throwSkyward(boss: EntityLike): void {
    this.ensureRoot();
    const slot = this.takeSlot();
    if (!slot) return;
    const hand = bodyLocalToWorld(
      boss.pos.x,
      boss.pos.z,
      boss.facing,
      GOURD_HAND_LOCAL.left,
      GOURD_HAND_LOCAL.forward,
    );
    slot.active = true;
    slot.up = true;
    slot.from.set(hand.x, boss.pos.y + GOURD_HAND_LOCAL.up, hand.z);
    slot.to.set(
      hand.x + Math.sin(boss.facing) * 4,
      boss.pos.y + 34,
      hand.z + Math.cos(boss.facing) * 4,
    );
    slot.start = this.time + GOURD_RELEASE_SEC;
    slot.end = slot.start + 0.9;
    slot.spin = 4;
  }

  private scheduleFall(ev: SpellfxAtLike): void {
    this.ensureRoot();
    const slot = this.takeSlot();
    if (!slot) return;
    const y = this.groundY(ev.x, ev.z);
    const o = fallOrigin(ev.x, y, ev.z);
    const w = fallWindow(this.time, ev.duration ?? 2.4);
    slot.active = true;
    slot.up = false;
    slot.from.set(o.x, o.y, o.z);
    slot.to.set(ev.x, y + 0.7, ev.z);
    slot.start = w.start;
    slot.end = w.end;
    slot.spin = 3 + (Math.abs(ev.x * 7.3 + ev.z * 3.1) % 3);
  }

  private pumpkinBurst(x: number, z: number, radius: number): void {
    const y = this.groundY(x, z);
    const at = this.scratch.set(x, y + 0.8, z);
    // the fireball: a hard flash, then flame rolling up and out
    this.particles.burst(at, 'fire', 34, 2.3, 0xffe2a0);
    this.particles.fireworkBurst(at, SHARD_COLORS, 30, 1.5);
    this.particles.groundPuff(this.scratch.set(x, y, z), 0.85, 0x6b5638);
    for (let i = 0; i < 3; i++) {
      this.particles.burstLater(
        0.06 + i * 0.1,
        x,
        y + 0.9 + i * 0.6,
        z,
        'fire',
        18,
        1.5 - i * 0.25,
      );
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = radius * 0.7;
      this.particles.burstLater(
        0.04,
        x + Math.sin(a) * r,
        y + 0.4,
        z + Math.cos(a) * r,
        'fire',
        6,
        0.7,
      );
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      this.particles.fluidSmoke(x + Math.sin(a), y, z + Math.cos(a), SMOKE, 1, 1000);
    }
  }

  /** The gourd heaves up out of the stubble: dirt and straw thrown up round it. */
  private gourdRises(ev: SpellfxAtLike): void {
    this.ensureRoot();
    if (ev.targetId !== undefined) this.gourdBorn.set(ev.targetId, this.time);
    const y = this.groundY(ev.x, ev.z);
    this.particles.groundPuff(this.scratch.set(ev.x, y, ev.z), 2.2, 0x5a4528);
    this.particles.fireworkBurst(this.scratch.set(ev.x, y + 0.5, ev.z), DIRT_COLORS, 60, 1.6);
    this.particles.burst(this.scratch.set(ev.x, y + 0.6, ev.z), 'nature', 40, 1.6, STRAW_COLOR);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.particles.fluidSmoke(
        ev.x + Math.sin(a) * 2,
        y,
        ev.z + Math.cos(a) * 2,
        0x4a3c2c,
        1,
        1000,
      );
    }
  }

  /** The fuse ran out: a fireball, pumpkin shards over the field, and a shockwave. */
  private gourdBursts(x: number, z: number, radius: number): void {
    this.ensureRoot();
    const y = this.groundY(x, z);
    const at = this.scratch.set(x, y + 2, z);
    this.particles.burst(at, 'fire', 120, 4.2, 0xfff0c0);
    this.particles.fireworkBurst(at, SHARD_COLORS, 110, 3.4);
    this.particles.fireworkBurst(this.scratch.set(x, y + 1.2, z), PULP_COLORS, 60, 2.4);
    this.particles.groundPuff(this.scratch.set(x, y, z), 3, 0x5a4528);
    for (let i = 0; i < 9; i++) {
      this.particles.burstLater(0.05 + i * 0.1, x, y + 2 + i * 0.9, z, 'fire', 46, 3.2 - i * 0.25);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.particles.burstLater(
        0.12,
        x + Math.sin(a) * 4,
        y + 0.6,
        z + Math.cos(a) * 4,
        'fire',
        14,
        1.6,
      );
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 3 + (i % 3);
      this.particles.fluidSmoke(x + Math.sin(a) * r, y, z + Math.cos(a) * r, SMOKE, 1, 1000);
    }
    if (this.ring && this.ringMaterial) {
      this.ringAt.set(x, y + 0.25, z);
      this.ringBorn = this.time;
      this.ring.userData.radius = Math.min(radius, 26);
    }
  }

  /** Broken: it splits in a spray of pulp and seeds. */
  private gourdBreaks(x: number, z: number): void {
    const y = this.groundY(x, z);
    const at = this.scratch.set(x, y + 1.6, z);
    this.particles.fireworkBurst(at, PULP_COLORS, 90, 2.2);
    this.particles.burst(at, 'fire', 30, 1.6, 0xffb347);
    this.particles.groundPuff(this.scratch.set(x, y, z), 1.6, 0x8a6a34);
  }

  private addPatch(x: number, z: number, radius: number, total: number): void {
    const root = this.ensureRoot();
    if (!this.discMaterial) return;
    // draped on the ground under it, so a patch on a slope never half-sinks into the hill
    const geometry = new THREE.CircleGeometry(radius, 40, 0, Math.PI * 2);
    geometry.rotateX(-Math.PI / 2);
    const y = this.groundY(x, z);
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.groundY(x + pos.getX(i), z + pos.getZ(i)) - y + 0.08);
    }
    pos.needsUpdate = true;
    const disc = new THREE.Mesh(geometry, this.discMaterial);
    disc.position.set(x, y, z);
    disc.visible = false;
    root.add(disc);
    this.patches.push({ disc, x, y, z, radius, born: this.time, total, flameClock: 0 });
  }

  /** The Swelling Gourd's drawn size (the renderer folds it into the entity's scale):
   *  1 for every other body. */
  bodySwell(e: EntityLike & { id?: number }, id: number): number {
    if (e.templateId !== SWELLING_GOURD_TEMPLATE || e.dead) return 1;
    const total = e.castTotal ?? 0;
    const p = total > 0 ? 1 - (e.castRemaining ?? 0) / total : 1;
    const born = this.gourdBorn.get(id);
    const since = born === undefined ? 99 : this.time - born;
    return swellScale(p, since, this.time);
  }

  update(dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    this.time += dt;
    this.frameDt = dt;
    this.updateFalls(dt, reducedMotion);
    this.updatePatches(dt);
    this.updateShockwave();
    this.halosUsed = 0;
    // his collapse into straw, his gourds' glow, his reel
    this.entities().forEach(this.watchEntity);
    const twins = this.time - this.rootBorn < TWIN_SEC;
    for (let i = this.halosUsed; i < this.halos.length; i++) {
      const s = this.halos[i];
      (s.material as THREE.SpriteMaterial).opacity = 0;
      s.scale.setScalar(0.001);
      s.visible = twins && i === 0;
    }
    if (this.gourdBorn.size > 0) {
      for (const id of this.gourdBorn.keys()) if (!this.entity(id)) this.gourdBorn.delete(id);
    }
  }

  private updateFalls(dt: number, reducedMotion: boolean): void {
    if (!this.comets) return;
    const pumpkins = this.ensurePumpkins();
    const twins = this.time - this.rootBorn < TWIN_SEC;
    // an idle pool past its twin window was hidden last frame: nothing to rewrite
    if (this.fallsIdle && !twins && !this.falls.some((f) => f.active)) return;
    let any = false;
    for (let i = 0; i < this.falls.length; i++) {
      const f = this.falls[i];
      let shown = false;
      if (f.active && this.time >= f.start) {
        const t = (this.time - f.start) / Math.max(0.05, f.end - f.start);
        if (t >= 1) {
          f.active = false;
        } else {
          shown = true;
          any = true;
          const p = f.up
            ? fallPoint(f.from, f.to, 1 - (1 - t) * (1 - t))
            : fallPoint(f.from, f.to, t);
          const size = f.up ? FALL_SCALE * 0.75 * (1 - t * 0.85) : FALL_SCALE;
          // the pumpkin, tumbling
          const spin = reducedMotion ? 0 : (this.time - f.start) * f.spin;
          scratchQuat.setFromEuler(scratchEuler.set(spin, spin * 0.6, spin * 0.3));
          scratchMat.compose(
            this.scratch.set(p.x, p.y, p.z),
            scratchQuat,
            scratchScale.setScalar(size),
          );
          if (pumpkins) for (const m of pumpkins) m.setMatrixAt(i, scratchMat);
          // its comet: the tail pointing back up the path it came down
          scratchDir.subVectors(f.from, f.to).normalize();
          scratchQuat.setFromUnitVectors(UP, scratchDir);
          const flick = reducedMotion ? 1 : 0.9 + 0.2 * Math.sin(this.time * 31 + i);
          scratchMat.compose(
            this.scratch2.set(p.x, p.y, p.z),
            scratchQuat,
            scratchScale.set(size * 0.42 * flick, size * 0.55, size * 0.42 * flick),
          );
          this.comets.setMatrixAt(i, scratchMat);
          // sparks and smoke shed along the trail
          this.particles.burst(this.scratch.set(p.x, p.y, p.z), 'fire', 1, 0.18);
          this.particles.campfireEmber(this.scratch.set(p.x, p.y - 0.5, p.z), dt);
          if (!f.up) this.particles.fluidSmoke(p.x, p.y, p.z, SMOKE, dt, 4);
        }
      }
      if (!shown) {
        this.comets.setMatrixAt(i, HIDDEN);
        if (pumpkins) for (const m of pumpkins) m.setMatrixAt(i, HIDDEN);
      }
    }
    this.comets.instanceMatrix.needsUpdate = true;
    if (pumpkins) for (const m of pumpkins) m.instanceMatrix.needsUpdate = true;
    // an idle pool draws nothing (its programs linked with the root's gated attach)
    this.comets.visible = any || twins;
    if (pumpkins) for (const m of pumpkins) m.visible = any;
    this.fallsIdle = !any && !twins && pumpkins !== null;
  }

  private updatePatches(dt: number): void {
    // fixed density: the governor never thins a hazard a player reacts to
    const calls = chaffFlameCalls(CHAFF_DENSITY);
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const patch = this.patches[i];
      const age = this.time - patch.born;
      const k = chaffStrength(age, patch.total);
      if (age >= patch.total) {
        patch.disc.removeFromParent();
        patch.disc.geometry.dispose();
        this.patches.splice(i, 1);
        continue;
      }
      // the disc is drawn at the TRUE radius for the whole burn: the edge a player reads is
      // the edge that burns (it only shows once the patch has caught)
      patch.disc.visible = k > 0.02;
      for (let c = 0; c < calls; c++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * patch.radius * 0.95;
        this.particles.campfireEmber(
          this.scratch.set(patch.x + Math.sin(a) * r, patch.y - 0.45, patch.z + Math.cos(a) * r),
          dt * k,
        );
      }
      // low tongues of flame licking up off the stubble, a few a second
      patch.flameClock -= dt;
      if (patch.flameClock <= 0 && k > 0.2) {
        patch.flameClock = 0.14;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * patch.radius * 0.85;
        this.particles.burst(
          this.scratch.set(patch.x + Math.sin(a) * r, patch.y + 0.15, patch.z + Math.cos(a) * r),
          'fire',
          4,
          0.35,
        );
      }
      this.particles.fluidSmoke(patch.x, patch.y, patch.z, SMOKE, dt, 2 * k);
    }
  }

  private updateShockwave(): void {
    if (!this.ring || !this.ringMaterial || !this.fireball || !this.fireballMaterial) return;
    if (this.ringBorn < 0) {
      const twins = this.time - this.rootBorn < TWIN_SEC;
      this.ring.visible = twins;
      this.fireball.visible = twins;
      return;
    }
    this.ring.visible = true;
    this.fireball.visible = true;
    const age = this.time - this.ringBorn;
    // the fireball: swells to 7 yd in a third of a second, then rolls up and fades
    const fk = Math.min(1, age / 1.1);
    const grow = 1 - (1 - Math.min(1, age / 0.32)) ** 3;
    this.fireball.position.set(this.ringAt.x, this.ringAt.y + 1.5 + 2.2 * fk, this.ringAt.z);
    this.fireball.scale.set(7 * grow, 6 * grow * (1 + 0.3 * fk), 7 * grow);
    this.fireballMaterial.opacity = 0.85 * (1 - fk) ** 1.5;
    this.fireballMaterial.color.setRGB(1, 0.42 - 0.22 * fk, 0.1 - 0.08 * fk);
    const life = 1.1;
    if (age >= life) {
      this.ringBorn = -1;
      this.ringMaterial.opacity = 0;
      this.ring.scale.setScalar(0.001);
      this.fireballMaterial.opacity = 0;
      this.fireball.scale.setScalar(0.001);
      return;
    }
    const k = Math.min(1, age / 0.75);
    const r = (this.ring.userData.radius as number) * (1 - (1 - k) ** 3);
    this.ring.position.copy(this.ringAt);
    this.ring.scale.setScalar(Math.max(0.001, r));
    this.ringMaterial.opacity = 0.9 * (1 - k);
  }

  private halosUsed = 0;

  private placeHalo(x: number, y: number, z: number, size: number, opacity: number, color: number) {
    if (this.halosUsed >= this.halos.length) return;
    const s = this.halos[this.halosUsed++];
    s.visible = true;
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    const m = s.material as THREE.SpriteMaterial;
    m.opacity = opacity;
    m.color.setHex(color);
  }

  /** Per entity, per frame: allocation-free (a bound method over Map.forEach). */
  private readonly watchEntity = (e: EntityLike, id: number): void => {
    if (e.templateId === SWELLING_GOURD_TEMPLATE) {
      this.ensureRoot();
      if (e.dead) return;
      const total = e.castTotal ?? 0;
      const p = total > 0 ? 1 - (e.castRemaining ?? 0) / total : 0;
      const swell = this.bodySwell(e, id);
      const cy = e.pos.y + 1.9 * swell;
      const glow = swellGlow(p, this.time);
      // a hot core seen through its carved face and seams, kept small and soft so the gourd
      // itself (its grin, its rind) still reads through it
      this.placeHalo(
        e.pos.x,
        cy,
        e.pos.z,
        2.0 * swell * (0.85 + 0.3 * glow),
        0.1 + 0.4 * glow,
        0xffffff,
      );
      // embers and smoke leaking out of its seams, more and faster as it ripens
      const leak = 0.6 + 2.4 * p + Math.max(0, swellThrob(p, this.time));
      this.particles.campfireEmber(
        this.scratch.set(e.pos.x, cy + 1.2 * swell, e.pos.z),
        this.frameDt * leak,
      );
      this.particles.fluidSmoke(
        e.pos.x,
        cy + 1.4 * swell,
        e.pos.z,
        SMOKE,
        this.frameDt,
        1.5 + 4 * p,
      );
      return;
    }
    if (e.templateId !== THATCHGRIN_TEMPLATE) return;
    this.ensureRoot();
    if (!e.dead) {
      this.deadSeen.delete(id);
      this.watchReel(e);
      return;
    }
    if (this.deadSeen.has(id)) return;
    this.deadSeen.add(id);
    const { x, y, z } = e.pos;
    this.particles.burstLater(DEATH_FOLD_SEC, x, y + 2.2, z, 'nature', 36, 1.6, STRAW_COLOR);
    this.particles.burstLater(DEATH_HEAP_SEC, x, y + 0.6, z, 'nature', 48, 1.9, STRAW_COLOR);
    this.particles.burstLater(DEATH_HEAP_SEC, x, y + 0.4, z, 'nature', 24, 1.2, 0x8a6a34);
  };

  /** His reel after a gourd breaks: dizzy sparks circling over his hat while he is
   *  Uprooted, an ember glow through the split in his chest while his rind is Split. */
  private watchReel(e: EntityLike): void {
    const auras = e.auras;
    if (!auras || auras.length === 0) return;
    let stunned = false;
    let split = false;
    for (const a of auras) {
      if (a.id === 'thatchgrin_uprooted') stunned = true;
      else if (a.id === 'thatchgrin_split_rind') split = true;
    }
    if (split) {
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 7);
      this.placeHalo(e.pos.x, e.pos.y + CHEST_UP, e.pos.z, 3.4 * pulse, 0.75 * pulse, 0xff6a2a);
    }
    if (stunned) {
      this.dizzyClock -= this.frameDt;
      if (this.dizzyClock <= 0) {
        this.dizzyClock = 0.05;
        for (let k = 0; k < 3; k++) {
          const a = this.time * 5 + (k / 3) * Math.PI * 2;
          this.particles.burst(
            this.scratch.set(
              e.pos.x + Math.cos(a) * 1.4,
              e.pos.y + DIZZY_UP + 0.2 * Math.sin(this.time * 9 + k),
              e.pos.z + Math.sin(a) * 1.4,
            ),
            'holy',
            1,
            0.05,
            0xffe066,
          );
        }
        this.particles.burst(
          this.scratch.set(e.pos.x, e.pos.y + 3, e.pos.z),
          'nature',
          1,
          0.6,
          STRAW_COLOR,
        );
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.patches) p.disc.geometry.dispose();
    this.patches.length = 0;
    this.root?.removeFromParent();
    this.discMaterial?.dispose();
    this.discGeometry?.dispose();
    this.discTexture?.dispose();
    this.cometMaterial?.dispose();
    this.cometGeo?.dispose();
    this.comets?.dispose();
    this.releasePumpkins();
    this.haloTexture?.dispose();
    for (const s of this.halos) (s.material as THREE.SpriteMaterial).dispose();
    this.ringMaterial?.dispose();
    this.ring?.geometry.dispose();
    this.fireballMaterial?.dispose();
    this.fireball?.geometry.dispose();
    this.fireballMaterial = null;
    this.fireball = null;
    this.discMaterial = null;
    this.discGeometry = null;
    this.discTexture = null;
    this.cometMaterial = null;
    this.cometGeo = null;
    this.comets = null;
    this.halos = [];
    this.ring = null;
    this.ringMaterial = null;
    this.root = null;
  }
}
