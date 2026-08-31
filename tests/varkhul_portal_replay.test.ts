import { describe, expect, it, vi } from 'vitest';
import {
  buildVarkhulPortalReplayBatch,
  varkhulPortalReplayFrame,
} from '../server/varkhul_portal_replay';
import type { SimEvent } from '../src/sim/types';
import { VARKHUL_FORGE_PORTAL_ABILITY_ID } from '../src/sim/varkhul_forge_intermission';

function portalEvent(x: number, z: number): SimEvent {
  return {
    type: 'spellfxAt',
    x,
    z,
    school: 'fire',
    fx: 'burst',
    radius: 4,
    duration: 2,
    ability: VARKHUL_FORGE_PORTAL_ABILITY_ID,
  };
}

describe('Varkhul portal reconnect replay', () => {
  it('does not allocate the active-portal readout when nobody resumed', () => {
    const activeTelegraphs = vi.fn(() => [portalEvent(3, 5)]);

    const batch = buildVarkhulPortalReplayBatch(
      [{ needsVarkhulPortalReplay: false }, { needsVarkhulPortalReplay: false }],
      activeTelegraphs,
      90,
    );

    expect(activeTelegraphs).not.toHaveBeenCalled();
    expect(batch.events).toEqual([]);
    expect(batch.fragments).toEqual([]);
  });

  it('serializes one shared batch and replays only portals in the resumed viewer range', () => {
    const near = portalEvent(8, 0);
    const far = portalEvent(120, 0);
    const activeTelegraphs = vi.fn(() => [near, far]);

    const batch = buildVarkhulPortalReplayBatch(
      [{ needsVarkhulPortalReplay: true }, { needsVarkhulPortalReplay: true }],
      activeTelegraphs,
      90,
    );
    const frame = varkhulPortalReplayFrame(batch, { x: 0, y: 0, z: 0 }, new Map());

    expect(activeTelegraphs).toHaveBeenCalledTimes(1);
    expect(frame).not.toBeNull();
    expect(JSON.parse(frame ?? '')).toEqual({ t: 'events', list: [near] });
  });

  it('returns no replay frame when every active portal is outside interest range', () => {
    const batch = buildVarkhulPortalReplayBatch(
      [{ needsVarkhulPortalReplay: true }],
      () => [portalEvent(120, 0)],
      90,
    );

    expect(varkhulPortalReplayFrame(batch, { x: 0, y: 0, z: 0 }, new Map())).toBeNull();
  });
});
