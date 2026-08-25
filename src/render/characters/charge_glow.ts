// A fist lighting up before it lands.
//
// The cue a telegraphed slam is missing. A ground ring says WHERE the blow is going and
// the wind-up clip says one is coming, but neither says which hand, and on a boss whose
// whole kit is his hands that is the read a player actually wants: one fist glowing means
// the hammer is coming down on somebody, both means the ground is.
//
// It is parented to the rig's own hand bone rather than drawn in world space, so it tracks
// the fist through the authored clip for free: the wind-up raises the arm and the glow
// goes up with it, because it IS on the arm. The bones are already resolved at load time
// for the weapon-attach path (visual.ts looks up `handslot.r`/`R_Hand`), so this costs no
// new traversal.
//
// Declared as ClipMap data (`chargeGlowByAbility`) rather than wired per boss, so a second
// creature with a telegraphed slam gets the same treatment by adding a row.
import * as THREE from 'three';
import { type ChargeGlowSpec, chargeGlowIntensity, moteWorldSize } from './charge_glow_core';

const SEGMENTS = 12;
/** Particles per fist. Small: this rides on a bone and is seen from raid distance. */
const FIST_MOTES = 14;

/**
 * The particle shell that makes a charging fist read as CHARGING rather than as painted.
 *
 * Parented to the hand bone and animated in BONE-LOCAL space, which is the whole trick: the
 * motes orbit the fist for free through every frame of the authored swing, with no
 * per-frame world-space bookkeeping and nothing to keep in sync with the animation. A
 * world-space emitter would need the bone's matrix every frame and would still lag it.
 */
const TMP_SCALE = new THREE.Vector3();

function buildMoteShell(color: number, radius: number): THREE.Points {
  const pos = new Float32Array(FIST_MOTES * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size: radius * 0.85,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.visible = false;
  pts.renderOrder = 6;
  return pts;
}

/** Advance one shell: motes orbit and bob on their own phase, in the fist's own frame. */
function stepMoteShell(pts: THREE.Points, radius: number, clock: number, k: number): void {
  const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < FIST_MOTES; i++) {
    // Golden-angle phases so the shell never reads as a ring of evenly spaced dots.
    const phase = i * 2.399963229728653;
    const spin = clock * (1.1 + 0.35 * ((i % 5) / 5)) + phase;
    const bob = Math.sin(clock * 2.2 + phase) * 0.45;
    const r = radius * (1.05 + 0.5 * k) * (0.7 + 0.3 * Math.sin(phase * 3.1));
    arr[i * 3] = Math.cos(spin) * r;
    arr[i * 3 + 1] = bob * radius + Math.sin(phase) * radius * 0.5;
    arr[i * 3 + 2] = Math.sin(spin) * r;
  }
  attr.needsUpdate = true;
}

/** One hand's glow: a soft additive blob the bone carries. */
function buildBlob(color: number, radius: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, SEGMENTS, SEGMENTS);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.renderOrder = 5;
  return mesh;
}

/**
 * The per-visual charge-glow rig. One instance per character; inert until `ignite`.
 *
 * Holds its own meshes so a rig that never charges anything allocates nothing beyond this
 * object, and so the whole thing tears down with the visual it belongs to.
 */
export class ChargeGlow {
  private left: THREE.Mesh | null = null;
  private right: THREE.Mesh | null = null;
  private leftMotes: THREE.Points | null = null;
  private rightMotes: THREE.Points | null = null;
  private spec: ChargeGlowSpec | null = null;
  private age = 0;
  private clock = 0;

  constructor(
    private leftHand: THREE.Object3D | null,
    private rightHand: THREE.Object3D | null,
  ) {}

  /** True when this rig has a hand to hang a glow on at all. */
  usable(): boolean {
    return this.leftHand !== null || this.rightHand !== null;
  }

  ignite(spec: ChargeGlowSpec): void {
    this.spec = spec;
    this.age = 0;
    if (spec.hand !== 'r') {
      this.left = this.ensure(this.left, this.leftHand, spec);
      this.leftMotes = this.ensureMotes(this.leftMotes, this.leftHand, spec);
    }
    if (spec.hand !== 'l') {
      this.right = this.ensure(this.right, this.rightHand, spec);
      this.rightMotes = this.ensureMotes(this.rightMotes, this.rightHand, spec);
    }
    // A hand the spec did not name goes dark immediately, so a one-fisted wind-up after a
    // two-fisted one cannot leave the other hand lit from the previous mechanic.
    if (spec.hand === 'r') {
      this.hide(this.left);
      this.hideMotes(this.leftMotes);
    }
    if (spec.hand === 'l') {
      this.hide(this.right);
      this.hideMotes(this.rightMotes);
    }
  }

  update(dt: number): void {
    if (!this.spec) return;
    this.age += dt;
    this.clock += dt;
    const k = chargeGlowIntensity(this.spec, this.age);
    if (k <= 0) {
      this.hide(this.left);
      this.hide(this.right);
      this.hideMotes(this.leftMotes);
      this.hideMotes(this.rightMotes);
      this.spec = null;
      return;
    }
    this.apply(this.left, k);
    this.apply(this.right, k);
    for (const shell of [this.leftMotes, this.rightMotes]) {
      if (!shell || !this.spec) continue;
      shell.visible = true;
      stepMoteShell(shell, this.spec.radius, this.clock, k);
      (shell.material as THREE.PointsMaterial).opacity = 0.9 * k;
    }
  }

  private ensureMotes(
    existing: THREE.Points | null,
    bone: THREE.Object3D | null,
    spec: ChargeGlowSpec,
  ): THREE.Points | null {
    if (!bone) return existing;
    const pts = existing ?? buildMoteShell(spec.color, spec.radius);
    if (!existing) bone.add(pts);
    const mat = pts.material as THREE.PointsMaterial;
    mat.color.setHex(spec.color);
    // Re-measured on every ignite rather than cached: the bone's world scale is the entity's
    // scale, and a rift spawn re-grades that per instance.
    bone.updateWorldMatrix(true, false);
    mat.size = moteWorldSize(spec.radius, bone.getWorldScale(TMP_SCALE).x);
    return pts;
  }

  private hideMotes(pts: THREE.Points | null): void {
    if (!pts) return;
    pts.visible = false;
    (pts.material as THREE.PointsMaterial).opacity = 0;
  }

  private ensure(
    existing: THREE.Mesh | null,
    bone: THREE.Object3D | null,
    spec: ChargeGlowSpec,
  ): THREE.Mesh | null {
    if (!bone) return existing;
    const mesh = existing ?? buildBlob(spec.color, 1);
    if (!existing) bone.add(mesh);
    // Scale rather than rebuild: the spec's radius can differ per ability, and rebuilding
    // geometry mid-fight would allocate on exactly the frames that matter most.
    mesh.scale.setScalar(spec.radius);
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(spec.color);
    return mesh;
  }

  private apply(mesh: THREE.Mesh | null, k: number): void {
    if (!mesh) return;
    mesh.visible = true;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    // 0.55 rather than near-opaque: this is additive, so it already reads far brighter
    // than its alpha suggests, and at full strength it stops looking like light coming
    // OFF a fist and starts looking like a ball held in one.
    mat.opacity = 0.55 * k;
  }

  private hide(mesh: THREE.Mesh | null): void {
    if (!mesh) return;
    mesh.visible = false;
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  dispose(): void {
    for (const pts of [this.leftMotes, this.rightMotes]) {
      if (!pts) continue;
      pts.removeFromParent();
      pts.geometry.dispose();
      (pts.material as THREE.Material).dispose();
    }
    this.leftMotes = null;
    this.rightMotes = null;
    for (const mesh of [this.left, this.right]) {
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.left = null;
    this.right = null;
    this.spec = null;
  }
}
