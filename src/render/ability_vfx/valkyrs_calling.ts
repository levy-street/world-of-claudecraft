import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  VALKYR_IMPACT_DURATION,
  VALKYR_LAND,
  VALKYR_LAUNCH,
  VALKYR_RETURN,
  VALKYR_VANISH,
} from '../paladin_valkyrs_calling_core';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { effectFloor, GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './effect_floor';
import { type PaladinLocalProbe, paladinFlash } from './paladin_flash';
import { PALADIN_RUNE_GLSL } from './paladin_runes';
import type { BakedKind, FragmentKind } from './production_assets';
import type { CrestKind } from './signature_shapes';

/** The debris half of the flight: dust, stone and camera weight. */
export interface ValkyrGroundHost {
  bakedAt(
    kind: BakedKind,
    x: number,
    y: number,
    z: number,
    size: number,
    tint: number,
    hot: number,
    duration: number,
    delay: number,
    heat: number,
    angle?: number,
  ): boolean;
  fragmentsAt(
    kind: FragmentKind,
    x: number,
    y: number,
    z: number,
    tint: number,
    count: number,
    power: number,
    dx: number,
    dz: number,
    duration?: number,
    fractured?: boolean,
  ): void;
  decalXZ?(
    x: number,
    z: number,
    radius: number,
    colorHex: number,
    style: string,
    dur: number,
  ): void;
  crestAt?(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    tint: number,
    accent: number,
    substance: CrestKind,
    angle?: number,
    duration?: number,
  ): boolean;
  shakeAt(x: number, y: number, z: number, amount: number, crunch?: boolean): void;
}

export const VALKYR_CAPACITY = 4;
const TAKEOFF_RAYS = 6;
const TAKEOFF_SPARKS = 10;
const FEATHERS = 10;
const SKY_RAYS = 4;
const IMPACT_RAYS = 10;
const IMPACT_SPARKS = 24;
/** Rings of air bursting out round the body at the launch. */
const LAUNCH_BOOMS = 2;
/** Motes of light drawn in to the body through the charge. */
const CHARGE_MOTES = 12;
/** Launch glow, departure column, launch flash and booms, takeoff rays and
 * sparks, weapon glint, vanish flash and sky streak, feathers, landing mark,
 * sky shaft and rays, return flash, dive trail, the slash, impact seal,
 * pillar, rays, flare and sparks. */
export const VALKYR_QUADS =
  3 +
  1 +
  LAUNCH_BOOMS +
  CHARGE_MOTES +
  1 +
  1 +
  TAKEOFF_RAYS +
  TAKEOFF_SPARKS +
  3 +
  FEATHERS +
  2 +
  SKY_RAYS +
  2 +
  3 +
  IMPACT_RAYS +
  IMPACT_SPARKS;
const VERTICES = VALKYR_CAPACITY * VALKYR_QUADS * 6;
const GOLD = new THREE.Color(0xe8bb76).multiplyScalar(1.3);
const IVORY = new THREE.Color(0xfff1cc).multiplyScalar(1.5);
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aColor', 'aAlpha', 'aUv', 'aShape', 'aTime'] as const;
const SHAPE = {
  launch: 0,
  mark: 1,
  impact: 2,
  beam: 3,
  flare: 4,
  spark: 5,
  feather: 6,
  slash: 7,
  boom: 8,
} as const;
/** The launch's ground burst, half its width. */
const LAUNCH_SIZE = 4.2;
/** The slash's crescent sweeps down onto the ground over this long. */
const SLASH_SWEEP = 0.09;
/** Dust and stone of the departure and the landing. */
const DUST = 0xb09a78;
const DUST_HOT = 0xf6e4c2;
const STONE = 0xb8a88c;

/** A cancelled flight's mark and light fade out over this long. */
export const VALKYR_CANCEL_FADE = 0.3;
/** The aura ends a tick before the landing event arrives: no cancel this close to touchdown. */
const VALKYR_CANCEL_GRACE = 0.15;

interface Slot {
  active: boolean;
  source: number;
  /** Seconds into the flight. */
  age: number;
  /** Seconds since touchdown, negative while in the air. */
  since: number;
  radius: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  /** Where the Paladin vanished (feathers fall from here). */
  goneX: number;
  goneY: number;
  goneZ: number;
  /** Last seen caster feet and height, for pieces that ride the body. */
  bodyX: number;
  bodyY: number;
  bodyZ: number;
  height: number;
  launched: boolean;
  vanished: boolean;
  /** The launch was seen (a landing joined mid-flight has no mark). */
  flew: boolean;
  /** Seconds since the flight was cancelled in the air, or -1. */
  cancelled: number;
  /** Empowered by Ascension: a second, golden shock follows the slam. */
  gilded: boolean;
}

function ramp(t: number, from: number, to: number): number {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
}
/** Deterministic 0..1 hash for per-piece variety. */
function hash(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Valkyr's Calling, the light half of the flight (the body, wings and pose
 * are the character's own): a glint on the raised weapon, a column of light
 * and a ground burst where the Paladin launches, a flash and a streak into
 * the sky as they vanish with feathers drifting down, a sun mark and light
 * shafts on the landing while they are gone, a flash on the return and a
 * burning trail through the dive, then the slam: a shockwave, light cracks
 * racing through the ground, a pillar and rays of light and sparks. Dust and
 * stone come from the shared baked sprites and fragments.
 */
export class ValkyrsCalling {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'valkyrs_calling'>;
  private readonly slots: Slot[] = Array.from({ length: VALKYR_CAPACITY }, () => ({
    active: false,
    source: -1,
    age: 0,
    since: -1,
    radius: 8,
    fromX: 0,
    fromY: 0,
    fromZ: 0,
    toX: 0,
    toY: 0,
    toZ: 0,
    goneX: 0,
    goneY: 0,
    goneZ: 0,
    bodyX: 0,
    bodyY: 0,
    bodyZ: 0,
    height: 1.8,
    launched: false,
    vanished: false,
    flew: false,
    cancelled: -1,
    gilded: false,
  }));
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly colors = new Float32Array(VERTICES * 3);
  private readonly alphas = new Float32Array(VERTICES);
  private readonly uvs = new Float32Array(VERTICES * 2);
  private readonly shapes = new Float32Array(VERTICES);
  private readonly times = new Float32Array(VERTICES);
  private readonly feet = new THREE.Vector3();
  private readonly top = new THREE.Vector3();
  private vertex = 0;
  /** The fade of the slot being drawn (a cancelled flight's). */
  private dim = 1;
  private time = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly groundY?: (x: number, z: number) => number,
    private readonly camera?: THREE.Camera,
    private readonly host?: ValkyrGroundHost,
    private readonly isLocal?: PaladinLocalProbe,
  ) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, data, size] of [
      ['position', this.positions, 3],
      ['aColor', this.colors, 3],
      ['aAlpha', this.alphas, 1],
      ['aUv', this.uvs, 2],
      ['aShape', this.shapes, 1],
      ['aTime', this.times, 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(data, size).setUsage(THREE.DynamicDrawUsage),
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
        void main() {vColor=aColor;vAlpha=aAlpha;vShape=aShape;vTime=aTime;vUv=aUv;
          // Launch glow, landing mark and impact seal lie on the ground.
          float pull=aShape<2.5?${GROUND_DEPTH_PULL.toFixed(2)}:0.0;
          gl_Position=projectionMatrix*groundPulledView(position,pull);}
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.9,0.68);
        const float PI=3.14159265;
        float sq(float x){return x*x;}
        float band(float r,float at,float w){return exp(-sq((r-at)/w));}
        ${PALADIN_RUNE_GLSL}
        void main() {
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float a=atan(p.y,p.x);
          float mask;
          vec3 color=vColor;
          if(vShape>7.5){
            // Launch boom: a ring of air bursting out round the body, streaked
            // inside, thinning as it spreads.
            float grow=1.0-pow(1.0-clamp(t/0.24,0.0,1.0),3.0);
            float R=0.22+0.72*grow;
            float ring=exp(-sq((r-R)/(0.025+0.05*grow)));
            float inner=exp(-sq((r-R+0.08)/0.1))*0.3;
            float streaks=pow(abs(sin(a*9.0+r*5.0)),10.0)*smoothstep(R-0.35,R-0.02,r)
              *(1.0-smoothstep(R-0.02,R+0.02,r))*0.7;
            mask=(ring*1.3+inner+streaks)*(1.0-grow)*step(0.0,t)*(1.0-smoothstep(0.96,1.0,r));
            color=mix(vColor,HOT,ring*0.7);
          } else if(vShape>6.5){
            // The slash: a crescent of light swept from high behind the head
            // down onto the ground in front, its edge hottest, fading behind.
            float sweep=1.0-sq(1.0-clamp(t/${SLASH_SWEEP.toFixed(2)},0.0,1.0));
            float edgeAt=mix(1.95,-0.95,sweep);
            float behind=a-edgeAt;
            float swept=step(0.0,behind)*step(a,1.95);
            float trail=swept*exp(-behind*mix(3.2,1.1,sweep));
            float w=0.035+0.07*exp(-behind*1.5);
            float blade=exp(-sq((r-0.84)/w));
            float lip=exp(-sq((r-0.9)/0.018))*exp(-behind*3.0)*swept;
            float fade=exp(-max(t-${SLASH_SWEEP.toFixed(2)},0.0)*6.5);
            mask=(blade*trail*0.95+lip*1.3)*fade*(1.0-smoothstep(0.97,1.0,r));
            color=mix(vColor,HOT,clamp(lip+blade*exp(-behind*2.5)*0.6,0.0,1.0));
          } else if(vShape>5.5){
            // Feather: a pointed vane about a hot shaft, faint barbs, a bare quill.
            float along=p.x, across=abs(p.y);
            float w=0.36*pow(max(1.0-along*along,0.0),0.7)*(along<-0.55?0.0:1.0);
            float inside=1.0-smoothstep(w-0.05,w,across);
            float edge=exp(-abs(across-w)*28.0)*step(-0.55,along);
            float barbs=0.6+0.4*sin(along*34.0-across*16.0);
            float shaft=exp(-p.y*p.y*260.0)*(1.0-smoothstep(0.85,0.98,abs(along)));
            mask=inside*0.3*barbs+edge*0.55+shaft*0.9;
            color=mix(vColor,HOT,shaft*0.8+edge*0.3);
          } else if(vShape>4.5){
            // Spark streak: hot head, tail trailing back along its flight.
            float head=exp(-(sq(vUv.x-0.85)*30.0+vUv.y*vUv.y*6.0));
            mask=exp(-vUv.y*vUv.y*5.0)*pow(max(vUv.x,0.0),1.6)*0.8+head;
            color=mix(vColor,HOT,head);
          } else if(vShape>3.5){
            // Flare: white core, soft halo and a long four-point star.
            float core=exp(-r*r*18.0);
            float spokes=exp(-abs(p.y)*34.0)*exp(-abs(p.x)*1.6)+exp(-abs(p.x)*34.0)*exp(-abs(p.y)*1.9);
            vec2 q=vec2(p.x+p.y,p.x-p.y)*0.7071;
            float minor=(exp(-abs(q.y)*40.0)*exp(-abs(q.x)*4.0)+exp(-abs(q.x)*40.0)*exp(-abs(q.y)*4.0))*0.5;
            mask=(core*1.5+exp(-r*r*4.0)*0.3+spokes*0.9*(1.0-smoothstep(0.3,0.95,r))+minor)*(1.0-smoothstep(0.5,1.0,r));
            color=mix(vColor,HOT,core+spokes*0.3);
          } else if(vShape>2.5){
            // Beam of light: hot core, soft body, energy running along it.
            float across=exp(-vUv.y*vUv.y*4.0);
            float core=exp(-vUv.y*vUv.y*40.0);
            float along=smoothstep(0.0,0.05,vUv.x)*pow(max(1.0-vUv.x,0.0),1.1);
            float flow=0.78+0.22*sin(vUv.x*26.0-t*34.0);
            mask=(across*0.45+core)*along*flow;
            color=mix(vColor,HOT,core*0.9);
          } else if(vShape>1.5){
            // The slam: a shockwave, light cracks racing out through the
            // ground, a second ring behind, the rune band lit as the shock
            // passes, and a molten pool at the heart.
            float grow=1.0-pow(max(1.0-clamp(t/0.35,0.0,1.0),0.0),3.0);
            float shock=band(r,0.08+0.88*grow,0.03+0.07*grow)*(1.0-grow*0.55)*exp(-t*2.5);
            float shock2=band(r,0.62*grow,0.02+0.05*grow)*0.5*exp(-t*3.0);
            // Nine jagged cracks of varied length, a constant hairline wide,
            // racing out behind the shock, then cooling to embers.
            float reach=clamp(t/0.22,0.0,1.0);
            float jag=sin(r*13.0+a*3.0)*0.07+sin(r*31.0-a*5.0)*0.035;
            float cell=(a+jag)*9.0/(2.0*PI);
            float id=floor(cell+0.5);
            float across=abs(fract(cell+0.5)-0.5)*2.0*PI*max(r,0.02)/9.0;
            float len=0.42+0.4*fract(sin(id*12.9898)*43758.5453);
            float width=0.006+0.012*(1.0-r);
            float along=smoothstep(0.04,0.1,r)*(1.0-smoothstep(len*reach-0.1,len*reach,r));
            float cracks=(exp(-sq(across/width))+exp(-across/(width*5.0))*0.25)*along;
            float heat=exp(-t*3.5);
            cracks*=(0.35+0.65*heat)*(1.0-smoothstep(0.7,1.3,t));
            float runes=paladinRuneRing(p,0.82,0.93)*smoothstep(0.75,0.95,grow)*exp(-t*3.0)*0.8;
            float pool=exp(-r*r*30.0)*exp(-t*3.0)*0.9+exp(-r*r*5.0)*exp(-t*4.0)*0.2;
            mask=(shock*1.2+shock2+cracks*1.4+runes+pool)*(1.0-smoothstep(0.96,1.0,r));
            color=mix(vColor,HOT,clamp(shock*0.6+pool+cracks*heat,0.0,1.0));
            color=mix(color,vec3(1.0,0.45,0.12),cracks*(1.0-heat)*0.6);
          } else if(vShape>0.5){
            // Landing mark: the rune band, and inside it a sun crown closing on
            // the heart: twelve blades of light pointing in, turning as they
            // close, a counter-turning chain of diamonds behind them, echoes
            // trailing outside, light drawn in along the spokes, and a beat
            // that quickens as the return nears.
            float close=smoothstep(${VALKYR_VANISH.toFixed(2)},${VALKYR_LAND.toFixed(2)},t);
            float ease=close*close;
            float R=mix(0.72,0.14,ease);
            float ring=band(r,0.975,0.012)*1.1+band(r,0.8,0.008)*0.5;
            float runes=paladinRuneRing(p,0.83,0.95)*0.65;
            float spin=t*0.5+ease*2.2;
            float cell=(a+spin)/(PI/6.0);
            float sec=fract(cell)-0.5;
            float bl=0.08+0.06*(1.0-ease);
            float u=(r-R)/bl;
            float inBlade=step(0.0,u)*step(u,1.0);
            float edge=abs(sec)-0.3*clamp(u,0.0,1.0);
            float blade=(1.0-smoothstep(-0.03,0.0,edge))*inBlade;
            float bladeRim=exp(-abs(edge)*45.0)*inBlade;
            float tip=exp(-sq((r-R)/0.014))*exp(-sq(sec*8.0));
            float crown=band(r,R+bl,0.007);
            float sec2=fract((a-spin*1.6)/(PI/12.0))-0.5;
            float chain=1.0-smoothstep(0.6,1.0,abs(r-(R-0.04))/0.02+abs(sec2)/0.2);
            float echo=0.0;
            for(int k=1;k<=3;k++){
              float ck=smoothstep(${VALKYR_VANISH.toFixed(2)},${VALKYR_LAND.toFixed(2)},t-float(k)*0.07);
              echo+=band(r,mix(0.72,0.14,ck*ck)+0.03,0.008)*0.3/float(k);
            }
            float gap=(0.5-abs(sec))*2.0*PI*max(r,0.02)/12.0;
            float flow=0.5+0.5*sin(r*70.0+t*28.0);
            float spoke=exp(-sq(gap/0.005))*flow*smoothstep(R+bl,R+bl+0.04,r)*(1.0-smoothstep(0.74,0.79,r));
            float beat=0.78+0.22*sin(t*(9.0+30.0*close));
            float heart=exp(-r*r*50.0)*ease*1.3+exp(-r*r*3.0)*0.07*close;
            float sun=(blade*0.65+bladeRim*0.9+tip*1.5+crown*0.7)*(0.65+0.7*close)*beat;
            mask=(ring+runes)*(0.5+0.5*close)+sun+chain*0.75+echo+spoke*0.55*(0.3+close)+heart;
            mask*=1.0-smoothstep(0.985,1.0,r);
            color=mix(vColor,HOT,clamp(heart+tip+bladeRim*0.35+chain*0.25,0.0,1.0));
          } else {
            // Departure: light gathers under the feet, then the launch blows
            // a ring out with short cracks and a scorch of light.
            if(t<0.0){
              float g=clamp(1.0+t/${VALKYR_LAUNCH.toFixed(2)},0.0,1.0);
              mask=band(r,mix(0.85,0.25,g*g),0.04)*0.9*g+exp(-r*r*30.0)*g*0.8;
            } else {
              float grow=1.0-pow(max(1.0-clamp(t/0.3,0.0,1.0),0.0),3.0);
              float shock=band(r,0.15+0.8*grow,0.04+0.06*grow)*(1.0-grow*0.8);
              float shock2=band(r,0.1+0.55*grow,0.03+0.04*grow)*0.6*exp(-t*4.0);
              float cracks=pow(abs(sin(a*7.0+sin(a*19.0)*0.7)),60.0)
                *smoothstep(0.05,0.15,r)*(1.0-smoothstep(0.55*grow,0.7*grow+0.01,r))*exp(-t*1.8);
              float scorch=exp(-r*r*10.0)*exp(-t*2.0);
              mask=shock*1.5+shock2+cracks*1.4+scorch*1.1;
            }
            mask*=1.0-smoothstep(0.95,1.0,r);
            color=mix(vColor,HOT,exp(-r*r*20.0));
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    material.name = 'valkyrs_calling:surface';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'valkyrs-calling';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 1);
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([['valkyrs_calling', geometry]]), material);
  }

  private slotFor(source: number): Slot {
    let slot = this.slots.find((s) => s.active && s.source === source);
    if (slot) return slot;
    slot = this.slots[0];
    for (const candidate of this.slots) {
      if (!candidate.active) return candidate;
      if (candidate.age > slot.age) slot = candidate;
    }
    return slot;
  }

  private floorAt(x: number, z: number, feet?: number): number {
    return effectFloor(this.groundY?.(x, z), feet);
  }

  /** The flight begins; (x, z) is where it will come down. */
  launch(source: number, x: number, z: number, radius: number): boolean {
    if (this.disposed || !this.preparation.ready('valkyrs_calling')) return false;
    if (!this.anchor(source, 0, this.feet)) return false;
    const slot = this.slotFor(source);
    slot.active = true;
    slot.source = source;
    slot.age = 0;
    slot.since = -1;
    slot.radius = Number.isFinite(radius) && radius > 0 ? Math.min(radius, 20) : 8;
    slot.fromX = slot.bodyX = this.feet.x;
    slot.fromZ = slot.bodyZ = this.feet.z;
    slot.fromY = slot.bodyY = this.floorAt(this.feet.x, this.feet.z, this.feet.y);
    slot.toX = x;
    slot.toZ = z;
    slot.toY = this.floorAt(x, z);
    slot.height = this.anchor(source, 1, this.top) ? Math.max(1, this.top.y - this.feet.y) : 1.8;
    slot.launched = false;
    slot.vanished = false;
    slot.flew = true;
    slot.cancelled = -1;
    slot.gilded = false;
    return true;
  }

  /** Touchdown at (x, z): the slam. */
  land(source: number, x: number, z: number, radius: number): boolean {
    if (this.disposed || !this.preparation.ready('valkyrs_calling')) return false;
    let slot = this.slots.find((s) => s.active && s.source === source);
    if (!slot) {
      // A landing seen without its launch (joined mid-flight): the slam alone.
      slot = this.slotFor(source);
      slot.active = true;
      slot.source = source;
      slot.launched = slot.vanished = true;
      slot.flew = false;
      slot.cancelled = -1;
      slot.fromX = x;
      slot.fromZ = z;
      slot.fromY = this.floorAt(x, z);
    }
    slot.age = Math.max(slot.age, VALKYR_LAND);
    slot.since = 0;
    slot.gilded = false;
    if (Number.isFinite(radius) && radius > 0) slot.radius = Math.min(radius, 20);
    const feet = this.anchor(source, 0, this.feet);
    slot.toX = x;
    slot.toZ = z;
    slot.toY = this.floorAt(x, z, feet ? feet.y : undefined);
    this.slam(slot);
    return true;
  }

  /** Ascension empowered `source`'s landing (its cue follows the slam). */
  gild(source: number): boolean {
    const slot = this.slots.find((s) => s.active && s.source === source && s.since >= 0);
    if (!slot || slot.since > 0.25) return false;
    slot.gilded = true;
    this.host?.shakeAt(slot.toX, slot.toY, slot.toZ, 0.12);
    return true;
  }

  private takeoff(s: Slot): void {
    const h = this.host;
    if (!h) return;
    // The ground cracks under the push-off, grit is blown out in every
    // direction, a slower cloud hangs where they left, and stones are kicked
    // loose.
    h.decalXZ?.(s.fromX, s.fromZ, 2.4, 0xffffff, 'leap_fracture', 1.2);
    h.crestAt?.(s.fromX, s.fromY, s.fromZ, 0.45, 1, 0x746b60, 0xd9c7a2, 'leap_rupture', 0, 0.7);
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4 + 0.3;
      const x = s.fromX + Math.sin(angle) * 0.9,
        z = s.fromZ + Math.cos(angle) * 0.9;
      h.bakedAt(
        'shout_dust',
        x,
        this.floorAt(x, z) + 0.08,
        z,
        5.2,
        DUST,
        DUST_HOT,
        0.6,
        0,
        0,
        angle,
      );
      if (k % 2 === 0)
        h.fragmentsAt(
          'stone_chip',
          x,
          s.fromY + 0.15,
          z,
          STONE,
          6,
          1.8,
          Math.sin(angle),
          Math.cos(angle),
          0.6,
          true,
        );
    }
    h.bakedAt('smoke', s.fromX, s.fromY + 0.6, s.fromZ, 3.8, DUST, DUST_HOT, 2.6, 0.05, 0);
    h.shakeAt(s.fromX, s.fromY, s.fromZ, 0.3, true);
  }

  private slam(s: Slot): void {
    const h = this.host;
    if (!h) return;
    const r = s.radius,
      scale = r / 6;
    // The ground itself breaks: a fracture decal and slabs heaved up (the
    // Heroic Leap rupture, sized to the slam), dust thrown out in a ring,
    // stones flung, and a cloud left hanging over the crater.
    h.decalXZ?.(s.toX, s.toZ, r * 0.8, 0xffffff, 'leap_fracture', 1.4);
    h.crestAt?.(s.toX, s.toY, s.toZ, scale * 0.7, 1, 0x746b60, 0xd9c7a2, 'leap_rupture', 0, 0.9);
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4 + Math.sin(k * 3.7) * 0.1;
      const at = r * (0.35 + 0.12 * (k % 2));
      const x = s.toX + Math.sin(angle) * at,
        z = s.toZ + Math.cos(angle) * at;
      h.bakedAt(
        'shout_dust',
        x,
        this.floorAt(x, z) + 0.08,
        z,
        (5.5 + (k % 3) * 0.7) * scale,
        DUST,
        DUST_HOT,
        0.8,
        0,
        0,
        angle,
      );
      h.fragmentsAt(
        'stone_chip',
        x,
        s.toY + 0.25,
        z,
        STONE,
        5,
        1.9,
        Math.sin(angle),
        Math.cos(angle),
        0.7,
        true,
      );
    }
    for (let k = 0; k < 4; k++) {
      const angle = (k * Math.PI) / 2 + 0.5;
      h.bakedAt(
        'smoke',
        s.toX + Math.sin(angle) * r * 0.25,
        s.toY + 0.7,
        s.toZ + Math.cos(angle) * r * 0.25,
        4 * scale,
        DUST,
        DUST_HOT,
        2.4,
        0.1 + k * 0.04,
        0,
      );
    }
    h.fragmentsAt('stone_chip', s.toX, s.toY + 0.2, s.toZ, STONE, 12, 3.2, 0, 0, 1.1);
    h.shakeAt(s.toX, s.toY, s.toZ, 0.5, true);
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

  /** Quad about a centre: u runs along `a` (0 at -a), v along `b` (-1 to 1). */
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
    alpha *= this.dim;
    if (alpha <= 0.002) return;
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

  /** Upright beam from `y0` to `y1` (u = 0 at y0), turned to face the camera. */
  private beam(
    x: number,
    z: number,
    y0: number,
    y1: number,
    half: number,
    hx: number,
    hz: number,
    color: THREE.Color,
    alpha: number,
  ): void {
    this.quad(x, (y0 + y1) / 2, z, 0, (y1 - y0) / 2, 0, hx * half, 0, hz * half, color, alpha, 3);
  }

  /** Once a frame per Paladin: whether `source` is still in Valkyr's Calling's
   * flight. A flight that ends in the air (death, or knocked off its path)
   * never lands: its landing mark and light fade at once rather than warning
   * of a strike that will not come. */
  flying(source: number, flying: boolean): void {
    if (flying) return;
    for (const s of this.slots)
      if (
        s.active &&
        s.source === source &&
        s.since < 0 &&
        s.cancelled < 0 &&
        // Touchdown's own frame: the landing event follows the aura's end.
        s.age < VALKYR_LAND - VALKYR_CANCEL_GRACE
      )
        s.cancelled = 0;
  }

  update(dt: number, reduced = false): void {
    if (this.disposed) return;
    this.vertex = 0;
    const e = this.camera?.matrixWorld.elements;
    const rx = e ? e[0] : 1,
      rz = e ? e[2] : 0;
    const rl = Math.hypot(rx, rz) || 1;
    const hx = rx / rl,
      hz = rz / rl;
    const cam = e
      ? [e[0], e[1], e[2], e[4], e[5], e[6], -e[8], -e[9], -e[10]]
      : [1, 0, 0, 0, 1, 0, 0, 0, -1];
    const motion = reduced ? 0.25 : 1;
    const step = Math.max(0, dt);
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += step;
      if (s.since >= 0) s.since += step;
      if (s.cancelled >= 0) {
        s.cancelled += step;
        if (s.cancelled >= VALKYR_CANCEL_FADE) {
          s.active = false;
          continue;
        }
      }
      this.dim = s.cancelled >= 0 ? 1 - s.cancelled / VALKYR_CANCEL_FADE : 1;
      // Done after the slam settles, or a flight that never landed (cancelled).
      if (s.since >= VALKYR_IMPACT_DURATION || (s.since < 0 && s.age > VALKYR_LAND + 0.6)) {
        s.active = false;
        continue;
      }
      const a = s.age;
      if (this.anchor(s.source, 0, this.feet)) {
        s.bodyX = this.feet.x;
        s.bodyY = this.feet.y;
        s.bodyZ = this.feet.z;
      }
      if (!s.launched && a >= VALKYR_LAUNCH) {
        s.launched = true;
        this.takeoff(s);
      }
      if (!s.vanished && a >= VALKYR_VANISH) {
        s.vanished = true;
        s.goneX = s.bodyX;
        s.goneY = s.bodyY + s.height * 0.6;
        s.goneZ = s.bodyZ;
      }
      const h = s.height;
      const chestY = s.bodyY + h * 0.6;

      // --- The charge ------------------------------------------------------
      // Motes of light drawn in off the ground, spiralling up into the
      // crouched body, and a glow building on it, its pulse quickening until
      // the launch spends it all.
      if (a < VALKYR_LAUNCH) {
        const charge = ramp(a, 0.03, VALKYR_LAUNCH);
        this.time = a;
        const pulse = 0.75 + 0.25 * Math.sin(a * (12 + 34 * charge));
        const core = s.bodyY + h * 0.4;
        this.flare(s.bodyX, core, s.bodyZ, 1 + 1.4 * charge, cam, IVORY, charge * pulse * 0.75);
        for (let i = 0; i < CHARGE_MOTES; i++) {
          const life = 0.3 + 0.12 * hash(i, 23);
          const k = ((a + hash(i, 24) * life) % life) / life;
          const ang = i * 2.399963 + k * 2.4;
          const out = (2.6 - 2.35 * k * k) * (0.8 + 0.4 * hash(i, 25)) * motion;
          const c = Math.cos(ang),
            sn = Math.sin(ang);
          this.spark(
            s.fromX + c * out,
            s.fromY + 0.1 + (core - s.fromY) * k * k,
            s.fromZ + sn * out,
            -c * 3 - sn * 2,
            1.5,
            -sn * 3 + c * 2,
            cam,
            i % 2 ? IVORY : GOLD,
            (0.35 + 0.65 * charge) * Math.sin(Math.PI * k),
          );
        }
      }

      // --- Departure -------------------------------------------------------
      this.time = a - VALKYR_LAUNCH;
      const departed = Math.max(0, a - VALKYR_LAUNCH);
      const glow = ramp(a, 0, 0.08) * (1 - ramp(departed, 0.6, 1.4));
      const L = LAUNCH_SIZE;
      this.quad(s.fromX, s.fromY + 0.04, s.fromZ, L, 0, 0, 0, 0, L, GOLD, glow, SHAPE.launch);
      if (a >= VALKYR_LAUNCH) {
        // The push-off: a flash at the feet and rings of air bursting out
        // round the body as it leaves, one at the ground, one higher.
        this.flare(
          s.fromX,
          s.fromY + 0.4,
          s.fromZ,
          2.8,
          cam,
          IVORY,
          Math.exp(-departed * 12) * 1.2,
        );
        for (let i = 0; i < LAUNCH_BOOMS; i++) {
          const t = departed - i * 0.05;
          if (t < 0 || t > 0.26) continue;
          this.time = t;
          const size = (i ? 2.4 : 3.4) * (reduced ? 0.7 : 1);
          const y = s.fromY + (i ? h * 0.9 : 0.25);
          this.quad(s.fromX, y, s.fromZ, size, 0, 0, 0, 0, size, IVORY, 1, SHAPE.boom);
        }
      }
      // The column of light the Paladin rises through.
      this.time = a;
      const column = ramp(a, 0.05, VALKYR_LAUNCH) * (1 - ramp(a, VALKYR_VANISH, 0.8));
      this.beam(s.fromX, s.fromZ, s.fromY, s.fromY + 18, 0.75, hx, hz, GOLD, column * 0.8);
      // Light pouring down from the rising body to the ground.
      const pour = ramp(a, VALKYR_LAUNCH, VALKYR_LAUNCH + 0.06) * (1 - ramp(a, VALKYR_VANISH, 0.7));
      for (let i = 0; i < TAKEOFF_RAYS; i++) {
        const ang = i * 2.399963 + 0.5;
        const off = 0.18 + 0.28 * hash(i, 1);
        const top = Math.max(s.fromY + 0.5, s.bodyY + h * (0.1 + 0.25 * hash(i, 2)));
        this.beam(
          s.fromX + Math.cos(ang) * off,
          s.fromZ + Math.sin(ang) * off,
          top,
          s.fromY,
          0.05 + 0.05 * hash(i, 3),
          hx,
          hz,
          i % 2 ? IVORY : GOLD,
          pour * (0.6 + 0.4 * hash(i, 4)),
        );
      }
      // Sparks thrown up from the launch.
      for (let i = 0; i < TAKEOFF_SPARKS; i++) {
        const life = 0.4 + 0.2 * hash(i, 5);
        const t = departed;
        if (a < VALKYR_LAUNCH || t >= life) continue;
        const ang = i * 2.399963;
        const out = (1.5 + 1.5 * hash(i, 6)) * motion;
        const up = (5 + 4 * hash(i, 7)) * motion;
        const vy = up - 9 * t * motion;
        this.spark(
          s.fromX + Math.cos(ang) * out * t,
          s.fromY + 0.2 + up * t - 4.5 * t * t * motion,
          s.fromZ + Math.sin(ang) * out * t,
          Math.cos(ang) * out,
          vy,
          Math.sin(ang) * out,
          cam,
          i % 2 ? IVORY : GOLD,
          (1 - t / life) ** 1.2,
        );
      }

      // --- On the body -----------------------------------------------------
      // A glint on the weapon raised to the sky.
      const glint =
        ramp(a, VALKYR_LAUNCH - 0.04, VALKYR_LAUNCH + 0.06) *
          (1 - ramp(a, VALKYR_VANISH - 0.05, VALKYR_VANISH)) +
        (a >= VALKYR_RETURN && s.since < 0 ? ramp(a, VALKYR_RETURN, VALKYR_RETURN + 0.1) : 0);
      const glintSize =
        (0.7 + 0.35 * Math.exp(-sq((a - VALKYR_LAUNCH - 0.04) * 12))) * (reduced ? 0.8 : 1);
      this.flare(s.bodyX, s.bodyY + h * 1.16, s.bodyZ, glintSize, cam, IVORY, glint * 1.2);
      // Gone into the light: a flash and a streak shot up into the sky.
      const vanish = s.vanished && s.since < 0 ? Math.max(0, a - VALKYR_VANISH) : -1;
      if (vanish >= 0) {
        const flash = Math.exp(-vanish * 9);
        this.flare(s.goneX, s.goneY, s.goneZ, 2.6, cam, IVORY, flash * 1.0);
        const streak = Math.exp(-vanish * 7);
        const rise = 6 + vanish * 70;
        this.beam(
          s.goneX,
          s.goneZ,
          s.goneY + rise - 10,
          s.goneY + rise + 6,
          0.45 * streak,
          hx,
          hz,
          IVORY,
          streak * 1.4,
        );
        // Feathers drifting down from where they vanished.
        for (let i = 0; i < FEATHERS; i++) {
          const life = 1.2 + 0.5 * hash(i, 8);
          const t = vanish;
          if (t >= life) continue;
          const ang = i * 2.399963 + 1.1;
          const out = (0.5 + 1.1 * hash(i, 9)) * Math.min(1, t * 3) * motion;
          const sway = Math.sin(t * (3 + hash(i, 10) * 2) + i) * 0.35 * motion;
          const fx = s.goneX + Math.cos(ang) * (out + sway);
          const fz = s.goneZ + Math.sin(ang) * (out + sway);
          const fy = s.goneY + 0.6 * hash(i, 11) - (1.6 + 0.8 * hash(i, 12)) * t * motion;
          const spin = i * 1.9 + t * (2 + 2 * hash(i, 13)) * motion;
          const c = Math.cos(spin),
            sn = Math.sin(spin);
          const long = 0.42 + 0.16 * hash(i, 14),
            wide = long * 0.55;
          const fade = Math.min(1, t * 8) * (1 - ramp(t, life * 0.6, life));
          this.quad(
            fx,
            fy,
            fz,
            (cam[0] * c + cam[3] * sn) * long,
            (cam[1] * c + cam[4] * sn) * long,
            (cam[2] * c + cam[5] * sn) * long,
            (cam[3] * c - cam[0] * sn) * wide,
            (cam[4] * c - cam[1] * sn) * wide,
            (cam[5] * c - cam[2] * sn) * wide,
            i % 3 ? GOLD : IVORY,
            fade * 1.1,
            SHAPE.feather,
          );
        }
      }

      // --- The landing, while they are gone ---------------------------------
      this.time = a;
      const r = s.radius;
      const mark = !s.flew
        ? 0
        : s.since < 0
          ? ramp(a, VALKYR_VANISH - 0.1, VALKYR_VANISH + 0.35) *
            (0.55 + 0.45 * ramp(a, VALKYR_RETURN, VALKYR_LAND))
          : 1 - ramp(s.since, 0, 0.12);
      this.quad(s.toX, s.toY + 0.05, s.toZ, r, 0, 0, 0, 0, r, GOLD, mark * 0.85, SHAPE.mark);
      // Light from the sky onto the landing: a soft shaft and a few rays.
      const shaft =
        s.since < 0
          ? ramp(a, VALKYR_VANISH, VALKYR_VANISH + 0.4) *
            (0.5 + 0.5 * ramp(a, VALKYR_RETURN, VALKYR_LAND))
          : 0;
      this.beam(s.toX, s.toZ, s.toY, s.toY + 22, 1.5, hx, hz, GOLD, shaft * 0.45);
      for (let i = 0; i < SKY_RAYS; i++) {
        const ang = i * 1.5708 + 0.8;
        const off = r * (0.18 + 0.2 * hash(i, 15));
        const flick = 0.6 + 0.4 * Math.sin(a * (9 + i * 2.3) + i);
        this.beam(
          s.toX + Math.cos(ang) * off,
          s.toZ + Math.sin(ang) * off,
          s.toY,
          s.toY + 16 + 4 * hash(i, 16),
          0.08,
          hx,
          hz,
          IVORY,
          shaft * flick * 0.45,
        );
      }

      // --- The return and the dive ------------------------------------------
      if (a >= VALKYR_RETURN && s.since < 0) {
        const back = a - VALKYR_RETURN;
        this.flare(s.bodyX, chestY, s.bodyZ, 2.4, cam, IVORY, Math.exp(-back * 8) * 1.1);
        const dive = Math.min(1, back / (VALKYR_LAND - VALKYR_RETURN));
        const trail = (1 + 9 * dive * dive) * motion;
        this.beam(s.bodyX, s.bodyZ, chestY - 0.4, chestY + trail, 0.55, hx, hz, GOLD, 0.35 + dive);
      }

      // --- The slam ----------------------------------------------------------
      if (s.since >= 0) {
        const t = s.since;
        const fade = 1 - ramp(t, VALKYR_IMPACT_DURATION * 0.55, VALKYR_IMPACT_DURATION);
        this.time = t;
        this.quad(
          s.toX,
          s.toY + 0.05,
          s.toZ,
          r * 1.05,
          0,
          0,
          0,
          0,
          r * 1.05,
          GOLD,
          fade * 0.8,
          SHAPE.impact,
        );
        // Gilded by Ascension: a second, golden shock rolls out behind the
        // first, to the same edge (more damage, the same reach).
        if (s.gilded && t > 0.1) {
          this.time = t - 0.1;
          this.quad(s.toX, s.toY + 0.06, s.toZ, r, 0, 0, 0, 0, r, GOLD, fade * 0.75, SHAPE.impact);
          this.time = t;
        }
        // The jumping slash: a crescent following the weapon from high behind
        // the head down onto the ground in front, along the line of the dive.
        let fx = s.toX - s.fromX,
          fz = s.toZ - s.fromZ;
        const fl = Math.hypot(fx, fz);
        if (fl > 0.5) {
          fx /= fl;
          fz /= fl;
        } else {
          fx = cam[6];
          fz = cam[8];
          const cl = Math.hypot(fx, fz) || 1;
          fx /= cl;
          fz /= cl;
        }
        const R = h * 0.95;
        this.quad(
          s.toX + fx * 0.15,
          s.toY + h * 0.75,
          s.toZ + fz * 0.15,
          fx * R,
          0,
          fz * R,
          0,
          R,
          0,
          IVORY,
          1.3,
          SHAPE.slash,
        );
        // The slam's flash builds and peaks under the shared limit (paladin_flash.ts).
        const flash = paladinFlash(t, this.isLocal?.(s.source) ?? true);
        const pillar = Math.exp(-t * 6) * (reduced ? 0.5 : 0.85) * flash;
        const pillarHalf = 1.4 * (1 - 0.55 * Math.min(1, t / 0.35));
        this.beam(s.toX, s.toZ, s.toY, s.toY + 16, pillarHalf, hx, hz, IVORY, pillar);
        this.flare(s.toX, s.toY + 1.1, s.toZ, 4, cam, IVORY, Math.exp(-t * 9) * 1.1 * flash);
        // Rays of light bursting up as the shock passes over them.
        for (let i = 0; i < IMPACT_RAYS; i++) {
          const ang = i * 2.399963 + 0.2;
          const at = r * (0.22 + 0.5 * hash(i, 17));
          const when = (at / r) * 0.3;
          const ray = t < when ? 0 : Math.exp(-(t - when) * 5.5);
          const tall = (3 + 4 * hash(i, 18)) * (0.4 + 0.6 * Math.min(1, (t - when) * 6 + 0.2));
          this.beam(
            s.toX + Math.cos(ang) * at,
            s.toZ + Math.sin(ang) * at,
            s.toY,
            s.toY + tall,
            0.12 + 0.1 * hash(i, 19),
            hx,
            hz,
            i % 2 ? IVORY : GOLD,
            ray * 1.1,
          );
        }
        for (let i = 0; i < IMPACT_SPARKS; i++) {
          const life = 0.45 + 0.25 * hash(i, 20);
          if (t >= life) continue;
          const ang = i * 2.399963;
          const out = (4 + 5 * hash(i, 21)) * motion;
          const up = (3 + 5 * hash(i, 22)) * motion;
          this.spark(
            s.toX + Math.cos(ang) * out * t,
            s.toY + 0.3 + up * t - 4.5 * t * t * motion,
            s.toZ + Math.sin(ang) * out * t,
            Math.cos(ang) * out,
            up - 9 * t * motion,
            Math.sin(ang) * out,
            cam,
            i % 2 ? IVORY : GOLD,
            (1 - t / life) ** 1.2 * 1.2,
          );
        }
      }
    }
    this.dim = 1;
    this.mesh.geometry.setDrawRange(0, this.vertex);
    this.mesh.visible = this.vertex > 0;
    if (this.vertex)
      for (const name of ATTRIBUTES) {
        const attr = this.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, this.vertex * attr.itemSize);
        attr.needsUpdate = true;
      }
  }

  private flare(
    x: number,
    y: number,
    z: number,
    size: number,
    cam: number[],
    color: THREE.Color,
    alpha: number,
  ): void {
    this.quad(
      x,
      y,
      z,
      cam[0] * size,
      cam[1] * size,
      cam[2] * size,
      cam[3] * size,
      cam[4] * size,
      cam[5] * size,
      color,
      alpha,
      SHAPE.flare,
    );
  }

  /** A spark streak at (x, y, z) trailing back along its velocity. */
  private spark(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    cam: number[],
    color: THREE.Color,
    alpha: number,
  ): void {
    const speed = Math.hypot(vx, vy, vz) || 1;
    const ax = vx / speed,
      ay = vy / speed,
      az = vz / speed;
    const streak = Math.min(0.6, Math.max(0.18, speed * 0.08)) * 0.5;
    let px = ay * cam[8] - az * cam[7],
      py = az * cam[6] - ax * cam[8],
      pz = ax * cam[7] - ay * cam[6];
    const pl = Math.hypot(px, py, pz) || 1;
    px = (px / pl) * 0.06;
    py = (py / pl) * 0.06;
    pz = (pz / pl) * 0.06;
    this.quad(
      x - ax * streak,
      y - ay * streak,
      z - az * streak,
      ax * streak,
      ay * streak,
      az * streak,
      px,
      py,
      pz,
      color,
      alpha,
      SHAPE.spark,
    );
  }

  clear(): void {
    for (const slot of this.slots) slot.active = false;
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
    if (errors.length) throw new AggregateError(errors, "Valkyr's Calling cleanup failed");
  }
}

function sq(x: number): number {
  return x * x;
}
