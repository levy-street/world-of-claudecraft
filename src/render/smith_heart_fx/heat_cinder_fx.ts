// The Rolling Cinders, the adds' fire and who is hunted (plan:
// heat_fight_fx_core.ts fallLook; docs/design/raid/smith_heart.md section
// 7.4), a part of HeatFightFx over its root, particles and floor telegraph
// kit:
//  - a cinder's fall: its landing spot at the sim's exact radius (the shared
//    floor telegraph, danger, every tier) filling over its warning, and the
//    great fireball plunging out of the smoke overhead onto it, a trail of
//    fire behind it;
//  - a Rolling Cinder: a living ball of the first flame (white at its heart,
//    molten gold boiling over it) rolling after its quarry over the bodiless
//    mob, a corona round it, flames streaming off it and a scorched track
//    smouldering behind it; its burst's reach round it (danger, every tier);
//    Cooling Crust hardens it dark under plates of crust (it cannot be struck
//    back);
//  - the hunted: a burning chevron over every player a cinder or a Seedflame
//    hunts and a ring at their feet (every tier: the quarry must know);
//  - the adds: the Wellspawn, the Wellkeepers and the Seedflames burn (a
//    glow round each, flames off them; the Wellspawn's walk leaves embers).
// The fall's spot, the cinder's ball and its reach, its crust, and the
// hunted's marks draw on every tier; the corona's size, the flames,
// the trail and the scorch track thin on the low tier.
//
// Built in the constructor under the host's root (one gated attach), fixed
// pools, no per-frame allocation, no light.

import * as THREE from 'three';
import {
  HEAT_AURAS,
  HEAT_MOBS,
  HEAT_OBJECTS,
  heatTimedOf,
  HEAT_TUNING as T,
} from '../../sim/encounters/smith_heart/heat_ids';
import { fxAnchor } from '../attached_fx_anchor';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  type TelegraphPaint,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { HEAT_FIGHT_COLORS as C, fallLook, HEAT_FIGHT_POOLS as P } from './heat_fight_fx_core';
import { HEAT_FLOOR } from './heat_floor_ladder_core';
import type { HeatFxHost } from './heat_fx_host';
import { HEAT_LAVA_GLSL, HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';

/** The ball's radius (yards): about a player and a half across. */
const BALL_R = 2.2;
const TRACK = 48;
const DANGER = { color: TELEGRAPH_THREAT_COLORS.danger, accent: C.accent };
const PAINT: TelegraphPaint = { fill: 0, clock: 0, range: 0 };
const _fall = { height: 0, fill: 0 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

const TRAIL_DIR: [number, number, number] = [0, 0.5, 0];
const TRAIL = {
  speed: 2,
  up: 2,
  life: 0.7,
  size: [1.6, 0.35] as [number, number],
  color: C.gold,
  alpha: 0.95,
  pool: 'glow' as const,
  dir: TRAIL_DIR,
  spread: 0.5,
  radius: 1.2,
};
const METEOR = {
  speed: 1.5,
  up: 4,
  life: 0.6,
  size: [2.6, 0.6] as [number, number],
  color: C.gold,
  alpha: 0.95,
  pool: 'glow' as const,
  radius: 1.6,
};
const ADD_FLAME = {
  speed: 0.5,
  up: 2.6,
  life: 0.55,
  size: [0.9, 0.2] as [number, number],
  color: C.ember,
  alpha: 0.9,
  pool: 'glow' as const,
  radius: 0.6,
};

const BALL_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec3 vN;
varying vec3 vL;
varying vec3 vW;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vL = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
/** A living ball of the first flame: molten gold boiling over a white heart,
 *  plates of dark crust as its Cooling Crust hardens (uCrust). */
const BALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCrust;
uniform float uSeed;
varying vec3 vN;
varying vec3 vL;
varying vec3 vW;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
${HEAT_LAVA_GLSL}
void main() {
  vec3 v = normalize(cameraPosition - vW);
  float facing = clamp(dot(normalize(vN), v), 0.0, 1.0);
  vec2 p = vec2(atan(vL.z, vL.x) * 2.2 + uSeed, vL.y * 2.2);
  float lvl = lavaLevel(p * 2.0, vec2(0.0, -2.2), uTime, 1.2);
  float m = mix(lvl, 1.0, pow(max(facing, 0.0), 3.0) * 0.6);
  // The crust: plates spread over it as it cools hard.
  float plate = smoothstep(0.08, 0.2, cellEdge(p * 1.6));
  m = mix(m, m * 0.18, plate * uCrust);
  vec3 col = molten(clamp(m, 0.0, 1.0));
  // A bright limb of fire round its silhouette.
  col += vec3(1.0, 0.75, 0.35) * pow(max(1.0 - facing, 0.0), 2.0) * (1.0 - 0.7 * uCrust) * 1.4;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;
/** The scorched track a cinder leaves (vP: heat, seed, unused). */
const TRACK_VERT = /* glsl */ `
varying vec2 vXY;
varying vec3 vP;
void main() {
  vXY = position.xz;
  vP = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const TRACK_FRAG = /* glsl */ `
varying vec2 vXY;
varying vec3 vP;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
void main() {
  float r = length(vXY);
  if (r > 1.0) discard;
  float n = vn(vXY * 3.0 + vP.y * 20.0);
  float m = vP.x * (0.6 + 0.4 * n) * (1.0 - r);
  vec3 col = mix(vec3(0.04, 0.035, 0.03), molten(m), smoothstep(0.05, 0.3, m));
  gl_FragColor = vec4(col, (1.0 - smoothstep(0.6, 1.0, r)) * (0.35 + 0.6 * vP.x));
  #include <colorspace_fragment>
}
`;
/** The hunted's chevron: a burning arrowhead pointing down at the quarry. */
const CHEVRON_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float v = abs(p.x) - (p.y * 0.9 + 0.1);
  float band = 1.0 - smoothstep(0.0, 0.08, abs(v + 0.25));
  float shape = band * step(-0.9, p.y) * step(p.y, 0.9);
  float pulse = 0.75 + 0.25 * sin(uTime * 8.0);
  gl_FragColor = vec4(uColor * (1.4 * pulse), shape);
  #include <colorspace_fragment>
}
`;
const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

interface CinderSlot {
  id: number;
  ball: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  corona: THREE.Sprite;
  coronaMat: THREE.SpriteMaterial;
  reach: TelegraphFan;
  x: number;
  z: number;
  /** The ball's roll (its spin about its travel's axis). */
  spin: number;
  dropIn: number;
  crust: number;
}

interface FallSlot {
  id: number;
  born: number;
  seconds: number;
  fan: TelegraphFan;
  ball: THREE.Sprite;
  ballMat: THREE.SpriteMaterial;
}

interface MarkSlot {
  id: number;
  chevron: THREE.Mesh;
  ring: TelegraphFan;
}

export class HeatCinderFx {
  private readonly cinders: CinderSlot[] = [];
  private readonly falls: FallSlot[] = [];
  private readonly marks: MarkSlot[] = [];
  private readonly track: THREE.InstancedMesh;
  private readonly trackAge = new Float32Array(TRACK);
  private trackNext = 0;
  private readonly addGlows: THREE.Sprite[] = [];
  private readonly chevronMat: THREE.ShaderMaterial;

  constructor(private readonly host: HeatFxHost) {
    const g = host.geometries;
    const sphere = new THREE.IcosahedronGeometry(1, 4);
    g.push(sphere);
    const plane = new THREE.PlaneGeometry(1, 1);
    g.push(plane);
    for (let i = 0; i < P.cinders; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartHeatCinder',
        uniforms: { uTime: host.uTime, uCrust: { value: 0 }, uSeed: { value: i * 3.7 } },
        vertexShader: BALL_VERT,
        fragmentShader: BALL_FRAG,
        toneMapped: false,
      });
      host.materials.push(mat);
      const ball = new THREE.Mesh(sphere, mat);
      ball.name = 'smithHeartHeatCinder';
      ball.frustumCulled = false;
      ball.visible = false;
      host.root.add(ball);
      const coronaMat = host.sprite(0xffc860, 'smithHeartHeatCinderCorona');
      const corona = new THREE.Sprite(coronaMat);
      corona.visible = false;
      host.root.add(corona);
      const reach = host.telegraphs.fan('cinderReach');
      host.kit.layOutFan(reach, 360, DANGER);
      reach.group.visible = false;
      this.cinders.push({
        id: -1,
        ball,
        mat,
        corona,
        coronaMat,
        reach,
        x: 0,
        z: 0,
        spin: 0,
        dropIn: 0,
        crust: 0,
      });
    }
    for (let i = 0; i < P.falls; i++) {
      const fan = host.telegraphs.fan('fall');
      host.kit.layOutFan(fan, 360, DANGER);
      fan.group.visible = false;
      const ballMat = host.sprite(0xffe0a0, 'smithHeartHeatCinderFall');
      const ball = new THREE.Sprite(ballMat);
      ball.visible = false;
      host.root.add(ball);
      this.falls.push({ id: -1, born: 0, seconds: T.cinderFallWarn, fan, ball, ballMat });
    }
    // The scorched track.
    const disc = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
    g.push(disc);
    const trackMat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatCinderTrack',
      vertexShader: TRACK_VERT,
      fragmentShader: TRACK_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    host.materials.push(trackMat);
    this.track = new THREE.InstancedMesh(disc, trackMat, TRACK);
    this.track.name = 'smithHeartHeatCinderTrack';
    this.track.frustumCulled = false;
    this.track.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < TRACK; i++) {
      this.track.setMatrixAt(i, _zero);
      this.track.setColorAt(i, _c.setRGB(0, 0, 0));
      this.trackAge[i] = 99;
    }
    if (this.track.instanceColor) this.track.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.track.renderOrder = floorVfxRenderOrder('encounter', HEAT_FLOOR.cinderTrack.step);
    this.track.visible = false;
    host.root.add(this.track);
    // The hunted's marks.
    this.chevronMat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatHunted',
      uniforms: {
        uTime: host.uTime,
        uColor: { value: new THREE.Color(TELEGRAPH_THREAT_COLORS.danger) },
      },
      vertexShader: UV_VERT,
      fragmentShader: CHEVRON_FRAG,
      transparent: true,
      depthWrite: false,
      // Additive like every glow round it (the seeds', the adds'), so it
      // commutes with them wherever they cross: no camera-angle flicker.
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    host.materials.push(this.chevronMat);
    for (let i = 0; i < P.bodies; i++) {
      const chevron = new THREE.Mesh(plane, this.chevronMat);
      chevron.name = 'smithHeartHeatHuntedChevron';
      chevron.frustumCulled = false;
      chevron.visible = false;
      host.root.add(chevron);
      const ring = host.telegraphs.fan('hunted');
      host.kit.layOutFan(ring, 360, DANGER);
      ring.group.visible = false;
      this.marks.push({ id: -1, chevron, ring });
    }
    // The adds' glows.
    const addMat = host.sprite(0xffc860, 'smithHeartHeatAddGlow');
    for (let i = 0; i < P.adds; i++) {
      const s = new THREE.Sprite(addMat);
      s.visible = false;
      host.root.add(s);
      this.addGlows.push(s);
    }
  }

  /** One frame: the falls (objects), the cinders and the adds (mobs), the
   *  hunted players. */
  update(
    fallIds: readonly number[],
    cinderIds: readonly number[],
    addIds: readonly number[],
    huntedIds: readonly number[],
    clock: number,
    dt: number,
  ): void {
    this.paintFalls(fallIds, clock, dt);
    this.paintCinders(cinderIds, clock, dt);
    this.paintTrack(dt);
    this.paintMarks(huntedIds, clock);
    this.paintAdds(addIds, dt);
  }

  private paintFalls(ids: readonly number[], clock: number, dt: number): void {
    const world = this.host.world;
    if (!world) return;
    for (const s of this.falls)
      if (s.id >= 0 && !ids.includes(s.id)) {
        s.id = -1;
        s.fan.group.visible = false;
        s.ball.visible = false;
      }
    for (const id of ids) {
      const e = world.entities.get(id);
      if (!e) continue;
      const eAt = fxAnchor(e);
      let s = this.falls.find((f) => f.id === id);
      if (!s) {
        s = this.falls.find((f) => f.id < 0);
        if (!s) continue;
        s.id = id;
        s.born = clock;
        s.seconds = heatTimedOf(HEAT_OBJECTS.fallPrefix, e.templateId) ?? T.cinderFallWarn;
        const y = this.host.groundY(eAt.x, eAt.z);
        this.host.kit.drapeFan(
          s.fan,
          this.host.groundY,
          eAt.x,
          y,
          eAt.z,
          0,
          e.scale || T.cinderLandR,
        );
        s.fan.group.visible = true;
      }
      const look = fallLook(clock - s.born, s.seconds, _fall);
      PAINT.fill = look.fill;
      PAINT.clock = clock;
      PAINT.range = e.scale || T.cinderLandR;
      PAINT.front = undefined;
      PAINT.fade = undefined;
      this.host.kit.paintFan(s.fan, PAINT);
      const y = this.host.groundY(eAt.x, eAt.z);
      s.ball.position.set(eAt.x, y + look.height + BALL_R, eAt.z);
      s.ball.scale.set(BALL_R * 5, BALL_R * 5, 1);
      s.ballMat.opacity = 0.95;
      s.ball.visible = true;
      if (this.host.rand() < dt * 50 * this.host.density)
        this.host.particles.puff(eAt.x, s.ball.position.y + 2, eAt.z, 1, METEOR);
    }
  }

  private paintCinders(ids: readonly number[], clock: number, dt: number): void {
    const world = this.host.world;
    if (!world) return;
    for (const s of this.cinders) if (s.id >= 0 && !ids.includes(s.id)) this.release(s);
    for (const id of ids) {
      const e = world.entities.get(id);
      if (!e) continue;
      let s = this.cinders.find((c) => c.id === id);
      if (!s) {
        s = this.cinders.find((c) => c.id < 0);
        if (!s) continue;
        s.id = id;
        s.x = e.pos.x;
        s.z = e.pos.z;
        s.spin = 0;
        s.crust = 0;
      }
      if (e.dead) {
        this.release(s);
        continue;
      }
      // Ride the drawn body (already smooth: attached_fx_anchor.ts); a lag
      // toward the snapshot trailed it and stepped with every snapshot.
      const at = fxAnchor(e);
      const mx = at.x - s.x;
      const mz = at.z - s.z;
      s.x += mx;
      s.z += mz;
      const moved = Math.hypot(mx, mz);
      s.spin += moved / BALL_R;
      let crust = false;
      for (const a of e.auras) if (a.id === HEAT_AURAS.crust) crust = true;
      s.crust += ((crust ? 1 : 0) - s.crust) * Math.min(1, dt * 4);
      const y = this.host.groundY(s.x, s.z);
      s.ball.position.set(s.x, y + BALL_R * 0.92, s.z);
      _v.set(mz, 0, -mx).normalize();
      if (moved > 1e-4) s.ball.quaternion.setFromAxisAngle(_v, s.spin);
      s.ball.scale.setScalar(BALL_R * (1 + 0.04 * Math.sin(clock * 9 + id)));
      s.mat.uniforms.uCrust.value = s.crust;
      s.ball.visible = true;
      s.corona.position.set(s.x, y + BALL_R, s.z);
      const cs = BALL_R * (this.host.detail ? 6 : 4.5) * (1 - 0.5 * s.crust);
      s.corona.scale.set(cs, cs, 1);
      s.coronaMat.opacity = 0.85 * (1 - 0.7 * s.crust);
      s.corona.visible = true;
      // Its burst's reach round it (every tier).
      this.host.kit.drapeFan(s.reach, this.host.groundY, s.x, y, s.z, 0, T.cinderSplashR);
      PAINT.fill = 0.35 + 0.25 * Math.sin(clock * 6);
      PAINT.clock = clock;
      PAINT.range = T.cinderSplashR;
      PAINT.front = undefined;
      PAINT.fade = undefined;
      this.host.kit.paintFan(s.reach, PAINT);
      s.reach.group.visible = true;
      if (this.host.rand() < dt * 40 * this.host.density * (1 - 0.6 * s.crust)) {
        TRAIL_DIR[0] = -mx * 20;
        TRAIL_DIR[2] = -mz * 20;
        this.host.particles.puff(s.x, y + BALL_R * 1.2, s.z, 1, TRAIL);
      }
      s.dropIn -= dt;
      if (moved > 1e-3 && s.dropIn <= 0) {
        s.dropIn = 0.25;
        this.layTrack(s.x, y, s.z, clock);
      }
    }
  }

  private release(s: CinderSlot): void {
    s.id = -1;
    s.ball.visible = false;
    s.corona.visible = false;
    s.reach.group.visible = false;
  }

  private layTrack(x: number, y: number, z: number, clock: number): void {
    const i = this.trackNext;
    this.trackNext = (i + 1) % TRACK;
    this.trackAge[i] = 0;
    _v.set(x, y + 0.04, z);
    _s.set(BALL_R * 0.9, 1, BALL_R * 0.9);
    this.track.setMatrixAt(i, _m.compose(_v, _q.identity(), _s));
    this.track.setColorAt(i, _c.setRGB(1, (clock * 7.3) % 1, 0));
  }

  private paintTrack(dt: number): void {
    let live = 0;
    for (let i = 0; i < TRACK; i++) {
      if (this.trackAge[i] > 8) continue;
      this.trackAge[i] += dt;
      const heat = Math.max(0, 1 - this.trackAge[i] / 8);
      this.track.getColorAt(i, _c);
      this.track.setColorAt(i, _c.setRGB(heat, _c.g, 0));
      if (heat <= 0) this.track.setMatrixAt(i, _zero);
      else live++;
    }
    this.track.instanceMatrix.needsUpdate = true;
    if (this.track.instanceColor) this.track.instanceColor.needsUpdate = true;
    this.track.visible = live > 0;
  }

  private paintMarks(ids: readonly number[], clock: number): void {
    const world = this.host.world;
    if (!world) return;
    let n = 0;
    for (const id of ids) {
      if (n >= this.marks.length) break;
      const p = world.entities.get(id);
      if (!p || p.dead) continue;
      const m = this.marks[n++];
      m.id = id;
      const pAt = fxAnchor(p);
      const y = this.host.groundY(pAt.x, pAt.z);
      m.chevron.position.set(pAt.x, pAt.y + 3.4 + 0.25 * Math.sin(clock * 5), pAt.z);
      m.chevron.scale.set(1.4, 1.4, 1);
      m.chevron.quaternion.copy(this.cameraYaw());
      m.chevron.visible = true;
      this.host.kit.drapeFan(m.ring, this.host.groundY, pAt.x, y, pAt.z, 0, 1.6);
      PAINT.fill = 1;
      PAINT.clock = clock;
      PAINT.range = 1.6;
      PAINT.front = undefined;
      PAINT.fade = undefined;
      this.host.kit.paintFan(m.ring, PAINT);
      m.ring.group.visible = true;
    }
    for (let i = n; i < this.marks.length; i++) {
      const m = this.marks[i];
      if (m.id < 0) continue;
      m.id = -1;
      m.chevron.visible = false;
      m.ring.group.visible = false;
    }
  }

  /** A billboard's turn toward the player's own view (its yaw only). */
  private cameraYaw(): THREE.Quaternion {
    const world = this.host.world;
    const me = world?.entities.get(world.playerId);
    return _q.setFromAxisAngle(_v.set(0, 1, 0), me ? me.facing + Math.PI : 0);
  }

  private paintAdds(ids: readonly number[], dt: number): void {
    const world = this.host.world;
    if (!world) return;
    let n = 0;
    for (const id of ids) {
      if (n >= this.addGlows.length) break;
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      const g = this.addGlows[n++];
      const big =
        e.templateId === HEAT_MOBS.keeper ? 2.2 : e.templateId === HEAT_MOBS.spawn ? 1.5 : 1;
      const eAt = fxAnchor(e);
      g.position.set(eAt.x, eAt.y + 1.4 * big, eAt.z);
      g.scale.set(4 * big, 4 * big, 1);
      g.visible = true;
      if (this.host.rand() < dt * 14 * big * this.host.density) {
        ADD_FLAME.radius = 0.5 * big;
        this.host.particles.puff(eAt.x, eAt.y + 0.8 * big, eAt.z, 1, ADD_FLAME);
      }
    }
    for (let i = n; i < this.addGlows.length; i++) this.addGlows[i].visible = false;
  }

  hide(): void {
    for (const s of this.cinders) this.release(s);
    for (const s of this.falls) {
      s.id = -1;
      s.fan.group.visible = false;
      s.ball.visible = false;
    }
    for (const m of this.marks) {
      m.id = -1;
      m.chevron.visible = false;
      m.ring.group.visible = false;
    }
    for (const g of this.addGlows) g.visible = false;
    for (let i = 0; i < TRACK; i++) {
      this.trackAge[i] = 99;
      this.track.setMatrixAt(i, _zero);
    }
    this.track.instanceMatrix.needsUpdate = true;
    this.track.visible = false;
  }

  dispose(): void {
    this.track.dispose();
  }
}
