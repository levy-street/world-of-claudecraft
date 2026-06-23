// Procedural $WOC holder travel-mount visual.
//
// The character rigs are all GLB-loaded, but there is no mount GLB asset; in the
// project's procedural-everything spirit we build the steed from primitives at
// runtime — a stylized low-poly creature parented under the rider's entity group
// (so it inherits the entity's world position + facing for free). The renderer
// attaches one when an entity's `mountId` is set and removes it on dismount.
//
// Per-tier escalation is read from the sim MountDef (src/sim/content/mounts.ts):
// body tint, a size bump, barding/horns/spine-crest/glow that grow up the ladder,
// and — for the 5%-of-supply rungs and up (`flying`) — a pair of animated wings,
// tucked legs and a hover bob. The 10% Sovereign is a one-off dreadwyrm: a winged,
// horned, spine-crested dragon with a strong gold glow.
import * as THREE from 'three';
import { surfaceMat } from '../gfx';
import { MOUNTS, type MountDef } from '../../sim/content/mounts';

// Diagonal gait pairs (trot): front-left + back-right swing together, the other
// diagonal opposite. Indices into the leg array [FL, FR, BL, BR].
const LEG_PHASE = [0, Math.PI, Math.PI, 0];
// Local layout (pre-scale), in yards. Tuned so the rider sits astride naturally.
const HIP_Y = 0.78;
const LEG_LEN = 0.7;
const BODY_CENTER_Y = 0.96;
const BODY_H = 0.6;
const BODY_W = 0.56;
const BODY_L = 1.6;

function shade(hex: number, factor: number): number {
  const c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  c.r = Math.min(1, c.r); c.g = Math.min(1, c.g); c.b = Math.min(1, c.b);
  return c.getHex();
}

export class MountVisual {
  readonly root = new THREE.Group();
  /** Y offset to raise the rider rig onto the saddle (already scaled). */
  readonly riderLift: number;
  private readonly bodyGroup = new THREE.Group();
  private readonly legPivots: THREE.Group[] = [];
  private readonly wings: THREE.Group[] = []; // [left, right] for flyers
  private readonly geoms: THREE.BufferGeometry[] = [];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly flying: boolean;
  private readonly dragon: boolean;
  private phase = 0;

  constructor(def: MountDef) {
    this.flying = def.flying;
    this.dragon = def.tier === 11;
    const scale = 1 + (def.tier - 1) * 0.016; // subtle grandeur up the ladder
    this.root.scale.setScalar(scale);
    this.riderLift = (BODY_CENTER_Y - 0.06) * scale;
    this.root.add(this.bodyGroup);

    const bodyMat = surfaceMat({ color: def.tint, roughness: 0.7, flatShading: true });
    const maneMat = surfaceMat({ color: shade(def.tint, 0.6), roughness: 0.82, flatShading: true });
    const hoofMat = surfaceMat({ color: 0x1c160f, roughness: 0.55, flatShading: true });
    // Barding/horns: a precious accent that brightens + gains metalness up-ladder;
    // the top rungs glow so whales literally shine, the dragon brightest of all.
    const accentMetal = Math.min(0.85, 0.12 + def.tier * 0.06);
    const glow = this.dragon ? 0.9 : def.tier >= 9 ? (def.tier - 7) * 0.16 : 0;
    const accentMat = surfaceMat({
      color: shade(def.tint, 1.3), roughness: 0.35, metalness: accentMetal,
      emissive: glow > 0 ? def.tint : 0x000000, emissiveIntensity: glow, flatShading: true,
    });
    const glowMat = surfaceMat({
      color: shade(def.tint, 1.4), roughness: 0.4, flatShading: true,
      emissive: def.tint, emissiveIntensity: this.flying ? 0.6 : 0.25,
    });
    const membraneMat = surfaceMat({
      color: shade(def.tint, this.dragon ? 0.9 : 1.05), roughness: 0.5, flatShading: true,
      emissive: def.tint, emissiveIntensity: this.dragon ? 0.5 : 0.28, side: THREE.DoubleSide,
    });

    // Geometry helpers — both create the mesh, register it for shadow/disposal,
    // AND add it to bodyGroup. Sub-groups (legs, wings) re-parent the returned
    // mesh via group.add(), which moves it out of bodyGroup automatically.
    const mesh = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const g = new THREE.BoxGeometry(w, h, d);
      this.geoms.push(g);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.meshes.push(m);
      this.bodyGroup.add(m);
      return m;
    };
    const cone = (r: number, h: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const g = new THREE.ConeGeometry(r, h, 6);
      this.geoms.push(g);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.meshes.push(m);
      this.bodyGroup.add(m);
      return m;
    };

    // --- barrel + chest + haunch (the dragon's barrel is leaner/longer) --------
    const len = this.dragon ? BODY_L * 1.12 : BODY_L;
    mesh(BODY_W, BODY_H, len, bodyMat, 0, BODY_CENTER_Y, 0);
    mesh(BODY_W * 0.9, BODY_H * 0.88, 0.3, bodyMat, 0, BODY_CENTER_Y + 0.02, len / 2);
    mesh(BODY_W * 1.04, BODY_H * 1.04, 0.34, bodyMat, 0, BODY_CENTER_Y + 0.04, -len / 2);

    // --- neck + head (dragon: longer reaching neck, broader horned skull) ------
    const neck = mesh(0.34, this.dragon ? 0.8 : 0.62, 0.34, bodyMat, 0, BODY_CENTER_Y + (this.dragon ? 0.52 : 0.42), len / 2 + 0.12);
    neck.rotation.x = this.dragon ? -0.65 : -0.55;
    const headY = BODY_CENTER_Y + (this.dragon ? 0.95 : 0.78);
    const headZ = len / 2 + (this.dragon ? 0.5 : 0.42);
    const head = mesh(this.dragon ? 0.38 : 0.3, this.dragon ? 0.4 : 0.34, this.dragon ? 0.66 : 0.6, bodyMat, 0, headY, headZ);
    head.rotation.x = -0.2;
    mesh(0.22, 0.16, this.dragon ? 0.4 : 0.34, bodyMat, 0, headY - 0.12, headZ + 0.42); // snout/jaw
    mesh(0.06, 0.06, 0.06, glowMat, -0.11, headY + 0.06, headZ + 0.22); // eyes
    mesh(0.06, 0.06, 0.06, glowMat, 0.11, headY + 0.06, headZ + 0.22);

    // ears (lower tiers) → horns (tier 4+ / flyers) → swept dragon horns
    if (def.tier >= 4 || this.flying) {
      const hr = this.dragon ? 0.1 : 0.07;
      const hh = this.dragon ? 0.5 : def.tier >= 7 ? 0.34 : 0.24;
      const hl = cone(hr, hh, accentMat, -0.13, headY + 0.18, headZ - 0.02);
      const hrr = cone(hr, hh, accentMat, 0.13, headY + 0.18, headZ - 0.02);
      hl.rotation.set(-0.5, 0, 0.3);
      hrr.rotation.set(-0.5, 0, -0.3);
    } else {
      mesh(0.08, 0.16, 0.06, maneMat, -0.1, headY + 0.16, headZ - 0.08);
      mesh(0.08, 0.16, 0.06, maneMat, 0.1, headY + 0.16, headZ - 0.08);
    }
    mesh(0.1, this.dragon ? 0.6 : 0.5, 0.32, maneMat, 0, BODY_CENTER_Y + 0.5, len / 2 - 0.02); // mane

    // --- spine crest: a row of accent spikes (tier 7+ / the dragon) ------------
    if (this.dragon || def.tier >= 7) {
      const n = this.dragon ? 6 : 4;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const sz = (this.dragon ? 0.26 : 0.16) * (1 - 0.4 * Math.abs(t - 0.4));
        const spike = cone(0.06, sz, accentMat, 0, BODY_CENTER_Y + BODY_H / 2 + sz / 2, len / 2 - 0.25 - t * (len - 0.5));
        spike.rotation.x = -0.15;
      }
    }

    // --- tail: flowing mane tail, or a spiked dragon tail ----------------------
    if (this.dragon) {
      const tail = mesh(0.14, 0.14, 0.7, bodyMat, 0, BODY_CENTER_Y - 0.02, -len / 2 - 0.32);
      tail.rotation.x = 0.35;
      cone(0.12, 0.34, accentMat, 0, BODY_CENTER_Y + 0.06, -len / 2 - 0.66); // tail barb
    } else {
      const tail = mesh(0.12, 0.5, 0.14, maneMat, 0, BODY_CENTER_Y + 0.1, -len / 2 - 0.12);
      tail.rotation.x = 0.5;
    }

    // --- barding: saddle + chest plate, flank plates from tier 5 ---------------
    mesh(BODY_W + 0.06, 0.14, 0.66, accentMat, 0, BODY_CENTER_Y + BODY_H / 2 + 0.04, -0.05);
    mesh(BODY_W + 0.04, 0.3, 0.1, accentMat, 0, BODY_CENTER_Y + 0.02, len / 2 + 0.13);
    if (def.tier >= 5) {
      mesh(0.06, 0.34, 0.6, accentMat, BODY_W / 2 + 0.02, BODY_CENTER_Y - 0.04, 0);
      mesh(0.06, 0.34, 0.6, accentMat, -BODY_W / 2 - 0.02, BODY_CENTER_Y - 0.04, 0);
    }

    // --- four legs on hip pivots so they swing (or tuck, while flying) ---------
    const legX = BODY_W / 2 - 0.04;
    const legZ = len / 2 - 0.28;
    for (const [x, z] of [[legX, legZ], [-legX, legZ], [legX, -legZ], [-legX, -legZ]] as [number, number][]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, HIP_Y, z);
      this.bodyGroup.add(pivot);
      pivot.add(mesh(0.16, LEG_LEN, 0.18, bodyMat, 0, -LEG_LEN / 2, 0));     // re-parents leg
      pivot.add(mesh(0.2, 0.12, 0.22, hoofMat, 0, -LEG_LEN - 0.02, 0.01));   // re-parents hoof
      this.legPivots.push(pivot);
    }

    // --- wings (flyers only): a flapping membrane on each flank ----------------
    if (this.flying) {
      const span = this.dragon ? 2.1 : 1.6;
      const chord = this.dragon ? 1.0 : 0.8;
      for (const side of [-1, 1]) {
        const wing = new THREE.Group();
        wing.position.set(side * (BODY_W / 2 - 0.02), BODY_CENTER_Y + 0.3, 0.05);
        this.bodyGroup.add(wing);
        const spar = mesh(span, 0.07, 0.09, accentMat, side * span / 2, 0.02, 0.04);
        spar.rotation.y = side * 0.2;
        wing.add(spar); // re-parents into the flapping group
        const panels = 3;
        for (let i = 0; i < panels; i++) {
          const t = (i + 0.5) / panels;
          const w = span / panels;
          const h = chord * (1 - 0.5 * t);
          const panel = mesh(w, 0.04, h, membraneMat, side * (w * (i + 0.5)), 0, -0.12 - t * 0.5);
          panel.rotation.y = side * (0.16 + t * 0.22);
          wing.add(panel);
        }
        if (this.dragon) {
          const claw = cone(0.09, 0.4, accentMat, side * (span - 0.1), 0.04, -0.12);
          claw.rotation.z = side * 0.7;
          wing.add(claw);
        }
        this.wings.push(wing);
      }
    }
  }

  /** Advance the animation. `speed` is the rider's world u/s. Ground steeds gait
   *  and bob; flyers flap their wings, tuck their legs, and hover-bob. */
  update(dt: number, speed: number): void {
    if (this.flying) {
      this.phase += dt * 4.2; // wingbeat cadence
      const beat = Math.sin(this.phase);
      for (let i = 0; i < this.wings.length; i++) {
        const side = i === 0 ? -1 : 1;
        this.wings[i].rotation.z = side * (0.35 + beat * 0.55); // dihedral + flap
        this.wings[i].rotation.x = beat * 0.12;
      }
      for (let i = 0; i < this.legPivots.length; i++) this.legPivots[i].rotation.x = 0.9; // tucked
      this.bodyGroup.position.y = Math.sin(this.phase * 0.5) * 0.06; // hover bob
      this.bodyGroup.rotation.x = -0.04 + beat * 0.02;
      return;
    }
    const norm = Math.min(1, speed / 9);
    this.phase += dt * (3 + norm * 9);
    const swing = 0.12 + norm * 0.5;
    for (let i = 0; i < this.legPivots.length; i++) {
      this.legPivots[i].rotation.x = Math.sin(this.phase + LEG_PHASE[i]) * swing;
    }
    this.bodyGroup.position.y = Math.abs(Math.sin(this.phase)) * 0.04 * norm;
    this.bodyGroup.rotation.x = -norm * 0.05;
  }

  setShadow(on: boolean): void {
    for (const m of this.meshes) m.castShadow = on;
  }

  /** Release this clone's geometries (materials are shared via surfaceMat and are
   *  never disposed). Call on dismount / view removal. */
  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const g of this.geoms) g.dispose();
    this.geoms.length = 0;
  }
}

/** Build the steed for a mount id, or null for an unknown id. */
export function createMountVisual(mountId: string): MountVisual | null {
  const def: MountDef | undefined = MOUNTS[mountId];
  return def ? new MountVisual(def) : null;
}
