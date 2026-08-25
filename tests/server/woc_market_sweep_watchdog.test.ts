// The sweep duration watchdog (server/woc_market_sweep_watchdog.ts): the
// mid-flight voice for a camping pass. The clock is injected and tick() is
// driven directly (the monitor's logTick idiom), so no fake timers anywhere.

import { describe, expect, it, vi } from 'vitest';
import {
  createWocMarketSweepWatchdog,
  WOC_MARKET_SWEEP_OVERRUN_WARN_MS,
} from '../../server/woc_market_sweep_watchdog';

function rig(warnMs?: number) {
  let clock = 5_000_000;
  const lines: string[] = [];
  const dog = createWocMarketSweepWatchdog({
    log: (line) => lines.push(line),
    now: () => clock,
    ...(warnMs === undefined ? {} : { warnMs }),
  });
  return {
    dog,
    lines,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('woc market sweep watchdog', () => {
  it('stays silent for a pass inside the bound', () => {
    const r = rig();
    r.dog.begin();
    r.dog.segment('expiry');
    r.advance(WOC_MARKET_SWEEP_OVERRUN_WARN_MS - 1);
    r.dog.tick();
    r.dog.end();
    expect(r.lines).toEqual([]);
    expect(r.dog.readout().overruns).toBe(0);
    expect(r.dog.readout().lastPassMs).toBe(WOC_MARKET_SWEEP_OVERRUN_WARN_MS - 1);
  });

  it('warns past the bound, naming the segment the pass is stuck in', () => {
    const r = rig(60_000);
    r.dog.begin();
    r.dog.segment('expiry');
    r.dog.segment('chain-polls');
    r.advance(60_000);
    r.dog.tick();
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain('sweep pass overrun');
    expect(r.lines[0]).toContain('60000ms');
    // The CURRENT segment, not the first: the operator needs to know where
    // the pass is stuck, and the chain segment is the expected culprit.
    expect(r.lines[0]).toContain('chain-polls');
    const readout = r.dog.readout();
    expect(readout.running).toBe(true);
    expect(readout.segment).toBe('chain-polls');
    expect(readout.overruns).toBe(1);
    expect(readout.lastOverrun).toEqual({
      segment: 'chain-polls',
      elapsedMs: 60_000,
      atMs: 5_060_000,
    });
  });

  it('repeats the warn each bound while running but scores ONE overrun per pass', () => {
    const r = rig(60_000);
    r.dog.begin();
    r.dog.segment('chain-polls');
    r.advance(60_000);
    r.dog.tick();
    // Inside the next bound: quiet (a camping pass is loud per minute, not
    // per tick).
    r.advance(1_000);
    r.dog.tick();
    expect(r.lines).toHaveLength(1);
    r.advance(60_000);
    r.dog.tick();
    expect(r.lines).toHaveLength(2);
    expect(r.dog.readout().overruns).toBe(1);
    r.dog.end();
    // A SECOND overrunning pass scores its own overrun.
    r.dog.begin();
    r.advance(61_000);
    r.dog.tick();
    expect(r.dog.readout().overruns).toBe(2);
  });

  it('end() clears the running state so a finished pass can never warn late', () => {
    const r = rig(60_000);
    r.dog.begin();
    r.dog.segment('delivery');
    r.advance(10_000);
    r.dog.end();
    r.advance(120_000);
    r.dog.tick();
    expect(r.lines).toEqual([]);
    const readout = r.dog.readout();
    expect(readout.running).toBe(false);
    expect(readout.segment).toBeNull();
    expect(readout.elapsedMs).toBe(0);
    expect(readout.lastPassMs).toBe(10_000);
  });

  it('a throwing log sink never escapes tick (the beat-never-throws contract)', () => {
    let clock = 0;
    const dog = createWocMarketSweepWatchdog({
      log: () => {
        throw new Error('sink died');
      },
      now: () => clock,
      warnMs: 1_000,
    });
    dog.begin();
    clock += 2_000;
    expect(() => dog.tick()).not.toThrow();
    expect(dog.readout().overruns).toBe(1);
  });

  it('arms ONE unref-ed interval at the documented quarter-bound period, and stop() clears it', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    try {
      const dog = createWocMarketSweepWatchdog({ log: () => {}, now: () => 0 });
      dog.begin();
      dog.begin();
      // One shared interval across passes; hasRef() false is the pin that
      // catches a deleted unref (every Node Timeout HAS the method, so a
      // typeof check would stay green with the call removed) - without it a
      // live handle holds the process open through every shutdown.
      expect(spy).toHaveBeenCalledTimes(1);
      const handle = spy.mock.results[0]?.value as NodeJS.Timeout;
      expect(handle.hasRef()).toBe(false);
      expect(spy.mock.calls[0]?.[1]).toBe(15_000);
      dog.stop();
      // Idempotent, and a fresh begin() re-arms.
      dog.stop();
      dog.begin();
      expect(spy).toHaveBeenCalledTimes(2);
      dog.stop();
    } finally {
      spy.mockRestore();
    }
  });

  it('the default bound is one confirm timeout', () => {
    // 60s = the proxy's CONFIRM_TIMEOUT_MS: one hung chain confirm may
    // legitimately pin a pass that long, so warning earlier would page on
    // routine brownouts.
    expect(WOC_MARKET_SWEEP_OVERRUN_WARN_MS).toBe(60_000);
  });

  it('the timer period never drops below one second (a tiny warnMs must not spin the loop)', () => {
    const spy = vi.spyOn(global, 'setInterval');
    try {
      const dog = createWocMarketSweepWatchdog({ log: () => {}, warnMs: 400, now: () => 0 });
      dog.begin();
      // warnMs / 4 would be 100ms; the floor clamps the shared interval to
      // 1000 so a mis-set bound can never turn the idle watchdog into load.
      expect(spy.mock.calls.at(-1)?.[1]).toBe(1_000);
      dog.stop();
    } finally {
      spy.mockRestore();
    }
  });
});
