// Moonwing Form's crown (VisualDef.sporeHalo): a thin ring tilted above the head with
// a loose scatter of spores and small stars turning through it. The ring is real geometry
// and the scatter layers lean different ways, so the crown never goes edge-on at eye
// level. It all draws in one glow program, the shared rig_fx.ts recipe, so the crown
// links nothing new; the kit is registered in ABILITY_MATERIAL_SOURCES all the same, for
// its painted maps.
//
// The crown rides the rig's `Head` bone but is placed in model space: Tripo's bone axes
// have nothing to do with the world's, so the bind matrix turns the model-space rest
// below into the bone's own. Units are the model's, whose height is 1 (the rig's
// normScale carries them to world size). Tripo bipeds face +X.
import * as THREE from 'three';
import { markSharedGeometry } from '../shared_resource';
import {
  sporeHaloRingTexture,
  sporeHaloScatterTexture,
  sporeHaloStarsTexture,
} from './form_adornment_textures';
import { markRigFx, rigGlowMaterial, tagStandInForTextureUpload } from './rig_fx';

/** The crown's rest, model space: just over the bald head, leaning slightly so the
 *  face stays clear of the ring. */
const CROWN_HEIGHT = 1.012;
const CROWN_TILT = new THREE.Euler(-0.2, 0, -0.14);
/** The painted square's edge, past the ring by the scatter's reach. */
const PLANE_SIZE = 0.38;
const RING_RADIUS = 0.122;
const RING_TUBE = 0.0042;

const RING_COLOR = 0x62c8ff;
const SPORE_COLOR = 0x8fe4ff;
const STAR_COLOR = 0xd9c8ff;

/** Each scatter layer: height off the ring, lean in radians, and turn in radians per second. */
const LAYERS = [
  { y: 0, leanX: 0.3, leanZ: 0, spin: 0.14 },
  { y: 0.016, leanX: -0.22, leanZ: 0.26, spin: -0.09 },
  { y: -0.012, leanX: 0.1, leanZ: -0.34, spin: 0.2 },
] as const;

interface SporeHaloKit {
  ring: THREE.MeshBasicMaterial;
  spores: THREE.MeshBasicMaterial;
  stars: THREE.MeshBasicMaterial;
  plane: THREE.BufferGeometry;
  band: THREE.BufferGeometry;
}

let kit: SporeHaloKit | null = null;

function sporeHaloKit(): SporeHaloKit {
  kit ??= {
    // Plain alpha, not additive: over a bright daytime sky additive light has nowhere to
    // go, and the crown washes out to a white streak.
    ring: rigGlowMaterial(
      'spore_halo:ring',
      sporeHaloRingTexture(),
      RING_COLOR,
      THREE.NormalBlending,
    ),
    spores: rigGlowMaterial(
      'spore_halo:spores',
      sporeHaloScatterTexture(),
      SPORE_COLOR,
      THREE.NormalBlending,
    ),
    stars: rigGlowMaterial(
      'spore_halo:stars',
      sporeHaloStarsTexture(),
      STAR_COLOR,
      THREE.NormalBlending,
    ),
    plane: markSharedGeometry(
      new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE).rotateX(-Math.PI / 2),
    ),
    band: markSharedGeometry(
      new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 6, 96).rotateX(Math.PI / 2),
    ),
  };
  return kit;
}

/** Every material the crown draws, for the prewarm registration. */
export function sporeHaloMaterials(): THREE.Material[] {
  const { ring, spores, stars } = sporeHaloKit();
  return [ring, spores, stars];
}

function layer(geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh {
  const out = markRigFx(new THREE.Mesh(geometry, material));
  out.name = name;
  out.renderOrder = 2;
  // parented to an animated bone: bind-pose bounds lie
  out.frustumCulled = false;
  return out;
}

/** The head bone's bind matrix in model space, or null off a skinned rig. */
function bindOf(model: THREE.Object3D, bone: THREE.Object3D): THREE.Matrix4 | null {
  let bind: THREE.Matrix4 | null = null;
  model.traverse((object) => {
    const skeleton = (object as THREE.SkinnedMesh).skeleton;
    if (bind || !skeleton) return;
    // By name: a cloned rig's skeleton can hold other objects than the graph's bones.
    const index = skeleton.bones.findIndex((b) => b.name === bone.name);
    if (index >= 0) bind = skeleton.boneInverses[index].clone().invert();
  });
  return bind;
}

/** One rig's crown, attached to its `Head` bone until disposed. */
export class SporeHalo {
  readonly root: THREE.Group | null = null;
  private readonly layers: THREE.Mesh[] = [];

  constructor(model: THREE.Object3D) {
    const bone = model.getObjectByName('Head');
    if (!bone) return;
    const k = sporeHaloKit();
    const root = markRigFx(new THREE.Group());
    root.name = 'spore_halo';
    root.add(layer(k.band, k.ring, 'spore_halo_ring'));
    LAYERS.forEach((spec, i) => {
      const lean = markRigFx(new THREE.Group());
      lean.position.y = spec.y;
      lean.rotation.set(spec.leanX, 0, spec.leanZ);
      const mesh = layer(k.plane, i === 1 ? k.stars : k.spores, `spore_halo_scatter_${i}`);
      lean.add(mesh);
      root.add(lean);
      this.layers.push(mesh);
    });
    const bind = bindOf(model, bone);
    if (bind) {
      const head = new THREE.Vector3().setFromMatrixPosition(bind);
      const rest = new THREE.Matrix4().compose(
        new THREE.Vector3(head.x, CROWN_HEIGHT, head.z),
        new THREE.Quaternion().setFromEuler(CROWN_TILT),
        new THREE.Vector3(1, 1, 1),
      );
      bind.invert().multiply(rest).decompose(root.position, root.quaternion, root.scale);
    }
    bone.add(root);
    this.root = root;
  }

  /** Turn the scatter. Reduced motion holds it still; `visible` false holds the clock
   *  for a culled or far-LOD rig. */
  update(dt: number, reducedMotion: boolean, visible: boolean): void {
    if (reducedMotion || !visible) return;
    for (let i = 0; i < this.layers.length; i++) {
      this.layers[i].rotation.y += LAYERS[i].spin * dt;
    }
  }

  /** Detach from the rig. The kit is shared and stays alive. */
  dispose(): void {
    this.root?.removeFromParent();
  }
}

/** The hidden prewarm stand-in: a bare `Head` wearing the crown, its meshes in the
 *  `vfx` render category so the ability-primitives entry uploads the painted maps. */
export function buildSporeHaloStandIn(): THREE.Group {
  const root = new THREE.Group();
  const head = new THREE.Group();
  head.name = 'Head';
  root.add(head);
  new SporeHalo(root);
  tagStandInForTextureUpload(root);
  return root;
}
