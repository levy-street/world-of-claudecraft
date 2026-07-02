// Pure view-core for the instance-transition veil (the classic loading
// curtain shown when a teleport moves the player between world spaces:
// overworld zone, dungeon instance, the arena, a delve). The overworld strip
// stays seamless: a space-identity change alone is just walking across a zone
// band and never triggers. A veil triggers only when the space identity
// changed AND the position jumped farther than any legitimate per-frame
// movement, which is exactly the door/exit/queue teleports. (Accepted edge:
// a spirit release to a graveyard in an ADJACENT zone is also a zone-id
// change plus a long jump and briefly veils; graveyards are per-zone so the
// common release is same-zone and never triggers.)
//
// The core owns the cover/hold/reveal phase machine on the caller's clock
// (the painter passes nowMs; no timing source lives here). It is DOM- and
// i18n-free: it emits a destination discriminator (kind + id) the painter
// localizes. Allocation-light per the per-frame contract: one reused state
// object and destination record, no per-frame garbage. Reduced-motion
// honoring is deliberately NOT here: the painter's CSS multiplies the fade
// durations by --motion-scale, the repo's single motion authority, so the
// core's phase windows stay fixed and the fades collapse to instant.

import { delveAt, dungeonAt, isArenaPos, isDelvePos, zoneAt } from '../sim/data';

// Phase lengths on the core's clock. COVER/REVEAL are also published to CSS
// by the painter (--veil-cover-ms / --veil-reveal-ms), so the class toggle
// and the opacity transition stay in step from this one source.
export const VEIL_COVER_MS = 140;
export const VEIL_HOLD_MS = 650;
export const VEIL_REVEAL_MS = 380;
// A space-crossing teleport moves hundreds of units (the nearest instance
// band starts at x=900); the fastest legitimate per-frame movement (charge,
// blink) covers under ~25u. Anything past this in one frame is a teleport.
export const VEIL_TELEPORT_DIST = 50;

export type VeilDestKind = 'zone' | 'dungeon' | 'arena' | 'delve';

export interface VeilDest {
  kind: VeilDestKind;
  /** Zone/dungeon/delve id; '' for the arena (one global name). */
  id: string;
}

export type VeilPhase = 'idle' | 'cover' | 'hold' | 'reveal';

export interface ZoneVeilState {
  phase: VeilPhase;
  /** Destination while showing, null when idle. A REUSED record: read it,
   *  never retain it across frames. */
  dest: VeilDest | null;
  /** Increments once per trigger, so the painter re-resolves the localized
   *  label only when a new veil starts, not per frame. */
  gen: number;
}

// Which world space a position belongs to, written into the reused `out`.
// Order matters: the delve band sits past the arena band, which sits past the
// dungeon bands; everything else is the overworld strip keyed by zone.
function classifyInto(x: number, z: number, out: VeilDest): void {
  if (isDelvePos(x)) {
    out.kind = 'delve';
    out.id = delveAt(x)?.id ?? '';
    return;
  }
  if (isArenaPos(x)) {
    out.kind = 'arena';
    out.id = '';
    return;
  }
  const dungeon = dungeonAt(x);
  if (dungeon) {
    out.kind = 'dungeon';
    out.id = dungeon.id;
    return;
  }
  out.kind = 'zone';
  out.id = zoneAt(z).id;
}

export class ZoneVeilCore {
  private hasPrev = false;
  private prevX = 0;
  private prevZ = 0;
  private prevKind: VeilDestKind = 'zone';
  private prevId = '';
  private startMs = Number.NEGATIVE_INFINITY;
  private readonly scratch: VeilDest = { kind: 'zone', id: '' };
  private readonly dest: VeilDest = { kind: 'zone', id: '' };
  private readonly state: ZoneVeilState = { phase: 'idle', dest: null, gen: 0 };

  /** Feed the player position once per frame; identical for a Sim- or
   *  ClientWorld-backed player (both mirror the same authoritative pos). The
   *  first call only records the baseline (login/char-select never veils). */
  update(x: number, z: number, nowMs: number): ZoneVeilState {
    const cur = this.scratch;
    classifyInto(x, z, cur);
    if (this.hasPrev && (cur.kind !== this.prevKind || cur.id !== this.prevId)) {
      const dx = x - this.prevX;
      const dz = z - this.prevZ;
      if (dx * dx + dz * dz > VEIL_TELEPORT_DIST * VEIL_TELEPORT_DIST) {
        this.dest.kind = cur.kind;
        this.dest.id = cur.id;
        this.startMs = nowMs;
        this.state.gen++;
      }
    }
    this.hasPrev = true;
    this.prevX = x;
    this.prevZ = z;
    this.prevKind = cur.kind;
    this.prevId = cur.id;

    const t = nowMs - this.startMs;
    const s = this.state;
    if (t < VEIL_COVER_MS) s.phase = 'cover';
    else if (t < VEIL_COVER_MS + VEIL_HOLD_MS) s.phase = 'hold';
    else if (t < VEIL_COVER_MS + VEIL_HOLD_MS + VEIL_REVEAL_MS) s.phase = 'reveal';
    else s.phase = 'idle';
    s.dest = s.phase === 'idle' ? null : this.dest;
    return s;
  }
}
