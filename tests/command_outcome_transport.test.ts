// Regression coverage for the cmdWithOutcome extraction (src/net/online.ts ->
// src/net/command_outcomes.ts). This file targets a REAL behavior change the
// extraction briefly introduced, not the tracker in isolation
// (tests/command_outcomes.test.ts owns that) and not the disconnected/spectator
// gate (already exercised by tests/net_interaction_outcome.test.ts's "rejects
// locally when the command cannot be sent" / "rejects locally while
// spectating").
//
// THE REGRESSION (fixed): the pre-extraction inline code called `rawCmd(...)`
// INSIDE the `new Promise((resolve) => { ... })` executor, so a synchronous
// throw from `ws.send`/`JSON.stringify` was caught by the Promise machinery
// itself and surfaced as a REJECTED promise, never a synchronous throw out of
// the IWorld method. A first pass at the extraction moved that call OUTSIDE
// any executor (register() returning `{ rid, promise }`, with `rawCmd` called
// by the caller afterward), which let the same throw propagate synchronously
// out of cmdWithOutcome (and therefore lootCorpse/pickUpObject/etc.) instead
// of rejecting the returned Promise. CommandOutcomeTracker.register now takes
// the `send(rid)` callback itself and calls it INSIDE its own executor,
// restoring the original contract. This suite pins that ESTABLISHED contract
// (never throw synchronously; a send failure REJECTS the returned Promise,
// never silently resolves it to `false`) so it cannot regress again silently.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';

// Kept bespoke on purpose (issue #2088), mirroring tests/net_interaction_outcome.test.ts's
// own rig rather than tests/helpers/bare_client.ts's fuller default set: this
// suite only needs the WS transport plus the two fields cmdWithOutcome's gate
// reads (connected/spectating), so a `send` that throws stays the one thing
// under test.
function rig(sendImpl: (payload: string) => void) {
  const world: any = Object.create(ClientWorld.prototype);
  world.connected = true;
  world.spectating = null;
  world.ws = {
    readyState: WebSocket.OPEN,
    send: sendImpl,
    close: () => {},
  };
  world.sessionEnded = false;
  // endSession() (run by close(), below) unconditionally reads these two via
  // a `!== null` check, unlike its other bypassed-initializer fields (which
  // it reads with a truthy check `undefined` already satisfies): seed them to
  // their real class defaults or close() itself calls flushActionBarLayoutSave
  // and sends an unrelated 'save_hotbar_layout' frame through the SAME `send`
  // this suite is deliberately making throw.
  world.actionBarSaveTimer = null;
  world.actionBarSavePending = null;
  return world;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // Each test below also calls world.close() on its own success path (the
  // real lifecycle seam: endSession() -> failPendingCommandOutcomes() clears
  // any live 5s timeout), but that call is SKIPPED whenever an earlier
  // expect() in the test throws. clearAllTimers() is the unconditional
  // backstop that always runs here regardless: it only drops pending fake
  // timers, never touches a promise or its resolution, so it cannot mask or
  // alter a rejection this suite is asserting on.
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('cmdWithOutcome transport failure (regression: reject, never throw or silently succeed)', () => {
  it('a synchronous ws.send throw does not escape lootCorpse synchronously, and rejects the returned promise with that exact error', async () => {
    const thrown = new Error('ws send exploded');
    const world = rig(() => {
      throw thrown;
    });

    let outcome: Promise<boolean> | undefined;
    expect(() => {
      outcome = world.lootCorpse(101);
    }).not.toThrow();

    expect(outcome).toBeInstanceOf(Promise);
    // Established contract: a transport failure REJECTS the returned promise
    // with the real error, never resolves it to `false` (that would make a
    // send failure indistinguishable from an honest server refusal) and never
    // throws synchronously out of the IWorld method (every other cmdWithOutcome
    // consumer already assumes a Promise it can always .then/.catch/await).
    await expect(outcome).rejects.toBe(thrown);

    world.close();
  });
});

describe('cmdWithOutcome + onMessage integration survives the extraction', () => {
  it('a real commandOutcome frame resolves only the matching in-flight request', async () => {
    const sent: string[] = [];
    const world = rig((payload) => sent.push(payload));

    const first = world.lootCorpse(101);
    const second = world.lootCorpse(102);
    expect(sent).toHaveLength(2);

    // Read the ACTUAL wire schema off the sent frames rather than inventing
    // one: the outbound command is {"t":"cmd","cmd":"loot","id":<n>,"rid":<n>}
    // (rawCmd), and the matching server reply's schema is read straight off
    // online.ts's own onMessage guard: `msg.t === 'commandOutcome' &&
    // Number.isSafeInteger(msg.rid) && msg.rid > 0 && typeof msg.ok ===
    // 'boolean'`, i.e. {"t":"commandOutcome","rid":<n>,"ok":<bool>}.
    const firstCmd = JSON.parse(sent[0]) as { t: string; cmd: string; id: number; rid: number };
    const secondCmd = JSON.parse(sent[1]) as { t: string; cmd: string; id: number; rid: number };
    expect(firstCmd).toMatchObject({ t: 'cmd', cmd: 'loot', id: 101 });
    expect(secondCmd).toMatchObject({ t: 'cmd', cmd: 'loot', id: 102 });
    expect(Number.isSafeInteger(firstCmd.rid)).toBe(true);
    expect(Number.isSafeInteger(secondCmd.rid)).toBe(true);
    expect(firstCmd.rid).not.toBe(secondCmd.rid);

    // Resolve only the FIRST request's rid. Calling the real onMessage, not
    // the tracker directly: this is what proves ClientWorld's onMessage ->
    // resolveCommandOutcome -> CommandOutcomeTracker wiring survived the
    // extraction, not just the tracker class in isolation.
    world.onMessage(JSON.stringify({ t: 'commandOutcome', rid: firstCmd.rid, ok: true }));
    await expect(first).resolves.toBe(true);

    // The second request must still be genuinely pending: race it against a
    // flushed microtask queue rather than asserting on private tracker state.
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    // Now resolve the second, independently, with the OTHER outcome value.
    world.onMessage(JSON.stringify({ t: 'commandOutcome', rid: secondCmd.rid, ok: false }));
    await expect(second).resolves.toBe(false);

    world.close();
  });
});
