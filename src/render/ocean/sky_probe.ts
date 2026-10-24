import * as THREE from 'three';
import { liveSkyDome } from '../sky';

// The sky the water reflects: a small cube capture of the LIVE dome, so a
// reflection carries everything the dome itself draws (the biome blend, the
// day/night grade, the dusk glow, the stars, the horizon fog band) instead of
// the raw HDRI the lighting environment is prefiltered from.
//
// It draws the dome's own geometry and material (no second program: a cube
// target is keyed like the composer's float target), one face per update, so
// the whole cube refreshes every six frames at the cost of one tiny draw a
// frame; mips are generated once the sixth face lands, which is what the
// surface's roughness reads (a rough far sea samples a blurred sky).

const PROBE_SIZE = 128;

/** Whether this context can render the probe's half-float cube at all. */
export function supportsSkyProbe(renderer: THREE.WebGLRenderer): boolean {
  return (
    renderer.capabilities.isWebGL2 &&
    (renderer.extensions.has('EXT_color_buffer_float') ||
      renderer.extensions.has('EXT_color_buffer_half_float'))
  );
}

export class SkyReflectionProbe {
  readonly target: THREE.WebGLCubeRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly mesh = new THREE.Mesh();
  private face = 0;
  private complete = false;
  // A restored context comes back with every face blank: redraw all six on the
  // next update instead of letting five black faces ride for five frames.
  private readonly onRestore = (): void => this.refreshAll();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.target = new THREE.WebGLCubeRenderTarget(PROBE_SIZE, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.target.texture.name = 'ocean-sky-probe';
    this.cubeCamera = new THREE.CubeCamera(1, 1000, this.target);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.scene.add(this.cubeCamera);
    renderer.domElement?.addEventListener?.('webglcontextrestored', this.onRestore);
  }

  /** Redraw every face on the next update (after a restore, or a long idle). */
  refreshAll(): void {
    this.complete = false;
    this.face = 0;
  }

  /** The highest mip level the surface may read (1x1). */
  get maxLod(): number {
    return Math.log2(PROBE_SIZE);
  }

  /** True once every face has been drawn at least once. */
  get ready(): boolean {
    return this.complete;
  }

  /** Draw the next face (all six on the first call). Returns the draws made. */
  update(): number {
    const dome = liveSkyDome();
    if (!dome) return 0;
    this.mesh.geometry = dome.geometry;
    this.mesh.material = dome.material;
    const renderer = this.renderer;
    if (this.cubeCamera.coordinateSystem !== renderer.coordinateSystem) {
      this.cubeCamera.coordinateSystem = renderer.coordinateSystem;
      this.cubeCamera.updateCoordinateSystem();
    }
    this.cubeCamera.updateMatrixWorld(true);
    const cameras = this.cubeCamera.children as THREE.PerspectiveCamera[];
    const previous = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousLevel = renderer.getActiveMipmapLevel();
    const faces = this.complete ? 1 : 6;
    let drawn = 0;
    try {
      for (let i = 0; i < faces; i++) {
        const face = this.face;
        // Mips once per full cube, on its last face, like three's CubeCamera.
        this.target.texture.generateMipmaps = face === 5;
        renderer.setRenderTarget(this.target, face);
        renderer.render(this.scene, cameras[face]);
        drawn++;
        this.face = (face + 1) % 6;
        if (face === 5) this.complete = true;
      }
    } finally {
      this.target.texture.generateMipmaps = true;
      renderer.setRenderTarget(previous, previousFace, previousLevel);
    }
    return drawn;
  }

  dispose(): void {
    this.renderer.domElement?.removeEventListener?.('webglcontextrestored', this.onRestore);
    this.target.dispose();
  }
}
