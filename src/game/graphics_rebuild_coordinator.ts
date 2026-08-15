// Effectful coordinator for swapping the live world renderer without replacing
// the IWorld, socket, canvas, HUD, or Input owners. Heavy render work is exposed
// as narrow injected steps so ordering and rollback are directly unit-testable.

export type GraphicsRebuildSettings = Readonly<Record<string, string | number | boolean>>;

export type GraphicsRebuildOutcome =
  | { status: 'unchanged' }
  | { status: 'applied' }
  | { status: 'rolled-back'; cause: unknown }
  | { status: 'fatal'; cause: unknown };

export interface GraphicsRebuildProgress {
  stage: 'assets' | 'current-zone' | 'neighbor-zones' | 'prewarm' | 'validation';
  done?: number;
  total?: number;
}

export interface GraphicsRebuildCoordinatorDeps<
  Settings extends GraphicsRebuildSettings,
  Renderer,
  RecycledContext,
> {
  currentRenderer(): Renderer;
  captureSettings(): Settings;
  settingsEqual(a: Settings, b: Settings): boolean;
  /** Fail while the old renderer is intact if same-context recycling is unavailable. */
  preflightContext(renderer: Renderer): void;

  setClientPaused(paused: boolean): void;
  resetInput(): void;
  neutralizeOnlineInput?(): void;
  showOpaqueCurtain(): void;
  /** Resolves only after one complete opaque curtain paint. */
  awaitCurtainPaint(): Promise<void>;
  hideOpaqueCurtain(): void;

  prepareTargetAssets(
    target: Settings,
    onProgress: (done: number, total: number) => void,
  ): Promise<void>;
  /** Tear down secondary portrait/preview contexts after target assets are ready. */
  resetAuxiliaryRenderers(): void;
  /** Capture the same-context pair before terminal shutdown can partially fail. */
  captureRendererContext(renderer: Renderer): RecycledContext;
  shutdownRenderer(renderer: Renderer): Promise<RecycledContext>;
  recycleContext(recycled: RecycledContext): Promise<RecycledContext>;
  activateProfile(settings: Settings): number;
  resetProfileResources(nextEpoch: number): void | Promise<void>;
  buildRenderer(settings: Settings, recycled: RecycledContext): Renderer | Promise<Renderer>;
  prepareCurrentZone(renderer: Renderer): Promise<void>;
  prepareNeighborZones(renderer: Renderer): Promise<void>;
  prewarmRenderer(renderer: Renderer): Promise<void>;
  validateRenderer(renderer: Renderer): void | Promise<void>;

  /** Synchronous commit: renderer consumers, settings, and UI effects rebind together. */
  commit(renderer: Renderer, settings: Settings): void;
  onProgress?(progress: GraphicsRebuildProgress): void;

  suspendEntryDiagnostics(): void;
  resumeEntryDiagnostics(settings: Settings): void;
  markCrashPhase(
    phase:
      | 'starting'
      | 'assets-prepared'
      | 'renderer-stopped'
      | 'candidate-built'
      | 'rollback-started',
    from: Settings,
    target: Settings,
    generation: number,
  ): void;
  clearCrashMarker(): void;

  isContextFailure(error: unknown): boolean;
  showFatalReload(error: unknown): void;
}

class StaleGraphicsRebuildError extends Error {
  constructor() {
    super('graphics rebuild generation is stale');
  }
}

/**
 * Single-flight renderer rebuild with an old-profile rollback arm. A target
 * failure is recoverable while either the old renderer is still alive or the
 * old profile can be rebuilt on the recycled context. Only a context failure
 * or a failed rollback reaches the fatal Reload surface.
 */
export class GraphicsRebuildCoordinator<
  Settings extends GraphicsRebuildSettings,
  Renderer,
  RecycledContext,
> {
  private generation = 0;
  private inFlight: Promise<GraphicsRebuildOutcome> | null = null;

  constructor(
    private readonly deps: GraphicsRebuildCoordinatorDeps<Settings, Renderer, RecycledContext>,
  ) {}

  get active(): boolean {
    return this.inFlight !== null;
  }

  /** Invalidate callbacks from a transition whose host is being torn down. */
  invalidate(): void {
    this.generation++;
  }

  rebuild(target: Settings): Promise<GraphicsRebuildOutcome> {
    if (this.inFlight) return this.inFlight;
    const from = this.deps.captureSettings();
    if (this.deps.settingsEqual(from, target)) return Promise.resolve({ status: 'unchanged' });
    const oldRenderer = this.deps.currentRenderer();
    try {
      // Deliberately before the curtain and every destructive step: a browser
      // without WEBGL_lose_context keeps playing on the old renderer.
      this.deps.preflightContext(oldRenderer);
    } catch (cause) {
      return Promise.resolve({ status: 'rolled-back', cause });
    }
    const generation = ++this.generation;
    const run = this.run(from, target, generation, oldRenderer);
    this.inFlight = run;
    const clear = (): void => {
      if (this.inFlight === run) this.inFlight = null;
    };
    void run.then(clear, clear);
    return run;
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new StaleGraphicsRebuildError();
  }

  private async prepareRenderer(renderer: Renderer, generation: number | null): Promise<void> {
    this.deps.onProgress?.({ stage: 'current-zone' });
    await this.deps.prepareCurrentZone(renderer);
    if (generation !== null) this.assertCurrent(generation);
    this.deps.onProgress?.({ stage: 'neighbor-zones' });
    await this.deps.prepareNeighborZones(renderer);
    if (generation !== null) this.assertCurrent(generation);
    this.deps.onProgress?.({ stage: 'prewarm' });
    await this.deps.prewarmRenderer(renderer);
    if (generation !== null) this.assertCurrent(generation);
    this.deps.onProgress?.({ stage: 'validation' });
    await this.deps.validateRenderer(renderer);
    if (generation !== null) this.assertCurrent(generation);
  }

  private finishRecoverable(settings: Settings): void {
    this.deps.clearCrashMarker();
    this.deps.resumeEntryDiagnostics(settings);
    this.deps.hideOpaqueCurtain();
    this.deps.setClientPaused(false);
  }

  private finishFatal(error: unknown): GraphicsRebuildOutcome {
    this.deps.clearCrashMarker();
    this.deps.showFatalReload(error);
    return { status: 'fatal', cause: error };
  }

  private async run(
    from: Settings,
    target: Settings,
    generation: number,
    oldRenderer: Renderer,
  ): Promise<GraphicsRebuildOutcome> {
    let recycled: RecycledContext | null = null;
    let candidate: Renderer | null = null;
    let oldRendererShutdownStarted = false;
    let auxiliaryRenderersResetAttempted = false;

    try {
      this.deps.setClientPaused(true);
      this.deps.resetInput();
      this.deps.neutralizeOnlineInput?.();
      this.deps.showOpaqueCurtain();

      // Two full paints, not merely two rAF callbacks, make the curtain opaque
      // before target asset preparation or any renderer teardown can block.
      await this.deps.awaitCurtainPaint();
      this.assertCurrent(generation);
      await this.deps.awaitCurtainPaint();
      this.assertCurrent(generation);

      this.deps.suspendEntryDiagnostics();
      this.deps.markCrashPhase('starting', from, target, generation);

      this.deps.onProgress?.({ stage: 'assets' });
      await this.deps.prepareTargetAssets(target, (done, total) =>
        this.deps.onProgress?.({ stage: 'assets', done, total }),
      );
      this.assertCurrent(generation);
      this.deps.markCrashPhase('assets-prepared', from, target, generation);
      // Both operations can tear down part of their owned surface before they
      // throw. Mark the attempt first so recovery never republishes a partial
      // client as though the operation had not started.
      auxiliaryRenderersResetAttempted = true;
      this.deps.resetAuxiliaryRenderers();

      // Target assets are ready before the old renderer gives up the context.
      recycled = this.deps.captureRendererContext(oldRenderer);
      oldRendererShutdownStarted = true;
      recycled = await this.deps.shutdownRenderer(oldRenderer);
      this.assertCurrent(generation);
      this.deps.markCrashPhase('renderer-stopped', from, target, generation);
      recycled = await this.deps.recycleContext(recycled);
      this.assertCurrent(generation);

      const epoch = this.deps.activateProfile(target);
      await this.deps.resetProfileResources(epoch);
      this.assertCurrent(generation);
      candidate = await this.deps.buildRenderer(target, recycled);
      this.assertCurrent(generation);
      this.deps.markCrashPhase('candidate-built', from, target, generation);
      await this.prepareRenderer(candidate, generation);

      this.deps.commit(candidate, target);
      this.finishRecoverable(target);
      return { status: 'applied' };
    } catch (cause) {
      if (!oldRendererShutdownStarted) {
        // Asset/curtain failures leave the old renderer and old persisted
        // settings untouched. If secondary contexts had already been reset,
        // recommit the still-live renderer so its consumers and previews are
        // restored before the curtain lifts.
        try {
          if (auxiliaryRenderersResetAttempted) this.deps.commit(oldRenderer, from);
          this.finishRecoverable(from);
          return { status: 'rolled-back', cause };
        } catch (restoreCause) {
          return this.finishFatal(
            new AggregateError(
              [cause, restoreCause],
              'graphics renderer rebuild failed before teardown and client restoration failed',
            ),
          );
        }
      }

      if (this.deps.isContextFailure(cause)) return this.finishFatal(cause);

      try {
        this.deps.markCrashPhase('rollback-started', from, target, generation);
        if (candidate) {
          recycled = await this.deps.shutdownRenderer(candidate);
          recycled = await this.deps.recycleContext(recycled);
        } else if (recycled !== null) {
          // A constructor can fail after touching the restored context but
          // before returning a candidate handle. Cycle it once more so the
          // rollback never inherits half-built GPU state.
          recycled = await this.deps.recycleContext(recycled);
        }
        if (recycled === null) throw new Error('graphics rebuild lost its recycled context');
        const rollbackEpoch = this.deps.activateProfile(from);
        await this.deps.resetProfileResources(rollbackEpoch);
        const rollbackRenderer = await this.deps.buildRenderer(from, recycled);
        // A stale generation must never publish its target, but the host still
        // needs a renderer. Roll back to the captured old profile without
        // consulting the invalidated generation again.
        await this.prepareRenderer(rollbackRenderer, null);
        this.deps.commit(rollbackRenderer, from);
        this.finishRecoverable(from);
        return { status: 'rolled-back', cause };
      } catch (rollbackCause) {
        const fatal = new AggregateError(
          [cause, rollbackCause],
          'graphics renderer rebuild and rollback both failed',
        );
        return this.finishFatal(fatal);
      }
    }
  }
}
