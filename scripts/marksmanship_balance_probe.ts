// Paired release/candidate receipts for the MM-only damage budget.
// Bundle this entry on each ref, then run both bundles with identical inputs.
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import type { Sim } from '../src/sim/sim';
import {
  type OwnedClassBalanceScenario,
  type OwnedDpsSpec,
  runOwnedClassDpsProbe,
} from './owned_class_balance_probe';

export type MarksmanProfile = 'stationary' | 'moving' | 'mobile-read' | 'without-cold-focus';
export type MarksmanGear = 'pbe' | 'coldsight-4pc' | 'naked';

export function runMarksmanBalanceProbe(
  spec: Extract<OwnedDpsSpec, 'coldsight' | 'packlord' | 'fieldcraft'>,
  seed: number,
  targets: 1 | 3,
  gear: MarksmanGear = 'pbe',
  profile: MarksmanProfile = 'stationary',
) {
  let distanceMoved = 0;
  let previous: { x: number; z: number } | undefined;
  const scenario: OwnedClassBalanceScenario = {
    targets,
    seconds: 120,
    window: 'raid',
    targetLevel: 22,
    targetTemplateId: 'nythraxis_scourge_of_thornpeak',
  };
  const result = runOwnedClassDpsProbe(
    spec,
    scenario,
    seed,
    'paired-mm-budget',
    undefined,
    gear === 'naked' ? 'naked' : 'pbe',
    (sim: Sim) => {
      if (gear !== 'coldsight-4pc') return;
      sim.setPlayerLevel(25);
      for (const slot of ['helmet', 'shoulder', 'chest', 'gloves'] as const) {
        const id = `coldsight_trackers_${slot}`;
        if (!ITEMS[id]) throw new Error(`missing set piece ${id}`);
        sim.addItem(id, 1);
        sim.equipItemToSlot(id, slot);
        if (sim.players.get(sim.playerId)?.equipment[slot] !== id) {
          throw new Error(`failed to equip ${id}`);
        }
      }
    },
    (sim, tick) => {
      const pos = sim.player.pos;
      if (previous) distanceMoved += Math.hypot(pos.x - previous.x, pos.z - previous.z);
      previous = { x: pos.x, z: pos.z };
      // Two seconds of real strafing every twelve seconds; alternate direction
      // within the window to stay near the original firing position.
      const phase = tick % 240;
      const movingProfile = profile === 'moving' || profile === 'mobile-read';
      sim.moveInput.strafeLeft = movingProfile && phase >= 100 && phase < 120;
      sim.moveInput.strafeRight = movingProfile && phase >= 120 && phase < 140;
      // Isolate the steady floor with the same real rotation and finite Focus.
      if (profile === 'without-cold-focus') sim.player.cooldowns.set('cold_focus', 999);
      // Exercise the alternative Read spender rather than crediting the
      // Long Draw-only moving policy with coverage of both choices.
      if (
        profile === 'mobile-read' &&
        !sim.player.castingAbility &&
        sim.player.gcdRemaining <= 0.001 &&
        sim.player.auras.some((aura) => aura.kind === 'hunter_coldsight_read')
      )
        return 'arcane_shot';
    },
    // Keep terrain, collision and real combat, but omit unrelated open-world
    // camps/NPCs. Both sides use this identical fixture and RNG history.
    { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  );
  return { ...result, gear, profile, distanceMoved };
}

if (process.argv[1]?.includes('marksmanship_balance')) {
  const seeds = (process.env.MM_PROBE_SEEDS ?? '29901,29902').split(',').map(Number);
  const mobileOnly = process.argv.includes('--mobile-only');
  for (const seed of seeds) {
    for (const targets of [1, 3] as const) {
      for (const spec of ['packlord', 'fieldcraft'] as const) {
        if (!mobileOnly) console.log(JSON.stringify(runMarksmanBalanceProbe(spec, seed, targets)));
      }
      for (const gear of ['pbe', 'coldsight-4pc', 'naked'] as const) {
        for (const profile of [
          'stationary',
          'moving',
          'mobile-read',
          'without-cold-focus',
        ] as const) {
          if (mobileOnly && profile !== 'mobile-read') continue;
          if (gear === 'naked' && profile !== 'stationary') continue;
          console.log(
            JSON.stringify(runMarksmanBalanceProbe('coldsight', seed, targets, gear, profile)),
          );
        }
      }
    }
  }
}
