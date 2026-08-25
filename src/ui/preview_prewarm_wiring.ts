// Composes the pure post-entry preview prewarm plan
// (buildPostEntryPreviewPrewarmUnits, preview_prewarm_core.ts) with the
// stateless halves that need no Hud state: the class roster, the per-class
// skin counts, and the async portrait prewarm. The Hud supplies only the
// thunks that reach its own windows and previews, so the composition stays
// out of the hud.ts coordinator (the monolith ratchet).
import { skinCount } from '../render/characters/manifest';
import { prewarmPlayerPortrait } from '../render/characters/portrait';
import { ALL_CLASSES, type PlayerClass } from '../sim/types';
import { buildPostEntryPreviewPrewarmUnits, type PreviewPrewarmUnit } from './preview_prewarm_core';

export interface HudPreviewPrewarmDeps<Pose> {
  playerClass: PlayerClass;
  cardPoses: readonly Pose[];
  /** Forwarded verbatim; see its doc on `PreviewPrewarmPlanDeps`. */
  includeCharFamily: boolean;
  /** Forwarded verbatim; see its doc on `PreviewPrewarmPlanDeps`. */
  warmCharSkins: boolean;
  /** Forwarded verbatim; see its doc on `PreviewPrewarmPlanDeps`. */
  includeCardPoses: boolean;
  /** Forwarded verbatim; see its doc on `PreviewPrewarmPlanDeps`. */
  portraitFramings: readonly ('headshot' | 'body')[];
  renderCharShell: () => void;
  prewarmCharSkin: (skin: number) => void | Promise<void>;
  prewarmCardPose: (pose: Pose) => void | Promise<void>;
}

/** The ordered post-entry preview prewarm plan, composed for the Hud. */
export function buildHudPreviewPrewarmUnits<Pose>(
  deps: HudPreviewPrewarmDeps<Pose>,
): PreviewPrewarmUnit[] {
  return buildPostEntryPreviewPrewarmUnits<Pose>({
    playerClass: deps.playerClass,
    allClasses: ALL_CLASSES,
    skinCount,
    cardPoses: deps.cardPoses,
    includeCharFamily: deps.includeCharFamily,
    warmCharSkins: deps.warmCharSkins,
    includeCardPoses: deps.includeCardPoses,
    portraitFramings: deps.portraitFramings,
    renderCharShell: deps.renderCharShell,
    prewarmCharSkin: deps.prewarmCharSkin,
    prewarmCardPose: deps.prewarmCardPose,
    // The prewarm variant, not the sync playerPortraitDataUrl: uploads are
    // prepaid in bounded slices and the PNG encode runs off-thread, so the
    // paced unit never books the 43 to 201 ms cold-capture block.
    renderPortrait: (portraitClass, skin, framing) =>
      prewarmPlayerPortrait(portraitClass as PlayerClass, skin, framing),
  });
}
