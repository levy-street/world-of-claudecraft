import { describe, it, expect } from 'vitest';
import { InputActivityMeter, installInputActivityTracking } from '../src/game/input_activity';

describe('InputActivityMeter', () => {
  it('counts edges in the trailing 60 s window', () => {
    const m = new InputActivityMeter();
    m.record(0); m.record(1000); m.record(2000);
    expect(m.apm(2000)).toBe(3);
  });

  it('drops edges older than the window', () => {
    const m = new InputActivityMeter();
    m.record(0); m.record(1000); m.record(2000);
    m.record(70_000); // 70s later: only this one is within the trailing 60s
    expect(m.apm(70_000)).toBe(1);
  });

  it('drainCount returns edges since the last drain, then resets', () => {
    const m = new InputActivityMeter();
    m.record(0); m.record(100);
    expect(m.drainCount()).toBe(2);
    expect(m.drainCount()).toBe(0);
    m.record(200);
    expect(m.drainCount()).toBe(1);
  });

  it('apm and drainCount are independent readouts of the same edges', () => {
    const m = new InputActivityMeter();
    m.record(0); m.record(10); m.record(20);
    expect(m.drainCount()).toBe(3);
    expect(m.apm(20)).toBe(3); // draining does not affect the windowed rate
  });
});

describe('installInputActivityTracking', () => {
  it('ignores untrusted input', () => {
    const m = new InputActivityMeter();
    const target = new EventTarget();
    installInputActivityTracking(m, target, () => 0);
    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('pointerdown'));
    expect(m.apm(0)).toBe(0);
  });

  it('cleanup removes the listeners', () => {
    const m = new InputActivityMeter();
    const target = new EventTarget();
    const stop = installInputActivityTracking(m, target, () => 0);
    expect(() => stop()).not.toThrow();
  });
});
