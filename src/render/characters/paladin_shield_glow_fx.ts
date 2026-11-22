import * as THREE from 'three';
import { PALADIN_SPEC_EMBLEM_GLSL } from '../ability_vfx/paladin_spec_emblems';
import {
  bindPaladinSpecIcons,
  PALADIN_SPEC_ICON_GLSL,
  paladinSpecIconUniforms,
} from '../ability_vfx/paladin_spec_icons';
import { paladinVfxDetailNow } from '../ability_vfx/paladin_vfx_detail';
import { type PaladinVfxDetail, paladinDetailScale } from '../ability_vfx/paladin_vfx_detail_core';
import { SHIELD_SIGN_RISE, SHIELD_SIGN_WIDTH } from '../paladin_shield_buffs';

// Detail: core = the glow layer itself (edges, the spec sign, the bash's build
// and contact flash, Bastion Rite's steady light and its fade, a Sunward Disc
// flash): it draws on every tier; secondary = none; accents = the flare as
// Bastion Rite lands and the rite light's slow breathing. The detail is read as
// a rite lands and held while it holds.

/** The shield meets its target this far into the bash (Woc_Shield_Bash's
 * contact, WOC_CONTACTS in the game's manifest). */
export const PALADIN_SHIELD_GLOW_CONTACT = 0.292;
/** Faithwarden: Bastion Sweep is the Faithwarden's (paladin_spec_emblems.ts). */
const FAITHWARDEN = 1;

export interface PaladinShieldGlowPlan {
  /** The layer's steady light, 0 to 1. */
  glow: number;
  /** The flash of the blow landing. */
  flash: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smooth(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/** The glow over the bash, `timeSeconds` into the clip (null: not bashing):
 * builds through the windup, flashes on contact, then fades. */
export function paladinShieldGlowPlan(
  timeSeconds: number | null,
  durationSeconds: number,
): PaladinShieldGlowPlan {
  if (timeSeconds === null || timeSeconds < 0 || timeSeconds >= durationSeconds)
    return { glow: 0, flash: 0 };
  const contact = PALADIN_SHIELD_GLOW_CONTACT;
  const since = timeSeconds - contact;
  const build = smooth(timeSeconds / contact);
  const fade = 1 - smooth((timeSeconds - (contact + 0.08)) / (durationSeconds - contact - 0.18));
  return {
    glow: build * fade,
    flash: since < 0 ? 0 : Math.exp(-since * 14) * (1 - smooth(since / 0.25)),
  };
}

const VERTEX = `
  uniform float uPush;
  varying vec3 vLocal;
  varying vec3 vLocalNormal;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  void main(){
    vLocal=position;
    vLocalNormal=normalize(normal);
    vec4 view=modelViewMatrix*vec4(position+normalize(normal)*uPush,1.0);
    vViewNormal=normalize(normalMatrix*normal);
    vViewDir=normalize(-view.xyz);
    gl_Position=projectionMatrix*view;
  }
`;

const FRAGMENT = `
  uniform float uGlow, uFlash, uTime, uFront, uUp, uMark, uSpec;
  uniform vec3 uCenter, uHalf;
  varying vec3 vLocal;
  varying vec3 vLocalNormal;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  float sq(float x){return x*x;}
  ${PALADIN_SPEC_ICON_GLSL}
  ${PALADIN_SPEC_EMBLEM_GLSL}
  void main(){
    // Edges catch the light: brightest where the shield turns from view.
    float facing=abs(dot(normalize(vViewNormal),normalize(vViewDir)));
    float rim=pow(max(1.0-facing,0.0),2.2);
    // The spec sign on the shield's face (the Faithwarden's unless a cast sigil
    // bears another), in its own plane (local x across, y up), on the front
    // face only.
    vec2 q=(vLocal.xy-uCenter.xy)/uHalf.x;
    // (The face curves, so any surface turned even a little to the front counts.)
    float face=smoothstep(0.05,0.35,vLocalNormal.z*uFront);
    vec2 e=vec2(q.x,(q.y-${SHIELD_SIGN_RISE.toFixed(3)})*uUp)/${SHIELD_SIGN_WIDTH.toFixed(3)};
    float mark=0.0;
    if(uSpecIconsReady>0.5){
      vec3 icon=paladinSpecIcon(e,uSpec);
      mark=max(1.0-smoothstep(0.0,0.04,icon.y-0.006),(1.0-smoothstep(-0.01,0.02,icon.x))*0.35);
    } else {
      float d=paladinSpecDist(e,uSpec);
      mark=max(1.0-smoothstep(0.012,0.03,abs(d)),(1.0-smoothstep(-0.01,0.01,d))*0.3);
    }
    mark*=face*uMark;
    // A band of light sweeping up across the face.
    float sweep=exp(-sq((q.y*uUp*0.45+q.x*0.25-fract(uTime*0.9)*2.2+0.9)/0.12))*mix(1.0,face,uMark);
    float alpha=(0.07+rim*0.7+mark*1.8+sweep*0.25)*uGlow+uFlash*(0.35+rim*0.5+mark*1.0);
    if(!(alpha>=0.003)) discard;
    vec3 gold=vec3(1.0,0.78,0.38);
    vec3 hot=vec3(1.0,0.95,0.8);
    gl_FragColor=vec4(mix(gold,hot,clamp(mark+rim*0.3+uFlash*0.5,0.0,1.0))*1.4,alpha);
    #include <colorspace_fragment>
  }
`;

/** The glow layer's material: one program for every layer, shield and weapon
 * alike (the boot stand-in below holds it), per-layer values in its uniforms. */
function shieldGlowMaterial(
  mark: number,
  spec: number,
  push: number,
  center: THREE.Vector3,
  half: THREE.Vector3,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'paladin_shield_glow_fx:layer',
    uniforms: {
      ...paladinSpecIconUniforms(),
      uGlow: { value: 0 },
      uFlash: { value: 0 },
      uTime: { value: 0 },
      uFront: { value: 1 },
      uUp: { value: 1 },
      uMark: { value: mark },
      uSpec: { value: spec },
      uPush: { value: push },
      uCenter: { value: center },
      uHalf: { value: half },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/**
 * The boot manifest's stand-in: one hidden layer over a small box (a geometry
 * with normals, like every layer: one without gets its own normals first),
 * never disposed, so the layer program is linked behind the loading cover and
 * stays referenced while live layers come and go with the shields they light.
 * Registered in ABILITY_MATERIAL_SOURCES.
 */
interface PaladinShieldGlowStandIn {
  root: THREE.Group;
  materials: THREE.Material[];
}
let paladinShieldGlowStandIn: PaladinShieldGlowStandIn | null = null;

export function buildPaladinShieldGlowStandIn(): PaladinShieldGlowStandIn {
  if (!paladinShieldGlowStandIn) {
    const root = new THREE.Group();
    root.name = 'paladin-shield-glow-stand-in';
    root.visible = false;
    const material = shieldGlowMaterial(
      1,
      FAITHWARDEN,
      0.01,
      new THREE.Vector3(),
      new THREE.Vector3(0.5, 0.5, 0.5),
    );
    const layer = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    layer.name = 'paladinShieldGlow';
    root.add(layer);
    paladinShieldGlowStandIn = { root, materials: [material] };
  }
  return paladinShieldGlowStandIn;
}

export function paladinShieldGlowStandInMaterials(): readonly THREE.Material[] {
  return buildPaladinShieldGlowStandIn().materials;
}

interface Layer {
  source: THREE.Mesh;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** A geometry of our own, when the shield's carried no normals. */
  ownGeometry: THREE.BufferGeometry | null;
}

/**
 * A glowing layer laid over the shield the Paladin holds, through Bastion
 * Sweep's bash and for as long as Bastion Rite holds: its own geometry lifted
 * a hair off the surface, edges bright, the Faithwarden's sign burning on its
 * face. Bastion Rite flares it as the rite lands, keeps it glowing, and lets it
 * fade as the rite runs out. The shield itself is never
 * detached, hidden or replaced; the layer is a child of each shield mesh in
 * the off hand and goes with them.
 *
 * The same layer, with no sign, lights the weapon in the main hand (hand
 * 'right'); its owner drives it with drive().
 */
export class PaladinShieldGlowFx {
  private readonly layers: Layer[] = [];
  private elapsed = 0;
  private visible = false;
  /** Bastion Rite's steady light on the shield, eased toward its target. */
  private rite = 0;
  /** Whether a rite was held last frame, and the flare of one landing. */
  private riteHeld = false;
  private riteFlare = 0;
  /** The spec icon burning on the face (PALADIN_SPEC_EMBLEMS index). */
  private spec = FAITHWARDEN;
  /** The detail the held rite draws at: read as it lands, kept while it holds. */
  private detail: PaladinVfxDetail = 'full';

  constructor(
    private readonly model: THREE.Object3D,
    private readonly side: 'left' | 'right' = 'left',
  ) {}

  private hand(): THREE.Object3D | undefined {
    // A rig may carry more than one slot by the name: take the one holding gear.
    const s = this.side === 'left' ? 'l' : 'r';
    let first: THREE.Object3D | undefined;
    let held: THREE.Object3D | undefined;
    this.model.traverse((object) => {
      if (held || (object.name !== `handslot${s}` && object.name !== `handslot.${s}`)) return;
      first ??= object;
      object.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && !child.userData.paladinShieldGlow) held ??= object;
      });
    });
    return held ?? first;
  }

  /** Builds the layers for what the hand holds now, hidden, so a first glow
   * mounts nothing: the visual calls it once the rig is built and again after
   * every weapon attach, ahead of the compile gate where the rig is new. */
  prepare(): void {
    this.sync();
  }

  /** Lays a layer over every shield mesh in the off hand that has none yet,
   * and drops the layers of shields no longer held. */
  private sync(): void {
    const hand = this.hand();
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      let held = false;
      for (let o: THREE.Object3D | null = layer.source; o; o = o.parent)
        if (o === hand) held = true;
      if (held) continue;
      this.disposeLayer(layer);
      this.layers.splice(i, 1);
    }
    if (!hand) return;
    hand.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.paladinShieldGlow) return;
      if (this.layers.some((layer) => layer.source === mesh)) return;
      const source = mesh.geometry;
      if (!source?.getAttribute('position')) return;
      let geometry = source;
      let ownGeometry: THREE.BufferGeometry | null = null;
      if (!source.getAttribute('normal')) {
        ownGeometry = source.clone();
        ownGeometry.computeVertexNormals();
        geometry = ownGeometry;
      }
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox ?? new THREE.Box3();
      const center = box.getCenter(new THREE.Vector3());
      const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const material = shieldGlowMaterial(
        this.side === 'left' ? 1 : 0,
        this.spec,
        Math.max(half.x, half.y, half.z) * 0.02,
        center,
        half,
      );
      const layer = new THREE.Mesh(geometry, material);
      layer.name = 'paladinShieldGlow';
      layer.userData.paladinShieldGlow = true;
      layer.userData.weaponVfxMesh = true;
      layer.userData.renderCategory = 'vfx';
      layer.castShadow = false;
      layer.receiveShadow = false;
      layer.renderOrder = 5;
      layer.visible = false;
      this.layers.push({ source: mesh, mesh: layer, ownGeometry });
    });
    // Parent after the walk, so the walk never meets its own layers.
    for (const layer of this.layers) if (!layer.mesh.parent) layer.source.add(layer.mesh);
  }

  /** `timeSeconds` into the bash clip of `durationSeconds`, or null when not
   * bashing; `rite` is the share of Bastion Rite still to run, or null when
   * the Paladin holds none; `flash` a flash of the shield (Sunward Disc);
   * `spec` the icon of a cast sigil borne on it (null: the Faithwarden's). */
  update(
    timeSeconds: number | null,
    durationSeconds: number,
    dt: number,
    rite: number | null = null,
    flash: number | null = null,
    spec: number | null = null,
  ): void {
    this.spec = spec ?? FAITHWARDEN;
    const step = Math.max(0, dt);
    if (rite !== null && !this.riteHeld) {
      this.detail = paladinVfxDetailNow();
      if (paladinDetailScale(this.detail).accents) this.riteFlare = 1;
    }
    const breathe = paladinDetailScale(this.detail).accents;
    this.riteHeld = rite !== null;
    // Steady while the rite holds, fading over its last fifth.
    const target = rite === null ? 0 : 0.7 * Math.min(1, rite / 0.2 + 0.1);
    this.rite += (target - this.rite) * Math.min(1, step * 6);
    this.riteFlare = Math.max(0, this.riteFlare - step * 2.5);
    const bash = paladinShieldGlowPlan(timeSeconds, durationSeconds);
    const kick = flash ?? 0;
    this.drive(
      Math.max(
        bash.glow,
        this.rite * (breathe ? 0.9 + 0.1 * Math.sin(this.elapsed * 2.5) : 0.9),
        kick * 0.7,
      ),
      Math.max(bash.flash, this.riteFlare * 0.85, kick),
      step,
    );
  }

  /** Shows the layer at `glow` steady light and `flash`, both 0 to 1. */
  drive(glow: number, flash: number, dt: number): void {
    const step = Math.max(0, dt);
    const plan = { glow, flash };
    const on = plan.glow > 0.002 || plan.flash > 0.002;
    if (!on) {
      if (this.visible) for (const layer of this.layers) layer.mesh.visible = false;
      this.visible = false;
      return;
    }
    this.elapsed += step;
    if (!this.visible) this.sync();
    this.visible = true;
    for (const layer of this.layers) {
      const material = layer.mesh.material;
      bindPaladinSpecIcons(material);
      material.uniforms.uGlow.value = plan.glow;
      material.uniforms.uFlash.value = plan.flash;
      material.uniforms.uTime.value = this.elapsed;
      material.uniforms.uSpec.value = this.spec;
      layer.mesh.visible = layer.source.visible;
    }
  }

  private disposeLayer(layer: Layer): void {
    layer.mesh.removeFromParent();
    layer.mesh.material.dispose();
    layer.ownGeometry?.dispose();
  }

  dispose(): void {
    for (const layer of this.layers) this.disposeLayer(layer);
    this.layers.length = 0;
  }
}
