// The client hold-to-grab side of the Yumi mystery power-ups: the pure decision
// logic (which ready orb, if any, the local player should channel and the
// mystery-aura "already holding" check), the stateful YumiGrabDriver that
// edge-sends intent and RE-sends it after a server-side cancel (stun), and the
// ClientWorld heartbeat fold that keeps the mirrored orb positions fresh online
// (the arena wire alone is rate-limited ~10s, coarser than the 4s telegraph).

import { describe, expect, it } from 'vitest';
import {
  carriesMysteryPowerup,
  pickGrabbableOrb,
  YUMI_GRAB_RESEND_FRAMES,
  YumiGrabDriver,
} from '../src/game/yumi_grab';
import { ClientWorld } from '../src/net/online';
import type { IWorld } from '../src/world_api';

const orb = (id: number, x: number, z: number, state: 'ready' | 'spawning' = 'ready') => ({
  id,
  x,
  z,
  state,
  frac: 1,
});

const base = { x: 0, z: 0, holding: false, interactHeld: true, dead: false };

describe('pickGrabbableOrb', () => {
  it('picks the nearest READY orb within radius while Interact is held', () => {
    const orbs = [orb(1, 0.5, 0), orb(2, 2, 0)];
    expect(pickGrabbableOrb(base, orbs, 2.5)).toBe(1);
  });

  it('returns null when no orb is within reach', () => {
    expect(pickGrabbableOrb(base, [orb(1, 10, 0)], 2.5)).toBeNull();
  });

  it('ignores orbs still telegraphing (state !== ready)', () => {
    expect(pickGrabbableOrb(base, [orb(1, 0.5, 0, 'spawning')], 2.5)).toBeNull();
  });

  it('returns null when Interact is not held, the player is dead, or already holding', () => {
    const orbs = [orb(1, 0.5, 0)];
    expect(pickGrabbableOrb({ ...base, interactHeld: false }, orbs, 2.5)).toBeNull();
    expect(pickGrabbableOrb({ ...base, dead: true }, orbs, 2.5)).toBeNull();
    expect(pickGrabbableOrb({ ...base, holding: true }, orbs, 2.5)).toBeNull();
  });
});

describe('carriesMysteryPowerup', () => {
  it('is true for any pu_* aura, false otherwise', () => {
    expect(carriesMysteryPowerup([{ kind: 'pu_invuln' }])).toBe(true);
    expect(carriesMysteryPowerup([{ kind: 'pu_stealth' }])).toBe(true);
    expect(carriesMysteryPowerup([{ kind: 'buff_ap' }, { kind: 'dot' }])).toBe(false);
    expect(carriesMysteryPowerup([])).toBe(false);
  });
});

// A minimal IWorld shape covering exactly what YumiGrabDriver reads: the arena
// mirror, the local player, and the two intent sends (recorded for assertions).
function fakeWorld(orbs: ReturnType<typeof orb>[], player: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const world = {
    arenaInfo: { match: { state: 'active', yumi: { groundPowerups: orbs } } },
    player: {
      pos: { x: 0, y: 0, z: 0 },
      auras: [] as { kind: string }[],
      dead: false,
      yumiGrabRemaining: 0,
      ...player,
    },
    yumiGrabStart: (id: number) => calls.push(`start:${id}`),
    yumiGrabStop: () => calls.push('stop'),
  };
  return { world: world as unknown as IWorld, raw: world, calls };
}

describe('YumiGrabDriver', () => {
  it('edge-sends start once and stays quiet while the authoritative channel is live', () => {
    const { world, raw, calls } = fakeWorld([orb(1, 0.5, 0)]);
    const d = new YumiGrabDriver();
    d.update(world, true, 2.5);
    expect(calls).toEqual(['start:1']);
    raw.player.yumiGrabRemaining = 1.8; // the server ack: channel running
    for (let i = 0; i < YUMI_GRAB_RESEND_FRAMES * 8; i++) d.update(world, true, 2.5);
    expect(calls).toEqual(['start:1']); // an unchanged live choice never spams the wire
  });

  it('re-sends start after a server-side cancel (stun) while Interact stays held', () => {
    // The regression this pins: the server cancels the channel on a stun, the
    // player keeps Interact held, and the client MUST re-express the intent
    // once the authoritative yumiGrabRemaining reads 0 again. Before the fix
    // the driver early-returned on an unchanged desired orb, so the bar never
    // came back until the player released and re-pressed Interact.
    const { world, raw, calls } = fakeWorld([orb(1, 0.5, 0)]);
    const d = new YumiGrabDriver();
    d.update(world, true, 2.5);
    raw.player.yumiGrabRemaining = 1.2; // channel live
    d.update(world, true, 2.5);
    raw.player.yumiGrabRemaining = 0; // server cancelled the channel (stunned)
    for (let i = 0; i <= YUMI_GRAB_RESEND_FRAMES; i++) d.update(world, true, 2.5);
    expect(calls.filter((c) => c === 'start:1').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps re-expressing intent while a start never sticks (stunned at press time)', () => {
    const { world, calls } = fakeWorld([orb(1, 0.5, 0)]);
    const d = new YumiGrabDriver();
    for (let i = 0; i <= YUMI_GRAB_RESEND_FRAMES * 3; i++) d.update(world, true, 2.5);
    expect(calls.filter((c) => c === 'start:1').length).toBeGreaterThanOrEqual(3);
  });

  it('sends stop on release and when the orb disappears out from under the channel', () => {
    const { world, raw, calls } = fakeWorld([orb(1, 0.5, 0)]);
    const d = new YumiGrabDriver();
    d.update(world, true, 2.5);
    d.update(world, false, 2.5); // Interact released
    expect(calls).toEqual(['start:1', 'stop']);
    d.update(world, true, 2.5); // re-press: a fresh grab of the same orb
    raw.arenaInfo.match.yumi.groundPowerups = []; // taken by someone else / timed out
    d.update(world, true, 2.5);
    expect(calls).toEqual(['start:1', 'stop', 'start:1', 'stop']);
  });

  it('never starts while already holding a power-up', () => {
    const { world, calls } = fakeWorld([orb(1, 0.5, 0)], { auras: [{ kind: 'pu_berserk' }] });
    const d = new YumiGrabDriver();
    for (let i = 0; i <= YUMI_GRAB_RESEND_FRAMES * 2; i++) d.update(world, true, 2.5);
    expect(calls).toEqual([]);
  });
});

// The other half of the online freshness fix: ClientWorld folds the 1/s (plus
// transition-forced) yumiStatus heartbeat's orb fields into its mirrored
// arenaInfo, because the `arena` snapshot field alone updates only every ~10s.
describe('ClientWorld yumiStatus fold', () => {
  const beat = (orbs: unknown[], nextIn: number) => ({
    type: 'yumiStatus',
    myHp: 1,
    myMax: 1,
    enemyHp: 1,
    enemyMax: 1,
    teleportIn: 0,
    suddenDeathIn: 0,
    suddenDeath: false,
    mult: 1,
    team: 'A',
    nextPowerupIn: nextIn,
    groundPowerups: orbs,
    pid: 7,
  });

  // A ClientWorld without the WebSocket plumbing (the bareClient idiom from
  // snapshots.test.ts), driven through the real `events` frame path so the
  // fold call site in onMessage is pinned too, not just the fold itself.
  const bare = (): any => {
    const c: any = Object.create(ClientWorld.prototype);
    c.eventQueue = [];
    return c;
  };

  it('an events frame refreshes the mirrored orbs + countdown immediately', () => {
    const c = bare();
    c.arenaInfo = {
      match: { state: 'active', yumi: { nextPowerupIn: 99, groundPowerups: [] } },
    };
    const orbs = [{ id: 3, x: 1, z: 2, state: 'ready', frac: 0.5 }];
    c.onMessage(JSON.stringify({ t: 'events', list: [beat(orbs, 0)] }));
    expect(c.arenaInfo.match.yumi.groundPowerups).toEqual(orbs);
    expect(c.arenaInfo.match.yumi.nextPowerupIn).toBe(0);
    // ...and a later beat clears a grabbed/expired orb without waiting for the
    // ~10s arena wire (the phantom-orb regression).
    c.onMessage(JSON.stringify({ t: 'events', list: [beat([], 42)] }));
    expect(c.arenaInfo.match.yumi.groundPowerups).toEqual([]);
    expect(c.arenaInfo.match.yumi.nextPowerupIn).toBe(42);
    // the events still reach the HUD queue unchanged
    expect(c.eventQueue.length).toBe(2);
  });

  it('is a safe no-op without a mirrored yumi match', () => {
    const c = bare();
    c.arenaInfo = null;
    expect(() => c.onMessage(JSON.stringify({ t: 'events', list: [beat([], 5)] }))).not.toThrow();
    c.arenaInfo = { match: null };
    expect(() => c.onMessage(JSON.stringify({ t: 'events', list: [beat([], 5)] }))).not.toThrow();
  });
});
