import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import {
  DEFAULT_NET_INTERVAL_MS,
  facingAlpha,
  POS_EXTRAPOLATION_CAP,
  remoteEntityAlpha,
} from '../src/render/net_interp_core';

// Regression for the "immobile characters strobe" report (prod capture,
// flicker-events.json): an idle mob's only record in minutes is a wander
// turn, so ClientWorld never learns netInterval (it only learns from gaps
// under 450 ms). The renderer then fell back to the global frame alpha,
// which cycles 0 -> 1 every sim tick, replaying the turn forever.

describe('remoteEntityAlpha', () => {
  it('offline (no net clock): uses the global frame alpha', () => {
    expect(remoteEntityAlpha(1000, undefined, undefined, 0.4)).toBe(0.4);
  });

  it('online with a measured cadence: interpolates on the entity clock', () => {
    expect(remoteEntityAlpha(1050, 1000, 100, 0.4)).toBeCloseTo(0.5);
    expect(remoteEntityAlpha(2000, 1000, 100, 0.4)).toBe(POS_EXTRAPOLATION_CAP);
  });

  it('online with UNKNOWN cadence: saturates once instead of cycling with the frame alpha', () => {
    const updatedAt = 1000;
    // simulate 3 seconds of frames with a cycling global alpha
    const rendered: number[] = [];
    for (let t = updatedAt; t < updatedAt + 3000; t += 16.7) {
      const cyclingAlpha = (((t / 50) % 1) + 1) % 1;
      rendered.push(remoteEntityAlpha(t, updatedAt, undefined, cyclingAlpha));
    }
    // monotonic non-decreasing (no replay of the transition); the fallback
    // clock earns no extrapolation, so it saturates at exactly 1
    for (let i = 1; i < rendered.length; i++) {
      expect(rendered[i]).toBeGreaterThanOrEqual(rendered[i - 1]);
    }
    expect(rendered[rendered.length - 1]).toBe(1);
    // the sweep completes over the fallback interval, not instantly
    expect(rendered[0]).toBeLessThan(0.2);
    expect(remoteEntityAlpha(updatedAt + DEFAULT_NET_INTERVAL_MS, updatedAt, undefined, 0)).toBe(1);
  });
});

describe('facingAlpha', () => {
  it('never extrapolates a turn past its target', () => {
    expect(facingAlpha(0.5)).toBe(0.5);
    expect(facingAlpha(1.25)).toBe(1);
  });
});

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot directly
// (the snapshots.test.ts idiom).
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = 'warrior';
  c.spectating = null;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.missingSince = new Map();
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  c.lastInputSentAt = 0;
  c.lastInputSig = '';
  c.inputSeq = 0;
  c.pendingInputSeqSentAt = new Map();
  c.ackedInputSeq = 0;
  c.inputEchoSamples = [];
  c.spectateFacingPending = false;
  c.pendingSpectateFacing = null;
  return c;
}

describe('ClientWorld prevFacing basis', () => {
  it('stays bounded in (-PI, PI] while a mob turns full circles across the seam', () => {
    const client = bareClient(1);
    const internals = client as unknown as { applySnapshot(snapshot: unknown): void };
    const wrap = (a: number) => {
      let d = a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return d;
    };
    const self = {
      id: 1,
      k: 'player',
      tid: 'warrior',
      nm: 'Watcher',
      lv: 10,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
      res: 0,
      mres: 100,
      rtype: 'rage',
    };
    const mob = (f: number, full = false) => ({
      id: 2,
      ...(full ? { k: 'mob', tid: 'forest_wolf', nm: 'Forest Wolf', lv: 5 } : {}),
      x: 3,
      y: 0,
      z: 3,
      f: +f.toFixed(2),
      hp: 50,
      mhp: 50,
    });
    internals.applySnapshot({ t: 'snap', ents: [mob(0, true)], self });
    // eight full revolutions in 0.5 rad steps; age the per-entity clock a full
    // interval before each record so the convergence alpha reaches 1 and
    // prevFacing tracks the turn (a fresh-clock record would barely move it)
    for (let k = 1; k <= 100; k++) {
      const tracked = client.entities.get(2);
      if (!tracked) throw new Error('mob entity missing');
      (tracked as any).netUpdatedAt = performance.now() - 130;
      internals.applySnapshot({ t: 'snap', ents: [mob(wrap(k * 0.5))], self });
      // without the wrap, prevFacing follows the turn around the circle and
      // grows by 2*PI per revolution
      expect(Math.abs(tracked.prevFacing)).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});
