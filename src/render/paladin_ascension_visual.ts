import * as THREE from 'three';
import { MAX_ASCENSION_CHARGES } from '../sim/paladin_devotion';
import { paladinFlash } from './ability_vfx/paladin_flash';
import { paladinVfxDetailNow } from './ability_vfx/paladin_vfx_detail';
import {
  type PaladinVfxDetail,
  paladinDetailCount,
  paladinDetailLinger,
  paladinDetailScale,
} from './ability_vfx/paladin_vfx_detail_core';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import type { PaladinAscensionVisualPlan } from './paladin_ascension_core';
import {
  type PaladinAvengingWrathVisual,
  syncPaladinAvengingWrathVisual,
} from './paladin_avenging_wrath_visual';
import { PALADIN_BODY_FIT } from './paladin_body_fit';

// Detail: core = the sun halo with its charge orbs, the inner rune circle with
// its charge marks, and the wing silhouette (paladin_avenging_wrath_visual's
// primaries and secondaries); secondary = the column of light crashing down and
// the wings' coverts; accents = the halo's forming bloom. The rising motes thin
// with paladinDetailCount and the exit fade scales with paladinDetailLinger.
// The detail is read as Ascension begins and held until it next begins.

const REFERENCE_HEIGHT = 1.8;
/** Seconds the column of light takes to crash down on the Paladin. */
export const ASCENSION_DROP = 0.18;
/** Seconds by which the column has faded away: it blazes only as it lands. */
export const ASCENSION_PILLAR_FADE = 0.6;
/** Seconds the whole ascension (column, shock, halo forming) takes to settle. */
export const ASCENSION_ENTRANCE = 1.3;
/** Seconds the halo and circle take to fade once Ascension ends. */
export const ASCENSION_EXIT = 0.6;
/** How high the Paladin is borne up while ascended, before the size scale. */
const LIFT = 0.14;
const BOB = 0.03;
const PILLAR_HEIGHT = 30;
const MOTES = 28;
/** The halo's centre, as a share of character height: behind the head. */
const HALO_HEIGHT = 0.9;
const HALO_SCALE = 0.85;
/** Avenging Wrath's wings (paladin_avenging_wrath_visual) sit at the shoulders
 * height * 0.62. With both spread, Ascension's pair drops to a lower set, this
 * share of height down, a little smaller and swept downward. */
const LOWER_WINGS_SIZE = 0.68;
const LOWER_WINGS_TILT = 0.85;
/** Seconds for an orb to kindle as the halo forms, and to go out when spent. */
const ORB_KINDLE = 0.25;
const ORB_FADE = 0.3;
/** Seconds for the halo, circle and wings to burn out with the Paladin at
 * Valkyr's Calling's vanish, and to return with them over the landing. */
const VANISH_FADE = 0.1;
const RETURN_FADE = 0.15;
/** The charge-spent pulse: seconds for it to run from the inner ring to the rim. */
export const ASCENSION_SPEND_PULSE = 0.35;

/**
 * The order the orbs go out, as slot indices left to right: from the outside
 * in, the right end then the left, so the centre orb shines last.
 */
export function ascensionRemovalOrder(slots: number): number[] {
  const order: number[] = [];
  for (let left = 0, right = slots - 1; left <= right; left++, right--) {
    order.push(right);
    if (left !== right) order.push(left);
  }
  return order;
}

/** Copy `source` over the front of `target` in place (a uniform array). */
function copyInto(target: number[], source: readonly number[]): void {
  for (let i = 0; i < source.length; i++) target[i] = source[i];
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
function ramp(t: number, from: number, to: number): number {
  const x = clamp01((t - from) / (to - from));
  return x * x * (3 - 2 * x);
}
function easeOutBack(t: number): number {
  const c = 1.6,
    u = clamp01(t) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

const COMMON_GLSL = `
  const vec3 GOLD=vec3(1.0,0.72,0.3);
  const vec3 HOT=vec3(1.0,0.95,0.82);
  const float PI=3.14159265;
  float sq(float x){return x*x;}
  float band(float r,float at,float w){return exp(-sq((r-at)/w));}
`;

/** The column of light that crashes down from the sky onto the Paladin. */
function pillarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'paladin_ascension:column',
    uniforms: { uDrop: { value: 0 }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `
      varying vec2 vUv; varying float vFacing;
      void main(){vUv=uv;
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        vec3 n=normalize(normalMatrix*normal);
        vFacing=abs(dot(n,normalize(-mv.xyz)));
        gl_Position=projectionMatrix*mv;}
    `,
    fragmentShader: `
      uniform float uDrop, uAlpha, uTime;
      varying vec2 vUv; varying float vFacing;
      ${COMMON_GLSL}
      void main(){
        // Only the part that has come down from the sky: the leading edge white-hot.
        float front=1.0-uDrop;
        float shown=smoothstep(front-0.02,front+0.02,vUv.y);
        float head=exp(-sq((vUv.y-front)*40.0))*(1.0-step(0.999,uDrop));
        // A soft core seen through the column, brightest at its middle and
        // falling away to the sides, so it reads as light, not a solid slab.
        float core=pow(max(vFacing,0.0),7.0);
        float streaks=0.7+0.3*sin(vUv.x*60.0+vUv.y*8.0-uTime*6.0);
        float base=exp(-vUv.y*6.0)*0.6;
        // The column thins away up into the sky, so it reads as a shaft of
        // light on the Paladin rather than a wall; its falling head keeps a
        // share of its light so the crash still reads.
        float top=1.0-smoothstep(0.3,0.95,vUv.y);
        top*=top;
        float mask=(core*streaks*0.5+base)*shown*top+head*1.2*mix(0.4,1.0,top);
        vec3 color=mix(GOLD,HOT,clamp(core*0.7+head+base,0.0,1.0));
        float opacity=uAlpha*mask;
        if(!(opacity>=0.003)) discard;
        gl_FragColor=vec4(color*1.4,opacity);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Ascension's inner circle on the ground: bursts outward on ascension, then
 * turns, its rays and charge marks inside the rune band Avenging Wrath draws
 * round it (paladin_avenging_wrath_visual), so with both the circle is whole. */
function groundMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'paladin_ascension:ground',
    uniforms: {
      uAge: { value: 0 },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uSlots: { value: MAX_ASCENSION_CHARGES },
      uOrb: { value: new Array<number>(MAX_ASCENSION_CHARGES).fill(0) },
      uPop: { value: new Array<number>(MAX_ASCENSION_CHARGES).fill(99) },
      uSpent: { value: 99 },
      uUrgent: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `
      varying vec2 vUv;
      void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
    `,
    fragmentShader: `
      uniform float uAge, uTime, uAlpha, uSlots, uUrgent, uSpent;
      uniform float uOrb[${MAX_ASCENSION_CHARGES}];
      uniform float uPop[${MAX_ASCENSION_CHARGES}];
      varying vec2 vUv;
      ${COMMON_GLSL}
      void main(){
        vec2 p=vUv*2.0-1.0;
        float r=length(p);
        // The circle draws out from the Paladin as the shock passes.
        float grow=1.0-sq(max(1.0-clamp(uAge/0.45,0.0,1.0),0.0));
        float drawn=1.0-smoothstep(grow*0.98-0.04,grow*0.98,r);
        float spin=uTime*0.12;
        vec2 q=vec2(p.x*cos(spin)-p.y*sin(spin),p.x*sin(spin)+p.y*cos(spin));
        // A double rim at the edge, beaded with points of light, and an inner
        // rim round the heart.
        float rims=band(r,0.71,0.008)*0.8+band(r,0.685,0.004)*0.5+band(r,0.46,0.006)*0.6;
        // Eight long rays and eight short between the rings.
        float a=atan(q.y,q.x);
        float rays=pow(max(cos(a*8.0),0.0),60.0)*smoothstep(0.1,0.2,r)*(1.0-smoothstep(0.4,0.46,r))*0.9
          +pow(max(cos(a*8.0+PI),0.0),80.0)*smoothstep(0.2,0.26,r)*(1.0-smoothstep(0.36,0.42,r))*0.5;
        // The charges: a diamond each round the inner ring, dark once spent.
        // A charge spent: its mark flares as it goes out.
        float marks=0.0,spentMark=0.0;
        for(int i=0;i<${MAX_ASCENSION_CHARGES};i++){
          if(float(i)>=uSlots) break;
          float ang=float(i)*2.0*PI/uSlots+PI*0.5-spin;
          vec2 c=vec2(cos(ang),sin(ang))*0.585;
          vec2 d=abs(p-c);
          float lit=uOrb[i];
          float dia=1.0-smoothstep(0.0,0.012,(d.x+d.y*0.7)-0.05);
          marks+=dia*(0.25+0.9*lit);
          float pop=uPop[i];
          if(pop<1.0) spentMark+=exp(-pop*7.0)*(dia*1.6+exp(-dot(p-c,p-c)*260.0)*1.1);
        }
        float pulse=1.0+uUrgent*(0.5+0.5*sin(uTime*9.0));
        float shock=band(r,0.1+0.9*grow,0.03+0.05*grow)*(1.0-grow)*1.6;
        // Every charge spent, the same cue: a pulse of light runs from the
        // inner ring out to the rim.
        float spend=uSpent/${ASCENSION_SPEND_PULSE.toFixed(2)};
        float spendRing=spend<1.0
          ? band(r,0.46+0.26*(1.0-sq(1.0-spend)),0.014+0.02*spend)*(1.0-spend)*1.5
          : 0.0;
        float pool=exp(-r*r*6.0)*(0.25+0.9*exp(-uAge*3.0));
        float beads=pow(max(cos(a*36.0),0.0),120.0)*band(r,0.6975,0.007)*0.9;
        // A fine thread through the charge marks, and a sun disc at the heart.
        float thread=band(r,0.585,0.003)*0.3;
        float heart=band(r,0.075,0.006)*0.8+exp(-r*r*500.0)*0.4;
        // A soft ripple of light running out every few seconds.
        float wave=fract(uTime/3.2);
        float ripple=band(r,0.08+wave*0.62,0.015)*(1.0-wave)*0.5*step(1.0,uAge);
        float mask=((rims+beads+rays+marks+thread+heart)*pulse+pool+ripple)*drawn+shock
          +spendRing+spentMark;
        mask*=1.0-smoothstep(0.95,1.0,r);
        vec3 color=mix(GOLD,HOT,clamp(shock+pool*0.8+marks*0.5+rims*0.3+beads+heart+ripple
          +spendRing+spentMark,0.0,1.0));
        float opacity=uAlpha*mask;
        if(!(opacity>=0.003)) discard;
        gl_FragColor=vec4(color*1.3,opacity);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** The sun halo behind the head, facing the camera, with an orb of light set
 * round its upper arc for each charge. */
function haloMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'paladin_ascension:halo',
    uniforms: {
      uAge: { value: 0 },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uScale: { value: 1 },
      uSlots: { value: MAX_ASCENSION_CHARGES },
      uOrb: { value: new Array<number>(MAX_ASCENSION_CHARGES).fill(0) },
      uPop: { value: new Array<number>(MAX_ASCENSION_CHARGES).fill(99) },
      uUrgent: { value: 0 },
      /** The bloom's share under the shared flash limit (paladin_flash.ts). */
      uFlash: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `
      uniform float uScale;
      varying vec2 vUv;
      void main(){vUv=uv;
        // A billboard set just behind the head, so the head sits in front of it.
        vec4 centre=modelViewMatrix*vec4(0.0,0.0,0.0,1.0);
        centre.xyz+=normalize(centre.xyz)*0.3;
        centre.xy+=position.xy*uScale;
        gl_Position=projectionMatrix*centre;}
    `,
    fragmentShader: `
      uniform float uAge, uTime, uAlpha, uSlots, uUrgent, uFlash;
      uniform float uOrb[${MAX_ASCENSION_CHARGES}];
      uniform float uPop[${MAX_ASCENSION_CHARGES}];
      varying vec2 vUv;
      ${COMMON_GLSL}
      void main(){
        vec2 p=vUv*2.0-1.0;
        float r=length(p);
        float pulse=1.0+uUrgent*(0.4+0.4*sin(uTime*9.0));
        // Two rings of light, the inner one blazing.
        float rings=band(r,0.46,0.02)*1.2+band(r,0.53,0.01)*0.7;
        float inner=exp(-sq((r-0.46)/0.12))*0.18;
        // The charge orbs set round the upper arc beyond the rings: bright
        // while charged, a dim ember once spent, bursting as each is spent.
        float orbs=0.0,hot=0.0,flare=0.0;
        float stepAng=min(0.87,3.6/max(uSlots-1.0,1.0));
        for(int i=0;i<${MAX_ASCENSION_CHARGES};i++){
          if(float(i)>=uSlots) break;
          float ang=PI*0.5-(float(i)-(uSlots-1.0)*0.5)*stepAng;
          vec2 c=vec2(cos(ang),sin(ang))*0.66;
          vec2 d2=p-c;
          float d=length(d2);
          float seed=float(i)*1.7;
          float appear=smoothstep(0.3,0.5,uAge);
          float f=uOrb[i];
          float breathe=1.0+0.1*sin(uTime*3.0+seed*2.0);
          float glint=(exp(-abs(d2.x)*260.0)*exp(-abs(d2.y)*16.0)+exp(-abs(d2.y)*260.0)*exp(-abs(d2.x)*16.0));
          float lit=(exp(-d*d*420.0/breathe)*1.6+exp(-d*d*60.0)*0.5+glint*0.5)*f*pulse;
          orbs+=lit+exp(-d*d*1200.0)*0.18*appear;
          hot+=exp(-d*d*1400.0/breathe)*1.3*f*pulse;
          float since=uPop[i];
          if(since<2.0){
            flare+=exp(-since*5.0)*(exp(-d*d*50.0)*2.2+band(d,0.08+since*0.9,0.025)*1.3);
            for(int k=0;k<5;k++){
              float sa=float(k)*1.2566+seed;
              vec2 sp=c+vec2(cos(sa),sin(sa))*since*(0.35+float(k)*0.05);
              flare+=exp(-dot(p-sp,p-sp)*9000.0)*exp(-since*2.5)*1.8;
            }
          }
        }
        // The halo blooms out as it forms.
        float form=smoothstep(0.08,0.45,uAge);
        float bloom=exp(-uAge*5.0)*exp(-r*r*4.0)*1.5*uFlash;
        float fade=1.0-smoothstep(0.85,1.0,r);
        vec3 color=(GOLD*((rings+inner)*pulse*form+orbs)
          +HOT*(rings*0.5*form+hot+flare+bloom))*fade;
        if(!(max(color.r,max(color.g,color.b))*uAlpha>=0.003)) discard;
        gl_FragColor=vec4(color*1.3,uAlpha);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Motes of light rising round the Paladin. */
function moteMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'paladin_ascension:motes',
    uniforms: {
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uHeight: { value: REFERENCE_HEIGHT },
      uSize: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `
      attribute float aSeed;
      uniform float uTime, uHeight, uSize;
      varying float vFade;
      void main(){
        float h=fract(aSeed*7.13+uTime*0.22);
        float ang=aSeed*40.0+uTime*0.6;
        float rad=(0.45+0.6*fract(aSeed*3.7))*uSize;
        vec3 pos=vec3(cos(ang)*rad,h*uHeight*1.4,sin(ang)*rad);
        vFade=sin(h*3.14159);
        vec4 mv=modelViewMatrix*vec4(pos,1.0);
        gl_PointSize=(30.0+30.0*fract(aSeed*5.3))*uSize/max(-mv.z,0.5);
        gl_Position=projectionMatrix*mv;}
    `,
    fragmentShader: `
      uniform float uAlpha;
      varying float vFade;
      void main(){
        vec2 p=gl_PointCoord*2.0-1.0;
        float r=length(p);
        float mask=exp(-r*r*6.0)*(1.0-smoothstep(0.7,1.0,r));
        float opacity=uAlpha*vFade*mask;
        if(!(opacity>=0.003)) discard;
        gl_FragColor=vec4(vec3(1.0,0.85,0.5)*1.4,opacity);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * Divine Ascension, the Paladin's greatest power. On ascending, a colossal
 * column of holy light crashes down from the sky onto the Paladin and a great
 * rune circle bursts out across the ground with a shockwave; the Paladin is
 * borne up off the ground, gently rising and falling, and seraphic wings,
 * the same as Avenging Wrath's, unfurl behind them; with Avenging Wrath also
 * active its wings keep the shoulders and Ascension's glide down to a second,
 * lower pair. While it lasts a sun
 * halo of two blazing rings burns behind their head, an orb of light set
 * round it for each Ascension charge, kindling from the centre outwards. Each
 * charge spent bursts the outermost orb, the right end then the left, leaving
 * a dim ember; the centre orb shines last. That is the one cue every charge
 * spent shows, whichever ability spends it: the orb bursts, its mark on the
 * circle flares, and a pulse of light runs out to the circle's rim. The circle turns beneath them, its
 * marks dimming in step, and motes of light rise round them. On the last
 * charge the halo and last orb pulse urgently. When it ends the halo and
 * circle fade away.
 */
export class PaladinAscensionVisual {
  /** The ground pieces (the column and the rune circle): parented to the view
   *  group, so they stay at the feet (under the mount) while the rider sits a
   *  saddle higher. */
  readonly group = new THREE.Group();
  /** The body-attached pieces (the halo, the motes and the wings): parented to
   *  the rider anchor (rider_anchor.ts), so they ride wherever the seat carries
   *  the Paladin. */
  readonly crown = new THREE.Group();
  private readonly pillar: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly halo: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly motes: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Ascension's own seraphic wings, the same as Avenging Wrath's. */
  private wings: PaladinAvengingWrathVisual | null = null;
  /** The lower pair furling away where it was after Avenging Wrath ends. */
  private furlingWings: PaladinAvengingWrathVisual | null = null;
  /** Whether Ascension's wings are the lower pair below Avenging Wrath's. */
  private lowerWings = false;
  private readonly size: number;
  private readonly height: number;
  private age = 0;
  private clock = 0;
  /** 1 while ascended, easing to 0 as it ends. */
  private presence = 0;
  private wasActive = false;
  private charges = MAX_ASCENSION_CHARGES;
  /** How many charges this Ascension began with: one orb for each. */
  private slots = MAX_ASCENSION_CHARGES;
  private order = ascensionRemovalOrder(MAX_ASCENSION_CHARGES);
  /** Which slots still hold a charge. */
  private readonly lit = new Array<boolean>(MAX_ASCENSION_CHARGES).fill(false);
  /** Each orb's size, kindling and going out smoothly. */
  private readonly orbs = new Array<number>(MAX_ASCENSION_CHARGES).fill(0);
  private readonly pops = new Array<number>(MAX_ASCENSION_CHARGES).fill(99);
  /** Seconds since the last charge was spent. */
  private spent = 99;
  /** 1 while the Paladin is seen, 0 while vanished mid-flight. */
  private seen = 1;
  /** The detail this Ascension draws at: read as it begins, kept to its end. */
  private detail: PaladinVfxDetail = 'full';

  constructor(characterHeight: number) {
    this.group.name = 'paladin-ascension-visual';
    this.group.visible = false;
    this.crown.name = 'paladin-ascension-crown-anchor';
    this.crown.visible = false;
    this.height = characterHeight;
    this.size = Math.max(0.72, Math.min(1.4, characterHeight / REFERENCE_HEIGHT));

    this.pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 28, 1, true),
      pillarMaterial(),
    );
    this.pillar.name = 'paladin-ascension-pillar';
    this.pillar.scale.set(0.6 * this.size, PILLAR_HEIGHT, 0.6 * this.size);
    this.pillar.position.y = PILLAR_HEIGHT / 2;
    this.pillar.renderOrder = floorVfxRenderOrder('player', 0);
    this.pillar.frustumCulled = false;

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMaterial());
    this.ground.name = 'paladin-ascension-ground-seal';
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0.055;
    this.ground.scale.setScalar(4.4 * this.size);
    this.ground.renderOrder = floorVfxRenderOrder('player', 0);

    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), haloMaterial());
    this.halo.name = 'paladin-ascension-halo';
    this.halo.position.y = characterHeight * HALO_HEIGHT;
    this.halo.material.uniforms.uScale.value = HALO_SCALE * this.size;
    this.halo.renderOrder = floorVfxRenderOrder('player', 1);
    this.halo.frustumCulled = false;

    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3),
    );
    moteGeometry.setAttribute(
      'aSeed',
      new THREE.BufferAttribute(
        Float32Array.from({ length: MOTES }, (_, i) => (i + 0.5) / MOTES),
        1,
      ),
    );
    this.motes = new THREE.Points(moteGeometry, moteMaterial());
    this.motes.name = 'paladin-ascension-motes';
    this.motes.material.uniforms.uHeight.value = characterHeight;
    this.motes.material.uniforms.uSize.value = this.size;
    this.motes.frustumCulled = false;
    this.motes.renderOrder = floorVfxRenderOrder('player', 0);

    this.group.add(this.pillar, this.ground);
    this.crown.add(this.halo, this.motes);
  }

  /**
   * Advance the column, circle, halo, orbs and wings, and lift the rig
   * (`hoverTarget`, the rider root) by the hover while Ascension is up.
   *
   * The lift is ADDED to the height the renderer placed the rig at THIS frame,
   * so call it after the rider placement (placeRider, or the mount attitude
   * pass in updateMountPresentation), which rewrites that height every frame.
   * It must never latch a base height of its own: the visual lives for the
   * whole view once built, and a latched height pinned the paladin to wherever
   * the first Ascension caught them, on the ground under every later mount or
   * floating at seat height after a dismount.
   */
  update(
    plan: PaladinAscensionVisualPlan,
    dt: number,
    reducedMotion: boolean,
    hoverTarget: THREE.Object3D | null = null,
  ): void {
    // Idle: no Ascension, its fade and its wings all done. Nothing to draw or
    // write until the aura returns (the view keeps the visual once built).
    if (
      !plan.active &&
      !this.wasActive &&
      this.presence <= 0 &&
      this.wings === null &&
      this.furlingWings === null
    ) {
      this.group.visible = this.crown.visible = false;
      return;
    }
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
    if (plan.active && !this.wasActive) {
      // Ascending (again): the column crashes down afresh.
      this.detail = paladinVfxDetailNow();
      this.motes.geometry.setDrawRange(0, paladinDetailCount(MOTES, this.detail));
      this.age = 0;
      this.slots = Math.max(1, plan.charges);
      this.order = ascensionRemovalOrder(this.slots);
      this.orbs.fill(0);
      this.pops.fill(99);
      this.spent = 99;
      this.lightCharges(plan.charges, false);
    } else this.age += dt;
    // Ascension ends with the last charge spent (or its time run out): what
    // charges remain burst as it goes, with the same cue as any charge spent.
    if (!plan.active && this.wasActive) this.lightCharges(0, true);
    this.wasActive = plan.active;
    // A charge spent: the outermost orb bursts and goes out.
    if (plan.active && plan.charges !== this.charges) {
      if (plan.charges > this.slots) {
        this.slots = plan.charges;
        this.order = ascensionRemovalOrder(this.slots);
      }
      this.lightCharges(plan.charges, true);
    }
    for (let i = 0; i < this.pops.length; i++) this.pops[i] += dt;
    this.spent += dt;
    // The orbs kindle from the centre outwards as the halo forms.
    for (let i = 0; i < this.orbs.length; i++) {
      const fromCentre = this.slots - 1 - this.order.indexOf(i);
      const burning =
        plan.active && this.lit[i] && (reducedMotion || this.age >= 0.35 + 0.09 * fromCentre);
      this.orbs[i] = burning
        ? Math.min(1, this.orbs[i] + dt / ORB_KINDLE)
        : Math.max(0, this.orbs[i] - dt / ORB_FADE);
    }

    this.presence = plan.active
      ? 1
      : Math.max(0, this.presence - dt / paladinDetailLinger(ASCENSION_EXIT, this.detail));
    this.seen = plan.vanished
      ? reducedMotion
        ? 0
        : Math.max(0, this.seen - dt / VANISH_FADE)
      : reducedMotion
        ? 1
        : Math.min(1, this.seen + dt / RETURN_FADE);
    const shown = this.presence > 0;
    this.group.visible = shown;
    this.crown.visible = shown;

    // Borne up off the ground, gently rising and falling.
    const lift = shown
      ? (LIFT * ramp(this.age, 0, 0.4) +
          (reducedMotion ? 0 : BOB * Math.sin(this.clock * 2.2) * ramp(this.age, 0.4, 0.8))) *
        this.size *
        this.presence
      : 0;
    if (hoverTarget && lift !== 0) hoverTarget.position.y += lift;
    this.syncWings(plan, dt, reducedMotion, shown, lift);
    // Gone with the Paladin mid-flight: the wings burn out with the body.
    for (const wings of [this.wings, this.furlingWings]) {
      if (!wings) continue;
      wings.material.uniforms.uAlpha.value *= this.seen;
      if (this.seen <= 0) wings.leftWing.visible = wings.rightWing.visible = false;
    }
    if (!shown) return;
    const seen = this.seen;
    this.ground.visible = this.halo.visible = seen > 0;

    const fading = 1 - this.presence;
    const urgent = plan.active && plan.lastCharge ? 1 : 0;
    // The column: crashes down, blazes as it lands, then fades away. It and
    // the halo's bloom build and peak under the shared flash limit.
    const flash = paladinFlash(this.age, plan.local ?? true);
    const pillar = this.pillar.material.uniforms;
    pillar.uDrop.value = reducedMotion ? 1 : ramp(this.age, 0, ASCENSION_DROP);
    pillar.uAlpha.value =
      (1 - ramp(this.age, ASCENSION_DROP, ASCENSION_PILLAR_FADE)) *
      (reducedMotion ? 0.4 : 0.6) *
      flash;
    pillar.uTime.value = this.clock;
    this.pillar.visible = pillar.uAlpha.value > 0.002 && paladinDetailScale(this.detail).secondary;

    const ground = this.ground.material.uniforms;
    ground.uAge.value = this.age - ASCENSION_DROP * 0.8;
    ground.uTime.value = this.clock;
    ground.uAlpha.value =
      ramp(this.age, ASCENSION_DROP * 0.8, ASCENSION_DROP + 0.05) * this.presence * seen;
    ground.uSlots.value = this.slots;
    copyInto(ground.uOrb.value as number[], this.orbs);
    copyInto(ground.uPop.value as number[], this.pops);
    ground.uSpent.value = this.spent;
    ground.uUrgent.value = urgent;

    const halo = this.halo.material.uniforms;
    halo.uAge.value = this.age;
    halo.uTime.value = this.clock;
    halo.uAlpha.value = this.presence * seen;
    halo.uSlots.value = this.slots;
    copyInto(halo.uOrb.value as number[], this.orbs);
    halo.uUrgent.value = urgent;
    // The forming bloom is an accent; the column (secondary) keeps its flash.
    halo.uFlash.value = paladinDetailScale(this.detail).accents ? flash : 0;
    halo.uScale.value =
      HALO_SCALE *
      this.size *
      (0.6 + 0.4 * easeOutBack(ramp(this.age, 0.08, 0.5))) *
      (1 + 0.25 * fading);
    copyInto(halo.uPop.value as number[], this.pops);
    this.halo.position.y = this.height * HALO_HEIGHT + lift;

    const motes = this.motes.material.uniforms;
    motes.uTime.value = this.clock;
    motes.uAlpha.value = reducedMotion ? 0 : ramp(this.age, 0.2, 0.8) * this.presence * seen;
    this.motes.visible = motes.uAlpha.value > 0.002;
  }

  /** Ascension spreads the same wings as Avenging Wrath. With both active the
   * Avenging Wrath pair keeps the shoulders and Ascension's is a second, lower
   * pair: two sets of wings. The extra pair never slides: it unfurls where it
   * stands and furls away there when it is no longer needed. */
  private syncWings(
    plan: PaladinAscensionVisualPlan,
    dt: number,
    reducedMotion: boolean,
    shown: boolean,
    lift: number,
  ): void {
    // The pair left below when Avenging Wrath ended folds away where it is.
    this.furlingWings = syncPaladinAvengingWrathVisual(
      this.furlingWings,
      this.crown,
      this.height,
      false,
      dt,
      reducedMotion,
    );
    this.wings = syncPaladinAvengingWrathVisual(
      this.wings,
      this.crown,
      this.height,
      plan.active && shown,
      dt,
      reducedMotion,
      undefined,
      null,
      this.detail,
    );
    const wings = this.wings;
    // Furling once Ascension is over: they hold the pose they furl from.
    if (!wings || wings.furling) return;
    const lower = Boolean(plan.wrathWings);
    if (lower !== this.lowerWings) {
      this.lowerWings = lower;
      if (lower) {
        // Avenging Wrath takes the shoulders: the extra pair unfurls below.
        wings.from = 0;
        wings.open = 0;
        wings.elapsed = 0;
        if (reducedMotion) wings.open = 1;
        wings.material.uniforms.uOpen.value = wings.open;
      } else {
        // Avenging Wrath is gone, and its pair with it: the lower pair furls
        // away where it is, and Ascension's stand at the shoulders in their
        // place, already spread.
        this.furlingWings?.dispose();
        // This frame's sync posed it afresh: back below before it furls.
        this.placeWings(wings, lift, 1);
        this.furlingWings = syncPaladinAvengingWrathVisual(
          wings,
          this.crown,
          this.height,
          false,
          0,
          reducedMotion,
        );
        const fresh = syncPaladinAvengingWrathVisual(
          null,
          this.crown,
          this.height,
          true,
          0,
          reducedMotion,
          undefined,
          null,
          this.detail,
        );
        if (!fresh) return;
        fresh.from = 1;
        fresh.open = 1;
        fresh.elapsed = 1;
        fresh.material.uniforms.uOpen.value = 1;
        this.wings = fresh;
        this.placeWings(fresh, lift, 0);
        return;
      }
    }
    this.placeWings(wings, lift, lower ? 1 : 0);
  }

  /** Ascension's pair at the shoulders (0) or as the lower pair (1). */
  private placeWings(wings: PaladinAvengingWrathVisual, lift: number, low: number): void {
    wings.root.position.y =
      this.height * (PALADIN_BODY_FIT.wingRoot - PALADIN_BODY_FIT.lowerWingDrop * low) + lift;
    wings.root.position.z = -0.05 * low;
    wings.wingRig.scale.multiplyScalar(1 - (1 - LOWER_WINGS_SIZE) * low);
    // Mirrored, the left wing tips down with a positive turn, the right negative.
    wings.leftWing.rotation.z += LOWER_WINGS_TILT * low;
    wings.rightWing.rotation.z -= LOWER_WINGS_TILT * low;
  }

  /** Which slots shine for `charges` left, going out from the outside in. */
  private lightCharges(charges: number, flare: boolean): void {
    const keep = new Set(this.order.slice(Math.max(0, this.slots - charges)));
    for (let i = 0; i < this.lit.length; i++) {
      const lit = keep.has(i);
      if (flare && this.lit[i] && !lit) {
        this.pops[i] = 0;
        this.spent = 0;
      }
      this.lit[i] = lit;
    }
    this.charges = charges;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.crown.removeFromParent();
    this.wings?.dispose();
    this.wings = null;
    this.furlingWings?.dispose();
    this.furlingWings = null;
    for (const object of [this.pillar, this.ground, this.halo, this.motes]) {
      object.geometry.dispose();
      object.material.dispose();
    }
  }
}

export function syncPaladinAscensionVisual(
  visual: PaladinAscensionVisual | null,
  parent: THREE.Group,
  riderParent: THREE.Group,
  characterHeight: number,
  plan: PaladinAscensionVisualPlan,
  dt: number,
  reducedMotion: boolean,
  hoverTarget: THREE.Object3D | null = null,
): PaladinAscensionVisual | null {
  let current = visual;
  if (plan.active && !current) {
    current = new PaladinAscensionVisual(characterHeight);
    parent.add(current.group);
    riderParent.add(current.crown);
  }
  current?.update(plan, dt, reducedMotion, hoverTarget);
  return current;
}

/**
 * The boot manifest's stand-in: one hidden visual, never disposed, so the
 * programs a live Divine Ascension draws (the column, the rune circle, the
 * halo, the motes and its seraphic wings) are linked behind the loading cover
 * and stay referenced for the session. The live visual is built per character
 * view when the aura first shows, after every prewarm entry ran, so its first
 * cast used to link them inside a live frame. Rebuilt with the graphics
 * profile (resetPaladinAscensionProfileCaches). Registered in
 * ABILITY_MATERIAL_SOURCES.
 */
interface PaladinAscensionStandIn {
  root: THREE.Group;
  materials: THREE.Material[];
}
let paladinAscensionStandIn: PaladinAscensionStandIn | null = null;

/** A fresh stand-in, its own instance: the Paladin kit recipe holds one per
 *  renderer (ability_vfx/paladin_stand_in_prewarm.ts) beside the boot one. */
export function createPaladinAscensionStandIn(): PaladinAscensionStandIn {
  const root = new THREE.Group();
  root.name = 'paladin-ascension-stand-in';
  const visual = new PaladinAscensionVisual(REFERENCE_HEIGHT);
  root.add(visual.group, visual.crown);
  // Ascension's wings are Avenging Wrath's: one pair built spread, never furled.
  syncPaladinAvengingWrathVisual(
    null,
    visual.crown,
    REFERENCE_HEIGHT,
    true,
    0,
    true,
    undefined,
    null,
    'full',
  );
  const materials: THREE.Material[] = [];
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (material && !Array.isArray(material) && !materials.includes(material)) {
      materials.push(material);
    }
  });
  return { root, materials };
}

export function buildPaladinAscensionStandIn(): PaladinAscensionStandIn {
  paladinAscensionStandIn ??= createPaladinAscensionStandIn();
  return paladinAscensionStandIn;
}

export function paladinAscensionStandInMaterials(): readonly THREE.Material[] {
  return buildPaladinAscensionStandIn().materials;
}

export function resetPaladinAscensionProfileCaches(): void {
  paladinAscensionStandIn = null;
}
