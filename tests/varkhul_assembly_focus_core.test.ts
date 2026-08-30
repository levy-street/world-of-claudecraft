import { describe, expect, it } from 'vitest';
import {
  type VarkhulAssemblyFocusState,
  type VarkhulAssemblyViewerFocus,
  varkhulAssemblyFocusPlan,
  varkhulAssemblyViewerFocusInto,
} from '../src/render/varkhul_assembly_focus_core';
import {
  VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET,
  VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS,
  VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS,
} from '../src/sim/varkhul_assembly';

function focusState(): VarkhulAssemblyFocusState {
  return {
    difficulty: 'heroic',
    phase: 'links',
    runes: Array.from({ length: 10 }, (_, symbol) => ({
      symbol,
      x: Math.sin((symbol * Math.PI * 2) / 10) * 15.5,
      z: Math.cos((symbol * Math.PI * 2) / 10) * 15.5,
      ownerAngle: (symbol * Math.PI * 2) / 10,
      trackRadius: VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS,
      assignedPlayerId: symbol < 5 ? 100 + symbol : null,
      locked: false,
      orphaned: false,
    })),
  };
}

describe('Varkhul Assembly personal focus', () => {
  it('focuses the local active rune, hides the waiting wave, and subdues teammates', () => {
    const state = focusState();
    const plan = varkhulAssemblyFocusPlan(state, {
      playerId: 100,
      x: 0,
      z: 0,
      assignedSymbol: 0,
    });

    expect(plan.focusedSymbol).toBe(0);
    expect(plan.focusKind).toBe('own');
    expect(plan.guideVisible).toBe(true);
    expect(plan.guideAngle).toBeCloseTo(0, 5);
    expect(plan.runeModes.slice(0, 5)).toEqual([
      'focused',
      'teammate',
      'teammate',
      'teammate',
      'teammate',
    ]);
    expect(plan.runeModes.slice(5)).toEqual(Array(5).fill('hidden'));
  });

  it('removes the navigation aids once the player reaches the station extent', () => {
    const state = focusState();
    const rune = state.runes[0];
    const interactionExtent =
      rune.trackRadius +
      VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET +
      VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS;
    const plan = varkhulAssemblyFocusPlan(state, {
      playerId: 100,
      x: rune.x,
      z: rune.z - interactionExtent + 0.01,
      assignedSymbol: 0,
    });

    expect(plan.focusedSymbol).toBe(0);
    expect(plan.guideVisible).toBe(false);
  });

  it('keeps the active group secondary for a waiting participant', () => {
    const plan = varkhulAssemblyFocusPlan(focusState(), {
      playerId: 107,
      x: 0,
      z: 0,
      assignedSymbol: 7,
    });

    expect(plan.focusedSymbol).toBeNull();
    expect(plan.runeModes.slice(0, 5)).toEqual(Array(5).fill('teammate'));
    expect(plan.runeModes.slice(5)).toEqual(Array(5).fill('hidden'));
  });

  it('gives an unassigned spectator an equal tactical overview of the active five', () => {
    const plan = varkhulAssemblyFocusPlan(focusState(), {
      playerId: 999,
      x: 0,
      z: 0,
      assignedSymbol: null,
    });

    expect(plan.focusedSymbol).toBeNull();
    expect(plan.runeModes.slice(0, 5)).toEqual(Array(5).fill('spectator'));
    expect(plan.runeModes.slice(5)).toEqual(Array(5).fill('hidden'));
  });

  it('redirects an adjacent locked owner to a Heroic orphan', () => {
    const base = focusState();
    const state = {
      ...base,
      runes: base.runes.map((rune) =>
        rune.symbol === 0
          ? { ...rune, assignedPlayerId: 100, orphaned: true }
          : rune.symbol === 1
            ? { ...rune, assignedPlayerId: 101, locked: true }
            : rune,
      ),
    };
    const plan = varkhulAssemblyFocusPlan(state, {
      playerId: 101,
      x: 0,
      z: 0,
      assignedSymbol: null,
    });

    expect(plan.focusedSymbol).toBe(0);
    expect(plan.focusKind).toBe('rescue');
    expect(plan.runeModes[0]).toBe('focused');
    expect(plan.runeModes[1]).toBe('sealed');
  });

  it('keeps physical rescue adjacency after online wire angle rounding', () => {
    const base = focusState();
    const state = {
      ...base,
      runes: base.runes.map((rune) => ({
        ...rune,
        ownerAngle: Number(rune.ownerAngle.toFixed(2)),
        orphaned: rune.symbol === 0,
        locked: rune.symbol === 1,
      })),
    };
    const plan = varkhulAssemblyFocusPlan(state, {
      playerId: 101,
      x: 0,
      z: 0,
      assignedSymbol: 1,
    });

    expect(plan.focusedSymbol).toBe(0);
    expect(plan.focusKind).toBe('rescue');
    expect(plan.guideVisible).toBe(true);
  });

  it('derives the viewer focus from the assembly assignment roster without allocating', () => {
    const output: VarkhulAssemblyViewerFocus = {
      playerId: Number.MIN_SAFE_INTEGER,
      x: 0,
      z: 0,
      assignedSymbol: null,
    };
    const assemblies = [
      {
        assignments: [
          { playerId: 100, symbol: 0 },
          { playerId: 103, symbol: 3 },
        ],
      },
    ];
    const filled = varkhulAssemblyViewerFocusInto(
      assemblies,
      { id: 103, pos: { x: 4, z: -7 } },
      output,
    );
    expect(filled).toBe(output);
    expect(filled).toEqual({ playerId: 103, x: 4, z: -7, assignedSymbol: 3 });
  });

  it('clears a stale assigned symbol for a viewer no roster names', () => {
    const output: VarkhulAssemblyViewerFocus = { playerId: 100, x: 1, z: 2, assignedSymbol: 0 };
    varkhulAssemblyViewerFocusInto(
      [{ assignments: [{ playerId: 101, symbol: 1 }] }],
      { id: 999, pos: { x: 0, z: 0 } },
      output,
    );
    expect(output).toEqual({ playerId: 999, x: 0, z: 0, assignedSymbol: null });
    varkhulAssemblyViewerFocusInto([], { id: 999, pos: { x: 5, z: 6 } }, output);
    expect(output.assignedSymbol).toBeNull();
    expect(output.x).toBe(5);
    expect(output.z).toBe(6);
  });

  it('does not focus an orphan for a non-neighbor', () => {
    const base = focusState();
    const state = {
      ...base,
      runes: base.runes.map((rune) =>
        rune.symbol === 0
          ? { ...rune, orphaned: true }
          : rune.symbol === 3
            ? { ...rune, assignedPlayerId: 103, locked: true }
            : rune,
      ),
    };
    const plan = varkhulAssemblyFocusPlan(state, {
      playerId: 103,
      x: 0,
      z: 0,
      assignedSymbol: null,
    });

    expect(plan.focusedSymbol).toBeNull();
    expect(plan.runeModes[0]).toBe('orphan');
  });
});
