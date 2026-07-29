import { describe, expect, it, vi } from 'vitest';
import {
  type HarborShipCueHandle,
  HarborShipCueRegistry,
} from '../src/render/harbor_ship_cue_registry';

interface Segment {
  id: string;
}

interface Handle extends HarborShipCueHandle<Segment> {
  id: string;
}

function parked(id: string): Handle {
  return { id, cueStartSec: null, segment: null };
}

function harness() {
  let now = 0;
  const segments: Record<string, Segment | undefined> = {
    castOff: { id: 'castOff' },
    openWater: { id: 'openWater' },
  };
  const activate = vi.fn((handle: Handle, segment: Segment, startSec: number) => {
    handle.segment = segment;
    handle.cueStartSec = startSec;
  });
  const reset = vi.fn((handle: Handle) => {
    handle.segment = null;
    handle.cueStartSec = null;
  });
  const registry = new HarborShipCueRegistry<Segment, Handle>({
    nowSec: () => now,
    segmentForCue: (cue) => segments[cue],
    activate,
    reset,
  });
  return {
    activate,
    registry,
    reset,
    setNow(value: number) {
      now = value;
    },
  };
}

describe('HarborShipCueRegistry', () => {
  it('applies a pre-build cue at its original start time', () => {
    const { activate, registry, setNow } = harness();
    const ship = parked('mainland');
    setNow(10);
    registry.cue('mainland', 'castOff');
    setNow(12);

    registry.register('mainland', ship);

    expect(activate).toHaveBeenCalledWith(ship, { id: 'castOff' }, 10);
    expect(ship.cueStartSec).toBe(10);
  });

  it('cancels pending work on reset and lets the latest pending cue win', () => {
    const { registry, setNow } = harness();
    const cancelled = parked('cancelled');
    setNow(10);
    registry.cue('cancelled', 'castOff');
    registry.resetAll();
    registry.register('cancelled', cancelled);
    expect(cancelled.segment).toBeNull();

    const latest = parked('latest');
    setNow(11);
    registry.cue('latest', 'castOff');
    setNow(13);
    registry.cue('latest', 'openWater');
    registry.register('latest', latest);
    expect(latest.segment).toEqual({ id: 'openWater' });
    expect(latest.cueStartSec).toBe(13);
  });

  it('keeps unknown cues parked before or after registration', () => {
    const { registry, reset } = harness();
    const pending = parked('pending');
    registry.cue('pending', 'unknown');
    registry.register('pending', pending);

    const registered = parked('registered');
    registry.register('registered', registered);
    registry.cue('registered', 'unknown');

    expect(pending.segment).toBeNull();
    expect(registered.segment).toBeNull();
    expect(reset).toHaveBeenCalledWith(pending);
    expect(reset).toHaveBeenCalledWith(registered);
  });

  it('activates registered ships and retires the prior ship on a cut', () => {
    const { registry, reset, setNow } = harness();
    const mainland = parked('mainland');
    const gullhaven = parked('gullhaven');
    registry.register('mainland', mainland);
    registry.register('gullhaven', gullhaven);

    setNow(2);
    registry.cue('mainland', 'castOff');
    setNow(6);
    registry.cue('gullhaven', 'openWater');

    expect(reset).toHaveBeenCalledWith(mainland);
    expect(mainland.segment).toBeNull();
    expect(gullhaven.segment).toEqual({ id: 'openWater' });
    expect(gullhaven.cueStartSec).toBe(6);
  });

  it('retires an active ship when the cut target registers after its cue', () => {
    const { registry, reset, setNow } = harness();
    const mainland = parked('mainland');
    const gullhaven = parked('gullhaven');
    registry.register('mainland', mainland);
    registry.cue('mainland', 'castOff');
    setNow(4);
    registry.cue('gullhaven', 'openWater');

    registry.register('gullhaven', gullhaven);

    expect(reset).toHaveBeenCalledWith(mainland);
    expect(mainland.segment).toBeNull();
    expect(gullhaven.cueStartSec).toBe(4);
  });
});
