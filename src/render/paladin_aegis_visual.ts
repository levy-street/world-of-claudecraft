import * as THREE from 'three';
import type { SimEvent } from '../sim/types';
import { PALADIN_RUNE_GLSL } from './ability_vfx/paladin_runes';
import {
  bindPaladinSpecIcons,
  PALADIN_SPEC_ICON_GLSL,
  paladinSpecIconUniforms,
} from './ability_vfx/paladin_spec_icons';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { PALADIN_BODY_FIT } from './paladin_body_fit';

export const PALADIN_AEGIS_DOME_RADIUS = 10;
const TAU = Math.PI * 2;
/** Pluses of healing rising through the dome. */
const RISING_PLUSES = 14;
/** The little green sparkles a heal gives off (vfx.healGlow), around each plus. */
const SPARKLES_PER_PLUS = 2;
/** The channel's length: the dawn sun climbs across it. */
const CHANNEL_SECONDS = 5;
/** The ground sun is only a faint outline, so the dome and the Paladin's
 * raised weapon carry the moment: the brightness of its strokes. */
export const PALADIN_AEGIS_SUN_OUTLINE = 0.3;
const DOME_GEOMETRY = new THREE.SphereGeometry(
  PALADIN_AEGIS_DOME_RADIUS,
  48,
  20,
  0,
  TAU,
  0,
  Math.PI / 2,
);
const GROUND_RING_GEOMETRY = new THREE.TorusGeometry(PALADIN_AEGIS_DOME_RADIUS, 0.06, 8, 96);
const GROUND_GEOMETRY = new THREE.PlaneGeometry(
  PALADIN_AEGIS_DOME_RADIUS * 2.1,
  PALADIN_AEGIS_DOME_RADIUS * 2.1,
);
const SUN_GEOMETRY = new THREE.SphereGeometry(0.42, 20, 12);
const BLADE_GEOMETRY = new THREE.BoxGeometry(0.1, 1.75, 0.05);
const GUARD_GEOMETRY = new THREE.BoxGeometry(0.7, 0.08, 0.08);

/** A plus of healing: rounded arms, a bright rim and a soft glow. */
function buildPlusTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size) * 2 - 1,
        py = ((y + 0.5) / size) * 2 - 1;
      // Distance to the union of two rounded bars.
      const bar = (hx: number, hy: number) => {
        const dx = Math.abs(px) - hx,
          dy = Math.abs(py) - hy;
        return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
      };
      const d = Math.min(bar(0.62, 0.17), bar(0.17, 0.62)) - 0.04;
      const body = d < 0 ? 0.75 : 0;
      const rim = Math.exp(-Math.abs(d) * 30);
      const glow = Math.exp(-Math.max(d, 0) * 6) * 0.5;
      const alpha = Math.min(1, body + rim + glow);
      if (alpha < 0.01) continue;
      const offset = (y * size + x) * 4;
      // White, so the sprite's colour tints it cleanly.
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

const PLUS_TEXTURE = buildPlusTexture();

/** A sparkle: a four-point glint with a bright core, as a heal's sparkles. */
function buildSparkleTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = Math.abs(((x + 0.5) / size) * 2 - 1),
        py = Math.abs(((y + 0.5) / size) * 2 - 1);
      const star = Math.max(
        Math.exp(-px * 16) * Math.exp(-py * 2.6),
        Math.exp(-py * 16) * Math.exp(-px * 2.6),
      );
      const core = Math.exp(-(px * px + py * py) * 18);
      const alpha = Math.min(1, star + core) * (1 - Math.max(0, Math.max(px, py) - 0.85) / 0.15);
      if (alpha < 0.01) continue;
      const offset = (y * size + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

const SPARKLE_TEXTURE = buildSparkleTexture();
const SIGN_GEOMETRY = new THREE.PlaneGeometry(1, 1);

/** The Sunmender's sign over the Paladin, drawn in light from the spec icon
 * atlas and always facing the camera; a plain sun disc until it loads. */
function signMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'paladin_aegis:sign',
    uniforms: { ...paladinSpecIconUniforms(), uAlpha: { value: 1 }, uPulse: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `
      varying vec2 vUv;
      void main(){
        vUv=uv;
        vec4 centre=modelViewMatrix*vec4(0.0,0.0,0.0,1.0);
        float size=length(modelMatrix[0].xyz);
        centre.xy+=position.xy*size;
        gl_Position=projectionMatrix*centre;
      }
    `,
    fragmentShader: `
      uniform float uAlpha, uPulse;
      varying vec2 vUv;
      ${PALADIN_SPEC_ICON_GLSL}
      float sq(float x){return x*x;}
      void main(){
        vec2 p=vUv*2.0-1.0;
        float r=length(p);
        float fill=0.0, line=0.0, glow;
        if(uSpecIconsReady>0.5){
          vec3 icon=paladinSpecIcon(p/0.78,0.0);
          fill=1.0-smoothstep(-0.01,0.02,icon.x);
          line=1.0-smoothstep(0.0,0.035,icon.y-0.008);
          glow=exp(-max(icon.x,0.0)*7.0)*0.22;
        } else {
          fill=1.0-smoothstep(0.3,0.34,r);
          glow=exp(-r*r*6.0)*0.4;
        }
        float ring=exp(-sq((r-0.9)/0.025))*0.5;
        float mask=(fill*0.22+line*1.0+glow+ring)*(1.0+uPulse*0.35)*uAlpha*(1.0-smoothstep(0.95,1.0,r));
        if(!(mask>=0.003)) discard;
        vec3 gold=vec3(1.0,0.8,0.42);
        vec3 hot=vec3(1.0,0.95,0.82);
        gl_FragColor=vec4(mix(gold,hot,clamp(line*0.6+fill*0.3+uPulse*0.3,0.0,1.0))*1.3,mask);
        #include <colorspace_fragment>
      }
    `,
  });
}

function additiveMaterial(
  role: string,
  color: number,
  opacity: number,
  side: THREE.Side = THREE.DoubleSide,
) {
  return new THREE.MeshBasicMaterial({
    name: `paladin_aegis:${role}`,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side,
    blending: THREE.AdditiveBlending,
  });
}

/** The dome: a clear shell of dawn light, brightest at its rim and base, with
 * fine ribs rising up it and a band of light climbing it on each pulse. */
function domeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'paladin_aegis:dome',
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uAlpha: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `
      varying vec3 vPoint;
      varying float vFacing;
      void main(){
        vPoint=position;
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        vec3 n=normalize(normalMatrix*normal);
        vFacing=abs(dot(n,normalize(-mv.xyz)));
        gl_Position=projectionMatrix*mv;
      }
    `,
    fragmentShader: `
      uniform float uTime, uPulse, uAlpha;
      varying vec3 vPoint;
      varying float vFacing;
      float sq(float x){return x*x;}
      void main(){
        float h=clamp(vPoint.y/${PALADIN_AEGIS_DOME_RADIUS.toFixed(1)},0.0,1.0);
        float ang=atan(vPoint.z,vPoint.x);
        // Rim light where the shell is seen edge on; nearly clear face on.
        float rim=pow(1.0-vFacing,3.0);
        // Fine ribs rising up the shell, fading toward the crown.
        float ribs=pow(max(cos(ang*16.0),0.0),80.0)*(1.0-smoothstep(0.55,0.95,h));
        // A warm band of dawn light about the base.
        float base=exp(-h*7.0);
        // Each pulse sends a band of light climbing the shell.
        float climb=1.0-uPulse;
        float wave=exp(-sq((h-climb)/0.05))*uPulse;
        float alpha=(0.012+rim*0.2+ribs*0.2+base*0.2+wave*0.55)*uAlpha;
        vec3 gold=vec3(1.0,0.78,0.38);
        vec3 hot=vec3(1.0,0.95,0.8);
        vec3 color=mix(gold,hot,clamp(base*0.6+wave+rim*0.3,0.0,1.0));
        gl_FragColor=vec4(color*1.2,alpha);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** The ground inside the dome: a rune circle at its edge, the faint outline of
 * a great sun at its heart, and ripples spreading out across it on each pulse. */
function groundMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'paladin_aegis:ground',
    uniforms: {
      uTime: { value: 0 },
      /** Seconds since each of the last three heals' ripples set out. */
      uRipples: { value: new THREE.Vector3(99, 99, 99) },
      uAlpha: { value: 1 },
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
      uniform float uTime, uAlpha;
      uniform vec3 uRipples;
      varying vec2 vUv;
      float sq(float x){return x*x;}
      // One heal's ripples at radius r, 'age' seconds after they set out: a
      // train of crests and troughs spreading until the last has passed the rim.
      float rippleTrain(float r,float age){
        float behind=age*0.8-r;
        return sin(behind*48.0)*smoothstep(0.0,0.04,behind)*exp(-behind*5.0);
      }
      ${PALADIN_RUNE_GLSL}
      void main(){
        // Units of the dome's radius: the rim at 1.
        vec2 p=(vUv*2.0-1.0)*1.05;
        float r=length(p);
        // Each heal sends ripples out from the Paladin, softening as they spread
        // and running on until they have passed the rim; the sun and runes
        // wobble as they pass.
        float wave=(rippleTrain(r,uRipples.x)+rippleTrain(r,uRipples.y)+rippleTrain(r,uRipples.z))
          *(1.0-0.5*smoothstep(0.2,1.0,r));
        float crest=sq(max(wave,0.0))*(1.0-smoothstep(0.75,1.0,r)*0.5);
        p+=p/max(r,0.001)*wave*0.012;
        r=length(p);
        float spin=uTime*0.05;
        vec2 q=vec2(p.x*cos(spin)-p.y*sin(spin),p.x*sin(spin)+p.y*cos(spin));
        float runes=paladinRuneRing(q,0.88,0.97);
        float a=atan(q.y,q.x);
        // A great sun, in outline only: a disc's edge inside a ring, and
        // sixteen tapered rays round it, long and short in turn, unfilled.
        float disc=exp(-sq((r-0.155)/0.006))*0.6;
        float ring=exp(-sq((r-0.19)/0.008))*0.95+exp(-sq((r-0.205)/0.004))*0.4;
        float sector=a/(6.2831853/16.0);
        float ray=floor(sector+0.5);
        float off=abs(fract(sector+0.5)-0.5)*(6.2831853/16.0)*r;
        float longRay=mod(ray,2.0)<0.5?1.0:0.0;
        float reach=mix(0.42,0.6,longRay);
        float width=mix(0.045,0.065,longRay)*clamp((reach-r)/(reach-0.23),0.0,1.0);
        float inRay=step(0.23,r)*step(r,reach);
        float d=off-width;
        float rayEdge=exp(-abs(d)*220.0)*inRay;
        float sunLine=${PALADIN_AEGIS_SUN_OUTLINE.toFixed(2)};
        float rays=rayEdge*0.7*sunLine;
        float heart=(disc+ring)*sunLine;
        float mask=((runes*0.75+rays+heart)*(1.0+wave*0.4)+crest*0.9)*(1.0-smoothstep(1.0,1.04,r))*uAlpha;
        if(!(mask>=0.003)) discard;
        vec3 gold=vec3(1.0,0.78,0.38);
        vec3 hot=vec3(1.0,0.95,0.8);
        gl_FragColor=vec4(mix(gold,hot,clamp(crest+heart+rayEdge*0.3,0.0,1.0))*1.25,mask);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * Aegis of the First Dawn: the Paladin plants their blade and raises a dome of
 * dawn light over the ground about them, its rune circle drawn at the rim and
 * pluses of healing rising through the dome among a heal's little green
 * sparkles.
 * The shell is clear but for its rim, its fine ribs and its warm base, so the
 * fight inside stays readable, and the faint outline of a great sun lies on the
 * ground within, so the dome and the Paladin's raised weapon carry the moment.
 * The Sunmender's sign, drawn in light with a soft sun glowing behind it,
 * rises over the Paladin through the channel. Each heal of the channel sends ripples out
 * across the ground and a band of light up the shell and flares the sign; the
 * last flares it as the dome lets go.
 */
export class PaladinAegisVisual {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly groundRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly sun: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  /** The Sunmender's sign over the Paladin. */
  private readonly sunHalo: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly plantedWeapon = new THREE.Group();
  private readonly pluses: THREE.Sprite[] = [];
  private readonly sparkles: THREE.Sprite[] = [];
  private time = 0;
  /** Seconds the dome has stood this channel: the sun rises across it. */
  private standing = 0;
  private pulseEnergy = 0;
  /** Seconds since each of the last three heals: their ripples spread across the ground. */
  private readonly ripples = new THREE.Vector3(99, 99, 99);
  private completionRemaining = 0;
  private disposed = false;
  private readonly ownedMaterials = new Set<THREE.Material>();

  constructor() {
    this.group.name = 'paladin-aegis-visual';
    this.group.visible = false;

    this.dome = new THREE.Mesh(DOME_GEOMETRY, domeMaterial());
    this.dome.name = 'paladin-aegis-dome';
    this.dome.renderOrder = floorVfxRenderOrder('player', 0);
    this.group.add(this.dome);

    this.groundRing = new THREE.Mesh(
      GROUND_RING_GEOMETRY,
      additiveMaterial('ground-ring', 0xffd86a, 0.6),
    );
    this.groundRing.name = 'paladin-aegis-ground-ring';
    this.groundRing.rotation.x = Math.PI / 2;
    this.groundRing.position.y = 0.06;
    this.groundRing.renderOrder = floorVfxRenderOrder('player', 2);
    this.group.add(this.groundRing);

    this.ground = new THREE.Mesh(GROUND_GEOMETRY, groundMaterial());
    this.ground.name = 'paladin-aegis-ground-runes';
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0.05;
    this.ground.renderOrder = floorVfxRenderOrder('player', 1);
    this.group.add(this.ground);

    this.sun = new THREE.Mesh(SUN_GEOMETRY, additiveMaterial('sun', 0xfff7d0, 0.92));
    this.sun.name = 'paladin-aegis-sun';
    this.sun.position.y = 4;
    this.sun.renderOrder = floorVfxRenderOrder('player', 3);
    this.group.add(this.sun);

    this.sunHalo = new THREE.Mesh(SIGN_GEOMETRY, signMaterial());
    this.sunHalo.frustumCulled = false;
    this.sunHalo.name = 'paladin-aegis-sun-halo';
    this.sunHalo.position.y = 4;
    this.sunHalo.scale.setScalar(1.6);
    this.sunHalo.renderOrder = floorVfxRenderOrder('player', 4);
    this.group.add(this.sunHalo);

    const blade = new THREE.Mesh(BLADE_GEOMETRY, additiveMaterial('blade', 0xfff4bd, 0.9));
    blade.position.y = 1.05;
    const guard = new THREE.Mesh(GUARD_GEOMETRY, additiveMaterial('guard', 0xffcc58, 0.9));
    guard.position.y = 0.52;
    this.plantedWeapon.name = 'paladin-aegis-planted-weapon';
    this.plantedWeapon.add(blade, guard);
    this.group.add(this.plantedWeapon);

    for (let index = 0; index < RISING_PLUSES; index++) {
      const plus = new THREE.Sprite(
        new THREE.SpriteMaterial({
          name: 'paladin_aegis:plus',
          map: PLUS_TEXTURE,
          color: index % 3 === 0 ? 0xffffff : 0xffe39a,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      plus.name = `paladin-aegis-plus-${index + 1}`;
      plus.renderOrder = floorVfxRenderOrder('player', 3);
      this.pluses.push(plus);
      this.group.add(plus);
    }
    for (let index = 0; index < RISING_PLUSES * SPARKLES_PER_PLUS; index++) {
      // Green as a heal's sparkles, with a gold one now and then (vfx.healGlow).
      const sparkle = new THREE.Sprite(
        new THREE.SpriteMaterial({
          name: 'paladin_aegis:sparkle',
          map: SPARKLE_TEXTURE,
          color: new THREE.Color(index % 3 === 2 ? 0xffe9a0 : 0xbaf7a0).multiplyScalar(1.8),
          toneMapped: false,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      sparkle.name = `paladin-aegis-sparkle-${index + 1}`;
      sparkle.renderOrder = floorVfxRenderOrder('player', 3);
      this.sparkles.push(sparkle);
      this.group.add(sparkle);
    }
    this.group.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (material)
        for (const item of Array.isArray(material) ? material : [material])
          this.ownedMaterials.add(item);
    });
  }

  pulse(completed: boolean): void {
    if (this.disposed) return;
    this.pulseEnergy = 1;
    // The oldest train makes way for the new one.
    const r = this.ripples;
    if (r.x >= r.y && r.x >= r.z) r.x = 0;
    else if (r.y >= r.z) r.y = 0;
    else r.z = 0;
    if (completed) this.completionRemaining = 0.55;
  }

  update(active: boolean, dt: number, reducedMotion: boolean, parentScale = 1): void {
    if (this.disposed) return;
    const seconds = Math.max(0, dt);
    this.pulseEnergy = Math.max(0, this.pulseEnergy - seconds * 1.6);
    const r = this.ripples;
    r.set(Math.min(99, r.x + seconds), Math.min(99, r.y + seconds), Math.min(99, r.z + seconds));
    this.completionRemaining = Math.max(0, this.completionRemaining - seconds);
    this.group.visible = active || this.completionRemaining > 0;
    this.dome.visible =
      this.groundRing.visible =
      this.ground.visible =
      this.plantedWeapon.visible =
        active;
    for (const plus of this.pluses) plus.visible = active;
    for (const sparkle of this.sparkles) sparkle.visible = active;
    if (!active) this.standing = 0;
    if (!this.group.visible) return;
    this.group.scale.setScalar(parentScale > 0 ? 1 / parentScale : 1);
    if (!reducedMotion) this.time += seconds;
    if (active) this.standing += seconds;

    const phase = reducedMotion ? 0.35 : this.time * 0.48;
    const pulse = reducedMotion ? 0 : this.pulseEnergy;
    this.dome.scale.setScalar(1);
    const dome = this.dome.material.uniforms;
    dome.uTime.value = this.time;
    dome.uPulse.value = pulse;
    dome.uAlpha.value = reducedMotion ? 0.65 : 0.62 + Math.sin(this.time * 2.2) * 0.08;
    const ground = this.ground.material.uniforms;
    ground.uTime.value = this.time;
    // The great sun underfoot is 20 m across: lit enough to read the dome's
    // edge, not so bright it washes out everyone standing in it.
    ground.uAlpha.value = 0.7;
    if (reducedMotion) ground.uRipples.value.setScalar(99);
    else ground.uRipples.value.copy(this.ripples);
    this.groundRing.rotation.z = phase * 0.35;
    // The dawn sun rises over the Paladin through the channel.
    const rise = Math.min(1, this.standing / CHANNEL_SECONDS);
    const sunY = 3.2 + PALADIN_BODY_FIT.aegisCrownLift + 2.2 * rise;
    this.sun.position.y = this.sunHalo.position.y = sunY;
    this.sun.scale.setScalar(
      (reducedMotion ? 1 : 1 + Math.sin(this.time * 5) * 0.08) * (0.8 + 0.4 * rise),
    );
    bindPaladinSpecIcons(this.sunHalo.material);
    const finish = this.completionRemaining / 0.55;
    this.sunHalo.material.uniforms.uAlpha.value = active ? 1 : finish;
    this.sunHalo.material.uniforms.uPulse.value = pulse;
    // The sun is a soft glow behind the sign.
    this.sun.material.opacity = (active ? 0.12 : finish * 0.12) * (1 + 0.5 * pulse);
    this.sunHalo.scale.setScalar(
      active
        ? (2.2 + pulse * 0.5) * (0.85 + 0.3 * rise)
        : 2.4 + (1 - finish) * (reducedMotion ? 0 : 2),
    );
    this.plantedWeapon.rotation.y = phase * 0.3;

    // Pluses of healing rising through the dome, swelling with each heal.
    for (let index = 0; index < this.pluses.length; index++) {
      const plus = this.pluses[index];
      const seed = (index * 0.618034) % 1;
      const cycle = (this.time * 0.22 + seed) % 1;
      const angle = index * 2.399963;
      const radius = PALADIN_AEGIS_DOME_RADIUS * (0.12 + 0.72 * ((index * 0.37) % 1));
      plus.position.set(Math.cos(angle) * radius, 0.3 + cycle * 3.6, Math.sin(angle) * radius);
      plus.material.opacity = Math.sin(cycle * Math.PI) * (0.45 + pulse * 0.35);
      plus.scale.setScalar((0.5 + 0.2 * seed) * (1 + pulse * 0.25));
      // Its sparkles drift up around and just behind it, twinkling.
      for (let k = 0; k < SPARKLES_PER_PLUS; k++) {
        const sparkle = this.sparkles[index * SPARKLES_PER_PLUS + k];
        const lag = (k + 1) * 0.045;
        const trail = (cycle - lag + 1) % 1;
        const swirl = this.time * 1.6 + k * 2.1 + seed * 6;
        const out = 0.22 + 0.12 * k;
        sparkle.position.set(
          plus.position.x + Math.cos(swirl) * out,
          0.3 + trail * 3.6,
          plus.position.z + Math.sin(swirl) * out,
        );
        const twinkle = 0.55 + 0.45 * Math.sin(this.time * 9 + index * 1.3 + k * 2.7);
        sparkle.material.opacity = Math.sin(trail * Math.PI) * twinkle * (0.8 + pulse * 0.2);
        sparkle.scale.setScalar((0.3 + 0.07 * k) * (1 + pulse * 0.3));
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.group.visible = false;
    const errors: unknown[] = [];
    try {
      this.group.removeFromParent();
    } catch (error) {
      errors.push(error);
    }
    for (const material of this.ownedMaterials) {
      try {
        material.dispose();
        this.ownedMaterials.delete(material);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Aegis material cleanup failed');
  }
}

export function syncPaladinAegisVisual(
  visual: PaladinAegisVisual | null,
  parent: THREE.Group,
  active: boolean,
  dt: number,
  reducedMotion: boolean,
  parentScale = 1,
  scene?: THREE.Scene,
): PaladinAegisVisual | null {
  let current = visual;
  if (active) current = attachPaladinAegisVisual(current, parent, scene);
  if (current && scene) {
    if (current.group.parent !== scene) scene.add(current.group);
    // Entity view groups are direct scene children; hidden rigs may have frozen matrices.
    current.group.position.copy(parent.position);
  }
  current?.update(active, dt, reducedMotion, scene ? 1 : parentScale);
  return current;
}

/** The one way a live Aegis visual is built and attached, for the sync and
 * the cue router alike: under the caster's view group (or the scene, for the
 * sync's hidden-rig arm). Its materials' programs are linked at boot by the
 * stand-in (buildPaladinAegisStandIn, ABILITY_MATERIAL_SOURCES), so the first
 * cast in view links nothing. */
function attachPaladinAegisVisual(
  current: PaladinAegisVisual | null,
  parent: THREE.Group,
  scene?: THREE.Scene,
): PaladinAegisVisual {
  if (current) return current;
  const visual = new PaladinAegisVisual();
  (scene ?? parent).add(visual.group);
  return visual;
}

/** Claim identified Aegis cues (each heal of the channel, and the closing
 * burst) before the generic zone rehit/ring dispatch: the dome pulses, and
 * the burst flares it as it lets go. A cue never invents an active channel:
 * only the sync (the caster's live aura) shows the dome itself. */
export function routePaladinAegisCue(
  event: Extract<SimEvent, { type: 'spellfxAt' }>,
  views: ReadonlyMap<number, { group: THREE.Group; paladinAegisVisual: PaladinAegisVisual | null }>,
): boolean {
  if (event.ability !== 'aegis_first_dawn' || (event.fx !== 'tick' && event.fx !== 'burst'))
    return false;
  const view = event.sourceId === undefined ? undefined : views.get(event.sourceId);
  if (view) {
    view.paladinAegisVisual = attachPaladinAegisVisual(view.paladinAegisVisual, view.group);
    view.paladinAegisVisual.pulse(event.fx === 'burst');
  }
  return true;
}

/**
 * The boot manifest's stand-in: one hidden visual, never disposed, so the
 * programs a live Aegis draws (the dome, ground and sign shaders, the additive
 * ring, sun and planted blade, the plus and sparkle sprites) are linked behind
 * the loading cover and stay referenced for the session, and preparing it
 * uploads the plus and sparkle textures. The live visual is built per caster
 * view when the channel first shows. Registered in ABILITY_MATERIAL_SOURCES.
 */
interface PaladinAegisStandIn {
  root: THREE.Group;
  materials: THREE.Material[];
}
let paladinAegisStandIn: PaladinAegisStandIn | null = null;

export function buildPaladinAegisStandIn(): PaladinAegisStandIn {
  if (!paladinAegisStandIn) {
    const visual = new PaladinAegisVisual();
    const root = visual.group;
    root.name = 'paladin-aegis-stand-in';
    root.visible = false;
    const materials: THREE.Material[] = [];
    root.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (material && !Array.isArray(material) && !materials.includes(material)) {
        materials.push(material);
      }
    });
    paladinAegisStandIn = { root, materials };
  }
  return paladinAegisStandIn;
}

export function paladinAegisStandInMaterials(): readonly THREE.Material[] {
  return buildPaladinAegisStandIn().materials;
}
