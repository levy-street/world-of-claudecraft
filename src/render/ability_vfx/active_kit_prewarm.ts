import type * as THREE from 'three';
import { type BackgroundGpuQueue, GPU_WORK_PRIORITY } from '../background_gpu_queue';
import type { PrewarmManifestEntry } from '../prewarm_entry';
import type { PrewarmResumeUnit } from '../prewarm_resume';
import {
  bakedTexture,
  warriorBloodTexture,
  warriorPressureTexture,
  warriorSteelTexture,
} from './production_assets';
import type { CrestKind } from './signature_shapes';
import { WARRIOR_PRESSURE_KINDS } from './warrior_shout_shapes';

export const ACTIVE_WARRIOR_CRESTS: readonly CrestKind[] = [
  'blood_cut',
  'harvest_cut',
  'harvest_eruption',
  'twinstrike_cut',
  'bloodletting_pull',
  'shield_contact',
  'steel_cut',
  'steel_chop',
  'steel_counter',
  'steel_execution',
  'steel_storm',
  'steel_reap',
  'iron_counter',
  'iron_quake',
  'iron_fault',
  'breach_wedge',
  'avatar_rupture',
  'blood_gyre',
  'leap_rupture',
  ...WARRIOR_PRESSURE_KINDS,
];
interface ActiveKitHost {
  queue: Pick<BackgroundGpuQueue, 'run'>;
  geometry(kinds: readonly CrestKind[]): readonly PrewarmResumeUnit[];
  texture(texture: THREE.Texture): void;
}
interface Preparation {
  host: ActiveKitHost;
  localClass: string;
  task: Promise<void> | null;
  done: Set<string>;
  cancelled: boolean;
}
const preparations = new WeakMap<object, Preparation>();

function recipe(state: Preparation, cls: string): readonly PrewarmResumeUnit[] {
  if (cls !== 'warrior') return [];
  return [
    {
      id: 'upload-big:active-warrior-blood',
      run: () => {
        const texture = warriorBloodTexture();
        if (!texture) throw new Error('Active Warrior blood texture was not loaded');
        state.host.texture(texture);
      },
    },
    {
      id: 'upload-big:active-warrior-steel',
      run: () => {
        const texture = warriorSteelTexture();
        if (!texture) throw new Error('Active Warrior steel texture was not loaded');
        state.host.texture(texture);
      },
    },
    {
      id: 'upload-big:active-warrior-pressure',
      run: () => {
        const texture = warriorPressureTexture();
        if (!texture) throw new Error('Active Warrior pressure texture was not loaded');
        state.host.texture(texture);
      },
    },
    {
      id: 'upload-big:active-warrior-power',
      run: () => {
        const texture = bakedTexture('warrior_power');
        if (!texture) throw new Error('Active Warrior power texture was not loaded');
        state.host.texture(texture);
      },
    },
    {
      id: 'upload-big:active-harvest-impact',
      run: () => {
        const texture = bakedTexture('harvest_impact');
        if (!texture) throw new Error('Red Harvest impact texture was not loaded');
        state.host.texture(texture);
      },
    },
    {
      id: 'upload-big:active-warrior-bite',
      run: () => {
        const texture = bakedTexture('warrior_bite');
        if (!texture) throw new Error('Warrior bite texture was not loaded');
        state.host.texture(texture);
      },
    },
    ...state.host.geometry(ACTIVE_WARRIOR_CRESTS),
  ].filter((unit) => !state.done.has(unit.id));
}

/** This optional manifest record owns a small local recipe. It does not spend
 * the loading deadline or enter the serial whole-catalogue resume chain.
 * Registration is unconditional, including a skipped constrained entry. */
export function activeKitPrewarmEntry(scene: object, cls: string, host: ActiveKitHost) {
  cancelActiveAbilityKit(scene);
  const state: Preparation = {
    host,
    localClass: cls,
    task: null,
    done: new Set(),
    cancelled: false,
  };
  preparations.set(scene, state);
  return {
    id: 'vfx.active-local-kit',
    category: 'vfx' as const,
    priority: 61.5,
    required: false,
    run: () => {},
    progress: () => {
      const remaining = recipe(state, state.localClass).length;
      return {
        done: state.done.size,
        planned: state.done.size + remaining,
        trimmed: remaining > 0,
      };
    },
  } satisfies PrewarmManifestEntry;
}

/** Also selects the current class when Studio reuses a scene for another kit.
 * No visible spawns, catalogue traversal or on-cast uploads occur here. */
export function ensureActiveAbilityKit(scene: object, cls?: string): Promise<void> {
  const state = preparations.get(scene);
  if (!state || state.cancelled) return Promise.resolve();
  const selected = cls ?? state.localClass;
  if (selected !== 'warrior') return Promise.resolve();
  state.localClass = selected;
  if (state.task) return state.task;
  const units = recipe(state, selected);
  if (!units.length) return Promise.resolve();
  const task = (async () => {
    for (const unit of units) {
      if (state.cancelled) return;
      await state.host.queue.run(
        () => {
          if (!state.cancelled) return unit.run();
        },
        GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
        unit.id,
        {
          releaseTail: true,
        },
      );
      if (state.cancelled) return;
      state.done.add(unit.id);
    }
  })();
  state.task = task;
  const release = () => {
    state.task = null;
  };
  void task.then(release, release);
  return task;
}

/** Start after the manifest, independently of unrelated retained world work.
 * Errors stay observable by Studio; ordinary gameplay keeps its primary fallback. */
export function resumeActiveAbilityKit(scene: object, afterFirstPaint?: Promise<unknown>): void {
  void Promise.resolve(afterFirstPaint)
    .then(() => ensureActiveAbilityKit(scene))
    .catch((error) => {
      console.warn('Active ability preparation failed', error);
    });
}

export function cancelActiveAbilityKit(scene: object): void {
  const state = preparations.get(scene);
  if (state) state.cancelled = true;
  preparations.delete(scene);
}
