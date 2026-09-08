import { normalizeGraphicsSettingsSnapshot } from '../game/graphics_rebuild_core';
import { masterworkAudioKey } from '../game/masterwork_audio_core';
import { Settings } from '../game/settings';
import { sfx } from '../game/sfx';
import {
  prepareGraphicsProfileAssets,
  resetGraphicsProfileDerivedCaches,
} from '../render/assets/graphics_profile';
import { assetsReady, beginDeferredPreloads } from '../render/assets/preload';
import { npcLookFor, setModularLookProvider } from '../render/characters';
import { preloadTrainingDummyAssets } from '../render/characters/assets';
import { classArmorSet } from '../render/characters/modular';
import { inWorldLookFor } from '../render/characters/player_look_core';
import { recycleWebGL2Context } from '../render/context_recycle';
import { activateGfxProfile, type GfxCapabilities, resolveGfxProfile } from '../render/gfx';
import { Renderer } from '../render/renderer';
import { ensureSkyAssetsAt } from '../render/sky';
import type { StudioLighting } from '../render/studio_stage';
import { DT, type SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import { StudioCinematicDirector } from './cinematic_director';
import { StudioCombatAudio } from './combat_audio';
import { createStudioGraphicsContext } from './graphics';
import { StudioPlayback } from './playback_core';
import { prepareStudioAbilityKit } from './prepare_ability_kit';
import { prepareStudioAssets } from './prepare_assets';
import { prepareStudioViews } from './prepare_views';
import {
  type RecordedCommand,
  type StudioCommand,
  type StudioConfig,
  StudioSession,
} from './session';
import { bindStudioWorld } from './world_binding';

export class StudioRuntime {
  session: StudioSession | null = null;
  renderer: Renderer | null = null;
  playback = new StudioPlayback();
  ready = false;
  audio = false;
  artView = false;
  lighting: StudioLighting = 'neutral';
  private cinematicEnabled = false;
  get cinematicResponse(): boolean {
    return this.cinematicEnabled;
  }
  set cinematicResponse(value: boolean) {
    this.cinematicEnabled = value;
    if (!value) this.cinematic.clear(this.renderer);
    this.requestDraw();
  }
  private readonly cinematic = new StudioCinematicDirector();
  private readonly combatAudio = new StudioCombatAudio(sfx);
  private readonly settings = new Settings();
  reduceMotion = this.settings.get('reduceMotion');
  private raf = 0;
  private last = 0;
  private generation = 0;
  private chain: Promise<void> = Promise.resolve();
  private replay: readonly RecordedCommand[] = [];
  private replayIndex = 0;
  private replayEnd = 0;
  private replaying = false;
  private disposed = false;
  private needsDraw = false;
  private graphicsCapabilities: GfxCapabilities | undefined;
  private pendingContext: WebGL2RenderingContext | undefined;
  private rendererPrepared = false;
  private readonly world = bindStudioWorld<IWorld>(() => this.session!.sim);

  configure(config: StudioConfig): Promise<void> {
    return this.load(config, undefined, 0, true);
  }

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly nameplates: HTMLDivElement,
    private onFrame: () => void,
    private onEvents: (events: SimEvent[]) => void,
  ) {}

  load(
    config: StudioConfig,
    recording?: readonly RecordedCommand[],
    endTick = 0,
    preserveView = false,
  ): Promise<void> {
    config = { ...config, rows: { ...config.rows } };
    const generation = ++this.generation;
    this.ready = false;
    this.combatAudio.clear();
    cancelAnimationFrame(this.raf);
    // Serialize context ownership even when class selections arrive during boot.
    this.chain = this.chain
      .catch(() => {})
      .then(async () => {
        if (generation !== this.generation || this.disposed) return;
        this.cinematic.clear(this.renderer);
        const previous = this.session?.config;
        const reuse =
          preserveView &&
          this.rendererPrepared &&
          this.renderer &&
          previous &&
          previous.seed === config.seed &&
          previous.scene === config.scene &&
          previous.graphicsPreset === config.graphicsPreset &&
          (previous.environment ?? 'studio') === (config.environment ?? 'studio');
        const stage = config.environment !== 'world';
        const camera =
          preserveView && this.renderer
            ? {
                yaw: this.renderer.camYaw,
                pitch: this.renderer.camPitch,
                distance: this.renderer.camDist,
              }
            : null;
        const speed = preserveView ? this.playback.speed : 1;
        const paused = preserveView && this.playback.paused;
        if (this.renderer && !reuse) {
          this.rendererPrepared = false;
          const recycled = await this.renderer.shutdown();
          this.renderer = null;
          this.pendingContext = recycled.context;
          this.pendingContext = (await recycleWebGL2Context(recycled)).context;
        }
        if (this.pendingContext?.isContextLost()) {
          this.pendingContext = (
            await recycleWebGL2Context({
              canvas: this.canvas,
              context: this.pendingContext,
            })
          ).context;
        }
        if (generation !== this.generation || this.disposed) return;
        const session = new StudioSession(config);
        if (reuse) this.renderer!.resetStudioPresentation();
        this.session = session;
        this.warmKitAudio();
        if (!reuse) {
          if (!this.graphicsCapabilities) {
            const graphics = createStudioGraphicsContext(this.canvas, this.pendingContext);
            this.pendingContext = graphics.context;
            this.graphicsCapabilities = graphics.capabilities;
          }
          const preferences = normalizeGraphicsSettingsSnapshot({
            ...this.settings.all(),
            ...(config.graphicsPreset === undefined
              ? {}
              : { graphicsPreset: config.graphicsPreset }),
          });
          const profile = activateGfxProfile(
            resolveGfxProfile(this.graphicsCapabilities, preferences, ''),
          );
          const position = this.session.sim.player.pos;
          if (stage) await prepareStudioAssets(profile.settings);
          else await prepareGraphicsProfileAssets(profile.settings, position);
          if (generation !== this.generation || this.disposed) return;
          // Preparation needs the retiring extracted keys to reload source scenes
          // released by their painters. Clear derived caches only after that work.
          resetGraphicsProfileDerivedCaches();

          if (!stage) {
            beginDeferredPreloads();
            await assetsReady();
          }
          if (config.scene === 'sandbox') await preloadTrainingDummyAssets();
          const { x, z } = this.session.sim.player.pos;
          if (!stage) await ensureSkyAssetsAt(x, z);

          if (generation !== this.generation || this.disposed) return;
          setModularLookProvider((e) =>
            e.kind === 'player'
              ? inWorldLookFor(e, classArmorSet)
              : npcLookFor(e.templateId, e.kind),
          );
          const renderer = new Renderer(this.world, this.canvas, this.nameplates, {
            context: this.pendingContext,
            initializeGfx: false,
            environment: stage ? 'studio' : 'world',
            studioActor: stage
              ? (e) =>
                  this.session!.targetIds.includes(e.id) ||
                  (e.ownerId !== null && this.session!.targetIds.includes(e.ownerId))
              : undefined,
          });
          this.renderer = renderer;
          renderer.studioArtView = this.artView;
          renderer.setStudioLighting(this.lighting);
          renderer.setAbilityPresentationListener((id, phase, sourceId) => {
            if (this.ready && this.cinematicResponse && !this.reduceMotion && this.session)
              this.cinematic.moment(id, phase, sourceId, this.session.sim.player.id, renderer);
          });
          this.pendingContext = undefined;
          renderer.setAudioSink(sfx);
          renderer.reduceMotionSetting = this.reduceMotion;
          renderer.setBrightness(this.settings.get('brightness'));
          renderer.setCameraFov(this.settings.get('cameraFov'));
          renderer.setRenderScale(this.settings.get('renderScale'));
          renderer.setWaterRipples(this.settings.get('waterRipples'));
          renderer.camYaw = stage ? 0.25 : Math.PI;
          renderer.camPitch = stage ? 0.48 : 0.65;
          renderer.camDist = config.scene === 'raid' ? 32 : stage ? 21 : 15;
          if (!stage) {
            await renderer.prepareZoneAt(x, z);
            renderer.armEntryDetailHorizon();
          }
          await renderer.prewarmInitialScene();
          this.rendererPrepared = true;
        }
        if (generation !== this.generation || this.disposed) return;
        if ((reuse || stage) && this.renderer) {
          // Prepare the new views without replacing the last completed frame.
          // Their compile completions cannot otherwise repaint a frozen take.
          await prepareStudioViews(
            this.renderer,
            session.targetIds,
            () => generation === this.generation && !this.disposed,
          );
          if (generation !== this.generation || this.disposed) return;
        }
        if (this.renderer)
          await this.renderer.prepareStudioActorForms(
            session.sim.player.id,
            config.cls,
            () => generation === this.generation && !this.disposed,
          );
        if (generation !== this.generation || this.disposed) return;
        if (this.renderer)
          await prepareStudioAbilityKit(
            this.renderer,
            config.cls,
            () => generation === this.generation && !this.disposed,
          );
        if (generation !== this.generation || this.disposed) return;
        if (camera && this.renderer) {
          this.renderer.camYaw = camera.yaw;
          this.renderer.camPitch = camera.pitch;
          this.renderer.camDist = camera.distance;
        }
        this.playback = new StudioPlayback();
        this.playback.speed = speed;
        this.playback.paused = paused;
        sfx.setVolume(this.audio ? 0.65 : 0);
        this.replay = recording ?? [];
        for (const row of this.replay)
          this.session.commands.push({ tick: row.tick, command: { ...row.command } });
        this.replayIndex = 0;
        this.replayEnd = endTick;
        this.replaying = recording !== undefined;
        this.ready = true;
        this.needsDraw = true;
        this.finishReplayAtEndpoint();
        this.last = performance.now();
        this.frame(this.last);
      })
      .catch((error) => {
        this.rendererPrepared = false;
        throw error;
      });
    return this.chain;
  }

  private events(events: SimEvent[]): void {
    // Training setup earns progression deeds on its first tick. Those personal
    // celebrations obscure the spell under review and are not combat feedback.
    events = events.filter((event) => event.type !== 'deedUnlocked' && event.type !== 'levelup');
    for (const event of events) {
      this.renderer?.handleEvent(event);
      if (this.cinematicResponse && !this.reduceMotion && this.session && this.renderer)
        this.cinematic.event(event, this.session.sim.player.id, this.renderer);
      if (this.audio && !this.playback.paused && this.session)
        this.combatAudio.event(event, this.session.sim.entities, this.session.sim.player.id);
    }
    if (events.length) this.needsDraw = true;
    this.onEvents(events);
  }
  private drainReplayCommands(): void {
    const session = this.session!;
    while (
      this.replaying &&
      this.replayIndex < this.replay.length &&
      this.replay[this.replayIndex].tick <= session.ticks
    ) {
      this.dispatchCommand(this.replay[this.replayIndex++].command, false);
    }
  }
  private finishReplayAtEndpoint(): void {
    const session = this.session!;
    if (this.replaying && session.ticks >= this.replayEnd) this.drainReplayCommands();
    if (
      this.replaying &&
      session.ticks >= this.replayEnd &&
      this.replayIndex === this.replay.length
    ) {
      this.replaying = false;
      this.playback.paused = true;
      this.combatAudio.clear();
      sfx.setVolume(0);
    }
  }
  private tick = (): void => {
    this.drainReplayCommands();
    this.events(this.session!.tick());
    if (this.renderer)
      this.cinematic.update(DT, this.renderer, this.cinematicResponse && !this.reduceMotion);
    this.finishReplayAtEndpoint();
  };
  private frame = (now: number): void => {
    if (!this.ready || this.disposed) return;
    const dt = this.playback.advance((now - this.last) / 1000, this.tick);
    this.last = now;
    const preparing = [...this.renderer!.views.values()].some((view) => view.compilePending);
    if (dt > 0 || this.needsDraw || preparing)
      this.renderer!.sync(this.playback.paused ? 1 : this.playback.alpha, dt, null);
    // One last draw after the final asynchronous view becomes visible.
    this.needsDraw = preparing;
    this.onFrame();
    this.raf = requestAnimationFrame(this.frame);
  };
  requestDraw(): void {
    this.needsDraw = true;
  }
  setLighting(value: StudioLighting): void {
    this.lighting = value;
    this.renderer?.setStudioLighting(value);
    this.requestDraw();
  }
  setReducedMotion(value: boolean): void {
    this.reduceMotion = value;
    if (this.renderer) this.renderer.reduceMotionSetting = value;
    if (value) this.cinematic.clear(this.renderer);
    this.requestDraw();
  }
  get isReplaying(): boolean {
    return this.replaying;
  }
  command(command: StudioCommand): boolean {
    if (!this.ready || this.replaying || this.playback.paused) return false;
    this.dispatchCommand(command);
    return true;
  }
  private dispatchCommand(command: StudioCommand, record = true): void {
    const events = this.session!.dispatch(command, record);
    // Preparation may reposition the actor. Update displayed anchors before
    // release effects read them, including during a deterministic replay.
    if (command.kind === 'cast' && command.prepare)
      this.renderer?.sync(1, 0, null, 0, null, true, false);
    this.events(events);
  }
  pause(): void {
    this.playback.paused = !this.playback.paused;
    if (this.playback.paused) {
      this.needsDraw = false;
      this.combatAudio.clear();
    }
    this.last = performance.now();
    sfx.setVolume(this.audio && !this.playback.paused ? 0.65 : 0);
  }
  step(): void {
    if (!this.ready || !this.playback.paused) return;
    this.tick();
    this.renderer!.sync(1, DT, null);
    this.needsDraw = false;
    this.onFrame();
  }
  setAudio(active: boolean): void {
    this.audio = active;
    if (!active) this.combatAudio.clear();
    if (active) {
      sfx.init();
      this.warmKitAudio();
    }
    sfx.setVolume(active && !this.playback.paused ? 0.65 : 0);
  }
  private warmKitAudio(): void {
    if (!this.audio || !this.session) return;
    for (const ability of this.session.abilities) {
      for (const phase of ['charge', 'release', 'impact'] as const) {
        const key = masterworkAudioKey(ability, phase);
        if (key) sfx.preload(key);
      }
    }
  }
  async dispose(): Promise<void> {
    this.cinematic.clear(this.renderer);
    this.disposed = true;
    this.combatAudio.clear();
    this.generation++;
    this.ready = false;
    cancelAnimationFrame(this.raf);
    sfx.setVolume(0);
    await this.chain.catch(() => {});
    const recycled = await this.renderer?.shutdown();
    recycled?.context.getExtension('WEBGL_lose_context')?.loseContext();
    this.pendingContext?.getExtension('WEBGL_lose_context')?.loseContext();
    this.pendingContext = undefined;
    this.renderer = null;
  }
}
