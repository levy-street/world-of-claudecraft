import type { SimEvent } from '../src/sim/types';

// Serialize-once assembly for the events fan-out. routeEvents sends a near-identical
// { t: 'events', time, list: [...] } frame to every recipient session, but the underlying
// SimEvent objects are shared and, apart from the once-per-batch sender-flair stamp
// applied before this runs, identical for every recipient. Stringifying the frame per
// session was therefore O(sessions x events) serialization where O(events) plus
// O(sessions x selected-fragments) string joins do the same work. This mirrors the
// hand-assembled sendRaw frame broadcastSnapshots already builds (head + ents.join(',')
// + ...), applied to the events frame.

// JSON-stringify each event in a batch exactly once. The returned array is
// index-aligned with `events`, so a per-session pass selects fragments by the same
// index it would have selected the event. Call this AFTER any once-per-batch mutation
// of the events (the sender-flair stamp), so each fragment reflects the final wire shape.
// `events` is always a dense array of real SimEvent objects (the sim's tick output), so
// every fragment is a defined JSON string; a hole or an `undefined` slot would serialize
// as `null` inside the frame, but that input never occurs here.
export function serializeEventFragments(events: readonly SimEvent[]): string[] {
  const fragments = new Array<string>(events.length);
  for (let i = 0; i < events.length; i++) fragments[i] = JSON.stringify(events[i]);
  return fragments;
}

// Assemble one session's events frame from the pre-serialized fragments it selected.
// Byte-identical to JSON.stringify({ t: 'events', time, list: selectedEvents }).
// The authoritative time precedes the events so the client can advance its mirrored
// presentation clock before any scene op from the batch becomes drainable.
export function assembleEventsFrame(
  selectedFragments: readonly string[],
  presentationTime: number,
): string {
  return `{"t":"events","time":${presentationTime},"list":[${selectedFragments.join(',')}]}`;
}
