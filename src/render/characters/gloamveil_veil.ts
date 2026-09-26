// Gloamveil's adornment, the THREE half of form_adornment_core.ts: a veil of
// gloom drawn over the Shadow priest's face, a dark shell that follows the head
// and hides every feature but two burning eyes. The form's name, made literal.
//
// Parented to the rig's `head` bone, so it rides every clip and far-LOD hide
// the body does. Geometry and materials are module-level kits shared by every
// Gloamveil on screen and never disposed (the halo.ts doctrine). The kit is
// registered in ABILITY_MATERIAL_SOURCES (ability_material_prewarm.ts) through
// `buildGloamveilStandIn`, and the first mount on a rig waits behind the
// compile gate (form_adornments.ts), as Moonwing's does. Both materials follow
// the shared rig_fx.ts glow recipe (the veil with normal blending, the eyes
// additive), so they share one program with Moonwing's glow pieces.
//
// Units are raw KayKit bone space. The shell is an ellipsoid cap just outside
// the modular head (x +-0.45, y -0.03 to 0.81, z -0.47 to 0.53), deep enough in
// front to swallow the projected brows too, covering the face from brow to
// chin; tuned by capture (scripts/form_adornment_shot.mjs).
import * as THREE from 'three';
import { markSharedGeometry } from '../shared_resource';
import { eyeGlowTexture, veilTexture } from './form_adornment_textures';
import { markRigFx, rigGlowMaterial, tagStandInForTextureUpload } from './rig_fx';

/** The gloom itself: a violet-black, nearly opaque at the face. */
const VEIL_COLOR = 0x120822;
/** The burning eyes: Gloamveil's shadow violet, run hot. */
const EYE_COLOR = 0xdcbcff;

/** The head ellipsoid the shell wraps, head-bone space. */
export const VEIL_SHELL = {
  center: { y: 0.39, z: 0.03 },
  radii: { x: 0.5, y: 0.47, z: 0.61 },
  /** Azimuth span around the facing axis, and the brow-to-chin polar band. */
  phiLength: 2.1,
  thetaStart: 0.72,
  thetaLength: 1.62,
} as const;
/** The eyes, head-bone space (x mirrors per side). */
export const VEIL_EYES = { x: 0.16, y: 0.36, z: 0.64, width: 0.26, height: 0.14 } as const;

interface GloamveilKit {
  veil: THREE.MeshBasicMaterial;
  eye: THREE.MeshBasicMaterial;
  shellGeometry: THREE.SphereGeometry;
  eyeGeometry: THREE.PlaneGeometry;
}

let kit: GloamveilKit | null = null;

function gloamveilKit(): GloamveilKit {
  if (kit) return kit;
  const shell = new THREE.SphereGeometry(
    1,
    24,
    14,
    // SphereGeometry's azimuth puts +Z (the face) at phi = PI / 2.
    Math.PI / 2 - VEIL_SHELL.phiLength / 2,
    VEIL_SHELL.phiLength,
    VEIL_SHELL.thetaStart,
    VEIL_SHELL.thetaLength,
  );
  shell.scale(VEIL_SHELL.radii.x, VEIL_SHELL.radii.y, VEIL_SHELL.radii.z);
  shell.translate(0, VEIL_SHELL.center.y, VEIL_SHELL.center.z);
  kit = {
    veil: rigGlowMaterial('gloamveil_veil:veil', veilTexture(), VEIL_COLOR, THREE.NormalBlending),
    eye: rigGlowMaterial('gloamveil_veil:eye-glow', eyeGlowTexture(), EYE_COLOR),
    shellGeometry: markSharedGeometry(shell),
    eyeGeometry: markSharedGeometry(new THREE.PlaneGeometry(VEIL_EYES.width, VEIL_EYES.height)),
  };
  return kit;
}

/** Every material a Gloamveil rig can draw, for the prewarm registration. */
export function gloamveilMaterials(): THREE.Material[] {
  const { veil, eye } = gloamveilKit();
  return [veil, eye];
}

/** One rig's veil, attached to its head bone until disposed. */
export class GloamveilVeil {
  readonly root: THREE.Group | null = null;
  /** The groups this set parented into the rig (see MoonwingAdornment.roots). */
  readonly roots: readonly THREE.Object3D[] = [];
  private readonly eyes: THREE.Mesh[] = [];

  constructor(model: THREE.Object3D) {
    const headBone = model.getObjectByName('head');
    if (!headBone) return;
    const k = gloamveilKit();
    const root = markRigFx(new THREE.Group());
    root.name = 'gloamveil_veil';
    const shell = markRigFx(new THREE.Mesh(k.shellGeometry, k.veil));
    shell.name = 'gloamveil_shell';
    // Drawn before the eyes: both are transparent, and the additive eyes must
    // land ON the gloom, never under it.
    shell.renderOrder = 1;
    root.add(shell);
    for (const side of [-1, 1] as const) {
      const eye = markRigFx(new THREE.Mesh(k.eyeGeometry, k.eye));
      eye.name = side < 0 ? 'gloamveil_eye_left' : 'gloamveil_eye_right';
      eye.position.set(VEIL_EYES.x * side, VEIL_EYES.y, VEIL_EYES.z);
      // A slight inward tilt, so the pair reads as a narrowed glare.
      eye.rotation.z = side * -0.18;
      eye.renderOrder = 2;
      root.add(eye);
      this.eyes.push(eye);
    }
    headBone.add(root);
    this.root = root;
    this.roots = [root];
  }

  /** Scale the eyes by this frame's smoulder (form_adornment_core). */
  apply(eyeGlow: number): void {
    for (const eye of this.eyes) eye.scale.setScalar(eyeGlow);
  }

  /** Detach from the rig. The kit is shared and stays alive. */
  dispose(): void {
    this.root?.removeFromParent();
  }
}

/** The hidden prewarm stand-in: a bare `head` wearing the veil, so the
 *  compile lane links every program a live Gloamveil draws (and, through the
 *  `vfx` tag, the ability-primitives entry uploads its painted maps). */
export function buildGloamveilStandIn(): THREE.Group {
  const root = new THREE.Group();
  const head = new THREE.Group();
  head.name = 'head';
  root.add(head);
  new GloamveilVeil(root).apply(1);
  tagStandInForTextureUpload(root);
  return root;
}
