// The Straw Foreman, alive: its plank hide falling away, the lantern in its eye going out,
// and the soldiers hammering it back together. The Three half.
//
// Read effigy_rig_core.ts first: it owns the choreography (where every plank is at every
// moment, the shudder, the flicker). This file finds the authored pieces on the effigy's
// own model (the GLB's `Plank_NN` nodes, `LanternGlass` and the `LanternFlame` anchor,
// scripts/assets/muster_effigy/), copies the core's numbers onto them, and draws the small
// things the model cannot: the flame, the smoke a snuffed lantern gives off, and the dust
// the planks raise where they land.
//
// WHOSE state: the drill is per player (src/sim/muster_effigy.ts), and so is this drawing.
// It is driven by the viewer's own reticle plan (eye_ward_marker_drive.ts), which reads the
// VIEWER's window off their own timer aura: the planks fall on your screen because YOUR
// thrust put the lantern out, and a player drilling beside you sees their own effigy.
//
// GPU: every material the rig can draw is in the module cache below, registered with the
// prewarm manifest (ability_material_prewarm.ts, a stand-in drawing each one), so the first
// lantern snuffed in a session links nothing live. The lit and dark glass are one clone of
// the model's own glass material (same program) whose colours are re-graded, never swapped.

import * as THREE from 'three';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import {
  type EffigyPlankRest,
  effigyFlameFlicker,
  effigyPlankFallAt,
  effigyPlankLandTime,
  effigyPlankLaunch,
  effigyPlankRebuildAt,
  effigyRebuildSeconds,
  effigyShudderAt,
} from './effigy_rig_core';

/** The model's authored pieces (the export contract, scripts/assets/muster_effigy/). */
const PLANK_NAME = /^Plank_\d+$/;
const LANTERN_GLASS = 'LanternGlass';
const LANTERN_FLAME = 'LanternFlame';

const SMOKE_PUFFS = 7;
const DUST_PUFFS = 18;
const SMOKE_SECONDS = 1.9;
const DUST_SECONDS = 1.1;

interface EffigyRigMaterials {
  flame: THREE.MeshBasicMaterial;
  flameCore: THREE.MeshBasicMaterial;
  smoke: THREE.MeshBasicMaterial;
  dust: THREE.MeshBasicMaterial;
}

let rigMaterials: EffigyRigMaterials | null = null;
let puffGeometry: THREE.BufferGeometry | null = null;
let flameGeometry: THREE.BufferGeometry | null = null;

/** Every material the rig can draw: the prewarm manifest drains this cache. */
export function effigyRigMaterials(): EffigyRigMaterials {
  if (rigMaterials) return rigMaterials;
  const additive = (color: number, opacity: number): THREE.MeshBasicMaterial =>
    markSharedMaterial(
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
  const soft = (color: number): THREE.MeshBasicMaterial =>
    markSharedMaterial(
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }),
    );
  rigMaterials = {
    flame: additive(0xff9a3c, 0.75),
    flameCore: additive(0xfff1b0, 0.9),
    smoke: soft(0x6f6a64),
    dust: soft(0x9c8566),
  };
  return rigMaterials;
}

function puffGeo(): THREE.BufferGeometry {
  if (!puffGeometry) puffGeometry = markSharedGeometry(new THREE.IcosahedronGeometry(1, 1));
  return puffGeometry;
}

function flameGeo(): THREE.BufferGeometry {
  if (!flameGeometry) {
    // A teardrop: a sphere drawn up into a point, the way a candle flame reads.
    const g = new THREE.SphereGeometry(1, 10, 8);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const taper = y > 0 ? 1 - y * 0.72 : 1;
      p.setXYZ(i, p.getX(i) * taper, y > 0 ? y * 1.9 : y * 0.8, p.getZ(i) * taper);
    }
    g.computeVertexNormals();
    flameGeometry = markSharedGeometry(g);
  }
  return flameGeometry;
}

/** A hidden stand-in drawing every rig material, for the prewarm manifest. */
export function buildEffigyRigStandIn(): THREE.Group {
  const m = effigyRigMaterials();
  const group = new THREE.Group();
  group.name = 'muster-effigy-rig-standin';
  group.add(
    new THREE.Mesh(flameGeo(), m.flame),
    new THREE.Mesh(flameGeo(), m.flameCore),
    new THREE.Mesh(puffGeo(), m.smoke),
    new THREE.Mesh(puffGeo(), m.dust),
  );
  group.visible = false;
  return group;
}

interface Plank {
  node: THREE.Object3D;
  rest: EffigyPlankRest;
  restQ: THREE.Quaternion;
  flatQ: THREE.Quaternion;
  /** Where it came to lie (captured at the landing, the rebuild's start). */
  lay: [number, number, number];
  layW: number;
  landedDust: boolean;
}

interface Puff {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

type Phase = 'standing' | 'falling' | 'down' | 'rebuilding';

const scratchPos: [number, number, number] = [0, 0, 0];
const scratchQ = new THREE.Quaternion();
const scratchBox = new THREE.Box3();
const scratchSize = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** The plank a node rests as, and how it lies once it is on the ground. */
function plankRest(node: THREE.Object3D, index: number): Plank | null {
  const mesh = node as THREE.Mesh;
  const geometry = mesh.isMesh ? mesh.geometry : (node.children[0] as THREE.Mesh)?.geometry;
  if (!geometry) return null;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  scratchBox.copy(geometry.boundingBox ?? scratchBox.makeEmpty());
  scratchBox.getSize(scratchSize);
  // The plank's thin axis, in its own frame: the one it must lie on.
  const thin =
    scratchSize.x <= scratchSize.y && scratchSize.x <= scratchSize.z
      ? new THREE.Vector3(1, 0, 0)
      : scratchSize.y <= scratchSize.z
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
  // The optimizer stores quantized geometry under a uniform node scale: measure through it.
  const scale = Math.abs(node.scale.x) || 1;
  const halfThickness = Math.max(
    0.02,
    (Math.min(scratchSize.x, scratchSize.y, scratchSize.z) * scale) / 2,
  );
  const restQ = node.quaternion.clone();
  // Lying flat: the thin axis turned to world up, then a stable yaw for this plank.
  const thinWorld = thin.clone().applyQuaternion(restQ);
  const flatQ = new THREE.Quaternion().setFromUnitVectors(thinWorld.normalize(), UP);
  flatQ.multiply(restQ);
  const yaw = new THREE.Quaternion().setFromAxisAngle(UP, (index * 2.399963) % (Math.PI * 2));
  flatQ.premultiply(yaw);
  return {
    node,
    rest: {
      x: node.position.x,
      y: node.position.y,
      z: node.position.z,
      q: [restQ.x, restQ.y, restQ.z, restQ.w],
      flat: [flatQ.x, flatQ.y, flatQ.z, flatQ.w],
      halfThickness,
    },
    restQ,
    flatQ,
    lay: [node.position.x, node.position.y, node.position.z],
    layW: 0,
    landedDust: false,
  };
}

/**
 * One effigy's plank hide, lantern and puffs. Built once per visual (CharacterVisual, off
 * VisualDef.effigy), driven every frame with the viewer's reticle plan.
 */
export class EffigyRig {
  private planks: Plank[] = [];
  private pivot: THREE.Object3D;
  private pivotRest = new THREE.Euler();
  private glass: THREE.Mesh[] = [];
  private glassMats: THREE.MeshStandardMaterial[] = [];
  private litColor: THREE.Color[] = [];
  private litEmissive: THREE.Color[] = [];
  private flame: THREE.Group | null = null;
  private flameAnchor: THREE.Object3D | null = null;
  private smoke: Puff[] = [];
  private dust: Puff[] = [];
  private phase: Phase = 'standing';
  private phaseT = 0;
  private shudderT = Number.POSITIVE_INFINITY;
  private clock = 0;
  private lit = 1;

  constructor(private model: THREE.Object3D) {
    const found: THREE.Object3D[] = [];
    model.traverse((n) => {
      if (PLANK_NAME.test(n.name)) found.push(n);
    });
    found.sort((a, b) => (a.name < b.name ? -1 : 1));
    found.forEach((node, i) => {
      const plank = plankRest(node, i);
      if (plank) this.planks.push(plank);
    });
    this.pivot = found[0]?.parent ?? model;
    this.pivotRest.copy(this.pivot.rotation);
    model.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (n.name !== LANTERN_GLASS && n.parent?.name !== LANTERN_GLASS) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      if (!src || Array.isArray(src)) return;
      // One owned clone (the same program as the model's own glass), so re-grading it never
      // touches the shared, cached source material.
      const mat = src.clone();
      mesh.material = mat;
      this.glass.push(mesh);
      this.glassMats.push(mat);
      this.litColor.push(mat.color.clone());
      this.litEmissive.push(mat.emissive ? mat.emissive.clone() : new THREE.Color(0));
    });
    this.flameAnchor = model.getObjectByName(LANTERN_FLAME) ?? null;
    const m = effigyRigMaterials();
    if (this.flameAnchor) {
      const flame = new THREE.Group();
      flame.name = 'effigy-flame';
      const outer = new THREE.Mesh(flameGeo(), m.flame);
      outer.scale.setScalar(0.09);
      const core = new THREE.Mesh(flameGeo(), m.flameCore);
      core.scale.setScalar(0.05);
      core.position.y = -0.01;
      outer.renderOrder = 7;
      core.renderOrder = 8;
      flame.add(outer, core);
      this.flameAnchor.add(flame);
      this.flame = flame;
    }
    const puff = (base: THREE.MeshBasicMaterial): Puff => {
      const mat = base.clone();
      const mesh = new THREE.Mesh(puffGeo(), mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      model.add(mesh);
      return { mesh, mat, age: 1, life: 1, vx: 0, vy: 0, vz: 0, size: 0 };
    };
    for (let i = 0; i < SMOKE_PUFFS; i++) this.smoke.push(puff(m.smoke));
    for (let i = 0; i < DUST_PUFFS; i++) this.dust.push(puff(m.dust));
  }

  /** True when the model carried the authored pieces this rig drives. */
  usable(): boolean {
    return this.planks.length > 0;
  }

  /** Is the lantern out on this viewer's effigy (the eye glow gutters with it)? */
  lanternOut(): boolean {
    return this.phase === 'falling' || this.phase === 'down';
  }

  /**
   * One frame. `down` is the viewer's own window: the plan's `blinded` state off the
   * reticle drive. The edges start the fall and the rebuild; everything else is a clock.
   */
  update(down: boolean, dt: number, reducedMotion = false): void {
    this.clock += dt;
    this.phaseT += dt;
    this.shudderT += dt;
    if (down && (this.phase === 'standing' || this.phase === 'rebuilding')) this.fall();
    else if (!down && (this.phase === 'falling' || this.phase === 'down')) this.rebuild();
    this.drivePlanks();
    this.driveShudder(reducedMotion);
    this.driveLantern(dt, reducedMotion);
    this.drivePuffs(dt, this.smoke);
    this.drivePuffs(dt, this.dust);
  }

  private fall(): void {
    // A rebuild caught half way falls from wherever each plank got to.
    this.phase = 'falling';
    this.phaseT = 0;
    this.shudderT = 0;
    for (const plank of this.planks) plank.landedDust = false;
    this.snuffPuff();
  }

  private rebuild(): void {
    for (const plank of this.planks) {
      plank.lay[0] = plank.node.position.x;
      plank.lay[1] = plank.node.position.y;
      plank.lay[2] = plank.node.position.z;
    }
    this.phase = 'rebuilding';
    this.phaseT = 0;
  }

  private drivePlanks(): void {
    const count = this.planks.length;
    if (this.phase === 'standing') return;
    let settled = true;
    for (let i = 0; i < count; i++) {
      const plank = this.planks[i];
      let w: number;
      if (this.phase === 'rebuilding') {
        w = effigyPlankRebuildAt(plank.rest, plank.lay, i, count, this.phaseT, scratchPos);
      } else {
        w = effigyPlankFallAt(plank.rest, i, this.phaseT, scratchPos);
        const launch = effigyPlankLaunch(plank.rest, i);
        const land = launch.delay + effigyPlankLandTime(plank.rest, launch.vy);
        if (!plank.landedDust && this.phaseT >= land) {
          plank.landedDust = true;
          this.dustAt(scratchPos[0], scratchPos[2], i);
        }
        if (this.phaseT < land + 0.3) settled = false;
      }
      plank.node.position.set(scratchPos[0], scratchPos[1], scratchPos[2]);
      scratchQ.copy(plank.restQ).slerp(plank.flatQ, w);
      plank.node.quaternion.copy(scratchQ);
    }
    if (this.phase === 'falling' && settled) this.phase = 'down';
    if (this.phase === 'rebuilding' && this.phaseT >= effigyRebuildSeconds(count) + 0.05) {
      for (const plank of this.planks) {
        plank.node.position.set(plank.rest.x, plank.rest.y, plank.rest.z);
        plank.node.quaternion.copy(plank.restQ);
      }
      this.phase = 'standing';
      // The last plank nailed home: a small settle of the whole figure.
      this.shudderT = 0.7;
    }
  }

  private driveShudder(reducedMotion: boolean): void {
    const s = effigyShudderAt(this.shudderT, reducedMotion);
    this.pivot.rotation.set(
      this.pivotRest.x + s.pitch,
      this.pivotRest.y,
      this.pivotRest.z + s.roll,
    );
  }

  private driveLantern(dt: number, reducedMotion: boolean): void {
    const target = this.lanternOut() ? 0 : 1;
    // Out in a breath, relit a little slower (a soldier with a taper).
    const rate = target < this.lit ? 5 : 1.6;
    this.lit += Math.sign(target - this.lit) * Math.min(Math.abs(target - this.lit), rate * dt);
    const k = this.lit * effigyFlameFlicker(this.clock, reducedMotion);
    if (this.flame) {
      this.flame.visible = this.lit > 0.02;
      const sway = reducedMotion ? 0 : Math.sin(this.clock * 7.1) * 0.08;
      this.flame.scale.set(0.8 + 0.2 * k, 0.6 + 0.4 * k, 0.8 + 0.2 * k);
      this.flame.rotation.z = sway;
    }
    for (let i = 0; i < this.glassMats.length; i++) {
      const mat = this.glassMats[i];
      // Dark glass: the lit colour pulled to soot, the glow cut; relit, both come back.
      mat.color.copy(this.litColor[i]).multiplyScalar(0.22 + 0.78 * this.lit);
      if (mat.emissive) mat.emissive.copy(this.litEmissive[i]).multiplyScalar(k);
    }
  }

  private snuffPuff(): void {
    if (!this.flameAnchor) return;
    this.model.updateWorldMatrix(true, false);
    this.flameAnchor.updateWorldMatrix(true, false);
    const p = new THREE.Vector3().setFromMatrixPosition(this.flameAnchor.matrixWorld);
    this.model.worldToLocal(p);
    this.smoke.forEach((puff, i) => {
      puff.age = -i * 0.07;
      puff.life = SMOKE_SECONDS;
      puff.mesh.position.set(p.x, p.y + 0.05, p.z);
      puff.vx = ((i % 3) - 1) * 0.12;
      puff.vy = 0.55 + (i % 2) * 0.2;
      puff.vz = (((i + 1) % 3) - 1) * 0.12;
      puff.size = 0.16 + 0.03 * i;
    });
  }

  private dustAt(x: number, z: number, index: number): void {
    // Two puffs per plank landing, from a small round-robin pool.
    for (let k = 0; k < 2; k++) {
      const puff = this.dust[(index * 2 + k) % this.dust.length];
      puff.age = 0;
      puff.life = DUST_SECONDS;
      puff.mesh.position.set(x + (k - 0.5) * 0.3, 0.12, z);
      const a = index * 1.7 + k * 3.1;
      puff.vx = Math.cos(a) * 0.5;
      puff.vy = 0.35;
      puff.vz = Math.sin(a) * 0.5;
      puff.size = 0.3 + 0.1 * k;
    }
  }

  private drivePuffs(dt: number, pool: Puff[]): void {
    for (const puff of pool) {
      if (puff.age >= puff.life) {
        if (puff.mesh.visible) puff.mesh.visible = false;
        continue;
      }
      puff.age += dt;
      if (puff.age < 0) continue;
      const u = Math.min(1, puff.age / puff.life);
      puff.mesh.visible = u < 1;
      puff.mesh.position.x += puff.vx * dt;
      puff.mesh.position.y += puff.vy * dt;
      puff.mesh.position.z += puff.vz * dt;
      puff.vy *= 1 - 0.9 * dt;
      puff.mesh.scale.setScalar(puff.size * (0.6 + 1.6 * u));
      puff.mat.opacity = 0.5 * (1 - u) * Math.min(1, u * 6);
    }
  }

  dispose(): void {
    for (const plank of this.planks) {
      plank.node.position.set(plank.rest.x, plank.rest.y, plank.rest.z);
      plank.node.quaternion.copy(plank.restQ);
    }
    this.pivot.rotation.copy(this.pivotRest);
    this.flame?.removeFromParent();
    this.flame = null;
    for (const puff of [...this.smoke, ...this.dust]) {
      puff.mesh.removeFromParent();
      puff.mat.dispose();
    }
    this.smoke = [];
    this.dust = [];
    for (const mat of this.glassMats) mat.dispose();
    this.glassMats = [];
  }
}
