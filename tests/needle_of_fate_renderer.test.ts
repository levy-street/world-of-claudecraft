import { describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/render/renderer';
import type { SimEvent } from '../src/sim/types';

interface NeedleRendererHarness {
  handleEvent(event: SimEvent): void;
}

function makeHarness() {
  const needleSpawn = vi.fn();
  const beginCast = vi.fn();
  const endCast = vi.fn();
  const genericProjectile = vi.fn();
  const renderer = Object.create(Renderer.prototype) as NeedleRendererHarness & {
    needleOfFateVfx: {
      spawn: typeof needleSpawn;
      beginCast: typeof beginCast;
      endCast: typeof endCast;
    };
    vfx: { projectile: typeof genericProjectile };
    abilityVfx: { handleSpellfx: ReturnType<typeof vi.fn> };
    sim: { entities: Map<number, never> };
    views: Map<number, never>;
    triggerAttack: ReturnType<typeof vi.fn>;
  };
  renderer.needleOfFateVfx = { spawn: needleSpawn, beginCast, endCast };
  renderer.vfx = { projectile: genericProjectile };
  renderer.abilityVfx = { handleSpellfx: vi.fn(() => false) };
  renderer.sim = { entities: new Map<number, never>() };
  renderer.views = new Map<number, never>();
  renderer.triggerAttack = vi.fn();
  return { renderer, needleSpawn, beginCast, endCast, genericProjectile };
}

describe('Needle of Fate renderer routing', () => {
  it('consumes the discriminated projectile and preserves the generic fallback', () => {
    const needle = makeHarness();
    needle.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 11,
      targetId: 22,
      school: 'shadow',
      fx: 'projectile',
      ability: 'needle_of_fate',
    });
    expect(needle.needleSpawn).toHaveBeenCalledWith(11, 22);
    expect(needle.genericProjectile).not.toHaveBeenCalled();

    const fallback = makeHarness();
    fallback.renderer.handleEvent({
      type: 'spellfx',
      sourceId: 11,
      targetId: 22,
      school: 'shadow',
      fx: 'projectile',
    });
    expect(fallback.needleSpawn).not.toHaveBeenCalled();
    expect(fallback.genericProjectile).toHaveBeenCalledWith(11, 22, 'shadow');
  });

  it('routes Needle cast windup and stop events into the powerful VFX painter', () => {
    const harness = makeHarness();

    harness.renderer.handleEvent({
      type: 'castStart',
      entityId: 11,
      ability: 'needle_of_fate',
      time: 1.5,
    });
    expect(harness.beginCast).toHaveBeenCalledWith(11, 1.5);

    harness.renderer.handleEvent({ type: 'castStop', entityId: 11, success: true });
    expect(harness.endCast).toHaveBeenCalledWith(11);

    const interrupted = makeHarness();
    interrupted.renderer.handleEvent({ type: 'castStop', entityId: 11, success: false });
    expect(interrupted.endCast).toHaveBeenCalledWith(11);

    const other = makeHarness();
    other.renderer.handleEvent({
      type: 'castStart',
      entityId: 11,
      ability: 'shadow_bolt',
      time: 2,
    });
    expect(other.beginCast).not.toHaveBeenCalled();
  });
});
