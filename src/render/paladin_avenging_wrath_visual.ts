import * as THREE from 'three';
import { PALADIN_RUNE_GLSL } from './ability_vfx/paladin_runes';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { PALADIN_BODY_FIT } from './paladin_body_fit';
import {
  VALKYR_LAND,
  VALKYR_RETURN,
  VALKYR_VANISH,
  valkyrVanished,
} from './paladin_valkyrs_calling_core';

const GOLD = 0xffd84a;
const IVORY = 0xfff1cc;

/** Seraphic Ascendance: two great wings of golden light behind the Paladin.
 * Each wing is layered feathers (long primaries at the hand, hanging
 * secondaries, two rows of coverts along the arched wing bone) and drifting
 * motes. Geometry is built once in unit body height;
 * the unfurl, breathing and sway run in the vertex shader from two uniforms. */
export interface PaladinAvengingWrathVisual {
  root: THREE.Group;
  /** Holds both wings, scaled to the wearer's height. */
  wingRig: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  geometry: THREE.BufferGeometry;
  /** Wing light (feathers and motes). */
  material: THREE.ShaderMaterial;
  elapsed: number;
  /** Current unfurl, 0 tucked behind the back to 1 fully spread. */
  open: number;
  /** Pose the wings are heading toward, and where this unfurl started. */
  opening: number;
  from: number;
  /** Seconds the wings stay spread after a Valkyr's Calling slam. */
  flightLinger: number;
  /** Avenging Wrath's rune band on the ground, round Divine Ascension's inner
   * circle when both are active. */
  runeBand: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** Seconds the rune band has been drawn. */
  runeAge: number;
  /** The wings are folding away behind the shoulders, their aura gone. */
  furling: boolean;
  dispose(): void;
}

const KIND = { feather: 0, mote: 1 } as const;
/** Valkyr's Calling: the wings hold spread through the slam, then fade. */
const FLIGHT_LINGER = 0.55;
/** Seconds the wings take to furl away behind the shoulders. */
export const WING_FURL = 0.5;
/** Wing size relative to the wearer's height. */
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];

/** Wing bone from the shoulder (s = 0) to the hand tip (s = 1), outward on +x. */
function arm(s: number): [number, number, number] {
  const rise = Math.sin((Math.min(s, 0.75) / 0.75) * (Math.PI / 2));
  return [0.06 + 1.1 * s, 0.05 + 0.75 * rise - Math.max(0, s - 0.75) * 0.5, -0.05 - 0.1 * s];
}
const DEG = Math.PI / 180;
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Builder {
  root: number[];
  dir: number[];
  size: number[];
  uv: number[];
  kind: number[];
  phase: number[];
  layer: number[];
}
function quad(
  b: Builder,
  root: [number, number, number],
  openAngle: number,
  foldAngle: number,
  length: number,
  width: number,
  kind: number,
  phase: number,
  layer: number,
  u0 = 0,
  u1 = 1,
): void {
  for (let c = 0; c < 6; c++) {
    const end = CORNERS[c * 2],
      side = CORNERS[c * 2 + 1];
    b.root.push(root[0], root[1], root[2]);
    b.dir.push(openAngle, foldAngle);
    b.size.push(length, width);
    b.uv.push(end ? u1 : u0, side);
    b.kind.push(kind);
    b.phase.push(phase);
    b.layer.push(layer);
  }
}
/** One wing in +x convention; the left wing mirrors it with scale.x = -1. */
function buildWingGeometry(): THREE.BufferGeometry {
  const b: Builder = { root: [], dir: [], size: [], uv: [], kind: [], phase: [], layer: [] };
  // Primaries fan from hanging to up-and-out at the hand tip.
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    quad(
      b,
      arm(lerp(0.62, 1, t)),
      lerp(-75, 25, t) * DEG,
      -92 * DEG,
      lerp(0.85, 1.15, t),
      0.13,
      KIND.feather,
      i * 1.7,
      0,
    );
  }
  // Secondaries hang long from the forearm.
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    quad(
      b,
      arm(lerp(0.12, 0.62, t)),
      lerp(-100, -80, t) * DEG,
      -100 * DEG,
      lerp(0.95, 0.8, t),
      0.16,
      KIND.feather,
      10 + i * 1.3,
      -0.01,
    );
  }
  // Greater and lesser coverts layered over the bases.
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const angle = t < 0.55 ? lerp(-95, -78, t / 0.55) : lerp(-78, -10, (t - 0.55) / 0.45);
      quad(
        b,
        arm(lerp(row ? 0.05 : 0.1, row ? 0.9 : 0.95, t)),
        (angle + row * 8) * DEG,
        -98 * DEG,
        row ? 0.25 : 0.45,
        row ? 0.12 : 0.14,
        KIND.feather,
        30 + row * 12 + i,
        0.02 + row * 0.015,
      );
    }
  // Motes drifting up through the wing.
  for (let m = 0; m < 14; m++) {
    const s = ((m * 0.618) % 1) * 0.9 + 0.08;
    const [x, y, z] = arm(s);
    quad(
      b,
      [x, y - ((m * 0.37) % 1) * 0.8, z + 0.03],
      0,
      0,
      0.035,
      0.035,
      KIND.mote,
      m * 2.1,
      0.04,
    );
  }
  const g = new THREE.BufferGeometry();
  const count = b.kind.length;
  // Positions are placed in the vertex shader; a zero array feeds three.js.
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aRoot', new THREE.Float32BufferAttribute(b.root, 3));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(b.dir, 2));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(b.size, 2));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(b.kind, 1));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(b.phase, 1));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(b.layer, 1));
  // Generous bounds: the shader moves every vertex.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.6, 0, 0), 2.2);
  return g;
}

function wingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'paladin_avenging_wrath:wings',
    uniforms: {
      uOpen: { value: 0 },
      uTime: { value: 0 },
      uAlpha: { value: 1 },
      uGold: { value: new THREE.Color(GOLD) },
      uHot: { value: new THREE.Color(IVORY) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `
      uniform float uOpen, uTime;
      attribute vec3 aRoot; attribute vec2 aDir, aSize, aUv;
      attribute float aKind, aPhase, aLayer;
      varying vec2 vUv; varying float vKind, vPhase;
      void main(){
        vUv=aUv; vKind=aKind; vPhase=aPhase;
        // Tucked behind the shoulders when closed, spread along the bone when open.
        vec3 folded=vec3(aRoot.x*0.3, aRoot.y*0.45-0.05, aRoot.z-aRoot.x*0.35);
        vec3 root=mix(folded, aRoot, uOpen);
        vec3 p;
        if(aKind<0.5){
          float a=mix(aDir.y, aDir.x, uOpen)+sin(uTime*1.8+aPhase)*0.025*uOpen;
          vec2 d=vec2(cos(a), sin(a)), n=vec2(-d.y, d.x);
          float len=aSize.x*mix(0.55, 1.0, uOpen);
          p=root+vec3(d*aUv.x*len+n*aUv.y*aSize.y*0.5, aLayer-0.12*aUv.x*aUv.x*len);
        } else {
          float rise=fract(uTime*0.12+aPhase*0.37);
          p=root+vec3((aUv.x-0.5)*aSize.x, rise*0.5+aUv.y*aSize.y*0.5, 0.0);
        }
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }`,
    fragmentShader: `
      uniform float uOpen, uTime, uAlpha;
      uniform vec3 uGold, uHot;
      varying vec2 vUv; varying float vKind, vPhase;
      void main(){
        float u=vUv.x, v=vUv.y, mask; vec3 color;
        if(vKind<0.5){
          // Feather: widening vane with a pointed tip, bright inner rim,
          // a hot shaft and faint diagonal barbs.
          float w=smoothstep(0.0,0.12,u)*(u<0.8?mix(0.55,1.0,u/0.8):(1.0-u)/0.2);
          float av=abs(v);
          float body=1.0-smoothstep(w-0.1,w,av);
          float edge=exp(-max(w-av,0.0)*9.0)*body;
          float shaft=exp(-v*v*400.0)*step(u,0.92)*smoothstep(0.0,0.05,u);
          float barbs=0.5+0.5*sin(u*42.0-av*10.0);
          mask=body*(0.07+0.1*u+0.1*barbs*smoothstep(0.1,0.9,av/max(w,0.01)))+edge*0.95+shaft*0.6;
          // Warm amber vanes, white-hot edges and shafts.
          vec3 amber=uGold*vec3(1.0,0.78,0.5);
          color=mix(amber,uHot,clamp(edge*0.9+shaft+u*0.15,0.0,1.0));
        } else {
          // Mote: a twinkling point that fades as it rises.
          vec2 q=vec2(u*2.0-1.0,v);
          float rise=fract(uTime*0.12+vPhase*0.37);
          mask=exp(-dot(q,q)*5.0)*(0.5+0.5*sin(uTime*6.0+vPhase))*(1.0-rise);
          color=uHot;
        }
        float alpha=mask*uAlpha*smoothstep(0.0,0.25,uOpen);
        if(!(alpha>=0.003)) discard;
        gl_FragColor=vec4(color*1.9,alpha);
        #include <colorspace_fragment>
      }`,
  });
}

/** The rune band, in the same frame as Divine Ascension's circle
 * (paladin_ascension_visual), whose plane is 4.4 times the size scale across;
 * this one is wider to hold the feather marks outside the rim. */
const RUNE_BAND_SPAN = 5.2;
const RUNE_BAND_REACH = (RUNE_BAND_SPAN / 4.4).toFixed(4);
/** Seconds the rune band takes to sweep round into place. */
const RUNE_BAND_SWEEP = 0.45;

/** A band of turning runes, flickering, with arcs of light running round it,
 * inside a ticked double rim ringed by feather marks for the wings; it sweeps
 * round into place. */
function runeBandMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'paladin_avenging_wrath:rune-band',
    uniforms: {
      uAge: { value: 0 },
      uTime: { value: 0 },
      uFade: { value: 1 },
      uGold: { value: new THREE.Color(GOLD) },
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
      uniform float uAge, uTime, uFade;
      uniform vec3 uGold;
      varying vec2 vUv;
      ${PALADIN_RUNE_GLSL}
      const float TAU=6.2831853;
      void main(){
        // Units of Divine Ascension's circle: its rim at 0.71, ours from 0.74.
        vec2 p=(vUv*2.0-1.0)*${RUNE_BAND_REACH};
        float r=length(p);
        float spin=uTime*0.12;
        vec2 q=vec2(p.x*cos(spin)-p.y*sin(spin),p.x*sin(spin)+p.y*cos(spin));
        float qa=atan(q.y,q.x);
        // The runes, each flickering on its own.
        float cell=floor((qa/TAU+0.5)*48.0);
        float flicker=0.72+0.28*sin(uTime*2.6+cell*2.39);
        float runes=paladinRuneRing(q,0.74,0.9)*flicker;
        // Two arcs of light running round the band.
        float a=atan(p.y,p.x);
        float glint=pow(0.5+0.5*cos(2.0*(a-uTime*0.9)),18.0)*smoothstep(0.72,0.76,r)*(1.0-smoothstep(0.9,0.94,r));
        // A soft glow under the runes.
        float haze=exp(-runeSq((r-0.82)/0.1))*0.12;
        // A double rim, fine ticks between.
        float rim=exp(-runeSq((r-0.93)/0.01))+exp(-runeSq((r-0.965)/0.005))*0.6;
        float ticks=pow(max(cos(qa*72.0),0.0),30.0)*smoothstep(0.935,0.94,r)*(1.0-smoothstep(0.958,0.962,r))*0.7;
        // Feather marks round the outside, turning the other way: for the wings.
        float fa=atan(p.y,p.x)+uTime*0.08;
        const float SECTOR=TAU/16.0;
        float off=(fa-(floor(fa/SECTOR)+0.5)*SECTOR)*r;
        float dd=abs(off)/0.022+abs(r-1.035)/0.05;
        float feathers=(1.0-smoothstep(0.75,1.0,dd))*0.3+exp(-runeSq((dd-1.0)/0.1))*0.9;
        feathers+=exp(-runeSq(off/0.003))*smoothstep(1.0,0.4,dd)*0.6;
        // Sweeping round from in front of the Paladin both ways at once.
        float around=abs(atan(p.x,-p.y))/3.14159265;
        float sweep=clamp(uAge/${RUNE_BAND_SWEEP.toFixed(2)},0.0,1.0);
        float reveal=1.0-smoothstep(sweep*1.08-0.08,sweep*1.08,around);
        float flash=1.0+1.6*exp(-uAge*4.0);
        float mask=(runes*0.9+glint*0.8+haze+rim+ticks+feathers)*reveal*flash*uFade
          *(1.0-smoothstep(1.1,${RUNE_BAND_REACH},r));
        if(!(mask>=0.003)) discard;
        vec3 hot=vec3(1.0,0.95,0.82);
        vec3 color=mix(uGold*vec3(1.0,0.82,0.55),hot,clamp(rim*0.3+glint+flash-1.0,0.0,1.0));
        gl_FragColor=vec4(color*1.3,mask);
        #include <colorspace_fragment>
      }
    `,
  });
}

function easeOutBack(t: number): number {
  const c = 1.4,
    u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** One wing geometry (unit body height) and one rune-band plane for every
 * wearer, never disposed: a cast attaches meshes over them, it never rebuilds
 * them, and the boot stand-in (buildPaladinAscensionStandIn) holds them too. */
const WING_GEOMETRY = buildWingGeometry();
const RUNE_BAND_GEOMETRY = new THREE.PlaneGeometry(1, 1);

function createPaladinAvengingWrathVisual(
  parent: THREE.Group,
  height: number,
): PaladinAvengingWrathVisual {
  const geometry = WING_GEOMETRY;
  const material = wingMaterial();
  const root = new THREE.Group();
  root.name = 'paladin-avenging-wrath';
  root.position.y = height * PALADIN_BODY_FIT.wingRoot;
  const wingRig = new THREE.Group();
  wingRig.name = 'paladin-avenging-wrath-wings';
  const wing = (side: 'left' | 'right') => {
    const group = new THREE.Group();
    group.name = `paladin-avenging-wrath-${side}-wing`;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `paladin-avenging-wrath-${side}-feathers`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    const sign = side === 'left' ? -1 : 1;
    group.scale.x = sign;
    group.position.set(sign * 0.1, 0.08, -0.14);
    // Swept slightly back from the shoulders.
    group.rotation.y = sign * 0.35;
    return group;
  };
  const leftWing = wing('left');
  const rightWing = wing('right');
  wingRig.add(leftWing, rightWing);
  wingRig.scale.setScalar(height * PALADIN_BODY_FIT.wingScale);
  root.add(wingRig);
  const runeBandMat = runeBandMaterial();
  const runeBand = new THREE.Mesh(RUNE_BAND_GEOMETRY, runeBandMat);
  runeBand.name = 'paladin-avenging-wrath-rune-band';
  runeBand.rotation.x = -Math.PI / 2;
  runeBand.renderOrder = floorVfxRenderOrder('player', 0);
  runeBand.visible = false;
  root.add(runeBand);
  parent.add(root);

  return {
    root,
    wingRig,
    leftWing,
    rightWing,
    geometry,
    material,
    elapsed: 0,
    open: 0,
    opening: Number.NaN,
    from: 0,
    flightLinger: 0,
    runeBand,
    runeAge: 0,
    furling: false,
    dispose() {
      parent.remove(root);
      runeBandMat.dispose();
      material.dispose();
    },
  };
}

/** The aura is gone: the wings fold back behind the shoulders, dimming as they
 * close, and the rune band fades. False once they are away. */
function furlWings(visual: PaladinAvengingWrathVisual, dt: number): boolean {
  if (!visual.furling) {
    visual.furling = true;
    visual.from = visual.open;
    visual.opening = 0;
    visual.elapsed = 0;
  }
  visual.elapsed += Math.max(0, dt);
  const t = Math.min(1, visual.elapsed / WING_FURL);
  visual.open = visual.from * (1 - t * t * (3 - 2 * t));
  const uniforms = visual.material.uniforms;
  uniforms.uOpen.value = visual.open;
  uniforms.uTime.value += Math.max(0, dt);
  uniforms.uAlpha.value = 0.95 * (1 - Math.max(0, (t - 0.6) / 0.4));
  visual.runeBand.material.uniforms.uFade.value = 1 - t;
  return t < 1;
}

export function syncPaladinAvengingWrathVisual(
  current: PaladinAvengingWrathVisual | null,
  parent: THREE.Group,
  height: number,
  active: boolean,
  dt: number,
  reducedMotion: boolean,
  auras?: ReadonlyArray<{ id: string; kind: string }>,
  flightElapsed: number | null = null,
): PaladinAvengingWrathVisual | null {
  let wrath = !auras && active,
    flight = false;
  if (active && auras)
    for (const aura of auras) {
      if (aura.id === 'avenging_wrath') wrath = true;
      if (aura.id === 'valkyrs_calling_flight') flight = true;
    }
  if (flightElapsed !== null) flight = active;
  // A slam's linger fades the wings out (uAlpha below): one that runs out this
  // frame leaves nothing on screen to furl.
  let lingeredOut = false;
  if (current && !flight && current.flightLinger > 0) {
    current.flightLinger = Math.max(0, current.flightLinger - Math.max(0, dt));
    lingeredOut = current.flightLinger === 0;
  }
  // After a Valkyr's Calling slam the wings hold briefly though the flight aura
  // (often the Paladin's last aura) is gone.
  const linger = !flight && (current?.flightLinger ?? 0) > 0;
  if (!(active || linger) || !(wrath || flight || linger)) {
    if (!current) return null;
    // Divine Ascension's own pair takes the shoulders the moment this one goes
    // (paladin_ascension_visual), so there is nothing to furl.
    const handover = auras?.some((aura) => aura.id === 'divine_ascension') ?? false;
    if (
      reducedMotion ||
      handover ||
      lingeredOut ||
      !current.leftWing.visible ||
      current.open < 0.02
    ) {
      current.dispose();
      return null;
    }
    if (furlWings(current, dt)) return current;
    current.dispose();
    return null;
  }
  if (current?.furling) {
    // Back before they were gone: unfurl again from where they are.
    current.furling = false;
    current.opening = Number.NaN;
  }
  const visual = current ?? createPaladinAvengingWrathVisual(parent, height);
  visual.root.position.y = height * PALADIN_BODY_FIT.wingRoot;
  visual.wingRig.scale.setScalar(height * PALADIN_BODY_FIT.wingScale);
  // Valkyr's Calling: out of sight mid-flight, back fully spread for the dive.
  const soaring = flight ? (flightElapsed ?? 0) : null;
  if (soaring !== null && soaring >= VALKYR_LAND - 0.3) visual.flightLinger = FLIGHT_LINGER;
  const winged = (wrath || flight || linger) && !valkyrVanished(soaring);
  visual.leftWing.visible = visual.rightWing.visible = winged;
  visual.leftWing.scale.set(-1, 1, 1);
  visual.rightWing.scale.set(1, 1, 1);
  // The rune band is Avenging Wrath's own: only its aura draws it, not wings
  // borrowed without auras (Divine Ascension's pair).
  const runeBand = wrath && auras !== undefined;
  // Out of sight mid-flight, the band goes with the Paladin as the wings do.
  visual.runeBand.visible = runeBand && !valkyrVanished(soaring);
  visual.runeAge = runeBand ? visual.runeAge + Math.max(0, dt) : 0;
  if (runeBand) {
    const scale = Math.max(0.72, Math.min(1.4, height / 1.8)) * RUNE_BAND_SPAN;
    visual.runeBand.scale.setScalar(scale);
    visual.runeBand.position.y = -height * PALADIN_BODY_FIT.wingRoot + 0.05;
    const band = visual.runeBand.material.uniforms;
    band.uAge.value = reducedMotion ? 10 : visual.runeAge;
    band.uFade.value = 1;
    if (!reducedMotion) band.uTime.value += Math.max(0, dt);
  }
  visual.material.uniforms.uGold.value.setHex(wrath ? GOLD : 0xf9c878);
  const opening = 1;
  if (visual.opening !== opening) {
    // A new pose unfurls from where the wings are now.
    visual.from = visual.open;
    visual.opening = opening;
    visual.elapsed = 0;
  }
  if (soaring !== null && soaring >= VALKYR_RETURN) {
    // Reappearing over the target: already open, no second unfurl.
    visual.from = 1;
    visual.elapsed = Math.max(visual.elapsed, 1);
  }
  if (reducedMotion) {
    visual.open = opening;
  } else {
    visual.elapsed += Math.max(0, dt);
    // Unfurl with a slight overshoot, then breathe while held. The flight
    // snaps open faster: the wings must be spread before the launch.
    const unfurl = Math.min(1, visual.elapsed / (flight ? 0.3 : 0.55));
    const base = visual.from + (opening - visual.from) * easeOutBack(unfurl);
    const breath = unfurl < 1 ? 0 : Math.sin((visual.elapsed - 0.55) * 2.2) * 0.03;
    visual.open = Math.max(0, base + breath);
  }
  const uniforms = visual.material.uniforms;
  uniforms.uOpen.value = visual.open;
  if (!reducedMotion) uniforms.uTime.value += Math.max(0, dt);
  uniforms.uAlpha.value = reducedMotion ? 0.95 : 0.9 + Math.sin(uniforms.uTime.value * 4.1) * 0.08;
  if (soaring !== null) {
    // Burn out into the light at the vanish; flare bright on the return.
    const fade = Math.min(1, Math.max(0, (VALKYR_VANISH - soaring) / 0.1));
    const flare = soaring >= VALKYR_RETURN ? 1.6 * Math.exp(-(soaring - VALKYR_RETURN) * 7) : 0;
    uniforms.uAlpha.value *= (soaring < VALKYR_RETURN ? 0.4 + 0.6 * fade : 1) + flare;
  } else if (linger) {
    uniforms.uAlpha.value *= visual.flightLinger / FLIGHT_LINGER;
  }
  // A gentle beat of the whole wing on top of the breathing.
  const beat = reducedMotion ? 0 : Math.sin(uniforms.uTime.value * 1.6) * 0.04 * visual.open;
  visual.leftWing.rotation.z = -beat;
  visual.rightWing.rotation.z = beat;
  return visual;
}
