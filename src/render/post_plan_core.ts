export type PostTargetFormat = 'rgba16f' | 'rgba8' | 'r32f+rgba16f';
export type PostTargetDepth = 'none' | 'depth-renderbuffer' | 'depth32ui-texture';

export interface PostRenderTargetPlan {
  readonly id: string;
  readonly scale: number;
  readonly format: PostTargetFormat;
  readonly samples: number;
  readonly depth: PostTargetDepth;
}

export interface PostFullscreenStagePlan {
  readonly id: string;
  readonly scale: number;
  readonly reads: readonly string[];
  readonly writes: string;
}

export interface PostPlanInput {
  readonly gradeOnly: boolean;
  readonly ao: boolean;
  readonly aoFullRes: boolean;
  readonly bloom: boolean;
  readonly smaa: boolean;
  readonly n8aoDisabled: boolean;
  readonly smaaDisabled: boolean;
  readonly isWebGL2: boolean;
  readonly msaaSamples: number;
}

export interface PostPipelinePlan {
  readonly scene: {
    readonly pass: 'n8ao' | 'render';
    readonly aoQuality: 'Low' | 'Medium' | null;
    readonly aoScale: 0.5 | 1 | null;
  };
  readonly composerPasses: readonly ('render' | 'n8ao' | 'bloom' | 'output-grade' | 'smaa')[];
  readonly singleComposerBuffer: boolean;
  readonly composerSamples: number;
  readonly resolveCount: number;
  readonly renderTargets: readonly PostRenderTargetPlan[];
  readonly fullscreenStages: readonly PostFullscreenStagePlan[];
}

const target = (
  id: string,
  scale: number,
  format: PostTargetFormat,
  samples = 0,
  depth: PostTargetDepth = 'none',
): PostRenderTargetPlan => ({ id, scale, format, samples, depth });

const stage = (
  id: string,
  scale: number,
  reads: readonly string[],
  writes: string,
): PostFullscreenStagePlan => ({ id, scale, reads, writes });

/**
 * Describes the concrete r165 EffectComposer, n8ao 1.10.3, and bloom graph.
 * The live builder consumes the same decisions, while tests pin every target
 * and full-screen stage without constructing WebGL resources.
 */
export function postPipelinePlan(input: PostPlanInput): PostPipelinePlan {
  const useAo = input.ao && !input.gradeOnly && !input.n8aoDisabled;
  const useBloom = input.bloom && !input.gradeOnly;
  const useSmaa = input.smaa && !input.smaaDisabled;
  const singleComposerBuffer = !useSmaa;
  // Preserve the shipped dev-override behavior: configured AO owns scene rasterization
  // storage even when ?n8ao=off temporarily selects the RenderPass attribution branch.
  const aoOwnsSceneStorage = input.ao && !input.gradeOnly;
  const composerSamples =
    input.isWebGL2 && !aoOwnsSceneStorage ? Math.max(0, input.msaaSamples) : 0;
  const scenePass = useAo ? 'n8ao' : 'render';
  const sceneTarget = useAo || singleComposerBuffer ? 'composer-a' : 'composer-b';
  const outputTarget = useSmaa
    ? sceneTarget === 'composer-a'
      ? 'composer-b'
      : 'composer-a'
    : 'canvas';
  const renderTargets: PostRenderTargetPlan[] = [
    target(
      'composer-a',
      1,
      'rgba16f',
      composerSamples,
      scenePass === 'render' ? 'depth-renderbuffer' : 'none',
    ),
  ];
  if (!singleComposerBuffer) {
    renderTargets.push(
      target(
        'composer-b',
        1,
        'rgba16f',
        composerSamples,
        scenePass === 'render' ? 'depth-renderbuffer' : 'none',
      ),
    );
  }

  const composerPasses: PostPipelinePlan['composerPasses'][number][] = [scenePass];
  const fullscreenStages: PostFullscreenStagePlan[] = [];
  let aoQuality: PostPipelinePlan['scene']['aoQuality'] = null;
  let aoScale: PostPipelinePlan['scene']['aoScale'] = null;

  if (useAo) {
    aoQuality = input.aoFullRes ? 'Medium' : 'Low';
    aoScale = input.aoFullRes ? 1 : 0.5;
    renderTargets.push(
      target('n8ao-beauty', 1, 'rgba16f', 0, 'depth32ui-texture'),
      target('n8ao-ao-a', aoScale, 'rgba8'),
      target('n8ao-ao-b', aoScale, 'rgba8'),
    );
    if (aoScale === 0.5) {
      renderTargets.push(target('n8ao-depth-downsample', 0.5, 'r32f+rgba16f'));
      fullscreenStages.push(
        stage('n8ao-depth-downsample', 0.5, ['n8ao-beauty-depth'], 'n8ao-depth-downsample'),
      );
    }
    const aoDepth = aoScale === 0.5 ? 'n8ao-depth-downsample' : 'n8ao-beauty-depth';
    fullscreenStages.push(
      stage('n8ao-evaluate', aoScale, ['n8ao-beauty', aoDepth], 'n8ao-ao-a'),
      stage('n8ao-denoise-0', aoScale, ['n8ao-ao-a', aoDepth], 'n8ao-ao-b'),
      stage('n8ao-denoise-1', aoScale, ['n8ao-ao-b', aoDepth], 'n8ao-ao-a'),
      stage('n8ao-composite', 1, ['n8ao-beauty', 'n8ao-beauty-depth', 'n8ao-ao-a'], sceneTarget),
    );
  }

  if (useBloom) {
    composerPasses.push('bloom');
    renderTargets.push(target('bloom-bright', 0.5, 'rgba16f'));
    fullscreenStages.push(stage('bloom-high-pass', 0.5, [sceneTarget], 'bloom-bright'));
    let bloomInput = 'bloom-bright';
    for (let mip = 0; mip < 5; mip++) {
      const scale = 0.5 / 2 ** mip;
      const horizontal = `bloom-h-${mip}`;
      const vertical = `bloom-v-${mip}`;
      renderTargets.push(target(horizontal, scale, 'rgba16f'), target(vertical, scale, 'rgba16f'));
      fullscreenStages.push(
        stage(`bloom-blur-x-${mip}`, scale, [bloomInput], horizontal),
        stage(`bloom-blur-y-${mip}`, scale, [horizontal], vertical),
      );
      bloomInput = vertical;
    }
    fullscreenStages.push(
      stage(
        'bloom-mip-composite',
        0.5,
        ['bloom-v-0', 'bloom-v-1', 'bloom-v-2', 'bloom-v-3', 'bloom-v-4'],
        'bloom-h-0',
      ),
    );
  }

  composerPasses.push('output-grade');
  fullscreenStages.push(
    stage('output-grade', 1, useBloom ? [sceneTarget, 'bloom-h-0'] : [sceneTarget], outputTarget),
  );

  if (useSmaa) {
    composerPasses.push('smaa');
    renderTargets.push(target('smaa-edges', 1, 'rgba16f'), target('smaa-weights', 1, 'rgba16f'));
    fullscreenStages.push(
      stage('smaa-edges', 1, [outputTarget], 'smaa-edges'),
      stage('smaa-weights', 1, ['smaa-edges'], 'smaa-weights'),
      stage('smaa-blend', 1, [outputTarget, 'smaa-weights'], 'canvas'),
    );
  }

  return {
    scene: {
      pass: scenePass,
      aoQuality,
      aoScale,
    },
    composerPasses,
    singleComposerBuffer,
    composerSamples,
    resolveCount: composerSamples > 0 ? (useSmaa ? 2 : 1) : 0,
    renderTargets,
    fullscreenStages,
  };
}
