// Shared page-lifetime materials. All variants are staged at boot and under the
// live root's construction-time gate; phases only select an already-warm color.
import * as THREE from 'three';

interface TraceMaterials {
  gold: THREE.MeshBasicMaterial;
  blue: THREE.MeshBasicMaterial;
  red: THREE.MeshBasicMaterial;
  green: THREE.MeshBasicMaterial;
  publicBlue: THREE.MeshBasicMaterial;
  completionBlue: THREE.MeshBasicMaterial;
}
let materials: TraceMaterials | null = null;

export function worldQuestTraceMaterials(): TraceMaterials {
  if (materials) return materials;
  const make = (name: string, color: number): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({
      name: `calligraphy:${name}`,
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  materials = {
    gold: make('gold', 0xffd45b),
    blue: make('blue', 0x45c8ff),
    red: make('red', 0xff5252),
    green: make('green', 0x75f69a),
    publicBlue: make('public-blue', 0x459be5),
    completionBlue: make('completion-blue', 0xa4e8ff),
  };
  materials.publicBlue.opacity = 0.32;
  return materials;
}

export function traceRibbonGeometry(maxQuads: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(maxQuads * 18), 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setDrawRange(0, 0);
  return geometry;
}

export function buildWorldQuestTraceStandIn(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'world-quest-trace-prewarm';
  for (const material of Object.values(worldQuestTraceMaterials())) {
    const mesh = new THREE.Mesh(traceRibbonGeometry(1), material);
    mesh.visible = false;
    group.add(mesh);
  }
  return group;
}
