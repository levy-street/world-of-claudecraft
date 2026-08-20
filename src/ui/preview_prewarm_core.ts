// Post-entry preview prewarm schedule, the pure core. The boot path used to
// await the paperdoll/armory/portrait prewarms behind the loading screen
// (11 to 26 s of the measured entry on ultra online); they now run AFTER the
// world reveal, one bounded unit at a time, through the renderer's background
// GPU queue. This core owns the scheduling policy only: unit order, pausing
// while the owning window is open (the open window's own lazy path is already
// warming what the player is looking at), soft-fail continuation, and
// cancellation (graphics rebuild destroys the target contexts mid-schedule).
// The Hud composes it with real thunks; a Vitest drives it with fakes.
//
// The ARMORY catalog is deliberately NOT in this plan, and is warmed NOWHERE
// ahead of time: the store's card list needs none of it (measured, warming the
// whole armory moved a cold store open 530.9 ms to 522.8 ms, i.e. not at all),
// and the lazy per-card path builds exactly what one inspected card needs, on
// the click that opens it. A store-open warm was tried and removed because it
// measured worse.
//
// Measured, the warming was per-CONTEXT GPU program setup: about 2.1 to 2.6 s of
// live-frame hitches every online session paid whether or not the player ever
// opened the store, buying nothing but the store's own first inspect (GPU
// program caches do not cross a WebGL context). The cost was also POSITIONAL
// rather than per skin, so no gentler schedule was available.
//
// Full evidence, the refutations along the way, and the accepted unmeasured
// trade (the CPU caches the world renderer also reads):
// docs/design/armory-preview-warming.md.

/** Which owning surface a unit's pause key watches. One member, because one
 *  surface is planned: the armory family went with the catalog warming, and an
 *  unused member would only invite the schedule back. The pause mechanism
 *  itself stays keyed, so a second surface costs one member and no rewiring. */
export type PreviewPrewarmFamily = 'char';

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
/** Fixed spacing between units: the paperdoll and portrait caches being warm a
 *  few minutes after entry is fine (nobody is waiting on either); a hitch every
 *  frame is not. */
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
  /** True on the boot path, false on a graphics-rebuild restart. Excludes the
   *  char-window shell unit plus the per-skin and per-pose units that depend on
   *  it (they no-op via `this.charPreview?.` once built): at boot the shell
   *  already exists behind the loading curtain (`Hud.prewarmCharPreviewShell`),
   *  so those units are real work there; on a rebuild restart the destroying
   *  reset already dropped its own cover, so building the shell as a schedule
   *  unit would hitch a live frame, the exact class of stall the curtain
   *  exists to avoid. Portrait units stay in every plan (canvas-2D only, no
   *  dependence on the shell). */
  includeCharFamily: boolean;
  /** Warm the paperdoll skin (chroma) swatch variants. FALSE for a composed
   *  ("modular") local look: the char-sheet skin picker retired its numbered
   *  class chromas (Troy, 2026-08-06), and the per-skin `setSkin` warms the
   *  FIXED `player_<class>` atlas that a `player_<class>_modular` body never
   *  reads (no SKINS entry for the modular key), so the units are pure cost
   *  for no visible effect. TRUE for a legacy no-look / mech-catalog body,
   *  which still mounts the fixed rig those swatches drive. */
  warmCharSkins: boolean;
  /** Warm the shareable Player Card closeup poses. FALSE at login: the card is
   *  a rare, explicit share action (the char-sheet Share button, local player
   *  only) and `PlayerCardController` builds the closeup lazily on open via
   *  `captureCloseup`, so paying the biggest preview stall (a ~950 ms frame gap
   *  measured) on every entry for a window most players never open is waste. */
  includeCardPoses: boolean;
  /** Which portrait framings to warm at login. Login warms `['headshot']` only:
   *  headshots ride the unit/party/target frames unprompted (a healer clicks
   *  raid frames mid-combat), so they stay warm; the full-body `'body'` framing
   *  is only ever shown in the menu-gated Inspect window and is built lazily on
   *  open, so warming it at every entry is deferred cost for a rare surface. */
  portraitFramings: readonly ('headshot' | 'body')[];
  renderCharShell: () => void;
  prewarmCharSkin: (skin: number) => void | Promise<void>;
  prewarmCardPose: (pose: Pose) => void | Promise<void>;
  renderPortrait: (cls: string, skin: number, framing: 'headshot' | 'body') => void | Promise<void>;
}

/** Build the ordered post-entry preview prewarm plan: the paperdoll shell, the
 *  paperdoll skin swatches (only when `warmCharSkins`), the player-card poses
 *  (only when `includeCardPoses`), and the requested `portraitFramings` for
 *  every class. Login trims the set to what a player actually hits unprompted
 *  or cheaply: skins only for a fixed-rig look, no card poses, headshots only.
 *  The dropped surfaces (card closeup, full-body Inspect portrait) stay warmed
 *  by their own lazy on-open paths; see each flag's doc on
 *  `PreviewPrewarmPlanDeps`. NO Armory units: that catalog is not warmed ahead
 *  of time at all, it is built per inspected card (see the header). Each entry
 *  is one bounded GPU unit the renderer's background lane paces.
 *  `deps.includeCharFamily` gates the shell/skin/pose units together; the
 *  per-surface flags trim within it. */
export function buildPostEntryPreviewPrewarmUnits<Pose>(
  deps: PreviewPrewarmPlanDeps<Pose>,
): PreviewPrewarmUnit[] {
  const units: PreviewPrewarmUnit[] = [];
  if (deps.includeCharFamily) {
    units.push({ family: 'char', label: 'preview:char-window', run: deps.renderCharShell });
    if (deps.warmCharSkins) {
      const skins = deps.skinCount(`player_${deps.playerClass}`);
      for (let skin = 0; skin < skins; skin++) {
        units.push({
          family: 'char',
          label: `preview:char-skin:${skin}`,
          run: () => deps.prewarmCharSkin(skin),
        });
      }
    }
    if (deps.includeCardPoses) {
      for (const [index, pose] of deps.cardPoses.entries()) {
        units.push({
          family: 'char',
          label: `preview:card-pose:${index}`,
          run: () => deps.prewarmCardPose(pose),
        });
      }
    }
  }
  for (const portraitClass of deps.allClasses) {
    const portraitSkins = deps.skinCount(`player_${portraitClass}`);
    for (let skin = 0; skin < portraitSkins; skin++) {
      for (const framing of deps.portraitFramings) {
        units.push({
          family: 'char',
          label: `preview:portrait:${portraitClass}:${skin}:${framing}`,
          // Expression body ON PURPOSE: renderPortrait may return a promise
          // (the async prewarm path), and the paced lane awaits a unit's
          // return value. A block body would discard it and the schedule
          // would advance mid-render.
          run: () => deps.renderPortrait(portraitClass, skin, framing),
        });
      }
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
