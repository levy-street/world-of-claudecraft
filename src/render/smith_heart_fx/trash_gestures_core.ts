// PURE (RENDER_PURE_CORES): which of the Smith's Heart's own trash and add bodies
// (smith_heart_trash_looks.ts) a fight cue moves. Two kinds:
//
//   A rise     a cue at a spot (spellfxAt) that brings bodies up out of the floor:
//              a Splinter climbing out of its quarter, a Wellspawn or a Wellkeeper
//              out of the Hearth's rim, a Seedflame cracking out of its seed, an
//              isle's Sentinel and Mender rising onto their isle. The body was
//              added on the same tick, often a frame or two before the renderer
//              builds it, so the rise stays on offer near the spot for a short
//              window and every body of the cue's templates in reach plays its
//              entrance the first frame it exists (CharacterVisual.playEntrance
//              plays once per entity, so the repeats are no-ops).
//   A gesture  a cue the body itself sends (spellfx with it as the source) that its
//              fight's effects claim, so the renderer's own beam and nova paths
//              never reach the body: the Wellkeeper's Kindling Mark (its throw),
//              the Heat Splinter marking a coal (its throw), and the Splinters'
//              Shearing Blow and Rime Toll landing (a flare of their glow).
//
// Every gesture named here is one the looks map (attackByAbility, a glow pulse or
// the entrance), never an unknown id: an unknown one would fall through to a plain
// swing. Looks only: nothing here reads or changes what the fight does.

import { ISLE_CUES, ISLE_MOBS } from '../../sim/encounters/smith_heart/breath_isle_ids';
import { FINAL_ADD_MOBS, FINAL_PHASE_CUES } from '../../sim/encounters/smith_heart/final_phase_ids';
import { HEAT_CUES, HEAT_MOBS } from '../../sim/encounters/smith_heart/heat_ids';

/** The entrance gesture every rising body answers (VisualDef.entranceGesture). */
export const SMITH_HEART_TRASH_RISE = 'smith_heart_trash_rise';

/** How long a rise stays on offer, in seconds: long enough for a body that waits
 *  on its file to build, short enough that a body first seen later never climbs
 *  out of a floor it has been standing on. */
export const TRASH_RISE_WINDOW_SECONDS = 1.5;

/** Yards past the cue's own radius a rising body may stand (a spawn spot is the
 *  cue's centre; the encounter may nudge a body onto the ground beside it). */
export const TRASH_RISE_SLACK = 1.5;

const SPLINTERS = Object.values(FINAL_ADD_MOBS);

/** The rise cues, each with the templates it brings up. */
export const TRASH_RISE_CUES: Readonly<Record<string, readonly string[]>> = {
  [FINAL_PHASE_CUES.rise]: SPLINTERS,
  [HEAT_CUES.spawn]: [HEAT_MOBS.spawn, HEAT_MOBS.keeper],
  [HEAT_CUES.hatch]: [HEAT_MOBS.seedflame],
  [ISLE_CUES.isleWake]: [ISLE_MOBS.sentinel, ISLE_MOBS.mender],
};

/** The gestures a body sends through its own claimed cue: cue id, the templates
 *  that answer it, the gesture they play. */
export const TRASH_SOURCE_GESTURES: Readonly<
  Record<string, { readonly templates: readonly string[]; readonly gesture: string }>
> = {
  [HEAT_CUES.kindling]: { templates: [HEAT_MOBS.keeper], gesture: HEAT_CUES.kindling },
  [FINAL_PHASE_CUES.coal]: { templates: [FINAL_ADD_MOBS.heat], gesture: FINAL_PHASE_CUES.coal },
  [FINAL_PHASE_CUES.shear]: { templates: SPLINTERS, gesture: FINAL_PHASE_CUES.shear },
  [FINAL_PHASE_CUES.toll]: { templates: [FINAL_ADD_MOBS.quench], gesture: FINAL_PHASE_CUES.toll },
};

/** One open rise: where, how far, which templates, until when (the host's clock). */
export interface TrashRiseOffer {
  readonly x: number;
  readonly z: number;
  readonly reach: number;
  readonly templates: readonly string[];
  readonly until: number;
}

/** The slice of a SimEvent this core reads. */
export interface TrashCueEvent {
  readonly type: string;
  readonly ability?: string | null;
  readonly x?: number;
  readonly z?: number;
  readonly radius?: number;
}

/** The rise a cue opens at `now`, or null when the event is not a rise. */
export function trashRiseOffer(ev: TrashCueEvent, now: number): TrashRiseOffer | null {
  if (ev.type !== 'spellfxAt' || !ev.ability) return null;
  const templates = TRASH_RISE_CUES[ev.ability];
  if (!templates || ev.x === undefined || ev.z === undefined) return null;
  return {
    x: ev.x,
    z: ev.z,
    reach: (ev.radius ?? 0) + TRASH_RISE_SLACK,
    templates,
    until: now + TRASH_RISE_WINDOW_SECONDS,
  };
}

/** Whether a living body of `templateId` standing at (x, z) answers `offer`. */
export function trashRiseMatches(
  offer: TrashRiseOffer,
  templateId: string,
  x: number,
  z: number,
): boolean {
  if (!offer.templates.includes(templateId)) return false;
  return Math.hypot(x - offer.x, z - offer.z) <= offer.reach;
}

/** The gesture a body of `templateId` plays for a cue it sent (spellfx with it as
 *  the source), or null. */
export function trashSourceGesture(
  ev: TrashCueEvent,
  templateId: string | undefined,
): string | null {
  if (ev.type !== 'spellfx' || !ev.ability || templateId === undefined) return null;
  const row = TRASH_SOURCE_GESTURES[ev.ability];
  return row?.templates.includes(templateId) ? row.gesture : null;
}
