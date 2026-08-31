// Forge portal telegraphs are one-shot spellfxAt events, so a socket resumed
// from linkdead missed any that fired while it was down. The GameServer arms
// needsVarkhulPortalReplay on resume and disarms it when a live portal event
// reaches the viewer through the events router; this module owns the rest:
// the once-per-broadcast batch (the portal readout is taken, and serialized,
// only while some resumed session still owes a replay) and the per-viewer
// replay frame sent right after that session's first full snapshot.

import { dist2d, type SimEvent, type Vec3 } from '../src/sim/types';
import { type EventAnchorEntities, eventAnchor } from './event_delivery';
import { assembleEventsFrame, serializeEventFragments } from './event_frame';

export interface VarkhulPortalReplayBatch {
  events: readonly SimEvent[];
  fragments: readonly string[];
  eventRadius: number;
}

const NO_REPLAY_EVENTS: readonly SimEvent[] = [];

// Serialize the active portal telegraphs at most once per broadcast pass, and
// only when at least one resumed session still needs its replay. The readout
// is taken through a thunk so the sim getter (which allocates its array on
// every read) is not touched on the common no-replay pass.
export function buildVarkhulPortalReplayBatch(
  sessions: Iterable<{ needsVarkhulPortalReplay: boolean }>,
  activeTelegraphs: () => readonly SimEvent[],
  eventRadius: number,
): VarkhulPortalReplayBatch {
  let varkhulPortalReplayNeeded = false;
  for (const session of sessions) {
    if (session.needsVarkhulPortalReplay) {
      varkhulPortalReplayNeeded = true;
      break;
    }
  }
  const events = varkhulPortalReplayNeeded ? activeTelegraphs() : NO_REPLAY_EVENTS;
  return { events, fragments: serializeEventFragments(events), eventRadius };
}

// The events frame replaying every portal telegraph in range of one resumed
// viewer (anchorless events always ride along), or null when none qualifies.
export function varkhulPortalReplayFrame(
  batch: VarkhulPortalReplayBatch,
  anchorPos: Vec3,
  entities: EventAnchorEntities,
): string | null {
  const portalReplay: string[] = [];
  for (let index = 0; index < batch.events.length; index++) {
    const event = batch.events[index];
    const anchor = eventAnchor(event, entities);
    if (anchor && dist2d(anchorPos, anchor) > batch.eventRadius) continue;
    const fragment = batch.fragments[index];
    if (fragment !== undefined) portalReplay.push(fragment);
  }
  if (portalReplay.length === 0) return null;
  return assembleEventsFrame(portalReplay);
}
