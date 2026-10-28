import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BossImpostorField } from '../../src/render/boss_impostor';
import { prepareVisual, tintedFarMaterials } from '../../src/render/characters/assets';
import { NEUTRAL_DAY_GRADE } from '../../src/render/day_night_core';
import { buildSceneRestoreCompileUnits } from '../../src/render/initial_scene_compile_units';
import type { Entity } from '../../src/sim/types';

vi.mock('../../src/render/characters/assets', () => ({
  prepareVisual: vi.fn(),
  tintedFarMaterials: vi.fn(),
}));
vi.mock('../../src/render/characters/manifest', () => ({
  visualKeyFor: () => 'fixture',
}));

describe('boss imposter retained program on real WebGL', () => {
  it('prewarms before its first atlas and reuses the owned program after restore and departures', async () => {
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(32, 32, false);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 1, 4);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld();
    const field = new BossImpostorField(scene);
    const root = scene.getObjectByName('bossImpostors');
    expect(root).toBeDefined();
    const sourceGeometry = new THREE.BoxGeometry(1, 2, 1);
    const sourceMaterial = new THREE.MeshBasicMaterial({ color: 0x55aa55 });
    vi.mocked(prepareVisual).mockReturnValue({
      idleGeo: sourceGeometry,
      def: {},
      idleSrcMats: [sourceMaterial],
      idleSrcIsBody: [true],
    } as unknown as ReturnType<typeof prepareVisual>);
    vi.mocked(tintedFarMaterials).mockReturnValue([sourceMaterial]);
    const entity = {
      id: 123,
      kind: 'mob',
      templateId: 'balgath_cyclops',
      pos: { x: 0, y: 0, z: 0 },
      prevPos: { x: 0, y: 0, z: 0 },
      facing: 0,
      prevFacing: 0,
      dead: false,
      asleep: false,
    } as Entity;
    const sync = (entities: Entity[]) =>
      field.sync(
        renderer,
        entities,
        camera,
        { x: 0, z: 10 },
        null,
        () => false,
        NEUTRAL_DAY_GRADE,
        0,
        1,
      );
    const program = (material: THREE.Material) => {
      const state = renderer.properties.get(material) as {
        currentProgram?: { program: WebGLProgram; usedTimes: number };
      };
      expect(state.currentProgram).toBeDefined();
      if (!state.currentProgram) throw new Error('Material has no compiled program');
      return state.currentProgram;
    };
    const errors: string[] = [];
    renderer.debug.onShaderError = (gl, linked) => errors.push(gl.getProgramInfoLog(linked) ?? '');
    const link = vi.spyOn(WebGL2RenderingContext.prototype, 'linkProgram');
    try {
      expect(root?.children).toHaveLength(1);
      const keeper = root?.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      expect(keeper.visible).toBe(false);
      expect(keeper.material.uniforms.uAtlas.value).toBeNull();
      await renderer.compileAsync(scene, camera);
      const beforeLoss = program(keeper.material);
      expect(beforeLoss.usedTimes).toBe(1);
      renderer.render(scene, camera);
      expect(renderer.info.render.calls).toBe(0);
      expect(prepareVisual).not.toHaveBeenCalled();

      const extension = renderer.getContext().getExtension('WEBGL_lose_context');
      expect(extension).not.toBeNull();
      const lost = new Promise<Event>((resolve) =>
        renderer.domElement.addEventListener('webglcontextlost', resolve, { once: true }),
      );
      extension?.loseContext();
      await lost;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const restored = new Promise<Event>((resolve) =>
        renderer.domElement.addEventListener('webglcontextrestored', resolve, { once: true }),
      );
      extension?.restoreContext();
      await restored;
      // The production hold links only visible roots plus explicit hidden program
      // anchors. A raw scene compile here would mask a missing anchor registration.
      const restoreUnits = buildSceneRestoreCompileUnits({
        scene,
        reach: 'visible',
        playerX: 0,
        playerZ: 0,
        batchSize: 1,
        sharedDedupe: { seen: new Set(), seenKeys: new Set() },
        compileColor: (compileRoot) => renderer.compileAsync(compileRoot, camera, scene),
        compileShadow: async () => {},
      });
      expect(restoreUnits.length).toBeGreaterThan(0);
      for (const unit of restoreUnits) await unit.run();
      const prewarmed = program(keeper.material);
      expect(prewarmed).not.toBe(beforeLoss);
      expect(prewarmed.usedTimes).toBe(1);

      for (let visit = 0; visit < 3; visit++) {
        sync([entity]);
        expect(root?.children).toHaveLength(2);
        const sprite = root?.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
        expect(sprite.geometry).toBe(keeper.geometry);
        expect(sprite.material.uniforms.uAtlas.value.isRenderTargetTexture).toBe(true);
        const linksBeforeDraw = link.mock.calls.length;
        renderer.render(scene, camera);
        expect(program(sprite.material)).toBe(prewarmed);
        expect(prewarmed.usedTimes).toBe(2);
        expect(link.mock.calls).toHaveLength(linksBeforeDraw);
        expect(renderer.info.render.calls).toBe(1);

        const disposed = vi.fn();
        sprite.material.addEventListener('dispose', disposed);
        sync([]);
        expect(disposed).toHaveBeenCalledOnce();
        expect(root?.children).toEqual([keeper]);
        expect(prewarmed.usedTimes).toBe(1);
        renderer.render(scene, camera);
        expect(renderer.info.render.calls).toBe(0);
      }
      expect(prepareVisual).toHaveBeenCalledOnce();
      expect(errors).toEqual([]);
      field.dispose();
      expect(prewarmed.usedTimes).toBe(0);
      expect(root?.parent).toBeNull();
    } finally {
      if (root?.parent) field.dispose();
      sourceGeometry.dispose();
      sourceMaterial.dispose();
      link.mockRestore();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  });
});
