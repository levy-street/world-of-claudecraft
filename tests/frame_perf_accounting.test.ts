import { describe, expect, it } from 'vitest';
import {
  FramePerfAccounting,
  type FramePerfNetworkStats,
  type FramePerfSink,
} from '../src/game/frame_perf_accounting';

interface TraceRecord {
  name: string;
  start: number;
  details: unknown[];
}

class FakeSink implements FramePerfSink {
  traceClock = 10;
  timeClock = 20;
  traces: TraceRecord[] = [];
  times: Array<{ bucket: string; start: number }> = [];
  networks: Array<FramePerfNetworkStats | null> = [];

  startTrace(): number {
    return this.traceClock++;
  }

  finishTrace(name: string, start: number, ...details: unknown[]): void {
    this.traces.push({ name, start, details });
  }

  startTime(): number {
    return this.timeClock++;
  }

  finishTime(bucket: 'sim' | 'events' | 'renderer' | 'hud', start: number): void {
    this.times.push({ bucket, start });
  }

  setNetwork(stats: FramePerfNetworkStats | null): void {
    this.networks.push(stats);
  }
}

describe('FramePerfAccounting', () => {
  it('preserves trace details and timed buckets for offline frame work', () => {
    const sink = new FakeSink();
    const accounting = new FramePerfAccounting(sink);

    accounting.beginTrace();
    accounting.finishTouchLook(16);
    accounting.beginTimedTrace();
    accounting.finishSimTick();
    accounting.beginTimedTrace();
    accounting.finishEvents('offline', 3);
    accounting.beginTrace();
    accounting.finishCamera('offline', 16, 0, -1);
    accounting.beginTimedTrace();
    accounting.finishRenderer('offline', 12, 0.5, 16);
    accounting.beginTimedTrace();
    accounting.finishHud('offline');

    expect(sink.traces).toEqual([
      { name: 'input.updateTouchLook', start: 10, details: ['frameDtMs', 16] },
      { name: 'sim.tick', start: 11, details: ['mode', 'offline'] },
      {
        name: 'hud.handleEvents',
        start: 12,
        details: ['mode', 'offline', 'events', 3],
      },
      {
        name: 'camera.follow',
        start: 13,
        details: ['mode', 'offline', 'frameDtMs', 16],
      },
      {
        name: 'renderer.sync',
        start: 14,
        details: ['mode', 'offline', 'views', 12, 'alpha', 0.5],
      },
      { name: 'hud.update', start: 15, details: ['mode', 'offline'] },
    ]);
    expect(sink.times).toEqual([
      { bucket: 'sim', start: 20 },
      { bucket: 'events', start: 21 },
      { bucket: 'renderer', start: 22 },
      { bucket: 'hud', start: 23 },
    ]);
  });

  it('preserves online-only trace details and reuses one network object', () => {
    const sink = new FakeSink();
    const accounting = new FramePerfAccounting(sink);

    accounting.beginTrace();
    accounting.finishCamera('online', 17, 0.75, 42);
    accounting.beginTimedTrace();
    accounting.finishRenderer('online', 19, 0.75, 17);
    accounting.publishOnlineNetwork(true, 49.6, 900, 1000, 0.754);
    accounting.publishOnlineNetwork(false, 50.4, 0, 1200, 1);

    expect(sink.traces).toEqual([
      {
        name: 'camera.follow',
        start: 10,
        details: ['mode', 'online', 'alpha', 0.75, 'frameDtMs', 17, 'lastSnapAge', 42],
      },
      {
        name: 'renderer.sync',
        start: 11,
        details: ['mode', 'online', 'views', 19, 'alpha', 0.75, 'frameDtMs', 17],
      },
    ]);
    expect(sink.networks).toHaveLength(2);
    expect(sink.networks[0]).toBe(sink.networks[1]);
    expect(sink.networks[1]).toEqual({
      connected: false,
      snapInterval: 50,
      lastSnapAge: -1,
      alpha: 1,
    });

    accounting.publishOfflineNetwork();
    expect(sink.networks[2]).toBeNull();
  });

  it('preserves every untimed input and HUD edge trace', () => {
    const sink = new FakeSink();
    const accounting = new FramePerfAccounting(sink);

    accounting.beginTrace();
    accounting.finishGamepad(17);
    accounting.beginTrace();
    accounting.finishHover(true);
    accounting.beginTrace();
    accounting.finishProfanityWords(42);
    accounting.beginTrace();
    accounting.finishInventoryChanged();
    accounting.beginTrace();
    accounting.finishCosmeticsChanged();
    accounting.beginTrace();
    accounting.finishClickMoveMarker();

    expect(sink.traces).toEqual([
      { name: 'input.gamepad', start: 10, details: ['frameDtMs', 17] },
      { name: 'input.hoverCursor', start: 11, details: ['active', true] },
      { name: 'hud.setProfanityWords', start: 12, details: ['words', 42] },
      { name: 'hud.onInventoryChanged', start: 13, details: [] },
      { name: 'hud.onCosmeticsChanged', start: 14, details: [] },
      { name: 'ui.clickMoveMarker', start: 15, details: [] },
    ]);
  });
});
