// The Thornhollow Fields WARDS: the two translucent barriers a player is meant
// to read rather than discover by walking into them.
//
//   the gate ward   spans each keep mouth during the form-up countdown. The sim
//                   already refuses to let a fighter out (social/battleground.ts
//                   sets them back with "The gates open when the battle
//                   begins"), but an invisible refusal reads as a bug; this is
//                   the wall that message is about.
//   the grave ward  rings each team's graveyard plot while its owner is waiting
//                   there as a spirit, so the wave respawn reads as a place you
//                   are held rather than a place you happen to be standing.
//
// Both are pure silhouette: no collision (the plan owns every footprint), no
// point light, and no per-frame CPU. The shimmer runs entirely in the vertex
// and fragment shaders off the shared clock, so the whole set costs two draws
// and a visibility flag per frame. Tier-safe: nothing here hides or delays
// anything a player acts on, it only draws a rule that already exists.

import * as THREE from 'three';
import {
  BG_BASES,
  BG_GRAVEYARDS,
  BG_TEAM_COLORS,
  KEEP_HALF_X,
  KEEP_MOUTH_DZ,
} from '../sim/battleground_layout';
import { sharedUniforms } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

/** How tall the gate ward stands. Above the keep wall's own crown would read as
 *  a dome; this stops just under it so the ward reads as filling the doorway. */
const GATE_WARD_H = 6.2;
/**
 * How far INSIDE the keep's own half-width the ward stops. The mouth is not the
 * full keep width: a gate drum stands at each end of it (dressing.mjs, scale
 * 1.55 at x = +-KEEP_HALF_X, centred on this very plane), so a ward built to
 * the full span buries its outer yards inside both towers and lights them up
 * from within. It has to end short of the drums, in the clear doorway.
 */
const GATE_WARD_INSET = 2.4;
/** The grave ward's height and how far it stands off the plot's rails. */
const GRAVE_WARD_H = 3.4;
const GRAVE_WARD_PAD = 0.5;

const WARD_VERTEX = `
  varying vec2 vUv;
  varying vec3 vLocal;
  void main() {
    vUv = uv;
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A slow vertical drift of banded light with a soft top and bottom fade, so the
// sheet reads as a held ward rather than a pane of glass.
const WARD_FRAGMENT = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uGlow;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    // Narrow travelling bands rather than a broad glow: at the range a player
    // actually meets this thing (a few yards) a soft wash just fogs the view,
    // while banding still reads as a held barrier without hiding the field
    // behind it. Nothing actionable is behind it during the form-up anyway.
    float bands = pow(max(0.5 + 0.5 * sin((vUv.y * 26.0) - uTime * 2.2), 0.0), 3.0);
    float drift = 0.5 + 0.5 * sin((vUv.x * 7.0) + uTime * 0.9);
    // Fade on ALL FOUR edges, so the sheet has visible bounds at the jambs and
    // never reads as an infinite fog plane filling the view.
    float edgeY = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
    float edgeX = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
    // A brighter seam right at the threshold line the player is being held at.
    float seam = smoothstep(0.12, 0.0, abs(vUv.y - 0.06));
    // A solid-ish veil with brighter bands travelling through it: the veil is
    // what makes the barrier read at a glance, the bands are what make it read
    // as held rather than as a pane of glass.
    float band = bands * drift;
    float body = edgeY * (0.55 + 0.45 * band) + 0.6 * seam;
    float a = uAlpha * edgeX * clamp(body, 0.0, 1.0);
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uColor, uGlow, band * 0.7 + seam * 0.5), a);
  }
`;

/**
 * A ward reads DARKER than the stone behind it, never brighter. Additive
 * blending was the first cut and it washed pale grey masonry out instead of
 * veiling it, which made the barrier hard to see precisely where it mattered.
 * Normal blending over a deepened team colour gives it body.
 */
function wardMaterial(color: number, alpha: number): THREE.ShaderMaterial {
  const deep = new THREE.Color(color).multiplyScalar(0.45);
  return markSharedMaterial(
    new THREE.ShaderMaterial({
      vertexShader: WARD_VERTEX,
      fragmentShader: WARD_FRAGMENT,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uColor: { value: deep },
        uGlow: { value: new THREE.Color(color) },
        uAlpha: { value: alpha },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    }),
  ) as THREE.ShaderMaterial;
}

export interface BgWardState {
  /** The form-up gate is up: the keeps are shut. */
  countdown: boolean;
  /** The local player is waiting as a spirit, so their plot is warded. */
  ghost: boolean;
  /** Which plot to ward; null wards neither. */
  myTeam: number | null;
}

export interface BgWardView {
  group: THREE.Group;
  setState(state: BgWardState): void;
  dispose(): void;
}

/** Build both wards for one field copy, hidden until a state turns them on. */
export function buildBgWards(): BgWardView {
  const group = new THREE.Group();
  group.name = 'battleground-wards';
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];

  // --- the gate wards: one sheet across each keep mouth ----------------------
  const gateW = (KEEP_HALF_X - GATE_WARD_INSET) * 2;
  const gateGeo = markSharedGeometry(new THREE.PlaneGeometry(gateW, GATE_WARD_H));
  owned.push(gateGeo);
  const gates: THREE.Mesh[] = [];
  for (const base of BG_BASES) {
    const mat = wardMaterial(BG_TEAM_COLORS[base.team], 0.72);
    owned.push(mat);
    const mesh = new THREE.Mesh(gateGeo, mat);
    // The mouth line: KEEP_MOUTH_DZ field-side of the flag stand.
    const mouthZ = base.flag.z + (base.team === 0 ? KEEP_MOUTH_DZ : -KEEP_MOUTH_DZ);
    mesh.position.set(base.flag.x, GATE_WARD_H / 2, mouthZ);
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    gates.push(mesh);
    group.add(mesh);
  }

  // --- the grave wards: a ring standing around each plot ---------------------
  const graves: THREE.Mesh[] = [];
  for (const [team, plot] of BG_GRAVEYARDS.entries()) {
    // Open-ended so it reads as a curtain around the yard, not a capsule.
    const r = Math.max(plot.hw, plot.hd) + GRAVE_WARD_PAD;
    const geo = markSharedGeometry(new THREE.CylinderGeometry(r, r, GRAVE_WARD_H, 20, 1, true));
    const mat = wardMaterial(BG_TEAM_COLORS[team], 0.5);
    owned.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(plot.x, GRAVE_WARD_H / 2, plot.z);
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    graves.push(mesh);
    group.add(mesh);
  }

  return {
    group,
    setState(state: BgWardState): void {
      // Both keeps are shut during the form-up, not just yours: the ward is a
      // statement about the match, and seeing the enemy keep held too is what
      // makes the countdown read as a start line rather than a personal wall.
      for (const g of gates) g.visible = state.countdown;
      for (let team = 0; team < graves.length; team++) {
        graves[team].visible = state.ghost && state.myTeam === team;
      }
    },
    dispose(): void {
      group.removeFromParent();
      for (const o of owned) o.dispose();
      group.clear();
    },
  };
}
