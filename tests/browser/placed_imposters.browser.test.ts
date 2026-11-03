import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PlacedImposters } from '../../src/render/placed_imposters';

describe('placed imposter mapped prewarm on real WebGL', () => {
  it.each([64, 128])(
    'reuses the seed program for the first %i px atlas sprite after context restore',
    async (cellPx) => {
      const renderer = new THREE.WebGLRenderer({ antialias: false });
      renderer.setSize(32, 32, false);
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x556677, 1, 100);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2));
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(0, 1, 4);
      camera.lookAt(0, 1, 0);
      camera.updateMatrixWorld();
      const view = new PlacedImposters({ cellPx });
      view.setRenderer(renderer);
      scene.add(view.mesh);
      const material = view.mesh.material as THREE.MeshLambertMaterial;
      const seed = material.map;
      const seedDisposed = vi.fn();
      seed?.addEventListener('dispose', seedDisposed);
      const sourceGeometry = new THREE.BoxGeometry(1, 2, 1);
      const sourceMaterial = new THREE.MeshBasicMaterial({ color: 0x55aa55 });
      const errors: string[] = [];
      renderer.debug.onShaderError = (gl, program) =>
        errors.push(gl.getProgramInfoLog(program) ?? '');
      const link = vi.spyOn(WebGL2RenderingContext.prototype, 'linkProgram');
      const program = () => {
        const state = renderer.properties.get(material) as {
          currentProgram?: { program: WebGLProgram };
        };
        const current = state.currentProgram;
        expect(current).toBeDefined();
        if (!current) throw new Error('Material has no compiled program');
        expect(
          renderer
            .getContext()
            .getProgramParameter(current.program, renderer.getContext().LINK_STATUS),
        ).toBe(true);
        return current;
      };
      try {
        // Compile the actual hidden, empty imposter mesh, as the resident collector does.
        await renderer.compileAsync(view.mesh, camera, scene);
        const beforeLoss = program();
        expect(view.bakedCount).toBe(0);
        expect(view.mesh.visible).toBe(false);
        expect(seed).not.toBeNull();

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
        expect(material.map).toBe(seed);
        expect(seedDisposed).not.toHaveBeenCalled();
        await renderer.compileAsync(view.mesh, camera, scene);
        const prewarmed = program();
        expect(prewarmed).not.toBe(beforeLoss);

        // Real lazy bake swaps in a RenderTarget texture, rather than a synthetic map assignment.
        expect(
          view.ensure('fixture', [
            {
              geometry: sourceGeometry,
              material: sourceMaterial,
              local: new THREE.Matrix4(),
              sources: [0],
              sourceLocals: [new THREE.Matrix4()],
            },
          ]),
        ).toBe(true);
        expect(material.map).not.toBe(seed);
        expect(material.map?.isRenderTargetTexture).toBe(true);
        expect(seedDisposed).not.toHaveBeenCalled();
        const linksBeforeSprite = link.mock.calls.length;
        expect(view.attach(1, 'fixture', 0, 0, 0, 0, 1, 1)).toBe(true);
        renderer.render(scene, camera);
        expect(program()).toBe(prewarmed);
        expect(link.mock.calls).toHaveLength(linksBeforeSprite);
        expect(renderer.info.render.calls).toBeGreaterThan(0);
        expect(errors).toEqual([]);
      } finally {
        view.dispose();
        expect(seedDisposed).toHaveBeenCalledOnce();
        sourceGeometry.dispose();
        sourceMaterial.dispose();
        link.mockRestore();
        renderer.dispose();
        renderer.forceContextLoss();
      }
    },
  );
});
