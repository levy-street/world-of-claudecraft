import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { effectFloor, GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './effect_floor';

export const SOLAR_RUNNERS = 6;
/** Stride between sun-prints, in yards, and how long one burns. */
export const SOLAR_STRIDE = 1.15;
export const SOLAR_PRINT_LIFE = 0.9;
export const SOLAR_PRINTS = 48;
export const SOLAR_EMBERS = 60;
export const SOLAR_EMBER_LIFE = 0.5;
/** The comet ribbon remembers this much of the path. */
export const SOLAR_TRAIL_SECONDS = 0.32;
export const SOLAR_TRAIL_POINTS = 14;
export const SOLAR_IGNITE_DURATION = 0.6;

const RIBBON_QUADS = SOLAR_TRAIL_POINTS - 1;
/** Per runner: ribbon, ignition burst and flare, body glow, the steadfast ring. */
const RUNNER_QUADS = RIBBON_QUADS + 4;
const VERTICES = (SOLAR_RUNNERS * RUNNER_QUADS + SOLAR_PRINTS + SOLAR_EMBERS) * 6;
const GOLD = new THREE.Color(0xe8bb76).multiplyScalar(1.3);
const IVORY = new THREE.Color(0xfff1cc).multiplyScalar(1.5);
const EMBER = new THREE.Color(0xffa94a).multiplyScalar(1.4);
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aColor', 'aAlpha', 'aUv', 'aShape', 'aTime'] as const;
const SHAPE = { print: 0, ignite: 1, ring: 2, ribbon: 3, flare: 4, ember: 5 } as const;

interface Runner {
  active: boolean;
  id: number;
  seen: boolean;
  /** Presence of the sprint visuals, easing in and out. */
  presence: number;
  /** Seconds since ignition (the cast), or -1 without one. */
  ignite: number;
  steadfast: number;
  x: number;
  y: number;
  z: number;
  floor: number;
  heading: number;
  stride: number;
  side: number;
  /** Path history: x, y, z, age per point, newest first. */
  trail: Float32Array;
  points: number;
  emberDebt: number;
}
interface Print {
  x: number;
  y: number;
  z: number;
  heading: number;
  age: number;
}
interface Ember {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
}

function ramp(t: number, from: number, to: number): number {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

/**
 * Solar Step: the Paladin runs on sunlight. The cast ignites a small sun at
 * the feet; while the sprint lasts every stride burns a sun-print into the
 * ground, embers kick up behind the heels and a comet ribbon of light streams
 * from the body. Steadfast Step's slow immunity shows as a turning ring of
 * gold at the feet. One pooled draw, textureless, no per-frame allocations.
 */
export class SolarStep {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'solar_step'>;
  private readonly runners: Runner[] = Array.from({ length: SOLAR_RUNNERS }, () => ({
    active: false,
    id: -1,
    seen: false,
    presence: 0,
    ignite: -1,
    steadfast: 0,
    x: 0,
    y: 0,
    z: 0,
    floor: 0,
    heading: 0,
    stride: 0,
    side: 1,
    trail: new Float32Array(SOLAR_TRAIL_POINTS * 4),
    points: 0,
    emberDebt: 0,
  }));
  private readonly prints: Print[] = [];
  private readonly printPool: Print[] = Array.from({ length: SOLAR_PRINTS }, () => ({
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    age: 0,
  }));
  private readonly embers: Ember[] = [];
  private readonly emberPool: Ember[] = Array.from({ length: SOLAR_EMBERS }, () => ({
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    age: 0,
  }));
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly colors = new Float32Array(VERTICES * 3);
  private readonly alphas = new Float32Array(VERTICES);
  private readonly uvs = new Float32Array(VERTICES * 2);
  private readonly shapes = new Float32Array(VERTICES);
  private readonly times = new Float32Array(VERTICES);
  private readonly at = new THREE.Vector3();
  private readonly cam = [1, 0, 0, 0, 1, 0, 0, 0, -1];
  private vertex = 0;
  private time = 0;
  private clock = 0;
  private emberSeed = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly groundY?: (x: number, z: number) => number,
    private readonly camera?: THREE.Camera,
  ) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, array, size] of [
      ['position', this.positions, 3],
      ['aColor', this.colors, 3],
      ['aAlpha', this.alphas, 1],
      ['aUv', this.uvs, 2],
      ['aShape', this.shapes, 1],
      ['aTime', this.times, 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage),
      );
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `
        attribute vec3 aColor; attribute float aAlpha, aShape, aTime; attribute vec2 aUv;
        varying vec3 vColor; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        ${GROUND_DEPTH_PULL_GLSL}
        void main(){vColor=aColor;vAlpha=aAlpha;vShape=aShape;vTime=aTime;vUv=aUv;
          // Prints, the ignition and the steadfast ring lie on the ground.
          float pull=aShape<2.5?${GROUND_DEPTH_PULL.toFixed(2)}:0.0;
          gl_Position=projectionMatrix*groundPulledView(position,pull);}
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.92,0.72);
        const vec3 AMBER=vec3(1.0,0.5,0.15);
        const float PI=3.14159265;
        float sq(float x){return x*x;}
        float band(float r,float at,float w){return exp(-sq((r-at)/w));}
        void main(){
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float a=atan(p.y,p.x);
          float mask;
          vec3 color=vColor;
          if(vShape>4.5){
            // Ember streak: hot head, tail back along its flight.
            float head=exp(-(sq(vUv.x-0.85)*30.0+vUv.y*vUv.y*6.0));
            mask=exp(-vUv.y*vUv.y*5.0)*pow(max(vUv.x,0.0),1.6)*0.8+head;
            color=mix(vColor,HOT,head);
          } else if(vShape>3.5){
            // Flare: white core, round halo, a soft four-point star.
            float core=exp(-r*r*18.0);
            float spokes=exp(-abs(p.y)*30.0)*exp(-abs(p.x)*2.0)+exp(-abs(p.x)*30.0)*exp(-abs(p.y)*2.2);
            mask=(core*1.5+exp(-r*r*5.0)*0.35+spokes*0.7)*(1.0-smoothstep(0.7,1.0,r));
            color=mix(vColor,HOT,core+spokes*0.3);
          } else if(vShape>2.5){
            // Comet ribbon: a hot core line, a soft sheet, light racing back along it.
            float across=exp(-vUv.y*vUv.y*3.0);
            float core=exp(-vUv.y*vUv.y*30.0);
            float flow=0.7+0.3*sin(t*40.0-vUv.x*6.0);
            mask=(across*0.55+core*1.1)*flow;
            color=mix(vColor,HOT,core*0.8);
          } else if(vShape>1.5){
            // Steadfast: a ring of gold with turning notches at the feet.
            float notch=0.6+0.4*step(0.5,fract(a/(PI/6.0)+t*0.8));
            mask=(band(r,0.85,0.035)*notch+band(r,0.62,0.02)*0.5)*(1.0-smoothstep(0.96,1.0,r));
            color=mix(vColor,HOT,0.3);
          } else if(vShape>0.5){
            // Ignition: a sun opens at the feet, rays race out, a ring leaves the rim.
            float grow=1.0-sq(max(1.0-clamp(t/0.25,0.0,1.0),0.0));
            float rays=pow(max(cos(a*6.0),0.0),10.0)*smoothstep(0.1,0.2,r)*(1.0-smoothstep(0.4*grow+0.2,0.9*grow+0.1,r));
            float disc=exp(-r*r*16.0)*exp(-t*4.0)*1.4;
            float ring=band(r,0.2+0.75*grow,0.03+0.03*grow)*(1.0-grow*0.6);
            mask=(rays*0.9+disc+ring)*exp(-t*2.0)*(1.0-smoothstep(0.95,1.0,r));
            color=mix(vColor,HOT,disc+ring*0.5);
          } else {
            // Sun-print: a small burning sun pressed into the ground, pointed
            // along the stride, cooling from white-gold to ember.
            float disc=1.0-smoothstep(0.3,0.36,r);
            float rim=band(r,0.34,0.03);
            float rays=pow(max(cos(a*4.0),0.0),14.0)*smoothstep(0.34,0.42,r)*(1.0-smoothstep(0.7,0.95,r));
            float heat=exp(-t*5.0);
            mask=(disc*0.6+rim*1.1+rays*0.9)*(0.45+0.75*heat)+exp(-r*r*8.0)*heat*1.1;
            color=mix(mix(AMBER,vColor,0.4+0.6*heat),HOT,heat*rim);
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'solar-step';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 1);
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([['solar_step', geometry]]), material);
  }

  private runner(id: number, claim: boolean): Runner | null {
    const found = this.runners.find((r) => r.active && r.id === id);
    if (found || !claim) return found ?? null;
    let slot = this.runners.find((r) => !r.active);
    if (!slot) {
      slot = this.runners[0];
      for (const r of this.runners) if (r.presence < slot.presence) slot = r;
    }
    if (!this.anchor(id, 0, this.at)) return null;
    slot.active = true;
    slot.id = id;
    slot.presence = 0;
    slot.ignite = -1;
    slot.steadfast = 0;
    slot.x = this.at.x;
    slot.y = this.at.y;
    slot.z = this.at.z;
    slot.floor = effectFloor(this.groundY?.(this.at.x, this.at.z), this.at.y);
    slot.stride = 0;
    slot.points = 0;
    slot.emberDebt = 0;
    return slot;
  }

  /** The cast: a sun ignites at the feet. */
  ignite(id: number): boolean {
    if (this.disposed || !this.preparation.ready('solar_step')) return false;
    const r = this.runner(id, true);
    if (!r) return false;
    r.ignite = 0;
    r.seen = true;
    return true;
  }

  /** Once a frame while the sprint aura is up; `steadfast` while slows can't hold them. */
  sprint(id: number, steadfast: boolean): void {
    if (this.disposed || !this.preparation.ready('solar_step')) return;
    const r = this.runner(id, true);
    if (!r) return;
    r.seen = true;
    r.steadfast = steadfast ? 1 : 0;
  }

  private put(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
  ): void {
    const i = this.vertex++;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.colors[i * 3] = color.r;
    this.colors[i * 3 + 1] = color.g;
    this.colors[i * 3 + 2] = color.b;
    this.alphas[i] = Math.max(0, alpha);
    this.uvs[i * 2] = u;
    this.uvs[i * 2 + 1] = v;
    this.shapes[i] = shape;
    this.times[i] = this.time;
  }

  private quad(
    x: number,
    y: number,
    z: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
  ): void {
    if (!(alpha > 0.002) || this.vertex + 6 > VERTICES) return;
    for (let c = 0; c < 6; c++) {
      const u = CORNERS[c * 2],
        side = CORNERS[c * 2 + 1],
        along = u * 2 - 1;
      this.put(
        x + ax * along + bx * side,
        y + ay * along + by * side,
        z + az * along + bz * side,
        u,
        side,
        color,
        alpha,
        shape,
      );
    }
  }

  update(dt: number, reduced = false): void {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
    this.vertex = 0;
    const e = this.camera?.matrixWorld.elements;
    const c = this.cam;
    if (e) {
      c[0] = e[0];
      c[1] = e[1];
      c[2] = e[2];
      c[3] = e[4];
      c[4] = e[5];
      c[5] = e[6];
      c[6] = -e[8];
      c[7] = -e[9];
      c[8] = -e[10];
    }
    for (const r of this.runners) if (r.active) this.run(r, dt, reduced);
    // Sun-prints burn out where they were pressed.
    for (let i = this.prints.length - 1; i >= 0; i--) {
      const p = this.prints[i];
      p.age += dt;
      if (p.age >= SOLAR_PRINT_LIFE) {
        this.printPool.push(p);
        this.prints.splice(i, 1);
        continue;
      }
      const fade = 1 - ramp(p.age, SOLAR_PRINT_LIFE * 0.4, SOLAR_PRINT_LIFE);
      const fx = Math.sin(p.heading) * 0.6,
        fz = Math.cos(p.heading) * 0.6;
      this.time = p.age;
      this.quad(p.x, p.y + 0.03, p.z, fx, 0, fz, fz, 0, -fx, GOLD, fade, SHAPE.print);
    }
    // Embers rise and drift back.
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const m = this.embers[i];
      m.age += dt;
      if (m.age >= SOLAR_EMBER_LIFE) {
        this.emberPool.push(m);
        this.embers.splice(i, 1);
        continue;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      m.vy += 1.2 * dt;
      m.vx *= 1 - 2 * dt;
      m.vz *= 1 - 2 * dt;
      this.streak(
        m.x,
        m.y,
        m.z,
        m.vx,
        m.vy,
        m.vz,
        0.32,
        0.05,
        EMBER,
        (1 - m.age / SOLAR_EMBER_LIFE) * 1.4,
      );
    }
    this.mesh.geometry.setDrawRange(0, this.vertex);
    this.mesh.visible = this.vertex > 0;
    for (const name of ATTRIBUTES) {
      const attr = this.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      if (this.vertex) {
        attr.addUpdateRange(0, this.vertex * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
  }

  private run(r: Runner, dt: number, reduced: boolean): void {
    r.presence = r.seen ? Math.min(1, r.presence + dt * 6) : Math.max(0, r.presence - dt * 3);
    r.seen = false;
    if (r.ignite >= 0) r.ignite += dt;
    const igniting = r.ignite >= 0 && r.ignite < SOLAR_IGNITE_DURATION;
    if (r.presence <= 0 && !igniting) {
      r.active = false;
      return;
    }
    if (!this.anchor(r.id, 0, this.at)) {
      r.active = false;
      return;
    }
    const x = this.at.x,
      y = this.at.y,
      z = this.at.z;
    const dx = x - r.x,
      dz = z - r.z;
    const moved = Math.hypot(dx, dz);
    // A teleport (or a respawn) is not a stride.
    const step = moved < 3 ? moved : 0;
    if (moved > 1e-4) r.heading = Math.atan2(dx, dz);
    r.x = x;
    r.y = y;
    r.z = z;
    r.floor = effectFloor(this.groundY?.(x, z), y);
    const k = r.presence;
    const running = step > 0.002 ? 1 : 0;
    // Strides burn sun-prints, alternating feet.
    if (k > 0.3) {
      r.stride += step;
      while (r.stride >= SOLAR_STRIDE) {
        r.stride -= SOLAR_STRIDE;
        r.side = -r.side;
        const p = this.printPool.pop() ?? this.prints.shift();
        if (!p) break;
        const s = Math.sin(r.heading),
          co = Math.cos(r.heading);
        p.x = x + co * 0.2 * r.side;
        p.z = z - s * 0.2 * r.side;
        p.y = r.floor;
        p.heading = r.heading;
        p.age = 0;
        this.prints.push(p);
      }
    }
    // Embers kicked up behind the heels while running.
    if (!reduced && k > 0.3 && running) {
      r.emberDebt += dt * 40;
      while (r.emberDebt >= 1) {
        r.emberDebt -= 1;
        const m = this.emberPool.pop() ?? this.embers.shift();
        if (!m) break;
        const seed = this.emberSeed++;
        const jitter = Math.sin(seed * 12.9898) * 43758.5453;
        const j = jitter - Math.floor(jitter);
        // Kicked back behind the stride, spread a little to either side.
        const hs = Math.sin(r.heading),
          hc = Math.cos(r.heading);
        const back = -hs * 2 + hc * (j - 0.5) * 1.2,
          backZ = -hc * 2 - hs * (j - 0.5) * 1.2;
        m.x = x + (j - 0.5) * 0.4;
        m.z = z + (0.5 - j) * 0.4;
        m.y = r.floor + 0.08;
        m.vx = back;
        m.vz = backZ;
        m.vy = 1.2 + j * 1.6;
        m.age = 0;
        this.embers.push(m);
      }
    }
    // Remember the path for the comet ribbon (newest first).
    const trail = r.trail;
    for (let i = 0; i < r.points; i++) trail[i * 4 + 3] += dt;
    if (moved >= 3) r.points = 0;
    if (r.points === 0 || Math.hypot(trail[0] - x, trail[2] - z) > 0.05) {
      trail.copyWithin(4, 0, (SOLAR_TRAIL_POINTS - 1) * 4);
      r.points = Math.min(SOLAR_TRAIL_POINTS, r.points + 1);
    }
    trail[0] = x;
    trail[1] = y;
    trail[2] = z;
    trail[3] = 0;
    while (r.points > 1 && trail[(r.points - 1) * 4 + 3] > SOLAR_TRAIL_SECONDS) r.points--;
    const height = this.anchor(r.id, 0.5, this.at) ? this.at.y - y : 0.9;
    if (!reduced) this.ribbon(r, height, k);
    // The ignition sun at the feet, and a flare at the heart.
    if (igniting) {
      this.time = r.ignite;
      this.quad(x, r.floor + 0.04, z, 2.3, 0, 0, 0, 0, 2.3, GOLD, 1.2, SHAPE.ignite);
      const cam = this.cam;
      const size = 1.8,
        flare = Math.exp(-r.ignite * 7) * 1.4;
      this.quad(
        x,
        y + height,
        z,
        cam[0] * size,
        cam[1] * size,
        cam[2] * size,
        cam[3] * size,
        cam[4] * size,
        cam[5] * size,
        IVORY,
        flare,
        SHAPE.flare,
      );
    }
    // The runner burns with sunlight while the sprint lasts.
    if (k > 0) {
      const cam = this.cam;
      const size = 1.05,
        glow = k * (0.3 + 0.08 * Math.sin(this.clock * 17));
      this.quad(
        x,
        y + height,
        z,
        cam[0] * size,
        cam[1] * size,
        cam[2] * size,
        cam[3] * size,
        cam[4] * size,
        cam[5] * size,
        GOLD,
        glow,
        SHAPE.flare,
      );
    }
    if (r.steadfast > 0) {
      this.time = this.clock;
      this.quad(x, r.floor + 0.045, z, 0.75, 0, 0, 0, 0, 0.75, GOLD, k * 0.8, SHAPE.ring);
    }
  }

  /** A comet ribbon through the remembered path at waist height, tapering back. */
  private ribbon(r: Runner, height: number, k: number): void {
    const trail = r.trail,
      c = this.cam;
    this.time = this.clock;
    for (let i = 0; i + 1 < r.points; i++) {
      const a = i * 4,
        b = a + 4;
      const ax = trail[a],
        ay = trail[a + 1] + height,
        az = trail[a + 2];
      const bx = trail[b],
        by = trail[b + 1] + height,
        bz = trail[b + 2];
      const dx = bx - ax,
        dy = by - ay,
        dz = bz - az;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-4) continue;
      let px = dy * c[8] - dz * c[7],
        py = dz * c[6] - dx * c[8],
        pz = dx * c[7] - dy * c[6];
      const pl = Math.hypot(px, py, pz) || 1;
      const u0 = i / (SOLAR_TRAIL_POINTS - 1),
        u1 = (i + 1) / (SOLAR_TRAIL_POINTS - 1);
      const w0 = 0.42 * (1 - u0 * 0.85),
        w1 = 0.42 * (1 - u1 * 0.85);
      px /= pl;
      py /= pl;
      pz /= pl;
      const fade0 = (1 - trail[a + 3] / SOLAR_TRAIL_SECONDS) * k,
        fade1 = (1 - trail[b + 3] / SOLAR_TRAIL_SECONDS) * k;
      if (!(fade0 > 0.002) || this.vertex + 6 > VERTICES) continue;
      for (let q = 0; q < 6; q++) {
        const end = CORNERS[q * 2],
          side = CORNERS[q * 2 + 1];
        const w = end ? w1 : w0;
        this.put(
          (end ? bx : ax) + px * w * side,
          (end ? by : ay) + py * w * side,
          (end ? bz : az) + pz * w * side,
          end ? u1 : u0,
          side,
          GOLD,
          Math.max(0, end ? fade1 : fade0),
          SHAPE.ribbon,
        );
      }
    }
  }

  private streak(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    length: number,
    width: number,
    color: THREE.Color,
    alpha: number,
  ): void {
    const c = this.cam;
    const speed = Math.hypot(vx, vy, vz) || 1;
    const ax = vx / speed,
      ay = vy / speed,
      az = vz / speed;
    let px = ay * c[8] - az * c[7],
      py = az * c[6] - ax * c[8],
      pz = ax * c[7] - ay * c[6];
    const pl = Math.hypot(px, py, pz) || 1;
    px = (px / pl) * width;
    py = (py / pl) * width;
    pz = (pz / pl) * width;
    const h = length / 2;
    this.quad(
      x - ax * h,
      y - ay * h,
      z - az * h,
      ax * h,
      ay * h,
      az * h,
      px,
      py,
      pz,
      color,
      alpha,
      SHAPE.ember,
    );
  }

  clear(): void {
    for (const r of this.runners) r.active = false;
    this.printPool.push(...this.prints.splice(0));
    this.emberPool.push(...this.embers.splice(0));
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    const errors: unknown[] = [];
    for (const release of [
      () => this.preparation.dispose(),
      () => this.mesh.removeFromParent(),
      () => this.mesh.geometry.dispose(),
      () => this.mesh.material.dispose(),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Solar Step cleanup failed');
  }
}
