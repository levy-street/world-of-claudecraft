import { describe, expect, it } from 'vitest';
import { LatencyLink, type LatencyLinkConfig } from './helpers/latency_link';
import { VirtualClock } from './helpers/virtual_clock';

// The transport half of the simulated-latency movement harness. The contract
// under test is TCP's: ordered, lossless, head-of-line blocked. A link that
// quietly reordered or dropped a frame would make every movement scenario built
// on it measure a failure mode the real client never sees.

interface Delivery {
  at: number;
  payload: string;
}

function linkOf(clock: VirtualClock, config: LatencyLinkConfig): [LatencyLink, Delivery[]] {
  const link = new LatencyLink(clock, config);
  const got: Delivery[] = [];
  link.onDeliverToServer((payload) => got.push({ at: clock.now(), payload }));
  link.onDeliverToClient((payload) => got.push({ at: clock.now(), payload }));
  return [link, got];
}

const noJitter = (baseMs: number): LatencyLinkConfig => ({
  toServer: { baseMs, jitterMs: 0, seed: 7 },
  toClient: { baseMs, jitterMs: 0, seed: 8 },
});

describe('LatencyLink delivery', () => {
  it('delivers at a constant one-way delay, in send order, per direction', () => {
    const clock = new VirtualClock();
    const link = new LatencyLink(clock, {
      toServer: { baseMs: 40, jitterMs: 0, seed: 1 },
      toClient: { baseMs: 90, jitterMs: 0, seed: 2 },
    });
    const toServer: Delivery[] = [];
    const toClient: Delivery[] = [];
    link.onDeliverToServer((payload) => toServer.push({ at: clock.now(), payload }));
    link.onDeliverToClient((payload) => toClient.push({ at: clock.now(), payload }));

    link.clientSend('in-1');
    link.serverSend('snap-1');
    clock.advanceBy(10);
    link.clientSend('in-2');

    clock.advanceBy(200);

    expect(toServer).toEqual([
      { at: 40, payload: 'in-1' },
      { at: 50, payload: 'in-2' },
    ]);
    expect(toClient).toEqual([{ at: 90, payload: 'snap-1' }]);
    expect(link.pending('toServer')).toBe(0);
  });

  it('never delivers a later message before a delayed one (head-of-line blocking)', () => {
    // Pinned draws: seed 1 on this Rng yields 0.6271 then 0.0027, so over a
    // 100 ms jitter band the first message draws ~62.7 ms and the second ~0.3
    // ms. Sent 10 ms apart, a naive per-message model would deliver the SECOND
    // at ~10.3 ms, ahead of the first. TCP cannot do that.
    const clock = new VirtualClock();
    const [link, got] = linkOf(clock, {
      toServer: { baseMs: 0, jitterMs: 100, seed: 1 },
      toClient: { baseMs: 0, jitterMs: 0, seed: 2 },
    });

    link.clientSend('first');
    clock.advanceBy(10);
    link.clientSend('second');

    // Past the moment the second message would have landed on its own draw.
    clock.advanceTo(30);
    expect(got).toEqual([]);

    clock.advanceTo(200);
    expect(got.map((d) => d.payload)).toEqual(['first', 'second']);
    expect(got[0].at).toBeGreaterThan(60);
    expect(got[1].at).toBeGreaterThanOrEqual(got[0].at);
    // Clamped onto the message ahead of it, not re-drawn.
    expect(got[1].at).toBe(got[0].at);
  });

  it('holds everything in flight until a stall lifts, order preserved', () => {
    const clock = new VirtualClock();
    const [link, got] = linkOf(clock, noJitter(50));

    link.clientSend('a');
    link.stall('toServer', 200);
    clock.advanceBy(20);
    link.clientSend('b');

    clock.advanceTo(199);
    expect(got).toEqual([]);

    clock.advanceTo(400);
    expect(got).toEqual([
      { at: 200, payload: 'a' },
      { at: 200, payload: 'b' },
    ]);

    // The pipe recovers: a send after the stall window pays only its delay.
    link.clientSend('c');
    clock.advanceBy(60);
    expect(got[2]).toEqual({ at: 450, payload: 'c' });
  });

  it('reports queued UTF-8 payload bytes until delivery drains them', () => {
    const clock = new VirtualClock();
    const [link] = linkOf(clock, noJitter(50));

    link.clientSend('abc');
    link.clientSend('Å');
    expect(link.pendingBytes('toServer')).toBe(5);

    clock.advanceBy(50);
    expect(link.pendingBytes('toServer')).toBe(0);
  });

  it('stalls one direction only', () => {
    const clock = new VirtualClock();
    const [link, got] = linkOf(clock, noJitter(50));

    link.clientSend('up');
    link.serverSend('down');
    link.stall('toServer', 300);

    clock.advanceTo(100);
    expect(got).toEqual([{ at: 50, payload: 'down' }]);

    clock.advanceTo(400);
    expect(got.map((d) => d.payload)).toEqual(['down', 'up']);
  });

  it('never delivers anything after a disconnect, in either direction', () => {
    const clock = new VirtualClock();
    const [link, got] = linkOf(clock, noJitter(50));

    link.clientSend('in-flight-up');
    link.serverSend('in-flight-down');
    clock.advanceBy(10);
    link.disconnect();

    clock.advanceBy(1000);
    expect(got).toEqual([]);
    expect(link.connected).toBe(false);
    expect(link.pending('toServer')).toBe(0);
    expect(link.pending('toClient')).toBe(0);

    link.clientSend('after');
    clock.advanceBy(1000);
    expect(got).toEqual([]);
  });

  it('passes payloads through byte-identical', () => {
    const clock = new VirtualClock();
    const [link, got] = linkOf(clock, noJitter(25));
    const frames = [
      '{"t":"in","f":1,"seq":12}',
      '{"t":"cmd","cmd":"chat","text":"  spaced \\" quote \\\\ backslash  "}',
      '{"t":"snap","name":"Grunhilda Åæø","zone":"Vale du Rêve"}',
      '',
    ];
    for (const frame of frames) link.clientSend(frame);

    clock.advanceBy(100);

    expect(got.map((d) => d.payload)).toEqual(frames);
    for (let i = 0; i < frames.length; i++) {
      expect(got[i].payload.length).toBe(frames[i].length);
    }
  });

  it('applies a mid-scenario latency change to later sends only', () => {
    const clock = new VirtualClock();
    const [link, got] = linkOf(clock, noJitter(20));

    link.clientSend('cheap');
    link.setLatency('toServer', 300, 0);
    link.clientSend('expensive');

    clock.advanceBy(500);
    expect(got).toEqual([
      { at: 20, payload: 'cheap' },
      { at: 300, payload: 'expensive' },
    ]);
  });

  it('is deterministic: the same seed replays the same delivery schedule', () => {
    const run = (): Delivery[] => {
      const clock = new VirtualClock();
      const [link, got] = linkOf(clock, {
        toServer: { baseMs: 35, jitterMs: 40, seed: 20061 },
        toClient: { baseMs: 60, jitterMs: 90, seed: 4242 },
      });
      for (let i = 0; i < 12; i++) {
        link.clientSend(`in-${i}`);
        link.serverSend(`snap-${i}`);
        if (i === 5) link.stall('toClient', clock.now() + 120);
        clock.advanceBy(50);
      }
      clock.advanceBy(1000);
      return got;
    };

    const first = run();
    const second = run();
    expect(first.length).toBe(24);
    expect(second).toEqual(first);
    // Not a constant-schedule self-comparison: the jitter really moved the
    // deliveries off the fixed base delay.
    const inbound = first.filter((d) => d.payload.startsWith('in-'));
    expect(new Set(inbound.map((d) => d.at - Math.floor(d.at / 50) * 50)).size).toBeGreaterThan(1);
  });
});
