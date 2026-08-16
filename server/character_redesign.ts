// The PAID character redesign: spending one Stylist credit on a new authored
// look. Its own domain module rather than another route in server/characters.ts,
// because it is a self-contained behavior with its own runtime injection, its own
// db seam, and its own error vocabulary; what it borrows from the character
// domain is exactly the two things that must NOT be duplicated (the
// authenticated-and-not-locked guard, and the appearance validator the creation
// path uses).
//
// Distinct from the one-shot appearance reroll (characters.ts
// appearanceRerollHandler), which spends a free legacy token granted to
// characters that predate the modular creator. This one spends a CREDIT bought
// from the Stylist for gold, and a character may hold several, so it is not
// one-shot and has no cutoff date.
//
// THE VALIDATION RULE, and it is the whole reason this route exists rather than
// the client writing the column: looks render to every player in view, so a
// redesign payload is untrusted input validated against EXACTLY the same rules as
// initial character creation. Both paths run parseAppearanceBody, which is
// sanitizeAppearance (src/world_api/appearance.ts): the shared bounds validator
// the creation route, the join path, and the roster read all use. There is no
// second, looser rule for the editor.
//
// THE DOUBLE-SUBMIT RULE: the credit decrement is a CONDITIONAL update
// (consumeRedesignCredit, `WHERE credits >= 1` in a single atomic statement), so
// two concurrent submits on one credit cannot both land. The loser changes
// nothing and gets a clean 400, never a second free redesign.
//
// ONLINE CHARACTERS ARE ALLOWED, deliberately. The alternative (refuse with "log
// out to change your look") would have been the simpler route only if the live
// push did not already exist, and it does: the v0.36 reroll path already mirrors
// a saved look and helm choice onto a live session
// (applyAppearanceForCharacter / setHelmHiddenForCharacter), because an online
// character's 30 s autosave otherwise writes its in-memory copy straight back
// over the row. This route reuses both and adds the credit half
// (spendRedesignCreditForCharacter): without it, an online player's own autosave
// would refund the credit they just spent.

import { activeGuard, parseAppearanceBody } from './characters';
import type { CharacterRow } from './db';
import { consumeRedesignCredit, getCharacter } from './db';
import { withBody } from './http/middleware/body';
import { CHARACTER_REROLL_POLICY, rateLimit } from './http/middleware/rate_limit';
import { requireOwned } from './http/middleware/require_owned';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { json } from './http_util';

/** ctx.state key the ownership loader stashes the row under. Its own key rather
 *  than the character domain's, so the two loaders can never read each other's
 *  stash by accident. */
const REDESIGN_CHARACTER_RESOURCE = 'redesignCharacter';

// Error bodies. Stable `<domain>.<reason>` codes, never English prose: the client
// localizes code-first through src/ui/api_error_i18n.ts.
const NOT_FOUND = {
  error: 'character not found',
  code: 'character.not_found',
} as const;
const INVALID_APPEARANCE = {
  error: 'invalid appearance payload',
  code: 'character.invalid_appearance',
} as const;
/** The conditional decrement matched no row: no credit held, or a concurrent
 *  submit spent the last one first. Both are the same answer to the caller, and
 *  deliberately so: the client's remedy is identical (re-read the roster). */
const NO_REDESIGN_CREDIT = {
  error: 'no redesign credit available for this character',
  code: 'character.no_redesign_credit',
} as const;

export interface CharacterRedesignRuntime {
  /** game.applyAppearanceForCharacter: mirror the saved LOOK onto a live session
   *  (entity field + wire-memo bust) so the player and every peer see the new
   *  body now rather than at next relog. */
  applyAppearanceForCharacter(
    characterId: number,
    appearance: Record<string, unknown> | null,
  ): boolean;
  /** game.setHelmHiddenForCharacter: mirror the helm choice onto a live session,
   *  so its autosave does not write the old value back over the row. */
  setHelmHiddenForCharacter(characterId: number, hidden: boolean): boolean;
  /** game.spendRedesignCreditForCharacter: mirror the CREDIT decrement onto a
   *  live session. Without this the session's 30 s autosave writes its stale
   *  in-memory count back and refunds the credit that was just spent. */
  spendRedesignCreditForCharacter(characterId: number): boolean;
}

let runtime: CharacterRedesignRuntime | null = null;

/** Inject the main.ts/game runtime the handler needs. Called once at boot. */
export function configureCharacterRedesignRuntime(rt: CharacterRedesignRuntime): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetCharacterRedesignRuntimeForTests(): void {
  runtime = null;
}

function useRuntime(): CharacterRedesignRuntime {
  if (runtime === null) {
    throw new Error(
      'character redesign runtime is not configured; call configureCharacterRedesignRuntime',
    );
  }
  return runtime;
}

// Db seam: the two reads/writes bundled behind a test-only setter so the handler
// drives with a FakeDb and no Postgres (the endpoint-test contract in
// server/CLAUDE.md).
const REAL_REDESIGN_DB = { getCharacter, consumeRedesignCredit };
let redesignDb = REAL_REDESIGN_DB;

/** Override the redesign db bundle with a fake (test-only). */
export function setCharacterRedesignDbForTests(overrides: Partial<typeof REAL_REDESIGN_DB>): void {
  redesignDb = { ...REAL_REDESIGN_DB, ...overrides };
}

/** Restore the real redesign db bundle (test-only). */
export function resetCharacterRedesignDbForTests(): void {
  redesignDb = REAL_REDESIGN_DB;
}

/** The character BOLA loader: an account-scoped find (id AND account_id AND
 *  realm). A miss is 404 whether the id is absent or belongs to another account
 *  (anti-enumeration), matching every other owned character route. */
const requireOwnedRedesignCharacter: Middleware = requireOwned<CharacterRow>({
  resource: REDESIGN_CHARACTER_RESOURCE,
  param: 'id',
  // Through the seam, not the direct import: resolved at CALL time so a test
  // can install a fake and drive this route with no Postgres.
  load: (accountId, id) => redesignDb.getCharacter(accountId, id),
  notFoundBody: NOT_FOUND,
});

/**
 * POST /api/characters/:id/redesign: spend one Stylist redesign credit on a new
 * authored look.
 *
 * The handler only shapes the payload and maps the outcome; every eligibility
 * decision (ownership + realm + an unspent credit) is made ATOMICALLY inside the
 * single conditional UPDATE, so there is no read-then-write window a concurrent
 * submit could slip through.
 */
async function redesignHandler(ctx: Ctx): Promise<void> {
  const character = ctx.state.get(REDESIGN_CHARACTER_RESOURCE) as CharacterRow;
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const appearance = parseAppearanceBody(body.appearance);
  // Same rule as the reroll: this route's whole point is a NEW look, so an
  // absent appearance is malformed rather than "clear the look". `null` from the
  // parser means absent; 'invalid' means present but unusable.
  if (appearance === 'invalid' || appearance === null) {
    json(ctx.res, 400, INVALID_APPEARANCE);
    return;
  }
  // An omission is NULL, not false, matching creation and the reroll: only a
  // client that does not offer the toggle can omit it, and defaulting that to
  // false would actively UN-hide a helm the player had hidden in world.
  const helmHidden = typeof body.helmHidden === 'boolean' ? body.helmHidden : null;
  const ok = await redesignDb.consumeRedesignCredit(
    ctx.account?.accountId ?? 0,
    character.id,
    appearance,
    helmHidden,
  );
  if (!ok) {
    json(ctx.res, 400, NO_REDESIGN_CREDIT);
    return;
  }
  // The row now says one thing and a live session's memory says another. All
  // three pushes are no-ops when the character is not in world.
  const rt = useRuntime();
  // The credit FIRST: this is the one whose absence silently refunds a spend.
  rt.spendRedesignCreditForCharacter(character.id);
  if (helmHidden !== null) rt.setHelmHiddenForCharacter(character.id, helmHidden);
  rt.applyAppearanceForCharacter(character.id, appearance);
  // Echo the normalized look so the client updates its roster row without a
  // second list fetch.
  json(ctx.res, 200, { ok: true, appearance, helmHidden });
}

/** The meta marking an account-owned (BOLA-protected) character :id route. */
const OWNED_CHARACTER_META = {
  requireOwned: { kind: REDESIGN_CHARACTER_RESOURCE, ownerScope: 'account' },
} as const;

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/characters/:id/redesign',
    surface: 'api',
    // Registry-only (the new-route rule): no legacy ladder twin. withBody BEFORE
    // the ownership loader, the rename/delete/reroll order, so a malformed body
    // answers uniformly for any :id rather than 404ing on ownership first.
    // Shares the reroll's per-action limiter: both are appearance writes by the
    // same account against the same table, so they belong in one bucket.
    middleware: [
      activeGuard,
      rateLimit(CHARACTER_REROLL_POLICY),
      withBody(),
      requireOwnedRedesignCharacter,
    ],
    handler: redesignHandler,
    meta: OWNED_CHARACTER_META,
  },
];
