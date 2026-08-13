import { describe, expect, it } from 'vitest';
import type { Aura } from '../src/sim/types';
import { afflictionFateThreadCount, doomMeterState } from '../src/ui/hud/warlock/doom_meter_view';

function doom(stacks: number, remaining: number): Aura {
  return {
    id: 'affliction_doom',
    name: 'Condemnation',
    kind: 'affliction_doom',
    remaining,
    duration: 20,
    value: stacks,
    stacks,
    sourceId: 1,
    school: 'shadow',
  };
}

describe('Affliction Condemnation meter view', () => {
  const empty = (value: string, max: string) => `${value}/${max}:empty`;
  const timed = (value: string, max: string, seconds: number) => `${value}/${max}:${seconds}`;

  it('shows 0/100 for Affliction even before the first point is generated', () => {
    expect(doomMeterState({ affliction: true, auras: [] }, String, empty, timed)).toEqual({
      visible: true,
      value: 0,
      fillFrac: 0,
      warning: false,
      ready: false,
      fateThreads: 0,
      fateThreadsReady: false,
      label: '0 / 100',
      ariaValueText: '0/100:empty',
      fateThreadsAriaValueText: '0 / 3',
    });
  });

  it('exposes three Fate Threads as a distinct ready state beside Condemnation', () => {
    expect(
      doomMeterState(
        { affliction: true, auras: [doom(73, 12)], fateThreads: 3 },
        String,
        empty,
        timed,
      ),
    ).toMatchObject({
      value: 73,
      fateThreads: 3,
      fateThreadsReady: true,
    });
  });

  it('warns in the final five seconds and marks a full pool ready', () => {
    expect(
      doomMeterState({ affliction: true, auras: [doom(73, 4.2)] }, String, empty, timed),
    ).toMatchObject({
      value: 73,
      fillFrac: 0.73,
      warning: true,
      ready: false,
      label: '73 / 100',
      ariaValueText: '73/100:5',
    });
    expect(
      doomMeterState({ affliction: true, auras: [doom(100, 20)] }, String, empty, timed),
    ).toMatchObject({
      ready: true,
      warning: false,
    });
  });

  it('falls back to the wire value when one stack is omitted by compact snapshots', () => {
    const aura = doom(1, 20);
    aura.stacks = undefined;

    expect(doomMeterState({ affliction: true, auras: [aura] }, String, empty, timed)).toMatchObject(
      {
        value: 1,
        label: '1 / 100',
      },
    );
  });

  it('reads only Fate Threads attached to the owned primary Evil Eye', () => {
    const primaryEye: Aura = {
      ...doom(1, 20),
      id: 'evil_eye',
      kind: 'affliction_eye',
      sourceId: 7,
    };
    const ownedThreads: Aura = {
      ...doom(3, 12),
      id: 'needle_of_fate',
      kind: 'affliction_fate_threads',
      sourceId: 7,
    };
    const foreignThreads: Aura = {
      ...ownedThreads,
      sourceId: 9,
    };

    expect(
      afflictionFateThreadCount(
        [{ auras: [foreignThreads] }, { auras: [primaryEye, ownedThreads, foreignThreads] }],
        7,
      ),
    ).toBe(3);
    expect(afflictionFateThreadCount([{ auras: [ownedThreads] }], 7)).toBe(0);
  });

  it('hides outside Affliction', () => {
    expect(doomMeterState({ affliction: false, auras: [] }, String, empty, timed).visible).toBe(
      false,
    );
  });
});
