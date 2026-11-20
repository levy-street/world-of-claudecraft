// The Guardian of the Heat's thrown Hearthseeds (pass 4; plan:
// heat_meteor_core.ts), a part of HeatFightFx over its root and particles:
//  - the throw: on the sim's throw cue the body plays its Throw clip
//    (heat_body.ts); here a mass of molten rock gathers between its hands as
//    they scoop the lava and heave it overhead, dripping fire;
//  - the meteors: on the clip's release one meteor per seed leaves the hands
//    (a molten rock, crust plates over a white-gold core, tumbling, a halo,
//    a trail of flame, smoke and sparks) and arcs high to its seed's spot;
//  - the strike: on the sim's landing (its seed cue, or the meteor's own
//    arrival on the same beat) a flash on the spot, two shock rings, lava
//    splashed up, basalt flung, a column of smoke, a short shake, and a
//    crater whose molten cracks cool over seconds.
// The seed's footprint (the fight's one seed field, every tier) is the
// warning a player reads, from the throw on; nothing here carries gameplay:
// the low tier keeps the rocks, their halos and the craters, and thins the
// trails, the splash and the smoke.
//
// Built in the constructor under the host's root (one gated attach), fixed
// pools, no per-frame allocation, no light.

import * as THREE from 'three';
import type { Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { HEAT_FX_GROW, HEAT_YD_PER_UNIT, heatSocketIndex } from './heat_body_core';
import { heatBodySockets } from './heat_body_sockets';
import { HEAT_FIGHT_COLORS as C } from './heat_fight_fx_core';
import { HEAT_FLOOR } from './heat_floor_ladder_core';
import type { HeatFxHost } from './heat_fx_host';
import { HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';
import {
  HEAT_METEOR as M,
  type MeteorLook,
  type MeteorPoint,
  meteorArc,
  meteorCraterLook,
  meteorHash,
  meteorLook,
} from './heat_meteor_core';
import { moltenDecal } from './heat_molten_decal';

/** At most one meteor per seed (the sim's seedCap). */
const POOL = 10;
/** A seed first seen this long after the throw cue still rides that throw. */
const JOIN_SEC = 0.8;
const S_FIST_L = heatSocketIndex('fistL');
const S_FIST_R = heatSocketIndex('fistR');

const _from: MeteorPoint = { x: 0, y: 0, z: 0 };
const _to: MeteorPoint = { x: 0, y: 0, z: 0 };
const _p: MeteorPoint = { x: 0, y: 0, z: 0 };
const _prev: MeteorPoint = { x: 0, y: 0, z: 0 };
const _look: MeteorLook = { gather: 0, flight: -1, landed: false };
const _crater = { flash: 0, glow: 0 };
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _dir: [number, number, number] = [0, 1, 0];

/** A molten rock: plates of dark crust over a white-gold core, its cracks
 *  alight, hotter toward its leading face (vHot), flaring as it gathers. */
const ROCK_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
void main() {
  vP = position;
  mat4 mm = modelMatrix * instanceMatrix;
  vec4 wp = mm * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(mm) * normal);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
const ROCK_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
${HEAT_NOISE_GLSL}
vec3 rockRamp(float m) {
  vec3 crust = vec3(0.06, 0.045, 0.04);
  vec3 ember = vec3(0.5, 0.09, 0.02);
  vec3 orange = vec3(1.0, 0.4, 0.07);
  vec3 gold = vec3(1.0, 0.72, 0.3);
  vec3 c = mix(crust, ember, smoothstep(0.08, 0.35, m));
  c = mix(c, orange, smoothstep(0.32, 0.65, m));
  c = mix(c, gold, smoothstep(0.72, 1.0, m));
  return c * (1.0 + 1.2 * smoothstep(0.5, 1.0, m));
}
void main() {
  // Plates of crust over the molten core: cracks between them, burning.
  vec3 p = vP * 1.6;
  vec2 q = vec2(p.x + 0.6 * p.y, p.z - 0.5 * p.y);
  // Warped, and some seams sealed: plates of uneven size, not a net.
  vec2 wq = q * 0.85 + 3.1 + (vec2(vn(q * 1.3), vn(q * 1.3 + 5.7)) - 0.5) * 1.1;
  float edge = cellEdge(wq);
  float crack = 1.0 - smoothstep(0.03, 0.16, edge);
  crack *= smoothstep(0.22, 0.5, vn(q * 1.7 + 7.0));
  float churn = fbm(q * 2.2 + vec2(uTime * 0.9, -uTime * 0.7));
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(max(1.0 - abs(dot(normalize(vN), V)), 0.0), 2.5);
  float m = max(crack * (0.75 + 0.25 * churn), 0.08 + 0.12 * churn) + rim * 0.35;
  gl_FragColor = vec4(rockRamp(clamp(m, 0.0, 1.0)), 1.0);
  #include <colorspace_fragment>
}
`;
const UV_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
/** The crater a meteor leaves: a scorched bowl, molten cracks splitting out
 *  of it and cooling (uGlow), a white-gold flash at the strike (uFlash). */
const CRATER_FRAG = /* glsl */ `
uniform float uGlow;
uniform float uFlash;
uniform float uSeed;
varying vec2 vUv;
varying vec3 vW;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float rag = vn(vec2(atan(p.y, p.x) * 3.0 + uSeed, uSeed)) * 0.18;
  if (r > 1.0 - rag * 0.5) discard;
  float a = atan(p.y, p.x);
  float k = a / 6.2831853 * 11.0 + uSeed;
  float id = floor(k);
  float wob = (hh2(vec2(id, floor(r * 5.0))) - 0.5) * 0.4;
  float line = abs(fract(k) - 0.5 + wob * 0.35);
  float crack = 1.0 - smoothstep(0.0, 0.05 + 0.05 * (1.0 - r), line * (0.3 + r));
  crack *= step(r, 0.55 + 0.45 * hh2(vec2(id, 5.0)));
  float bowl = 1.0 - smoothstep(0.0, 0.42, r);
  float cells = 1.0 - smoothstep(0.0, 0.08, cellEdge(p * 3.0 + uSeed));
  float m = max(max(crack * 0.95, bowl * 0.85), cells * bowl * 0.6) * uGlow;
  m += uFlash * 0.6 * (1.0 - r);
  vec3 col = mix(vec3(0.045, 0.038, 0.034), molten(clamp(m, 0.0, 1.0)), smoothstep(0.02, 0.2, m));
  float char = (1.0 - smoothstep(0.65, 1.0, r + rag)) * 0.85;
  gl_FragColor = vec4(col, max(char * (0.35 + 0.65 * uGlow), m));
  #include <colorspace_fragment>
}
`;

/** Flame torn off a meteor in flight (orange, on the pyre ramp). */
const TRAIL_FLAME = {
  speed: 0.8,
  up: 1.2,
  life: 0.55,
  size: [3 * HEAT_FX_GROW, 0.6] as [number, number],
  color: [0.6, 0, 0] as const,
  alpha: 0.95,
  pool: 'pyre' as const,
  radius: 0.6,
};
const TRAIL_SMOKE = {
  speed: 0.5,
  up: 0.8,
  life: 1.6,
  size: [1.6, 4.2] as [number, number],
  color: [0.09, 0.075, 0.065] as const,
  alpha: 0.5,
  drag: 0.9,
  radius: 0.6,
};
const TRAIL_SPARK = {
  speed: 2.2,
  up: 0.6,
  life: 0.7,
  size: [0.34, 0.06] as [number, number],
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  gravity: 8,
  radius: 0.6,
};
/** Molten drops falling off the gathered mass in the hands. */
const DRIP = {
  speed: 1.2,
  up: -0.5,
  life: 0.9,
  size: [0.5, 0.15] as [number, number],
  color: C.gold,
  alpha: 1,
  pool: 'glow' as const,
  gravity: 16,
  radius: 1.2,
};

interface MeteorSlot {
  /** The seed object it carries (-1: free). */
  id: number;
  /** The throw it rides (the cue's clock; NaN until its cue is seen). */
  thrown: number;
  /** When its seed came into view. */
  seenAt: number;
  /** Its spot (world) and the hands it left (world, set on the release). */
  x: number;
  z: number;
  y: number;
  fx: number;
  fy: number;
  fz: number;
  launched: boolean;
  landed: boolean;
  spin: number;
}

interface CraterSlot {
  at: number;
  x: number;
  z: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

export class HeatMeteorFx {
  private readonly rocks: THREE.InstancedMesh;
  private readonly glows: THREE.Sprite[] = [];
  private readonly mass: THREE.Sprite;
  private readonly flashes: { at: number; sprite: THREE.Sprite; mat: THREE.SpriteMaterial }[] = [];
  private readonly slots: MeteorSlot[] = [];
  private readonly craters: CraterSlot[] = [];
  /** The last throw cue's clock (-99: none) and where the hands are. */
  private throwAt = -99;
  /** The throw whose release burst has fired (once per throw). */
  private releasedFor = -99;
  /** Any rock drawn last frame (the instance buffer re-uploads only then). */
  private drawn = false;
  private readonly hands = new THREE.Vector3();
  private handsKnown = false;

  constructor(private readonly host: HeatFxHost) {
    // The rocks: a lumpy, faceted boulder (the low tier keeps them).
    const rock = new THREE.IcosahedronGeometry(1, 1);
    const pos = rock.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      const k = 0.78 + 0.4 * meteorHash(Math.round(_v.x * 97), Math.round(_v.y * 89 + _v.z * 61));
      pos.setXYZ(i, _v.x * k, _v.y * k * 0.9, _v.z * k);
    }
    rock.computeVertexNormals();
    host.geometries.push(rock);
    const rockMat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatMeteorRock',
      uniforms: { uTime: host.uTime },
      vertexShader: ROCK_VERT,
      fragmentShader: ROCK_FRAG,
      toneMapped: false,
    });
    host.materials.push(rockMat);
    // POOL meteors and the mass gathered in the hands.
    this.rocks = new THREE.InstancedMesh(rock, rockMat, POOL + 1);
    this.rocks.name = 'smithHeartHeatMeteors';
    this.rocks.frustumCulled = false;
    this.rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i <= POOL; i++) this.rocks.setMatrixAt(i, _zero);
    this.rocks.visible = false;
    host.root.add(this.rocks);
    const glowMat = host.sprite(0xff7a28, 'smithHeartHeatMeteorGlow');
    glowMat.opacity = 0.3;
    for (let i = 0; i < POOL; i++) {
      const g = new THREE.Sprite(glowMat);
      g.visible = false;
      host.root.add(g);
      this.glows.push(g);
      this.slots.push({
        id: -1,
        thrown: -99,
        seenAt: -99,
        x: 0,
        z: 0,
        y: 0,
        fx: 0,
        fy: 0,
        fz: 0,
        launched: false,
        landed: false,
        spin: 0,
      });
    }
    const massMat = host.sprite(0xffb060, 'smithHeartHeatMeteorMass');
    massMat.opacity = 0;
    this.mass = new THREE.Sprite(massMat);
    this.mass.visible = false;
    host.root.add(this.mass);
    // The strikes' flashes (short, on the spot, never a wash).
    for (let i = 0; i < POOL; i++) {
      const mat = host.sprite(0xffd8a0, 'smithHeartHeatMeteorFlash');
      mat.opacity = 0;
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      host.root.add(sprite);
      this.flashes.push({ at: -99, sprite, mat });
    }
    // The craters: char and glow passes on Wakefire's molten rungs (one root,
    // commuting passes: a crater over a band composes the same either way).
    const craterGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    host.geometries.push(craterGeo);
    for (let i = 0; i < POOL; i++) {
      const { mesh, mat } = moltenDecal(
        {
          name: 'smithHeartHeatMeteorCrater',
          geometry: craterGeo,
          vertexShader: UV_VERT,
          fragmentShader: CRATER_FRAG,
          uniforms: {
            uGlow: { value: 0 },
            uFlash: { value: 0 },
            uSeed: { value: meteorHash(i, 7) * 9 },
          },
          charStep: HEAT_FLOOR.zoneChar.step,
          glowStep: HEAT_FLOOR.zoneGlow.step,
        },
        host.materials,
      );
      mesh.visible = false;
      host.root.add(mesh);
      this.craters.push({ at: -99, x: 0, z: 0, mesh, mat });
    }
  }

  private get clock(): number {
    return this.host.uTime.value;
  }

  /** The sim threw the seeds (its throw cue on the guardian). */
  thrown(): void {
    this.throwAt = this.clock;
    // Seeds that came into view a moment before their cue ride this throw.
    for (const s of this.slots) if (s.id >= 0 && Number.isNaN(s.thrown)) s.thrown = this.clock;
  }

  /** A seed object came into view at (x, z) (world): its meteor rides the
   *  throw it came with (a seed seen long after any throw already lies on
   *  the floor: it gets no meteor). */
  seedSeen(id: number, x: number, z: number): void {
    if (this.slots.some((s) => s.id === id)) return;
    const slot = this.slots.find((s) => s.id < 0);
    if (!slot) return;
    slot.id = id;
    slot.seenAt = this.clock;
    slot.thrown = this.clock - this.throwAt <= JOIN_SEC ? this.throwAt : Number.NaN;
    slot.x = x;
    slot.z = z;
    slot.y = this.host.groundY(x, z);
    slot.launched = false;
    slot.landed = false;
    slot.spin = meteorHash(id, 3) * 6.28;
  }

  /** Is this seed still in the air (its orb not yet on the floor)? */
  inFlight(id: number): boolean {
    for (const s of this.slots) if (s.id === id) return !s.landed;
    return false;
  }

  /** The sim landed a seed at (x, z) (world): strike it now if its meteor is
   *  still in the air (the cue and the arrival share a beat). */
  landAt(x: number, z: number): void {
    let best: MeteorSlot | null = null;
    let bestD = 1.5;
    for (const s of this.slots) {
      if (s.id < 0 || s.landed) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) this.strike(best);
    else this.burst(x, z, this.host.groundY(x, z));
  }

  update(guardian: Entity | null, dt: number): void {
    const h = this.host;
    this.readHands(guardian);
    const age = this.clock - this.throwAt;
    const look = meteorLook(age, _look);
    // The molten mass gathering in the hands.
    let flying = 0;
    let carried = false;
    for (const s of this.slots) {
      if (s.id < 0) continue;
      carried = true;
      if (!s.landed && s.launched) flying++;
    }
    const gathering = look.gather > 0 && this.handsKnown && carried;
    // A fixed trail budget shared by everything in the air (ten seeds at most:
    // the trails never crowd the fight's own flames out of their pools).
    const share = 1 / Math.max(1, flying / 3);
    if (gathering) {
      const s = (0.45 + 1.25 * look.gather) * M.size;
      _q.setFromEuler(_e.set(this.clock * 0.7, this.clock * 1.1, 0));
      this.rocks.setMatrixAt(POOL, _m.compose(this.hands, _q, _s.setScalar(s)));
      this.mass.position.copy(this.hands);
      const gs = M.glow * (0.6 + 0.9 * look.gather);
      this.mass.scale.set(gs, gs, 1);
      this.mass.material.opacity = 0.25 + 0.5 * look.gather;
      this.mass.visible = true;
      if (h.rand() < dt * 30 * look.gather * h.density)
        h.particles.puff(this.hands.x, this.hands.y - s, this.hands.z, 1, DRIP);
    } else {
      this.rocks.setMatrixAt(POOL, _zero);
      this.mass.visible = false;
    }
    let shown = gathering;
    for (let i = 0; i < POOL; i++) {
      const s = this.slots[i];
      const g = this.glows[i];
      if (s.id >= 0 && Number.isNaN(s.thrown) && this.clock - s.seenAt > JOIN_SEC) {
        // No throw came with it (a view joined late): it already lies there.
        s.landed = true;
      }
      if (s.id < 0 || s.landed || Number.isNaN(s.thrown)) {
        this.rocks.setMatrixAt(i, _zero);
        g.visible = false;
        continue;
      }
      const sl = meteorLook(this.clock - s.thrown, _look);
      if (sl.landed) {
        this.strike(s);
        this.rocks.setMatrixAt(i, _zero);
        g.visible = false;
        continue;
      }
      if (sl.flight < 0) {
        this.rocks.setMatrixAt(i, _zero);
        g.visible = false;
        continue;
      }
      if (!s.launched) {
        s.launched = true;
        // Each leaves from the mass, spread a little across the hands.
        const spread = (meteorHash(s.id, 5) - 0.5) * 2.4;
        s.fx = this.hands.x + spread;
        s.fy = this.hands.y + meteorHash(s.id, 9);
        s.fz = this.hands.z - spread * 0.5;
        if (this.releasedFor !== s.thrown) {
          this.releasedFor = s.thrown;
          this.release();
        }
      }
      _from.x = s.fx;
      _from.y = s.fy;
      _from.z = s.fz;
      _to.x = s.x;
      _to.y = s.y;
      _to.z = s.z;
      meteorArc(_from, _to, sl.flight, _p);
      meteorArc(_from, _to, Math.max(0, sl.flight - 0.03), _prev);
      const size = M.size * (0.85 + 0.35 * meteorHash(s.id, 11));
      const spin = s.spin + this.clock * 7;
      _q.setFromEuler(_e.set(spin, spin * 0.6, spin * 0.3));
      _a.set(_p.x, _p.y, _p.z);
      this.rocks.setMatrixAt(i, _m.compose(_a, _q, _s.setScalar(size)));
      g.position.copy(_a);
      g.scale.set(M.glow, M.glow, 1);
      g.visible = true;
      shown = true;
      // Its trail: flame, smoke and sparks torn off behind it.
      const d = h.density * share;
      _dir[0] = _prev.x - _p.x;
      _dir[1] = _prev.y - _p.y;
      _dir[2] = _prev.z - _p.z;
      for (let k = 0; k < 2; k++)
        if (h.rand() < dt * 55 * d) h.particles.puff(_p.x, _p.y, _p.z, 1, TRAIL_FLAME);
      if (h.rand() < dt * 30 * d) h.particles.puff(_prev.x, _prev.y, _prev.z, 1, TRAIL_SMOKE);
      if (h.rand() < dt * 30 * d) h.particles.puff(_p.x, _p.y, _p.z, 1, TRAIL_SPARK);
    }
    if (shown || this.drawn) this.rocks.instanceMatrix.needsUpdate = true;
    this.drawn = shown;
    this.rocks.visible = shown;
    this.strikesThisFrame = 0;
    this.paintFlashes();
    this.paintCraters(dt);
  }

  /** Where the hands are this frame (the body's bones; else over the body). */
  private readHands(guardian: Entity | null): void {
    const set = heatBodySockets();
    const l = set?.points[S_FIST_L];
    const r = set?.points[S_FIST_R];
    if (l && r) {
      l.getWorldPosition(_a);
      r.getWorldPosition(_b);
      this.hands.addVectors(_a, _b).multiplyScalar(0.5);
      this.handsKnown = true;
      return;
    }
    if (guardian) {
      const at = fxAnchor(guardian);
      // Over its head, where the clip loads the rock.
      this.hands.set(at.x, at.y + 6 * HEAT_YD_PER_UNIT, at.z);
      this.handsKnown = true;
      return;
    }
    this.handsKnown = false;
  }

  /** The throw leaves the hands: a burst of fire and sparks flung forward. */
  private release(): void {
    const h = this.host;
    const p = this.hands;
    h.particles.puff(p.x, p.y, p.z, Math.round(26 * h.density) + 6, {
      speed: 9,
      up: 4,
      life: 0.6,
      size: [3 * HEAT_FX_GROW, 0.8],
      color: C.gold,
      alpha: 1,
      pool: 'pyre',
      radius: 1.5,
    });
    h.particles.puff(p.x, p.y, p.z, Math.round(30 * h.density) + 6, {
      speed: 14,
      up: 6,
      life: 0.8,
      size: [0.45, 0.08],
      color: C.spark,
      alpha: 1,
      pool: 'glow',
      gravity: 8,
      radius: 1,
    });
    this.flashAt(p.x, p.y, p.z, 9 * HEAT_FX_GROW);
  }

  /** Strikes burst this frame: past a few on one beat, the rest go lighter. */
  private strikesThisFrame = 0;

  private strike(s: MeteorSlot): void {
    if (s.landed) return;
    s.landed = true;
    this.burst(s.x, s.z, s.y);
  }

  /** A meteor strikes the floor at (x, z). */
  private burst(x: number, z: number, y: number): void {
    const h = this.host;
    // Ten seeds can land on one beat: the first few burst whole, the rest light.
    const d = h.density * (this.strikesThisFrame++ < 3 ? 1 : 0.35);
    let c = this.craters[0];
    for (const k of this.craters) if (k.at < c.at) c = k;
    c.at = this.clock;
    c.x = x;
    c.z = z;
    c.mesh.position.set(x, y + 0.05, z);
    c.mesh.scale.set(M.craterR, 1, M.craterR);
    c.mesh.rotation.y = meteorHash(Math.round(x * 7), Math.round(z * 7)) * 6.28;
    c.mesh.visible = true;
    this.flashAt(x, y + 1.5, z, 10);
    // Rings kept small: the seed's own footprint is the warning here.
    h.particles.shockRing(x, z, C.ringGold, M.craterR * 2, 0.6);
    // Lava splashed up out of the crater.
    h.particles.puff(x, y + 0.4, z, Math.round(26 * d) + 6, {
      speed: 8,
      up: 9,
      life: 1.1,
      size: [0.8, 0.22],
      color: C.gold,
      alpha: 1,
      pool: 'glow',
      gravity: 20,
      radius: 1.2,
    });
    // Basalt flung out of it.
    h.particles.puff(x, y + 0.6, z, Math.round(16 * d) + 4, {
      speed: 9,
      up: 7,
      life: 1.2,
      size: [0.7, 0.5],
      color: [0.08, 0.065, 0.055],
      alpha: 1,
      gravity: 22,
      radius: 1,
    });
    // A burst of flame and a column of smoke.
    h.particles.puff(x, y + 0.6, z, Math.round(10 * d) + 3, {
      speed: 3,
      up: 6,
      life: 0.55,
      size: [3.2, 0.8],
      color: C.gold,
      alpha: 1,
      pool: 'pyre',
      radius: 1.4,
    });
    h.particles.puff(x, y + 1, z, Math.round(10 * d) + 2, {
      speed: 1.4,
      up: 3.2,
      life: 2.6,
      size: [2.4, 6.5],
      color: [0.11, 0.095, 0.085],
      alpha: 0.5,
      drag: 0.8,
      radius: 1.6,
    });
    h.shakeNear(x, z, 0.35, 40);
  }

  private flashAt(x: number, y: number, z: number, size: number): void {
    let f = this.flashes[0];
    for (const k of this.flashes) if (k.at < f.at) f = k;
    f.at = this.clock;
    f.sprite.position.set(x, y, z);
    f.sprite.userData.size = size;
    f.sprite.visible = true;
  }

  private paintFlashes(): void {
    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      const k = (this.clock - f.at) / 0.35;
      if (k >= 1) {
        f.sprite.visible = false;
        f.mat.opacity = 0;
        continue;
      }
      const s = (f.sprite.userData.size as number) * (0.6 + 0.6 * k);
      f.sprite.scale.set(s, s, 1);
      f.mat.opacity = 0.55 * (1 - k) * (1 - k);
    }
  }

  private paintCraters(dt: number): void {
    const h = this.host;
    for (const c of this.craters) {
      if (c.at < -50) continue;
      const look = meteorCraterLook(this.clock - c.at, _crater);
      if (look.glow <= 0.005 && look.flash <= 0.005) {
        c.at = -99;
        c.mesh.visible = false;
        continue;
      }
      c.mat.uniforms.uGlow.value = look.glow;
      c.mat.uniforms.uFlash.value = look.flash;
      // A thread of smoke off the cooling crater, and the odd spark.
      if (h.rand() < dt * 3 * look.glow * h.density)
        h.particles.puff(c.x, h.groundY(c.x, c.z) + 0.4, c.z, 1, TRAIL_SMOKE);
      if (h.rand() < dt * 6 * look.glow * h.density)
        h.particles.puff(c.x, h.groundY(c.x, c.z) + 0.2, c.z, 1, TRAIL_SPARK);
    }
  }

  /** A seed gone from the world (burst, or out of view): its slot frees. */
  forget(liveIds: readonly number[]): void {
    for (const s of this.slots)
      if (s.id >= 0 && !liveIds.includes(s.id)) {
        s.id = -1;
        s.landed = false;
      }
  }

  /** The rocks' own instance buffer (their geometry and material are the
   *  host's to dispose). */
  dispose(): void {
    this.rocks.dispose();
  }

  hide(): void {
    this.throwAt = -99;
    for (const s of this.slots) {
      s.id = -1;
      s.landed = false;
    }
    for (let i = 0; i <= POOL; i++) this.rocks.setMatrixAt(i, _zero);
    this.rocks.instanceMatrix.needsUpdate = true;
    this.rocks.visible = false;
    this.mass.visible = false;
    for (const g of this.glows) g.visible = false;
    for (const f of this.flashes) f.sprite.visible = false;
    for (const c of this.craters) {
      c.at = -99;
      c.mesh.visible = false;
    }
  }
}
