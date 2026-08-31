import { describe, expect, it } from 'vitest';
import { applyReconSelfWire, ReconWireState } from '../src/net/movement_reconciliation_wire';

describe('applyReconSelfWire', () => {
  it('advances previous authoritative facing on every v2 self sample', () => {
    const state = new ReconWireState();

    applyReconSelfWire(state, { rpx: 1, rpy: 2, rpz: 3, rpf: 0.25, ackCt: 0, ovE: 0 }, 2);
    expect(state.reconPreviousAuthoritativeFacing).toBe(0.25);
    expect(state.reconAuthoritativeFacing).toBe(0.25);

    applyReconSelfWire(state, { rpx: 2, rpy: 3, rpz: 4, rpf: 1.25, ackCt: 1, ovE: 0 }, 2);
    expect(state.reconPreviousAuthoritativeFacing).toBe(0.25);
    expect(state.reconAuthoritativeFacing).toBe(1.25);

    applyReconSelfWire(state, { rpx: 3, rpy: 4, rpz: 5, rpf: -0.5, ackCt: 2, ovE: 0 }, 2);
    expect(state.reconPreviousAuthoritativeFacing).toBe(1.25);
    expect(state.reconAuthoritativeFacing).toBe(-0.5);
  });
});
