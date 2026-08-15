// Dense submitted-prefix bookkeeping for the toroidal blade-grass pool.
// Logical slots keep their stable world-cell ownership while active slots
// occupy [0, count), so rejected placements submit no zero-scale triangles.

export interface DenseSlotState {
  count: number;
  slotToDense: Int32Array;
  denseToSlot: Int32Array;
}

/** Add or update a logical slot and return its dense instance index. */
export function activateDenseSlot(state: DenseSlotState, slot: number): number {
  const current = state.slotToDense[slot];
  if (current >= 0) return current;
  const dense = state.count;
  if (dense >= state.denseToSlot.length) throw new RangeError('dense slot capacity exceeded');
  state.count++;
  state.slotToDense[slot] = dense;
  state.denseToSlot[dense] = slot;
  return dense;
}

/**
 * Remove a logical slot with a swap-remove. Returns the logical slot moved
 * into the gap, -1 when the removed slot was last, or -2 when it was inactive.
 */
export function deactivateDenseSlot(state: DenseSlotState, slot: number): number {
  const dense = state.slotToDense[slot];
  if (dense < 0) return -2;
  const lastDense = state.count - 1;
  const movedSlot = dense === lastDense ? -1 : state.denseToSlot[lastDense];
  if (movedSlot >= 0) {
    state.denseToSlot[dense] = movedSlot;
    state.slotToDense[movedSlot] = dense;
  }
  state.slotToDense[slot] = -1;
  state.denseToSlot[lastDense] = -1;
  state.count = lastDense;
  return movedSlot;
}
