// Per-entity gesture triggers the renderer derives from state every client
// already has, so neither needs wire traffic of its own:
//
//  - the overhead-emote one-shot: a player's emote id plus its sequence number
//    is an edge, and the rig plays the emote clip once per edge;
//  - the follower hop: a cosmetic buddy jumps when its owner does. The owner's
//    displayed airborne flag and height are already on the owner's view, so
//    every client can read a hop off them with nothing sent. The renderer
//    derives that flag three ways (the live sim bit offline, the predictor's
//    for the online local player, a foot-height heuristic for remote players),
//    so a remote viewer sees the hop a beat later than the owner does. It is
//    presentation only: the sim never moves a buddy vertically, the Jump clip
//    carries its own arc.
//
// No Three, no DOM, no i18n, no clock, no randomness, and no state of its own:
// the hop's memory lives on the follower's view (GestureView.hopTrack), which
// the renderer owns. The renderer hands in its per-entity view and the active
// rig; this module decides and calls. Registered in RENDER_PURE_CORES
// (tests/architecture.test.ts).
import { BUDDY_TEMPLATE_IDS } from '../sim/content/buddy_mobs';
import type { Entity } from '../sim/types';
import type { OverheadEmoteId } from '../world_api';
import type { AnimState } from './characters/anim_state';

/** The slice of the renderer's per-entity view this module keeps state on. */
export interface GestureView {
  /** `${emoteId}:${seq}` of the emote this view last played, or null. */
  lastOverheadEmoteKey: string | null;
  /** A follower's read of its owner between frames. Created here on the
   *  follower's first frame, so it is born and dies with the view. */
  hopTrack?: FollowerHopTrack;
}

/** What a follower reads off its OWNER's view. */
export interface GestureOwnerView {
  /** The owner's displayed airborne flag as of its latest update. */
  wasAirborne: boolean;
  /** The owner's displayed height as of its latest update, BEFORE the
   *  renderer's step smoothing: that smoothing lags a body on any slope and
   *  drains after take-off, which reads as a rise after an uphill run and a
   *  drop after a downhill one. */
  prevRenderY: number;
}

/** The rig calls this module makes; CharacterVisual satisfies it structurally. */
export interface GestureRig {
  playEmote(id: OverheadEmoteId): void;
  playHop(moving: boolean): void;
}

/** How far an owner must RISE, in yards, above where it was on its first
 *  airborne frame before the follower commits to a hop, and how far it may
 *  drop below it before the follower rules a hop out. A jump climbs past a
 *  yard, so it clears this within a tick or two; a step off a ledge only ever
 *  goes the other way. */
export const FOLLOWER_HOP_RISE = 0.2;

/** One follower's read of its owner between frames. */
export interface FollowerHopTrack {
  /** the owner was airborne on the previous step */
  airborne: boolean;
  /** the owner's height on the first airborne frame of this flight */
  takeoffY: number;
  /** the owner left the ground and has not yet shown which way it is going */
  pending: boolean;
}

/** A track for a follower first seen now. An owner already in the air is not
 *  a jump the follower witnessed, so it starts with nothing pending. */
export function newFollowerHopTrack(ownerAirborne: boolean, ownerY: number): FollowerHopTrack {
  return { airborne: ownerAirborne, takeoffY: ownerY, pending: false };
}

/**
 * Advance one follower's read of its owner. True on the single frame the
 * follower should hop.
 *
 * The airborne edge alone is not a jump: walking off a ledge raises it too. So
 * the edge only ARMS the hop, and it fires once the owner has actually climbed
 * above the height it had on its FIRST AIRBORNE frame. An owner that drops
 * below that height instead disarms it.
 *
 * The reference is the first airborne frame, never the last grounded one. The
 * two are a render frame apart, and on a slope the ground the owner ran over
 * in that frame is itself a rise or a drop: measured from the last grounded
 * frame, running uphill off a ledge read as a jump, and a jump taken running
 * downhill read as a fall and was thrown away.
 */
export function stepFollowerHop(
  t: FollowerHopTrack,
  ownerAirborne: boolean,
  ownerY: number,
): boolean {
  if (!ownerAirborne) {
    t.airborne = false;
    t.pending = false;
    return false;
  }
  if (!t.airborne) {
    t.airborne = true;
    t.pending = true;
    t.takeoffY = ownerY;
    return false;
  }
  if (!t.pending) return false;
  const rise = ownerY - t.takeoffY;
  if (rise >= FOLLOWER_HOP_RISE) {
    t.pending = false;
    return true;
  }
  if (rise <= -FOLLOWER_HOP_RISE) t.pending = false;
  return false;
}

/**
 * One entity, one frame: fire whichever gesture its state calls for.
 * `views` is the renderer's whole view table, read only to find a follower's
 * owner; an owner outside the table (out of interest) simply never triggers.
 * `presenting` is whether this rig's state machine and mixer run this frame.
 */
export function tickEntityGestures(
  v: GestureView,
  e: Entity,
  st: AnimState,
  moving: boolean,
  rig: GestureRig,
  views: ReadonlyMap<number, GestureOwnerView>,
  presenting: boolean,
): void {
  const emoteId = e.kind === 'player' && e.overheadEmoteId && !e.dead ? e.overheadEmoteId : null;
  const emoteKey = emoteId ? `${emoteId}:${e.overheadEmoteSeq}` : null;
  if (emoteKey !== v.lastOverheadEmoteKey) {
    const canPlayEmote =
      emoteId && !moving && !st.airborne && !st.swimming && !st.casting && !st.sitting;
    if (canPlayEmote) {
      rig.playEmote(emoteId);
      v.lastOverheadEmoteKey = emoteKey;
    } else if (!emoteId) {
      v.lastOverheadEmoteKey = null;
    }
  }

  if (e.kind !== 'mob' || e.ownerId === null || !BUDDY_TEMPLATE_IDS.has(e.templateId)) return;
  const owner = views.get(e.ownerId);
  if (!owner) return;
  const ownerY = owner.prevRenderY;
  let track = v.hopTrack;
  if (!track) {
    track = newFollowerHopTrack(owner.wasAirborne, ownerY);
    v.hopTrack = track;
  }
  // The track advances every frame, so a jump the buddy sat out (mid-search,
  // swimming, dead, or out of the camera's view) is spent rather than
  // replayed the moment it is free. Out of view matters as much as the rest:
  // a rig that is not presenting runs no state machine, so a hop started
  // there would sit latched and play the next time the camera found it.
  const hop = stepFollowerHop(track, owner.wasAirborne, ownerY);
  if (hop && presenting && !st.dead && !st.casting && !st.swimming) rig.playHop(moving);
}
