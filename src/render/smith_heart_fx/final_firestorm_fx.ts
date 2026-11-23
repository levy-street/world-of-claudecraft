// Firestorm's wall of flame (Elemental Fusion of the Heat and the Breath), a
// part of FinalElementsFx (final_elements_fx.ts keeps the lane's floor
// telegraph through the warning and lends its host). The plan and the reasons
// are final_firestorm_core.ts; the programs final_firestorm_glsl.ts. Per lane
// slot:
//   - the wall: a LineFireWall (line_fire_wall.ts, the Heat guardian's fire on
//     a straight front): stacked fire curtains, its dark body, the air lit
//     round it, smoke and haze (detail tier), tongues, embers and sparks,
//     standing on the floor's own heights across the front;
//   - the trail: low curtains of fire down the burnt lane (one draw, baked on
//     the floor once per lane), out the moment the sim's lane ends;
//   - the floor: the burnt lane (one draw, baked once per lane) with the
//     molten seam, the light ahead, the char and its cracks, and the crisp
//     hot danger edge on both sides (every tier).
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the host's root (the kit's one gated attach, so the first
// cast never compiles a program); fixed pools; no light; no per-frame
// allocation (a lane's floor is baked into its slot's own buffers when the
// slot takes the lane).

import * as THREE from 'three';
import {
  type FirestormWallLook,
  firestormBudget,
  firestormChar,
  firestormWall,
  FIRESTORM_LOOK as L,
} from './final_firestorm_core';
import { FS_FLOOR_FRAG, FS_FLOOR_VERT, FS_TRAIL_VERT } from './final_firestorm_glsl';
import { fireRampGlsl } from './heat_flame_core';
import { wallFireFrag } from './heat_lava_wall_glsl';
import { LineFireWall, lineFireHash } from './line_fire_wall';

/** What FinalElementsFx lends the wall. */
export interface FinalFirestormHost {
  root: THREE.Group;
  uTime: { value: number };
  groundY: (x: number, z: number) => number;
  density: number;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  /** The standing bodies' draw order (past every floor rung). */
  bodyOrder: number;
}

interface Uni {
  [k: string]: THREE.IUniform;
}

/** The longest lane a slot bakes (the sim's rim-to-rim lane is 108 yd). */
const MAX_LENGTH = 120;
/** The draw order of the wall's layers over the bodies' order. */
const AIR = { trail: 2 };
/** The danger edge's colour (the fight's fire threat). */
const EDGE_RGB = [1, 0.36, 0.08] as const;

interface Slot {
  id: number;
  seen: boolean;
  /** The painter clock the burn began at; the clock the lane went at. */
  burnAt: number;
  goneAt: number;
  sx: number;
  sz: number;
  dx: number;
  dz: number;
  length: number;
  half: number;
  run: number;
  cx: number;
  cz: number;
  r: number;
  wall: LineFireWall;
  /** The floor across the front this frame (relative to its centre). */
  base: (xs: number) => number;
  fx: number;
  fy: number;
  fz: number;
  trail: THREE.Mesh;
  trailU: Uni;
  floor: THREE.Mesh;
  floorU: Uni;
  /** The baked buffers (the trail's floor points, the floor grid). */
  trailBase: THREE.BufferAttribute;
  floorPos: THREE.BufferAttribute;
  floorLane: THREE.BufferAttribute;
}

export class FinalFirestormFx {
  private readonly slots: Slot[] = [];
  private clock = 0;
  private readonly look: FirestormWallLook = { front: 0, rise: 0, heat: 0, trail: 0 };
  private readonly trailLanes: readonly number[];
  private readonly trailSteps = Math.ceil(MAX_LENGTH / L.trailStep);
  private readonly floorRows = Math.ceil(MAX_LENGTH / L.floorStep);

  constructor(
    private readonly h: FinalFirestormHost,
    pools: number,
  ) {
    const budget = firestormBudget(h.density >= 1);
    // The trail's curtains run along the lane at these shares of its width.
    this.trailLanes = [-0.6, 0.0, 0.62].slice(0, budget.trailSheets);
    const fireFrag = wallFireFrag(fireRampGlsl('fireRamp'));

    for (let s = 0; s < pools; s++) {
      const wall = new LineFireWall(
        h,
        {
          name: 'smithHeartFirestorm',
          height: L.height,
          tongue: L.tongue,
          sheetBack: L.sheetBack.slice(0, budget.sheets),
          bodyBack: 0.6,
          tongues: budget.tongues,
          embers: budget.embers,
          smoke: budget.smoke,
          haze: budget.haze,
          gain: budget.sheets > 1 ? 0.52 : 0.8,
          order: h.bodyOrder,
        },
        s,
      );
      const shared = wall.shared;
      const add = (
        name: string,
        geometry: THREE.BufferGeometry,
        uniforms: Uni,
        order: number,
      ): THREE.Mesh => {
        const mat = new THREE.ShaderMaterial({
          name,
          uniforms,
          vertexShader: FS_TRAIL_VERT,
          fragmentShader: fireFrag,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
          fog: false,
        });
        h.materials.push(mat);
        const obj = new THREE.Mesh(geometry, mat);
        obj.name = name;
        obj.frustumCulled = false;
        obj.visible = false;
        obj.renderOrder = h.bodyOrder + order;
        h.root.add(obj);
        return obj;
      };

      // The trail's low fire: strips along the lane, baked per lane.
      const steps = this.trailSteps;
      const hs = 4;
      const strips = this.trailLanes.length;
      const per = (steps + 1) * (hs + 1);
      const tPos = new Float32Array(per * strips * 3);
      const tBase = new Float32Array(per * strips * 3);
      const tTrail = new Float32Array(per * strips * 2);
      const tIdx: number[] = [];
      for (let k = 0; k < strips; k++) {
        const base = k * per;
        for (let i = 0; i <= steps; i++)
          for (let j = 0; j <= hs; j++) {
            const q = base + i * (hs + 1) + j;
            tPos[q * 3 + 1] = j / hs;
            tTrail[q * 2] = i * L.trailStep;
            tTrail[q * 2 + 1] = lineFireHash(k, 401 + s);
          }
        for (let i = 0; i < steps; i++)
          for (let j = 0; j < hs; j++) {
            const a = base + i * (hs + 1) + j;
            const b = a + hs + 1;
            tIdx.push(a, b, a + 1, b, b + 1, a + 1);
          }
      }
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
      const trailBase = new THREE.BufferAttribute(tBase, 3);
      trailBase.setUsage(THREE.DynamicDrawUsage);
      trailGeo.setAttribute('aBase', trailBase);
      trailGeo.setAttribute('aTrail', new THREE.BufferAttribute(tTrail, 2));
      trailGeo.setIndex(tIdx);
      h.geometries.push(trailGeo);
      const trailU: Uni = {
        ...shared,
        uTrailH: { value: L.trailHeight },
        uTrailRun: { value: L.trailRun },
        uTrailFloor: { value: L.trailFloor },
        uHeelH: { value: L.heelHeight },
        uHeelRun: { value: L.heelRun },
        uGain: { value: 0.62 },
      };
      const trail = add('smithHeartFirestormTrail', trailGeo, trailU, AIR.trail);

      // The burnt lane on the floor: a grid baked per lane.
      const across = L.floorAcross;
      const rows = this.floorRows;
      const fN = (across + 1) * (rows + 1);
      const floorPos = new THREE.BufferAttribute(new Float32Array(fN * 3), 3);
      floorPos.setUsage(THREE.DynamicDrawUsage);
      const floorLane = new THREE.BufferAttribute(new Float32Array(fN * 2), 2);
      floorLane.setUsage(THREE.DynamicDrawUsage);
      const fIdx: number[] = [];
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < across; j++) {
          const a = i * (across + 1) + j;
          const b = a + across + 1;
          fIdx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      const floorGeo = new THREE.BufferGeometry();
      floorGeo.setAttribute('position', floorPos);
      floorGeo.setAttribute('aLane', floorLane);
      floorGeo.setIndex(fIdx);
      h.geometries.push(floorGeo);
      const floorU: Uni = {
        uTime: h.uTime,
        uFrontAlong: shared.uFrontAlong,
        uLength: { value: 100 },
        uHalf: shared.uHalf,
        uLive: { value: 0 },
        uChar: { value: 0 },
        uBurn: { value: 0 },
        uRoom: shared.uRoom,
        uEdge: { value: new THREE.Vector3(...EDGE_RGB) },
      };
      const floorMat = new THREE.ShaderMaterial({
        name: 'smithHeartFirestormFloor',
        uniforms: floorU,
        vertexShader: FS_FLOOR_VERT,
        fragmentShader: FS_FLOOR_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      h.materials.push(floorMat);
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.name = 'smithHeartFirestormFloor';
      floor.frustumCulled = false;
      floor.visible = false;
      // Over every floor rung (the lane's own telegraph included: the burnt
      // lane is a new state of the floor, not under the warning's paint),
      // under the wall and everything standing.
      floor.renderOrder = h.bodyOrder - 1;
      h.root.add(floor);

      const slot: Slot = {
        id: -1,
        seen: false,
        burnAt: 0,
        goneAt: -1,
        sx: 0,
        sz: 0,
        dx: 0,
        dz: 1,
        length: 0,
        half: 5,
        run: 1,
        cx: 0,
        cz: 0,
        r: 60,
        wall,
        base: () => 0,
        fx: 0,
        fy: 0,
        fz: 0,
        trail,
        trailU,
        floor,
        floorU,
        trailBase,
        floorPos,
        floorLane,
      };
      // The floor across the front, read once per sample (built once: no
      // closure a frame).
      slot.base = (xs) =>
        h.groundY(slot.fx + slot.dz * xs * slot.half, slot.fz - slot.dx * xs * slot.half) - slot.fy;
      this.slots.push(slot);
    }
  }

  begin(clock: number): void {
    this.clock = clock;
    for (const s of this.slots) s.seen = false;
  }

  /** A burning lane this frame: its start, heading, length, half width and
   *  run (the sim's), how long it has burnt, and the Anvil it stands on. */
  see(
    id: number,
    sx: number,
    sz: number,
    facing: number,
    length: number,
    half: number,
    run: number,
    sinceBurn: number,
    room: { x: number; z: number; r: number },
  ): void {
    let s = this.slots.find((k) => k.id === id);
    if (!s) {
      s = this.slots.find((k) => k.id === -1);
      if (!s) {
        s = this.slots[0];
        for (const k of this.slots) if (k.burnAt < s.burnAt) s = k;
      }
      s.id = id;
      s.burnAt = this.clock - sinceBurn;
      s.sx = sx;
      s.sz = sz;
      s.dx = Math.sin(facing);
      s.dz = Math.cos(facing);
      s.length = Math.min(MAX_LENGTH, length);
      s.half = half;
      s.run = run;
      s.cx = room.x;
      s.cz = room.z;
      s.r = room.r;
      this.bake(s);
    }
    s.seen = true;
    s.goneAt = -1;
  }

  /** Lay the slot's floor and trail on the floor under its lane (once). */
  private bake(s: Slot): void {
    const g = this.h.groundY;
    const px = s.dz;
    const pz = -s.dx;
    // The trail strips.
    const tb = s.trailBase.array as Float32Array;
    const hs = 4;
    const per = (this.trailSteps + 1) * (hs + 1);
    this.trailLanes.forEach((share, k) => {
      for (let i = 0; i <= this.trailSteps; i++) {
        const along = Math.min(s.length, i * L.trailStep);
        const lat = share * s.half + Math.sin(i * 1.7 + k * 2.3) * 0.25 * s.half;
        const x = s.sx + s.dx * along + px * lat;
        const z = s.sz + s.dz * along + pz * lat;
        const y = g(x, z);
        for (let j = 0; j <= hs; j++) {
          const q = k * per + i * (hs + 1) + j;
          tb[q * 3] = x;
          tb[q * 3 + 1] = y;
          tb[q * 3 + 2] = z;
        }
      }
    });
    s.trailBase.needsUpdate = true;
    // The floor grid (a little past the lane's edges, so the edge line is
    // whole; the shader draws nothing past it but the line's glow).
    const fp = s.floorPos.array as Float32Array;
    const fl = s.floorLane.array as Float32Array;
    const across = L.floorAcross;
    const widen = 1.12;
    for (let i = 0; i <= this.floorRows; i++) {
      const along = Math.min(s.length + 1, -1 + i * L.floorStep);
      for (let j = 0; j <= across; j++) {
        const xs = -1 + (2 * j) / across;
        const lat = xs * s.half * widen;
        const x = s.sx + s.dx * along + px * lat;
        const z = s.sz + s.dz * along + pz * lat;
        const q = i * (across + 1) + j;
        fp[q * 3] = x;
        fp[q * 3 + 1] = g(x, z) + 0.06;
        fp[q * 3 + 2] = z;
        fl[q * 2] = xs * widen;
        fl[q * 2 + 1] = along;
      }
    }
    s.floorPos.needsUpdate = true;
    s.floorLane.needsUpdate = true;
  }

  /** Draw every lane (burning this frame, or its char fading after the sim's
   *  lane went); free the ones out. */
  end(): void {
    for (const s of this.slots) {
      if (s.id === -1) continue;
      if (!s.seen && s.goneAt < 0) s.goneAt = this.clock;
      const gone = s.goneAt < 0 ? 0 : this.clock - s.goneAt;
      const char = firestormChar(gone);
      if (char <= 0.001) {
        this.free(s);
        continue;
      }
      this.paint(s, this.clock - s.burnAt, gone > 0, char);
    }
  }

  private paint(s: Slot, since: number, gone: boolean, char: number): void {
    const look = firestormWall(since, s.length, s.run, this.look);
    const rise = gone ? 0 : look.rise;
    const trail = gone ? 0 : look.trail;
    const u = s.wall.shared;
    s.fx = s.sx + s.dx * look.front;
    s.fz = s.sz + s.dz * look.front;
    s.fy = this.h.groundY(s.fx, s.fz);
    s.wall.clip(s.cx, s.cz, s.r);
    s.wall.set(s.fx, s.fy, s.fz, s.dx, s.dz, s.half, rise, look.heat, s.base);
    u.uFrontAlong.value = look.front;
    u.uTrail.value = trail;
    s.trail.visible = trail > 0.002;
    s.floorU.uLive.value = gone ? 0 : 1;
    s.floorU.uBurn.value = rise;
    s.floorU.uChar.value = char;
    s.floorU.uLength.value = s.length;
    s.floor.visible = true;
  }

  private free(s: Slot): void {
    s.id = -1;
    s.goneAt = -1;
    s.wall.hide();
    s.trail.visible = false;
    s.floor.visible = false;
  }

  hide(): void {
    for (const s of this.slots) this.free(s);
  }
}
