import type * as THREE from 'three';
import { bitmapSheetReleased, restoreBitmapSheet } from '../assets/bitmap_sheet_release';
import { type BackgroundGpuQueue, GPU_WORK_PRIORITY } from '../background_gpu_queue';
import { registerContextRestoreReset } from '../context_restore_registry';
import type { PrewarmManifestEntry } from '../prewarm_entry';
import type { PrewarmResumeUnit } from '../prewarm_resume';
import { contactTexture } from './contact_assets';
import {
  ensurePaladinSpecIcons,
  markPaladinSpecIconsCold,
  markPaladinSpecIconsUploaded,
  paladinSpecIconsTexture,
} from './paladin_spec_icons';
import {
  bakedTexture,
  PALADIN_BORROWED_PIECES,
  type WarriorKitPiece,
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
  /** Start (or join) the Warrior kit's demand-loaded assets before any unit
   *  runs: the whole kit, or with `pieces` only those (the Paladin recipe asks
   *  for PALADIN_BORROWED_PIECES). False means the device declined them, so
   *  the pieces stay cold and no unit needing them runs. Absent in tests that
   *  inject textures directly. */
  assets?(pieces?: readonly WarriorKitPiece[]): Promise<boolean>;
  /** The Paladin kit's demand load (its spec-icon atlas). Defaults to
   *  `ensurePaladinSpecIcons`; tests inject their own. */
  paladinAssets?(): Promise<boolean>;
  /** The authored preparation units: the Warrior crests for `kinds`, or with
   *  `kit` one part of the Paladin recipe (`kinds` ignored): 'paladin-stand-ins'
   *  (the renderer-owned visuals), 'paladin-borrowed' (the Warrior pieces its
   *  landings borrow) or 'paladin' (the kit's own pools). */
  geometry(kinds: readonly CrestKind[], kit?: string): readonly PrewarmResumeUnit[];
  texture(texture: THREE.Texture): void;
}
interface Preparation {
  scene: object;
  host: ActiveKitHost;
  /** The local player's class: the kit this entry's progress reports. */
  localClass: string;
  /** Every kit asked for on this renderer (the local one and each remote
   *  sighting), all prepared again after a context restore. */
  requested: Set<string>;
  /** Each kit's full unit-id list, kept so a progress poll never rebuilds the
   *  recipe (and its closures); refreshed when a run builds the recipe. */
  planned: Map<string, readonly string[]>;
  task: Promise<void> | null;
  /** The kit the running task prepares. */
  taskKit: string | null;
  done: Set<string>;
  cancelled: boolean;
  /** Bumped by a context restore: a unit that finished for an older context
   *  is not recorded as done for this one. */
  context: number;
  /** Failed attempts per kit, each spending its own bounded backoff. */
  failures: Map<string, number>;
  /** The pending retry per kit: a Warrior kit in backoff never swallows a
   *  Paladin sighting (the painter asks once per class), nor the reverse. */
  retry: Map<string, ReturnType<typeof setTimeout>>;
  /** The borrowed Warrior pieces' demand load for the Paladin recipe, as of
   *  its last run: 'cold' before any, 'declined' on a constrained device. */
  borrowed: 'cold' | 'ready' | 'declined' | 'failed';
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

/** The Paladin atlas upload: its own paced unit, like each Warrior sheet. It
 *  runs after the kit's pools, so an atlas that failed to load fails only this
 *  unit (the backoff asks again) while the pools are already prepared and the
 *  binders draw their built-in emblems meanwhile. */
const PALADIN_SPEC_ICONS_UNIT = 'upload-big:paladin-spec-icons';

function paladinIconUnit(state: Preparation): PrewarmResumeUnit {
  return {
    id: PALADIN_SPEC_ICONS_UNIT,
    synchronous: true,
    run: () => {
      const texture = paladinSpecIconsTexture();
      if (!texture) throw new Error('Paladin spec icons texture was not loaded');
      state.host.texture(texture);
      markPaladinSpecIconsUploaded();
    },
  };
}

/** The Warrior sheets a Paladin landing borrows, uploaded by the SAME units the
 *  Warrior recipe runs (one id each, so the shared done record pays neither
 *  kit twice): the shout dust and smoke layers, and the rock map Valkyr's
 *  Calling's slabs sample. */
const PALADIN_BORROWED_SHEETS = new Set([
  'active-shout-dust',
  'active-smoke',
  'active-warrior-rock',
]);

/** A sheet upload, plus the decode it needs first when an earlier renderer's
 *  upload released the sheet's image. The decode lives HERE, with the upload
 *  that follows it, and never in the page-wide demand load: a sheet this
 *  renderer already uploaded (its unit done, whichever kit ran it) is never
 *  decoded again, so it is never left dirty with no upload scheduled. */
interface SheetUnit extends PrewarmResumeUnit {
  /** The re-decode, or null when the sheet holds its image (no wait at all). */
  restore(): Promise<void> | null;
}

function sheetUnit(state: Preparation, [id, name, sheet]: (typeof KIT_SHEETS)[number]): SheetUnit {
  return {
    id: `upload-big:${id}`,
    synchronous: true,
    restore: () => {
      const texture = sheet();
      return texture && bitmapSheetReleased(texture) ? restoreBitmapSheet(texture) : null;
    },
    run: () => {
      const texture = sheet();
      if (!texture) throw new Error(`${name} texture was not loaded`);
      state.host.texture(texture);
    },
  };
}

/** The Paladin recipe: the stand-ins first, then the borrowed Warrior pieces
 *  (their sheets, then their slots, fragments and crest) once their demand
 *  load landed, then the kit's own pools, then the spec-icon atlas. A device
 *  that declined the pieces, or a load that failed, runs the rest without
 *  them. */
function paladinRecipe(state: Preparation): readonly PrewarmResumeUnit[] {
  const borrowed =
    state.borrowed === 'ready'
      ? [
          ...KIT_SHEETS.filter(([id]) => PALADIN_BORROWED_SHEETS.has(id)).map((entry) =>
            sheetUnit(state, entry),
          ),
          ...state.host.geometry([], 'paladin-borrowed'),
        ]
      : [];
  return [
    ...state.host.geometry([], 'paladin-stand-ins'),
    ...borrowed,
    ...state.host.geometry([], 'paladin'),
    paladinIconUnit(state),
  ];
}

/** Every unit of a kit's recipe, done or not. */
function fullRecipe(state: Preparation, cls: string): readonly PrewarmResumeUnit[] {
  let units: readonly PrewarmResumeUnit[];
  if (cls === 'paladin') units = paladinRecipe(state);
  else if (cls === 'warrior') units = warriorRecipe(state);
  else units = [];
  state.planned.set(
    cls,
    units.map((unit) => unit.id),
  );
  return units;
}

function plannedIds(state: Preparation, cls: string): readonly string[] {
  return state.planned.get(cls) ?? fullRecipe(state, cls).map((unit) => unit.id);
}

function recipe(state: Preparation, cls: string): readonly PrewarmResumeUnit[] {
  return fullRecipe(state, cls).filter((unit) => !state.done.has(unit.id));
}

function warriorRecipe(state: Preparation): readonly PrewarmResumeUnit[] {
  return [
    ...KIT_SHEETS.map((entry) => sheetUnit(state, entry)),
    ...state.host.geometry(ACTIVE_WARRIOR_CRESTS),
  ];
}

/** This optional manifest record owns a small local recipe. It does not spend
 * the loading deadline or enter the serial whole-catalogue resume chain.
 * Registration is unconditional, including a skipped constrained entry. */
export function activeKitPrewarmEntry(scene: object, cls: string, host: ActiveKitHost) {
  cancelActiveAbilityKit(scene);
  // A new renderer holds none of the previous one's uploads.
  markPaladinSpecIconsCold();
  const state: Preparation = {
    scene,
    host,
    localClass: cls,
    requested: new Set(),
    planned: new Map(),
    task: null,
    taskKit: null,
    done: new Set(),
    cancelled: false,
    context: 0,
    failures: new Map(),
    retry: new Map(),
    borrowed: 'cold',
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
      const ids = plannedIds(state, state.localClass);
      let done = 0;
      for (const id of ids) if (state.done.has(id)) done++;
      return { done, planned: ids.length, trimmed: done < ids.length };
    },
  } satisfies PrewarmManifestEntry;
}

/** Prepares `cls`'s kit (the local class when omitted): the local player's
 * own, or a remote one the painter sighted. No visible spawns, catalogue
 * traversal or on-cast uploads occur here. */
export function ensureActiveAbilityKit(scene: object, cls?: string): Promise<void> {
  const state = preparations.get(scene);
  if (!state || state.cancelled) return Promise.resolve();
  const selected = cls ?? state.localClass;
  if (selected !== 'warrior' && selected !== 'paladin') return Promise.resolve();
  state.requested.add(selected);
  // A request for the other kit while one runs waits for it, then prepares
  // its own units (the recipe skips every unit already done).
  // A request for the kit already running joins that run (and its outcome).
  // A request for the other kit waits for it and then runs whichever way it
  // ended: the other kit's failure is its own, retried on its own backoff.
  if (state.task) {
    if (state.taskKit === selected) return state.task;
    const again = () => ensureActiveAbilityKit(scene, selected);
    return state.task.then(again, again);
  }
  const task = (async () => {
    // The recipe enumerates units that need the kit's sheets resident, so it
    // is built only once the demand load has landed. The Warrior's declined
    // load leaves the whole kit cold; the Paladin's only leaves its atlas
    // unit unpaid (it fails, and the backoff asks again).
    if (selected === 'warrior' && state.host.assets && !(await state.host.assets())) return;
    if (selected === 'paladin') {
      await (state.host.paladinAssets ?? ensurePaladinSpecIcons)().catch(() => false);
      // Only the Warrior pieces its landings borrow, never the whole kit. A
      // decline (constrained memory, the Warrior kit's own device policy)
      // leaves them cold for good; a failed load runs the rest of the recipe
      // and fails the run below, so this kit's backoff asks for them again.
      const load = state.host.assets?.(PALADIN_BORROWED_PIECES) ?? Promise.resolve(true);
      state.borrowed = await load.then(
        (resident) => (resident ? 'ready' : 'declined'),
        () => 'failed' as const,
      );
    }
    if (state.cancelled) return;
    const context = state.context;
    for (const unit of recipe(state, selected)) {
      if (state.cancelled || state.context !== context) return;
      // A released sheet decodes off the main thread before its paced upload.
      const restoring = 'restore' in unit ? (unit as SheetUnit).restore() : null;
      if (restoring) {
        await restoring;
        if (state.cancelled || state.context !== context) return;
      }
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
    if (selected === 'paladin' && state.borrowed === 'failed')
      throw new Error('The Warrior pieces the Paladin landings borrow did not load');
  })();
  state.task = task;
  state.taskKit = selected;
  const release = () => {
    if (state.task !== task) return;
    state.task = null;
    state.taskKit = null;
  };
  void task.then(release, release);
  return task;
}

/** Start after the manifest, independently of unrelated retained world work.
 * Errors stay observable by Studio; ordinary gameplay keeps its primary
 * fallback, and a failed preparation asks again on ACTIVE_KIT_RETRY_DELAYS_MS.
 * Each kit keeps its own backoff: a request while THAT kit's retry is pending
 * joins the retry, while a request for the other kit runs at once. */
export function resumeActiveAbilityKit(
  scene: object,
  afterFirstPaint?: Promise<unknown>,
  cls?: string,
): void {
  const state = preparations.get(scene);
  const kit = cls ?? state?.localClass;
  if (state && kit !== undefined && state.retry.has(kit)) return;
  void Promise.resolve(afterFirstPaint)
    .then(() => ensureActiveAbilityKit(scene, cls))
    .catch((error) => {
      if (
        !state ||
        kit === undefined ||
        state.cancelled ||
        preparations.get(scene) !== state ||
        state.retry.has(kit)
      ) {
        console.warn('Active ability preparation failed', error);
        return;
      }
      const failures = state.failures.get(kit) ?? 0;
      state.failures.set(kit, failures + 1);
      const delay = ACTIVE_KIT_RETRY_DELAYS_MS[failures];
      if (delay === undefined) {
        console.warn('Active ability preparation failed and gave up', error);
        return;
      }
      console.warn(`Active ability preparation failed, retrying in ${delay} ms`, error);
      state.retry.set(
        kit,
        setTimeout(() => {
          state.retry.delete(kit);
          resumeActiveAbilityKit(scene, undefined, cls);
        }, delay),
      );
    });
}

/** A WebGL context restore: every unit the recipe ran (sheet uploads, the
 *  Paladin atlas, crest and guard links) belonged to the lost context. Forget
 *  them and run every requested kit's recipe again once any run in flight has
 *  stopped; the prewarms themselves are reset by their own registrations
 *  (GuardPrewarm, CrestPrewarm), so `recipe()` offers their units again. */
function invalidatePreparation(state: Preparation): void {
  if (state.cancelled) return;
  state.context++;
  state.done.clear();
  markPaladinSpecIconsCold();
  for (const timer of state.retry.values()) clearTimeout(timer);
  state.retry.clear();
  state.failures.clear();
  const rerun = async (): Promise<void> => {
    if (state.cancelled || state.task) return;
    const kits = new Set([state.localClass, ...state.requested]);
    await Promise.all([...kits].map((cls) => ensureActiveAbilityKit(state.scene, cls)));
  };
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
    for (const timer of state.retry.values()) clearTimeout(timer);
    state.retry.clear();
  }
  preparations.delete(scene);
}
