import type * as THREE from 'three';
import { type BackgroundGpuQueue, GPU_WORK_PRIORITY } from '../background_gpu_queue';
import { registerContextRestoreReset } from '../context_restore_registry';
import type { PrewarmManifestEntry } from '../prewarm_entry';
import type { PrewarmResumeUnit } from '../prewarm_resume';
import { contactTexture } from './contact_assets';
import {
  bakedTexture,
  warriorBloodTexture,
  warriorPressureTexture,
  warriorRockTexture,
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
  'bark_pressure',
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
/** The kit's queue priority. The kit is a cosmetic upgrade gated by its own
 *  readiness (the baked layers and contact sheets wait on `textureReady`, the
 *  crests on their prepared slots), so the generic presentation carries every cast until it
 *  lands and nothing here is actionable. It rides the boot-debt lane, which
 *  the budget paces as approaching work (at most one big upload per presented
 *  frame, where the actionable floor admitted all ten sheets into one 533 to
 *  635 ms freeze on an Intel HD 530) and which waits out a loading cover: the
 *  cover's frames belong to what the camera landed among, and the kit's
 *  uploads froze the entry settle cover for 555 ms under the visible class. */
export const ACTIVE_KIT_PRIORITY = GPU_WORK_PRIORITY.BOOT_DEBT;
/** The waits before each new attempt at a failed kit preparation. The painter
 *  asks for the kit once per renderer, so without these a single failed unit
 *  (a sheet that did not load, a link the driver rejected) left the kit cold
 *  until the renderer was rebuilt. Bounded: past the last one it gives up. */
export const ACTIVE_KIT_RETRY_DELAYS_MS: readonly number[] = [5_000, 30_000, 120_000];
interface ActiveKitHost {
  queue: Pick<BackgroundGpuQueue, 'run'>;
  /** Start (or join) the kit's demand-loaded assets before any unit runs;
   *  false means the device declined them, so the kit stays cold and no unit
   *  runs. Absent in tests that inject textures directly. */
  assets?(): Promise<boolean>;
  geometry(kinds: readonly CrestKind[]): readonly PrewarmResumeUnit[];
  texture(texture: THREE.Texture): void;
}
interface Preparation {
  scene: object;
  host: ActiveKitHost;
  localClass: string;
  task: Promise<void> | null;
  done: Set<string>;
  cancelled: boolean;
  /** Bumped by a context restore: a unit that finished for an older context
   *  is not recorded as done for this one. */
  context: number;
  failures: number;
  retry: ReturnType<typeof setTimeout> | null;
}
const preparations = new WeakMap<object, Preparation>();

/** Every sheet the kit's live presentation draws, each uploaded by its own
 *  paced unit before any geometry unit runs: the contact sheets
 *  (`flipbooks.ts`), the smoke and dust layers (`baked_impact_layers.ts`) and
 *  the signature sheets. They land with the kit's demand load, and this recipe
 *  is their only upload home on each renderer; every drawer waits for its
 *  sheet's upload (a contact binds a procedural sheet meanwhile, smoke and dust
 *  skip), so those five go first to shorten that window. The kit loads no
 *  sheet this list does not upload. A sheet that is absent fails its unit,
 *  so the kit stays cold rather than half-ready. */
const KIT_SHEETS: readonly (readonly [
  id: string,
  name: string,
  sheet: () => THREE.Texture | null,
])[] = [
  ['active-contact-cut', 'Warrior cut contact', () => contactTexture('contact_cut')],
  ['active-contact-crush', 'Warrior crush contact', () => contactTexture('contact_crush')],
  ['active-contact-pierce', 'Warrior pierce contact', () => contactTexture('contact_pierce')],
  ['active-smoke', 'Warrior smoke', () => bakedTexture('smoke')],
  ['active-shout-dust', 'Warrior shout dust', () => bakedTexture('shout_dust')],
  ['active-warrior-blood', 'Active Warrior blood', () => warriorBloodTexture()],
  ['active-warrior-steel', 'Active Warrior steel', () => warriorSteelTexture()],
  ['active-warrior-pressure', 'Active Warrior pressure', () => warriorPressureTexture()],
  ['active-warrior-rock', 'Active Warrior rock', () => warriorRockTexture()],
  ['active-warrior-power', 'Active Warrior power', () => bakedTexture('warrior_power')],
  ['active-warrior-fervor', 'Active Warrior fervor', () => bakedTexture('warrior_fervor')],
  ['active-harvest-impact', 'Red Harvest impact', () => bakedTexture('harvest_impact')],
  ['active-warrior-bite', 'Warrior bite', () => bakedTexture('warrior_bite')],
  ['active-warrior-shear', 'Warrior shear', () => bakedTexture('warrior_shear')],
  ['active-warrior-crush', 'Warrior crush', () => bakedTexture('warrior_crush')],
];

function recipe(state: Preparation, cls: string): readonly PrewarmResumeUnit[] {
  if (cls !== 'warrior') return [];
  return [
    ...KIT_SHEETS.map(
      ([id, name, sheet]): PrewarmResumeUnit => ({
        id: `upload-big:${id}`,
        synchronous: true,
        run: () => {
          const texture = sheet();
          if (!texture) throw new Error(`${name} texture was not loaded`);
          state.host.texture(texture);
        },
      }),
    ),
    ...state.host.geometry(ACTIVE_WARRIOR_CRESTS),
  ].filter((unit) => !state.done.has(unit.id));
}

/** This optional manifest record owns a small local recipe. It does not spend
 * the loading deadline or enter the serial whole-catalogue resume chain.
 * Registration is unconditional, including a skipped constrained entry. */
export function activeKitPrewarmEntry(scene: object, cls: string, host: ActiveKitHost) {
  cancelActiveAbilityKit(scene);
  const state: Preparation = {
    scene,
    host,
    localClass: cls,
    task: null,
    done: new Set(),
    cancelled: false,
    context: 0,
    failures: 0,
    retry: null,
  };
  preparations.set(scene, state);
  registerContextRestoreReset('active-kit', state, invalidatePreparation);
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
  const task = (async () => {
    // The recipe enumerates units that need the kit's sheets resident, so it
    // is built only once the demand load has landed.
    if (state.host.assets && !(await state.host.assets())) return;
    if (state.cancelled) return;
    const context = state.context;
    for (const unit of recipe(state, selected)) {
      if (state.cancelled || state.context !== context) return;
      await state.host.queue.run(
        () => {
          if (!state.cancelled) return unit.run();
        },
        ACTIVE_KIT_PRIORITY,
        unit.id,
        {
          // Synchronous uploads/touches cannot add an asynchronous driver
          // tail, so unrelated links must not consume their admission slots.
          releaseTail: unit.synchronous !== true,
        },
      );
      if (state.cancelled || state.context !== context) return;
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
 * Errors stay observable by Studio; ordinary gameplay keeps its primary
 * fallback, and a failed preparation asks again on ACTIVE_KIT_RETRY_DELAYS_MS.
 * A request while a retry is pending joins that retry. */
export function resumeActiveAbilityKit(
  scene: object,
  afterFirstPaint?: Promise<unknown>,
  cls?: string,
): void {
  const state = preparations.get(scene);
  if (state?.retry) return;
  void Promise.resolve(afterFirstPaint)
    .then(() => ensureActiveAbilityKit(scene, cls))
    .catch((error) => {
      if (!state || state.cancelled || preparations.get(scene) !== state || state.retry) {
        console.warn('Active ability preparation failed', error);
        return;
      }
      const delay = ACTIVE_KIT_RETRY_DELAYS_MS[state.failures++];
      if (delay === undefined) {
        console.warn('Active ability preparation failed and gave up', error);
        return;
      }
      console.warn(`Active ability preparation failed, retrying in ${delay} ms`, error);
      state.retry = setTimeout(() => {
        state.retry = null;
        resumeActiveAbilityKit(scene, undefined, cls);
      }, delay);
    });
}

/** A WebGL context restore: every unit the recipe ran (sheet uploads,
 *  crest and guard links) belonged to the lost context. Forget them and run
 *  the recipe again once any run in flight has stopped; the prewarms
 *  themselves are reset by their own registrations (GuardPrewarm,
 *  CrestPrewarm), so `recipe()` offers their units again. */
function invalidatePreparation(state: Preparation): void {
  if (state.cancelled) return;
  state.context++;
  state.done.clear();
  if (state.retry) clearTimeout(state.retry);
  state.retry = null;
  state.failures = 0;
  const rerun = (): Promise<void> =>
    state.cancelled || state.task ? Promise.resolve() : ensureActiveAbilityKit(state.scene);
  void Promise.resolve(state.task)
    .then(rerun, rerun)
    .catch((error) => {
      console.warn('Active ability preparation failed after a context restore', error);
    });
}

export function cancelActiveAbilityKit(scene: object): void {
  const state = preparations.get(scene);
  if (state) {
    state.cancelled = true;
    if (state.retry) clearTimeout(state.retry);
    state.retry = null;
  }
  preparations.delete(scene);
}
