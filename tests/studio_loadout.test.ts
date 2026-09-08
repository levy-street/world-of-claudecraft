import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { StudioSession } from '../src/vfx_studio/session';

describe('studio fighting discipline equipment', () => {
  it('uses a real two-handed weapon, paired Fury blades and a protection shield', () => {
    for (const spec of ['arms', 'fury', 'prot']) {
      const session = new StudioSession({ cls: 'warrior', spec, seed: 42, scene: 'sandbox' });
      const equipment = session.sim.players.get(session.sim.player.id)!.equipment;
      if (spec === 'prot') expect(ITEMS[equipment.offhand!]).toMatchObject({ shield: true });
      else {
        expect(ITEMS[equipment.mainhand!]).toMatchObject({ hand: 'twohand' });
        if (spec === 'fury') expect(ITEMS[equipment.offhand!]).toMatchObject({ hand: 'twohand' });
        else expect(equipment.offhand).toBeUndefined();
      }
    }
  });
});
