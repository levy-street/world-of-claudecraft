// handleEvent's 'runeCircle' arm forwards the emitted mechanic school to
// MageGroundFx.spawnRune. Before this fix the call site dropped ev.school on
// the floor, so every windup telegraph (a fire boss's stomp, a frost boss's
// pulse) rode spawnRune's hardcoded arcane tint (issue #2917 point 3): a fire
// boss wound up behind a violet ring that did not read as danger.
import { describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/render/renderer';
import type { SimEvent } from '../src/sim/types';

interface EventHarness {
  handleEvent(ev: SimEvent): void;
}

/** A renderer stripped to just what the 'spellfxAt' runeCircle arm touches. */
function runeCircleHarness() {
  const spawnRune = vi.fn();
  const renderer = Object.create(Renderer.prototype) as EventHarness & Record<string, unknown>;
  renderer.warlockMeteorFx = {};
  renderer.abilityVfx = { handleSpellfxAt: vi.fn().mockReturnValue(false) };
  // the Forgefather strike route reads sim.cfg.seed (and hands vfx along) on
  // every spellfxAt before the runeCircle arm; a rune event never matches its
  // gate, so empty stubs are enough
  renderer.sim = { cfg: { seed: 42 } };
  renderer.vfx = {};
  renderer.mageGroundFx = { spawnRune };
  return { harness: renderer as EventHarness, spawnRune };
}

type SpellfxAtEvent = Extract<SimEvent, { type: 'spellfxAt' }>;

function runeCircleEvent(school: string, overrides: Partial<SpellfxAtEvent> = {}): SpellfxAtEvent {
  return {
    type: 'spellfxAt',
    x: 12,
    z: -4,
    school,
    fx: 'runeCircle',
    radius: 5,
    duration: 3,
    ...overrides,
  };
}

describe('handleEvent spellfxAt runeCircle: forwards the emitted school to the ground ring', () => {
  it('passes the mechanic school through to spawnRune, not just position/radius/duration', () => {
    const { harness, spawnRune } = runeCircleHarness();

    harness.handleEvent(runeCircleEvent('fire'));

    expect(spawnRune).toHaveBeenCalledWith({
      x: 12,
      z: -4,
      radius: 5,
      duration: 3,
      school: 'fire',
    });
  });

  it('forwards a different school unchanged, so the tint tracks the real mechanic', () => {
    const { harness, spawnRune } = runeCircleHarness();

    harness.handleEvent(runeCircleEvent('frost'));

    expect(spawnRune).toHaveBeenCalledWith(expect.objectContaining({ school: 'frost' }));
  });

  it('still applies the radius/duration defaults on the same arm that forwards school', () => {
    const { harness, spawnRune } = runeCircleHarness();

    harness.handleEvent(runeCircleEvent('shadow', { radius: undefined, duration: undefined }));

    expect(spawnRune).toHaveBeenCalledWith({
      x: 12,
      z: -4,
      radius: 8,
      duration: 15,
      school: 'shadow',
    });
  });
});
