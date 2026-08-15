import { describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/render/renderer';
import type { SimEvent } from '../src/sim/types';

describe('Paladin combat VFX routing', () => {
  it('executes each Paladin spellfx route against the renderer collaborators', () => {
    const triggerAttack = vi.fn();
    const pulseAt = vi.fn();
    const vfx = {
      paladinHolyShock: vi.fn(),
      paladinSunwardDisc: vi.fn(),
      paladinSunwardDiscImpact: vi.fn(),
      paladinBastionSweep: vi.fn(),
      paladinBastionSweepImpact: vi.fn(),
      paladinDawnfall: vi.fn(),
      paladinDawnfallImpact: vi.fn(),
      paladinFinalEdict: vi.fn(),
    };
    const renderer = {
      sim: {
        player: { id: 1 },
        entities: new Map([[1, { facing: 1.25 }]]),
      },
      triggerAttack,
      pulseAt,
      vfx,
      // The spec-registry gate runs before the paladin switch; none of these fx
      // names are registry casts, so the real painter returns false too.
      abilityVfx: { handleSpellfx: vi.fn(() => false) },
    } as unknown as Renderer;
    const handle = (event: Record<string, unknown>) =>
      Renderer.prototype.handleEvent.call(renderer, event as SimEvent);

    handle({
      type: 'spellfx',
      fx: 'paladinHolyShock',
      sourceId: 1,
      targetId: 2,
      school: 'holy',
      impact: 'healing',
    });
    expect(vfx.paladinHolyShock).toHaveBeenCalledWith(1, 2, 'heal');

    handle({
      type: 'spellfx',
      fx: 'paladinSunwardDisc',
      sourceId: 1,
      targetId: 2,
      school: 'holy',
      level: 0,
      count: 3,
    });
    expect(triggerAttack).toHaveBeenCalledWith(1, 'sunward_disc');
    expect(vfx.paladinSunwardDisc).toHaveBeenCalledWith(1, 2, 0, 3);

    handle({
      type: 'spellfx',
      fx: 'paladinSunwardDiscImpact',
      sourceId: 1,
      targetId: 2,
      school: 'holy',
      level: 0,
      count: 3,
    });
    expect(vfx.paladinSunwardDiscImpact).toHaveBeenCalledWith(1, 2, 0, 3);

    handle({
      type: 'spellfx',
      fx: 'paladinBastionSweep',
      sourceId: 1,
      targetId: 1,
      school: 'holy',
      range: 6,
      angle: 180,
      facing: 0.75,
    });
    expect(triggerAttack).toHaveBeenCalledWith(1, 'bastion_sweep');
    expect(vfx.paladinBastionSweep).toHaveBeenCalledWith(1, 6, 180, 0.75);

    handle({
      type: 'spellfx',
      fx: 'paladinBastionSweepImpact',
      sourceId: 1,
      targetId: 2,
      school: 'holy',
    });
    expect(vfx.paladinBastionSweepImpact).toHaveBeenCalledWith(2);

    handle({
      type: 'spellfx',
      fx: 'paladinDawnfall',
      sourceId: 1,
      targetId: 1,
      school: 'holy',
      ability: 'dawnfall',
      range: 8,
    });
    expect(triggerAttack).toHaveBeenCalledWith(1, 'dawnfall');
    expect(vfx.paladinDawnfall).toHaveBeenCalledWith(1, 8);

    handle({
      type: 'spellfx',
      fx: 'paladinDawnfallImpact',
      sourceId: 1,
      targetId: 2,
      school: 'holy',
    });
    expect(vfx.paladinDawnfallImpact).toHaveBeenCalledWith(2);

    handle({
      type: 'spellfx',
      fx: 'paladinFinalEdict',
      sourceId: 1,
      targetId: 2,
      school: 'holy',
    });
    expect(vfx.paladinFinalEdict).toHaveBeenCalledWith(1, 2);
  });
});
