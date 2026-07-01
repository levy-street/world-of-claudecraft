import { describe, expect, it } from 'vitest';
import { GATHERING_PROFESSION_IDS } from '../src/sim/content/professions';
import { emptyGatheringProficiencies } from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';

function makeWorld() {
  return new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
}

describe('gathering profession proficiency', () => {
  it('starts every gathering profession at zero', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Miner');

    expect(GATHERING_PROFESSION_IDS).toEqual(['mining', 'logging', 'herbalism']);
    expect(sim.gatheringProficienciesFor(pid)).toEqual(emptyGatheringProficiencies());
  });

  it('adds proficiency only to the profession and player being granted', () => {
    const sim = makeWorld();
    const miner = sim.addPlayer('warrior', 'Miner');
    const herbalist = sim.addPlayer('druid', 'Herbalist');

    expect(sim.gainGatheringProficiency('mining', 5, miner)).toBe(true);
    expect(sim.gainGatheringProficiency('mining', 2.9, miner)).toBe(true);
    expect(sim.gainGatheringProficiency('herbalism', 3, herbalist)).toBe(true);

    expect(sim.gatheringProficienciesFor(miner)).toEqual({
      mining: 7,
      logging: 0,
      herbalism: 0,
    });
    expect(sim.gatheringProficienciesFor(herbalist)).toEqual({
      mining: 0,
      logging: 0,
      herbalism: 3,
    });
  });

  it('ignores non-positive gains and missing players', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Careful');

    expect(sim.gainGatheringProficiency('logging', 0, pid)).toBe(false);
    expect(sim.gainGatheringProficiency('logging', -3, pid)).toBe(false);
    expect(sim.gainGatheringProficiency('logging', Number.NaN, pid)).toBe(false);
    expect(sim.gainGatheringProficiency('logging', 4, 9999)).toBe(false);

    expect(sim.gatheringProficienciesFor(pid)).toEqual(emptyGatheringProficiencies());
  });

  it('returns a copy so IWorld readers cannot mutate character state', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Reader');
    sim.gainGatheringProficiency('mining', 4, pid);

    const view = sim.gatheringProficienciesFor(pid);
    view.mining = 999;

    expect(sim.gatheringProficienciesFor(pid).mining).toBe(4);
    expect(sim.gatheringProficiencies.mining).toBe(4);
  });

  it('persists gathering proficiencies across a serialize and reload round-trip', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Saver');
    sim.gainGatheringProficiency('mining', 12, pid);
    sim.gainGatheringProficiency('logging', 6, pid);

    const state = sim.serializeCharacter(pid);
    expect(state).not.toBeNull();
    if (!state) throw new Error('expected serialized character state');
    expect(state.gatheringProficiencies).toEqual({
      mining: 12,
      logging: 6,
      herbalism: 0,
    });

    const loaded = makeWorld();
    const loadedPid = loaded.addPlayer('warrior', 'Saver', { state });
    expect(loaded.gatheringProficienciesFor(loadedPid)).toEqual({
      mining: 12,
      logging: 6,
      herbalism: 0,
    });
  });

  it('loads legacy saves without gathering proficiency as all-zero state', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'LegacySeed');
    const state = sim.serializeCharacter(pid);
    expect(state).not.toBeNull();
    if (!state) throw new Error('expected serialized character state');
    const legacy: Record<string, unknown> = { ...state };
    delete legacy.gatheringProficiencies;

    const loaded = makeWorld();
    const loadedPid = loaded.addPlayer('warrior', 'Legacy', { state: legacy as never });

    expect(loaded.gatheringProficienciesFor(loadedPid)).toEqual(emptyGatheringProficiencies());
    expect(loaded.serializeCharacter(loadedPid)?.gatheringProficiencies).toEqual(
      emptyGatheringProficiencies(),
    );
  });
});
