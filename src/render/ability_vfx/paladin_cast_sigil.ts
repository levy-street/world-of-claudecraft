import * as THREE from 'three';
import { PALADIN_BODY_FIT } from '../paladin_body_fit';
import {
  forgetShieldSigil,
  noteShieldSigil,
  SHIELD_SIGN_RISE,
  SHIELD_SIGN_WIDTH,
} from '../paladin_shield_buffs';
import type { VfxAnchorResolver } from '../vfx_anchor';
import type { WeaponAnchorSampler } from '../weapon_trail_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { PALADIN_SPEC_EMBLEM_GLSL, paladinSpecEmblemIndex } from './paladin_spec_emblems';
import {
  bindPaladinSpecIcons,
  PALADIN_SPEC_ICON_GLSL,
  paladinSpecIconUniforms,
} from './paladin_spec_icons';

type HandSample = (id: number, hand: 0 | 1, out: THREE.Vector3) => boolean;
/** The shield `id` holds in the off hand, or null when they hold none. */
type ShieldOf = (id: number) => WeaponAnchorSampler | null;
const CAPACITY = 16;
const ATTRIBUTES = ['position', 'aUvAlpha', 'aAge', 'aSpec'] as const;
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
export const CAST_SIGIL_DURATION = 0.95;
/** A held sigil stays at this age, fully lit, and jumps to the swell on release. */
export const CAST_SIGIL_LIT = 0.4;
const CAST_SIGIL_SWELL = 0.7;
/** Quad half-size and emblem scale inside it, as fractions of body height.
 * The emblem keeps its former size; the margin holds its glow. */
const EMBLEM_IN_QUAD = 1.82;
/** On a shield, the quad's half-size and the icon's rise, as shares of the
 * face's half-width: the icon lies exactly over the sign the shield's glow
 * burns on its face. */
export const SHIELD_QUAD = EMBLEM_IN_QUAD * SHIELD_SIGN_WIDTH;
const SHIELD_RISE = SHIELD_SIGN_RISE;
/** How far the sigil lies off the shield's surface, in world units. */
const SHIELD_LIFT = 0.045;

function easeOutBack(t: number): number {
  const c = 1.7;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}
/** Pops in with a slight overshoot, then swells as it releases into the shield. */
export function castSigilScale(age: number): number {
  const appear = 0.75 + 0.25 * easeOutBack(Math.min(1, Math.max(0, age / 0.25)));
  const release = Math.min(1, Math.max(0, (age - 0.7) / 0.25));
  return appear + 0.35 * release * release;
}
export function castSigilAlpha(age: number): number {
  if (age < 0 || age >= CAST_SIGIL_DURATION) return 0;
  return (
    Math.min(1, Math.max(0, (age - 0.05) / 0.1)) * Math.min(1, (CAST_SIGIL_DURATION - age) / 0.25)
  );
}

/** The caster's spec icon (Sunmender, Faithwarden or Dawnreaver) invoked
 * above the live offhand during the shield salute: it ignites from its centre
 * as glowing strokes, then swells and fades as the shield forms. The icon
 * alone, with no ring or backing. A Paladin holding a shield bears it on the
 * shield's face instead, lying in the face's plane. */
export class PaladinCastSigil {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'paladin_cast_sigil'>;
  private readonly slots = Array.from({ length: CAPACITY }, () => ({
    id: -1,
    age: 0,
    /** Kept lit through a cast (Mending Light) until it lands or stops. */
    held: false,
    touched: false,
    /** PALADIN_SPEC_EMBLEMS index of the icon. */
    spec: 1,
    /** The shield it is borne on, resolved as it ignites (null: none held). */
    shield: null as WeaponAnchorSampler | null,
  }));
  private readonly face = new THREE.Matrix4();
  private readonly faceRight = new THREE.Vector3();
  private readonly faceUp = new THREE.Vector3();
  private readonly faceNormal = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly positions = new Float32Array(CAPACITY * 18);
  private readonly uvAlpha = new Float32Array(CAPACITY * 18);
  private readonly ages = new Float32Array(CAPACITY * 6);
  private readonly specs = new Float32Array(CAPACITY * 6);
  private readonly hand = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly anchor: VfxAnchorResolver,
    private readonly sampleHand?: HandSample,
    private readonly shieldOf?: ShieldOf,
  ) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'aUvAlpha',
      new THREE.BufferAttribute(this.uvAlpha, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'aAge',
      new THREE.BufferAttribute(this.ages, 1).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'aSpec',
      new THREE.BufferAttribute(this.specs, 1).setUsage(THREE.DynamicDrawUsage),
    );
    const material = new THREE.ShaderMaterial({
      uniforms: paladinSpecIconUniforms(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `attribute vec3 aUvAlpha; attribute float aAge, aSpec;
        varying vec3 vUvAlpha; varying float vAge, vSpec;
        void main(){vUvAlpha=aUvAlpha;vAge=aAge;vSpec=aSpec;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vUvAlpha; varying float vAge, vSpec;
        ${PALADIN_SPEC_EMBLEM_GLSL}
        ${PALADIN_SPEC_ICON_GLSL}
        const vec3 ROSE=vec3(1.25,0.7,0.52);
        const vec3 GOLD=vec3(1.0,0.65,0.22);
        const vec3 IVORY=vec3(1.4,1.31,1.08);
        float sq(float x){return x*x;}
        void main(){
          float t=vAge;
          vec2 q=vUvAlpha.xy;
          vec2 p=q*${EMBLEM_IN_QUAD.toFixed(2)};
          // The simplified spec icon ignites from its centre: a solid glyph with
          // a bright edge and soft glow, and a front travelling outward as it lights.
          float front=clamp((t-0.08)/0.5,0.0,1.0)*2.7;
          float reveal=1.0-smoothstep(front-0.15,front,length(p));
          // The approved solid icon from the atlas, the built-in one until it loads.
          float sd=paladinSpecSigilDist(p,vSpec);
          float accent=0.0;
          if(uSpecIconsReady>0.5){
            vec3 icon=paladinSpecIcon(p,vSpec);
            sd=icon.x;
            accent=icon.z;
          }
          float d=abs(sd);
          float stroke=1.0-smoothstep(0.0,0.025,d);
          float fill=1.0-smoothstep(-0.01,0.01,sd);
          // A tight glow hugging the icon and a wide soft halo, both fading out
          // well inside the quad.
          float glow=exp(-max(sd,0.0)*14.0)*0.4+exp(-max(sd,0.0)*3.5)*0.16;
          float emblem=(fill*0.75+stroke*0.45+glow)*reveal;
          emblem+=exp(-sq((length(p)-front)*10.0))*exp(-d*30.0)*1.2*(1.0-smoothstep(0.3,0.45,t));
          float mask=emblem*(1.0-smoothstep(0.7,1.0,length(q)));
          float alpha=mask*vUvAlpha.z;
          if(!(alpha>=0.005)) discard;
          vec3 col=mix(GOLD,IVORY,clamp(stroke*reveal,0.0,1.0));
          col=mix(col,ROSE,accent*fill*0.8);
          gl_FragColor=vec4(col,alpha);}`,
    });
    material.name = 'paladin_cast_sigil:surface';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'paladin-offhand-cast-sigil';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(
      scene,
      new Map([['paladin_cast_sigil', geometry]]),
      material,
    );
  }

  /** A salute by `id`, bearing the icon of `spec` (Faithwarden when unknown). */
  cast(id: number, spec?: string | null): boolean {
    if (this.disposed || !this.preparation.ready('paladin_cast_sigil')) return false;
    const slot = this.slots.find((s) => s.id === id) ?? this.slots.find((s) => s.id < 0);
    if (!slot) return false;
    if (slot.id === id && slot.held) {
      // The cast lands: the held sigil swells and fades rather than restarting.
      this.letGo(slot);
      return true;
    }
    slot.id = id;
    slot.age = 0;
    slot.held = false;
    slot.spec = paladinSpecEmblemIndex(spec);
    slot.shield = this.shieldOf?.(id) ?? null;
    return true;
  }

  /** Once a frame while a cast (Mending Light) is held: the sigil ignites on
   * the raised off-hand and stays lit until `cast` lands it or the hold stops. */
  hold(id: number, spec?: string | null): boolean {
    if (this.disposed || !this.preparation.ready('paladin_cast_sigil')) return false;
    let slot = this.slots.find((s) => s.id === id);
    if (!slot?.held) {
      slot = slot ?? this.slots.find((s) => s.id < 0);
      if (!slot) return false;
      slot.id = id;
      slot.age = 0;
      slot.held = true;
      slot.spec = paladinSpecEmblemIndex(spec);
      slot.shield = this.shieldOf?.(id) ?? null;
    }
    slot.touched = true;
    return true;
  }

  private letGo(slot: { age: number; held: boolean }): void {
    slot.held = false;
    slot.age = Math.max(slot.age, CAST_SIGIL_SWELL);
  }

  update(dt: number): void {
    if (this.disposed) return;
    bindPaladinSpecIcons(this.mesh.material);
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.eye.setFromMatrixPosition(this.camera.matrixWorld);
    let vertex = 0;
    for (const slot of this.slots) {
      if (slot.id < 0) continue;
      if (slot.held && !slot.touched) this.letGo(slot);
      slot.touched = false;
      slot.age += Math.max(0, dt);
      if (slot.held) slot.age = Math.min(slot.age, CAST_SIGIL_LIT);
      if (
        slot.age >= CAST_SIGIL_DURATION ||
        !this.anchor(slot.id, 0, this.feet) ||
        !this.anchor(slot.id, 1, this.head)
      ) {
        this.end(slot);
        continue;
      }
      const height = this.head.y - this.feet.y;
      // On a shield: over its face, in the face's plane and sized to it, and
      // the shield lights as Bastion Rite lights it. Otherwise above the
      // off-hand, facing the camera.
      let size: number;
      let right = this.right;
      let up = this.up;
      if (slot.shield?.frame?.(this.face)) {
        const e = this.face.elements;
        this.hand.set(e[12], e[13], e[14]);
        this.faceRight.set(e[0], e[1], e[2]);
        this.faceUp.set(e[4], e[5], e[6]);
        this.faceNormal.set(e[8], e[9], e[10]);
        const half = slot.shield.faceHalf?.() ?? 0;
        size =
          (half > 0 ? half * SHIELD_QUAD : height * PALADIN_BODY_FIT.sigilHalf) *
          castSigilScale(slot.age);
        this.hand.addScaledVector(this.faceUp, half * SHIELD_RISE);
        // Borne on the side the camera sees: the salute turns the face
        // outward, away from a camera behind the caster, so their own sigil
        // shows on the shield's back, read the right way round.
        if (this.eye.sub(this.hand).dot(this.faceNormal) < 0) {
          const depth = slot.shield.faceDepth?.() ?? 0;
          this.hand.addScaledVector(this.faceNormal, -(depth + SHIELD_LIFT * 2));
          this.faceRight.negate();
        }
        this.eye.setFromMatrixPosition(this.camera.matrixWorld);
        right = this.faceRight;
        up = this.faceUp;
        noteShieldSigil(slot.id, 1 - slot.age / CAST_SIGIL_DURATION, slot.spec);
      } else if (this.sampleHand?.(slot.id, 1, this.hand)) {
        if (slot.shield) forgetShieldSigil(slot.id);
        this.hand.y += height * PALADIN_BODY_FIT.sigilLift;
        size = height * PALADIN_BODY_FIT.sigilHalf * castSigilScale(slot.age);
      } else {
        this.end(slot);
        continue;
      }
      const alpha = castSigilAlpha(slot.age);
      for (let corner = 0; corner < 6; corner++) {
        const x = CORNERS[corner * 2],
          y = CORNERS[corner * 2 + 1];
        const offset = vertex * 3;
        this.positions[offset] = this.hand.x + (right.x * x + up.x * y) * size;
        this.positions[offset + 1] = this.hand.y + (right.y * x + up.y * y) * size;
        this.positions[offset + 2] = this.hand.z + (right.z * x + up.z * y) * size;
        this.uvAlpha[offset] = x;
        this.uvAlpha[offset + 1] = y;
        this.uvAlpha[offset + 2] = alpha;
        this.specs[vertex] = slot.spec;
        this.ages[vertex++] = slot.age;
      }
    }
    for (const name of ATTRIBUTES) {
      const attribute = this.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      if (vertex) {
        attribute.addUpdateRange(0, vertex * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
    if (this.preparation.ready('paladin_cast_sigil')) this.mesh.geometry.setDrawRange(0, vertex);
    this.mesh.visible = vertex > 0;
  }

  /** The sigil has faded: any shield it lit goes dark with it. */
  private end(slot: { id: number; held: boolean; shield: WeaponAnchorSampler | null }): void {
    if (slot.shield && slot.id >= 0) forgetShieldSigil(slot.id);
    slot.id = -1;
    slot.held = false;
    slot.shield = null;
  }

  clear(): void {
    for (const slot of this.slots) this.end(slot);
    this.mesh.visible = false;
    if (this.preparation.ready('paladin_cast_sigil')) this.mesh.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.preparation.dispose();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
