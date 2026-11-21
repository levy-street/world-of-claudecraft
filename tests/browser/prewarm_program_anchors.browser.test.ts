import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { applyEnvSheen } from '../../src/render/characters/env_sheen';
import { attachGloamClimb } from '../../src/render/characters/gloam_climb';
import { addRimGlow } from '../../src/render/gfx';
import { buildSceneRestoreCompileUnits } from '../../src/render/initial_scene_compile_units';
import { cloneMaterialWithHooks } from '../../src/render/material_clone_hooks';
import {
  buildPrewarmProgramAnchors,
  disposePrewarmProgramAnchors,
} from '../../src/render/prewarm_program_anchors';

type Shape = 'rigid' | 'skinned' | 'skinned-morph';
interface LinkedProgram {
  id: number;
  usedTimes: number;
  program: WebGLProgram;
}

function fixture(shapes: Shape[]) {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(32, 32, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20);
  camera.position.z = 4;
  camera.updateMatrixWorld();
  scene.fog = new THREE.Fog(0x556677, 1, 12);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2));
  const source = new THREE.Group();
  const texture = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  const materials: THREE.Material[] = [];
  for (const [index, shape] of shapes.entries()) {
    const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute(
      'color',
      new THREE.Uint8BufferAttribute(new Uint8Array(count * 4).fill(255), 4, true),
    );
    geometry.setAttribute(
      'tangent',
      new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 1]).flat(), 4),
    );
    if (shape === 'skinned-morph') {
      geometry.morphTargetsRelative = true;
      geometry.morphAttributes.position = [0, 1].map(
        () => new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3),
      );
      geometry.morphAttributes.normal = [0, 1].map(
        () => new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3),
      );
    }
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      normalMap: texture,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
    });
    // These are the real hooks the player catalog's standard materials carry,
    // not a synthetic custom key that the clone helper cannot reconstruct.
    addRimGlow(material);
    attachGloamClimb(material);
    applyEnvSheen(material, 0.5);
    materials.push(material);
    let mesh: THREE.Mesh;
    if (shape === 'rigid') mesh = new THREE.Mesh(geometry, material);
    else {
      geometry.setAttribute(
        'skinIndex',
        new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
      );
      const weights = new Float32Array(count * 4);
      for (let vertex = 0; vertex < count; vertex++) weights[vertex * 4] = 1;
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      const rootBone = new THREE.Bone();
      const tipBone = new THREE.Bone();
      rootBone.add(tipBone);
      const skin = new THREE.SkinnedMesh(geometry, material);
      skin.add(rootBone);
      skin.bind(new THREE.Skeleton([rootBone, tipBone]));
      mesh = skin;
    }
    mesh.name = shape;
    mesh.position.x = (index - (shapes.length - 1) / 2) * 1.2;
    source.add(mesh);
  }
  const owner = {};
  const anchors = buildPrewarmProgramAnchors(owner, source);
  scene.add(source, anchors);
  const errors: string[] = [];
  renderer.debug.onShaderError = (gl, program) => errors.push(gl.getProgramInfoLog(program) ?? '');
  const link = vi.spyOn(WebGL2RenderingContext.prototype, 'linkProgram');
  const programFor = (material: THREE.Material): LinkedProgram => {
    const state = renderer.properties.get(material) as { currentProgram?: LinkedProgram };
    expect(state.currentProgram).toBeDefined();
    if (!state.currentProgram) throw new Error('Material has no compiled program');
    const gl = renderer.getContext();
    expect(gl.getProgramParameter(state.currentProgram.program, gl.LINK_STATUS)).toBe(true);
    return state.currentProgram;
  };
  const programsFor = (material: THREE.Material): Map<string, LinkedProgram> => {
    const state = renderer.properties.get(material) as { programs?: Map<string, LinkedProgram> };
    if (!state.programs) throw new Error('Material has no compiled variants');
    return state.programs;
  };
  const dispose = (): void => {
    link.mockRestore();
    disposePrewarmProgramAnchors(owner);
    for (const mesh of source.children as THREE.Mesh[]) {
      mesh.geometry.dispose();
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).skeleton.dispose();
    }
    for (const material of materials) material.dispose();
    texture.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
  return {
    renderer,
    scene,
    camera,
    source,
    anchors,
    materials,
    errors,
    link,
    programFor,
    programsFor,
    dispose,
  };
}

describe('compact shader anchors on the real WebGL renderer', () => {
  it.each<Shape>(['rigid', 'skinned', 'skinned-morph'])(
    'retains the exact %s program after the source material is disposed',
    async (shape) => {
      const f = fixture([shape]);
      try {
        const sourceMesh = f.source.children[0] as THREE.Mesh;
        const sourceMaterial = sourceMesh.material as THREE.Material;
        const anchor = f.anchors.children[0] as THREE.Mesh;
        await f.renderer.compileAsync(f.source, f.camera, f.scene);
        const original = f.programFor(sourceMaterial);
        const links = f.link.mock.calls.length;
        await f.renderer.compileAsync(f.anchors, f.camera, f.scene);
        expect(f.programFor(anchor.material as THREE.Material)).toBe(original);
        expect(f.link.mock.calls).toHaveLength(links);
        expect(original.usedTimes).toBe(2);
        expect(anchor.geometry.getAttribute('position').count).toBe(3);
        expect(f.anchors.visible).toBe(false);

        const liveMaterial = cloneMaterialWithHooks(sourceMaterial);
        f.materials.push(liveMaterial);
        sourceMaterial.dispose();
        // A positive owner count is decisive even with Three's idle retention
        // cache: the program is actively held and cannot be evicted from it.
        expect(original.usedTimes).toBe(1);
        sourceMesh.material = liveMaterial;
        f.renderer.render(f.scene, f.camera);
        expect(f.programFor(liveMaterial)).toBe(original);
        expect(f.link.mock.calls).toHaveLength(links);
        expect(f.renderer.info.render.calls).toBeGreaterThan(0);
        expect(f.errors).toEqual([]);
        expect(f.renderer.getContext().getError()).toBe(f.renderer.getContext().NO_ERROR);
      } finally {
        f.dispose();
      }
    },
  );

  it('relinks the hidden recipes before the first live draw after a real context restore', async () => {
    const f = fixture(['rigid', 'skinned']);
    try {
      await f.renderer.compileAsync(f.anchors, f.camera, f.scene);
      f.renderer.render(f.scene, f.camera);
      const oldPrograms = (f.anchors.children as THREE.Mesh[]).map((mesh) =>
        f.programFor(mesh.material as THREE.Material),
      );
      const extension = f.renderer.getContext().getExtension('WEBGL_lose_context');
      expect(extension).not.toBeNull();
      const lost = new Promise<Event>((resolve) =>
        f.renderer.domElement.addEventListener('webglcontextlost', resolve, { once: true }),
      );
      extension?.loseContext();
      await lost;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const restored = new Promise<Event>((resolve) =>
        f.renderer.domElement.addEventListener('webglcontextrestored', resolve, { once: true }),
      );
      extension?.restoreContext();
      await restored;
      expect(f.anchors.visible).toBe(false);
      expect(f.renderer.info.programs).toHaveLength(0);
      const compiled: THREE.Object3D[] = [];
      // The real restore hold's collector includes these hidden roots before
      // identical visible meshes; no world render occurs until it settles.
      const units = buildSceneRestoreCompileUnits({
        scene: f.scene,
        reach: 'visible',
        playerX: 0,
        playerZ: 0,
        batchSize: 1,
        sharedDedupe: { seen: new Set(), seenKeys: new Set() },
        compileColor: async (root) => {
          compiled.push(root);
          await f.renderer.compileAsync(root, f.camera, f.scene);
        },
        compileShadow: async () => {},
      });
      for (const unit of units) await unit.run();
      expect(compiled).toEqual(f.anchors.children);
      const restoredPrograms = (f.anchors.children as THREE.Mesh[]).map((mesh, index) => {
        const program = f.programFor(mesh.material as THREE.Material);
        expect(program).not.toBe(oldPrograms[index]);
        return f.programsFor(mesh.material as THREE.Material);
      });
      const linksBeforeReveal = f.link.mock.calls.length;
      f.renderer.render(f.scene, f.camera);
      expect(f.link.mock.calls).toHaveLength(linksBeforeReveal);
      for (const [index, mesh] of (f.source.children as THREE.Mesh[]).entries()) {
        const programs = f.programsFor(mesh.material as THREE.Material);
        expect(programs.size).toBeGreaterThan(0);
        for (const [key, program] of programs) {
          // Double-sided transparent render and compile can leave different
          // variants in currentProgram; each actual draw must reuse an anchor.
          expect(program).toBe(restoredPrograms[index].get(key));
        }
      }
      expect(f.renderer.info.render.calls).toBeGreaterThan(0);
      expect(f.errors).toEqual([]);
    } finally {
      f.dispose();
    }
  });
});
