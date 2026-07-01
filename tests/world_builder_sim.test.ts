import { beforeEach, describe, expect, it } from 'vitest';

import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

// A minimal Sim with one player, used to drive prop placement + interaction.
function freshSim(): { sim: Sim; pid: number } {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Tester');
  return { sim, pid };
}

describe('Sim in-world Builder authority', () => {
  let h: ReturnType<typeof freshSim>;
  beforeEach(() => {
    h = freshSim();
  });

  it('placeProp spawns a prop:<key> object entity', () => {
    const before = [...h.sim.entities.values()].filter((e) => e.kind === 'object').length;
    h.sim.placeProp('barrel', 5, 6, 0, 1);
    const props = [...h.sim.entities.values()].filter(
      (e) => e.kind === 'object' && e.templateId === 'prop:barrel',
    );
    expect(props.length).toBe(1);
    expect([...h.sim.entities.values()].filter((e) => e.kind === 'object').length).toBe(before + 1);
  });

  it('loadProps replays rows and setPropMeta dialogue is spoken on interact', () => {
    h.sim.loadProps([
      { id: 100, propKey: 'statue', x: 0, z: 0, facing: 0, scale: 1, meta: {} },
    ]);
    const prop = [...h.sim.entities.values()].find((e) => e.templateId === 'prop:statue');
    expect(prop).toBeTruthy();

    h.sim.setPropMeta(100, { dialogue: 'Welcome, traveler.', music: '/m/town.mp3', voice: '' });

    // Stand the player on the prop and interact.
    const player = h.sim.entities.get(h.pid)!;
    player.pos = { x: 0, y: 0, z: 0 };
    h.sim.drainEvents();
    h.sim.interact(h.pid);

    const chat = h.sim
      .drainEvents()
      .find((e) => e.type === 'chat') as Extract<SimEvent, { type: 'chat' }> | undefined;
    expect(chat).toBeTruthy();
    expect(chat!.text).toBe('Welcome, traveler.');
    expect(chat!.entityId).toBe(prop!.id);
    expect(chat!.propAudio).toEqual({ music: '/m/town.mp3', voice: undefined });
  });

  it('removeProp drops the entity', () => {
    h.sim.loadProps([{ id: 7, propKey: 'lamp', x: 1, z: 1, facing: 0, scale: 1, meta: {} }]);
    expect([...h.sim.entities.values()].some((e) => e.templateId === 'prop:lamp')).toBe(true);
    h.sim.removeProp(7);
    expect([...h.sim.entities.values()].some((e) => e.templateId === 'prop:lamp')).toBe(false);
  });
});
