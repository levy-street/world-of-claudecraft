import * as THREE from 'three';
import { vi } from 'vitest';

export function sceneryFixture(x = 90) {
  const scene = new THREE.Scene(),
    root = new THREE.Group();
  root.name = 'jungle-features';
  scene.add(root);
  const mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> =
    new THREE.InstancedMesh(new THREE.BoxGeometry(8, 12, 8), new THREE.MeshLambertMaterial(), 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(20, 0, 0));
  mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(x, 0, 0));
  root.add(mesh);
  scene.updateMatrixWorld(true);
  const webgl = {
    shadowMap: { enabled: false },
    render: vi.fn(),
    compileAsync: vi.fn(async () => {}),
    getRenderTarget: () => null,
    getViewport: (v: THREE.Vector4) => v.set(0, 0, 900, 400),
    getScissor: (v: THREE.Vector4) => v.set(0, 0, 900, 400),
    getScissorTest: () => false,
    getClearColor: (v: THREE.Color) => v.set(0),
    getClearAlpha: () => 1,
    autoClear: true,
    setRenderTarget: vi.fn(),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    setClearColor: vi.fn(),
    clear: vi.fn(),
  };
  const renderer = {
    scene,
    camera: new THREE.PerspectiveCamera(),
    foliage: { update: vi.fn() },
    entryDetailHorizon: { sceneryCullFar: (d: number) => d },
    updateZoneFeatureVisibility: vi.fn(),
    zoneFeatureGroups: [{ group: root }],
    webgl,
    compileGate: vi.fn(async () => {}),
  };
  return { renderer, mesh, root };
}
