// The shared GPU 3D Navier-Stokes and combustion fire simulation, modelled on
// ocean/ocean_simulation.ts.
//
// One shared 3D fluid volume (packed as a 2D atlas of Z-slices in two
// half-float MRT attachments) advances once per simulated frame while any
// volumetric fire is live on screen. Every nearby campfire, brazier and hearth
// samples this shared volume from its own azimuthal angle, mirror and phase so
// forty fires in view cost the exact same single simulation step as one.

import * as THREE from 'three';
import { fireShedStepScale } from './fire_shed';
import {
  FIRE_ADVECT_COMBUST_FRAG,
  FIRE_DIVERGENCE_FRAG,
  FIRE_JACOBI_FRAG,
  FIRE_PASS_VERT,
  FIRE_PROJECT_FRAG,
} from './fire_simulation_glsl';
import { FIRE_LOOP_SECONDS, type FirePlan, fireDraftPulse } from './fire_solver_core';

/** What a volumetric fire material binds to sample the shared 3D simulation. */
export interface FireVolumeUniforms {
  /** (vx, vy, vz, temperature) 2D-tiled 3D volume atlas. */
  uFireVelTemp: THREE.IUniform<THREE.Texture>;
  /** (fuel, smoke, pressure, vorticity) 2D-tiled 3D volume atlas. */
  uFireFuelSmoke: THREE.IUniform<THREE.Texture>;
  /** (gridXZ, gridY, tilesX, tilesZ) atlas layout. */
  uFireGrid: THREE.IUniform<THREE.Vector4>;
  /** (1 / atlasWidth, 1 / atlasHeight, simReady, shimmerStrength). */
  uFireAtlasMeta: THREE.IUniform<THREE.Vector4>;
}

export function supportsFireSimulation(renderer: THREE.WebGLRenderer): boolean {
  return renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
}

function neutralFireTexture(
  values: readonly [number, number, number, number],
  name: string,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Float32Array(values),
    1,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = name;
  return tex;
}

/**
 * Stand-in uniforms when no GPU simulation is mounted (unit tests, Low tier, or
 * hardware without float render targets). uFireAtlasMeta.z is 0 so the volume
 * shader seamlessly blends in its analytical 3D plume fallback.
 */
export function calmFireUniforms(plan?: FirePlan | null): FireVolumeUniforms {
  const velTemp = neutralFireTexture([0, 0.6, 0, 0.75], 'fire-calm-vel-temp');
  const fuelSmoke = neutralFireTexture([0.5, 0.1, 0, 0.5], 'fire-calm-fuel-smoke');
  const gx = plan?.gridXZ ?? 24;
  const gy = plan?.gridY ?? 48;
  const tx = plan?.tilesX ?? 6;
  const tz = plan?.tilesZ ?? 4;
  const aw = plan?.atlasWidth ?? gx * tx;
  const ah = plan?.atlasHeight ?? gy * tz;
  return {
    uFireVelTemp: { value: velTemp },
    uFireFuelSmoke: { value: fuelSmoke },
    uFireGrid: { value: new THREE.Vector4(gx, gy, tx, tz) },
    uFireAtlasMeta: { value: new THREE.Vector4(1 / aw, 1 / ah, 0, plan?.shimmerStrength ?? 0) },
  };
}

/** Number of warm-up steps run at construction so the plume is already burning on frame 1. */
const PREWARM_STEPS = 12;

export class FireSimulation {
  readonly enabled: boolean;
  readonly uniforms: FireVolumeUniforms;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.RawShaderMaterial>;
  private readonly advectCombust: THREE.RawShaderMaterial;
  private readonly divergence: THREE.RawShaderMaterial;
  private readonly jacobi: THREE.RawShaderMaterial;
  private readonly project: THREE.RawShaderMaterial;
  private targetA: THREE.WebGLRenderTarget | null = null;
  private targetB: THREE.WebGLRenderTarget | null = null;
  private lastStep = Number.NEGATIVE_INFINITY;
  private readonly calm: FireVolumeUniforms;

  constructor(
    private readonly renderer: THREE.WebGLRenderer | null,
    readonly plan: FirePlan,
    private readonly seed = 0,
  ) {
    this.enabled = renderer !== null && supportsFireSimulation(renderer);
    this.calm = calmFireUniforms(plan);
    this.uniforms = {
      uFireVelTemp: { value: this.calm.uFireVelTemp.value },
      uFireFuelSmoke: { value: this.calm.uFireFuelSmoke.value },
      uFireGrid: {
        value: new THREE.Vector4(plan.gridXZ, plan.gridY, plan.tilesX, plan.tilesZ),
      },
      uFireAtlasMeta: {
        value: new THREE.Vector4(
          1 / plan.atlasWidth,
          1 / plan.atlasHeight,
          0,
          plan.shimmerStrength,
        ),
      },
    };

    const gridUniforms = () => ({
      uGridXZ: { value: plan.gridXZ },
      uGridY: { value: plan.gridY },
      uTilesX: { value: plan.tilesX },
      uTilesZ: { value: plan.tilesZ },
    });

    const pass = (
      name: string,
      fragmentShader: string,
      uniforms: Record<string, THREE.IUniform>,
    ) => {
      const material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FIRE_PASS_VERT,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
      material.name = name;
      return material;
    };

    this.advectCombust = pass('fire:advect_combust', FIRE_ADVECT_COMBUST_FRAG, {
      ...gridUniforms(),
      uVelTemp: { value: null },
      uFuelSmokeP: { value: null },
      uDt: { value: 1 / 45 },
      uTime: { value: 0 },
      uDraftPulse: { value: 1 },
    });
    this.divergence = pass('fire:divergence', FIRE_DIVERGENCE_FRAG, {
      ...gridUniforms(),
      uVelTemp: { value: null },
      uFuelSmokeP: { value: null },
    });
    this.jacobi = pass('fire:jacobi', FIRE_JACOBI_FRAG, {
      ...gridUniforms(),
      uVelTemp: { value: null },
      uFuelSmokeP: { value: null },
    });
    this.project = pass('fire:project', FIRE_PROJECT_FRAG, {
      ...gridUniforms(),
      uVelTemp: { value: null },
      uFuelSmokeP: { value: null },
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.advectCombust);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    if (this.enabled) this.allocateAndPrewarm();
  }

  /**
   * Advance the 3D fluid solver to `time` (seconds). Returns the number of
   * fullscreen passes drawn.
   */
  update(time: number): number {
    if (!this.enabled || !this.renderer || !this.targetA || !this.targetB) return 0;
    const minStep = 1 / (this.plan.stepHz * fireShedStepScale());
    const dt = time - this.lastStep;
    if (dt >= 0 && dt < minStep) return 0;
    const stepDt = dt > 0 && dt < 0.08 ? dt : Math.min(0.033, minStep);
    this.lastStep = time;
    return this.stepInternal(time, stepDt);
  }

  dispose(): void {
    this.targetA?.dispose();
    this.targetB?.dispose();
    this.targetA = null;
    this.targetB = null;
    this.quad.geometry.dispose();
    this.advectCombust.dispose();
    this.divergence.dispose();
    this.jacobi.dispose();
    this.project.dispose();
    this.calm.uFireVelTemp.value.dispose();
    this.calm.uFireFuelSmoke.value.dispose();
  }

  private stepInternal(time: number, stepDt: number): number {
    const renderer = this.renderer;
    if (!renderer || !this.targetA || !this.targetB) return 0;
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    let passes = 0;
    try {
      const wrappedTime = ((time % FIRE_LOOP_SECONDS) + FIRE_LOOP_SECONDS) % FIRE_LOOP_SECONDS;
      let src = this.targetA;
      let dst = this.targetB;

      // 1. Advect + combust + buoyancy + vorticity confinement
      const ac = this.advectCombust.uniforms;
      ac.uVelTemp.value = src.textures[0];
      ac.uFuelSmokeP.value = src.textures[1];
      ac.uDt.value = stepDt;
      ac.uTime.value = wrappedTime;
      ac.uDraftPulse.value = fireDraftPulse(wrappedTime, this.seed);
      this.draw(this.advectCombust, dst);
      passes++;
      [src, dst] = [dst, src];

      // 2. Velocity divergence
      const div = this.divergence.uniforms;
      div.uVelTemp.value = src.textures[0];
      div.uFuelSmokeP.value = src.textures[1];
      this.draw(this.divergence, dst);
      passes++;
      [src, dst] = [dst, src];

      // 3. Warm-started Poisson pressure Jacobi iterations
      const jac = this.jacobi.uniforms;
      for (let i = 0; i < this.plan.jacobiIterations; i++) {
        jac.uVelTemp.value = src.textures[0];
        jac.uFuelSmokeP.value = src.textures[1];
        this.draw(this.jacobi, dst);
        passes++;
        [src, dst] = [dst, src];
      }

      // 4. Subtract pressure gradient for incompressible turbulent curls
      const proj = this.project.uniforms;
      proj.uVelTemp.value = src.textures[0];
      proj.uFuelSmokeP.value = src.textures[1];
      this.draw(this.project, dst);
      passes++;

      // Ensure targetA holds the latest completed state for the next step.
      this.targetA = dst;
      this.targetB = src;
      this.uniforms.uFireVelTemp.value = dst.textures[0];
      this.uniforms.uFireFuelSmoke.value = dst.textures[1];
      this.uniforms.uFireAtlasMeta.value.z = 1;
    } finally {
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(previous);
    }
    return passes;
  }

  private draw(material: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget): void {
    if (!this.renderer) return;
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  private allocateAndPrewarm(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const rtOptions: THREE.RenderTargetOptions = {
      count: 2,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    const { atlasWidth, atlasHeight } = this.plan;
    this.targetA = new THREE.WebGLRenderTarget(atlasWidth, atlasHeight, rtOptions);
    this.targetB = new THREE.WebGLRenderTarget(atlasWidth, atlasHeight, rtOptions);
    for (const [tag, rt] of [
      ['a', this.targetA],
      ['b', this.targetB],
    ] as const) {
      rt.textures[0].name = `fire-vel-temp-${tag}`;
      rt.textures[1].name = `fire-fuel-smoke-${tag}`;
      for (const tex of rt.textures) {
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
      }
    }

    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(this.targetA);
      for (const material of [this.advectCombust, this.divergence, this.jacobi, this.project]) {
        this.quad.material = material;
        renderer.compile(this.scene, this.camera);
      }
      const color = new THREE.Color();
      renderer.getClearColor(color);
      const alpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      for (const rt of [this.targetA, this.targetB]) {
        renderer.setRenderTarget(rt);
        renderer.clear(true, false, false);
      }
      renderer.setClearColor(color, alpha);
      // Pre-step under the construction curtain so frame 1 already has a full
      // buoyant plume instead of igniting from an empty grid.
      for (let i = 0; i < PREWARM_STEPS; i++) {
        this.stepInternal(i * 0.03, 0.03);
      }
    } finally {
      this.quad.material = this.advectCombust;
      renderer.setRenderTarget(previous);
    }
  }
}
