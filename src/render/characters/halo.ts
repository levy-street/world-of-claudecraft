// Glowing head halo (VisualDef.halo): a soft additive ring parented behind the
// head bone, the priest's Light. Texture + material are module-level caches
// shared by every clone; the mesh itself is per-visual and lives in the model
// subtree, so LOD/visibility toggles and scene removal need no extra plumbing
// (geometry/materials are shared caches and never disposed, like the rest of
// the character asset caches).
import * as THREE from 'three';

// Bone-space (raw KayKit rig units): a HORIZONTAL ring floating above the
// crown (angel style). A vertical disc behind the head fights the wide hat
// brim from half the camera angles; hovering above it never clips.
const HALO_RADIUS = 0.5;
const HALO_UP_OFFSET = 1.3;

let haloTex: THREE.Texture | null = null;
const haloMats = new Map<number, THREE.MeshBasicMaterial>();
let haloGeo: THREE.PlaneGeometry | null = null;

/** Soft annulus on a transparent canvas: bright ring band, feathered falloff. */
function haloTexture(): THREE.Texture {
  if (haloTex) return haloTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const c = size / 2;
    // ring only: a transparent center keeps the face readable (a filled
    // center reads as a glow BALL swallowing the whole chibi body in-world)
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0.0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    grad.addColorStop(0.64, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.8, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  haloTex = new THREE.CanvasTexture(canvas);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}

function haloMaterial(color: number): THREE.MeshBasicMaterial {
  let mat = haloMats.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      map: haloTexture(),
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    haloMats.set(color, mat);
  }
  return mat;
}

/** Build the per-visual halo mesh; the caller parents it to the head bone. */
export function buildHalo(color: number): THREE.Mesh {
  haloGeo ??= new THREE.PlaneGeometry(HALO_RADIUS * 2, HALO_RADIUS * 2);
  const mesh = new THREE.Mesh(haloGeo, haloMaterial(color));
  mesh.name = 'class_halo';
  mesh.position.set(0, HALO_UP_OFFSET, 0);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // parented to an animated bone: bind-pose bounds lie, and the plane is tiny
  mesh.frustumCulled = false;
  return mesh;
}
