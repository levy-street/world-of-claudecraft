// The Gale Crossing's look (encounters/smith_heart/breath_crossing.ts; pure
// look: breath_crossing_fx_core.ts), a part of BreathIslesFx. The owner's
// playtest of 2026-11-25: the Storm Cornice stands a chasm forward of the
// climb's landing, and a road of wind carries the raid over.
//
//  - on EVERY tier (the raid acts on it): each pad an Updraft like the
//    isles' (a wheeling wind disc on the floor, a column of wind over it with
//    two ribbons spiralling up round a bright core), and from it the road of
//    wind over the chasm, drawn along the ride's own arc: a bright core of
//    two crossed ribbons flowing toward where it sets you down, and strands
//    of wind wound round it in a helix (the current a body rides inside).
//    The landing's road is the wind's pale cyan; the road home, up only while
//    the guardian is not fighting, the isles' homeward gold;
//  - cosmetic (thinned on the low tier): motes streaming along the road and
//    up the columns.
//
// Built in the constructor under the host's local group (its one gated
// attach); fixed meshes, no light, no per-frame allocation. The rider's own
// look (the funnel at the launch, the ribbons round the body, the landing's
// downdraft) is the isles' ride (breath_ride_fx.ts): the crossing wears its
// aura and cues.

import * as THREE from 'three';
import { CORNICE_CROSSING } from '../../sim/content/smith_heart_layout';
import { CROSSING_OBJECTS } from '../../sim/encounters/smith_heart/breath_crossing_ids';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  CROSSING_LOOK,
  type CrossingPoint,
  crossingRoads,
  crossingStrand,
} from './breath_crossing_fx_core';
import { CORNICE_FLOOR_H } from './breath_fight_fx_core';
import type { BreathIslesHost } from './breath_isles_fx';
import { ISLE_COLORS as C, ISLE_RGB as RGB } from './breath_isles_fx_core';
import {
  ISLE_COLUMN_FRAG,
  ISLE_DISC_FRAG,
  ISLE_RIBBON_FRAG,
  ISLE_UV_VERT,
} from './breath_isles_glsl';
import { ribbonGeometry } from './breath_ride_fx';

/** A pad's column height (yards): it reads from across the chasm. */
const COLUMN_H = 12;

interface Road {
  /** The pad's template this road belongs to. */
  template: string;
  group: THREE.Group;
  disc: THREE.ShaderMaterial;
  column: THREE.ShaderMaterial;
  core: THREE.ShaderMaterial;
  strands: THREE.ShaderMaterial;
  helixGroup: THREE.Group;
  path: CrossingPoint[];
  rgb: readonly [number, number, number];
  id: number;
  born: number;
  /** The pad's spot (instance-local). */
  at: { x: number; z: number };
}

export class BreathCrossingFx {
  private readonly roads: Road[] = [];
  private clock = 0;
  private seed = 0x6a3d;

  constructor(private readonly h: BreathIslesHost) {
    const discGeo = new THREE.PlaneGeometry(1, 1);
    discGeo.rotateX(-Math.PI / 2);
    const colGeo = new THREE.CylinderGeometry(0.8, 1.15, 1, 28, 1, true);
    colGeo.translate(0, 0.5, 0);
    const helixGeos: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 2; k++) {
      const pts: { x: number; y: number; z: number }[] = [];
      for (let i = 0; i <= 48; i++) {
        const f = i / 48;
        const a = f * Math.PI * 2 * 2 + k * Math.PI;
        const r = 1 - 0.3 * f;
        pts.push({ x: Math.sin(a) * r, y: f, z: Math.cos(a) * r });
      }
      helixGeos.push(ribbonGeometry(pts, 0.022, true));
    }
    h.geometries.push(discGeo, colGeo, ...helixGeos);
    const roads = crossingRoads(CORNICE_FLOOR_H);
    const CC = CORNICE_CROSSING;
    this.build(CROSSING_OBJECTS.out, CC.out, roads.out, C.path, C.pathCore, RGB.path, {
      discGeo,
      colGeo,
      helixGeos,
    });
    this.build(CROSSING_OBJECTS.home, CC.home, roads.home, C.home, C.homeCore, RGB.homeCore, {
      discGeo,
      colGeo,
      helixGeos,
    });
  }

  private build(
    template: string,
    at: { x: number; z: number },
    path: CrossingPoint[],
    color: number,
    coreColor: number,
    rgb: readonly [number, number, number],
    g: {
      discGeo: THREE.BufferGeometry;
      colGeo: THREE.BufferGeometry;
      helixGeos: THREE.BufferGeometry[];
    },
  ): void {
    const h = this.h;
    const y = CORNICE_FLOOR_H + 0.08;
    const r = CORNICE_CROSSING.r;
    const group = new THREE.Group();
    group.visible = false;
    group.name = `smithHeartBreathCrossing_${template}`;
    const ribbon = (glow: number, flow: number, dash: number, fade: number) =>
      new THREE.ShaderMaterial({
        name: 'smithHeartBreathCrossingRibbon',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(color) },
          uCore: { value: new THREE.Color(coreColor) },
          uGlow: { value: glow },
          uFlow: { value: flow },
          uDash: { value: dash },
          uFade: { value: fade },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: ISLE_RIBBON_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
    // The pad: a wheeling disc, a column, its two spiralling ribbons.
    const disc = new THREE.ShaderMaterial({
      name: 'smithHeartBreathCrossingDisc',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(color) },
        uCore: { value: new THREE.Color(coreColor) },
        uGlow: { value: 1 },
        uOpen: { value: 1 },
        uSpin: { value: 1 },
      },
      vertexShader: ISLE_UV_VERT,
      fragmentShader: ISLE_DISC_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const discMesh = new THREE.Mesh(g.discGeo, disc);
    discMesh.scale.set(r * 2.6, 1, r * 2.6);
    discMesh.position.set(at.x, y, at.z);
    discMesh.renderOrder = floorVfxRenderOrder('encounter', 18);
    group.add(discMesh);
    const column = new THREE.ShaderMaterial({
      name: 'smithHeartBreathCrossingColumn',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(color) },
        uGlow: { value: 0.4 },
        uOpen: { value: 1 },
      },
      vertexShader: ISLE_UV_VERT,
      fragmentShader: ISLE_COLUMN_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const colMesh = new THREE.Mesh(g.colGeo, column);
    colMesh.scale.set(r, COLUMN_H, r);
    colMesh.position.set(at.x, y, at.z);
    group.add(colMesh);
    const helix = ribbon(0.55, 2.2, 4, 0.12);
    const helixGroup = new THREE.Group();
    helixGroup.position.set(at.x, y + 0.2, at.z);
    helixGroup.scale.set(r * 1.05, COLUMN_H * 0.9, r * 1.05);
    for (const hg of g.helixGeos) {
      const m = new THREE.Mesh(hg, helix);
      m.frustumCulled = false;
      helixGroup.add(m);
    }
    group.add(helixGroup);
    // The road: a core of two crossed ribbons and the strands round it.
    const core = ribbon(0.5, 1.1, 10, 0.05);
    for (const upright of [false, true]) {
      const rg = ribbonGeometry(path, 0.32, upright);
      h.geometries.push(rg);
      const m = new THREE.Mesh(rg, core);
      m.frustumCulled = false;
      group.add(m);
    }
    const strands = ribbon(0.8, 1.6, 14, 0.06);
    for (let k = 0; k < CROSSING_LOOK.strands; k++) {
      const sg = ribbonGeometry(crossingStrand(path, k), 0.11, false);
      h.geometries.push(sg);
      const m = new THREE.Mesh(sg, strands);
      m.frustumCulled = false;
      group.add(m);
    }
    h.materials.push(disc, column, helix, core, strands);
    h.local.add(group);
    this.roads.push({
      template,
      group,
      disc,
      column,
      core,
      strands,
      helixGroup,
      path,
      rgb,
      id: -1,
      born: 0,
      at,
    });
  }

  // ---- the scan ----------------------------------------------------------------------

  private readonly seen: number[] = [];

  beginScan(): void {
    this.seen.length = 0;
  }

  /** A crossing object (a pad or a ride's carrier) is this part's (true). */
  takeObject(e: Entity): boolean {
    const t = e.templateId;
    if (t === CROSSING_OBJECTS.ride) return true;
    if (t !== CROSSING_OBJECTS.out && t !== CROSSING_OBJECTS.home) return false;
    this.seen.push(e.id);
    return true;
  }

  endScan(world: IWorld): void {
    for (const road of this.roads) {
      let found = -1;
      for (const id of this.seen)
        if (world.entities.get(id)?.templateId === road.template) found = id;
      if (found !== road.id) {
        road.id = found;
        road.born = this.clock;
        road.group.visible = found >= 0;
      }
    }
  }

  // ---- the frame ---------------------------------------------------------------------

  update(dt: number): void {
    this.clock += dt;
    const t = this.h.uTime.value;
    const o = this.h.local.position;
    for (const road of this.roads) {
      if (road.id < 0) continue;
      // Opening as it rises (a home pad come back after a fight), then a
      // slow breath in its glow.
      const open = Math.min(1, (this.clock - road.born) / 0.8);
      const breathe = 0.85 + 0.15 * Math.sin(t * 1.7);
      road.disc.uniforms.uOpen.value = open;
      road.disc.uniforms.uGlow.value = open * breathe;
      road.column.uniforms.uOpen.value = open;
      road.core.uniforms.uGlow.value = 0.5 * open * breathe;
      road.strands.uniforms.uGlow.value = 1.1 * open;
      road.helixGroup.rotation.y = t * 2.1;
      // Motes riding the road over the chasm (cosmetic, by the density).
      if (this.rand() < dt * 18 * this.h.density) {
        const n = road.path.length - 1;
        const i = Math.min(n - 1, Math.floor(this.rand() * n));
        const a = road.path[i];
        const b = road.path[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
        const s = 9 / len;
        const j = () => (this.rand() - 0.5) * CROSSING_LOOK.radius * 1.6;
        this.h.particles.puff(o.x + a.x + j(), o.y + a.y + j(), o.z + a.z + j(), 1, {
          speed: 0.3,
          life: 1.1,
          size: [0.3, 0.06],
          color: road.rgb,
          alpha: 0.85,
          pool: 'glow',
          dir: [(b.x - a.x) * s, (b.y - a.y) * s, (b.z - a.z) * s],
          spread: 0.15,
          drag: 0.4,
        });
      }
      // ...and drawn up the pad's column.
      if (this.rand() < dt * 8 * this.h.density) {
        const ang = this.rand() * Math.PI * 2;
        this.h.particles.puff(
          o.x + road.at.x + Math.sin(ang) * 1.6,
          o.y + CORNICE_FLOOR_H + 0.2,
          o.z + road.at.z + Math.cos(ang) * 1.6,
          1,
          {
            speed: 0.6,
            up: 6,
            life: 1.2,
            size: [0.25, 0.08],
            color: road.rgb,
            alpha: 0.85,
            pool: 'glow',
          },
        );
      }
    }
  }

  /** The claim is out of view: hide what stands. */
  leave(): void {
    for (const road of this.roads) {
      road.id = -1;
      road.group.visible = false;
    }
  }

  private rand(): number {
    // A small LCG: cosmetic scatter, never the sim's.
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}
