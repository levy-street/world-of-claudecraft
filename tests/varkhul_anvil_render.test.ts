import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/render/renderer';
import { VARKHUL_ANVILS_DECREE_CAST_ID } from '../src/sim/encounters/varkhul';
import type { SimEvent } from '../src/sim/types';

interface EventHarness {
  handleEvent(event: SimEvent): void;
}

function anvilImpactHarness() {
  const burst = vi.fn();
  const burstLater = vi.fn();
  const spawnAoeRing = vi.fn();
  const addShake = vi.fn();
  const renderer = Object.create(Renderer.prototype) as EventHarness & Record<string, unknown>;
  renderer.warlockMeteorFx = {};
  renderer.views = new Map();
  renderer.abilityVfx = { handleSpellfxAt: vi.fn().mockReturnValue(false) };
  renderer.sim = { cfg: { seed: 42 } };
  renderer.vfx = { burst, burstLater };
  renderer.spawnAoeRing = spawnAoeRing;
  renderer.addShake = addShake;
  return { renderer: renderer as EventHarness, burst, burstLater, spawnAoeRing, addShake };
}

describe("Varkhul's Anvil impact rendering", () => {
  it('renders a central fire burst without a ground ring or camera shake', () => {
    const { renderer, burst, burstLater, spawnAoeRing, addShake } = anvilImpactHarness();
    const event: SimEvent = {
      type: 'spellfxAt',
      x: 12,
      z: -4,
      school: 'fire',
      fx: 'nova',
      sourceId: 81,
      ability: VARKHUL_ANVILS_DECREE_CAST_ID,
    };

    renderer.handleEvent(event);

    expect(burst).toHaveBeenCalledWith(expect.any(THREE.Vector3), 'fire', 34, 1.4);
    // the decree strike is a hammer blow on the anvil: the strike route also
    // schedules the delayed spark shower for the clip's contact moment
    expect(burstLater).toHaveBeenCalledOnce();
    expect(burstLater.mock.calls[0][1]).toBe(12);
    expect(burstLater.mock.calls[0][3]).toBe(-4);
    expect(burstLater.mock.calls[0][4]).toBe('physical');
    expect(spawnAoeRing).not.toHaveBeenCalled();
    expect(addShake).not.toHaveBeenCalled();
  });
});
