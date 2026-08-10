// Post-entry preview prewarm schedule, the pure core. The boot path used to
// await the paperdoll/armory/portrait prewarms behind the loading screen
// (11 to 26 s of the measured entry on ultra online); they now run AFTER the
// world reveal, one bounded unit at a time, through the renderer's background
// GPU queue. This core owns the scheduling policy only: unit order, pausing
// while the owning window is open (the open window's own lazy path is already
// warming what the player is looking at), soft-fail continuation, and
// cancellation (graphics rebuild destroys the target contexts mid-schedule).
// The Hud composes it with real thunks; a Vitest drives it with fakes.

export type PreviewPrewarmFamily = 'char' | 'armory';

export interface PreviewPrewarmUnit {
  family: PreviewPrewarmFamily;
  label: string;
  run: () => void | Promise<void>;
}

export interface PreviewPrewarmDeps {
  /** Hand one unit to the paced GPU lane; resolves when the unit completed. */
  enqueue: (label: string, run: () => void | Promise<void>) => Promise<void>;
  /** True while the unit's owning window is open (schedule pauses, not skips). */
  isFamilyBusy: (family: PreviewPrewarmFamily) => boolean;
  /** False while the live frame has no headroom (the FPS governor is
   *  degrading): the schedule pauses rather than piling GPU work onto an
   *  already-struggling frame. Bounded by the starvation cap below, because
   *  ambient pressure (a crowded town at ultra) could otherwise stall the
   *  warmup forever and reintroduce the very first-open freeze it prevents. */
  hasHeadroom?: () => boolean;
  delay: (ms: number) => Promise<void>;
  onUnitError?: (label: string, err: unknown) => void;
}

export interface PreviewPrewarmHandle {
  cancel: () => void;
  /** Resolves when the schedule ran to the end or was cancelled. */
  done: Promise<void>;
}

export const PREVIEW_PREWARM_BUSY_POLL_MS = 2_000;
/** Fixed spacing between units: a warm catalog a few minutes after entry is
 *  fine (the store rarely opens that early); a hitch every frame is not. */
export const PREVIEW_PREWARM_UNIT_SPACING_MS = 750;
/** Max consecutive no-headroom polls before running the unit anyway. */
export const PREVIEW_PREWARM_HEADROOM_POLL_CAP = 15;

export interface PreviewPrewarmPlanDeps<Pose> {
  /** The local player's class id (their paperdoll skins warm first). */
  playerClass: string;
  /** Every class id, for the portrait caches (chips + Inspect). */
  allClasses: readonly string[];
  /** Skin count for a `player_<class>` unit id. */
  skinCount: (unitId: string) => number;
  /** Player-card closeup poses, opaque to the plan. */
  cardPoses: readonly Pose[];
  /** Armory catalog skin ids to warm, in catalog order. */
  armorySkinIds: readonly string[];
  /** True on the boot path, false on a graphics-rebuild restart. Excludes the
   *  char-window shell unit plus the per-skin and per-pose units that depend on
   *  it (they no-op via `this.charPreview?.` once built): at boot the shell
   *  already exists behind the loading curtain (`Hud.prewarmCharPreviewShell`),
   *  so those units are real work there; on a rebuild restart the destroying
   *  reset already dropped its own cover, so building the shell as a schedule
   *  unit would hitch a live frame, the exact class of stall the curtain
   *  exists to avoid. Portrait units stay in every plan (canvas-2D only, no
   *  dependence on the shell); so do armory units (its own prewarm path
   *  lazily rebuilds its stage). */
  includeCharFamily: boolean;
  renderCharShell: () => void;
  prewarmCharSkin: (skin: number) => void | Promise<void>;
  prewarmCardPose: (pose: Pose) => void | Promise<void>;
  renderPortrait: (cls: string, skin: number, framing: 'headshot' | 'body') => void;
  prewarmArmorySkin: (skinId: string, mode: 'character' | 'weapon') => void | Promise<void>;
}

/** Build the ordered post-entry preview prewarm plan: the shared paperdoll
 *  preview per skin, the player-card poses, both portrait framings for every
 *  class (chips use headshots while Inspect uses a full-body portrait, so
 *  warming only the former still leaves a synchronous WebGL readback + PNG
 *  encode on the first inspected player), then every Armory catalog skin,
 *  one MODE per unit (a whole-skin warmup measured 170 to 225 ms of
 *  main-thread block during live play; per-mode units roughly halve it).
 *  Each entry is one bounded GPU unit the renderer's background lane paces.
 *  `deps.includeCharFamily` gates the shell/skin/pose units only; see its doc
 *  on `PreviewPrewarmPlanDeps`. */
export function buildPostEntryPreviewPrewarmUnits<Pose>(
  deps: PreviewPrewarmPlanDeps<Pose>,
): PreviewPrewarmUnit[] {
  const units: PreviewPrewarmUnit[] = [];
  if (deps.includeCharFamily) {
    units.push({ family: 'char', label: 'preview:char-window', run: deps.renderCharShell });
    const skins = deps.skinCount(`player_${deps.playerClass}`);
    for (let skin = 0; skin < skins; skin++) {
      units.push({
        family: 'char',
        label: `preview:char-skin:${skin}`,
        run: () => deps.prewarmCharSkin(skin),
      });
    }
    for (const [index, pose] of deps.cardPoses.entries()) {
      units.push({
        family: 'char',
        label: `preview:card-pose:${index}`,
        run: () => deps.prewarmCardPose(pose),
      });
    }
  }
  for (const portraitClass of deps.allClasses) {
    const portraitSkins = deps.skinCount(`player_${portraitClass}`);
    for (let skin = 0; skin < portraitSkins; skin++) {
      for (const framing of ['headshot', 'body'] as const) {
        units.push({
          family: 'char',
          label: `preview:portrait:${portraitClass}:${skin}:${framing}`,
          run: () => {
            deps.renderPortrait(portraitClass, skin, framing);
          },
        });
      }
    }
  }
  for (const skinId of deps.armorySkinIds) {
    for (const armoryMode of ['character', 'weapon'] as const) {
      units.push({
        family: 'armory',
        label: `preview:armory:${skinId}:${armoryMode}`,
        run: () => deps.prewarmArmorySkin(skinId, armoryMode),
      });
    }
  }
  return units;
}

export function runPreviewPrewarmSchedule(
  units: readonly PreviewPrewarmUnit[],
  deps: PreviewPrewarmDeps,
): PreviewPrewarmHandle {
  let cancelled = false;
  const done = (async () => {
    for (const unit of units) {
      // The busy pause and the headroom pause bound two different waits (an
      // open window vs. frame pressure), and the headroom pause can itself
      // run long enough for the player to open the window this unit is about
      // to warm. Recheck busy after every headroom wait and loop back to the
      // busy pause instead of firing at a window the player just opened.
      for (;;) {
        while (!cancelled && deps.isFamilyBusy(unit.family)) {
          await deps.delay(PREVIEW_PREWARM_BUSY_POLL_MS);
        }
        if (cancelled) return;
        let headroomPolls = 0;
        while (
          !cancelled &&
          deps.hasHeadroom &&
          !deps.hasHeadroom() &&
          headroomPolls < PREVIEW_PREWARM_HEADROOM_POLL_CAP
        ) {
          headroomPolls++;
          await deps.delay(PREVIEW_PREWARM_BUSY_POLL_MS);
        }
        if (cancelled) return;
        if (!deps.isFamilyBusy(unit.family)) break;
      }
      try {
        await deps.enqueue(unit.label, unit.run);
      } catch (err) {
        // One failed unit (context loss, renderer shutdown race) must never
        // halt the remaining warmups; the lazy first-open path still covers
        // whatever stays cold.
        deps.onUnitError?.(unit.label, err);
      }
      if (cancelled) return;
      await deps.delay(PREVIEW_PREWARM_UNIT_SPACING_MS);
    }
  })();
  return {
    cancel: () => {
      cancelled = true;
    },
    done,
  };
}
