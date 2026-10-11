import { Sim } from '../../src/sim/sim';
import { EMPTY_TEST_WORLD } from '../sim_shared';

/** Real simulation entities for presentation/audio tests, without previewer runtime. */
export function createWarriorVfxSim(spec: 'arms' | 'fury' | 'prot' = 'arms') {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    devCommands: true,
    compulsoryTutorial: false,
    riftPortals: false,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  if (!sim.applyTalents({ spec, rows: {} })) throw new Error('Invalid Warrior test spec');
  const existing = new Set(sim.entities.keys());
  sim.startDevSandbox();
  const targetIds = [...sim.entities.keys()].filter((id) => !existing.has(id));
  if (!targetIds.length) throw new Error('Warrior test requires a real sandbox target');
  return { sim, targetIds };
}
