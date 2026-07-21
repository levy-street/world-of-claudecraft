// Pure-core tests for the Protect Yumi HUD view model (src/ui/yumi_match_view.ts):
// snapshot-vs-live merging, phase handling, bench countdown precedence, the
// fairness guarantee (both bars always modeled while a match is visible), and
// the allocation contract (one reused container). Fed both a Sim-shaped and a
// wire-roundtripped (ClientWorld-mirror-shaped) ArenaInfo stub.

import { describe, expect, it } from 'vitest';
import { type YumiLiveState, yumiMatchView } from '../src/ui/yumi_match_view';
import type { ArenaInfo } from '../src/world_api';

function stubInfo(over: Partial<NonNullable<ArenaInfo['match']>['yumi']> = {}): ArenaInfo {
  const yumi = {
    team: 'A' as const,
    size: 3 as const,
    phase: 'active' as const,
    matchElapsed: 42,
    teleportIn: 18,
    suddenDeathIn: 558,
    damageTakenMult: 1,
    down: false,
    respawnIn: 0,
    yumiA: { entityId: 900, hp: 4200, maxHp: 5000, x: 8400, z: -1250, alive: true },
    yumiB: { entityId: 901, hp: 3100, maxHp: 5000, x: 8420, z: -1240, alive: true },
    teamA: [],
    teamB: [],
    ...over,
  };
  return {
    rating: 1500,
    wins: 0,
    losses: 0,
    standings: {} as ArenaInfo['standings'],
    format: 'yumi3',
    queued: false,
    queueSize: 0,
    match: {
      format: 'yumi3',
      state: yumi.phase === 'sudden' ? 'active' : (yumi.phase as 'countdown' | 'active' | 'over'),
      oppName: 'Them',
      oppClass: 'warrior',
      oppLevel: 10,
      oppPid: 2,
      allies: [],
      enemies: [],
      yumi,
    },
    ladder: [],
    ladders: {} as ArenaInfo['ladders'],
  };
}

const live: YumiLiveState = {
  seen: true,
  myHp: 3999,
  myMax: 5000,
  enemyHp: 2500,
  enemyMax: 5000,
  teleportIn: 7,
  suddenDeathIn: 431,
  suddenDeath: false,
};

describe('yumi match view', () => {
  it('is inactive without a yumi match or once the bout is over', () => {
    expect(yumiMatchView(null, null, 0).active).toBe(false);
    const info = stubInfo();
    // biome-ignore lint/style/noNonNullAssertion: stub always carries a match
    info.match!.yumi = undefined;
    expect(yumiMatchView(info, null, 0).active).toBe(false);
    expect(yumiMatchView(stubInfo({ phase: 'over' }), null, 0).active).toBe(false);
  });

  it('models BOTH bars from the snapshot (my side resolves by team)', () => {
    const m = yumiMatchView(stubInfo(), null, 0);
    expect(m.active).toBe(true);
    expect(m.myHp).toBe(4200);
    expect(m.enemyHp).toBe(3100);
    expect(m.myFrac).toBeCloseTo(0.84, 5);
    expect(m.enemyFrac).toBeCloseTo(0.62, 5);
    expect(m.teleportIn).toBe(18);
    // team B viewer sees the same cats mirrored
    const b = yumiMatchView(stubInfo({ team: 'B' }), null, 0);
    expect(b.myHp).toBe(3100);
    expect(b.enemyHp).toBe(4200);
  });

  it('prefers the event-fed live cache once a heartbeat was seen', () => {
    const m = yumiMatchView(stubInfo(), live, 0);
    expect(m.myHp).toBe(3999);
    expect(m.enemyHp).toBe(2500);
    expect(m.teleportIn).toBe(7);
    expect(m.suddenDeathIn).toBe(431);
    // ...but never during the countdown (no heartbeats flow yet)
    const c = yumiMatchView(stubInfo({ phase: 'countdown' }), live, 0);
    expect(c.myHp).toBe(4200);
    expect(c.phase).toBe('countdown');
  });

  it('sudden death zeroes the teleport countdown from either source', () => {
    const snap = yumiMatchView(stubInfo({ phase: 'sudden' }), null, 0);
    expect(snap.suddenDeath).toBe(true);
    expect(snap.teleportIn).toBe(0);
    expect(snap.suddenDeathIn).toBe(0);
    // ...and the snapshot countdown passes through while active
    expect(yumiMatchView(stubInfo(), null, 0).suddenDeathIn).toBe(558);
    const viaLive = yumiMatchView(stubInfo(), { ...live, suddenDeath: true }, 0);
    expect(viaLive.suddenDeath).toBe(true);
    expect(viaLive.teleportIn).toBe(0);
  });

  it('bench countdown: the local event-seeded timer wins, snapshot seeds a reconnect', () => {
    const localTicking = yumiMatchView(stubInfo(), null, 6.4);
    expect(localTicking.down).toBe(true);
    expect(localTicking.respawnIn).toBe(7);
    const reconnect = yumiMatchView(stubInfo({ down: true, respawnIn: 4 }), null, 0);
    expect(reconnect.down).toBe(true);
    expect(reconnect.respawnIn).toBe(4);
    const alive = yumiMatchView(stubInfo(), null, 0);
    expect(alive.down).toBe(false);
    expect(alive.respawnIn).toBe(0);
  });

  it('same input, same output for a Sim-shaped and a wire-roundtripped stub', () => {
    const simShaped = stubInfo();
    const wireShaped = JSON.parse(JSON.stringify(simShaped)) as ArenaInfo;
    const a = { ...yumiMatchView(simShaped, live, 3) };
    const b = { ...yumiMatchView(wireShaped, live, 3) };
    expect(b).toEqual(a);
  });

  it('reuses one preallocated container (allocation-light per-frame core)', () => {
    const first = yumiMatchView(stubInfo(), null, 0);
    const second = yumiMatchView(stubInfo({ team: 'B' }), live, 2);
    expect(second).toBe(first);
  });
});
