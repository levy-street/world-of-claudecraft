// Shared displacement teardown for the two profession sessions (a running
// gather cast or a fishing session), behind the SimContext seam. Every
// teleport (dungeon and delve entry/exit, the delve eject and module
// advance, revive, the server-side jail/spectate/dev moves) and a /follow
// tow across a zone line calls this ONE helper instead of growing its own
// copy of the cancel. The scope is the ruling's, exactly: every teleport,
// plus the follow tow ON A ZONE CROSSING. Of the arena family, arena,
// fiesta, and the Yumi placements clear sessions inline in their own
// resets; Vale Cup calls this helper directly at its two placement moves.
// A same-zone tow deliberately does NOT cancel (the
// gather half re-checks node range at completion, and a reel off the water
// is an accepted classic-era oddity, not a rod-tier dodge), and neither
// does a displacement with no hit and no teleport (a hostile damage-free
// knockback, a leap or charge already in flight): the pinned session zone
// bounds those, keeping the table, deed credit, and telemetry on the zone
// the gate validated.
// Gated on isNonSpellCast so SPELL casts gain no new cancel path here
// (teleports that should break a spell keep their own rules), and delegated
// to the one cancelCast on the seam, which already clears the queued-spell
// slot and every hidden session field. Draw-free on every path.

import type { SimContext } from '../sim_context';
import { type Entity, isNonSpellCast } from '../types';

export function cancelProfessionSessionOnDisplacement(ctx: SimContext, e: Entity): void {
  if (e.kind !== 'player') return;
  if (!isNonSpellCast(e.castingAbility)) return;
  ctx.cancelCast(e);
}
