// The Fire and Fly arena, built hidden ahead of the teleport. The seat teleports
// in the tick the trial is picked, and the live copy then linked its programs
// behind the interior's compile gate in the first frames inside: the ground
// stood alone before the trees and the cover showed. The pick comes from
// Alder's dialog, so the moment the player targets him
// (fire_and_fly_arena_intent_core.ts) one copy is built at slot 0's origin under
// a holder that is never shown, through the live path's own open-field builder
// and compile gate: its programs link and its textures upload while the player
// reads. Its first build shaped the whole hill canopy in one frame, so the
// arena's caches fill first in small steps (fireAndFlyArenaWarmSteps), one
// unit each on the renderer's preparation queue at the approaching priority,
// admitted under its frame budget (idle slots when no queue was lent), and
// the build that follows is short. Every material it draws is page-lifetime (the arena's named set, the
// open world's foliage), so the live copy links as a cache hit whichever slot
// it lands in. The copy owns only its instance buffers and ghost-hide shells,
// released once when the player sits down, walks away, or lets the intent
// lapse (the battleground prebuild's shape, battleground_views.ts).

import * as THREE from 'three';
import {
  FIRE_AND_FLY_DUNGEON_DEFS,
  FIRE_AND_FLY_DUNGEON_ID,
} from '../sim/content/fire_and_fly_arena';
import { instanceOrigin } from '../sim/data';
import { GPU_WORK_PRIORITY, isGpuQueueShutdown } from './background_gpu_queue';
import { timeBuildSpan } from './build_spans';
import { fireAndFlyArenaWarmSteps } from './fire_and_fly_arena';
import { FIRE_AND_FLY_INTERIOR } from './fire_and_fly_arena_core';
import {
  type ArenaIntentWorld,
  type ArenaPrebuildState,
  createArenaPrebuildState,
  stepArenaPrebuild,
} from './fire_and_fly_arena_intent_core';
import { GFX } from './gfx';
import { type IdleScheduler, idleSlot } from './idle_queue';
import {
  createOwnedInteriorResourceRegistry,
  type OwnedInteriorResourceRegistry,
} from './interior_resource_lifecycle';
import {
  attachOpenFieldInterior,
  type OpenFieldInterior,
  openFieldInteriorBuilder,
} from './open_field_interiors';
import type { FireLightSink } from './point_light_budget';

type CompileGate = (target: THREE.Object3D) => Promise<unknown>;

export const FIRE_AND_FLY_PREBUILD_NAME = 'fireAndFlyArenaPrebuild';

// The turret rigs' idle terms (turret_defense_visual.ts): a busy frame is
// skipped twice, then the step runs anyway so the chain always finishes.
const WARM_IDLE_TIMEOUT_MS = 250;
const WARM_IDLE_DEFERRALS = 2;

export interface ArenaPrebuildScene {
  add(object: THREE.Object3D): unknown;
  remove(object: THREE.Object3D): unknown;
}

/** Builds and attaches one copy under `holder`; the default is the live path's own. */
export type ArenaPrebuildBuilder = (
  holder: THREE.Group,
  registry: OwnedInteriorResourceRegistry,
  compileGate: CompileGate | undefined,
) => Promise<void>;

/** The slice of the renderer's background GPU queue the warm steps ride. */
export interface ArenaPrebuildQueue {
  run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T>;
}

/** The kind the preparation budget learns a warm step's cost under. */
export const ARENA_WARM_LABEL = 'arena-warm';

export interface ArenaPrebuildOptions {
  build?: ArenaPrebuildBuilder;
  /** The cache fills that run first: one queue unit each, or idle slots without a queue. */
  warmSteps?: () => (() => void)[];
  idle?: IdleScheduler;
}

const lowGfx = (): boolean => !GFX.standardMaterials;

// The arena takes no flame and no point light (its golden hour is the
// interior light rig's grade), so the builder's lent sinks stay empty.
const NO_FIRE_LIGHTS: FireLightSink = { push: () => 0 };

const buildArenaCopy: ArenaPrebuildBuilder = (holder, registry, compileGate) => {
  const field = openFieldInteriorBuilder(FIRE_AND_FLY_INTERIOR) as OpenFieldInterior;
  const origin = instanceOrigin(FIRE_AND_FLY_DUNGEON_DEFS[FIRE_AND_FLY_DUNGEON_ID].index, 0);
  const group = timeBuildSpan('zone:fire-and-fly-prebuild', () =>
    field.build({ lowGfx: lowGfx(), flames: [], fireLights: NO_FIRE_LIGHTS, origin }),
  );
  return attachOpenFieldInterior(holder, group, field, compileGate, registry);
};

interface ArenaCopy {
  holder: THREE.Group;
  registry: OwnedInteriorResourceRegistry;
}

export class FireAndFlyArenaPrebuild {
  private readonly state: ArenaPrebuildState = createArenaPrebuildState();
  private copy: ArenaCopy | null = null;
  private disposed = false;
  private readonly build: ArenaPrebuildBuilder;
  private readonly warmSteps: () => (() => void)[];
  private readonly idle: IdleScheduler | undefined;
  private queue: ArenaPrebuildQueue | null = null;

  constructor(
    private readonly scene: ArenaPrebuildScene,
    private readonly compileGate?: CompileGate,
    options: ArenaPrebuildOptions = {},
  ) {
    this.build = options.build ?? buildArenaCopy;
    this.warmSteps = options.warmSteps ?? (() => fireAndFlyArenaWarmSteps(lowGfx()));
    this.idle = options.idle;
  }

  /** The renderer's preparation queue; without one the steps take idle slots. */
  setQueue(queue: ArenaPrebuildQueue | null): void {
    this.queue = queue;
  }

  /** A hidden copy stands (it may still be warming or linking). */
  get built(): boolean {
    return this.copy !== null;
  }

  update(world: ArenaIntentWorld, nowMs: number): void {
    if (this.disposed) return;
    const verdict = stepArenaPrebuild(this.state, world, nowMs);
    if (verdict === 'build') this.buildCopy();
    else if (verdict === 'release') this.release();
  }

  dispose(): void {
    this.disposed = true;
    this.release();
  }

  private buildCopy(): void {
    const holder = new THREE.Group();
    holder.name = FIRE_AND_FLY_PREBUILD_NAME;
    holder.visible = false;
    const copy: ArenaCopy = { holder, registry: createOwnedInteriorResourceRegistry() };
    this.scene.add(holder);
    this.copy = copy;
    void this.run(copy);
  }

  private async run(copy: ArenaCopy): Promise<void> {
    let attached: Promise<void>;
    try {
      const steps = this.warmSteps();
      const queue = this.queue;
      if (queue) await this.warmOnQueue(copy, steps, queue);
      else await this.warmOnIdle(copy, steps);
      if (this.copy !== copy) return;
      attached = this.build(copy.holder, copy.registry, this.compileGate);
    } catch (error) {
      const current = this.copy === copy;
      if (current) this.release();
      if (current && !isGpuQueueShutdown(error)) {
        console.error('Fire and Fly arena prebuild failed, the arena links at entry', error);
      }
      return;
    }
    // A gate cancelled by the release rejects here; the copy is already gone.
    await attached.catch(() => {});
  }

  private async warmOnQueue(
    copy: ArenaCopy,
    steps: readonly (() => void)[],
    queue: ArenaPrebuildQueue,
  ): Promise<void> {
    for (let i = 0; i < steps.length && this.copy === copy; i++) {
      // Enqueued from the last one's completion: the chain holds one slot.
      await queue.run(
        () => {
          if (this.copy === copy) timeBuildSpan('zone:fire-and-fly-warm', steps[i]);
        },
        GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        `${ARENA_WARM_LABEL}:fire-and-fly:${i}`,
      );
    }
  }

  private async warmOnIdle(copy: ArenaCopy, steps: readonly (() => void)[]): Promise<void> {
    let next = 0;
    while (next < steps.length) {
      const slot = await idleSlot(WARM_IDLE_TIMEOUT_MS, {
        scheduler: this.idle,
        maxTimeoutDeferrals: WARM_IDLE_DEFERRALS,
      });
      if (this.copy !== copy) return;
      // As many steps as the idle period holds, judged by the last one's cost;
      // always one, so a slot the timeout forced still makes progress.
      const until = performance.now() + slot.timeRemainingMs;
      let cost = 0;
      do {
        const started = performance.now();
        timeBuildSpan('zone:fire-and-fly-warm', steps[next++]);
        cost = performance.now() - started;
      } while (next < steps.length && performance.now() + cost < until);
    }
  }

  private release(): void {
    const copy = this.copy;
    if (!copy) return;
    this.copy = null;
    this.scene.remove(copy.holder);
    // Retiring the registry also cancels a gate still pending on the copy.
    const report = copy.registry.dispose();
    if (report.errors.length > 0) {
      console.warn('Fire and Fly arena prebuild release failed', report.errors[0]);
    }
  }
}
