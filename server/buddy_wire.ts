// Buddy companions on the server: the self-snapshot keys, the command dispatch,
// and the two grant channels (a live admin grant, and the queued grants a
// character drains at its next join). Extracted from server/game.ts under the
// monolith ratchet (the vault_wire.ts precedent): the coordinator keeps
// one-line delegates, the bodies live here.
//
// The sim owns every rule (src/sim/buddies.ts re-validates key, ownership and
// fit); this module only moves values between the wire, the database and the
// sim's own grant/summon entry points.

import { buddyDef } from '../src/sim/content/buddies';
import type { Sim } from '../src/sim/sim';
import { type BuddyGrantRow, takePendingBuddyGrants } from './buddy_grants_db';
import { screenCompanionRename } from './companion_rename';

/** Buddy grant, including the retired cosmetic id shape in historical queue rows. */
export interface BuddyGrant {
  buddyKey?: string;
  cosmeticId?: string;
}

/** Validate an active companion grant. Retired cosmetic grants are refused. */
export function buddyGrantBodyError(body: {
  buddyKey?: unknown;
  cosmeticId?: unknown;
}): string | null {
  const hasBuddy = typeof body.buddyKey === 'string' && body.buddyKey.length > 0;
  if (body.cosmeticId !== undefined) return 'unknown cosmetic id';
  if (!hasBuddy || !buddyDef(body.buddyKey as string)) return 'unknown buddy key';
  return null;
}

/** The heavy self-snapshot keys for the buddy collection (IWorldBuddies):
 *  owned companions `budOwn` and boss-roll wins pending their reveal `budPend`.
 *  Every writer (src/sim/buddies.ts) bumps meta.wireRev, which is what makes
 *  the heavy block due, so the gate needs no command list of its own. */
export function emitBuddySelfKeys(
  sim: Sim,
  pid: number,
  maybe: (key: string, value: unknown) => void,
): void {
  maybe('budOwn', sim.ownedBuddiesFor(pid));
  maybe('budPend', sim.pendingBuddiesFor(pid));
}

/** The buddy command family (src/world_api.ts COMMAND_FACETS 'IWorldBuddies').
 *  The entity mirror `bud`/`budal` and the self keys above carry every result;
 *  nothing here answers directly. */
export function dispatchBuddyCommand(
  sim: Sim,
  pid: number,
  command: string,
  msg: Record<string, unknown>,
): void {
  switch (command) {
    // Retired shortcut token. Selection is explicit in Cosmetics.
    case 'buddy_toggle':
      break;
    // Summon/dismiss a specific collected buddy from Cosmetics.
    case 'buddy_summon':
      if (typeof msg.key === 'string') sim.summonBuddyFor(pid, msg.key);
      break;
    // Retired append-only protocol token: old clients cannot activate archived looks.
    case 'buddy_cosmetic':
      break;
    // A preference flip, settable with no buddy out; the errand itself runs in
    // the Sim tick (src/sim/pet/buddy_autoloot.ts).
    case 'buddy_autoloot':
      if (typeof msg.on === 'boolean') sim.setBuddyAutolootFor(pid, msg.on);
      break;
  }
}

/** Shape-first name screening, under the inbound name-screen lane. Ownership and
 *  stale entity ids are re-validated by the sim before any state changes. */
export function dispatchBuddyRename(
  sim: Sim,
  pid: number,
  msg: Record<string, unknown>,
  offensiveName: (name: string) => boolean,
  rejectName: () => void,
): void {
  if (
    typeof msg.id !== 'number' ||
    !Number.isSafeInteger(msg.id) ||
    msg.id <= 0 ||
    typeof msg.name !== 'string'
  )
    return;
  const buddyId = msg.id;
  screenCompanionRename(
    msg.name,
    offensiveName,
    (name) => sim.renameBuddyFor(pid, buddyId, name),
    rejectName,
  );
}

/** Apply one grant to a LIVE player through the sim's own idempotent entry
 *  point. False for retired cosmetic grants or when the character already had it. */
export function applyBuddyGrantToSim(sim: Sim, pid: number, grant: BuddyGrant): boolean {
  if (grant.cosmeticId !== undefined) return false;
  if (typeof grant.buddyKey === 'string') return sim.grantBuddyFor(pid, grant.buddyKey);
  return false;
}

/** Join-time drain: every grant queued for this character while it was
 *  offline (server/db.ts queueBuddyGrant, the admin grant endpoint's offline
 *  arm) lands now, then one save closes the durability window the same way a
 *  live admin grant does. A failed read logs and leaves the rows queued for
 *  the next join; nothing is lost. */
export async function drainPendingBuddyGrants(
  sim: Sim,
  pid: number,
  characterId: number,
  name: string,
  save: () => Promise<boolean>,
): Promise<void> {
  let rows: BuddyGrantRow[];
  try {
    rows = await takePendingBuddyGrants(characterId);
  } catch (err) {
    console.error(`buddy grants: reading the queue for ${name} failed:`, err);
    return;
  }
  if (rows.length === 0) return;
  // The player may have left during the read; the rows are already consumed,
  // so re-queue by not applying is impossible. Apply to whoever holds the pid
  // only when it is still this character (the sim re-validates the key).
  if (!sim.players.get(pid) || sim.players.get(pid)?.characterId !== characterId) {
    console.error(`buddy grants: ${name} left before ${rows.length} queued grant(s) landed`);
    return;
  }
  let landed = 0;
  for (const row of rows) {
    if (applyBuddyGrantToSim(sim, pid, row)) landed += 1;
  }
  if (landed === 0) return;
  try {
    if (!(await save())) {
      console.error(`buddy grants for ${name}: queued grant did not persist (save fenced)`);
    }
  } catch (err) {
    console.error(`buddy grants save failed for ${name}:`, err);
  }
}
