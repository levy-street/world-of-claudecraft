import * as THREE from 'three';
import { attachBiomeHaze, biomeHazeFragmentGlsl } from '../biome_haze_field';
import { cloneMaterialWithHooks } from '../material_clone_hooks';
import type { SceneryPlacement } from './types';

interface GiantFrame {
  center: THREE.Vector3;
  width: number;
  height: number;
}
interface Atlas {
  start: number;
  end: number;
  target: THREE.WebGLRenderTarget;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}
export interface GiantBuildOptions {
  items: readonly SceneryPlacement[];
  scene: THREE.Scene;
  webgl: THREE.WebGLRenderer;
  prepare<T>(work: () => T | Promise<T>, label: string): Promise<T>;
  gate(root: THREE.Group): Promise<unknown>;
  prepareBake(
    scene: THREE.Scene,
    camera: THREE.Camera,
    target: THREE.WebGLRenderTarget,
  ): Promise<void>;
  cancelled(): boolean;
}

function lightColor(scene: THREE.Scene, output: THREE.Color): void {
  output.setRGB(0, 0, 0);
  for (const child of scene.children) {
    const light = child as THREE.Light;
    if (
      !(light as THREE.HemisphereLight).isHemisphereLight &&
      !(light as THREE.DirectionalLight).isDirectionalLight
    )
      continue;
    if (!light.visible) continue;
    output.r += light.color.r * light.intensity;
    output.g += light.color.g * light.intensity;
    output.b += light.color.b * light.intensity;
  }
}

/** Sixteen 256px views per giant (22.5-degree steps in a 1024px atlas) so
 * asymmetric leaning crowns hold their silhouette without 90-degree flips.
 * Live light grading and biome haze prevent a frozen noon card. */
export async function buildGiantSprites(options: GiantBuildOptions): Promise<GiantSprites> {
  const root = new THREE.Group();
  root.name = 'scenery-band:giants';
  root.visible = false;
  const atlases: Atlas[] = [];
  const frames = options.items.map((item) => {
    const size = item.box.getSize(new THREE.Vector3());
    return {
      center: item.box.getCenter(new THREE.Vector3()),
      width: Math.hypot(size.x, size.z) * 1.04,
      height: size.y * 1.04,
    };
  });
  const bakedLight = new THREE.Color();
  lightColor(options.scene, bakedLight);
  const release = (): void => {
    root.removeFromParent();
    for (const atlas of atlases) {
      atlas.target.dispose();
      atlas.mesh.geometry.dispose();
      atlas.mesh.material.dispose();
    }
    atlases.length = 0;
  };
  const assertActive = (): void => {
    if (options.cancelled()) throw new Error('Giant scenery preparation cancelled');
  };
  try {
    for (let start = 0; start < options.items.length; start += 1) {
      assertActive();
      const end = Math.min(start + 1, options.items.length);
      const target = new THREE.WebGLRenderTarget(1024, 1024, {
        depthBuffer: true,
        stencilBuffer: false,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      const count = end - start;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(new Float32Array(count * 12), 3),
      );
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 8), 2));
      geometry.setIndex(
        Array.from({ length: count }, (_, i) => [
          i * 4,
          i * 4 + 1,
          i * 4 + 2,
          i * 4 + 2,
          i * 4 + 1,
          i * 4 + 3,
        ]).flat(),
      );
      geometry.setDrawRange(0, 0);
      const material = new THREE.MeshBasicMaterial({
        map: target.texture,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
      });
      material.name = 'scenery-band:giant-atlas';
      attachBiomeHaze(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      root.add(mesh);
      atlases.push({ start, end, target, mesh });
      const bake = new THREE.Scene();
      bake.environment = options.scene.environment;
      bake.environmentIntensity = options.scene.environmentIntensity;
      bake.environmentRotation.copy(options.scene.environmentRotation);
      for (const child of options.scene.children)
        if (
          (child as THREE.HemisphereLight).isHemisphereLight ||
          (child as THREE.DirectionalLight).isDirectionalLight
        )
          bake.add(child.clone());
      const materials: THREE.Material[] = [];
      const groups: THREE.Group[] = [];
      try {
        for (let i = start; i < end; i++) {
          const group = new THREE.Group();
          for (const part of options.items[i].parts) {
            const source = part.source.material;
            const clone = cloneMaterialWithHooks(source);
            // Source-specific hooks retain their local-space inputs because
            // the bake draws the original geometry under its own transform.
            clone.onBeforeCompile = (shader, renderer): void => {
              source.onBeforeCompile(shader, renderer);
              // Bake the subject, not the air at its temporary atlas origin.
              // Live atmosphere is applied once by the displayed sprite.
              shader.fragmentShader = shader.fragmentShader.replace(
                biomeHazeFragmentGlsl('wocHazeVXZ'),
                '',
              );
            };
            clone.customProgramCacheKey = () =>
              `${source.customProgramCacheKey()}|scenery-giant-bake`;
            (clone as THREE.MeshLambertMaterial).fog = false;
            clone.toneMapped = false;
            const colored = clone as THREE.MeshLambertMaterial;
            if (colored.color) colored.color.multiply(part.tint);
            materials.push(clone);
            const partMesh = new THREE.Mesh(part.source.geometry, clone);
            partMesh.matrixAutoUpdate = false;
            partMesh.matrix.copy(part.matrix);
            partMesh.matrix.elements[12] -= frames[i].center.x;
            partMesh.matrix.elements[13] -= frames[i].center.y;
            partMesh.matrix.elements[14] -= frames[i].center.z;
            group.add(partMesh);
          }
          bake.add(group);
          groups.push(group);
        }
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
        await options.prepareBake(bake, camera, target);
        assertActive();
        for (let i = start; i < end; i++) {
          await options.prepare(() => {
            assertActive();
            for (let j = 0; j < groups.length; j++) groups[j].visible = j === i - start;
            const frame = frames[i];
            camera.left = -frame.width / 2;
            camera.right = frame.width / 2;
            camera.top = frame.height / 2;
            camera.bottom = -frame.height / 2;
            camera.updateProjectionMatrix();
            const webgl = options.webgl;
            const previous = webgl.getRenderTarget();
            const viewport = webgl.getViewport(new THREE.Vector4());
            const scissor = webgl.getScissor(new THREE.Vector4());
            const scissorTest = webgl.getScissorTest();
            const clear = webgl.getClearColor(new THREE.Color());
            const alpha = webgl.getClearAlpha();
            const autoClear = webgl.autoClear;
            try {
              webgl.setRenderTarget(target);
              webgl.setScissorTest(true);
              webgl.setClearColor(0, 0);
              webgl.autoClear = false;
              for (let view = 0; view < 16; view++) {
                const angle = (view * Math.PI) / 8;
                camera.position.set(Math.sin(angle) * 500, 0, Math.cos(angle) * 500);
                camera.lookAt(0, 0, 0);
                camera.updateMatrixWorld();
                const cell = (i - start) * 16 + view;
                target.viewport.set((cell % 4) * 256, Math.floor(cell / 4) * 256, 256, 256);
                target.scissor.copy(target.viewport);
                target.scissorTest = true;
                webgl.setViewport(target.viewport);
                webgl.setScissor(target.scissor);
                webgl.clear();
                webgl.render(bake, camera);
              }
            } finally {
              webgl.setRenderTarget(previous);
              webgl.setViewport(viewport);
              webgl.setScissor(scissor);
              webgl.setScissorTest(scissorTest);
              webgl.setClearColor(clear, alpha);
              webgl.autoClear = autoClear;
            }
          }, 'scenery-giant:cell');
        }
      } finally {
        for (const material of materials) material.dispose();
      }
    }
    await options.gate(root);
    assertActive();
    return new GiantSprites(root, frames, atlases, options.scene, bakedLight, release);
  } catch (error) {
    release();
    throw error;
  }
}

export class GiantSprites {
  private light = new THREE.Color();
  private disposed = false;
  private count = 0;
  constructor(
    readonly root: THREE.Group,
    private readonly frames: GiantFrame[],
    private readonly atlases: Atlas[],
    private readonly scene: THREE.Scene,
    private readonly bakedLight: THREE.Color,
    private readonly release: () => void,
  ) {}

  update(selected: Uint8Array, x: number, z: number): void {
    if (this.disposed) return;
    this.count = 0;
    lightColor(this.scene, this.light);
    this.light.setRGB(
      this.light.r / Math.max(this.bakedLight.r, 0.001),
      this.light.g / Math.max(this.bakedLight.g, 0.001),
      this.light.b / Math.max(this.bakedLight.b, 0.001),
    );
    for (const atlas of this.atlases) {
      const positions = atlas.mesh.geometry.attributes.position;
      const uv = atlas.mesh.geometry.attributes.uv;
      let n = 0;
      for (let i = atlas.start; i < atlas.end; i++) {
        if (!selected[i]) continue;
        const frame = this.frames[i];
        const angle = Math.atan2(x - frame.center.x, z - frame.center.z);
        const view = ((Math.round(angle / (Math.PI / 8)) % 16) + 16) % 16;
        const cell = (i - atlas.start) * 16 + view;
        const viewAngle = (view * Math.PI) / 8;
        const rightX = Math.cos(viewAngle),
          rightZ = -Math.sin(viewAngle);
        for (let k = 0; k < 4; k++) {
          const side = k % 2 ? 0.5 : -0.5;
          positions.setXYZ(
            n * 4 + k,
            frame.center.x + side * frame.width * rightX,
            frame.center.y + (k >= 2 ? 0.5 : -0.5) * frame.height,
            frame.center.z + side * frame.width * rightZ,
          );
          uv.setXY(
            n * 4 + k,
            ((cell % 4) * 256 + (k % 2 ? 255.5 : 0.5)) / 1024,
            (Math.floor(cell / 4) * 256 + (k >= 2 ? 255.5 : 0.5)) / 1024,
          );
        }
        n++;
      }
      this.count += n;
      atlas.mesh.geometry.setDrawRange(0, n * 6);
      positions.needsUpdate = true;
      uv.needsUpdate = true;
      atlas.mesh.visible = n > 0;
      atlas.mesh.material.color.copy(this.light);
    }
    this.root.visible = true;
  }
  snapshot(): { placements: number; triangles: number; atlasBytes: number } {
    return {
      placements: this.count,
      triangles: this.count * 2,
      atlasBytes: this.atlases.length * 1024 * 1024 * 4,
    };
  }
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.release();
    }
  }
}
