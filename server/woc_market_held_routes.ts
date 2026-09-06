// The Exchange Vault's REST handlers (docs/prd/woc/marketplace.md, "Selling
// without a wallet: the Vault"). The RouteDef rows themselves live in the
// woc_market_routes.ts table (its guard-tier and BOLA pins scan that table's
// source), while the handler bodies and their wire views live here behind an
// injected deps bag, the stepup_flow / delivery sibling pattern.
//
// Wire contract (pinned in tests/server/woc_market_held_routes.test.ts):
//   GET  /api/woc-market/held                     -> heldView
//   POST /api/woc-market/held/withdraw            -> { base, tokens, wallet }
//   POST /api/woc-market/settlements/:id/confirm-held -> { state, reason }
// Every figure is the base-unit string the ledger holds plus the display
// tokens; the client never derives one from the other.

import { ctxAccountId } from './http/context';
import { HttpError } from './http/errors';
import type { Ctx } from './http/types';
import { json } from './http_util';
import type { Refused } from './woc_market';
import type { WocMarketHeldService } from './woc_market_held';
import type { WocHeldEntryRow } from './woc_market_held_db';
import { screenWirePendingReason } from './woc_market_rules';

export interface WocHeldRouteDeps {
  /** The Vault service, or null when the realm has none wired (the rigs and
   *  a server booted without the Vault): every route then answers
   *  woc_market.held_disabled. */
  held(): WocMarketHeldService | null;
  throwRefusal(refusal: Refused): never;
  /** The actor's cached /me readout must not outlive a Vault mutation. */
  bustMe(account: number): void;
  /** The item's public history changed under this request (an eager
   *  delivery ran to the sale insert). */
  bustHistoryAll(): void;
}

export interface WocHeldHandlers {
  readout(ctx: Ctx): Promise<void>;
  withdraw(ctx: Ctx): Promise<void>;
  confirmHeld(ctx: Ctx): Promise<void>;
}

function entryView(row: WocHeldEntryRow): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    deltaBase: row.deltaBase,
    settlementId: row.settlementId,
    atMs: row.createdAtMs,
  };
}

export function createWocHeldHandlers(deps: WocHeldRouteDeps): WocHeldHandlers {
  const disabled = (): never => {
    throw new HttpError(403, 'woc_market.held_disabled');
  };
  return {
    async readout(ctx) {
      const held = deps.held();
      // A realm with no Vault still answers the shape (enabled false, zero
      // balance) so the client renders one honest state instead of an error
      // banner for a feature that is simply off here.
      if (!held) {
        json(ctx.res, 200, {
          enabled: false,
          base: '0',
          tokens: 0,
          canWithdraw: false,
          entries: [],
        });
        return;
      }
      const out = await held.readout(ctxAccountId(ctx));
      json(ctx.res, 200, {
        enabled: out.enabled,
        base: out.base,
        tokens: out.tokens,
        canWithdraw: out.canWithdraw,
        entries: out.entries.map(entryView),
      });
    },

    async withdraw(ctx) {
      const held = deps.held() ?? disabled();
      const account = ctxAccountId(ctx);
      const out = await held.withdraw(account);
      // Both arms can have moved the ledger (a reversed charge included).
      deps.bustMe(account);
      if (!out.ok) deps.throwRefusal(out);
      json(ctx.res, 200, { base: out.base, tokens: out.tokens, wallet: out.wallet });
    },

    async confirmHeld(ctx) {
      const held = deps.held() ?? disabled();
      const account = ctxAccountId(ctx);
      const id = Number(ctx.params.id);
      const out = await held.confirmFromHeld(account, id);
      deps.bustMe(account);
      if (!out.ok) deps.throwRefusal(out);
      if (out.state === 'confirmed') deps.bustHistoryAll();
      json(ctx.res, 200, { state: out.state, reason: screenWirePendingReason(out.reason ?? null) });
    },
  };
}
