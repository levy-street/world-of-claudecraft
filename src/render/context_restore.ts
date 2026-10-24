// The world renderer's side of an in-place WebGL context loss and restore
// (the registry and pass sequencing are the pure context_restore_core.ts).
//
// three answers a restore by rebuilding every program, texture and render
// target lazily at its next use, so without this host the restore frame links
// everything on screen at once (measured: one 2.3 s frame on an RTX 3090, a
// 3.3 s freeze in a traced AMD session), every "prepared" record keeps
// answering for a context that is gone (so the rest links in live frames for
// the rest of the session), and every render target comes back empty (the
// world stays dark). The host, in order:
// - on LOSS: bump the context generation (context_generation.ts: a link that
//   straddles the loss is linked again) and pause the GPU queue, so nothing
//   is proved on a dead context;
// - on RESTORE: re-read what was captured off the old context (the GL
//   identity, the draw stats, the pinned extension sweep and its drift
//   sentinel, the shader warm worker), run every registered reset
//   (context_restore_registry.ts), then HOLD THE WORLD DRAW under the arrival
//   cover while the re-bakes, the post chain and the visible scene link and
//   upload through the queue, for at most CONTEXT_RESTORE_HOLD_MAX_MS;
// - after the hold: the rest (the cast families, the zone archetypes, the
//   resident scene the camera cannot see) resumes as paced BOOT_DEBT with
//   every gate closed again, so nothing opens on the dead context's proof.
// The HUD, input, sim and network run through the hold: only the 3D view is
// withheld, for less time than the frozen frame it replaces, and a note says
// why (src/ui/graphics_restore_note_controller.ts).
//
// A graphics rebuild never reaches this: the renderer removes these listeners
// before its own recycle loses the context, and the rebuild runs its curtain.

import * as THREE from 'three';
import { setArrivalCover as setArrivalCoverDefault } from './arrival_cover';
import { type BackgroundGpuQueue, GPU_WORK_PRIORITY } from './background_gpu_queue';
import type { CompileArmHost } from './compile_arms';
import {
  disposeRendererContextGeneration,
  noteRendererContextLost,
  noteRendererContextRestored,
} from './context_generation';
import {
  CONTEXT_RESTORE_HOLD_MAX_MS,
  type ContextRestoreHoldEnd,
  type ContextRestoreSnapshot,
  createContextRestoreSequence,
} from './context_restore_core';
import {
  beginContextRestoreHold,
  endContextRestoreHold,
  setContextRestorePacing,
} from './context_restore_hold';
import {
  contextRestoreRebakeUnits,
  registerContextRestoreRebake,
  registerContextRestoreReset,
  runContextRestoreResets,
} from './context_restore_registry';
import { enableAndWatchRendererExtensions } from './extension_drift_sentinel';
import { recordGpuPrepEvent } from './gpu_prep_events';
import {
  buildSceneRestoreCompileUnits,
  type InitialSceneCompileDedupe,
  type InitialSceneCompileTail,
} from './initial_scene_compile_units';
import { liveMaterialProperties } from './linked_program_touch';
import { createPrewarmCompileLifecycle } from './prewarm_compile_lifecycle';
import type { PrewarmResumeUnit } from './prewarm_resume';
import { runResumeUnit } from './prewarm_resume_runner';
import { restartShaderWarmForContextRestore } from './shader_warm_client';
import { runTexturePrepLane } from './texture_prep_lane';

/** The renderer surface a restore reads. Read-through closures: the post
 *  chain, the sky, the scene contents and the player move during a session. */
export interface ContextRestoreSurface {
  /** The renderer; the host listens on its canvas (`domElement`). */
  webgl(): THREE.WebGLRenderer;
  queue: BackgroundGpuQueue;
  isShutdown(): boolean;
  /** Re-read what the renderer caches off the context: the GL identity, and
   *  the composer's draw-stats session, which would otherwise keep reading the
   *  `info` object initGLContext just replaced (a dead accumulator). */
  rebindContextReaders(): void;
  scene(): THREE.Scene;
  player(): { x: number; z: number };
  /** The compile arms, for the shader warm ahead of each debt link; null skips it. */
  arms: CompileArmHost | null;
  compileColor(root: THREE.Object3D): Promise<unknown>;
  compileShadow(root: THREE.Object3D): Promise<unknown>;
  /** The link tail the entry lane binds (settle, then touch). */
  tail(): InitialSceneCompileTail;
  /** Chunked texture uploads already in flight (texture_residency_ledger.ts). */
  textureInFlight: WeakMap<THREE.Texture, Promise<void>>;
  compileBatchRoots: number;
  /** The renderer's per-zone "programs prewarmed" records. */
  zoneProgramRecords(): readonly Set<string>[];
  /** The zone archetype prewarm, as the background streaming lane runs it. */
  prewarmZone(x: number, z: number): Promise<void>;
  /** One composer pass with the scene hidden plus the shed twin
   *  (renderer.ts renderPresentationPrewarmPass); false without a composer. */
  presentationPrewarm(): boolean;
  /** The cast gate's program units (cast_vfx_prewarm.ts), first reads first. */
  castVfxUnits(): PrewarmResumeUnit[];
  /** The local spirit prewarmer (self_spirit_prewarm.ts). */
  selfSpirit(): {
    observe(
      visual: object,
      skin: number,
      mainhand: string | null,
      offhand: string | null,
      weaponSkin: string | null,
    ): void;
  };
  environment(): ContextRestoreEnvironment | null;
}

/** The prefiltered environment maps (PMREM render targets) a restore empties. */
export interface ContextRestoreEnvironment {
  targets: ReadonlyMap<string, THREE.WebGLRenderTarget>;
  /** The equirect a target was prefiltered from, null when not resident. */
  source(key: string): THREE.Texture | null;
  pmrem(): THREE.PMREMGenerator;
  /** Forget a target whose source is gone, so the next prepare builds it. */
  drop(key: string): void;
  /** The sky dome, for the prefilter used when no biome equirect exists. */
  dome(): THREE.Object3D;
}

/** The environment used when no per-biome equirect prefilter exists: the dome
 *  itself prefiltered (its gain and clamp already applied). `far` covers the
 *  560u dome; size 128 matches the 512-wide equirect prefilters, since the
 *  cubeUV height is a program-cache-key input. */
export function prefilterSkyDome(
  pmrem: THREE.PMREMGenerator,
  dome: THREE.Object3D,
): THREE.WebGLRenderTarget {
  const envScene = new THREE.Scene();
  envScene.add(dome.clone());
  return pmrem.fromScene(envScene, 0.04, 0.1, 1100, { size: 128 });
}

export interface ContextRestoreOptions {
  now?: () => number;
  schedule?: (callback: () => void, ms: number) => () => void;
  holdMaxMs?: number;
  setArrivalCover?: (active: boolean) => void;
}

// A look no real player can wear: observing it makes the spirit prewarmer's
// "already warmed" comparison fail for the real look on its next frame, so
// the local spirit's variants are warmed again on the restored context.
const FORGOTTEN_SPIRIT_LOOK = Object.freeze({});

const defaultSchedule = (callback: () => void, ms: number): (() => void) => {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
};

export class ContextRestoreHost {
  private readonly sequence;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, ms: number) => () => void;
  private readonly setCover: (active: boolean) => void;
  private coverRaised = false;
  private cancelPass: (() => void) | null = null;
  private disposed = false;
  private readonly canvas: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  private readonly onLost = (): void => this.contextLost();
  private readonly onRestored = (): void => this.contextRestored();

  constructor(
    private readonly surface: ContextRestoreSurface,
    options: ContextRestoreOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.schedule = options.schedule ?? defaultSchedule;
    this.setCover = options.setArrivalCover ?? setArrivalCoverDefault;
    this.sequence = createContextRestoreSequence(options.holdMaxMs ?? CONTEXT_RESTORE_HOLD_MAX_MS);
    this.canvas = surface.webgl().domElement;
    this.canvas.addEventListener('webglcontextlost', this.onLost);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored);
    registerContextRestoreReset('renderer.zone-programs', this, (host) => host.forgetZones());
    registerContextRestoreReset('self-spirit', this, (host) => host.forgetSpirit());
    registerContextRestoreRebake('environment-maps', this, (host) => host.rebakeEnvironment());
  }

  snapshot(): ContextRestoreSnapshot {
    return this.sequence.snapshot();
  }

  /** The renderer is shutting down: stop listening, release anything held. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const pass = this.sequence.snapshot().generation;
    this.endHold(pass, 'disposed');
    this.cancelPass?.();
    disposeRendererContextGeneration(this.surface.webgl());
  }

  private contextLost(): void {
    if (this.disposed) return;
    const wasHolding = this.sequence.snapshot().phase === 'holding';
    this.sequence.lost(this.now());
    if (wasHolding) {
      recordGpuPrepEvent({
        kind: 'context-restore',
        key: 'cancelled',
        ageMs: this.sequence.snapshot().lastHold?.ms ?? 0,
      });
    }
    noteRendererContextLost(this.surface.webgl());
    this.surface.queue.setPaused(true);
    this.releaseHoldAndCover();
    this.cancelPass?.();
  }

  private contextRestored(): void {
    if (this.disposed || this.surface.isShutdown()) return;
    const webgl = this.surface.webgl();
    const pass = this.sequence.restored(this.now());
    noteRendererContextRestored(webgl);
    this.surface.rebindContextReaders();
    // Three enabled its own set on the new context; the pinned sweep runs
    // again BEFORE anything links, so the program keys match the ones the
    // session linked before the loss, and the drift sentinel watches the new
    // extension object instead of the dead one.
    try {
      enableAndWatchRendererExtensions(webgl);
    } catch (error) {
      console.warn('[context-restore] extension sweep failed', error);
    }
    restartShaderWarmForContextRestore();
    const report = runContextRestoreResets();
    // A cached shadow map comes back empty too; draw it at the next pass.
    webgl.shadowMap.needsUpdate = true;
    this.raiseHoldAndCover();
    this.surface.queue.setPaused(false);
    void this.runPass(pass, report.instances).catch((error: unknown) => {
      console.warn('[context-restore] restore pass failed', error);
      this.endHold(pass, 'bound');
    });
  }

  private raiseHoldAndCover(): void {
    const now = this.now();
    beginContextRestoreHold((this.sequence.holdDeadline() ?? now) - now, now);
    if (!this.coverRaised) {
      this.coverRaised = true;
      this.setCover(true);
      setContextRestorePacing(true);
    }
  }

  private releaseHoldAndCover(): void {
    endContextRestoreHold();
    if (this.coverRaised) {
      this.coverRaised = false;
      setContextRestorePacing(false);
      this.setCover(false);
    }
  }

  private endHold(pass: number, end: ContextRestoreHoldEnd, counts?: HoldCounts): void {
    const ended = this.sequence.endHold(pass, this.now(), end);
    this.releaseHoldAndCover();
    if (!ended) return;
    recordGpuPrepEvent({
      kind: 'context-restore',
      key: end,
      ageMs: this.sequence.snapshot().lastHold?.ms ?? 0,
      readyRoots: counts?.settled ?? 0,
      totalRoots: counts?.submitted ?? 0,
      units: counts?.resets ?? 0,
    });
  }

  private async runPass(pass: number, resets: number): Promise<void> {
    const counts: HoldCounts = { submitted: 0, settled: 0, resets };
    const work: Promise<unknown>[] = [];
    const queue = this.surface.queue;
    const track = (task: Promise<unknown>): void => {
      counts.submitted++;
      work.push(
        task.then(
          () => {
            counts.settled++;
          },
          (error: unknown) => {
            counts.settled++;
            console.warn('[context-restore] hold unit failed', error);
          },
        ),
      );
    };
    const hold = GPU_WORK_PRIORITY.VISIBLE_PREWARM;
    // A unit a second loss left queued belongs to a cancelled pass: skipped,
    // never run beside the next pass's own copy.
    const live =
      <T>(work: () => T) =>
      (): T | undefined =>
        this.sequence.current(pass) ? work() : undefined;
    for (const rebake of contextRestoreRebakeUnits()) {
      // One kind per re-bake: an atlas and a target re-init cost nothing alike.
      track(queue.run(live(rebake.run), hold, `restore-rebake-${rebake.id}`));
    }
    track(
      queue.run(
        live(() => this.surface.presentationPrewarm()),
        hold,
        'restore-post',
      ),
    );
    const dedupe: InitialSceneCompileDedupe = { seen: new Set(), seenKeys: new Set() };
    const player = this.surface.player();
    const tail = this.surface.tail();
    const unitsFor = (reach: 'visible' | 'resident'): PrewarmResumeUnit[] =>
      buildSceneRestoreCompileUnits({
        scene: this.surface.scene(),
        reach,
        playerX: player.x,
        playerZ: player.z,
        batchSize: this.surface.compileBatchRoots,
        sharedDedupe: dedupe,
        compileColor: (root) => this.surface.compileColor(root),
        compileShadow: (root) => this.surface.compileShadow(root),
        tail,
      });
    const links: Promise<unknown>[] = [];
    for (const unit of unitsFor('visible')) {
      const link = queue.run(live(unit.run), hold, `restore-link:${unit.id}`, {
        releaseTail: true,
      });
      links.push(link.catch(() => undefined));
      track(link);
    }
    // Every texture the visible scene samples, not only the link units'
    // roots: those are deduped by PROGRAM, and a hundred props sharing one
    // program still carry a hundred textures the first draw would upload.
    const scene = this.surface.scene();
    const visibleScene = {
      traverse: (visit: (object: unknown) => void) => scene.traverseVisible(visit),
    };
    const upload = (root: { traverse(visit: (object: unknown) => void): void }) =>
      runTexturePrepLane(
        queue,
        liveMaterialProperties(this.surface.webgl()),
        this.surface.webgl(),
        root,
        hold,
        { inFlight: this.surface.textureInFlight },
      );
    track(upload(visibleScene));
    // And the textures a program binds through uniforms its material does not
    // carry (an onBeforeCompile hook's own: the terrain splats, the shared
    // fields). three keeps them on its per-material record once the program
    // exists, so they are read after the links, off the restored context.
    const properties = liveMaterialProperties(this.surface.webgl());
    const programUniforms = {
      traverse: (visit: (object: unknown) => void) =>
        scene.traverseVisible((object) => {
          const material = (object as { material?: THREE.Material | THREE.Material[] }).material;
          for (const entry of Array.isArray(material) ? material : material ? [material] : []) {
            const record = properties.get(entry) as { uniforms?: unknown } | undefined;
            if (record?.uniforms) visit({ material: { uniforms: record.uniforms } });
          }
        }),
    };
    track(Promise.all(links).then(() => upload(programUniforms)));
    let cancelBound: () => void = () => {};
    const end = await new Promise<ContextRestoreHoldEnd>((resolve) => {
      const remaining = (this.sequence.holdDeadline() ?? this.now()) - this.now();
      cancelBound = this.schedule(() => resolve('bound'), Math.max(0, remaining));
      this.cancelPass = () => resolve('cancelled');
      void Promise.all(work).then(() => resolve('settled'));
    });
    cancelBound();
    this.cancelPass = null;
    if (end === 'cancelled' || !this.sequence.current(pass)) return;
    this.endHold(pass, end, counts);
    await this.resumeDebt(pass, unitsFor);
    this.sequence.resumed(pass);
  }

  /** The paced remainder, in the order a first combat after the restore
   *  needs it: the cast families (their gate is closed again), the zone
   *  archetypes, then everything resident the camera could not see. */
  private async resumeDebt(
    pass: number,
    unitsFor: (reach: 'visible' | 'resident') => PrewarmResumeUnit[],
  ): Promise<void> {
    const lifecycle = createPrewarmCompileLifecycle(this.now);
    const deps = {
      queue: this.surface.queue,
      ledger: { noteStart: () => {} },
      lifecycle,
      arms: this.surface.arms,
    };
    const run = async (id: string, units: readonly PrewarmResumeUnit[]): Promise<void> => {
      const entry = { id, units };
      for (const unit of units) {
        if (!this.sequence.current(pass) || this.disposed) return;
        try {
          await runResumeUnit(unit, entry, deps);
        } catch (error) {
          console.warn(`[context-restore] debt unit failed: ${id}:${unit.id}`, error);
        }
      }
    };
    await run('programs.context-restore-cast', this.surface.castVfxUnits());
    if (!this.sequence.current(pass) || this.disposed) return;
    try {
      const { x, z } = this.surface.player();
      await this.surface.prewarmZone(x, z);
    } catch (error) {
      console.warn('[context-restore] zone prewarm failed', error);
    }
    await run('programs.context-restore-resident', unitsFor('resident'));
  }

  private forgetZones(): void {
    if (this.disposed) return;
    for (const records of this.surface.zoneProgramRecords()) records.clear();
  }

  private forgetSpirit(): void {
    if (this.disposed) return;
    this.surface.selfSpirit().observe(FORGOTTEN_SPIRIT_LOOK, -1, null, null, null);
  }

  /** Each prefiltered environment is rendered again into its own target, so
   *  every material and every blend already pointing at it lights again. A
   *  target whose source equirect is not resident is forgotten instead, and
   *  the next zone prepare builds it. With no per-biome target at all the
   *  scene lights from the dome's own prefilter, which is made again. */
  private rebakeEnvironment(): void {
    if (this.disposed) return;
    const environment = this.surface.environment();
    if (!environment) return;
    if (environment.targets.size === 0) {
      const scene = this.surface.scene();
      const current = scene.environment;
      if (!current?.isRenderTargetTexture) return;
      scene.environment = prefilterSkyDome(environment.pmrem(), environment.dome()).texture;
      current.renderTarget?.dispose();
      return;
    }
    // Several biome keys can share one target (one source prefilters once).
    const rebaked = new Set<THREE.WebGLRenderTarget>();
    for (const [key, target] of environment.targets) {
      if (rebaked.has(target)) continue;
      const source = environment.source(key);
      if (!source) {
        environment.drop(key);
        continue;
      }
      rebaked.add(target);
      environment.pmrem().fromEquirectangular(source, target);
    }
  }
}

interface HoldCounts {
  submitted: number;
  settled: number;
  resets: number;
}
