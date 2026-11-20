// Each isle's Closing Storm and Sky's Reckoning (encounters/smith_heart/
// breath_isles.ts), a part of BreathIslesFx (looks: breath_isle_phase_core.ts):
//
//  - the Closing Storm (`closingTemplate`: the isle, the whole seconds left,
//    its whole), drawn on the isle's OWN rim shape (its bays and tongues,
//    the sim's floor): a ring on the floor closing from the rim toward the
//    middle over the timer (smoothed between the sim's whole-second updates),
//    the stone beyond it shaded under the storm, and a wall of torn storm
//    cloud standing on the ring, growing taller and darker as it closes, its
//    colour turning from white blue to angry violet near the end and its
//    foot throbbing faster in the last ten seconds;
//  - Sky's Reckoning (ISLE_CUES.reckoning, when the ring runs out): the storm
//    breaks over that isle: bolts from the sky onto the stone, a flash, rings
//    racing out, a shake; the wall then flickers with lightning while the
//    strikes keep falling (their telegraphs are the fight's own strikes).
// On EVERY tier (the raid reads its time off it); only sparks thin on the
// low tier. The floor ring rides the floor ladder (encounter band). Built
// in the constructor (its one gated attach through the host's root); one
// floor and one wall draw per isle, fixed pools, no per-frame allocation.

import * as THREE from 'three';
import { BREATH_ISLES } from '../../sim/content/smith_heart_layout';
import type { Entity } from '../../sim/types';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { BreathEntranceBolts } from './breath_entrance_bolts';
import {
  type ClosingLook,
  closingLook,
  closingParts,
  PHASE_COLORS as PC,
  phaseHash,
  RECKONING_SECONDS,
  reckoningBolts,
  stepClosingClock,
} from './breath_isle_phase_core';
import {
  CLOSING_FLOOR_FRAG,
  CLOSING_FLOOR_VERT,
  CLOSING_WALL_FRAG,
  CLOSING_WALL_VERT,
} from './breath_isle_phase_glsl';
import type { BreathIslesHost } from './breath_isles_fx';
import { isleRimAt } from './breath_isles_fx_core';

/** Bearings round the ring, and the floor's rings (shares of the rim). */
const ANGLES = 96;
const FLOOR_RINGS = [0, 0.2, 0.4, 0.55, 0.68, 0.78, 0.86, 0.92, 0.97, 1.0, 1.03];
const WALL_ROWS = [0, 0.12, 0.3, 0.55, 0.8, 1];

interface StormSlot {
  floor: THREE.Mesh;
  floorMat: THREE.ShaderMaterial;
  wall: THREE.Mesh;
  wallMat: THREE.ShaderMaterial;
  /** The object's id (-1: none), its whole seconds left and its whole. */
  id: number;
  left: number;
  whole: number;
  /** The smooth clock, the shown strength (fading in and out). */
  rem: number;
  shown: number;
  /** When its Reckoning broke (NaN: not yet). */
  reckonAt: number;
}

const _look: ClosingLook = { k: 1, late: 0, violet: 0, wall: 0, dark: 0, throb: 0 };
const _calm = new THREE.Color(PC.calm);
const _angry = new THREE.Color(PC.angry);
const _shade = new THREE.Color(PC.storm);

export class BreathIsleStormFx {
  private readonly slots: StormSlot[] = [];
  private readonly bolts: BreathEntranceBolts;
  private readonly seen: number[] = [];
  private clock = 0;

  constructor(
    private readonly h: BreathIslesHost,
    isles: readonly THREE.Group[],
  ) {
    BREATH_ISLES.forEach((_, i) => {
      // The rim at each bearing (the sim's own floor, this isle's turn).
      const rim = new Float32Array(ANGLES + 1);
      for (let a = 0; a <= ANGLES; a++) rim[a] = isleRimAt(i, (a / ANGLES) * Math.PI * 2) + 0.2;
      // The floor: a disc of rings, each vertex a unit bearing times its share.
      const fp: number[] = [];
      const fr: number[] = [];
      const fi: number[] = [];
      for (let r = 0; r < FLOOR_RINGS.length; r++)
        for (let a = 0; a <= ANGLES; a++) {
          const b = (a / ANGLES) * Math.PI * 2;
          const s = FLOOR_RINGS[r];
          fp.push(Math.sin(b) * s, 0.09, Math.cos(b) * s);
          fr.push(rim[a]);
          if (r > 0 && a < ANGLES) {
            const p = (r - 1) * (ANGLES + 1) + a;
            const q = r * (ANGLES + 1) + a;
            fi.push(p, q, p + 1, p + 1, q, q + 1);
          }
        }
      const floorGeo = new THREE.BufferGeometry();
      floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
      floorGeo.setAttribute('aRim', new THREE.Float32BufferAttribute(fr, 1));
      floorGeo.setIndex(fi);
      floorGeo.computeBoundingSphere();
      h.geometries.push(floorGeo);
      const floorMat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathClosingFloor',
        uniforms: {
          uTime: h.uTime,
          uK: { value: 1 },
          uColor: { value: new THREE.Color(PC.calm) },
          uShade: { value: new THREE.Color(PC.storm) },
          uDark: { value: 0 },
          uThrob: { value: 0 },
        },
        vertexShader: CLOSING_FLOOR_VERT,
        fragmentShader: CLOSING_FLOOR_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      h.materials.push(floorMat);
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.name = 'smithHeartBreathClosingFloor';
      floor.renderOrder = floorVfxRenderOrder('encounter', 7);
      floor.frustumCulled = false;
      floor.visible = false;
      isles[i].add(floor);
      // The wall: a band of rows standing on the ring (scaled in its shader).
      const wp: number[] = [];
      const wr: number[] = [];
      const wu: number[] = [];
      const wi: number[] = [];
      for (let r = 0; r < WALL_ROWS.length; r++)
        for (let a = 0; a <= ANGLES; a++) {
          const b = (a / ANGLES) * Math.PI * 2;
          wp.push(Math.sin(b), WALL_ROWS[r], Math.cos(b));
          wr.push(rim[a]);
          wu.push(a / ANGLES, WALL_ROWS[r]);
          if (r > 0 && a < ANGLES) {
            const p = (r - 1) * (ANGLES + 1) + a;
            const q = r * (ANGLES + 1) + a;
            wi.push(p, q, p + 1, p + 1, q, q + 1);
          }
        }
      const wallGeo = new THREE.BufferGeometry();
      wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
      wallGeo.setAttribute('aRim', new THREE.Float32BufferAttribute(wr, 1));
      wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
      wallGeo.setIndex(wi);
      h.geometries.push(wallGeo);
      const wallMat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathClosingWall',
        uniforms: {
          uTime: h.uTime,
          uK: { value: 1 },
          uH: { value: 3 },
          uColor: { value: new THREE.Color(PC.calm) },
          uShade: { value: new THREE.Color(PC.storm) },
          uDark: { value: 0 },
          uThrob: { value: 0 },
          uFlash: { value: 0 },
        },
        vertexShader: CLOSING_WALL_VERT,
        fragmentShader: CLOSING_WALL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      h.materials.push(wallMat);
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.name = 'smithHeartBreathClosingWall';
      wall.frustumCulled = false;
      wall.visible = false;
      isles[i].add(wall);
      this.slots.push({
        floor,
        floorMat,
        wall,
        wallMat,
        id: -1,
        left: 0,
        whole: 1,
        rem: Number.NaN,
        shown: 0,
        reckonAt: Number.NaN,
      });
    });
    this.bolts = new BreathEntranceBolts(h.root, h);
  }

  beginScan(): void {
    this.seen.length = 0;
  }

  /** A Closing Storm object (true: this part's). */
  takeObject(e: Entity): boolean {
    const c = closingParts(e.templateId);
    if (!c) return false;
    const s = this.slots[c.isle];
    if (s.id !== e.id) {
      s.id = e.id;
      s.rem = c.left;
      s.reckonAt = Number.NaN;
    }
    s.left = c.left;
    s.whole = c.whole;
    this.seen.push(c.isle);
    return true;
  }

  endScan(): void {
    this.slots.forEach((s, i) => {
      if (s.id >= 0 && !this.seen.includes(i)) s.id = -1;
    });
  }

  /** Sky's Reckoning broke over the isle under (x, z) (world). */
  reckoning(x: number, z: number): void {
    const o = this.h.local.position;
    let best = -1;
    let bestD = 1e9;
    BREATH_ISLES.forEach((isle, i) => {
      const d = Math.hypot(x - o.x - isle.x, z - o.z - isle.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0 || bestD > 30) return;
    const s = this.slots[best];
    s.reckonAt = this.clock;
    const isle = BREATH_ISLES[best];
    const p = this.h.particles;
    p.shockRing(x, z, PC.angry, isle.r * 2.2, 1.0, { wake: 0.7, crest: 0.1, strength: 1.1 });
    p.shockRing(x, z, 0xffffff, isle.r * 1.4, 0.6);
    this.h.shakeNear(x, z, 0.45, 40);
  }

  update(isles: readonly THREE.Group[], dt: number): void {
    this.clock += dt;
    const t = this.h.uTime.value;
    this.bolts.begin();
    const o = this.h.local.position;
    this.slots.forEach((s, i) => {
      const live = s.id >= 0;
      s.shown += ((live ? 1 : 0) - s.shown) * Math.min(1, dt * (live ? 3 : 1.4));
      if (s.shown < 0.01 && !live) {
        if (s.floor.visible) {
          s.floor.visible = false;
          s.wall.visible = false;
          s.rem = Number.NaN;
        }
        return;
      }
      if (live) s.rem = stepClosingClock(s.rem, s.left, dt);
      const L = closingLook(Number.isNaN(s.rem) ? 0 : s.rem, s.whole, t, _look);
      s.floor.visible = true;
      s.wall.visible = true;
      const fu = s.floorMat.uniforms;
      const wu = s.wallMat.uniforms;
      (fu.uColor.value as THREE.Color).copy(_calm).lerp(_angry, L.violet);
      (wu.uColor.value as THREE.Color).copy(_calm).lerp(_angry, L.violet);
      (fu.uShade.value as THREE.Color).copy(_shade);
      fu.uK.value = L.k;
      fu.uDark.value = L.dark * s.shown;
      fu.uThrob.value = L.throb;
      wu.uK.value = L.k;
      wu.uH.value = L.wall * s.shown;
      wu.uDark.value = L.dark * s.shown;
      wu.uThrob.value = L.throb;
      // Out: the storm rages over the isle (lightning in its wall).
      const out = live && s.left <= 0;
      const age = this.clock - s.reckonAt;
      const breaking = !Number.isNaN(s.reckonAt) && age < RECKONING_SECONDS;
      wu.uFlash.value = breaking ? 1 : out ? 0.6 : L.late > 0.8 ? 0.25 : 0;
      // The break: bolts from the sky onto the isle.
      if (breaking) {
        const g = isles[i].position;
        const n = reckoningBolts(age);
        const step = Math.floor(age * 16);
        const isle = BREATH_ISLES[i];
        for (let k = 0; k < n; k++) {
          const a = phaseHash(k, step + i * 31) * Math.PI * 2;
          const r = isle.r * 0.9 * Math.sqrt(phaseHash(k + 7, step));
          const x = o.x + g.x + Math.sin(a) * r;
          const z = o.z + g.z + Math.cos(a) * r;
          const y = o.y + g.y;
          this.bolts.draw(step * 11 + k, x + (k - 2) * 2, y + 42, z, x, y + 0.2, z, 0.16, 1.3, 1.5);
          if (k < 2) this.bolts.glow(x, y + 0.6, z, 6, 0.75, 0.55, 1);
          if (this.rand(k, step) < 0.4 * this.h.density)
            this.h.particles.puff(x, y + 0.3, z, 4, {
              speed: 7,
              life: 0.6,
              size: [0.6, 0.12],
              color: [0.85, 0.75, 1],
              alpha: 1,
              pool: 'glow',
              spread: 1,
            });
        }
      } else if (out && phaseHash(i, Math.floor(t * 3)) > 0.7) {
        // Still raging: a lone bolt into the wall now and then.
        const g = isles[i].position;
        const isle = BREATH_ISLES[i];
        const step = Math.floor(t * 3);
        const a = phaseHash(i + 5, step) * Math.PI * 2;
        const r = isleRimAt(i, a) * L.k;
        const x = o.x + g.x + Math.sin(a) * r;
        const z = o.z + g.z + Math.cos(a) * r;
        this.bolts.draw(step * 5 + i, x, o.y + g.y + 30, z, x, o.y + g.y + 0.2, z, 0.18, 0.8, 0.8);
        void isle;
      }
    });
    this.bolts.end();
  }

  /** A storm's smooth clock for isle `i` (NaN: none; the tests read it). */
  remaining(i: number): number {
    return this.slots[i]?.rem ?? Number.NaN;
  }

  leave(): void {
    for (const s of this.slots) {
      s.id = -1;
      s.shown = 0;
      s.rem = Number.NaN;
      s.reckonAt = Number.NaN;
      s.floor.visible = false;
      s.wall.visible = false;
    }
    this.bolts.hide();
  }

  private rand(a: number, b: number): number {
    return phaseHash(a + 101, b + 7);
  }
}
