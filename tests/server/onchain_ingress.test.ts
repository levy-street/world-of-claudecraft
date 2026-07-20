// Drives the /internal/onchain-event ingress + /internal/onchain/feed drain routes
// end to end through the real middleware onion, asserting the realm-chat broadcast
// fires and the event becomes drainable for the bot. The gate's unset/mismatch
// behavior is covered by the ownership-coverage sweep; this covers the happy path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compose } from '../../server/http/compose';
import {
  DISCORD_SECRET_ENV,
  DISCORD_SECRET_HEADER,
  ONCHAIN_SECRET_ENV,
  ONCHAIN_SECRET_HEADER,
} from '../../server/http/middleware/require_internal_secret';
import { withErrors } from '../../server/http/middleware/with_errors';
import { apiRoutes } from '../../server/http/registry';
import type { Ctx, Middleware, RouteDef } from '../../server/http/types';
import { configureInternalRuntime, resetInternalRuntimeForTests } from '../../server/internal';
import { resetOnchainForTests } from '../../server/onchain_activity';
import { fakeCtx } from './helpers/fake_ctx';

const SIG = '5YsdJH3LdRAjYzKf2yiJejHNB9f39zdEPxDXDZWptBwMvAF4VtpHEDeyM5kRFzxEqJX';

function routeFor(method: string, path: string): RouteDef {
  const r = apiRoutes.find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`route not found: ${method} ${path}`);
  return r;
}

async function run(route: RouteDef, ctx: Ctx): Promise<{ statusCode: number; body: string }> {
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    (async (c) => {
      await route.handler(c);
    }) as Middleware,
  ];
  await compose(stack)(ctx);
  const res = ctx.res as unknown as { statusCode: number; body: string };
  return { statusCode: res.statusCode, body: res.body };
}

const burnBody = {
  kind: 'burn',
  token: 'WOC',
  amountUi: 25000,
  usd: 4.38,
  actor: 'Logan',
  sig: SIG,
  blockMs: 1_784_462_593_000,
  network: 'mainnet',
  totalBurnedUi: 442072,
};

describe('onchain ingress + feed routes', () => {
  let announce: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetOnchainForTests();
    process.env[ONCHAIN_SECRET_ENV] = 'onchain-secret';
    process.env[DISCORD_SECRET_ENV] = 'discord-secret';
    delete process.env.WOC_ONCHAIN_REALM_MIN_USD;
    announce = vi.fn();
    configureInternalRuntime({
      startRestartCountdown: vi.fn(() => ({ started: true })) as never,
      announceOnchain: announce as unknown as (line: string) => void,
    });
  });

  afterEach(() => {
    delete process.env[ONCHAIN_SECRET_ENV];
    delete process.env[DISCORD_SECRET_ENV];
    delete process.env.WOC_ONCHAIN_REALM_MIN_USD;
    resetInternalRuntimeForTests();
    resetOnchainForTests();
    vi.restoreAllMocks();
  });

  it('accepts a valid burn event, broadcasts it to realm chat, and queues it for the bot', async () => {
    const ingress = routeFor('POST', '/internal/onchain-event');
    const res = await run(
      ingress,
      fakeCtx({
        method: 'POST',
        url: '/internal/onchain-event',
        headers: { [ONCHAIN_SECRET_HEADER]: 'onchain-secret' },
        body: burnBody,
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      '[WOC] Burned 25,000 WOC ($4.38). Total burned 442,072 WOC.',
    );

    // The bot drain returns the queued event.
    const feed = routeFor('GET', '/internal/onchain/feed');
    const drained = await run(
      feed,
      fakeCtx({
        method: 'GET',
        url: '/internal/onchain/feed',
        headers: { [DISCORD_SECRET_HEADER]: 'discord-secret' },
      }),
    );
    expect(drained.statusCode).toBe(200);
    const payload = JSON.parse(drained.body) as { data: { items: Array<{ sig: string }> } };
    expect(payload.data.items).toHaveLength(1);
    expect(payload.data.items[0].sig).toBe(SIG);
  });

  it('rejects a malformed event with 400 and never broadcasts', async () => {
    const ingress = routeFor('POST', '/internal/onchain-event');
    const res = await run(
      ingress,
      fakeCtx({
        method: 'POST',
        url: '/internal/onchain-event',
        headers: { [ONCHAIN_SECRET_HEADER]: 'onchain-secret' },
        body: { kind: 'mint', token: 'WOC', amountUi: 1, sig: SIG },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(announce).not.toHaveBeenCalled();
  });

  it('holds the realm broadcast below the configured USD floor but still queues for the bot', async () => {
    process.env.WOC_ONCHAIN_REALM_MIN_USD = '100';
    const ingress = routeFor('POST', '/internal/onchain-event');
    const res = await run(
      ingress,
      fakeCtx({
        method: 'POST',
        url: '/internal/onchain-event',
        headers: { [ONCHAIN_SECRET_HEADER]: 'onchain-secret' },
        body: { ...burnBody, usd: 4.38 },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(announce).not.toHaveBeenCalled(); // $4.38 is below the $100 realm floor

    const feed = routeFor('GET', '/internal/onchain/feed');
    const drained = await run(
      feed,
      fakeCtx({
        method: 'GET',
        url: '/internal/onchain/feed',
        headers: { [DISCORD_SECRET_HEADER]: 'discord-secret' },
      }),
    );
    const payload = JSON.parse(drained.body) as { data: { items: unknown[] } };
    expect(payload.data.items).toHaveLength(1);
  });
});
