// The client mirror of the Footprints in Ash marks (src/sim/pvp/skill_event_footprints.ts).
// The server streams, on the self wire's `sevm` key, only the marks new since
// its last send to this session (server/world_pvp_wire.ts emitSkillEventMarksKey):
// a flat list of `seq, x, z, heading, kind, ageTenths` per mark, kind 0 a
// footprint and 1 a breath plume, age in tenths of a second at the send. `null` clears the book (the
// fight is over for this viewer). The mirror stamps each mark on its own clock
// (receive time minus the age) and prunes what has faded, so IWorld readers see
// the same book shape the offline Sim gives them.

import type { SkillEventMark, SkillEventMarkBook } from '../world_api/world_pvp';

/** Mirrors the sim's SKILL_EVENT_MARK_LIFETIME (pinned equal by a test). */
export const CLIENT_MARK_LIFETIME = 3;
const MARK_FIELDS = 6;
/** A defensive cap on a book, far above what a full arena leaves in 3 s. */
const MAX_MARKS = 512;

interface MarkMirror {
  book: { now: number; marks: SkillEventMark[] };
}

const mirrors = new WeakMap<object, MarkMirror>();

function mirrorOf(target: object): MarkMirror {
  let m = mirrors.get(target);
  if (!m) {
    m = { book: { now: 0, marks: [] } };
    mirrors.set(target, m);
  }
  return m;
}

function clockSeconds(): number {
  return typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
}

/** Apply one `sevm` value to the target's book. Malformed input is ignored. */
export function applySkillEventMarksWire(
  target: object,
  wire: unknown,
  now = clockSeconds(),
): void {
  const book = mirrorOf(target).book;
  if (!Array.isArray(wire)) {
    book.marks = [];
    return;
  }
  let lastSeq = book.marks.length ? book.marks[book.marks.length - 1].seq : 0;
  for (let i = 0; i + MARK_FIELDS <= wire.length; i += MARK_FIELDS) {
    const [seq, x, z, heading, kind, age] = wire.slice(i, i + MARK_FIELDS);
    const fields = [seq, x, z, heading, kind, age];
    if (!fields.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    if (seq <= lastSeq) continue; // a resend after a resync
    lastSeq = seq;
    if (book.marks.length >= MAX_MARKS) book.marks.shift();
    book.marks.push({
      seq,
      x,
      z,
      heading,
      kind: kind === 1 ? 'breath' : 'step',
      at: now - age / 10,
    });
  }
}

/** The IWorld book, pruned to the marks still readable at `now`. */
export function skillEventMarkBookOf(target: object, now = clockSeconds()): SkillEventMarkBook {
  const book = mirrorOf(target).book;
  book.now = now;
  const cutoff = now - CLIENT_MARK_LIFETIME;
  if (book.marks.length > 0 && book.marks[0].at < cutoff) {
    book.marks = book.marks.filter((m) => m.at >= cutoff);
  }
  return book;
}
