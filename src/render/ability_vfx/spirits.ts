import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ABILITIES } from '../../sim/data';
import { ABILITY_VFX_FULL_SPECS } from '../ability_vfx_full_specs';
import { loadGltf } from '../assets/loader';

// Spirit apparitions (the gallery's spawnSpirit/updateSpirits): ghost-tinted
// creature GLBs playing a short choreographed path, a druid's spectral bear
// lunging through the strike, Polymorph's startled sheep, Ghost Wolf's lap
// around the shaman, a voidwalker looming out of its summoning portal.
//
// Discipline in the game engine:
//   - One PUPPET per creature model, built once when its GLB resolves: a
//     SkeletonUtils clone whose meshes all share ONE additive ghost material
//     (cloned nothing per spawn), plus its mixer and intent-matched actions.
//     A spawn only attaches the cached puppet to a pooled holder slot, so
//     steady state (and every spawn after warm-up) allocates nothing.
//   - Cap 2 concurrent spirits; a model already on stage cannot double-book.
//   - GLB loads are async: a cast whose model is still in flight SKIPS
//     silently (no late pop-in). Models are warmed per class on first
//     sighting (painter.syncEntity), so the miss window is the first seconds
//     of first contact.
//   - Fresh-loaded puppets run a one-frame invisible compile pass so the
//     ghost material's program links at warm time, never mid-combat.
//   - Despawn is a dissolve-out: the shared opacity envelope ramps to zero
//     over the last 0.35s (the gallery's noise-dissolve shader stays a
//     gallery luxury; the opacity read is what survives the port).

// Mirrors the gallery SPIRIT_URLS onto the game's creature set (wolf.glb
// restored for the spirit pack; the gallery preview used wolf_basic).
export const SPIRIT_URLS: Record<string, string> = {
  wolf: 'models/creatures/wolf.glb',
  // the real quadruped, not the brown-tinted yeti biped this used to conjure
  bear: 'models/creatures/bear_form.glb',
  raptor: 'models/creatures/velociraptor.glb',
  stag: 'models/creatures/stag.glb',
  fox: 'models/creatures/fox.glb',
  bull: 'models/creatures/bull.glb',
  sheep: 'models/creatures/alpaca.glb',
  hawk: 'models/creatures/dragonevolved.glb',
  demon: 'models/creatures/demon.glb',
  voidwalker: 'models/creatures/demonalt.glb',
  ghost: 'models/creatures/ghost.glb',
  spider: 'models/creatures/spider.glb',
  boar: 'models/creatures/wild_boar.glb',
};

// Canonical species heights (world units): normalization must keep the food
// chain readable, the bull dwarfs the fox, the bear dwarfs everyone.
const SPIRIT_HEIGHT: Record<string, number> = {
  fox: 0.8,
  sheep: 1.1,
  wolf: 1.15,
  boar: 1.0,
  raptor: 1.7,
  stag: 2.0,
  bull: 2.2,
  bear: 2.5,
  hawk: 1.4,
  demon: 1.0,
  voidwalker: 2.4,
  ghost: 1.6,
  spider: 0.9,
};

// Per-species animation tempo (a bear strides slower than a fox).
const SPIRIT_TEMPO: Record<string, number> = {
  bear: 0.85,
  bull: 1.0,
  wolf: 1.15,
  fox: 1.25,
  raptor: 1.3,
  sheep: 0.9,
  hawk: 1.1,
  stag: 0.95,
  demon: 0.9,
  voidwalker: 0.7,
  ghost: 0.6,
  spider: 1.1,
  boar: 1.1,
};

// Clips matched by INTENT across the creature packs' naming schemes:
// locomotion while moving, idle while standing, the attack fired only at the
// moment that earns it (pass-through, landing).
export const MOVE_CLIPS = [
  'Gallop',
  'Run',
  'Fast_Flying',
  'Walk',
  'Move1 (jump)',
  'Spider_Walk',
  'Walking_A',
];
export const IDLE_CLIPS = ['Idle', 'Flying_Idle', 'Idle1', 'Idle_Combat', 'Spider_Idle'];
export const ATTACK_CLIPS = [
  'Attack',
  'Attack1 (marracca)',
  'Attack_Headbutt',
  'Punch',
  'Spider_Attack',
];

const MAX_SPIRITS = 2;

export type SpiritPath = 'rise' | 'lunge' | 'pounce' | 'circle' | 'swoop';
export type SpiritAtKind = 'caster' | 'target' | 'portal';

const SPIRIT_PATH_SET = new Set<string>(['rise', 'lunge', 'pounce', 'circle', 'swoop']);

// Resolve an authored path name ('rise' on unknown/absent, the calm default).
export function asSpiritPath(v: string | null | undefined): SpiritPath {
  return v != null && SPIRIT_PATH_SET.has(v) ? (v as SpiritPath) : 'rise';
}

export interface SpiritSpawnOpts {
  model: string;
  path: SpiritPath;
  atKind: SpiritAtKind;
  // ground-level base point of the choreography
  x: number;
  y: number;
  z: number;
  // horizontal unit direction the choreography runs along (caster -> target)
  dirX: number;
  dirZ: number;
  scale: number;
  dur: number;
  colorHex: number; // resolved tint (spec.spirit.tint or the ability color)
  dim: number;
}

interface SpiritPuppet {
  root: THREE.Object3D;
  mat: THREE.MeshBasicMaterial;
  mixer: THREE.AnimationMixer;
  moveA: THREE.AnimationAction | null;
  idleA: THREE.AnimationAction | null;
  atkA: THREE.AnimationAction | null;
  // the loop the finished-attack crossfade returns to (set per spawn)
  currentLoop: THREE.AnimationAction | null;
  tempo: number;
  rawHeight: number;
  rawMinY: number;
  inUse: boolean;
  compiled: boolean;
}

interface SpiritSlot {
  active: boolean;
  holder: THREE.Group;
  puppet: SpiritPuppet | null;
  model: string;
  path: SpiritPath;
  age: number;
  dur: number;
  scale: number;
  fx: number;
  fy: number;
  fz: number;
  dirX: number;
  dirZ: number;
  ghostMul: number;
  /** this apparition is drawn ON TOP of its own caster (a shapeshift rise) */
  overlapsCaster: boolean;
  colorHex: number;
  yaw: number;
  atkFired: boolean;
  prevX: number;
  prevY: number;
  prevZ: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// Class -> spirit models it can conjure, derived once from the authored spec
// table (the spec policy already encodes druid-only animals etc; this map
// only exists so a sighted player warms exactly their own models).
let modelsByClass: Map<string, string[]> | null = null;
function spiritModelsByClass(): Map<string, string[]> {
  if (modelsByClass) return modelsByClass;
  modelsByClass = new Map();
  for (const [id, spec] of Object.entries(ABILITY_VFX_FULL_SPECS)) {
    const model = spec.spirit?.model;
    if (!model || SPIRIT_URLS[model] === undefined) continue;
    const cls = ABILITIES[id]?.class;
    if (!cls) continue;
    let list = modelsByClass.get(cls);
    if (!list) {
      list = [];
      modelsByClass.set(cls, list);
    }
    if (!list.includes(model)) list.push(model);
  }
  return modelsByClass;
}

const scratch = new THREE.Vector3();
const bbScratch = new THREE.Box3();

/**
 * Runs one puppet build. The host supplies a scheduler that spends a browser
 * idle slot and the shared GPU arbiter on it; hosts without one (tests, the
 * editor viewport) keep the historical inline build.
 */
export type SpiritBuildScheduler = (build: () => void) => void;

export class SpiritApparitions {
  private slots: SpiritSlot[] = [];
  private puppets = new Map<string, SpiritPuppet>();
  private loading = new Set<string>();
  // fresh puppets ride one invisible frame here so their program compiles at
  // warm time instead of on the first mid-combat spawn
  private compileGroup: THREE.Group;
  private compileQueue: SpiritPuppet[] = [];
  private compiling: SpiritPuppet | null = null;
  private buildScheduler: SpiritBuildScheduler | null = null;
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    private groundY: (x: number, z: number) => number,
  ) {
    for (let i = 0; i < MAX_SPIRITS; i++) {
      const holder = new THREE.Group();
      holder.visible = false;
      holder.userData.renderCategory = 'vfx';
      scene.add(holder);
      this.slots.push({
        active: false,
        holder,
        puppet: null,
        model: '',
        path: 'rise',
        age: 0,
        dur: 1.5,
        scale: 1,
        fx: 0,
        fy: 0,
        fz: 0,
        dirX: 1,
        dirZ: 0,
        ghostMul: 1,
        colorHex: 0xffffff,
        yaw: 0,
        overlapsCaster: false,
        atkFired: false,
        prevX: 0,
        prevY: 0,
        prevZ: 0,
      });
    }
    this.compileGroup = new THREE.Group();
    this.compileGroup.position.set(0, -80, 0);
    this.compileGroup.visible = false;
    scene.add(this.compileGroup);
  }

  /**
   * Route puppet construction (a SkeletonUtils rig clone, a material rebind
   * traverse, and a per-vertex skinned-bounds measure) off the GLB resolve's
   * synchronous continuation. Without this the whole build lands in whatever
   * frame the loader happens to resolve in, which is a live combat frame:
   * warmForClass fires on first SIGHTING of a class, so a player walking into
   * a fight resolves several models at once.
   */
  setBuildScheduler(schedule: SpiritBuildScheduler | null): void {
    this.buildScheduler = schedule;
  }

  // Kick the async loads for every spirit model this class's kit authors.
  // Called on first sighting of a player of that class; misses are harmless
  // (an unwarmed model's first cast just skips its spirit).
  warmForClass(cls: string): void {
    const models = spiritModelsByClass().get(cls);
    if (!models) return;
    for (const model of models) this.ensureLoaded(model);
  }

  private ensureLoaded(model: string): void {
    if (this.puppets.has(model) || this.loading.has(model)) return;
    const url = SPIRIT_URLS[model];
    if (url === undefined) return;
    this.loading.add(model);
    loadGltf(url).then(
      (g) => {
        // The model stays marked loading until the build actually runs, so a
        // deferred build cannot be queued twice by a second ensureLoaded.
        const build = (): void => {
          this.loading.delete(model);
          if (this.puppets.has(model)) return;
          this.buildPuppet(model, g.scene, g.animations);
        };
        if (this.buildScheduler) this.buildScheduler(build);
        else build();
      },
      (err: unknown) => {
        // stays in `loading` forever on failure: never retried at frame rate
        console.warn('[spirits] model load failed', model, url, err);
      },
    );
  }

  // One cached puppet per model: skeleton clone, ONE shared ghost material
  // across all its meshes, measured skinned bounds, intent-matched actions.
  private buildPuppet(
    model: string,
    sourceScene: THREE.Object3D,
    animations: THREE.AnimationClip[],
  ): void {
    const root = cloneSkinned(sourceScene);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false, // depth-tested: a body, not a sticker
    });
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(() => mat) : mat;
      mesh.frustumCulled = false;
      mesh.renderOrder = 9; // ghosts draw over their overlap; they're apparitions
    });
    // Measure the SKINNED body (like prepareVisual): raw geometry bounds lie
    // badly for rigged creatures, armature node scales carry the real size.
    root.updateMatrixWorld(true);
    bbScratch.makeEmpty();
    root.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      sm.skeleton.update();
      const pos = sm.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 3) {
        scratch.fromBufferAttribute(pos, i);
        sm.applyBoneTransform(i, scratch);
        scratch.applyMatrix4(sm.matrixWorld);
        bbScratch.expandByPoint(scratch);
      }
    });
    if (bbScratch.isEmpty()) bbScratch.setFromObject(root); // static-mesh creatures
    const rawHeight = Math.max(0.001, bbScratch.max.y - bbScratch.min.y);
    const rawMinY = bbScratch.min.y;
    root.rotation.y = Math.PI / 2; // creatures face +Z; holder yaw owns facing

    const mixer = new THREE.AnimationMixer(root);
    const tempo = SPIRIT_TEMPO[model] ?? 1;
    const names = new Set(animations.map((c) => c.name));
    const findClip = (list: string[]): THREE.AnimationClip | null => {
      const name = list.find((n) => names.has(n));
      return name ? (animations.find((c) => c.name === name) ?? null) : null;
    };
    const mkAction = (
      clip: THREE.AnimationClip | null,
      loop: boolean,
    ): THREE.AnimationAction | null => {
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      a.timeScale = tempo * (loop ? 1 : 1.15);
      if (!loop) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      return a;
    };
    const puppet: SpiritPuppet = {
      root,
      mat,
      mixer,
      moveA: mkAction(findClip(MOVE_CLIPS), true),
      idleA: mkAction(findClip(IDLE_CLIPS), true),
      atkA: mkAction(findClip(ATTACK_CLIPS), false),
      currentLoop: null,
      tempo,
      rawHeight,
      rawMinY,
      inUse: false,
      compiled: false,
    };
    if (puppet.atkA) {
      mixer.addEventListener('finished', (e) => {
        // bite done -> back to stride
        if (e.action === puppet.atkA && puppet.currentLoop) {
          puppet.currentLoop.reset().play();
          puppet.atkA.crossFadeTo(puppet.currentLoop, 0.12, false);
        }
      });
    }
    this.puppets.set(model, puppet);
    this.compileQueue.push(puppet);
  }

  // Attach the cached puppet to a free slot. Returns false (skipping
  // silently) when the model is still loading, both slots run, or the puppet
  // is already on stage, a spirit never pops in late.
  spawn(o: SpiritSpawnOpts): boolean {
    const puppet = this.puppets.get(o.model);
    if (!puppet) {
      this.ensureLoaded(o.model); // warm for the next cast
      return false;
    }
    if (puppet.inUse) return false;
    let slot: SpiritSlot | null = null;
    for (const s of this.slots) {
      if (!s.active) {
        slot = s;
        break;
      }
    }
    if (!slot) return false;
    // a fresh puppet spawning before its compile frame just compiles here
    if (this.compiling === puppet) this.finishCompile();

    let x = o.x;
    let z = o.z;
    if (o.path === 'rise' && o.atKind === 'caster') {
      // loom BESIDE the caster, not inside them
      x += -o.dirZ * 1.2;
      z += o.dirX * 1.2;
    }
    // choreography that overlaps a body runs dimmer so additive stacking
    // never clips the silhouette to white; spec dim tunes further
    const overlaps =
      (o.path === 'rise' && o.atKind === 'caster') ||
      o.path === 'swoop' ||
      (o.path === 'pounce' && o.atKind === 'target');
    slot.ghostMul = (overlaps ? 1.3 : o.scale >= 1.05 ? 1.45 : 1.9) * o.dim;
    slot.overlapsCaster = o.path === 'rise' && o.atKind === 'caster';

    const targetH = (SPIRIT_HEIGHT[o.model] ?? 1.9) * o.scale;
    const s = targetH / puppet.rawHeight;
    puppet.root.scale.setScalar(s);
    puppet.root.position.y = -puppet.rawMinY * s;
    puppet.mat.color.setHex(o.colorHex).multiplyScalar(slot.ghostMul);
    puppet.mat.opacity = 0;
    puppet.inUse = true;

    const moving = o.path !== 'rise';
    const loop = moving ? (puppet.moveA ?? puppet.idleA) : (puppet.idleA ?? puppet.moveA);
    puppet.mixer.stopAllAction();
    puppet.currentLoop = loop;
    if (loop) loop.reset().play();

    slot.active = true;
    slot.puppet = puppet;
    slot.model = o.model;
    slot.path = o.path;
    slot.age = 0;
    slot.dur = Math.max(0.6, o.dur);
    slot.scale = o.scale;
    slot.fx = x;
    slot.fy = this.groundY(x, z);
    slot.fz = z;
    slot.dirX = o.dirX;
    slot.dirZ = o.dirZ;
    slot.colorHex = o.colorHex;
    slot.yaw = Math.atan2(-o.dirZ, o.dirX);
    slot.atkFired = false;
    slot.holder.position.set(x, slot.fy, z);
    slot.holder.rotation.set(0, slot.yaw, 0);
    slot.holder.add(puppet.root);
    slot.holder.visible = true;
    slot.prevX = x;
    slot.prevY = slot.fy;
    slot.prevZ = z;
    return true;
  }

  activeCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.active) n++;
    return n;
  }

  update(dt: number): void {
    this.time += dt;
    // one-frame compile pass for freshly loaded puppets, one puppet per frame
    if (this.compiling) this.finishCompile();
    if (!this.compiling) {
      const next = this.compileQueue.pop();
      if (next && !next.compiled && !next.inUse) {
        next.mat.opacity = 0;
        this.compileGroup.add(next.root);
        this.compileGroup.visible = true;
        this.compiling = next;
      }
    }
    for (const slot of this.slots) {
      if (!slot.active) continue;
      const puppet = slot.puppet;
      if (!puppet) {
        slot.active = false;
        continue;
      }
      slot.age += dt;
      const t = clamp01(slot.age / slot.dur);
      if (t >= 1) {
        this.release(slot);
        continue;
      }
      puppet.mixer.update(dt);
      // materialize over 0.25s, dissolve out over the last 0.35s
      const o = Math.min(slot.age / 0.25, 1, (slot.dur - slot.age) / 0.35);
      puppet.mat.opacity = 0.75 * clamp01(o);
      this.moveAlongPath(slot, puppet, t, dt);
    }
    if (this.compileGroup.children.length === 0) this.compileGroup.visible = false;
  }

  private finishCompile(): void {
    const p = this.compiling;
    if (!p) return;
    this.compiling = null;
    p.compiled = true;
    if (p.root.parent === this.compileGroup) this.compileGroup.remove(p.root);
  }

  private fireAtk(slot: SpiritSlot, puppet: SpiritPuppet): void {
    if (slot.atkFired || !puppet.atkA) return;
    slot.atkFired = true;
    puppet.atkA.reset().play();
    if (puppet.currentLoop) puppet.currentLoop.crossFadeTo(puppet.atkA, 0.08, false);
  }

  // The five gallery choreographies, run along the spawn's direction vector
  // (the gallery stage ran along +X; the game aims caster -> target). Ground
  // paths re-sample terrain height so a lunge across a slope stays planted.
  private moveAlongPath(slot: SpiritSlot, puppet: SpiritPuppet, t: number, dt: number): void {
    const h = slot.holder;
    const dx = slot.dirX;
    const dz = slot.dirZ;
    let px = slot.fx;
    let pz = slot.fz;
    let lift = 0; // height above ground at (px, pz)
    if (slot.path === 'lunge') {
      // gather speed, strike as it passes through
      const u = easeInOutSine(t);
      const disp = u * 6.4 - 2.8;
      px = slot.fx + dx * disp;
      pz = slot.fz + dz * disp;
      if (t > 0.38) this.fireAtk(slot, puppet);
    } else if (slot.path === 'pounce') {
      // stalk -> leap -> land in the strike
      let disp: number;
      if (t < 0.4) {
        disp = -2.2 + easeInOutSine(t / 0.4) * 1.2;
      } else if (t < 0.85) {
        const u = (t - 0.4) / 0.45;
        disp = -1.0 + u * 3.2;
        lift = Math.sin(u * Math.PI) * 1.7;
        if (u > 0.55) this.fireAtk(slot, puppet);
      } else {
        disp = 2.2;
      }
      px = slot.fx + dx * disp;
      pz = slot.fz + dz * disp;
    } else if (slot.path === 'circle') {
      // considered three-quarter lap, eased in and out
      const u = easeInOutSine(t);
      const a = slot.yaw - Math.PI / 2 + u * Math.PI * 1.5;
      px = slot.fx + Math.cos(a) * 1.95;
      pz = slot.fz + Math.sin(a) * 1.95;
    } else if (slot.path === 'swoop') {
      // committed dive, talons raking just above head height
      const disp = t * 12 - 6;
      px = slot.fx + dx * disp;
      pz = slot.fz + dz * disp;
      lift = Math.max(5.5 - Math.sin(t * Math.PI) * 5, 1.55);
      if (t > 0.42 && t < 0.6) this.fireAtk(slot, puppet);
      // the dragon rig only reads as a bird of prey with wings locked open:
      // freeze the flap through the dive, resume on the strike
      if (slot.model === 'hawk' && puppet.currentLoop) {
        puppet.currentLoop.timeScale =
          t > 0.22 && t < 0.62 && !slot.atkFired ? puppet.tempo * 0.1 : puppet.tempo;
      }
    } else {
      // rise: calm ceremonial presence with a slow surveying turn
      lift = Math.sin(this.time * 1.8) * 0.05;
      if (slot.model === 'sheep' && t > 0.4 && t < 0.55) {
        lift += Math.sin(((t - 0.4) / 0.15) * Math.PI) * 0.4; // startled half-hop
      }
      h.position.set(slot.fx, slot.fy + Math.max(0, lift), slot.fz);
      // A rise that OVERLAYS its own caster (a shapeshift) stays locked to the
      // caster's yaw. The surveying turn is +-0.55 rad, and on a body as long as
      // a bear that swings the silhouette a whole body-width off centre, so the
      // apparition reads as a second animal standing beside you rather than the
      // spirit of the one you just became. Rise spirits anchored elsewhere (a
      // portal summon, a target-side omen) keep the turn: it is what stops them
      // looking like a decal.
      h.rotation.y = slot.overlapsCaster ? slot.yaw : slot.yaw + Math.sin(t * Math.PI * 0.9) * 0.55;
      slot.prevX = h.position.x;
      slot.prevY = h.position.y;
      slot.prevZ = h.position.z;
      return;
    }
    const gy = this.groundY(px, pz);
    h.position.set(px, gy + lift, pz);
    // every moving spirit FACES its motion, turning smoothly
    const mx = h.position.x - slot.prevX;
    const my = h.position.y - slot.prevY;
    const mz = h.position.z - slot.prevZ;
    if (mx * mx + mz * mz > 1e-7) {
      const targetYaw = Math.atan2(-mz, mx);
      let dy = targetYaw - slot.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      slot.yaw += dy * Math.min(1, dt * 9);
      h.rotation.y = slot.yaw;
      if (slot.path === 'swoop') {
        const horiz = Math.sqrt(mx * mx + mz * mz);
        h.rotation.z = Math.max(-0.55, Math.min(0.55, Math.atan2(my, horiz + 1e-4) * 0.8));
      }
    }
    slot.prevX = h.position.x;
    slot.prevY = h.position.y;
    slot.prevZ = h.position.z;
  }

  private release(slot: SpiritSlot): void {
    const puppet = slot.puppet;
    if (puppet) {
      puppet.mixer.stopAllAction();
      puppet.currentLoop = null;
      puppet.mat.opacity = 0;
      puppet.inUse = false;
      slot.holder.remove(puppet.root);
    }
    slot.puppet = null;
    slot.active = false;
    slot.holder.visible = false;
    slot.holder.rotation.set(0, 0, 0);
  }

  clear(): void {
    for (const slot of this.slots) {
      if (slot.active) this.release(slot);
    }
  }
}
