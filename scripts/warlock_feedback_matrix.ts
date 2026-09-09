import fs from 'node:fs';
import { ITEMS } from '../src/sim/data';
import type { PlayerEquipment } from '../src/sim/entity';
import {
  runWarlockBalanceProbe,
  WARLOCK_FULL_BIS_GEAR,
  WARLOCK_HEROIC_NYTHRAXIS_SCENARIO,
} from './warlock_balance_probe';

const heroic = { ...WARLOCK_FULL_BIS_GEAR };
const normal = Object.fromEntries(
  Object.entries(heroic).map(([slot, id]) => [
    slot,
    id.startsWith('heroic_') && ITEMS[id.slice(7)] ? id.slice(7) : id,
  ]),
) as PlayerEquipment;
const crucible = {
  ...heroic,
  helmet: 'ruincaller_helmet',
  shoulder: 'ruincaller_shoulder',
  chest: 'ruincaller_chest',
  gloves: 'ruincaller_gloves',
};
for (const gear of [normal, heroic, crucible])
  for (const id of Object.values(gear)) if (!ITEMS[id]) throw new Error(`Missing gear ${id}`);
// Fixed kits are comparison fixtures, not a claim of globally optimized BiS.
const output = process.argv[2] ?? 'tmp/warlock-feedback.json';
fs.mkdirSync('tmp', { recursive: true });
const rows: unknown[] = [];
for (const [gearName, equipment] of Object.entries({ normal, heroic, crucible })) {
  for (const seconds of [30, 180, 300])
    for (const secondaryTarget of [false, true])
      for (const usePyre of [false, true])
        for (const seed of [42, 1337]) {
          const result = runWarlockBalanceProbe('destruction', seed, seconds, {
            ...WARLOCK_HEROIC_NYTHRAXIS_SCENARIO,
            equipment,
            secondaryTarget,
            usePyre,
            isolated: true,
          });
          const row = { gearName, secondaryTarget, usePyre, ...result };
          rows.push(row);
          fs.writeFileSync(output, JSON.stringify(rows, null, 2));
          console.log(
            `${rows.length}: ${gearName} ${seconds}s targets=${secondaryTarget ? 2 : 1} pyre=${usePyre} seed=${seed} ${result.dps.toFixed(1)} DPS`,
          );
        }
  for (const spec of ['affliction', 'demonology'] as const)
    for (const seed of [42, 1337]) {
      const set = spec === 'affliction' ? 'hexthread' : 'gravebrand';
      const specGear =
        gearName === 'crucible'
          ? {
              ...equipment,
              helmet: `${set}_helmet`,
              shoulder: `${set}_shoulder`,
              chest: `${set}_chest`,
              gloves: `${set}_gloves`,
            }
          : equipment;
      const result = runWarlockBalanceProbe(spec, seed, 180, {
        ...WARLOCK_HEROIC_NYTHRAXIS_SCENARIO,
        equipment: specGear,
        isolated: true,
      });
      rows.push({ gearName, secondaryTarget: false, usePyre: true, ...result });
      fs.writeFileSync(output, JSON.stringify(rows, null, 2));
    }
}
