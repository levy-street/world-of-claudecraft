// The queue-pop DM opt-in toggle: GET/POST /api/discord/queue-pings, the
// account setting behind the options-window row. Registry-only RouteDefs on the
// deeds broadcasts shape (server/deeds.ts): a read-tier bearer for the read so
// the row renders the persisted state before its first write, a mutation-tier
// bearer plus the body middleware for the write. The flag itself is read by the
// game loop's queue-pop observer (server/discord_queue_pops.ts), which the
// write busts so an opt-in mid-queue is honored on the next tick.

import { getDiscordQueuePings, setDiscordQueuePings } from './discord_queue_pings_db';
import { bustQueuePingCache } from './discord_queue_ping_cache';
import { ctxAccountId } from './http/context';
import { withBody } from './http/middleware/body';
import { requireAccount } from './http/middleware/require_account';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';

/** The domain's stable invalid-input code (server/http/error_codes.ts). */
export const QUEUE_PINGS_INVALID_INPUT_CODE = 'discord.invalid_input';

/**
 * GET /api/discord/queue-pings: `{ enabled }`, the account's current opt-in.
 * A missing row reads as the column default FALSE.
 */
async function queuePingsReadHandler(ctx: Ctx): Promise<void> {
  json(ctx.res, 200, { enabled: await getDiscordQueuePings(ctxAccountId(ctx)) });
}

/**
 * POST /api/discord/queue-pings { enabled: boolean }: set the opt-in
 * (accounts.discord_queue_pings) and forget the game loop's cached answer for
 * this account. The strict boolean check answers the domain's stable
 * invalid-input code.
 */
async function queuePingsHandler(ctx: Ctx): Promise<void> {
  const enabled = (ctx.body as Record<string, unknown> | null | undefined)?.enabled;
  if (typeof enabled !== 'boolean') {
    json(ctx.res, 400, { error: 'invalid input', code: QUEUE_PINGS_INVALID_INPUT_CODE });
    return;
  }
  const accountId = ctxAccountId(ctx);
  await setDiscordQueuePings(accountId, enabled);
  bustQueuePingCache(accountId);
  json(ctx.res, 200, { enabled });
}

/** The mutation-tier bearer gate the toggle route mounts. */
const activeAccount = requireAccount({ scope: 'active' });
/** Read-tier bearer gate for the settings read. */
const readAccount = requireAccount({ scope: 'read' });

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/discord/queue-pings',
    surface: 'api',
    middleware: [readAccount],
    handler: queuePingsReadHandler,
  },
  {
    method: 'POST',
    path: '/api/discord/queue-pings',
    surface: 'api',
    middleware: [activeAccount, withBody()],
    handler: queuePingsHandler,
  },
];
