// A wall of fire standing across a straight lane (the programs are
// line_fire_glsl.ts on the Heat guardian's own fire fragments,
// heat_lava_wall_glsl.ts): stacked animated fire curtains (one draw), a smoky
// dark body under them, the air lit round it, smoke off its tips and a heat
// haze (when the look asks), tongues leaping off it (one instanced draw),
// embers and sparks (one point draw); when the look asks, soft flames all
// across the lane (one instanced draw, soft_flame_glsl.ts) and smoke puffs
// rolling off its tips (one instanced draw). Shared by Firestorm's wall
// (final_firestorm_fx.ts) and the Molten Swells' burning crests
// (heat_swell_fx.ts), so every moving fire in the Smith's Heart reads as one
// family.
//
// Rules (src/render/CLAUDE.md): built whole in the constructor under the
// owner's root (its one gated attach: no program compiles at the first cast);
// a fixed set of draws; no light; `set` writes uniforms only (no allocation).

import * as THREE from 'three';
import { fireRampGlsl } from './heat_flame_core';
import {
  WALL_EMBER_FRAG,
  WALL_GLOW_FRAG,
  WALL_HAZE_FRAG,
  WALL_SMOKE_FRAG,
  wallFireFrag,
  wallTongueFrag,
} from './heat_lava_wall_glsl';
import {
  LINE_EMBER_VERT,
  LINE_FIRE_SAMPLES,
  LINE_FLAME_VERT,
  LINE_PUFF_VERT,
  LINE_SHEET_VERT,
  LINE_TONGUE_VERT,
} from './line_fire_glsl';
import { SOFT_SMOKE_FRAG, softFlameFrag } from './soft_flame_glsl';

/** The wall's look (yards), fixed at the build. */
export interface LineFireLook {
  /** Its name prefix (each draw is `<prefix>Fire`, `Body`, `Glow`, ...). */
  name: string;
  height: number;
  tongue: number;
  /** Each fire sheet's yards behind the front (0: on it). */
  sheetBack: readonly number[];
  /** The body, glow, smoke and haze sheet's yards behind the front. */
  bodyBack: number;
  tongues: number;
  embers: number;
  smoke: boolean;
  haze: boolean;
  /** The stacked sheets' gain (they sum: dimmer each, never a white band). */
  gain: number;
  /** The draw order the layers stack from. */
  order: number;
  /** Soft flames standing all across the lane (0 or absent: none), their
   *  height, and how far each wanders across between lives (share of the
   *  lane's half width). */
  flames?: number;
  flameHeight?: number;
  flameSpan?: number;
  /** Smoke puffs rolling up off the tips (0 or absent: none). */
  puffs?: number;
  /** The sheets' foot melts into the floor (no straight line where a sheet
   *  meets it). */
  softFoot?: boolean;
  /** Where across (share of the half width) the sheets start to taper to
   *  their ends (default 0.72). */
  ends?: number;
  /** The sheets fade out as the view swings edge-on to them (a sheet seen
   *  along its face reads as a flat line); the soft flames carry the wall. */
  edgeFade?: boolean;
}

interface Uni {
  [k: string]: THREE.IUniform;
}

/** A deterministic 0..1 hash (the layers' seeds). */
export function lineFireHash(i: number, salt: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Curtains across the lane: x 0..1 across, y 0..1 up, aSheet (back, seed). */
function sheetGeometry(sheets: readonly (readonly [number, number])[]): THREE.BufferGeometry {
  const seg = 40;
  const hs = 10;
  const per = (seg + 1) * (hs + 1);
  const pos = new Float32Array(per * sheets.length * 3);
  const sh = new Float32Array(per * sheets.length * 2);
  const idx: number[] = [];
  sheets.forEach(([back, seed], s) => {
    const base = s * per;
    for (let i = 0; i <= seg; i++)
      for (let j = 0; j <= hs; j++) {
        const k = base + i * (hs + 1) + j;
        pos[k * 3] = i / seg;
        pos[k * 3 + 1] = j / hs;
        sh[k * 2] = back;
        sh[k * 2 + 1] = seed;
      }
    for (let i = 0; i < seg; i++)
      for (let j = 0; j < hs; j++) {
        const a = base + i * (hs + 1) + j;
        const b = a + hs + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSheet', new THREE.BufferAttribute(sh, 2));
  g.setIndex(idx);
  return g;
}

/** What the owner lends the wall. */
export interface LineFireHost {
  root: THREE.Object3D;
  uTime: { value: number };
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

export class LineFireWall {
  /** The uniforms every layer shares (the owner may read them into its own
   *  draws: the front, the heading, the half width, the rise, the trail). */
  readonly shared: Uni;
  private readonly layers: THREE.Object3D[] = [];
  private readonly ground: number[];

  constructor(host: LineFireHost, look: LineFireLook, seed: number) {
    this.ground = new Array(LINE_FIRE_SAMPLES).fill(0);
    this.shared = {
      uFront: { value: new THREE.Vector3() },
      uDir: { value: new THREE.Vector2(0, 1) },
      uHalf: { value: 5 },
      uRise: { value: 0 },
      uTime: host.uTime,
      // No room clip unless the owner sets one.
      uRoom: { value: new THREE.Vector3(0, 0, 1e6) },
      uGround: { value: this.ground },
      uHeat: { value: 1 },
      uFrontAlong: { value: 0 },
      uTrail: { value: 0 },
      uEnds: { value: look.ends ?? 0.72 },
      uEdgeOn: { value: look.edgeFade ? 1 : 0 },
    };
    const shared = this.shared;
    const ramp = fireRampGlsl('fireRamp');
    const fireFrag = wallFireFrag(ramp);
    const foot: Record<string, string> = look.softFoot ? { SOFT_FOOT: '' } : {};
    const tongueFrag = wallTongueFrag(ramp);
    const curtain = sheetGeometry(
      look.sheetBack.map((back, i) => [back, 0.13 + i * 0.37 + seed * 0.11] as const),
    );
    const single = sheetGeometry([[look.bodyBack, 0.29 + seed * 0.07]]);
    const tongueQuad = new THREE.PlaneGeometry(1, 1, 1, 10);
    host.geometries.push(curtain, single, tongueQuad);
    const add = (
      part: string,
      geometry: THREE.BufferGeometry,
      uniforms: Uni,
      vertexShader: string,
      fragmentShader: string,
      blending: THREE.Blending,
      order: number,
      points = false,
      defines: Record<string, string> = {},
    ) => {
      const name = `${look.name}${part}`;
      const mat = new THREE.ShaderMaterial({
        name,
        uniforms,
        defines,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending,
        toneMapped: false,
        fog: false,
      });
      host.materials.push(mat);
      const obj = points ? new THREE.Points(geometry, mat) : new THREE.Mesh(geometry, mat);
      obj.name = name;
      obj.frustumCulled = false;
      obj.visible = false;
      obj.renderOrder = look.order + order;
      host.root.add(obj);
      this.layers.push(obj);
    };
    if (look.smoke)
      add(
        'Smoke',
        single,
        { ...shared, uH: { value: look.height * 2.2 }, uLift: { value: 0 } },
        LINE_SHEET_VERT,
        WALL_SMOKE_FRAG,
        THREE.NormalBlending,
        0,
      );
    // Its dark body (the wall's shape against a bright floor).
    add(
      'Body',
      single,
      { ...shared, uH: { value: look.height * 1.08 }, uLift: { value: 0 }, uGain: { value: 1 } },
      LINE_SHEET_VERT,
      fireFrag,
      THREE.NormalBlending,
      1,
      false,
      { WALL_DARK: '', ...foot },
    );
    // The air lit round it.
    add(
      'Glow',
      single,
      { ...shared, uH: { value: look.height * 1.5 }, uLift: { value: 0 } },
      LINE_SHEET_VERT,
      WALL_GLOW_FRAG,
      THREE.AdditiveBlending,
      3,
    );
    add(
      'Fire',
      curtain,
      { ...shared, uH: { value: look.height }, uLift: { value: 0 }, uGain: { value: look.gain } },
      LINE_SHEET_VERT,
      fireFrag,
      THREE.AdditiveBlending,
      4,
      false,
      foot,
    );
    const tg = new THREE.InstancedBufferGeometry();
    tg.index = tongueQuad.index;
    tg.setAttribute('position', tongueQuad.getAttribute('position'));
    const ta = new Float32Array(look.tongues * 2);
    for (let i = 0; i < look.tongues; i++) {
      ta[i * 2] = -1 + (2 * (i + 0.8 * lineFireHash(i, 11 + seed))) / look.tongues;
      ta[i * 2 + 1] = lineFireHash(i, 29 + seed);
    }
    tg.setAttribute('aTongue', new THREE.InstancedBufferAttribute(ta, 2));
    tg.instanceCount = look.tongues;
    host.geometries.push(tg);
    add(
      'Tongues',
      tg,
      { ...shared, uTongue: { value: look.tongue } },
      LINE_TONGUE_VERT,
      tongueFrag,
      THREE.AdditiveBlending,
      5,
    );
    // Soft flames all across the lane, and smoke puffs off the tips.
    const cards = (count: number, salt: number): THREE.InstancedBufferGeometry => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = cardQuad.index;
      g.setAttribute('position', cardQuad.getAttribute('position'));
      const a = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        a[i * 2] = -1 + (2 * (i + 0.5 + 0.6 * (lineFireHash(i, salt + seed) - 0.5))) / count;
        a[i * 2 + 1] = lineFireHash(i, salt + 19 + seed);
      }
      g.setAttribute('aFlame', new THREE.InstancedBufferAttribute(a, 2));
      g.instanceCount = count;
      host.geometries.push(g);
      return g;
    };
    const cardQuad = new THREE.PlaneGeometry(1, 1, 1, 1);
    host.geometries.push(cardQuad);
    if (look.puffs)
      add(
        'Puffs',
        cards(look.puffs, 211),
        { uTime: host.uTime, ...shared, uH: { value: look.height } },
        LINE_PUFF_VERT,
        SOFT_SMOKE_FRAG,
        THREE.NormalBlending,
        2,
      );
    if (look.flames) {
      const flameU = {
        ...shared,
        uH: { value: look.flameHeight ?? look.height },
        uSpan: { value: (2.4 / look.flames) * (look.flameSpan ?? 1) },
      };
      const flameGeo = cards(look.flames, 233);
      const flameFrag = softFlameFrag(ramp);
      add(
        'FlameBody',
        flameGeo,
        flameU,
        LINE_FLAME_VERT,
        flameFrag,
        THREE.NormalBlending,
        3,
        false,
        { SOFT_DARK: '' },
      );
      add('Flames', flameGeo, flameU, LINE_FLAME_VERT, flameFrag, THREE.AdditiveBlending, 5);
    }
    const eg = new THREE.BufferGeometry();
    const n = look.embers;
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const ea = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      ea[i * 4] = lineFireHash(i, 101 + seed) * 2 - 1;
      ea[i * 4 + 1] = lineFireHash(i, 131 + seed);
      ea[i * 4 + 2] = 0.35 + 0.55 * lineFireHash(i, 151 + seed);
      ea[i * 4 + 3] = 0.16 + 0.26 * lineFireHash(i, 171 + seed);
    }
    eg.setAttribute('aEmber', new THREE.BufferAttribute(ea, 4));
    host.geometries.push(eg);
    add(
      'Embers',
      eg,
      { ...shared, uPx: { value: 900 } },
      LINE_EMBER_VERT,
      WALL_EMBER_FRAG,
      THREE.AdditiveBlending,
      6,
      true,
    );
    if (look.haze)
      add(
        'Haze',
        single,
        { ...shared, uH: { value: look.height * 1.3 }, uLift: { value: 0.5 } },
        LINE_SHEET_VERT,
        WALL_HAZE_FRAG,
        THREE.AdditiveBlending,
        7,
      );
  }

  /** The wall this frame: its front's centre on the floor (x, y, z), its
   *  heading (dx, dz), the lane's half width, how far it stands (0 hides it),
   *  how hot. `base(xs)` is the height over `y` the fire stands on at `xs`
   *  across (-1..1): the floor's own, or a wave's crest. */
  set(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    half: number,
    rise: number,
    heat: number,
    base: (xs: number) => number,
  ): void {
    const u = this.shared;
    (u.uFront.value as THREE.Vector3).set(x, y, z);
    (u.uDir.value as THREE.Vector2).set(dx, dz);
    u.uHalf.value = half;
    u.uRise.value = rise;
    u.uHeat.value = heat;
    const n = LINE_FIRE_SAMPLES;
    for (let i = 0; i < n; i++) this.ground[i] = base(-1 + (2 * i) / (n - 1));
    const on = rise > 0.002;
    for (const o of this.layers) o.visible = on;
  }

  /** Clip the wall to a round floor (its centre and radius, world yards). */
  clip(x: number, z: number, r: number): void {
    (this.shared.uRoom.value as THREE.Vector3).set(x, z, r);
  }

  hide(): void {
    this.shared.uRise.value = 0;
    for (const o of this.layers) o.visible = false;
  }
}
