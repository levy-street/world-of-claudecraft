// The baked additive floor pool under a torch or molten prop: the point
// light budget keeps only the nearest few lights live, so the warm floor
// pools are baked geometry. ONE process-lifetime geometry, texture, and
// material-per-color cache shared by every caller (the dungeon torch rigs
// and the Ignivar raid dressing), extracted from DungeonInteriors's private
// addTorchGlow on the rule of three. Callers own their tier gating.
import * as THREE from 'three';
import { markSharedGeometry, markSharedMaterial, markSharedTexture } from './shared_resource';
import { radialGlowTexture } from './textures';

let glowDecalGeo: THREE.BufferGeometry | null = null;
let glowDecalTex: THREE.Texture | null = null;
const glowDecalMats = new Map<number, THREE.MeshBasicMaterial>();

export function addTorchGlowDecal(
  group: THREE.Group,
  x: number,
  z: number,
  colorHex: number,
  y = 0.07,
  scale = 1,
): void {
  glowDecalGeo ??= markSharedGeometry(new THREE.CircleGeometry(6.6, 20).rotateX(-Math.PI / 2));
  glowDecalTex ??= markSharedTexture(radialGlowTexture());
  let mat = glowDecalMats.get(colorHex);
  if (!mat) {
    mat = markSharedMaterial(
      new THREE.MeshBasicMaterial({
        map: glowDecalTex,
        color: colorHex,
        transparent: true,
        opacity: 0.46,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    ) as THREE.MeshBasicMaterial;
    glowDecalMats.set(colorHex, mat);
  }
  const glow = new THREE.Mesh(glowDecalGeo, mat);
  glow.position.set(x, y, z);
  glow.scale.setScalar(scale);
  glow.renderOrder = 1; // after the floor it floats over
  group.add(glow);
}
