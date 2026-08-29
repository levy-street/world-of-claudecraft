// THE LOGIN COVENANT, driven rather than read: a fresh join must arm the
// provisional storage ladder hold BEFORE the socket can deliver its first
// command, so a gold `bank_buy_slots` cannot land while a debited-but-unapplied
// Claudium purchase is still unknown.
//
// Until this file existed the covenant was guarded only by a source-text
// ordering pin in tests/server/main_retention_wiring.test.ts, which compares the
// INDEX of two string literals inside server/ws_auth.ts. That pin stays (it is
// free and it catches deletion), but it cannot see the three regressions that
// matter: a kick made conditional or moved into one admission arm, the arm being
// moved inside kickStoragePurchaseRecovery's own FIFO gate so a queued kick arms
// nothing, or a second admission path added with no kick at all. All three keep
// the literals in place and in order.
//
// The load-bearing detail is WHERE the hold is observed, and the first version of
// this file got it half right. Reading it after the awaited handshake proves only
// that a hold exists at SOME later moment. Reading it from inside the
// game.handleMessage spy is better but still not the ordering claim, because the
// only frame that arrives is one this test emits after that same await. So the
// primary observation is taken when ws_auth REGISTERS its permanent message
// handler (FakeWs.on below), which is a real happens-before: any kick pushed past
// that registration, by a timer, a microtask, or a plain relocation below the
// handler, reads false. The frame-time reading is kept as the weaker second arm,
// because it also proves the handler routes.
//
// ITS OWN FILE on purpose. The ladder-hold table and the recovery kick gate are
// process-global module state and a kick's chain outlives the case that started
// it, so sharing a file with the rest of the ws_auth suite would let a stray
// kick satisfy an arm for the wrong reason (and would leave that suite's ~30
// existing joins taking real holds).
import { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { ChatModerationLiveState } from '../../server/chat_mod_live';
import type { CharacterRow } from '../../server/db';
import { GeneralChatRateLimitLiveState } from '../../server/general_chat_quota';
import {
  configureStoragePurchaseRuntime,
  resetStoragePurchasesForTests,
  type StoragePurchaseHost,
  storagePurchaseInFlight,
} from '../../server/storage_purchases';
import { createWsAuth, type WsAuthDeps } from '../../server/ws_auth';
import { bufferHandshakeMessages } from '../../server/ws_buffer';
import { ONLINE_WORLD_AUTH_TYPE } from '../../src/world_api';

const CHARACTER = 7;

class FakeWs extends EventEmitter {
  send = vi.fn();
  close = vi.fn();
  readyState = 1;
  OPEN = 1;
  /** What `storagePurchaseInFlight` answered at the instant the PERMANENT message
   *  handler was registered. This, not the arrival of a frame, is the true
   *  happens-before pin: a frame the test emits itself necessarily arrives after
   *  the handshake promise settled, so observing there cannot distinguish "armed
   *  before the handler existed" from "armed by the time the await resolved". */
  holdAtHandlerRegistration: boolean[] = [];
  observeHold: (() => boolean) | null = null;
  override on(event: string, fn: (...args: unknown[]) => void): this {
    if (event === 'message' && this.observeHold) {
      this.holdAtHandlerRegistration.push(this.observeHold());
    }
    return super.on(event, fn) as this;
  }
}

const asWs = (ws: FakeWs): WebSocket => ws as unknown as WebSocket;

// A scan that NEVER answers, so the provisional hold cannot be released before
// the assertion runs. That is the point of the fixture rather than a shortcut:
// the covenant is about the window between the join and the scan's answer.
function neverAnsweringHost(): StoragePurchaseHost {
  return {
    resolveLiveCharacter: () => ({ characterId: CHARACTER, pid: 1 }),
    grant: () => ({ status: 'fits' }),
    stageAppliedEffect: vi.fn(() => true),
    saveCharacter: async () => true,
    spend: vi.fn(),
    db: {
      begin: vi.fn(),
      byKey: vi.fn(),
      settle: vi.fn(),
      discardWithoutDebit: vi.fn(),
      pendingFor: () => new Promise(() => {}),
    },
    realm: 'test',
    warn: vi.fn(),
  } as unknown as StoragePurchaseHost;
}

function setup() {
  const ws = new FakeWs();
  // characterId is what the kick is keyed on; the rest of the ws_auth suite
  // omits it, which is why its ~30 joins kick with `undefined`.
  const session = { pid: 1, characterId: CHARACTER, tag: 'covenant-session' };
  const game = {
    isIpBlocked: vi.fn(() => false),
    countIpSessions: vi.fn(() => 0),
    hasSessionForCharacter: vi.fn(() => false),
    join: vi.fn(() => session),
    clients: { size: 1 },
    handleMessage: vi.fn(),
    leave: vi.fn(async () => {}),
    socketClosed: vi.fn(() => true),
    beginGeneralChatRateLimitHydration: vi.fn((accountId: number) =>
      new GeneralChatRateLimitLiveState().beginHydration(accountId),
    ),
    beginChatModerationHydration: vi.fn((accountId: number) =>
      new ChatModerationLiveState().beginHydration(accountId),
    ),
  };
  const deps: WsAuthDeps = {
    game: game as unknown as WsAuthDeps['game'],
    accountAndScopeForToken: vi.fn(async () => ({ accountId: 1, scope: 'full' as const })),
    moderationStatusForAccount: vi.fn(async () => ({
      state: 'active' as const,
      bannedUntil: null,
      reason: '',
    })),
    getCharacter: vi.fn(
      async () =>
        ({
          id: CHARACTER,
          account_id: 1,
          name: 'Aldric',
          class: 'warrior',
          level: 10,
          state: null,
          is_gm: false,
          force_rename: false,
        }) as unknown as CharacterRow | null,
    ),
    chatMuteStatusForAccount: vi.fn(async () => ({ mutedUntil: null, reason: '' })),
    adminRolesForAccount: vi.fn(async () => null),
    permissionsForRoles: vi.fn((roles: readonly string[]) => new Set<string>(roles)),
    metaRequestUserData: vi.fn(() => ({ fbp: null, fbc: null })),
    metaEventSourceUrl: vi.fn(() => undefined),
    loadAccountCosmetics: vi.fn(async () => ({
      completedQuestIds: [],
      mechChromaIds: [],
      weaponSkinIds: [],
      weaponSkinLoadout: {},
    })),
    acquireCharacterLease: vi.fn(async () => true),
    releaseCharacterLease: vi.fn(async () => {}),
    bankBonusForAccount: vi.fn(async () => ({ bonusSlots: 0, sources: [], characterCount: 1 })),
    isConnectionRefused: vi.fn(() => false),
    bufferHandshakeMessages,
    requestMetadata: vi.fn(() => ({ ip: '1.2.3.4', userAgent: 'ua' })),
    maxWsPerIpHard: 20,
    maxPlayersPerRealm: 0,
  } as unknown as WsAuthDeps;
  return { ws, game, session, deps, req: {} as http.IncomingMessage };
}

const authRaw = JSON.stringify({
  t: ONLINE_WORLD_AUTH_TYPE,
  token: 'tok',
  character: CHARACTER,
});

/** Drive one admission and report the hold as seen from BOTH observation points:
 *  `atRegistration` is read when ws_auth registers its permanent message handler
 *  (the ordering claim), `atFirstCommand` when a frame is dispatched through it
 *  (the routing claim). They answer different questions and the first is the
 *  stronger one. */
async function driveAdmission(
  resumeArm: boolean,
): Promise<{ atRegistration: boolean[]; atFirstCommand: boolean[] }> {
  const { ws, game, deps, req } = setup();
  if (resumeArm) game.hasSessionForCharacter.mockReturnValue(true);
  ws.observeHold = () => storagePurchaseInFlight(CHARACTER);
  const atFirstCommand: boolean[] = [];
  game.handleMessage.mockImplementation(() => {
    atFirstCommand.push(storagePurchaseInFlight(CHARACTER));
  });
  const { authenticateWebSocket } = createWsAuth(deps);
  await authenticateWebSocket(asWs(ws), authRaw, req);
  ws.emit('message', JSON.stringify({ cmd: 'bank_buy_slots' }));
  expect(game.handleMessage).toHaveBeenCalledTimes(1);
  // Exactly one permanent handler was registered, so the reading below is not an
  // average over several.
  expect(ws.holdAtHandlerRegistration.length).toBe(1);
  return { atRegistration: ws.holdAtHandlerRegistration, atFirstCommand };
}

describe('the login covenant: the gold rail is held before the first command', () => {
  beforeEach(() => {
    resetStoragePurchasesForTests();
  });
  afterEach(() => {
    resetStoragePurchasesForTests();
  });

  it('arms the provisional hold before a fresh join registers its message handler', async () => {
    const host = neverAnsweringHost();
    configureStoragePurchaseRuntime(() => host);
    const seen = await driveAdmission(false);
    // THE ORDERING CLAIM: the hold already existed when the handler that can
    // deliver a gold buy was attached. Any kick pushed past that registration,
    // by a timer, a microtask or a plain relocation, reads false here.
    expect(seen.atRegistration).toEqual([true]);
    // And it is still held when a frame actually routes.
    expect(seen.atFirstCommand).toEqual([true]);
  });

  it('arms it on the RESUME arm too, which the source pin cannot see', async () => {
    // ws_auth has two game.join call sites and both fall through one common
    // tail. A kick moved into the fresh-lease arm alone would leave every
    // resume and in-process takeover reaching a live handler with the gold rail
    // open, and the textual ordering pin would stay green.
    const host = neverAnsweringHost();
    configureStoragePurchaseRuntime(() => host);
    const seen = await driveAdmission(true);
    expect(seen.atRegistration).toEqual([true]);
    expect(seen.atFirstCommand).toEqual([true]);
  });

  it('CONTROL: with no storage runtime configured the hold is absent', async () => {
    // The negative arm that makes the two above mean something at BOTH
    // observation points. Without it a `storagePurchaseInFlight` that returned
    // true unconditionally, or a hold left over from another case, would
    // satisfy them.
    const seen = await driveAdmission(false);
    expect(seen.atRegistration).toEqual([false]);
    expect(seen.atFirstCommand).toEqual([false]);
  });
});
