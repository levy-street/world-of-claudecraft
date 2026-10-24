import * as THREE from 'three';
import { applyTextureAnisotropy } from '../texture_anisotropy';
import {
  OCEAN_ASSEMBLE_FRAG,
  OCEAN_EVOLVE_FRAG,
  OCEAN_FFT_FRAG,
  OCEAN_PASS_VERT,
} from './ocean_fft_glsl';
import { oceanShedStepScale } from './ocean_shed';
import {
  buildCascadeSpectrum,
  OCEAN_LOOP_SECONDS,
  OCEAN_VARIANCE_SAMPLES,
  type OceanPlan,
  type OceanSeaState,
  unresolvedSlopeVariance,
} from './ocean_spectrum_core';

// The GPU ocean: a Tessendorf FFT simulation over a few cascades, advanced
// once per simulated frame, whose outputs every water surface samples.
//
// Per step: one time-evolution pass writes the four packed spectra of every
// cascade into one atlas, 2 * log2(N) Stockham passes transform them in place
// (ping-ponging two atlases), and one assemble pass per cascade unpacks the
// result into that cascade's displacement and shading textures, which carry
// full mip chains so a distant pixel reads the AVERAGE of the waves under it
// rather than one aliased sample. The shading targets ping-pong as well, so
// whitecap foam can persist and fade instead of flickering with the crests.
//
// Like the wake field (water_simulation.ts) it owns a private scene, an
// orthographic camera and one quad, links every program at construction
// against the target it will draw into, and restores the renderer's bound
// target after every pass.

/** FFT axes, horizontal first (hoisted: update() runs every simulated frame). */
const FFT_AXES = [1, 0] as const;
/** Seconds a whitecap takes to fade to a third. */
const FOAM_LIFETIME_SECONDS = 2.6;
/** Jacobian below which a crest is fully white, and where foam starts. */
const FOAM_BIRTH_FULL = -0.05;
const FOAM_BIRTH_START = 0.38;

/** What a surface material binds to read the simulation. */
export interface OceanSurfaceUniforms {
  /** Per cascade: the displacement texture (Dx, Dy, Dz). */
  disp: THREE.IUniform<THREE.Texture>[];
  /** Per cascade: the shading texture (dDy/dx, dDy/dz, Jacobian, foam). */
  shade: THREE.IUniform<THREE.Texture>[];
  /** Per cascade: x 1/size, y slope variance, z foam weight, w height std. */
  cascade: THREE.IUniform<THREE.Vector4[]>;
  /** Slope variance above each cutoff wavenumber (ocean_spectrum_core). */
  variance: THREE.IUniform<Float32Array>;
}

function supportsOcean(renderer: THREE.WebGLRenderer): boolean {
  return (
    renderer.capabilities.isWebGL2 &&
    renderer.capabilities.maxVertexTextures >= 8 &&
    renderer.extensions.has('EXT_color_buffer_float')
  );
}

/** A 1x1 texture holding one texel, the calm stand-in before the first step. */
function neutralTexture(
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
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = name;
  return tex;
}

/** Uniforms for a surface with no simulation behind it: flat, calm, no foam. */
export function calmOceanUniforms(cascades: number): OceanSurfaceUniforms {
  const disp = neutralTexture([0, 0, 0, 0], 'ocean-calm-disp');
  const shade = neutralTexture([0, 0, 1, 0], 'ocean-calm-shade');
  return {
    disp: Array.from({ length: cascades }, () => ({ value: disp })),
    shade: Array.from({ length: cascades }, () => ({ value: shade })),
    cascade: {
      value: Array.from({ length: cascades }, () => new THREE.Vector4(1 / 64, 0, 0, 1)),
    },
    variance: { value: new Float32Array(OCEAN_VARIANCE_SAMPLES) },
  };
}

interface CascadeTargets {
  /** Two MRT targets (displacement, shading), ping-ponged for the foam. */
  read: THREE.WebGLRenderTarget;
  write: THREE.WebGLRenderTarget;
}

export class OceanSimulation {
  readonly enabled: boolean;
  readonly uniforms: OceanSurfaceUniforms;
  private readonly n: number;
  private readonly cascadeCount: number;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.RawShaderMaterial>;
  private readonly evolve: THREE.RawShaderMaterial;
  private readonly fft: THREE.RawShaderMaterial;
  private readonly assemble: THREE.RawShaderMaterial;
  private readonly h0: THREE.DataTexture;
  private readonly waves: THREE.DataTexture;
  private atlasA: THREE.WebGLRenderTarget | null = null;
  private atlasB: THREE.WebGLRenderTarget | null = null;
  private outputs: CascadeTargets[] = [];
  private lastStep = Number.NEGATIVE_INFINITY;
  private readonly calm: OceanSurfaceUniforms;

  constructor(
    private readonly renderer: THREE.WebGLRenderer | null,
    readonly plan: OceanPlan,
    sea: OceanSeaState,
    private readonly seed: number,
  ) {
    this.n = plan.resolution;
    this.cascadeCount = plan.cascades.length;
    this.enabled = renderer !== null && supportsOcean(renderer);
    this.calm = calmOceanUniforms(this.cascadeCount);
    this.uniforms = {
      disp: this.calm.disp.map((u) => ({ value: u.value })),
      shade: this.calm.shade.map((u) => ({ value: u.value })),
      cascade: {
        value: plan.cascades.map((c) => new THREE.Vector4(1 / c.size, 0, 1, 1)),
      },
      variance: { value: new Float32Array(OCEAN_VARIANCE_SAMPLES) },
    };
    const atlasHeight = this.n * this.cascadeCount;
    this.h0 = new THREE.DataTexture(
      new Float32Array(this.n * atlasHeight * 4),
      this.n,
      atlasHeight,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.waves = new THREE.DataTexture(
      new Float32Array(this.n * atlasHeight * 4),
      this.n,
      atlasHeight,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    for (const tex of [this.h0, this.waves]) {
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
    }
    this.h0.name = 'ocean-h0';
    this.waves.name = 'ocean-waves';

    const pass = (
      name: string,
      fragmentShader: string,
      uniforms: Record<string, THREE.IUniform>,
    ) => {
      const material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: OCEAN_PASS_VERT,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
      // Named so a live-program or census entry reads as the ocean, not a key.
      material.name = name;
      return material;
    };
    this.evolve = pass('ocean:evolve', OCEAN_EVOLVE_FRAG, {
      uH0: { value: this.h0 },
      uWaves: { value: this.waves },
      uLoopT: { value: 0 },
      uChop: { value: sea.choppiness },
    });
    this.fft = pass('ocean:fft', OCEAN_FFT_FRAG, {
      uInA: { value: null },
      uInB: { value: null },
      uStage: { value: 1 },
      uN: { value: this.n },
      uHorizontal: { value: 1 },
    });
    this.assemble = pass('ocean:assemble', OCEAN_ASSEMBLE_FRAG, {
      uInA: { value: null },
      uInB: { value: null },
      uPrevShade: { value: null },
      uBlock: { value: 0 },
      uFoamDecay: { value: 0.98 },
      uFoamBirth: { value: new THREE.Vector2(FOAM_BIRTH_FULL, FOAM_BIRTH_START) },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.evolve);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.setSeaState(sea);
    if (this.enabled) this.allocateAndPrewarm();
  }

  /** Rebuild the initial spectrum (a new wind or swell); the waves keep their clock. */
  setSeaState(sea: OceanSeaState): void {
    const n = this.n;
    const h0 = this.h0.image.data as Float32Array;
    const waves = this.waves.image.data as Float32Array;
    this.plan.cascades.forEach((c, i) => {
      const spectrum = buildCascadeSpectrum(this.plan, i, sea, this.seed);
      h0.set(spectrum.h0, i * n * n * 4);
      waves.set(spectrum.waves, i * n * n * 4);
      const vec = this.uniforms.cascade.value[i];
      // Whitecaps come from the long waves breaking; ripples never fold white.
      vec.set(
        1 / c.size,
        spectrum.slopeVariance,
        i < 2 ? 1 : 0,
        Math.sqrt(spectrum.heightVariance),
      );
    });
    this.h0.needsUpdate = true;
    this.waves.needsUpdate = true;
    this.evolve.uniforms.uChop.value = sea.choppiness;
    this.uniforms.variance.value.set(unresolvedSlopeVariance(this.plan, sea));
  }

  /**
   * Advance to `time` (seconds, any epoch: it is wrapped to the loop here).
   * Returns the passes drawn, for the renderer's draw accounting.
   */
  update(time: number): number {
    if (!this.enabled || !this.renderer || !this.atlasA || !this.atlasB) return 0;
    // The tier's step rate, slowed further while the render budget is shedding
    // post (ocean_shed.ts): the waves move far slower than a frame.
    const minStep = 1 / (this.plan.stepHz * oceanShedStepScale());
    const dt = time - this.lastStep;
    if (dt >= 0 && dt < minStep) return 0;
    const step = dt > 0 && dt < 1 ? dt : minStep;
    this.lastStep = time;
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    // Every pass overwrites its whole target, so the per-render clear is waste.
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    let passes = 0;
    try {
      this.evolve.uniforms.uLoopT.value =
        (((time % OCEAN_LOOP_SECONDS) + OCEAN_LOOP_SECONDS) % OCEAN_LOOP_SECONDS) /
        OCEAN_LOOP_SECONDS;
      this.draw(this.evolve, this.atlasA);
      passes++;
      let src = this.atlasA;
      let dst = this.atlasB;
      for (const horizontal of FFT_AXES) {
        for (let p = 1; p < this.n; p *= 2) {
          const u = this.fft.uniforms;
          u.uInA.value = src.textures[0];
          u.uInB.value = src.textures[1];
          u.uStage.value = p;
          u.uHorizontal.value = horizontal;
          this.draw(this.fft, dst);
          passes++;
          const t = src;
          src = dst;
          dst = t;
        }
      }
      const au = this.assemble.uniforms;
      au.uInA.value = src.textures[0];
      au.uInB.value = src.textures[1];
      au.uFoamDecay.value = Math.exp(-step / FOAM_LIFETIME_SECONDS);
      for (let c = 0; c < this.cascadeCount; c++) {
        const out = this.outputs[c];
        au.uBlock.value = c * this.n;
        au.uPrevShade.value = out.read.textures[1];
        this.draw(this.assemble, out.write);
        passes++;
        const t = out.read;
        out.read = out.write;
        out.write = t;
        this.uniforms.disp[c].value = out.read.textures[0];
        this.uniforms.shade[c].value = out.read.textures[1];
      }
    } finally {
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(previous);
    }
    return passes;
  }

  dispose(): void {
    this.atlasA?.dispose();
    this.atlasB?.dispose();
    for (const out of this.outputs) {
      out.read.dispose();
      out.write.dispose();
    }
    this.outputs = [];
    this.quad.geometry.dispose();
    this.evolve.dispose();
    this.fft.dispose();
    this.assemble.dispose();
    this.h0.dispose();
    this.waves.dispose();
    for (const u of [...this.calm.disp, ...this.calm.shade]) u.value.dispose();
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
    const atlasOptions: THREE.RenderTargetOptions = {
      count: 2,
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    const atlasHeight = this.n * this.cascadeCount;
    this.atlasA = new THREE.WebGLRenderTarget(this.n, atlasHeight, atlasOptions);
    this.atlasB = new THREE.WebGLRenderTarget(this.n, atlasHeight, atlasOptions);
    for (let i = 0; i < 2; i++) {
      this.atlasA.textures[i].name = `ocean-atlas-a${i}`;
      this.atlasB.textures[i].name = `ocean-atlas-b${i}`;
    }
    const outputOptions: THREE.RenderTargetOptions = {
      count: 2,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: true,
    };
    this.outputs = this.plan.cascades.map((_, c) => {
      const read = new THREE.WebGLRenderTarget(this.n, this.n, outputOptions);
      const write = new THREE.WebGLRenderTarget(this.n, this.n, outputOptions);
      for (const [tag, rt] of [
        ['a', read],
        ['b', write],
      ] as const) {
        rt.textures[0].name = `ocean-disp-${c}${tag}`;
        rt.textures[1].name = `ocean-shade-${c}${tag}`;
        for (const t of rt.textures) {
          t.wrapS = THREE.RepeatWrapping;
          t.wrapT = THREE.RepeatWrapping;
        }
        // The slopes are a normal map seen at grazing angles: the tier's
        // normal-map tap budget keeps the far sea from smearing to flat.
        applyTextureAnisotropy(rt.textures[1], 'normal');
      }
      return { read, write };
    });
    // Link every pass program against the kind of target it draws into (three
    // keys a program on the bound target), under the construction curtain, so
    // the first live step links nothing.
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(this.atlasA);
      for (const material of [this.evolve, this.fft]) {
        this.quad.material = material;
        renderer.compile(this.scene, this.camera);
      }
      const first = this.outputs[0];
      if (first) {
        renderer.setRenderTarget(first.write);
        this.quad.material = this.assemble;
        renderer.compile(this.scene, this.camera);
      }
      // Clear the foam history so the first assemble reads calm water.
      const color = new THREE.Color();
      renderer.getClearColor(color);
      const alpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      for (const out of this.outputs) {
        for (const rt of [out.read, out.write]) {
          renderer.setRenderTarget(rt);
          renderer.clear(true, false, false);
        }
      }
      renderer.setClearColor(color, alpha);
    } finally {
      this.quad.material = this.evolve;
      renderer.setRenderTarget(previous);
    }
  }
}
