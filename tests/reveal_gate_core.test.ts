import { describe, expect, it } from 'vitest';
import { createRevealGateCore } from '../src/render/reveal_gate_core';

describe('reveal gate core', () => {
  it('holds a cold key and fires exactly one compile request', () => {
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    expect(gate.state('village:0:0')).toBe('cold');
    expect(gate.allow('village:0:0')).toBe(false);
    expect(gate.state('village:0:0')).toBe('compiling');
    // Further consultations while compiling hold WITHOUT re-requesting: the
    // cull asks every frame and a request per frame would flood the queue.
    expect(gate.allow('village:0:0')).toBe(false);
    expect(gate.allow('village:0:0')).toBe(false);
    expect(requested).toEqual(['village:0:0']);
  });

  it('reveals after settle and never requests again', () => {
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    gate.allow('town');
    gate.settle('town');
    expect(gate.state('town')).toBe('warm');
    expect(gate.allow('town')).toBe(true);
    expect(gate.allow('town')).toBe(true);
    expect(requested).toEqual(['town']);
  });

  it('treats a settle for an unknown key as warm (fail-soft)', () => {
    const gate = createRevealGateCore(() => undefined);
    gate.settle('never-requested');
    expect(gate.state('never-requested')).toBe('warm');
    expect(gate.allow('never-requested')).toBe(true);
  });

  it('tracks keys independently', () => {
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    expect(gate.allow('a')).toBe(false);
    expect(gate.allow('b')).toBe(false);
    gate.settle('a');
    expect(gate.allow('a')).toBe(true);
    expect(gate.allow('b')).toBe(false);
    expect(requested).toEqual(['a', 'b']);
  });

  it('settle is idempotent', () => {
    const gate = createRevealGateCore(() => undefined);
    gate.allow('key');
    gate.settle('key');
    gate.settle('key');
    expect(gate.allow('key')).toBe(true);
  });
});
