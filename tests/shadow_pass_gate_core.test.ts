// Shadow-pass-only gate (src/render/shadow_pass_gate_core.ts): an instanced
// shadow proxy restores its instance count just before its shadow draw and
// zeroes it right after, so the color pass (which three runs AFTER the shadow
// pass inside the same render call, skipping instanced draws with count 0)
// never submits the clone.

import { describe, expect, it } from 'vitest';
import { attachShadowPassOnlyGate } from '../src/render/shadow_pass_gate_core';

interface FakeMesh {
  count: number;
  onBeforeShadow: unknown;
  onAfterShadow: unknown;
}

function gated(count: number): FakeMesh {
  const mesh: FakeMesh = { count, onBeforeShadow: null, onAfterShadow: null };
  attachShadowPassOnlyGate(mesh);
  return mesh;
}

describe('attachShadowPassOnlyGate', () => {
  it('starts color-invisible and restores the full count only for the shadow draw', () => {
    const mesh = gated(48);
    // attach zeroes immediately: no color draw before the first shadow pass
    expect(mesh.count).toBe(0);
    (mesh.onBeforeShadow as () => void)();
    expect(mesh.count).toBe(48);
    (mesh.onAfterShadow as () => void)();
    expect(mesh.count).toBe(0);
  });

  it('survives repeated frames and captures the count from attach time', () => {
    const mesh = gated(7);
    for (let frame = 0; frame < 3; frame++) {
      (mesh.onBeforeShadow as () => void)();
      expect(mesh.count).toBe(7);
      (mesh.onAfterShadow as () => void)();
      expect(mesh.count).toBe(0);
    }
  });

  it('lands at zero after multiple shadow-casting lights in one frame', () => {
    // three fires the hook pair once per shadow light; the world has one sun
    // today, but the gate must stay correct if a second caster ever ships:
    // each light sees the full count for its own draw, and the color pass
    // (after the last light) still sees zero.
    const mesh = gated(9);
    for (let light = 0; light < 3; light++) {
      (mesh.onBeforeShadow as () => void)();
      expect(mesh.count).toBe(9);
      (mesh.onAfterShadow as () => void)();
    }
    expect(mesh.count).toBe(0);
  });

  it('stays at zero when the shadow pass never runs (shadows off or culled)', () => {
    const mesh = gated(12);
    expect(mesh.count).toBe(0);
  });

  it('exposes the real count for cost telemetry', () => {
    const mesh = gated(48) as FakeMesh & { shadowPassFullCount?: number };
    // the budget report must not read the gated 0
    expect(mesh.shadowPassFullCount).toBe(48);
  });
});
