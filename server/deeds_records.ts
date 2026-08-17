// Deeds records: an OBSERVER of the sim's deedUnlocked events, never an
// authority. The sim alone decides unlocks (src/sim/deeds.ts grantDeed) and
// persists them inside the characters.state blob; this module only mirrors
// each unlock into the queryable character_deeds index. It copies the
// bank_ledger runtime shape minus the diffing (deeds are event-driven, so
// there is no before/after snapshot to compare): each insert chains onto a
// per-process FIFO promise tail the game loop NEVER awaits, a rejected insert
// logs and never blocks or reorders anything, and the whole body is guarded
// so the observer can never throw into the caller. Idempotence lives in the
// SQL (ON CONFLICT DO NOTHING over UNIQUE (character_id, deed_id)), so the
// initial retro backfill and crash-replays of unpersisted state are free.
// The guarantee's edge: a deed already persisted in the state blob never
// re-emits on a later login (grantDeed no-ops on the earned set), so a
// TRANSIENT insert failure would leave this index one row short. The
// login-time reconcile (reconcileCharacterDeeds, wired at join in
// server/game.ts) closes that drift: it replays the loaded earned set into
// character_deeds idempotently on every join, so a dropped row is re-created
// the next time the character logs in. The one gap this cannot heal is a
// rollback that strips the deeds fields FROM the blob itself: with the blob no
// longer carrying those ids, there is nothing left to replay from.

import { DEEDS } from '../src/sim/content/deeds';
import { FISHING_RARE_ID } from '../src/sim/content/items';
import { ITEMS } from '../src/sim/data';
import type { DeedDef } from '../src/sim/types';
import type { DeedsRarity } from '../src/world_api';
import { insertCharacterDeed, insertCharacterDeeds } from './deeds_db';
// Imported from the mirror modules DIRECTLY (not the ./steam or ./epic
// barrels): this module rides in game.ts's graph, and the barrels would drag
// routes.ts (and its load-time requireAccount over the db module) into every
// test that partial-mocks the db, the known overlay-mock breakage class.
// Steam and Epic observers are independent (D21): either may be dark; one
// outage must not block the other.
import { onDeedRecorded as onEpicDeedRecorded } from './epic/mirror';
import { REALM } from './realm';
import { onDeedRecorded as onSteamDeedRecorded } from './steam/mirror';

// Per-process FIFO tail. A character lives on one realm process, so chaining
// preserves that character's unlock order; a rejection is caught (logged) and
// the chain continues.
let tail: Promise<void> = Promise.resolve();

/** The marquee bar for the guild/friend broadcast: notable-or-better Renown,
 *  or any cosmetic reward. Pure so the gate is unit-testable. */
export function isMarqueeDeed(def: DeedDef): boolean {
  return def.renown >= 25 || def.reward !== undefined;
}

/** Hidden deeds are invisible until earned, EXISTENCE included (the DeedDef
 *  contract). isHiddenDeedId answers ONLY "is this a KNOWN hidden deed"; it
 *  reads an unknown id as NOT hidden (DEEDS[id]?.hidden is undefined). That
 *  fail-open is sound for its one caller, the guild broadcast gate
 *  (server/game.ts), which already drops any id with no live DeedDef before it
 *  asks. Public surfaces must NOT reuse it: use isPubliclyListableDeedId, which
 *  fails CLOSED. */
export function isHiddenDeedId(deedId: string): boolean {
  return DEEDS[deedId]?.hidden === true;
}

/** Whether an id may appear on an anonymous or third-party public surface: it
 *  must resolve to a KNOWN, non-hidden deed. Fails CLOSED on an unknown id.
 *  Production runs a mixed-version fleet over one shared database, so a NEWER
 *  hidden deed's id (a descriptive slug any current client resolves to full
 *  name and description) can reach an older process, and a binary rollback
 *  reintroduces the same skew; either would spoil an unearned hidden deed. A
 *  removed id dropped from public surfaces loses nothing, since no client can
 *  render it anyway, and an owner's own Book never routes through this
 *  predicate, so owners are unaffected. */
export function isPubliclyListableDeedId(id: string): boolean {
  const def = DEEDS[id];
  return def !== undefined && def.hidden !== true;
}

/** The first-koi deed (col_glimmerfin, "Glimmer of Hope", desc "Catch a
 *  Sunglint Koi"; the NAME is what ships as the card's deedName): the one
 *  feed-worthy deed with no title reward; its Discord card reads as a catch. */
export const FIRST_KOI_DEED_ID = 'col_glimmerfin';

/** The Discord activity-feed payload for one deed unlock, or null when the
 *  unlock is not feed-worthy. Feed-worthy is exactly a title-rewarding deed, a
 *  border-rewarding deed (Phase 18: every cosmetic-reward deed is already
 *  marquee, and its card is name-only, no title and no item), or the first-koi
 *  deed: the moments the rareloot detector cannot see (no loot roll fires for
 *  a catch, a craft, or a deed; the first masterwork rides prog_masterwright's
 *  title). A Discord channel is precisely the third-party public surface the
 *  hidden-deed contract covers, so this routes through isPubliclyListableDeedId
 *  and fails CLOSED on hidden or unknown ids. Pure so the gate is
 *  unit-testable. */
export function discordFeedDeed(
  deedId: string,
): { deedName: string; deedTitle?: string; itemName?: string } | null {
  const def = DEEDS[deedId];
  if (!def || !isPubliclyListableDeedId(deedId)) return null;
  if (deedId === FIRST_KOI_DEED_ID) {
    return { deedName: def.name, itemName: ITEMS[FISHING_RARE_ID]?.name ?? FISHING_RARE_ID };
  }
  if (def.reward?.kind === 'border') return { deedName: def.name };
  if (def.reward?.kind === 'title') return { deedName: def.name, deedTitle: def.reward.text };
  return null;
}

/** The public form of the rarity aggregate: keep only publicly listable deeds
 *  so an anonymous caller can neither enumerate a hidden deed's id the moment
 *  one player earns it nor learn a newer/rolled-back id. Pure; the main.ts
 *  cache applies it once per refresh. */
export function publicRarityPayload(payload: DeedsRarity): DeedsRarity {
  const earned: Record<string, number> = {};
  for (const id in payload.earned) {
    if (isPubliclyListableDeedId(id)) earned[id] = payload.earned[id];
  }
  return { totalEligible: payload.totalEligible, earned };
}

/** Mirror one sim-decided unlock into character_deeds, fire-and-forget.
 *  Returns void immediately (never a promise, never awaited by the game
 *  loop); gameplay never depends on the write landing. */
export function recordDeedUnlock(
  who: { characterId: number; accountId: number },
  deedId: string,
): void {
  try {
    tail = tail
      .then(() =>
        insertCharacterDeed({
          realm: REALM,
          characterId: who.characterId,
          accountId: who.accountId,
          deedId,
        }),
      )
      .then(() => {
        // Storefront mirrors observe THIS observer: each hooks in only after
        // the character_deeds upsert resolves, is synchronous + swallow-all,
        // and stays a per-process no-op unless its flag is on, the deed is
        // mapped, and the account is linked. Direct dual fan-out (D21), not a
        // shared mega-bus: Steam and Epic are independent.
        onSteamDeedRecorded(who.accountId, deedId);
        onEpicDeedRecorded(who.accountId, deedId);
      })
      .catch((err) => {
        console.error('character_deeds write failed:', err);
      });
  } catch (err) {
    // The observer must never fault the event-routing path.
    console.error('deeds recordDeedUnlock failed:', err);
  }
}

/** Mirror a BATCH of sim-decided unlocks into character_deeds in ONE multi-row
 *  insert, fire-and-forget, chained onto the SAME per-process FIFO tail as
 *  single unlocks and the login reconcile so unlock order is preserved. The
 *  post-save drain uses this: a returning veteran's blob write flushes many
 *  pending unlocks at once, and a login storm would otherwise serialize N*M
 *  single-row round trips ahead of the public index, the Steam pushes, and the
 *  shutdown drain that awaits deedRecordsIdle. One batch replaces the M inserts.
 *  A single-id slice delegates to recordDeedUnlock, keeping the common
 *  live-unlock case on its exact single-row insert; an empty slice never
 *  touches the tail. Unlike the login reconcile (a DB write only), the drain
 *  owns the storefront at-least-once pushes, so each onDeedRecorded fires once
 *  per id AFTER the batch resolves. A rejected batch logs and never breaks the
 *  tail; at-least-once heals via the join reconcile, which replays the same
 *  ids. */
export function recordDeedUnlocks(
  who: { characterId: number; accountId: number },
  deedIds: readonly string[],
): void {
  if (deedIds.length === 0) return;
  if (deedIds.length === 1) {
    recordDeedUnlock(who, deedIds[0]);
    return;
  }
  // Snapshot so the insert bind and the post-resolve mirror loop share one
  // stable list even if the caller reuses the array.
  const ids = [...deedIds];
  try {
    tail = tail
      .then(() =>
        insertCharacterDeeds(
          { realm: REALM, characterId: who.characterId, accountId: who.accountId },
          ids,
        ),
      )
      .then(() => {
        // The drain, unlike the login reconcile, owns the storefront
        // at-least-once pushes: notify each mirror once per id, in unlock
        // order, only after the batch upsert resolves. Each onDeedRecorded is
        // synchronous + swallow-all and a per-process no-op unless its flag
        // is on, the deed is mapped, and the account is linked (Steam and
        // Epic independently; D21).
        for (const id of ids) {
          onSteamDeedRecorded(who.accountId, id);
          onEpicDeedRecorded(who.accountId, id);
        }
      })
      .catch((err) => {
        console.error('character_deeds batch write failed:', err);
      });
  } catch (err) {
    // The observer must never fault the event-routing path.
    console.error('deeds recordDeedUnlocks failed:', err);
  }
}

/** Login-time reconcile: replay a character's whole earned-deed set (from the
 *  authoritative state blob) into character_deeds in ONE idempotent batch,
 *  chained onto the SAME FIFO tail as live unlocks so it never races them. It
 *  heals a row that a transient per-unlock insert failure dropped and that
 *  grantDeed never re-emits (the deed is already in the earned set). Fire-and-
 *  forget: returns void immediately, is fully guarded so it can never throw
 *  into the join path, and a rejected batch logs and continues the chain. An
 *  empty set is a no-op that never touches the tail.
 *
 *  Deliberately does NOT call the storefront onDeedRecorded hooks per row: the
 *  character_deeds write is the whole job here. Each storefront's own login
 *  catch-up is owned by its mirror.reconcileOnLogin, called separately from
 *  the join path (server/game.ts) beside this reconcile. They replay the
 *  earned-and-mapped subset throttled per account, so a dropped achievement
 *  push heals without churning the push queue with an account's whole history
 *  every join. */
export function reconcileCharacterDeeds(
  who: { characterId: number; accountId: number },
  deedIds: readonly string[],
): void {
  if (deedIds.length === 0) return;
  try {
    tail = tail
      .then(() =>
        insertCharacterDeeds(
          { realm: REALM, characterId: who.characterId, accountId: who.accountId },
          deedIds,
        ),
      )
      .catch((err) => {
        console.error('character_deeds reconcile failed:', err);
      });
  } catch (err) {
    // The reconcile must never fault the join path.
    console.error('deeds reconcileCharacterDeeds failed:', err);
  }
}

/** The current FIFO tail, for tests to await the queue draining deterministically. */
export function deedRecordsIdle(): Promise<void> {
  return tail;
}
